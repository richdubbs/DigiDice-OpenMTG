/**
 * M14-2: reserved names by key (design 6.2) and the forced-rename series (9.4): built-in words, contains-rules with their exceptions, the guest
 * suffix, the series by the digit alphabet's keys, RESERVED_NAMES_FILE and its default, and generatedRenameName. Review of M14-2: the empty key is
 * reserved, and NameRules bounds the work of a key and of a reserved check.
 */
import { describe, expect, it } from 'vitest';
import { ACCOUNT_LIMITS, checkAccountName } from '@openmtg/accounts/api';
import { createNameRules, DEFAULT_RESERVED_NAMES } from '@openmtg/accounts';
import { RESERVED_EXACT } from '../../src/names/reserved';
import { RESERVED_KEY_MAX, type DisplayAwareNameRules } from '../../src/names/rules';
import { constantRandom, fixedRandom } from '../m14-1/support';

const rules = createNameRules({ reservedNamesText: null });
const reserved = (name: string, r = rules) => r.reservedProblem(r.key(name)) === 'reserved';

describe('M14-2: reserved names, compared by their keys (6.2)', () => {
  it('"Admin", "Moderator", "Mod", "OpenMTG", "System" and "Anonymous" are refused, whatever their case, look-alikes or separators', () => {
    for (const n of ['Admin', 'Moderator', 'Mod', 'OpenMTG', 'System', 'Anonymous']) expect(reserved(n), n).toBe(true);
    // written all in Cyrillic capitals that look like Latin ones (review of M14-2: the capital's look-alike counts)
    expect(checkAccountName('ЅУЅТЕМ')).toMatchObject({ ok: true });
    expect(reserved('ЅУЅТЕМ')).toBe(true);
    expect(reserved('Ѕуѕтем')).toBe(true);
    for (const n of ['ADMIN', 'admin', 'Adm1n', 'AdmIn', 'Adrnin', 'A.d.m.i.n', 'MOD', 'M0D', 'Rnod', 'Open-MTG', 'open mtg', '0penMTG', 'SYSTEM', 'S y s t e m'])
      expect(reserved(n), n).toBe(true);
    // the key rewrites literals: the list is never compared as text against a key
    expect(rules.key('Admin')).toBe('adrnln');
    expect(rules.reservedProblem('admin')).toBe(null);
  });

  it('every word of the equal list is refused as a whole name, and only as a whole name unless a contains-rule applies', () => {
    for (const w of RESERVED_EXACT) expect(reserved(w), w).toBe(true);
    for (const n of ['Rooted', 'Helper', 'Nullify', 'Ownership', 'Systems Bob', 'Serverus', 'Staffan', 'Modesty', 'Hereford', 'Supporter'])
      expect(reserved(n), n).toBe(false);
  });

  it('contains openmtg, digidice, admin, moderator or official: refused, unless the place is inside an exception', () => {
    for (const n of ['SuperAdmin', 'admin_bob', 'OpenMTGFan', 'TheDigiDiceTeam', 'ChatModerator', 'OfficialBob', 'Bob_0fficial', 'MrAdmIn'])
      expect(reserved(n), n).toBe(true);
    expect(reserved('Badminton')).toBe(false);
    expect(reserved('BADMINTON')).toBe(false);
    expect(reserved('Badminton Club')).toBe(false);
    expect(reserved('Padmini')).toBe(false);
    // an exception covers only its own place
    expect(reserved('BadmintonAdmin')).toBe(true);
    expect(reserved('Admin Badminton')).toBe(true);
  });

  it('given the display, an exception counts only inside one of its words (review of M14-2)', () => {
    const r = rules as DisplayAwareNameRules;
    const withDisplay = (n: string) => r.reservedProblem(r.key(n), n) === 'reserved';
    for (const n of ['B Admin Ton', 'P Admin I', 'b-admin-ton', 'Bad Minton']) expect(withDisplay(n), n).toBe(true);
    for (const n of ['Badminton', 'Badminton Club', 'BADMINTON_42', 'Padmini', 'Alice']) expect(withDisplay(n), n).toBe(false);
    // with the key alone (NameRules as M14-1 declares it) the exception still counts anywhere
    expect(r.reservedProblem(r.key('B Admin Ton'))).toBe(null);
    // a key the display did not make: the exception counts anywhere, as for a key alone
    expect(r.reservedProblem(r.key('Badminton Club'), 'B Admin Ton')).toBe(null);
  });

  it('a key ending in the key of "guest" is refused (guests are shown "Name (guest)")', () => {
    for (const n of ['BestGuest', 'Bob Guest', 'bob-guest', 'Guest', 'MyGUEST', 'BobGUEST']) expect(reserved(n), n).toBe(true);
    for (const n of ['Guesthouse', 'Guests', 'Guestbook']) expect(reserved(n), n).toBe(false);
  });

  it('the forced-rename series: "Player 101010", "Player-101010" and "P1ayer 42" refused, by the keys of the digits', () => {
    for (const n of ['Player 101010', 'Player-101010', 'P1ayer 42', 'Player 0', 'PLAYER 7', 'Player_123456', 'Player 9876543210', 'PlayerOlO', 'Player lol'])
      expect(reserved(n), n).toBe(true);
    for (const n of ['Player One', 'Players', 'Player 42b', 'Player X', 'Playeress']) expect(reserved(n), n).toBe(false);
    expect(reserved('Player')).toBe(true); // the equal list
  });

  it('every generatedRenameName result is in the series, is a valid name, and a fixed source gives a fixed name', () => {
    const random = fixedRandom('m14-2 rename');
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const n = rules.generatedRenameName(random);
      expect(n).toMatch(/^Player \d{6}$/);
      expect(checkAccountName(n)).toEqual({ ok: true, display: n });
      expect(rules.reservedProblem(rules.key(n)), n).toBe('reserved');
      seen.add(n);
    }
    expect(seen.size).toBe(200);
    expect(rules.generatedRenameName(fixedRandom('one'))).toBe(rules.generatedRenameName(fixedRandom('one')));
  });

  it('generatedRenameName draws uniform digits by rejecting bytes of 250 and more, and refuses a source that gives none', () => {
    const bytes = [250, 251, 255, 3, 252, 14, 25, 36, 47, 58, 69, 70];
    const r = (n: number) => {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = bytes.shift() ?? 0;
      return out;
    };
    expect(rules.generatedRenameName(r)).toBe('Player 345678');
    expect(() => rules.generatedRenameName(constantRandom(255))).toThrow(/no usable bytes/);
    expect(() => rules.generatedRenameName(() => [1, 2, 3] as unknown as Uint8Array)).toThrow(TypeError);
  });

  it("RESERVED_NAMES_FILE's lines are compared by their keys; comments and blank lines are skipped", () => {
    const r = createNameRules({ reservedNamesText: '# companies\nAcme\n\n  Widget Co  \r\nM1ke\n' });
    for (const n of ['Acme', 'ACME', 'Αcme', 'Widget-Co', 'widgetco', 'Mike', 'MIKE']) expect(reserved(n, r), n).toBe(true);
    for (const n of ['Acme2', 'Acmes', 'Widget', 'companies']) expect(reserved(n, r), n).toBe(false);
    // the file replaces the default list; the built-in rules stay
    expect(reserved('Scryfall', r)).toBe(false);
    expect(reserved('Admin', r)).toBe(true);
  });

  it('a "!word" line of RESERVED_NAMES_FILE adds an exception to the contains-rules, at its own place only', () => {
    const r = createNameRules({ reservedNamesText: 'Acme\n!Kadmin\n! Unofficial \n' });
    for (const n of ['Kadmin', 'KADMIN Bob', 'Unofficial', 'Badminton']) expect(reserved(n, r), n).toBe(false);
    for (const n of ['KadminAdmin', 'Official', 'Admin', 'Acme']) expect(reserved(n, r), n).toBe(true);
    expect(reserved('Kadmin')).toBe(true); // not an exception of the default list
  });

  it('the default list (RESERVED_NAMES_FILE unset) holds other companies\' and products\' names', () => {
    for (const n of ['Wizards of the Coast', 'WotC', 'Hasbro', 'MTG Arena', 'Scryfall', 'Shopify', 'Discord']) expect(reserved(n), n).toBe(true);
    expect(DEFAULT_RESERVED_NAMES).toMatch(/^# /);
    for (const line of DEFAULT_RESERVED_NAMES.split('\n').filter((l) => l !== '' && !l.startsWith('#'))) expect(reserved(line), line).toBe(true);
    expect(reserved('Alice')).toBe(false);
  });

  it('the empty key is reserved: a name of apostrophe look-alikes keys to nothing, and no account may hold that one key', () => {
    for (const n of ['ʼʼʼ', 'ˈˈˈ', 'ʻʻʻ', 'ꞌꞌꞌ', 'ʼ ʼ ʼ']) {
      expect(checkAccountName(n), n).toMatchObject({ ok: true }); // 6.1 counts them as letters
      expect(rules.key(n), n).toBe('');
      expect(rules.reservedProblem(rules.key(n)), n).toBe('reserved');
    }
    expect(rules.reservedProblem('')).toBe('reserved');
    // letters of other scripts no longer vanish (Hebrew yod looks like an apostrophe): those names have keys of their own
    for (const n of ['ייי', 'ᛌᛌᛌ', 'ꓸꓸꓸ']) {
      expect(rules.key(n), n).not.toBe('');
      expect(rules.reservedProblem(rules.key(n)), n).toBe(null);
    }
    // a display past nameRawMax keys to "" without any work, so it is reserved too
    expect(rules.reservedProblem(rules.key('Bob'.repeat(100)))).toBe('reserved');
  });

  it('the work of a key is bounded: a display longer than nameRawMax keys to "" at once, and a reserved check reads no long key', () => {
    expect(ACCOUNT_LIMITS.nameRawMax).toBe(256);
    const longest = 'ﷺ'.repeat(ACCOUNT_LIMITS.nameMax); // the longest valid name's key: 20 x 15 characters
    expect(checkAccountName(longest)).toMatchObject({ ok: true });
    expect(rules.key(longest).length).toBe(300);
    expect(rules.key('ﷺ'.repeat(ACCOUNT_LIMITS.nameRawMax)).length).toBe(15 * ACCOUNT_LIMITS.nameRawMax);
    const start = Date.now();
    for (const x of ['ﷺ'.repeat(65_536), 'x'.repeat(ACCOUNT_LIMITS.nameRawMax + 1), 'a'.repeat(262_144)]) expect(rules.key(x)).toBe('');
    expect(rules.reservedProblem('badminton'.repeat(16_000))).toBe('reserved');
    expect(rules.reservedProblem('a'.repeat(RESERVED_KEY_MAX + 1))).toBe('reserved');
    expect(rules.reservedProblem(rules.key(longest))).toBe(null);
    expect(Date.now() - start).toBeLessThan(1_000);
  });

  it('ordinary names are not reserved', () => {
    for (const n of ['Alice', 'Bob', 'Ann Lee', 'Tanaka田中', 'Дмитрий', 'Moe Squad Fan', 'Officer', 'Digit']) expect(reserved(n), n).toBe(false);
  });
});
