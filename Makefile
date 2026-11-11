.PHONY: install dev bot-poll migrate test content-check

install:
	cd client && npm ci
	uv sync --project server --group dev --locked

dev:
	bash scripts/dev.sh

bot-poll:
	cd server && uv run --locked python -m app.services.telegram_polling

migrate:
	uv run --project server --locked alembic -c server/alembic.ini upgrade head

test:
	cd server && uv run --locked ruff check --no-respect-gitignore app tests migrations
	cd server && uv run --locked mypy app
	cd server && uv run --locked pytest tests
	cd client && npm run lint && npm run test && npm run build

content-check:
	cd client && npm run content-check
