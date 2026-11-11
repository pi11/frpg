"""Isolated HTTP and database fixtures for API tests."""

from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from app.config import get_settings
from app.db import get_session
from app.main import app
from app.models import Base
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
async def api(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[dict[str, Any]]:
    monkeypatch.setenv("JWT_SECRET", "test-only-secret-with-at-least-thirty-two-characters")
    monkeypatch.setenv("TELEGRAM_BOT_USERNAME", "test_wasteland_bot")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmno")
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", "test-webhook-secret")
    monkeypatch.setenv("MAIL_BACKEND", "console")
    get_settings.cache_clear()

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def enable_foreign_keys(connection: Any, _record: Any) -> None:
        connection.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def override_session() -> AsyncIterator[AsyncSession]:
        async with factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    sent: list[tuple[str, str, str]] = []

    async def fake_mail(email: str, link: str, code: str, _id: object) -> None:
        sent.append((email, link, code))

    monkeypatch.setattr("app.api.auth.send_login_email", fake_mail)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield {"client": client, "factory": factory, "sent": sent}

    app.dependency_overrides.clear()
    get_settings.cache_clear()
    await engine.dispose()
