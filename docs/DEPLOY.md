# Despliegue en el droplet de Manhattan

Destino: el droplet de DigitalOcean que ya sirve Manhattan (Ubuntu 24.04, 1 vCPU / 1 GB RAM +
2 GB de swap, Docker, Caddy con HTTPS automático). Subdominio: **domino.manhattan-project.online**.

Estado al 2026-09-26 (desplegado):

- En producción en **https://domino.manhattan-project.online** (registro `A` `domino` →
  `137.184.155.4` creado en Namecheap el 2026-09-28; certificado de Let's Encrypt emitido por
  Caddy, se renueva solo).
- También responde **https://domino.137-184-155-4.sslip.io**, el nombre temporal que se usó antes
  de tener el registro DNS. Se puede quitar ese bloque del Caddyfile cuando ya no haga falta.
- Contenedor `domino` en `127.0.0.1:8020` (repo en `/opt/domino`), ~25 MB de RAM.
- coturn activo (`/etc/turnserver.conf`, secreto en `/opt/domino/.turn_secret`), UFW abierto en
  3478/udp+tcp y 49160–49359/udp; `/opt/domino/.env` le pasa `TURN_URLS`/`TURN_SECRET` al
  contenedor. Verificado con un enlace forzado a `relay`.
- Respaldo del Caddyfile anterior en `/etc/caddy/Caddyfile.bak-*`.

## 1. Contenedor

El `Dockerfile` es multi-etapa: compila en `node:24-alpine` y la imagen final solo lleva el bundle
del servidor, el web compilado y `socket.io`. `docker-compose.yml` publica el puerto **solo en
127.0.0.1:8020** (8000 y 8010 ya los usan Manhattan y el bot).

```bash
ssh root@137.184.155.4
cd /opt/domino && git pull
docker compose up -d --build
curl -s 127.0.0.1:8020/healthz        # → ok
```

Para actualizar: `cd /opt/domino && git pull && docker compose up -d --build`.

## 2. Caddy

Añadir al final de `/etc/caddy/Caddyfile` (Caddy hace solo el upgrade a WebSocket):

```caddy
domino.manhattan-project.online {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8020
}
```

```bash
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
curl -sI https://domino.manhattan-project.online | head -1   # → HTTP/2 200
```

## 3. TURN con coturn (recomendado)

Solo con STUN, la voz falla entre algunas redes (muchos datos móviles usan NAT simétrico). El
juego sigue funcionando y se ve el icono "sin conexión de voz", pero para que se oigan todos hace
falta un relay TURN. El servidor ya genera credenciales temporales por jugador si recibe
`TURN_URLS` y `TURN_SECRET` (coturn con `use-auth-secret`).

```bash
apt-get install -y coturn
openssl rand -hex 32 > /opt/domino/.turn_secret && chmod 600 /opt/domino/.turn_secret
```

`/etc/turnserver.conf`:

```ini
listening-port=3478
external-ip=137.184.155.4
realm=domino.manhattan-project.online
fingerprint
use-auth-secret
static-auth-secret=<contenido de /opt/domino/.turn_secret>
min-port=49160
max-port=49359
total-quota=150
user-quota=12
max-bps=96000
no-cli
no-tls
no-dtls
no-multicast-peers
# nunca relevar hacia redes privadas ni hacia el propio host
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
simple-log
```

Firewall (UFW; si hay un Cloud Firewall de DigitalOcean, abrir lo mismo allí):

```bash
ufw allow 3478/udp && ufw allow 3478/tcp && ufw allow 49160:49359/udp
systemctl enable --now coturn
```

`/opt/domino/.env` (lo lee el compose):

```ini
TURN_URLS=turn:domino.manhattan-project.online:3478?transport=udp,turn:domino.manhattan-project.online:3478?transport=tcp
TURN_SECRET=<el mismo secreto>
```

Luego `docker compose up -d` para que el contenedor lo tome. Alternativa sin coturn propio: poner
servidores TURN con usuario y clave fijos en `ICE_SERVERS` (JSON).

## 4. Memoria (droplet de 1 GB)

- El proceso Node usa ~40–60 MB en reposo; `--max-old-space-size=96` y `mem_limit: 192m` lo
  acotan. Cada sala es un objeto pequeño en memoria.
- La voz **no** pasa por el servidor (malla P2P); solo la señalización. Con coturn, el audio
  relevado es Opus (~40 kbps por flujo) y coturn gasta ~10–20 MB.
- Construir la imagen en el droplet usa unos cientos de MB durante ~1 minuto (hay swap). Si
  molesta, construirla fuera con `docker buildx build --platform linux/amd64` y pasarla con
  `docker save | ssh root@137.184.155.4 docker load`.
- Reiniciar el contenedor borra las **salas en curso** (viven en memoria). Los clientes ven "La sala
  ya no existe". Los **torneos** no se pierden: están en SQLite (`/opt/domino/data`), ver abajo.

## 5. Base de datos de los torneos (SQLite)

Los torneos viven en un archivo SQLite (`node:sqlite`, sin compilar nada nativo). En el contenedor
es `/data/domino.db` (`DATABASE_PATH`); en el droplet es el volumen `/opt/domino/data`.
`docker-compose.yml` monta además `/opt/domino/backups` en `/backups`.

La primera vez, **antes** de levantar el contenedor, los directorios deben existir y pertenecer al
usuario `node` del contenedor (uid 1000):

```bash
mkdir -p /opt/domino/data /opt/domino/backups
chown 1000:1000 /opt/domino/data /opt/domino/backups
chmod 700 /opt/domino/data /opt/domino/backups
cd /opt/domino && git pull && docker compose up -d --build
docker logs domino | tail -3        # → … · db /data/domino.db
```

Si Docker crea `data/` solo, queda de root y el servidor no arranca ("unable to open database
file"): corrige con el `chown` y reinicia. Las migraciones se aplican solas al arrancar y son
idempotentes; un build viejo se niega a abrir una base más nueva. Los datos sobreviven a
`docker compose up -d --build` y a recrear el contenedor.

Ver cuántas salas hay vivas **antes de desplegar** (no se expone por Caddy: solo responde desde
dentro del contenedor; la versión anterior a los torneos no lo tiene, para esa se cuentan las
conexiones del puerto):

```bash
docker exec domino node -e "fetch('http://127.0.0.1:3000/_stats').then(r=>r.text()).then(console.log)"
# versión sin /_stats: conexiones establecidas hacia el contenedor (≈ jugadores conectados)
ss -Htn state established '( sport = :8020 )' | wc -l
```

### Administración

```bash
alias torneo='docker exec domino node server/dist/admin.js'
torneo list
torneo show <ID>
torneo void-match <ID> <jornada> <cupo> --reason "motivo"
torneo rename-player <ID> <letra> "Nombre"
torneo delete-tournament <ID>        # solo torneos sin partidos
torneo audit
```

Todo queda en `admin_audit`. Más detalle en [TORNEO.md](TORNEO.md).

## 6. Copias de seguridad

Dos capas, ambas diarias:

1. **Local**: `deploy/backup.sh` pide al propio contenedor una copia **consistente**
   (`VACUUM INTO`, nunca una copia cruda de un archivo vivo), le pasa `integrity_check`, la
   comprime en `/opt/domino/backups/domino-AAAAMMDD-HHMMSS.db.gz` y borra las de más de 7 días.
2. **Fuera del servidor**: la misma copia sube a **Google Drive de la cuenta personal**
   (`jmarquezh975@gmail.com`, **nunca** la de `cifrato.co`), carpeta `domino-online-backups`, con
   `rclone` y el alcance mínimo `drive.file` (solo ve lo que él mismo creó). En Drive se conservan
   30 días.

Cron (estilo de Manhattan: script en el repo, archivo en `/etc/cron.d/`, log en `/var/log/`):

```bash
cp /opt/domino/deploy/domino-backup.cron /etc/cron.d/domino-backup
chmod 644 /etc/cron.d/domino-backup
touch /var/log/domino-backup.log
/opt/domino/deploy/backup.sh && tail -5 /var/log/domino-backup.log   # prueba manual
```

El script termina con código 3 (y lo anota en el log) si la copia local salió bien pero la de
Drive no, o si `rclone` aún no está configurado.

### Configurar rclone con Drive (una sola vez)

Solo el dueño de la cuenta puede dar el consentimiento de Google. En el Mac, en el **perfil de
Chrome de `jmarquezh975@gmail.com`**:

```bash
brew install rclone                       # si no lo tienes
rclone authorize "drive" '{"scope":"drive.file"}'
```

`rclone` imprime un enlace (`http://127.0.0.1:53682/auth?state=…`): ábrelo en ese perfil de Chrome,
elige la cuenta personal y acepta. Al terminar imprime un JSON `{"access_token":…}`. En el droplet:

```bash
apt-get install -y rclone                 # o: curl https://rclone.org/install.sh | bash
/opt/domino/deploy/rclone-setup.sh        # pega el JSON y Enter
```

El script guarda el remoto `domino-gdrive` en `/root/.config/rclone/rclone.conf` con `chmod 600`.
El token **solo existe en el droplet**: no va a git ni a `.env`. Para revocarlo: _Cuenta de Google
→ Seguridad → Conexiones de terceros → rclone_.

### Ver que las copias existen

```bash
/opt/domino/deploy/backup-status.sh
# Local  domino-20261007-073000.db.gz — hace 3 h 12 min [ok]
# Drive  domino-20261007-073000.db.gz — hace 3 h 12 min [ok]      (sale 1 si alguna pasa de 26 h)
```

### Probar una copia (sin tocar la base viva)

```bash
/opt/domino/deploy/verify-backup.sh            # la última local
/opt/domino/deploy/verify-backup.sh --drive    # baja la última de Drive y la verifica
# integrity_check: ok; foreign_key_check: ok
# Los conteos coinciden.
# COPIA VÁLIDA
```

Restaura la copia en una base de prueba, corre `integrity_check` y compara el número de filas de
cada tabla con la base viva (una copia más vieja puede tener menos filas, nunca más).

### Restaurar

```bash
/opt/domino/deploy/restore.sh /opt/domino/backups/domino-AAAAMMDD-HHMMSS.db.gz
```

Para el contenedor, **aparta** (no borra) la base actual en `/opt/domino/data/pre-restore-<fecha>/`,
pone la copia, la deja con dueño 1000:1000, levanta el contenedor y lista los torneos. Si algo
falla en medio, devuelve la base anterior. Desde Drive: `rclone copy
domino-gdrive:domino-online-backups/<archivo> /opt/domino/backups/` y se usa igual.

## 7. Actualizar y revertir

```bash
cd /opt/domino && git pull && docker compose up -d --build   # corta las salas en curso
curl -s 127.0.0.1:8020/healthz                               # → ok
docker logs domino | tail -3
```

Revertir: `git checkout <commit anterior> && docker compose up -d --build`. La base de datos no se
toca; un build anterior a una migración se niega a abrirla (hay que volver al build nuevo o
restaurar una copia anterior a la migración).
