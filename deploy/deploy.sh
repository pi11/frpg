#!/usr/bin/env bash
# Update the server from git. Run as root: /srv/wasteland/app/deploy/deploy.sh [git-ref]
set -euo pipefail

# A function is read whole, so `git checkout` may replace this file while it runs.
main() {
ref=${1:-origin/master}
app=/srv/wasteland/app
web=/srv/wasteland/web
env_file=/etc/wasteland/wasteland.env
deploy_env=/etc/wasteland/deploy.env

as_app() { sudo -u wasteland -H "$@"; }

# shellcheck source=/dev/null
set -a; . "$deploy_env"; set +a
: "${MIGRATION_DATABASE_URL:?set it in $deploy_env (direct PostgreSQL, not PgBouncer)}"
: "${VITE_CONTACT_EMAIL:?set it in $deploy_env}"
: "${VITE_OPERATOR:?set it in $deploy_env}"
export VITE_BACKUP_DAYS=${VITE_BACKUP_DAYS:-14}

cd "$app"
as_app git fetch --prune origin
as_app git checkout --detach "$ref"

as_app /usr/local/bin/uv sync --project server --locked --no-dev
(cd client
 as_app npm ci
 as_app env VITE_API_URL= VITE_CONTACT_EMAIL="$VITE_CONTACT_EMAIL" \
   VITE_OPERATOR="$VITE_OPERATOR" VITE_BACKUP_DAYS="$VITE_BACKUP_DAYS" npm run build)

systemd-run --quiet --wait --pipe --collect --uid=wasteland \
  --property=EnvironmentFile="$env_file" --property=WorkingDirectory="$app/server" \
  "$app/server/.venv/bin/python" -m app.services.check_config
as_app env DATABASE_URL="$MIGRATION_DATABASE_URL" \
  server/.venv/bin/alembic -c server/alembic.ini upgrade head

systemctl restart wasteland-api
healthy=
for _ in $(seq 30); do
  if curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8010/api/v1/health; then
    healthy=yes; break
  fi
  sleep 1
done 2>/dev/null
[ -n "$healthy" ] || { journalctl -u wasteland-api -n 30 --no-pager; exit 1; }

# New files first, index.html last; old hashed files stay for open tabs and go after 30 days.
rsync -a --exclude='*.html' client/dist/ "$web/"
rsync -a --include='*.html' --exclude='*' client/dist/ "$web/"
find "$web/assets" -maxdepth 1 -type f -mtime +30 -print0 | while IFS= read -r -d '' file; do
  [ -e "client/dist/assets/${file##*/}" ] || rm -f -- "$file"
done
echo; echo "deployed $(as_app git rev-parse --short HEAD)"
}

main "$@"; exit
