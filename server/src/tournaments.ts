import {
  championsOf,
  computeStandings,
  isValidTournamentId,
  normalizeNameKey,
  normalizeTournamentId,
  nextPendingSlot,
  assignLetters,
  cleanPlayerName,
  matchNumber,
  pairingPairs,
  validateTournamentNames,
  type Ack,
  type Letter,
  type LetterAssignment,
  type Rng,
  type Seat,
  type Target,
  type TournamentCreated,
  type TournamentEntered,
  type TournamentExport,
  type TournamentMatchView,
  type TournamentView,
} from '@domino/shared';
import type { StoredMatch, StoredTournament, TournamentStore } from './db/store';
import { hashToken, newToken, newTournamentId } from './ids';
import { FailureLimiter } from './ratelimit';
import { isValidToken, type MatchOutcome, type Room, type TournamentRoomSpec } from './room';
import type { RoomManager } from './rooms';

export interface ClientCtx {
  ip: string;
  socketId: string;
}

export interface TournamentLimits {
  /** Failed ID/name attempts allowed per IP / per socket inside the window. */
  failuresPerIp: number;
  failuresPerSocket: number;
  failureWindowMs: number;
  /** Tournaments an IP may create per window. */
  createsPerIp: number;
  createWindowMs: number;
}

export const DEFAULT_LIMITS: TournamentLimits = {
  failuresPerIp: 12,
  failuresPerSocket: 6,
  failureWindowMs: 10 * 60_000,
  createsPerIp: 10,
  createWindowMs: 60 * 60_000,
};

export interface TournamentServiceOptions {
  store: TournamentStore;
  getRooms: () => RoomManager;
  /** Pushes a fresh view to everyone watching the tournament. */
  emit: (tournamentId: string, view: TournamentView) => void;
  /** Crypto-backed in production: the letter draw is decided here, never by the client. */
  rng: Rng;
  /** Match target of every tournament match (a server constant). */
  target: Target;
  limits?: Partial<TournamentLimits>;
  now?: () => number;
}

/** Everything the server does for tournaments except the socket plumbing. */
export class TournamentService {
  private readonly store: TournamentStore;
  /** `${tournamentId}:${jornada}:${slot}` → id of the room open for that slot. */
  private readonly liveRooms = new Map<string, string>();
  private readonly ipFailures: FailureLimiter;
  private readonly socketFailures: FailureLimiter;
  private readonly creates: FailureLimiter;

  constructor(private readonly options: TournamentServiceOptions) {
    this.store = options.store;
    const limits = { ...DEFAULT_LIMITS, ...options.limits };
    const now = options.now ?? Date.now;
    this.ipFailures = new FailureLimiter(limits.failuresPerIp, limits.failureWindowMs, now);
    this.socketFailures = new FailureLimiter(limits.failuresPerSocket, limits.failureWindowMs, now);
    this.creates = new FailureLimiter(limits.createsPerIp, limits.createWindowMs, now);
  }

  // ───────────────────────────── rate limiting ─────────────────────────────

  /** Milliseconds the caller must wait, or 0. */
  blockedFor(ctx: ClientCtx): number {
    return Math.max(
      this.ipFailures.blockedFor(ctx.ip),
      this.socketFailures.blockedFor(ctx.socketId),
    );
  }

  recordFailure(ctx: ClientCtx): void {
    this.ipFailures.fail(ctx.ip);
    this.socketFailures.fail(ctx.socketId);
  }

  forgetSocket(socketId: string): void {
    this.socketFailures.clear(socketId);
  }

  private limited(ctx: ClientCtx): Ack<never> | null {
    const wait = this.blockedFor(ctx);
    return wait > 0 ? { ok: false, code: 'RATE_LIMITED', retryAfterMs: wait } : null;
  }

  // ───────────────────────────── create / enter ─────────────────────────────

  create(rawNames: unknown, ctx: ClientCtx): Ack<TournamentCreated> {
    const wait = this.creates.hit(ctx.ip);
    if (wait > 0) return { ok: false, code: 'RATE_LIMITED', retryAfterMs: wait };
    const names = validateTournamentNames(rawNames);
    if (!names.ok) return { ok: false, code: names.code };
    const players = assignLetters(names.names, this.options.rng);
    try {
      let id = newTournamentId();
      while (this.store.exists(id)) id = newTournamentId();
      this.store.create(id, this.options.target, players);
      return { ok: true, id, players };
    } catch (error) {
      console.error('[domino] could not create a tournament', error);
      return { ok: false, code: 'FAILED' };
    }
  }

  /**
   * Identifies a visitor: a stored device token, or a typed name that matches one of the four
   * registered players (and then a fresh token is issued). The ID alone proves nothing.
   */
  enter(
    req: { id: unknown; name?: unknown; token?: unknown },
    ctx: ClientCtx,
  ): Ack<TournamentEntered> & { letter?: Letter; id?: string } {
    const limited = this.limited(ctx);
    if (limited) return limited;
    const id = typeof req.id === 'string' ? normalizeTournamentId(req.id) : '';
    const stored = isValidTournamentId(id) ? this.store.load(id) : null;
    if (!stored) {
      this.recordFailure(ctx);
      return { ok: false, code: 'NOT_FOUND' };
    }

    // 1) This device already proved who it is.
    if (isValidToken(req.token)) {
      const letter = this.store.letterForToken(id, hashToken(req.token));
      const you = letter ? stored.players.find((p) => p.letter === letter) : undefined;
      if (letter && you) {
        return { ok: true, id, token: req.token, you, view: this.buildView(stored), letter };
      }
    }

    // 2) A new device: the typed name is the only proof.
    if (req.name === undefined || req.name === null || req.name === '') {
      return { ok: false, code: 'NEED_NAME' };
    }
    const clean = cleanPlayerName(req.name);
    if (!clean) return { ok: false, code: 'NAME_INVALID' };
    const letter = this.store.letterForName(id, normalizeNameKey(clean));
    const you = letter ? stored.players.find((p) => p.letter === letter) : undefined;
    if (!letter || !you) {
      this.recordFailure(ctx);
      return { ok: false, code: 'NAME_UNKNOWN' };
    }
    const token = newToken();
    try {
      this.store.issueToken(id, letter, hashToken(token));
    } catch (error) {
      console.error('[domino] could not store a tournament token', error);
      return { ok: false, code: 'FAILED' };
    }
    return { ok: true, id, token, you, view: this.buildView(stored), letter };
  }

  /** The letter a device token belongs to in `tournamentId` (used to admit players to its rooms). */
  identify(tournamentId: string, token: unknown): Letter | null {
    return isValidToken(token) ? this.store.letterForToken(tournamentId, hashToken(token)) : null;
  }

  /** IDs a device remembers → summaries of those that still exist. Unknown ones count as failures. */
  list(ids: unknown, ctx: ClientCtx): Ack<{ items: ReturnType<TournamentStore['summaries']> }> {
    const limited = this.limited(ctx);
    if (limited) return limited;
    if (!Array.isArray(ids)) return { ok: false, code: 'INVALID' };
    const wanted = [
      ...new Set(
        ids
          .slice(0, 20)
          .filter((x): x is string => typeof x === 'string')
          .map(normalizeTournamentId)
          .filter(isValidTournamentId),
      ),
    ];
    const items = this.store.summaries(wanted);
    for (let i = 0; i < wanted.length - items.length; i++) this.recordFailure(ctx);
    return { ok: true, items };
  }

  // ───────────────────────────── views ─────────────────────────────

  view(id: string): TournamentView | null {
    const stored = this.store.load(id);
    return stored ? this.buildView(stored) : null;
  }

  private liveRoom(tournamentId: string, jornada: number, slot: number): Room | undefined {
    const key = `${tournamentId}:${jornada}:${slot}`;
    const roomId = this.liveRooms.get(key);
    if (!roomId) return undefined;
    const room = this.options.getRooms().get(roomId);
    if (!room || room.isSaved) {
      this.liveRooms.delete(key);
      return undefined;
    }
    return room;
  }

  private buildView(t: StoredTournament): TournamentView {
    const counted = t.matches.filter((m) => !m.voided);
    const bySlot = new Map<string, StoredMatch>(counted.map((m) => [`${m.jornada}:${m.slot}`, m]));
    const next = t.status === 'finished' ? null : nextPendingSlot(counted);
    const standings = computeStandings(t.players, counted);
    return {
      id: t.id,
      createdAt: t.createdAt,
      target: t.target,
      status: t.status,
      players: t.players,
      jornadas: t.jornadas.map((j) => ({
        number: j.number,
        matches: j.matchOrder.map((pairing, i): TournamentMatchView => {
          const slot = i + 1;
          const done = bySlot.get(`${j.number}:${slot}`);
          return {
            number: matchNumber(j.number, slot),
            jornada: j.number,
            slot,
            pairing,
            pairs: pairingPairs(pairing),
            status: done
              ? 'terminado'
              : this.liveRoom(t.id, j.number, slot)
                ? 'jugando'
                : 'pendiente',
            result: done
              ? {
                  winnerPair: done.winnerPair,
                  scorePair1: done.scorePair1,
                  scorePair2: done.scorePair2,
                  shutout: done.shutout,
                  endedAt: done.endedAt,
                }
              : null,
          };
        }),
      })),
      currentJornada: next?.jornada ?? null,
      next,
      standings,
      champions: t.status === 'finished' ? championsOf(standings) : [],
      played: counted.length,
    };
  }

  /** Sends the current state to every viewer of the tournament. */
  push(tournamentId: string): void {
    try {
      const view = this.view(tournamentId);
      if (view) this.options.emit(tournamentId, view);
    } catch (error) {
      console.error('[domino] could not push a tournament update', error);
    }
  }

  // ───────────────────────────── playing ─────────────────────────────

  /**
   * "Jugar": opens the private room of the next pending match, or returns the one already open
   * (so a double click, or four players pressing at once, still yields exactly one room).
   */
  play(tournamentId: string): Ack<{ roomId: string }> {
    const t = this.store.load(tournamentId);
    if (!t) return { ok: false, code: 'NOT_FOUND' };
    const counted = t.matches.filter((m) => !m.voided);
    const next = t.status === 'finished' ? null : nextPendingSlot(counted);
    if (!next) return { ok: false, code: 'FINISHED' };
    const jornada = t.jornadas.find((j) => j.number === next.jornada);
    const pairing = jornada?.matchOrder[next.slot - 1];
    if (!pairing) {
      console.error(`[domino] tournament ${tournamentId} has no drawn jornada ${next.jornada}`);
      return { ok: false, code: 'FAILED' };
    }
    const open = this.liveRoom(tournamentId, next.jornada, next.slot);
    if (open) return { ok: true, roomId: open.id };

    const names = new Map(t.players.map((p) => [p.letter, p.name]));
    const [pair1, pair2] = pairingPairs(pairing);
    const place = (letter: Letter, seat: Seat) =>
      [letter, { seat, name: names.get(letter) ?? letter }] as const;
    const spec: TournamentRoomSpec = {
      tournamentId,
      jornada: next.jornada,
      slot: next.slot,
      number: next.number,
      pairing,
      target: this.options.target,
      seats: Object.fromEntries([
        place(pair1[0], 0),
        place(pair2[0], 1),
        place(pair1[1], 2),
        place(pair2[1], 3),
      ]) as TournamentRoomSpec['seats'],
    };
    const room = this.options.getRooms().create({ spec, record: (o) => this.record(o) });
    this.liveRooms.set(`${tournamentId}:${next.jornada}:${next.slot}`, room.id);
    this.push(tournamentId);
    return { ok: true, roomId: room.id };
  }

  /** The room's match-end hook. Throws when the write fails so the room keeps retrying. */
  private record(o: MatchOutcome): void {
    const { spec } = o;
    this.store.recordMatch({
      tournamentId: spec.tournamentId,
      jornada: spec.jornada,
      slot: spec.slot,
      pairing: spec.pairing,
      roomId: o.roomId,
      startedAt: o.startedAt,
      endedAt: o.endedAt,
      winnerPair: o.winnerPair,
      scorePair1: o.scorePair1,
      scorePair2: o.scorePair2,
      hands: o.hands,
    });
    this.push(spec.tournamentId);
  }

  /** A room disappeared: its slot may be pending again. */
  roomRemoved(room: Room): void {
    const spec = room.tournament;
    if (!spec) return;
    const key = `${spec.tournamentId}:${spec.jornada}:${spec.slot}`;
    if (this.liveRooms.get(key) === room.id) this.liveRooms.delete(key);
    this.push(spec.tournamentId);
  }

  // ───────────────────────────── export ─────────────────────────────

  export(tournamentId: string): TournamentExport | null {
    const t = this.store.load(tournamentId);
    if (!t) return null;
    const players: LetterAssignment[] = t.players;
    return {
      format: 'domino-torneo/1',
      exportedAt: new Date().toISOString(),
      tournament: {
        id: t.id,
        createdAt: t.createdAt,
        target: t.target,
        status: t.status,
        finishedAt: t.finishedAt,
      },
      players,
      jornadas: t.jornadas,
      matches: t.matches.map((m) => ({
        id: m.id,
        jornada: m.jornada,
        slot: m.slot,
        pairing: m.pairing,
        roomId: m.roomId,
        startedAt: m.startedAt,
        endedAt: m.endedAt,
        winnerPair: m.winnerPair,
        scorePair1: m.scorePair1,
        scorePair2: m.scorePair2,
        shutout: m.shutout,
        hands: m.hands,
        voidedAt: m.voidedAt,
        voidedReason: m.voidedReason,
      })),
    };
  }

  get liveRoomCount(): number {
    return this.liveRooms.size;
  }
}
