"""Short contracts: start checks, settlement by the stored mode, the bonus paid once."""

from datetime import timedelta
from uuid import UUID

import httpx
import pytest
from app.models.auth import Profile
from app.models.run import Run
from app.services.content import get_content
from app.services.economy import run_reward
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

CONTRACT = "outskirts_cleanup"


def wall(game_seconds: float) -> timedelta:
    pace = float(get_content().balance["run"]["timeScale"])
    return timedelta(seconds=game_seconds / pace)


async def guest(client: httpx.AsyncClient) -> dict[str, str]:
    pair = (await client.post("/api/v1/auth/guest")).json()
    return {"Authorization": f"Bearer {pair['access_token']}"}


async def start(client: httpx.AsyncClient, auth: dict[str, str], **extra: object) -> httpx.Response:
    return await client.post("/api/v1/runs/start", json={
        "location_id": "shelter_outskirts", "hero_id": "wanderer", **extra,
    }, headers=auth)


async def age(factory: async_sessionmaker[AsyncSession], run_id: str, seconds: float) -> None:
    async with factory() as session:
        run = await session.get(Run, UUID(run_id))
        assert run is not None
        run.started_at = run.started_at - wall(seconds)
        await session.commit()


@pytest.mark.anyio
async def test_contract_start_errors(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    auth = await guest(client)
    missing = await start(client, auth, mode="contract", contract_id="nope")
    assert missing.status_code == 404
    assert (await start(client, auth, mode="contract")).status_code == 404
    stray = await start(client, auth, contract_id=CONTRACT)
    assert stray.status_code == 409
    other = await client.post("/api/v1/runs/start", json={
        "location_id": "dead_city", "hero_id": "wanderer", "mode": "contract",
        "contract_id": CONTRACT,
    }, headers=auth)
    assert other.status_code == 403  # the location itself is still closed
    started = await start(client, auth, mode="contract", contract_id=CONTRACT)
    assert started.status_code == 200
    assert started.json()["mode"] == "contract" and started.json()["contract_id"] == CONTRACT
    plain = (await start(client, auth)).json()
    assert plain["mode"] == "standard" and plain["contract_id"] is None


@pytest.mark.anyio
async def test_done_contract_pays_the_bonus_once_and_no_boss_or_emeralds(
    api: dict[str, object],
) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    auth = await guest(client)
    content = get_content()
    contract = content.category("contracts")[CONTRACT]
    started = (await start(client, auth, mode="contract", contract_id=CONTRACT)).json()
    await age(factory, started["run_id"], 300)
    boss = content.category("locations")["shelter_outskirts"]["boss"]["enemy"]
    summary = {
        "content_hash": content.hash, "duration_seconds": 600,
        "kills_by_type": {"ghoul": 300, contract["objective"]["enemy"]: 1, boss: 1},
        "wave_reached": 9, "boss_killed": True, "picked_caps": 0,
    }
    url = f"/api/v1/runs/{started['run_id']}/finish"
    first = (await client.post(url, json=summary, headers=auth)).json()
    duration = contract["durationSeconds"]
    multiplier = float(content.category("locations")["shelter_outskirts"]["rewardMultiplier"])
    expected = run_reward(
        content.balance["reward"], duration, 302, len(contract["waves"]), False, 0,
        multiplier * float(contract["rewardMultiplier"]),
    ) + contract["completionCaps"]
    assert first["contract"] == {
        "id": CONTRACT, "done": True, "bonus_caps": contract["completionCaps"],
    }
    assert first["reward_caps"] == expected
    assert first["reward_emeralds"] == 0
    assert {"duration_clamped", "wave_clamped", "boss_clamped"} <= set(first["flags"])
    profile = first["profile"]
    assert profile["bosses_killed"] == [] and profile["wins"] == {} and profile["milestones"] == {}
    assert profile["unlocked_locations"] == ["shelter_outskirts"]
    assert first["record"] is None
    again = (await client.post(url, json=summary, headers=auth)).json()
    assert again["contract"] == first["contract"]
    assert again["profile"]["caps"] == profile["caps"] == expected


@pytest.mark.anyio
async def test_contract_objective_needs_the_kill_after_it_appears(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    auth = await guest(client)
    content = get_content()
    contract = content.category("contracts")[CONTRACT]
    enemy = contract["objective"]["enemy"]
    for seconds, kills in ((230, {"ghoul": 100}), (100, {"ghoul": 100, enemy: 1})):
        started = (await start(client, auth, mode="contract", contract_id=CONTRACT)).json()
        await age(factory, started["run_id"], seconds + 5)
        result = (await client.post(f"/api/v1/runs/{started['run_id']}/finish", json={
            "content_hash": content.hash, "duration_seconds": seconds, "kills_by_type": kills,
            "wave_reached": 1, "boss_killed": False, "picked_caps": 0,
        }, headers=auth)).json()
        assert result["contract"] == {"id": CONTRACT, "done": False, "bonus_caps": 0}
        assert result["reward_emeralds"] == 0


@pytest.mark.anyio
async def test_standard_runs_still_finish_as_before(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    auth = await guest(client)
    started = (await start(client, auth)).json()
    await age(factory, started["run_id"], 140)
    result = (await client.post(f"/api/v1/runs/{started['run_id']}/finish", json={
        "content_hash": get_content().hash, "duration_seconds": 130,
        "kills_by_type": {"ghoul": 120}, "wave_reached": 2, "boss_killed": False,
        "picked_caps": 0,
    }, headers=auth)).json()
    assert result["contract"] is None and result["flags"] == []
    async with factory() as session:
        run = await session.get(Run, UUID(started["run_id"]))
        assert run is not None and run.mode == "standard" and run.contract_id is None
        profile = await session.get(Profile, run.user_id)
        assert profile is not None and profile.caps == result["reward_caps"]


def test_contract_pays_no_more_per_minute_than_the_same_minutes_of_a_full_run() -> None:
    content = get_content()
    rules = content.balance["reward"]
    location = content.category("locations")["shelter_outskirts"]
    multiplier = float(location["rewardMultiplier"])
    for contract in content.category("contracts").values():
        seconds = contract["durationSeconds"]
        full_waves = sum(1 for wave in location["waves"] if wave["atSecond"] <= seconds)
        for kills_per_second in (0.5, 1, 2, 3, 5):
            kills = int(seconds * kills_per_second)
            short = run_reward(
                rules, seconds, kills, len(contract["waves"]), False, 0,
                multiplier * float(contract["rewardMultiplier"]),
            ) + contract["completionCaps"]
            full = run_reward(rules, seconds, kills, full_waves, False, 0, multiplier)
            assert short <= full, (contract["id"], kills_per_second, short, full)
