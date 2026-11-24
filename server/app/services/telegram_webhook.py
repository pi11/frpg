"""Registers the production webhook: python -m app.services.telegram_webhook [set|info]."""

import asyncio
import sys

from aiogram import Bot

from app.config import Settings, get_settings

WEBHOOK_PATH = "/api/v1/telegram/webhook"


async def set_webhook(bot: Bot, settings: Settings) -> str:
    if not settings.public_url.startswith("https://") or not settings.telegram_webhook_secret:
        raise ValueError("Set an https:// PUBLIC_URL and TELEGRAM_WEBHOOK_SECRET")
    url = settings.public_url.rstrip("/") + WEBHOOK_PATH
    await bot.set_webhook(
        url, secret_token=settings.telegram_webhook_secret,
        allowed_updates=["message", "callback_query"],
    )
    return url


async def main(action: str) -> None:
    settings = get_settings()
    bot = Bot(settings.telegram_bot_token)
    try:
        if action == "set":
            print(f"webhook: {await set_webhook(bot, settings)}")
        elif action != "info":
            raise ValueError("Use: telegram_webhook [set|info]")
        info = await bot.get_webhook_info()
        print(f"url={info.url} pending={info.pending_update_count} "
              f"last_error={info.last_error_message}")
    finally:
        await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "info"))
