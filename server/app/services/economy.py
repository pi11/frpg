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


def open_items(
    items: Mapping[str, Mapping[str, Any]], data: Mapping[str, Any],
) -> list[str]:
    """Weapons and perks offered in runs: open from the start, by progress, or bought."""
    bought = set(data.get("unlocks", []))
    result = []
    for item_id, item in items.items():
        unlock = item.get("unlock", {"type": "default"})
        if unlock["type"] == "emeralds":
            if item_id in bought:
                result.append(item_id)
        elif hero_progress(unlock, data):
            result.append(item_id)
    return sorted(result)


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


def speed_percents(speeds: Sequence[Mapping[str, int]]) -> list[int]:
    return sorted(int(item["percent"]) for item in speeds)


def best_win(data: Mapping[str, Any], location: str) -> int:
    """Highest game speed (percent) a boss of this location was beaten at, 0 if never.

    Profiles from before speeds only list the location in `bosses_killed`: that is a win at 100.
    """
    wins = data.get("wins", {}).get(location, {})
    best = max((int(value) for value in wins.values()), default=0)
    if location in data.get("bosses_killed", []):
        best = max(best, 100)
    return best


def unlocked_speeds(
    speeds: Sequence[Mapping[str, int]], data: Mapping[str, Any], location: str,
) -> list[int]:
    """The base speed, and each next one after a boss win at the previous speed."""
    percents = speed_percents(speeds)
    best = best_win(data, location)
    return [
        percent for index, percent in enumerate(percents)
        if index == 0 or best >= percents[index - 1]
    ]


def speed_win_emeralds(
    speeds: Sequence[Mapping[str, int]], data: Mapping[str, Any], location: str, speed: int,
) -> int:
    """Bonus for the first boss win at a speed (and every slower one skipped) here."""
    best = best_win(data, location)
    return sum(
        int(item["firstWinEmeralds"]) for item in speeds
        if best < int(item["percent"]) <= speed
    )


def record_win(data: Mapping[str, Any], location: str, hero: str, speed: int) -> dict[str, Any]:
    wins = {key: dict(value) for key, value in data.get("wins", {}).items()}
    heroes = wins.setdefault(location, {})
    heroes[hero] = max(int(heroes.get(hero, 0)), speed)
    return {**data, "wins": wins}


def update_record(
    data: Mapping[str, Any], location: str, seconds: int, kills: int,
) -> tuple[dict[str, Any], dict[str, int | None]]:
    """Best accepted time and kills per location; returns the new data and the result-screen view.

    The view holds this run's numbers and the previous bests (None on the first run there).
    """
    records = {key: dict(value) for key, value in data.get("records", {}).items()}
    before = records.get(location)
    records[location] = {
        "seconds": max(seconds, int(before["seconds"])) if before else seconds,
        "kills": max(kills, int(before["kills"])) if before else kills,
    }
    view: dict[str, int | None] = {
        "seconds": seconds, "kills": kills,
        "previous_seconds": int(before["seconds"]) if before else None,
        "previous_kills": int(before["kills"]) if before else None,
    }
    return {**data, "records": records}, view
