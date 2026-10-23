/**
 * M14-1: the named copy of m13's text rules and store rules (src/text.ts, design 11.8), on fixed lists taken from m13's own tests. At the sync, M14-10
 * pins the copy against the original itself; this keeps the copy honest until then.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_COMBINING_MARKS, STORE_ID, codePoints, collapseWhitespace, hostedTextProblem, invisibleTextProblem, isBidiControl, isControlChar, jsonbProblem,
  textProblem,
} from '@openmtg/accounts';

const BIDI = [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];

describe('M14-1: hostedTextProblem (copied)', () => {
  it('NUL, unpaired surrogates, bidi and control characters are refused; ordinary text passes', () => {
    expect(hostedTextProblem('abc\u0000')).toBe('nul');
    for (const s of ['a\ud800b', 'a\udc00b', '\udc00\ud800', 'abc\udbff']) expect(hostedTextProblem(s), JSON.stringify(s)).toBe('surrogate');
    for (const c of BIDI) {
      expect(hostedTextProblem(`ab${String.fromCharCode(c)}cd`)).toBe('bidi');
      expect(isBidiControl(c)).toBe(true);
    }
    for (const c of [0x01, 0x09, 0x0a, 0x1b, 0x7f, 0x85, 0x9f, 0x2028, 0x2029]) {
      expect(hostedTextProblem(`x${String.fromCharCode(c)}`), c.toString(16)).toBe('control');
      expect(isControlChar(c)).toBe(true);
    }
    for (const s of ['', 'Alice', "Urza's Saga", 'Лилиана', '日本語のテーブル', '🐉', 'a b c']) expect(hostedTextProblem(s), s).toBeNull();
  });

  it('refuses exactly net\'s control set plus three bidi marks over the Basic Multilingual Plane', () => {
    let refused = 0;
    for (let c = 0; c <= 0xffff; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue;
      if (hostedTextProblem(String.fromCharCode(c))) refused++;
    }
    expect(refused).toBe(32 + 33 + 7 + 4 + 3);
  });

  it('helpers', () => {
    expect(collapseWhitespace('\t a   b 　')).toBe('a b');
    expect(codePoints('a🐉b')).toBe(3);
  });
});

describe('M14-1: invisibleTextProblem (copied)', () => {
  it('refuses ignorable, private and unassigned code points and text with nothing visible', () => {
    for (const c of [0x00ad, 0x034f, 0x115f, 0x200b, 0x2060, 0x3164, 0xfeff, 0xffa0, 0xe0001, 0xe000, 0x0378, 0xfff9, 0x2800]) {
      expect(invisibleTextProblem(`Al${String.fromCodePoint(c)}ice`), c.toString(16)).toBe('invisible');
    }
    for (const s of ['ㅤ', '⠀⠀', '́́', '‍']) expect(invisibleTextProblem(s), JSON.stringify(s)).toBe('invisible');
  });

  it('joiners only between visible characters, presentation selectors only after a base', () => {
    for (const s of ['\u{1F468}‍\u{1F469}‍\u{1F467}', '❤️', 'می‌خواهم', '❤️‍\u{1F525}', 'Alice']) {
      expect(invisibleTextProblem(s), JSON.stringify(s)).toBeNull();
    }
    for (const s of ['‍Alice', 'Alice‍', 'Al‍‍ice', '️Alice', '❤︎‍\u{1F525}']) expect(invisibleTextProblem(s), JSON.stringify(s)).toBe('invisible');
  });

  it(`at most ${MAX_COMBINING_MARKS} combining marks in a row`, () => {
    expect(MAX_COMBINING_MARKS).toBe(2);
    expect(invisibleTextProblem('Nẽ́')).toBeNull();
    expect(invisibleTextProblem('Zé̂̃lgo')).toBe('invisible');
  });
});

describe('M14-1: the store rules (copied)', () => {
  it('STORE_ID: 1-64 characters of [0-9A-Za-z_-]', () => {
    for (const s of ['a', 'acc_01ARYZ6S41TSV4RRFFQ69G5FAV', 'x'.repeat(64), 'A-b_9']) expect(STORE_ID.test(s), s).toBe(true);
    for (const s of ['', 'x'.repeat(65), 'a b', 'a/b', 'a.b', '..', 'é']) expect(STORE_ID.test(s), s).toBe(false);
  });

  it('textProblem and jsonbProblem: NUL and unpaired surrogates, in values and keys, at their path', () => {
    expect(textProblem('ok')).toBeNull();
    expect(textProblem('a\u0000')).toBe('nul');
    expect(textProblem('a\ud800')).toBe('surrogate');
    expect(textProblem('a\u0007‮')).toBeNull();
    expect(jsonbProblem({ a: ['x', { b: 'y\u0000' }] })).toBe('$.a[1].b: a NUL character');
    expect(jsonbProblem({ ['k\udc00']: 1 })).toBe('$: a key with an unpaired surrogate');
    expect(jsonbProblem({ a: 1, b: null, c: [true, 2.5], d: new Date(0), e: new Uint8Array([0]) })).toBeNull();
  });
});
