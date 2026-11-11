"""aiogram handlers for the explicit Telegram login confirmation."""

from aiogram import Bot, Dispatcher, F, Router
from aiogram.filters import CommandObject, CommandStart
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message
from sqlalchemy import select

from app.db import SessionFactory
from app.models.auth import TelegramLoginRequest
from app.services.tokens import as_utc, digest, utcnow

router = Router()
dispatcher = Dispatcher()
dispatcher.include_router(router)


async def valid_nonce(nonce: str) -> bool:
    async with SessionFactory() as session:
        challenge = await session.scalar(
            select(TelegramLoginRequest).where(TelegramLoginRequest.nonce_hash == digest(nonce))
        )
        return bool(
            challenge and challenge.status == "pending"
            and as_utc(challenge.expires_at) > utcnow()
        )


async def confirm_nonce(nonce: str, telegram_user_id: int) -> bool:
    async with SessionFactory() as session:
        challenge = await session.scalar(
            select(TelegramLoginRequest)
            .where(TelegramLoginRequest.nonce_hash == digest(nonce))
            .with_for_update()
        )
        if (
            not challenge or challenge.status != "pending"
            or as_utc(challenge.expires_at) <= utcnow()
        ):
            return False
        challenge.telegram_user_id = telegram_user_id
        challenge.status = "confirmed"
        await session.commit()
        return True


@router.message(CommandStart())
async def bot_start(message: Message, command: CommandObject) -> None:
    nonce = command.args or ""
    if not nonce or not await valid_nonce(nonce):
        await message.answer("Ссылка для входа недействительна. Начните вход из игры заново.")
        return
    keyboard = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="Войти в Пустошь", callback_data=f"login:{nonce}")
    ]])
    await message.answer("Нажмите кнопку, чтобы подтвердить вход в игру.", reply_markup=keyboard)


@router.callback_query(F.data.startswith("login:"))
async def bot_confirm(callback: CallbackQuery) -> None:
    nonce = (callback.data or "").removeprefix("login:")
    if await confirm_nonce(nonce, callback.from_user.id):
        await callback.answer("Вход подтверждён. Вернитесь в игру.", show_alert=True)
    else:
        await callback.answer("Запрос истёк. Начните вход из игры заново.", show_alert=True)


async def feed_webhook(bot: Bot, payload: dict[str, object]) -> None:
    await dispatcher.feed_raw_update(bot, payload)
