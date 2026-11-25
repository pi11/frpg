"""Refuses to start production with unsafe settings: python -m app.services.check_config."""

import sys
from urllib.parse import urlparse

from app.config import Settings, get_settings


def production_problems(settings: Settings) -> list[str]:
    problems: list[str] = []
    url = urlparse(settings.public_url)
    if url.scheme != "https" or not url.hostname or url.path not in ("", "/"):
        problems.append("PUBLIC_URL must be https://<domain> without a path")
    if len(settings.jwt_secret) < 32:
        problems.append("JWT_SECRET must have at least 32 characters (openssl rand -hex 32)")
    if settings.mail_backend not in ("resend", "disabled"):
        problems.append(
            "MAIL_BACKEND must be resend or disabled: console prints login codes to the log")
    elif settings.mail_backend == "resend" and not settings.mail_enabled:
        problems.append("RESEND_API_KEY and MAIL_FROM must be set, or MAIL_BACKEND=disabled")
    telegram = (settings.telegram_bot_token, settings.telegram_bot_username,
                settings.telegram_webhook_secret)
    if any(telegram) and not all(telegram):
        problems.append("set TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and "
                        "TELEGRAM_WEBHOOK_SECRET together, or leave all three empty")
    if "*" in settings.cors_origins:
        problems.append("CORS_ORIGINS must list exact origins")
    return problems


def main() -> int:
    problems = production_problems(get_settings())
    for problem in problems:
        print(f"config: {problem}", file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
