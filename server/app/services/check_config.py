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
    if settings.mail_backend != "resend":
        problems.append("MAIL_BACKEND must be resend: console prints login codes to the log")
    if not settings.resend_api_key or not settings.mail_from:
        problems.append("RESEND_API_KEY and MAIL_FROM must be set")
    if not (settings.telegram_bot_token and settings.telegram_bot_username
            and settings.telegram_webhook_secret):
        problems.append(
            "TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and TELEGRAM_WEBHOOK_SECRET must be set")
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
