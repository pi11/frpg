"""Achievements: one-time emerald rewards stored in profile.data.

An earned achievement waits in `achievements_unclaimed` until the player takes its emeralds.

`metric` conditions are computed here from accepted run data. `reported` ones (standing still,
clicking the hero) cannot be seen by the server: the client names them and the server only checks
the limits written in content (minimum duration, boss kill, autopilot, game speed, location and
boosts taken).
`victory` ones read the boss wins per location, hero and speed kept in `data["wins"]`.
`account` ones are granted by the auth endpoints: signing in by mail, Telegram or account key
adds the event to `data["account_events"]` (see `record_account_event`).
"""

from collections.abc import Collection, Mapping
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class RunFacts:
    """Accepted numbers of the finished run; None outside of a run."""

    location: str
    duration: int
    kills: int
    picked_caps: int
    boss_killed: bool
    autopilot: bool
    reported: Collection[str] = field(default_factory=tuple)
    #: Game speed in percent.
    speed: int = 100
    #: One-run boosts the run took.
    boosts: int = 0


def metric_value(
    metric: str, data: Mapping[str, Any], run: RunFacts | None, condition: Mapping[str, Any],
) -> int:
    if metric == "runs":
        return int(data.get("runs_count", 0))
    if metric == "unlocks":
        return len(data.get("unlocks", []))
    if run is None or run.autopilot:
        return 0
    if metric == "boss":
        return int(run.boss_killed and run.location == condition["location"])
    return {"kills": run.kills, "duration": run.duration, "caps": run.picked_caps}[metric]


def has_victory(condition: Mapping[str, Any], data: Mapping[str, Any]) -> bool:
    """Boss wins at the speed or faster: for every listed location × hero, or for any of them.

    An empty list means any location (or hero); `every` needs both lists filled.
    """
    speed = int(condition["speed"])
    wins: Mapping[str, Mapping[str, int]] = data.get("wins", {})
    locations: list[str] = condition["locations"]
    heroes: list[str] = condition["heroes"]
    if condition["every"]:
        return all(
            int(wins.get(location, {}).get(hero, 0)) >= speed
            for location in locations for hero in heroes
        )
    return any(
        int(value) >= speed
        for location, by_hero in wins.items() if not locations or location in locations
        for hero, value in by_hero.items() if not heroes or hero in heroes
    )


def is_earned(
    achievement: Mapping[str, Any], data: Mapping[str, Any], run: RunFacts | None,
) -> bool:
    condition = achievement["condition"]
    if condition["type"] == "victory":
        return has_victory(condition, data)
    if condition["type"] == "account":
        return condition["event"] in data.get("account_events", [])
    min_speed = int(condition.get("minSpeed", 100))
    if min_speed > 100 and (run is None or run.speed < min_speed):
        return False
    if condition["type"] == "metric":
        return metric_value(condition["metric"], data, run, condition) >= int(condition["value"])
    return (
        run is not None and achievement["id"] in run.reported
        and run.autopilot == condition.get("autopilot", False)
        and run.duration >= condition.get("minSeconds", 0)
        and (run.boss_killed or not condition.get("boss", False))
        and condition.get("location", run.location) == run.location
        and run.boosts >= int(condition.get("minBoosts", 0))
    )


def new_achievements(
    achievements: Mapping[str, Mapping[str, Any]], data: Mapping[str, Any], run: RunFacts | None,
) -> list[str]:
    owned = data.get("achievements", [])
    return sorted(
        key for key, item in achievements.items()
        if key not in owned and is_earned(item, data, run)
    )


def grant_achievements(
    achievements: Mapping[str, Mapping[str, Any]], data: Mapping[str, Any], run: RunFacts | None,
) -> tuple[dict[str, Any], list[str]]:
    """Profile data with new achievements waiting to be claimed, and what was added."""
    earned = new_achievements(achievements, data, run)
    if not earned:
        return dict(data), []
    return {
        **data,
        "achievements": [*data.get("achievements", []), *earned],
        "achievements_unclaimed": [*data.get("achievements_unclaimed", []), *earned],
    }, earned


def record_account_event(
    achievements: Mapping[str, Mapping[str, Any]], data: Mapping[str, Any], event: str,
) -> tuple[dict[str, Any], list[str]]:
    """Profile data after a sign-in by mail, Telegram or account key, and new achievements."""
    events = list(data.get("account_events", []))
    if event not in events:
        events.append(event)
    return grant_achievements(achievements, {**data, "account_events": events}, None)
