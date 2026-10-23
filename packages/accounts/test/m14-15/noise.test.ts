/**
 * M14-15, security review pass A, findings A8 and A9: the security log's growth from names no account holds, and what the noise bounds keep in
 * memory (8.5, D15). In process, the fast hasher's spy (its pressure switch and its jobs), a fake clock and fixed inputs (owner rule); the audit
 * writer is the one the service hands its parts (PartDeps.audit).
 *
 * - A8: failed sign-ins (and recoveries) on names no account holds make one event a minute per address key, whatever the names, with the name's
 *   tag only while it was one name; all of them together at most ANONYMOUS_EVENTS_PER_MINUTE a minute, the rest counted and logged. Events about
 *   an account are as before, whatever the budget.
 * - A9: the once-a-minute keys hold the account id or 'anon' and the address tag, never a typed name's key or a raw address key, and the tick
 *   sweeps them once their minute is over.
 */
import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '@openmtg/accounts';
import { ANONYMOUS_EVENTS_PER_MINUTE, type ServiceAuditWriter } from '../../src/audit/writer';
import { addressFor, code, ctxOf, MIN, PW, PW2, registerAs, setup, type Setup } from '../m14-5/support';
import { createModerationPart } from '../../src/moderation/index';

/** M14-5's setup with a part, so the test can reach the audit writer the core hands its parts. */
function withWriter(o: Parameters<typeof setup>[0] = {}): Setup & { writer: ServiceAuditWriter } {
  const s = setup({ ...o, parts: { moderation: (deps) => createModerationPart(deps) } });
  return Object.assign(s, { writer: s.partDeps.current!.audit as ServiceAuditWriter });
}

async function securityEvents(s: Setup, kind: AuditEvent['kind']): Promise<AuditEvent[]> {
  await s.service.tick(s.clock.now());
  return s.store.audit({ kinds: [kind], limit: 10_000 });
}

const signIn = (s: Setup, name: string, who: string, password = PW2) =>
  s.service.signIn(ctxOf(s.clock, { addressKey: addressFor(who), guestSession: null, connection: `conn-${who}` }), { name, password });

describe('M14-15 A8: names no account holds make one event a minute per address key, within a budget (8.5)', () => {
  it('ten free names from one address key under hashing pressure: no hash, and one event with the count and no name tag', async () => {
    const s = withWriter();
    s.hasher.pressure = true;
    s.hasher.reset();
    for (let i = 0; i < 10; i++) expect(code(await signIn(s, `Freename${'abcdefghjk'[i]}`, 'one place'))).toBe('badCredentials');
    expect(s.hasher.calls).toEqual([]);
    s.clock.advance(MIN + 1);
    const events = await securityEvents(s, 'signInFailed');
    expect(events.map((e) => [e.account, e.details])).toEqual([[null, { count: 10, nameTag: null }]]);
  });

  it('one name again and again keeps its tag; recoveries on free names are summed per address key too', async () => {
    const s = withWriter();
    for (let i = 0; i < 4; i++) expect(code(await signIn(s, 'Nobody Here', 'one place'))).toBe('badCredentials');
    const ctx = ctxOf(s.clock, { addressKey: addressFor('recoverer'), guestSession: null });
    for (const name of ['Ghost', 'Phantom', 'Spectre']) {
      expect(code(await s.service.useRecoveryCode(ctx, { name, code: 'AAAA-BBBB-CCCC-DDDD', newPassword: 'a brand new passphrase' }))).toBe('badCredentials');
    }
    s.clock.advance(MIN + 1);
    const failed = await securityEvents(s, 'signInFailed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.details).toEqual({ count: 4, nameTag: expect.stringMatching(/^[0-9a-f]{16}$/) });
    expect((await s.store.audit({ kinds: ['recoveryFailed'], limit: 10 })).map((e) => [e.account, e.details])).toEqual([[null, { count: 3 }]]);
  });

  it('many address keys: at most the budget of events a minute, the rest counted and logged; an account\'s events are never held to it', async () => {
    expect(ANONYMOUS_EVENTS_PER_MINUTE).toBe(30);
    const s = withWriter();
    const alice = await registerAs(s, 'Alice');
    void alice;
    for (let i = 0; i < 40; i++) expect(code(await signIn(s, `Freename${i % 10}x`, `botnet ${i}`))).toBe('badCredentials');
    // Alice's own failures in the same minute, from two places
    for (const who of ['alice a', 'alice b']) expect(code(await signIn(s, 'Alice', who))).toBe('badCredentials');
    s.clock.advance(MIN + 1);
    const events = await securityEvents(s, 'signInFailed');
    expect(events.filter((e) => e.account === null)).toHaveLength(ANONYMOUS_EVENTS_PER_MINUTE);
    expect(events.filter((e) => e.account !== null).map((e) => e.details)).toEqual([{ count: 1, nameTag: null }, { count: 1, nameTag: null }]);
    expect(s.log.filter((l) => l.name === 'accounts.audit.anonymousDropped')).toEqual([{ name: 'accounts.audit.anonymousDropped', fields: { count: 10 } }]);
    // a new minute, a new budget
    expect(code(await signIn(s, 'Another Free', 'botnet 0'))).toBe('badCredentials');
    s.clock.advance(MIN + 1);
    expect((await securityEvents(s, 'signInFailed')).filter((e) => e.account === null)).toHaveLength(ANONYMOUS_EVENTS_PER_MINUTE + 1);
  });
});

describe('M14-15 A9: the once-a-minute keys hold tags only, and the tick sweeps them (8.5, D15)', () => {
  it('a throttle on an account and work demands on free names: keys by account id or anon and the address tag; gone a minute later', async () => {
    const s = withWriter({ verifier: 'work' });
    const alice = await registerAs(s, 'Alice');
    // five failures on Alice from one place, then the back-off throttles the sixth (rule 1): a throttle event's key
    for (let i = 0; i < 5; i++) expect(code(await signIn(s, 'Alice', 'guesser'))).toBe('badCredentials');
    expect(code(await signIn(s, 'Alice', 'guesser'))).toBe('rateLimited');
    // under hashing pressure, a free name from a place that failed asks for work (rule 5): a work demand's key
    s.hasher.pressure = true;
    expect(code(await signIn(s, 'Typedname Secret', 'guesser'))).toBe('captchaRequired');
    const keys = s.writer.noiseKeys();
    const tag = s.writer.addressTag(addressFor('guesser'), s.clock.now())!;
    expect(keys.sort()).toEqual([`throttle\n${alice.auth.account}\n${tag}`, `work\nanon\n${tag}`].sort());
    const typed = [addressFor('guesser'), s.names.key('Typedname Secret'), s.names.key('Alice'), 'Typedname', 'typedname'];
    for (const k of keys) for (const x of typed) expect(k.includes(x), `${JSON.stringify(k)} holds ${x}`).toBe(false);
    // still within the minute: kept; once it is over, the tick drops them
    await s.service.tick(s.clock.now());
    expect(s.writer.noiseKeys()).toHaveLength(2);
    s.clock.advance(MIN);
    await s.service.tick(s.clock.now());
    expect(s.writer.noiseKeys()).toEqual([]);
  });
});
