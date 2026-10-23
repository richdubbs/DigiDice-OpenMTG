/**
 * p2-counters-move-3 (lane p2-counters-move): "For each counter removed this way, ~ gets +1/+0 until end of turn." played through the engine with synthetic cards
 * (wordings invented, design 6.10). CR cites from memory, unverified.
 *
 *   CR 122.1, 608.2d, 613.4c   the counters actually removed count, not the X announced
 */
import { describe, expect, it } from 'vitest';
import { getChars, ptNumbers, type CardDef, type DecisionAnswer, type GameState, type ObjectId } from '../../../src/index';
import { activate, target } from '../../m5/cr-examples/helpers';
import { find, resolveAll, scenario, synthetic } from '../../m6/costs/support';

const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const pt = (s: GameState, id: ObjectId): [number | null, number | null] => { const n = ptNumbers(getChars(s, id)); return [n.power, n.toughness]; };
const option = (id: string): DecisionAnswer => ({ kind: 'chooseOption', ids: [id] });
const number = (n: number): DecisionAnswer => ({ kind: 'chooseNumber', n });

const LEECH = synthetic('Test Counter Leech', 'Creature — Insect', '{1}{B}', '{X}{B}: Remove up to X counters from target creature. For each counter removed this way, ~ gets +1/+0 until end of turn.', { power: '1', toughness: '1' });
const BEAR = synthetic('Test Grey Bear', 'Creature — Bear', '{1}{G}', '', { power: '2', toughness: '2' });
const DEFS = [LEECH, BEAR];

function board(): { s: GameState; leech: ObjectId; bear: ObjectId } {
  const s = scenario(['Swamp'], { defs: DEFS, p1: { battlefield: ['Test Counter Leech', 'Test Grey Bear', 'Swamp', 'Swamp', 'Swamp', 'Swamp'] } });
  const bear = find(s, 'Test Grey Bear', 'battlefield');
  s.objects[bear]!.counters = { '+1/+1': 1, charge: 2 };
  return { s, leech: find(s, 'Test Counter Leech', 'battlefield'), bear };
}

describe('the synthetic card is automated', () => {
  it('plays fully', () => expect(full(LEECH), JSON.stringify(LEECH.automation)).toBe(true));
});

describe('CR 122.1, 608.2d, 613.4c: "For each counter removed this way, ~ gets +1/+0 until end of turn."', () => {
  it('CR 613.4c: X = 2, two counters removed (a charge and the +1/+1): +2/+0', () => {
    const { s: s0, leech, bear } = board();
    const s = resolveAll(activate(s0, leech, [number(2), target(bear)]), [option('charge'), option('+1/+1')]);
    expect(pt(s, leech)).toEqual([3, 1]);
    expect(s.objects[bear]!.counters?.['charge'] ?? 0).toBe(1);
  });
  it('CR 608.2d: X = 3 but the controller stops after one: only the counter removed counts, +1/+0', () => {
    const { s: s0, leech, bear } = board();
    const s = resolveAll(activate(s0, leech, [number(3), target(bear)]), [option('charge'), option('__stop')]);
    expect(pt(s, leech)).toEqual([2, 1]);
  });
});
