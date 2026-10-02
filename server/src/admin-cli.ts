import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  LETTERS,
  computeStandings,
  formatAvg,
  formatPts,
  isLetter,
  type Letter,
} from '@domino/shared';
import { cryptoRng } from './ids';
import { openDatabase, type Db } from './db/database';
import { StoreError, TournamentStore } from './db/store';

export const USAGE = `Administración del torneo (solo desde el servidor; todo queda en admin_audit)

  list                                          torneos, partidos jugados y anulados
  show <torneoId>                               jugadores, calendario y tabla
  void-match <torneoId> <jornada> <slot> --reason "motivo"
                                                anula un partido (la fila se conserva y el cupo
                                                vuelve a quedar pendiente)
  rename-player <torneoId> <letra> "Nombre nuevo"
  delete-tournament <torneoId>                  solo si nunca tuvo partidos
  audit [n]                                     últimas acciones de administrador
  backup <archivo.db>                           copia consistente (VACUUM INTO) + verificación
  verify-backup <archivo.db> [--against <bd>]   integridad y conteo de filas de una copia

Base de datos: --db <ruta> o DATABASE_PATH (por defecto ./data/domino.db)`;

type Out = (line: string) => void;

export class UsageError extends Error {}

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a.startsWith('--')) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--'))
        throw new UsageError(`Falta el valor de ${a}`);
      flags[a.slice(2)] = value;
      i++;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function need(args: string[], n: number, what: string): string[] {
  if (args.length < n) throw new UsageError(`Faltan argumentos: ${what}`);
  return args;
}

function intArg(raw: string | undefined, name: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new UsageError(`${name} debe ser un número entero`);
  return n;
}

function openExisting(path: string): Db {
  if (path !== ':memory:' && !existsSync(path)) {
    throw new UsageError(`No existe la base de datos ${path}`);
  }
  return openDatabase(path);
}

const newStore = (db: Db) =>
  new TournamentStore(db, { now: () => new Date().toISOString(), rng: cryptoRng });

/** Runs one admin command. Returns the process exit code. */
export function runAdmin(argv: string[], env: NodeJS.ProcessEnv, out: Out = console.log): number {
  const { positional, flags } = parseArgs(argv);
  const [command, ...rest] = positional;
  const dbPath = resolve(flags.db ?? env.DATABASE_PATH ?? './data/domino.db');
  if (!command || command === 'help') {
    out(USAGE);
    return command ? 0 : 1;
  }

  if (command === 'verify-backup') {
    const [file] = need(rest, 1, 'verify-backup <archivo.db>');
    return verifyBackup(file as string, flags.against ? resolve(flags.against) : null, out);
  }

  const db = openExisting(dbPath);
  try {
    const store = newStore(db);
    switch (command) {
      case 'list': {
        const rows = store.listTournaments();
        if (rows.length === 0) out('(sin torneos)');
        for (const r of rows) {
          out(
            `${r.id}  ${r.status.padEnd(8)}  ${r.played}/12 jugados  ${r.voided} anulados  creado ${r.createdAt}`,
          );
        }
        return 0;
      }
      case 'show': {
        const [id] = need(rest, 1, 'show <torneoId>');
        const t = store.load(id as string);
        if (!t) throw new UsageError('No existe ese torneo');
        out(`Torneo ${t.id} · ${t.status} · meta ${t.target} · creado ${t.createdAt}`);
        for (const p of t.players) out(`  ${p.letter}  ${p.name}`);
        for (const j of t.jornadas) {
          out(`Jornada ${j.number}: ${j.matchOrder.join('  ')}`);
          for (const m of t.matches.filter((x) => x.jornada === j.number)) {
            out(
              `  slot ${m.slot} ${m.pairing}  ${m.scorePair1}-${m.scorePair2}${m.shutout ? ' zapatero' : ''}` +
                `  ${m.endedAt}${m.voidedAt ? `  ANULADO ${m.voidedAt}: ${m.voidedReason}` : ''}`,
            );
          }
        }
        out('Tabla:');
        for (const r of computeStandings(t.players, t.matches)) {
          out(
            `  ${r.rank}. ${r.name} (${r.letter})  PJ ${r.pj}  PG ${r.pg}  Zap ${r.zap}  Pts ${formatPts(r.pts)}  Avg ${formatAvg(r.avg)}`,
          );
        }
        return 0;
      }
      case 'void-match': {
        const [id, j, s] = need(rest, 3, 'void-match <torneoId> <jornada> <slot> --reason "…"');
        const reason = flags.reason;
        if (!reason?.trim()) throw new UsageError('Falta --reason "motivo"');
        const m = store.voidMatch(id as string, intArg(j, 'jornada'), intArg(s, 'slot'), reason);
        out(
          `Anulado: jornada ${m.jornada} slot ${m.slot} (${m.scorePair1}-${m.scorePair2}). El cupo quedó pendiente.`,
        );
        return 0;
      }
      case 'rename-player': {
        const [id, letter, name] = need(rest, 3, 'rename-player <torneoId> <letra> "Nombre"');
        const l = (letter as string).toUpperCase();
        if (!isLetter(l)) throw new UsageError(`La letra debe ser una de ${LETTERS.join(', ')}`);
        store.renamePlayer(id as string, l as Letter, name as string);
        out(`Jugador ${l} renombrado a "${name}".`);
        return 0;
      }
      case 'delete-tournament': {
        const [id] = need(rest, 1, 'delete-tournament <torneoId>');
        store.deleteTournament(id as string);
        out('Torneo borrado (no tenía partidos).');
        return 0;
      }
      case 'audit': {
        for (const a of store.auditLog(rest[0] ? intArg(rest[0], 'n') : 20)) {
          out(`${a.at}  ${a.action}  ${a.tournamentId ?? '-'}  ${JSON.stringify(a.details)}`);
        }
        return 0;
      }
      case 'backup': {
        const [dest] = need(rest, 1, 'backup <archivo.db>');
        return backup(db, store, resolve(dest as string), out);
      }
      default:
        throw new UsageError(`Comando desconocido: ${command}`);
    }
  } finally {
    db.close();
  }
}

function backup(db: Db, store: TournamentStore, dest: string, out: Out): number {
  if (existsSync(dest)) throw new UsageError(`${dest} ya existe; no se sobrescribe`);
  mkdirSync(dirname(dest), { recursive: true });
  // VACUUM INTO takes a consistent snapshot of a live database; a raw file copy would not.
  db.exec(`VACUUM INTO '${dest.replaceAll("'", "''")}'`);
  const copy = new DatabaseSync(dest, { readOnly: true });
  try {
    const integrity = (copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string })
      .integrity_check;
    if (integrity !== 'ok') throw new Error(`La copia falló integrity_check: ${integrity}`);
    const counts = countsOf(copy);
    const live = store.rowCounts();
    const same = JSON.stringify(counts) === JSON.stringify(live);
    out(`Copia creada: ${dest} (${statSync(dest).size} bytes), integrity_check ok`);
    out(
      `Filas: ${JSON.stringify(counts)}${same ? '' : '  (la base viva cambió durante la copia)'}`,
    );
  } finally {
    copy.close();
  }
  return 0;
}

function countsOf(db: DatabaseSync): Record<string, number> {
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
    out[table] = (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  }
  return out;
}

/** Opens a backup read-only, checks it and (optionally) compares row counts with another database. */
function verifyBackup(file: string, against: string | null, out: Out): number {
  if (!existsSync(file)) throw new UsageError(`No existe ${file}`);
  const copy = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = (copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string })
      .integrity_check;
    const fk = copy.prepare('PRAGMA foreign_key_check').all();
    const counts = countsOf(copy);
    out(
      `integrity_check: ${integrity}; foreign_key_check: ${fk.length === 0 ? 'ok' : `${fk.length} problemas`}`,
    );
    out(`Filas en la copia: ${JSON.stringify(counts)}`);
    let ok = integrity === 'ok' && fk.length === 0;
    if (against) {
      const live = new DatabaseSync(against, { readOnly: true });
      try {
        const liveCounts = countsOf(live);
        out(`Filas en ${against}: ${JSON.stringify(liveCounts)}`);
        const diff = Object.keys(counts).filter((k) => counts[k] !== liveCounts[k]);
        if (diff.length === 0) out('Los conteos coinciden.');
        else {
          out(
            `Difieren: ${diff.map((k) => `${k} (copia ${counts[k]}, viva ${liveCounts[k]})`).join(', ')}`,
          );
          // A backup older than the live database legitimately has fewer rows; more rows is wrong.
          ok = ok && diff.every((k) => (counts[k] as number) <= (liveCounts[k] as number));
        }
      } finally {
        live.close();
      }
    }
    out(ok ? 'COPIA VÁLIDA' : 'COPIA CON PROBLEMAS');
    return ok ? 0 : 2;
  } finally {
    copy.close();
  }
}

/** Entry point used by `admin.ts`: friendly errors, proper exit codes. */
export function main(argv: string[], env: NodeJS.ProcessEnv): number {
  try {
    return runAdmin(argv, env);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`Error: ${error.message}\n\n${USAGE}`);
      return 1;
    }
    if (error instanceof StoreError) {
      console.error(`Error: ${error.message}`);
      return 1;
    }
    console.error(error);
    return 2;
  }
}
