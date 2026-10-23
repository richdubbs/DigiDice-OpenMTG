/**
 * M14-5: the operator's API as the service assembles it (design 9.6, 11.3 AccountAdmin): the moderation part's commands (M14-6), the rights part's
 * (exportAccount, deleteAccount, purge; M14-7) and the core's own, `rekeyCheck` and `rekey` (6.3). A command of a part that is not built yet throws
 * AccountsAdminError('incomplete'), naming the package.
 *
 * **Rekey** (6.3): the store's keys are under its nameKeyVersion; the server's current name data is NameRules.current, and the data the keys were
 * made with must be loaded as NameRules.previous. `rekeyCheck` computes every names entry's key under the new data from the name it was made from:
 * an account's current key from its display name, a held or banned key from the account's name history (a forced rename's ban keeps its account),
 * a reserved key from the name stored with it (review A7, M14-15: keyed again from the old key, a ban or reservation whose name the new data folds
 * differently no longer covered it). An entry with no name to key again (an erased account's, a hold for nobody, a reservation made before M14-15)
 * is keyed again from its old key, as before, and listed in `unnamed`.
 * A collision is two entries that fold to one new key, or an account's new key that 6.2's static rules refuse while its old key was not refused
 * (M14-6: a forced rename gives a generated or reserved name, and that is no collision); the operator settles each with a forced rename of one side
 * (9.4), then releases the old key, which each name of a collision lists as the store keeps it (`entry`, M14-6: `release <key> --key-version <n>`
 * takes it verbatim). `rekey` refuses while a collision remains ('conflict') and then rewrites every key and the version in one store
 * call; it is audited (nameRekeyed). The check is a read like `show`, but `adminViewed` has no `what` for it, so it is not audited (reported).
 *
 * **The operator** (D16, 9.6) is checked with the audit writer's own rules before anything runs (a name of 1 to 64 UTF-16 units and an OS user of at
 * most 64, both plain text under m13's text rules), and the rekey's event is built (and so checked) before the store changes and written to the
 * store after it, outside the writer's queue: a command the audit log cannot record is refused ('invalid'), never run unrecorded.
 */
import type { NameEntry } from '../store/api';
import { hostedTextProblem } from '../text';
import { AccountsAdminError, type AccountAdmin, type ModerationPart, type Operator, type RekeyCheck, type RightsPart } from './api';
import type { Core } from './context';

/** An operator's name (`--as`) and OS user, as the audit writer takes them (src/audit/writer.ts: `admin:<name>` and actorOs). */
const OPERATOR_MAX = 64;

function checkOperator(op: Operator): void {
  if (typeof op !== 'object' || op === null || typeof op.name !== 'string' || op.name.trim() === '' || typeof op.osUser !== 'string') {
    throw new AccountsAdminError('invalid', 'the operator needs a name (--as) and an OS user');
  }
  if (op.name.length > OPERATOR_MAX || hostedTextProblem(op.name) !== null) {
    throw new AccountsAdminError('invalid', `the operator's name (--as) must be plain text of at most ${OPERATOR_MAX} characters`);
  }
  if (op.osUser.length > OPERATOR_MAX || hostedTextProblem(op.osUser) !== null) {
    throw new AccountsAdminError('invalid', `the OS user must be plain text of at most ${OPERATOR_MAX} characters`);
  }
}

async function allEntries(core: Core): Promise<NameEntry[]> {
  const out: NameEntry[] = [];
  let after: string | null = null;
  for (;;) {
    const page = await core.store.nameEntries(after, 500);
    if (page.length === 0) break;
    out.push(...page);
    after = page[page.length - 1]!.key;
    if (page.length < 500) break;
  }
  return out;
}

async function plan(core: Core): Promise<{ check: RekeyCheck; keys: Map<string, string> }> {
  const from = await core.store.nameKeyVersion();
  const to = core.names.current.version;
  if (from === to) return { check: { from, to, changed: 0, collisions: [], unnamed: [] }, keys: new Map() };
  const old = core.names.previous;
  if (old === null || old.version !== from) {
    throw new AccountsAdminError('invalid', `the store's keys are under name data ${from}, which this server does not load as its previous data`);
  }
  const entries = (await allEntries(core)).filter((e) => e.keyVersion === from);
  const keys = new Map<string, string>();
  const byNew = new Map<string, RekeyCheck['collisions'][number]['names']>();
  const collisions: RekeyCheck['collisions'] = [];
  let changed = 0;
  const reservedRule = core.names.reservedProblem as (key: string, display?: string) => 'reserved' | null;
  const unnamed: RekeyCheck['unnamed'] = [];
  for (const e of entries) {
    let display: string | null = null;
    if (e.kind === 'current' && e.account !== null) display = (await core.store.account(e.account))?.name ?? null;
    else if ((e.kind === 'held' || e.kind === 'banned') && e.account !== null) {
      const rows = (await core.store.nameHistory(e.account)).filter((h) => h.key === e.key && h.keyVersion === from);
      display = rows[rows.length - 1]?.name ?? null;
    } else if (e.kind === 'reserved' && e.name !== undefined) display = e.name;
    if (display === null) unnamed.push({ kind: e.kind, account: e.account, entry: { key: e.key, keyVersion: e.keyVersion } });
    const next = core.names.key(display ?? e.key, core.names.current);
    keys.set(e.key, next);
    if (next !== e.key) changed++;
    const who = { kind: e.kind, name: display, account: e.account, entry: { key: e.key, keyVersion: e.keyVersion } };
    const list = byNew.get(next);
    if (list) list.push(who);
    else byNew.set(next, [who]);
    // a current key 6.2's static rules refuse, unless its old key was refused already (a forced rename's generated or --to name, M14-6)
    if (
      e.kind === 'current' && display !== null && reservedRule.call(core.names, next, display) !== null &&
      reservedRule.call(core.names, e.key, display) === null
    ) {
      collisions.push({ key: next, names: [who, { kind: 'reserved', name: null, account: null, entry: null }] });
    }
  }
  for (const [key, names] of byNew) if (names.length > 1) collisions.push({ key, names });
  collisions.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { check: { from, to, changed, collisions, unnamed }, keys };
}

/** A part's admin method by name, called on the part (so it keeps its `this`), or one that throws 'incomplete' while the part is missing. */
function delegate<T extends object>(part: T | null, what: string, pkg: string) {
  return <K extends keyof T>(k: K): T[K] => {
    if (part === null) {
      return (async () => {
        throw new AccountsAdminError('incomplete', `${what} not built yet (${pkg})`);
      }) as T[K];
    }
    return ((...args: unknown[]) => (part[k] as unknown as (...a: unknown[]) => unknown).apply(part, args)) as T[K];
  };
}

export function createAdmin(core: Core, parts: { moderation: ModerationPart | null; rights: RightsPart | null }): AccountAdmin {
  const mod = delegate(parts.moderation?.admin ?? null, 'The moderation commands are', 'M14-6');
  const rights = delegate(parts.rights?.admin ?? null, 'The data-rights commands are', 'M14-7');

  return {
    find: mod('find'),
    show: mod('show'),
    reports: mod('reports'),
    showReport: mod('showReport'),
    closeReport: mod('closeReport'),
    sanction: mod('sanction'),
    lift: mod('lift'),
    forceRename: mod('forceRename'),
    reserveName: mod('reserveName'),
    releaseName: mod('releaseName'),
    revokeSessions: mod('revokeSessions'),
    appeals: mod('appeals'),
    answerAppeal: mod('answerAppeal'),
    audit: mod('audit'),
    exportAccount: rights('exportAccount'),
    deleteAccount: rights('deleteAccount'),
    purge: rights('purge'),
    async rekeyCheck(op) {
      checkOperator(op);
      return (await plan(core)).check;
    },
    async rekey(op) {
      checkOperator(op);
      const { check, keys } = await plan(core);
      if (check.collisions.length > 0) throw new AccountsAdminError('conflict', `${check.collisions.length} collisions remain: settle each with a forced rename`);
      if (check.from === check.to) return { changed: 0 };
      // the event first: one the audit log would refuse stops the command before it changes anything (D16)
      let event;
      try {
        event = core.audit.build(
          { kind: 'nameRekeyed', account: null, actor: `admin:${op.name}`, actorOs: op.osUser, details: { from: check.from, to: check.to, changed: check.changed } },
          core.clock(),
        );
      } catch {
        throw new AccountsAdminError('invalid', 'the rekey cannot be audited as given');
      }
      try {
        await core.store.rekey(check.from, check.to, keys);
      } catch (e) {
        if ((e as { code?: unknown })?.code === 'conflict') throw new AccountsAdminError('conflict', 'a name changed since the check: run it again');
        throw e;
      }
      await core.store.appendAudit([event]);
      await core.audit.flush();
      return { changed: check.changed };
    },
  };
}
