import asyncio
from collections.abc import AsyncIterator, Iterator
from typing import cast

import httpx
import pytest
from app.db import get_session
from app.main import app
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession


class HealthySession:
    async def execute(self, _statement: object) -> None:
        return None


class BrokenSession:
    async def execute(self, _statement: object) -> None:
        raise OperationalError("SELECT 1", {}, Exception("connection failed"))


async def get_health() -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        return await client.get("/api/v1/health")


@pytest.fixture(autouse=True)
def clear_overrides() -> Iterator[None]:
    yield
    app.dependency_overrides.clear()


def test_health_with_database() -> None:
    async def session() -> AsyncIterator[AsyncSession]:
        yield cast(AsyncSession, HealthySession())

    app.dependency_overrides[get_session] = session
    response = asyncio.run(get_health())
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


def test_health_without_database() -> None:
    async def session() -> AsyncIterator[AsyncSession]:
        yield cast(AsyncSession, BrokenSession())

    app.dependency_overrides[get_session] = session
    response = asyncio.run(get_health())
    assert response.status_code == 503
    assert response.json() == {
        "code": "database_unavailable",
        "message": "База данных недоступна",
    }
