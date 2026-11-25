#!/usr/bin/env bash
# Update the server from git. Run as root: <repository>/deploy/deploy.sh [git-ref]
# The repository may live anywhere; web/, node/ and python/ are its neighbours.
set -euo pipefail

# A function is read whole, so `git checkout` may replace this file while it runs.
main() {
app=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
base=$(dirname "$app")
owner=$(stat -c %U "$app")
ref=${1:-origin/master}
web=$base/web
env_file=/etc/wasteland/wasteland.env
deploy_env=/etc/wasteland/deploy.env

# Own Node.js next to the app, if it is there: the system one belongs to other sites.
node_bin=$base/node/bin
# Git, npm and uv run as the owner of the repository. Python is kept outside of home directories,
# which the service cannot see (ProtectHome).
as_app() {
  sudo -u "$owner" -H env PATH="$node_bin:$PATH" UV_PYTHON_INSTALL_DIR="$base/python" \
    UV_PYTHON_PREFERENCE=only-managed "$@"
}

# shellcheck source=/dev/null
set -a; . "$deploy_env"; set +a
: "${MIGRATION_DATABASE_URL:?set it in $deploy_env (direct PostgreSQL, not PgBouncer)}"
: "${VITE_CONTACT_EMAIL:?set it in $deploy_env}"
: "${VITE_OPERATOR:?set it in $deploy_env}"
port=$(sed -n 's/^API_PORT=//p' "$env_file")
port=${port:-8010}
export VITE_BACKUP_DAYS=${VITE_BACKUP_DAYS:-14}

cd "$app"
[ -d .git ] || { echo "$app is not a git clone" >&2; exit 1; }
# The API runs as another user: it must be able to read the code.
sudo -u wasteland test -r "$app/server/app/main.py" \
  || { echo "user wasteland cannot read $app (see docs/DEPLOY.md)" >&2; exit 1; }
install -d -o "$owner" "$web" "$base/python"
as_app git fetch --prune origin
as_app git checkout --detach "$ref"

as_app /usr/local/bin/uv sync --project server --locked --no-dev --python 3.12
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
  if curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:$port/api/v1/health"; then
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
