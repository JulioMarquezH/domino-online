import type { RTCIceServerConfig } from '@domino/shared';

export interface ServerConfig {
  port: number;
  iceServers: RTCIceServerConfig[];
  /** Directory with the built web app, served in production. */
  webDist: string | null;
  pauseMs: number;
}

const DEFAULT_ICE: RTCIceServerConfig[] = [{ urls: 'stun:stun.l.google.com:19302' }];

export function parseIceServers(raw: string | undefined): RTCIceServerConfig[] {
  if (!raw || raw.trim() === '') return DEFAULT_ICE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('ICE_SERVERS must be valid JSON (an array of RTCIceServer objects)');
  }
  if (!Array.isArray(parsed)) throw new Error('ICE_SERVERS must be a JSON array');
  return parsed.map((entry, i) => {
    const e = entry as Record<string, unknown>;
    const urls = e.urls;
    const valid =
      typeof urls === 'string' ||
      (Array.isArray(urls) && urls.length > 0 && urls.every((u) => typeof u === 'string'));
    if (!valid) throw new Error(`ICE_SERVERS[${i}].urls must be a string or string[]`);
    const server: RTCIceServerConfig = { urls: urls as string | string[] };
    if (typeof e.username === 'string') server.username = e.username;
    if (typeof e.credential === 'string') server.credential = e.credential;
    return server;
  });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port <= 0) throw new Error('PORT must be a positive integer');
  const pauseMs = Number(env.PAUSE_MS ?? 120_000);
  return {
    port,
    iceServers: parseIceServers(env.ICE_SERVERS),
    webDist: env.WEB_DIST ?? null,
    pauseMs: Number.isFinite(pauseMs) && pauseMs > 0 ? pauseMs : 120_000,
  };
}
