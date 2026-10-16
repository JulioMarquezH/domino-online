import { cleanChatText, mulberry32 } from '@domino/shared';
import { describe, expect, it } from 'vitest';
import { Fun } from '../src/fun';
import { RoomManager } from '../src/rooms';
import { FakeClock } from './helpers';

function setup() {
  const clock = new FakeClock();
  const manager = new RoomManager({ clock, rng: mulberry32(1), onChange: () => {} });
  const room = manager.create();
  const a = room.join({ name: 'Ana', token: null }, 's1');
  const b = room.join({ name: 'Beto', token: null }, 's2');
  if (!a.ok || !b.ok) throw new Error('join');
  return { clock, room, a: a.player.id, b: b.player.id, fun: new Fun(() => clock.now()) };
}

describe('chat, reactions and throwables', () => {
  it('cleans chat lines', () => {
    expect(cleanChatText('  hola \n  mesa  ')).toBe('hola mesa');
    expect(cleanChatText('   ')).toBeNull();
    expect(cleanChatText(42)).toBeNull();
    expect([...(cleanChatText('🍅'.repeat(200)) ?? '')]).toHaveLength(140);
  });

  it('keeps a short chat log and slows down spammers', () => {
    const { clock, room, a, fun } = setup();
    for (let i = 0; i < 5; i++) expect(fun.chat(room, a, `m${i}`).ok).toBe(true);
    expect(fun.chat(room, a, 'otra')).toEqual({ ok: false, code: 'SLOW_DOWN' });
    clock.advance(5_000);
    expect(fun.chat(room, a, 'ya')).toMatchObject({ ok: true });
    expect(fun.log(room).map((e) => (e.kind === 'chat' ? e.text : ''))).toEqual([
      'm0',
      'm1',
      'm2',
      'm3',
      'm4',
      'ya',
    ]);
  });

  it('throws things at a point of the table, with cooldowns', () => {
    const { clock, room, a, b, fun } = setup();
    expect(fun.throw(room, a, 'tomato', 0.4, 1.7)).toMatchObject({
      ok: true,
      event: { kind: 'throw', from: a, item: 'tomato', x: 0.4, y: 1 },
    });
    // Same thing again too soon: the remaining wait comes back.
    expect(fun.throw(room, a, 'tomato', 0.5, 0.5)).toMatchObject({ ok: false, code: 'COOLDOWN' });
    expect(fun.throw(room, a, 'egg', 0.5, 0.5)).toMatchObject({ ok: true });
    // One big one for the whole table, then a breather for everybody.
    expect(fun.throw(room, a, 'bomb', 0.5, 0.5)).toMatchObject({ ok: true });
    const wait = fun.throw(room, b, 'tornado', 0.5, 0.5);
    expect(wait).toMatchObject({ ok: false, code: 'COOLDOWN' });
    expect((wait as { retryInMs: number }).retryInMs).toBe(10_000);
    clock.advance(10_000);
    expect(fun.throw(room, b, 'tornado', 0.5, 0.5)).toMatchObject({ ok: true });
    expect(fun.throw(room, a, 'piano', 0.5, 0.5)).toEqual({ ok: false, code: 'INVALID' });
    expect(fun.throw(room, a, 'tomato', Number.NaN, 0.5)).toEqual({ ok: false, code: 'INVALID' });
    expect(fun.react(room, a, '🔥')).toMatchObject({ ok: true });
    expect(fun.react(room, a, '<script>')).toEqual({ ok: false, code: 'INVALID' });
  });
});
