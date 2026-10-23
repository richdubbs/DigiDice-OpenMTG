/**
 * M14-2: ListNameFilter (design 6.4): entries compared by their keys, substring and whole-key entries, exceptions, the leet fold before keying, the
 * built-in list, and a refusal that never names the matched word.
 */
import { describe, expect, it } from 'vitest';
import { checkAccountName } from '@openmtg/accounts/api';
import { createListNameFilter, createNameRules, DEFAULT_MODERATION_WORDS, NAME_FILTERED_MESSAGE } from '@openmtg/accounts';
import { leetFold } from '../../src/names/filter';

const rules = createNameRules({ reservedNamesText: null });
const WORDS = '# a fixed list\nshit\n=ass\ncunt\n!scunthorpe\n\n  =Toast  \r\nbadword\n!goodbadword\n';
const filter = createListNameFilter(WORDS, rules);
const builtIn = createListNameFilter(null, rules);
const ok = (name: string, f = filter) => f.check({ display: name, key: rules.key(name) }).ok;

describe('M14-2: the word filter (6.4)', () => {
  it('the leet fold: "sh1t" and "5hit" are refused, by the fixed list and by the built-in one', () => {
    for (const f of [filter, builtIn]) {
      for (const n of ['sh1t', '5hit', 'shit', 'SHIT', 'Sh1T', '5H1T', 'Shlt']) expect(ok(n, f), n).toBe(false);
    }
    expect(leetFold('4 3 5 7 0 1')).toBe('a e s t 0 1');
  });

  it('a word matches anywhere in the key; =word only the whole key', () => {
    for (const n of ['MyShitName', 'shitty', 'Bob_shit', 'Ass', 'A.S.S', '4ss', 'Toast', 'T0ast', '7oast']) expect(ok(n), n).toBe(false);
    for (const n of ['Bass', 'Assam', 'Classic', 'Toaster', 'Alice']) expect(ok(n), n).toBe(true);
  });

  it('exceptions (the Scunthorpe problem) cover only their own place', () => {
    expect(ok('Scunthorpe')).toBe(true);
    expect(ok('SCUNTHORPE_FC')).toBe(true);
    expect(ok('Scunthorpe FC')).toBe(true);
    // review of M14-2: an exception counts only inside one word of the display, so it never excuses a word shown on its own
    for (const n of ['S Cunt Horpe', 'S CUNT HORPE', 'S.Cunt.Horpe', 'Scun Thorpe']) expect(ok(n), n).toBe(false);
    for (const n of ['S Cunt Horpe', 'Scunthorpe']) expect(rules.key(n)).toBe(rules.key('Scunthorpe'));
    expect(ok('Scunthorpe', builtIn)).toBe(true);
    expect(ok('S Cunt Horpe', builtIn)).toBe(false);
    expect(ok('ScunthorpeCunt')).toBe(false);
    expect(ok('GoodBadWord')).toBe(true);
    expect(ok('BadWord')).toBe(false);
    expect(ok('BadWordGoodBadWord')).toBe(false);
  });

  it('entries are compared by their keys: an entry written in capitals or look-alikes still matches', () => {
    const f = createListNameFilter('SH1T\n=AS5\n', rules);
    expect(ok('shit', f)).toBe(false);
    expect(ok('Shitface', f)).toBe(false);
    // the leet fold applies to names, not to the entries: "AS5" keys as "as5"
    expect(ok('as5', f)).toBe(false);
    expect(ok('ass', f)).toBe(true);
  });

  it('checks the key it is given too (a key under the other data version during a rekey)', () => {
    expect(filter.check({ display: 'Alice', key: rules.key('badword') })).toEqual({ ok: false, reason: 'word' });
  });

  it('a refusal never holds the matched word: only { ok: false, reason: "word" }', () => {
    for (const n of ['sh1t', 'ScunthorpeCunt', 'Toast', 'BadWord']) {
      const r = filter.check({ display: n, key: rules.key(n) });
      expect(r).toEqual({ ok: false, reason: 'word' });
      const text = JSON.stringify(r).toLowerCase();
      for (const w of ['shit', 'shlt', 'cunt', 'toast', 'badword', 'badwor', n.toLowerCase()]) expect(text).not.toContain(w);
    }
    expect(NAME_FILTERED_MESSAGE).toBe('This name is not allowed');
  });

  it('the built-in list (MODERATION_WORDS_FILE unset) refuses common slurs and leaves ordinary names that hold a short word alone', () => {
    for (const n of ['Fuck', 'Fuckface', 'Bullsh1t', 'Cunt', 'Slut', 'Rape']) expect(ok(n, builtIn), n).toBe(false);
    for (const n of ['Yoshito', 'Ashitaka', 'Scunthorpe', 'Grape', 'Slutsky', 'Pomeroy', 'Alice', 'Hancock']) expect(ok(n, builtIn), n).toBe(true);
    expect(DEFAULT_MODERATION_WORDS).toMatch(/^# /);
  });

  it('capitals that look like Latin ones spell the word: the key and the skeleton key are both checked (review of M14-2)', () => {
    // Cyrillic and Greek capitals, and Latin capital beta; "Н" keys by its small letter, so only the skeleton key reads it as "H"
    for (const n of ['ЅНІТ', 'ВІТСН', 'Ꞵitch', 'ΒΙΤϹΗ', 'Ѕһіт']) {
      expect(checkAccountName(n), n).toMatchObject({ ok: true });
      expect(ok(n, builtIn), n).toBe(false);
    }
    expect(rules.key('ЅНІТ')).not.toBe(rules.key('SHIT')); // the key keeps Cyrillic "Н" with "н": the skeleton key is what refuses it
    for (const n of ['Наташа', 'Нина', 'Ηλίας', 'Βασίλης']) expect(ok(n, builtIn), n).toBe(true);
  });

  it('an empty list refuses nothing', () => {
    const f = createListNameFilter('', rules);
    for (const n of ['sh1t', 'Alice']) expect(ok(n, f), n).toBe(true);
  });
});
