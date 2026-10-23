/**
 * M14-2: scripts/gen-unicode-data.ts on fixed inputs (no network): the three parsers, the header checks, the derived table (letters of other scripts
 * that look like separators kept, the closure of case and look-alike and the links it does not follow), the settle check that refuses tables needing
 * more than 3 rounds, the tables' digest, and the version plan (1 at first, kept when nothing differs, one more with the committed data moved to the
 * previous file).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createNameData, createNameRules, type GeneratedNameData } from '@openmtg/accounts';
import {
  buildNameData, DEFAULT_BASE, DEFAULT_UNICODE, deriveOverrides, header, parseCaseFolding, parseConfusables, parseIdentifierStatus, planNameData,
  renderModule, tablesSha256,
} from '../../../../scripts/gen-unicode-data';

const FOLD = [
  '# CaseFolding-99.0.0.txt',
  '# Date: 2030-01-02, 03:04:05 GMT',
  '0041; C; 0061; # LATIN CAPITAL LETTER A',
  '0042; C; 0062; # LATIN CAPITAL LETTER B',
  '0049; C; 0069; # LATIN CAPITAL LETTER I',
  '0049; T; 0131; # LATIN CAPITAL LETTER I (Turkic)',
  '004D; C; 006D; # LATIN CAPITAL LETTER M',
  '00DF; F; 0073 0073; # LATIN SMALL LETTER SHARP S',
  '1E9E; F; 0073 0073; # LATIN CAPITAL LETTER SHARP S',
  '1E9E; S; 00DF; # LATIN CAPITAL LETTER SHARP S',
  '',
].join('\n');
const CONF = [
  '# confusables.txt',
  '# Date: 2030-01-03, 01:02:03 GMT',
  '# Version: 99.0.0',
  '0049 ;\t006C ;\tMA\t# ( I → l )',
  '0031 ;\t006C ;\tMA\t# ( 1 → l )',
  '006D ;\t0072 006E ;\tMA\t# ( m → rn )',
  '',
].join('\n');
const STATUS = [
  '# IdentifierStatus.txt',
  '# Date: 2030-01-04, 00:00:00 GMT',
  '# Version: 99.0.0',
  '0027          ; Allowed    # APOSTROPHE',
  '0030..0039    ; Allowed    # DIGITS',
  '0041..005A    ; Allowed    # A..Z',
  '0061..007A    ; Allowed    # a..z',
  '00DF          ; Allowed    # SHARP S',
  '0410..044F    ; Allowed    # Cyrillic A..ya',
  '04BA..04BB    ; Allowed    # Cyrillic SHHA',
  '05D0..05EA    ; Allowed    # Hebrew letters',
  '',
].join('\n');
const inputs = (fold = FOLD, conf = CONF, status = STATUS) => ({
  caseFolding: { text: fold, where: 'fold' }, confusables: { text: conf, where: 'conf' }, identifierStatus: { text: status, where: 'status' },
});
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
/** Rules on the tables `buildNameData` makes from the fixed inputs plus `fold` and `conf` lines. */
const rulesFrom = (fold: string[] = [], conf: string[] = []) => {
  const fresh = buildNameData(inputs([FOLD, ...fold].join('\n'), [CONF, ...conf].join('\n')), '99.0.0');
  return { fresh, rules: createNameRules({ reservedNamesText: '', data: createNameData({ ...fresh, version: 1 }) }) };
};
const derive = (fold: string[], conf: string[]) =>
  deriveOverrides(parseCaseFolding([FOLD, ...fold].join('\n')), parseConfusables([CONF, ...conf].join('\n')), [['i', 'l']], parseIdentifierStatus(STATUS));
const cp = (c: string) => c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
const foldLine = (from: string, to: string) => `${cp(from)}; C; ${cp(to)}; #`;
const confLine = (from: string, to: string) => `${cp(from)} ;\t${Array.from(to, cp).join(' ')} ;\tMA\t#`;

describe('M14-2: the Unicode data generator', () => {
  it('reads Unicode from GitHub by default, a released version (never "dev")', () => {
    expect(DEFAULT_BASE).toBe('https://raw.githubusercontent.com/unicode-org/unicodetools/main/unicodetools/data');
    expect(DEFAULT_UNICODE).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('CaseFolding.txt: statuses C and F only (the Turkic T and the simple S are left out)', () => {
    expect(parseCaseFolding(FOLD)).toEqual([['A', 'a'], ['B', 'b'], ['I', 'i'], ['M', 'm'], ['ß', 'ss'], [String.fromCodePoint(0x1e9e), 'ss']]);
    expect(() => parseCaseFolding('0041; C; 0061;\n0041; F; 0061;')).toThrow(/two C\/F mappings/);
    expect(() => parseCaseFolding('0041; C')).toThrow(/malformed/);
  });

  it('confusables.txt: one prototype per single code point source', () => {
    expect(parseConfusables(CONF)).toEqual([['I', 'l'], ['1', 'l'], ['m', 'rn']]);
    expect(() => parseConfusables('0041 0042 ;\t0043 ;\tMA')).toThrow(/2 code points/);
    expect(() => parseConfusables('0041 ;\t0043 ;\tMA\n0041 ;\t0044 ;\tMA')).toThrow(/two prototypes/);
    expect(() => parseConfusables('XYZ ;\t0043 ;\tMA')).toThrow(/not a code point/);
  });

  it('IdentifierStatus.txt: the Allowed code points, single and ranges', () => {
    const allowed = parseIdentifierStatus(STATUS);
    for (const c of ["'", '0', '9', 'A', 'z', '\u00df', '\u0416', '\u04bb', '\u05d0']) expect(allowed.has(c.codePointAt(0)!), c).toBe(true);
    for (const c of ['!', '\u028d', '\u1d0d', '\u2c8e']) expect(allowed.has(c.codePointAt(0)!), c).toBe(false);
    expect(() => parseIdentifierStatus('0041 ; Restricted')).toThrow(/unknown status/);
    expect(() => parseIdentifierStatus('0041..0040 ; Allowed')).toThrow(/bad range/);
    expect(() => parseIdentifierStatus('zz ; Allowed')).toThrow(/malformed/);
  });

  it('each file\'s header must name the version asked for; its date is recorded', () => {
    expect(header({ text: FOLD, where: 'f' }, '99.0.0', 'CaseFolding.txt')).toBe('2030-01-02');
    expect(header({ text: CONF, where: 'c' }, '99.0.0', 'confusables.txt')).toBe('2030-01-03');
    expect(header({ text: STATUS, where: 's' }, '99.0.0', 'IdentifierStatus.txt')).toBe('2030-01-04');
    expect(() => header({ text: STATUS, where: 's' }, '99.0.1', 'IdentifierStatus.txt')).toThrow(/does not name Unicode 99.0.1/);
    expect(() => header({ text: FOLD, where: 'f' }, '98.0.0', 'CaseFolding.txt')).toThrow(/does not name Unicode 98.0.0/);
    expect(() => header({ text: CONF, where: 'c' }, '99.0.1', 'confusables.txt')).toThrow(/does not name Unicode 99.0.1/);
    expect(() => header({ text: '# CaseFolding-99.0.0.txt\n', where: 'f' }, '99.0.0', 'CaseFolding.txt')).toThrow(/no date/);
  });

  it('builds the tables with the "i" supplement, and their keys work', () => {
    const fresh = buildNameData(inputs(), '99.0.0');
    expect(fresh.unicodeVersion).toBe('99.0.0');
    expect(fresh.sources).toBe(`CaseFolding-99.0.0.txt (2030-01-02, 6 entries, SHA-256 ${sha(FOLD)}), confusables.txt (Version 99.0.0, ` +
      `2030-01-03, 3 entries, SHA-256 ${sha(CONF)}) and IdentifierStatus.txt (Version 99.0.0, 2030-01-04, ${parseIdentifierStatus(STATUS).size} ` +
      `Allowed code points, SHA-256 ${sha(STATUS)})`);
    expect(fresh.overrides).toBe('');
    expect(fresh.supplement).toBe('69>6c');
    const rules = createNameRules({ reservedNamesText: '', data: createNameData({ ...fresh, version: 1 }) });
    expect(rules.key('IMBA')).toBe('lrnba');
    expect(rules.key('1mba')).toBe('lrnba');
    expect(rules.key('imba')).toBe('lrnba');
    expect(rules.key('aß')).toBe(rules.key('ass'));
    expect(rules.key('A\u1E9E')).toBe('ass');
  });

  it('the derived table: a capital that looks like a basic Latin capital keys like it, with its small letter and that letter\'s look-alikes', () => {
    // Cyrillic EM: the capital looks like "M", the small letter like "\u028d" (turned w, a small capital M)
    const { fresh, rules } = rulesFrom([foldLine('\u041c', '\u043c')], [confLine('\u041c', 'M'), confLine('\u043c', '\u028d')]);
    for (const x of ['\u041c', '\u043c', '\u028d', 'M', 'm']) expect(rules.key(x), x).toBe('rn');
    expect(fresh.overrides).toBe('28d>72 6e\n41c>72 6e\n43c>72 6e');
    // without the closure (the plain tables), folding first would read the capital as its small letter
    const plain = createNameRules({ reservedNamesText: '', data: createNameData({ ...fresh, overrides: '', version: 1 }) });
    expect(plain.key('\u041c')).toBe('\u028d');
  });

  it('the derived table keeps letters of other scripts whose prototype is only separators; the apostrophe look-alikes of Common still vanish', () => {
    const { fresh, rules } = rulesFrom([], [confLine('\u05d9', "'"), confLine('\u02bc', "'")]);
    expect(fresh.overrides).toBe('5d9>5d9');
    expect(rules.key('\u05e9\u05d9\u05e8\u05d4')).toBe('\u05e9\u05d9\u05e8\u05d4'); // Shira keeps its yod
    expect(rules.key('\u05e9\u05d9\u05e8\u05d4')).not.toBe(rules.key('\u05e9\u05e8\u05d4')); // and is not Sarah
    expect(rules.key('B\u02bco\u02bcb')).toBe('bob');
    expect(fresh.notes).toContain('Kept as themselves (letters and marks of other scripts whose prototype is only separators): \u05d9 U+05D9.');
  });

  it('the closure follows no link that would make two letters of one script in use one name, nor two fixed keys one', () => {
    // Cyrillic SHHA looks like "h"; EN's capital looks like "H", its small letter like "\u029c": joining EN to "H" would make EN and SHHA one
    // letter, so the capital link is not followed and EN keys by its small letter, as before
    const fold = [foldLine('H', 'h'), foldLine('\u041d', '\u043d'), foldLine('\u04ba', '\u04bb')];
    const conf = [confLine('\u04bb', 'h'), confLine('\u041d', 'H'), confLine('\u043d', '\u029c')];
    const d = derive(fold, conf);
    expect(d.refused).toContainEqual({ from: '\u041d', to: 'H', kind: 'capital', why: 'script' });
    expect(d.problems).toEqual([]);
    const { rules } = rulesFrom(fold, conf);
    expect(rules.key('\u04bb')).toBe('h');
    expect(rules.key('\u041d')).toBe(rules.key('\u043d'));
    expect(rules.key('\u041d')).not.toBe(rules.key('\u04bb'));
    // Greek ETA: the capital looks like "H", the small letter like "n"; "n" and "h" are two fixed keys, so the capital keys by its small letter
    const eta = derive([foldLine('\u0397', '\u03b7')], [confLine('\u03b7', 'n'), confLine('\u0397', 'H')]);
    expect(eta.refused).toContainEqual({ from: '\u0397', to: 'H', kind: 'capital', why: 'key' });
    expect(rulesFrom([foldLine('\u0397', '\u03b7')], [confLine('\u03b7', 'n'), confLine('\u0397', 'H')]).rules.key('\u0397')).toBe('n');
  });

  it('a look-alike between two capitals that both have small letters is not followed (it would join the small letters)', () => {
    const fold = [foldLine('\u03a3', '\u03c3'), foldLine('\u01a9', '\u0283')];
    const conf = [confLine('\u03c3', 'o'), confLine('\u03a3', '\u01a9')];
    const d = derive(fold, conf);
    expect(d.refused).toContainEqual({ from: '\u03a3', to: '\u01a9', kind: 'other', why: 'small' });
    const { rules } = rulesFrom(fold, conf);
    expect(rules.key('\u03a3')).toBe('o');
    expect(rules.key('\u0283')).toBe('\u0283');
  });

  it('refuses tables in which an entry needs more than 3 rounds to settle, and writes nothing', () => {
    // a chain a → b → c → d → e: each round moves one step, so "a" changes in 4 rounds
    const chain = [CONF, '0061 ;\t0062 ;\tMA', '0062 ;\t0063 ;\tMA', '0063 ;\t0064 ;\tMA', '0064 ;\t0065 ;\tMA'].join('\n');
    expect(() => buildNameData(inputs(FOLD, chain), '99.0.0')).toThrow(/do not settle[\s\S]*U\+0061 settles only after 4 rounds/);
    // three steps settle
    const three = [CONF, '0061 ;\t0062 ;\tMA', '0062 ;\t0063 ;\tMA', '0063 ;\t0064 ;\tMA'].join('\n');
    expect(() => buildNameData(inputs(FOLD, three), '99.0.0')).not.toThrow();
  });

  it('plans the versions: 1 at first; the same version when nothing differs; one more, with the committed data moved to unicode-data-prev.ts', () => {
    const fresh = buildNameData(inputs(), '99.0.0');
    const first = planNameData(null, fresh);
    expect(first.next.version).toBe(1);
    expect(first.unchanged).toBe(false);
    expect(first.previous).toBe(renderModule('previous', null));
    expect(first.current).toContain('export const NAME_DATA_VERSION = 1;');

    const again = planNameData(first.next, fresh);
    expect(again.unchanged).toBe(true);
    expect(again.next.version).toBe(1);
    expect(again.previous).toBe(undefined);
    expect(again.current).toBe(first.current);

    const changed = buildNameData(inputs(FOLD, `${CONF}0071 ;\t0067 ;\tMA\n`), '99.0.0');
    const second = planNameData(first.next, changed);
    expect(second.unchanged).toBe(false);
    expect(second.next.version).toBe(2);
    expect(second.current).toContain('export const NAME_DATA_VERSION = 2;');
    expect(second.previous).toBe(renderModule('previous', first.next));
    expect(second.previous).toContain('export const PREVIOUS_UNICODE_DATA: GeneratedNameData | null = {\n  version: 1,');
    expect(second.previous).toContain('NAME_DATA_VERSION 1:');
  });

  it('renders the version and the Unicode version into the header and the exports', () => {
    const g: GeneratedNameData = { ...buildNameData(inputs(), '99.0.0'), version: 7 };
    const text = renderModule('current', g);
    expect(text).toContain(`export const TABLES_SHA256 = '${tablesSha256(g)}';`);
    expect(text).toContain(` * edit of a table shows: ${tablesSha256(g)}.`);
    expect(text).toContain(" * OpenMTG's derived table (not Unicode data), 0 entries,");
    expect(tablesSha256(g)).toBe(sha(`${g.supplement}\n${g.overrides}\n${g.caseFolding}\n${g.confusables}\n`));
    // any change to a table changes the digest
    for (const field of ['supplement', 'overrides', 'caseFolding', 'confusables'] as const) {
      expect(tablesSha256({ ...g, [field]: `${g[field] ?? ''}\n78>79` }), field).not.toBe(tablesSha256(g));
    }
    expect(text).toContain(' * Unicode 99.0.0, from CaseFolding-99.0.0.txt (2030-01-02, 6 entries, SHA-256');
    expect(text).toContain(' * NAME_DATA_VERSION 7: ');
    expect(text).toContain("export const NAME_DATA_VERSION = 7;\nexport const UNICODE_VERSION = '99.0.0';");
    expect(text).toContain('  supplement: `69>6c`,');
    expect(() => renderModule('current', null)).toThrow(/cannot be null/);
  });
});
