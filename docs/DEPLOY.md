# Despliegue en el droplet de Manhattan

Destino: el droplet de DigitalOcean que ya sirve Manhattan (Ubuntu 24.04, 1 vCPU / 1 GB RAM +
2 GB de swap, Docker, Caddy con HTTPS automático). Subdominio: **domino.manhattan-project.online**.

Estado al 2026-09-26:

- DNS: `domino.manhattan-project.online` ya resuelve a `137.184.155.4`. Si alguna vez deja de
  resolver: en Namecheap, registro `A`, host `domino`, valor `137.184.155.4`.
- El repo está clonado en `/opt/domino` y la imagen `domino-online:latest` ya está construida ahí.
- Falta: arrancar el contenedor, añadir el bloque de Caddy y (recomendado) coturn.

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
- Reiniciar el contenedor borra las salas (por diseño: no hay base de datos). Los clientes ven
  "La sala ya no existe".
