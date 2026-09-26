import {
  applyHandAction,
  dealHand,
  type Action,
  type ActionOutcome,
  type HandResult,
  type HandState,
} from './hand';
import type { Rng } from './rng';
import { nextSeat, type Seat, type Team } from './seats';

export const TARGETS = [100, 150, 200] as const;
export type Target = (typeof TARGETS)[number];
export const DEFAULT_TARGET: Target = 100;

export function isTarget(value: unknown): value is Target {
  return (TARGETS as readonly unknown[]).includes(value);
}

export interface MatchState {
  target: Target;
  scores: [number, number];
  /** 1-based. */
  handNumber: number;
  hand: HandState;
  winner: Team | null;
}

export function startMatch(target: Target, firstStarter: Seat, rng: Rng): MatchState {
  return {
    target,
    scores: [0, 0],
    handNumber: 1,
    hand: dealHand(rng, firstStarter),
    winner: null,
  };
}

/** Adds a finished hand's points. Only one team can score per hand, so only one can cross the target. */
export function scoreHand(
  scores: [number, number],
  result: HandResult,
  target: Target,
): { scores: [number, number]; winner: Team | null } {
  const next: [number, number] = [scores[0], scores[1]];
  if (result.winnerTeam !== null) next[result.winnerTeam] += result.points;
  const winner = next[0] >= target ? 0 : next[1] >= target ? 1 : null;
  return { scores: next, winner };
}

export function applyMatchAction(
  match: MatchState,
  seat: Seat,
  action: Action,
): ActionOutcome<MatchState> {
  if (match.winner !== null) return { ok: false, error: 'HAND_OVER' };
  const outcome = applyHandAction(match.hand, seat, action);
  if (!outcome.ok) return outcome;
  const hand = outcome.state;
  if (!hand.result) return { ok: true, state: { ...match, hand }, events: outcome.events };
  const { scores, winner } = scoreHand(match.scores, hand.result, match.target);
  return { ok: true, state: { ...match, hand, scores, winner }, events: outcome.events };
}

/** Deals the next hand. The starter rotates to the RIGHT of the previous hand's starter. */
export function nextHand(match: MatchState, rng: Rng): MatchState {
  if (!match.hand.result) throw new Error('The current hand is not over');
  if (match.winner !== null) throw new Error('The match is over');
  return {
    ...match,
    handNumber: match.handNumber + 1,
    hand: dealHand(rng, nextSeat(match.hand.starter)),
  };
}
