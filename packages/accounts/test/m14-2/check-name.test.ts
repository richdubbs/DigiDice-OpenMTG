/**
 * M14-2: `checkAccountName` (design 6.1), the browser-safe display check, on fixed accepted and refused lists: the length, the allow-list (letters,
 * marks after a letter, ASCII digits, five separators), the separators' places, a letter, UTS #39's Highly Restrictive script rule, and (review
 * of M14-2) RFC 5893's first rule for right-to-left names.
 */
import { describe, expect, it } from 'vitest';
import { ACCOUNT_LIMITS, checkAccountName, type NameProblem } from '@openmtg/accounts/api';
import { NAME_PROBLEM_MESSAGES } from '../../src/api/names';
import { NAMES } from './fixtures';

const accepted = (raw: string): string => {
  const r = checkAccountName(raw);
  expect(r, JSON.stringify(raw)).toMatchObject({ ok: true });
  return (r as { ok: true; display: string }).display;
};
const problem = (raw: unknown): NameProblem | null => {
  const r = checkAccountName(raw);
  return r.ok ? null : r.problem;
};

describe('M14-2: checkAccountName (6.1)', () => {
  it('accepts every name of the fixed list, as its own display form', () => {
    for (const n of NAMES) expect(accepted(n), n).toBe(n);
  });

  it('collapses white space and normalizes to NFC: the display form is what is stored and shown', () => {
    expect(accepted('  Ann   Lee  ')).toBe('Ann Lee');
    expect(accepted('Ann\tLee')).toBe('Ann Lee');
    expect(accepted('Ann\u00a0Lee')).toBe('Ann Lee');
    expect(accepted('Jose\u0301')).toBe('Jos\u00e9');
    expect(accepted('\u1100\u1161\u11a8 Kim')).toBe('\uac01 Kim');
  });

  it('3 to 20 code points of the display form, and at most nameRawMax UTF-16 units before any work', () => {
    expect(ACCOUNT_LIMITS.nameMin).toBe(3);
    expect(ACCOUNT_LIMITS.nameMax).toBe(20);
    expect(accepted('Abe')).toBe('Abe');
    expect(accepted('a'.repeat(20))).toBe('a'.repeat(20));
    expect(accepted('𐐀𐐁𐐂')).toBe('𐐀𐐁𐐂'); // 3 code points, 6 UTF-16 units (Deseret)
    expect(accepted(`${' '.repeat(200)}Bob${' '.repeat(50)}`)).toBe('Bob');
    expect(problem('Al')).toBe('short');
    expect(problem('  Al  ')).toBe('short');
    expect(problem('a\u0301b')).toBe('short'); // NFC: "áb"
    expect(problem('')).toBe('short');
    expect(problem('a'.repeat(21))).toBe('long');
    expect(problem('Ann Lee Ann Lee Ann L')).toBe('long');
    expect(problem(`${' '.repeat(255)}Bob`)).toBe('long'); // 258 units before any work
  });

  it('refuses what is not a string', () => {
    for (const x of [undefined, null, 42, true, {}, ['Alice'], new String('Alice')]) expect(problem(x), String(x)).toBe('type');
  });

  it('refuses every character outside the allow-list, invisible ones and the m13 text problems among them', () => {
    const bad = [
      'Bob!', 'B@b', 'Bob/', 'Bob,', 'Bob:', 'Bob?', 'Bob+', 'Bob=', 'Bob~', 'Bob#', 'Bob$', 'Bob%', 'Bob(', 'Bob*', 'Bob"', 'Bob`', 'Bob’s',
      'Bob😀', 'Bob❤', 'Bob★', 'Bob©', 'Bob™', '₿ob', // emoji and symbols
      'Bob١', 'Bob²', 'Bob٣', 'Bob５', 'Bob½', 'BobⅣ', // digits other than ASCII 0-9 (Nd, No, Nl)
      'Bo\u200db', 'Bo\u200cb', 'Bo\u200bb', 'Bo\u2060b', 'Bo\u00adb', 'Bob\u3164', 'Bob\u115f', 'Bob\uffa0', 'Bo\u034fb', // invisible
      'Bob\u0000', 'Bob\ud800', 'Bob\udc00x', 'Bob\u202e', 'Bob\u2066', 'Bob\u061c', 'Bob\u0007', 'Bob\u007f', 'Bob\u0085', 'Bob\u0090', // m13
      'Bob\ue000', 'Bob\u{f0000}', 'Bob\u0378', // private use, unassigned
      'Bo\u2800b', 'Bob\ufff9',
    ];
    for (const raw of bad) expect(problem(raw), JSON.stringify(raw)).toBe('character');
  });

  it('combining marks only after a letter, at most 2 in a row', () => {
    expect(accepted('x\u0301\u0302yz')).toBe('x\u0301\u0302yz');
    expect(accepted('Ńgo')).toBe('Ńgo');
    expect(problem('x\u0301\u0302\u0303yz')).toBe('marks');
    expect(problem('\u0301Bob')).toBe('marks');
    expect(problem('Bo1\u0301b')).toBe('marks');
    expect(problem('Bo-\u0301b')).toBe('marks');
    expect(problem('Bo \u0301b')).toBe('marks');
  });

  it('separators never first or last and never doubled (one twice in a run of separators); two different ones may meet', () => {
    for (const ok of ['Ann Lee', 'Ann-Lee', 'Ann_Lee', 'Ann.Lee', "Ann'Lee", "O'Neil-Smith", 'J.R.R', 'a b c']) expect(accepted(ok)).toBe(ok);
    // review of M14-2: common names with ". " or "' " (the key drops separators, so this copies nobody)
    for (const ok of ['St. John', 'Dr. Who', 'Mr. T', 'J. R. Smith', "Bo' b", 'Bo. b', 'Bo-_b']) expect(accepted(ok), ok).toBe(ok);
    for (const raw of ['_Bob', 'Bob_', '.Bob', "Bob'", '-Bob', 'Bo__b', 'Bo--b', 'Bo..b', "Bo''b", 'St. .John', 'Bo-_-b', 'Dr.'])
      expect(problem(raw), raw).toBe('separator');
    expect(accepted('Bo   b')).toBe('Bo b'); // white space collapses before the rule
  });

  it('at least one letter', () => {
    for (const raw of ['123', '1-2-3', '0_0', '42.7']) expect(problem(raw), raw).toBe('noLetter');
    expect(accepted('R2D2')).toBe('R2D2');
  });

  it('the script rule: Latin with Han accepted, Latin with Cyrillic refused, all-Greek accepted (UTS #39 Highly Restrictive)', () => {
    // one script; Common and Inherited characters go with any
    for (const ok of ['Αλέξανδρος', 'Ελένη', 'Дмитрий', 'שלום', 'द\u0947वन\u093eगर\u0940', 'Bob 42', 'ʼAkiva']) expect(accepted(ok), ok).toBe(ok);
    // Latin with Han, with Han and Kana (Japanese), with Han and Bopomofo, with Han and Hangul
    for (const ok of ['Tanaka田中', 'Lee李', 'Sakuraさくら', 'Sakuraサクラ', '田中さくらSan', 'ㄅㄆ注音Ok', 'Kim철수', 'Kim金철수', 'ラーメンMan'])
      expect(accepted(ok), ok).toBe(ok);
    for (const raw of [
      '\u0410lice', // Cyrillic \u0410, then Latin
      'Bobβ', 'Ωmega', 'Иван Ivanov', 'abcאב', 'Иван李', 'さくら김', 'サクラ김', 'ㄅㄆ김', 'Kimㄅ김', 'Αλέξανδρος Ivan', 'द\u0947वAnand', 'ᏣᎳᎩ Bob',
    ]) expect(problem(raw), raw).toBe('scripts');
  });

  it('a name that holds a right-to-left letter starts with one (RFC 5893 rule 1): its digits cannot move to the front and look the same', () => {
    // each pair looks the same on a left-to-right page (the digits are reordered); only the first may be a name
    const pairs: [string, string][] = [['שלום 123', '123 שלום'], ['שלום_42', '42_שלום'], ['أحمد 12', '12 أحمد'], ['שלום 12 34', '34 12 שלום']];
    for (const [ok, bad] of pairs) {
      expect(accepted(ok), ok).toBe(ok);
      expect(problem(bad), bad).toBe('scripts');
    }
    for (const ok of ['שלום', 'أحمد', 'ދިވެހި', 'ߒߞߏ', '𞤀𞤁𞤂', 'ܫܠܡܐ', 'שירה 2', 'Bob 42', '42 Bob', '42 Δήμος']) expect(accepted(ok), ok).toBe(ok);
    for (const bad of ['1ߒߞߏ', '7 𞤀𞤁𞤂', '9ܫܠܡܐ']) expect(problem(bad), bad).toBe('scripts');
    expect(problem('ʼשלום')).toBe('scripts'); // a Common letter first
  });

  it('checks in order: type, raw length, length, characters, marks, separators, a letter, scripts', () => {
    expect(problem('_Bob!')).toBe('character');
    expect(problem('_\u0301Bob')).toBe('marks');
    expect(problem('_123')).toBe('separator');
    expect(problem('_Иван Ivan')).toBe('separator');
  });

  it('each problem has its message, and no message repeats the name', () => {
    const cases: [string | number, NameProblem][] = [
      [7, 'type'], ['Zx', 'short'], ['Zx'.repeat(11), 'long'], ['Zxq!', 'character'], ['Zxq_', 'separator'], ['123', 'noLetter'],
      ['\u0301Zxq', 'marks'], ['Зxq Zxq', 'scripts'],
    ];
    for (const [raw, p] of cases) {
      const r = checkAccountName(raw);
      expect(r).toEqual({ ok: false, problem: p, message: NAME_PROBLEM_MESSAGES[p] });
      if (typeof raw === 'string') expect(NAME_PROBLEM_MESSAGES[p]).not.toContain('Zx');
    }
    expect(new Set(Object.values(NAME_PROBLEM_MESSAGES)).size).toBe(8);
  });
});
