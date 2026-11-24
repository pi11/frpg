"""Production maintenance: clean-up, settings check and webhook registration."""

from datetime import timedelta
from uuid import UUID

import httpx
import pytest
from app.config import Settings
from app.models.auth import LoginToken, Profile, RefreshToken, TelegramLoginRequest, User
from app.services.check_config import production_problems
from app.services.cleanup import cleanup
from app.services.telegram_webhook import set_webhook
from app.services.tokens import as_utc, digest, utcnow
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

NOW = utcnow()


def login_token(email: str, expired_for: timedelta) -> LoginToken:
    return LoginToken(
        email=email, request_ip="127.0.0.1", token_hash=digest(email), code_hash="x",
        expires_at=NOW - expired_for,
    )


def telegram_request(name: str, expired_for: timedelta) -> TelegramLoginRequest:
    return TelegramLoginRequest(
        nonce_hash=digest(name), poll_secret_hash="x", request_ip="127.0.0.1",
        expires_at=NOW - expired_for,
    )


@pytest.mark.anyio
async def test_cleanup_removes_only_stale_data(api: dict[str, object]) -> None:
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    old, fresh = timedelta(days=91), timedelta(days=89)
    async with factory() as session:
        stale = User(is_guest=True, last_seen_at=NOW - old)
        recent = User(is_guest=True, last_seen_at=NOW - fresh)
        player = User(is_guest=False, last_seen_at=NOW - old)
        session.add_all([stale, recent, player])
        await session.flush()
        for user in (stale, recent, player):
            session.add(Profile(user_id=user.id, data={}))
        session.add_all([
            login_token("old@example.com", timedelta(hours=25)),
            login_token("new@example.com", timedelta(hours=23)),
            telegram_request("old", timedelta(hours=25)),
            telegram_request("new", timedelta(hours=23)),
            RefreshToken(user_id=player.id, token_hash="old", expires_at=NOW - old),
            RefreshToken(user_id=player.id, token_hash="new", expires_at=NOW + fresh),
        ])
        kept = {recent.id, player.id}
        await session.commit()
    async with factory() as session:
        result = await cleanup(session, NOW)
    assert (result.guests, result.login_tokens, result.telegram_requests,
            result.refresh_tokens) == (1, 1, 1, 1)
    async with factory() as session:
        assert set(await session.scalars(select(User.id))) == kept
        assert set(await session.scalars(select(Profile.user_id))) == kept
        assert list(await session.scalars(select(LoginToken.email))) == ["new@example.com"]
        assert list(await session.scalars(
            select(TelegramLoginRequest.nonce_hash))) == [digest("new")]
        assert list(await session.scalars(select(RefreshToken.token_hash))) == ["new"]


@pytest.mark.anyio
async def test_refresh_counts_as_activity(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    guest = (await client.post("/api/v1/auth/guest")).json()
    async with factory() as session:
        user = await session.get(User, UUID(guest["user_id"]))
        assert user is not None
        user.last_seen_at = NOW - timedelta(days=100)
        await session.commit()
    response = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": guest["refresh_token"]})
    assert response.status_code == 200
    async with factory() as session:
        user = await session.get(User, UUID(guest["user_id"]))
        assert user is not None and as_utc(user.last_seen_at) > NOW - timedelta(minutes=1)


def production_settings(**changes: object) -> Settings:
    values: dict[str, object] = {
        "public_url": "https://game.example.com", "jwt_secret": "s" * 32,
        "mail_backend": "resend", "resend_api_key": "key", "mail_from": "login@example.com",
        "telegram_bot_token": "1:token", "telegram_bot_username": "bot",
        "telegram_webhook_secret": "secret", "cors_origins": ["https://game.example.com"],
    }
    return Settings.model_validate(values | changes)


def test_production_settings_are_accepted() -> None:
    assert production_problems(production_settings()) == []


@pytest.mark.parametrize("changes", [
    {"public_url": "http://game.example.com"},
    {"public_url": "https://game.example.com/path"},
    {"jwt_secret": "short"},
    {"mail_backend": "console"},
    {"resend_api_key": ""},
    {"telegram_webhook_secret": ""},
    {"cors_origins": ["*"]},
])
def test_unsafe_production_settings_are_rejected(changes: dict[str, object]) -> None:
    assert len(production_problems(production_settings(**changes))) == 1


class FakeBot:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []

    async def set_webhook(self, url: str, **options: object) -> None:
        self.calls.append((url, options))


@pytest.mark.anyio
async def test_webhook_registration() -> None:
    bot = FakeBot()
    await set_webhook(bot, production_settings())  # type: ignore[arg-type]
    assert bot.calls == [("https://game.example.com/api/v1/telegram/webhook", {
        "secret_token": "secret", "allowed_updates": ["message", "callback_query"],
    })]
    with pytest.raises(ValueError):
        await set_webhook(
            bot, production_settings(public_url="http://localhost"))  # type: ignore[arg-type]
    assert len(bot.calls) == 1
