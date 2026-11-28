"""Changelog versions already posted to the Telegram channel."""

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.auth import utcnow
from app.models.base import Base


class ChangelogPost(Base):
    __tablename__ = "changelog_posts"

    version: Mapped[str] = mapped_column(String(32), primary_key=True)
    #: None for older versions marked as posted without a message (the first run posts only
    #: the newest one, not the whole history).
    message_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    posted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
