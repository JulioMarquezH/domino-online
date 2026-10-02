#!/usr/bin/env bash
# Proves a backup is usable: restores it into a SCRATCH database (never the live one), runs
# integrity_check and compares row counts with the live database.
#
#   deploy/verify-backup.sh                  newest local backup
#   deploy/verify-backup.sh FILE.db.gz       a specific local file
#   deploy/verify-backup.sh --drive          downloads the newest backup from Google Drive first
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/domino}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
CONTAINER="${CONTAINER:-domino}"
REMOTE_NAME="${RCLONE_REMOTE_NAME:-domino-gdrive}"
REMOTE_DIR="${RCLONE_REMOTE_DIR:-domino-online-backups}"

scratch="$BACKUP_DIR/.verify-$$"
mkdir -p "$scratch"
trap 'rm -rf "$scratch"' EXIT

if [ "${1:-}" = "--drive" ]; then
  newest="$(rclone lsjson "$REMOTE_NAME:$REMOTE_DIR" --files-only | python3 -c '
import json, sys
items = json.load(sys.stdin)
print(max(items, key=lambda i: i["ModTime"])["Name"])')"
  echo "Descargando de Drive: $newest"
  rclone copy "$REMOTE_NAME:$REMOTE_DIR/$newest" "$scratch"
  src="$scratch/$newest"
elif [ -n "${1:-}" ]; then
  src="$1"
else
  src="$(ls -1t "$BACKUP_DIR"/domino-*.db.gz | head -1)"
fi

echo "Verificando: $src"
gunzip -c "$src" > "$scratch/restored.db"
chmod 644 "$scratch/restored.db"
# The scratch copy is inside /backups of the container: opened read-only, never touching /data.
docker exec "$CONTAINER" node server/dist/admin.js verify-backup \
  "/backups/.verify-$$/restored.db" --against /data/domino.db
