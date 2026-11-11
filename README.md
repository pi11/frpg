# Пустошь

Survivor-like про выжившего у убежища. Сейчас реализован **этап 0: каркас**. [Полный план](docs/PLAN.md).

## Требования

- Node.js 22.12+ и npm
- Python 3.12 и [uv](https://docs.astral.sh/uv/)
- PostgreSQL 16+ (локально, без Docker)

## Первый запуск

```bash
createdb wasteland
cp .env.example .env
make install
make migrate
make dev
```

Если PostgreSQL использует отдельного пользователя, измените `DATABASE_URL` в `.env`. URL должен начинаться с `postgresql+asyncpg://`. `make dev` запускает сервер на `http://localhost:8000` и клиент на `http://localhost:5173`. Для проверки сервера откройте `http://localhost:8000/api/v1/health`; пустая Phaser-сцена видна в браузере на порту 5173.

## Команды

| Команда | Назначение |
| --- | --- |
| `make install` | Установить зависимости клиента и сервера |
| `make dev` | Запустить оба dev-сервера |
| `make migrate` | Применить миграции Alembic |
| `make test` | Запустить проверки Python, тесты и проверки клиента |
| `make content-check` | Проверить JSON-файлы каталога контента |

На этом этапе каталог контента пуст. Полные схемы и проверка ссылок появляются на этапе 2. Android, вход и игровой цикл относятся к следующим этапам.

## Проверка вручную

1. Запустите `make dev` и убедитесь, что браузер показывает пустую игровую сцену «Пустошь».
2. Откройте `/api/v1/health`: при доступной БД ответ `{"status":"ok","database":"ok"}`. Если БД недоступна, сервер вернёт HTTP 503 в формате `{ "code": ..., "message": ... }`.
3. Выполните `make test` и `make content-check`.
