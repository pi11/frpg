"""Game speed of a run, in percent: 100, 150 or 200.

Revision ID: 0005_run_speed
Revises: 0004_recovery_keys
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0005_run_speed"
down_revision: str | None = "0004_recovery_keys"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "runs", sa.Column("speed", sa.SmallInteger(), nullable=False, server_default="100"),
    )


def downgrade() -> None:
    op.drop_column("runs", "speed")
