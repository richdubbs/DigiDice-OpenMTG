/**
 * WP22 ability-level wrappers (design 15.2 WP22, 6.2 table, 6.5): the WP22 effect and static templates inside every ability shape. Activated (CR 602),
 * triggered (CR 603), loyalty (CR 606), modal (CR 700.2), saga chapters (CR 714), leveler brackets (CR 711) and Class levels (CR 716) are structure the
 * segmenter and the ability driver (WP5, WP17) recognize; Class levels are lowered since WP22 (parser/lower/ability.ts, an INTERFACE CHANGE: before, a
 * Class card was one manual ability per level). Synthetic cards with invented names and wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import { ENGINE_CAPABILITIES, missingCapabilities } from '../../../src/model/capabilities';
import { automated, bare, card, face, options } from './support';

type Of<K extends AbilityDef['kind']> = Extract<AbilityDef, { kind: K }>;
const opts = options([], { capabilities: ENGINE_CAPABILITIES });
const parse = (type: string, text: string, extra = {}) => face(card('Test Wrapper', type, text, extra), opts);

describe('WP22 templates inside every ability shape', () => {
  it('CR 602.1: an activated ability whose effect is a WP22 template ("{2}{G}: ~ gets +2/+2 and gains trample until end of turn.")', () => {
    const f = parse('Creature — Elf', '{2}{G}: ~ gets +2/+2 and gains trample until end of turn.');
    const a = f.abilities[0] as Of<'activated'>;
    expect(a.kind).toBe('activated');
    expect(a.cost).toEqual({ mana: [{ kind: 'generic', amount: 2 }, { kind: 'colored', color: 'G' }] });
    expect(bare([a])[0]).toMatchObject({ effect: { steps: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ affects: { ref: 'self' }, mods: [{ layer: '7c', power: 2, toughness: 2 }, { layer: 6 }] }] }] } });
    expect(f.templatesUsed).toContain('eff.cont.pumpgrant');
    expect(f.gate.every((g) => g.ok)).toBe(true);
  });
  it('CR 603.1: a triggered ability ("When ~ enters, creatures you control gain haste until end of turn.")', () => {
    const f = parse('Creature — Goblin', 'When ~ enters, creatures you control gain haste until end of turn.');
    const a = f.abilities[0] as Of<'triggered'>;
    expect(a.kind).toBe('triggered');
    expect(a.effect.steps[0]).toMatchObject({ op: 'effect', effects: [{ affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, mods: [{ layer: 6 }] }] });
    expect(automated(f.abilities)).toBe(true);
  });
  it('CR 606: a loyalty ability ("+1: Target creature gains flying until end of turn.")', () => {
    const f = parse('Legendary Planeswalker — Testa', '+1: Target creature gains flying until end of turn.', { loyalty: '3' });
    const a = f.abilities[0] as Of<'activated'>;
    expect(a).toMatchObject({ kind: 'activated', isLoyalty: true, cost: { loyalty: 1 } });
    expect(a.effect.targets).toHaveLength(1);
    expect(f.gate.every((g) => g.ok)).toBe(true);
  });
  it('CR 700.2, 608.2b: a modal spell whose modes are WP22 templates; target ids are unique across the modes', () => {
    const f = parse('Instant', 'Choose one —\n• Target creature gets +3/+0 until end of turn.\n• Target creature can\'t block this turn.');
    const a = f.abilities[0] as Of<'spell'>;
    expect(a.effect.modes?.options).toHaveLength(2);
    expect(a.effect.modes!.options.map((o) => o.program.targets.map((t) => t.id))).toEqual([['t0'], ['t1']]);
    expect(f.templatesUsed).toEqual(expect.arrayContaining(['eff.pump', 'eff.rst.cant.block']));
    expect(automated(f.abilities)).toBe(true);
  });
  it('CR 714.2: saga chapters ("I -- Creatures you control get +1/+0 until end of turn.")', () => {
    const f = parse('Enchantment — Saga', '(As this Saga enters and after your draw step, add a lore counter.)\nI — Creatures you control get +1/+0 until end of turn.\nII, III — Creatures you control gain vigilance until end of turn.');
    expect(f.abilities.map((a) => [a.kind, (a as Of<'chapter'>).chapters])).toEqual([['chapter', [1]], ['chapter', [2, 3]]]);
    expect(automated(f.abilities)).toBe(true);
    expect(f.gate.every((g) => g.ok)).toBe(true);
    // CR 714: the engine runs chapter abilities from M6-6 on (feature:chapter, statics/levels.ts): nothing is missing any more
    expect(f.abilities.flatMap((a) => missingCapabilities(a, ENGINE_CAPABILITIES))).toEqual([]);
  });
  it('CR 711.2: a leveler bracket whose ability is a WP22 static ("~ can\'t be blocked.")', () => {
    const f = parse('Creature — Human Rogue', 'Level up {1}{U}\nLEVEL 1-2\n2/2\n~ can\'t be blocked.\nLEVEL 3+\n3/3\nFlying\n~ can\'t be blocked.', { power: '1', toughness: '1' });
    const brackets = f.abilities.filter((a) => a.kind === 'levelBracket') as Of<'levelBracket'>[];
    expect(brackets.map((b) => [b.min, b.max, b.power, b.toughness])).toEqual([[1, 2, '2', '2'], [3, null, '3', '3']]);
    expect(bare(brackets[0]!.abilities)).toEqual([{ kind: 'static', text: '~ can\'t be blocked.', effects: [{ s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'beBlocked' }] }]);
    expect(f.gate.every((g) => g.ok)).toBe(true);
  });
});

describe('CR 716: Class levels are lowered (WP22 addition to parser/lower/ability.ts)', () => {
  const text = '(Gain the next level as a sorcery to add its ability.)\nCreatures you control get +1/+0.\n{2}{R}: Level 2\nCreatures you control have haste.\n{3}{R}: Level 3\nAt the beginning of your upkeep, zorblat a card.';
  it('level 1 has no cost; level N has the mana cost of its "[cost]: Level N" line (CR 716.2a) and the abilities under it', () => {
    const f = parse('Enchantment — Class', text);
    const levels = f.abilities as Of<'classLevel'>[];
    expect(levels.map((l) => [l.kind, l.level, l.cost])).toEqual([
      ['classLevel', 1, undefined],
      ['classLevel', 2, { mana: [{ kind: 'generic', amount: 2 }, { kind: 'colored', color: 'R' }] }],
      ['classLevel', 3, { mana: [{ kind: 'generic', amount: 3 }, { kind: 'colored', color: 'R' }] }],
    ]);
    expect(bare(levels[1]!.abilities)).toEqual([{ kind: 'static', text: 'Creatures you control have haste.', effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'haste', text: 'haste' }] }] }] }]);
    expect(f.gate.slice(0, 2).every((g) => g.ok)).toBe(true);
  });
  it('an ability of a level that is not understood stays manual inside its level, never dropped (design 6.6)', () => {
    const f = parse('Enchantment — Class', text);
    const third = f.abilities[2] as Of<'classLevel'>;
    expect(third.abilities.map((a) => a.kind)).toEqual(['manual']);
    expect(f.diagnostics.some((d) => d.level === 'manual')).toBe(true);
  });
  it('a Class card without the WP22 templates keeps each level, with every unparsed ability manual inside it', () => {
    const f = face(card('Test Wrapper', 'Enchantment — Class', text), options([], { templates: [] }));
    expect(f.abilities.map((a) => a.kind)).toEqual(['classLevel', 'classLevel', 'classLevel']);
    for (const l of f.abilities as Of<'classLevel'>[]) expect(l.abilities.every((a) => a.kind === 'manual')).toBe(true);
  });
});
