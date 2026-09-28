import { chooseAction, knowledgeOf, mulberry32, type RoomView } from '@domino/shared';
import { describe, expect, it } from 'vitest';
import type { Room } from '../src/room';
import { RoomManager } from '../src/rooms';
import { FakeClock } from './helpers';

const TIMINGS = {
  pauseMs: 120_000,
  lobbyGraceMs: 5_000,
  emptyRoomTtlMs: 600_000,
  drawRevealMs: 4_000,
  nextHandMs: 20_000,
  botMinMs: 900,
  botMaxMs: 900,
  botBudget: 120,
};

function setup() {
  const clock = new FakeClock();
  const manager = new RoomManager({
    clock,
    timings: TIMINGS,
    rng: mulberry32(3),
    onChange: () => {},
  });
  const room = manager.create();
  const me = room.join({ name: 'Julio', token: null }, 's0');
  if (!me.ok) throw new Error(me.code);
  return { clock, manager, room, me: me.player.id };
}

/** The human also lets the AI decide, so the whole match runs on the fake clock. */
function humanPlays(room: Room, id: string) {
  const p = room.getPlayer(id);
  const hands = room.debugHands();
  if (!p || p.seat === null || !hands || room.phase !== 'playing') return;
  const v: RoomView = room.viewFor(id);
  if (v.game?.turn !== p.seat || v.pause.length) return;
  const state = (room as unknown as { match: { hand: Parameters<typeof knowledgeOf>[0] } }).match
    .hand;
  const a = chooseAction(knowledgeOf(state, p.seat), mulberry32(v.version), { budget: 200 });
  const r =
    a.type === 'pass'
      ? room.pass(id, room.version)
      : room.play(id, a.tile, a.end ?? 'left', room.version);
  expect(r).toEqual({ ok: true });
}

describe('AI players', () => {
  it('lets one person play a whole match against three AIs', () => {
    const { clock, room, me } = setup();
    for (let i = 0; i < 3; i++) expect(room.addBot(me)).toEqual({ ok: true });
    expect(room.addBot(me)).toEqual({ ok: false, code: 'TAKEN' });
    const v = room.viewFor(me);
    expect(v.players.filter((p) => p.isBot)).toHaveLength(3);
    expect(v.players.filter((p) => p.isBot).every((p) => p.voiceSession === null)).toBe(true);
    expect(room.start(me)).toEqual({ ok: true });

    room.pick(me, 0);
    clock.advance(900); // the AIs pick their draw tiles
    expect(room.viewFor(me).draw?.picks).toHaveLength(4);
    clock.advance(TIMINGS.drawRevealMs);
    expect(room.phase).toBe('playing');

    let steps = 0;
    while (room.phase !== 'matchEnd') {
      if (++steps > 5000) throw new Error('match did not finish');
      humanPlays(room, me);
      if (room.phase === 'handEnd') {
        // AIs are always ready: one "Continuar" from the human is enough.
        expect(room.viewFor(me).ready.length).toBe(3);
        room.markReady(me);
        continue;
      }
      clock.advance(900);
    }
    const end = room.viewFor(me);
    expect(end.matchWinner).not.toBeNull();
    expect(Math.max(...(end.game?.scores ?? [0]))).toBeGreaterThanOrEqual(100);
  });

  it('a friend joining a full lobby takes an AI seat; only the host adds or removes AIs', () => {
    const { room, me } = setup();
    const b = room.join({ name: 'Beto', token: null }, 's1');
    if (!b.ok) throw new Error(b.code);
    expect(room.addBot(b.player.id)).toEqual({ ok: false, code: 'NOT_HOST' });
    room.addBot(me);
    room.addBot(me);
    expect(room.players).toHaveLength(4);
    const c = room.join({ name: 'Caro', token: null }, 's2');
    expect(c.ok).toBe(true);
    expect(room.players.filter((p) => p.isBot)).toHaveLength(1);
    const bot = room.players.find((p) => p.isBot);
    expect(room.removeBot(me, bot?.id as string)).toEqual({ ok: true });
    expect(room.players).toHaveLength(3);
  });

  it('never makes an AI the host, and a room with only AIs left expires', () => {
    const { clock, manager, room, me } = setup();
    room.addBot(me);
    room.leave(me, 's0');
    expect(room.hostId).not.toBe(room.players[0]?.id);
    clock.advance(TIMINGS.emptyRoomTtlMs);
    expect(manager.get(room.id)).toBeUndefined();
  });

  it('can take over a disconnected seat, and the player gets it back on return', () => {
    const { clock, room, me } = setup();
    const b = room.join({ name: 'Beto', token: null }, 's1');
    if (!b.ok) throw new Error(b.code);
    room.addBot(me);
    room.addBot(me);
    room.start(me);
    room.pick(me, 1);
    room.pick(b.player.id, 2);
    clock.advance(900);
    clock.advance(TIMINGS.drawRevealMs);
    expect(room.phase).toBe('playing');
    const token = b.player.token;
    const hand = room.viewFor(b.player.id).game?.hand;
    room.detach(b.player.id, 's1');
    clock.advance(TIMINGS.pauseMs);
    expect(room.decide(me, b.player.id, 'bot')).toEqual({ ok: true });
    expect(room.isPaused).toBe(false);
    expect(room.getPlayer(b.player.id)?.isBot).toBe(true);
    // Beto comes back with his token: the seat is his again.
    const back = room.join({ name: null, token }, 's1b');
    expect(back.ok && back.player.id).toBe(b.player.id);
    expect(room.getPlayer(b.player.id)?.isBot).toBe(false);
    expect(room.viewFor(b.player.id).game?.hand.length).toBeLessThanOrEqual(hand?.length ?? 7);
  });
});
