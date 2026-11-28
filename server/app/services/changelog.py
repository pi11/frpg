"""Post new «Что нового» versions to the Telegram channel.

    python -m app.services.changelog post         # new versions; deploy.sh runs this
    python -m app.services.changelog post --all   # also the history the first run skips
    python -m app.services.changelog preview [version]

The releases come from changelog.json at the repository root (the same file the client's
/changelog page shows). Posted versions are kept in changelog_posts, so every version goes out
once. On the very first run only the newest version is posted and older ones are marked as done,
so a new channel does not get the whole history at once.
"""

import argparse
import asyncio
import html
import json
import sys
from collections.abc import Awaitable, Callable, Sequence
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.changelog import ChangelogPost

CHANGELOG_PATH = Path(__file__).resolve().parents[3] / "changelog.json"
GAME_NAME = "Пустошь"
#: A change that starts with a short label, such as «Ядовитые топи: …», gets it in bold.
LABEL_LIMIT = 32

Release = dict[str, Any]
Send = Callable[[str], Awaitable[int]]


def load_releases(path: Path = CHANGELOG_PATH) -> list[Release]:
    return list(json.loads(path.read_text(encoding="utf-8")))


def version_key(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in version.split("."))


def emphasize(change: str) -> str:
    text = html.escape(change, quote=False)
    label, colon, rest = text.partition(": ")
    if colon and 0 < len(label) <= LABEL_LIMIT and "«" not in label:
        return f"<b>{label}</b>: {rest}"
    return text


def format_release(release: Release, public_url: str) -> str:
    """Telegram HTML: a headline, the date, one line per change and links to the game."""
    url = public_url.rstrip("/")
    lines = [
        f"📻 <b>{GAME_NAME} {html.escape(release['version'])} · "
        f"{html.escape(release['title'])}</b>",
        f"<i>{html.escape(release['date'])}</i>",
        "",
        *(f"▸ {emphasize(change)}" for change in release["changes"]),
        "",
        f'<a href="{html.escape(url)}/changelog">Все изменения</a> · '
        f'<a href="{html.escape(url)}">Играть</a>',
    ]
    return "\n".join(lines)


async def post_new(
    session: AsyncSession, releases: Sequence[Release], send: Send, public_url: str,
    everything: bool = False,
) -> list[str]:
    """Sends versions not posted yet, oldest first, and returns them.

    Each version is saved right after its message, so a failure halfway does not repeat the
    ones already sent.
    """
    posted = set((await session.scalars(select(ChangelogPost.version))).all())
    fresh = sorted(
        (release for release in releases if release["version"] not in posted),
        key=lambda release: version_key(release["version"]),
    )
    if not posted and not everything and len(fresh) > 1:
        for release in fresh[:-1]:
            session.add(ChangelogPost(version=release["version"], message_id=None))
        await session.commit()
        fresh = fresh[-1:]
    sent: list[str] = []
    for release in fresh:
        message_id = await send(format_release(release, public_url))
        session.add(ChangelogPost(version=release["version"], message_id=message_id))
        await session.commit()
        sent.append(release["version"])
    return sent


async def telegram_post(everything: bool) -> int:
    settings = get_settings()
    if not settings.telegram_bot_token or not settings.telegram_channel_id:
        print("changelog: TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID is empty, nothing posted")
        return 0
    from aiogram import Bot
    from aiogram.enums import ParseMode
    from aiogram.types import LinkPreviewOptions

    from app.db import SessionFactory

    bot = Bot(settings.telegram_bot_token)

    async def send(text: str) -> int:
        message = await bot.send_message(
            chat_id=settings.telegram_channel_id, text=text, parse_mode=ParseMode.HTML,
            link_preview_options=LinkPreviewOptions(is_disabled=True),
        )
        return message.message_id

    try:
        async with SessionFactory() as session:
            sent = await post_new(
                session, load_releases(), send, settings.public_url, everything=everything,
            )
    finally:
        await bot.session.close()
    print(f"changelog: posted {', '.join(sent)}" if sent else "changelog: nothing new")
    return 0


def main(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.services.changelog")
    commands = parser.add_subparsers(dest="command", required=True)
    post = commands.add_parser("post", help="post versions the channel has not seen")
    post.add_argument("--all", action="store_true", help="also the history skipped at first")
    preview = commands.add_parser("preview", help="print a message without sending it")
    preview.add_argument("version", nargs="?")
    args = parser.parse_args(argv)
    if args.command == "preview":
        releases = load_releases()
        release = next(
            (item for item in releases if item["version"] == args.version), releases[0],
        )
        print(format_release(release, get_settings().public_url))
        return 0
    return asyncio.run(telegram_post(args.all))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
