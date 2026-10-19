"""add voice profiles

Revision ID: 20ef599817bd
Revises: 3a7b91c5d402
Create Date: 2026-10-19 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20ef599817bd"
down_revision: Union[str, None] = "3a7b91c5d402"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "voice_profiles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("tts", sa.JSON(), nullable=False),
        sa.Column(
            "is_default",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id", "name", name="uq_voice_profiles_org_name"
        ),
    )
    op.create_index(op.f("ix_voice_profiles_id"), "voice_profiles", ["id"], unique=False)
    op.create_index(
        "ix_voice_profiles_org", "voice_profiles", ["organization_id"], unique=False
    )
    op.create_index(
        "uq_voice_profiles_default",
        "voice_profiles",
        ["organization_id"],
        unique=True,
        postgresql_where=sa.text("is_default = true"),
    )


def downgrade() -> None:
    op.drop_index("uq_voice_profiles_default", table_name="voice_profiles")
    op.drop_index("ix_voice_profiles_org", table_name="voice_profiles")
    op.drop_index(op.f("ix_voice_profiles_id"), table_name="voice_profiles")
    op.drop_table("voice_profiles")