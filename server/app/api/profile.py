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
from app.services.content import get_content
from app.services.economy import upgrade_cost
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
    version: int
    schema_version: int
    best_time_s: int
    upgrades: dict[str, int]
    runs_count: int
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
        version=profile.version, schema_version=profile.schema_version,
        best_time_s=profile.best_time_s, upgrades=data.get("upgrades", {}),
        runs_count=data.get("runs_count", 0),
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
    if profile.caps < cost:
        raise ApiError(409, ErrorCode.conflict, "Недостаточно крышек")
    result = await session.execute(
        update(Profile).where(
            Profile.user_id == user.id, Profile.version == body.expected_version,
            Profile.caps >= cost,
        ).values(caps=Profile.caps - cost, version=Profile.version + 1)
        .returning(Profile.user_id)
    )
    if result.scalar_one_or_none() is None:
        raise ApiError(409, ErrorCode.conflict, "Профиль изменился. Обновите данные")
    upgrades[upgrade_id] = level + 1
    profile.data = {**(profile.data or {}), "upgrades": upgrades}
    await session.commit()
    await session.refresh(profile)
    return await profile_response(session, user, profile)
