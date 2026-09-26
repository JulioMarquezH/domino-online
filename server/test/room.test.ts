import {
  legalMoves,
  mulberry32,
  partnerOf,
  screenPosition,
  type RoomView,
  type Seat,
} from '@domino/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { RoomManager } from '../src/rooms';
import type { Room } from '../src/room';
import { FakeClock } from './helpers';

const TIMINGS = {
  pauseMs: 120_000,
  lobbyGraceMs: 5_000,
  emptyRoomTtlMs: 600_000,
  drawRevealMs: 4_000,
  nextHandMs: 20_000,
};

let clock: FakeClock;
let manager: RoomManager;
let room: Room;
let ids: string[];

function setup(seed = 1) {
  clock = new FakeClock();
  manager = new RoomManager({ clock, timings: TIMINGS, rng: mulberry32(seed), onChange: () => {} });
  room = manager.create();
  ids = ['Ana', 'Beto', 'Caro', 'Dani'].map((name, i) => {
    const r = room.join({ name, token: null }, `s${i}`);
    if (!r.ok) throw new Error(r.code);
    return r.player.id;
  });
}

const view = (i: number): RoomView => room.viewFor(ids[i] as string);
const host = () => room.hostId as string;

function runDraw() {
  ids.forEach((id, i) => expect(room.pick(id, i * 3)).toEqual({ ok: true }));
  clock.advance(TIMINGS.drawRevealMs);
  expect(room.phase).toBe('playing');
}

/** Plays random legal moves for whoever's turn it is until the hand ends. */
function playOutHand(rng = mulberry32(5)) {
  while (room.phase === 'playing') {
    const v = view(0);
    const turn = v.game?.turn as Seat;
    const idx = ids.findIndex((id) => room.getPlayer(id)?.seat === turn);
    const mine = room.viewFor(ids[idx] as string).game;
    if (!mine) throw new Error('no game');
    const moves = legalMoves(mine.hand, mine.line);
    const move = moves[Math.floor(rng() * moves.length)];
    const r = move
      ? room.play(ids[idx] as string, move.tile, move.end, room.version)
      : room.pass(ids[idx] as string, room.version);
    expect(r).toEqual({ ok: true });
  }
}

beforeEach(() => setup());

describe('lobby', () => {
  it('rejects a fifth player and duplicate names', () => {
    expect(room.join({ name: 'Eva', token: null }, 's9')).toEqual({ ok: false, code: 'FULL' });
    const other = manager.create();
    other.join({ name: 'Ana', token: null }, 'x1');
    expect(other.join({ name: '  ana ', token: null }, 'x2')).toEqual({
      ok: false,
      code: 'NAME_TAKEN',
    });
    expect(other.join({ name: '   ', token: null }, 'x3')).toEqual({
      ok: false,
      code: 'NAME_INVALID',
    });
    expect(other.join({ name: 'x'.repeat(21), token: null }, 'x4')).toEqual({
      ok: false,
      code: 'NAME_INVALID',
    });
  });

  it('only the host changes settings and starts; manual mode needs everyone seated', () => {
    expect(host()).toBe(ids[0]);
    expect(room.setTarget(ids[1] as string, 150)).toEqual({ ok: false, code: 'NOT_HOST' });
    expect(room.setTarget(host(), 200)).toEqual({ ok: true });
    expect(room.setTeamMode(host(), 'manual')).toEqual({ ok: true });
    expect(room.start(host())).toEqual({ ok: false, code: 'NOT_READY' });
    ids.forEach((id, i) => room.sit(id, i as Seat));
    expect(room.sit(ids[0] as string, 1)).toEqual({ ok: false, code: 'TAKEN' });
    expect(room.start(host())).toEqual({ ok: true });
    expect(room.phase).toBe('draw');
  });

  it('frees a lobby slot after a disconnection, but the token still reclaims it', () => {
    const token = room.getPlayer(ids[1] as string)?.token as string;
    room.detach(ids[1] as string, 's1');
    clock.advance(TIMINGS.lobbyGraceMs);
    expect(room.players).toHaveLength(3);
    const back = room.join({ name: 'Beto', token }, 's1b');
    expect(back.ok && back.player.token).toBe(token);
    expect(room.players).toHaveLength(4);
  });

  it('passes the host to the next player to the right when the host leaves', () => {
    room.leave(ids[0] as string, 's0');
    expect(host()).toBe(ids[1]);
  });
});

describe('draw', () => {
  it('Sortear: partners are the two highest tiles and the highest leads', () => {
    room.start(host());
    ids.forEach((id, i) => room.pick(id, i));
    const outcome = view(0).draw?.outcome;
    expect(outcome).toBeTruthy();
    if (!outcome) return;
    const [first, second, third, fourth] = outcome.ranking as [string, string, string, string];
    const seats = outcome.seats;
    expect(partnerOf(seats[first] as Seat)).toBe(seats[second]);
    expect(partnerOf(seats[third] as Seat)).toBe(seats[fourth]);
    expect(outcome.starterId).toBe(first);
    clock.advance(TIMINGS.drawRevealMs);
    expect(view(0).game?.turn).toBe(seats[first]);
    expect(view(0).game?.hand).toHaveLength(7);
  });

  it('rejects picking twice or a taken position', () => {
    room.start(host());
    expect(room.pick(ids[0] as string, 5)).toEqual({ ok: true });
    expect(room.pick(ids[0] as string, 6)).toEqual({ ok: false, code: 'TAKEN' });
    expect(room.pick(ids[1] as string, 5)).toEqual({ ok: false, code: 'TAKEN' });
    expect(room.pick(ids[1] as string, 28)).toEqual({ ok: false, code: 'INVALID' });
  });
});

describe('game flow', () => {
  it('never shows other hands, rejects stale/out-of-turn actions and rotates the starter', () => {
    room.start(host());
    runDraw();
    const starters: Seat[] = [];
    for (let hand = 0; hand < 3; hand++) {
      const g = view(0).game;
      if (!g) throw new Error('no game');
      starters.push(g.starter);
      for (let i = 0; i < 4; i++) {
        const v = view(i);
        expect(v.handResult).toBeNull();
        expect(Object.keys(v.game ?? {})).not.toContain('hands');
      }
      // Out of turn and stale versions are rejected.
      const notTurn = ids.find((id) => room.getPlayer(id)?.seat !== g.turn) as string;
      expect(room.pass(notTurn, room.version)).toEqual({ ok: false, code: 'NOT_YOUR_TURN' });
      const turnId = ids.find((id) => room.getPlayer(id)?.seat === g.turn) as string;
      expect(room.pass(turnId, room.version - 1)).toEqual({ ok: false, code: 'STALE' });
      playOutHand(mulberry32(hand + 10));
      if (room.phase === 'matchEnd') break;
      expect(room.phase).toBe('handEnd');
      expect(view(2).handResult?.hands).toHaveLength(4);
      ids.forEach((id) => room.markReady(id));
    }
    for (let i = 1; i < starters.length; i++) {
      expect(starters[i]).toBe(((starters[i - 1] as Seat) + 1) % 4);
    }
  });

  it('auto-continues after the summary countdown', () => {
    room.start(host());
    runDraw();
    playOutHand();
    if (room.phase !== 'handEnd') return;
    expect(view(0).nextHandInMs).toBe(TIMINGS.nextHandMs);
    clock.advance(TIMINGS.nextHandMs);
    expect(room.phase).toBe('playing');
    expect(view(0).game?.handNumber).toBe(2);
  });

  it('plays a whole match to the target', () => {
    room.start(host());
    runDraw();
    let hands = 0;
    while (room.phase !== 'matchEnd') {
      playOutHand(mulberry32(100 + hands));
      hands++;
      if (room.phase === 'handEnd') clock.advance(TIMINGS.nextHandMs);
      if (hands > 100) throw new Error('too many hands');
    }
    const v = view(0);
    expect(v.matchWinner).not.toBeNull();
    expect(v.game?.scores[v.matchWinner as 0 | 1]).toBeGreaterThanOrEqual(100);
    // Rematch keeping teams: seats unchanged, a new draw starts.
    const seatsBefore = ids.map((id) => room.getPlayer(id)?.seat);
    expect(room.rematch(host(), true)).toEqual({ ok: true });
    expect(room.phase).toBe('draw');
    runDraw();
    expect(ids.map((id) => room.getPlayer(id)?.seat)).toEqual(seatsBefore);
    expect(view(0).game?.scores).toEqual([0, 0]);
  });
});

describe('disconnections', () => {
  beforeEach(() => {
    room.start(host());
    runDraw();
  });

  it('pauses, lets the host wait more, and resumes when the player returns', () => {
    const p1 = room.getPlayer(ids[1] as string);
    const token = p1?.token as string;
    const handBefore = view(1).game?.hand;
    room.detach(ids[1] as string, 's1');
    expect(room.isPaused).toBe(true);
    expect(view(0).pause).toMatchObject([
      { playerId: ids[1], expired: false, remainingMs: 120_000 },
    ]);
    const turnId = ids.find((id) => room.getPlayer(id)?.seat === view(0).game?.turn) as string;
    expect(room.pass(turnId, room.version)).toEqual({ ok: false, code: 'PAUSED' });
    expect(room.decide(host(), ids[1] as string, 'wait')).toEqual({ ok: false, code: 'NOT_READY' });
    clock.advance(120_000);
    expect(view(0).pause[0]?.expired).toBe(true);
    expect(room.decide(ids[2] as string, ids[1] as string, 'wait')).toEqual({
      ok: false,
      code: 'NOT_HOST',
    });
    expect(room.decide(host(), ids[1] as string, 'wait')).toEqual({ ok: true });
    expect(view(0).pause[0]).toMatchObject({ expired: false, remainingMs: 120_000 });
    const back = room.join({ name: null, token }, 's1-new');
    expect(back.ok && back.player.id).toBe(ids[1]);
    expect(room.isPaused).toBe(false);
    expect(view(1).game?.hand).toEqual(handBefore);
  });

  it('allows a replacement who inherits the seat and hand', () => {
    const seat = room.getPlayer(ids[3] as string)?.seat;
    const hand = view(3).game?.hand;
    room.detach(ids[3] as string, 's3');
    expect(room.join({ name: 'Eva', token: null }, 's9')).toEqual({ ok: false, code: 'FULL' });
    clock.advance(120_000);
    expect(room.decide(host(), ids[3] as string, 'replace')).toEqual({ ok: true });
    expect(room.join({ name: 'Ana', token: null }, 's9')).toEqual({
      ok: false,
      code: 'NAME_TAKEN',
    });
    const eva = room.join({ name: 'Eva', token: null }, 's9');
    if (!eva.ok) throw new Error(eva.code);
    expect(eva.player.seat).toBe(seat);
    expect(room.viewFor(eva.player.id).game?.hand).toEqual(hand);
    expect(room.isPaused).toBe(false);
  });

  it('ends the match and returns to the lobby when the host decides so', () => {
    room.detach(ids[2] as string, 's2');
    clock.advance(120_000);
    expect(room.decide(host(), ids[2] as string, 'end')).toEqual({ ok: true });
    expect(room.phase).toBe('lobby');
    expect(room.players).toHaveLength(3);
  });

  it('moves the host to the right mid-game', () => {
    const hostSeat = room.getPlayer(host())?.seat as Seat;
    const oldHost = host();
    room.detach(oldHost, `s${ids.indexOf(oldHost)}`);
    const newHostSeat = room.getPlayer(host())?.seat as Seat;
    expect(screenPosition(hostSeat, newHostSeat)).toBe('right');
  });

  it('deletes the room 10 minutes after everyone left', () => {
    ids.forEach((id, i) => room.detach(id, `s${i}`));
    clock.advance(599_999);
    expect(manager.get(room.id)).toBe(room);
    clock.advance(1);
    expect(manager.get(room.id)).toBeUndefined();
  });
});
