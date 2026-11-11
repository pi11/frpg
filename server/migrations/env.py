"""Async Alembic environment."""

import asyncio
from logging.config import fileConfig

from alembic import context
from app.config import get_settings
from app.models.base import Base
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", get_settings().database_url)
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=get_settings().database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        connect_args={"statement_cache_size": 0, "prepared_statement_cache_size": 0},
    )

    async def migrate() -> None:
        async with connectable.connect() as connection:
            await connection.run_sync(
                lambda sync_connection: context.configure(
                    connection=sync_connection, target_metadata=target_metadata
                )
            )
            await connection.run_sync(lambda _: context.run_migrations())
        await connectable.dispose()

    asyncio.run(migrate())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
