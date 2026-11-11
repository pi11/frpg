"""Resend request contract with an in-process HTTP transport."""

import uuid

import httpx
import pytest
from app.config import get_settings
from app.services.mail import send_login_email


@pytest.mark.anyio
async def test_resend_payload_and_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MAIL_BACKEND", "resend")
    monkeypatch.setenv("RESEND_API_KEY", "test-resend-key")
    monkeypatch.setenv("MAIL_FROM", "login@example.com")
    get_settings.cache_clear()
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(429 if len(seen) == 1 else 200, json={"id": "sent"})

    original_client = httpx.AsyncClient

    def fake_client(*args: object, **kwargs: object) -> httpx.AsyncClient:
        return original_client(*args, transport=httpx.MockTransport(handle), **kwargs)

    monkeypatch.setattr("app.services.mail.httpx.AsyncClient", fake_client)
    monkeypatch.setattr("app.services.mail.asyncio.sleep", lambda _seconds: no_wait())
    challenge_id = uuid.uuid4()
    await send_login_email(
        "player@example.com", "https://example.com/login?token=abc", "123456", challenge_id
    )
    assert len(seen) == 2
    assert all(request.url == "https://api.resend.com/emails" for request in seen)
    assert all(request.headers["Idempotency-Key"] == str(challenge_id) for request in seen)
    assert all(request.headers["Authorization"] == "Bearer test-resend-key" for request in seen)
    assert "123456" in seen[0].content.decode()
    get_settings.cache_clear()


async def no_wait() -> None:
    pass
