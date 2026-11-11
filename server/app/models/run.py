"""Server-authoritative run records."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ARRAY, JSON, BigInteger, DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.auth import utcnow
from app.models.base import Base


class Run(Base):
    __tablename__ = "runs"
    __table_args__ = (
        Index("ix_runs_user_started", "user_id", "started_at"),
        Index("ix_runs_started_status", "status", postgresql_where=text("status = 'started'")),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    location_id: Mapped[str] = mapped_column(String(80))
    hero_id: Mapped[str] = mapped_column(String(80))
    seed: Mapped[int] = mapped_column(BigInteger)
    content_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), default="started")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    summary: Mapped[dict[str, Any] | None] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"), nullable=True
    )
    reward_caps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    flags: Mapped[list[str]] = mapped_column(
        JSON().with_variant(ARRAY(String), "postgresql"), default=list
    )
