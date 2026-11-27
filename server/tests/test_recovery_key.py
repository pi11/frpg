"""Account keys: reveal, sign in elsewhere, renew."""

from datetime import timedelta
from uuid import UUID, uuid4

import httpx
import pytest
from app.models.auth import Profile, RecoveryKey, User
from app.services.cleanup import cleanup
from app.services.recovery import derive_key, format_key, normalize_key
from app.services.tokens import utcnow
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


def headers(pair: dict[str, object]) -> dict[str, str]:
    return {"Authorization": f"Bearer {pair['access_token']}"}


def test_key_format_and_typos(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.services.recovery.require_jwt_secret", lambda: "s" * 40)
    user = uuid4()
    key = derive_key(user, 1)
    assert key == derive_key(user, 1)
    assert len({key, derive_key(user, 2), derive_key(uuid4(), 1)}) == 3
    shown = format_key(key)
    assert len(shown) == 23 and shown.count("-") == 3
    assert normalize_key(f"  {shown.lower().replace('-', ' ')} ") == key
    assert normalize_key("O0I1L" * 4) == "00111" * 4
    for bad in ("", key[:-1], key + "0", "U" * 20, "я" * 20):
        assert normalize_key(bad) is None


@pytest.mark.anyio
async def test_key_opens_the_same_account(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    guest = (await client.post("/api/v1/auth/guest")).json()
    assert (await client.post("/api/v1/account/key")).status_code == 401
    assert (await client.post("/api/v1/account/key/renew")).status_code == 401
    shown = (await client.post("/api/v1/account/key", headers=headers(guest))).json()["key"]
    again = (await client.post("/api/v1/account/key", headers=headers(guest))).json()["key"]
    assert shown == again
    async with factory() as session:
        row = await session.get(RecoveryKey, UUID(guest["user_id"]))
        assert row is not None and shown.replace("-", "") not in row.key_hash

    login = await client.post("/api/v1/auth/key", json={"key": shown.lower()})
    assert login.status_code == 200
    assert login.json()["user_id"] == guest["user_id"] and not login.json()["is_guest"]
    async with factory() as session:
        profile = await session.get(Profile, UUID(guest["user_id"]))
        assert profile is not None
        assert (profile.data or {}).get("achievements_unclaimed") == ["key_master"]
    # A second sign-in does not grant it again.
    assert (await client.post("/api/v1/auth/key", json={"key": shown})).status_code == 200
    async with factory() as session:
        profile = await session.get(Profile, UUID(guest["user_id"]))
        assert profile is not None and (profile.data or {}).get("achievements") == ["key_master"]
    for wrong in ("", "AAAAA-AAAAA-AAAAA-AAAAA", "hello"):
        response = await client.post("/api/v1/auth/key", json={"key": wrong})
        assert response.status_code == 401 and response.json()["code"] == "invalid_code"
    assert (await client.post("/api/v1/auth/key", json={"key": "A" * 65})).status_code == 422

    renewed = (await client.post("/api/v1/account/key/renew", headers=headers(guest))).json()["key"]
    assert renewed != shown
    assert (await client.post("/api/v1/auth/key", json={"key": shown})).status_code == 401
    assert (await client.post("/api/v1/auth/key", json={"key": renewed})).status_code == 200

    # A player who saved the key is not cleaned up as an inactive guest.
    other = (await client.post("/api/v1/auth/guest")).json()
    async with factory() as session:
        for pair in (guest, other):
            user = await session.get(User, UUID(pair["user_id"]))
            assert user is not None
            user.last_seen_at = utcnow() - timedelta(days=200)
        await session.commit()
        assert (await cleanup(session, utcnow())).guests == 1
    assert (await client.post("/api/v1/auth/key", json={"key": renewed})).status_code == 200
    await client.delete("/api/v1/account", headers=headers(guest))
    assert (await client.post("/api/v1/auth/key", json={"key": renewed})).status_code == 401
