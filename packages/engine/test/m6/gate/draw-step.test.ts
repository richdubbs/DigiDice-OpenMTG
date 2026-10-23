/**
 * M6-10 fix (core/steps.ts): the draw of the draw step (CR 504.1) is an event, and replacement effects that apply to draws apply to it (CR 614.1a, 614.6,
 * 121.2). Before, the draw step drew directly, so "If you would draw a card, ... instead" never saw the most common draw of the game: Thought Reflection drew
 * one card, Laboratory Maniac's controller lost to an empty library, and dredge was never offered in the draw step. Real fixture cards on the game path.
 */
import { describe, expect, it } from 'vitest';
import { advanceTo, scenario, tweak } from '../../m5/helpers';
import { handSize } from '../../m5/cr-examples/helpers';
import { lifeOf } from '../../m4/helpers';

describe('CR 504.1, 614.6: the draw step\'s draw goes through the replacement pipeline', () => {
  it('CR 614.6: with Thought Reflection the active player draws two cards in the draw step', () => {
    const s = scenario(['Thought Reflection'], { p1: { battlefield: ['Thought Reflection'] } });
    const before = handSize(s, 'p1');
    expect(handSize(advanceTo(s, 3, 'main1'), 'p1')).toBe(before + 2);
  });

  it('CR 614.6, 104.2b: Laboratory Maniac\'s controller wins instead of drawing from an empty library in the draw step', () => {
    let s = scenario(['Laboratory Maniac'], { p1: { battlefield: ['Laboratory Maniac'] } });
    s = tweak(s, (t) => { t.zones.library.p1 = []; });
    s = advanceTo(s, 3, 'draw');
    expect(s.result).toMatchObject({ winner: 'p1' });
  });

  it('CR 702.52a: dredge is offered for the draw step\'s draw', () => {
    let s = scenario(['Golgari Thug'], { p1: { graveyard: ['Golgari Thug'] } });
    s = advanceTo(s, 3, 'draw');
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p1' });
  });

  it('CR 504.1, 121.4: without a replacement effect the draw is unchanged: one card, and an empty library still loses (SBA 704.5b)', () => {
    const s = scenario([]);
    const before = handSize(s, 'p1');
    expect(handSize(advanceTo(s, 3, 'main1'), 'p1')).toBe(before + 1);
    let e = tweak(s, (t) => { t.zones.library.p1 = []; });
    e = advanceTo(e, 3, 'draw');
    expect(e.result).toMatchObject({ winner: 'p2' });
    expect(lifeOf(e, 'p1')).toBe(20);
  });
});
