"""Daily quests: same for everyone, progress from runs, one claim each."""

from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID

import httpx
import pytest
from app.models.run import Run
from app.services.content import get_content
from app.services.daily import add_run, daily_view, game_day, pick_quests, resets_at
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

RULES = get_content().balance["daily"]
TEMPLATES = get_content().category("daily")


def test_quests_depend_only_on_the_day() -> None:
    day = date(2026, 11, 26)
    first = pick_quests(day, TEMPLATES, RULES)
    assert first == pick_quests(day, TEMPLATES, RULES)
    assert RULES["minQuests"] <= len(first) <= RULES["maxQuests"]
    assert len({quest["id"] for quest in first}) == len(first)
    days = [pick_quests(day + timedelta(days=shift), TEMPLATES, RULES) for shift in range(30)]
    assert len({tuple(quest["id"] for quest in quests) for quests in days}) > 10
    for quests in days:
        for quest in quests:
            assert "{goal}" not in quest["text"] and quest["emeralds"] > 0


def test_day_changes_at_game_midnight() -> None:
    offset = RULES["utcOffsetHours"]
    before = datetime(2026, 11, 26, 23 - offset, 59, tzinfo=UTC)
    assert game_day(before, RULES) == date(2026, 11, 26)
    assert game_day(before + timedelta(minutes=1), RULES) == date(2026, 11, 27)
    assert resets_at(date(2026, 11, 26), RULES) == before + timedelta(minutes=1)


def run(**changes: Any) -> dict[str, Any]:
    return {"kills": 0, "kills_by_type": {}, "duration": 0, "elites": 0, "picked_caps": 0,
            "boss_killed": False, **changes}


def test_progress_sums_runs_and_stops_at_the_goal() -> None:
    day = date(2026, 11, 26)
    quests = [
        {"id": "a", "metric": "kills", "goal": 100},
        {"id": "b", "metric": "survive", "goal": 300},
        {"id": "c", "metric": "enemyKills", "enemy": "ghoul", "goal": 50},
        {"id": "d", "metric": "runs", "goal": 2},
    ]
    data = add_run({}, quests, day, run(kills=60, duration=200,
                                        kills_by_type={"ghoul": 70, "roach": 5}), RULES)
    data = add_run(data, quests, day, run(kills=60, duration=30, kills_by_type={"ghoul": 1}), RULES)
    assert data["daily"]["progress"] == {"a": 100, "b": 200, "c": 50, "d": 1}
    # A new day starts from zero.
    later = add_run(data, quests, day + timedelta(days=1), run(kills=1), RULES)
    assert later["daily"]["progress"]["a"] == 1
    view = daily_view(data, [{**quest, "text": "x", "emeralds": 1} for quest in quests], day, RULES)
    assert [quest.progress for quest in view.quests] == [100, 200, 50, 1]


@pytest.mark.anyio
async def test_daily_claim_flow(api: dict[str, object], monkeypatch: pytest.MonkeyPatch) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    monkeypatch.setitem(RULES, "minQuests", 4)
    monkeypatch.setitem(RULES, "maxQuests", 4)
    guest = (await client.post("/api/v1/auth/guest")).json()
    auth = {"Authorization": f"Bearer {guest['access_token']}"}
    profile = (await client.get("/api/v1/profile", headers=auth)).json()
    quests = profile["daily"]["quests"]
    assert len(quests) == 4 and all(quest["progress"] == 0 for quest in quests)
    assert (await client.post("/api/v1/daily/kill_many/claim",
                              json={"expected_version": 0})).status_code == 401
    assert (await client.post("/api/v1/daily/nothing/claim", json={"expected_version": 0},
                              headers=auth)).status_code == 404
    target = quests[0]
    early = await client.post(f"/api/v1/daily/{target['id']}/claim",
                              json={"expected_version": 0}, headers=auth)
    assert early.status_code == 409 and "не выполнено" in early.json()["message"]

    # A huge honest-looking run finishes the first quest whatever it is.
    started = (await client.post("/api/v1/runs/start", json={
        "location_id": "shelter_outskirts", "hero_id": "wanderer"}, headers=auth)).json()
    async with factory() as session:
        row = await session.get(Run, UUID(started["run_id"]))
        assert row is not None
        row.started_at = row.started_at - timedelta(seconds=900)
        await session.commit()
    location = get_content().category("locations")["shelter_outskirts"]
    kills = {"ghoul": 2000, "roach": 1500, "raider": 500, location["boss"]["enemy"]: 1}
    for event in location["events"]:
        kills[event["enemy"]] = kills.get(event["enemy"], 0) + event["count"]
    body = {"content_hash": get_content().hash, "duration_seconds": 890,
            "kills_by_type": kills, "wave_reached": len(location["waves"]),
            "boss_killed": True, "picked_caps": 1000}
    finished = (await client.post(f"/api/v1/runs/{started['run_id']}/finish", json=body,
                                  headers=auth)).json()
    done = {quest["id"]: quest for quest in finished["profile"]["daily"]["quests"]}
    assert done[target["id"]]["progress"] == target["goal"]
    version = finished["profile"]["version"]
    claimed = await client.post(f"/api/v1/daily/{target['id']}/claim",
                                json={"expected_version": version}, headers=auth)
    assert claimed.status_code == 200
    assert claimed.json()["emeralds"] == finished["profile"]["emeralds"] + target["emeralds"]
    again = await client.post(f"/api/v1/daily/{target['id']}/claim",
                              json={"expected_version": version + 1}, headers=auth)
    assert again.status_code == 409 and "уже" in again.json()["message"]
