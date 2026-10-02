import {
  legalMoves,
  mulberry32,
  type Letter,
  type RoomView,
  type Seat,
  type Target,
} from '@domino/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchOutcome, Room, TournamentRoomSpec } from '../src/room';
import { RoomManager } from '../src/rooms';
import { FakeClock } from './helpers';

const TIMINGS = {
  pauseMs: 120_000,
  lobbyGraceMs: 5_000,
  emptyRoomTtlMs: 600_000,
  drawRevealMs: 4_000,
  nextHandMs: 20_000,
};

// Pair 1 = A+B on seats 0/2, pair 2 = C+D on seats 1/3. Target 30 keeps matches short.
const SPEC: TournamentRoomSpec = {
  tournamentId: 'ABCDEFGHJKMN',
  jornada: 1,
  slot: 2,
  number: 2,
  pairing: 'AB-CD',
  target: 30 as Target,
  seats: {
    A: { seat: 0, name: 'Ana' },
    C: { seat: 1, name: 'Caro' },
    B: { seat: 2, name: 'Beto' },
    D: { seat: 3, name: 'Dani' },
  },
};

let clock: FakeClock;
let manager: RoomManager;
let room: Room;
let recorded: MatchOutcome[];
let record: (o: MatchOutcome) => void;
let changes: number;
const ids: Partial<Record<Letter, string>> = {};

function setup(seed = 4) {
  clock = new FakeClock();
  recorded = [];
  changes = 0;
  record = (o) => void recorded.push(o);
  manager = new RoomManager({
    clock,
    timings: TIMINGS,
    rng: mulberry32(seed),
    onChange: () => void changes++,
  });
  room = manager.create({ spec: SPEC, record: (o) => record(o) });
}

function seatAll() {
  for (const [i, letter] of (['A', 'B', 'C', 'D'] as Letter[]).entries()) {
    const r = room.join({ name: null, token: null, identity: { letter } }, `s${i}`);
    if (!r.ok) throw new Error(r.code);
    ids[letter] = r.player.id;
  }
}

const id = (l: Letter) => ids[l] as string;
const view = (l: Letter): RoomView => room.viewFor(id(l));
const host = () => room.hostId as string;

function startDraw() {
  expect(room.start(host())).toEqual({ ok: true });
  (['A', 'B', 'C', 'D'] as Letter[]).forEach((l, i) =>
    expect(room.pick(id(l), i * 3)).toEqual({ ok: true }),
  );
  clock.advance(TIMINGS.drawRevealMs);
  expect(room.phase).toBe('playing');
}

/** Random legal moves until the match ends (continuing every hand summary). */
function playToEnd(rng = mulberry32(9)) {
  for (let guard = 0; guard < 4000 && room.phase !== 'matchEnd'; guard++) {
    if (room.phase === 'handEnd') {
      clock.advance(TIMINGS.nextHandMs);
      continue;
    }
    const turn = view('A').game?.turn as Seat;
    const letter = (['A', 'B', 'C', 'D'] as Letter[]).find(
      (l) => room.getPlayer(id(l))?.seat === turn,
    ) as Letter;
    const mine = view(letter).game;
    if (!mine) throw new Error('no game');
    const moves = legalMoves(mine.hand, mine.line);
    const move = moves[Math.floor(rng() * moves.length)];
    const r = move
      ? room.play(id(letter), move.tile, move.end, room.version)
      : room.pass(id(letter), room.version);
    expect(r).toEqual({ ok: true });
  }
  expect(room.phase).toBe('matchEnd');
}

beforeEach(() => {
  setup();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('tournament room: who can sit', () => {
  it('seats the four registered players at the seats their pairing gives them', () => {
    seatAll();
    const v = view('A');
    expect(v.players.map((p) => [p.name, p.letter, p.seat])).toEqual([
      ['Ana', 'A', 0],
      ['Beto', 'B', 2],
      ['Caro', 'C', 1],
      ['Dani', 'D', 3],
    ]);
    expect(v.target).toBe(30);
    expect(v.tournament).toEqual({
      id: SPEC.tournamentId,
      jornada: 1,
      slot: 2,
      number: 2,
      pairing: 'AB-CD',
      saved: false,
    });
  });

  it('rejects anyone without a registered identity, and a fifth player', () => {
    seatAll();
    expect(room.join({ name: 'Eva', token: null }, 'x1')).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(room.join({ name: null, token: 'not-a-room-token-123456' }, 'x2')).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
    // A letter that is not part of the room's four seats.
    expect(
      room.join({ name: null, token: null, identity: { letter: 'Z' as Letter } }, 'x3'),
    ).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(room.players).toHaveLength(4);
  });

  it('ignores the typed name: the registered name is used', () => {
    const r = room.join({ name: 'Impostor', token: null, identity: { letter: 'B' } }, 's1');
    expect(r.ok && r.player.name).toBe('Beto');
  });

  it('lets a player come back from another device and takes the old socket over', () => {
    seatAll();
    const again = room.join({ name: null, token: null, identity: { letter: 'C' } }, 'other-device');
    expect(again).toMatchObject({ ok: true, previousSocketId: 's2' });
    expect(room.players).toHaveLength(4);
    expect(room.getPlayer(id('C'))?.socketId).toBe('other-device');
  });

  it('reclaims with the room token after a disconnect, mid-match', () => {
    seatAll();
    startDraw();
    const token = room.getPlayer(id('D'))?.token as string;
    room.detach(id('D'), 's3');
    expect(view('A').pause).toHaveLength(1);
    const back = room.join({ name: null, token }, 's9');
    expect(back).toMatchObject({ ok: true });
    expect(view('A').pause).toHaveLength(0);
    expect(room.getPlayer(id('D'))?.seat).toBe(3);
  });

  it('does not admit a newcomer to a started match (no substitutes)', () => {
    seatAll();
    startDraw();
    room.detach(id('D'), 's3');
    clock.advance(TIMINGS.pauseMs);
    expect(room.join({ name: 'Eva', token: null }, 'x')).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(room.join({ name: null, token: null, identity: { letter: 'D' } }, 'back')).toMatchObject(
      {
        ok: true,
      },
    );
  });
});

describe('tournament room: locked settings', () => {
  it('refuses target, team mode, seats, AIs and rematch', () => {
    seatAll();
    const h = host();
    expect(room.setTarget(h, 200)).toEqual({ ok: false, code: 'LOCKED' });
    expect(room.setTeamMode(h, 'sortear')).toEqual({ ok: false, code: 'LOCKED' });
    expect(room.sit(id('A'), 3)).toEqual({ ok: false, code: 'LOCKED' });
    expect(room.addBot(h)).toEqual({ ok: false, code: 'LOCKED' });
    expect(room.removeBot(h, id('B'))).toEqual({ ok: false, code: 'LOCKED' });
    expect(room.target).toBe(30);
    expect(room.teamMode).toBe('manual');
  });

  it('keeps the starter draw, with the preset teams', () => {
    seatAll();
    expect(room.start(host())).toEqual({ ok: true });
    const draw = view('A').draw;
    expect(draw?.mode).toBe('starter');
    startDraw2();
    function startDraw2() {
      (['A', 'B', 'C', 'D'] as Letter[]).forEach((l, i) => room.pick(id(l), i * 5));
      clock.advance(TIMINGS.drawRevealMs);
    }
    expect(room.phase).toBe('playing');
    // Teams did not change: A+B on seats 0/2.
    expect(view('A').players.map((p) => p.seat)).toEqual([0, 1, 2, 3]);
  });

  it('does not offer AI takeover or replacement seats when a player is gone', () => {
    seatAll();
    startDraw();
    room.detach(id('D'), 's3');
    clock.advance(TIMINGS.pauseMs);
    expect(view('A').pause[0]).toMatchObject({ expired: true });
    expect(room.decide(host(), id('D'), 'bot')).toEqual({ ok: false, code: 'LOCKED' });
    expect(room.decide(host(), id('D'), 'replace')).toEqual({ ok: false, code: 'LOCKED' });
    expect(room.getPlayer(id('D'))?.isBot).toBe(false);
  });
});

describe('tournament room: recording the result', () => {
  it('persists the finished match exactly once, before saying it is saved', () => {
    seatAll();
    startDraw();
    const savedAtRecord: boolean[] = [];
    record = (o) => {
      savedAtRecord.push(room.viewFor(id('A')).tournament?.saved ?? true);
      recorded.push(o);
    };
    playToEnd();
    expect(recorded).toHaveLength(1);
    expect(savedAtRecord).toEqual([false]); // still "not saved" while the write happens
    const final = view('A');
    expect(final.tournament?.saved).toBe(true);
    expect(final.pause).toEqual([]);

    const o = recorded[0] as MatchOutcome;
    expect(o).toMatchObject({ roomId: room.id, spec: SPEC });
    const winnerTeam = final.matchWinner as 0 | 1;
    expect(o.winnerPair).toBe(winnerTeam + 1);
    expect(final.game?.scores).toEqual([o.scorePair1, o.scorePair2]);
    expect(Math.max(o.scorePair1, o.scorePair2)).toBeGreaterThanOrEqual(30);
    expect(o.hands.length).toBeGreaterThan(0);
    expect(o.hands.at(-1)?.scores).toEqual([o.scorePair1, o.scorePair2]);
    expect(o.startedAt).not.toBeNull();
    expect(Date.parse(o.endedAt)).toBeGreaterThanOrEqual(Date.parse(o.startedAt as string));

    // Nothing else can record it again: no rematch, no more plays, time passing.
    expect(room.rematch(host(), true)).toEqual({ ok: false, code: 'LOCKED' });
    clock.advance(3_600_000);
    expect(recorded).toHaveLength(1);
  });

  it('keeps the room alive and retries with backoff when the write fails', () => {
    seatAll();
    startDraw();
    let broken = true;
    const attempts: number[] = [];
    record = (o) => {
      attempts.push(clock.now());
      if (broken) throw new Error('disk I/O error');
      recorded.push(o);
    };
    playToEnd();
    expect(recorded).toHaveLength(0);
    expect(view('A').tournament?.saved).toBe(false);
    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toContain('CRITICAL');

    // Everybody leaves and the empty-room TTL passes: the unsaved room must survive.
    (['A', 'B', 'C', 'D'] as Letter[]).forEach((l, i) => room.detach(id(l), `s${i}`));
    clock.advance(TIMINGS.emptyRoomTtlMs + 1);
    expect(manager.get(room.id)).toBe(room);
    expect(recorded).toHaveLength(0);

    // Exponential backoff: 1 s, 2 s, 4 s, 8 s, 16 s, then every 30 s.
    const gaps = attempts.slice(1, 8).map((t, i) => t - (attempts[i] as number));
    expect(gaps).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);

    const before = changes;
    broken = false;
    clock.advance(30_000);
    expect(recorded).toHaveLength(1);
    expect(room.viewFor(id('A')).tournament?.saved).toBe(true);
    expect(changes).toBeGreaterThan(before); // the "saved" state was broadcast

    // Once stored, the empty room can expire as usual — and the result is never written twice.
    clock.advance(TIMINGS.emptyRoomTtlMs + 1);
    expect(manager.get(room.id)).toBeUndefined();
    expect(recorded).toHaveLength(1);
  });

  it('records nothing when the host ends the match early; the slot can be replayed', () => {
    seatAll();
    startDraw();
    room.detach(id('D'), 's3');
    clock.advance(TIMINGS.pauseMs);
    expect(room.decide(host(), id('D'), 'end')).toEqual({ ok: true });
    expect(room.phase).toBe('lobby');
    expect(recorded).toHaveLength(0);
    expect(view('A').players).toHaveLength(3);

    // The missing player returns to the lobby and the match starts again from zero.
    const back = room.join({ name: null, token: null, identity: { letter: 'D' } }, 's7');
    if (!back.ok) throw new Error(back.code);
    ids.D = back.player.id;
    startDraw();
    expect(view('A').game?.scores).toEqual([0, 0]);
    playToEnd();
    expect(recorded).toHaveLength(1);
  });

  it('records nothing if the room simply dies', () => {
    seatAll();
    startDraw();
    (['A', 'B', 'C', 'D'] as Letter[]).forEach((l, i) => room.detach(id(l), `s${i}`));
    clock.advance(TIMINGS.emptyRoomTtlMs + 1);
    expect(manager.get(room.id)).toBeUndefined();
    expect(recorded).toHaveLength(0);
  });

  it('makes a last attempt to store a pending result when the room is disposed', () => {
    seatAll();
    startDraw();
    let fail = true;
    record = (o) => {
      if (fail) throw new Error('locked');
      recorded.push(o);
    };
    playToEnd();
    fail = false;
    manager.dispose();
    expect(recorded).toHaveLength(1);
  });
});

describe('casual rooms are untouched', () => {
  it('carry no tournament fields and keep every lobby control', () => {
    const casual = manager.create();
    const a = casual.join({ name: 'Ana', token: null }, 'c0');
    if (!a.ok) throw new Error(a.code);
    const v = casual.viewFor(a.player.id);
    expect(v.tournament).toBeUndefined();
    expect('tournament' in v).toBe(false);
    expect(v.players.every((p) => !('letter' in p))).toBe(true);
    expect(casual.tournament).toBeNull();
    expect(casual.setTarget(a.player.id, 150)).toEqual({ ok: true });
    expect(casual.addBot(a.player.id)).toEqual({ ok: true });
    expect(casual.setTeamMode(a.player.id, 'manual')).toEqual({ ok: true });
  });
});
