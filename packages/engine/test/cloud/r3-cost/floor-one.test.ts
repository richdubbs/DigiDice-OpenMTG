/**
 * r3-cost: "Activated abilities of <permanents> cost {N} less to activate. This effect can't reduce the mana in that cost to less than one mana." (Training
 * Grounds, Forensic Gadgeteer, Agatha of the Vile Cauldron), played through the engine with synthetic cards (design 6.10).
 *
 *   CR 601.2f, 602.2b, 118.7   the reduction leaves at least one mana in a cost that had some: "{1}, {T}: Draw a card" still costs {1}; "{3}, {T}" costs {1}
 *   CR 601.2f                  with another reduction that has no floor, the floored one is applied first (the order that never costs the player more)
 *   CR 118.7a                  generic mana only: "{1}{U}" becomes {U}, never less
 *   CR 107.3, 608.2h-like      "{X} less, where X is ~'s power": the power as the cost is determined
 *   CR 109.2                   "activated abilities of creatures": creature permanents, not a creature card's ability in a graveyard
 */
import { describe, expect, it } from 'vitest';
import { modifyMana, type CostModHit } from '../../../src/statics/costmods';
import type { CostModDef } from '../../../src/types/ability';
import type { ManaSymbol } from '../../../src/types/mana';
import { act, activations, card, drive, full, legal, resolveAll, scenario } from './support';

const GROUNDS = card('Test Drill Yard', 'Enchantment', "Activated abilities of artifacts you control cost {2} less to activate. This effect can't reduce the mana in that cost to less than one mana.", '{1}{U}');
const KEEPER = card('Test Gear Keeper', 'Creature — Human', 'Activated abilities of artifacts you control cost {1} less to activate.', '{1}', ['1', '1']);
const MATRON = card('Test Cauldron Matron', 'Creature — Human Warlock', "Activated abilities of creatures you control cost {X} less to activate, where X is Test Cauldron Matron's power. This effect can't reduce the mana in that cost to less than one mana.", '{G}', ['3', '3']);
const ENGINE = card('Test Thought Engine', 'Artifact', '{3}, {T}: Draw a card.\n{1}, {T}: You gain 1 life.\n{1}{U}, {T}: Scry 1.', '{1}');
const TINKER = card('Test Tinker', 'Creature — Human', '{4}: Test Tinker gets +1/+1 until end of turn.', '{1}', ['1', '1']);
const SPECTER = card('Test Grave Specter', 'Creature — Spirit', '{3}: Return this card from your graveyard to your hand. Activate only as a sorcery.', '{1}', ['1', '1']);
const DEFS = [GROUNDS, KEEPER, MATRON, ENGINE, TINKER, SPECTER];

const hit = (change: CostModDef['change']): CostModHit => ({ def: { s: 'costMod', applies: { abilities: {}, caster: 'any' }, change }, source: null, controller: 'p1', name: 'x', text: '', cx: undefined as never });
const g = (n: number): ManaSymbol => ({ kind: 'generic', amount: n });
const U: ManaSymbol = { kind: 'colored', color: 'U' };
const mana = (r: ReturnType<typeof modifyMana>): ManaSymbol[] => ('mana' in r ? r.mana : (() => { throw new Error('unknown'); })());

describe('r3-cost: the one-mana floor of a cost reduction (statics/costmods.ts#modifyMana)', () => {
  it('the cards are automated', () => {
    for (const d of DEFS) expect(full(d), d.name).toBe(true);
  });
  it('CR 601.2f, 118.7: {3} less 2 is {1}; {1} stays {1}; {2} less 2 is {1}; {1}{U} less 2 is {U}; a cost with no mana stays empty', () => {
    const floored = hit({ kind: 'reduce', mana: [g(2)], floor: 'one' });
    expect(mana(modifyMana([g(3)], [floored]))).toEqual([g(1)]);
    expect(mana(modifyMana([g(1)], [floored]))).toEqual([g(1)]);
    expect(mana(modifyMana([g(2)], [floored]))).toEqual([g(1)]);
    expect(mana(modifyMana([g(1), U], [floored]))).toEqual([U]);
    expect(mana(modifyMana([], [floored]))).toEqual([]);
  });
  it('CR 601.2f: with a reduction that has no floor, the floored one is applied first, in whatever order they come', () => {
    const floored = hit({ kind: 'reduce', mana: [g(2)], floor: 'one' });
    const plain = hit({ kind: 'reduce', mana: [g(1)] });
    expect(mana(modifyMana([g(3)], [plain, floored]))).toEqual([]);
    expect(mana(modifyMana([g(3)], [floored, plain]))).toEqual([]);
  });
  it('fails closed: a floored reduction of a specific mana symbol is unknown', () => {
    expect('unknown' in modifyMana([g(1), U], [hit({ kind: 'reduce', mana: [U], floor: 'one' })])).toBe(true);
  });
  it('CR 602.2b: "{3}, {T}: Draw a card" costs {1} (one land pays it); "{1}, {T}" still costs {1}: neither is offered with no land', () => {
    const s0 = scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Drill Yard', 'Test Thought Engine', 'Plains'], library: ['Plains', 'Plains'] } });
    const hand = s0.zones.hand.p1!.length;
    const draw = activations(s0, 'Test Thought Engine').find((a) => /Draw/.test(a.label));
    expect(draw).toBeDefined();
    const s = resolveAll(drive(act(s0, draw!.action)));
    expect(s.zones.hand.p1!.length).toBe(hand + 1);
    const none = scenario([], { defs: DEFS, p1: { battlefield: ['Test Drill Yard', 'Test Thought Engine'] } });
    expect(activations(none, 'Test Thought Engine')).toEqual([]);
  });
  it('CR 601.2f: with "cost {1} less" (no floor) as well, "{1}, {T}" and "{3}, {T}" cost nothing', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Drill Yard', 'Test Gear Keeper', 'Test Thought Engine'], library: ['Plains'] } });
    const labels = activations(s0, 'Test Thought Engine').map((a) => a.label).join(' | ');
    expect(labels).toMatch(/Draw/);
    expect(labels).toMatch(/gain 1 life/);
    expect(labels).not.toMatch(/Scry/); // {1}{U}: {U} is left to pay, and there is no land
  });
  it('CR 107.3: "{X} less, where X is ~\'s power" (3): "{4}: +1/+1" costs {1}; a creature card in a graveyard is not a creature (CR 109.2)', () => {
    const s0 = scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Cauldron Matron', 'Test Tinker', 'Plains'] } });
    expect(activations(s0, 'Test Tinker')).toHaveLength(1);
    const none = scenario([], { defs: DEFS, p1: { battlefield: ['Test Cauldron Matron', 'Test Tinker'] } });
    expect(activations(none, 'Test Tinker')).toEqual([]);
    const without = scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Tinker', 'Plains'] } });
    expect(activations(without, 'Test Tinker')).toEqual([]);
    // the Specter's "{3}: Return this card from your graveyard" is not reduced: one land does not pay for it
    const gy = scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Cauldron Matron', 'Plains'], graveyard: ['Test Grave Specter'] } });
    expect(legal(gy, 'p1', 'activate').filter((a) => gy.objects[a.object!]?.zone === 'graveyard')).toEqual([]);
    const gy3 = scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Cauldron Matron', 'Plains', 'Plains', 'Plains'], graveyard: ['Test Grave Specter'] } });
    expect(legal(gy3, 'p1', 'activate').filter((a) => gy3.objects[a.object!]?.zone === 'graveyard')).toHaveLength(1);
  });
});
