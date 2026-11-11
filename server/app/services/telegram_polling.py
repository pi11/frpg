"""Development polling runner: python -m app.services.telegram_polling."""

import asyncio

from aiogram import Bot

from app.config import get_settings
from app.services.telegram import dispatcher


async def main() -> None:
    token = get_settings().telegram_bot_token
    if not token:
        raise RuntimeError("Set TELEGRAM_BOT_TOKEN in .env")
    bot = Bot(token)
    await bot.delete_webhook(drop_pending_updates=False)
    await dispatcher.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
