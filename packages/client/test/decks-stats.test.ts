/** Deckbuilder statistics: curve, colored symbols vs. land sources, types, land count; the Arena-style curve and type breakdown; card tones and keyword reminders. */
import { describe, expect, it } from 'vitest';
import { keywordReminders } from '../src/decks/keywords';
import { deckColors, deckSize, toneOf } from '../src/decks/look';
import { costPips, deckStats, landColors, subtypesOf } from '../src/decks/stats';
import { byName, card, deckFixture } from './decks-fixtures';

describe('deck stats', () => {
  it('CR 202.3: counts the curve of non-land cards by mana value, colored symbols, land sources, types and lands', () => {
    const s = deckStats(deckFixture(), byName);
    expect(s.curve).toEqual([0, 4, 4, 0, 0, 0, 0, 0]); // 4 Bolt at 1, 4 Bears at 2
    expect(s.pips).toEqual({ W: 0, U: 0, B: 0, R: 4, G: 4 });
    expect(s.sources).toEqual({ W: 0, U: 0, B: 0, R: 12, G: 2 }); // 10 Mountain + 2 Stomping Ground; Ground also makes G
    expect(s.lands).toBe(12);
    expect(s.types.Creature).toBe(4);
    expect(s.types.Instant).toBe(4);
    expect(s.types.Land).toBe(12);
    expect(s.notLoaded).toBe(0);
  });

  it('leaves out (and counts) cards whose data is not loaded, and ignores the sideboard', () => {
    const s = deckStats(deckFixture({ main: [{ name: 'Mystery Card', count: 3 }] }), byName);
    expect(s.notLoaded).toBe(3);
    expect(s.curve.every((n) => n === 0)).toBe(true);
  });

  it('CR 202.3: puts mana value 7 and more in the last bucket', () => {
    const big = card('Big', { cost: '{9}{G}', mv: 10, colors: ['G'] });
    expect(deckStats(deckFixture({ main: [{ name: 'Big', count: 1 }], sideboard: [] }), new Map([['Big', big]])).curve[7]).toBe(1);
  });

  it('CR 107.4e, 107.4f: reads hybrid and Phyrexian symbols for each of their colors', () => {
    expect(costPips('{1}{W/B}{W/B}')).toEqual({ W: 2, U: 0, B: 2, R: 0, G: 0 });
    expect(costPips('{G/P}{2/R}')).toEqual({ W: 0, U: 0, B: 0, R: 1, G: 1 });
    expect(costPips(null)).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0 });
  });

  it('CR 305.6: reads the colors a land makes from its basic land types and its text', () => {
    expect([...landColors(byName.get('Stomping Ground')!)].sort()).toEqual(['G', 'R']);
    expect(landColors(card('City of Brass', { type: 'Land', text: '{T}: Add one mana of any color.' })).size).toBe(5);
    expect(landColors(card('Wastes', { type: 'Basic Land', text: '{T}: Add {C}.' })).size).toBe(0);
  });
});

describe('Arena-style deck statistics (Deck Details)', () => {
  const elf = card('Elvish Mystic', { cost: '{G}', type: 'Creature — Elf Druid', mv: 1, colors: ['G'], pt: ['1', '1'] });
  const big = card('Big', { cost: '{9}{G}', type: 'Creature — Dragon', mv: 10, colors: ['G'] });
  const gate = card('Boros Guildgate', { type: 'Land — Gate' });
  const cards = new Map([...byName, ['Elvish Mystic', elf], ['Big', big], ['Boros Guildgate', gate]]);

  it('splits the six curve buckets (1 or less, 2, 3, 4, 5, 6 or more) into creatures and non-creatures, and averages the non-land mana value', () => {
    const deck = deckFixture({ main: [{ name: 'Elvish Mystic', count: 2 }, { name: 'Lightning Bolt', count: 3 }, { name: 'Grizzly Bears', count: 1 }, { name: 'Big', count: 1 }, { name: 'Mountain', count: 20 }] });
    const s = deckStats(deck, cards);
    expect(s.curveCreature).toEqual([2, 1, 0, 0, 0, 1]);
    expect(s.curveOther).toEqual([3, 0, 0, 0, 0, 0]);
    expect(s.spells).toBe(7);
    expect(s.average).toBeCloseTo((2 * 1 + 3 * 1 + 2 + 10) / 7);
  });

  it('CR 300.1: counts each card once under its first type, with subtypes (a land creature is a creature, an artifact land a land)', () => {
    const deck = deckFixture({
      main: [{ name: 'Elvish Mystic', count: 4 }, { name: 'Grizzly Bears', count: 2 }, { name: 'Big', count: 1 }, { name: 'Lightning Bolt', count: 3 }, { name: 'Boros Guildgate', count: 4 }, { name: 'Mountain', count: 7 }],
    });
    const g = deckStats(deck, cards).groups;
    expect(g.map((x) => [x.type, x.count])).toEqual([
      ['Creature', 7],
      ['Instant', 3],
      ['Land', 11],
    ]);
    expect(g[0]!.subtypes).toEqual([
      { name: 'Druid', count: 4 },
      { name: 'Elf', count: 4 },
      { name: 'Bear', count: 2 },
      { name: 'Dragon', count: 1 },
    ]);
    expect(g[1]!.subtypes).toEqual([]);
    expect(g[2]!.subtypes).toEqual([
      { name: 'Gate', count: 4 },
      { name: 'Mountain', count: 7 },
    ].sort((a, b) => b.count - a.count));
    expect(subtypesOf('Legendary Creature — Elf Druid')).toEqual(['Elf', 'Druid']);
    expect(subtypesOf('Instant')).toEqual([]);
  });

  it('gives each card a banner tone: its color, gold for several colors, grey tones for lands, artifacts and colorless cards', () => {
    expect(toneOf(byName.get('Lightning Bolt'))).toBe('R');
    expect(toneOf(byName.get('Boros Charm'))).toBe('multi');
    expect(toneOf(byName.get('Mountain'))).toBe('land');
    expect(toneOf(card('Sol Ring', { cost: '{1}', type: 'Artifact' }))).toBe('artifact');
    expect(toneOf(card('Eldrazi', { type: 'Creature — Eldrazi' }))).toBe('colorless');
    expect(toneOf(undefined)).toBe('colorless');
  });

  it("lists a deck's colors from its spells, in WUBRG order, and the card count a format is built to", () => {
    const deck = deckFixture({ main: [{ name: 'Lightning Bolt', count: 1 }, { name: 'Grizzly Bears', count: 1 }, { name: 'Boros Charm', count: 1 }, { name: 'Mountain', count: 1 }] });
    expect(deckColors(deck, byName)).toEqual(['W', 'R', 'G']);
    expect(deckColors(deckFixture({ main: [{ name: 'Mountain', count: 20 }] }), byName)).toEqual([]);
    expect([deckSize('modern'), deckSize('casual'), deckSize('commander'), deckSize('duel')]).toEqual([60, 60, 100, 100]);
  });

  it('reads keyword reminders from a card\'s rules text, not from reminder text in parentheses', () => {
    const angel = card('Serra Angel', { type: 'Creature — Angel', text: 'Flying, vigilance', colors: ['W'] });
    expect(keywordReminders(angel).map((k) => [k.keyword, k.rule])).toEqual([
      ['Flying', 'CR 702.9'],
      ['Vigilance', 'CR 702.20'],
    ]);
    expect(keywordReminders(angel)[0]!.text).toBe("A creature with flying can't be blocked except by creatures with flying or reach.");
    expect(keywordReminders(card('Plain', { text: 'Reach\nWhen this enters, scry 2. (Look at the top two cards. It has flying only in this sentence.)' })).map((k) => k.keyword)).toEqual(['Reach', 'Scry']);
    expect(keywordReminders(card('Grudge', { text: 'Destroy target artifact.\nFlashback {G}' })).map((k) => k.keyword)).toEqual(['Flashback']);
    expect(keywordReminders(card('Vanilla', { text: '' }))).toEqual([]);
    expect(keywordReminders(card('Double', { text: 'Double strike' })).map((k) => k.keyword)).toEqual(['Double strike']);
  });
});
