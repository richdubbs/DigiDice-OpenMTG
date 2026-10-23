/**
 * M14-2: the canonical key (design 6.3) under the generated Unicode data: the pinned examples, case-insensitivity over the fixed list, 200 pairs of
 * different names kept apart, the key as its own key, and every entry of the tables settling within 3 rounds. Review of M14-2: capitals that look
 * like basic Latin capitals key like them (the derived table's closure), no letter of another script vanishes from a key (Hebrew yod), the closure
 * merges no two letters of one alphabet.
 */
import { describe, expect, it } from 'vitest';
import { checkAccountName } from '@openmtg/accounts/api';
import { createNameData, createNameRules } from '@openmtg/accounts';
import { tablesOf, CURRENT_NAME_DATA } from '../../src/names/data';
import { canonicalKey, KEY_ROUNDS_CHECKED, keyRound, settle } from '../../src/names/key';
import { UNICODE_DATA } from '../../src/names/unicode-data';
import { differentPairs, NAMES } from './fixtures';

const rules = createNameRules({ reservedNamesText: null });
const key = (s: string) => rules.key(s);
const cp = (...xs: number[]) => String.fromCodePoint(...xs);

describe('M14-2: the canonical key (6.3)', () => {
  it('the examples of 6.3 are one name each', () => {
    const same: string[][] = [
      ['Alice', 'alice', 'ALICE'],
      ['MIKE', 'mike'],
      ['Ilya', 'ilya', 'llya', '1lya'],
      ['Coco', 'Сосо'], // the second all in Cyrillic
      ['Bob', 'B0b'],
      ['Ann-Lee', 'Ann Lee', 'annlee'],
      ['José', 'Jose', `Jose${cp(0x301)}`],
      ['Straße', 'Strasse'],
      ['Barn', 'Bam'],
    ];
    for (const group of same) for (const x of group) expect(key(x), `${x} ~ ${group[0]}`).toBe(key(group[0]!));
    expect(key('MIKE')).toBe('rnlke');
    expect(key('mike')).toBe('rnlke');
    expect(key('Barn')).toBe('barn');
    expect(key('Bam')).toBe('barn');
    expect(key('ALICE')).toBe('allce');
    expect(key('Admin')).toBe('adrnln');
    // "Аlice" with one Cyrillic letter keys like "Alice", but the script rule refuses it before any key is made
    expect(checkAccountName(`${cp(0x410)}lice`)).toMatchObject({ ok: false, problem: 'scripts' });
  });

  it('look-alikes, case, diacritics after Latin, Greek and Cyrillic letters, separators and compatibility forms do not make a name different', () => {
    const same: string[][] = [
      ['Jörg', 'Jorg', 'JÖRG'], ['Zoë', 'Zoe'], ['Ñandú', 'Nandu'], ['Dvořák', 'Dvorak'], ['Ελένη', 'Ελενη', 'ΕΛΈΝΗ'],
      ['Ёжик', 'Ежик'], ['Ｂｏｂ', 'Bob'], ['ﬁona', 'fiona', 'Fiona', 'FlONA'], ['Mary_Jane', 'Mary.Jane', "Mary'Jane", 'MaryJane'],
      ['Dmitri', 'DMITRI', 'drnitri', 'Drn1tr1'], ['Οδυσσεύς', 'ΟΔΥΣΣΕΥΣ', 'οδυσσευς'],
    ];
    for (const group of same) for (const x of group) expect(key(x), `${x} ~ ${group[0]}`).toBe(key(group[0]!));
  });

  it('for every name of the fixed list, key(x) = key(x.toUpperCase()) = key(x.toLowerCase())', () => {
    for (const x of NAMES) {
      expect(key(x.toUpperCase()), x).toBe(key(x));
      expect(key(x.toLowerCase()), x).toBe(key(x));
    }
  });

  it('200 fixed pairs of different names keep different keys', () => {
    const pairs = differentPairs();
    expect(pairs.length).toBe(200);
    for (const [a, b] of pairs) {
      expect(checkAccountName(a), a).toMatchObject({ ok: true });
      expect(checkAccountName(b), b).toMatchObject({ ok: true });
      expect(key(a), `${a} / ${b}`).not.toBe(key(b));
    }
  });

  it('a key is its own key: key(key(x)) = key(x)', () => {
    const odd = ['', ' ', '%', '‰', '⏨', '🅭', 'ǅ', 'ﷺ', '㎒', 'ǃ', `a${cp(0x301, 0x302, 0x303)}`, `${cp(0x627, 0x654)}`, 'ⅷ'];
    for (const x of [...NAMES, ...differentPairs().flat(), ...odd]) expect(key(key(x)), x).toBe(key(x));
  });

  it('is total: any string has a key, NUL, lone surrogates and emoji included', () => {
    for (const x of ['', cp(0), String.fromCharCode(0xd800), `a${String.fromCharCode(0xdc00)}b`, '😀', 'x'.repeat(300)]) expect(typeof key(x)).toBe('string');
    expect(key('')).toBe('');
    expect(key(' - _ . ')).toBe('');
  });

  it('every entry of the generated tables settles within 3 rounds, and its key is its own key (what the generator checks)', () => {
    const t = tablesOf(CURRENT_NAME_DATA);
    expect(KEY_ROUNDS_CHECKED).toBe(3);
    const sources = new Set([...t.caseFolding.keys(), ...t.confusables.keys(), ...t.supplement.keys()]);
    expect(sources.size).toBeGreaterThan(7_000);
    for (const c of sources) {
      const ch = cp(c);
      expect(settle(t, ch).rounds, `U+${c.toString(16)}`).toBeLessThanOrEqual(KEY_ROUNDS_CHECKED);
      const k = canonicalKey(t, ch);
      expect(canonicalKey(t, k), `U+${c.toString(16)}`).toBe(k);
    }
  });

  it('one round: fold, map, fold, drop the marks after a Latin, Greek or Cyrillic letter, drop the separators, "i" to "l"', () => {
    const t = tablesOf(CURRENT_NAME_DATA);
    expect(keyRound(t, 'MI')).toBe('rnl'); // fold "mi", map "rni", supplement "rnl"
    expect(keyRound(t, 'I')).toBe('l');
    expect(keyRound(t, '0')).toBe('o'); // map "O", fold "o"
    expect(keyRound(t, 'é')).toBe('e');
    expect(keyRound(t, 'a-b c_d.e\'f')).toBe('abcdef');
    expect(keyRound(t, `${cp(0x915, 0x93c)}`)).toBe(keyRound(t, keyRound(t, `${cp(0x915, 0x93c)}`))); // a Devanagari nukta stays
    expect(key(`${cp(0x915, 0x93c)}`)).not.toBe(key(cp(0x915)));
  });

  it('a capital that looks like a basic Latin capital keys like it, with its small letter (the closure of the derived table)', () => {
    const same: string[][] = [
      ['Мах', 'Max', 'MAX', 'мах', 'МАХ'], // Cyrillic EM, A, HA
      ['ΜΙΚΕ', 'MIKE', 'mike', 'μικε'], // Greek MU, IOTA, KAPPA, EPSILON (6.3's own example)
      ['Ꞵob', 'Bob', 'ꞵob'], // Latin capital BETA (U+A7B4)
      ['Тасо', 'Taco'], ['Веа', 'Bea'], ['Ꭓena', 'Xena'], ['Ʝose', 'Jose'], ['ΒΟΒ', 'BOB', 'βοβ'], ['Κάτια', 'Katia'], ['ЅУЅТЕМ', 'SYSTEM'],
      ['мах', 'ᴍax'], // the small letter keeps the look-alike it had: Latin small capital M
    ];
    for (const group of same) {
      for (const x of group) {
        expect(checkAccountName(x), x).toMatchObject({ ok: true });
        expect(key(x), `${x} ~ ${group[0]}`).toBe(key(group[0]!));
      }
    }
    expect(key('Мах')).toBe('rnax');
    expect(key('Ꞵob')).toBe('bob');
    // the derived table is in the data, and the plain tables (without it) would key these apart, folding first
    expect(UNICODE_DATA.overrides).toMatch(/^[0-9a-f]+>/);
    const plain = createNameRules({ reservedNamesText: null, data: createNameData({ ...UNICODE_DATA, overrides: '' }) });
    expect(plain.key('Мах')).not.toBe(plain.key('Max'));
    expect(plain.key('Ꞵob')).not.toBe(plain.key('Bob'));
  });

  it('a capital keeps its small letter\'s key when that letter looks like another basic letter, or the merge would join two letters of one script', () => {
    // Greek ETA looks like "n" when small and "H" when capital; Cyrillic EN's "H" would meet SHHA "һ", which is "h": both stay as they were
    expect(key('ΗΟΜΕ')).toBe(key('ηομε'));
    expect(key('Норе')).toBe(key('норе'));
    expect(key('Норе')).not.toBe(key('һоре'));
    expect(key('һоре')).toBe(key('hope'));
  });

  it('no letter of a script other than Common, Inherited and Latin vanishes from a key; Hebrew names with yod stay apart from those without', () => {
    const pairs: [string, string][] = [
      ['שירה', 'שרה'], // Shira, Sarah
      ['דניאל', 'דנאל'], // Daniel
      ['יוסי', 'יוס'], ['יעל', 'עלי'], ['ייי', 'יי']];
    for (const [a, b] of pairs) {
      expect(checkAccountName(a), a).toMatchObject({ ok: true });
      expect(key(a), `${a} / ${b}`).not.toBe(key(b));
    }
    expect(key('ייי')).toBe('ייי');
    // every letter: which keys vanish, and how long a key of one letter gets (RESERVED_KEY_MAX relies on 15)
    const vanishing: string[] = [];
    let longest = 0;
    for (let c = 0; c < 0x30000; c++) {
      if (c >= 0xd800 && c < 0xe000) continue;
      const ch = cp(c);
      if (!/^\p{L}$/u.test(ch)) continue;
      const k = key(ch);
      if (k === '') vanishing.push(c.toString(16));
      longest = Math.max(longest, Array.from(k).length);
    }
    expect(longest).toBe(15);
    // the letters that still vanish are the apostrophe look-alikes of Common and Latin, dropped as the typed apostrophe is
    expect(vanishing).toEqual(['2b9', '2ba', '2bb', '2bc', '2bd', '2be', '2c8', '2ca', '2cb', '2ee', '374', 'a78b', 'a78c']);
    expect(key('Dʼarcy')).toBe(key("D'Arcy"));
  });

  it('the closure makes no two letters of one alphabet one name that the plain tables told apart', () => {
    const plain = createNameRules({ reservedNamesText: null, data: createNameData({ ...UNICODE_DATA, overrides: '' }) });
    const alphabets = [
      'abcdefghijklmnopqrstuvwxyz0123456789',
      'αβγδεζηθικλμνξοπρστυφχψως',
      'абвгдеёжзийклмнопрстуфхцчшщъыьэюя', // Russian
      'ґєіїўђјљњћџѓѕќәғқңөұүһ', // Ukrainian, Belarusian, Serbian, Macedonian, Kazakh
      'աբգդեզէըթժիլխծկհձղճմյնշոչպջռսվտրցւփքօֆ',
      'אבגדהוזחטיכלמנסעפצקרשתךםןףץ',
    ];
    for (const alphabet of alphabets) {
      const letters = Array.from(alphabet);
      for (let i = 0; i < letters.length; i++) {
        for (let j = i + 1; j < letters.length; j++) {
          const [a, b] = [letters[i]!, letters[j]!];
          if (key(a) === key(b)) expect(plain.key(a), `${a} and ${b} became one letter`).toBe(plain.key(b));
        }
      }
    }
  });

  it('refuses name data it did not build', () => {
    expect(() => rules.key('Alice', { version: 1, unicodeVersion: '17.0.0' })).toThrow(/unknown name data/);
  });
});
