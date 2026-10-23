/**
 * Integration (WP3 storm data + WP7 casting): the `spellCast` event carries the number of spells cast this turn by ALL players before it
 * (CR 702.40a: "for each other spell cast before it this turn"), not only the caster's.
 */
import { describe, expect, it } from 'vitest';
import { applyAction } from '../../../src/index';
import type { GameEvent } from '../../../src/index';
import { act, find, scenario } from '../helpers';
import { spell } from './support';

describe('CR 702.40a: spellCast.spellsBefore counts every player\'s spells', () => {
  const a = spell('Test Spell A', '{R}', [], { type: 'Instant' });
  const b = spell('Test Spell B', '{R}', [], { type: 'Instant' });
  const c = spell('Test Spell C', '{R}', [], { type: 'Instant' });

  it('the second player\'s first spell has one spell before it; the first player\'s next spell has two', () => {
    let s = scenario(['Mountain', 'Mountain'], { p1: { hand: ['Test Spell A', 'Test Spell C'], battlefield: ['Mountain', 'Mountain'] }, p2: { hand: ['Test Spell B'], battlefield: ['Mountain'] }, defs: [a, b, c] });
    const seen: number[] = [];
    const cast = (name: string, player: 'p1' | 'p2') => {
      let r = applyAction(s, { type: 'cast', player, card: find(s, name, 'hand', player) });
      const events: GameEvent[] = [...r.events];
      while (!r.error && r.state.pending && r.state.pending.kind === 'payCost') {
        r = applyAction(r.state, { type: 'answer', player, decisionId: r.state.pending.id, answer: { kind: 'payCost', auto: true } });
        events.push(...r.events);
      }
      expect(r.error).toBeUndefined();
      s = r.state;
      const ev = events.find((e) => e.type === 'spellCast');
      seen.push(ev && ev.type === 'spellCast' ? (ev.spellsBefore ?? -1) : -2);
    };
    cast('Test Spell A', 'p1');
    s = act(s, { type: 'pass', player: 'p1' });
    cast('Test Spell B', 'p2');
    s = act(s, { type: 'pass', player: 'p2' });
    cast('Test Spell C', 'p1');
    expect(seen).toEqual([0, 1, 2]);
  });
});
