"""Achievements: one-time emerald rewards stored in profile.data.

An earned achievement waits in `achievements_unclaimed` until the player takes its emeralds.

`metric` conditions are computed here from accepted run data. `reported` ones (standing still,
clicking the hero) cannot be seen by the server: the client names them and the server only checks
the limits written in content (minimum duration, boss kill, autopilot).
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


def is_earned(
    achievement: Mapping[str, Any], data: Mapping[str, Any], run: RunFacts | None,
) -> bool:
    condition = achievement["condition"]
    if condition["type"] == "metric":
        return metric_value(condition["metric"], data, run, condition) >= int(condition["value"])
    return (
        run is not None and achievement["id"] in run.reported
        and run.autopilot == condition.get("autopilot", False)
        and run.duration >= condition.get("minSeconds", 0)
        and (run.boss_killed or not condition.get("boss", False))
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
