#!/usr/bin/env bash
# Writes the rclone remote for the PERSONAL Google Drive (jmarquezh975@gmail.com), minimal scope.
# The OAuth token is read from stdin, so it never appears in a command line or in git:
#
#   rclone authorize "drive" '{"scope":"drive.file"}'  # on the Mac, in the personal Chrome profile
#   ssh root@137.184.155.4 /opt/domino/deploy/rclone-setup.sh   # then paste the {"access_token":…} JSON
set -euo pipefail

REMOTE_NAME="${RCLONE_REMOTE_NAME:-domino-gdrive}"
CONF="${RCLONE_CONFIG:-/root/.config/rclone/rclone.conf}"

echo "Pega el token JSON que imprimió 'rclone authorize' y pulsa Enter:" >&2
IFS= read -r token
case "$token" in
  '{'*access_token*'}') ;;
  *) echo "Eso no parece un token de rclone." >&2; exit 1 ;;
esac

umask 077
mkdir -p "$(dirname "$CONF")"
touch "$CONF"
# Keep any other remotes already configured; replace only ours.
python3 - "$CONF" "$REMOTE_NAME" <<'PY'
import re, sys
path, name = sys.argv[1], sys.argv[2]
text = open(path).read()
text = re.sub(r'(?ms)^\[' + re.escape(name) + r'\]\n.*?(?=^\[|\Z)', '', text)
open(path, 'w').write(text.rstrip('\n') + ('\n' if text.strip() else ''))
PY
{
  printf '\n[%s]\n' "$REMOTE_NAME"
  printf 'type = drive\n'
  printf 'scope = drive.file\n'
  printf 'token = %s\n' "$token"
} >> "$CONF"
chmod 600 "$CONF"
echo "Remoto '$REMOTE_NAME' guardado en $CONF (chmod 600)." >&2
rclone lsd "$REMOTE_NAME:" >&2 && echo "Conexión con Drive OK." >&2
