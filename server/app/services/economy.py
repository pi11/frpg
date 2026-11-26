"""Pure formulas shared with the client (client/src/economy.ts).

Both sides must produce identical integers for identical inputs, so the
operations and their order are mirrored exactly. Exponentiation is done by
repeated multiplication because ``**`` in CPython and ``Math.pow`` in V8 may
round the last bit differently; plain IEEE-754 multiplication and addition are
identical everywhere. The shared vectors live in testdata/economy_vectors.json.
"""

import math
from collections.abc import Collection, Mapping, Sequence
from typing import Any


def round_half_up(value: float) -> int:
    return math.floor(value + 0.5)


def upgrade_cost(upgrade: Mapping[str, Any], current_level: int) -> int:
    base = float(upgrade["cost"]["base"])
    growth = float(upgrade["cost"]["growth"])
    price = base
    for _ in range(current_level):
        price *= growth
    return round_half_up(price)


def run_reward(
    reward: Mapping[str, Any], duration: int, kills: int, wave: int,
    boss_killed: bool, picked_caps: int, multiplier: float = 1.0,
) -> int:
    """Earned caps scale with the location's reward multiplier; picked caps do not."""
    total = float(reward["base"])
    total += duration * float(reward["perSecond"])
    total += kills * float(reward["perKill"])
    total += wave * float(reward["perWave"])
    if boss_killed:
        total += float(reward["bossBonus"])
    total *= multiplier
    total += picked_caps
    return round_half_up(total)


def accepted_elites(
    location: Mapping[str, Any], enemies: Mapping[str, Mapping[str, Any]],
    kills_by_type: Mapping[str, int], duration: int,
) -> int:
    """Mini-boss kills, limited per type by how many could have appeared by `duration`."""
    spawned: dict[str, int] = {}
    for event in location["events"]:
        if event["atSecond"] <= duration:
            spawned[event["enemy"]] = spawned.get(event["enemy"], 0) + event["count"]
    return sum(
        min(kills_by_type.get(enemy, 0), count) for enemy, count in spawned.items()
        if enemies[enemy]["role"] == "elite"
    )


def new_milestones(
    milestones: Sequence[Mapping[str, int]], duration: int, reached: Collection[int],
) -> list[int]:
    """Survival marks passed for the first time in this location.

    A stored mark at or after this one also counts: profiles keep the marks of
    older, longer timelines.
    """
    best = max(reached, default=0)
    return [
        mark["atSecond"] for mark in milestones
        if mark["atSecond"] <= duration and mark["atSecond"] > best
    ]


def emerald_reward(
    rates: Mapping[str, int], milestones: Sequence[Mapping[str, int]],
    elites: int, boss_killed: bool, first_boss: bool, passed: Collection[int],
) -> int:
    total = elites * rates["elite"]
    if boss_killed:
        total += rates["boss"]
        if first_boss:
            total += rates["firstBoss"]
    return total + sum(mark["amount"] for mark in milestones if mark["atSecond"] in passed)


def unlocked_locations(
    locations: Mapping[str, Mapping[str, Any]], bosses_killed: Collection[str],
) -> list[str]:
    """Locations open from the start or whose required boss was killed at least once."""
    return sorted(
        location_id for location_id, location in locations.items()
        if location["unlock"]["type"] == "default"
        or location["unlock"].get("location") in bosses_killed
    )


def unlocked_heroes(heroes: Mapping[str, Mapping[str, Any]], data: Mapping[str, Any]) -> list[str]:
    """Heroes whose condition is met by the profile; mirrored by heroProgress on the client."""
    return sorted(
        hero_id for hero_id, hero in heroes.items() if hero_progress(hero["unlock"], data)
    )


def hero_progress(unlock: Mapping[str, Any], data: Mapping[str, Any]) -> bool:
    match unlock["type"]:
        case "default":
            return True
        case "runs":
            return int(data.get("runs_count", 0)) >= int(unlock["count"])
        case "achievements":
            return len(data.get("achievements", [])) >= int(unlock["count"])
        case "bossKilled":
            return unlock["location"] in data.get("bosses_killed", [])
        case "milestone":
            reached = data.get("milestones", {}).get(unlock["location"], [])
            return any(int(mark) >= int(unlock["atSecond"]) for mark in reached)
    return False
