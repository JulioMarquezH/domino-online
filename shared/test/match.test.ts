import { describe, expect, it } from 'vitest';
import {
  TARGETS,
  applyMatchAction,
  fullSet,
  legalMoves,
  mulberry32,
  nextHand,
  nextSeat,
  randomInt,
  scoreHand,
  startMatch,
  type HandResult,
  type MatchState,
  type Rng,
  type Seat,
  type Target,
} from '../src';

const domino = (winnerTeam: 0 | 1, points: number): HandResult => ({
  kind: 'domino',
  winner: winnerTeam,
  winnerTeam,
  points,
  teamPips: [0, 0],
  hands: [[], [], [], []],
});

describe('scoring and match end', () => {
  it.each(TARGETS)('ends the match when a team reaches or exceeds %i', (target) => {
    expect(scoreHand([target - 10, 0], domino(0, 9), target)).toEqual({
      scores: [target - 1, 0],
      winner: null,
    });
    expect(scoreHand([target - 10, 0], domino(0, 10), target).winner).toBe(0);
    expect(scoreHand([0, target - 10], domino(1, 37), target)).toEqual({
      scores: [0, target + 27],
      winner: 1,
    });
  });

  it('only the scoring team can cross the target in a hand', () => {
    expect(scoreHand([99, 99], domino(1, 5), 100)).toEqual({ scores: [99, 104], winner: 1 });
  });

  it('a tied tranque adds nothing', () => {
    const tie: HandResult = {
      kind: 'tranque-tie',
      winnerTeam: null,
      points: 0,
      teamPips: [20, 20],
      hands: [[], [], [], []],
    };
    expect(scoreHand([98, 97], tie, 100)).toEqual({ scores: [98, 97], winner: null });
  });
});

/** Plays one full hand with random legal moves. */
function playHand(match: MatchState, rng: Rng): MatchState {
  let m = match;
  let guard = 0;
  while (!m.hand.result) {
    if (++guard > 200) throw new Error('Hand did not finish');
    const seat = m.hand.turn;
    const moves = legalMoves(m.hand.hands[seat] ?? [], m.hand.line);
    const move = moves[randomInt(rng, moves.length)];
    const out = applyMatchAction(m, seat, move ? { type: 'play', ...move } : { type: 'pass' });
    if (!out.ok) throw new Error(`Unexpected error ${out.error}`);
    m = out.state;
    const onTable = m.hand.line.length + m.hand.hands.flat().length;
    expect(onTable).toBe(28);
  }
  return m;
}

describe('full simulated match', () => {
  it.each([1, 2, 3, 42, 2026])('plays a seeded match to completion (seed %i)', (seed) => {
    const rng = mulberry32(seed);
    const target: Target = TARGETS[seed % 3] as Target;
    let match = startMatch(target, 3, rng);
    const starters: Seat[] = [];
    while (true) {
      starters.push(match.hand.starter);
      const before = match.scores;
      match = playHand(match, rng);
      const result = match.hand.result;
      if (!result) throw new Error('no result');
      // The winning team scores exactly the opponents' remaining pips.
      if (result.winnerTeam !== null) {
        const opp = result.winnerTeam === 0 ? 1 : 0;
        expect(result.points).toBe(result.teamPips[opp]);
        expect(match.scores[result.winnerTeam]).toBe(before[result.winnerTeam] + result.points);
        expect(match.scores[opp]).toBe(before[opp]);
      } else {
        expect(match.scores).toEqual(before);
      }
      if (match.winner !== null) break;
      match = nextHand(match, rng);
      if (match.handNumber > 200) throw new Error('Match did not finish');
    }
    expect(match.scores[match.winner]).toBeGreaterThanOrEqual(target);
    expect(match.scores[match.winner === 0 ? 1 : 0]).toBeLessThan(target);
    // The starter rotates to the right every hand, regardless of who won.
    expect(starters[0]).toBe(3);
    starters.forEach((s, i) => {
      if (i > 0) expect(s).toBe(nextSeat(starters[i - 1] as Seat));
    });
    expect(match.handNumber).toBe(starters.length);
  });

  it('is deterministic for a given seed', () => {
    const run = () => {
      const rng = mulberry32(99);
      let m = startMatch(100, 0, rng);
      m = playHand(m, rng);
      return [m.scores, m.hand.line.map((p) => p.tile)];
    };
    expect(run()).toEqual(run());
    expect(fullSet()).toHaveLength(28);
  });
});
