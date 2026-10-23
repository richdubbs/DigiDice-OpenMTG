/**
 * std-rx2 (wave 2 slice s25): "If a creature attacking causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time"
 * (sta.stdrx2.triggerMod.attacking, `feature:triggerMod.attacks`, triggers/collect.ts), played through the engine with synthetic cards compiled by the game's default
 * compiler (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not
 * in the cloud checkout).
 *
 *   CR 603.2d, 508.1m  an ability that triggers on a creature attacking triggers an additional time, for each such effect; "whenever you attack" too
 *   CR 603.2d          an ability that triggers on another event (a creature entering) triggers once; an opponent's permanent's ability triggers once
 *   CR 603.2d          "a creature you control attacking": an opponent's creature attacking is not that cause
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { advanceTo, find, life, scenario } from '../../m3/scenario';
import { attackWith, card, cast, full, resolveAll } from '../cmd3/helpers';

const DRUM = card('Test Drum', 'Enchantment', 'If a creature attacking causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.');
const OWN_DRUM = card('Test Own Drum', 'Enchantment', 'If a creature you control attacking causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.');
const RAIDER = card('Test Raider', 'Creature — Human Warrior', 'Whenever this creature attacks, you gain 1 life.', ['2', '2']);
const BANNER = card('Test Banner', 'Enchantment', 'Whenever you attack, you gain 1 life.');
const SPROUT = card('Test Sprout', 'Creature — Plant', 'When this creature enters, you gain 1 life.', ['1', '1']);
const WATCH = card('Test Watch', 'Enchantment', 'Whenever a creature attacks you, you gain 1 life.');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const DEFS = [DRUM, OWN_DRUM, RAIDER, BANNER, SPROUT, WATCH, BEAR];

const attack = (p1: string[], p2: string[] = [], attackers = ['Test Raider']): GameState => {
  let s = scenario(['Plains'], { p1: { battlefield: p1 }, p2: { battlefield: p2 }, defs: DEFS });
  s = advanceTo(s, 3, 'main1');
  return resolveAll(attackWith(s, attackers.map((n) => find(s, n, 'battlefield', 'p1'))));
};

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 603.2d, 508.1m: a creature attacking causes the trigger an additional time', () => {
  it('without the effect, an attack trigger triggers once', () => {
    const s = attack(['Test Raider']);
    expect(life(s, 'p1')).toBe(21);
  });
  it('"whenever this creature attacks" triggers an additional time', () => {
    const s = attack(['Test Drum', 'Test Raider']);
    expect(life(s, 'p1')).toBe(22);
  });
  it('two such effects: three times', () => {
    const s = attack(['Test Drum', 'Test Drum', 'Test Raider']);
    expect(life(s, 'p1')).toBe(23);
  });
  it('"whenever you attack" is caused by creatures attacking too, and triggers once more (not once per attacker)', () => {
    const s = attack(['Test Drum', 'Test Banner', 'Test Bear', 'Test Bear'], [], ['Test Bear']);
    expect(life(s, 'p1')).toBe(22);
  });
  it('an opponent\'s permanent\'s ability that the attack triggers triggers only once (not a permanent you control)', () => {
    const s = attack(['Test Drum', 'Test Raider'], ['Test Watch']);
    expect(life(s, 'p2')).toBe(21);
  });
  it('"a creature you control attacking": your creature attacking is the cause', () => {
    const s = attack(['Test Own Drum', 'Test Raider']);
    expect(life(s, 'p1')).toBe(22);
  });
});

describe('CR 603.2d: another event is not the cause', () => {
  it('an enters trigger triggers once with the effect on the battlefield', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Drum'], hand: ['Test Sprout'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const before = life(s, 'p1');
    s = resolveAll(cast(s, 'Test Sprout'));
    expect(life(s, 'p1')).toBe(before + 1);
  });
});
