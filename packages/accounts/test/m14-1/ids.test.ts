/**
 * M14-1: ids, tokens and codes (design 11.1, 11.4, D22): the patterns on fixed good and bad lists; account and deleted-player ids are 128 random bits
 * with no time part (1,000 made under one fixed clock spread their first character over all 8 values and share no 10-character prefix); ULIDs for
 * the ids only the account or the operator sees; tokens and their hashes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_ID, ACCOUNT_TOKEN, AUDIT_ID, CONFIRM_CODE, DELETED_PLAYER_ID, EMAIL_CODE_ID, FLOW_ID, REPORT_ID, SANCTION_ID, SESSION_ID, STORE_ID, ULID,
  WORK_ANSWER, isAccountId, isAccountToken, isDeletedPlayerId, newAccountId, newAuditId, newDeletedPlayerId, newEmailCodeId, newFlowId, newReportId,
  newSanctionId, newSessionId, newToken, newUlid, tokenHash,
} from '@openmtg/accounts';
import { constantRandom, fixedRandom } from './support';

const GOOD_ULIDS = ['00000000000000000000000000', '7ZZZZZZZZZZZZZZZZZZZZZZZZZ', '01ARYZ6S41TSV4RRFFQ69G5FAV', '3HJKMNPQRSTVWXYZ0123456789'];
const BAD_ULIDS = [
  '', '8ZZZZZZZZZZZZZZZZZZZZZZZZZ', '01ARYZ6S41TSV4RRFFQ69G5FA', '01ARYZ6S41TSV4RRFFQ69G5FAVX', '01arYZ6S41TSV4RRFFQ69G5FAV', '01ARYZ6S41TSV4RRFFQ69G5FAI',
  '01ARYZ6S41TSV4RRFFQ69G5FAL', '01ARYZ6S41TSV4RRFFQ69G5FAO', '01ARYZ6S41TSV4RRFFQ69G5FAU', '01ARYZ6S41TSV4RRFFQ69G5FA-', ' 1ARYZ6S41TSV4RRFFQ69G5FAV',
  '01ARYZ6S41TSV4RRFFQ69G5FAV\n',
];

describe('M14-1: id patterns on fixed lists', () => {
  it('ULID: 26 Crockford base32 characters, the first 0-7', () => {
    for (const s of GOOD_ULIDS) expect(ULID.test(s), s).toBe(true);
    for (const s of BAD_ULIDS) expect(ULID.test(s), JSON.stringify(s)).toBe(false);
  });

  it('account and deleted-player ids', () => {
    for (const s of GOOD_ULIDS) {
      expect(isAccountId(`acc_${s}`)).toBe(true);
      expect(ACCOUNT_ID.test(`acc_${s}`)).toBe(true);
      expect(isDeletedPlayerId(`del_${s}`)).toBe(true);
      expect(DELETED_PLAYER_ID.test(`del_${s}`)).toBe(true);
      expect(isAccountId(`del_${s}`)).toBe(false);
      expect(isDeletedPlayerId(`acc_${s}`)).toBe(false);
      expect(STORE_ID.test(`acc_${s}`)).toBe(true);
    }
    for (const s of BAD_ULIDS) {
      expect(isAccountId(`acc_${s}`), JSON.stringify(s)).toBe(false);
      expect(isDeletedPlayerId(`del_${s}`), JSON.stringify(s)).toBe(false);
    }
    for (const x of [undefined, null, 42, {}, ['acc_01ARYZ6S41TSV4RRFFQ69G5FAV'], 'ACC_01ARYZ6S41TSV4RRFFQ69G5FAV', 'acc01ARYZ6S41TSV4RRFFQ69G5FAV']) {
      expect(isAccountId(x), JSON.stringify(x)).toBe(false);
      expect(isDeletedPlayerId(x), JSON.stringify(x)).toBe(false);
    }
  });

  it('the server-side id patterns', () => {
    const cases: [RegExp, string][] = [[SESSION_ID, 'as_'], [REPORT_ID, 'rep_'], [SANCTION_ID, 'san_'], [AUDIT_ID, 'aud_'], [EMAIL_CODE_ID, 'ec_'], [FLOW_ID, 'pf_']];
    for (const [re, prefix] of cases) {
      for (const s of GOOD_ULIDS) {
        expect(re.test(prefix + s), prefix + s).toBe(true);
        expect(STORE_ID.test(prefix + s)).toBe(true);
      }
      for (const s of BAD_ULIDS) expect(re.test(prefix + s), prefix + JSON.stringify(s)).toBe(false);
      expect(re.test(`acc_${GOOD_ULIDS[2]}`)).toBe(false);
    }
  });

  it('tokens: 64 lowercase hex digits', () => {
    const good = ['0'.repeat(64), 'f'.repeat(64), '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'];
    const bad = ['', '0'.repeat(63), '0'.repeat(65), 'F'.repeat(64), 'g'.repeat(64), ` ${'0'.repeat(63)}`, `${'0'.repeat(64)}\n`, '0x' + '0'.repeat(62)];
    for (const s of good) {
      expect(isAccountToken(s)).toBe(true);
      expect(ACCOUNT_TOKEN.test(s)).toBe(true);
    }
    for (const s of bad) expect(isAccountToken(s), JSON.stringify(s)).toBe(false);
    for (const x of [undefined, null, 0, { length: 64 }]) expect(isAccountToken(x)).toBe(false);
  });

  it('confirmation codes and work answers', () => {
    for (const s of ['0123ABCD', 'ZZZZZZZZ', 'HJKMNPQR']) expect(CONFIRM_CODE.test(s), s).toBe(true);
    for (const s of ['0123ABC', '0123ABCDE', '0123abcd', '0123ABCI', '0123ABCL', '0123ABCO', '0123ABCU', '0123-ABC']) expect(CONFIRM_CODE.test(s), s).toBe(false);
    for (const s of ['v1_abc-DEF9:0', `${'a'.repeat(400)}:1234567890123456`, 'x:1']) expect(WORK_ANSWER.test(s), s).toBe(true);
    for (const s of ['', ':1', 'abc:', 'abc', 'a.b:1', `${'a'.repeat(401)}:1`, 'abc:12345678901234567', 'abc:1a', 'abc:-1', 'a b:1']) {
      expect(WORK_ANSWER.test(s), s).toBe(false);
    }
  });
});

describe('M14-1: random ids (D22)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('newAccountId and newDeletedPlayerId take no clock: only the random source', () => {
    expect(newAccountId.length).toBe(1);
    expect(newDeletedPlayerId.length).toBe(1);
    expect(newFlowId.length).toBe(1);
  });

  it('encode 128 bits: all zero, all one, and a fixed pattern', () => {
    expect(newAccountId(constantRandom(0))).toBe('acc_00000000000000000000000000');
    expect(newAccountId(constantRandom(0xff))).toBe('acc_7ZZZZZZZZZZZZZZZZZZZZZZZZZ');
    expect(newDeletedPlayerId(constantRandom(0xff))).toBe('del_7ZZZZZZZZZZZZZZZZZZZZZZZZZ');
    expect(newFlowId(constantRandom(0))).toBe('pf_00000000000000000000000000');
    // 0x01 then fifteen 0x00 bytes is 2^120 = 32^24: a 1 in the second of the 26 characters
    const one = (n: number) => {
      const b = new Uint8Array(n);
      b[0] = 0x01;
      return b;
    };
    expect(newAccountId(one)).toBe(`acc_01${'0'.repeat(24)}`);
    expect(isAccountId(newAccountId(fixedRandom('x')))).toBe(true);
  });

  it('1,000 ids made under one fixed clock: the first character takes all 8 values, and 1,000 distinct 10-character prefixes', () => {
    vi.useFakeTimers({ now: new Date('2026-10-21T12:00:00.000Z') });
    for (const make of [newAccountId, newDeletedPlayerId] as const) {
      const random = fixedRandom(`ids-${make.name}`);
      const ids = Array.from({ length: 1_000 }, () => make(random));
      expect(Date.now()).toBe(Date.parse('2026-10-21T12:00:00.000Z'));
      const body = ids.map((id) => id.slice(4));
      expect(new Set(ids).size).toBe(1_000);
      expect(new Set(body.map((b) => b[0])).size).toBe(8);
      expect(new Set(body.map((b) => b.slice(0, 10))).size).toBe(1_000);
      for (const id of ids) expect(make === newAccountId ? isAccountId(id) : isDeletedPlayerId(id), id).toBe(true);
    }
  });

  it('refuses a random source that gives too few bytes', () => {
    expect(() => newAccountId(() => new Uint8Array(15))).toThrow(RangeError);
    expect(() => newToken(() => new Uint8Array(31))).toThrow(RangeError);
  });
});

describe('M14-1: ULIDs for the ids only the account or the operator sees', () => {
  it('48 bits of time, then 80 random bits; the spec example time encodes to 01ARYZ6S41', () => {
    const r = fixedRandom('ulid');
    expect(newUlid(new Date(1469918176385), r).slice(0, 10)).toBe('01ARYZ6S41');
    expect(newUlid(new Date(0), constantRandom(0))).toBe('0'.repeat(26));
    expect(newUlid(new Date(2 ** 48 - 1), constantRandom(0xff))).toBe('7'.padEnd(26, 'Z'));
    expect(() => newUlid(new Date(2 ** 48), r)).toThrow(RangeError);
    expect(() => newUlid(new Date(-1), r)).toThrow(RangeError);
    expect(() => newUlid(new Date(Number.NaN), r)).toThrow(RangeError);
  });

  it('ids made in one millisecond share the time prefix and differ after it; later ones sort after earlier ones', () => {
    const r = fixedRandom('same-ms');
    const now = new Date('2026-10-21T12:00:00.000Z');
    const a = newUlid(now, r), b = newUlid(now, r);
    expect(a.slice(0, 10)).toBe(b.slice(0, 10));
    expect(a).not.toBe(b);
    const later = newUlid(new Date(now.getTime() + 1), r);
    expect(later.slice(0, 10) > a.slice(0, 10)).toBe(true);
  });

  it('each id kind has its prefix and matches its pattern', () => {
    const r = fixedRandom('kinds');
    const now = new Date('2026-10-21T12:00:00.000Z');
    const cases: [string, RegExp][] = [
      [newSessionId(now, r), SESSION_ID], [newReportId(now, r), REPORT_ID], [newSanctionId(now, r), SANCTION_ID], [newAuditId(now, r), AUDIT_ID],
      [newEmailCodeId(now, r), EMAIL_CODE_ID], [newFlowId(r), FLOW_ID],
    ];
    for (const [id, re] of cases) {
      expect(re.test(id), id).toBe(true);
      expect(STORE_ID.test(id), id).toBe(true);
    }
  });
});

describe('M14-1: tokens', () => {
  it('newToken: 32 random bytes as 64 lowercase hex digits', () => {
    expect(newToken(constantRandom(0xab))).toBe('ab'.repeat(32));
    const r = fixedRandom('tokens');
    const tokens = Array.from({ length: 20 }, () => newToken(r));
    for (const t of tokens) expect(isAccountToken(t)).toBe(true);
    expect(new Set(tokens).size).toBe(20);
  });

  it('tokenHash: SHA-256 of the text, hex (the standard test vector)', () => {
    expect(tokenHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const t = newToken(fixedRandom('hash'));
    expect(isAccountToken(tokenHash(t))).toBe(true);
    expect(tokenHash(t)).not.toBe(t);
  });
});
