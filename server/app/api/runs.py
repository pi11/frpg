"""Start and settle runs with server-side reward and plausibility checks."""

import math
import secrets
import uuid
from datetime import timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import ApiError, ErrorCode, ErrorResponse
from app.api.profile import ProfileResponse, profile_response
from app.db import get_session
from app.models.auth import Profile, User
from app.models.run import Run
from app.services.achievements import RunFacts, grant_achievements
from app.services.content import get_content
from app.services.daily import add_run, game_day, pick_quests
from app.services.economy import (
    accepted_elites,
    emerald_reward,
    new_milestones,
    record_win,
    run_reward,
    speed_win_emeralds,
    unlocked_heroes,
    unlocked_locations,
    unlocked_speeds,
    update_record,
)
from app.services.tokens import as_utc, current_user, utcnow

router = APIRouter(prefix="/runs", tags=["runs"], responses={
    401: {"model": ErrorResponse}, 403: {"model": ErrorResponse}, 404: {"model": ErrorResponse},
    409: {"model": ErrorResponse},
})
SessionDep = Annotated[AsyncSession, Depends(get_session)]
UserDep = Annotated[User, Depends(current_user)]


class RunStartRequest(BaseModel):
    location_id: str
    hero_id: str
    #: Game speed in percent, one of `balance.speeds`.
    speed: int = 100
    #: A full run, or a short contract on this location (`contract_id` from content/contracts).
    mode: Literal["standard", "contract"] = "standard"
    contract_id: str | None = Field(default=None, max_length=80)


class RunStartResponse(BaseModel):
    run_id: uuid.UUID
    seed: int
    content_hash: str
    #: Bought boosts this run takes; they are gone from the profile now.
    boosts: list[str] = Field(default_factory=list)
    mode: Literal["standard", "contract"] = "standard"
    contract_id: str | None = None


class RunSummary(BaseModel):
    content_hash: str
    duration_seconds: int = Field(ge=0)
    kills_by_type: dict[str, Annotated[int, Field(ge=0)]]
    wave_reached: int = Field(ge=1)
    boss_killed: bool
    picked_caps: int = Field(ge=0)
    autopilot: bool = False
    achievements: list[Annotated[str, Field(max_length=64)]] = Field(
        default_factory=list, max_length=64,
    )


class RunRecord(BaseModel):
    """Accepted time and kills of this run and the location bests before it (None: first run)."""

    seconds: int
    kills: int
    previous_seconds: int | None
    previous_kills: int | None


class ContractResult(BaseModel):
    """How a contract ended: the objective checked by the server and the bonus caps paid."""

    id: str
    done: bool
    bonus_caps: int


class RunFinishResponse(BaseModel):
    status: Literal["finished"] = "finished"
    reward_caps: int
    reward_emeralds: int
    achievements: list[str]
    flags: list[str]
    #: Personal record view; None for autopilot runs and contracts, which do not set records.
    record: RunRecord | None = None
    #: Set for a contract run only.
    contract: ContractResult | None = None
    profile: ProfileResponse


@router.post("/start", response_model=RunStartResponse)
async def start_run(
    body: RunStartRequest, user: UserDep, session: SessionDep,
) -> RunStartResponse:
    content = get_content()
    if body.location_id not in content.category("locations"):
        raise ApiError(404, ErrorCode.not_found, "Локация не найдена")
    if body.hero_id not in content.category("heroes"):
        raise ApiError(404, ErrorCode.not_found, "Герой не найден")
    profile = await session.get(Profile, user.id)
    data = (profile.data or {}) if profile else {}
    bosses_killed = data.get("bosses_killed", [])
    if body.location_id not in unlocked_locations(content.category("locations"), bosses_killed):
        raise ApiError(403, ErrorCode.locked, "Локация ещё закрыта")
    if body.hero_id not in unlocked_heroes(content.category("heroes"), data):
        raise ApiError(403, ErrorCode.locked, "Персонаж ещё не открыт")
    if body.speed not in unlocked_speeds(content.balance["speeds"], data, body.location_id):
        raise ApiError(403, ErrorCode.locked, "Эта скорость ещё не открыта")
    contract_id: str | None = None
    if body.mode == "contract":
        contract = content.category("contracts").get(body.contract_id or "")
        if contract is None:
            raise ApiError(404, ErrorCode.not_found, "Контракт не найден")
        if contract["location"] != body.location_id:
            raise ApiError(409, ErrorCode.conflict, "Этот контракт на другой локации")
        contract_id = contract["id"]
    elif body.contract_id is not None:
        raise ApiError(409, ErrorCode.conflict, "Контракт выбирается только в режиме контракта")
    await session.scalar(select(User).where(User.id == user.id).with_for_update())
    now = utcnow()
    active = (await session.scalars(
        select(Run).where(Run.user_id == user.id, Run.status == "started").with_for_update()
    )).all()
    for previous in active:
        previous.status = "rejected"
        previous.finished_at = now
        age = now - as_utc(previous.started_at)
        previous.flags = ["abandoned"] if age < timedelta(hours=1) else ["expired"]
    # Boosts are used up by the start itself: an abandoned run loses them too.
    locked = await session.scalar(
        select(Profile).where(Profile.user_id == user.id).with_for_update()
        .execution_options(populate_existing=True)
    )
    known_boosts = content.category("boosts")
    boosts: list[str] = []
    if locked is not None and (locked.data or {}).get("boosts"):
        boosts = [item for item in locked.data["boosts"] if item in known_boosts]
        locked.data = {**locked.data, "boosts": []}
        locked.version += 1
    run = Run(
        user_id=user.id, location_id=body.location_id, hero_id=body.hero_id, speed=body.speed,
        seed=secrets.randbits(32), content_hash=content.hash, status="started",
        started_at=now, flags=[], boosts=boosts, mode=body.mode, contract_id=contract_id,
    )
    session.add(run)
    await session.commit()
    return RunStartResponse(
        run_id=run.id, seed=run.seed, content_hash=run.content_hash, boosts=boosts,
        mode=body.mode, contract_id=contract_id,
    )


@router.post("/{run_id}/finish", response_model=RunFinishResponse)
async def finish_run(
    run_id: uuid.UUID, body: RunSummary,
    user: UserDep, session: SessionDep,
) -> RunFinishResponse:
    run = await session.scalar(
        select(Run).where(Run.id == run_id, Run.user_id == user.id).with_for_update()
    )
    if run is None:
        raise ApiError(404, ErrorCode.not_found, "Забег не найден")
    if run.status == "rejected":
        raise ApiError(409, ErrorCode.conflict, "Забег уже закрыт")
    profile = await session.scalar(
        select(Profile).where(Profile.user_id == user.id).with_for_update()
    )
    if profile is None:
        raise ApiError(404, ErrorCode.not_found, "Профиль не найден")
    if run.status == "finished":
        accepted = (run.summary or {}).get("accepted") or {}
        saved = accepted.get("record")
        saved_contract = accepted.get("contract")
        return RunFinishResponse(
            reward_caps=run.reward_caps or 0,
            reward_emeralds=((run.summary or {}).get("accepted") or {}).get("emeralds", 0),
            achievements=((run.summary or {}).get("accepted") or {}).get("achievements", []),
            flags=run.flags,
            record=RunRecord(**saved) if saved else None,
            contract=ContractResult(**saved_contract) if saved_contract else None,
            profile=await profile_response(session, user, profile),
        )

    content = get_content()
    location = content.category("locations")[run.location_id]
    # A contract is checked by the mode stored at start, never by what the client says now.
    contract = (
        content.category("contracts").get(run.contract_id or "") if run.mode == "contract" else None
    )
    schedule = contract or location
    known_enemies = content.category("enemies")
    rules = content.balance["reward"]
    now = utcnow()
    flags: list[str] = []
    if body.content_hash != run.content_hash or content.hash != run.content_hash:
        flags.append("content_hash_mismatch")
    if run.mode == "contract" and contract is None:
        flags.append("contract_missing")
    # Durations are in game seconds: they pass at the chosen speed times the base pace.
    wall_seconds = max(0.0, (now - as_utc(run.started_at)).total_seconds())
    max_duration = min(
        schedule["durationSeconds"],
        int(wall_seconds * run.speed / 100 * content.balance["run"]["timeScale"])
        + rules["durationGraceSeconds"],
    )
    duration = min(body.duration_seconds, max_duration)
    if duration != body.duration_seconds:
        flags.append("duration_clamped")

    unknown = set(body.kills_by_type) - set(known_enemies)
    if unknown:
        flags.append("unknown_enemy")
    reported_kills = sum(
        count for enemy, count in body.kills_by_type.items() if enemy in known_enemies
    )
    kills = min(reported_kills, math.floor(duration * rules["maxKillsPerSecond"]))
    if kills != reported_kills:
        flags.append("kills_clamped")
    picked_caps = min(body.picked_caps, math.floor(duration * rules["maxCapsPerSecond"]))
    if picked_caps != body.picked_caps:
        flags.append("caps_clamped")
    maximum_wave = sum(1 for wave in schedule["waves"] if wave["atSecond"] <= duration)
    wave = min(body.wave_reached, max(1, maximum_wave))
    if wave != body.wave_reached:
        flags.append("wave_clamped")
    boss = location.get("boss")
    boss_killed = (
        run.mode == "standard" and body.boss_killed and boss is not None
        and duration >= boss["atSecond"]
        and body.kills_by_type.get(boss["enemy"], 0) >= 1
    )
    if body.boss_killed and not boss_killed:
        flags.append("boss_clamped")

    boosts = content.category("boosts")
    bonus = sum(float(boosts[item].get("rewardBonus", 0)) for item in run.boosts if item in boosts)
    objective = contract["objective"] if contract else None
    objective_done = bool(
        objective and objective["enemy"] in known_enemies and duration >= objective["atSecond"]
        and body.kills_by_type.get(objective["enemy"], 0) >= 1
    )
    contract_bonus = int(contract["completionCaps"]) if contract and objective_done else 0
    reward = run_reward(
        rules, duration, kills, wave, boss_killed, picked_caps,
        float(location["rewardMultiplier"]) * float(contract["rewardMultiplier"] if contract else 1)
        * (1 + bonus),
    ) + contract_bonus
    # The objective counts as one more mini-boss of the schedule (for daily quests).
    events = list(schedule["events"]) + (
        [{"atSecond": objective["atSecond"], "enemy": objective["enemy"], "count": 1}]
        if objective else []
    )
    data = profile.data or {}
    bosses = list(data.get("bosses_killed", []))
    marks: dict[str, list[int]] = dict(data.get("milestones", {}))
    reached = marks.get(run.location_id, [])
    rules_marks = rules["emeraldMilestones"]
    # Contracts give no emeralds and never reach survival marks, wins or bosses.
    passed = new_milestones(rules_marks, duration, reached) if run.mode == "standard" else []
    emeralds = emerald_reward(
        location["emeralds"], rules_marks,
        accepted_elites(location, known_enemies, body.kills_by_type, duration),
        boss_killed, run.location_id not in bosses, passed,
    ) if run.mode == "standard" else 0
    if boss_killed and not body.autopilot:
        emeralds += speed_win_emeralds(
            content.balance["speeds"], data, run.location_id, run.speed,
        )
        data = record_win(data, run.location_id, run.hero_id, run.speed)
    if passed:
        marks[run.location_id] = sorted([*reached, *passed])
    if boss_killed and run.location_id not in bosses:
        bosses.append(run.location_id)
    data, achievements = grant_achievements(
        content.category("achievements"),
        {
            **data, "runs_count": data.get("runs_count", 0) + 1, "bosses_killed": bosses,
            "milestones": marks, "emeralds": data.get("emeralds", 0) + emeralds,
        },
        RunFacts(
            location=run.location_id, duration=duration, kills=kills, picked_caps=picked_caps,
            boss_killed=boss_killed, autopilot=body.autopilot, reported=body.achievements,
            speed=run.speed, boosts=len(run.boosts),
        ),
    )
    elites = accepted_elites({"events": events}, known_enemies, body.kills_by_type, duration)
    if not body.autopilot:
        daily_rules = content.balance["daily"]
        day = game_day(now, daily_rules)
        data = add_run(data, pick_quests(day, content.category("daily"), daily_rules), day, {
            "kills": kills, "kills_by_type": body.kills_by_type, "duration": duration,
            "elites": elites, "picked_caps": picked_caps, "boss_killed": boss_killed,
        }, daily_rules)
    record: dict[str, int | None] | None = None
    if not body.autopilot and run.mode == "standard":
        data, record = update_record(data, run.location_id, duration, kills)
    contract_result = (
        {"id": run.contract_id, "done": objective_done, "bonus_caps": contract_bonus}
        if run.mode == "contract" and run.contract_id else None
    )
    run.status = "finished"
    run.finished_at = now
    run.reward_caps = reward
    run.flags = flags
    run.summary = {
        "reported": body.model_dump(),
        "accepted": {
            "duration_seconds": duration, "kills": kills, "wave_reached": wave,
            "boss_killed": boss_killed, "picked_caps": picked_caps,
            "emeralds": emeralds, "achievements": achievements, "speed": run.speed,
            "boosts": list(run.boosts), "record": record, "mode": run.mode,
            "contract": contract_result,
        },
    }
    profile.caps += reward
    profile.version += 1
    profile.best_time_s = max(profile.best_time_s, duration)
    profile.data = data
    await session.commit()
    return RunFinishResponse(
        reward_caps=reward, reward_emeralds=emeralds, achievements=achievements, flags=flags,
        record=RunRecord(**record) if record else None,
        contract=ContractResult(**contract_result) if contract_result else None,
        profile=await profile_response(session, user, profile),
    )
