"""Telegram deep-link login and webhook."""

import hmac
import secrets
import uuid
from datetime import timedelta
from typing import Annotated, Literal

from aiogram import Bot
from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import AUTH_ERRORS, resolve_identity
from app.api.errors import ApiError, ErrorCode
from app.config import get_settings
from app.db import get_session
from app.models.auth import TelegramLoginRequest, User
from app.services.telegram import feed_webhook
from app.services.tokens import (
    TokenPair,
    as_utc,
    digest,
    issue_pair,
    optional_user,
    utcnow,
)

router = APIRouter(tags=["telegram"], responses=AUTH_ERRORS)
SessionDep = Annotated[AsyncSession, Depends(get_session)]
OptionalUserDep = Annotated[User | None, Depends(optional_user)]


class TelegramStartResponse(BaseModel):
    request_id: uuid.UUID
    poll_secret: str
    deep_link: str


class TelegramPollResponse(BaseModel):
    status: Literal["pending", "confirmed", "expired"]
    tokens: TokenPair | None = None


@router.post("/auth/telegram/start", response_model=TelegramStartResponse)
async def telegram_start(
    request: Request,
    user: OptionalUserDep,
    session: SessionDep,
) -> TelegramStartResponse:
    username = get_settings().telegram_bot_username.removeprefix("@")
    if not username:
        raise ApiError(503, ErrorCode.not_configured, "Telegram-бот не настроен")
    ip = request.client.host if request.client else "unknown"
    count = await session.scalar(
        select(func.count(TelegramLoginRequest.id)).where(
            TelegramLoginRequest.request_ip == ip,
            TelegramLoginRequest.created_at >= utcnow() - timedelta(minutes=1),
        )
    )
    if (count or 0) >= 10:
        raise ApiError(429, ErrorCode.rate_limited, "Слишком много запросов")
    nonce = secrets.token_urlsafe(24)
    poll_secret = secrets.token_urlsafe(32)
    challenge = TelegramLoginRequest(
        id=uuid.uuid4(), nonce_hash=digest(nonce), poll_secret_hash=digest(poll_secret),
        user_id=user.id if user else None, request_ip=ip, status="pending",
        expires_at=utcnow() + timedelta(minutes=5),
    )
    session.add(challenge)
    await session.commit()
    return TelegramStartResponse(
        request_id=challenge.id, poll_secret=poll_secret,
        deep_link=f"https://t.me/{username}?start={nonce}",
    )


@router.get("/auth/telegram/poll/{request_id}", response_model=TelegramPollResponse)
async def telegram_poll(
    request_id: uuid.UUID,
    request: Request,
    poll_secret: Annotated[str, Header(alias="X-Poll-Secret")],
    session: SessionDep,
) -> TelegramPollResponse:
    challenge = await session.scalar(
        select(TelegramLoginRequest)
        .where(TelegramLoginRequest.id == request_id).with_for_update()
    )
    if not challenge or not hmac.compare_digest(challenge.poll_secret_hash, digest(poll_secret)):
        raise ApiError(401, ErrorCode.invalid_token, "Недействительный запрос входа")
    now = utcnow()
    if challenge.status in ("expired", "consumed") or as_utc(challenge.expires_at) <= now:
        challenge.status = "expired" if challenge.status != "consumed" else "consumed"
        await session.commit()
        return TelegramPollResponse(status="expired")
    if challenge.last_polled_at and as_utc(challenge.last_polled_at) > now - timedelta(seconds=1):
        raise ApiError(429, ErrorCode.rate_limited, "Подождите перед повторным опросом")
    challenge.last_polled_at = now
    if challenge.status == "pending":
        await session.commit()
        return TelegramPollResponse(status="pending")
    if challenge.telegram_user_id is None:
        raise ApiError(401, ErrorCode.invalid_token, "Вход не подтверждён")
    user = await resolve_identity(
        session, "telegram", str(challenge.telegram_user_id), challenge.user_id
    )
    pair = await issue_pair(session, user, request.headers.get("user-agent"))
    challenge.status = "consumed"
    await session.commit()
    return TelegramPollResponse(status="confirmed", tokens=pair)


@router.post("/telegram/webhook", status_code=200)
async def telegram_webhook(
    request: Request,
    secret_header: Annotated[str, Header(alias="X-Telegram-Bot-Api-Secret-Token")],
) -> dict[str, str]:
    settings = get_settings()
    if not settings.telegram_bot_token or not settings.telegram_webhook_secret:
        raise ApiError(503, ErrorCode.not_configured, "Telegram-бот не настроен")
    if not hmac.compare_digest(secret_header, settings.telegram_webhook_secret):
        raise ApiError(403, ErrorCode.invalid_token, "Недействительный секрет вебхука")
    bot = Bot(settings.telegram_bot_token)
    try:
        payload = await request.json()
        await feed_webhook(bot, payload)
    finally:
        await bot.session.close()
    return {"status": "ok"}
