/**
 * M14-6: the operator's names (design 9.4, 6.2, 6.3, 6.5, 6.7): the forced rename, and reserving and releasing a key.
 *
 * - **Forced rename** (9.4): to the name `to` gives, or to a generated name of the forced-rename series ("Player" and 6 digits, never held by a
 *   player). `to` must pass 6.1's rules (checkAccountName); the static reserved rules and the word filter are the operator's call (`--to` may give
 *   a reserved name, 6.2: the owner's own account), and the key may be free, the operator's reservation, or the account's own held key. Every other
 *   taken key answers 'conflict' (a generated name is drawn again). The store's atomic rename bans the old key (nobody may take it; `release` frees
 *   it), the old name's history rows are **redacted** (6.7: even the account itself then sees its current name in its history), the account gets
 *   one free rename, and a `rename` sanction is recorded as the notice the account sees until it marks it seen (and may appeal). Appends `renamed`
 *   (open tables pick the new name up, 9.7); audited as `forcedRename` with that sanction. A forced rename is also how a `rekey` collision is
 *   settled (6.3): rename one side, then `release` its old, banned key.
 * - **The owner learns the new name** (review A6, M14-15): the `forcedRename` notice names it, to the account's verified address (PartDeps.notify);
 *   and the ban keeps the account it was taken from (the store's rename), so sign-in, a recovery code and the email reset still reach the account
 *   by the old name while the ban lasts (src/service/context.ts findByName): an owner signed out everywhere, without email, is not stranded.
 * - **The names it renamed away from.** The keys the account still holds from its own renames (6.5: 60 days, for a take-back) become holds for
 *   nobody until their own end, so an account that renamed away from an offending name before the operator acted cannot take it back with the
 *   free rename, and nobody else can claim it during the hold. Their history rows are not redacted: the operator acts on the current name only (an
 *   earlier one may be innocent), and `reserve` blocks an offending earlier one for good.
 * - **A name changed meanwhile.** A version conflict re-reads the account: renamed in between (by itself or another operator), the command answers
 *   'conflict' rather than ban a name the operator did not name; any other change is retried.
 * - **Keys** are made under the store's name data version, and during a rekey checked under both versions (6.3), as the service core does.
 * - **reserve**: the key of a name that passes 6.1's rules becomes the operator's reservation (`nameTaken` for everyone, 6.5), kept with the name
 *   (its display form, so a rekey keys it again from the name: review A7, M14-15); refused for an account's current key; a held key (an account's
 *   or nobody's) is reserved over. **release**: frees a reserved, banned or held key; never a
 *   current one. It takes a name (keyed under the store's version), or a key verbatim with its version, as `rekey --check` lists each entry of a
 *   collision: under new data a banned key may fold into another account's name, and keying a name then finds that account's.
 */
import { ACCOUNT_ID, ACCOUNT_LIMITS, type Account, type AccountId, type SanctionReason } from '../api';
import { checkAccountName } from '../api/names';
import { newSanctionId } from '../ids';
import { RESERVED_KEY_MAX } from '../names/rules';
import type { Operator } from '../service/api';
import type { NameHistoryRow } from '../store/api';
import { hostedTextProblem } from '../text';
import { entriesFor, isFree, iso, keysFor, storeCode, type Mod } from '../moderation/context';
import { actorOf, adminEvent, append, checkOperator, conflict, idOf, invalid, notFound, optionalText } from './operator';
import { SANCTION_REASONS } from './sanctions';

/** The notice a forced rename leaves the account (its `rename` sanction's message). */
export const FORCED_RENAME_MESSAGE = 'A moderator changed your name. You can choose a new one now, once, without waiting for the rename cooldown.';
/** Draws of a generated name before giving up (a taken one is drawn again). */
const DRAWS = 20;
/** Version conflicts a forced rename retries (the account changed between the read and the rename). */
const RETRIES = 3;

/** A display the operator typed, by 6.1's rules: the display form, or 'invalid' with the rule it broke. */
function displayOf(label: string, v: unknown): string {
  if (typeof v !== 'string' || v.length > ACCOUNT_LIMITS.nameRawMax) invalid(`${label} is not a name`);
  const c = checkAccountName(v);
  if (!c.ok) invalid(`${label}: ${c.message}`);
  return c.display;
}

/**
 * Every key the account still holds from its own renames becomes a hold for nobody until the hold's own end (the store's putNameEntry), so
 * neither the account (its take-back, 6.5, with the free rename or later) nor anyone else claims it meanwhile. The account cannot take one back
 * before this runs: the forced rename has just set renamedAt (the cooldown), and its free rename is granted after. The keys are found through
 * the name history; a hold that ended, or a key claimed as someone's current name meanwhile, is left as it is.
 */
async function holdForNobody(m: Mod, id: AccountId, at: Date): Promise<void> {
  const seen = new Set<string>();
  for (const h of await m.store.nameHistory(id)) {
    const k = `${h.keyVersion}\n${h.key}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const e = await m.store.nameEntry(h.key, h.keyVersion);
    if (e === null || e.kind !== 'held' || e.account !== id || isFree(e, at)) continue;
    try {
      await m.store.putNameEntry({ ...e, account: null });
    } catch (err) {
      if (storeCode(err) !== 'conflict') throw err;
    }
  }
}

export async function forceRename(m: Mod, op: Operator, account: AccountId, reason: SanctionReason, to?: string): Promise<Account> {
  checkOperator(op);
  const id = idOf<AccountId>('the account', account, ACCOUNT_ID);
  if (!SANCTION_REASONS.includes(reason)) invalid(`the reason must be one of ${SANCTION_REASONS.join(', ')}`);
  const given = to === undefined ? null : displayOf('--to', to);
  const rules = await m.names();
  const at = m.clock();
  const atIso = iso(at);
  let a = (await m.store.account(id)) ?? notFound('no such account');

  // the new name and its keys: free, reserved by the operator (--to only) or the account's own held key
  let display = '';
  let keys: Awaited<ReturnType<typeof keysFor>> | null = null;
  for (let draw = 0; draw < (given !== null ? 1 : DRAWS) && keys === null; draw++) {
    display = given ?? rules.generatedRenameName(m.random);
    const k = await keysFor(m, display);
    if (k.primary.key === a.nameKey && k.primary.version === a.keyVersion) {
      if (given !== null) invalid('the account already has this name');
      continue;
    }
    const usable = (await entriesFor(m, k)).every(
      (e) => isFree(e, at) || (e.kind === 'held' && e.account === a.id) || (given !== null && e.kind === 'reserved'),
    );
    if (usable) keys = k;
    else if (given !== null) conflict('the name is taken');
  }
  if (keys === null) conflict('no free name of the forced-rename series was found');

  const sanctionId = newSanctionId(at, m.random);
  const event = adminEvent(m, op, 'forcedRename', id, { sanction: sanctionId }, at);
  // the name the operator acts on: the one banned, and never another
  const oldKey = a.nameKey;
  const oldVersion = a.keyVersion;
  let renamed: Account | null = null;
  for (let attempt = 0; attempt <= RETRIES && renamed === null; attempt++) {
    // a name-history row starts after the one before it (11.5's key): within the same millisecond as the last change, one millisecond later
    const last = (await m.store.nameHistory(a.id)).at(-1);
    const from = last !== undefined && Date.parse(last.from) >= at.getTime() ? new Date(Date.parse(last.from) + 1).toISOString() : atIso;
    const row: NameHistoryRow = {
      account: a.id, name: display, key: keys.primary.key, keyVersion: keys.primary.version, from, to: null, cause: 'forced', redacted: false,
    };
    try {
      renamed = await m.store.rename(a.id, a.version, row, {
        oldKind: 'banned', holdUntil: null, allow: given !== null ? ['ownHeld', 'reserved'] : ['ownHeld'], now: atIso,
      });
    } catch (e) {
      if (storeCode(e) === 'exists') conflict('the name is taken');
      if (storeCode(e) !== 'conflict') throw e;
      // the account changed since it was read: read it again; renamed meanwhile, it is not the name the operator named
      a = (await m.store.account(id)) ?? notFound('no such account');
      if (a.nameKey !== oldKey || a.keyVersion !== oldVersion) conflict(`the account was renamed meanwhile (now ${JSON.stringify(a.name)}): look again`);
    }
  }
  if (renamed === null) conflict('the account kept changing: try again');
  // on record from its first change on (./operator.ts)
  await append(m, [event]);
  // what it held from its own renames, held for nobody now (see the header), before the free rename is granted
  await holdForNobody(m, id, at);
  // the old name redacted (6.7), one free rename granted (6.5), the notice recorded
  await m.store.redactName(id, oldKey);
  const free = await m.guard.patch(id, (cur) => (cur.freeRename ? null : { freeRename: true }));
  if (free.ok) renamed = free.value;
  else m.log.event('accounts.forcedRename.freeRename', { account: id, code: free.error.code });
  await m.store.putSanction({
    id: sanctionId, account: id, kind: 'rename', reason, message: FORCED_RENAME_MESSAGE, note: null, createdAt: atIso, createdBy: actorOf(op), reports: [],
    since: atIso, until: null, endedAt: null, endReason: null, endedBy: null, seenAt: null,
  });
  await m.changes({ at: atIso, account: id, kind: 'renamed' });
  // the new name to the owner's verified address (see the header); a notice never fails the command
  await m.notify?.(id, 'forcedRename').catch(() => undefined);
  return renamed;
}

export async function reserveName(m: Mod, op: Operator, name: string, note?: string): Promise<void> {
  checkOperator(op);
  const display = displayOf('the name', name);
  const text = optionalText('the note', note);
  const at = m.clock();
  const { primary } = await keysFor(m, display);
  // a held key is reserved over: the operator may block an offending earlier name for good
  const e = await m.store.nameEntry(primary.key, primary.version);
  if (e?.kind === 'current') conflict('an account has this name');
  const event = adminEvent(m, op, 'nameReserved', null, {}, at);
  try {
    // with the name, so a rekey keys it again from the name under new data (review A7, M14-15)
    await m.store.putNameEntry({
      key: primary.key, keyVersion: primary.version, kind: 'reserved', account: null, until: null, note: text, createdAt: iso(at), name: display,
    });
  } catch (err) {
    if (storeCode(err) === 'conflict') conflict('an account has this name');
    throw err;
  }
  await append(m, [event]);
}

export async function releaseName(m: Mod, op: Operator, name: string, keyVersion?: number): Promise<void> {
  checkOperator(op);
  // a name, or with keyVersion a key verbatim, as `rekey --check` lists an entry: only plain text is asked of either
  const max = keyVersion === undefined ? ACCOUNT_LIMITS.nameRawMax : RESERVED_KEY_MAX;
  if (typeof name !== 'string' || name.trim() === '' || name.length > max || hostedTextProblem(name) !== null) invalid('the name is not a name');
  if (keyVersion !== undefined && (!Number.isSafeInteger(keyVersion) || keyVersion < 0)) invalid('the key version is a whole number');
  const at = m.clock();
  const primary = keyVersion !== undefined ? { key: name, version: keyVersion } : (await keysFor(m, name)).primary;
  const e = (await m.store.nameEntry(primary.key, primary.version)) ?? notFound('no reserved, banned or held name has this key');
  if (e.kind === 'current') conflict('an account has this name: it cannot be released');
  const event = adminEvent(m, op, 'nameReleased', null, {}, at);
  try {
    await m.store.deleteNameEntry(primary.key, primary.version);
  } catch (err) {
    if (storeCode(err) === 'notFound') notFound('no reserved, banned or held name has this key');
    if (storeCode(err) === 'conflict') conflict('an account has this name: it cannot be released');
    throw err;
  }
  await append(m, [event]);
}
