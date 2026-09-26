import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const here = dirname(fileURLToPath(import.meta.url));
// In production the server serves the built web app itself (single origin, single port).
const defaultDist = resolve(here, '../../web/dist');
const webDist =
  config.webDist ??
  (process.env.NODE_ENV === 'production' && existsSync(defaultDist) ? defaultDist : null);

const app = createApp({
  iceServers: config.iceServers,
  turn: config.turn,
  webDist,
  timings: { pauseMs: config.pauseMs },
});

app.http.listen(config.port, () => {
  console.log(
    `[domino] listening on :${config.port}${webDist ? ` (serving ${webDist})` : ' (API only)'}${config.turn ? ' + TURN' : ''}`,
  );
});

const shutdown = () => {
  void app.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
