#!/usr/bin/env bash
set -euo pipefail

uv run --project server --locked uvicorn app.main:app --app-dir server --reload --host 127.0.0.1 --port 8000 &
server_pid=$!
(
  cd client
  npm run dev -- --host 127.0.0.1
) &
client_pid=$!
trap 'kill "$server_pid" "$client_pid" 2>/dev/null || true' EXIT INT TERM
wait -n "$server_pid" "$client_pid"
