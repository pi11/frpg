#!/usr/bin/env bash
# Daily dump: local copy plus a copy on another host. Settings: /etc/wasteland/backup.env.
#   BACKUP_DATABASE_URL  direct PostgreSQL URL (not PgBouncer)
#   BACKUP_REMOTE        rsync target, e.g. backup@other-host:wasteland
#   BACKUP_KEEP_DAYS     how long to keep copies (default 14, must match the privacy policy)
set -euo pipefail
umask 077

: "${BACKUP_DATABASE_URL:?set BACKUP_DATABASE_URL}"
: "${BACKUP_REMOTE:?set BACKUP_REMOTE: backups must also live on another host}"
keep_days=${BACKUP_KEEP_DAYS:-14}
dir=${STATE_DIRECTORY:-/var/lib/wasteland-backups}
file="$dir/wasteland-$(date -u +%Y%m%dT%H%M%SZ).dump"

trap 'rm -f "$file.part"' EXIT
pg_dump --format=custom --no-owner --file="$file.part" "$BACKUP_DATABASE_URL"
pg_restore --list "$file.part" >/dev/null
mv "$file.part" "$file"

# Old copies go first, then --delete mirrors exactly this set to the other host.
find "$dir" -maxdepth 1 -name 'wasteland-*.dump' -mtime "+$((keep_days - 1))" -delete
rsync -a --delete --include='wasteland-*.dump' --exclude='*' "$dir/" "$BACKUP_REMOTE/"
echo "backup: $file ($(stat -c %s "$file") bytes)"
