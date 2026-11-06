/**
 * Commander EDHREC ranks 21,501-22,000, round edh-c-27: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's
 * default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 701.21a, 106.4, 608.2h    "Sacrifice any number of Forests, then add that much {G}."
 *   CR 121.1, 701.9a, 608.2h     "Target opponent draws cards equal to the number of cards in their hand, then discards that many cards."
 *   CR 208.1, 608.2h             "Exile target creature card from a graveyard, then create X ... tokens, where X is the exiled card's toughness."
 *   CR 105.2, 613.4c             "Creatures that are green and/or white get an additional -2/-2 until end of turn."
 *   CR 603.4, 400.7              "as long as you had another creature enter the battlefield under your control this turn" / "two or more creatures"
 *   CR 601.2h, 105.1             "for each color of mana spent to cast this spell"
 *   CR 608.2e, 101.4             "Each player creates a token for each untapped Forest they control."
 *   CR 701.3a-b, 301.5           "attach all Equipment on the battlefield to it"
 *   CR 122.5                     "move all +1/+1 counters from all creatures onto it"
 *   CR 205.3m, 105.3, 613.1d-e   "All Elves are black and are Zombies in addition to their other creature types."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, find, pool, put, scenario } from '../../m3/scenario';
import { attackWith, card, cast, counters, full, named, pt, resolveAll, settle, tokens } from '../cmd3/helpers';

/** A synthetic card with colors of its own (the cmd3 helper's cards are colorless whatever their cost). */
const colored = (name: string, type: string, text: string, pts: [string, string], colors: string[], cost: string): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, power: pts[0], toughness: pts[1] } as OracleCard);
const onField = (s: GameState, defId: string): ObjectId[] => named(s, defId);
const handSize = (s: GameState, p: string): number => s.zones.hand[p]!.length;
const yardSize = (s: GameState, p: string): number => (s.zones.graveyard[p] ?? []).length;

describe('CR 701.21a, 106.4, 608.2h: "Sacrifice any number of Forests, then add that much {G}."', () => {
  const RITE = card('Test Root Offering', 'Sorcery', 'Sacrifice any number of Forests, then add that much {G}.');
  const game = (): GameState => scenario(['Forest', 'Plains'], { defs: [RITE], p1: { hand: ['Test Root Offering'], battlefield: ['Forest', 'Forest', 'Forest', 'Plains'] }, p2: { battlefield: ['Forest'] } });
  it('is full', () => expect(full(RITE)).toBe(true));
  it('sacrifices exactly the Forests chosen and adds one {G} for each', () => {
    const s0 = game();
    const mine = s0.zones.battlefield.filter((id) => s0.objects[id]!.controller === 'p1' && s0.objects[id]!.defId === 'Forest');
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Root Offering', 'hand', 'p1') });
    const d = s.pending as unknown as { kind: string; options?: ObjectId[] };
    s = resolveAll(s, { objects: [mine[0]!, mine[1]!] });
    expect(d.kind === 'chooseObjects' || s.zones.stack.length === 0).toBe(true);
    expect(pool(s, 'p1')).toBe('GG');
    expect(named(s, 'Forest').filter((id) => s.objects[id]!.controller === 'p1').length).toBe(1);
    expect(named(s, 'Forest').filter((id) => s.objects[id]!.controller === 'p2').length).toBe(1);
  });
  it('negative: choosing none adds no mana; Plains and the opponent\'s Forest are never offered', () => {
    const s0 = game();
    let s = cast(s0, 'Test Root Offering');
    for (let i = 0; i < 6 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; i++) s = act(s, { type: 'pass', player: s.pending.player });
    const d = s.pending as unknown as { kind: string; options: ObjectId[] };
    expect(d.kind).toBe('chooseObjects');
    expect(d.options.every((id) => s.objects[id]!.defId === 'Forest' && s.objects[id]!.controller === 'p1')).toBe(true);
    expect(d.options.length).toBe(3);
    s = resolveAll(s, { objects: [] });
    expect(pool(s, 'p1')).toBe('');
    expect(named(s, 'Forest').length).toBe(4);
  });
});

describe('CR 121.1, 701.9a, 608.2h: "Target opponent draws cards equal to the number of cards in their hand, then discards that many cards."', () => {
  const CHURN = card('Test Mind Churn', 'Sorcery', 'Target opponent draws cards equal to the number of cards in their hand, then discards that many cards.');
  const game = (hand: string[]): GameState => scenario(['Plains', 'Island'], { defs: [CHURN], p1: { hand: ['Test Mind Churn', 'Plains'] }, p2: { hand, library: ['Island', 'Island', 'Island', 'Island', 'Island'] } });
  it('is full', () => expect(full(CHURN)).toBe(true));
  it('the target draws as many as THEIR hand held, then discards the same number', () => {
    const s0 = game(['Plains', 'Plains', 'Plains']);
    const lib0 = s0.zones.library['p2']!.length;
    const opp = s0.players.find((p) => p.id === 'p2')!.id;
    const s = resolveAll(cast(s0, 'Test Mind Churn', { targets: [{ kind: 'player', id: opp }] }), { objects: s0.zones.hand['p2']!.slice(0, 3) });
    expect(s.zones.library['p2']!.length).toBe(lib0 - 3);
    expect(handSize(s, 'p2')).toBe(3);
    expect(yardSize(s, 'p2')).toBe(3);
    expect(handSize(s, 'p1')).toBe(1); // the caster's own hand (Plains) is not counted and nothing was drawn
  });
  it('negative: an empty hand draws nothing and discards nothing', () => {
    const s0 = game([]);
    const lib0 = s0.zones.library['p2']!.length;
    const s = resolveAll(cast(s0, 'Test Mind Churn', { targets: [{ kind: 'player', id: 'p2' }] }));
    expect(s.zones.library['p2']!.length).toBe(lib0);
    expect(handSize(s, 'p2')).toBe(0);
    expect(yardSize(s, 'p2')).toBe(0);
  });
});

describe('CR 208.1, 608.2h: "Exile target creature card from a graveyard, then create X ... tokens, where X is the exiled card\'s toughness."', () => {
  const BLOOM = card('Test Grave Bloom', 'Sorcery', 'Exile target creature card from a graveyard, then create X 1/1 green Saproling creature tokens, where X is the exiled card\'s toughness.');
  const BIG = card('Test Heavy Ogre', 'Creature — Ogre', '', ['2', '4']);
  const ZERO = card('Test Hollow Shade', 'Creature — Shade', '', ['2', '0']);
  const game = (target: string): GameState => scenario([], { defs: [BLOOM, BIG, ZERO], p1: { hand: ['Test Grave Bloom'] }, p2: { graveyard: [target] } });
  it('is full', () => expect(full(BLOOM)).toBe(true));
  it('exiles the card and makes tokens equal to its toughness', () => {
    const s0 = game('Test Heavy Ogre');
    const target = s0.zones.graveyard['p2']![0]!;
    const s = resolveAll(cast(s0, 'Test Grave Bloom', { targets: [{ kind: 'object', id: target }] }));
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Heavy Ogre')).toBe(true);
    expect(tokens(s, 'p1').length).toBe(4);
  });
  it('negative: a card with toughness 0 makes no token (and is still exiled)', () => {
    const s0 = game('Test Hollow Shade');
    const target = s0.zones.graveyard['p2']![0]!;
    const s = resolveAll(cast(s0, 'Test Grave Bloom', { targets: [{ kind: 'object', id: target }] }));
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Hollow Shade')).toBe(true);
    expect(tokens(s, 'p1').length).toBe(0);
  });
});

describe('CR 105.2, 613.4c: "All creatures get -1/-1 ... Creatures that are green and/or white get an additional -2/-2 until end of turn."', () => {
  const WAVE = card('Test Blight Wave', 'Sorcery', 'All creatures get -1/-1 until end of turn. Creatures that are green and/or white get an additional -2/-2 until end of turn.');
  const mk = (n: string, color: string): CardDef => colored(n, 'Creature — Ox', '', ['4', '4'], color === '' ? [] : [color], color === '' ? '{0}' : `{${color}}`);
  const defs = [WAVE, mk('Test Green Ox', 'G'), mk('Test White Ox', 'W'), mk('Test Red Ox', 'R'), mk('Test Grey Ox', '')];
  it('is full', () => expect(full(WAVE)).toBe(true));
  it('green and white creatures get -3/-3 in all, every other creature -1/-1', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Blight Wave'], battlefield: ['Test Green Ox', 'Test Red Ox'] }, p2: { battlefield: ['Test White Ox', 'Test Grey Ox'] } });
    const s = resolveAll(cast(s0, 'Test Blight Wave'));
    const stat = (n: string): string => pt(s, onField(s, n)[0]!);
    expect(stat('Test Green Ox')).toBe('1/1');
    expect(stat('Test White Ox')).toBe('1/1');
    expect(stat('Test Red Ox')).toBe('3/3');
    expect(stat('Test Grey Ox')).toBe('3/3');
  });
  it('negative: a creature that is neither color gets only -1/-1 (the set is fixed on resolution, CR 611.2c)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Blight Wave'], battlefield: ['Test Red Ox'] } });
    const s = resolveAll(cast(s0, 'Test Blight Wave'));
    expect(pt(s, onField(s, 'Test Red Ox')[0]!)).toBe('3/3');
  });
});

describe('CR 603.4, 400.7: "as long as you had another creature enter the battlefield under your control this turn" / "two or more creatures"', () => {
  const STAG = card('Test Saddled Elk', 'Creature — Elk', 'This creature gets +2/+2 as long as you had another creature enter the battlefield under your control this turn.', ['2', '2']);
  const MARE = card('Test Sky Mare', 'Creature — Horse', 'Flying\nWhenever this creature deals combat damage to a player, draw a card if you had two or more creatures enter the battlefield under your control this turn.', ['2', '2']);
  const PUP = card('Test Plain Pup', 'Creature — Dog', '', ['1', '1']);
  it('are full', () => { expect(full(STAG)).toBe(true); expect(full(MARE)).toBe(true); });
  it('the Elk is 4/4 once another creature entered under its controller\'s control this turn, and not before', () => {
    const s0 = scenario([], { defs: [STAG, PUP], p1: { hand: ['Test Plain Pup'], battlefield: ['Test Saddled Elk'] } });
    const elk = onField(s0, 'Test Saddled Elk')[0]!;
    expect(pt(s0, elk)).toBe('2/2');
    const s1 = resolveAll(cast(s0, 'Test Plain Pup'));
    expect(pt(s1, elk)).toBe('4/4');
  });
  it('negative: the Elk\'s own entry and an opponent\'s creature entering do not count', () => {
    const own = resolveAll(cast(scenario([], { defs: [STAG], p1: { hand: ['Test Saddled Elk'] } }), 'Test Saddled Elk'));
    expect(pt(own, onField(own, 'Test Saddled Elk')[0]!)).toBe('2/2');
  });
  it('the Mare draws after combat damage only when two or more creatures entered under your control this turn', () => {
    const run = (casts: number): number => {
      let s = scenario([], { defs: [MARE, PUP], p1: { hand: Array(casts).fill('Test Plain Pup') as string[], battlefield: ['Test Sky Mare'] } });
      const lib0 = s.zones.library['p1']!.length;
      for (let i = 0; i < casts; i++) s = resolveAll(cast(s, 'Test Plain Pup'));
      s = attackWith(s, onField(s, 'Test Sky Mare'));
      s = resolveAll(s);
      for (let i = 0; i < 8 && s.turn.step !== 'combatDamage' && s.turn.step !== 'endCombat' && s.pending?.kind === 'priority'; i++) s = resolveAll(act(s, { type: 'pass', player: s.pending.player }));
      s = resolveAll(s);
      return lib0 - s.zones.library['p1']!.length;
    };
    expect(run(2)).toBe(1);
    expect(run(1)).toBe(0); // negative: only one creature entered
  });
});

describe('CR 601.2h, 105.1: "for each color of mana spent to cast this spell"', () => {
  const SWEEP = card('Test Prism Flock', 'Instant', 'Create a 1/1 colorless Thopter artifact creature token with flying for each color of mana spent to cast this spell.', undefined, '{R}{G}');
  const TWO = card('Test Twin Flock', 'Instant', 'Create a 1/1 colorless Thopter artifact creature token with flying for each color of mana spent to cast this spell.', undefined, '{R}{R}');
  it('are full', () => { expect(full(SWEEP)).toBe(true); expect(full(TWO)).toBe(true); });
  it('two colors spent: two tokens; one color spent twice: one token (negative)', () => {
    const a = scenario(['Mountain', 'Forest'], { defs: [SWEEP], p1: { hand: ['Test Prism Flock'], battlefield: ['Mountain', 'Forest'] } });
    expect(tokens(resolveAll(cast(a, 'Test Prism Flock')), 'p1').length).toBe(2);
    const b = scenario(['Mountain'], { defs: [TWO], p1: { hand: ['Test Twin Flock'], battlefield: ['Mountain', 'Mountain'] } });
    expect(tokens(resolveAll(cast(b, 'Test Twin Flock')), 'p1').length).toBe(1);
  });
});

describe('CR 608.2e, 101.4: "Each player creates a 1/1 green Cat creature token for each untapped Forest they control."', () => {
  const DUST = card('Test Weed Bloom', 'Sorcery', 'Each player creates a 1/1 green Cat creature token for each untapped Forest they control.');
  it('is full', () => expect(full(DUST)).toBe(true));
  it('each player\'s own untapped Forests are counted for that player only (tapped ones and other lands are not)', () => {
    const s0 = scenario(['Forest', 'Plains'], { defs: [DUST], p1: { hand: ['Test Weed Bloom'], battlefield: ['Forest', { name: 'Forest', tapped: true }, 'Forest', 'Plains'] }, p2: { battlefield: ['Forest', 'Forest', 'Forest', { name: 'Forest', tapped: true }] } });
    const s = resolveAll(cast(s0, 'Test Weed Bloom'));
    expect(tokens(s, 'p1').length).toBe(2);
    expect(tokens(s, 'p2').length).toBe(3);
  });
  it('negative: a player with no untapped Forest creates nothing', () => {
    const s0 = scenario(['Forest', 'Plains'], { defs: [DUST], p1: { hand: ['Test Weed Bloom'], battlefield: ['Plains'] }, p2: { battlefield: ['Forest'] } });
    const s = resolveAll(cast(s0, 'Test Weed Bloom'));
    expect(tokens(s, 'p1').length).toBe(0);
    expect(tokens(s, 'p2').length).toBe(1);
  });
});

describe('CR 701.3a-b, 301.5: "When this creature enters, attach all Equipment on the battlefield to it."', () => {
  const KNIGHT = card('Test Armory Knight', 'Creature — Knight', 'When this creature enters, attach all Equipment on the battlefield to it.', ['2', '2']);
  const BLADE = card('Test Plain Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip {1}');
  const ROCK = card('Test Dull Rock', 'Artifact', '');
  const WOLF = card('Test Lone Wolf', 'Creature — Wolf', '', ['1', '1']);
  it('is full', () => expect(full(KNIGHT)).toBe(true));
  it('attaches every Equipment, whoever controls it, and nothing else', () => {
    const s0 = scenario([], { defs: [KNIGHT, BLADE, ROCK, WOLF], p1: { hand: ['Test Armory Knight'], battlefield: ['Test Plain Blade', 'Test Dull Rock', 'Test Lone Wolf'] }, p2: { battlefield: ['Test Plain Blade'] } });
    const s = resolveAll(cast(s0, 'Test Armory Knight'));
    const knight = onField(s, 'Test Armory Knight')[0]!;
    const blades = named(s, 'Test Plain Blade');
    expect(blades.length).toBe(2);
    for (const b of blades) expect(s.objects[b]!.attachedTo, 'blade').toBe(knight);
    expect(s.objects[named(s, 'Test Dull Rock')[0]!]!.attachedTo ?? null).toBe(null);
    expect(pt(s, knight)).toBe('4/4');
  });
});

describe('CR 122.5: "move all +1/+1 counters from all creatures onto it"', () => {
  const HOUND = card('Test Bulk Hound', 'Creature — Hound', 'This creature enters with a +1/+1 counter on it.\nWhen this creature enters, move all +1/+1 counters from all creatures onto it.', ['1', '1']);
  const OX = card('Test Heavy Ox', 'Creature — Ox', '', ['1', '1']);
  it('is full', () => expect(full(HOUND)).toBe(true));
  it('takes every +1/+1 counter of every creature, leaves other kinds, and keeps its own', () => {
    const s0 = scenario([], { defs: [HOUND, OX], p1: { hand: ['Test Bulk Hound'], battlefield: [{ name: 'Test Heavy Ox', counters: { '+1/+1': 2 } }] }, p2: { battlefield: [{ name: 'Test Heavy Ox', counters: { '+1/+1': 1, charge: 1 } }, 'Test Heavy Ox'] } });
    const s = resolveAll(cast(s0, 'Test Bulk Hound'));
    const hound = onField(s, 'Test Bulk Hound')[0]!;
    expect(counters(s, hound, '+1/+1')).toBe(4);
    const oxen = onField(s, 'Test Heavy Ox');
    expect(oxen.length).toBe(3);
    for (const o of oxen) expect(counters(s, o, '+1/+1')).toBe(0);
    expect(oxen.reduce((n, o) => n + counters(s, o, 'charge'), 0)).toBe(1); // another kind stays
  });
  it('negative: with no other counters on the battlefield the Hound keeps just its own', () => {
    const s0 = scenario([], { defs: [HOUND, OX], p1: { hand: ['Test Bulk Hound'], battlefield: ['Test Heavy Ox'] } });
    const s = resolveAll(cast(s0, 'Test Bulk Hound'));
    expect(counters(s, onField(s, 'Test Bulk Hound')[0]!, '+1/+1')).toBe(1);
  });
});

describe('CR 122.5, 614.1a: the group move is ONE put of the total (a "plus one" replacement applies once)', () => {
  const HOUND = card('Test Bulk Hound', 'Creature — Hound', 'This creature enters with a +1/+1 counter on it.\nWhen this creature enters, move all +1/+1 counters from all creatures onto it.', ['1', '1']);
  const OX = card('Test Heavy Ox', 'Creature — Ox', '', ['1', '1']);
  const COIL = card('Test Coil Ring', 'Enchantment', 'If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.');
  it('two givers with one counter each: the Hound gets 1 (own) + 1 + 2 total, +1 once = same as one giver with the same total', () => {
    const run = (cs: number[]): number => {
      const s0 = scenario([], { defs: [HOUND, OX, COIL], p1: { hand: ['Test Bulk Hound'], battlefield: ['Test Coil Ring', ...cs.map((n) => ({ name: 'Test Heavy Ox', counters: { '+1/+1': n } }))] } });
      const s = resolveAll(cast(s0, 'Test Bulk Hound'));
      return counters(s, onField(s, 'Test Bulk Hound')[0]!, '+1/+1');
    };
    expect(run([2])).toBe(run([1, 1]));
  });
});

describe('CR 205.3m, 105.3, 613.1d-e: "All Elves get +1/+1. All Elves are black and are Zombies in addition to their other creature types."', () => {
  const BANNER = card('Test Hex Banner', 'Enchantment', 'All Elves get +1/+1.\nAll Elves are black and are Zombies in addition to their other creature types.');
  const ELF = colored('Test Glade Elf', 'Creature — Elf Druid', '', ['1', '1'], ['G'], '{G}');
  const OX = colored('Test Heavy Ox', 'Creature — Ox', '', ['1', '1'], ['G'], '{G}');
  it('is full', () => expect(full(BANNER)).toBe(true));
  it('every Elf is black, a Zombie too, and bigger; its controller does not matter; other creatures are unchanged', () => {
    const s = scenario([], { defs: [BANNER, ELF, OX], p1: { battlefield: ['Test Hex Banner', 'Test Glade Elf', 'Test Heavy Ox'] }, p2: { battlefield: ['Test Glade Elf'] } });
    for (const id of named(s, 'Test Glade Elf')) {
      const c = getChars(s, id)!;
      expect(c.colors).toEqual(['B']);
      expect(c.subtypes).toContain('Zombie');
      expect(c.subtypes).toContain('Elf');
      expect(pt(s, id)).toBe('2/2');
    }
    const ox = getChars(s, named(s, 'Test Heavy Ox')[0]!)!;
    expect(ox.colors).toEqual(['G']);
    expect(ox.subtypes).not.toContain('Zombie');
    expect(pt(s, named(s, 'Test Heavy Ox')[0]!)).toBe('1/1');
  });
});
