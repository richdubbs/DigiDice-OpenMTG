/**
 * WP8 review: what only a real neighbor can settle (design 15.1.7: "tests that need a real neighbor are marked and enabled at that merge").
 *
 * The `it.todo` entries that were named by rule and by the work package whose merge enables them are tests since WP31 (wp31-integration.test.ts). The
 * agreement test below: `triggers/filters.ts#objectMatches` re-implements part of `rules/filter.ts#matchesFilter` (the identity fields), and the two must
 * agree on every field both evaluate.
 */
import { describe, expect, it } from 'vitest';
import type { ObjectFilter } from '../../../src/index';
import { matchesFilter, NO_ENV } from '../../../src/rules/filter';
import { objectMatches } from '../../../src/triggers/filters';
import { keyword, synth } from '../helpers';
import { vanilla } from './cards';
import { find, scenario, tweak } from './helpers';

// WP31: the integration placeholders that stood here are tests now, in wp31-integration.test.ts, with the real neighbors: CR 603.4 (the intervening "if" on
// resolution), 603.6b (an enters trigger looked for in the permanent as it enters, under a Humility-style effect), 603.10a twice (a look-back filter judges
// LastKnown.chars: an anthem, counters and a Giant Growth effect; triggers/filters.ts#objectMatches now passes the recorded characteristics to
// rules/filter.ts#matchesFilter), the evalCond / localCondition agreement (603.4, 603.8), 603.3d (a triggered ability announces its division) and the WP14
// events (attached, transformed, countered advertised; the keyword-action verbs not yet). CR 706 (`ev:dieRoll`) is in test/m5/lasting/game.test.ts.
// WP32: `becomes targeted` is advertised (wp32-ward.test.ts) and CR 605.1b / 605.4a triggered mana abilities resolve at once (wp32-mana-trigger.test.ts).

describe('triggers/filters.ts#objectMatches agrees with rules/filter.ts#matchesFilter on every field both evaluate', () => {
  const flyer = synth({ name: 'Test Flyer', cost: '{1}{W}', type: 'Creature — Bird Soldier', pt: ['1', '3'], abilities: [keyword('flying')] });
  const defs = [flyer, vanilla(), vanilla('Test Big', ['4', '4'])];
  const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Flyer', 'Test Vanilla', 'Plains'] }, p2: { battlefield: ['Test Big'] } });
  const s = tweak(s0, (t) => { t.objects[find(s0, 'Test Vanilla', 'battlefield')]!.tapped = true; });
  const objects = s.zones.battlefield.map((id) => s.objects[id]!);
  const source = find(s, 'Test Flyer', 'battlefield');

  const filters: ObjectFilter[] = [
    {}, { types: ['Creature'] }, { types: ['Land'] }, { types: ['Creature'], notTypes: ['Land'] }, { subtypes: ['Bird'] }, { subtypes: ['Soldier'] }, { colors: ['W'] }, { notColors: ['W'] },
    { colorless: true }, { power: { op: '>=', value: 2 } }, { toughness: { op: '<', value: 4 } }, { manaValue: { op: '==', value: 2 } }, { tapped: true }, { tapped: false },
    { token: false }, { name: 'Test Big' }, { controller: 'you' }, { controller: 'opponent' }, { owner: 'you' }, { keyword: 'flying' }, { notKeyword: 'flying' },
    { types: ['Creature'], controller: 'you', power: { op: '<=', value: 2 } }, { types: ['Creature'], controller: 'opponent', keyword: 'flying' },
  ];

  it('for every object and filter of the table (identity fields aside)', () => {
    let compared = 0;
    for (const o of objects) {
      for (const f of filters) {
        const a = objectMatches(s, f, o, [o.id], { source, controller: 'p1' });
        const b = matchesFilter(s, o, f, { you: 'p1', sourceId: source, env: NO_ENV });
        expect(a, `${s.defs[o.defId]!.name} vs ${JSON.stringify(f)}`).toBe(b);
        compared++;
      }
    }
    expect(compared).toBe(objects.length * filters.length);
  });

  it('the identity fields are the one thing objectMatches adds: self / other follow every id the object had, anyOf / not combine', () => {
    const flyerObj = s.objects[source]!;
    const big = s.objects[find(s, 'Test Big', 'battlefield')]!;
    const cx = { source, controller: 'p1' } as const;
    expect(objectMatches(s, { self: true }, flyerObj, [source], cx)).toBe(true);
    expect(objectMatches(s, { self: true }, big, [big.id], cx)).toBe(false);
    expect(objectMatches(s, { other: true }, flyerObj, [source], cx)).toBe(false);
    expect(objectMatches(s, { other: true }, big, [big.id], cx)).toBe(true);
    expect(objectMatches(s, { self: true }, flyerObj, ['somethingelse', source], cx)).toBe(true); // a zone change gave it a second id
    expect(objectMatches(s, { anyOf: [{ self: true }, { name: 'Test Big' }] }, big, [big.id], cx)).toBe(true);
    expect(objectMatches(s, { not: { name: 'Test Big' } }, big, [big.id], cx)).toBe(false);
  });
});
