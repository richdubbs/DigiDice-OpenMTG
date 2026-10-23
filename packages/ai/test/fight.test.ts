/** The combat estimate the AI plans with (src/fight.ts). */
import { describe, expect, it } from 'vitest';
import { fight, toPlayer, type Fighter } from '../src/fight';

const f = (id: string, power: number, toughness: number, more: Partial<Fighter> = {}): Fighter => ({
  id, power, toughness, damage: 0, first: false, double: false, deathtouch: false, trample: false, indestructible: false, lifelink: false, infect: false,
  toxic: 0, value: power + toughness, ...more,
});

describe('fight estimate', () => {
  it('CR 510.2: damage is simultaneous without first strike', () => {
    expect(fight(f('a', 2, 2), [f('b', 2, 2)])).toEqual({ attackerDies: true, killed: ['b'], through: 0 });
  });
  it('CR 702.7b: a first striker kills its blocker before it deals damage', () => {
    expect(fight(f('a', 2, 2, { first: true }), [f('b', 2, 2)])).toEqual({ attackerDies: false, killed: ['b'], through: 0 });
  });
  it('CR 702.4b: double strike deals damage in both steps', () => {
    expect(fight(f('a', 2, 2, { double: true }), [f('b', 1, 4)]).killed).toEqual(['b']);
  });
  it('CR 702.2b: any damage from a deathtouch source is lethal', () => {
    expect(fight(f('a', 5, 5), [f('b', 1, 1, { deathtouch: true })])).toEqual({ attackerDies: true, killed: ['b'], through: 0 });
  });
  it('CR 702.19b: trample assigns lethal damage to the blocker and the rest to the player', () => {
    expect(fight(f('a', 6, 4, { trample: true }), [f('b', 2, 2)]).through).toBe(4);
  });
  it('CR 702.12b: an indestructible creature survives lethal damage', () => {
    expect(fight(f('a', 1, 1, { indestructible: true }), [f('b', 5, 5)]).attackerDies).toBe(false);
  });
  it('CR 510.1c: an attacker blocked by two divides its damage to kill the most valuable blocker it can', () => {
    const o = fight(f('a', 3, 5), [f('small', 1, 1, { value: 1 }), f('big', 3, 3, { value: 9 })]);
    expect(o.killed).toEqual(['big']);
    expect(o.attackerDies).toBe(false);
  });
  it('CR 120.3a-b, 702.90b, 702.164c: combat damage to a player is life loss, poison counters with infect, and toxic adds poison', () => {
    expect(toPlayer(f('a', 3, 3), 3)).toEqual({ life: 3, poison: 0 });
    expect(toPlayer(f('a', 2, 1, { infect: true }), 2)).toEqual({ life: 0, poison: 2 });
    expect(toPlayer(f('a', 2, 2, { toxic: 1 }), 2)).toEqual({ life: 2, poison: 1 });
    expect(toPlayer(f('a', 2, 2, { toxic: 1 }), 0)).toEqual({ life: 0, poison: 0 });
  });
});
