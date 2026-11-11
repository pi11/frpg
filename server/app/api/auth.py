"""Guest, email and refresh-token authentication."""

import hashlib
import hmac
import secrets
import uuid
from datetime import timedelta
from typing import Annotated, Any
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response
from pydantic import BaseModel, EmailStr, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import ApiError, ErrorCode, ErrorResponse
from app.config import get_settings
from app.db import get_session
from app.models.auth import AuthIdentity, LoginToken, Profile, User
from app.services.mail import send_login_email
from app.services.tokens import (
    TokenPair,
    as_utc,
    current_user,
    digest,
    issue_pair,
    logout_refresh,
    optional_user,
    require_jwt_secret,
    rotate_refresh,
    utcnow,
)

AUTH_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorResponse},
    409: {"model": ErrorResponse},
    429: {"model": ErrorResponse},
    503: {"model": ErrorResponse},
}
router = APIRouter(prefix="/auth", tags=["auth"], responses=AUTH_ERRORS)
account_router = APIRouter(tags=["account"], responses=AUTH_ERRORS)
SessionDep = Annotated[AsyncSession, Depends(get_session)]
OptionalUserDep = Annotated[User | None, Depends(optional_user)]
UserDep = Annotated[User, Depends(current_user)]


class EmailStartRequest(BaseModel):
    email: EmailStr


class EmailVerifyRequest(BaseModel):
    token: str | None = None
    email: EmailStr | None = None
    code: str | None = Field(default=None, pattern=r"^\d{6}$")

    @model_validator(mode="after")
    def check_choice(self) -> "EmailVerifyRequest":
        if bool(self.token) == bool(self.email and self.code):
            raise ValueError("Provide a token or an email and code")
        return self


class RefreshRequest(BaseModel):
    refresh_token: str


class OkResponse(BaseModel):
    status: str = "ok"


def code_digest(challenge_id: uuid.UUID, code: str) -> str:
    return hmac.new(
        require_jwt_secret().encode(), f"{challenge_id}:{code}".encode(), hashlib.sha256
    ).hexdigest()


async def create_user(session: AsyncSession) -> User:
    user = User(is_guest=True)
    session.add(user)
    await session.flush()
    session.add(Profile(user_id=user.id, data={}))
    return user


async def resolve_identity(
    session: AsyncSession, provider: str, subject: str, preferred_user_id: uuid.UUID | None,
) -> User:
    identity = await session.scalar(
        select(AuthIdentity).where(
            AuthIdentity.provider == provider, AuthIdentity.subject == subject
        ).with_for_update()
    )
    if identity:
        user = await session.get(User, identity.user_id)
        if user is None:
            raise ApiError(401, ErrorCode.invalid_token, "Аккаунт не найден")
        return user
    user = await session.get(User, preferred_user_id) if preferred_user_id else None
    if user is None:
        user = await create_user(session)
    user.is_guest = False
    session.add(AuthIdentity(user_id=user.id, provider=provider, subject=subject))
    await session.flush()
    return user


@router.post("/guest", response_model=TokenPair)
async def guest(
    request: Request, session: SessionDep,
) -> TokenPair:
    user = await create_user(session)
    pair = await issue_pair(session, user, request.headers.get("user-agent"))
    await session.commit()
    return pair


@router.post("/email/start", response_model=OkResponse)
async def email_start(
    body: EmailStartRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    user: OptionalUserDep,
    session: SessionDep,
) -> OkResponse:
    email = str(body.email).lower()
    ip = request.client.host if request.client else "unknown"
    now = utcnow()
    last = await session.scalar(
        select(LoginToken).where(LoginToken.email == email)
        .order_by(LoginToken.created_at.desc()).limit(1)
    )
    count_today = await session.scalar(
        select(func.count(LoginToken.id)).where(
            LoginToken.email == email, LoginToken.created_at >= now - timedelta(days=1)
        )
    )
    count_ip = await session.scalar(
        select(func.count(LoginToken.id)).where(
            LoginToken.request_ip == ip,
            LoginToken.created_at >= now - timedelta(hours=1),
        )
    )
    if ((last and as_utc(last.created_at) > now - timedelta(minutes=1))
            or (count_today or 0) >= 5 or (count_ip or 0) >= 20):
        await session.commit()
        return OkResponse()

    raw = secrets.token_urlsafe(32)
    code = f"{secrets.randbelow(1_000_000):06d}"
    challenge_id = uuid.uuid4()
    challenge = LoginToken(
        id=challenge_id, email=email, request_ip=ip, user_id=user.id if user else None,
        token_hash=digest(raw), code_hash=code_digest(challenge_id, code),
        expires_at=now + timedelta(minutes=15),
    )
    session.add(challenge)
    await session.commit()
    link = f"{get_settings().public_url.rstrip('/')}/login?token={quote(raw)}"
    background_tasks.add_task(send_login_email, email, link, code, challenge_id)
    return OkResponse()


@router.post("/email/verify", response_model=TokenPair)
async def email_verify(
    body: EmailVerifyRequest,
    request: Request,
    session: SessionDep,
) -> TokenPair:
    if body.token:
        challenge = await session.scalar(
            select(LoginToken).where(LoginToken.token_hash == digest(body.token)).with_for_update()
        )
    else:
        challenge = await session.scalar(
            select(LoginToken).where(LoginToken.email == str(body.email).lower())
            .order_by(LoginToken.created_at.desc()).limit(1).with_for_update()
        )
    if challenge is None or challenge.used_at is not None:
        raise ApiError(401, ErrorCode.invalid_token, "Ссылка или код недействительны")
    if as_utc(challenge.expires_at) <= utcnow():
        raise ApiError(401, ErrorCode.expired, "Срок действия ссылки истёк")
    if body.code:
        if challenge.attempts >= 5:
            raise ApiError(401, ErrorCode.invalid_code, "Превышено число попыток")
        if not hmac.compare_digest(challenge.code_hash, code_digest(challenge.id, body.code)):
            challenge.attempts += 1
            await session.commit()
            raise ApiError(401, ErrorCode.invalid_code, "Неверный код")
    challenge.used_at = utcnow()
    user = await resolve_identity(session, "email", challenge.email, challenge.user_id)
    pair = await issue_pair(session, user, request.headers.get("user-agent"))
    await session.commit()
    return pair


@router.post("/refresh", response_model=TokenPair)
async def refresh(
    body: RefreshRequest,
    request: Request,
    session: SessionDep,
) -> TokenPair:
    return await rotate_refresh(session, body.refresh_token, request.headers.get("user-agent"))


@router.post("/logout", response_model=OkResponse)
async def logout(
    body: RefreshRequest,
    user: UserDep,
    session: SessionDep,
) -> OkResponse:
    await logout_refresh(session, user, body.refresh_token)
    return OkResponse()


@account_router.delete("/account", status_code=204)
async def delete_account(
    user: UserDep,
    session: SessionDep,
) -> Response:
    await session.delete(user)
    await session.commit()
    return Response(status_code=204)
