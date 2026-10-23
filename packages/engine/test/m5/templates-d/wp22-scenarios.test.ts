/**
 * WP22 scenarios: the JSON the WP22 templates produce DRIVES the engine. Each card here is compiled by `parseCard` with the bootstrap and WP22 templates
 * (no hand-written JSON) and put on a real board; the layers (WP9), the rule hooks and cost modifiers (WP16) and the enters replacements (WP11) then do
 * what the Oracle text says. Synthetic cards use invented names and wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, CardDef, GameState } from '../../../src/index';
import { attackCandidates } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { gameOf, hookpoints } from '../../../src/rules/hookpoints';
import { modifiedPlan } from '../../../src/actions/cast';
import { emptyPlan } from '../../../src/rules/cost';
import { moveObject } from '../../../src/core/zones';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { parseCard } from '../../../src/parser/parse';
import { getCard } from '../../fixtures';
import { act, find, passBoth, scenario, synth } from '../helpers';
import { drive } from '../announce/support';
import { run, withAbilities } from '../propose/support';
import { putAttached } from '../rulehooks/fixtures';
import { card, options } from './support';

const opts = options([], { capabilities: ENGINE_CAPABILITIES });

/** The abilities `parseCard` gives a card; the test fails if any of them is not automated (the scenario must run on parsed JSON, not on manual text). */
function parsed(c: Parameters<typeof parseCard>[0]): AbilityDef[] {
  const abilities = parseCard(c, opts).faces[0]!.abilities;
  expect(abilities.filter((a) => a.kind === 'manual'), c.name).toEqual([]);
  return abilities;
}

/** A fixture card whose abilities are what the WP22 parser makes of its Oracle text. */
const fixture = (name: string): CardDef => withAbilities(name, parsed(getCard(name)));

/** A synthetic card compiled from an invented text by the parser. */
function synthetic(name: string, type: string, text: string, extra: { cost?: string; pt?: [string, string] } = {}): CardDef {
  return synth({ name, type, cost: extra.cost ?? '{1}', ...(extra.pt ? { pt: extra.pt } : {}), abilities: parsed(card(name, type, text)) });
}

const pt = (s: GameState, id: string): [string, string] => { const c = getChars(s, id); return [c.power ?? '', c.toughness ?? '']; };

describe('CR 613.4b, 613.6, 613.7: Humility and Opalescence as parsed, in both timestamp orders (design 9.3)', () => {
  const defs = (): CardDef[] => [fixture('Humility'), fixture('Opalescence')];
  it('Opalescence first, Humility later: Humility is a creature (layer 4) and its own 1/1 (later timestamp in 7b) wins; a Bear is a 1/1 with no abilities', () => {
    const s = scenario(['Grizzly Bears'], { defs: defs(), p1: { battlefield: ['Opalescence', 'Humility', 'Grizzly Bears'] } });
    const humility = find(s, 'Humility', 'battlefield');
    expect(getChars(s, humility).types).toContain('Creature');
    expect(pt(s, humility)).toEqual(['1', '1']);
    expect(pt(s, find(s, 'Grizzly Bears', 'battlefield'))).toEqual(['1', '1']);
    expect(getChars(s, find(s, 'Opalescence', 'battlefield')).types).not.toContain('Creature'); // "each other" (CR 109.2)
  });
  it('Humility first, Opalescence later: Opalescence\'s base P/T equal to mana value is later in layer 7b, so Humility is a 4/4', () => {
    const s = scenario(['Grizzly Bears'], { defs: defs(), p1: { battlefield: ['Humility', 'Opalescence', 'Grizzly Bears'] } });
    expect(pt(s, find(s, 'Humility', 'battlefield'))).toEqual(['4', '4']);
    expect(pt(s, find(s, 'Grizzly Bears', 'battlefield'))).toEqual(['1', '1']);
  });
});

describe('CR 611.3a, 613.4c: a parsed anthem and a parsed conditional static', () => {
  it('Glorious Anthem: its controller\'s creatures get +1/+1, the opponent\'s do not', () => {
    const s = scenario(['Grizzly Bears'], { defs: [fixture('Glorious Anthem')], p1: { battlefield: ['Glorious Anthem', 'Grizzly Bears'] }, p2: { battlefield: ['Grizzly Bears'] } });
    expect(pt(s, find(s, 'Grizzly Bears', 'battlefield', 'p1'))).toEqual(['3', '3']);
    expect(pt(s, find(s, 'Grizzly Bears', 'battlefield', 'p2'))).toEqual(['2', '2']);
  });
  it('"As long as you control a Swamp, ~ gets +3/+0." (CR 604.1): the condition is read continuously', () => {
    const brute = synthetic('Test Marsh Brute', 'Creature — Ogre', 'As long as you control a Swamp, ~ gets +3/+0.', { pt: ['2', '2'] });
    const without = scenario(['Forest'], { defs: [brute], p1: { battlefield: ['Test Marsh Brute', 'Forest'] } });
    expect(pt(without, find(without, 'Test Marsh Brute', 'battlefield'))).toEqual(['2', '2']);
    const withSwamp = scenario(['Swamp'], { defs: [brute], p1: { battlefield: ['Test Marsh Brute', 'Swamp'] } });
    expect(pt(withSwamp, find(withSwamp, 'Test Marsh Brute', 'battlefield'))).toEqual(['5', '2']);
  });
  it('"Equipped creature gets +2/+1 and has vigilance." (CR 301.5, 613.1f, 613.4c) applies to the creature it is attached to', () => {
    const blade = synthetic('Test Blade', 'Artifact — Equipment', 'Equipped creature gets +2/+1 and has vigilance.');
    let s = scenario(['Grizzly Bears'], { defs: [blade], p1: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = putAttached(s, 'Test Blade', bears);
    expect(pt(s, bears)).toEqual(['4', '3']);
    expect(getChars(s, bears).keywords.some((k) => k.keyword === 'vigilance')).toBe(true);
  });
});

describe('CR 508.1c, 509.1b: parsed restrictions reach the rule hooks', () => {
  it('"Enchanted creature can\'t attack or block." (an invented Aura): the creature is not an attacker and the hook names the rule', () => {
    const aura = synthetic('Test Shackles', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature can\'t attack or block.');
    let s = scenario(['Grizzly Bears'], { defs: [aura], p1: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = putAttached(s, 'Test Shackles', bears);
    expect(attackCandidates(s, 'p1').map((c) => c.id)).not.toContain(bears);
    expect(hookpoints.canAttack(gameOf(s), bears, 'p2')?.rules).toContain('CR 508.1c');
  });
  it('"~ can\'t block." (CR 509.1b): the hook forbids it as a blocker', () => {
    const coward = synthetic('Test Coward', 'Creature — Goblin', '~ can\'t block.', { pt: ['2', '1'] });
    const s = scenario(['Grizzly Bears'], { defs: [coward], p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Test Coward'] } });
    expect(hookpoints.canBlock(gameOf(s), find(s, 'Test Coward', 'battlefield'), find(s, 'Grizzly Bears', 'battlefield'))?.rules).toContain('CR 509.1b');
  });
});

describe('CR 601.2f, 118.7: Thalia as parsed makes noncreature spells cost {1} more for every player', () => {
  const costOf = (s: GameState, name: string, player: string): number => {
    const id = find(s, name, 'hand', player);
    const def = s.defs[s.objects[id]!.defId]!;
    const m = modifiedPlan(s, player, id, { ...emptyPlan(), mana: (def.faces[0]!.manaCost ?? []).filter((x) => x.kind !== 'variable') });
    if (!('plan' in m)) throw new Error(m.denial.message);
    return m.plan.mana.reduce((n, x) => n + (x.kind === 'generic' ? x.amount : 1), 0);
  };
  it('Lightning Bolt costs two mana for both players, Grizzly Bears still two', () => {
    const s = scenario(['Lightning Bolt', 'Grizzly Bears'], { defs: [fixture('Thalia, Guardian of Thraben')], p1: { battlefield: ['Thalia, Guardian of Thraben'], hand: ['Lightning Bolt', 'Grizzly Bears'] }, p2: { hand: ['Lightning Bolt'] } });
    expect(costOf(s, 'Lightning Bolt', 'p1')).toBe(2);
    expect(costOf(s, 'Lightning Bolt', 'p2')).toBe(2);
    expect(costOf(s, 'Grizzly Bears', 'p1')).toBe(2);
  });
});

describe('CR 614.1c, 614.12, 702.33d: parsed enters replacements', () => {
  const kavuBoard = (): GameState => scenario(['Forest'], { p1: { hand: ['Kavu Titan'], battlefield: Array(5).fill('Forest') as string[] }, defs: [fixture('Kavu Titan')] });
  const castKavu = (kick: boolean): GameState => passBoth(drive(act(kavuBoard(), { type: 'cast', player: 'p1', card: find(kavuBoard(), 'Kavu Titan', 'hand') }), [{ kind: 'yesNo', yes: kick }]));
  it('Kavu Titan kicked: three +1/+1 counters as it enters and trample (layer 6, read from the cast record, CR 400.7d)', () => {
    const s = castKavu(true);
    const kavu = find(s, 'Kavu Titan', 'battlefield');
    expect(s.objects[kavu]!.counters['+1/+1']).toBe(3);
    expect(pt(s, kavu)).toEqual(['5', '5']);
    expect(getChars(s, kavu).keywords.some((k) => k.keyword === 'trample')).toBe(true);
  });
  it('Kavu Titan not kicked: a 2/2 without trample', () => {
    const s = castKavu(false);
    const kavu = find(s, 'Kavu Titan', 'battlefield');
    expect(s.objects[kavu]!.counters['+1/+1']).toBeUndefined();
    expect(getChars(s, kavu).keywords.some((k) => k.keyword === 'trample')).toBe(false);
  });
  it('"~ enters tapped." and "~ enters tapped unless you control a Swamp or a Forest." (an invented check land) however it enters', () => {
    const tapland = synthetic('Test Tapland', 'Land', '~ enters tapped.');
    const check = synthetic('Test Checkland', 'Land', '~ enters tapped unless you control a Swamp or a Forest.');
    const enter = (name: string, battlefield: string[]): boolean => {
      const s0 = scenario(['Swamp', 'Island'], { defs: [tapland, check], p1: { hand: [name], battlefield } });
      const r = run(s0, (g) => moveObject(g, find(s0, name, 'hand'), 'battlefield', { controller: 'p1' }));
      return r.g.s.objects[r.result!]!.tapped;
    };
    expect(enter('Test Tapland', ['Swamp'])).toBe(true);
    expect(enter('Test Checkland', ['Swamp'])).toBe(false);
    expect(enter('Test Checkland', ['Island'])).toBe(true);
  });
  it('"~ enters with two +1/+1 counters on it." (an invented creature, CR 122.6)', () => {
    const grower = synthetic('Test Grower', 'Creature — Ooze', '~ enters with two +1/+1 counters on it.', { pt: ['0', '0'] });
    const s0 = scenario([], { defs: [grower], p1: { hand: ['Test Grower'] } });
    const r = run(s0, (g) => moveObject(g, find(s0, 'Test Grower', 'hand'), 'battlefield', { controller: 'p1' }));
    expect(r.g.s.objects[r.result!]!.counters['+1/+1']).toBe(2);
    expect(pt(r.g.s, r.result!)).toEqual(['2', '2']);
  });
});
