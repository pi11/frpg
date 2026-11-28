"""Changelog versions posted to the Telegram channel.

Revision ID: 0009_changelog_posts
Revises: 0008_run_mode
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0009_changelog_posts"
down_revision: str | None = "0008_run_mode"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "changelog_posts",
        sa.Column("version", sa.String(length=32), primary_key=True),
        sa.Column("message_id", sa.BigInteger(), nullable=True),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("changelog_posts")
