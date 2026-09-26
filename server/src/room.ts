import {
  DEFAULT_TARGET,
  DRAW_POSITIONS,
  MAX_PLAYERS,
  applyMatchAction,
  assignSortearSeats,
  drawStarter,
  fullSet,
  isSeat,
  nextHand,
  rankDrawPicks,
  sanitizeName,
  shuffle,
  startMatch,
  type Action,
  type ActionError,
  type ActionErrorCode,
  type DrawPickView,
  type End,
  type JoinErrorCode,
  type MatchState,
  type MicState,
  type Phase,
  type PublicPlayer,
  type Rng,
  type RoomView,
  type Seat,
  type TableEvent,
  type Target,
  type TeamMode,
  type TileId,
} from '@domino/shared';

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface Timings {
  /** How long the game waits for a disconnected player before the host decides. */
  pauseMs: number;
  /** Grace period before a player who dropped in the lobby frees their slot (covers reloads). */
  lobbyGraceMs: number;
  /** A room with nobody connected is deleted after this long. */
  emptyRoomTtlMs: number;
  /** Time to show the draw outcome before dealing. */
  drawRevealMs: number;
  /** The end-of-hand summary auto-continues after this long. */
  nextHandMs: number;
}

export const DEFAULT_TIMINGS: Timings = {
  pauseMs: 120_000,
  lobbyGraceMs: 5_000,
  emptyRoomTtlMs: 600_000,
  drawRevealMs: 4_500,
  nextHandMs: 25_000,
};

export interface Player {
  id: string;
  token: string;
  name: string;
  seat: Seat | null;
  joinOrder: number;
  socketId: string | null;
  mic: MicState;
  /** Mid-game disconnection bookkeeping. */
  pauseDeadline: number | null;
  expired: boolean;
  replaceable: boolean;
}

export interface RoomDeps {
  clock: Clock;
  timings: Timings;
  rng: Rng;
  newPlayerId: () => string;
  newToken: () => string;
  /** Called whenever any client-visible state changed. */
  onChange: (room: Room) => void;
  /** Called when the room has been empty for `emptyRoomTtlMs`. */
  onExpired: (room: Room) => void;
}

type DrawMode = 'sortear' | 'starter';

interface DrawState {
  mode: DrawMode;
  /** The face-down tile under each of the 28 positions. Never sent to clients. */
  positions: TileId[];
  picks: DrawPickView[];
  outcome: NonNullable<RoomView['draw']>['outcome'];
  starter: Seat | null;
}

export type Result = { ok: true } | { ok: false; code: ActionErrorCode };
export type JoinResult =
  | { ok: true; player: Player; previousSocketId: string | null }
  | { ok: false; code: JoinErrorCode };

const OK: Result = { ok: true };
const fail = (code: ActionErrorCode): Result => ({ ok: false, code });

const ENGINE_ERRORS: Record<ActionError, ActionErrorCode> = {
  HAND_OVER: 'WRONG_PHASE',
  NOT_YOUR_TURN: 'NOT_YOUR_TURN',
  INVALID_ACTION: 'INVALID',
  TILE_NOT_IN_HAND: 'TILE_NOT_IN_HAND',
  ILLEGAL_MOVE: 'ILLEGAL_MOVE',
  END_REQUIRED: 'END_REQUIRED',
  CANNOT_PASS: 'CANNOT_PASS',
};

export function isValidToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(token);
}

/**
 * One private room: lobby, starter draw, the match itself and the disconnection flow.
 * The room is the single source of truth; clients only send intents.
 */
export class Room {
  players: Player[] = [];
  hostId: string | null = null;
  phase: Phase = 'lobby';
  target: Target = DEFAULT_TARGET;
  teamMode: TeamMode = 'sortear';
  version = 0;

  private draw: DrawState | null = null;
  private match: MatchState | null = null;
  private lastEvent: TableEvent | null = null;
  private eventSeq = 0;
  private ready = new Set<string>();
  private nextHandAt: number | null = null;
  private joinSeq = 0;
  private disposed = false;
  private timers = new Map<string, unknown>();

  constructor(
    readonly id: string,
    private readonly deps: RoomDeps,
  ) {
    // A freshly created room is empty until its creator joins.
    this.scheduleEmptyCheck();
  }

  // ───────────────────────────── membership ─────────────────────────────

  getPlayer(id: string): Player | undefined {
    return this.players.find((p) => p.id === id);
  }

  get connectedCount(): number {
    return this.players.filter((p) => p.socketId !== null).length;
  }

  get isPaused(): boolean {
    return this.phase !== 'lobby' && this.players.some((p) => p.socketId === null);
  }

  join(req: { name: string | null; token: string | null }, socketId: string): JoinResult {
    if (req.token) {
      const existing = this.players.find((p) => p.token === req.token);
      if (existing) {
        const previousSocketId = existing.socketId;
        this.attach(existing, socketId);
        return { ok: true, player: existing, previousSocketId };
      }
    }
    if (req.name === null) return { ok: false, code: 'NEED_NAME' };
    const name = sanitizeName(req.name);
    if (!name) return { ok: false, code: 'NAME_INVALID' };

    if (this.phase === 'lobby') {
      if (this.players.length >= MAX_PLAYERS) return { ok: false, code: 'FULL' };
      if (this.nameTaken(name)) return { ok: false, code: 'NAME_TAKEN' };
      // An unknown token in the lobby is honored so a player whose slot was freed keeps it.
      const player = this.createPlayer(name, req.token ?? this.deps.newToken());
      this.players.push(player);
      this.attach(player, socketId);
      return { ok: true, player, previousSocketId: null };
    }

    // Mid-match, a newcomer can only take a seat the host opened for replacement.
    const open = this.players.find((p) => p.replaceable && p.socketId === null);
    if (!open) return { ok: false, code: 'FULL' };
    if (this.nameTaken(name, open.id)) return { ok: false, code: 'NAME_TAKEN' };
    const player = this.createPlayer(name, this.deps.newToken());
    player.seat = open.seat;
    this.players[this.players.indexOf(open)] = player;
    this.ready.delete(open.id);
    if (this.hostId === open.id) this.hostId = null;
    this.attach(player, socketId);
    return { ok: true, player, previousSocketId: null };
  }

  /** Socket went away. Ignored if the player already moved to a newer socket. */
  detach(playerId: string, socketId: string): void {
    const player = this.getPlayer(playerId);
    if (!player || player.socketId !== socketId) return;
    player.socketId = null;
    if (this.phase === 'lobby') {
      this.setTimer(`lobby:${player.id}`, this.deps.timings.lobbyGraceMs, () => {
        if (player.socketId === null) this.removePlayer(player);
      });
    } else {
      this.startWaiting(player);
    }
    this.passHostFrom(player);
    this.scheduleEmptyCheck();
    this.changed();
  }

  /** Explicit "Salir". In the lobby the slot is freed at once; mid-match it counts as a disconnection. */
  leave(playerId: string, socketId: string): void {
    const player = this.getPlayer(playerId);
    if (!player || player.socketId !== socketId) return;
    if (this.phase === 'lobby') {
      player.socketId = null;
      this.passHostFrom(player);
      this.removePlayer(player);
    } else {
      this.detach(playerId, socketId);
    }
  }

  setMic(playerId: string, mic: MicState): void {
    const player = this.getPlayer(playerId);
    if (!player || player.mic === mic) return;
    player.mic = mic;
    this.changed();
  }

  // ───────────────────────────── lobby ─────────────────────────────

  setTarget(playerId: string, target: Target): Result {
    const check = this.requireHost(playerId, 'lobby');
    if (!check.ok) return check;
    this.target = target;
    this.changed();
    return OK;
  }

  setTeamMode(playerId: string, mode: TeamMode): Result {
    const check = this.requireHost(playerId, 'lobby');
    if (!check.ok) return check;
    this.teamMode = mode;
    this.changed();
    return OK;
  }

  sit(playerId: string, seat: Seat | null): Result {
    const player = this.getPlayer(playerId);
    if (!player) return fail('NOT_IN_ROOM');
    if (this.phase !== 'lobby' || this.teamMode !== 'manual') return fail('WRONG_PHASE');
    if (seat !== null && this.players.some((p) => p !== player && p.seat === seat)) {
      return fail('TAKEN');
    }
    player.seat = seat;
    this.changed();
    return OK;
  }

  start(playerId: string): Result {
    const check = this.requireHost(playerId, 'lobby');
    if (!check.ok) return check;
    if (this.players.length !== MAX_PLAYERS || this.connectedCount !== MAX_PLAYERS) {
      return fail('NOT_READY');
    }
    if (this.teamMode === 'manual') {
      const seats = new Set(this.players.map((p) => p.seat));
      if (seats.has(null) || seats.size !== MAX_PLAYERS) return fail('NOT_READY');
    }
    this.startDraw(this.teamMode === 'sortear' ? 'sortear' : 'starter');
    return OK;
  }

  // ───────────────────────────── starter draw ─────────────────────────────

  private startDraw(mode: DrawMode): void {
    this.clearTimer('nextHand');
    if (mode === 'sortear') this.players.forEach((p) => (p.seat = null));
    this.phase = 'draw';
    this.match = null;
    this.lastEvent = null;
    this.ready.clear();
    this.nextHandAt = null;
    this.draw = {
      mode,
      positions: shuffle(fullSet(), this.deps.rng),
      picks: [],
      outcome: null,
      starter: null,
    };
    this.bump();
  }

  /** Clients only choose a face-down position; the tile under it was fixed by the server's shuffle. */
  pick(playerId: string, position: number): Result {
    const player = this.getPlayer(playerId);
    if (!player) return fail('NOT_IN_ROOM');
    const draw = this.draw;
    if (this.phase !== 'draw' || !draw || draw.outcome) return fail('WRONG_PHASE');
    if (this.isPaused) return fail('PAUSED');
    if (!Number.isInteger(position) || position < 0 || position >= DRAW_POSITIONS) {
      return fail('INVALID');
    }
    if (draw.picks.some((p) => p.playerId === playerId || p.position === position)) {
      return fail('TAKEN');
    }
    draw.picks.push({ playerId, position, tile: draw.positions[position] as TileId });
    if (draw.picks.length === MAX_PLAYERS) this.resolveDraw(draw);
    this.bump();
    return OK;
  }

  private resolveDraw(draw: DrawState): void {
    const picks = draw.picks.map((p) => ({ player: p.playerId, tile: p.tile }));
    let starter: Seat;
    if (draw.mode === 'sortear') {
      const result = assignSortearSeats(picks);
      for (const p of this.players) p.seat = result.seats.get(p.id) ?? null;
      starter = result.starter;
    } else {
      starter = drawStarter(picks.map((p) => ({ player: this.seatOf(p.player), tile: p.tile })));
    }
    const seats: Record<string, Seat> = {};
    for (const p of this.players) if (p.seat !== null) seats[p.id] = p.seat;
    const ranking = rankDrawPicks(picks).map((p) => p.player);
    draw.starter = starter;
    draw.outcome = { ranking, starterId: ranking[0] as string, seats };
    this.setTimer('draw', this.deps.timings.drawRevealMs, () => this.beginMatch());
  }

  private beginMatch(): void {
    const draw = this.draw;
    if (this.phase !== 'draw' || !draw || draw.starter === null) return;
    if (this.isPaused) return; // resumed from onResume()
    this.match = startMatch(this.target, draw.starter, this.deps.rng);
    this.draw = null;
    this.phase = 'playing';
    this.lastEvent = null;
    this.bump();
  }

  // ───────────────────────────── the game ─────────────────────────────

  play(playerId: string, tile: TileId, end: End, v: number): Result {
    return this.act(playerId, { type: 'play', tile, end }, v);
  }

  pass(playerId: string, v: number): Result {
    return this.act(playerId, { type: 'pass' }, v);
  }

  private act(playerId: string, action: Action, v: number): Result {
    const player = this.getPlayer(playerId);
    if (!player) return fail('NOT_IN_ROOM');
    if (this.phase !== 'playing' || !this.match) return fail('WRONG_PHASE');
    if (this.isPaused) return fail('PAUSED');
    if (v !== this.version) return fail('STALE');
    if (player.seat === null) return fail('INVALID');
    const outcome = applyMatchAction(this.match, player.seat, action);
    if (!outcome.ok) return fail(ENGINE_ERRORS[outcome.error]);
    this.match = outcome.state;
    const last = outcome.events[outcome.events.length - 1];
    if (last) this.lastEvent = { ...last, id: ++this.eventSeq };
    if (this.match.hand.result) {
      this.ready.clear();
      if (this.match.winner !== null) {
        this.phase = 'matchEnd';
      } else {
        this.phase = 'handEnd';
        this.scheduleNextHand();
      }
    }
    this.bump();
    return OK;
  }

  markReady(playerId: string): Result {
    if (!this.getPlayer(playerId)) return fail('NOT_IN_ROOM');
    if (this.phase !== 'handEnd') return fail('WRONG_PHASE');
    this.ready.add(playerId);
    if (this.players.every((p) => p.socketId !== null && this.ready.has(p.id))) {
      this.advanceHand();
    } else {
      this.changed();
    }
    return OK;
  }

  private scheduleNextHand(): void {
    this.nextHandAt = this.deps.clock.now() + this.deps.timings.nextHandMs;
    this.setTimer('nextHand', this.deps.timings.nextHandMs, () => this.advanceHand());
  }

  private advanceHand(): void {
    if (this.phase !== 'handEnd' || !this.match || this.isPaused) return;
    this.clearTimer('nextHand');
    this.match = nextHand(this.match, this.deps.rng);
    this.phase = 'playing';
    this.lastEvent = null;
    this.nextHandAt = null;
    this.ready.clear();
    this.bump();
  }

  rematch(playerId: string, keepTeams: boolean): Result {
    const check = this.requireHost(playerId, 'matchEnd');
    if (!check.ok) return check;
    if (this.isPaused) return fail('PAUSED');
    this.startDraw(keepTeams ? 'starter' : 'sortear');
    return OK;
  }

  // ───────────────────────────── disconnections ─────────────────────────────

  private startWaiting(player: Player): void {
    player.expired = false;
    player.pauseDeadline = this.deps.clock.now() + this.deps.timings.pauseMs;
    this.setTimer(`pause:${player.id}`, this.deps.timings.pauseMs, () => {
      player.expired = true;
      player.pauseDeadline = null;
      this.changed();
    });
    if (this.phase === 'handEnd') {
      this.clearTimer('nextHand');
      this.nextHandAt = null;
    }
  }

  decide(playerId: string, targetId: string, decision: 'wait' | 'end' | 'replace'): Result {
    if (this.hostId !== playerId) return fail('NOT_HOST');
    if (this.phase === 'lobby') return fail('WRONG_PHASE');
    const target = this.getPlayer(targetId);
    if (!target || target.socketId !== null) return fail('INVALID');
    if (!target.expired) return fail('NOT_READY');
    if (decision === 'wait') {
      target.replaceable = false;
      this.startWaiting(target);
      this.changed();
    } else if (decision === 'replace') {
      target.replaceable = true;
      this.changed();
    } else {
      this.endMatch();
    }
    return OK;
  }

  /** "Terminar partida": back to the lobby with whoever is still here. */
  private endMatch(): void {
    for (const key of [...this.timers.keys()]) if (key !== 'empty') this.clearTimer(key);
    this.players = this.players.filter((p) => p.socketId !== null);
    for (const p of this.players) {
      p.pauseDeadline = null;
      p.expired = false;
      p.replaceable = false;
      if (this.teamMode === 'sortear') p.seat = null;
    }
    this.phase = 'lobby';
    this.match = null;
    this.draw = null;
    this.lastEvent = null;
    this.ready.clear();
    this.nextHandAt = null;
    this.bump();
  }

  private onResume(): void {
    if (this.phase === 'draw' && this.draw?.outcome && !this.timers.has('draw')) {
      this.beginMatch();
    } else if (this.phase === 'handEnd' && !this.timers.has('nextHand')) {
      this.scheduleNextHand();
    }
  }

  private attach(player: Player, socketId: string): void {
    const wasPaused = this.isPaused;
    player.socketId = socketId;
    player.pauseDeadline = null;
    player.expired = false;
    player.replaceable = false;
    this.clearTimer(`lobby:${player.id}`);
    this.clearTimer(`pause:${player.id}`);
    this.clearTimer('empty');
    const host = this.hostId ? this.getPlayer(this.hostId) : undefined;
    if (!host || host.socketId === null) this.hostId = player.id;
    if (wasPaused && !this.isPaused) this.onResume();
    this.changed();
  }

  private removePlayer(player: Player): void {
    this.clearTimer(`lobby:${player.id}`);
    this.clearTimer(`pause:${player.id}`);
    const wasHost = this.hostId === player.id;
    if (wasHost) this.passHostFrom(player);
    this.players = this.players.filter((p) => p !== player);
    if (this.hostId === player.id) this.hostId = null;
    this.ready.delete(player.id);
    this.scheduleEmptyCheck();
    this.changed();
  }

  /** The host role passes to the next connected player to the right. */
  private passHostFrom(from: Player): void {
    if (this.hostId !== from.id) return;
    const next = this.playersToTheRightOf(from).find((p) => p.socketId !== null);
    if (next) this.hostId = next.id;
  }

  private playersToTheRightOf(from: Player): Player[] {
    const others = this.players.filter((p) => p !== from);
    if (from.seat !== null && others.every((p) => p.seat !== null)) {
      const fromSeat = from.seat;
      return others.sort(
        (a, b) => (((a.seat as Seat) - fromSeat + 4) % 4) - (((b.seat as Seat) - fromSeat + 4) % 4),
      );
    }
    const n = this.joinSeq + 1;
    return others.sort(
      (a, b) => ((a.joinOrder - from.joinOrder + n) % n) - ((b.joinOrder - from.joinOrder + n) % n),
    );
  }

  private scheduleEmptyCheck(): void {
    if (this.connectedCount > 0) return;
    if (this.timers.has('empty')) return;
    this.setTimer('empty', this.deps.timings.emptyRoomTtlMs, () => {
      if (this.connectedCount === 0) this.deps.onExpired(this);
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const key of [...this.timers.keys()]) this.clearTimer(key);
  }

  // ───────────────────────────── views ─────────────────────────────

  viewFor(playerId: string): RoomView {
    const now = this.deps.clock.now();
    const me = this.getPlayer(playerId);
    const match = this.match;
    const inHand = match !== null && this.phase !== 'lobby' && this.phase !== 'draw';
    const ordered = this.players
      .slice()
      .sort((a, b) =>
        a.seat !== null && b.seat !== null && this.phase !== 'lobby'
          ? a.seat - b.seat
          : a.joinOrder - b.joinOrder,
      );

    const players: PublicPlayer[] = ordered.map((p) => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      connected: p.socketId !== null,
      isHost: p.id === this.hostId,
      mic: p.socketId !== null ? p.mic : 'off',
      voiceSession: p.socketId,
      tileCount: inHand && p.seat !== null ? (match.hand.hands[p.seat]?.length ?? 0) : 0,
    }));

    const reveal = this.phase === 'handEnd' || this.phase === 'matchEnd';
    const result = match?.hand.result ?? null;

    return {
      roomId: this.id,
      phase: this.phase,
      youId: playerId,
      players,
      target: this.target,
      teamMode: this.teamMode,
      version: this.version,
      draw:
        this.phase === 'draw' && this.draw
          ? {
              mode: this.draw.mode,
              picks: this.draw.picks.map((p) => ({ ...p })),
              outcome: this.draw.outcome,
            }
          : null,
      game:
        inHand && match
          ? {
              target: match.target,
              scores: [match.scores[0], match.scores[1]],
              handNumber: match.handNumber,
              starter: match.hand.starter,
              turn: match.hand.turn,
              line: match.hand.line.map((t) => ({ ...t })),
              origin: match.hand.origin,
              // Only your own tiles. Other hands are revealed through `handResult` at the end.
              hand: me?.seat != null ? [...(match.hand.hands[me.seat] ?? [])] : [],
              lastEvent: this.lastEvent,
            }
          : null,
      handResult:
        reveal && result
          ? { ...result, hands: result.hands.map((h) => [...h]), teamPips: [...result.teamPips] }
          : null,
      ready: this.phase === 'handEnd' ? [...this.ready] : [],
      nextHandInMs:
        this.phase === 'handEnd' && this.nextHandAt !== null
          ? Math.max(0, this.nextHandAt - now)
          : null,
      pause:
        this.phase === 'lobby'
          ? []
          : this.players
              .filter((p) => p.socketId === null)
              .map((p) => ({
                playerId: p.id,
                name: p.name,
                remainingMs: p.pauseDeadline !== null ? Math.max(0, p.pauseDeadline - now) : 0,
                expired: p.expired,
                replaceable: p.replaceable,
              })),
      matchWinner: this.phase === 'matchEnd' ? (match?.winner ?? null) : null,
    };
  }

  /** Seat → hand, for tests and debugging only. Never sent to clients. */
  debugHands(): TileId[][] | null {
    return this.match ? this.match.hand.hands.map((h) => [...h]) : null;
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private requireHost(playerId: string, phase: Phase): Result {
    if (!this.getPlayer(playerId)) return fail('NOT_IN_ROOM');
    if (this.hostId !== playerId) return fail('NOT_HOST');
    if (this.phase !== phase) return fail('WRONG_PHASE');
    return OK;
  }

  private seatOf(playerId: string): Seat {
    const seat = this.getPlayer(playerId)?.seat;
    if (!isSeat(seat)) throw new Error('Player without a seat');
    return seat;
  }

  private nameTaken(name: string, exceptId?: string): boolean {
    const key = name.toLocaleLowerCase('es');
    return this.players.some((p) => p.id !== exceptId && p.name.toLocaleLowerCase('es') === key);
  }

  private createPlayer(name: string, token: string): Player {
    return {
      id: this.deps.newPlayerId(),
      token,
      name,
      seat: null,
      joinOrder: ++this.joinSeq,
      socketId: null,
      mic: 'off',
      pauseDeadline: null,
      expired: false,
      replaceable: false,
    };
  }

  private setTimer(key: string, ms: number, fn: () => void): void {
    this.clearTimer(key);
    const handle = this.deps.clock.setTimeout(() => {
      this.timers.delete(key);
      if (!this.disposed) fn();
    }, ms);
    this.timers.set(key, handle);
  }

  private clearTimer(key: string): void {
    const handle = this.timers.get(key);
    if (handle !== undefined) this.deps.clock.clearTimeout(handle);
    this.timers.delete(key);
  }

  /** Game state changed: invalidates in-flight actions. */
  private bump(): void {
    this.version++;
    this.changed();
  }

  private changed(): void {
    if (!this.disposed) this.deps.onChange(this);
  }
}
