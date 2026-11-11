"""Profile, purchases and run settlement over the HTTP API."""

from datetime import timedelta
from uuid import UUID, uuid4

import httpx
import pytest
from app.models.auth import Profile
from app.models.run import Run
from app.services.content import get_content
from app.services.economy import run_reward, upgrade_cost
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


def headers(pair: dict[str, object]) -> dict[str, str]:
    return {"Authorization": f"Bearer {pair['access_token']}"}


@pytest.mark.anyio
async def test_content_etag_and_profile_auth(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    assert (await client.get("/api/v1/profile")).status_code == 401
    response = await client.get("/api/v1/content")
    assert response.status_code == 200
    assert response.json()["hash"] == get_content().hash
    etag = response.headers["etag"]
    cached = await client.get("/api/v1/content", headers={"If-None-Match": etag})
    assert cached.status_code == 304
    guest = (await client.post("/api/v1/auth/guest")).json()
    profile = (await client.get("/api/v1/profile", headers=headers(guest))).json()
    assert profile["caps"] == 0 and profile["version"] == 0
    assert profile["is_guest"] and profile["upgrades"] == {}


@pytest.mark.anyio
async def test_purchase_is_versioned_and_uses_server_price(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    guest = (await client.post("/api/v1/auth/guest")).json()
    auth = headers(guest)
    assert (await client.post(
        "/api/v1/upgrades/missing/buy", json={"expected_version": 0}, headers=auth
    )).status_code == 404
    short = await client.post(
        "/api/v1/upgrades/armor_plates/buy", json={"expected_version": 0}, headers=auth
    )
    assert short.status_code == 409 and short.json()["code"] == "conflict"
    async with factory() as session:
        profile = await session.get(Profile, UUID(guest["user_id"]))
        assert profile is not None
        profile.caps = 100
        await session.commit()
    bought = await client.post(
        "/api/v1/upgrades/armor_plates/buy", json={"expected_version": 0}, headers=auth
    )
    assert bought.status_code == 200
    assert bought.json()["caps"] == 70
    assert bought.json()["version"] == 1
    assert bought.json()["upgrades"] == {"armor_plates": 1}
    duplicate = await client.post(
        "/api/v1/upgrades/armor_plates/buy", json={"expected_version": 0}, headers=auth
    )
    assert duplicate.status_code == 409
    profile = (await client.get("/api/v1/profile", headers=auth)).json()
    assert profile["caps"] == 70 and profile["upgrades"] == {"armor_plates": 1}


@pytest.mark.anyio
async def test_run_reward_clamps_fraud_and_finish_is_idempotent(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    guest = (await client.post("/api/v1/auth/guest")).json()
    auth = headers(guest)
    assert (await client.post(
        "/api/v1/runs/start", json={"location_id": "missing", "hero_id": "wanderer"},
        headers=auth,
    )).status_code == 404
    body = {"location_id": "shelter_outskirts", "hero_id": "wanderer"}
    previous = (await client.post("/api/v1/runs/start", json=body, headers=auth)).json()
    started = (await client.post("/api/v1/runs/start", json=body, headers=auth)).json()
    summary = {
        "content_hash": started["content_hash"], "duration_seconds": 60,
        "kills_by_type": {"ghoul": 10000}, "wave_reached": 20,
        "boss_killed": True, "picked_caps": 10000,
    }
    abandoned = await client.post(
        f"/api/v1/runs/{previous['run_id']}/finish", json=summary, headers=auth
    )
    assert abandoned.status_code == 409
    result = await client.post(
        f"/api/v1/runs/{started['run_id']}/finish", json=summary, headers=auth
    )
    assert result.status_code == 200
    data = result.json()
    assert set(data["flags"]) >= {
        "duration_clamped", "kills_clamped", "caps_clamped", "wave_clamped", "boss_clamped"
    }
    assert data["reward_caps"] < 1000
    assert data["profile"]["caps"] == data["reward_caps"]
    assert data["profile"]["runs_count"] == 1
    replay = await client.post(
        f"/api/v1/runs/{started['run_id']}/finish", json=summary, headers=auth
    )
    assert replay.status_code == 200
    assert replay.json()["reward_caps"] == data["reward_caps"]
    assert replay.json()["profile"]["caps"] == data["reward_caps"]
    async with factory() as session:
        run = await session.scalar(select(Run).where(Run.id == UUID(started["run_id"])))
        assert run is not None and run.status == "finished"
        assert run.summary is not None and run.summary["accepted"]["kills"] < 10000


@pytest.mark.anyio
async def test_run_errors_and_profile_survives_email_login(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    sent: list[tuple[str, str, str]] = api["sent"]  # type: ignore[assignment]
    guest = (await client.post("/api/v1/auth/guest")).json()
    auth = headers(guest)
    start = (await client.post(
        "/api/v1/runs/start",
        json={"location_id": "shelter_outskirts", "hero_id": "wanderer"},
        headers=auth,
    )).json()
    finish_url = f"/api/v1/runs/{start['run_id']}/finish"
    invalid = await client.post(finish_url, json={
        "content_hash": start["content_hash"], "duration_seconds": -1,
        "kills_by_type": {}, "wave_reached": 1, "boss_killed": False, "picked_caps": 0,
    }, headers=auth)
    assert invalid.status_code == 422
    summary = {
        "content_hash": start["content_hash"], "duration_seconds": 0,
        "kills_by_type": {}, "wave_reached": 1, "boss_killed": False, "picked_caps": 0,
    }
    other = (await client.post("/api/v1/auth/guest")).json()
    assert (await client.post(finish_url, json=summary, headers=headers(other))).status_code == 404
    assert (await client.post(finish_url, json=summary, headers=auth)).status_code == 200
    await client.post(
        "/api/v1/auth/email/start", json={"email": "device@example.com"}, headers=auth
    )
    linked = (await client.post(
        "/api/v1/auth/email/verify",
        json={"email": "device@example.com", "code": sent[0][2]},
    )).json()
    assert linked["user_id"] == guest["user_id"]
    profile = (await client.get("/api/v1/profile", headers=headers(linked))).json()
    assert profile["runs_count"] == 1 and profile["caps"] > 0
    assert profile["identities"] == [{"provider": "email", "subject": "device@example.com"}]


@pytest.mark.anyio
async def test_honest_run_gets_exact_reward_without_flags(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    guest = (await client.post("/api/v1/auth/guest")).json()
    auth = headers(guest)
    started = (await client.post(
        "/api/v1/runs/start",
        json={"location_id": "shelter_outskirts", "hero_id": "wanderer"}, headers=auth,
    )).json()
    assert 0 <= started["seed"] < 2**32
    async with factory() as session:
        run = await session.get(Run, UUID(started["run_id"]))
        assert run is not None
        run.started_at = run.started_at - timedelta(seconds=150)
        await session.commit()
    summary = {
        "content_hash": get_content().hash, "duration_seconds": 130,
        "kills_by_type": {"ghoul": 120, "roach": 30}, "wave_reached": 2,
        "boss_killed": False, "picked_caps": 0,
    }
    result = await client.post(
        f"/api/v1/runs/{started['run_id']}/finish", json=summary, headers=auth
    )
    assert result.status_code == 200
    expected = run_reward(get_content().balance["reward"], 130, 150, 2, False, 0)
    assert result.json()["flags"] == []
    assert result.json()["reward_caps"] == expected
    assert result.json()["profile"]["best_time_s"] == 130


@pytest.mark.anyio
async def test_stale_content_and_unknown_enemy_are_flagged(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    auth = headers((await client.post("/api/v1/auth/guest")).json())
    started = (await client.post(
        "/api/v1/runs/start",
        json={"location_id": "shelter_outskirts", "hero_id": "wanderer"}, headers=auth,
    )).json()
    result = await client.post(f"/api/v1/runs/{started['run_id']}/finish", json={
        "content_hash": "0" * 64, "duration_seconds": 0, "kills_by_type": {"dragon": 1},
        "wave_reached": 1, "boss_killed": False, "picked_caps": 0,
    }, headers=auth)
    assert result.status_code == 200
    assert set(result.json()["flags"]) == {"content_hash_mismatch", "unknown_enemy"}


@pytest.mark.anyio
async def test_profile_and_run_endpoint_errors(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    body = {"location_id": "shelter_outskirts", "hero_id": "wanderer"}
    assert (await client.post("/api/v1/runs/start", json=body)).status_code == 401
    assert (await client.post(
        "/api/v1/upgrades/armor_plates/buy", json={"expected_version": 0}
    )).status_code == 401
    empty_summary = {
        "content_hash": "x", "duration_seconds": 0, "kills_by_type": {},
        "wave_reached": 1, "boss_killed": False, "picked_caps": 0,
    }
    assert (await client.post(
        f"/api/v1/runs/{uuid4()}/finish", json=empty_summary
    )).status_code == 401
    guest = (await client.post("/api/v1/auth/guest")).json()
    auth = headers(guest)
    missing_hero = await client.post(
        "/api/v1/runs/start", json={**body, "hero_id": "missing"}, headers=auth
    )
    assert missing_hero.status_code == 404 and missing_hero.json()["code"] == "not_found"
    assert (await client.post(
        f"/api/v1/runs/{uuid4()}/finish", json=empty_summary, headers=auth,
    )).status_code == 404
    assert (await client.post(
        "/api/v1/upgrades/armor_plates/buy", json={"expected_version": -1}, headers=auth
    )).status_code == 422
    upgrade = get_content().category("upgrades")["armor_plates"]
    async with factory() as session:
        profile = await session.get(Profile, UUID(guest["user_id"]))
        assert profile is not None
        profile.caps = 10**6
        profile.data = {"upgrades": {"armor_plates": upgrade["maxLevel"]}}
        await session.commit()
    maxed = await client.post(
        "/api/v1/upgrades/armor_plates/buy", json={"expected_version": 0}, headers=auth
    )
    assert maxed.status_code == 409 and maxed.json()["code"] == "conflict"
    priced = await client.post(
        "/api/v1/upgrades/field_training/buy", json={"expected_version": 0}, headers=auth
    )
    assert priced.status_code == 200
    field = get_content().category("upgrades")["field_training"]
    assert priced.json()["caps"] == 10**6 - upgrade_cost(field, 0)
