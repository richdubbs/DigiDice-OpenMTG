/**
 * std-promote-3 (lane std-promote): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (wordings invented,
 * design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 701.43a, 603.12, 603.12a  "You may exert ~ as it attacks. When you do, <instruction with a target>": the reflexive trigger's target is chosen when it is put
 *                                on the stack, after the exert; declining to exert triggers nothing
 *   CR 603.7a, 118.12, 107.14    "At the beginning of the next end step, sacrifice that creature unless you pay an amount of {E} equal to its power": the delayed
 *                                ability is created with the whole sentence; the payment is offered at the end step, the amount read then (CR 608.2h)
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState, ObjectId } from '../../../src/index';
import { advanceTo, answer, find, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';
import { card, counters, full, resolveAll } from '../cmd3/helpers';

const BEAR = card('Test Bear', 'Creature — Bear', '', ['3', '3']);
const RAIDER = card('Test Exert Raider', 'Creature — Human Warrior', 'You may exert this creature as it attacks. When you do, put a +1/+1 counter on target creature you control.', ['2', '2']);
const KEEPER = card('Test Toll Keeper', 'Creature — Human Rogue', 'Whenever this creature attacks, put a +1/+1 counter on target creature you control. At the beginning of the next end step, sacrifice that creature unless you pay an amount of {E} equal to its power.', ['1', '1']);
const DEFS: CardDef[] = [BEAR, RAIDER, KEEPER];

const attack = (s: GameState, names: string[]): GameState => declareAttackers(toDeclareAttackers(s), names.map((n) => [find(s, n, 'battlefield', 'p1')] as [ObjectId]));
const choose = (s: GameState, ids: ObjectId[]): GameState => answer(s, { kind: 'chooseObjects', ids });
const energy = (s: GameState): number => ((s.players[0]! as unknown as { counters?: Record<string, number> }).counters?.['energy'] ?? 0);
const withEnergy = (s: GameState, n: number): GameState => {
  const p = s.players[0]! as unknown as { counters?: Record<string, number> };
  p.counters = { ...(p.counters ?? {}), energy: n };
  return s;
};

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 701.43a, 603.12a: "You may exert ~ as it attacks. When you do, <instruction with a target>"', () => {
  it('CR 603.12a: exerted, the reflexive trigger targets a creature chosen as it is put on the stack (the Bear, not the attacker)', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Exert Raider', 'Test Bear'] }, defs: DEFS });
    const raider = find(s, 'Test Exert Raider', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = choose(attack(s, ['Test Exert Raider']), [raider]);
    s = resolveAll(s, { targets: [{ kind: 'object', id: bear }] });
    expect(counters(s, bear, '+1/+1')).toBe(1);
    expect(counters(s, raider, '+1/+1')).toBe(0);
    expect(s.objects[raider]!.tapped).toBe(true);
  });
  it('CR 701.43a: not exerted, nothing triggers and no counter is put', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Exert Raider', 'Test Bear'] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = choose(attack(s, ['Test Exert Raider']), []);
    expect(s.zones.stack).toHaveLength(0);
    s = resolveAll(s, { targets: [{ kind: 'object', id: bear }] });
    expect(counters(s, bear, '+1/+1')).toBe(0);
  });
});

describe('CR 603.7a, 118.12: "At the beginning of the next end step, sacrifice that creature unless you pay an amount of {E} equal to its power"', () => {
  const toEndStep = (energyNow: number, pay: boolean): { s: GameState; bear: ObjectId; before: number } => {
    let s = withEnergy(scenario(['Plains'], { p1: { battlefield: ['Test Toll Keeper', 'Test Bear'] }, defs: DEFS }), energyNow);
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = resolveAll(attack(s, ['Test Toll Keeper']), { targets: [{ kind: 'object', id: bear }] });
    expect(counters(s, bear, '+1/+1')).toBe(1);
    // CR 603.7a: nothing is asked at the attack; the payment belongs to the delayed ability
    expect(energy(s)).toBe(energyNow);
    const before = energy(s);
    s = resolveAll(advanceTo(s, 1, 'end'), { yes: pay });
    return { s, bear, before };
  };
  it('CR 118.12, 608.2h: at the end step, paying four {E} (the Bear is 4/4 then) keeps it', () => {
    const { s, bear, before } = toEndStep(5, true);
    expect(s.zones.battlefield).toContain(bear);
    expect(energy(s)).toBe(before - 4);
  });
  it('CR 118.12: declining the payment sacrifices it, and no energy is spent', () => {
    const { s, bear, before } = toEndStep(5, false);
    expect(s.zones.battlefield).not.toContain(bear);
    expect(energy(s)).toBe(before);
  });
  it('CR 118.3: with fewer {E} than its power the payment cannot be made, so it is sacrificed', () => {
    const { s, bear, before } = toEndStep(3, true);
    expect(s.zones.battlefield).not.toContain(bear);
    expect(energy(s)).toBe(before);
  });
});
