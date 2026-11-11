"""Telegram request polling and webhook boundaries."""

from datetime import timedelta
from urllib.parse import parse_qs, urlparse
from uuid import UUID

import httpx
import pytest
from app.config import get_settings
from app.models.auth import AuthIdentity, Profile, TelegramLoginRequest
from app.services import telegram as telegram_service
from app.services.tokens import utcnow
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


@pytest.mark.anyio
async def test_telegram_login_and_guest_link(
    api: dict[str, object], monkeypatch: pytest.MonkeyPatch,
) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    monkeypatch.setattr(telegram_service, "SessionFactory", factory)
    guest = (await client.post("/api/v1/auth/guest")).json()
    async with factory() as session:
        profile = await session.get(Profile, UUID(guest["user_id"]))
        assert profile is not None
        profile.caps = 55
        await session.commit()

    started = await client.post(
        "/api/v1/auth/telegram/start",
        headers={"Authorization": f"Bearer {guest['access_token']}"},
    )
    assert started.status_code == 200
    info = started.json()
    nonce = parse_qs(urlparse(info["deep_link"]).query)["start"][0]
    poll_path = f"/api/v1/auth/telegram/poll/{info['request_id']}"
    assert (await client.get(
        poll_path, headers={"X-Poll-Secret": "bad"}
    )).status_code == 401
    pending = await client.get(poll_path, headers={"X-Poll-Secret": info["poll_secret"]})
    assert pending.status_code == 200 and pending.json()["status"] == "pending"
    assert (await client.get(
        poll_path, headers={"X-Poll-Secret": info["poll_secret"]}
    )).status_code == 429
    assert await telegram_service.valid_nonce(nonce)
    assert await telegram_service.confirm_nonce(nonce, 987654321)
    assert not await telegram_service.confirm_nonce(nonce, 123)

    async with factory() as session:
        challenge = await session.get(TelegramLoginRequest, UUID(info["request_id"]))
        assert challenge is not None
        challenge.last_polled_at = utcnow() - timedelta(seconds=2)
        await session.commit()
    confirmed = await client.get(poll_path, headers={"X-Poll-Secret": info["poll_secret"]})
    assert confirmed.status_code == 200
    assert confirmed.json()["status"] == "confirmed"
    tokens = confirmed.json()["tokens"]
    assert tokens["user_id"] == guest["user_id"] and tokens["is_guest"] is False
    expired = await client.get(poll_path, headers={"X-Poll-Secret": info["poll_secret"]})
    assert expired.status_code == 200 and expired.json()["status"] == "expired"
    async with factory() as session:
        profile = await session.get(Profile, UUID(guest["user_id"]))
        identity = await session.scalar(select(AuthIdentity))
        assert profile is not None and profile.caps == 55
        assert identity is not None and identity.subject == "987654321"


@pytest.mark.anyio
async def test_telegram_start_rate_limit_and_configuration(
    api: dict[str, object], monkeypatch: pytest.MonkeyPatch,
) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    for _ in range(10):
        assert (await client.post("/api/v1/auth/telegram/start")).status_code == 200
    response = await client.post("/api/v1/auth/telegram/start")
    assert response.status_code == 429
    monkeypatch.setenv("TELEGRAM_BOT_USERNAME", "")
    get_settings.cache_clear()
    assert (await client.post("/api/v1/auth/telegram/start")).status_code == 503


@pytest.mark.anyio
async def test_webhook_secret_and_dispatch(
    api: dict[str, object], monkeypatch: pytest.MonkeyPatch,
) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    received: list[dict[str, object]] = []

    async def fake_feed(_bot: object, payload: dict[str, object]) -> None:
        received.append(payload)

    monkeypatch.setattr("app.api.telegram.feed_webhook", fake_feed)
    assert (await client.post(
        "/api/v1/telegram/webhook", json={"update_id": 1},
        headers={"X-Telegram-Bot-Api-Secret-Token": "bad"},
    )).status_code == 403
    response = await client.post(
        "/api/v1/telegram/webhook", json={"update_id": 2},
        headers={"X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret"},
    )
    assert response.status_code == 200
    assert received == [{"update_id": 2}]
