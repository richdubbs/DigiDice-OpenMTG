/**
 * M6-1 review: the loyalty counters a planeswalker enters with (CR 306.5b) and the defense counters a battle enters with (CR 310.4b) come from replacement
 * effects built into the card types (CR 614.1c). CR 614.16: "if an effect would put one or more counters" also applies when a replacement effect puts them,
 * so Doubling Season doubles them (its ruling: a planeswalker enters with twice its printed loyalty). A loyalty cost (CR 606.4) is a cost, not an effect, so a
 * +N ability is not doubled. "Can't have counters put on it" still stops them (CR 122.6, 614.17).
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState } from '../../../src/index';
import { proposeResult } from '../../../src/effects/propose';
import { act } from '../../m3/scenario';
import { find, scenario, synth, activated } from '../../m5/helpers';
import { DOUBLING_SEASON, HARDENED_SCALES, run } from './support';

const enterFromHand = (s: GameState, name: string) => {
  const id = find(s, name, 'hand');
  return run(s, (g) => proposeResult(g, { ev: 'zoneChange', object: { id, zone: 'hand' }, from: 'hand', to: 'battlefield', destination: { controller: 'p1' } }));
};

describe('CR 306.5b, 310.4b, 614.16: printed loyalty and defense counters go through the replacement pipeline', () => {
  it('CR 306.5b, 614.16: Doubling Season (hand-written JSON): Garruk Wildspeaker (loyalty 3) enters with 6 loyalty counters', () => {
    const s = scenario(['Garruk Wildspeaker', 'Doubling Season'], { p1: { battlefield: ['Doubling Season'], hand: ['Garruk Wildspeaker'] }, defs: [DOUBLING_SEASON] });
    const r = enterFromHand(s, 'Garruk Wildspeaker');
    expect(r.need).toBeUndefined();
    expect(r.g.s.objects[r.result!.newIds[0]!]!.counters).toEqual({ loyalty: 6 });
  });

  it('CR 306.5b, 614.16: the compiled Doubling Season doubles the printed loyalty too', () => {
    const s = scenario(['Garruk Wildspeaker', 'Doubling Season'], { p1: { battlefield: ['Doubling Season'], hand: ['Garruk Wildspeaker'] } });
    const r = enterFromHand(s, 'Garruk Wildspeaker');
    expect(r.need).toBeUndefined();
    expect(r.g.s.objects[r.result!.newIds[0]!]!.counters).toEqual({ loyalty: 6 });
  });

  it('CR 310.4b, 614.16: Doubling Season doubles the defense counters a battle enters with', () => {
    const plain = scenario(['Invasion of Ergamon // Truga Cliffcharger'], { p1: { hand: ['Invasion of Ergamon // Truga Cliffcharger'] } });
    const base = enterFromHand(plain, 'Invasion of Ergamon // Truga Cliffcharger');
    const printed = base.g.s.objects[base.result!.newIds[0]!]!.counters.defense!;
    expect(printed).toBeGreaterThan(0);
    const s = scenario(['Invasion of Ergamon // Truga Cliffcharger', 'Doubling Season'], {
      p1: { battlefield: ['Doubling Season'], hand: ['Invasion of Ergamon // Truga Cliffcharger'] }, defs: [DOUBLING_SEASON],
    });
    const r = enterFromHand(s, 'Invasion of Ergamon // Truga Cliffcharger');
    expect(r.g.s.objects[r.result!.newIds[0]!]!.counters).toEqual({ defense: printed * 2 });
  });

  it('CR 306.5b: with no counters replacement the printed loyalty is put as before; Hardened Scales (+1/+1 only) does not touch it', () => {
    const s = scenario(['Garruk Wildspeaker', 'Hardened Scales'], { p1: { battlefield: ['Hardened Scales'], hand: ['Garruk Wildspeaker'] }, defs: [HARDENED_SCALES] });
    const r = enterFromHand(s, 'Garruk Wildspeaker');
    expect(r.need).toBeUndefined();
    expect(r.g.s.objects[r.result!.newIds[0]!]!.counters).toEqual({ loyalty: 3 });
    expect(r.g.events.filter((e) => e.type === 'countersChanged')).toEqual([expect.objectContaining({ counter: 'loyalty', delta: 3 })]);
  });

  it('CR 606.4, 614.16: a +1 loyalty cost is a cost, not an effect: Doubling Season does not double it', () => {
    const walker: CardDef = synth({
      name: 'Test Walker', cost: '{3}', type: 'Planeswalker — Test',
      abilities: [activated('+1: Do a thing.', { loyalty: 1 }, [], { isLoyalty: true })],
    });
    let s = scenario([], { p1: { battlefield: ['Doubling Season', { name: 'Test Walker', counters: { loyalty: 3 } }] }, defs: [DOUBLING_SEASON, walker] });
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Walker', 'battlefield'), ability: 'p:0:0' });
    expect(s.objects[find(s, 'Test Walker', 'battlefield')]!.counters.loyalty).toBe(4);
  });
});
