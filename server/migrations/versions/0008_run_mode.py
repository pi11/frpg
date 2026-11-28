"""Run mode: a full run or a short contract.

Revision ID: 0008_run_mode
Revises: 0007_run_boosts
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0008_run_mode"
down_revision: str | None = "0007_run_boosts"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # Old rows become full runs through the server default.
    op.add_column(
        "runs",
        sa.Column("mode", sa.String(length=16), nullable=False, server_default="standard"),
    )
    op.add_column("runs", sa.Column("contract_id", sa.String(length=80), nullable=True))


def downgrade() -> None:
    op.drop_column("runs", "contract_id")
    op.drop_column("runs", "mode")
