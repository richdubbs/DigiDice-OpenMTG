/**
 * Cloud r5-repl (Standard round 5: replacement and prevention effects): "Combat damage can't be prevented." (the restriction `preventCombatDamage`) and a damage replacement that heals, played
 * through the engine with synthetic cards compiled by the game's default compiler (invented names, numbers and wordings, design 6.10). Each test is named after
 * the rule it checks.
 *
 *   CR 615.12, 510.2          combat damage that can't be prevented is dealt in spite of a prevention effect
 *   CR 615.12, 120.2b         noncombat damage is still prevented
 *   CR 614.1a, 120.3e         "instead that damage is dealt, but all other damage already dealt to ~ is healed" (the `healFirst` body)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, life, pass, scenario } from '../../m3/scenario';
import { attackUnblocked, declareAttackers, declareBlockers, toDeclareAttackers, toDeclareBlockers, toStep } from '../../m4/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = pass(pass(s));
  return s;
}
function cast(s0: GameState, name: string, targets: TargetChoice[] = []): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand') });
  for (let i = 0; i < 10 && s.pending && s.pending.kind !== 'priority'; i++) {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else throw new Error(`unexpected decision ${s.pending.kind}`);
  }
  return resolveAll(s);
}

const BALOTH = card('Test Baloth', 'Creature — Beast', 'Trample\nCombat damage can\'t be prevented.', { pt: ['3', '3'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const HAZE = card('Test Haze', 'Instant', 'Prevent all combat damage that would be dealt this turn.');
const CALM = card('Test Calm', 'Instant', 'Until your next turn, prevent all damage that would be dealt to you.');
const SHOCK = card('Test Shock', 'Instant', '~ deals 2 damage to any target.');

describe('Cloud r5-repl: "Combat damage can\'t be prevented." (CR 615.12, 510.2)', () => {
  it('is automated, and so are the prevention effects the tests use', () => {
    for (const d of [BALOTH, HAZE, CALM, SHOCK]) expect(full(d), d.name).toBe(true);
  });
  it('CR 615.12, 510.2: combat damage is dealt in spite of "prevent all combat damage"', () => {
    let s = scenario([], { defs: [BALOTH, BEAR, HAZE], p1: { hand: ['Test Haze'], battlefield: ['Test Baloth', 'Test Bear'] } });
    s = cast(s, 'Test Haze');
    s = attackUnblocked(s, [find(s, 'Test Baloth', 'battlefield'), find(s, 'Test Bear', 'battlefield')]);
    expect(life(s, 'p2')).toBe(15); // 3 + 2: the bear's damage is combat damage too (the ability speaks of all combat damage)
  });
  it('CR 615.12: without the ability, the prevention effect applies', () => {
    let s = scenario([], { defs: [BEAR, HAZE], p1: { hand: ['Test Haze'], battlefield: ['Test Bear'] } });
    s = cast(s, 'Test Haze');
    s = attackUnblocked(s, [find(s, 'Test Bear', 'battlefield')]);
    expect(life(s, 'p2')).toBe(20);
  });
  it('CR 615.12, 120.2b: noncombat damage can still be prevented', () => {
    let s = scenario([], { defs: [BALOTH, CALM, SHOCK], p1: { hand: ['Test Calm', 'Test Shock'], battlefield: ['Test Baloth'] } });
    s = cast(s, 'Test Calm');
    s = cast(s, 'Test Shock', [{ kind: 'player', id: 'p1' }]);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('Cloud r5-repl: "If damage would be dealt to ~, instead that damage is dealt, but all other damage already dealt to ~ is healed." (CR 614.1a, 120.3e)', () => {
  const HEALER = card('Test Healer', 'Creature — Mutant', 'If damage would be dealt to ~, instead that damage is dealt, but all other damage already dealt to ~ is healed.', { pt: ['3', '3'] });
  const BOLT3 = card('Test Blast', 'Instant', '~ deals 3 damage to any target.');
  it('is automated', () => expect(full(HEALER)).toBe(true));
  it('CR 614.1a, 120.3e: two 2-damage hits leave 2 damage marked, not 4; the creature survives', () => {
    let s = scenario([], { defs: [HEALER, SHOCK], p1: { hand: ['Test Shock', 'Test Shock'], battlefield: ['Test Healer'] } });
    const id = find(s, 'Test Healer', 'battlefield');
    s = cast(s, 'Test Shock', [{ kind: 'object', id }]);
    expect(s.objects[id]!.damage).toBe(2);
    s = cast(s, 'Test Shock', [{ kind: 'object', id }]);
    expect(s.zones.battlefield).toContain(id);
    expect(s.objects[id]!.damage).toBe(2);
  });
  it('CR 704.5g: damage equal to its toughness in one event is still lethal', () => {
    let s = scenario([], { defs: [HEALER, BOLT3], p1: { hand: ['Test Blast'], battlefield: ['Test Healer'] } });
    const id = find(s, 'Test Healer', 'battlefield');
    s = cast(s, 'Test Blast', [{ kind: 'object', id }]);
    expect(s.zones.battlefield).not.toContain(id);
  });
  it('CR 614.1a: another creature\'s damage is not healed', () => {
    let s = scenario([], { defs: [HEALER, SHOCK, BEAR], p1: { hand: ['Test Shock'], battlefield: ['Test Healer', { name: 'Test Bear' }] } });
    const bear = find(s, 'Test Bear', 'battlefield');
    s = { ...s, objects: { ...s.objects, [bear]: { ...s.objects[bear]!, damage: 1 } } };
    s = cast(s, 'Test Shock', [{ kind: 'object', id: bear }]);
    expect(s.zones.battlefield).not.toContain(bear);
  });
});

describe('Cloud r5-repl: "Combat damage that would be dealt by creatures you control can\'t be prevented." (CR 615.12, 510.2)', () => {
  const BEAST = card('Test Beast', 'Creature — Beast', 'Combat damage that would be dealt by creatures you control can\'t be prevented.', { pt: ['4', '4'] });
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['3', '3'] });
  it('is automated', () => expect(full(BEAST)).toBe(true));
  it('CR 615.12: your creature\'s combat damage is dealt; the blocker\'s combat damage to it is still prevented', () => {
    let s = scenario([], { defs: [BEAST, BEAR, OGRE, HAZE], p1: { hand: ['Test Haze'], battlefield: ['Test Beast', 'Test Bear'] }, p2: { battlefield: ['Test Ogre'] } });
    s = cast(s, 'Test Haze');
    const bear = find(s, 'Test Bear', 'battlefield');
    const ogre = find(s, 'Test Ogre', 'battlefield');
    s = declareAttackers(toDeclareAttackers(s), [[bear]]);
    s = declareBlockers(toDeclareBlockers(s), [[ogre, bear]]);
    s = toStep(s, 'endCombat');
    expect(s.objects[ogre]!.damage).toBe(2);
    expect(s.objects[bear]!.damage).toBe(0);
  });
});
