"""Isolated HTTP and database fixtures for API tests.

By default every test gets an in-memory SQLite database built from the models.
With ``TEST_DATABASE_URL=postgresql+asyncpg://.../wasteland_test`` the suite instead
migrates that PostgreSQL database with Alembic (base -> head -> base -> head, then
``alembic check`` for model drift) and truncates all tables before each test.
The database is wiped, so never point it at real data.
"""

import os
import subprocess
import sys
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from app.config import get_settings
from app.db import get_session
from app.main import app
from app.models import Base
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


REPO_ROOT = Path(__file__).resolve().parents[2]
PG_URL = os.environ.get("TEST_DATABASE_URL")


def alembic(*args: str) -> None:
    assert PG_URL is not None
    subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "server/alembic.ini", *args],
        cwd=REPO_ROOT, env={**os.environ, "DATABASE_URL": PG_URL}, check=True,
    )


@pytest.fixture(scope="session")
def migrated_database() -> str | None:
    if PG_URL is None:
        return None
    alembic("downgrade", "base")
    alembic("upgrade", "head")
    alembic("downgrade", "base")
    alembic("upgrade", "head")
    alembic("check")
    return PG_URL


@pytest.fixture
async def api(
    monkeypatch: pytest.MonkeyPatch, migrated_database: str | None,
) -> AsyncIterator[dict[str, Any]]:
    monkeypatch.setenv("JWT_SECRET", "test-only-secret-with-at-least-thirty-two-characters")
    monkeypatch.setenv("TELEGRAM_BOT_USERNAME", "test_wasteland_bot")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmno")
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", "test-webhook-secret")
    monkeypatch.setenv("MAIL_BACKEND", "console")
    get_settings.cache_clear()

    if migrated_database is not None:
        engine = create_async_engine(
            migrated_database,
            connect_args={"statement_cache_size": 0, "prepared_statement_cache_size": 0},
        )
        tables = ", ".join(table.name for table in Base.metadata.sorted_tables)
        async with engine.begin() as connection:
            await connection.execute(text(f"TRUNCATE {tables} CASCADE"))
    else:
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
