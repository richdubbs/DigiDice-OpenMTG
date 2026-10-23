/**
 * r3-cost: "Crew 1. Activate only once each turn." (Luxurious Locomotive; parser/lower/ability.ts#staticAbility reads the keyword with the restriction on its
 * line as one keyword ability, FAST5X E27's `limit`), played with synthetic cards (design 6.10).
 *
 *   CR 702.122a, 602.5b   the crew ability is activated once; with untapped creatures left it is not offered again that turn; the next turn it is
 */
import { describe, expect, it } from 'vitest';
import { act, activations, advanceTo, card, drive, full, passBoth, scenario } from './support';

const CAR = card('Test Rail Car', 'Artifact — Vehicle', 'Crew 1. Activate only once each turn.', '{3}', ['4', '4']);
const PLAIN = card('Test Hand Car', 'Artifact — Vehicle', 'Crew 1', '{3}', ['4', '4']);
const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
const DEFS = [CAR, PLAIN, BEAR];

describe('r3-cost: "Crew 1. Activate only once each turn." (CR 702.122a, 602.5b)', () => {
  it('is automated: a crew keyword whose activated ability has the limit', () => {
    expect(full(CAR)).toBe(true);
    expect(CAR.faces[0]!.abilities[0]).toMatchObject({ kind: 'keyword', keyword: 'crew', amount: 1, limit: { per: 'turn', max: 1 } });
  });
  it('crews once; with another untapped creature it is not offered again this turn; next turn it is', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Rail Car', 'Test Bear', 'Test Bear'] } });
    expect(activations(s, 'Test Rail Car')).toHaveLength(1);
    s = drive(act(s, activations(s, 'Test Rail Car')[0]!.action));
    s = passBoth(s);
    expect(s.zones.stack).toEqual([]);
    const car = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Rail Car')!;
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Bear' && s.objects[id]!.tapped !== true)).toHaveLength(1);
    expect(activations(s, 'Test Rail Car')).toEqual([]);
    s = advanceTo(s, 3, 'main1');
    expect(s.objects[car]!.zone).toBe('battlefield');
    expect(activations(s, 'Test Rail Car')).toHaveLength(1);
  });
  it('without the restriction, a second crew is offered the same turn (the control case)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Hand Car', 'Test Bear', 'Test Bear'] } });
    s = passBoth(drive(act(s, activations(s, 'Test Hand Car')[0]!.action)));
    expect(activations(s, 'Test Hand Car')).toHaveLength(1);
  });
});
