/**
 * WP11 review: CR 615.7, "prevent the next N damage" shields and damage dealt at the same time. All combat damage of a step is dealt simultaneously (CR 510.2);
 * when two or more sources would deal damage to the shielded permanent or player at once and the shield can't prevent all of it, the player or the
 * permanent's controller chooses which damage the shield prevents. The result never depends on the order in which blockers were declared.
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { answer, declareAttackers, declareBlockers, find, pass, scenario, toDeclareAttackers, tweak } from '../helpers';
import { shieldRecord } from './support';

const board = (): GameState => scenario(['Craw Wurm', 'Typhoid Rats', 'Hill Giant'], { p1: { battlefield: ['Craw Wurm'] }, p2: { battlefield: ['Typhoid Rats', 'Hill Giant'] } });

/** Craw Wurm (6/4) has "prevent the next 3 damage that would be dealt to it this turn"; it attacks and both p2's creatures block it, in the given order. */
function fight(order: ('Typhoid Rats' | 'Hill Giant')[], shares: Record<string, number>, budget = 3): { s: GameState; asked: { player: string; prompt: string; min: number; max: number }[] } {
  const s0 = board();
  const wurm = find(s0, 'Craw Wurm', 'battlefield');
  const shielded = tweak(s0, (t) => {
    t.continuousEffects.push(shieldRecord('e90', {
      s: 'replace', replaces: { ev: 'damage', recipient: { object: { is: { ref: 'fixed', objects: [{ id: wurm, zone: 'battlefield' }] } } } }, body: { b: 'prevent', amount: budget }, shield: { uses: 'all' },
    }, { sourceName: 'Test Shield' }));
  });
  let s = declareAttackers(toDeclareAttackers(shielded), [[wurm]]);
  const asked: { player: string; prompt: string; min: number; max: number }[] = [];
  for (let i = 0; i < 80; i++) {
    const d = s.pending!;
    if (d.kind === 'declareBlockers') s = declareBlockers(s, order.map((n) => [find(s, n, 'battlefield'), wurm]));
    else if (d.kind === 'assignDamage') s = answer(s, { kind: 'assignDamage', amounts: [{ id: find(s, 'Typhoid Rats', 'battlefield'), amount: 1 }, { id: find(s, 'Hill Giant', 'battlefield'), amount: 5 }] });
    else if (d.kind === 'chooseNumber') {
      asked.push({ player: d.player, prompt: d.prompt, min: d.min, max: d.max });
      const who = Object.keys(shares).find((n) => d.prompt.includes(n))!;
      s = answer(s, { kind: 'chooseNumber', n: shares[who]! });
    } else if (d.kind === 'priority') {
      if (s.turn.step === 'endCombat') return { s, asked };
      s = pass(s);
    } else throw new Error(`unexpected ${d.kind}`);
  }
  throw new Error('combat did not finish');
}

describe('CR 615.7, 510.2: a shield and simultaneous damage from two sources', () => {
  for (const order of [['Hill Giant', 'Typhoid Rats'], ['Typhoid Rats', 'Hill Giant']] as const) {
    it(`blockers declared ${order.join(' then ')}: the shielded creature's controller chooses; preventing the deathtouch damage, Craw Wurm survives`, () => {
      const { s, asked } = fight([...order], { 'Typhoid Rats': 1, 'Hill Giant': 2 });
      expect(asked.length).toBe(1);
      expect(asked[0]!.player).toBe('p1');
      const wurm = find(s, 'Craw Wurm', 'battlefield');
      expect(s.objects[wurm]!.damage).toBe(1);
      expect(s.log.some((l) => l.rules?.includes('CR 615.7') && /prevented/.test(l.text))).toBe(true);
    });
  }

  it('the choice is bounded: the shield prevents exactly 3 in all, and no more from a source than it deals', () => {
    const { asked } = fight(['Typhoid Rats', 'Hill Giant'], { 'Typhoid Rats': 0, 'Hill Giant': 3 });
    expect(asked[0]).toMatchObject({ min: 0, max: 1 });
  });

  it('when the shield can prevent all of the simultaneous damage, nobody is asked', () => {
    const { s, asked } = fight(['Typhoid Rats', 'Hill Giant'], {}, 10);
    expect(asked).toEqual([]);
    expect(s.objects[find(s, 'Craw Wurm', 'battlefield')]!.damage).toBe(0);
  });
});
