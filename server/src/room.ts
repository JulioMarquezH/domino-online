import {
  BOT_NAMES,
  DEFAULT_TARGET,
  DRAW_POSITIONS,
  MAX_PLAYERS,
  applyMatchAction,
  chooseAction,
  knowledgeOf,
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
  type Letter,
  type MatchState,
  type MicState,
  type Pairing,
  type PauseDecision,
  type Phase,
  type PublicPlayer,
  type Rng,
  type RoomView,
  type Seat,
  type TableEvent,
  type Team,
  type Target,
  type TeamMode,
  type TileId,
  type TournamentRoomInfo,
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
  /** How long an AI "thinks" before playing (random in [min, max]). */
  botMinMs: number;
  botMaxMs: number;
  /** Simulated playouts per AI decision (strength vs CPU). */
  botBudget: number;
}

export const DEFAULT_TIMINGS: Timings = {
  pauseMs: 120_000,
  lobbyGraceMs: 5_000,
  emptyRoomTtlMs: 600_000,
  drawRevealMs: 4_500,
  nextHandMs: 25_000,
  botMinMs: 800,
  botMaxMs: 1600,
  botBudget: 1600,
};

/** Marker "socket" for AI players: always present, never emitted to. */
export const BOT_SOCKET = 'bot';

export interface Player {
  id: string;
  token: string;
  name: string;
  seat: Seat | null;
  joinOrder: number;
  socketId: string | null;
  /** Played by the AI (added in the lobby, or taking over a seat mid-game). */
  isBot: boolean;
  mic: MicState;
  /** Mid-game disconnection bookkeeping. */
  pauseDeadline: number | null;
  expired: boolean;
  replaceable: boolean;
  /** Tournament rooms only: the registered player this seat belongs to. */
  letter?: Letter;
}

/** A private room created for one slot of a tournament: locked to its four registered players. */
export interface TournamentRoomSpec {
  tournamentId: string;
  jornada: number;
  slot: number;
  /** 1..12 */
  number: number;
  pairing: Pairing;
  /** The match target. Always the server constant (tests inject another value through createApp). */
  target: Target;
  /** Fixed seats: pair 1 is team 0 (seats 0 and 2), pair 2 is team 1 (seats 1 and 3). */
  seats: Record<Letter, { seat: Seat; name: string }>;
}

/** One finished hand, kept with the match record. */
export interface HandLogEntry {
  hand: number;
  starter: Seat;
  kind: 'domino' | 'tranque' | 'tranque-tie';
  winnerTeam: Team | null;
  points: number;
  /** Match score after the hand. */
  scores: [number, number];
}

/** What a finished tournament match hands to the recorder. */
export interface MatchOutcome {
  spec: TournamentRoomSpec;
  roomId: string;
  startedAt: string | null;
  endedAt: string;
  winnerPair: 1 | 2;
  scorePair1: number;
  scorePair2: number;
  hands: HandLogEntry[];
}

export interface TournamentHooks {
  spec: TournamentRoomSpec;
  /** Persists the finished match synchronously (one transaction). Throws when the write fails. */
  record: (outcome: MatchOutcome) => void;
}

/** Who a socket proved to be (a registered player of the tournament this room belongs to). */
export interface TournamentIdentity {
  letter: Letter;
}

/** Retry delays for a failed save: 1 s, 2 s, 4 s … capped at 30 s, forever. */
export const saveRetryDelay = (attempt: number): number => Math.min(30_000, 1000 * 2 ** attempt);

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
  /** Present only in tournament rooms. */
  tournament?: TournamentHooks;
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
  // Tournament bookkeeping (unused in casual rooms).
  private handLog: HandLogEntry[] = [];
  private startedAt: string | null = null;
  private pendingOutcome: MatchOutcome | null = null;
  private saved = false;
  private saveAttempts = 0;

  constructor(
    readonly id: string,
    private readonly deps: RoomDeps,
  ) {
    if (deps.tournament) {
      // Tournament rooms are locked: fixed target, fixed seats, no AI, no replacements.
      this.target = deps.tournament.spec.target;
      this.teamMode = 'manual';
    }
    // A freshly created room is empty until its creator joins.
    this.scheduleEmptyCheck();
  }

  /** Set only in tournament rooms. */
  get tournament(): TournamentRoomSpec | null {
    return this.deps.tournament?.spec ?? null;
  }

  /** The result is in the database (tournament rooms only). */
  get isSaved(): boolean {
    return this.saved;
  }

  // ───────────────────────────── membership ─────────────────────────────

  getPlayer(id: string): Player | undefined {
    return this.players.find((p) => p.id === id);
  }

  get connectedCount(): number {
    return this.players.filter((p) => p.socketId !== null).length;
  }

  /** Real people currently connected (AI players don't keep a room alive). */
  get humansOnline(): number {
    return this.players.filter((p) => !p.isBot && p.socketId !== null).length;
  }

  get isPaused(): boolean {
    return this.phase !== 'lobby' && this.players.some((p) => p.socketId === null);
  }

  join(
    req: { name: string | null; token: string | null; identity?: TournamentIdentity | null },
    socketId: string,
  ): JoinResult {
    if (this.deps.tournament) return this.joinTournament(req, socketId, this.deps.tournament.spec);
    if (req.token) {
      const existing = this.players.find((p) => p.token === req.token);
      if (existing) {
        // Coming back to a seat the AI was playing for you: take it back.
        const previousSocketId = existing.isBot ? null : existing.socketId;
        existing.isBot = false;
        this.clearTimer('botmove');
        this.attach(existing, socketId);
        return { ok: true, player: existing, previousSocketId };
      }
    }
    if (req.name === null) return { ok: false, code: 'NEED_NAME' };
    const name = sanitizeName(req.name);
    if (!name) return { ok: false, code: 'NAME_INVALID' };

    if (this.phase === 'lobby') {
      // A friend arriving takes the place of an AI.
      const full = this.players.length >= MAX_PLAYERS;
      const bot = full ? [...this.players].reverse().find((p) => p.isBot) : undefined;
      if (full && !bot) return { ok: false, code: 'FULL' };
      if (this.nameTaken(name)) return { ok: false, code: 'NAME_TAKEN' };
      if (bot) this.removePlayer(bot);
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

  /**
   * Tournament rooms admit only the four registered players, each at the seat their pairing
   * gives them. A returning player (same device token, or the same registered identity from
   * another device) takes their seat back, exactly like a casual-room reclaim.
   */
  private joinTournament(
    req: { token: string | null; identity?: TournamentIdentity | null },
    socketId: string,
    spec: TournamentRoomSpec,
  ): JoinResult {
    const byToken = req.token ? this.players.find((p) => p.token === req.token) : undefined;
    const letter = byToken?.letter ?? req.identity?.letter;
    if (!letter) return { ok: false, code: 'FORBIDDEN' };
    const existing = byToken ?? this.players.find((p) => p.letter === letter);
    if (existing) {
      const previousSocketId = existing.socketId;
      this.attach(existing, socketId);
      return { ok: true, player: existing, previousSocketId };
    }
    const slot = spec.seats[letter];
    if (!slot || this.phase !== 'lobby') return { ok: false, code: 'FORBIDDEN' };
    const player = this.createPlayer(slot.name, this.deps.newToken());
    player.seat = slot.seat;
    player.letter = letter;
    this.players.push(player);
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
    if (this.deps.tournament) return fail('LOCKED');
    const check = this.requireHost(playerId, 'lobby');
    if (!check.ok) return check;
    this.target = target;
    this.changed();
    return OK;
  }

  setTeamMode(playerId: string, mode: TeamMode): Result {
    if (this.deps.tournament) return fail('LOCKED');
    const check = this.requireHost(playerId, 'lobby');
    if (!check.ok) return check;
    this.teamMode = mode;
    if (mode === 'manual') {
      for (const p of this.players) if (p.isBot && p.seat === null) p.seat = this.freeSeat();
    }
    this.changed();
    return OK;
  }

  sit(playerId: string, seat: Seat | null): Result {
    if (this.deps.tournament) return fail('LOCKED');
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

  addBot(playerId: string): Result {
    if (this.deps.tournament) return fail('LOCKED');
    const check = this.requireHost(playerId, 'lobby');
    if (!check.ok) return check;
    if (this.players.length >= MAX_PLAYERS) return fail('TAKEN');
    const name = BOT_NAMES.find((n) => !this.nameTaken(n)) ?? `IA ${this.players.length + 1}`;
    const bot = this.createPlayer(name, this.deps.newToken());
    bot.isBot = true;
    bot.socketId = BOT_SOCKET;
    if (this.teamMode === 'manual') bot.seat = this.freeSeat();
    this.players.push(bot);
    this.changed();
    return OK;
  }

  removeBot(playerId: string, botId: string): Result {
    if (this.deps.tournament) return fail('LOCKED');
    const check = this.requireHost(playerId, 'lobby');
    if (!check.ok) return check;
    const bot = this.getPlayer(botId);
    if (!bot?.isBot) return fail('INVALID');
    this.removePlayer(bot);
    return OK;
  }

  private freeSeat(): Seat | null {
    return ([0, 1, 2, 3] as Seat[]).find((s) => !this.players.some((p) => p.seat === s)) ?? null;
  }

  start(playerId: string): Result {
    const check = this.requireHost(playerId, 'lobby');
    if (!check.ok) return check;
    if (this.players.length !== MAX_PLAYERS || this.connectedCount !== MAX_PLAYERS) {
      return fail('NOT_READY');
    }
    if (this.teamMode === 'manual') {
      // AI players sit wherever is free.
      for (const p of this.players) if (p.isBot && p.seat === null) p.seat = this.freeSeat();
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
    this.handLog = [];
    this.startedAt = new Date(this.deps.clock.now()).toISOString();
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
      this.logHand(this.match);
      if (this.match.winner !== null) {
        this.phase = 'matchEnd';
        // Persist BEFORE the "Partido guardado" state is broadcast (bump below).
        this.finishTournamentMatch(this.match);
      } else {
        this.phase = 'handEnd';
        for (const p of this.players) if (p.isBot) this.ready.add(p.id);
        this.scheduleNextHand();
      }
    }
    this.bump();
    return OK;
  }

  // ───────────────────────────── tournament records ─────────────────────────────

  private logHand(match: MatchState): void {
    if (!this.deps.tournament || !match.hand.result) return;
    const r = match.hand.result;
    this.handLog.push({
      hand: match.handNumber,
      starter: match.hand.starter,
      kind: r.kind,
      winnerTeam: r.winnerTeam,
      points: r.points,
      scores: [match.scores[0], match.scores[1]],
    });
  }

  /** The match reached its target: write it down. A failed write is retried until it succeeds. */
  private finishTournamentMatch(match: MatchState): void {
    const hooks = this.deps.tournament;
    if (!hooks || match.winner === null || this.pendingOutcome) return;
    this.pendingOutcome = {
      spec: hooks.spec,
      roomId: this.id,
      startedAt: this.startedAt,
      endedAt: new Date(this.deps.clock.now()).toISOString(),
      winnerPair: (match.winner + 1) as 1 | 2,
      scorePair1: match.scores[0],
      scorePair2: match.scores[1],
      hands: this.handLog.map((h) => ({ ...h })),
    };
    this.saveAttempts = 0;
    this.trySave();
  }

  private trySave(): void {
    const hooks = this.deps.tournament;
    const outcome = this.pendingOutcome;
    if (!hooks || !outcome || this.saved) return;
    try {
      hooks.record(outcome);
      this.saved = true;
      this.clearTimer('save');
    } catch (error) {
      const delay = saveRetryDelay(this.saveAttempts++);
      console.error(
        `[domino] CRITICAL: could not save tournament match ${outcome.spec.tournamentId} ` +
          `J${outcome.spec.jornada}/${outcome.spec.slot} (attempt ${this.saveAttempts}); ` +
          `retrying in ${delay} ms. The room stays open until it is stored.`,
        error,
      );
      this.setTimer('save', delay, () => {
        this.trySave();
        if (this.saved) this.bump();
      });
    }
  }

  markReady(playerId: string): Result {
    if (!this.getPlayer(playerId)) return fail('NOT_IN_ROOM');
    if (this.phase !== 'handEnd') return fail('WRONG_PHASE');
    this.ready.add(playerId);
    if (this.players.every((p) => p.isBot || (p.socketId !== null && this.ready.has(p.id)))) {
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
    if (this.deps.tournament) return fail('LOCKED');
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

  decide(playerId: string, targetId: string, decision: PauseDecision): Result {
    if (this.hostId !== playerId) return fail('NOT_HOST');
    if (this.phase === 'lobby') return fail('WRONG_PHASE');
    if (this.deps.tournament) {
      // No AI takeover and no replacement seats; once the result is stored the room is done.
      if (decision === 'bot' || decision === 'replace') return fail('LOCKED');
      if (this.pendingOutcome) return fail('WRONG_PHASE');
    }
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
    } else if (decision === 'bot') {
      // The AI plays the seat (same hand, same team). The player can still come back.
      const wasPaused = this.isPaused;
      this.clearTimer(`pause:${target.id}`);
      target.isBot = true;
      target.socketId = BOT_SOCKET;
      target.pauseDeadline = null;
      target.expired = false;
      target.replaceable = false;
      if (this.phase === 'handEnd') this.ready.add(target.id);
      if (wasPaused && !this.isPaused) this.onResume();
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
    // An abandoned tournament match records nothing: the slot is replayed from zero.
    this.handLog = [];
    this.startedAt = null;
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
    if (!player.isBot) this.clearTimer('empty');
    const host = this.hostId ? this.getPlayer(this.hostId) : undefined;
    if (!player.isBot && (!host || host.socketId === null || host.isBot)) this.hostId = player.id;
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
    const next = this.playersToTheRightOf(from).find((p) => !p.isBot && p.socketId !== null);
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
    if (this.humansOnline > 0) return;
    // A finished tournament match that is not stored yet must outlive its players.
    if (this.pendingOutcome && !this.saved) return;
    if (this.timers.has('empty')) return;
    this.setTimer('empty', this.deps.timings.emptyRoomTtlMs, () => {
      if (this.humansOnline === 0) this.deps.onExpired(this);
    });
  }

  dispose(): void {
    // Last chance to store a finished tournament match (e.g. on shutdown).
    if (this.pendingOutcome && !this.saved) this.trySave();
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
      isBot: p.isBot,
      seat: p.seat,
      connected: p.socketId !== null,
      isHost: p.id === this.hostId,
      mic: p.socketId !== null && !p.isBot ? p.mic : 'off',
      voiceSession: p.isBot ? null : p.socketId,
      tileCount: inHand && p.seat !== null ? (match.hand.hands[p.seat]?.length ?? 0) : 0,
      ...(p.letter ? { letter: p.letter } : {}),
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
        this.phase === 'lobby' || (this.deps.tournament && this.phase === 'matchEnd')
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
      ...(this.deps.tournament
        ? { tournament: this.tournamentInfo(this.deps.tournament.spec) }
        : {}),
    };
  }

  private tournamentInfo(spec: TournamentRoomSpec): TournamentRoomInfo {
    return {
      id: spec.tournamentId,
      jornada: spec.jornada,
      slot: spec.slot,
      number: spec.number,
      pairing: spec.pairing,
      saved: this.saved,
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
      isBot: false,
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
    if (this.disposed) return;
    this.deps.onChange(this);
    this.scheduleBots();
  }

  // ───────────────────────────── AI players ─────────────────────────────

  private botDelay(): number {
    const { botMinMs, botMaxMs } = this.deps.timings;
    return botMinMs + this.deps.rng() * Math.max(0, botMaxMs - botMinMs);
  }

  /** Lets AI players pick their draw tile and play their turns, after a human-like pause. */
  private scheduleBots(): void {
    if (this.isPaused) return;
    const draw = this.draw;
    if (this.phase === 'draw' && draw && !draw.outcome) {
      for (const bot of this.players) {
        const key = `botpick:${bot.id}`;
        if (!bot.isBot || draw.picks.some((x) => x.playerId === bot.id) || this.timers.has(key)) {
          continue;
        }
        this.setTimer(key, this.botDelay(), () => {
          const taken = new Set(this.draw?.picks.map((x) => x.position));
          const free = Array.from({ length: DRAW_POSITIONS }, (_, i) => i).filter(
            (i) => !taken.has(i),
          );
          const pos = free[Math.floor(this.deps.rng() * free.length)];
          if (pos !== undefined) this.pick(bot.id, pos);
        });
      }
    }
    const match = this.match;
    if (this.phase === 'playing' && match && !match.hand.result && !this.timers.has('botmove')) {
      const seat = match.hand.turn;
      const bot = this.players.find((p) => p.isBot && p.seat === seat);
      if (!bot) return;
      this.setTimer('botmove', this.botDelay(), () => {
        const m = this.match;
        if (this.phase !== 'playing' || !m || m.hand.turn !== seat || !bot.isBot) return;
        // Only what that seat can see: its own tiles and the public history.
        const action = chooseAction(knowledgeOf(m.hand, seat), this.deps.rng, {
          budget: this.deps.timings.botBudget,
        });
        const r =
          action.type === 'pass'
            ? this.pass(bot.id, this.version)
            : this.play(bot.id, action.tile, action.end ?? 'left', this.version);
        if (!r.ok) this.scheduleBots();
      });
    }
  }
}
