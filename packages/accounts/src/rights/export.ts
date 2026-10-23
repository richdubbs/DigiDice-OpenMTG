/**
 * M14-7: the export (design 10.1, 11.1 AccountExport): one JSON document of the account's OWN data, built from its rows by fixed key lists, so
 * nothing of anyone else rides along.
 *
 * - `account.self`: its SelfView (src/views.ts), with the full createdAt. `nameHistory`: every name it has had, redacted ones included (they were its
 *   own). `ageGate`, `lastSignInAt`.
 * - `sessions`: every session row the store still holds (live ones, and revoked or expired ones within their 7 days, 10.3) as SessionView, `current`
 *   for the session that asked. `devices`: every device proof of the account (AccountStore.devicesOf), times only.
 * - `claims`, and `relations` by the other account's current name (ExportRelation: never its id), by time and then name, never in id order.
 * - `reportsFiled`: reason, its own text, date, the target as the display name at the time (`targetName`) and `open` or `closed`, never the outcome.
 *   `reportsAbout`: closed reports only, as the reason and the month the report was made, sorted by month and reason, so neither a reporter nor the
 *   one game just played can be read from them. Reports filed by or about a guest session the account claimed count as its own (5.5), as the store's
 *   erase treats them, read by the store's guestSession query (never the whole table).
 * - **Only what the account could see of others now** (review of M14-7): a relation, and a report it filed about an account, are listed only while
 *   that other account is active (status 'active', as AccountDirectory.names), so blocking or reporting an id and exporting never tells whether it is
 *   suspended, banned, being deleted or erased, or what a hidden account is called now. Such a row comes back in the export once the other account
 *   is active again (an erased one never does). A report about a guest session is listed as it is.
 * - `sanctions`: every sanction with its appeal as SanctionView (never the note, the operator or the reports it settles).
 * - `security`: its SECURITY_AUDIT_KINDS events whose actor is `self` or `system`: time, kind, session and details, never the address tag or an
 *   operator. No moderation or operator event (no `adminViewed` telling a suspect a moderator is looking, no `sanctioned` with an operator's name).
 * - `holders`: one section per registered AccountDataHolder (its exportFor, copied through JSON), in the order they were added; `missing` names the
 *   required holders (11.7) that are not registered (only the operator's `--partial` gives such an export: the server's exportData answers
 *   `unavailable` until they are, 10.1).
 */
import { SECURITY_AUDIT_KINDS, type Account, type AccountExport, type AccountId } from '../api';
import type { ReportRow } from '../store/api';
import { exportRelation, sanctionView, sessionView } from '../views';
import { activeAccounts, allAudit, allReports, iso, missingHolders, playerRef, sanctionsWithAppeals, selfViewFor, type Rights } from './context';

/** 'YYYY-MM' of an ISO time, in UTC. */
function monthOf(t: string): string {
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 7) : t.slice(0, 7);
}

/** A holder's section as plain JSON (11.1: JSON-safe), never sharing an object with the holder. */
function jsonCopy(v: unknown): unknown {
  return v === undefined ? null : (JSON.parse(JSON.stringify(v)) as unknown);
}

/** The reports filed by the account and the closed ones about it, its claimed guest sessions' included, each once, in id order. */
async function reportsOf(r: Rights, a: Account, guests: ReadonlySet<string>): Promise<{ filed: ReportRow[]; about: ReportRow[] }> {
  const closed = (x: ReportRow) => x.status !== 'new';
  const [byAccount, aboutAccount] = await Promise.all([allReports(r, { reporter: a.id }), allReports(r, { target: a.id }, closed)]);
  const filed = new Map(byAccount.map((x) => [x.id, x]));
  const about = new Map(aboutAccount.map((x) => [x.id, x]));
  for (const g of guests) {
    const byGuest = (x: ReportRow) => x.reporter?.kind === 'guest' && x.reporter.session === g;
    const aboutGuest = (x: ReportRow) => 'guestSession' in x.target && x.target.guestSession === g && closed(x);
    for (const x of await allReports(r, { guestSession: g }, (x) => byGuest(x) || aboutGuest(x))) {
      if (byGuest(x)) filed.set(x.id, x);
      if (aboutGuest(x)) about.set(x.id, x);
    }
  }
  const byId = (x: ReportRow, y: ReportRow) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  return { filed: [...filed.values()].sort(byId), about: [...about.values()].sort(byId) };
}

/** The account's export at `now`; `session` is the session that asked (its SessionView is `current`), null for the operator's export. */
export async function buildAccountExport(r: Rights, a: Account, opts: { now: Date; session: string | null }): Promise<AccountExport> {
  const id = a.id;
  const [self, sanctions, history, sessions, deviceRows, claims, relations, events] = await Promise.all([
    selfViewFor(r, a, opts.now), sanctionsWithAppeals(r, id), r.store.nameHistory(id), r.store.sessionsOf(id), r.store.devicesOf(id),
    r.store.claimsOf(id), r.store.relationsOf(id), allAudit(r, id, SECURITY_AUDIT_KINDS),
  ]);
  const devices = deviceRows.map((d) => ({ createdAt: d.createdAt, lastUsedAt: d.lastUsedAt }));

  const { filed: filedAll, about } = await reportsOf(r, a, new Set(claims.map((c) => c.session)));
  // the other accounts it can see now (see the header): its relations' and its reports' targets
  const targetOf = (x: ReportRow): AccountId | null => ('account' in x.target ? x.target.account : null);
  const active = await activeAccounts(r, [...relations.map((x) => x.other), ...filedAll.flatMap((x) => targetOf(x) ?? [])], opts.now);
  const exportRelations = relations
    .flatMap((x) => {
      const other = active.get(x.other);
      // never shown by id: a relation to an account that is not active now is left out
      return other !== undefined ? [exportRelation(x, other.name)] : [];
    })
    // by time, then name and kind: never in the order of the other accounts' ids
    .sort((x, y) => Date.parse(x.since) - Date.parse(y.since) || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0) || (x.kind < y.kind ? -1 : x.kind > y.kind ? 1 : 0));

  const filed = filedAll.filter((x) => {
    const target = targetOf(x);
    return target === null || active.has(target);
  });
  const reportsAbout = about
    .map((x) => ({ reason: x.reason, month: monthOf(x.createdAt) }))
    .sort((x, y) => (x.month !== y.month ? (x.month < y.month ? -1 : 1) : x.reason < y.reason ? -1 : x.reason > y.reason ? 1 : 0));

  const ref = await playerRef(r, a);
  const holders: Record<string, unknown> = {};
  for (const h of r.holders.values()) holders[h.name] = jsonCopy(await h.exportFor(ref));

  return {
    format: 'openmtg-account-export',
    version: 1,
    exportedAt: iso(opts.now),
    missing: missingHolders(r),
    account: {
      self,
      nameHistory: history.map((h) => ({ name: h.name, from: h.from, to: h.to, cause: h.cause })),
      ageGate: { minAge: a.ageGate.minAge, passedAt: a.ageGate.passedAt },
      lastSignInAt: a.lastSignInAt,
      sessions: sessions.map((s) => sessionView(s, s.id === opts.session)),
      devices,
      claims: claims.map((c) => ({ session: c.session, claimedAt: c.claimedAt })),
      relations: exportRelations,
      reportsFiled: filed.map((x) => ({
        id: x.id,
        target: { kind: 'account' in x.target ? ('account' as const) : ('guest' as const), name: x.targetName },
        reason: x.reason,
        text: x.text,
        createdAt: x.createdAt,
        status: x.status === 'new' ? ('open' as const) : ('closed' as const),
      })),
      reportsAbout,
      sanctions: sanctions.map((s) => sanctionView(s.row, s.appeal)),
      security: events
        .filter((e) => e.actor === 'self' || e.actor === 'system')
        .map((e) => ({ at: e.at, kind: e.kind, session: e.session, details: jsonCopy(e.details) as Record<string, unknown> })),
    },
    holders,
  };
}
