/**
 * FXC, audit m1 (CR 702.51a, 601.2h): convoke offers only the creatures that can pay for some of the remaining cost: any creature while generic mana is
 * left, otherwise a creature of a color whose symbol is still in the cost. A green creature is never offered for {R}.
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import type { PaymentOption } from '../../../src/keywords/types';
import { answer, find, labels, scenario, withStatics } from '../../m5/helpers';
import { castCard, drive, spell } from '../../m5/announce/support';

const convoke: PaymentOption = {
  key: 'convoke', describe: 'Tap an untapped creature you control', reduces: { generic: 1, colors: ['W', 'U', 'B', 'R', 'G'] },
  cost: { other: [{ kind: 'tapUntapped', filter: { types: ['Creature'] }, count: 1 }] },
};
const only = (o: PaymentOption) => ({ paymentOptions: (_g: unknown, id: string) => (id.length > 0 ? [o] : []) });
const options = (s: GameState): string[] => [...((s.pending as { options?: string[] }).options ?? [])].sort();

describe('CR 702.51a: convoke offers only creatures that can pay', () => {
  it('{R}: the red creature is offered, the green one is not', () => {
    const card = spell('Test Red Convoke', '{R}', [], { type: 'Sorcery' });
    const s0 = scenario(['Grizzly Bears', 'Hill Giant'], { p1: { hand: ['Test Red Convoke'], battlefield: ['Grizzly Bears', 'Hill Giant'] }, defs: [card] });
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const s = withStatics(only(convoke), () => {
      const t = castCard(s0, 'Test Red Convoke');
      expect(t.pending).toMatchObject({ kind: 'chooseObjects', min: 0, max: 1 });
      expect(options(t)).toEqual([giant]);
      return drive(answer(t, { kind: 'chooseObjects', ids: [giant] }), []);
    });
    expect(s.objects[giant]!.tapped).toBe(true);
    expect(s.zones.stack.length).toBe(1);
  });

  it('{1}{R}: generic mana is left, so every creature is offered', () => {
    const card = spell('Test Convoke Two', '{1}{R}', [], { type: 'Sorcery' });
    const s0 = scenario(['Grizzly Bears', 'Hill Giant'], { p1: { hand: ['Test Convoke Two'], battlefield: ['Grizzly Bears', 'Hill Giant'] }, defs: [card] });
    withStatics(only(convoke), () => {
      const t = castCard(s0, 'Test Convoke Two');
      expect(options(t)).toEqual([find(s0, 'Grizzly Bears', 'battlefield'), find(s0, 'Hill Giant', 'battlefield')].sort());
    });
  });

  it('{R} with only a green creature: convoke has nothing to pay, no prompt, the Mountain pays', () => {
    const card = spell('Test Red Convoke', '{R}', [], { type: 'Sorcery' });
    const s0 = scenario(['Grizzly Bears', 'Mountain'], { p1: { hand: ['Test Red Convoke'], battlefield: ['Grizzly Bears', 'Mountain'] }, defs: [card] });
    const s = withStatics(only(convoke), () => drive(castCard(s0, 'Test Red Convoke'), []));
    expect(s.objects[find(s0, 'Grizzly Bears', 'battlefield')]!.tapped).toBeFalsy();
    expect(s.objects[find(s0, 'Mountain', 'battlefield')]!.tapped).toBe(true);
    expect(s.zones.stack.length).toBe(1);
  });

  it('{R} with only a green creature and no mana: not castable', () => {
    const card = spell('Test Red Convoke', '{R}', [], { type: 'Sorcery' });
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Test Red Convoke'], battlefield: ['Grizzly Bears'] }, defs: [card] });
    expect(withStatics(only(convoke), () => labels(s0, 'p1'))).not.toContain('Cast Test Red Convoke');
  });
});
