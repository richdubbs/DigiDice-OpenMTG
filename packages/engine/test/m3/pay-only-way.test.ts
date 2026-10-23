import { describe, expect, it } from 'vitest';
import type { GameState } from '../../src/index';
import { act, find, scenario } from './scenario';

/** Cast a card and answer X (1) and targets (the opponent) until the payment is asked. */
const toPayment = (s: GameState, name: string): GameState => {
  s = act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') });
  for (let i = 0; i < 4 && s.pending?.kind !== 'payCost'; i++) {
    const d = s.pending!;
    if (d.kind === 'chooseNumber') s = act(s, { type: 'answer', player: 'p1', decisionId: d.id, answer: { kind: 'chooseNumber', n: 1 } });
    else if (d.kind === 'chooseTargets') s = act(s, { type: 'answer', player: 'p1', decisionId: d.id, answer: { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] } });
    else throw new Error(`unexpected ${d.kind}`);
  }
  return s;
};

const onlyWay = (s: GameState, name: string): boolean | undefined => {
  s = toPayment(s, name);
  if (s.pending?.kind !== 'payCost') throw new Error('expected payCost');
  return s.pending.onlyWay;
};

describe('payCost onlyWay: ways told apart by source names (client auto pay, CR 601.2g-h)', () => {
  it('two Mountains pay {R} one way', () => {
    expect(onlyWay(scenario(['Shock', 'Mountain'], { p1: { hand: ['Shock'], battlefield: ['Mountain', 'Mountain'] } }), 'Shock')).toBe(true);
  });
  it('a Forest that cannot pay {R} adds no way', () => {
    expect(onlyWay(scenario(['Shock', 'Mountain', 'Forest'], { p1: { hand: ['Shock'], battlefield: ['Mountain', 'Mountain', 'Forest'] } }), 'Shock')).toBe(true);
  });
  it('{1}{G} with two Forests and a Mountain has two ways', () => {
    expect(onlyWay(scenario(['Grizzly Bears', 'Mountain', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest', 'Mountain'] } }), 'Grizzly Bears')).toBeUndefined();
  });
  it('{1}{G} with exactly a Forest and a Mountain has one way', () => {
    expect(onlyWay(scenario(['Grizzly Bears', 'Mountain', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Mountain'] } }), 'Grizzly Bears')).toBe(true);
  });
  it('an X spell is never paid without asking', () => {
    const s = toPayment(scenario(['Blaze', 'Mountain'], { p1: { hand: ['Blaze'], battlefield: ['Mountain', 'Mountain'] } }), 'Blaze');
    expect(s.pending).toMatchObject({ kind: 'payCost', costText: '{1}{R}' });
    if (s.pending?.kind !== 'payCost') throw new Error('expected payCost');
    expect(s.pending.onlyWay).toBeUndefined();
  });
});
