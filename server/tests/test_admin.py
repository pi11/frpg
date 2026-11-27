"""Admin rights from the shell and the admin API."""

from datetime import timedelta
from uuid import UUID

import httpx
import pytest
from app.models.admin import AdminAction
from app.models.auth import AuthIdentity, Profile
from app.models.run import Run
from app.services.admin import find_user, list_admins, set_admin
from app.services.content import get_content
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


def headers(pair: dict[str, object]) -> dict[str, str]:
    return {"Authorization": f"Bearer {pair['access_token']}"}


async def new_admin(api: dict[str, object]) -> tuple[dict[str, object], dict[str, str]]:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    pair = (await client.post("/api/v1/auth/guest")).json()
    async with factory() as session:
        assert await set_admin(session, str(pair["user_id"]), True) is not None
    return pair, headers(pair)


@pytest.mark.anyio
async def test_shell_command_grants_by_id_or_email_and_logs(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    pair = (await client.post("/api/v1/auth/guest")).json()
    user_id = UUID(pair["user_id"])
    async with factory() as session:
        session.add(AuthIdentity(user_id=user_id, provider="email", subject="boss@example.com"))
        await session.commit()
        assert await find_user(session, "nobody@example.com") is None
        assert await find_user(session, "not-an-id") is None
        found = await find_user(session, " Boss@Example.com ")
        assert found is not None and found.id == user_id
        assert (await set_admin(session, "boss@example.com", True)) is not None
        assert [user.id for user in await list_admins(session)] == [user_id]
        assert (await set_admin(session, str(user_id), True)) is not None
        actions = (await session.scalars(select(AdminAction))).all()
        assert [item.action for item in actions] == ["grant_admin"]
    profile = (await client.get("/api/v1/profile", headers=headers(pair))).json()
    assert profile["is_admin"] is True
    async with factory() as session:
        await set_admin(session, str(user_id), False)
        assert await list_admins(session) == []


@pytest.mark.anyio
async def test_admin_api_needs_admin(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    assert (await client.get("/api/v1/admin/stats")).status_code == 401
    player = headers((await client.post("/api/v1/auth/guest")).json())
    for path in ("/admin/stats", "/admin/users", "/admin/runs", "/admin/actions"):
        response = await client.get(f"/api/v1{path}", headers=player)
        assert response.status_code == 403 and response.json()["code"] == "forbidden"
    denied = await client.post(
        f"/api/v1/admin/users/{UUID(int=1)}/grant", json={"caps": 5}, headers=player,
    )
    assert denied.status_code == 403
    assert (await client.get("/api/v1/profile", headers=player)).json()["is_admin"] is False


@pytest.mark.anyio
async def test_stats_users_grants_and_runs(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    admin, auth = await new_admin(api)
    player = (await client.post("/api/v1/auth/guest")).json()
    player_id = player["user_id"]
    async with factory() as session:
        session.add(AuthIdentity(
            user_id=UUID(player_id), provider="email", subject="player@example.com"))
        await session.commit()

    started = (await client.post("/api/v1/runs/start", json={
        "location_id": "shelter_outskirts", "hero_id": "wanderer"}, headers=headers(player))).json()
    async with factory() as session:
        run = await session.get(Run, UUID(started["run_id"]))
        assert run is not None
        run.started_at = run.started_at - timedelta(seconds=200)
        await session.commit()
    finished = await client.post(f"/api/v1/runs/{started['run_id']}/finish", json={
        "content_hash": get_content().hash, "duration_seconds": 100,
        "kills_by_type": {"ghoul": 99_999}, "wave_reached": 1, "boss_killed": False,
        "picked_caps": 0,
    }, headers=headers(player))
    assert "kills_clamped" in finished.json()["flags"]

    stats = (await client.get("/api/v1/admin/stats", headers=auth)).json()
    assert stats["users_total"] == 2 and stats["users_admins"] == 1
    assert stats["runs_total"] == stats["runs_today"] == stats["runs_week"] == 1
    assert stats["flagged_week"] == 1 and stats["avg_duration_week"] == 100
    assert stats["locations_week"] == [{"key": "shelter_outskirts", "runs": 1, "bosses": 0}]
    assert len(stats["days"]) == 14 and stats["days"][-1]["players"] == 1

    found = (await client.get("/api/v1/admin/users?q=PLAYER@", headers=auth)).json()
    assert found["total"] == 1 and found["users"][0]["id"] == player_id
    by_id = (await client.get(f"/api/v1/admin/users?q={player_id}", headers=auth)).json()
    assert by_id["total"] == 1
    everyone = (await client.get("/api/v1/admin/users?sort=created&limit=1", headers=auth)).json()
    assert everyone["total"] == 2 and len(everyone["users"]) == 1
    assert (await client.get("/api/v1/admin/users?sort=bad", headers=auth)).status_code == 422

    detail = (await client.get(f"/api/v1/admin/users/{player_id}", headers=auth)).json()
    assert detail["user"]["runs_count"] == 1 and detail["runs"][0]["kills"] is not None
    assert (await client.get(f"/api/v1/admin/users/{UUID(int=1)}", headers=auth)).status_code == 404

    caps_before = detail["user"]["caps"]
    granted = await client.post(f"/api/v1/admin/users/{player_id}/grant", json={
        "caps": 500, "emeralds": 20, "note": "компенсация"}, headers=auth)
    assert granted.status_code == 200
    assert granted.json()["user"]["caps"] == caps_before + 500
    assert granted.json()["user"]["emeralds"] == detail["user"]["emeralds"] + 20
    taken = (await client.post(f"/api/v1/admin/users/{player_id}/grant", json={
        "emeralds": -1_000}, headers=auth)).json()
    assert taken["user"]["emeralds"] == 0
    too_much = await client.post(f"/api/v1/admin/users/{player_id}/grant",
                                 json={"caps": 10**9}, headers=auth)
    assert too_much.status_code == 422
    async with factory() as session:
        profile = await session.get(Profile, UUID(player_id))
        assert profile is not None and profile.version >= 3

    flagged = (await client.get("/api/v1/admin/runs?flagged=true", headers=auth)).json()
    assert [row["id"] for row in flagged] == [started["run_id"]]
    actions = (await client.get("/api/v1/admin/actions", headers=auth)).json()
    assert [item["action"] for item in actions][:2] == ["grant", "grant"]
    assert actions[1]["details"] == {"caps": 500, "emeralds": 20, "note": "компенсация"}
    assert actions[0]["admin_id"] == admin["user_id"]
