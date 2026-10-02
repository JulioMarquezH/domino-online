# syntax=docker/dockerfile:1
# ── build: install everything, build the web app and bundle the server ──
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build

# ── deps: only the server's runtime dependency (socket.io) ──
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace server --ignore-scripts --no-audit --no-fund

# ── runtime: one small Node process serving Socket.IO, the static web app and the SQLite file ──
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/domino.db
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
# /data holds the SQLite database (tournaments); /backups receives the daily consistent copies.
# In production both are bind mounts from /opt/domino that must belong to uid 1000 (see docs/DEPLOY.md).
RUN mkdir -p /data /backups && chown node:node /data /backups
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "--max-old-space-size=96", "server/dist/index.js"]
