/**
 * The view builders (design D13, 7.3, 7.4, 11.1; M14-1, server only). Every view that leaves the server is built here, by one function per view
 * that returns a NEW object with exactly its key list (PUBLIC_PROFILE_KEYS, SELF_VIEW_KEYS, SANCTION_VIEW_KEYS, SESSION_VIEW_KEYS,
 * RELATION_VIEW_KEYS, and the export's EXPORT_RELATION_KEYS), writing each key by name and never spreading a row: TypeScript does not stop extra
 * properties at run time, so a row's `note`, `createdBy`, `reports`, `tokenHash`, `previousHash`, `nameKey`, `ageGate` or `version` can never ride
 * along (test/m14-1/views.test.ts).
 * Nested values are copied too (privacy, email, ended, appeal, deletion), so a view never shares an object with a stored row.
 */
import {
  accountStatus, sanctionRuns, type Account, type AccountSession, type ExportRelation, type ProviderId, type PublicProfile, type RelationView,
  type SanctionView, type SelfView, type SessionView,
} from './api';
import type { AppealRow, CredentialRow, RecoveryCodeRow, RelationRow, SanctionRow } from './store/api';

/** The public profile (7.3): the month the account was made, never the day. Only for an active account; the service answers notFound otherwise. */
export function publicProfile(a: Account): PublicProfile {
  const t = Date.parse(a.createdAt);
  return {
    id: a.id,
    name: a.name,
    avatar: a.avatar,
    memberSince: Number.isFinite(t) ? new Date(t).toISOString().slice(0, 7) : a.createdAt.slice(0, 7),
    historyPublic: a.privacy.history === 'public',
  };
}

/** A sanction as the account sees it (never the note, the operator, the reports it settles or who ended it). `appeal` counts only if it is this sanction's. */
export function sanctionView(row: SanctionRow, appeal: AppealRow | null): SanctionView {
  const own = appeal !== null && appeal.sanction === row.id ? appeal : null;
  return {
    id: row.id,
    kind: row.kind,
    reason: row.reason,
    message: row.message,
    since: row.since,
    until: row.until,
    ended: row.endedAt !== null ? { at: row.endedAt, reason: row.endReason ?? 'lifted' } : null,
    appeal: own !== null ? { at: own.createdAt, answer: own.answer, message: own.answerMessage } : null,
  };
}

/** A session in the sessions list (5.2): never a token hash, a device hash or a counter. */
export function sessionView(row: AccountSession, current: boolean): SessionView {
  return { id: row.id, provider: row.provider, client: row.client, createdAt: row.createdAt, lastUsedAt: row.lastUsedAt, current };
}

/** A block or mute the account set, with the other account's current name. */
export function relationView(row: RelationRow, name: string): RelationView {
  return { account: row.other, name, kind: row.kind, since: row.createdAt };
}

/** A block or mute in the account's export (10.1): the other account's name, never its id. */
export function exportRelation(row: RelationRow, name: string): ExportRelation {
  return { name, kind: row.kind, since: row.createdAt };
}

/** What selfView needs besides the account row; it works the status, the listed sanctions, renameAt and cancellable out itself, at `now`. */
export interface SelfViewParts {
  /** The time the view is for (the request's ctx.now as an ISO string). */
  now: string;
  /** The account's credentials: `providers` (each provider once, 'local' included, in ProviderId order) and `hasPassword` (a local one). */
  credentials: readonly Pick<CredentialRow, 'provider'>[];
  /** The account's recovery code slots: recoveryCodesLeft counts the unused ones. */
  recoveryCodes: readonly Pick<RecoveryCodeRow, 'usedAt'>[];
  /** Every sanction of the account with its appeal (or null); the status comes from these (accountStatus, D23). */
  sanctions: readonly { row: SanctionRow; appeal: AppealRow | null }[];
  /** ACCOUNT_TIMING.renameCooldownMs as configured. */
  renameCooldownMs: number;
}

const PROVIDER_ORDER: readonly ProviderId[] = ['local', 'shopify', 'passkey'];

/**
 * Whether SelfView lists the sanction at `now`: a running mute, unlist, suspension or ban; a warning (and a forced-rename notice, which never expires
 * either) while it is not marked seen and not ended.
 */
function listed(row: SanctionRow, now: string): boolean {
  if (!sanctionRuns(row, now)) return false;
  return row.kind === 'warn' || row.kind === 'rename' ? row.seenAt === null : true;
}

/**
 * What the account itself sees (`me`, `welcome.account`, the export): never nameKey, keyVersion, ageGate or version. `restricted` is true while the
 * status is not 'active' (3.8: such an account only ever gets restricted sessions).
 */
export function selfView(a: Account, parts: SelfViewParts): SelfView {
  const { now } = parts;
  const status = accountStatus(parts.sanctions.map((s) => s.row), a.deletion, now);
  const has = new Set(parts.credentials.map((c) => c.provider));
  let renameAt: string | null = null;
  if (!a.freeRename && a.renamedAt !== null) {
    const next = Date.parse(a.renamedAt) + parts.renameCooldownMs;
    if (Number.isFinite(next) && next > Date.parse(now)) renameAt = new Date(next).toISOString();
  }
  const sanctions = parts.sanctions
    .filter((s) => listed(s.row, now))
    .sort((x, y) => Date.parse(x.row.since) - Date.parse(y.row.since))
    .map((s) => sanctionView(s.row, s.appeal));
  return {
    id: a.id,
    name: a.name,
    avatar: a.avatar,
    status,
    restricted: status !== 'active',
    privacy: { history: a.privacy.history, leaderboards: a.privacy.leaderboards, guestsAtMyTables: a.privacy.guestsAtMyTables },
    email: a.email !== null ? { address: a.email.address, verified: a.email.verifiedAt !== null } : null,
    providers: PROVIDER_ORDER.filter((p) => has.has(p)),
    hasPassword: has.has('local'),
    recoveryCodesLeft: parts.recoveryCodes.filter((r) => r.usedAt === null).length,
    createdAt: a.createdAt,
    renameAt,
    sanctions,
    deletion:
      a.deletion !== null
        ? { purgeAt: a.deletion.purgeAt, cancellable: a.deletion.erasingAt === null && Date.parse(now) < Date.parse(a.deletion.purgeAt) }
        : null,
  };
}
