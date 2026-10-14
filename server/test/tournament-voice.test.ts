import { describe, expect, it } from 'vitest';
import { TournamentVoice } from '../src/tournament-voice';

describe('tournament voice call', () => {
  it('tracks who is in each call, by letter, one device per player', () => {
    const v = new TournamentVoice();
    expect(v.join('T1', 'A', 's1')).toBeNull();
    expect(v.join('T1', 'B', 's2')).toBeNull();
    expect(v.join('T2', 'A', 's9')).toBeNull();
    expect(v.members('T1').map((m) => m.letter)).toEqual(['A', 'B']);
    // A's second device takes over; the first is told it's out.
    expect(v.join('T1', 'A', 's3')).toBe('s1');
    expect(v.members('T1').find((m) => m.letter === 'A')?.session).toBe('s3');
    expect(v.leave('s1')).toBeNull();
  });

  it('routes signals only to the current session of a member', () => {
    const v = new TournamentVoice();
    v.join('T1', 'A', 's1');
    v.join('T1', 'B', 's2');
    expect(v.route('T1', 'B', 's2')).toBe('s2');
    expect(v.route('T1', 'B', 'old')).toBeNull();
    expect(v.route('T2', 'B', 's2')).toBeNull();
    expect(v.letterOf('T1', 's1')).toBe('A');
  });

  it('keeps mic state and forgets a socket when it leaves', () => {
    const v = new TournamentVoice();
    v.join('T1', 'C', 's1');
    expect(v.setMic('s1', 'muted')).toBe('T1');
    expect(v.setMic('s1', 'muted')).toBeNull();
    expect(v.members('T1')[0]?.mic).toBe('muted');
    expect(v.leave('s1')).toBe('T1');
    expect(v.members('T1')).toEqual([]);
  });
});
