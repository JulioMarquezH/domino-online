import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LETTERS,
  TOURNAMENT_ID_LENGTH,
  legalMoves,
  mulberry32,
  type Ack,
  type ClientToServerEvents,
  type JoinOk,
  type Letter,
  type RoomView,
  type ServerToClientEvents,
  type TournamentCreated,
  type TournamentEntered,
  type TournamentView,
} from '@domino/shared';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type App } from '../src/app';

type Client = Socket<ServerToClientEvents, ClientToServerEvents> & {
  views: RoomView[];
  tviews: TournamentView[];
  latest: () => RoomView;
  tlatest: () => TournamentView;
};

const NAMES = ['Ana', 'Beto', 'Caro', 'Dani'];
const TARGET = 30;
let app: App;
let url: string;
let dir: string;
let dbFile: string;
const clients: Client[] = [];

function options(overrides: Partial<Parameters<typeof createApp>[0]> = {}) {
  return {
    iceServers: [{ urls: 'stun:stun.example.org:3478' }],
    rng: mulberry32(7),
    timings: { drawRevealMs: 20, nextHandMs: 40, lobbyGraceMs: 50, pauseMs: 60_000 },
    databasePath: dbFile,
    tournamentTarget: TARGET,
    ...overrides,
  };
}

async function listen(application: App) {
  await new Promise<void>((r) => application.http.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(application.http.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'domino-t-'));
  dbFile = join(dir, 'domino.db');
  app = createApp(options());
  await listen(app);
});

afterEach(async () => {
  clients.splice(0).forEach((c) => c.disconnect());
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

function client(): Promise<Client> {
  const socket = connect(url, { transports: ['websocket'], forceNew: true }) as Client;
  socket.views = [];
  socket.tviews = [];
  socket.latest = () => {
    const v = socket.views.at(-1);
    if (!v) throw new Error('no room state yet');
    return v;
  };
  socket.tlatest = () => {
    const v = socket.tviews.at(-1);
    if (!v) throw new Error('no tournament state yet');
    return v;
  };
  socket.on('state', (v) => socket.views.push(v));
  socket.on('tournament:state', (v) => socket.tviews.push(v));
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

async function until(fn: () => boolean, ms = 4000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('Timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function createTournament(creator: Client, names = NAMES) {
  const res = await call<TournamentCreated>(creator, 'tournament:create', { names });
  if (!res.ok) throw new Error(res.code);
  return res;
}

async function enterAs(socket: Client, id: string, name: string) {
  const res = await call<TournamentEntered>(socket, 'tournament:enter', { id, name });
  if (!res.ok) throw new Error(res.code);
  socket.tviews.push(res.view); // like the page does with the answer to "enter"
  return res;
}

/** Four registered players, each on their own socket, all inside the tournament page. */
async function fourPlayers() {
  const [creator, ...players] = await Promise.all([
    client(),
    client(),
    client(),
    client(),
    client(),
  ]);
  const created = await createTournament(creator as Client);
  const entered = await Promise.all(
    players.map((s, i) => enterAs(s, created.id, NAMES[i] as string)),
  );
  return { created, players, entered };
}

describe('creating a tournament', () => {
  it('draws the letters on the server and returns an unguessable ID', async () => {
    const c = await client();
    const res = await createTournament(c);
    expect(res.id).toHaveLength(TOURNAMENT_ID_LENGTH);
    expect(res.id).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{12}$/);
    expect(res.players.map((p) => p.name)).toEqual(NAMES);
    expect(res.players.map((p) => p.letter).sort()).toEqual([...LETTERS]);
    const other = await createTournament(c);
    expect(other.id).not.toBe(res.id);
  });

  it('validates names: exactly four, 1–20 chars, unique after normalization', async () => {
    const c = await client();
    const create = (names: unknown) => call(c, 'tournament:create', { names });
    expect(await create(['a', 'b', 'c'])).toEqual({ ok: false, code: 'NAMES_COUNT' });
    expect(await create('nope')).toEqual({ ok: false, code: 'NAMES_COUNT' });
    expect(await create(['a', 'b', 'c', ''])).toEqual({ ok: false, code: 'NAME_INVALID' });
    expect(await create(['a', 'b', 'c', 'x'.repeat(21)])).toEqual({
      ok: false,
      code: 'NAME_INVALID',
    });
    expect(await create(['José', 'Beto', 'Caro', ' JOSE '])).toEqual({
      ok: false,
      code: 'NAME_DUPLICATE',
    });
    expect(await call(c, 'tournament:create', null)).toEqual({ ok: false, code: 'NAMES_COUNT' });
  });

  it('rate-limits tournament creation per IP', async () => {
    await app.close();
    app = createApp(options({ limits: { createsPerIp: 2 } }));
    await listen(app);
    const c = await client();
    await createTournament(c);
    await createTournament(c);
    const third = await call(c, 'tournament:create', { names: NAMES });
    expect(third).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
  });
});

describe('entering a tournament', () => {
  it('needs the exact name of a registered player — no pick-list, no PIN', async () => {
    const [creator, visitor] = await Promise.all([client(), client()]);
    const { id } = await createTournament(creator);

    expect(await call(visitor, 'tournament:enter', { id })).toEqual({
      ok: false,
      code: 'NEED_NAME',
    });
    expect(await call(visitor, 'tournament:enter', { id, name: 'Zoila' })).toEqual({
      ok: false,
      code: 'NAME_UNKNOWN',
    });
    expect(await call(visitor, 'tournament:enter', { id, name: '' })).toEqual({
      ok: false,
      code: 'NEED_NAME',
    });
    const ok = await enterAs(visitor, id.toLowerCase(), '  ANA ');
    expect(ok.you.name).toBe('Ana');
    expect(ok.token).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(ok.view.id).toBe(id);
    expect(ok.view.players.map((p) => p.name).sort()).toEqual([...NAMES].sort());
  });

  it('matches names ignoring case, accents and extra spaces', async () => {
    const [creator, visitor] = await Promise.all([client(), client()]);
    const { id } = await createTournament(creator, ['José Luis', 'Beto', 'Caro', 'Dani']);
    const res = await enterAs(visitor, id, 'jose   LUIS');
    expect(res.you.name).toBe('José Luis');
  });

  it('answers "does not exist" for unknown or malformed IDs', async () => {
    const c = await client();
    expect(await call(c, 'tournament:enter', { id: 'ZZZZZZZZZZZZ', name: 'Ana' })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(await call(c, 'tournament:enter', { id: 'short', name: 'Ana' })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(await call(c, 'tournament:enter', 42)).toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('remembers a device with its token, and lets the same name claim another device', async () => {
    const [creator, phone, laptop, stranger] = await Promise.all([
      client(),
      client(),
      client(),
      client(),
    ]);
    const { id } = await createTournament(creator);
    const first = await enterAs(phone, id, 'Beto');

    // The phone comes back later with only its token (no name prompt).
    const back = await call<TournamentEntered>(laptop, 'tournament:enter', {
      id,
      token: first.token,
    });
    expect(back).toMatchObject({ ok: true, you: { name: 'Beto' }, token: first.token });
    // A token is only good for its own tournament.
    const { id: other } = await createTournament(creator);
    expect(await call(stranger, 'tournament:enter', { id: other, token: first.token })).toEqual({
      ok: false,
      code: 'NEED_NAME',
    });
    // The same name from another device gets its own token; the first one keeps working.
    const second = await enterAs(stranger, id, 'beto');
    expect(second.token).not.toBe(first.token);
    expect(second.you.letter).toBe(first.you.letter);
    expect(await call(laptop, 'tournament:enter', { id, token: first.token })).toMatchObject({
      ok: true,
    });
  });

  it('rate-limits failed attempts per socket and per IP, with a retry hint', async () => {
    await app.close();
    app = createApp(options({ limits: { failuresPerSocket: 3, failuresPerIp: 5 } }));
    await listen(app);
    const [a, b, creator] = await Promise.all([client(), client(), client()]);
    const { id } = await createTournament(creator);

    for (let i = 0; i < 3; i++) {
      expect(await call(a, 'tournament:enter', { id, name: `Nadie${i}` })).toMatchObject({
        code: 'NAME_UNKNOWN',
      });
    }
    const blocked = await call(a, 'tournament:enter', { id, name: 'Ana' });
    expect(blocked).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    expect((blocked as { retryAfterMs: number }).retryAfterMs).toBeGreaterThan(0);

    // A fresh socket from the same IP has its own budget… until the IP budget (5) is spent.
    for (let i = 0; i < 2; i++) {
      expect(await call(b, 'tournament:enter', { id: 'ZZZZZZZZZZZZ', name: 'x' })).toMatchObject({
        code: 'NOT_FOUND',
      });
    }
    expect(await call(b, 'tournament:enter', { id, name: 'Ana' })).toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('validates remembered IDs and silently drops the dead ones', async () => {
    const [creator, c] = await Promise.all([client(), client()]);
    const { id } = await createTournament(creator);
    const res = await call<{ items: { id: string; status: string; played: number }[] }>(
      c,
      'tournament:list',
      { ids: [id, 'ZZZZZZZZZZZZ', 'garbage', 7] },
    );
    expect(res).toEqual({ ok: true, items: [{ id, status: 'active', played: 0 }] });
    expect(await call(c, 'tournament:list', { ids: 'x' })).toMatchObject({ ok: false });
  });

  it('requires an identity to play or export', async () => {
    const c = await client();
    expect(await call(c, 'tournament:play')).toEqual({ ok: false, code: 'NOT_AUTHENTICATED' });
    expect(await call(c, 'tournament:export')).toEqual({ ok: false, code: 'NOT_AUTHENTICATED' });
  });
});

describe('the schedule', () => {
  it('starts with jornada 1 drawn: three pairings, one "Jugar" on the first', async () => {
    const { entered } = await fourPlayers();
    const view = (entered[0] as { view: TournamentView }).view;
    expect(view.status).toBe('active');
    expect(view.target).toBe(TARGET);
    expect(view.jornadas).toHaveLength(1);
    const matches = view.jornadas[0]?.matches ?? [];
    expect(matches.map((m) => m.pairing).sort()).toEqual(['AB-CD', 'AC-BD', 'AD-BC']);
    expect(matches.map((m) => m.status)).toEqual(['pendiente', 'pendiente', 'pendiente']);
    expect(view.next).toEqual({ jornada: 1, slot: 1, number: 1 });
    expect(view.standings.every((r) => r.pj === 0 && r.rank === 1)).toBe(true);
  });

  it('gives everyone the same order', async () => {
    const { players, entered } = await fourPlayers();
    const orders = entered.map((e) => e.view.jornadas[0]?.matches.map((m) => m.pairing).join());
    expect(new Set(orders).size).toBe(1);
    expect(players).toHaveLength(4);
  });
});

// ───────────────────────────── playing a whole match ─────────────────────────────

async function joinGameRoom(
  sockets: Client[],
  entered: TournamentEntered[],
  roomId: string,
): Promise<JoinOk[]> {
  const joins = await Promise.all(
    sockets.map((s, i) => call<JoinOk>(s, 'room:join', { roomId, tt: entered[i]?.token })),
  );
  return joins.map((j) => {
    if (!j.ok) throw new Error(j.code);
    return j;
  });
}

async function playMatch(sockets: Client[]) {
  const rng = mulberry32(3);
  const startPhase = sockets[0]?.latest().phase;
  expect(startPhase).toBe('lobby');
  expect(await call(sockets[0] as Client, 'lobby:start')).toEqual({ ok: true });
  await until(() => sockets.every((s) => s.latest().phase === 'draw'));
  const picks = await Promise.all(sockets.map((s, i) => call(s, 'draw:pick', { position: i * 7 })));
  expect(picks.every((p) => p.ok)).toBe(true);
  await until(() => sockets.every((s) => s.latest().phase === 'playing'));

  for (let guard = 0; guard < 4000; guard++) {
    const phase = sockets[0]?.latest().phase;
    if (phase === 'matchEnd') break;
    if (phase === 'handEnd') {
      await Promise.all(sockets.map((s) => call(s, 'hand:ready')));
      await until(() => sockets.every((s) => s.latest().phase !== 'handEnd'));
      continue;
    }
    const turn = sockets[0]?.latest().game?.turn;
    const actor = sockets.find((s) => {
      const v = s.latest();
      return v.players.find((p) => p.id === v.youId)?.seat === turn;
    }) as Client;
    const v = actor.latest();
    if (!v.game) throw new Error('no game');
    const moves = legalMoves(v.game.hand, v.game.line);
    const move = moves[Math.floor(rng() * moves.length)];
    const before = v.version;
    const r = move
      ? await call(actor, 'game:play', { tile: move.tile, end: move.end, v: v.version })
      : await call(actor, 'game:pass', { v: v.version });
    expect(r).toEqual({ ok: true });
    await until(() => sockets.every((s) => s.latest().version > before));
  }
  await until(() => sockets.every((s) => s.latest().phase === 'matchEnd'));
}

describe('playing and recording a tournament match', () => {
  it('opens exactly one room per slot, even when everyone presses Jugar at once', async () => {
    const { players } = await fourPlayers();
    const rooms = await Promise.all([
      ...players.map((s) => call<{ roomId: string }>(s, 'tournament:play')),
      call<{ roomId: string }>(players[0] as Client, 'tournament:play'),
    ]);
    const ids = rooms.map((r) => (r.ok ? r.roomId : 'x'));
    expect(new Set(ids).size).toBe(1);
    expect(app.rooms.size).toBe(1);
    expect(ids[0]).toMatch(/^[A-Z2-9]{6}$/);
  });

  it('shows the match as "jugando" to every viewer while its room is open', async () => {
    const { players } = await fourPlayers();
    await call(players[0] as Client, 'tournament:play');
    await until(() =>
      players.every((s) => s.tlatest().jornadas[0]?.matches[0]?.status === 'jugando'),
    );
    expect(players[3]?.tlatest().jornadas[0]?.matches[1]?.status).toBe('pendiente');
  });

  it('plays match 1 to the end, stores it and pushes the new table to every viewer', async () => {
    const { created, players, entered } = await fourPlayers();
    const viewer = await client(); // a second device of Ana, only watching the table
    const first = entered[0] as TournamentEntered;
    await call(viewer, 'tournament:enter', { id: created.id, token: first.token });

    const play = await call<{ roomId: string }>(players[0] as Client, 'tournament:play');
    if (!play.ok) throw new Error(play.code);
    const joins = await joinGameRoom(players, entered, play.roomId);
    expect(new Set(joins.map((j) => j.roomId))).toEqual(new Set([play.roomId]));
    await until(() => players.every((s) => s.views.at(-1)?.players.length === 4));

    const room = players[0]?.latest();
    expect(room?.tournament).toMatchObject({ id: created.id, jornada: 1, slot: 1, saved: false });
    expect(room?.target).toBe(TARGET);
    expect(room?.teamMode).toBe('manual');

    await playMatch(players);

    // The result was persisted and the room says so.
    await until(() => players.every((s) => s.latest().tournament?.saved === true));
    const finalRoom = players[0]?.latest();
    const winnerTeam = finalRoom?.matchWinner as 0 | 1;
    const scores = finalRoom?.game?.scores as [number, number];
    expect(scores[winnerTeam]).toBeGreaterThanOrEqual(TARGET);

    const stored = app.store.load(created.id);
    expect(stored?.matches).toHaveLength(1);
    const m = stored?.matches[0];
    expect(m).toMatchObject({
      jornada: 1,
      slot: 1,
      winnerPair: winnerTeam + 1,
      scorePair1: scores[0],
      scorePair2: scores[1],
      roomId: play.roomId,
      voidedAt: null,
    });
    expect((m?.hands as unknown[]).length).toBeGreaterThan(0);

    // Everyone — players and the extra viewer — got the pushed update, no polling.
    await until(() =>
      [...players, viewer].every(
        (s) => s.tlatest().jornadas[0]?.matches[0]?.status === 'terminado',
      ),
    );
    const t = viewer.tlatest();
    expect(t.played).toBe(1);
    expect(t.next).toEqual({ jornada: 1, slot: 2, number: 2 });
    const result = t.jornadas[0]?.matches[0]?.result;
    expect(result).toMatchObject({ winnerPair: winnerTeam + 1, scorePair1: scores[0] });
    const pairing = t.jornadas[0]?.matches[0]?.pairing as string;
    const [pair1, pair2] = pairing.split('-') as [string, string];
    const winners = winnerTeam === 0 ? pair1 : pair2;
    for (const row of t.standings) {
      expect(row.pj).toBe(1);
      expect(row.pg).toBe(winners.includes(row.letter) ? 1 : 0);
      expect(row.pts).toBe(winners.includes(row.letter) ? (result?.shutout ? 1.5 : 1) : 0);
    }
    expect(t.standings[0]?.rank).toBe(1);

    // "Jugar" now points at the next slot, and opens a different room.
    const next = await call<{ roomId: string }>(players[1] as Client, 'tournament:play');
    expect(next.ok && next.roomId).not.toBe(play.roomId);
    expect(app.store.load(created.id)?.matches).toHaveLength(1);
  });

  it('rejects people who are not the four players of the tournament room', async () => {
    const { created, players, entered } = await fourPlayers();
    const play = await call<{ roomId: string }>(players[0] as Client, 'tournament:play');
    if (!play.ok) throw new Error(play.code);
    await joinGameRoom(players.slice(0, 3), entered.slice(0, 3), play.roomId);

    const intruder = await client();
    expect(await call(intruder, 'room:join', { roomId: play.roomId, name: 'Eva' })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(
      await call(intruder, 'room:join', { roomId: play.roomId, tt: 'AAAAAAAAAAAAAAAAAAAAAAAA' }),
    ).toEqual({ ok: false, code: 'NOT_FOUND' });

    // A player of ANOTHER tournament is not welcome either.
    const [otherCreator, otherPlayer] = await Promise.all([client(), client()]);
    const other = await createTournament(otherCreator);
    const foreign = await enterAs(otherPlayer, other.id, NAMES[0] as string);
    expect(
      await call(otherPlayer, 'room:join', { roomId: play.roomId, tt: foreign.token }),
    ).toEqual({ ok: false, code: 'NOT_FOUND' });

    // The fourth registered player does get in, and no fifth person ever can.
    const [fourth] = await joinGameRoom(
      [players[3] as Client],
      [entered[3] as TournamentEntered],
      play.roomId,
    );
    expect(fourth?.roomId).toBe(play.roomId);
    expect(await call(intruder, 'room:join', { roomId: play.roomId, name: 'Eva' })).toMatchObject({
      ok: false,
    });
    expect(created.players).toHaveLength(4);
  });

  it('locks the room settings against the host', async () => {
    const { players, entered } = await fourPlayers();
    const play = await call<{ roomId: string }>(players[0] as Client, 'tournament:play');
    if (!play.ok) throw new Error(play.code);
    await joinGameRoom(players, entered, play.roomId);
    const host = players.find(
      (s) => s.latest().players.find((p) => p.id === s.latest().youId)?.isHost,
    );
    expect(host).toBeDefined();
    const h = host as Client;
    expect(await call(h, 'lobby:target', { target: 200 })).toEqual({ ok: false, code: 'LOCKED' });
    expect(await call(h, 'lobby:mode', { mode: 'sortear' })).toEqual({ ok: false, code: 'LOCKED' });
    expect(await call(h, 'lobby:addBot')).toEqual({ ok: false, code: 'LOCKED' });
    expect(await call(h, 'lobby:sit', { seat: 1 })).toEqual({ ok: false, code: 'LOCKED' });
    expect(await call(h, 'match:rematch', { keepTeams: true })).toEqual({
      ok: false,
      code: 'LOCKED',
    });
    expect(h.latest().target).toBe(TARGET);
  });

  it('records nothing and frees the slot when the room is abandoned', async () => {
    const { created, players, entered } = await fourPlayers();
    const play = await call<{ roomId: string }>(players[0] as Client, 'tournament:play');
    if (!play.ok) throw new Error(play.code);
    await joinGameRoom(players, entered, play.roomId);
    await call(players[0] as Client, 'lobby:start');
    await until(() => players.every((s) => s.latest().phase === 'draw'));
    app.rooms.delete(play.roomId); // the room dies (expiry / server decision)
    await until(() => players[2]?.tlatest().jornadas[0]?.matches[0]?.status === 'pendiente');
    expect(app.store.load(created.id)?.matches).toHaveLength(0);
    expect(app.rooms.size).toBe(0);
    // Pressing Jugar again opens a fresh room for the same slot.
    const again = await call<{ roomId: string }>(players[1] as Client, 'tournament:play');
    expect(again.ok && again.roomId).not.toBe(play.roomId);
  });

  it('exports every record, voided ones included', async () => {
    const { created, players } = await fourPlayers();
    const res = await call<{ data: { matches: unknown[]; players: unknown[]; format: string } }>(
      players[0] as Client,
      'tournament:export',
    );
    expect(res.ok && res.data.format).toBe('domino-torneo/1');
    expect(res.ok && res.data.players).toHaveLength(4);
    expect(app.store.load(created.id)?.id).toBe(created.id);
  });
});

describe('restart', () => {
  it('keeps tournaments, identities, schedule and results across a server restart', async () => {
    const { created, players, entered } = await fourPlayers();
    const before = app.store.load(created.id);
    const play = await call<{ roomId: string }>(players[0] as Client, 'tournament:play');
    if (!play.ok) throw new Error(play.code);
    await joinGameRoom(players, entered, play.roomId);
    await playMatch(players);
    await until(() => players.every((s) => s.latest().tournament?.saved === true));
    const standings = app.tournaments.view(created.id)?.standings;
    expect(app.rooms.size).toBe(1);

    clients.splice(0).forEach((c) => c.disconnect());
    await app.close();
    app = createApp(options({ rng: mulberry32(99) })); // same file, different RNG
    await listen(app);

    const c = await client();
    // Rooms are gone…
    expect(app.rooms.size).toBe(0);
    // …but the device token still identifies the player, with the same schedule and table.
    const again = await call<TournamentEntered>(c, 'tournament:enter', {
      id: created.id,
      token: entered[2]?.token,
    });
    if (!again.ok) throw new Error(again.code);
    expect(again.you).toEqual(entered[2]?.you);
    expect(again.view.standings).toEqual(standings);
    expect(again.view.played).toBe(1);
    expect(again.view.jornadas[0]?.matches.map((m) => m.pairing)).toEqual(
      before?.jornadas[0]?.matchOrder,
    );
    expect(again.view.jornadas[0]?.matches[0]?.status).toBe('terminado');
    // The letters never change.
    expect(again.view.players).toEqual(
      created.players.slice().sort((a, b) => a.letter.localeCompare(b.letter)),
    );
    const letters: Letter[] = again.view.players.map((p) => p.letter);
    expect(letters).toEqual([...LETTERS]);
  });
});
