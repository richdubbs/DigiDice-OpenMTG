import { describe, expect, it } from 'vitest';
import { parseDecklist, totalCount } from '../src/decklist';

const names = (l: { name: string; count: number }[]) => l.map((e) => `${e.count} ${e.name}`);

describe('decklist parser', () => {
  it('parses counts, "4x", no count, and split names', () => {
    const d = parseDecklist('4 Lightning Bolt\n4x Mountain\n2 x Shock\nCounterspell\n1 Fire // Ice\n');
    expect(names(d.main)).toEqual(['4 Lightning Bolt', '4 Mountain', '2 Shock', '1 Counterspell', '1 Fire // Ice']);
    expect(d.errors).toEqual([]);
    expect(d.sideboard).toEqual([]);
  });

  it('records 1-based line numbers', () => {
    const d = parseDecklist('# c\n\n4 Lightning Bolt\n1 Shock\n  \n2 Fog');
    expect(d.main.map((e) => e.line)).toEqual([3, 4]);
    expect(d.sideboard.map((e) => e.line)).toEqual([6]);
  });

  it('parses Arena/MTGO set and collector number suffixes', () => {
    const d = parseDecklist('4 Lightning Bolt (M10) 146\n3 Shock (M19)\n1 Fire // Ice (MH2) 290\n1 Plains (PLST) 12 *F*\n');
    expect(d.main.map((e) => [e.name, e.set, e.collectorNumber])).toEqual([
      ['Lightning Bolt', 'M10', '146'],
      ['Shock', 'M19', undefined],
      ['Fire // Ice', 'MH2', '290'],
      ['Plains', 'PLST', '12'],
    ]);
  });

  it('keeps parentheses that are not set codes', () => {
    const d = parseDecklist("1 Erase (Not the Urza's Legacy One)");
    expect(d.main[0]!.name).toBe("Erase (Not the Urza's Legacy One)");
  });

  it('handles section headers (Deck, Sideboard, Commander, Companion, Maybeboard)', () => {
    const d = parseDecklist(
      "Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n4 Shock\n\nSideboard\n2 Disenchant\n\nCompanion\n1 Lurrus of the Dream-Den\n\nMaybeboard\n1 Counterspell\n",
    );
    expect(names(d.commander)).toEqual(["1 Atraxa, Praetors' Voice"]);
    expect(names(d.main)).toEqual(['4 Shock']);
    expect(names(d.sideboard)).toEqual(['2 Disenchant']);
    expect(names(d.companion)).toEqual(['1 Lurrus of the Dream-Den']);
    expect(names(d.maybeboard)).toEqual(['1 Counterspell']);
  });

  it('accepts Main / Mainboard / "Sideboard:" header variants, case-insensitively', () => {
    const d = parseDecklist('MAINBOARD\n4 Shock\nsideboard:\n1 Fog');
    expect(names(d.main)).toEqual(['4 Shock']);
    expect(names(d.sideboard)).toEqual(['1 Fog']);
  });

  it('treats a blank line as the sideboard separator (MTGO format) when there are no headers', () => {
    const d = parseDecklist('4 Shock\n4 Lightning Bolt\n\n2 Disenchant\n1 Fog\n');
    expect(names(d.main)).toEqual(['4 Shock', '4 Lightning Bolt']);
    expect(names(d.sideboard)).toEqual(['2 Disenchant', '1 Fog']);
  });

  it('does not treat blank lines as the sideboard separator when headers are used', () => {
    const d = parseDecklist('Deck\n4 Shock\n\n4 Lightning Bolt\n');
    expect(names(d.main)).toEqual(['4 Shock', '4 Lightning Bolt']);
    expect(d.sideboard).toEqual([]);
  });

  it('ignores leading blank lines and repeated blank lines', () => {
    const d = parseDecklist('\n\n4 Shock\n\n\n\n1 Fog\n');
    expect(names(d.main)).toEqual(['4 Shock']);
    expect(names(d.sideboard)).toEqual(['1 Fog']);
  });

  it('supports the "SB:" prefix', () => {
    const d = parseDecklist('4 Shock\nSB: 2 Disenchant\nSB: Fog');
    expect(names(d.sideboard)).toEqual(['2 Disenchant', '1 Fog']);
  });

  it('skips // and # comment lines but not split-card names', () => {
    const d = parseDecklist('// my burn deck\n# another comment\n4 Shock\n1 Wear // Tear\n  // indented comment');
    expect(names(d.main)).toEqual(['4 Shock', '1 Wear // Tear']);
    expect(d.errors).toEqual([]);
  });

  it('copes with stray whitespace, tabs, NBSP, CRLF, BOM and a missing final newline', () => {
    const d = parseDecklist('﻿  4   Lightning   Bolt  \r\n\t2\tShock\r\n1 Fog');
    expect(names(d.main)).toEqual(['4 Lightning Bolt', '2 Shock', '1 Fog']);
  });

  it('ignores the Arena "About" block', () => {
    const d = parseDecklist('About\nName Burn Deck\n\nDeck\n4 Shock\n');
    expect(names(d.main)).toEqual(['4 Shock']);
    expect(d.errors).toEqual([]);
  });

  it('reports per-line errors with line numbers and keeps going', () => {
    const d = parseDecklist('4 Shock\n0 Fog\n12\n5000 Island\n!!!\n2 Counterspell');
    expect(names(d.main)).toEqual(['4 Shock', '2 Counterspell']);
    expect(d.errors.map((e) => e.line)).toEqual([2, 3, 4, 5]);
    expect(d.errors[0]!.message).toMatch(/at least 1/);
    expect(d.errors[1]!.message).toMatch(/Missing card name/);
    expect(d.errors[2]!.message).toMatch(/large/);
  });

  it('does not mistake card names that start with x for counts', () => {
    const d = parseDecklist('4 Xenagos, God of Revels\n1 Xira\n');
    expect(names(d.main)).toEqual(['4 Xenagos, God of Revels', '1 Xira']);
  });

  it('totalCount sums counts', () => {
    expect(totalCount(parseDecklist('4 Shock\n3 Fog').main)).toBe(7);
  });

  it('returns empty lists for empty input', () => {
    const d = parseDecklist('');
    expect(d.main).toEqual([]);
    expect(d.errors).toEqual([]);
  });
});
