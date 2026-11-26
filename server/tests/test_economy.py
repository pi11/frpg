"""Shared formula vectors; client/src/economy.test.ts checks the same file."""

import json
from pathlib import Path
from typing import Any

from app.services.content import content_digest, get_content
from app.services.economy import (
    accepted_elites,
    emerald_reward,
    new_milestones,
    run_reward,
    unlocked_heroes,
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
