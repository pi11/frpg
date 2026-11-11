"""HTTP contract and state transitions for passwordless accounts."""

from datetime import timedelta
from urllib.parse import parse_qs, urlparse
from uuid import UUID

import httpx
import pytest
from app.config import get_settings
from app.models.auth import AuthIdentity, LoginToken, Profile, RefreshToken, User
from app.services.tokens import utcnow
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.anyio
async def test_guest_and_account_deletion(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    assert (await client.delete("/api/v1/account")).status_code == 401

    response = await client.post("/api/v1/auth/guest")
    assert response.status_code == 200
    pair = response.json()
    assert pair["is_guest"] is True
    async with factory() as session:
        profile = await session.get(Profile, UUID(pair["user_id"]))
        assert profile is not None and profile.caps == 0

    deleted = await client.delete("/api/v1/account", headers=auth_header(pair["access_token"]))
    assert deleted.status_code == 204
    assert (await client.delete(
        "/api/v1/account", headers=auth_header(pair["access_token"])
    )).status_code == 401
    async with factory() as session:
        assert await session.get(User, UUID(pair["user_id"])) is None
        assert await session.get(Profile, UUID(pair["user_id"])) is None
        assert await session.scalar(select(RefreshToken)) is None


@pytest.mark.anyio
async def test_guest_email_link_preserves_profile(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    sent: list[tuple[str, str, str]] = api["sent"]  # type: ignore[assignment]
    guest = (await client.post("/api/v1/auth/guest")).json()
    async with factory() as session:
        profile = await session.get(Profile, UUID(guest["user_id"]))
        assert profile is not None
        profile.caps = 123
        await session.commit()

    started = await client.post(
        "/api/v1/auth/email/start", json={"email": "Player@Example.com"},
        headers=auth_header(guest["access_token"]),
    )
    assert started.status_code == 200
    assert started.json() == {"status": "ok"}
    assert sent[0][0] == "player@example.com"
    code = sent[0][2]
    wrong = await client.post(
        "/api/v1/auth/email/verify", json={"email": "player@example.com", "code": "000000"}
    )
    assert wrong.status_code == 401 and wrong.json()["code"] == "invalid_code"
    verified = await client.post(
        "/api/v1/auth/email/verify", json={"email": "PLAYER@example.com", "code": code}
    )
    assert verified.status_code == 200
    assert verified.json()["user_id"] == guest["user_id"]
    assert verified.json()["is_guest"] is False
    assert (await client.post(
        "/api/v1/auth/email/verify", json={"email": "player@example.com", "code": code}
    )).status_code == 401

    async with factory() as session:
        profile = await session.get(Profile, UUID(guest["user_id"]))
        assert profile is not None and profile.caps == 123
        identity = await session.scalar(select(AuthIdentity))
        assert identity is not None and identity.subject == "player@example.com"
        challenge = await session.scalar(select(LoginToken))
        assert challenge is not None and challenge.attempts == 1

    repeated = await client.post("/api/v1/auth/email/start", json={"email": "player@example.com"})
    assert repeated.status_code == 200 and len(sent) == 1


@pytest.mark.anyio
async def test_email_token_registration_and_expiry(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    sent: list[tuple[str, str, str]] = api["sent"]  # type: ignore[assignment]
    assert (await client.post(
        "/api/v1/auth/email/start", json={"email": "new@example.com"}
    )).status_code == 200
    raw = parse_qs(urlparse(sent[0][1]).query)["token"][0]
    result = await client.post("/api/v1/auth/email/verify", json={"token": raw})
    assert result.status_code == 200 and result.json()["is_guest"] is False
    assert (await client.post(
        "/api/v1/auth/email/verify", json={"token": raw}
    )).status_code == 401

    await client.post("/api/v1/auth/email/start", json={"email": "expired@example.com"})
    async with factory() as session:
        challenge = await session.scalar(
            select(LoginToken).where(LoginToken.email == "expired@example.com")
        )
        assert challenge is not None
        challenge.expires_at = utcnow() - timedelta(seconds=1)
        await session.commit()
    expired_raw = parse_qs(urlparse(sent[1][1]).query)["token"][0]
    expired = await client.post("/api/v1/auth/email/verify", json={"token": expired_raw})
    assert expired.status_code == 401 and expired.json()["code"] == "expired"


@pytest.mark.anyio
async def test_code_attempt_limit_and_malformed_requests(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    sent: list[tuple[str, str, str]] = api["sent"]  # type: ignore[assignment]
    assert (await client.post("/api/v1/auth/email/verify", json={})).status_code == 422
    assert (await client.post(
        "/api/v1/auth/email/start", json={"email": "not-an-email"}
    )).status_code == 422
    await client.post("/api/v1/auth/email/start", json={"email": "limit@example.com"})
    correct = sent[0][2]
    wrong = "000000" if correct != "000000" else "111111"
    for _ in range(5):
        response = await client.post(
            "/api/v1/auth/email/verify", json={"email": "limit@example.com", "code": wrong}
        )
        assert response.status_code == 401
    response = await client.post(
        "/api/v1/auth/email/verify", json={"email": "limit@example.com", "code": correct}
    )
    assert response.status_code == 401 and response.json()["code"] == "invalid_code"


@pytest.mark.anyio
async def test_refresh_rotation_reuse_and_logout(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    first = (await client.post("/api/v1/auth/guest")).json()
    second_response = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": first["refresh_token"]}
    )
    assert second_response.status_code == 200
    second = second_response.json()
    assert second["refresh_token"] != first["refresh_token"]
    reused = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": first["refresh_token"]}
    )
    assert reused.status_code == 401
    assert (await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": second["refresh_token"]}
    )).status_code == 401
    assert (await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": "nonsense"}
    )).status_code == 401

    third = (await client.post("/api/v1/auth/guest")).json()
    assert (await client.post(
        "/api/v1/auth/logout", json={"refresh_token": third["refresh_token"]}
    )).status_code == 401
    logged_out = await client.post(
        "/api/v1/auth/logout", json={"refresh_token": third["refresh_token"]},
        headers=auth_header(third["access_token"]),
    )
    assert logged_out.status_code == 200
    assert (await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": third["refresh_token"]}
    )).status_code == 401


@pytest.mark.anyio
async def test_missing_jwt_secret_is_server_error(
    api: dict[str, object], monkeypatch: pytest.MonkeyPatch,
) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    monkeypatch.setenv("JWT_SECRET", "")
    get_settings.cache_clear()
    response = await client.post("/api/v1/auth/guest")
    assert response.status_code == 503
    assert response.json()["code"] == "not_configured"


@pytest.mark.anyio
async def test_email_ip_limit_has_uniform_response(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    sent: list[tuple[str, str, str]] = api["sent"]  # type: ignore[assignment]
    for index in range(21):
        response = await client.post(
            "/api/v1/auth/email/start", json={"email": f"player{index}@example.com"}
        )
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
    assert len(sent) == 20
