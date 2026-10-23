/**
 * M14-1: the five view key lists and the export's relation list pinned against their types (D13), and each builder of src/views.ts, given rows
 * with extra fields (note, createdBy, reports, tokenHash, previousHash, nameKey, ageGate, version and more), returns exactly its keys, in a new
 * object that shares nothing with the row.
 */
import { describe, expect, it } from 'vitest';
import {
  EXPORT_RELATION_KEYS, PUBLIC_PROFILE_KEYS, RELATION_VIEW_KEYS, SANCTION_VIEW_KEYS, SELF_VIEW_KEYS, SESSION_VIEW_KEYS, exportRelation, publicProfile,
  relationView, sanctionView, selfView, sessionView,
  type Account, type AccountExport, type AccountId, type AccountSessionRow, type AppealRow, type ExportRelation, type PublicProfile, type RelationRow,
  type RelationView, type SanctionRow, type SanctionView, type SelfView, type SessionView,
} from '@openmtg/accounts';
import type { Equals } from './support';

// ---- the key lists against their types (checked by the package typecheck) -----------------------------------------------------------------
const pinPublic: Equals<(typeof PUBLIC_PROFILE_KEYS)[number], keyof PublicProfile> = true;
const pinSelf: Equals<(typeof SELF_VIEW_KEYS)[number], keyof SelfView> = true;
const pinSanction: Equals<(typeof SANCTION_VIEW_KEYS)[number], keyof SanctionView> = true;
const pinSession: Equals<(typeof SESSION_VIEW_KEYS)[number], keyof SessionView> = true;
const pinRelation: Equals<(typeof RELATION_VIEW_KEYS)[number], keyof RelationView> = true;
const pinExportRelation: Equals<(typeof EXPORT_RELATION_KEYS)[number], keyof ExportRelation> = true;
/** The export's relations are ExportRelation, which has no account id (finding 11; 10.1). */
const pinExportRelations: Equals<AccountExport['account']['relations'][number], ExportRelation> = true;

const ID = 'acc_01ARYZ6S41TSV4RRFFQ69G5FAV' as AccountId;
const OTHER = 'acc_3HJKMNPQRSTVWXYZ0123456789' as AccountId;
const NOW = '2026-10-21T12:00:00.000Z';
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.parse(NOW) - days * DAY).toISOString();

/** Fields no view may carry, added to every row given to a builder. */
const EXTRA = {
  note: 'internal note', createdBy: 'admin:alice', reports: ['rep_01ARYZ6S41TSV4RRFFQ69G5FAV'], tokenHash: 'a'.repeat(64), previousHash: 'b'.repeat(64),
  nameKey: 'allce', ageGate: { minAge: 13, passedAt: NOW }, version: 7, secret: '$scrypt$...', addressTag: 'deadbeefdeadbeef', device: 'c'.repeat(64),
  rotation: 3, proofFailures: 2, endedBy: 'admin:bob', answeredBy: 'admin:carol', hash: 'd'.repeat(64), keyVersion: 1,
};

const account = (over: Partial<Account> = {}): Account => ({
  ...EXTRA,
  id: ID, name: 'Alice', nameKey: 'allce', keyVersion: 1, avatar: 'd20-magenta', privacy: { history: 'private', leaderboards: true, guestsAtMyTables: false },
  email: { address: 'alice@example.org', verifiedAt: ago(3) }, ageGate: { minAge: 13, passedAt: ago(100) }, createdAt: '2026-03-15T08:09:10.000Z',
  lastSignInAt: ago(1), renamedAt: null, freeRename: false, deletion: null, inactiveNoticeAt: null, version: 4, ...over,
});

const sanction = (over: Partial<SanctionRow> = {}): SanctionRow => ({
  ...EXTRA,
  id: 'san_01ARYZ6S41TSV4RRFFQ69G5FAV', account: ID, kind: 'mute', reason: 'chat', message: 'Please keep chat friendly.', note: 'internal note',
  since: ago(2), until: new Date(Date.parse(NOW) + 5 * DAY).toISOString(), endedAt: null, createdAt: ago(2), createdBy: 'admin:alice',
  reports: ['rep_01ARYZ6S41TSV4RRFFQ69G5FAV'], endReason: null, endedBy: null, seenAt: null, ...over,
} as SanctionRow);

const appeal = (over: Partial<AppealRow> = {}): AppealRow => ({
  sanction: 'san_01ARYZ6S41TSV4RRFFQ69G5FAV', account: ID, text: 'It was a joke between friends.', createdAt: ago(1), answer: 'upheld',
  answerMessage: 'Upheld.', answeredAt: ago(0.5), answeredBy: 'admin:carol', ...over,
});

const keysOf = (o: object) => Object.keys(o);

describe('M14-1: view key lists', () => {
  it('are pinned against their types and have no duplicates', () => {
    expect([pinPublic, pinSelf, pinSanction, pinSession, pinRelation, pinExportRelation, pinExportRelations]).toEqual([true, true, true, true, true, true, true]);
    for (const list of [PUBLIC_PROFILE_KEYS, SELF_VIEW_KEYS, SANCTION_VIEW_KEYS, SESSION_VIEW_KEYS, RELATION_VIEW_KEYS, EXPORT_RELATION_KEYS]) {
      expect(new Set(list).size).toBe(list.length);
    }
    expect(PUBLIC_PROFILE_KEYS).toEqual(['id', 'name', 'avatar', 'memberSince', 'historyPublic']);
    expect(SESSION_VIEW_KEYS).toEqual(['id', 'provider', 'client', 'createdAt', 'lastUsedAt', 'current']);
    expect(RELATION_VIEW_KEYS).toEqual(['account', 'name', 'kind', 'since']);
    expect(EXPORT_RELATION_KEYS).toEqual(['name', 'kind', 'since']);
    expect(SANCTION_VIEW_KEYS).toEqual(['id', 'kind', 'reason', 'message', 'since', 'until', 'ended', 'appeal']);
    for (const k of ['nameKey', 'keyVersion', 'ageGate', 'version']) expect(SELF_VIEW_KEYS).not.toContain(k);
  });
});

describe('M14-1: the view builders return exactly their keys', () => {
  it('publicProfile: five fields, the month only', () => {
    const v = publicProfile(account());
    expect(keysOf(v)).toEqual([...PUBLIC_PROFILE_KEYS]);
    expect(v).toEqual({ id: ID, name: 'Alice', avatar: 'd20-magenta', memberSince: '2026-03', historyPublic: false });
    expect(publicProfile(account({ privacy: { history: 'public', leaderboards: false, guestsAtMyTables: true } })).historyPublic).toBe(true);
  });

  it('sanctionView: never the note, the operator, the reports or who ended it; the appeal only if it is this sanction\'s', () => {
    const v = sanctionView(sanction({ endedAt: ago(0.1), endReason: 'appeal', endedBy: 'admin:carol' }), appeal());
    expect(keysOf(v)).toEqual([...SANCTION_VIEW_KEYS]);
    expect(v.ended).toEqual({ at: ago(0.1), reason: 'appeal' });
    expect(keysOf(v.ended!)).toEqual(['at', 'reason']);
    expect(v.appeal).toEqual({ at: ago(1), answer: 'upheld', message: 'Upheld.' });
    expect(keysOf(v.appeal!)).toEqual(['at', 'answer', 'message']);
    const text = JSON.stringify(v);
    for (const leak of ['internal note', 'admin:', 'rep_', 'It was a joke']) expect(text).not.toContain(leak);
    expect(sanctionView(sanction(), appeal({ sanction: 'san_3HJKMNPQRSTVWXYZ0123456789' })).appeal).toBeNull();
    expect(sanctionView(sanction(), null)).toMatchObject({ ended: null, appeal: null });
  });

  it('sessionView: never a token hash, a device hash or a counter', () => {
    const row = {
      id: 'as_01ARYZ6S41TSV4RRFFQ69G5FAV', account: ID, provider: 'local', client: 'web', createdAt: ago(5), lastUsedAt: ago(1), authAt: ago(5),
      rotatedAt: ago(1), expiresAt: ago(-175), revokedAt: null, revokeReason: null, ...EXTRA,
    } as AccountSessionRow;
    const v = sessionView(row, true);
    expect(keysOf(v)).toEqual([...SESSION_VIEW_KEYS]);
    expect(v).toEqual({ id: row.id, provider: 'local', client: 'web', createdAt: ago(5), lastUsedAt: ago(1), current: true });
    expect(sessionView(row, false).current).toBe(false);
  });

  it('relationView: the other account, its current name, the kind and since', () => {
    const row = { account: ID, other: OTHER, kind: 'block', createdAt: ago(9), ...EXTRA } as RelationRow;
    const v = relationView(row, 'Bob');
    expect(keysOf(v)).toEqual([...RELATION_VIEW_KEYS]);
    expect(v).toEqual({ account: OTHER, name: 'Bob', kind: 'block', since: ago(9) });
  });

  it('exportRelation: the name, the kind and since, never an account id (finding 11; 10.1)', () => {
    const row = { account: ID, other: OTHER, kind: 'mute', createdAt: ago(4), ...EXTRA } as RelationRow;
    const v = exportRelation(row, 'Bob');
    expect(keysOf(v)).toEqual([...EXPORT_RELATION_KEYS]);
    expect(v).toEqual({ name: 'Bob', kind: 'mute', since: ago(4) });
    const text = JSON.stringify(v);
    for (const leak of [OTHER, ID, 'acc_', 'internal note', 'admin:']) expect(text, leak).not.toContain(leak);
  });

  it('selfView: exactly its keys, nested objects copied, never nameKey, keyVersion, ageGate or version', () => {
    const a = account();
    const v = selfView(a, {
      now: NOW,
      credentials: [{ provider: 'shopify', ...EXTRA }, { provider: 'local', ...EXTRA }] as never,
      recoveryCodes: [{ usedAt: null }, { usedAt: ago(1) }, { usedAt: null }],
      sanctions: [{ row: sanction(), appeal: null }],
      renameCooldownMs: 30 * DAY,
    });
    expect(keysOf(v)).toEqual([...SELF_VIEW_KEYS]);
    expect(keysOf(v.privacy)).toEqual(['history', 'leaderboards', 'guestsAtMyTables']);
    expect(keysOf(v.email!)).toEqual(['address', 'verified']);
    for (const s of v.sanctions) expect(keysOf(s)).toEqual([...SANCTION_VIEW_KEYS]);
    expect(v.privacy).not.toBe(a.privacy);
    expect(v).toMatchObject({
      id: ID, name: 'Alice', avatar: 'd20-magenta', status: 'active', restricted: false, email: { address: 'alice@example.org', verified: true },
      providers: ['local', 'shopify'], hasPassword: true, recoveryCodesLeft: 2, createdAt: '2026-03-15T08:09:10.000Z', renameAt: null, deletion: null,
    });
    expect(v.sanctions.map((s) => s.kind)).toEqual(['mute']);
    const text = JSON.stringify(v);
    for (const leak of ['allce', 'internal note', 'admin:', '$scrypt$', 'deadbeef', 'rep_', 'aaaaaaaa']) expect(text, leak).not.toContain(leak);
  });

  it('selfView: the status and restricted from the sanctions; warnings until seen; ended and expired ones left out', () => {
    const ban = sanction({ id: 'san_0000000000000000000000000B', kind: 'ban', reason: 'cheating', until: null, since: ago(1) });
    const seenWarn = sanction({ id: 'san_0000000000000000000000000W', kind: 'warn', until: null, since: ago(3), seenAt: ago(2) });
    const warn = sanction({ id: 'san_0000000000000000000000000X', kind: 'warn', until: null, since: ago(4) });
    const expired = sanction({ id: 'san_0000000000000000000000000E', kind: 'suspend', since: ago(40), until: ago(10) });
    const lifted = sanction({ id: 'san_0000000000000000000000000L', kind: 'mute', since: ago(4), endedAt: ago(1), endReason: 'lifted' });
    const v = selfView(account(), {
      now: NOW, credentials: [], recoveryCodes: [], renameCooldownMs: 30 * DAY,
      sanctions: [ban, seenWarn, warn, expired, lifted].map((row) => ({ row, appeal: null })),
    });
    expect(v.status).toBe('banned');
    expect(v.restricted).toBe(true);
    expect(v.sanctions.map((s) => s.id)).toEqual([warn.id, ban.id]);
    expect(v).toMatchObject({ providers: [], hasPassword: false, recoveryCodesLeft: 0 });
  });

  it('selfView: renameAt after the cooldown, null with a free rename; the deletion and whether it can be cancelled', () => {
    const parts = { now: NOW, credentials: [], recoveryCodes: [], sanctions: [], renameCooldownMs: 30 * DAY };
    expect(selfView(account({ renamedAt: ago(10) }), parts).renameAt).toBe(new Date(Date.parse(NOW) + 20 * DAY).toISOString());
    expect(selfView(account({ renamedAt: ago(10), freeRename: true }), parts).renameAt).toBeNull();
    expect(selfView(account({ renamedAt: ago(31) }), parts).renameAt).toBeNull();
    const pending = { requestedAt: ago(2), purgeAt: ago(-5), erasingAt: null, done: ['x'] };
    const v = selfView(account({ deletion: pending }), parts);
    expect(v.status).toBe('deleting');
    expect(v.restricted).toBe(true);
    expect(v.deletion).toEqual({ purgeAt: ago(-5), cancellable: true });
    expect(keysOf(v.deletion!)).toEqual(['purgeAt', 'cancellable']);
    expect(selfView(account({ deletion: { ...pending, erasingAt: ago(0) } }), parts).deletion!.cancellable).toBe(false);
    expect(selfView(account({ deletion: { ...pending, purgeAt: NOW } }), parts).deletion!.cancellable).toBe(false);
    expect(selfView(account({ email: { address: 'a@b.cd', verifiedAt: null } }), parts).email).toEqual({ address: 'a@b.cd', verified: false });
    expect(selfView(account({ email: null }), parts).email).toBeNull();
  });
});
