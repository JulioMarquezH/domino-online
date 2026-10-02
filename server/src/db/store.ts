import {
  JORNADAS,
  MATCHES_PER_JORNADA,
  TOTAL_MATCHES,
  cleanPlayerName,
  isLetter,
  isPairing,
  normalizeNameKey,
  shuffleJornadaOrder,
  type Letter,
  type LetterAssignment,
  type Pairing,
  type PlayedMatch,
  type Rng,
  type TournamentSummary,
} from '@domino/shared';
import { transaction, type Db } from './database';

export interface StoredMatch extends PlayedMatch {
  id: number;
  tournamentId: string;
  roomId: string | null;
  startedAt: string | null;
  endedAt: string;
  recordedAt: string;
  shutout: boolean;
  hands: unknown;
  voidedAt: string | null;
  voidedReason: string | null;
}

export interface StoredJornada {
  number: number;
  matchOrder: Pairing[];
  createdAt: string;
}

export interface StoredTournament {
  id: string;
  createdAt: string;
  target: number;
  status: 'active' | 'finished';
  finishedAt: string | null;
  players: LetterAssignment[];
  jornadas: StoredJornada[];
  matches: StoredMatch[];
}

export interface MatchRecordInput {
  tournamentId: string;
  jornada: number;
  slot: number;
  pairing: Pairing;
  roomId: string | null;
  startedAt: string | null;
  endedAt: string;
  winnerPair: 1 | 2;
  scorePair1: number;
  scorePair2: number;
  hands: unknown;
}

export interface RecordOutcome {
  /** 'duplicate' = that slot was already recorded; nothing was written (idempotent). */
  result: 'recorded' | 'duplicate';
  matchId: number;
  finished: boolean;
  /** Set when recording the third match of a jornada started the next one. */
  startedJornada: number | null;
}

const MAX_TOKENS_PER_PLAYER = 12;

type Row = Record<string, unknown>;

export class StoreError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'INVALID' | 'CONFLICT',
    message: string,
  ) {
    super(message);
  }
}

/** All tournament persistence. Match rows are append-only (SQLite triggers enforce it). */
export class TournamentStore {
  constructor(
    readonly db: Db,
    private readonly deps: { now: () => string; rng: Rng },
  ) {}

  // ───────────────────────────── tournaments ─────────────────────────────

  exists(id: string): boolean {
    return this.db.prepare('SELECT 1 FROM tournaments WHERE id = ?').get(id) !== undefined;
  }

  /** Creates the tournament, its four players and jornada 1 in one transaction. */
  create(id: string, target: number, players: readonly LetterAssignment[]): void {
    const now = this.deps.now();
    transaction(this.db, () => {
      this.db
        .prepare('INSERT INTO tournaments (id, created_at, target, status) VALUES (?, ?, ?, ?)')
        .run(id, now, target, 'active');
      const insert = this.db.prepare(
        'INSERT INTO tournament_players (tournament_id, letter, display_name, name_key) VALUES (?, ?, ?, ?)',
      );
      for (const p of players) insert.run(id, p.letter, p.name, normalizeNameKey(p.name));
      this.insertJornada(id, 1, now);
    });
  }

  private insertJornada(id: string, number: number, now: string): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO tournament_jornadas (tournament_id, number, match_order, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(id, number, JSON.stringify(shuffleJornadaOrder(this.deps.rng)), now);
  }

  load(id: string): StoredTournament | null {
    const t = this.db
      .prepare('SELECT id, created_at, target, status, finished_at FROM tournaments WHERE id = ?')
      .get(id) as Row | undefined;
    if (!t) return null;
    const players = (
      this.db
        .prepare(
          'SELECT letter, display_name FROM tournament_players WHERE tournament_id = ? ORDER BY letter',
        )
        .all(id) as Row[]
    ).map((r) => ({ letter: r.letter as Letter, name: r.display_name as string }));
    const jornadas = (
      this.db
        .prepare(
          'SELECT number, match_order, created_at FROM tournament_jornadas WHERE tournament_id = ? ORDER BY number',
        )
        .all(id) as Row[]
    ).map((r) => ({
      number: r.number as number,
      matchOrder: JSON.parse(r.match_order as string) as Pairing[],
      createdAt: r.created_at as string,
    }));
    const matches = (
      this.db
        .prepare('SELECT * FROM tournament_matches WHERE tournament_id = ? ORDER BY id')
        .all(id) as Row[]
    ).map(toMatch);
    return {
      id: t.id as string,
      createdAt: t.created_at as string,
      target: t.target as number,
      status: t.status as 'active' | 'finished',
      finishedAt: (t.finished_at as string | null) ?? null,
      players,
      jornadas,
      matches,
    };
  }

  summaries(ids: readonly string[]): TournamentSummary[] {
    const out: TournamentSummary[] = [];
    const stmt = this.db.prepare(
      `SELECT t.id, t.status,
         (SELECT count(*) FROM tournament_matches m WHERE m.tournament_id = t.id AND m.voided_at IS NULL) AS played
       FROM tournaments t WHERE t.id = ?`,
    );
    for (const id of ids) {
      const r = stmt.get(id) as Row | undefined;
      if (r) {
        out.push({
          id: r.id as string,
          status: r.status as 'active' | 'finished',
          played: r.played as number,
        });
      }
    }
    return out;
  }

  // ───────────────────────────── identities ─────────────────────────────

  letterForName(id: string, nameKey: string): Letter | null {
    const r = this.db
      .prepare('SELECT letter FROM tournament_players WHERE tournament_id = ? AND name_key = ?')
      .get(id, nameKey) as Row | undefined;
    return r ? (r.letter as Letter) : null;
  }

  letterForToken(id: string, tokenHash: string): Letter | null {
    const r = this.db
      .prepare('SELECT letter FROM tournament_tokens WHERE tournament_id = ? AND token_hash = ?')
      .get(id, tokenHash) as Row | undefined;
    return r ? (r.letter as Letter) : null;
  }

  /** Stores a device token for a player (keeping the newest few so the table stays small). */
  issueToken(id: string, letter: Letter, tokenHash: string): void {
    transaction(this.db, () => {
      this.db
        .prepare(
          'INSERT INTO tournament_tokens (token_hash, tournament_id, letter, created_at) VALUES (?, ?, ?, ?)',
        )
        .run(tokenHash, id, letter, this.deps.now());
      this.db
        .prepare(
          `DELETE FROM tournament_tokens WHERE tournament_id = ? AND letter = ? AND token_hash NOT IN (
             SELECT token_hash FROM tournament_tokens WHERE tournament_id = ? AND letter = ?
             ORDER BY created_at DESC, rowid DESC LIMIT ?)`,
        )
        .run(id, letter, id, letter, MAX_TOKENS_PER_PLAYER);
    });
  }

  // ───────────────────────────── recording ─────────────────────────────

  /**
   * Writes a finished match. One transaction; idempotent per slot. Starting the next jornada and
   * closing the tournament happen in the same transaction, so there is never a half-state.
   */
  recordMatch(input: MatchRecordInput): RecordOutcome {
    return transaction(this.db, () => {
      const t = this.db
        .prepare('SELECT status FROM tournaments WHERE id = ?')
        .get(input.tournamentId) as Row | undefined;
      if (!t) throw new StoreError('NOT_FOUND', `Unknown tournament ${input.tournamentId}`);
      const jornada = this.db
        .prepare(
          'SELECT match_order FROM tournament_jornadas WHERE tournament_id = ? AND number = ?',
        )
        .get(input.tournamentId, input.jornada) as Row | undefined;
      if (!jornada) throw new StoreError('INVALID', `Jornada ${input.jornada} has not started`);
      const order = JSON.parse(jornada.match_order as string) as Pairing[];
      if (order[input.slot - 1] !== input.pairing) {
        throw new StoreError(
          'INVALID',
          'The pairing does not match the drawn order of the jornada',
        );
      }
      const existing = this.db
        .prepare(
          'SELECT id FROM tournament_matches WHERE tournament_id = ? AND jornada = ? AND slot = ? AND voided_at IS NULL',
        )
        .get(input.tournamentId, input.jornada, input.slot) as Row | undefined;
      if (existing) {
        return {
          result: 'duplicate',
          matchId: existing.id as number,
          finished: t.status === 'finished',
          startedJornada: null,
        } satisfies RecordOutcome;
      }

      const shutout = (input.winnerPair === 1 ? input.scorePair2 : input.scorePair1) === 0;
      const now = this.deps.now();
      const res = this.db
        .prepare(
          `INSERT INTO tournament_matches
             (tournament_id, jornada, slot, pairing, room_id, started_at, ended_at, recorded_at,
              winner_pair, score_pair1, score_pair2, shutout, hands)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.tournamentId,
          input.jornada,
          input.slot,
          input.pairing,
          input.roomId,
          input.startedAt,
          input.endedAt,
          now,
          input.winnerPair,
          input.scorePair1,
          input.scorePair2,
          shutout ? 1 : 0,
          input.hands === undefined ? null : JSON.stringify(input.hands),
        );

      let startedJornada: number | null = null;
      const inJornada = this.count(
        'SELECT count(*) AS n FROM tournament_matches WHERE tournament_id = ? AND jornada = ? AND voided_at IS NULL',
        input.tournamentId,
        input.jornada,
      );
      if (inJornada === MATCHES_PER_JORNADA && input.jornada < JORNADAS) {
        const next = input.jornada + 1;
        const had = this.count(
          'SELECT count(*) AS n FROM tournament_jornadas WHERE tournament_id = ? AND number = ?',
          input.tournamentId,
          next,
        );
        if (had === 0) {
          this.insertJornada(input.tournamentId, next, now);
          startedJornada = next;
        }
      }
      const total = this.count(
        'SELECT count(*) AS n FROM tournament_matches WHERE tournament_id = ? AND voided_at IS NULL',
        input.tournamentId,
      );
      const finished = total >= TOTAL_MATCHES;
      if (finished) {
        this.db
          .prepare("UPDATE tournaments SET status = 'finished', finished_at = ? WHERE id = ?")
          .run(now, input.tournamentId);
      }
      return {
        result: 'recorded',
        matchId: Number(res.lastInsertRowid),
        finished,
        startedJornada,
      } satisfies RecordOutcome;
    });
  }

  private count(sql: string, ...params: (string | number)[]): number {
    return (this.db.prepare(sql).get(...params) as { n: number }).n;
  }

  // ───────────────────────────── admin corrections ─────────────────────────────

  /** Voids a match: the row stays forever, the slot becomes pending again. */
  voidMatch(tournamentId: string, jornada: number, slot: number, reason: string): StoredMatch {
    const why = reason.trim();
    if (!why) throw new StoreError('INVALID', 'A reason is required to void a match');
    return transaction(this.db, () => {
      const row = this.db
        .prepare(
          'SELECT * FROM tournament_matches WHERE tournament_id = ? AND jornada = ? AND slot = ? AND voided_at IS NULL',
        )
        .get(tournamentId, jornada, slot) as Row | undefined;
      if (!row) throw new StoreError('NOT_FOUND', 'There is no recorded match in that slot');
      const now = this.deps.now();
      this.db
        .prepare('UPDATE tournament_matches SET voided_at = ?, voided_reason = ? WHERE id = ?')
        .run(now, why, row.id as number);
      // The tournament is open again (its slot is pending).
      this.db
        .prepare("UPDATE tournaments SET status = 'active', finished_at = NULL WHERE id = ?")
        .run(tournamentId);
      this.writeAudit('void-match', tournamentId, {
        matchId: row.id,
        jornada,
        slot,
        reason: why,
        score: [row.score_pair1, row.score_pair2],
        winnerPair: row.winner_pair,
      });
      return toMatch({ ...row, voided_at: now, voided_reason: why });
    });
  }

  renamePlayer(tournamentId: string, letter: string, newName: string): void {
    const name = cleanPlayerName(newName);
    if (!isLetter(letter) || !name) throw new StoreError('INVALID', 'Invalid letter or name');
    transaction(this.db, () => {
      const old = this.db
        .prepare(
          'SELECT display_name FROM tournament_players WHERE tournament_id = ? AND letter = ?',
        )
        .get(tournamentId, letter) as Row | undefined;
      if (!old) throw new StoreError('NOT_FOUND', 'No such player');
      const key = normalizeNameKey(name);
      const clash = this.db
        .prepare(
          'SELECT 1 FROM tournament_players WHERE tournament_id = ? AND name_key = ? AND letter != ?',
        )
        .get(tournamentId, key, letter);
      if (clash) throw new StoreError('CONFLICT', 'Another player already has that name');
      this.db
        .prepare(
          'UPDATE tournament_players SET display_name = ?, name_key = ? WHERE tournament_id = ? AND letter = ?',
        )
        .run(name, key, tournamentId, letter);
      this.writeAudit('rename-player', tournamentId, { letter, from: old.display_name, to: name });
    });
  }

  /** Only tournaments that never recorded a match (voided ones count as recorded). */
  deleteTournament(tournamentId: string): void {
    transaction(this.db, () => {
      if (!this.exists(tournamentId)) throw new StoreError('NOT_FOUND', 'No such tournament');
      const n = this.count(
        'SELECT count(*) AS n FROM tournament_matches WHERE tournament_id = ?',
        tournamentId,
      );
      if (n > 0) {
        throw new StoreError(
          'CONFLICT',
          `The tournament has ${n} match record(s); it cannot be deleted`,
        );
      }
      for (const table of ['tournament_tokens', 'tournament_jornadas', 'tournament_players']) {
        this.db.prepare(`DELETE FROM ${table} WHERE tournament_id = ?`).run(tournamentId);
      }
      this.db.prepare('DELETE FROM tournaments WHERE id = ?').run(tournamentId);
      this.writeAudit('delete-tournament', tournamentId, {});
    });
  }

  private writeAudit(action: string, tournamentId: string | null, details: unknown): void {
    this.db
      .prepare('INSERT INTO admin_audit (at, action, tournament_id, details) VALUES (?, ?, ?, ?)')
      .run(this.deps.now(), action, tournamentId, JSON.stringify(details));
  }

  audit(action: string, tournamentId: string | null, details: unknown): void {
    this.writeAudit(action, tournamentId, details);
  }

  auditLog(
    limit = 50,
  ): { id: number; at: string; action: string; tournamentId: string | null; details: unknown }[] {
    return (
      this.db.prepare('SELECT * FROM admin_audit ORDER BY id DESC LIMIT ?').all(limit) as Row[]
    ).map((r) => ({
      id: r.id as number,
      at: r.at as string,
      action: r.action as string,
      tournamentId: (r.tournament_id as string | null) ?? null,
      details: JSON.parse(r.details as string),
    }));
  }

  listTournaments(): {
    id: string;
    createdAt: string;
    status: string;
    played: number;
    voided: number;
  }[] {
    return (
      this.db
        .prepare(
          `SELECT t.id, t.created_at, t.status,
             (SELECT count(*) FROM tournament_matches m WHERE m.tournament_id = t.id AND m.voided_at IS NULL) AS played,
             (SELECT count(*) FROM tournament_matches m WHERE m.tournament_id = t.id AND m.voided_at IS NOT NULL) AS voided
           FROM tournaments t ORDER BY t.created_at`,
        )
        .all() as Row[]
    ).map((r) => ({
      id: r.id as string,
      createdAt: r.created_at as string,
      status: r.status as string,
      played: r.played as number,
      voided: r.voided as number,
    }));
  }

  /** Row counts of every data table: used to compare a restored backup with the live database. */
  rowCounts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const table of [
      'tournaments',
      'tournament_players',
      'tournament_tokens',
      'tournament_jornadas',
      'tournament_matches',
      'admin_audit',
      'schema_migrations',
    ]) {
      out[table] = this.count(`SELECT count(*) AS n FROM ${table}`);
    }
    return out;
  }
}

function toMatch(r: Row): StoredMatch {
  const pairing = r.pairing as string;
  if (!isPairing(pairing)) throw new Error(`Corrupt pairing in match ${String(r.id)}`);
  return {
    id: r.id as number,
    tournamentId: r.tournament_id as string,
    jornada: r.jornada as number,
    slot: r.slot as number,
    pairing,
    roomId: (r.room_id as string | null) ?? null,
    startedAt: (r.started_at as string | null) ?? null,
    endedAt: r.ended_at as string,
    recordedAt: r.recorded_at as string,
    winnerPair: r.winner_pair as 1 | 2,
    scorePair1: r.score_pair1 as number,
    scorePair2: r.score_pair2 as number,
    shutout: r.shutout === 1,
    hands: r.hands == null ? null : JSON.parse(r.hands as string),
    voidedAt: (r.voided_at as string | null) ?? null,
    voidedReason: (r.voided_reason as string | null) ?? null,
    voided: r.voided_at != null,
  };
}
