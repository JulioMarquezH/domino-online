import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mulberry32, type Pairing } from '@domino/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAdmin, UsageError } from '../src/admin-cli';
import { openDatabase } from '../src/db/database';
import { TournamentStore } from '../src/db/store';

const ID = 'ABCDEFGHJKMN';
let dir: string;
let dbFile: string;
let lines: string[];
const out = (l: string) => void lines.push(l);
const run = (...argv: string[]) => runAdmin(['--db', dbFile, ...argv], {}, out);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'domino-admin-'));
  dbFile = join(dir, 'domino.db');
  lines = [];
  const db = openDatabase(dbFile);
  const store = new TournamentStore(db, {
    now: () => new Date().toISOString(),
    rng: mulberry32(1),
  });
  store.create(ID, 100, [
    { letter: 'A', name: 'Ana' },
    { letter: 'B', name: 'Beto' },
    { letter: 'C', name: 'Caro' },
    { letter: 'D', name: 'Dani' },
  ]);
  const pairing = store.load(ID)?.jornadas[0]?.matchOrder[0] as Pairing;
  store.recordMatch({
    tournamentId: ID,
    jornada: 1,
    slot: 1,
    pairing,
    roomId: 'R',
    startedAt: null,
    endedAt: new Date().toISOString(),
    winnerPair: 1,
    scorePair1: 100,
    scorePair2: 0,
    hands: [],
  });
  store.create('ZZZZZZZZZZZZ', 100, [
    { letter: 'A', name: 'Uno' },
    { letter: 'B', name: 'Dos' },
    { letter: 'C', name: 'Tres' },
    { letter: 'D', name: 'Cuatro' },
  ]);
  db.close();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const store = () => {
  const db = openDatabase(dbFile);
  return {
    db,
    s: new TournamentStore(db, { now: () => new Date().toISOString(), rng: mulberry32(1) }),
  };
};

describe('admin script', () => {
  it('lists and shows tournaments', () => {
    expect(run('list')).toBe(0);
    expect(lines.join('\n')).toContain(`${ID}  active    1/12 jugados`);
    lines = [];
    expect(run('show', ID)).toBe(0);
    expect(lines.join('\n')).toContain('zapatero');
    expect(lines.join('\n')).toMatch(/1\. .*Pts 1\.5/);
  });

  it('voids a match with a mandatory reason, and audits it', () => {
    expect(() => run('void-match', ID, '1', '1')).toThrow(UsageError);
    expect(run('void-match', ID, '1', '1', '--reason', 'partida mal anotada')).toBe(0);
    const { db, s } = store();
    expect(s.load(ID)?.matches[0]?.voidedReason).toBe('partida mal anotada');
    expect(s.auditLog()[0]).toMatchObject({ action: 'void-match', tournamentId: ID });
    db.close();
    lines = [];
    run('audit');
    expect(lines.join('\n')).toContain('void-match');
  });

  it('renames a player (audited)', () => {
    expect(run('rename-player', ID, 'b', 'Beto Pérez')).toBe(0);
    const { db, s } = store();
    expect(s.load(ID)?.players[1]?.name).toBe('Beto Pérez');
    expect(s.auditLog()[0]?.action).toBe('rename-player');
    db.close();
    expect(() => run('rename-player', ID, 'Z', 'Nadie')).toThrow(UsageError);
  });

  it('deletes only a tournament with zero matches', () => {
    expect(() => run('delete-tournament', ID)).toThrow(/cannot be deleted/);
    expect(run('delete-tournament', 'ZZZZZZZZZZZZ')).toBe(0);
    const { db, s } = store();
    expect(s.exists('ZZZZZZZZZZZZ')).toBe(false);
    expect(s.exists(ID)).toBe(true);
    expect(s.auditLog()[0]?.action).toBe('delete-tournament');
    db.close();
  });

  it('backs up a live database and verifies the copy against it', () => {
    const copy = join(dir, 'backups', 'copy.db');
    expect(run('backup', copy)).toBe(0);
    expect(existsSync(copy)).toBe(true);
    expect(lines.join('\n')).toContain('integrity_check ok');
    expect(() => run('backup', copy)).toThrow(/ya existe/); // never overwrites
    lines = [];
    expect(runAdmin(['verify-backup', copy, '--against', dbFile], {}, out)).toBe(0);
    expect(lines.join('\n')).toContain('Los conteos coinciden');
    expect(lines.join('\n')).toContain('COPIA VÁLIDA');
  });

  it('flags a copy that has more rows than the live database', () => {
    const copy = join(dir, 'copy.db');
    run('backup', copy);
    run('delete-tournament', 'ZZZZZZZZZZZZ');
    lines = [];
    // The copy is OLDER than the live db → fewer or equal rows is fine; this one has MORE players.
    expect(runAdmin(['verify-backup', copy, '--against', dbFile], {}, out)).toBe(2);
    expect(lines.join('\n')).toContain('COPIA CON PROBLEMAS');
  });

  it('fails clearly for a missing database or an unknown command', () => {
    expect(() => runAdmin(['--db', join(dir, 'nope.db'), 'list'], {}, out)).toThrow(/No existe/);
    expect(() => run('explode')).toThrow(UsageError);
    expect(runAdmin([], {}, out)).toBe(1);
    expect(runAdmin(['--help'], {}, out)).toBe(0);
  });
});
