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
from app.models.auth import AuthIdentity, LoginToken, Profile, RecoveryKey, User
from app.services.achievements import record_account_event
from app.services.content import get_content
from app.services.mail import send_login_email
from app.services.recovery import derive_key, format_key, key_digest, normalize_key
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


class KeyLoginRequest(BaseModel):
    key: str = Field(max_length=64)


class KeyResponse(BaseModel):
    key: str


class MethodsResponse(BaseModel):
    """Optional ways to sign in; guests and account keys always work."""

    email: bool
    telegram: bool


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


async def note_sign_in(session: AsyncSession, user_id: uuid.UUID, event: str) -> None:
    """Remembers how the player signed in, for the hidden account achievements."""
    profile = await session.scalar(
        select(Profile).where(Profile.user_id == user_id).with_for_update()
        .execution_options(populate_existing=True)
    )
    if profile is None or event in (profile.data or {}).get("account_events", []):
        return
    data, _ = record_account_event(
        get_content().category("achievements"), profile.data or {}, event,
    )
    profile.data = data
    profile.version += 1


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


@router.get("/methods", response_model=MethodsResponse)
async def methods() -> MethodsResponse:
    settings = get_settings()
    return MethodsResponse(email=settings.mail_enabled, telegram=settings.telegram_enabled)


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
    if not get_settings().mail_enabled:
        raise ApiError(503, ErrorCode.not_configured, "Вход по почте не настроен")
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
    await note_sign_in(session, user.id, "email")
    pair = await issue_pair(session, user, request.headers.get("user-agent"))
    await session.commit()
    return pair


@router.post("/key", response_model=TokenPair)
async def key_login(body: KeyLoginRequest, request: Request, session: SessionDep) -> TokenPair:
    key = normalize_key(body.key)
    record = await session.scalar(
        select(RecoveryKey).where(RecoveryKey.key_hash == key_digest(key))
    ) if key else None
    user = await session.get(User, record.user_id) if record else None
    if user is None:
        raise ApiError(401, ErrorCode.invalid_code, "Ключ не подходит. Проверьте, нет ли опечатки")
    user.last_seen_at = utcnow()
    await note_sign_in(session, user.id, "key")
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


async def issue_key(session: AsyncSession, user: User, renew: bool) -> str:
    # The row lock keeps two tabs from issuing different versions at once.
    await session.scalar(select(User).where(User.id == user.id).with_for_update())
    record = await session.get(RecoveryKey, user.id)
    if record is None:
        record = RecoveryKey(user_id=user.id, version=1, key_hash="")
        session.add(record)
    elif renew:
        record.version += 1
        record.created_at = utcnow()
    key = derive_key(user.id, record.version)
    record.key_hash = key_digest(key)
    # An account with a key can be reopened, so it is no longer a disposable guest.
    user.is_guest = False
    await session.commit()
    return format_key(key)


@account_router.post("/account/key", response_model=KeyResponse)
async def account_key(user: UserDep, session: SessionDep) -> KeyResponse:
    return KeyResponse(key=await issue_key(session, user, renew=False))


@account_router.post("/account/key/renew", response_model=KeyResponse)
async def renew_account_key(user: UserDep, session: SessionDep) -> KeyResponse:
    """Replaces the key, e.g. after someone else saw it; the old one stops working."""
    return KeyResponse(key=await issue_key(session, user, renew=True))


@account_router.delete("/account", status_code=204)
async def delete_account(
    user: UserDep,
    session: SessionDep,
) -> Response:
    await session.delete(user)
    await session.commit()
    return Response(status_code=204)
