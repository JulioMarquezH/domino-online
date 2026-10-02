import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mulberry32, type LetterAssignment, type Pairing } from '@domino/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../src/db/database';
import { MIGRATIONS } from '../src/db/migrations';
import { StoreError, TournamentStore, type MatchRecordInput } from '../src/db/store';

const PLAYERS: LetterAssignment[] = [
  { letter: 'A', name: 'Ana' },
  { letter: 'B', name: 'Beto' },
  { letter: 'C', name: 'Caro' },
  { letter: 'D', name: 'Dani' },
];
const ID = 'ABCDEFGHJKMN';

let n = 0;
const now = () => new Date(Date.UTC(2026, 9, 7, 20, 0, n++)).toISOString();
const opened: Db[] = [];
const dirs: string[] = [];

function memory() {
  const db = openDatabase(':memory:');
  opened.push(db);
  return { db, store: new TournamentStore(db, { now, rng: mulberry32(1) }) };
}

function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), 'domino-db-'));
  dirs.push(dir);
  return join(dir, 'domino.db');
}

afterEach(() => {
  for (const db of opened.splice(0)) {
    try {
      db.close();
    } catch {
      // already closed by the test
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function record(
  store: TournamentStore,
  jornada: number,
  slot: number,
  winnerPair: 1 | 2 = 1,
  loserScore = 40,
): MatchRecordInput {
  const t = store.load(ID);
  const pairing = t?.jornadas.find((j) => j.number === jornada)?.matchOrder[slot - 1] as Pairing;
  return {
    tournamentId: ID,
    jornada,
    slot,
    pairing,
    roomId: 'ROOM01',
    startedAt: '2026-10-07T19:00:00.000Z',
    endedAt: '2026-10-07T19:30:00.000Z',
    winnerPair,
    scorePair1: winnerPair === 1 ? 100 : loserScore,
    scorePair2: winnerPair === 2 ? 100 : loserScore,
    hands: [{ hand: 1, starter: 0, kind: 'domino', winnerTeam: 0, points: 100 }],
  };
}

function playAll(store: TournamentStore) {
  for (let j = 1; j <= 4; j++) for (let s = 1; s <= 3; s++) store.recordMatch(record(store, j, s));
}

describe('migrations', () => {
  it('applies on a fresh database and records itself', () => {
    const { db } = memory();
    const rows = db.prepare('SELECT version, name FROM schema_migrations').all();
    expect(rows).toEqual([{ version: 1, name: 'tournaments' }]);
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  });

  it('is idempotent: running again applies nothing', () => {
    const { db } = memory();
    expect(migrate(db)).toEqual([]);
    expect(migrate(db)).toEqual([]);
    expect(db.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toEqual({ n: 1 });
  });

  it('applies later migrations on top of earlier data', () => {
    const file = tempFile();
    const first = openDatabase(file);
    first.close();
    const extra = [
      ...MIGRATIONS,
      { version: 2, name: 'extra', sql: 'CREATE TABLE extra (x INTEGER) STRICT;' },
    ];
    const second = openDatabase(file, { migrations: extra });
    opened.push(second);
    expect(second.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual([
      { version: 1 },
      { version: 2 },
    ]);
  });

  it('refuses to open a database written by a newer build', () => {
    const file = tempFile();
    const newer = openDatabase(file, {
      migrations: [...MIGRATIONS, { version: 9, name: 'future', sql: 'SELECT 1;' }],
    });
    newer.close();
    expect(() => openDatabase(file)).toThrow(/newer database/);
  });

  it('uses WAL and full synchronous writes on a real file', () => {
    const db = openDatabase(tempFile());
    opened.push(db);
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(db.prepare('PRAGMA synchronous').get()).toEqual({ synchronous: 2 }); // FULL
    expect(db.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 });
  });
});

describe('tournament creation', () => {
  it('stores players, a unique name key per tournament and jornada 1', () => {
    const { store } = memory();
    store.create(ID, 100, PLAYERS);
    const t = store.load(ID);
    expect(t?.players).toEqual(PLAYERS);
    expect(t?.status).toBe('active');
    expect(t?.jornadas).toHaveLength(1);
    expect([...(t?.jornadas[0]?.matchOrder ?? [])].sort()).toEqual(['AB-CD', 'AC-BD', 'AD-BC']);
    expect(store.letterForName(ID, 'beto')).toBe('B');
    expect(store.letterForName(ID, 'nadie')).toBeNull();
    expect(store.exists('ZZZZZZZZZZZZ')).toBe(false);
  });

  it('rejects two names with the same normalized key (database level)', () => {
    const { store } = memory();
    expect(() =>
      store.create(ID, 100, [
        { letter: 'A', name: 'José' },
        { letter: 'B', name: 'jose' },
        { letter: 'C', name: 'Caro' },
        { letter: 'D', name: 'Dani' },
      ]),
    ).toThrow();
    // …and nothing was left behind by the failed transaction.
    expect(store.exists(ID)).toBe(false);
  });

  it('keeps device tokens hashed, per player, and prunes the oldest', () => {
    const { store, db } = memory();
    store.create(ID, 100, PLAYERS);
    for (let i = 0; i < 15; i++) store.issueToken(ID, 'A', `hash-${i}`);
    expect(store.letterForToken(ID, 'hash-14')).toBe('A');
    expect(store.letterForToken(ID, 'hash-0')).toBeNull();
    expect(store.letterForToken('OTHERID12345', 'hash-14')).toBeNull();
    expect(db.prepare('SELECT count(*) AS n FROM tournament_tokens').get()).toEqual({ n: 12 });
  });
});

describe('recording matches', () => {
  it('records a match and derives nothing but the facts', () => {
    const { store } = memory();
    store.create(ID, 100, PLAYERS);
    const out = store.recordMatch(record(store, 1, 1, 2, 0));
    expect(out).toMatchObject({ result: 'recorded', finished: false, startedJornada: null });
    const m = store.load(ID)?.matches[0];
    expect(m).toMatchObject({
      jornada: 1,
      slot: 1,
      winnerPair: 2,
      scorePair1: 0,
      scorePair2: 100,
      shutout: true,
      voidedAt: null,
    });
    expect(m?.hands).toEqual([{ hand: 1, starter: 0, kind: 'domino', winnerTeam: 0, points: 100 }]);
  });

  it('is idempotent: the same slot is never recorded twice', () => {
    const { store, db } = memory();
    store.create(ID, 100, PLAYERS);
    const first = store.recordMatch(record(store, 1, 1));
    const again = store.recordMatch(record(store, 1, 1, 2));
    expect(again).toMatchObject({ result: 'duplicate', matchId: first.matchId });
    expect(db.prepare('SELECT count(*) AS n FROM tournament_matches').get()).toEqual({ n: 1 });
    // The raw unique index also blocks a direct duplicate insert.
    expect(() =>
      db
        .prepare(
          `INSERT INTO tournament_matches (tournament_id, jornada, slot, pairing, ended_at, recorded_at,
             winner_pair, score_pair1, score_pair2, shutout) VALUES (?, 1, 1, ?, 'x', 'x', 1, 100, 5, 0)`,
        )
        .run(ID, store.load(ID)?.jornadas[0]?.matchOrder[0] as string),
    ).toThrow(/UNIQUE/);
  });

  it('rejects a pairing that is not the drawn one for the slot', () => {
    const { store } = memory();
    store.create(ID, 100, PLAYERS);
    const input = record(store, 1, 1);
    const wrong: Pairing = input.pairing === 'AB-CD' ? 'AC-BD' : 'AB-CD';
    expect(() => store.recordMatch({ ...input, pairing: wrong })).toThrow(StoreError);
    expect(() => store.recordMatch({ ...input, jornada: 2 })).toThrow(/has not started/);
    expect(() => store.recordMatch({ ...input, tournamentId: 'NOPENOPENOPE' })).toThrow(
      /Unknown tournament/,
    );
  });

  it('rejects impossible scores at the database level', () => {
    const { store } = memory();
    store.create(ID, 100, PLAYERS);
    const input = record(store, 1, 1);
    expect(() => store.recordMatch({ ...input, scorePair1: 50, scorePair2: 50 })).toThrow();
    expect(store.load(ID)?.matches).toHaveLength(0);
  });

  it('starts the next jornada when the third match of one is recorded', () => {
    const { store } = memory();
    store.create(ID, 100, PLAYERS);
    store.recordMatch(record(store, 1, 1));
    store.recordMatch(record(store, 1, 2));
    expect(store.load(ID)?.jornadas).toHaveLength(1);
    const third = store.recordMatch(record(store, 1, 3));
    expect(third.startedJornada).toBe(2);
    const t = store.load(ID);
    expect(t?.jornadas.map((j) => j.number)).toEqual([1, 2]);
    expect([...(t?.jornadas[1]?.matchOrder ?? [])].sort()).toEqual(['AB-CD', 'AC-BD', 'AD-BC']);
  });

  it('closes the tournament at match 12 and never creates a fifth jornada', () => {
    const { store } = memory();
    store.create(ID, 100, PLAYERS);
    playAll(store);
    const t = store.load(ID);
    expect(t?.status).toBe('finished');
    expect(t?.finishedAt).not.toBeNull();
    expect(t?.jornadas.map((j) => j.number)).toEqual([1, 2, 3, 4]);
    expect(t?.matches).toHaveLength(12);
    expect(store.summaries([ID, 'UNKNOWN12345'])).toEqual([
      { id: ID, status: 'finished', played: 12 },
    ]);
  });

  it('rolls the whole write back when anything fails', () => {
    const { store, db } = memory();
    store.create(ID, 100, PLAYERS);
    store.recordMatch(record(store, 1, 1));
    store.recordMatch(record(store, 1, 2));
    // Make the third insert fail late (inside the transaction) with a trigger that always aborts.
    db.exec(
      `CREATE TRIGGER boom BEFORE UPDATE ON tournaments BEGIN SELECT RAISE(ABORT, 'boom'); END`,
    );
    // Third match does not update `tournaments` (not match 12), so force failure via jornada insert.
    db.exec(`CREATE TRIGGER boom2 BEFORE INSERT ON tournament_jornadas
             WHEN NEW.number = 2 BEGIN SELECT RAISE(ABORT, 'boom2'); END`);
    expect(() => store.recordMatch(record(store, 1, 3))).toThrow(/boom2/);
    expect(store.load(ID)?.matches).toHaveLength(2); // the third insert was rolled back
    db.exec('DROP TRIGGER boom2');
    expect(store.recordMatch(record(store, 1, 3)).result).toBe('recorded');
  });
});

describe('immutability', () => {
  function seeded() {
    const ctx = memory();
    ctx.store.create(ID, 100, PLAYERS);
    ctx.store.recordMatch(record(ctx.store, 1, 1));
    return ctx;
  }

  it('blocks DELETE on tournament_matches', () => {
    const { db } = seeded();
    expect(() => db.exec('DELETE FROM tournament_matches')).toThrow(/immutable/);
    expect(() => db.exec('DELETE FROM tournament_matches WHERE id = 1')).toThrow(/immutable/);
    expect(db.prepare('SELECT count(*) AS n FROM tournament_matches').get()).toEqual({ n: 1 });
  });

  it('blocks UPDATE of every field except the void fields', () => {
    const { db } = seeded();
    for (const set of [
      'winner_pair = 2',
      'score_pair1 = 99',
      'score_pair2 = 1',
      'shutout = 1',
      "pairing = 'AB-CD'",
      'slot = 2',
      'jornada = 2',
      "ended_at = 'later'",
      "recorded_at = 'later'",
      "room_id = 'OTHER'",
      "hands = '[]'",
      "tournament_id = 'ZZZZZZZZZZZZ'",
      'id = 99',
    ]) {
      expect(() => db.exec(`UPDATE tournament_matches SET ${set}`), set).toThrow();
    }
    expect(db.prepare('SELECT winner_pair, score_pair1 FROM tournament_matches').get()).toEqual({
      winner_pair: 1,
      score_pair1: 100,
    });
  });

  it('allows voiding once, and a voided row can never change again', () => {
    const { db } = seeded();
    db.exec("UPDATE tournament_matches SET voided_at = 'now', voided_reason = 'prueba'");
    expect(() => db.exec("UPDATE tournament_matches SET voided_reason = 'otra razón'")).toThrow(
      /immutable/,
    );
    expect(() =>
      db.exec('UPDATE tournament_matches SET voided_at = NULL, voided_reason = NULL'),
    ).toThrow();
    expect(() => db.exec('DELETE FROM tournament_matches')).toThrow(/immutable/);
    expect(db.prepare('SELECT voided_reason FROM tournament_matches').get()).toEqual({
      voided_reason: 'prueba',
    });
  });

  it('requires a reason together with the void time', () => {
    const { db } = seeded();
    expect(() => db.exec("UPDATE tournament_matches SET voided_at = 'now'")).toThrow();
  });

  it('keeps the audit log append-only and the jornada order fixed', () => {
    const { store, db } = seeded();
    store.audit('note', ID, { hello: 'world' });
    expect(() => db.exec("UPDATE admin_audit SET action = 'x'")).toThrow(/append-only/);
    expect(() => db.exec('DELETE FROM admin_audit')).toThrow(/append-only/);
    expect(() => db.exec("UPDATE tournament_jornadas SET match_order = '[]'")).toThrow(/immutable/);
  });

  it('refuses to delete a tournament, jornada or player that has matches', () => {
    const { db, store } = seeded();
    expect(() => db.exec('DELETE FROM tournaments')).toThrow();
    expect(() => db.exec('DELETE FROM tournament_jornadas')).toThrow();
    expect(() => db.exec('DELETE FROM tournament_players')).toThrow();
    expect(() => store.deleteTournament(ID)).toThrow(/cannot be deleted/);
    expect(store.load(ID)).not.toBeNull();
  });
});

describe('voiding (admin)', () => {
  it('keeps the row, makes the slot pending again and reopens a finished tournament', () => {
    const { store } = memory();
    store.create(ID, 100, PLAYERS);
    playAll(store);
    expect(store.load(ID)?.status).toBe('finished');

    const voided = store.voidMatch(ID, 2, 3, 'se cayó la partida y se anotó mal');
    expect(voided.voidedAt).not.toBeNull();
    const t = store.load(ID);
    expect(t?.status).toBe('active');
    expect(t?.finishedAt).toBeNull();
    expect(t?.matches).toHaveLength(12); // the voided row is still there
    expect(t?.matches.filter((m) => !m.voided)).toHaveLength(11);
    expect(store.summaries([ID])[0]?.played).toBe(11);

    // The slot can be replayed; the new record coexists with the voided one.
    const replay = store.recordMatch(record(store, 2, 3, 2));
    expect(replay).toMatchObject({ result: 'recorded', finished: true });
    expect(store.load(ID)?.matches).toHaveLength(13);
    expect(store.load(ID)?.status).toBe('finished');
  });

  it('requires a reason, an existing match, and writes the audit trail', () => {
    const { store } = memory();
    store.create(ID, 100, PLAYERS);
    store.recordMatch(record(store, 1, 1));
    expect(() => store.voidMatch(ID, 1, 1, '  ')).toThrow(/reason/);
    expect(() => store.voidMatch(ID, 1, 2, 'x')).toThrow(/no recorded match/);
    store.voidMatch(ID, 1, 1, 'duplicado');
    expect(() => store.voidMatch(ID, 1, 1, 'otra vez')).toThrow(/no recorded match/);
    const log = store.auditLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: 'void-match', tournamentId: ID });
    expect(log[0]?.details).toMatchObject({ jornada: 1, slot: 1, reason: 'duplicado' });
  });
});

describe('other admin actions', () => {
  it('renames a player (audited) but never to a name another player has', () => {
    const { store } = memory();
    store.create(ID, 100, PLAYERS);
    store.renamePlayer(ID, 'B', 'Beto Pérez');
    expect(store.letterForName(ID, 'beto perez')).toBe('B');
    expect(store.letterForName(ID, 'beto')).toBeNull();
    expect(() => store.renamePlayer(ID, 'B', 'ANA')).toThrow(/already has that name/);
    expect(() => store.renamePlayer(ID, 'Z', 'Zeta')).toThrow(StoreError);
    expect(store.auditLog()[0]).toMatchObject({ action: 'rename-player' });
  });

  it('deletes only a tournament with zero match records', () => {
    const { store } = memory();
    store.create(ID, 100, PLAYERS);
    store.issueToken(ID, 'A', 'hash');
    store.deleteTournament(ID);
    expect(store.exists(ID)).toBe(false);
    expect(store.auditLog()[0]).toMatchObject({ action: 'delete-tournament', tournamentId: ID });
    expect(() => store.deleteTournament(ID)).toThrow(/No such tournament/);
  });

  it('refuses to delete a tournament whose only matches are voided', () => {
    const { store } = memory();
    store.create(ID, 100, PLAYERS);
    store.recordMatch(record(store, 1, 1));
    store.voidMatch(ID, 1, 1, 'prueba');
    expect(() => store.deleteTournament(ID)).toThrow(/cannot be deleted/);
  });
});

describe('durability', () => {
  it('survives closing and reopening the database (a restart)', () => {
    const file = tempFile();
    const db1 = openDatabase(file);
    const s1 = new TournamentStore(db1, { now, rng: mulberry32(1) });
    s1.create(ID, 100, PLAYERS);
    s1.issueToken(ID, 'C', 'device-hash');
    s1.recordMatch(record(s1, 1, 1, 2, 0));
    s1.recordMatch(record(s1, 1, 2));
    const before = s1.load(ID);
    db1.close();

    const db2 = openDatabase(file);
    opened.push(db2);
    const s2 = new TournamentStore(db2, { now, rng: mulberry32(99) });
    expect(s2.load(ID)).toEqual(before);
    expect(s2.letterForToken(ID, 'device-hash')).toBe('C');
    // …and the next jornada order is the one that was persisted, not a new draw.
    s2.recordMatch(record(s2, 1, 3));
    expect(s2.load(ID)?.jornadas[0]).toEqual(before?.jornadas[0]);
    expect(s2.load(ID)?.matches).toHaveLength(3);
  });

  it('VACUUM INTO makes a consistent copy that opens read-only with the same counts', () => {
    const file = tempFile();
    const db = openDatabase(file);
    const store = new TournamentStore(db, { now, rng: mulberry32(1) });
    store.create(ID, 100, PLAYERS);
    store.recordMatch(record(store, 1, 1));
    const copy = `${file}.backup`;
    db.exec(`VACUUM INTO '${copy}'`);
    const restored = openDatabase(copy, { readOnly: true });
    opened.push(restored, db);
    expect(new TournamentStore(restored, { now, rng: mulberry32(1) }).rowCounts()).toEqual(
      store.rowCounts(),
    );
    expect(restored.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
  });
});
