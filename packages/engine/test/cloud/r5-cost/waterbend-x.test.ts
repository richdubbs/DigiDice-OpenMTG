/**
 * r5-cost: "waterbend {X}" as a cost (parser/holes/cost.ts; FAST5X E10's waterbend, rules/cost.ts), played with synthetic cards (design 6.10).
 *
 *   CR 701.67a, 107.3a, 601.2b   "As an additional cost to cast this spell, waterbend {X}.": X is announced with the spell; each untapped artifact or creature
 *                                tapped pays {1} of it
 *   CR 701.67a, 602.2b           "Waterbend {X}, {T}: ...": the same in an activated ability's cost
 */
import { describe, expect, it } from 'vitest';
import { act, activations, card, cast, drive, full, lifeOf, resolveAll, scenario } from './support';

const TIDE = card('Test Tide Gift', 'Sorcery', 'As an additional cost to cast this spell, waterbend {X}.\nYou gain X life.', '{U}');
const FONT = card('Test Water Font', 'Artifact', 'Waterbend {X}, {T}: You gain X life.', '{0}');
const SPRITE = card('Test Sprite', 'Creature — Faerie', '', '{0}', ['1', '1']);
const DEFS = [TIDE, FONT, SPRITE];

describe('r5-cost: waterbend {X}', () => {
  it('the cards are automated', () => {
    for (const d of [TIDE, FONT]) expect(full(d), d.name).toBe(true);
  });

  it('CR 701.67a, 107.3a: X = 2 paid by tapping two creatures; the spell reads X', () => {
    const s0 = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Tide Gift'], battlefield: ['Island', 'Test Sprite', 'Test Sprite'] } });
    const s = resolveAll(cast(s0, 'Test Tide Gift', { x: [2] }));
    expect(lifeOf(s, 'p1')).toBe(22);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped)).toHaveLength(3); // the Island and both Sprites
  });

  it('CR 107.3a, 601.2h: X can be no more than what can be paid', () => {
    const s0 = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Tide Gift'], battlefield: ['Island', 'Test Sprite'] } });
    const s1 = act(s0, { type: 'cast', player: 'p1', card: s0.zones.hand.p1![0]! });
    const d = s1.pending;
    expect(d?.kind === 'chooseNumber' ? d.max : d?.kind).toBe(1);
  });

  it('CR 701.67a, 602.2b: the activated ability with X = 1 taps the Sprite for the waterbend and gains 1 life', () => {
    const s0 = scenario(['Island'], { defs: DEFS, p1: { battlefield: ['Test Water Font', 'Test Sprite'] } });
    const s = resolveAll(drive(act(s0, activations(s0, 'Test Water Font')[0]!.action), { x: [1] }));
    expect(lifeOf(s, 'p1')).toBe(21);
  });
});
