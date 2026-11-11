"""Magic-link delivery through console logs or Resend."""

import asyncio
import logging
import uuid
from pathlib import Path

import httpx
from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.config import get_settings

logger = logging.getLogger(__name__)
templates = Environment(
    loader=FileSystemLoader(Path(__file__).resolve().parents[1] / "templates"),
    autoescape=select_autoescape(["html"]),
)


async def send_login_email(email: str, link: str, code: str, challenge_id: uuid.UUID) -> None:
    settings = get_settings()
    if settings.mail_backend == "console":
        logger.warning("DEV login for %s: %s | code %s", email, link, code)
        return
    if settings.mail_backend != "resend" or not settings.resend_api_key or not settings.mail_from:
        logger.error("Mail backend is not configured")
        return

    html = templates.get_template("login.html.j2").render(link=link, code=code)
    plain = templates.get_template("login.txt.j2").render(link=link, code=code)
    payload = {
        "from": settings.mail_from,
        "to": [email],
        "subject": "Вход в Пустошь",
        "html": html,
        "text": plain,
    }
    headers = {
        "Authorization": f"Bearer {settings.resend_api_key}",
        "Idempotency-Key": str(challenge_id),
    }
    async with httpx.AsyncClient(timeout=10) as client:
        for attempt in range(3):
            try:
                response = await client.post(
                    "https://api.resend.com/emails", json=payload, headers=headers
                )
                if response.status_code < 400:
                    return
                if response.status_code != 429 and response.status_code < 500:
                    logger.error("Resend rejected login email: HTTP %s", response.status_code)
                    return
                logger.warning("Resend temporary error: HTTP %s", response.status_code)
            except httpx.HTTPError:
                logger.exception("Resend request failed")
            if attempt < 2:
                await asyncio.sleep(2**attempt)
    logger.error("Could not send login email after retries")
