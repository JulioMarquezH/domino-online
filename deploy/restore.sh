#!/usr/bin/env bash
# Restores the tournament database from a backup. DESTRUCTIVE for the live database file, so the
# current one is moved aside first (never deleted).
#
#   deploy/restore.sh /opt/domino/backups/domino-20261007-073000.db.gz
set -euo pipefail

src="${1:?usage: restore.sh BACKUP.db.gz}"
APP_DIR="${APP_DIR:-/opt/domino}"
DATA_DIR="${DATA_DIR:-$APP_DIR/data}"
CONTAINER="${CONTAINER:-domino}"
stamp="$(date -u +%Y%m%d-%H%M%S)"
aside="$DATA_DIR/pre-restore-$stamp"

[ -f "$src" ] || { echo "No existe $src" >&2; exit 1; }
tmp="$(mktemp "$DATA_DIR/restore-XXXXXX.db")"
trap 'rm -f "$tmp"' EXIT
case "$src" in
  *.gz) gunzip -c "$src" > "$tmp" ;;
  *) cp "$src" "$tmp" ;;
esac

# If anything fails after the container is stopped, put the previous database back and restart.
rollback() {
  echo "ERROR: la restauración falló; devolviendo la base anterior." >&2
  for f in domino.db domino.db-wal domino.db-shm; do
    [ -e "$aside/$f" ] && mv -f "$aside/$f" "$DATA_DIR/$f"
  done
  (cd "$APP_DIR" && docker compose up -d domino) || true
  rm -f "$tmp"
}

echo "Parando el contenedor $CONTAINER…"
(cd "$APP_DIR" && docker compose stop domino)
trap rollback ERR

mkdir -p "$aside"
for f in domino.db domino.db-wal domino.db-shm; do
  if [ -e "$DATA_DIR/$f" ]; then mv "$DATA_DIR/$f" "$aside/"; fi
done
mv "$tmp" "$DATA_DIR/domino.db"
# The container runs as uid 1000; on the server this script runs as root.
if [ "$(id -u)" = 0 ]; then chown 1000:1000 "$DATA_DIR/domino.db"; fi
chmod 600 "$DATA_DIR/domino.db"
trap - ERR EXIT
echo "Base anterior guardada en $aside"

(cd "$APP_DIR" && docker compose up -d domino)
for _ in $(seq 1 20); do
  [ "$(curl -s 127.0.0.1:8020/healthz || true)" = "ok" ] && break
  sleep 1
done
curl -s 127.0.0.1:8020/healthz && echo
docker exec "$CONTAINER" node server/dist/admin.js list
