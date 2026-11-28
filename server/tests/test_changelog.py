"""Changelog posts to the Telegram channel: formatting and posting every version once."""

import pytest
from app.models.changelog import ChangelogPost
from app.services.changelog import emphasize, format_release, load_releases, post_new, version_key
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

RELEASES = [
    {"version": "0.0.2", "date": "02.01.2026", "title": "Второй", "changes": ["Б"]},
    {"version": "0.0.10", "date": "03.01.2026", "title": "Третий", "changes": ["В"]},
    {"version": "0.0.1", "date": "01.01.2026", "title": "Первый", "changes": ["А"]},
]


class FakeChannel:
    """Stands in for Telegram: keeps the texts and hands out message ids."""

    def __init__(self) -> None:
        self.texts: list[str] = []

    async def send(self, text: str) -> int:
        self.texts.append(text)
        return 100 + len(self.texts)


def test_release_text_is_escaped_html_with_labels_and_links() -> None:
    text = format_release({
        "version": "1.2.3", "date": "28.11.2026", "title": "Туман <и> турели",
        "changes": ["Ядовитые топи: туман жжёт", "Цена: 5 < 7 & «Лафет»: слот", "Без метки"],
    }, "https://game.example/")
    assert text.startswith("📻 <b>Пустошь 1.2.3 · Туман &lt;и&gt; турели</b>\n<i>28.11.2026</i>")
    assert "▸ <b>Ядовитые топи</b>: туман жжёт" in text
    assert "▸ <b>Цена</b>: 5 &lt; 7 &amp; «Лафет»: слот" in text
    assert "▸ Без метки" in text
    assert text.endswith('<a href="https://game.example/changelog">Все изменения</a> · '
                         '<a href="https://game.example">Играть</a>')
    assert emphasize("Очень длинное начало фразы, которое не метка: текст") \
        == "Очень длинное начало фразы, которое не метка: текст"


def test_real_changelog_is_valid_and_newest_first() -> None:
    releases = load_releases()
    versions = [version_key(release["version"]) for release in releases]
    assert versions == sorted(versions, reverse=True)
    assert all(release["changes"] and release["title"] for release in releases)


@pytest.mark.anyio
async def test_first_run_posts_only_the_newest_then_each_new_version_once(
    api: dict[str, object],
) -> None:
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    channel = FakeChannel()
    async with factory() as session:
        assert await post_new(session, RELEASES, channel.send, "https://g") == ["0.0.10"]
        assert await post_new(session, RELEASES, channel.send, "https://g") == []
        newer = [{"version": "0.1.0", "date": "04.01.2026", "title": "Новый", "changes": ["Г"]}]
        assert await post_new(session, newer + RELEASES, channel.send, "https://g") == ["0.1.0"]
        rows = {row.version: row.message_id for row in await session.scalars(select(ChangelogPost))}
    assert rows == {"0.0.1": None, "0.0.2": None, "0.0.10": 101, "0.1.0": 102}
    assert len(channel.texts) == 2 and "Пустошь 0.1.0 · Новый" in channel.texts[1]


@pytest.mark.anyio
async def test_all_posts_the_history_oldest_first_and_a_failure_keeps_what_was_sent(
    api: dict[str, object],
) -> None:
    factory: async_sessionmaker[AsyncSession] = api["factory"]  # type: ignore[assignment]
    texts: list[str] = []

    async def flaky(text: str) -> int:
        if len(texts) == 2:
            raise RuntimeError("telegram is down")
        texts.append(text)
        return len(texts)

    async with factory() as session:
        with pytest.raises(RuntimeError):
            await post_new(session, RELEASES, flaky, "https://g", everything=True)
        assert ["Пустошь 0.0.1" in texts[0], "Пустошь 0.0.2" in texts[1]] == [True, True]
        channel = FakeChannel()
        assert await post_new(session, RELEASES, channel.send, "https://g") == ["0.0.10"]
