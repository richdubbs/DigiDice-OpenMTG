/**
 * The hosted text rules (design 6.1 step 1, 3.2, 4.2, 4.3; review 2): NUL, unpaired surrogates, bidi and control characters are refused in every string
 * a browser sends; names, titles, passwords and chat have their lengths. A fixed list of crafted inputs (no randomized fuzzing: owner rule), plus an
 * exhaustive pass over the Basic Multilingual Plane against milestone 9's control set.
 */
import { describe, expect, it } from 'vitest';
import { hasControl } from '@openmtg/net/server-kit';
import {
  actionTextProblem, checkChat, checkName, checkPassword, checkTitle, codePoints, collapseWhitespace, defaultTitle, HOSTED_LIMITS, hostedTextProblem,
  invisibleTextProblem, isBidiControl, MAX_COMBINING_MARKS,
} from '@openmtg/hosted/api';

const BIDI = [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];

describe('M13-1: hostedTextProblem', () => {
  it('refuses NUL anywhere', () => {
    expect(hostedTextProblem('\u0000')).toBe('nul');
    expect(hostedTextProblem('abc\u0000')).toBe('nul');
    expect(hostedTextProblem('\u0000abc')).toBe('nul');
  });

  it('refuses unpaired surrogates (lone high, lone low, reversed, high at the end) and accepts pairs', () => {
    expect(hostedTextProblem('a\ud800b')).toBe('surrogate');
    expect(hostedTextProblem('a\udc00b')).toBe('surrogate');
    expect(hostedTextProblem('\udc00\ud800')).toBe('surrogate');
    expect(hostedTextProblem('abc\udbff')).toBe('surrogate');
    expect(hostedTextProblem('\ud83d🐉')).toBe('surrogate');
    expect(hostedTextProblem('🐉')).toBeNull(); // 🐉
    expect(hostedTextProblem('Jötun Grunt 🐉 Æther')).toBeNull();
  });

  it('refuses every bidi control', () => {
    for (const c of BIDI) {
      expect(hostedTextProblem(`ab${String.fromCharCode(c)}cd`), c.toString(16)).toBe('bidi');
      expect(isBidiControl(c)).toBe(true);
    }
    // the classic "Trojan Source" reordering
    expect(hostedTextProblem('admin‮⁦gnp.exe⁩')).toBe('bidi');
  });

  it("refuses milestone 9's control set: C0, DEL, C1, line and paragraph separators", () => {
    for (const c of [0x01, 0x07, 0x08, 0x09, 0x0a, 0x0d, 0x1b, 0x1f, 0x7f, 0x80, 0x85, 0x9b, 0x9f, 0x2028, 0x2029]) {
      expect(hostedTextProblem(`x${String.fromCharCode(c)}`), c.toString(16)).toBe('control');
    }
    expect(hostedTextProblem('\u001b[2J\u001b]52;c;payload\u0007')).toBe('control');
  });

  it('accepts ordinary text', () => {
    for (const s of ['', 'Alice', 'Llanowar Elves', "Urza's Saga", 'Лилиана', '日本語のテーブル', 'ﺍﻟﻌﺮﺑﻴﺔ', 'a b c', 'x+y=z <>&"\'']) {
      expect(hostedTextProblem(s), s).toBeNull();
    }
  });

  it('refuses at least everything net refuses (every BMP character outside the surrogate block)', () => {
    let refused = 0;
    for (let c = 0; c <= 0xffff; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue;
      const s = String.fromCharCode(c);
      const p = hostedTextProblem(s);
      if (hasControl(s)) expect(p, c.toString(16)).not.toBeNull();
      if (p) refused++;
    }
    // exactly net's set (0x00-0x1f, 0x7f-0x9f, 0x2028-0x202e, 0x2066-0x2069) plus U+061C, U+200E, U+200F
    expect(refused).toBe(32 + 33 + 7 + 4 + 3);
  });
});

describe('M13-1: names, titles, passwords, chat', () => {
  it('names: 1-40 characters after whitespace is collapsed', () => {
    expect(checkName('  Alice   the  Bold ')).toEqual({ ok: true, value: 'Alice the Bold' });
    expect(checkName('A')).toMatchObject({ ok: true, value: 'A' });
    expect(checkName('x'.repeat(40))).toMatchObject({ ok: true });
    expect(checkName('x'.repeat(41))).toMatchObject({ ok: false, reason: 'long' });
    expect(checkName('🐉'.repeat(40))).toMatchObject({ ok: true }); // 40 characters, 80 UTF-16 units
    expect(checkName('   ')).toMatchObject({ ok: false, reason: 'short' });
    expect(checkName('')).toMatchObject({ ok: false, reason: 'short' });
    expect(checkName(42)).toMatchObject({ ok: false, reason: 'type' });
    expect(checkName('Al\u0000ice')).toMatchObject({ ok: false, reason: 'nul' });
    expect(checkName('Al‮ice')).toMatchObject({ ok: false, reason: 'bidi' });
    expect(checkName('Al\ud800ice')).toMatchObject({ ok: false, reason: 'surrogate' });
    expect(checkName('Al\nice')).toMatchObject({ ok: false, reason: 'control' });
    expect(checkName('x'.repeat(100_000))).toMatchObject({ ok: false, reason: 'long' });
  });

  it('titles: 3-60 characters, whitespace collapsed; the default title fits for every valid name', () => {
    expect(checkTitle(' Friday   night Commander ')).toEqual({ ok: true, value: 'Friday night Commander' });
    expect(checkTitle('ab')).toMatchObject({ ok: false, reason: 'short' });
    expect(checkTitle('abc')).toMatchObject({ ok: true });
    expect(checkTitle('t'.repeat(60))).toMatchObject({ ok: true });
    expect(checkTitle('t'.repeat(61))).toMatchObject({ ok: false, reason: 'long' });
    expect(checkTitle('No ⁦bidi⁩ please')).toMatchObject({ ok: false, reason: 'bidi' });
    expect(checkTitle(null)).toMatchObject({ ok: false, reason: 'type' });
    for (const n of ['A', 'x'.repeat(HOSTED_LIMITS.nameMax), '🐉'.repeat(HOSTED_LIMITS.nameMax)]) expect(checkTitle(defaultTitle(n)).ok).toBe(true);
  });

  it('passwords: 4-64 characters, exactly as typed (no trimming), the text rules', () => {
    expect(checkPassword(' pa ss ')).toEqual({ ok: true, value: ' pa ss ' });
    expect(checkPassword('abc')).toMatchObject({ ok: false, reason: 'short' });
    expect(checkPassword('p'.repeat(64))).toMatchObject({ ok: true });
    expect(checkPassword('p'.repeat(65))).toMatchObject({ ok: false, reason: 'long' });
    expect(checkPassword('pass\u0000word')).toMatchObject({ ok: false, reason: 'nul' });
    expect(checkPassword(['x'])).toMatchObject({ ok: false, reason: 'type' });
  });

  it('chat: at most 500 characters, not empty, no line breaks', () => {
    expect(checkChat(' gg ')).toEqual({ ok: true, value: 'gg' });
    expect(checkChat('c'.repeat(500))).toMatchObject({ ok: true });
    expect(checkChat('c'.repeat(501))).toMatchObject({ ok: false, reason: 'long' });
    expect(checkChat('  ')).toMatchObject({ ok: false, reason: 'short' });
    expect(checkChat('line\nbreak')).toMatchObject({ ok: false, reason: 'control' });
  });

  it('helpers', () => {
    expect(collapseWhitespace('\t a   b 　')).toBe('a b');
    expect(codePoints('a🐉b')).toBe(3);
  });
});

describe('M13-1: the visible-text rule of names and titles (M13-1 review)', () => {
  const cp = (n: number) => String.fromCodePoint(n);
  const IGNORABLE = [
    0x00ad, 0x034f, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180b, 0x180e, 0x180f, 0x200b, 0x2060, 0x2061, 0x2064, 0x206a, 0x206f, 0x3164, 0xfe00, 0xfe0d,
    0xfeff, 0xffa0, 0xe0000, 0xe0001, 0xe0041, 0xe007f, 0xe0100, 0xe0fff,
  ];

  it('refuses default-ignorable code points inside a name or title', () => {
    for (const c of IGNORABLE) {
      expect(invisibleTextProblem(`Al${cp(c)}ice`), c.toString(16)).toBe('invisible');
      expect(checkName(`Al${cp(c)}ice`), c.toString(16)).toMatchObject({ ok: false, reason: 'invisible' });
      expect(checkTitle(`Table ${cp(c)}one`), c.toString(16)).toMatchObject({ ok: false, reason: 'invisible' });
    }
  });

  it('refuses private-use and unassigned code points, U+FFF9-FFFB and U+2800', () => {
    for (const c of [0xe000, 0xf8ff, 0xf0000, 0x100000, 0x0378, 0xfdd0, 0xffff, 0x10ffff, 0xfff9, 0xfffa, 0xfffb, 0x2800]) {
      expect(checkName(`Bob${cp(c)}`), c.toString(16)).toMatchObject({ ok: false, reason: 'invisible' });
    }
  });

  it('refuses names and titles with nothing visible', () => {
    for (const s of ['\u3164', '\u3164\u3164\u3164', '\u2800\u2800\u2800', '\u115f', '\u0301\u0301', '\u200d']) {
      expect(checkName(s), JSON.stringify(s)).toMatchObject({ ok: false, reason: 'invisible' });
    }
    expect(checkTitle('\u3164 \u3164 \u3164')).toMatchObject({ ok: false, reason: 'invisible' });
    expect(checkName('   ')).toMatchObject({ ok: false, reason: 'short' }); // blank stays "empty"
  });

  it('allows U+200C/U+200D only between two visible characters, U+FE0E/U+FE0F only right after a base character', () => {
    // real uses: emoji sequences, Persian and Indic scripts
    for (const s of ['\u{1F468}\u200d\u{1F469}\u200d\u{1F467}', '\u2764\ufe0f', '\u263a\ufe0e', 'می\u200cخواهم', 'क्\u200dष', 'Alice \u{1F409}']) {
      expect(invisibleTextProblem(s), JSON.stringify(s)).toBeNull();
      expect(checkName(s).ok, JSON.stringify(s)).toBe(true);
    }
    for (const s of ['\u200dAlice', 'Alice\u200d', 'Al \u200d ice', 'Al\u200d\u200dice', 'Al\u200c\u200bice', '\ufe0fAlice', 'Al \ufe0fice', 'Al\u0301\ufe0fice', 'A\ufe0f\ufe0f']) {
      expect(invisibleTextProblem(s), JSON.stringify(s)).toBe('invisible');
    }
  });

  it('allows emoji ZWJ sequences (a base + U+FE0F counts as the base before a ZWJ), refuses leading, trailing and double ZWJ', () => {
    const fire = '❤️‍\u{1F525}'; // ❤️‍🔥
    const rainbow = '\u{1F3F3}️‍\u{1F308}'; // 🏳️‍🌈
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}'; // 👨‍👩‍👧
    for (const s of [fire, rainbow, family, `Alice ${fire}`, `${rainbow} table`]) {
      expect(invisibleTextProblem(s), JSON.stringify(s)).toBeNull();
      expect(checkName(s).ok, JSON.stringify(s)).toBe(true);
      expect(checkTitle(`${s} night`).ok, JSON.stringify(s)).toBe(true);
    }
    for (const s of [
      '‍\u{1F525}', // leading
      '❤️‍', // trailing, after a presentation sequence
      '\u{1F468}‍', // trailing
      '\u{1F468}‍‍\u{1F469}', // double
      '️‍\u{1F525}', // FE0F not after a base
      '❤️‍ \u{1F525}', // ZWJ before white space
      '❤︎‍\u{1F525}', // FE0E (text presentation) does not join
    ]) {
      expect(invisibleTextProblem(s), JSON.stringify(s)).toBe('invisible');
      expect(checkName(s), JSON.stringify(s)).toMatchObject({ ok: false, reason: 'invisible' });
    }
  });

  it(`allows at most ${MAX_COMBINING_MARKS} combining marks in a row (no "Zalgo" text)`, () => {
    expect(checkName('Ame\u0301lie').ok).toBe(true);
    expect(checkName('Ne\u0303\u0301').ok).toBe(true);
    expect(checkName('Ze\u0301\u0302\u0303lgo')).toMatchObject({ ok: false, reason: 'invisible' });
    expect(checkName('Z\u0336\u0337\u0338\u0339\u033a')).toMatchObject({ ok: false, reason: 'invisible' });
  });

  it('accepts ordinary names in many scripts, and chat and passwords keep only the text rules', () => {
    for (const s of ['Alice', 'Jötun', 'Лилиана', '日本語', 'ﺍﻟﻌﺮﺑﻴﺔ', 'Zoë-123', '!!!', '\u2605', 'Bob (2nd)']) expect(checkName(s).ok, s).toBe(true);
    expect(checkChat('hi\u200b there').ok).toBe(true);
    expect(checkPassword('pa\u200bss').ok).toBe(true);
  });
});

describe('M13-1: actionTextProblem (every string in an action)', () => {
  const pass = { type: 'pass', player: 'p1' };
  const note = (text: string) => ({ type: 'answer', player: 'p1', decisionId: 'd1', answer: { kind: 'manualResolve', ops: [{ op: 'note', text }] } });

  it('passes ordinary actions', () => {
    expect(actionTextProblem(pass)).toBeNull();
    expect(actionTextProblem({ type: 'cast', player: 'p1', card: 'o12', face: 0 })).toBeNull();
    expect(actionTextProblem(note('Exile the top card 🐉'))).toBeNull();
    expect(actionTextProblem({ type: 'answer', player: 'p1', decisionId: 'd2', answer: { kind: 'chooseName', name: 'Lightning Bolt' } })).toBeNull();
  });

  it('refuses NUL, an unpaired surrogate and a bidi control deep inside an action, with the path', () => {
    expect(actionTextProblem(note('a\u0000b'))).toMatchObject({ path: ['answer', 'ops', 0, 'text'], key: false, reason: 'nul' });
    expect(actionTextProblem(note('a\udfffb'))).toMatchObject({ path: ['answer', 'ops', 0, 'text'], reason: 'surrogate' });
    expect(actionTextProblem(note('evil‮txt'))).toMatchObject({ reason: 'bidi' });
    expect(actionTextProblem({ type: 'pass', player: 'p1\u0007' })).toMatchObject({ path: ['player'], reason: 'control' });
  });

  it('refuses a bad object key, not only values', () => {
    expect(actionTextProblem({ type: 'answer', player: 'p1', answer: { kind: 'x', ['k\u0000']: 1 } })).toMatchObject({ path: ['answer', 'k\u0000'], key: true, reason: 'nul' });
    expect(actionTextProblem({ type: 'answer', player: 'p1', answer: { ['\ud800']: 1 } })).toMatchObject({ key: true, reason: 'surrogate' });
  });

  it('limits free text to 500 and typed names to 200 (the engine accepts any note)', () => {
    expect(actionTextProblem(note('n'.repeat(500)))).toBeNull();
    expect(actionTextProblem(note('n'.repeat(501)))).toMatchObject({ reason: 'long' });
    const name = (n: string) => ({ type: 'answer', player: 'p1', decisionId: 'd', answer: { kind: 'chooseName', name: n } });
    expect(actionTextProblem(name('x'.repeat(200)))).toBeNull();
    expect(actionTextProblem(name('x'.repeat(201)))).toMatchObject({ path: ['answer', 'name'], reason: 'long' });
    const token = (n: string) => ({ type: 'answer', player: 'p1', decisionId: 'd', answer: { kind: 'manualResolve', ops: [{ op: 'token', player: 'p1', name: n, typeLine: 'Creature', text: 't'.repeat(500) }] } });
    expect(actionTextProblem(token('Goblin'))).toBeNull();
    expect(actionTextProblem(token('g'.repeat(201)))).toMatchObject({ path: ['answer', 'ops', 0, 'name'], reason: 'long' });
  });

  it('is bounded: a huge action stops at the walk limit instead of running on', () => {
    const wide = { type: 'answer', player: 'p1', answer: { kind: 'x', list: Array.from({ length: HOSTED_LIMITS.actionStrings + 10 }, () => 'a') } };
    expect(actionTextProblem(wide)).toMatchObject({ reason: 'tooLarge' });
    let deep: unknown = 'leaf';
    for (let i = 0; i < 5000; i++) deep = [deep]; // iterative: no stack overflow
    expect(actionTextProblem({ type: 'pass', player: 'p1', deep })).toBeNull();
    // parent links, not copied paths: a refusal 5,000 levels down is found and its path built once
    let bad: unknown = 'x\u0000';
    for (let i = 0; i < 5_000; i++) bad = { k: bad };
    const t0 = performance.now();
    const r = actionTextProblem({ type: 'pass', player: 'p1', bad });
    expect(r).toMatchObject({ reason: 'nul' });
    expect(r!.path).toHaveLength(5_001);
    expect(r!.path.slice(0, 3)).toEqual(['bad', 'k', 'k']);
    expect(performance.now() - t0).toBeLessThan(2_000);
  });
});
