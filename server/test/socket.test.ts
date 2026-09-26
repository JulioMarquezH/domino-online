import type { AddressInfo } from 'node:net';
import {
  legalMoves,
  mulberry32,
  type Ack,
  type ClientToServerEvents,
  type JoinOk,
  type RoomView,
  type ServerToClientEvents,
} from '@domino/shared';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type App } from '../src/app';

type Client = Socket<ServerToClientEvents, ClientToServerEvents> & {
  views: RoomView[];
  latest: () => RoomView;
};

let app: App;
let url: string;
const clients: Client[] = [];

beforeEach(async () => {
  app = createApp({
    iceServers: [{ urls: 'stun:stun.example.org:3478' }],
    rng: mulberry32(7),
    timings: { drawRevealMs: 20, nextHandMs: 60_000, lobbyGraceMs: 50, pauseMs: 60_000 },
  });
  await new Promise<void>((r) => app.http.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
});

afterEach(async () => {
  clients.splice(0).forEach((c) => c.disconnect());
  await app.close();
});

function client(): Promise<Client> {
  const socket = connect(url, { transports: ['websocket'], forceNew: true }) as Client;
  socket.views = [];
  socket.latest = () => {
    const v = socket.views[socket.views.length - 1];
    if (!v) throw new Error('no state yet');
    return v;
  };
  socket.on('state', (v) => socket.views.push(v));
  clients.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function call<T extends object>(
  socket: Client,
  event: keyof ClientToServerEvents,
  payload?: unknown,
): Promise<Ack<T>> {
  return new Promise((resolve) => {
    const s = socket as unknown as { emit: (...args: unknown[]) => void };
    if (payload === undefined) s.emit(event, resolve);
    else s.emit(event, payload, resolve);
  });
}

async function until(fn: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('Timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function fourPlayers() {
  const [a, b, c, d] = await Promise.all([client(), client(), client(), client()]);
  const created = await call<JoinOk>(a, 'room:create', { name: 'Ana' });
  if (!created.ok) throw new Error(created.code);
  const roomId = created.roomId;
  const joins = [created];
  for (const [s, name] of [
    [b, 'Beto'],
    [c, 'Caro'],
    [d, 'Dani'],
  ] as const) {
    const r = await call<JoinOk>(s, 'room:join', { roomId: roomId.toLowerCase(), name });
    if (!r.ok) throw new Error(r.code);
    joins.push(r);
  }
  const all = [a, b, c, d];
  await until(() => all.every((s) => s.views.at(-1)?.players.length === 4));
  return { roomId, all, joins: joins as Extract<Ack<JoinOk>, { ok: true }>[] };
}

async function startGame(all: Client[]) {
  expect(await call(all[0] as Client, 'lobby:start')).toEqual({ ok: true });
  await until(() => all.every((s) => s.views.at(-1)?.phase === 'draw'));
  const picks = await Promise.all(all.map((s, i) => call(s, 'draw:pick', { position: i * 7 })));
  expect(picks.every((p) => p.ok)).toBe(true);
  await until(() => all.every((s) => s.views.at(-1)?.phase === 'playing'));
}

/** Tiles mentioned anywhere in a payload. */
const tilesIn = (v: unknown) => new Set(JSON.stringify(v).match(/"[0-6]-[0-6]"/g) ?? []);

describe('socket integration', () => {
  it('creates and joins a room, rejects a fifth player and unknown rooms, delivers ICE config', async () => {
    const { roomId, all, joins } = await fourPlayers();
    expect(roomId).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/);
    expect(joins[0]?.iceServers).toEqual([{ urls: 'stun:stun.example.org:3478' }]);
    const view = all[0]?.latest();
    expect(view?.players.map((p) => p.name)).toEqual(['Ana', 'Beto', 'Caro', 'Dani']);
    expect(view?.players[0]?.isHost).toBe(true);

    const fifth = await client();
    expect(await call(fifth, 'room:join', { roomId, name: 'Eva' })).toEqual({
      ok: false,
      code: 'FULL',
    });
    expect(await call(fifth, 'room:join', { roomId: 'ZZZZZZ', name: 'Eva' })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(await call(fifth, 'room:join', { roomId, name: 'beto' })).toEqual({
      ok: false,
      code: 'FULL',
    });
  });

  it('never sends a player the tiles of the others during a hand', async () => {
    const { all } = await fourPlayers();
    await startGame(all);
    all.forEach((s) => (s.views = [s.latest()]));
    const rng = mulberry32(3);

    // Everyone plays their own legal moves through the socket until the hand ends.
    for (let guard = 0; guard < 200; guard++) {
      const phase = all[0]?.latest().phase;
      if (phase !== 'playing') break;
      const turn = all[0]?.latest().game?.turn;
      const actor = all.find((s) => {
        const v = s.latest();
        return v.players.find((p) => p.id === v.youId)?.seat === turn;
      }) as Client;
      const v = actor.latest();
      const g = v.game;
      if (!g) throw new Error('no game');
      const moves = legalMoves(g.hand, g.line);
      const move = moves[Math.floor(rng() * moves.length)];
      const before = v.version;
      const r = move
        ? await call(actor, 'game:play', { tile: move.tile, end: move.end, v: v.version })
        : await call(actor, 'game:pass', { v: v.version });
      expect(r).toEqual({ ok: true });
      await until(() => all.every((s) => s.latest().version > before));
    }

    for (const s of all) {
      for (const v of s.views) {
        if (v.phase !== 'playing' || !v.game) continue;
        const allowed = new Set(
          [...v.game.hand, ...v.game.line.map((t) => t.tile)].map((t) => `"${t}"`),
        );
        for (const t of tilesIn(v)) expect(allowed.has(t)).toBe(true);
        expect(v.handResult).toBeNull();
      }
      const last = s.latest();
      expect(['handEnd', 'matchEnd']).toContain(last.phase);
      expect(last.handResult?.hands).toHaveLength(4);
    }
  });

  it('rejects out-of-turn, stale and illegal actions and resyncs the client', async () => {
    const { all } = await fourPlayers();
    await startGame(all);
    const turn = all[0]?.latest().game?.turn;
    const other = all.find((s) => {
      const v = s.latest();
      return v.players.find((p) => p.id === v.youId)?.seat !== turn;
    }) as Client;
    const v = other.latest();
    const count = other.views.length;
    expect(
      await call(other, 'game:play', { tile: v.game?.hand[0], end: 'left', v: v.version }),
    ).toEqual({ ok: false, code: 'NOT_YOUR_TURN' });
    await until(() => other.views.length > count);
    expect(await call(other, 'game:pass', { v: -1 })).toEqual({ ok: false, code: 'STALE' });
    expect(await call(other, 'game:play', { tile: '9-9', end: 'left', v: v.version })).toEqual({
      ok: false,
      code: 'INVALID',
    });
  });

  it('reclaims the same seat and hand with the token after a reconnection', async () => {
    const { roomId, all, joins } = await fourPlayers();
    await startGame(all);
    const beto = all[1] as Client;
    const before = beto.latest();
    const me = before.players.find((p) => p.id === before.youId);
    beto.disconnect();
    await until(() => (all[0]?.latest().pause.length ?? 0) === 1);
    expect(all[0]?.latest().pause[0]).toMatchObject({ name: 'Beto', expired: false });

    const again = await client();
    const r = await call<JoinOk>(again, 'room:join', { roomId, token: joins[1]?.token });
    expect(r.ok && r.playerId).toBe(me?.id);
    await until(() => again.views.length > 0 && all[0]?.latest().pause.length === 0);
    const after = again.latest();
    expect(after.players.find((p) => p.id === after.youId)?.seat).toBe(me?.seat);
    expect(after.game?.hand).toEqual(before.game?.hand);
    expect(after.phase).toBe('playing');
  });

  it('relays WebRTC signals only to the current session of a room member', async () => {
    const { all } = await fourPlayers();
    const [a, b] = all as [Client, Client];
    const bView = b.latest();
    const bId = bView.youId;
    const bSession = bView.players.find((p) => p.id === bId)?.voiceSession as string;
    const got: unknown[] = [];
    b.on('rtc:signal', (p) => got.push(p));
    a.emit('rtc:signal', { to: bId, toSession: 'stale', data: { candidate: 'x' } });
    a.emit('rtc:signal', { to: bId, toSession: bSession, data: { candidate: 'y' } });
    await until(() => got.length > 0);
    expect(got).toEqual([{ from: a.latest().youId, fromSession: a.id, data: { candidate: 'y' } }]);
  });
});
