/**
 * p2-counters-move-2 (lane p2-counters-move): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in
 * the cloud checkout).
 *
 *   CR 118.3, 107.3a, 602.2b   "{T}, Remove all gloom counters from ~: You gain 2 life for each gloom counter removed this way.": every counter of that kind, no choice
 *   CR 118.3, 120.3            "{T}, Remove all +1/+1 counters from ~: It deals damage to any target equal to the number of +1/+1 counters removed this way."
 *   CR 121.1, 603.4            "if you've drawn more than one card this turn": strictly more than one
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState, ObjectId } from '../../../src/index';
import { activate, target } from '../../m5/cr-examples/helpers';
import { find, resolveAll, scenario, synthetic } from '../../m6/costs/support';

const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const counters = (s: GameState, id: ObjectId): Record<string, number> => Object.fromEntries(Object.entries(s.objects[id]!.counters ?? {}).filter(([, n]) => n > 0));

const FLASK = synthetic('Test Gloom Flask', 'Artifact', '{1}', '{T}, Remove all gloom counters from ~: You gain 2 life for each gloom counter removed this way.');
const WYRM = synthetic('Test Ember Wyrm', 'Creature — Dragon', '{2}{R}', '{T}, Remove all +1/+1 counters from ~: It deals damage to any target equal to the number of +1/+1 counters removed this way.', { power: '1', toughness: '1' });
const DEFS = [FLASK, WYRM];

function board(name: string, kinds: Record<string, number>): { s: GameState; id: ObjectId } {
  const s = scenario(['Mountain'], { defs: DEFS, p1: { battlefield: [name, 'Mountain', 'Mountain'] } });
  const id = find(s, name, 'battlefield');
  s.objects[id]!.counters = { ...kinds };
  return { s, id };
}

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 118.3, 107.3a: "Remove all gloom counters from ~" as a cost', () => {
  it('CR 118.3: all three gloom counters are removed (no choice of how many), and the effect counts them: 6 life; a charge counter stays', () => {
    const { s: s0, id } = board('Test Gloom Flask', { gloom: 3, charge: 1 });
    const s = resolveAll(activate(s0, id));
    expect(counters(s, id)).toEqual({ charge: 1 });
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1') + 6);
  });
  it('CR 118.3: with no gloom counter, removing all of them removes none: the ability can be activated and gains no life', () => {
    const { s: s0, id } = board('Test Gloom Flask', { charge: 2 });
    const s = resolveAll(activate(s0, id));
    expect(counters(s, id)).toEqual({ charge: 2 });
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1'));
  });
});

describe('CR 118.3, 120.3: "It deals damage to any target equal to the number of +1/+1 counters removed this way."', () => {
  it('CR 120.3: four +1/+1 counters removed: 4 damage to the opponent, the creature keeps none', () => {
    const { s: s0, id } = board('Test Ember Wyrm', { '+1/+1': 4 });
    const s = resolveAll(activate(s0, id, [target('p2')]));
    expect(counters(s, id)).toEqual({});
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2') - 4);
  });
  it('CR 120.3: one counter, one damage (the number removed, not a number chosen)', () => {
    const { s: s0, id } = board('Test Ember Wyrm', { '+1/+1': 1 });
    const s = resolveAll(activate(s0, id, [target('p2')]));
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2') - 1);
  });
});
