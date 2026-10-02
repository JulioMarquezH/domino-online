#!/usr/bin/env bash
# Prints how old the newest local and Google Drive backups are. Exit 1 if either is older than
# MAX_AGE_HOURS (default 26) or missing, so it can be used from monitoring.
set -uo pipefail

APP_DIR="${APP_DIR:-/opt/domino}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
REMOTE_NAME="${RCLONE_REMOTE_NAME:-domino-gdrive}"
REMOTE_DIR="${RCLONE_REMOTE_DIR:-domino-online-backups}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-26}"
now="$(date -u +%s)"
status=0

human() { # seconds → "3 h 12 min"
  local s=$1
  printf '%d h %02d min' $((s / 3600)) $((s % 3600 / 60))
}

report() { # label, name, epoch
  local label=$1 name=$2 epoch=$3
  if [ -z "$name" ]; then
    printf '%-6s sin copias\n' "$label"
    status=1
    return
  fi
  local age=$((now - epoch))
  local mark="ok"
  if [ "$age" -gt $((MAX_AGE_HOURS * 3600)) ]; then
    mark="VIEJA"
    status=1
  fi
  printf '%-6s %s — hace %s [%s]\n' "$label" "$name" "$(human "$age")" "$mark"
}

# Local: newest file by modification time (portable: GNU and BSD stat differ, so use Python).
latest_local="$(ls -1t "$BACKUP_DIR"/domino-*.db.gz 2> /dev/null | head -1 || true)"
if [ -n "$latest_local" ]; then
  mtime="$(python3 -c 'import os,sys; print(int(os.path.getmtime(sys.argv[1])))' "$latest_local")"
  report "Local" "$(basename "$latest_local")" "$mtime"
else
  report "Local" "" 0
fi

# Drive: newest file in the remote folder.
if command -v rclone > /dev/null 2>&1 && rclone listremotes 2> /dev/null | grep -qx "$REMOTE_NAME:"; then
  line="$(rclone lsjson "$REMOTE_NAME:$REMOTE_DIR" --files-only 2> /dev/null | python3 -c '
import json, sys, datetime
items = json.load(sys.stdin)
if items:
    last = max(items, key=lambda i: i["ModTime"])
    t = datetime.datetime.fromisoformat(last["ModTime"].replace("Z", "+00:00"))
    print(last["Name"], int(t.timestamp()))
' || true)"
  if [ -n "$line" ]; then
    report "Drive" "${line% *}" "${line##* }"
  else
    report "Drive" "" 0
  fi
else
  printf '%-6s rclone sin configurar\n' "Drive"
  status=1
fi
exit "$status"
