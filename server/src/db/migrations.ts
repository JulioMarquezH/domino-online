/**
 * Versioned schema migrations. Each one runs once, in order, inside a transaction, and is recorded
 * in `schema_migrations`. NEVER edit a migration that has shipped: add a new one.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'tournaments',
    sql: `
CREATE TABLE tournaments (
  id          TEXT PRIMARY KEY CHECK (length(id) >= 10),
  created_at  TEXT NOT NULL,
  target      INTEGER NOT NULL CHECK (target > 0),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
  finished_at TEXT
) STRICT;

CREATE TABLE tournament_players (
  tournament_id TEXT NOT NULL REFERENCES tournaments (id),
  letter        TEXT NOT NULL CHECK (letter IN ('A', 'B', 'C', 'D')),
  display_name  TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  name_key      TEXT NOT NULL CHECK (length(name_key) >= 1),
  PRIMARY KEY (tournament_id, letter),
  UNIQUE (tournament_id, name_key)
) STRICT;

-- Per-device identities. Only a hash of the token is stored; a player can have several devices.
CREATE TABLE tournament_tokens (
  token_hash    TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL,
  letter        TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  FOREIGN KEY (tournament_id, letter) REFERENCES tournament_players (tournament_id, letter)
) STRICT;
CREATE INDEX tournament_tokens_player ON tournament_tokens (tournament_id, letter, created_at);

-- The shuffled order of the three matches of each jornada, drawn when the jornada starts.
CREATE TABLE tournament_jornadas (
  tournament_id TEXT NOT NULL REFERENCES tournaments (id),
  number        INTEGER NOT NULL CHECK (number BETWEEN 1 AND 4),
  match_order   TEXT NOT NULL CHECK (json_valid(match_order)),
  created_at    TEXT NOT NULL,
  PRIMARY KEY (tournament_id, number)
) STRICT;

CREATE TABLE tournament_matches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id TEXT NOT NULL REFERENCES tournaments (id),
  jornada       INTEGER NOT NULL,
  slot          INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 3),
  pairing       TEXT NOT NULL CHECK (pairing IN ('AB-CD', 'AC-BD', 'AD-BC')),
  room_id       TEXT,
  started_at    TEXT,
  ended_at      TEXT NOT NULL,
  recorded_at   TEXT NOT NULL,
  winner_pair   INTEGER NOT NULL CHECK (winner_pair IN (1, 2)),
  score_pair1   INTEGER NOT NULL CHECK (score_pair1 >= 0),
  score_pair2   INTEGER NOT NULL CHECK (score_pair2 >= 0),
  shutout       INTEGER NOT NULL CHECK (shutout IN (0, 1)),
  hands         TEXT CHECK (hands IS NULL OR json_valid(hands)),
  voided_at     TEXT,
  voided_reason TEXT,
  CHECK ((voided_at IS NULL) = (voided_reason IS NULL)),
  CHECK (
    (winner_pair = 1 AND score_pair1 > score_pair2) OR (winner_pair = 2 AND score_pair2 > score_pair1)
  ),
  CHECK (
    shutout = (CASE winner_pair WHEN 1 THEN score_pair2 ELSE score_pair1 END = 0)
  ),
  FOREIGN KEY (tournament_id, jornada) REFERENCES tournament_jornadas (tournament_id, number)
) STRICT;

-- A slot can be recorded once; a voided slot may be replayed (the voided row stays forever).
CREATE UNIQUE INDEX tournament_matches_slot_once
  ON tournament_matches (tournament_id, jornada, slot) WHERE voided_at IS NULL;

CREATE TABLE admin_audit (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  at            TEXT NOT NULL,
  action        TEXT NOT NULL,
  tournament_id TEXT,
  details       TEXT NOT NULL CHECK (json_valid(details))
) STRICT;

-- ── immutability ──────────────────────────────────────────────────────────────────────────
CREATE TRIGGER tournament_matches_no_delete BEFORE DELETE ON tournament_matches
BEGIN
  SELECT RAISE(ABORT, 'tournament_matches are immutable: DELETE is not allowed');
END;

-- The only allowed UPDATE is setting voided_at + voided_reason on a match that is not voided yet.
CREATE TRIGGER tournament_matches_immutable BEFORE UPDATE ON tournament_matches
WHEN OLD.voided_at IS NOT NULL
  OR NEW.voided_at IS NULL
  OR NEW.id IS NOT OLD.id
  OR NEW.tournament_id IS NOT OLD.tournament_id
  OR NEW.jornada IS NOT OLD.jornada
  OR NEW.slot IS NOT OLD.slot
  OR NEW.pairing IS NOT OLD.pairing
  OR NEW.room_id IS NOT OLD.room_id
  OR NEW.started_at IS NOT OLD.started_at
  OR NEW.ended_at IS NOT OLD.ended_at
  OR NEW.recorded_at IS NOT OLD.recorded_at
  OR NEW.winner_pair IS NOT OLD.winner_pair
  OR NEW.score_pair1 IS NOT OLD.score_pair1
  OR NEW.score_pair2 IS NOT OLD.score_pair2
  OR NEW.shutout IS NOT OLD.shutout
  OR NEW.hands IS NOT OLD.hands
BEGIN
  SELECT RAISE(ABORT, 'tournament_matches are immutable: only voiding is allowed');
END;

CREATE TRIGGER admin_audit_no_update BEFORE UPDATE ON admin_audit
BEGIN
  SELECT RAISE(ABORT, 'admin_audit is append-only');
END;
CREATE TRIGGER admin_audit_no_delete BEFORE DELETE ON admin_audit
BEGIN
  SELECT RAISE(ABORT, 'admin_audit is append-only');
END;

-- The drawn order of a jornada never changes.
CREATE TRIGGER tournament_jornadas_no_update BEFORE UPDATE ON tournament_jornadas
BEGIN
  SELECT RAISE(ABORT, 'tournament_jornadas are immutable');
END;

-- A tournament with recorded matches (voided ones included) can never be deleted.
CREATE TRIGGER tournaments_keep_matches BEFORE DELETE ON tournaments
WHEN EXISTS (SELECT 1 FROM tournament_matches WHERE tournament_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete a tournament that has matches');
END;
CREATE TRIGGER tournament_jornadas_keep_matches BEFORE DELETE ON tournament_jornadas
WHEN EXISTS (SELECT 1 FROM tournament_matches WHERE tournament_id = OLD.tournament_id)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete a jornada of a tournament that has matches');
END;
CREATE TRIGGER tournament_players_keep_matches BEFORE DELETE ON tournament_players
WHEN EXISTS (SELECT 1 FROM tournament_matches WHERE tournament_id = OLD.tournament_id)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete a player of a tournament that has matches');
END;
`,
  },
];
