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


def wall(game_seconds: float, speed: int = 100) -> timedelta:
    """Wall-clock time in which a run at this speed plays `game_seconds`."""
    pace = float(get_content().balance["run"]["timeScale"])
    return timedelta(seconds=game_seconds * 100 / speed / pace)


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
        run.started_at = run.started_at - wall(150)
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


@pytest.mark.anyio
async def test_boss_kill_counts_only_after_the_boss_appears(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    auth = headers((await client.post("/api/v1/auth/guest")).json())
    location = get_content().category("locations")["shelter_outskirts"]
    boss = location["boss"]
    body = {"location_id": "shelter_outskirts", "hero_id": "wanderer"}
    summary = {
        "content_hash": get_content().hash, "kills_by_type": {boss["enemy"]: 1, "ghoul": 50},
        "wave_reached": 1, "boss_killed": True, "picked_caps": 0,
    }
    early = (await client.post("/api/v1/runs/start", json=body, headers=auth)).json()
    rejected = await client.post(f"/api/v1/runs/{early['run_id']}/finish",
                                 json={**summary, "duration_seconds": 60}, headers=auth)
    assert "boss_clamped" in rejected.json()["flags"]

    late = (await client.post("/api/v1/runs/start", json=body, headers=auth)).json()
    async with factory() as session:
        run = await session.get(Run, UUID(late["run_id"]))
        assert run is not None
        run.started_at = run.started_at - wall(boss["atSecond"] + 20)
        await session.commit()
    waves = sum(1 for wave in location["waves"] if wave["atSecond"] <= boss["atSecond"] + 10)
    accepted = await client.post(f"/api/v1/runs/{late['run_id']}/finish", json={
        **summary, "duration_seconds": boss["atSecond"] + 10, "wave_reached": waves,
    }, headers=auth)
    data = accepted.json()
    assert data["flags"] == []
    rules = get_content().balance["reward"]
    assert data["reward_caps"] == run_reward(rules, boss["atSecond"] + 10, 51, waves, True, 0)


@pytest.mark.anyio
async def test_locations_unlock_after_their_boss_and_scale_the_reward(
    api: dict[str, object],
) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    guest = (await client.post("/api/v1/auth/guest")).json()
    auth = headers(guest)
    profile = (await client.get("/api/v1/profile", headers=auth)).json()
    assert profile["unlocked_locations"] == ["shelter_outskirts"]
    assert profile["bosses_killed"] == []
    locked = await client.post("/api/v1/runs/start", json={
        "location_id": "dead_city", "hero_id": "wanderer"}, headers=auth)
    assert locked.status_code == 403
    assert locked.json()["code"] == "locked"

    # Beat the first boss: the city opens, the marsh stays closed.
    outskirts = get_content().category("locations")["shelter_outskirts"]
    boss = outskirts["boss"]
    started = (await client.post("/api/v1/runs/start", json={
        "location_id": "shelter_outskirts", "hero_id": "wanderer"}, headers=auth)).json()
    async with factory() as session:
        run = await session.get(Run, UUID(started["run_id"]))
        assert run is not None
        run.started_at = run.started_at - wall(boss["atSecond"] + 20)
        await session.commit()
    duration = boss["atSecond"] + 10
    waves = sum(1 for wave in outskirts["waves"] if wave["atSecond"] <= duration)
    finished = (await client.post(f"/api/v1/runs/{started['run_id']}/finish", json={
        "content_hash": get_content().hash, "duration_seconds": duration,
        "kills_by_type": {boss["enemy"]: 1}, "wave_reached": waves,
        "boss_killed": True, "picked_caps": 0,
    }, headers=auth)).json()
    assert finished["flags"] == []
    assert finished["profile"]["bosses_killed"] == ["shelter_outskirts"]
    assert finished["profile"]["unlocked_locations"] == ["dead_city", "shelter_outskirts"]
    marsh = await client.post("/api/v1/runs/start", json={
        "location_id": "toxic_marsh", "hero_id": "wanderer"}, headers=auth)
    assert marsh.status_code == 403

    city = get_content().category("locations")["dead_city"]
    started = (await client.post("/api/v1/runs/start", json={
        "location_id": "dead_city", "hero_id": "wanderer"}, headers=auth)).json()
    async with factory() as session:
        run = await session.get(Run, UUID(started["run_id"]))
        assert run is not None
        run.started_at = run.started_at - wall(150)
        await session.commit()
    result = (await client.post(f"/api/v1/runs/{started['run_id']}/finish", json={
        "content_hash": get_content().hash, "duration_seconds": 130,
        "kills_by_type": {"wild_dog": 100}, "wave_reached": 2,
        "boss_killed": False, "picked_caps": 12,
    }, headers=auth)).json()
    rules = get_content().balance["reward"]
    assert result["flags"] == []
    assert city["rewardMultiplier"] > 1
    assert result["reward_caps"] == run_reward(
        rules, 130, 100, 2, False, 12, float(city["rewardMultiplier"]),
    )
    assert result["reward_caps"] > run_reward(rules, 130, 100, 2, False, 12)


@pytest.mark.anyio
async def test_emeralds_are_earned_once_and_open_items(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    guest = (await client.post("/api/v1/auth/guest")).json()
    auth = headers(guest)
    content = get_content()
    location = content.category("locations")["shelter_outskirts"]
    marks = content.balance["reward"]["emeraldMilestones"]
    event = location["events"][0]
    duration = max(event["atSecond"], marks[0]["atSecond"]) + 5
    waves = sum(1 for wave in location["waves"] if wave["atSecond"] <= duration)

    async def play() -> dict[str, object]:
        started = (await client.post("/api/v1/runs/start", json={
            "location_id": "shelter_outskirts", "hero_id": "wanderer"}, headers=auth)).json()
        async with factory() as session:
            run = await session.get(Run, UUID(started["run_id"]))
            assert run is not None
            run.started_at = run.started_at - wall(duration + 10)
            await session.commit()
        url = f"/api/v1/runs/{started['run_id']}/finish"
        body = {
            "content_hash": content.hash, "duration_seconds": duration,
            # More kills than mini-bosses that could have appeared are not paid.
            "kills_by_type": {event["enemy"]: 50}, "wave_reached": waves,
            "boss_killed": False, "picked_caps": 0,
        }
        first = (await client.post(url, json=body, headers=auth)).json()
        replay = (await client.post(url, json=body, headers=auth)).json()
        assert replay["reward_emeralds"] == first["reward_emeralds"]
        assert replay["profile"]["emeralds"] == first["profile"]["emeralds"]
        return dict(first)

    elite = event["count"] * location["emeralds"]["elite"]
    first = await play()
    assert first["reward_emeralds"] == elite + marks[0]["amount"]
    assert first["profile"]["milestones"] == {  # type: ignore[index]
        "shelter_outskirts": [marks[0]["atSecond"]]}
    second = await play()
    assert second["reward_emeralds"] == elite
    profile = (await client.get("/api/v1/profile", headers=auth)).json()
    assert profile["emeralds"] == 2 * elite + marks[0]["amount"]

    async def buy(item: str, version: int) -> httpx.Response:
        return await client.post(
            f"/api/v1/unlocks/{item}/buy", json={"expected_version": version}, headers=auth)

    version = profile["version"]
    cost = content.category("weapons")["rotary_gun"]["unlock"]["emeralds"]
    assert (await client.post(
        "/api/v1/unlocks/rotary_gun/buy", json={"expected_version": version})).status_code == 401
    assert (await buy("missing", version)).status_code == 404
    assert (await buy("scrap_pistol", version)).status_code == 404
    assert (await buy("rotary_gun", -1)).status_code == 422
    assert profile["emeralds"] < cost
    short = await buy("rotary_gun", version)
    assert short.status_code == 409 and "изумруд" in short.json()["message"]
    async with factory() as session:
        row = await session.get(Profile, UUID(guest["user_id"]))
        assert row is not None
        row.data = {**row.data, "emeralds": cost + 4}
        await session.commit()
    assert (await buy("rotary_gun", version - 1)).status_code == 409
    bought = await buy("rotary_gun", version)
    assert bought.status_code == 200
    assert bought.json()["emeralds"] == 4 and bought.json()["unlocks"] == ["rotary_gun"]
    assert bought.json()["runs_count"] == 2
    again = await buy("rotary_gun", version + 1)
    assert again.status_code == 409
    perk = await buy("trophy_hunter", version + 1)
    assert perk.status_code == 200
    assert perk.json()["unlocks"] == ["rotary_gun", "trophy_hunter"]
    assert perk.json()["emeralds"] == 4 - content.category("passives")["trophy_hunter"][
        "unlock"]["emeralds"]


@pytest.mark.anyio
async def test_slots_cost_emeralds_not_caps(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    guest = (await client.post("/api/v1/auth/guest")).json()
    rack = get_content().category("upgrades")["weapon_rack"]
    assert rack["currency"] == "emeralds"
    cost = upgrade_cost(rack, 0)

    async def give(emeralds: int) -> None:
        async with factory() as session:
            row = await session.get(Profile, UUID(guest["user_id"]))
            assert row is not None
            row.caps = 1000
            row.data = {**row.data, "emeralds": emeralds}
            await session.commit()

    async def buy(version: int) -> httpx.Response:
        return await client.post("/api/v1/upgrades/weapon_rack/buy",
                                 json={"expected_version": version}, headers=headers(guest))

    await give(cost - 1)
    short = await buy(0)
    assert short.status_code == 409 and "изумруд" in short.json()["message"]
    await give(cost + 2)
    bought = (await buy(0)).json()
    assert bought["emeralds"] == 2 and bought["caps"] == 1000
    assert bought["upgrades"] == {"weapon_rack": 1}


@pytest.mark.anyio
async def test_locked_hero_cannot_start_a_run(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    guest = (await client.post("/api/v1/auth/guest")).json()
    body = {"location_id": "shelter_outskirts", "hero_id": "spark"}
    locked = await client.post("/api/v1/runs/start", json=body, headers=headers(guest))
    assert locked.status_code == 403 and locked.json()["code"] == "locked"
    async with factory() as session:
        row = await session.get(Profile, UUID(guest["user_id"]))
        assert row is not None
        row.data = {"runs_count": 5}
        await session.commit()
    profile = (await client.get("/api/v1/profile", headers=headers(guest))).json()
    assert profile["unlocked_heroes"] == ["spark", "wanderer"]
    assert {"trap_mine", "firebomb", "orbit_drone", "flamethrower"} <= set(profile["open_items"])
    started = await client.post("/api/v1/runs/start", json=body, headers=headers(guest))
    assert started.status_code == 200


@pytest.mark.anyio
async def test_speeds_open_one_by_one_and_scale_the_time_check(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    guest = (await client.post("/api/v1/auth/guest")).json()
    auth = headers(guest)
    location = get_content().category("locations")["shelter_outskirts"]
    boss = location["boss"]
    profile = (await client.get("/api/v1/profile", headers=auth)).json()
    assert profile["speeds"]["shelter_outskirts"] == [100] and profile["wins"] == {}
    fast = {"location_id": "shelter_outskirts", "hero_id": "wanderer", "speed": 150}
    locked = await client.post("/api/v1/runs/start", json=fast, headers=auth)
    assert locked.status_code == 403 and locked.json()["code"] == "locked"
    odd = await client.post("/api/v1/runs/start", json={**fast, "speed": 120}, headers=auth)
    assert odd.status_code == 403

    async def win(speed: int) -> dict[str, object]:
        started = (await client.post(
            "/api/v1/runs/start", json={**fast, "speed": speed}, headers=auth,
        )).json()
        duration = boss["atSecond"] + 10
        async with factory() as session:
            run = await session.get(Run, UUID(started["run_id"]))
            assert run is not None and run.speed == speed
            # Wall-clock time that fits `duration` game seconds only at this speed.
            run.started_at = run.started_at - wall(duration, speed)
            await session.commit()
        finished = await client.post(f"/api/v1/runs/{started['run_id']}/finish", json={
            "content_hash": get_content().hash, "kills_by_type": {boss["enemy"]: 1},
            "wave_reached": 1, "boss_killed": True, "picked_caps": 0,
            "duration_seconds": duration,
        }, headers=auth)
        assert finished.status_code == 200
        result: dict[str, object] = finished.json()
        return result

    first = await win(100)
    assert first["flags"] == []
    assert first["profile"]["speeds"]["shelter_outskirts"] == [100, 150]  # type: ignore[index]
    speeds = {item["percent"]: item["firstWinEmeralds"] for item in get_content().balance["speeds"]}
    emeralds = location["emeralds"]
    second = await win(150)
    assert second["flags"] == []
    assert second["reward_emeralds"] == emeralds["boss"] + speeds[150]
    assert "shelter_outskirts_x150" in second["achievements"]  # type: ignore[operator]
    assert "hero_wanderer_x150" in second["achievements"]  # type: ignore[operator]
    profile = second["profile"]
    assert profile["speeds"]["shelter_outskirts"] == [100, 150, 200]  # type: ignore[index]
    assert profile["wins"] == {"shelter_outskirts": {"wanderer": 150}}  # type: ignore[index]
    again = await win(150)
    assert again["reward_emeralds"] == emeralds["boss"]
    # A run at ×2 that claims more game time than the wall clock allows is clamped.
    started = (await client.post(
        "/api/v1/runs/start", json={**fast, "speed": 200}, headers=auth,
    )).json()
    async with factory() as session:
        run = await session.get(Run, UUID(started["run_id"]))
        assert run is not None
        run.started_at = run.started_at - timedelta(seconds=100)
        await session.commit()
    clamped = (await client.post(f"/api/v1/runs/{started['run_id']}/finish", json={
        "content_hash": get_content().hash, "kills_by_type": {}, "wave_reached": 1,
        "boss_killed": False, "picked_caps": 0, "duration_seconds": 400,
    }, headers=auth)).json()
    assert "duration_clamped" in clamped["flags"]


async def give_emeralds(
    factory: async_sessionmaker[AsyncSession], user_id: str, amount: int,
) -> None:
    async with factory() as session:
        profile = await session.get(Profile, UUID(user_id))
        assert profile is not None
        profile.data = {**(profile.data or {}), "emeralds": amount}
        await session.commit()


@pytest.mark.anyio
async def test_boosts_cost_emeralds_and_are_used_by_the_next_run(api: dict[str, object]) -> None:
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    guest = (await client.post("/api/v1/auth/guest")).json()
    auth = headers(guest)
    boosts = get_content().category("boosts")
    bag = boosts["caps_bag"]
    assert (await client.post(
        "/api/v1/boosts/missing/buy", json={"expected_version": 0}, headers=auth,
    )).status_code == 404
    poor = await client.post(
        "/api/v1/boosts/caps_bag/buy", json={"expected_version": 0}, headers=auth,
    )
    assert poor.status_code == 409 and poor.json()["code"] == "conflict"
    await give_emeralds(factory, guest["user_id"], bag["emeralds"] + 3)
    stale = await client.post(
        "/api/v1/boosts/caps_bag/buy", json={"expected_version": 5}, headers=auth,
    )
    assert stale.status_code == 409
    bought = await client.post(
        "/api/v1/boosts/caps_bag/buy", json={"expected_version": 0}, headers=auth,
    )
    assert bought.status_code == 200
    assert bought.json()["boosts"] == ["caps_bag"]
    assert bought.json()["emeralds"] == 3 and bought.json()["version"] == 1
    again = await client.post(
        "/api/v1/boosts/caps_bag/buy", json={"expected_version": 1}, headers=auth,
    )
    assert again.status_code == 409

    started = (await client.post("/api/v1/runs/start", json={
        "location_id": "shelter_outskirts", "hero_id": "wanderer"}, headers=auth)).json()
    assert started["boosts"] == ["caps_bag"]
    profile = (await client.get("/api/v1/profile", headers=auth)).json()
    assert profile["boosts"] == [] and profile["emeralds"] == 3
    async with factory() as session:
        run = await session.get(Run, UUID(started["run_id"]))
        assert run is not None and run.boosts == ["caps_bag"]
        run.started_at = run.started_at - wall(150)
        await session.commit()
    result = (await client.post(f"/api/v1/runs/{started['run_id']}/finish", json={
        "content_hash": get_content().hash, "duration_seconds": 130,
        "kills_by_type": {"ghoul": 100}, "wave_reached": 2,
        "boss_killed": False, "picked_caps": 7,
    }, headers=auth)).json()
    rules = get_content().balance["reward"]
    outskirts = get_content().category("locations")["shelter_outskirts"]
    multiplier = float(outskirts["rewardMultiplier"]) * (1 + float(bag["rewardBonus"]))
    assert result["flags"] == []
    assert result["reward_caps"] == run_reward(rules, 130, 100, 2, False, 7, multiplier)
    assert result["reward_caps"] > run_reward(rules, 130, 100, 2, False, 7)

    # The next run starts without them.
    plain = (await client.post("/api/v1/runs/start", json={
        "location_id": "shelter_outskirts", "hero_id": "wanderer"}, headers=auth)).json()
    assert plain["boosts"] == []


@pytest.mark.anyio
async def test_boost_achievement_needs_a_bought_boost(api: dict[str, object]) -> None:
    """«Лошок» is reported by the client, but the server checks that the run took a boost."""
    client: httpx.AsyncClient = api["client"]  # type: ignore[assignment]
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    guest = (await client.post("/api/v1/auth/guest")).json()
    auth = headers(guest)
    summary = {
        "content_hash": get_content().hash, "duration_seconds": 20,
        "kills_by_type": {"ghoul": 3}, "wave_reached": 1,
        "boss_killed": False, "picked_caps": 0, "achievements": ["loshok"],
    }
    plain = (await client.post("/api/v1/runs/start", json={
        "location_id": "shelter_outskirts", "hero_id": "wanderer"}, headers=auth)).json()
    async with factory() as session:
        run = await session.get(Run, UUID(plain["run_id"]))
        assert run is not None
        run.started_at = run.started_at - wall(30)
        await session.commit()
    first = (await client.post(
        f"/api/v1/runs/{plain['run_id']}/finish", json=summary, headers=auth)).json()
    assert "loshok" not in first["achievements"]

    await give_emeralds(factory, guest["user_id"], 10)
    version = (await client.get("/api/v1/profile", headers=auth)).json()["version"]
    assert (await client.post("/api/v1/boosts/jet_boots/buy", json={
        "expected_version": version}, headers=auth)).status_code == 200
    boosted = (await client.post("/api/v1/runs/start", json={
        "location_id": "shelter_outskirts", "hero_id": "wanderer"}, headers=auth)).json()
    async with factory() as session:
        run = await session.get(Run, UUID(boosted["run_id"]))
        assert run is not None
        run.started_at = run.started_at - wall(30)
        await session.commit()
    second = (await client.post(
        f"/api/v1/runs/{boosted['run_id']}/finish", json=summary, headers=auth)).json()
    assert "loshok" in second["achievements"]
