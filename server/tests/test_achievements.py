"""Achievement conditions and their one-time reward."""

from datetime import timedelta
from typing import Any
from uuid import UUID

import httpx
import pytest
from app.models.run import Run
from app.services.achievements import RunFacts, grant_achievements, new_achievements
from app.services.content import get_content
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


def facts(**changes: Any) -> RunFacts:
    values: dict[str, Any] = {
        "location": "shelter_outskirts", "duration": 60, "kills": 0, "picked_caps": 0,
        "boss_killed": False, "autopilot": False, "reported": (), **changes,
    }
    return RunFacts(**values)


def earned(run: RunFacts | None, data: dict[str, Any] | None = None) -> list[str]:
    return new_achievements(get_content().category("achievements"), data or {}, run)


def test_metric_conditions() -> None:
    assert earned(facts(kills=99)) == []
    assert earned(facts(kills=100)) == ["first_hundred"]
    assert earned(facts(kills=100), {"achievements": ["first_hundred"]}) == []
    assert earned(facts(boss_killed=True)) == ["junk_king_down"]
    assert earned(facts(boss_killed=True, location="dead_city")) == ["iron_mayor_down"]
    assert earned(None, {"unlocks": list("abcde")}) == ["armory"]
    assert earned(facts(), {"runs_count": 25}) == ["regular"]
    # The autopilot does not earn run achievements, long-term ones still count.
    assert earned(facts(kills=5000, autopilot=True), {"runs_count": 25}) == ["regular"]


def test_reported_conditions_have_limits() -> None:
    assert earned(facts(duration=1, reported=["tickle"])) == ["tickle"]
    assert earned(facts(duration=119, reported=["rooted"])) == []
    assert earned(facts(duration=120, reported=["rooted"])) == ["rooted"]
    assert earned(facts(duration=800, reported=["boss_blitz"])) == []
    assert "boss_blitz" in earned(facts(duration=800, reported=["boss_blitz"], boss_killed=True))
    assert earned(facts(duration=600, reported=["tea_time"])) == []
    assert earned(facts(duration=600, reported=["tea_time", "rooted"], autopilot=True)) == [
        "tea_time"]
    # Metric achievements cannot be claimed by name.
    assert earned(facts(reported=["meat_grinder", "unknown"])) == []


def test_reward_is_added_once() -> None:
    items = get_content().category("achievements")
    data, new = grant_achievements(items, {"emeralds": 2}, facts(reported=["tickle"]))
    assert new == ["tickle"] and data["emeralds"] == 2 + items["tickle"]["emeralds"]
    assert grant_achievements(items, data, facts(reported=["tickle"])) == (data, [])


@pytest.mark.anyio
async def test_run_finish_grants_achievements(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    guest = (await client.post("/api/v1/auth/guest")).json()
    auth = {"Authorization": f"Bearer {guest['access_token']}"}
    started = (await client.post("/api/v1/runs/start", json={
        "location_id": "shelter_outskirts", "hero_id": "wanderer"}, headers=auth)).json()
    async with factory() as session:
        run = await session.get(Run, UUID(started["run_id"]))
        assert run is not None
        run.started_at = run.started_at - timedelta(seconds=140)
        await session.commit()
    body = {
        "content_hash": get_content().hash, "duration_seconds": 130,
        "kills_by_type": {"ghoul": 120}, "wave_reached": 2, "boss_killed": False,
        "picked_caps": 0, "achievements": ["tickle", "statue"],
    }
    url = f"/api/v1/runs/{started['run_id']}/finish"
    assert (await client.post(url, json={**body, "achievements": ["x" * 65]},
                              headers=auth)).status_code == 422
    first = (await client.post(url, json=body, headers=auth)).json()
    assert first["achievements"] == ["first_hundred", "tickle"]
    items = get_content().category("achievements")
    total = items["first_hundred"]["emeralds"] + items["tickle"]["emeralds"]
    assert first["profile"]["achievements"] == ["first_hundred", "tickle"]
    assert first["profile"]["emeralds"] == total and first["reward_emeralds"] == 0
    replay = (await client.post(url, json=body, headers=auth)).json()
    assert replay["achievements"] == first["achievements"]
    assert replay["profile"]["emeralds"] == total
