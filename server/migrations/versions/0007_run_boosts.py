"""One-run emerald boosts taken into a run.

Revision ID: 0007_run_boosts
Revises: 0006_admin
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007_run_boosts"
down_revision: str | None = "0006_admin"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "runs",
        sa.Column(
            "boosts", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}",
        ),
    )


def downgrade() -> None:
    op.drop_column("runs", "boosts")
