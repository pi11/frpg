"""Account keys: sign in on another device without email or Telegram.

Revision ID: 0004_recovery_keys
Revises: 0003_runs
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0004_recovery_keys"
down_revision: str | None = "0003_runs"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "recovery_keys",
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("key_hash", sa.String(length=64), nullable=False, unique=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("recovery_keys")
