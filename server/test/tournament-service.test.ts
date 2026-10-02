import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ROOM_ID_ALPHABET,
  TOURNAMENT_ID_LENGTH,
  mulberry32,
  type Letter,
  type Pairing,
  type Target,
  type TournamentView,
} from '@domino/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type Db } from '../src/db/database';
import { TournamentStore } from '../src/db/store';
import { hashToken, newTournamentId } from '../src/ids';
import { RoomManager } from '../src/rooms';
import { TournamentService } from '../src/tournaments';
import { FakeClock, playRoomToEnd } from './helpers';

const TIMINGS = {
  pauseMs: 120_000,
  lobbyGraceMs: 5_000,
  emptyRoomTtlMs: 600_000,
  drawRevealMs: 4_000,
  nextHandMs: 20_000,
};
const NAMES = ['Ana', 'Beto', 'Caro', 'Dani'];

let dir: string;
let db: Db;
let store: TournamentStore;
let clock: FakeClock;
let rooms: RoomManager;
let service: TournamentService;
let pushed: TournamentView[];
const ctx = { ip: '203.0.113.9', socketId: 's' };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'domino-svc-'));
  db = openDatabase(join(dir, 'd.db'));
  clock = new FakeClock();
  const rng = mulberry32(5);
  store = new TournamentStore(db, { now: () => new Date(clock.now()).toISOString(), rng });
  pushed = [];
  service = new TournamentService({
    store,
    getRooms: () => rooms,
    emit: (_id, view) => void pushed.push(view),
    rng,
    target: 30 as Target,
  });
  rooms = new RoomManager({
    clock,
    timings: TIMINGS,
    rng: mulberry32(8),
    onChange: () => undefined,
    onRemoved: (r) => service.roomRemoved(r),
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  rooms.dispose();
  db.close();
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function newTournament() {
  const res = service.create(NAMES, ctx);
  if (!res.ok) throw new Error(res.code);
  return res;
}

function enter(id: string, name: string) {
  const r = service.enter({ id, name }, ctx);
  if (!r.ok) throw new Error(r.code);
  return r;
}

/** Plays the next pending match through a real room, as its four registered players. */
async function playNextMatch(id: string, rng = mulberry32(2)) {
  const play = service.play(id);
  if (!play.ok) throw new Error(play.code);
  const room = rooms.get(play.roomId)!;
  const ids: string[] = [];
  for (const [i, name] of NAMES.entries()) {
    const entered = enter(id, name);
    const joined = room.join(
      { name: null, token: null, identity: { letter: entered.you.letter } },
      `p${i}`,
    );
    if (!joined.ok) throw new Error(joined.code);
    ids.push(joined.player.id);
  }
  expect(room.start(room.hostId as string)).toEqual({ ok: true });
  ids.forEach((pid, i) => room.pick(pid, i * 4));
  clock.advance(TIMINGS.drawRevealMs);
  await playRoomToEnd(room, ids, clock, TIMINGS.nextHandMs, rng);
  return room;
}

describe('ids', () => {
  it('generates long, unambiguous, crypto-random tournament IDs', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const id = newTournamentId();
      expect(id).toHaveLength(TOURNAMENT_ID_LENGTH);
      expect(TOURNAMENT_ID_LENGTH).toBeGreaterThanOrEqual(10);
      for (const c of id) expect(ROOM_ID_ALPHABET).toContain(c);
      expect(id).not.toMatch(/[01OIL]/);
      seen.add(id);
    }
    expect(seen.size).toBe(500);
  });

  it('hashes device tokens (the database never holds the raw token)', () => {
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
    const { id } = newTournament();
    const entered = enter(id, 'Ana');
    const rows = db.prepare('SELECT token_hash FROM tournament_tokens').all();
    expect(JSON.stringify(rows)).not.toContain(entered.token);
  });
});

describe('the whole league', () => {
  it('plays 12 matches: jornadas appear one at a time and match 12 closes the tournament', async () => {
    const { id } = newTournament();
    let view = service.view(id) as TournamentView;
    for (let n = 1; n <= 12; n++) {
      expect(view.status).toBe('active');
      expect(view.next?.number).toBe(n);
      expect(view.jornadas).toHaveLength(Math.ceil(n / 3));
      await playNextMatch(id, mulberry32(n));
      view = service.view(id) as TournamentView;
      expect(view.played).toBe(n);
      expect(view.standings.every((r) => r.pj === n)).toBe(true); // everybody plays every match
    }
    expect(view.status).toBe('finished');
    expect(view.next).toBeNull();
    expect(view.currentJornada).toBeNull();
    expect(view.jornadas).toHaveLength(4); // no jornada 5
    expect(view.champions.length).toBeGreaterThanOrEqual(1);
    expect(view.champions).toEqual(view.standings.filter((r) => r.rank === 1).map((r) => r.letter));
    const totalPoints = view.standings.reduce((sum, r) => sum + r.pts, 0);
    // Every match hands out 2 × (1 or 1.5) points.
    expect(totalPoints).toBeGreaterThanOrEqual(24);
    expect(totalPoints).toBeLessThanOrEqual(36);
    // Each jornada covered the three pairings exactly once.
    for (const j of view.jornadas) {
      expect(j.matches.map((m) => m.pairing).sort()).toEqual(['AB-CD', 'AC-BD', 'AD-BC']);
    }
    // "Jugar" is gone.
    expect(service.play(id)).toEqual({ ok: false, code: 'FINISHED' });
    expect(store.load(id)?.status).toBe('finished');
  }, 30_000);

  it('persists the match exactly once even if the room asks twice', async () => {
    const { id } = newTournament();
    const room = await playNextMatch(id);
    expect(store.load(id)?.matches).toHaveLength(1);
    // Disposing a saved room, or time passing, never writes again.
    rooms.dispose();
    clock.advance(10_000_000);
    expect(store.load(id)?.matches).toHaveLength(1);
    expect(room.isSaved).toBe(true);
  });

  it('retries a failed write until it works and loses nothing', async () => {
    const { id } = newTournament();
    const real = store.recordMatch.bind(store);
    let failures = 3;
    store.recordMatch = (input) => {
      if (failures-- > 0) throw new Error('SQLITE_BUSY');
      return real(input);
    };
    const room = await playNextMatch(id);
    expect(room.isSaved).toBe(false);
    expect(store.load(id)?.matches).toHaveLength(0);
    expect(service.view(id)?.jornadas[0]?.matches[0]?.status).toBe('jugando'); // not "terminado" yet
    clock.advance(1_000 + 2_000 + 4_000);
    expect(room.isSaved).toBe(true);
    expect(store.load(id)?.matches).toHaveLength(1);
    expect(pushed.at(-1)?.jornadas[0]?.matches[0]?.status).toBe('terminado');
  });

  it('voiding a match (admin) makes the slot pending and removes it from the table', async () => {
    const { id } = newTournament();
    await playNextMatch(id);
    await playNextMatch(id);
    expect(service.view(id)?.played).toBe(2);
    store.voidMatch(id, 1, 1, 'se anotó mal');
    const v = service.view(id) as TournamentView;
    expect(v.played).toBe(1);
    expect(v.next).toEqual({ jornada: 1, slot: 1, number: 1 });
    expect(v.jornadas[0]?.matches[0]).toMatchObject({ status: 'pendiente', result: null });
    expect(v.standings.every((r) => r.pj === 1)).toBe(true);
    // The voided slot is replayed from zero.
    await playNextMatch(id);
    expect(service.view(id)?.played).toBe(2);
    expect(store.load(id)?.matches).toHaveLength(3);
  }, 15_000);
});

describe('rooms per slot', () => {
  it('returns the same room until it finishes, then moves to the next slot', async () => {
    const { id } = newTournament();
    const a = service.play(id);
    const b = service.play(id);
    expect(a).toEqual(b);
    expect(rooms.size).toBe(1);
    await playNextMatch(id);
    const next = service.play(id);
    expect(next.ok && a.ok && next.roomId !== a.roomId).toBe(true);
    expect(store.load(id)?.matches).toHaveLength(1);
  });

  it('passes the preset teams and the server-side target to the room', () => {
    const { id } = newTournament();
    const play = service.play(id);
    if (!play.ok) throw new Error(play.code);
    const spec = rooms.get(play.roomId)?.tournament;
    expect(spec?.target).toBe(30);
    const pairing = spec?.pairing as Pairing;
    const [p1, p2] = pairing.split('-') as [string, string];
    const letterAt = (seat: number) =>
      (Object.entries(spec?.seats ?? {}).find(([, v]) => v.seat === seat) as [Letter, unknown])[0];
    // Partners sit opposite each other.
    expect(`${letterAt(0)}${letterAt(2)}`).toBe(p1);
    expect(`${letterAt(1)}${letterAt(3)}`).toBe(p2);
  });
});
