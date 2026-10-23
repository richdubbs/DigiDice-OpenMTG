/**
 * M15-1: the ladder's ids (design 2 "Ids", 8.7, 9.6, 11.2). Match and report ids are ULIDs whose time part is the given time; a deleted season
 * record's sort key is "deleted:" and 128 random bits with no time part, so keys made at the same moment share nothing but the prefix; every
 * generator reads only the random source it is given (fixed sources here), and checks it.
 */
import { describe, expect, it } from 'vitest';
import {
  DELETED_SORT_KEY, DELETED_SORT_KEY_PREFIX, isDeletedSortKey, isUlid, newDeletedSortKey, newMatchId, newReportId, newUlid, ULID,
} from '@openmtg/ladder';
import { constantRandom, fixedRandom } from '../support/random';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** The time of a ULID's first 10 characters. */
function ulidTime(id: string): number {
  return [...id.slice(0, 10)].reduce((n, c) => n * 32 + CROCKFORD.indexOf(c), 0);
}

const T = Date.parse('2026-10-15T12:00:00.000Z');

describe('M15-1: ULIDs (match and report ids)', () => {
  it('26 characters in the ULID shape, the time part being the given ms', () => {
    for (const make of [newUlid, newMatchId, newReportId]) {
      const id = make(T, fixedRandom('ulid'));
      expect(id).toMatch(ULID);
      expect(isUlid(id)).toBe(true);
      expect(id).toHaveLength(26);
      expect(ulidTime(id)).toBe(T);
    }
    expect(newUlid(0, constantRandom(0))).toBe('0'.repeat(26));
    expect(newUlid(2 ** 48 - 1, constantRandom(255))).toBe('7ZZZZZZZZZZZZZZZZZZZZZZZZZ');
  });

  it('the same time and random source give the same id; later times sort later', () => {
    expect(newMatchId(T, fixedRandom('a'))).toBe(newMatchId(T, fixedRandom('a')));
    expect(newMatchId(T, fixedRandom('a'))).not.toBe(newMatchId(T, fixedRandom('b')));
    const ids = [T, T + 1, T + 60_000, T + 86_400_000].map((t) => newReportId(t, constantRandom(255)));
    expect([...ids].sort()).toEqual(ids);
  });

  it('meets m13\'s store id rule (1-64 characters of [0-9A-Za-z_-])', () => {
    expect(newMatchId(T, fixedRandom('m'))).toMatch(/^[0-9A-Za-z_-]{1,64}$/);
  });

  it('works with the default source (node:crypto)', () => {
    const a = newUlid(T);
    const b = newUlid(T);
    expect(a).toMatch(ULID);
    expect(a.slice(0, 10)).toBe(b.slice(0, 10));
  });

  it('refuses a time outside a ULID and a source that gives too few bytes', () => {
    for (const t of [-1, 2 ** 48, 1.5, Number.NaN]) expect(() => newUlid(t, constantRandom(0)), String(t)).toThrow(RangeError);
    expect(() => newUlid(T, () => new Uint8Array(9))).toThrow(RangeError);
    expect(() => newDeletedSortKey(() => new Uint8Array(15))).toThrow(RangeError);
  });
});

describe('M15-1: deleted season records\' sort keys (8.7)', () => {
  it('"deleted:" and 26 characters of 128 random bits', () => {
    const k = newDeletedSortKey(fixedRandom('d'));
    expect(k.startsWith(DELETED_SORT_KEY_PREFIX)).toBe(true);
    expect(k).toMatch(DELETED_SORT_KEY);
    expect(isDeletedSortKey(k)).toBe(true);
    expect(k.slice(DELETED_SORT_KEY_PREFIX.length)).toMatch(ULID);
    expect(newDeletedSortKey(constantRandom(0))).toBe(`deleted:${'0'.repeat(26)}`);
    expect(newDeletedSortKey(constantRandom(255))).toBe('deleted:7ZZZZZZZZZZZZZZZZZZZZZZZZZ');
  });

  it('take no time: keys of one erasure share no prefix beyond chance, and come only from the random bits', () => {
    expect(newDeletedSortKey.length).toBeLessThanOrEqual(1);
    const random = fixedRandom('erasure');
    const keys = Array.from({ length: 8 }, () => newDeletedSortKey(random));
    expect(new Set(keys).size).toBe(8);
    // with fixed bits the key is fixed, whenever it is made: nothing of the clock is in it
    expect(newDeletedSortKey(fixedRandom('x'))).toBe(newDeletedSortKey(fixedRandom('x')));
    const firstFour = new Set(keys.map((k) => k.slice(8, 12)));
    expect(firstFour.size).toBe(8);
  });

  it('never parses as an account id or a ULID, and the checks refuse other shapes', () => {
    const k = newDeletedSortKey(fixedRandom('d'));
    expect(isUlid(k)).toBe(false);
    expect(/^acc_/.test(k)).toBe(false);
    for (const x of [null, 3, 'deleted:', `deleted:${'0'.repeat(25)}`, `deleted:8${'0'.repeat(25)}`, `Deleted:${'0'.repeat(26)}`]) {
      expect(isDeletedSortKey(x), String(x)).toBe(false);
    }
    for (const x of [null, 3, '0'.repeat(25), `8${'0'.repeat(25)}`, `${'0'.repeat(25)}I`, `${'0'.repeat(25)}u`]) expect(isUlid(x), String(x)).toBe(false);
  });
});
