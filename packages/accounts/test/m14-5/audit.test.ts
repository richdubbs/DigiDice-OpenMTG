/**
 * M14-5: the audit writer (design 8.5, D15): address tags under a random month key kept only in memory and destroyed when the month ends; name tags;
 * every kind's details checked against its fixed shape (an extra key, a wrong value, a nameTag with an account, too long: refused); the queue
 * flushed to the store, bounded, dropping signInFailed first; one signInFailed per group per minute with its count.
 */
import { describe, expect, it } from 'vitest';
import { AUDIT_KINDS, createMemoryAccountStore, type AuditEvent, type AuditKind } from '@openmtg/accounts';
import { AUDIT_DETAIL_SHAPES, auditDetailsProblem } from '../../src/audit/details';
import { createAuditWriter } from '../../src/audit/index';
import { buildAuditWriter } from '../../src/audit/writer';
import { fixedRandom, T0 } from './support';

const ACC = 'acc_00000000000000000000000001';

function writer(opts: { queueMax?: number } = {}) {
  const store = createMemoryAccountStore();
  const log: { name: string; fields: Record<string, unknown> }[] = [];
  const timers: (() => void)[] = [];
  const w = buildAuditWriter(
    { store, log: { event: (name, fields) => log.push({ name, fields }) }, random: fixedRandom('audit') },
    { schedule: (f) => timers.push(f), ...opts },
  );
  return { w, store, log, timers };
}

describe('M14-5: the details\' own keys (8.5)', () => {
  it('a key every object inherits (constructor, toString, hasOwnProperty) is an unknown key; an inherited value is not the key\'s value', () => {
    expect(auditDetailsProblem('signedOut', { everywhere: true, constructor: 'alice@example.org' }, null)).toMatch(/unknown key "constructor"/);
    expect(auditDetailsProblem('emailSet', { toString: 'hunter2hunter2' }, null)).toMatch(/unknown key "toString"/);
    expect(auditDetailsProblem('sessionReuse', { hasOwnProperty: 'x' }, null)).toMatch(/unknown key "hasOwnProperty"/);
    expect(auditDetailsProblem('signedOut', { everywhere: true, extra: 'x' }, null)).toMatch(/unknown key "extra"/);
    expect(auditDetailsProblem('signedOut', Object.create({ everywhere: true }) as object, null)).toMatch(/lack everywhere/);
    expect(auditDetailsProblem('signInFailed', Object.assign(Object.create({ nameTag: 'abcdef0123456789' }) as object, { count: 1, nameTag: null }), ACC)).toBeNull();
    expect(auditDetailsProblem('signedOut', { everywhere: true }, null)).toBeNull();
  });
});

describe('M14-5: the audit writer', () => {
  it('address tags: 16 hex digits under the month key, stable within the month, unlinkable across months; spellings of one /64 alike', () => {
    const { w } = writer();
    const oct = new Date('2026-10-10T00:00:00Z');
    const t1 = w.addressTag('203.0.113.7', oct)!;
    expect(t1).toMatch(/^[0-9a-f]{16}$/);
    expect(w.addressTag('203.0.113.7', new Date('2026-10-31T23:59:59Z'))).toBe(t1);
    expect(w.addressTag('203.0.113.8', oct)).not.toBe(t1);
    expect(w.addressTag('2001:db8:1:2::', oct)).toBe(w.addressTag('2001:0DB8:0001:0002:0:0:0:0', oct));
    const nov = new Date('2026-11-01T00:00:00Z');
    const t2 = w.addressTag('203.0.113.7', nov)!;
    expect(t2).not.toBe(t1);
    // October's key is destroyed once November's first event came: an October event gets no tag any more
    expect(w.addressTag('203.0.113.7', oct)).toBeNull();
    // the name tags follow the same keys (and never hold the key)
    expect(w.nameTag('allce', nov)).toMatch(/^[0-9a-f]{16}$/);
    expect(w.nameTag('allce', nov)).toBe(w.nameTag('allce', new Date('2026-11-20T00:00:00Z')));
    expect(w.nameTag('allce', nov)).not.toBe(w.nameTag('bob', nov));
    // a restart (another writer) makes a new key: the tags do not match
    const other = buildAuditWriter({ store: createMemoryAccountStore(), log: { event: () => undefined }, random: fixedRandom('restart') });
    expect(other.addressTag('203.0.113.7', nov)).not.toBe(t2);
  });

  it('sweep destroys the past months\' keys', () => {
    const { w } = writer();
    const oct = new Date('2026-10-10T00:00:00Z');
    w.addressTag('203.0.113.7', oct);
    w.sweep(new Date('2026-11-01T00:00:01Z'));
    expect(w.addressTag('203.0.113.7', oct)).toBeNull();
  });

  it('builds events with exactly the fields of AuditEvent and copies the details', () => {
    const { w } = writer();
    const details = { provider: 'local' as const, device: true, restricted: false };
    const e = w.build({ kind: 'signedIn', account: ACC, actor: 'self', session: 'as_01', addressKey: '203.0.113.7', details }, new Date(T0));
    expect(Object.keys(e).sort()).toEqual(['account', 'actor', 'actorOs', 'addressTag', 'at', 'details', 'id', 'kind', 'session']);
    expect(e.id).toMatch(/^aud_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(e.at).toBe(new Date(T0).toISOString());
    expect(e.actorOs).toBeNull();
    expect(e.details).toEqual(details);
    expect(e.details).not.toBe(details);
    const op = w.build({ kind: 'nameRekeyed', account: null, actor: 'admin:Jane Doe', actorOs: 'jane', details: { from: 1, to: 2, changed: 3 } }, new Date(T0));
    expect([op.actor, op.actorOs, op.addressTag]).toEqual(['admin:Jane Doe', 'jane', null]);
  });

  it('refuses details of another shape, a nameTag with an account, too long details, unknown kinds and bad actors', () => {
    const { w } = writer();
    const at = new Date(T0);
    const bad: [AuditKind, unknown, string | null][] = [
      ['signedIn', { provider: 'local', device: true }, ACC],
      ['signedIn', { provider: 'local', device: true, restricted: false, password: 'x' }, ACC],
      ['signedIn', { provider: 'github', device: true, restricted: false }, ACC],
      ['signInFailed', { count: 1, nameTag: 'not-a-tag' }, null],
      ['signInFailed', { count: 1, nameTag: '0123456789abcdef' }, ACC],
      ['signInFailed', { count: -1, nameTag: null }, null],
      ['sessionReuse', { reason: 'reuse' }, ACC],
      ['guestClaimed', { guestSession: 'has spaces', games: 1 }, ACC],
      ['deleted', { holders: ['hosted', 'Bad Name'] }, ACC],
      ['deletionRequested', { purgeAt: 'tomorrow' }, ACC],
    ];
    for (const [kind, details, account] of bad) {
      expect(() => w.build({ kind, account: account as never, actor: 'self', details: details as never }, at), `${kind} ${JSON.stringify(details)}`).toThrow(TypeError);
    }
    expect(() => w.build({ kind: 'nope' as AuditKind, account: null, actor: 'self', details: {} as never }, at)).toThrow(TypeError);
    expect(() => w.build({ kind: 'signedOut', account: null, actor: 'root' as never, details: { everywhere: true } }, at)).toThrow(TypeError);
    expect(() => w.build({ kind: 'signedOut', account: 'acc_bad' as never, actor: 'self', details: { everywhere: true } }, at)).toThrow(TypeError);
    // every kind has a shape, and the shapes' keys are those of AuditDetails (the type test is the typecheck of details.ts)
    expect(Object.keys(AUDIT_DETAIL_SHAPES).sort()).toEqual([...AUDIT_KINDS].sort());
    expect(auditDetailsProblem('deleted', { holders: Array.from({ length: 16 }, () => 'h'.repeat(32)) }, ACC)).toBeNull();
  });

  it('record queues and flushes to the store; it never throws, and logs a refused event by kind only', async () => {
    const { w, store, log, timers } = writer();
    w.record({ kind: 'signedOut', account: ACC, actor: 'self', details: { everywhere: false } }, new Date(T0));
    w.record({ kind: 'signedOut', account: ACC, actor: 'self', details: { everywhere: 'yes' } as never }, new Date(T0));
    expect(timers).toHaveLength(1);
    expect(log).toEqual([{ name: 'accounts.audit.refused', fields: { kind: 'signedOut', error: 'TypeError' } }]);
    expect(await store.audit({ limit: 10 })).toEqual([]);
    timers[0]!();
    await w.flush();
    const events = await store.audit({ limit: 10 });
    expect(events.map((e) => e.kind)).toEqual(['signedOut']);
  });

  it('a full queue drops signInFailed first, then the oldest, and counts what it dropped', async () => {
    const { w, store, log } = writer({ queueMax: 3 });
    const at = new Date(T0);
    w.record({ kind: 'signedOut', account: ACC, actor: 'self', details: { everywhere: false } }, at);
    w.record({ kind: 'signInFailed', account: null, actor: 'self', details: { count: 1, nameTag: null } }, at);
    w.record({ kind: 'signedOut', account: ACC, actor: 'self', details: { everywhere: true } }, at);
    w.record({ kind: 'emailSet', account: ACC, actor: 'self', details: {} }, at);
    w.record({ kind: 'emailVerified', account: ACC, actor: 'self', details: {} }, at);
    expect(w.dropped).toBe(2);
    await w.flush();
    const kinds = (await store.audit({ limit: 10 })).map((e: AuditEvent) => e.kind).sort();
    expect(kinds).toEqual(['emailSet', 'emailVerified', 'signedOut']);
    expect(log).toContainEqual({ name: 'accounts.audit.dropped', fields: { count: 2 } });
  });

  it('failure counts: one event per group per minute, with the minute\'s count, written once the minute passed', async () => {
    const { w, store } = writer();
    const input = { kind: 'signInFailed' as const, account: null, actor: 'self' as const, addressKey: '203.0.113.7', details: { count: 1, nameTag: null } };
    for (let i = 0; i < 5; i++) w.countFailure('g1', input, new Date(T0 + i * 1_000));
    w.countFailure('g2', input, new Date(T0 + 2_000));
    w.drain(new Date(T0 + 30_000));
    // the drain wrote nothing yet (both windows are open); flush writes the open windows too
    await w.flush();
    const events = await store.audit({ limit: 10 });
    expect(events.map((e) => (e.details as { count: number }).count).sort()).toEqual([1, 5]);
    // a later window of g1 is a new event
    w.countFailure('g1', input, new Date(T0 + 61_000));
    w.drain(new Date(T0 + 122_000));
    await w.flush();
    expect((await store.audit({ limit: 10 })).length).toBe(3);
    expect(createAuditWriter({ store, log: { event: () => undefined }, random: fixedRandom('x') }).nameTag('a', new Date(T0))).toMatch(/^[0-9a-f]{16}$/);
  });
});
