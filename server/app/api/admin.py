"""Admin API: statistics, players, currency grants, suspicious runs and the audit trail.

Only users with `is_admin` (set from the server shell, see app.services.admin) get past
`admin_user`; everyone else receives 403. Every change is written to admin_actions.
"""

import uuid
from collections import Counter
from datetime import datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import ApiError, ErrorCode, ErrorResponse
from app.db import get_session
from app.models.admin import AdminAction
from app.models.auth import AuthIdentity, Profile, User
from app.models.run import Run
from app.services.tokens import as_utc, current_user, utcnow

router = APIRouter(prefix="/admin", tags=["admin"], responses={
    401: {"model": ErrorResponse}, 403: {"model": ErrorResponse}, 404: {"model": ErrorResponse},
})
SessionDep = Annotated[AsyncSession, Depends(get_session)]

#: Chart of finished runs per day.
STAT_DAYS = 14
#: Flags of runs that simply were not finished; anything else is worth a look.
QUIET_FLAGS = {"abandoned", "expired"}
#: A single grant may not move more than this, so a typo cannot flood the economy.
GRANT_LIMIT = 1_000_000


async def admin_user(user: Annotated[User, Depends(current_user)]) -> User:
    if not user.is_admin:
        raise ApiError(403, ErrorCode.forbidden, "Нужны права администратора")
    return user


AdminDep = Annotated[User, Depends(admin_user)]


class Identity(BaseModel):
    provider: str
    subject: str


class UserRow(BaseModel):
    id: uuid.UUID
    created_at: datetime
    last_seen_at: datetime
    is_guest: bool
    is_admin: bool
    identities: list[Identity]
    caps: int
    emeralds: int
    runs_count: int
    best_time_s: int
    bosses_killed: list[str]


class UserList(BaseModel):
    total: int
    users: list[UserRow]


class RunRow(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    location_id: str
    hero_id: str
    speed: int
    status: str
    started_at: datetime
    finished_at: datetime | None
    duration_s: int | None
    kills: int | None
    boss_killed: bool
    reward_caps: int | None
    emeralds: int | None
    flags: list[str]


class UserDetail(BaseModel):
    user: UserRow
    upgrades: dict[str, int]
    unlocks: list[str]
    achievements: list[str]
    wins: dict[str, dict[str, int]]
    runs: list[RunRow]


class ActionRow(BaseModel):
    id: uuid.UUID
    admin_id: uuid.UUID | None
    user_id: uuid.UUID | None
    action: str
    details: dict[str, Any]
    created_at: datetime


class GrantRequest(BaseModel):
    caps: int = Field(default=0, ge=-GRANT_LIMIT, le=GRANT_LIMIT)
    emeralds: int = Field(default=0, ge=-GRANT_LIMIT, le=GRANT_LIMIT)
    note: str = Field(default="", max_length=200)


class Count(BaseModel):
    key: str
    runs: int
    bosses: int


class DayCount(BaseModel):
    day: str
    runs: int
    players: int


class Stats(BaseModel):
    users_total: int
    users_guests: int
    users_admins: int
    users_new_today: int
    users_new_week: int
    active_today: int
    active_week: int
    runs_total: int
    runs_in_progress: int
    runs_today: int
    runs_week: int
    flagged_week: int
    boss_kills_week: int
    avg_duration_week: int
    caps_total: int
    emeralds_total: int
    locations_week: list[Count]
    heroes_week: list[Count]
    speeds_week: list[Count]
    days: list[DayCount]


def day_start(now: datetime) -> datetime:
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def accepted(run: Run) -> dict[str, Any]:
    return dict((run.summary or {}).get("accepted") or {})


def run_row(run: Run) -> RunRow:
    data = accepted(run)
    return RunRow(
        id=run.id, user_id=run.user_id, location_id=run.location_id, hero_id=run.hero_id,
        speed=run.speed, status=run.status, started_at=run.started_at,
        finished_at=run.finished_at, duration_s=data.get("duration_seconds"),
        kills=data.get("kills"), boss_killed=bool(data.get("boss_killed")),
        reward_caps=run.reward_caps, emeralds=data.get("emeralds"), flags=list(run.flags or []),
    )


async def user_rows(session: AsyncSession, users: list[User]) -> list[UserRow]:
    ids = [user.id for user in users]
    profiles = {profile.user_id: profile for profile in (await session.scalars(
        select(Profile).where(Profile.user_id.in_(ids))
    )).all()} if ids else {}
    identities: dict[uuid.UUID, list[Identity]] = {}
    if ids:
        for item in (await session.scalars(
            select(AuthIdentity).where(AuthIdentity.user_id.in_(ids))
        )).all():
            identities.setdefault(item.user_id, []).append(
                Identity(provider=item.provider, subject=item.subject))
    rows = []
    for user in users:
        profile = profiles.get(user.id)
        data = (profile.data or {}) if profile else {}
        rows.append(UserRow(
            id=user.id, created_at=user.created_at, last_seen_at=user.last_seen_at,
            is_guest=user.is_guest, is_admin=user.is_admin,
            identities=identities.get(user.id, []), caps=profile.caps if profile else 0,
            emeralds=int(data.get("emeralds", 0)), runs_count=int(data.get("runs_count", 0)),
            best_time_s=profile.best_time_s if profile else 0,
            bosses_killed=sorted(data.get("bosses_killed", [])),
        ))
    return rows


async def count(session: AsyncSession, statement: Select[int]) -> int:
    return int(await session.scalar(statement) or 0)


@router.get("/stats", response_model=Stats)
async def stats(_admin: AdminDep, session: SessionDep) -> Stats:
    now = utcnow()
    today = day_start(now)
    week = now - timedelta(days=7)
    users = select(func.count()).select_from(User)
    runs = select(func.count()).select_from(Run)
    recent = [run for run in (await session.scalars(select(Run).where(
        Run.status == "finished", Run.finished_at >= today - timedelta(days=STAT_DAYS - 1),
    ))).all() if run.finished_at]
    finished = {run.id: as_utc(run.finished_at) for run in recent if run.finished_at}
    week_runs = [run for run in recent if finished[run.id] >= week]

    def counts(key: str) -> list[Count]:
        runs_by: Counter[str] = Counter()
        bosses_by: Counter[str] = Counter()
        for run in week_runs:
            value = str(getattr(run, key))
            runs_by[value] += 1
            bosses_by[value] += int(bool(accepted(run).get("boss_killed")))
        return [Count(key=name, runs=total, bosses=bosses_by[name])
                for name, total in runs_by.most_common()]

    per_day: dict[str, list[Run]] = {}
    for run in recent:
        per_day.setdefault(finished[run.id].date().isoformat(), []).append(run)
    days = []
    for offset in range(STAT_DAYS - 1, -1, -1):
        day = (today - timedelta(days=offset)).date().isoformat()
        items = per_day.get(day, [])
        days.append(DayCount(day=day, runs=len(items),
                             players=len({run.user_id for run in items})))
    durations = [int(accepted(run).get("duration_seconds", 0)) for run in week_runs]
    profiles = (await session.scalars(select(Profile))).all()
    return Stats(
        users_total=await count(session, users),
        users_guests=await count(session, users.where(User.is_guest.is_(True))),
        users_admins=await count(session, users.where(User.is_admin.is_(True))),
        users_new_today=await count(session, users.where(User.created_at >= today)),
        users_new_week=await count(session, users.where(User.created_at >= week)),
        active_today=await count(session, users.where(User.last_seen_at >= today)),
        active_week=await count(session, users.where(User.last_seen_at >= week)),
        runs_total=await count(session, runs.where(Run.status == "finished")),
        runs_in_progress=await count(session, runs.where(
            Run.status == "started", Run.started_at >= now - timedelta(hours=1))),
        runs_today=sum(1 for run in recent if finished[run.id] >= today),
        runs_week=len(week_runs),
        flagged_week=sum(1 for run in week_runs if run.flags),
        boss_kills_week=sum(1 for run in week_runs if accepted(run).get("boss_killed")),
        avg_duration_week=round(sum(durations) / len(durations)) if durations else 0,
        caps_total=sum(profile.caps for profile in profiles),
        emeralds_total=sum(int((profile.data or {}).get("emeralds", 0)) for profile in profiles),
        locations_week=counts("location_id"), heroes_week=counts("hero_id"),
        speeds_week=counts("speed"), days=days,
    )


@router.get("/users", response_model=UserList)
async def list_users(
    _admin: AdminDep, session: SessionDep,
    q: Annotated[str, Query(max_length=320)] = "",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    sort: Annotated[str, Query(pattern="^(last_seen|created)$")] = "last_seen",
) -> UserList:
    """Newest activity first; `q` is a whole user id or a part of an email or Telegram id."""
    statement = select(User)
    needle = q.strip().lower()
    if needle:
        matching = select(AuthIdentity.user_id).where(AuthIdentity.subject.contains(needle))
        try:
            statement = statement.where(or_(User.id == uuid.UUID(needle), User.id.in_(matching)))
        except ValueError:
            statement = statement.where(User.id.in_(matching))
    total = await count(session, select(func.count()).select_from(statement.subquery()))
    order = User.last_seen_at if sort == "last_seen" else User.created_at
    users = list((await session.scalars(
        statement.order_by(order.desc()).limit(limit).offset(offset)
    )).all())
    return UserList(total=total, users=await user_rows(session, users))


async def get_user(session: AsyncSession, user_id: uuid.UUID) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise ApiError(404, ErrorCode.not_found, "Пользователь не найден")
    return user


async def user_detail(session: AsyncSession, user: User) -> UserDetail:
    profile = await session.get(Profile, user.id)
    data = (profile.data or {}) if profile else {}
    runs = (await session.scalars(
        select(Run).where(Run.user_id == user.id).order_by(Run.started_at.desc()).limit(30)
    )).all()
    return UserDetail(
        user=(await user_rows(session, [user]))[0], upgrades=data.get("upgrades", {}),
        unlocks=sorted(data.get("unlocks", [])), achievements=data.get("achievements", []),
        wins=data.get("wins", {}), runs=[run_row(run) for run in runs],
    )


@router.get("/users/{user_id}", response_model=UserDetail)
async def show_user(user_id: uuid.UUID, _admin: AdminDep, session: SessionDep) -> UserDetail:
    return await user_detail(session, await get_user(session, user_id))


@router.post("/users/{user_id}/grant", response_model=UserDetail)
async def grant(
    user_id: uuid.UUID, body: GrantRequest, admin: AdminDep, session: SessionDep,
) -> UserDetail:
    """Adds (or with a negative amount takes away) caps and emeralds; never below zero."""
    user = await get_user(session, user_id)
    profile = await session.scalar(
        select(Profile).where(Profile.user_id == user.id).with_for_update()
    )
    if profile is None:
        raise ApiError(404, ErrorCode.not_found, "Профиль не найден")
    data = dict(profile.data or {})
    caps = max(0, profile.caps + body.caps)
    emeralds = max(0, int(data.get("emeralds", 0)) + body.emeralds)
    details = {
        "caps": caps - profile.caps, "emeralds": emeralds - int(data.get("emeralds", 0)),
        "note": body.note.strip(),
    }
    profile.caps = caps
    data["emeralds"] = emeralds
    profile.data = data
    # Open shelter screens hold the old version: their next purchase gets 409 and reloads.
    profile.version += 1
    session.add(AdminAction(admin_id=admin.id, user_id=user.id, action="grant", details=details))
    await session.commit()
    return await user_detail(session, user)


@router.get("/runs", response_model=list[RunRow])
async def list_runs(
    _admin: AdminDep, session: SessionDep,
    flagged: bool = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[RunRow]:
    """Latest finished runs; with `flagged` only those the server clamped or rejected."""
    statement = select(Run).where(Run.status != "started")
    runs = (await session.scalars(
        statement.order_by(Run.started_at.desc()).limit(limit if not flagged else 1000)
    )).all()
    if flagged:
        runs = [run for run in runs if set(run.flags or []) - QUIET_FLAGS][:limit]
    return [run_row(run) for run in runs]


@router.get("/actions", response_model=list[ActionRow])
async def list_actions(
    _admin: AdminDep, session: SessionDep, limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[ActionRow]:
    actions = (await session.scalars(
        select(AdminAction).order_by(AdminAction.created_at.desc()).limit(limit)
    )).all()
    return [ActionRow(id=item.id, admin_id=item.admin_id, user_id=item.user_id,
                      action=item.action, details=item.details or {},
                      created_at=item.created_at) for item in actions]
