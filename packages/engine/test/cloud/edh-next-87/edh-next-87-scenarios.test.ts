/**
 * Top-rank round 3, edh-next-87 (code edhn87): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names, design 6.10).
 * Each test is named after the rule it checks, with its negative case. CR cites are from memory of the 2026-09-25 text (no rules/cr folder in this session): unverified.
 *
 *   CR 608.2c, 115.1     "Whenever you cast a black spell, you may destroy target creature if it's tapped." (Deathbringer Liege)
 *   CR 202.3, 608.2c     "Draw two cards. Then discard a card unless there are five or more mana values among cards in your graveyard." (Tainted Indulgence)
 *   CR 120.3, 122.1      "Put a number of +1/+1 counters on it equal to the damage dealt." (Primo, the Unbounded)
 *   CR 701.23a, 201.2    "Search your graveyard, hand, and library for a card named X, put it onto the battlefield, then shuffle." (Kassandra, Eagle Bearer)
 *   CR 608.2c, 614.1     "Exile the top card of your library. If it's a permanent card, you may put it onto the battlefield. If you do, repeat this process." (Primal Surge)
 *   CR 603.2, 700.4      "Whenever ~ or another nontoken artifact you control is put into a graveyard from the battlefield or is put into exile from the battlefield, ..." (Slagstone Refinery)
 *   CR 608.2c, 701.21a   "Whenever a creature is put into your graveyard from the battlefield, you may sacrifice this enchantment. If you do, return that card to the battlefield." (Angelic Renewal)
 *   CR 702.165a          "Backup 1, backup 1, backup 1" (Conclave Sledge-Captain)
 */
import { describe, expect, it } from 'vitest';
import { getChars } from '../../../src/index';
import { hasKeyword } from '../../../src/rules/characteristics';
import type { GameState, ObjectId } from '../../../src/index';
import { attackWith, card, cast, drive, find, full, named, obj, resolveAll, scenario } from '../r4-cost/support';
import { passBoth } from '../../m3/scenario';

const zoneNames = (s: GameState, zone: 'graveyard' | 'hand' | 'library', p: 'p1' | 'p2' = 'p1'): string[] => s.zones[zone][p]!.map((id) => s.objects[id]!.defId);
const hasTrample = (s: GameState, id: ObjectId): boolean => hasKeyword(getChars(s, id)!, 'trample');

// ---- Deathbringer Liege ------------------------------------------------------------------------------------------------------------------------------------
describe('CR 608.2c, 115.1: "Whenever you cast a black spell, you may destroy target creature if it\'s tapped." ("it" is the target, not the spell cast)', () => {
  const LIEGE = card('Test Liege', 'Creature — Horror', 'Whenever you cast a black spell, you may destroy target creature if it\'s tapped.', '{1}', ['2', '2']);
  const BLACK = card('Test Black Spell', 'Sorcery', 'You gain 1 life.', '{0}', undefined, ['B']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const defs = [LIEGE, BLACK, BEAR];
  const board = (tapped: boolean): GameState => scenario([], { defs, p1: { hand: ['Test Black Spell'], battlefield: ['Test Liege'] }, p2: { battlefield: [{ name: 'Test Bear', tapped }] } });
  it('is full', () => expect(full(LIEGE)).toBe(true));
  it('destroys the target creature when it is tapped', () => {
    const s0 = board(true);
    const bear = named(s0, 'Test Bear')[0]!;
    const s = resolveAll(cast(s0, 'Test Black Spell', { yes: [true], targets: [[obj(bear)]] }), { yes: [true], targets: [[obj(bear)]] });
    expect(named(s, 'Test Bear').length).toBe(0);
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Bear']);
  });
  it('negative: an untapped target creature is not destroyed (the condition is about the target, not the spell)', () => {
    const s0 = board(false);
    const bear = named(s0, 'Test Bear')[0]!;
    const s = resolveAll(cast(s0, 'Test Black Spell', { yes: [true], targets: [[obj(bear)]] }), { yes: [true], targets: [[obj(bear)]] });
    expect(named(s, 'Test Bear').length).toBe(1);
  });
  it('negative: declining the option destroys nothing', () => {
    const s0 = board(true);
    const bear = named(s0, 'Test Bear')[0]!;
    const s = resolveAll(cast(s0, 'Test Black Spell', { yes: [false], targets: [[obj(bear)]] }), { yes: [false], targets: [[obj(bear)]] });
    expect(named(s, 'Test Bear').length).toBe(1);
  });
});

// ---- Tainted Indulgence ------------------------------------------------------------------------------------------------------------------------------------
describe('CR 202.3, 608.2c: "Draw two cards. Then discard a card unless there are five or more mana values among cards in your graveyard."', () => {
  const SPELL = card('Test Indulgence', 'Instant', 'Draw two cards. Then discard a card unless there are five or more mana values among cards in your graveyard.', '{0}');
  const costs = ['{0}', '{1}', '{2}', '{3}', '{4}', '{5}'];
  const fodder = costs.map((c, i) => card(`Test Fodder ${i}`, 'Artifact', '', c));
  const defs = [SPELL, ...fodder];
  const withGraveyard = (n: number): GameState => scenario([], { defs, p1: { hand: ['Test Indulgence'], graveyard: fodder.slice(0, n).map((d) => d.name) } });
  it('is full', () => expect(full(SPELL)).toBe(true));
  it('with four different mana values in the graveyard the controller draws two and discards one', () => {
    const s = resolveAll(cast(withGraveyard(4), 'Test Indulgence'));
    expect(zoneNames(s, 'hand').length).toBe(1);
  });
  it('with five different mana values in the graveyard nothing is discarded', () => {
    const s = resolveAll(cast(withGraveyard(5), 'Test Indulgence'));
    expect(zoneNames(s, 'hand').length).toBe(2);
  });
  it('negative: cards of the same mana value count once (six cards of two values do not reach five)', () => {
    const twins = [0, 1, 2, 3, 4, 5].map((i) => card(`Test Twin ${i}`, 'Artifact', '', i % 2 === 0 ? '{1}' : '{2}'));
    const s0 = scenario([], { defs: [SPELL, ...twins], p1: { hand: ['Test Indulgence'], graveyard: twins.map((d) => d.name) } });
    const s = resolveAll(cast(s0, 'Test Indulgence'));
    expect(zoneNames(s, 'hand').length).toBe(1);
  });
});

// ---- Primo, the Unbounded ----------------------------------------------------------------------------------------------------------------------------------
describe('CR 120.3, 122.1: "Whenever one or more creatures you control with base power 0 deal combat damage to a player, create a 0/0 ... Fractal creature token. Put a number of +1/+1 counters on it equal to the damage dealt."', () => {
  const TEXT = 'Whenever one or more creatures you control with base power 0 deal combat damage to a player, create a 0/0 green and blue Fractal creature token. Put a number of +1/+1 counters on it equal to the damage dealt.';
  const PRIMO = card('Test Primo', 'Legendary Creature — Fractal Wolf', TEXT, '{1}', ['3', '3']);
  const BAT = card('Test Zero Bat', 'Creature — Bat', '', '{1}', ['0', '2']);
  const defs = [PRIMO, BAT];
  it('is full', () => expect(full(PRIMO)).toBe(true));
  it('a base power 0 creature with three +1/+1 counters deals 3: the token enters with 3 counters', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Primo', { name: 'Test Zero Bat', counters: { '+1/+1': 3 } }] } });
    const bat = named(s, 'Test Zero Bat')[0]!;
    s = attackWith(s, [bat]);
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.defId.includes('Fractal'));
    expect(tokens.length).toBe(1);
    expect(s.objects[tokens[0]!]!.counters['+1/+1']).toBe(3);
  });
  it('negative: a creature with base power 3 dealing damage does not trigger it', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Primo'] } });
    const primo = named(s, 'Test Primo')[0]!;
    s = attackWith(s, [primo]);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId.includes('Fractal')).length).toBe(0);
  });
});

// ---- Kassandra, Eagle Bearer -------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.23a, 201.2: "search your graveyard, hand, and library for a card named X, put it onto the battlefield, then shuffle"', () => {
  const KASS = card('Test Kassandra', 'Legendary Creature — Human', 'When this creature enters, search your graveyard, hand, and library for a card named Test Spear, put it onto the battlefield, then shuffle.', '{0}', ['2', '2']);
  const SPEAR = card('Test Spear', 'Legendary Artifact — Equipment', '', '{1}');
  const OTHER = card('Test Pike', 'Artifact — Equipment', '', '{1}');
  const defs = [KASS, SPEAR, OTHER];
  it('is full', () => expect(full(KASS)).toBe(true));
  for (const zone of ['library', 'graveyard', 'hand'] as const) {
    it(`finds the named card in the ${zone} and puts it onto the battlefield`, () => {
      const s0 = scenario([], { defs, p1: { hand: ['Test Kassandra', ...(zone === 'hand' ? ['Test Spear'] : [])], ...(zone === 'library' ? { library: ['Test Spear'] } : {}), ...(zone === 'graveyard' ? { graveyard: ['Test Spear'] } : {}) } });
      const s = resolveAll(cast(s0, 'Test Kassandra'), { objects: [[find(s0, 'Test Spear', zone)]] });
      expect(named(s, 'Test Spear').length).toBe(1);
    });
  }
  it('negative: a card with another name is not fetched', () => {
    const s = resolveAll(cast(scenario([], { defs, p1: { hand: ['Test Kassandra'], library: ['Test Pike'] } }), 'Test Kassandra'));
    expect(named(s, 'Test Pike').length).toBe(0);
    expect(named(s, 'Test Spear').length).toBe(0);
  });
});

// ---- Primal Surge ------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 608.2c: "Exile the top card of your library. If it\'s a permanent card, you may put it onto the battlefield. If you do, repeat this process."', () => {
  const SURGE = card('Test Surge', 'Sorcery', 'Exile the top card of your library. If it\'s a permanent card, you may put it onto the battlefield. If you do, repeat this process.', '{0}');
  const A = card('Test Perm A', 'Artifact', '', '{1}');
  const B = card('Test Perm B', 'Artifact', '', '{1}');
  const C = card('Test Spell C', 'Sorcery', 'You gain 1 life.', '{1}');
  const defs = [SURGE, A, B, C];
  const board = (): GameState => scenario([], { defs, p1: { hand: ['Test Surge'], library: ['Test Perm A', 'Test Perm B', 'Test Spell C'] } });
  it('is full', () => expect(full(SURGE)).toBe(true));
  it('repeats while each permanent card is put onto the battlefield and stops at a nonpermanent card (left in exile)', () => {
    const s = resolveAll(cast(board(), 'Test Surge'), { yes: [true, true, true] });
    expect(named(s, 'Test Perm A').length).toBe(1);
    expect(named(s, 'Test Perm B').length).toBe(1);
    expect(named(s, 'Test Spell C').length).toBe(0);
    expect(named(s, 'Test Spell C', 'exile').length).toBe(1);
  });
  it('negative: declining to put the first permanent card stops the process (the card stays in exile, the next card is untouched)', () => {
    const s = resolveAll(cast(board(), 'Test Surge'), { yes: [false] });
    expect(named(s, 'Test Perm A').length).toBe(0);
    expect(named(s, 'Test Perm A', 'exile').length).toBe(1);
    expect(zoneNames(s, 'library')[0]).toBe('Test Perm B');
  });
});

// ---- Slagstone Refinery ------------------------------------------------------------------------------------------------------------------------------------
describe('CR 603.2, 700.4: "Whenever ~ or another nontoken artifact you control is put into a graveyard from the battlefield or is put into exile from the battlefield, create a tapped Powerstone token."', () => {
  const REF = card('Test Refinery', 'Artifact', 'Whenever this artifact or another nontoken artifact you control is put into a graveyard from the battlefield or is put into exile from the battlefield, create a tapped Powerstone token.', '{1}');
  const GIZMO = card('Test Gizmo', 'Artifact', '', '{1}');
  const SMASH = card('Test Smash', 'Instant', 'Destroy target artifact.', '{0}');
  const BANISH = card('Test Banish', 'Instant', 'Exile target artifact.', '{0}');
  const defs = [REF, GIZMO, SMASH, BANISH];
  const stones = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId.includes('Powerstone'));
  const board = (spell: string, target: 'mine' | 'theirs' | 'self'): { s: GameState; t: ObjectId } => {
    const s = scenario([], { defs, p1: { hand: [spell], battlefield: ['Test Refinery', ...(target === 'mine' ? ['Test Gizmo'] : [])] }, p2: { battlefield: target === 'theirs' ? ['Test Gizmo'] : [] } });
    return { s, t: target === 'self' ? named(s, 'Test Refinery')[0]! : named(s, 'Test Gizmo')[0]! };
  };
  it('is full', () => expect(full(REF)).toBe(true));
  for (const spell of ['Test Smash', 'Test Banish']) {
    it(`another artifact you control ${spell === 'Test Smash' ? 'destroyed' : 'exiled'}: one tapped Powerstone token`, () => {
      const { s: s0, t } = board(spell, 'mine');
      const s = resolveAll(cast(s0, spell, { targets: [[obj(t)]] }));
      expect(stones(s).length).toBe(1);
      expect(s.objects[stones(s)[0]!]!.tapped).toBe(true);
    });
    it(`the Refinery itself ${spell === 'Test Smash' ? 'destroyed' : 'exiled'}: one token`, () => {
      const { s: s0, t } = board(spell, 'self');
      const s = resolveAll(cast(s0, spell, { targets: [[obj(t)]] }));
      expect(stones(s).length).toBe(1);
    });
    it(`negative: an artifact an opponent controls ${spell === 'Test Smash' ? 'destroyed' : 'exiled'} makes no token`, () => {
      const { s: s0, t } = board(spell, 'theirs');
      const s = resolveAll(cast(s0, spell, { targets: [[obj(t)]] }));
      expect(stones(s).length).toBe(0);
    });
  }
});

// ---- Angelic Renewal ---------------------------------------------------------------------------------------------------------------------------------------
describe('CR 608.2c, 701.21a: "Whenever a creature is put into your graveyard from the battlefield, you may sacrifice this enchantment. If you do, return that card to the battlefield."', () => {
  const RENEW = card('Test Renewal', 'Enchantment', 'Whenever a creature is put into your graveyard from the battlefield, you may sacrifice this enchantment. If you do, return that card to the battlefield.', '{1}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.', '{0}');
  const defs = [RENEW, BEAR, KILL];
  const board = (owner: 'p1' | 'p2'): GameState => scenario([], { defs, p1: { hand: ['Test Kill'], battlefield: ['Test Renewal', ...(owner === 'p1' ? ['Test Bear'] : [])] }, p2: { battlefield: owner === 'p2' ? ['Test Bear'] : [] } });
  it('is full', () => expect(full(RENEW)).toBe(true));
  it('returns the creature that died (not the enchantment) and sacrifices the enchantment', () => {
    const s0 = board('p1');
    const bear = named(s0, 'Test Bear')[0]!;
    const s = resolveAll(cast(s0, 'Test Kill', { targets: [[obj(bear)]] }), { yes: [true] });
    expect(named(s, 'Test Bear').length).toBe(1);
    expect(named(s, 'Test Renewal').length).toBe(0);
    expect(zoneNames(s, 'graveyard')).toContain('Test Renewal');
    expect(zoneNames(s, 'graveyard')).not.toContain('Test Bear');
  });
  it('negative: declining keeps the enchantment and leaves the creature in the graveyard', () => {
    const s0 = board('p1');
    const bear = named(s0, 'Test Bear')[0]!;
    const s = resolveAll(cast(s0, 'Test Kill', { targets: [[obj(bear)]] }), { yes: [false] });
    expect(named(s, 'Test Bear').length).toBe(0);
    expect(named(s, 'Test Renewal').length).toBe(1);
    expect(zoneNames(s, 'graveyard')).toContain('Test Bear');
  });
  it('negative: a creature put into an opponent\'s graveyard does not trigger it', () => {
    const s0 = board('p2');
    const bear = named(s0, 'Test Bear')[0]!;
    const s = resolveAll(cast(s0, 'Test Kill', { targets: [[obj(bear)]] }), { yes: [true] });
    expect(named(s, 'Test Renewal').length).toBe(1);
    expect(named(s, 'Test Bear').length).toBe(0);
  });
});

// ---- Conclave Sledge-Captain -------------------------------------------------------------------------------------------------------------------------------
describe('CR 702.165a, 702.165d: "Backup 1, backup 1, backup 1": each backup ability triggers separately and grants the abilities printed below', () => {
  const CAP = card('Test Sledge', 'Creature — Elephant Soldier', 'Backup 1, backup 1, backup 1\nTrample\nWhenever this creature deals combat damage to a player, put that many +1/+1 counters on it.', '{0}', ['3', '3']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const defs = [CAP, BEAR];
  it('is full', () => expect(full(CAP)).toBe(true));
  it('three triggers put three counters on another creature, which gains trample until end of turn', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Sledge'], battlefield: ['Test Bear'] } });
    const bear = named(s0, 'Test Bear')[0]!;
    const s = resolveAll(cast(s0, 'Test Sledge'), { targets: [[obj(bear)], [obj(bear)], [obj(bear)]] });
    expect(s.objects[bear]!.counters['+1/+1']).toBe(3);
    expect(hasTrample(s, bear)).toBe(true);
  });
  it('negative: counters on the creature itself give it no extra abilities (it has them already) and the other creature gets nothing', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Sledge'], battlefield: ['Test Bear'] } });
    const bear = named(s0, 'Test Bear')[0]!;
    const s1 = passBoth(cast(s0, 'Test Sledge')); // the creature spell resolves; the three backup triggers ask for their targets
    const cap = find(s1, 'Test Sledge', 'battlefield');
    const s = resolveAll(drive(s1, { targets: [[obj(cap)], [obj(cap)], [obj(cap)]] }));
    expect(s.objects[cap]!.counters['+1/+1']).toBe(3);
    expect(s.objects[bear]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(hasTrample(s, bear)).toBe(false);
  });
});
