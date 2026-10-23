-- OpenMTG accounts: migration 001, the schema `accounts` (docs/design/m14-accounts.md 11.5; M14-11).
--
-- Run by hosted's migration runner (`migrate(sql, { schema: 'accounts', dir })`, store/migrate.ts) with the database owner's role, in one transaction,
-- recorded in `accounts.schema_migrations` (which the runner creates itself, with the schema, before the first migration). The runner takes one
-- advisory lock for every package, and runs the packages in order: accounts, then hosted, then ladder.
--
-- Rights (design 11.5; `SELECT accounts.grant_service('<the service role>')` once the migrations have run, and again after a later migration adds a
-- table): the service's role has SELECT, INSERT, UPDATE and DELETE on every table but `audit` (SELECT and INSERT only), `audit_kinds`,
-- `schema_migrations`, `deletion_policy` and `purge_ledger` (SELECT only), and `accounts` (SELECT and DELETE, and INSERT and UPDATE on every column but the
-- three of the erasure claim, below), and EXECUTE on the functions at the end of this file but `grant_service`. It cannot change or remove an audit
-- event except through `purge_audit`, a SECURITY DEFINER function that enforces the retention policy itself. No DDL, no ownership of anything.
--
-- The erasure claim cannot be forged by the service's role (the one thing that unlocks `purge_audit(account)`: purge_at <= now() and erasing_at set,
-- `erasure_claimed`). deletion_requested_at, purge_at and erasing_at are written only by the SECURITY DEFINER functions request_deletion, move_deletion,
-- cancel_deletion and claim_erasure, each of which checks the transition itself by the database's clock: a request is made at the database's time
-- (within deletion_policy.max_skew_ms) with a grace of at least deletion_policy.min_grace_ms; it can be moved only while unclaimed, and only to a
-- time that keeps that grace; it is cancelled only before purge_at and while unclaimed; it is claimed only when purge_at has come, as a lease
-- (60 seconds). A claim cannot be taken back, so wiping an account's events means erasing that account for good, which purge_audit writes to
-- `purge_ledger` (account, counts, time, the calling role), an insert-only record the service can read and never change. A compromised service can
-- still ask for an account's deletion and wait out the grace (slow, visible to the owner, whom the notice reaches), and then erase it. The policy is
-- the owner's (UPDATE accounts.deletion_policy): the defaults are an hour and five minutes; an operator's immediate deletion (`delete --now`, grace 0) needs
-- the owner to lower min_grace_ms first.
--
-- Rules every column keeps (the stores' common text rules, src/store/rules.ts): text holds no NUL (PostgreSQL refuses it) and no unpaired surrogate
-- (the store refuses it first); times are timestamptz, read and written as ISO-8601 UTC; jsonb only for small server-built JSON (`privacy`, `meta`,
-- `details`, `detail`, `evidence`), whose strings pass the text rules first; everything players type is text. Id and key columns are COLLATE "C", so
-- every ordering and keyset page is in code-point order like the memory and file stores', whatever the database's own collation is.
-- No foreign key crosses packages (accounts are erased; hosted's results keep no reference to them), and none reaches `names`, whose rows outlive
-- the account that held them (a hold for nobody).
--
-- INTERFACE CHANGE (M14-11) from the table list of 11.5, each needed by the contract suite: accounts.email_set_at (Account.email.setAt, M14-15 A5);
-- names.name (a reserved key's name, M14-15 A7); tombstones.hold_until (the end of the name hold the erase wrote, 10.3); the table `change_head`
-- (the newest seq given out, which never goes back, not even when purge has removed every change: the contract says so, and max(seq) would not);
-- purge_audit's two optional "keep at least this long" arguments (below); the functions erasure_claimed and grant_service; the claim's guards
-- (deletion_policy, request_deletion, move_deletion, cancel_deletion, claim_erasure, purge_ledger); write_pad, the row the store writes where a stored
-- row would have been (a block, mute or report of an id with no account), so the answer takes as long either way; bigint for every counter (the
-- contract allows any safe integer).

-- ---- audit kinds ---------------------------------------------------------------------------------------------------------------------------------

-- Written from AUDIT_CATEGORY (src/api.ts) and pinned against it by test/m14-11/rights.test.ts. Owned by the migrating role; the service only reads it.
CREATE TABLE accounts.audit_kinds (
  kind text COLLATE "C" PRIMARY KEY,
  category text NOT NULL CHECK (category IN ('security', 'moderation', 'operator'))
);
INSERT INTO accounts.audit_kinds (kind, category) VALUES
  ('registered', 'security'),
  ('signedIn', 'security'),
  ('signInFailed', 'security'),
  ('signInThrottled', 'security'),
  ('signedOut', 'security'),
  ('sessionRevoked', 'security'),
  ('sessionsRevoked', 'security'),
  ('sessionReuse', 'security'),
  ('reauthed', 'security'),
  ('reauthFailed', 'security'),
  ('passwordChanged', 'security'),
  ('recoveryUsed', 'security'),
  ('recoveryFailed', 'security'),
  ('recoveryCodesRenewed', 'security'),
  ('emailSet', 'security'),
  ('emailVerified', 'security'),
  ('emailRemoved', 'security'),
  ('emailResetRequested', 'security'),
  ('emailResetUsed', 'security'),
  ('providerLinked', 'security'),
  ('providerUnlinked', 'security'),
  ('renamed', 'security'),
  ('guestClaimed', 'security'),
  ('exported', 'security'),
  ('deletionRequested', 'security'),
  ('deletionCancelled', 'security'),
  ('deleted', 'security'),
  ('captchaRequired', 'security'),
  ('reported', 'moderation'),
  ('appealed', 'moderation'),
  ('sanctioned', 'moderation'),
  ('sanctionLifted', 'moderation'),
  ('sanctionExpired', 'moderation'),
  ('forcedRename', 'moderation'),
  ('reportClosed', 'moderation'),
  ('appealAnswered', 'moderation'),
  ('adminViewed', 'operator'),
  ('adminExported', 'operator'),
  ('nameReserved', 'operator'),
  ('nameReleased', 'operator'),
  ('nameRekeyed', 'operator');

-- ---- accounts and names --------------------------------------------------------------------------------------------------------------------------

-- No secrets, and no status (D23: the status is worked out from sanctions and the deletion). deletion_* are all null for an account that is not
-- being deleted; deletion_done lists the holders whose erase succeeded.
CREATE TABLE accounts.accounts (
  id text COLLATE "C" PRIMARY KEY,
  name text NOT NULL CHECK (name <> ''),
  name_key text COLLATE "C" NOT NULL CHECK (name_key <> ''),
  key_version bigint NOT NULL CHECK (key_version >= 0),
  avatar text NOT NULL,
  privacy jsonb NOT NULL,
  email text CHECK (email IS NULL OR email <> ''),
  email_verified_at timestamptz,
  email_set_at timestamptz,
  age_min bigint NOT NULL CHECK (age_min >= 0),
  age_passed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  last_sign_in_at timestamptz,
  renamed_at timestamptz,
  free_rename boolean NOT NULL,
  deletion_requested_at timestamptz,
  purge_at timestamptz,
  erasing_at timestamptz,
  deletion_done text[] NOT NULL DEFAULT '{}',
  inactive_notice_at timestamptz,
  version bigint NOT NULL CHECK (version >= 0),
  UNIQUE (name_key, key_version),
  CHECK ((deletion_requested_at IS NULL) = (purge_at IS NULL)),
  CHECK (erasing_at IS NULL OR purge_at IS NOT NULL),
  CHECK (email IS NOT NULL OR (email_verified_at IS NULL AND email_set_at IS NULL))
);
-- the rights part's tick: dueDeletions (purgeAt, then id) and inactiveSince (the last sign-in, or the registration; then id)
CREATE INDEX accounts_due ON accounts.accounts (purge_at, id) WHERE purge_at IS NOT NULL;
CREATE INDEX accounts_inactive ON accounts.accounts ((coalesce(last_sign_in_at, created_at)), id) WHERE purge_at IS NULL;

-- Uniqueness of names lives here: registration and rename write `accounts` and `names` in one transaction, `names` first (every writer of a key meets
-- the others on this row before anything else, so two of them never wait for each other's rows). A key is free when it has no entry here, or an entry
-- whose `until` has passed. `account_id` is the account of a current or held key, and of a ban put by a forced rename (9.4); null for reserved keys,
-- holds for nobody and bans left by an erased account.
CREATE TABLE accounts.names (
  key text COLLATE "C" NOT NULL,
  key_version bigint NOT NULL CHECK (key_version >= 0),
  kind text NOT NULL CHECK (kind IN ('current', 'held', 'reserved', 'banned')),
  account_id text COLLATE "C",
  until timestamptz,
  note text,
  created_at timestamptz NOT NULL,
  name text,
  PRIMARY KEY (key, key_version),
  CHECK (key <> ''),
  CHECK (kind <> 'current' OR (account_id IS NOT NULL AND until IS NULL))
);
CREATE INDEX names_account ON accounts.names (account_id) WHERE account_id IS NOT NULL;
CREATE INDEX names_until ON accounts.names (until) WHERE until IS NOT NULL;

-- One row: the name data version (6.3), set by `rekey` in the same transaction as the keys.
CREATE TABLE accounts.name_meta (
  only_row boolean PRIMARY KEY DEFAULT true CHECK (only_row),
  current_version bigint NOT NULL CHECK (current_version >= 0)
);
INSERT INTO accounts.name_meta (current_version) VALUES (1);

CREATE TABLE accounts.name_history (
  account_id text COLLATE "C" NOT NULL REFERENCES accounts.accounts (id),
  name text NOT NULL CHECK (name <> ''),
  key text COLLATE "C" NOT NULL CHECK (key <> ''),
  key_version bigint NOT NULL CHECK (key_version >= 0),
  from_at timestamptz NOT NULL,
  to_at timestamptz,
  cause text NOT NULL CHECK (cause IN ('register', 'rename', 'forced')),
  redacted boolean NOT NULL,
  PRIMARY KEY (account_id, from_at)
);

-- ---- credentials, recovery codes, device proofs --------------------------------------------------------------------------------------------------

-- secret: the PHC string (local), the public key (passkey), null (shopify). Compare-and-set on the secret is a single UPDATE (store/postgres.ts).
CREATE TABLE accounts.credentials (
  provider text COLLATE "C" NOT NULL CHECK (provider IN ('local', 'shopify', 'passkey')),
  subject text COLLATE "C" NOT NULL CHECK (subject <> ''),
  account_id text COLLATE "C" NOT NULL REFERENCES accounts.accounts (id),
  secret text,
  meta jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  last_used_at timestamptz,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX credentials_account ON accounts.credentials (account_id);

CREATE TABLE accounts.recovery_codes (
  account_id text COLLATE "C" NOT NULL REFERENCES accounts.accounts (id),
  slot bigint NOT NULL CHECK (slot >= 0),
  hash text COLLATE "C" NOT NULL CHECK (hash <> ''),
  generation bigint NOT NULL CHECK (generation >= 0),
  created_at timestamptz NOT NULL,
  used_at timestamptz,
  PRIMARY KEY (account_id, slot)
);

CREATE TABLE accounts.devices (
  hash text COLLATE "C" PRIMARY KEY CHECK (hash <> ''),
  account_id text COLLATE "C" NOT NULL REFERENCES accounts.accounts (id),
  created_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL,
  failures bigint NOT NULL CHECK (failures >= 0)
);
CREATE INDEX devices_account ON accounts.devices (account_id, created_at, hash);
CREATE INDEX devices_last_used ON accounts.devices (last_used_at);

-- ---- sessions and guest claims -------------------------------------------------------------------------------------------------------------------

-- A token hash is unique among current hashes and among previous ones; that no current hash is another session's previous one is the store's check
-- (SHA-256 of random 256-bit tokens, so a collision is a caller's mistake).
CREATE TABLE accounts.sessions (
  id text COLLATE "C" PRIMARY KEY,
  account_id text COLLATE "C" NOT NULL REFERENCES accounts.accounts (id),
  token_hash text COLLATE "C" NOT NULL UNIQUE CHECK (token_hash <> ''),
  previous_hash text COLLATE "C" UNIQUE CHECK (previous_hash <> ''),
  rotation bigint NOT NULL CHECK (rotation >= 0),
  device_hash text COLLATE "C" CHECK (device_hash <> ''),
  provider text NOT NULL CHECK (provider IN ('local', 'shopify', 'passkey')),
  client text NOT NULL CHECK (client IN ('desktop', 'web')),
  created_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL,
  auth_at timestamptz NOT NULL,
  rotated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text CHECK (revoke_reason IN (
    'signOut', 'signOutEverywhere', 'revoked', 'passwordChanged', 'recovery', 'emailReset', 'reuse', 'proofFailed', 'expired', 'tooMany', 'sanction',
    'deletion', 'admin')),
  proof_failures bigint NOT NULL CHECK (proof_failures >= 0),
  CHECK (previous_hash IS DISTINCT FROM token_hash)
);
CREATE INDEX sessions_account ON accounts.sessions (account_id, created_at, id);

CREATE TABLE accounts.guest_claims (
  session_id text COLLATE "C" PRIMARY KEY,
  account_id text COLLATE "C" NOT NULL REFERENCES accounts.accounts (id),
  claimed_at timestamptz NOT NULL
);
CREATE INDEX guest_claims_account ON accounts.guest_claims (account_id, claimed_at, session_id);

-- ---- relations and email codes -------------------------------------------------------------------------------------------------------------------

CREATE TABLE accounts.relations (
  account_id text COLLATE "C" NOT NULL REFERENCES accounts.accounts (id),
  other_id text COLLATE "C" NOT NULL REFERENCES accounts.accounts (id),
  kind text NOT NULL CHECK (kind IN ('block', 'mute')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, other_id, kind),
  CHECK (account_id <> other_id)
);
CREATE INDEX relations_other ON accounts.relations (other_id);

-- At most `emailResetLiveCodes` live (unused, unexpired) codes per account and purpose, checked in the inserting transaction under an advisory lock
-- of its own (store/postgres.ts). Tries are counted in memory per address key, never here (D15).
CREATE TABLE accounts.email_codes (
  id text COLLATE "C" PRIMARY KEY,
  account_id text COLLATE "C" NOT NULL REFERENCES accounts.accounts (id),
  purpose text NOT NULL CHECK (purpose IN ('verify', 'reset')),
  hash text COLLATE "C" NOT NULL CHECK (hash <> ''),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX email_codes_account ON accounts.email_codes (account_id, purpose);

-- ---- moderation ----------------------------------------------------------------------------------------------------------------------------------

-- No foreign keys: a report about an account, or by one, outlives it (10.2 keeps the open ones; the target's name becomes "Deleted player").
-- reporter_*: null when the reporter was deleted. target_account xor target_session (a guest session).
CREATE TABLE accounts.reports (
  id text COLLATE "C" PRIMARY KEY,
  reporter_kind text CHECK (reporter_kind IN ('account', 'guest', 'system')),
  reporter_account text COLLATE "C",
  reporter_session text COLLATE "C",
  reporter_source text CHECK (reporter_source <> ''),
  target_account text COLLATE "C",
  target_session text COLLATE "C",
  target_name text NOT NULL CHECK (target_name <> ''),
  reason text NOT NULL CHECK (reason IN ('name', 'chat', 'title', 'cheating', 'collusion', 'stalling', 'smurf', 'harassment', 'spam', 'other')),
  game_id text COLLATE "C",
  text text,
  related text[] NOT NULL DEFAULT '{}',
  evidence jsonb,
  status text NOT NULL CHECK (status IN ('new', 'actioned', 'dismissed')),
  created_at timestamptz NOT NULL,
  closed_at timestamptz,
  closed_by text,
  note text,
  CHECK ((target_account IS NULL) <> (target_session IS NULL)),
  CHECK (
    (reporter_kind IS NULL AND reporter_account IS NULL AND reporter_session IS NULL AND reporter_source IS NULL)
    OR (reporter_kind = 'account' AND reporter_account IS NOT NULL AND reporter_session IS NULL AND reporter_source IS NULL)
    OR (reporter_kind = 'guest' AND reporter_session IS NOT NULL AND reporter_account IS NULL AND reporter_source IS NULL)
    OR (reporter_kind = 'system' AND reporter_source IS NOT NULL AND reporter_account IS NULL AND reporter_session IS NULL)),
  -- `related` and `evidence` come only from a system reporter (9.2)
  CHECK ((related = '{}' AND evidence IS NULL) OR reporter_kind = 'system')
);
CREATE INDEX reports_status ON accounts.reports (status, id);
CREATE INDEX reports_target ON accounts.reports (target_account, id) WHERE target_account IS NOT NULL;
CREATE INDEX reports_reporter ON accounts.reports (reporter_account, id) WHERE reporter_account IS NOT NULL;
CREATE INDEX reports_guest_reporter ON accounts.reports (reporter_session, id) WHERE reporter_session IS NOT NULL;
CREATE INDEX reports_guest_target ON accounts.reports (target_session, id) WHERE target_session IS NOT NULL;
CREATE INDEX reports_closed ON accounts.reports (closed_at) WHERE status <> 'new';

CREATE TABLE accounts.sanctions (
  id text COLLATE "C" PRIMARY KEY,
  account_id text COLLATE "C" NOT NULL REFERENCES accounts.accounts (id),
  kind text NOT NULL CHECK (kind IN ('warn', 'mute', 'rename', 'unlist', 'suspend', 'ban')),
  reason text NOT NULL CHECK (reason IN ('name', 'chat', 'title', 'cheating', 'collusion', 'stalling', 'smurf', 'harassment', 'spam', 'other', 'evasion')),
  message text NOT NULL,
  note text,
  created_at timestamptz NOT NULL,
  created_by text NOT NULL CHECK (created_by <> ''),
  since timestamptz NOT NULL,
  until timestamptz,
  ended_at timestamptz,
  end_reason text CHECK (end_reason IN ('lifted', 'expired', 'appeal')),
  ended_by text,
  seen_at timestamptz,
  reports text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX sanctions_running ON accounts.sanctions (account_id) WHERE ended_at IS NULL;
CREATE INDEX sanctions_account ON accounts.sanctions (account_id, since, created_at, id);
CREATE INDEX sanctions_ending ON accounts.sanctions (until, id) WHERE ended_at IS NULL AND until IS NOT NULL;

-- One appeal per sanction (the key). The store inserts only for a sanction of the appealing account.
CREATE TABLE accounts.appeals (
  sanction_id text COLLATE "C" PRIMARY KEY REFERENCES accounts.sanctions (id),
  account_id text COLLATE "C" NOT NULL REFERENCES accounts.accounts (id),
  text text NOT NULL,
  created_at timestamptz NOT NULL,
  answer text CHECK (answer IN ('upheld', 'lifted')),
  answer_message text,
  answered_at timestamptz,
  answered_by text
);
CREATE INDEX appeals_account ON accounts.appeals (account_id);
CREATE INDEX appeals_order ON accounts.appeals (created_at, sanction_id);

-- ---- the audit log and the change feed -----------------------------------------------------------------------------------------------------------

-- Append-only for the service (rights above); events leave only through purge_audit. No foreign key to accounts: the `deleted` event outlives its
-- account, and an operator event keeps its time with the account removed.
CREATE TABLE accounts.audit (
  id text COLLATE "C" PRIMARY KEY,
  at timestamptz NOT NULL,
  kind text COLLATE "C" NOT NULL REFERENCES accounts.audit_kinds (kind),
  account_id text COLLATE "C",
  actor text NOT NULL CHECK (actor IN ('self', 'system') OR actor ~ '^admin:.'),
  actor_os text,
  session_id text COLLATE "C",
  address_tag text,
  details jsonb NOT NULL
);
CREATE INDEX audit_account ON accounts.audit (account_id, at, id);
CREATE INDEX audit_kind ON accounts.audit (kind, at, id);
CREATE INDEX audit_at ON accounts.audit (at, id);

-- seq is given out under a transaction-scoped advisory lock (store/postgres.ts, CHANGES_LOCK_KEY), so seqs become visible in order: a reader never
-- sees seq n + 1 while n is uncommitted. No foreign key: the `deleted` change outlives its account.
CREATE TABLE accounts.changes (
  seq bigint PRIMARY KEY CHECK (seq >= 1),
  at timestamptz NOT NULL,
  account_id text COLLATE "C" NOT NULL,
  kind text NOT NULL CHECK (kind IN ('sessionRevoked', 'sessionsRevoked', 'standing', 'renamed', 'avatar', 'deleting', 'deleted')),
  session_id text COLLATE "C",
  detail jsonb
);
CREATE INDEX changes_at ON accounts.changes (at);
CREATE INDEX changes_account ON accounts.changes (account_id);

-- One row: the newest seq given out. It never goes back, not even when purge has removed every change (changesHead; the next seq is this + 1).
CREATE TABLE accounts.change_head (
  only_row boolean PRIMARY KEY DEFAULT true CHECK (only_row),
  last_seq bigint NOT NULL CHECK (last_seq >= 0)
);
INSERT INTO accounts.change_head (last_seq) VALUES (0);

-- ---- deletion ------------------------------------------------------------------------------------------------------------------------------------

-- Written last by an erase (10.2). hold_until: the end of the name hold the erase wrote; the tombstone stays until that and any running sanction end (10.3).
CREATE TABLE accounts.tombstones (
  account_id text COLLATE "C" PRIMARY KEY,
  deleted_at timestamptz NOT NULL,
  sanction_until timestamptz,
  hold_until timestamptz NOT NULL,
  holders_done text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX tombstones_hold ON accounts.tombstones (hold_until);

-- ---- the guards of the erasure claim, the ledger, the pad ---------------------------------------------------------------------------------------------

-- One row, the owner's: how soon after a request a deletion may fall due, and how far a request's time may be from the database's. The service can
-- read it (SELECT only) and never change it; the functions below read it as the owner.
CREATE TABLE accounts.deletion_policy (
  only_row boolean PRIMARY KEY DEFAULT true CHECK (only_row),
  min_grace_ms bigint NOT NULL CHECK (min_grace_ms >= 0),
  max_skew_ms bigint NOT NULL CHECK (max_skew_ms >= 0)
);
INSERT INTO accounts.deletion_policy (min_grace_ms, max_skew_ms) VALUES (3600000, 300000);

-- Every account purge purge_audit(account) did: written by the function alone (the service can read it and nothing more), so a purge always leaves
-- this record, which stays two years (purge_audit with no account removes older rows; it holds the id of an erased account, as its tombstone does). removed: security and moderation events deleted; anonymised: operator events that lost the account id; called_by: the login role.
CREATE TABLE accounts.purge_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  account_id text COLLATE "C" NOT NULL,
  removed bigint NOT NULL CHECK (removed >= 0),
  anonymised bigint NOT NULL CHECK (anonymised >= 0),
  called_by text NOT NULL
);
CREATE INDEX purge_ledger_account ON accounts.purge_ledger (account_id, at);

-- One row the store writes (a no-op update) on the path of a block, mute or report that finds no account to attach it to, as the stored path writes its
-- row: both then end in a write and its flush, so the time of the answer does not tell whether an id has an account (threat model T2, A2).
CREATE TABLE accounts.write_pad (
  only_row boolean PRIMARY KEY DEFAULT true CHECK (only_row),
  n bigint NOT NULL
);
INSERT INTO accounts.write_pad (n) VALUES (0);

-- ---- functions -----------------------------------------------------------------------------------------------------------------------------------

-- Whether the erasure of `account` has been claimed (10.2 step 3) and is due by the database's clock: the account row shows purge_at <= now() and
-- erasing_at set. The one rule `purge_audit` and hosted's `erase_player` (M14-10) both enforce, so neither can be used on another account. The three
-- columns it reads are written only by the functions below.
CREATE FUNCTION accounts.erasure_claimed(account text) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM accounts.accounts a
    WHERE a.id = account AND a.purge_at IS NOT NULL AND a.purge_at <= pg_catalog.now() AND a.erasing_at IS NOT NULL
  )
$$;

-- The four writes of the deletion columns (10.2), each checking its transition against the database's clock and the owner's deletion_policy. A refusal
-- raises SQLSTATE OM409 (the store answers 'conflict'), an account that is not there OM404 ('notFound'). The service's role has no INSERT or UPDATE on
-- deletion_requested_at, purge_at or erasing_at (grant_service), so these are the only ways to set them.

-- Step 1: a deletion is requested at the database's time (p_requested_at within max_skew_ms of now()), falls due no sooner than min_grace_ms after
-- that, and the account has none pending.
CREATE FUNCTION accounts.request_deletion(p_account text, p_requested_at timestamptz, p_purge_at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  pol accounts.deletion_policy;
BEGIN
  SELECT * INTO pol FROM accounts.deletion_policy;
  IF abs(extract(epoch FROM (p_requested_at - pg_catalog.now())) * 1000) > pol.max_skew_ms THEN
    RAISE EXCEPTION 'a deletion is requested at the database''s time' USING ERRCODE = 'OM409';
  END IF;
  IF extract(epoch FROM (p_purge_at - p_requested_at)) * 1000 < pol.min_grace_ms THEN
    RAISE EXCEPTION 'a deletion falls due no sooner than the policy''s grace after the request' USING ERRCODE = 'OM409';
  END IF;
  UPDATE accounts.accounts SET deletion_requested_at = p_requested_at, purge_at = p_purge_at, erasing_at = NULL, deletion_done = '{}'
  WHERE id = p_account AND purge_at IS NULL;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM accounts.accounts WHERE id = p_account) THEN
      RAISE EXCEPTION 'the account has a deletion pending' USING ERRCODE = 'OM409';
    END IF;
    RAISE EXCEPTION 'no such account' USING ERRCODE = 'OM404';
  END IF;
END
$$;

-- The operator's sooner (or later) purge time for a pending, unclaimed deletion; it keeps the policy's grace after the request.
CREATE FUNCTION accounts.move_deletion(p_account text, p_purge_at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  pol accounts.deletion_policy;
BEGIN
  SELECT * INTO pol FROM accounts.deletion_policy;
  UPDATE accounts.accounts SET purge_at = p_purge_at
  WHERE id = p_account AND purge_at IS NOT NULL AND erasing_at IS NULL
    AND extract(epoch FROM (p_purge_at - deletion_requested_at)) * 1000 >= pol.min_grace_ms;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM accounts.accounts WHERE id = p_account) THEN
      RAISE EXCEPTION 'the deletion cannot be moved: none pending, already claimed, or sooner than the policy''s grace' USING ERRCODE = 'OM409';
    END IF;
    RAISE EXCEPTION 'no such account' USING ERRCODE = 'OM404';
  END IF;
END
$$;

-- Step 2: a cancel, only before purge_at and while the erasure is unclaimed.
CREATE FUNCTION accounts.cancel_deletion(p_account text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  UPDATE accounts.accounts SET deletion_requested_at = NULL, purge_at = NULL, erasing_at = NULL, deletion_done = '{}'
  WHERE id = p_account AND purge_at IS NOT NULL AND erasing_at IS NULL AND pg_catalog.now() < purge_at;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM accounts.accounts WHERE id = p_account) THEN
      RAISE EXCEPTION 'the deletion cannot be cancelled: none pending, already due, or already claimed' USING ERRCODE = 'OM409';
    END IF;
    RAISE EXCEPTION 'no such account' USING ERRCODE = 'OM404';
  END IF;
END
$$;

-- Step 3: the claim, only once purge_at has come by the database's clock, as a lease (60 seconds: erasing_at is null or older than that). p_at, the
-- claim's time, is not before purge_at and not after the database's time by more than max_skew_ms. A claim is never taken back.
CREATE FUNCTION accounts.claim_erasure(p_account text, p_at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  pol accounts.deletion_policy;
BEGIN
  SELECT * INTO pol FROM accounts.deletion_policy;
  UPDATE accounts.accounts SET erasing_at = p_at
  WHERE id = p_account AND purge_at IS NOT NULL AND purge_at <= pg_catalog.now() AND p_at >= purge_at
    AND extract(epoch FROM (p_at - pg_catalog.now())) * 1000 <= pol.max_skew_ms
    AND (erasing_at IS NULL OR erasing_at + interval '60 seconds' <= pg_catalog.now());
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM accounts.accounts WHERE id = p_account) THEN
      RAISE EXCEPTION 'the erasure cannot be claimed: none pending, not due, or claimed within the lease' USING ERRCODE = 'OM409';
    END IF;
    RAISE EXCEPTION 'no such account' USING ERRCODE = 'OM404';
  END IF;
END
$$;

-- The only way the service's role removes or changes audit events, and it enforces the retention policy itself (10.3, 11.5), taking no time or kind:
-- - no account: deletes `security` events older than 180 days (but never a `deleted` event whose tombstone still exists) and `operator` events older
--   than 730 days, and rows of purge_ledger older than 730 days; nothing else. The optional arguments keep events LONGER (a configured retention above those floors, in milliseconds); a smaller
--   value, or none, changes nothing, so a compromised service cannot make the function delete anything younger. (Capped at 100 years: older events
--   do not exist, and a larger number must not push the cutoff out of timestamptz's range.)
-- - an account: only when erasure_claimed(account): deletes that account's `security` and `moderation` events except `deleted`, and sets account_id
--   to null on its `operator` events, and writes a row of purge_ledger; otherwise it does nothing. (The tombstone is written last, after this call, so
--   it checks the account row.)
-- Returns the number of events deleted or changed. Days are counted in hours (4320 = 180 days, 17520 = 730 days), never calendar days.
CREATE FUNCTION accounts.purge_audit(account text DEFAULT NULL, keep_security_ms bigint DEFAULT NULL, keep_operator_ms bigint DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  n bigint := 0;
  m bigint := 0;
BEGIN
  IF account IS NULL THEN
    DELETE FROM accounts.audit e USING accounts.audit_kinds k
    WHERE k.kind = e.kind AND k.category = 'security'
      AND e.at <= pg_catalog.now() - greatest(interval '4320 hours', least(coalesce(keep_security_ms, 0), 3153600000000)::double precision * interval '1 millisecond')
      AND NOT (e.kind = 'deleted' AND e.account_id IS NOT NULL
               AND EXISTS (SELECT 1 FROM accounts.tombstones t WHERE t.account_id = e.account_id));
    GET DIAGNOSTICS n = ROW_COUNT;
    DELETE FROM accounts.audit e USING accounts.audit_kinds k
    WHERE k.kind = e.kind AND k.category = 'operator'
      AND e.at <= pg_catalog.now() - greatest(interval '17520 hours', least(coalesce(keep_operator_ms, 0), 3153600000000)::double precision * interval '1 millisecond');
    GET DIAGNOSTICS m = ROW_COUNT;
    -- the ledger of account purges is kept as long as operator events (two years), and goes only here (not counted: it is no audit event)
    DELETE FROM accounts.purge_ledger l
    WHERE l.at <= pg_catalog.now() - greatest(interval '17520 hours', least(coalesce(keep_operator_ms, 0), 3153600000000)::double precision * interval '1 millisecond');
    RETURN n + m;
  END IF;
  IF NOT accounts.erasure_claimed(account) THEN
    RETURN 0;
  END IF;
  DELETE FROM accounts.audit e USING accounts.audit_kinds k
  WHERE e.account_id = account AND k.kind = e.kind AND k.category IN ('security', 'moderation') AND e.kind <> 'deleted';
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE accounts.audit e SET account_id = NULL FROM accounts.audit_kinds k
  WHERE e.account_id = account AND k.kind = e.kind AND k.category = 'operator';
  GET DIAGNOSTICS m = ROW_COUNT;
  INSERT INTO accounts.purge_ledger (account_id, removed, anonymised, called_by) VALUES (account, n, m, session_user::text);
  RETURN n + m;
END
$$;

-- Gives the service's role the rights of the header above. Run by the owner's role (SECURITY INVOKER: it can grant only what it has) after the
-- migrations, and again after one that adds a table. Not callable by anyone else.
CREATE FUNCTION accounts.grant_service(service name) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  t text;
  claim_columns text[] := ARRAY['deletion_requested_at', 'purge_at', 'erasing_at'];
  writable text;
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA accounts TO %I', service);
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
           WHERE s.nspname = 'accounts' AND c.relkind IN ('r', 'p')
             AND c.relname NOT IN ('accounts', 'audit', 'audit_kinds', 'schema_migrations', 'deletion_policy', 'purge_ledger')
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON accounts.%I TO %I', t, service);
  END LOOP;
  -- accounts: every column but the erasure claim's three, which only the functions write (a new account has no deletion)
  SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum) INTO writable
  FROM pg_attribute a WHERE a.attrelid = 'accounts.accounts'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attname <> ALL (claim_columns);
  EXECUTE format('GRANT SELECT, DELETE ON accounts.accounts TO %I', service);
  EXECUTE format('GRANT INSERT (%s), UPDATE (%s) ON accounts.accounts TO %I', writable, writable, service);
  EXECUTE format('GRANT SELECT, INSERT ON accounts.audit TO %I', service);
  FOR t IN SELECT unnest(ARRAY['audit_kinds', 'deletion_policy', 'purge_ledger'])
  LOOP
    EXECUTE format('GRANT SELECT ON accounts.%I TO %I', t, service);
  END LOOP;
  IF pg_catalog.to_regclass('accounts.schema_migrations') IS NOT NULL THEN
    EXECUTE format('GRANT SELECT ON accounts.schema_migrations TO %I', service);
  END IF;
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION accounts.purge_audit(text, bigint, bigint), accounts.erasure_claimed(text), accounts.request_deletion(text, timestamptz, timestamptz), '
    || 'accounts.move_deletion(text, timestamptz), accounts.cancel_deletion(text), accounts.claim_erasure(text, timestamptz) TO %I',
    service);
END
$$;

REVOKE ALL ON FUNCTION accounts.erasure_claimed(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION accounts.purge_audit(text, bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION accounts.request_deletion(text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION accounts.move_deletion(text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION accounts.cancel_deletion(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION accounts.claim_erasure(text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION accounts.grant_service(name) FROM PUBLIC;
