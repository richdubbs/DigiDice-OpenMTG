/**
 * M14-7: what every piece of the rights part shares (design section 10): the core's PartDeps, the clock for the operator's commands, the registered
 * data holders, the tick's cursors, and the small reads the export and the erasure both need (an account's PlayerRef, every page of a store
 * listing, which accounts are active, whether one is still there).
 */
import { accountStatus, type Account, type AccountDataHolder, type AccountId, type AuditEvent, type AuditKind, type PlayerRef, type SelfView } from '../api';
import type { AccountsConfig } from '../config';
import type { AccountsLog, PartDeps } from '../service/api';
import type { AccountStore, AppealRow, ListCursor, ReportQuery, ReportRow, SanctionRow } from '../store/api';
import { selfView } from '../views';

export const DAY = 86_400_000;

/** Rows read per page from a store listing. */
export const PAGE = 500;

export interface Rights {
  deps: PartDeps;
  store: AccountStore;
  config: AccountsConfig;
  log: AccountsLog;
  /** The service's clock (PartDeps.clock), for calls that bring no time: the operator's commands. */
  clock: () => Date;
  /** The registered holders by name, in the order they were added (AccountService.addHolder). */
  holders: Map<string, AccountDataHolder>;
}

/** Where the tick's paged listings go on at the next tick (ListCursor; null: from the start). */
export interface Cursors { erase: ListCursor | null; inactive: ListCursor | null }

export const iso = (d: Date): string => d.toISOString();

/** An error's name for the log (12.1: never its message, which may hold what a caller typed). */
export const errorName = (e: unknown): string => (e instanceof Error ? e.name : 'error');

/** The required holders (AccountsConfig.requiredHolders, 11.7) that are not registered. */
export function missingHolders(r: Rights): string[] {
  return r.config.requiredHolders.filter((h) => !r.holders.has(h));
}

/** What a holder needs to find a player's rows (11.1): the account, its claimed guest sessions, and every display name it has had. */
export async function playerRef(r: Rights, account: { id: AccountId; name: string }): Promise<PlayerRef> {
  const [claims, history] = await Promise.all([r.store.claimsOf(account.id), r.store.nameHistory(account.id)]);
  const names: string[] = [];
  for (const n of [...history.map((h) => h.name), account.name]) if (!names.includes(n)) names.push(n);
  return { account: account.id, claims: claims.map((c) => ({ session: c.session, claimedAt: c.claimedAt })), names };
}

/** Every sanction of the account with its appeal (or null), in the store's order (by start). */
export async function sanctionsWithAppeals(r: Rights, id: AccountId): Promise<{ row: SanctionRow; appeal: AppealRow | null }[]> {
  const [rows, appeals] = await Promise.all([r.store.sanctionsOf(id), r.store.appeals({ account: id, limit: 10_000 })]);
  const by = new Map(appeals.map((a) => [a.sanction, a]));
  return rows.map((row) => ({ row, appeal: by.get(row.id) ?? null }));
}

/** What the account itself sees at `now` (src/views.ts selfView), from its rows. */
export async function selfViewFor(r: Rights, a: Account, now: Date): Promise<SelfView> {
  const [credentials, recoveryCodes, sanctions] = await Promise.all([r.store.credentials(a.id), r.store.recoveryCodes(a.id), sanctionsWithAppeals(r, a.id)]);
  return selfView(a, { now: iso(now), credentials, recoveryCodes, sanctions, renameCooldownMs: r.config.timing.renameCooldownMs });
}

/** The account is there and not erased: what a flow that outlasted an erasure checks before it records or hands out anything of it. */
export async function stillThere(r: Rights, id: AccountId): Promise<boolean> {
  const [a, t] = await Promise.all([r.store.account(id), r.store.tombstone(id)]);
  return a !== null && t === null;
}

/** The accounts of `ids` that are active at `now` (status 'active', as AccountDirectory.names shows them), by id. */
export async function activeAccounts(r: Rights, ids: readonly AccountId[], now: Date): Promise<Map<AccountId, Account>> {
  const list = [...new Set(ids)];
  const out = new Map<AccountId, Account>();
  if (list.length === 0) return out;
  const [accounts, running] = await Promise.all([r.store.accounts(list), r.store.runningSanctions(list, iso(now))]);
  for (const [id, a] of accounts) if (accountStatus(running.get(id) ?? [], a.deletion, iso(now)) === 'active') out.set(id, a);
  return out;
}

/** Every report matching `q` that `keep` keeps, page by page in id order, each page filtered as it comes. */
export async function allReports(r: Rights, q: Omit<ReportQuery, 'limit' | 'after'>, keep: (x: ReportRow) => boolean = () => true): Promise<ReportRow[]> {
  const out: ReportRow[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await r.store.reports({ ...q, limit: PAGE, ...(after !== undefined ? { after } : {}) });
    for (const x of page) if (keep(x)) out.push(x);
    if (page.length < PAGE) return out;
    after = page[page.length - 1]!.id;
  }
}

/**
 * Every audit event of `account` of `kinds`, oldest first. AuditQuery pages by time only (`since` is inclusive), so each page starts at the last
 * page's last time and skips the ids it has seen; a page that brings nothing new ends it.
 */
export async function allAudit(r: Rights, account: AccountId, kinds: readonly AuditKind[]): Promise<AuditEvent[]> {
  const out: AuditEvent[] = [];
  const seen = new Set<string>();
  let since: string | undefined;
  for (;;) {
    const page = await r.store.audit({ account, kinds: [...kinds], limit: PAGE, ...(since !== undefined ? { since } : {}) });
    const fresh = page.filter((e) => !seen.has(e.id));
    for (const e of fresh) {
      seen.add(e.id);
      out.push(e);
    }
    if (page.length < PAGE || fresh.length === 0) return out;
    since = page[page.length - 1]!.at;
  }
}
