"""Profile reads and versioned upgrade purchases."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import ApiError, ErrorCode, ErrorResponse
from app.db import get_session
from app.models.auth import AuthIdentity, Profile, User
from app.services.achievements import grant_achievements
from app.services.content import get_content
from app.services.economy import unlocked_locations, upgrade_cost
from app.services.tokens import current_user

router = APIRouter(tags=["profile"], responses={
    401: {"model": ErrorResponse}, 404: {"model": ErrorResponse},
    409: {"model": ErrorResponse},
})
SessionDep = Annotated[AsyncSession, Depends(get_session)]
UserDep = Annotated[User, Depends(current_user)]


class IdentityResponse(BaseModel):
    provider: str
    subject: str


class ProfileResponse(BaseModel):
    user_id: uuid.UUID
    is_guest: bool
    caps: int
    emeralds: int
    version: int
    schema_version: int
    best_time_s: int
    upgrades: dict[str, int]
    runs_count: int
    bosses_killed: list[str]
    unlocks: list[str]
    milestones: dict[str, list[int]]
    achievements: list[str]
    unlocked_locations: list[str]
    identities: list[IdentityResponse]


class BuyRequest(BaseModel):
    expected_version: int = Field(ge=0)


async def profile_response(session: AsyncSession, user: User, profile: Profile) -> ProfileResponse:
    identities = (await session.scalars(
        select(AuthIdentity).where(AuthIdentity.user_id == user.id)
    )).all()
    data = profile.data or {}
    return ProfileResponse(
        user_id=user.id, is_guest=user.is_guest, caps=profile.caps,
        emeralds=data.get("emeralds", 0),
        version=profile.version, schema_version=profile.schema_version,
        best_time_s=profile.best_time_s, upgrades=data.get("upgrades", {}),
        runs_count=data.get("runs_count", 0),
        bosses_killed=sorted(data.get("bosses_killed", [])),
        unlocks=sorted(data.get("unlocks", [])), milestones=data.get("milestones", {}),
        achievements=data.get("achievements", []),
        unlocked_locations=unlocked_locations(
            get_content().category("locations"), data.get("bosses_killed", []),
        ),
        identities=[IdentityResponse(provider=item.provider, subject=item.subject)
                    for item in identities],
    )


@router.get("/profile", response_model=ProfileResponse)
async def get_profile(user: UserDep, session: SessionDep) -> ProfileResponse:
    profile = await session.get(Profile, user.id)
    if profile is None:
        raise ApiError(404, ErrorCode.not_found, "Профиль не найден")
    return await profile_response(session, user, profile)


@router.post("/upgrades/{upgrade_id}/buy", response_model=ProfileResponse)
async def buy_upgrade(
    upgrade_id: str, body: BuyRequest, user: UserDep, session: SessionDep,
) -> ProfileResponse:
    upgrade = get_content().category("upgrades").get(upgrade_id)
    if upgrade is None:
        raise ApiError(404, ErrorCode.not_found, "Улучшение не найдено")
    profile = await session.scalar(
        select(Profile).where(Profile.user_id == user.id).with_for_update()
    )
    if profile is None:
        raise ApiError(404, ErrorCode.not_found, "Профиль не найден")
    if profile.version != body.expected_version:
        raise ApiError(409, ErrorCode.conflict, "Профиль изменился. Обновите данные")
    upgrades: dict[str, int] = dict((profile.data or {}).get("upgrades", {}))
    level = upgrades.get(upgrade_id, 0)
    if level >= upgrade["maxLevel"]:
        raise ApiError(409, ErrorCode.conflict, "Достигнут максимальный уровень")
    cost = upgrade_cost(upgrade, level)
    data = dict(profile.data or {})
    caps = emeralds = 0
    if upgrade.get("currency") == "emeralds":
        emeralds = cost
    else:
        caps = cost
    if profile.caps < caps:
        raise ApiError(409, ErrorCode.conflict, "Недостаточно крышек")
    if data.get("emeralds", 0) < emeralds:
        raise ApiError(409, ErrorCode.conflict, "Недостаточно изумрудов")
    result = await session.execute(
        update(Profile).where(
            Profile.user_id == user.id, Profile.version == body.expected_version,
            Profile.caps >= caps,
        ).values(caps=Profile.caps - caps, version=Profile.version + 1)
        .returning(Profile.user_id)
    )
    if result.scalar_one_or_none() is None:
        raise ApiError(409, ErrorCode.conflict, "Профиль изменился. Обновите данные")
    upgrades[upgrade_id] = level + 1
    data["upgrades"] = upgrades
    if emeralds:
        data["emeralds"] = data.get("emeralds", 0) - emeralds
    profile.data = data
    await session.commit()
    await session.refresh(profile)
    return await profile_response(session, user, profile)


@router.post("/unlocks/{item_id}/buy", response_model=ProfileResponse)
async def buy_unlock(
    item_id: str, body: BuyRequest, user: UserDep, session: SessionDep,
) -> ProfileResponse:
    """Opens a weapon or perk for runs; paid with emeralds, kept in profile.data."""
    content = get_content()
    item = content.category("weapons").get(item_id) or content.category("passives").get(item_id)
    cost = (item or {}).get("unlock", {}).get("emeralds")
    if cost is None:
        raise ApiError(404, ErrorCode.not_found, "Предмет не найден")
    # The row lock together with the version check serializes every profile change.
    profile = await session.scalar(
        select(Profile).where(Profile.user_id == user.id).with_for_update()
    )
    if profile is None:
        raise ApiError(404, ErrorCode.not_found, "Профиль не найден")
    if profile.version != body.expected_version:
        raise ApiError(409, ErrorCode.conflict, "Профиль изменился. Обновите данные")
    data = profile.data or {}
    unlocks = list(data.get("unlocks", []))
    if item_id in unlocks:
        raise ApiError(409, ErrorCode.conflict, "Уже открыто")
    emeralds = data.get("emeralds", 0)
    if emeralds < cost:
        raise ApiError(409, ErrorCode.conflict, "Недостаточно изумрудов")
    data, _ = grant_achievements(
        content.category("achievements"),
        {**data, "emeralds": emeralds - cost, "unlocks": [*unlocks, item_id]}, None,
    )
    changed = await session.execute(
        update(Profile).where(
            Profile.user_id == user.id, Profile.version == body.expected_version,
        ).values(version=Profile.version + 1, data=data).returning(Profile.user_id)
    )
    if changed.scalar_one_or_none() is None:
        raise ApiError(409, ErrorCode.conflict, "Профиль изменился. Обновите данные")
    await session.commit()
    await session.refresh(profile)
    return await profile_response(session, user, profile)
