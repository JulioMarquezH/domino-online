#!/usr/bin/env bash
# Daily backup of the Domino tournament database (SQLite).
#
#   1. a CONSISTENT snapshot made by SQLite itself (VACUUM INTO, never a raw copy of a live file),
#      checked with integrity_check, written to /opt/domino/backups/
#   2. compressed, with 7 days of local retention
#   3. copied off the server to Google Drive (personal account) with rclone
#
# Cron: /etc/cron.d/domino-backup. Log: /var/log/domino-backup.log. Same style as Manhattan's.
# Exit codes: 0 ok · 1 snapshot failed · 3 snapshot ok but the Drive copy failed.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/domino}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
LOG="${LOG:-/var/log/domino-backup.log}"
CONTAINER="${CONTAINER:-domino}"
KEEP_DAYS="${KEEP_DAYS:-7}"
REMOTE_NAME="${RCLONE_REMOTE_NAME:-domino-gdrive}"
REMOTE_DIR="${RCLONE_REMOTE_DIR:-domino-online-backups}"
REMOTE_KEEP_DAYS="${REMOTE_KEEP_DAYS:-30}"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >> "$LOG"; }
trap 'log "FAILED (line $LINENO)"' ERR

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%d-%H%M%S)"
name="domino-$stamp.db"

log "start"
# Runs inside the container as the same user that owns the database.
docker exec "$CONTAINER" node server/dist/admin.js backup "/backups/$name" >> "$LOG" 2>&1
gzip -9 "$BACKUP_DIR/$name"
chmod 600 "$BACKUP_DIR/$name.gz"
size="$(wc -c < "$BACKUP_DIR/$name.gz" | tr -d ' ')"
log "local backup ok: $name.gz ($size bytes)"

# Local retention.
find "$BACKUP_DIR" -maxdepth 1 -name 'domino-*.db.gz' -mtime "+$KEEP_DAYS" -print -delete >> "$LOG" 2>&1 || true

# Off-server copy.
if ! command -v rclone > /dev/null 2>&1 || ! rclone listremotes 2> /dev/null | grep -qx "$REMOTE_NAME:"; then
  log "WARNING: rclone remote '$REMOTE_NAME' is not configured, so there is NO off-server copy yet"
  exit 3
fi
if rclone copy "$BACKUP_DIR/$name.gz" "$REMOTE_NAME:$REMOTE_DIR" --log-file "$LOG" --log-level NOTICE; then
  log "drive copy ok: $REMOTE_NAME:$REMOTE_DIR/$name.gz"
else
  log "ERROR: the Drive copy failed"
  exit 3
fi
rclone delete "$REMOTE_NAME:$REMOTE_DIR" --min-age "${REMOTE_KEEP_DAYS}d" --log-file "$LOG" --log-level NOTICE || true
log "done"
