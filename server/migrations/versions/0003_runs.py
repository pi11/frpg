"""Run records with reward, replay idempotency and integrity flags.

Revision ID: 0003_runs
Revises: 0002_accounts
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_runs"
down_revision: str | None = "0002_accounts"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("location_id", sa.String(length=80), nullable=False),
        sa.Column("hero_id", sa.String(length=80), nullable=False),
        sa.Column("seed", sa.BigInteger(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("summary", postgresql.JSONB()),
        sa.Column("reward_caps", sa.Integer()),
        sa.Column("flags", postgresql.ARRAY(sa.String()), nullable=False),
    )
    op.create_index("ix_runs_user_started", "runs", ["user_id", "started_at"])
    op.create_index(
        "ix_runs_started_status", "runs", ["status"],
        postgresql_where=sa.text("status = 'started'"),
    )


def downgrade() -> None:
    op.drop_index("ix_runs_started_status", table_name="runs")
    op.drop_index("ix_runs_user_started", table_name="runs")
    op.drop_table("runs")
