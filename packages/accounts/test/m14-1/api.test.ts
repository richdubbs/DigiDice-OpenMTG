/**
 * M14-1: the pure parts of the browser-safe contract (design 11.1): avatars, the status and the standing worked out from sanctions and a deletion
 * (D23, 3.8, 9.3), the age gate at the month boundaries (7.5), the environment names, and the constants other packages read.
 */
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_LIMITS, ACCOUNT_RATE_LIMITS, ACCOUNT_TIMING, AVATAR_IDS, AVATAR_SHAPES, AVATAR_TONES, DEFAULT_PRIVACY, DELETED_PLAYER_NAME, REPORT_REASONS,
  accountStatus, accountsEnvName, defaultAvatar, isAvatarId, oldEnough, sanctionRuns, standingOf,
  type Account, type AccountId, type SanctionKind, type SanctionSpan,
} from '@openmtg/accounts/api';
import { newAccountId } from '@openmtg/accounts';
import { fixedRandom } from './support';

const ID = 'acc_01ARYZ6S41TSV4RRFFQ69G5FAV' as AccountId;
const T0 = '2026-10-01T00:00:00.000Z';
const at = (days: number): string => new Date(Date.parse(T0) + days * 86_400_000).toISOString();
const span = (kind: SanctionKind, since: number, until: number | null, endedAt: number | null = null): SanctionSpan => ({
  kind, since: at(since), until: until === null ? null : at(until), endedAt: endedAt === null ? null : at(endedAt),
});
const deletion = (requested: number): Account['deletion'] => ({ requestedAt: at(requested), purgeAt: at(requested + 7), erasingAt: null, done: [] });
const acct = (d: Account['deletion'] = null) => ({ id: ID, createdAt: '2026-01-02T03:04:05.000Z', deletion: d });

describe('M14-1: avatars (7.1)', () => {
  it('48 distinct ids, shape by shape, each a shape and a tone', () => {
    expect(AVATAR_IDS).toHaveLength(48);
    expect(new Set(AVATAR_IDS).size).toBe(48);
    expect(AVATAR_IDS.slice(0, 6)).toEqual(['d4-blue', 'd4-magenta', 'd4-violet', 'd4-cyan', 'd4-amber', 'd4-white']);
    expect(AVATAR_IDS[47]).toBe('comet-white');
    AVATAR_SHAPES.forEach((s, i) => AVATAR_TONES.forEach((t, j) => expect(AVATAR_IDS[i * AVATAR_TONES.length + j]).toBe(`${s}-${t}`)));
    expect(Object.isFrozen(AVATAR_IDS)).toBe(true);
  });

  it('isAvatarId accepts exactly the 48', () => {
    for (const a of AVATAR_IDS) expect(isAvatarId(a)).toBe(true);
    for (const x of ['', 'd20', 'd20-red', 'D20-blue', 'd20-blue ', 'd3-blue', 'chip-', '-blue', 42, null, undefined]) expect(isAvatarId(x), String(x)).toBe(false);
  });

  it('defaultAvatar is a fixed function of the id (pinned: it must never change)', () => {
    expect(defaultAvatar('acc_00000000000000000000000000')).toBe('d6-magenta');
    expect(defaultAvatar('acc_7ZZZZZZZZZZZZZZZZZZZZZZZZZ')).toBe('d10-amber');
    expect(defaultAvatar('acc_01ARYZ6S41TSV4RRFFQ69G5FAV')).toBe('d12-amber');
    expect(defaultAvatar('acc_3HJKMNPQRSTVWXYZ0123456789')).toBe('comet-cyan');
    const r = fixedRandom('avatars');
    const seen = new Set<string>();
    for (let i = 0; i < 2_000; i++) {
      const id = newAccountId(r);
      const a = defaultAvatar(id);
      expect(isAvatarId(a)).toBe(true);
      expect(defaultAvatar(id)).toBe(a);
      seen.add(a);
    }
    // spread over the whole set, not stuck on a few
    expect(seen.size).toBe(48);
  });
});

describe('M14-1: sanctionRuns, accountStatus (D23, 3.8)', () => {
  it('a sanction runs from since, until until (an expiry takes effect at its time), unless ended', () => {
    const s = span('suspend', 0, 10);
    expect(sanctionRuns(s, at(-1))).toBe(false);
    expect(sanctionRuns(s, at(0))).toBe(true);
    expect(sanctionRuns(s, at(9.999))).toBe(true);
    expect(sanctionRuns(s, at(10))).toBe(false);
    expect(sanctionRuns(span('ban', 0, null), at(10_000))).toBe(true);
    expect(sanctionRuns(span('ban', 0, null, 3), at(2))).toBe(true);
    expect(sanctionRuns(span('ban', 0, null, 3), at(3))).toBe(false);
    expect(() => sanctionRuns(s, 'not a time')).toThrow(RangeError);
  });

  it('active, suspended, banned, deleting, in that order of precedence', () => {
    expect(accountStatus([], null, at(1))).toBe('active');
    expect(accountStatus([span('warn', 0, null), span('mute', 0, 30), span('unlist', 0, null)], null, at(1))).toBe('active');
    expect(accountStatus([span('suspend', 0, 30)], null, at(1))).toBe('suspended');
    expect(accountStatus([span('ban', 0, null)], null, at(1))).toBe('banned');
    expect(accountStatus([span('suspend', 0, 30), span('ban', 0, null)], null, at(1))).toBe('banned');
    expect(accountStatus([span('ban', 0, null)], deletion(1), at(2))).toBe('deleting');
  });

  it('suspend, then delete, then cancel leaves suspended', () => {
    const sanctions = [span('suspend', 0, 30)];
    expect(accountStatus(sanctions, null, at(1))).toBe('suspended');
    expect(accountStatus(sanctions, deletion(2), at(3))).toBe('deleting');
    // the cancel clears Account.deletion; the suspension was never touched
    expect(accountStatus(sanctions, null, at(4))).toBe('suspended');
  });

  it('ban plus suspend, then lifting the suspension, leaves banned; lifting the ban then leaves active', () => {
    expect(accountStatus([span('ban', 0, null), span('suspend', 0, 30, 5)], null, at(6))).toBe('banned');
    expect(accountStatus([span('ban', 0, null, 7), span('suspend', 0, 30, 5)], null, at(8))).toBe('active');
    // a suspension that outlasts a lifted ban is in force again
    expect(accountStatus([span('ban', 0, null, 7), span('suspend', 0, 30)], null, at(8))).toBe('suspended');
  });

  it('an expiry takes effect at its until, without tick (endedAt still null)', () => {
    const sanctions = [span('suspend', 0, 10)];
    expect(accountStatus(sanctions, null, at(9))).toBe('suspended');
    expect(accountStatus(sanctions, null, at(10))).toBe('active');
    expect(accountStatus([span('ban', 0, 20), span('suspend', 0, 10)], null, at(15))).toBe('banned');
    expect(accountStatus([span('ban', 0, 20), span('suspend', 0, 10)], null, at(20))).toBe('active');
  });

  it('a sanction that has not started does not count', () => {
    expect(accountStatus([span('ban', 5, null)], null, at(1))).toBe('active');
  });

  it('a damaged row never lifts a ban by itself: a since, until or endedAt that does not parse keeps it running (findings 4, 10)', () => {
    const ban: SanctionSpan = span('ban', 0, null);
    for (const bad of ['not-a-time', '', '2026-13-45T99:00:00Z']) {
      for (const damaged of [{ ...ban, since: bad }, { ...ban, until: bad }, { ...ban, endedAt: bad }] as SanctionSpan[]) {
        const label = JSON.stringify(damaged);
        expect(sanctionRuns(damaged, at(1)), label).toBe(true);
        expect(sanctionRuns(damaged, at(10_000)), label).toBe(true);
        expect(accountStatus([damaged], null, at(1)), label).toBe('banned');
        expect(standingOf(acct(), [damaged], at(1)), label).toMatchObject({ status: 'banned', ranked: false, listed: false, chat: false, until: null });
      }
      // the same for a suspension, a mute and an unlist; a damaged until reads as permanent in Standing.until
      expect(accountStatus([{ ...span('suspend', 0, 30), endedAt: bad }], null, at(1))).toBe('suspended');
      expect(standingOf(acct(), [{ ...span('suspend', 0, 30), until: bad }], at(40))).toMatchObject({ status: 'suspended', until: null });
      expect(standingOf(acct(), [span('suspend', 0, 30), { ...span('suspend', 0, 60), until: bad }], at(1))).toMatchObject({ until: null });
      expect(standingOf(acct(), [{ ...span('mute', 0, 30), endedAt: bad }], at(1))).toMatchObject({ status: 'active', chat: false, until: at(30) });
      expect(standingOf(acct(), [{ ...span('unlist', 0, 30), until: bad }], at(40))).toMatchObject({ listed: false, until: null });
    }
    // a valid endedAt still ends it
    expect(accountStatus([span('ban', 0, null, 3)], null, at(4))).toBe('active');
  });
});

describe('M14-1: standingOf for each sanction kind (9.3)', () => {
  it('no sanction: active, ranked, listed, chat, no until; createdAt and the id copied', () => {
    expect(standingOf(acct(), [], at(1))).toEqual({
      account: ID, status: 'active', ranked: true, listed: true, chat: true, until: null, createdAt: '2026-01-02T03:04:05.000Z',
    });
  });

  it('warn and rename change nothing', () => {
    for (const k of ['warn', 'rename'] as const) {
      expect(standingOf(acct(), [span(k, 0, null)], at(1))).toMatchObject({ status: 'active', ranked: true, listed: true, chat: true, until: null });
    }
  });

  it('mute: no chat until it ends', () => {
    expect(standingOf(acct(), [span('mute', 0, 30)], at(1))).toMatchObject({ status: 'active', ranked: true, listed: true, chat: false, until: at(30) });
    expect(standingOf(acct(), [span('mute', 0, 30)], at(30))).toMatchObject({ chat: true, until: null });
  });

  it('unlist: not listed, still ranked; permanent or until a time', () => {
    expect(standingOf(acct(), [span('unlist', 0, null)], at(1))).toMatchObject({ status: 'active', ranked: true, listed: false, chat: true, until: null });
    expect(standingOf(acct(), [span('unlist', 0, 40)], at(1))).toMatchObject({ listed: false, until: at(40) });
    // the latest end of the limits that run; a permanent one makes it null
    expect(standingOf(acct(), [span('unlist', 0, 40), span('mute', 0, 50)], at(1))).toMatchObject({ listed: false, chat: false, until: at(50) });
    expect(standingOf(acct(), [span('unlist', 0, null), span('mute', 0, 50)], at(1))).toMatchObject({ until: null });
  });

  it('suspend: nothing allowed, until its end', () => {
    expect(standingOf(acct(), [span('suspend', 0, 30)], at(1))).toMatchObject({
      status: 'suspended', ranked: false, listed: false, chat: false, until: at(30),
    });
    expect(standingOf(acct(), [span('suspend', 0, 30), span('suspend', 5, 60)], at(10))).toMatchObject({ until: at(60) });
  });

  it('ban: nothing allowed; permanent (until null) or until its end', () => {
    expect(standingOf(acct(), [span('ban', 0, null)], at(1))).toMatchObject({ status: 'banned', ranked: false, listed: false, chat: false, until: null });
    expect(standingOf(acct(), [span('ban', 0, 90)], at(1))).toMatchObject({ status: 'banned', until: at(90) });
  });

  it('a ban and a longer suspension: until is when the account is active again, not the ban\'s end (finding 5)', () => {
    const both = [span('ban', 0, 90), span('suspend', 0, 200)];
    expect(standingOf(acct(), both, at(1))).toMatchObject({ status: 'banned', ranked: false, until: at(200) });
    expect(standingOf(acct(), both, at(91))).toMatchObject({ status: 'suspended', ranked: false, until: at(200) });
    expect(standingOf(acct(), both, at(200))).toMatchObject({ status: 'active', ranked: true, until: null });
    // a permanent ban over a suspension, and a permanent suspension's data under a timed ban: null (permanent)
    expect(standingOf(acct(), [span('ban', 0, null), span('suspend', 0, 30)], at(1))).toMatchObject({ status: 'banned', until: null });
    expect(standingOf(acct(), [span('ban', 0, 30), span('suspend', 0, null)], at(1))).toMatchObject({ status: 'banned', until: null });
    // a suspension that ends first: the ban's end
    expect(standingOf(acct(), [span('ban', 0, 90), span('suspend', 0, 30)], at(1))).toMatchObject({ status: 'banned', until: at(90) });
    // mutes and unlists do not count for a banned or suspended account's until; they show once it is active again
    expect(standingOf(acct(), [span('suspend', 0, 30), span('mute', 0, 60)], at(1))).toMatchObject({ status: 'suspended', until: at(30) });
    expect(standingOf(acct(), [span('suspend', 0, 30), span('mute', 0, 60)], at(30))).toMatchObject({ status: 'active', chat: false, until: at(60) });
  });

  it('deleting: nothing allowed, no until (a deletion is not a sanction)', () => {
    expect(standingOf(acct(deletion(0)), [], at(1))).toMatchObject({ status: 'deleting', ranked: false, listed: false, chat: false, until: null });
    expect(standingOf(acct(deletion(0)), [span('suspend', 0, 30)], at(1))).toMatchObject({ status: 'deleting', until: null });
  });

  it('ended sanctions limit nothing', () => {
    expect(standingOf(acct(), [span('ban', 0, null, 1), span('mute', 0, 30, 1), span('unlist', 0, null, 1)], at(2))).toMatchObject({
      status: 'active', ranked: true, listed: true, chat: true, until: null,
    });
  });
});

describe('M14-1: oldEnough (7.5)', () => {
  const birth = { year: 2013, month: 5 };
  it('13 years in the birth month refused, the month after accepted', () => {
    expect(oldEnough(birth, 13, '2026-04-30')).toBe(false);
    expect(oldEnough(birth, 13, '2026-05-01')).toBe(false);
    expect(oldEnough(birth, 13, '2026-05-31')).toBe(false);
    expect(oldEnough(birth, 13, '2026-06-01')).toBe(true);
    expect(oldEnough(birth, 13, '2030-01-15')).toBe(true);
    expect(oldEnough(birth, 13, '2026-06-01T00:00:00.000Z')).toBe(true);
    expect(oldEnough(birth, 13, '2026-05-31T23:59:59.999Z')).toBe(false);
  });

  it('across a year end, and with another minimum', () => {
    expect(oldEnough({ year: 2012, month: 12 }, 13, '2025-12-31')).toBe(false);
    expect(oldEnough({ year: 2012, month: 12 }, 13, '2026-01-01')).toBe(true);
    expect(oldEnough({ year: 2010, month: 1 }, 16, '2026-01-31')).toBe(false);
    expect(oldEnough({ year: 2010, month: 1 }, 16, '2026-02-01')).toBe(true);
    expect(oldEnough({ year: 2027, month: 1 }, 13, '2026-10-21')).toBe(false);
  });

  it('a malformed birth, age or date answers false, never throws', () => {
    const bad: [unknown, unknown, unknown][] = [
      [{ year: 2000, month: 0 }, 13, '2026-10-21'], [{ year: 2000, month: 13 }, 13, '2026-10-21'], [{ year: 2000.5, month: 1 }, 13, '2026-10-21'],
      [{ year: '2000', month: 1 }, 13, '2026-10-21'], [{ year: 2000, month: 1.5 }, 13, '2026-10-21'], [null, 13, '2026-10-21'], ['2000-01', 13, '2026-10-21'],
      [{ year: 2000, month: 1 }, -1, '2026-10-21'], [{ year: 2000, month: 1 }, Number.NaN, '2026-10-21'], [{ year: 2000, month: 1 }, 13, 'yesterday'],
      [{ year: 2000, month: 1 }, 13, '2026-13-01'], [{ year: 2000, month: 1 }, 13, ''], [{ year: 2000, month: 1 }, 13, null],
      [{ year: Number.POSITIVE_INFINITY, month: 1 }, 13, '2026-10-21'],
    ];
    for (const [b, m, t] of bad) {
      expect(oldEnough(b as { year: number; month: number }, m as number, t as string), JSON.stringify([b, m, t])).toBe(false);
    }
  });
});

describe('M14-1: names of the environment variables', () => {
  it('accountsEnvName: camelCase to ACCOUNTS_SCREAMING_SNAKE_CASE', () => {
    expect(accountsEnvName('registerPerHour')).toBe('ACCOUNTS_REGISTER_PER_HOUR');
    expect(accountsEnvName('sessionIdleMs')).toBe('ACCOUNTS_SESSION_IDLE_MS');
    expect(accountsEnvName('prefix56Factor')).toBe('ACCOUNTS_PREFIX56_FACTOR');
    expect(accountsEnvName('backoffAfter48')).toBe('ACCOUNTS_BACKOFF_AFTER48');
  });

  it('every limit and timing key gives a distinct name', () => {
    const names = [...Object.keys(ACCOUNT_RATE_LIMITS), ...Object.keys(ACCOUNT_TIMING)].map(accountsEnvName);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^ACCOUNTS_[A-Z0-9_]+$/);
  });
});

describe('M14-1: constants other packages read', () => {
  it('the deleted player, privacy defaults, report reasons, limits', () => {
    expect(DELETED_PLAYER_NAME).toBe('Deleted player');
    expect(DEFAULT_PRIVACY).toEqual({ history: 'private', leaderboards: true, guestsAtMyTables: true });
    expect(Object.isFrozen(DEFAULT_PRIVACY)).toBe(true);
    expect(REPORT_REASONS).toEqual(['name', 'chat', 'title', 'cheating', 'collusion', 'stalling', 'smurf', 'harassment', 'spam', 'other']);
    expect(ACCOUNT_LIMITS).toMatchObject({ nameMin: 3, nameMax: 20, passwordMin: 12, passwordMax: 128, recoveryCodes: 10, minAge: 13, sessionsMax: 20 });
    expect(ACCOUNT_TIMING).toMatchObject({ sessionIdleMs: 30 * 86_400_000, sessionMaxMs: 180 * 86_400_000, rotateAfterMs: 86_400_000, rotateGraceMs: 120_000 });
    expect(ACCOUNT_RATE_LIMITS).toMatchObject({ registerPerHour: 3, signInPerMinute: 10, backoffAfter: 5, workBaseBits: 16, workMaxBits: 22, counterEntries: 100_000 });
  });
});
