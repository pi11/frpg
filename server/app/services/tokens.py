"""Access JWTs and rotating opaque refresh tokens."""

import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

import jwt
from fastapi import Depends, Request
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import ApiError, ErrorCode
from app.config import get_settings
from app.db import get_session
from app.models.auth import RefreshToken, User

ACCESS_LIFETIME = timedelta(minutes=15)
REFRESH_LIFETIME = timedelta(days=30)


def utcnow() -> datetime:
    return datetime.now(UTC)


def as_utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def require_jwt_secret() -> str:
    secret = get_settings().jwt_secret
    if len(secret) < 32:
        raise ApiError(503, ErrorCode.not_configured, "JWT_SECRET не настроен")
    return secret


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = int(ACCESS_LIFETIME.total_seconds())
    user_id: uuid.UUID
    is_guest: bool


def access_token(user: User) -> str:
    return jwt.encode(
        {"sub": str(user.id), "type": "access", "jti": str(uuid.uuid4()),
         "exp": utcnow() + ACCESS_LIFETIME},
        require_jwt_secret(),
        algorithm="HS256",
    )


def decode_access(raw: str) -> uuid.UUID:
    try:
        payload = jwt.decode(
            raw, require_jwt_secret(), algorithms=["HS256"],
            options={"require": ["exp", "sub", "type"]},
        )
        if payload["type"] != "access":
            raise ValueError("wrong token type")
        return uuid.UUID(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError, TypeError) as exc:
        raise ApiError(401, ErrorCode.invalid_token, "Недействительный токен") from exc


def new_refresh_record(
    user: User, raw: str, user_agent: str | None, family_id: uuid.UUID | None = None,
) -> RefreshToken:
    return RefreshToken(
        user_id=user.id,
        token_hash=digest(raw),
        family_id=family_id or uuid.uuid4(),
        expires_at=utcnow() + REFRESH_LIFETIME,
        user_agent=user_agent[:512] if user_agent else None,
    )


async def issue_pair(
    session: AsyncSession, user: User, user_agent: str | None,
    family_id: uuid.UUID | None = None,
) -> TokenPair:
    raw = secrets.token_urlsafe(32)
    session.add(new_refresh_record(user, raw, user_agent, family_id))
    await session.flush()
    return TokenPair(
        access_token=access_token(user), refresh_token=raw,
        user_id=user.id, is_guest=user.is_guest,
    )


async def optional_user(
    request: Request, session: Annotated[AsyncSession, Depends(get_session)],
) -> User | None:
    header = request.headers.get("Authorization")
    if header is None:
        return None
    prefix, _, raw = header.partition(" ")
    if prefix.lower() != "bearer" or not raw:
        raise ApiError(401, ErrorCode.invalid_token, "Недействительный токен")
    user = await session.get(User, decode_access(raw))
    if user is None:
        raise ApiError(401, ErrorCode.invalid_token, "Аккаунт не найден")
    user.last_seen_at = utcnow()
    return user


async def current_user(
    request: Request, session: Annotated[AsyncSession, Depends(get_session)],
) -> User:
    user = await optional_user(request, session)
    if user is None:
        raise ApiError(401, ErrorCode.invalid_token, "Требуется вход")
    return user


async def rotate_refresh(
    session: AsyncSession, raw: str, user_agent: str | None,
) -> TokenPair:
    record = await session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == digest(raw)).with_for_update()
    )
    if record is None:
        raise ApiError(401, ErrorCode.invalid_token, "Недействительный токен")
    if record.revoked_at is not None:
        if record.replaced_by is not None:
            await session.execute(
                update(RefreshToken)
                .where(RefreshToken.family_id == record.family_id)
                .values(revoked_at=utcnow())
            )
            await session.commit()
        raise ApiError(401, ErrorCode.invalid_token, "Токен уже использован")
    if as_utc(record.expires_at) <= utcnow():
        record.revoked_at = utcnow()
        await session.commit()
        raise ApiError(401, ErrorCode.expired, "Срок действия токена истёк")
    user = await session.get(User, record.user_id)
    if user is None:
        raise ApiError(401, ErrorCode.invalid_token, "Аккаунт не найден")
    record.revoked_at = utcnow()
    raw_next = secrets.token_urlsafe(32)
    replacement = new_refresh_record(user, raw_next, user_agent, record.family_id)
    session.add(replacement)
    await session.flush()
    record.replaced_by = replacement.id
    pair = TokenPair(
        access_token=access_token(user), refresh_token=raw_next,
        user_id=user.id, is_guest=user.is_guest,
    )
    await session.commit()
    return pair


async def logout_refresh(session: AsyncSession, user: User, raw: str) -> None:
    record = await session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == digest(raw))
    )
    if record is not None and hmac.compare_digest(str(record.user_id), str(user.id)):
        record.revoked_at = utcnow()
    await session.commit()
