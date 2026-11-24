"""Scheduled clean-up (systemd timer): python -m app.services.cleanup."""

import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, cast

from sqlalchemy import CursorResult, Delete, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionFactory, engine
from app.models.auth import LoginToken, RefreshToken, TelegramLoginRequest, User
from app.services.tokens import utcnow

GUEST_INACTIVITY = timedelta(days=90)
CHALLENGE_RETENTION = timedelta(days=1)


@dataclass(frozen=True)
class CleanupResult:
    guests: int
    login_tokens: int
    telegram_requests: int
    refresh_tokens: int


async def execute(session: AsyncSession, statement: Delete) -> int:
    result = cast(CursorResult[Any], await session.execute(statement))
    return result.rowcount


async def cleanup(session: AsyncSession, now: datetime) -> CleanupResult:
    """Deletes inactive guests (their data cascades) and stale one-time login data."""
    challenge_limit = now - CHALLENGE_RETENTION
    no_sync = {"synchronize_session": False}
    result = CleanupResult(
        login_tokens=await execute(session, delete(LoginToken).where(
            LoginToken.expires_at < challenge_limit).execution_options(**no_sync)),
        telegram_requests=await execute(session, delete(TelegramLoginRequest).where(
            TelegramLoginRequest.expires_at < challenge_limit).execution_options(**no_sync)),
        # Expired refresh tokens can no longer be used, so reuse detection does not need them.
        refresh_tokens=await execute(session, delete(RefreshToken).where(
            RefreshToken.expires_at < challenge_limit).execution_options(**no_sync)),
        guests=await execute(session, delete(User).where(
            User.is_guest.is_(True), User.last_seen_at < now - GUEST_INACTIVITY,
        ).execution_options(**no_sync)),
    )
    await session.commit()
    return result


async def main() -> None:
    try:
        async with SessionFactory() as session:
            print(await cleanup(session, utcnow()))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
