/**
 * p2-counters-move-4 (lane p2-counters-move): "move any number of +1/+1 counters from ~ onto other creatures" played through the engine with synthetic cards
 * (wordings invented, design 6.10). CR cites from memory, unverified.
 *
 *   CR 122.5, 608.2d   how many, then which creatures and how many each (at least one each); none is a legal number
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, DecisionAnswer, GameState, ObjectId } from '../../../src/index';
import { activate } from '../../m5/cr-examples/helpers';
import { find, resolveAll, scenario, synthetic } from '../../m6/costs/support';

const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const plus = (s: GameState, id: ObjectId): number => s.objects[id]!.counters?.['+1/+1'] ?? 0;
const number = (n: number): DecisionAnswer => ({ kind: 'chooseNumber', n });

const ANCIENT = synthetic('Test Patient Elder', 'Creature — Elemental', '{3}{G}', '{1}: Move any number of +1/+1 counters from ~ onto other creatures.', { power: '0', toughness: '3' });
const BEAR = synthetic('Test Grey Bear', 'Creature — Bear', '{1}{G}', '', { power: '2', toughness: '2' });
const ELK = synthetic('Test Grey Elk', 'Creature — Elk', '{1}{G}', '', { power: '2', toughness: '2' });
const DEFS = [ANCIENT, BEAR, ELK];

function board(): { s: GameState; elder: ObjectId; bear: ObjectId; elk: ObjectId } {
  const s = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Test Patient Elder', 'Test Grey Bear', 'Forest', 'Forest'] }, p2: { battlefield: ['Test Grey Elk'] } });
  const elder = find(s, 'Test Patient Elder', 'battlefield');
  s.objects[elder]!.counters = { '+1/+1': 4 };
  return { s, elder, bear: find(s, 'Test Grey Bear', 'battlefield'), elk: find(s, 'Test Grey Elk', 'battlefield', 'p2') };
}

describe('the synthetic card is automated', () => {
  it('plays fully', () => expect(full(ANCIENT), JSON.stringify(ANCIENT.automation)).toBe(true));
});

describe('CR 122.5, 608.2d: "Move any number of +1/+1 counters from ~ onto other creatures."', () => {
  it('CR 608.2d: three of four, divided two onto the bear and one onto the opponent\'s elk (any other creature)', () => {
    const { s: s0, elder, bear, elk } = board();
    const s = resolveAll(activate(s0, elder), [number(3), { kind: 'chooseObjects', ids: [bear, elk] }, { kind: 'chooseDivision', amounts: [2, 1] } as DecisionAnswer]);
    expect([plus(s, elder), plus(s, bear), plus(s, elk)]).toEqual([1, 2, 1]);
  });
  it('CR 608.2d: all four onto one creature', () => {
    const { s: s0, elder, bear } = board();
    const s = resolveAll(activate(s0, elder), [number(4), { kind: 'chooseObjects', ids: [bear] }]);
    expect([plus(s, elder), plus(s, bear)]).toEqual([0, 4]);
  });
  it('CR 608.2d: none is a legal number: nothing moves', () => {
    const { s: s0, elder, bear } = board();
    const s = resolveAll(activate(s0, elder), [number(0)]);
    expect([plus(s, elder), plus(s, bear)]).toEqual([4, 0]);
  });
});
