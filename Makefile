.PHONY: install dev bot-poll migrate test content-check assets

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
	cd server && uv run --locked ruff check --no-respect-gitignore app tests migrations ../tools
	cd server && uv run --locked mypy app ../tools/assets
	cd server && uv run --locked pytest tests
	cd client && npm run lint && npm run test && npm run build

content-check:
	cd client && npm run content-check

# Rebuild original sprites, atlas, SFX and music into client/public/assets (needs ffmpeg).
assets:
	python3 tools/assets/build_assets.py
