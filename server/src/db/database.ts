import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, type Migration } from './migrations';

export type Db = DatabaseSync;

export interface OpenOptions {
  /** Read-only handle (used to inspect backups); migrations are not applied. */
  readOnly?: boolean;
  migrations?: Migration[];
  /** ISO timestamp provider for `schema_migrations.applied_at`. */
  now?: () => string;
}

/**
 * Opens (creating if needed) the SQLite database with the durability pragmas the tournaments
 * need and applies pending migrations. `:memory:` is allowed for tests.
 */
export function openDatabase(path: string, options: OpenOptions = {}): Db {
  const inMemory = path === ':memory:';
  if (!inMemory && !options.readOnly) mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { readOnly: options.readOnly ?? false });
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  if (!options.readOnly) {
    // WAL + synchronous=FULL: a committed match survives a crash or power loss.
    const row = db.prepare('PRAGMA journal_mode = WAL').get() as { journal_mode: string };
    if (!inMemory && row.journal_mode !== 'wal') {
      throw new Error(`Could not enable WAL on ${path} (journal_mode=${row.journal_mode})`);
    }
    db.exec('PRAGMA synchronous = FULL');
    migrate(db, options.migrations ?? MIGRATIONS, options.now);
  }
  return db;
}

/** Runs `fn` in one write transaction (BEGIN IMMEDIATE): all or nothing. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // the transaction was already rolled back by SQLite
    }
    throw error;
  }
}

/** Applies the migrations that are not recorded yet. Safe to run on every start (idempotent). */
export function migrate(
  db: Db,
  migrations: Migration[] = MIGRATIONS,
  now: () => string = () => new Date().toISOString(),
): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT`);
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
      (r) => r.version,
    ),
  );
  const latest = Math.max(0, ...migrations.map((m) => m.version));
  const newest = Math.max(0, ...applied);
  if (newest > latest) {
    throw new Error(
      `The database is at schema version ${newest} but this build only knows up to ${latest}. ` +
        'Refusing to start with an older build on a newer database.',
    );
  }
  const ran: number[] = [];
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (applied.has(m.version)) continue;
    transaction(db, () => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        now(),
      );
    });
    ran.push(m.version);
  }
  return ran;
}
