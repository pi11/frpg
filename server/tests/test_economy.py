"""Shared formula vectors; client/src/economy.test.ts checks the same file."""

import json
from pathlib import Path
from typing import Any

from app.services.content import content_digest, get_content
from app.services.economy import (
    accepted_elites,
    emerald_reward,
    new_milestones,
    open_items,
    record_win,
    run_reward,
    speed_win_emeralds,
    unlocked_heroes,
    unlocked_speeds,
    upgrade_cost,
)

VECTORS: dict[str, list[dict[str, Any]]] = json.loads(
    (Path(__file__).resolve().parents[2] / "testdata" / "economy_vectors.json").read_text()
)


def test_upgrade_cost_vectors() -> None:
    for case in VECTORS["upgradeCost"]:
        assert upgrade_cost({"cost": case["cost"]}, case["level"]) == case["expected"], case


def test_run_reward_vectors() -> None:
    for case in VECTORS["runReward"]:
        assert run_reward(
            case["rules"], case["duration"], case["kills"], case["wave"],
            case["boss_killed"], case["picked_caps"], case["multiplier"],
        ) == case["expected"], case


def test_emerald_reward_vectors() -> None:
    for case in VECTORS["emeraldReward"]:
        assert emerald_reward(
            case["rates"], case["milestones"], case["elites"], case["boss_killed"],
            case["first_boss"], case["passed"],
        ) == case["expected"], case


def test_elites_are_limited_by_the_timeline() -> None:
    content = get_content()
    location = content.category("locations")["shelter_outskirts"]
    enemies = content.category("enemies")
    kills = {"brute": 100, "war_bot": 100, "ghoul": 500}
    event = location["events"][0]
    assert accepted_elites(location, enemies, kills, event["atSecond"] - 1) == 0
    assert accepted_elites(location, enemies, kills, event["atSecond"]) == event["count"]
    assert accepted_elites(location, enemies, kills, 900) == sum(
        item["count"] for item in location["events"])
    assert accepted_elites(location, enemies, {"brute": 1}, 900) == 1


def test_milestones_are_paid_once() -> None:
    marks = [{"atSecond": 300, "amount": 1}, {"atSecond": 480, "amount": 2}]
    assert new_milestones(marks, 299, []) == []
    assert new_milestones(marks, 500, []) == [300, 480]
    assert new_milestones(marks, 500, [300]) == [480]
    # Marks of an older, longer timeline count as reached.
    assert new_milestones(marks, 500, [720]) == []


def test_content_digest_vectors() -> None:
    for case in VECTORS["contentDigest"]:
        raw = {path: text.encode() for path, text in case["files"].items()}
        assert content_digest(raw) == case["expected"]


def test_bundle_hash_covers_every_content_file() -> None:
    content = get_content()
    assert "content/balance.json" in content.files
    assert len(content.hash) == 64


def test_heroes_open_by_their_conditions() -> None:
    heroes = get_content().category("heroes")
    assert unlocked_heroes(heroes, {}) == ["wanderer"]
    assert "spark" not in unlocked_heroes(heroes, {"runs_count": 4})
    assert "spark" in unlocked_heroes(heroes, {"runs_count": 5})
    assert "bruiser" in unlocked_heroes(heroes, {"bosses_killed": ["shelter_outskirts"]})
    assert "bruiser" not in unlocked_heroes(heroes, {"bosses_killed": ["dead_city"]})
    assert "marksman" in unlocked_heroes(heroes, {"milestones": {"dead_city": [230, 555]}})
    assert "marksman" not in unlocked_heroes(heroes, {"milestones": {"toxic_marsh": [555]}})
    assert "marksman" in unlocked_heroes(heroes, {"milestones": {"dead_city": [720]}})
    assert "marksman" not in unlocked_heroes(heroes, {"milestones": {"dead_city": [370]}})
    assert "chemist" in unlocked_heroes(heroes, {"achievements": list("abcdefgh")})
    assert "chemist" not in unlocked_heroes(heroes, {"achievements": list("abcdefg")})


def test_weapons_and_perks_open_by_progress_or_emeralds() -> None:
    content = get_content()
    items = {**content.category("weapons"), **content.category("passives")}
    start = open_items(items, {})
    assert {"scrap_pistol", "scattergun", "heavy_rounds"} <= set(start)
    assert not {"trap_mine", "tesla_coil", "rocket_tube", "lucky_cap", "rail_gun"} & set(start)
    after_run = open_items(items, {"runs_count": 1})
    assert set(after_run) - set(start) == {"trap_mine"}
    assert "tesla_coil" in open_items(items, {"milestones": {"shelter_outskirts": [230]}})
    assert "rocket_tube" in open_items(items, {"bosses_killed": ["shelter_outskirts"]})
    assert "rail_gun" in open_items(items, {"unlocks": ["rail_gun"]})
    # Buying a progress item does nothing: only emerald items read `unlocks`.
    assert "laser_rifle" not in open_items(items, {"unlocks": ["laser_rifle"]})


def test_speeds_open_after_wins_and_pay_once() -> None:
    speeds = get_content().balance["speeds"]
    assert unlocked_speeds(speeds, {}, "dead_city") == [100]
    assert unlocked_speeds(speeds, {"bosses_killed": ["dead_city"]}, "dead_city") == [100, 150]
    data = record_win({}, "dead_city", "spark", 150)
    assert unlocked_speeds(speeds, data, "dead_city") == [100, 150, 200]
    assert unlocked_speeds(speeds, data, "toxic_marsh") == [100]
    assert record_win(data, "dead_city", "spark", 100)["wins"] == {"dead_city": {"spark": 150}}
    bonus = {item["percent"]: item["firstWinEmeralds"] for item in speeds}
    assert speed_win_emeralds(speeds, {}, "dead_city", 100) == 0
    assert speed_win_emeralds(speeds, {"bosses_killed": ["dead_city"]}, "dead_city", 150) == (
        bonus[150])
    assert speed_win_emeralds(speeds, data, "dead_city", 150) == 0
    assert speed_win_emeralds(speeds, data, "dead_city", 200) == bonus[200]
