-- OpenMTG hosted server: migration 001, the initial schema (docs/design/m13-hosted-server.md 8.2; M13-4).
--
-- Run by the migration command (`migrate` in src/store/migrate.ts) with the database owner's role, in one transaction, recorded in schema_migrations.
-- Least privilege (review minor 6): the service's role needs SELECT on schema_migrations (the version check at start); SELECT, INSERT, UPDATE,
-- DELETE on sessions, games, seats, actions, snapshots, bug_reports; only INSERT and SELECT on results and placements (append-only, kept). No DDL.
-- The database must be UTF8 (the migrate command checks); the migrating and the service's roles need the same search_path (to_regclass).
--
-- Text rules (design review 2): the action log and the game config are `json` columns (the exact text, so key order is kept: the checkpoint hash
-- of a replayed state depends on it) with a CHECK that casts them to jsonb, so PostgreSQL refuses exactly what jsonb refuses (a \u0000 escape, an
-- unpaired surrogate escape). Such a refusal fails only its game's savepoint in a group commit. Report attachments are TEXT, never jsonb.
-- Client addresses are never stored; tokens, invite codes and passwords only as hashes; the seed only in games.seed.

-- (schema_migrations (version, name, applied_at) is created by the migration command itself before the first migration.)

-- Guest sessions (design 3.2). Deleted 30 days after last_seen (retention); placements keep the orphaned id.
CREATE TABLE sessions (
  id text PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL,
  last_seen timestamptz NOT NULL
);
CREATE INDEX sessions_last_seen ON sessions (last_seen);

-- Tables and games (design 4.1, 2.3). seed: secret, its own column so a config can be exported without it.
CREATE TABLE games (
  id text PRIMARY KEY,
  format text NOT NULL,
  variant text,
  seats smallint NOT NULL CHECK (seats BETWEEN 2 AND 4),
  source text NOT NULL CHECK (source IN ('listed', 'private', 'matched')),
  title text NOT NULL,
  password_hash text,
  password_salt text,
  status text NOT NULL CHECK (status IN ('lobby', 'waitingCapacity', 'running', 'finished', 'void', 'quarantined')),
  ranked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  waiting_since timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  engine_build text,
  rules_pack text,
  seed text,
  seating smallint[],
  config json CHECK (config IS NULL OR (config::jsonb) IS NOT NULL),
  last_seq integer NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  recoveries integer NOT NULL DEFAULT 0,
  engine_errors integer NOT NULL DEFAULT 0,
  void_reason text,
  node text,
  lease_until timestamptz
);
-- recovery at start (runningGames), per node for milestone 16's scale-out
CREATE INDEX games_running ON games (node, started_at) WHERE status = 'running';
-- the capacity queue's order after a restart (waitingTables)
CREATE INDEX games_waiting ON games (waiting_since) WHERE status = 'waitingCapacity';
-- retention: unstarted tables by age, ended games by end
CREATE INDEX games_unstarted ON games (created_at) WHERE status IN ('lobby', 'waitingCapacity');
CREATE INDEX games_ended ON games (status, ended_at) WHERE ended_at IS NOT NULL;

-- Seats; decklists are private (never shown to another player, never logged).
CREATE TABLE seats (
  game_id text NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  seat smallint NOT NULL CHECK (seat BETWEEN 1 AND 4),
  player text CHECK (player IN ('p1', 'p2', 'p3', 'p4')),
  session_id text,
  name text,
  deck jsonb,
  deck_hash text,
  invite_hash text,
  joined_at timestamptz,
  left_at timestamptz,
  PRIMARY KEY (game_id, seat)
);
CREATE INDEX seats_session ON seats (session_id) WHERE session_id IS NOT NULL;

-- The action log (design D4, 8.1): append-only, one row per applied action, committed before anything derived from it is sent.
CREATE TABLE actions (
  game_id text NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq >= 1),
  seat smallint NOT NULL,
  action json NOT NULL CHECK ((action::jsonb) IS NOT NULL),
  cause text CHECK (cause IN ('timeout', 'disconnect', 'left', 'approved')),
  approved_by smallint[],
  clocks jsonb NOT NULL,
  elapsed_ms double precision NOT NULL,
  at timestamptz NOT NULL,
  check_hash text,
  PRIMARY KEY (game_id, seq)
);

-- Snapshots (design 2.3): written only after the record of their seq committed; deleted when the game ends.
CREATE TABLE snapshots (
  game_id text NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq >= 1),
  engine_build text NOT NULL,
  hash text NOT NULL,
  state bytea NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (game_id, seq)
);

-- The results ledger (design 7): append-only and kept (no reference to games, which retention deletes).
CREATE TABLE results (
  game_id text PRIMARY KEY,
  format text NOT NULL,
  variant text,
  seats smallint NOT NULL CHECK (seats BETWEEN 2 AND 4),
  source text NOT NULL CHECK (source IN ('listed', 'private', 'matched')),
  ranked boolean NOT NULL DEFAULT false,
  outcome text NOT NULL CHECK (outcome IN ('win', 'draw', 'void')),
  reason text NOT NULL,
  turns integer NOT NULL,
  actions integer NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  engine_build text NOT NULL,
  -- every seat's logged actions at the end ([{seat, actions}], M13-7's GameRecord.seatActions; milestone 15's cap rule): kept with the result
  seat_actions jsonb
);
CREATE INDEX results_ended ON results (ended_at, game_id);

CREATE TABLE placements (
  game_id text NOT NULL REFERENCES results (game_id) ON DELETE CASCADE,
  seat smallint NOT NULL CHECK (seat BETWEEN 1 AND 4),
  player text NOT NULL CHECK (player IN ('p1', 'p2', 'p3', 'p4')),
  session_id text NOT NULL,
  account_id text,
  name text NOT NULL,
  deck_hash text NOT NULL,
  place smallint NOT NULL CHECK (place BETWEEN 1 AND 4),
  loss text,
  loss_rule text,
  out_turn integer,
  out_order integer,
  time_used_ms double precision NOT NULL,
  timeouts smallint NOT NULL,
  disconnected_ms double precision NOT NULL,
  PRIMARY KEY (game_id, seat)
);
CREATE INDEX placements_session ON placements (session_id);
CREATE INDEX placements_account ON placements (account_id) WHERE account_id IS NOT NULL;

-- TODO(owner decision): bug reports' text and session_id are kept with no time limit (design 8.3 names only their game logs, stripped after 90
-- days by purge). Whether the player's words and the session id should expire too is the owner's call; until then they stay, as designed.
-- The bug inbox (design 4.8). attachments: the JSON text of [{kind, json}] as TEXT, never jsonb (api.ts ReportAttachment).
CREATE TABLE bug_reports (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('bug', 'title')),
  session_id text NOT NULL,
  game_id text,
  seat smallint,
  text text NOT NULL,
  attachments text NOT NULL,
  created_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('new', 'read', 'closed'))
);
CREATE INDEX bug_reports_created ON bug_reports (created_at, id);
