"""Daily quests: the same 3-4 tasks for every player, picked from content/daily by the date.

Progress comes only from accepted run numbers (runs with the autopilot do not count) and is kept
in profile.data["daily"] for the current day; emeralds are claimed by hand.
"""

import hashlib
import random
from collections.abc import Mapping
from datetime import UTC, date, datetime, timedelta
from typing import Any

from pydantic import BaseModel


class DailyQuest(BaseModel):
    id: str
    text: str
    metric: str
    goal: int
    emeralds: int
    progress: int
    claimed: bool


class DailyResponse(BaseModel):
    date: date
    resets_at: datetime
    quests: list[DailyQuest]


def game_day(now: datetime, rules: Mapping[str, Any]) -> date:
    """Quests change at midnight of the game's time zone, not of UTC."""
    return (now + timedelta(hours=rules["utcOffsetHours"])).date()


def resets_at(day: date, rules: Mapping[str, Any]) -> datetime:
    midnight = datetime.combine(day + timedelta(days=1), datetime.min.time(), tzinfo=UTC)
    return midnight - timedelta(hours=rules["utcOffsetHours"])


def pick_quests(
    day: date, templates: Mapping[str, Mapping[str, Any]], rules: Mapping[str, Any],
) -> list[dict[str, Any]]:
    """Same result for the same day on every server; weighted, without repeats."""
    rng = random.Random(int(hashlib.sha256(f"daily:{day.isoformat()}".encode()).hexdigest(), 16))
    count = rng.randint(rules["minQuests"], rules["maxQuests"])
    pool = sorted(templates.values(), key=lambda item: item["id"])
    picked: list[dict[str, Any]] = []
    while pool and len(picked) < count:
        roll = rng.random() * sum(item["weight"] for item in pool)
        index = len(pool) - 1
        for position, candidate in enumerate(pool):
            roll -= candidate["weight"]
            if roll < 0:
                index = position
                break
        item = pool.pop(index)
        level = rng.randrange(len(item["goals"]))
        goal = int(item["goals"][level])
        shown = f"{goal // 60} мин" if item["metric"] == "survive" else str(goal)
        picked.append({
            "id": item["id"], "text": item["text"].replace("{goal}", shown),
            "metric": item["metric"], "goal": goal,
            "emeralds": int(item["emeralds"][level]), "enemy": item.get("enemy"),
        })
    return picked


def today_state(data: Mapping[str, Any], day: date) -> dict[str, Any]:
    state = data.get("daily") or {}
    if state.get("date") != day.isoformat():
        return {"date": day.isoformat(), "progress": {}, "claimed": []}
    return {"date": state["date"], "progress": dict(state.get("progress", {})),
            "claimed": list(state.get("claimed", []))}


def run_progress(quest: Mapping[str, Any], run: Mapping[str, Any], min_seconds: int) -> int:
    """What one finished run adds; `survive` keeps the best run instead of a sum."""
    match quest["metric"]:
        case "kills":
            return int(run["kills"])
        case "enemyKills":
            return min(int(run["kills_by_type"].get(quest["enemy"], 0)), int(run["kills"]))
        case "survive":
            return int(run["duration"])
        case "runs":
            return int(run["duration"] >= min_seconds)
        case "elites":
            return int(run["elites"])
        case "caps":
            return int(run["picked_caps"])
        case "boss":
            return int(run["boss_killed"])
    return 0


def add_run(
    data: Mapping[str, Any], quests: list[dict[str, Any]], day: date, run: Mapping[str, Any],
    rules: Mapping[str, Any],
) -> dict[str, Any]:
    state = today_state(data, day)
    for quest in quests:
        gained = run_progress(quest, run, rules["minRunSeconds"])
        old = int(state["progress"].get(quest["id"], 0))
        new = max(old, gained) if quest["metric"] == "survive" else old + gained
        state["progress"][quest["id"]] = min(new, quest["goal"])
    return {**data, "daily": state}


def daily_view(
    data: Mapping[str, Any], quests: list[dict[str, Any]], day: date, rules: Mapping[str, Any],
) -> DailyResponse:
    state = today_state(data, day)
    return DailyResponse(date=day, resets_at=resets_at(day, rules), quests=[
        DailyQuest(
            id=quest["id"], text=quest["text"], metric=quest["metric"], goal=quest["goal"],
            emeralds=quest["emeralds"], progress=int(state["progress"].get(quest["id"], 0)),
            claimed=quest["id"] in state["claimed"],
        ) for quest in quests
    ])
