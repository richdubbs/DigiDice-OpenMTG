/**
 * WP2 review fixes: every field of an ObjectFilter that is present is ANDed (design 3.3), so a field the renderer does not print is a constraint the gate
 * cannot see. `attacking:false` is "nonattacking" (CR 506.4: a creature is attacking from the declaration until it leaves combat), `blocked:false` is
 * "unblocked" (CR 509.1h), `tapped:false` is "untapped" (CR 110.5), `token:false` is "nontoken" (CR 111.1) and so on: each present field changes the words
 * or the renderer refuses.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, Condition, ObjectFilter } from '../../../src/types/ability';
import '../../../src/render/boot';
import { K } from '../../../src/render/kernel';
import { newState } from '../../../src/render/state';
import { accepts, CTX, objTarget, rejects, self, spell, t, trig } from './build';

const destroy = (filter: ObjectFilter): AbilityDef => spell([{ op: 'destroy', what: t('c') }], [objTarget('c', filter)]);
const conditional = (filter: ObjectFilter): AbilityDef =>
  trig([{ ev: 'step', step: 'upkeep', whose: 'you' }], [{ op: 'draw', who: { ref: 'you' }, count: 1 }], { interveningIf: { cond: 'matches', object: self, filter } as Condition });

/** The printed text of an ability, or the refusal (a refusal is a legitimate answer for a field with no wording). */
function text(def: AbilityDef): string {
  try {
    return K.ability(def, newState(CTX));
  } catch (e) {
    return `refused: ${e instanceof Error ? e.message : String(e)}`;
  }
}

const BOOLEAN_FIELDS = [
  'tapped', 'token', 'isCard', 'faceDown', 'transformed', 'isCopy', 'attacking', 'blocking', 'blocked', 'attached', 'attachedToSource', 'enteredThisTurn',
  'dealtDamageThisTurn', 'attackedThisTurn', 'blockedThisTurn', 'colorless', 'multicolored', 'monocolored', 'self',
] as const;

describe('CR 109.3 and design 3.3 (all fields ANDed): a boolean filter field, true or false, changes the noun phrase', () => {
  const bare = { types: ['Creature'] } as ObjectFilter;
  for (const field of BOOLEAN_FIELDS) {
    for (const value of [true, false]) {
      it(`${field}: ${value}`, () => {
        const filter = { ...bare, [field]: value } as ObjectFilter;
        expect(text(destroy(filter)), `${field}:${value} prints exactly like the bare filter`).not.toBe(text(destroy(bare)));
        rejects(destroy(filter), 'Destroy target creature.');
      });
    }
  }
  it('other:false is "no constraint" and prints like the bare filter (it is the default)', () => {
    accepts(destroy({ types: ['Creature'], other: false }), 'Destroy target creature.');
  });
});

describe('CR 109.3 and design 3.3 (all fields ANDed): a boolean filter field changes a "matches" condition', () => {
  const bare = text(conditional({}));
  for (const field of BOOLEAN_FIELDS) {
    for (const value of [true, false]) {
      it(`${field}: ${value}`, () => {
        expect(text(conditional({ [field]: value } as ObjectFilter)), `${field}:${value} prints like an empty filter`).not.toBe(bare);
      });
    }
  }
  it('any other field of a filter without types is not dropped either (owner, zone, name, not ...)', () => {
    for (const filter of [{ owner: 'you' }, { name: 'Bear' }, { not: { types: ['Land'] } }, { zone: 'graveyard' }, { notName: 'Bear' }] as ObjectFilter[]) {
      expect(text(conditional(filter)), JSON.stringify(filter)).not.toBe(bare);
    }
  });
});

describe('CR 506.4, 509.1h, 110.5, 111.1: the negative status words', () => {
  it.each([
    [{ attacking: false }, 'Destroy target nonattacking creature.'],
    [{ blocking: false }, 'Destroy target nonblocking creature.'],
    [{ blocked: false }, 'Destroy target unblocked creature.'],
    [{ tapped: false }, 'Destroy target untapped creature.'],
    [{ token: false }, 'Destroy target nontoken creature.'],
    [{ faceDown: false }, 'Destroy target face-up creature.'],
    [{ colorless: false }, 'Destroy target colored creature.'],
    [{ attackedThisTurn: false }, "Destroy target creature that didn't attack this turn."],
    [{ blockedThisTurn: false }, "Destroy target creature that didn't block this turn."],
    [{ enteredThisTurn: false }, "Destroy target creature that didn't enter the battlefield this turn."],
    [{ dealtDamageThisTurn: false }, "Destroy target creature that wasn't dealt damage this turn."],
  ] as [ObjectFilter, string][])('%o', (f, wording) => accepts(destroy({ types: ['Creature'], ...f }), wording));
  it('the positive words are not accepted for the negative field', () => {
    rejects(destroy({ types: ['Creature'], attacking: false }), 'Destroy target attacking creature.');
    rejects(destroy({ types: ['Creature'], blocked: false }), 'Destroy target blocked creature.');
  });
});

describe('CR 109.3 and design 3.3: "this object" combined with other fields is not silently the source', () => {
  it('self:true with a type is refused, not printed as the source alone', () => {
    rejects(destroy({ self: true, types: ['Creature'] }), 'Destroy Test Card.');
    rejects(destroy({ self: true, types: ['Creature'] }), 'Destroy target creature.');
  });
});
