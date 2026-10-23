/**
 * WP2 review fixes: a field of the model that changes behavior has words or the renderer refuses the ability (design 3.3, 9). Each case here is a field that
 * used to be dropped: removal and choice in layer 4 (CR 613.1d), the options of a permission (CR 609.4), the player of a rule (CR 500.5), the players and
 * the chooser of a target (CR 601.2c, 601.7), the owner of a card in exile (CR 108.3, 406) and the types beside a subtype (CR 205.3).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, EffectStep, Modification, ObjectFilter, ObjRef, StaticEffect } from '../../../src/types/ability';
import '../../../src/render/boot';
import { K } from '../../../src/render/kernel';
import { newState } from '../../../src/render/state';
import { accepts, CTX, objTarget, rejects, spell, statics, t, you } from './build';

const creatures: ObjRef = { ref: 'each', filter: { types: ['Creature'] } };
const pump: Modification = { layer: '7c', power: 1, toughness: 1 };
const text = (def: AbilityDef): string => {
  try {
    return K.ability(def, newState(CTX));
  } catch (e) {
    return `refused: ${e instanceof Error ? e.message : String(e)}`;
  }
};

describe('CR 613.1d: removing or choosing a type in layer 4 is not dropped beside a modification that has words', () => {
  const anthem = (type: Modification): AbilityDef => statics([{ s: 'continuous', affects: creatures, mods: [type, pump] }]);
  it('the plain anthem is accepted', () => accepts(statics([{ s: 'continuous', affects: creatures, mods: [pump] }]), 'Creatures get +1/+1.'));
  it('subtypes.remove is refused', () => rejects(anthem({ layer: 4, subtypes: { remove: ['Human'] } }), 'Creatures get +1/+1.'));
  it('subtypes.chosen is refused', () => rejects(anthem({ layer: 4, subtypes: { chosen: 'type' } }), 'Creatures get +1/+1.'));
  it('types.remove and supertypes.remove are refused', () => {
    rejects(anthem({ layer: 4, types: { remove: ['Artifact'] } }), 'Creatures get +1/+1.');
    rejects(anthem({ layer: 4, supertypes: { remove: ['Legendary'] } }), 'Creatures get +1/+1.');
  });
  it('a layer-4 modification with no words at all is refused', () => rejects(anthem({ layer: 4, subtypes: {} }), 'Creatures get +1/+1.'));
});

describe('CR 609.4: the options of a permission are words or the permission is refused', () => {
  const permit = (extra: Record<string, unknown> = {}): AbilityDef =>
    statics([{ s: 'permit', who: you, action: 'cast', of: { types: ['Creature'] }, from: 'graveyard', ...extra } as StaticEffect]);
  it('the plain permission is accepted', () => accepts(permit(), 'You may cast creature spells from your graveyard.'));
  it('a cost change is refused', () => rejects(permit({ costChange: { kind: 'increase', generic: 2 } }), 'You may cast creature spells from your graveyard.'));
  it('granted abilities are refused', () => rejects(permit({ grants: [{ kind: 'keyword', text: '', keyword: 'haste' }] }), 'You may cast creature spells from your graveyard.'));
  it('a count on anything but a land play is refused', () => rejects(permit({ count: 2 }), 'You may cast creature spells from your graveyard.'));
  it('"as though" on a play permission is refused', () => rejects(statics([{ s: 'permit', who: you, action: 'play', asThough: 'it were a land', of: { types: ['Land'] } }]), 'You may play lands.'));
  it('a land play still takes its count', () => accepts(statics([{ s: 'permit', who: you, action: 'playLand', count: 2 }]), 'You may play two additional lands on each of your turns.'));
});

describe('CR 500.5: who a rule is about is stated', () => {
  const rule = (player?: unknown): AbilityDef => statics([{ s: 'rule', rule: 'manaDoesNotEmpty', ...(player ? { player } : {}) } as StaticEffect]);
  it('you', () => {
    accepts(rule(), "You don't lose unspent mana as steps and phases end.");
    rejects(rule(), "Mana pools don't empty as steps and phases end.");
  });
  it('each player', () => {
    accepts(rule({ ref: 'each', who: 'player' }), "Mana pools don't empty as steps and phases end.");
    rejects(rule({ ref: 'each', who: 'player' }), "You don't lose unspent mana as steps and phases end.");
  });
  it('a field the rule has no words for is refused', () => {
    const def = statics([{ s: 'rule', rule: 'startingLife', value: 40, of: { types: ['Creature'] } }]);
    rejects(def, 'You start the game with 40 life.');
  });
});

describe('CR 601.2c, 601.7: the players and the chooser of a target are words', () => {
  const anyOrPlayer = (extra: Record<string, unknown>): AbilityDef =>
    spell([{ op: 'damage', source: { ref: 'self' }, to: t('x'), amount: 2 } as EffectStep], [{ id: 'x', kind: 'objectOrPlayer', min: 1, max: 1, text: '', filter: { types: ['Creature'] }, ...extra } as never]);
  it('target creature or player', () => accepts(anyOrPlayer({}), 'Test Card deals 2 damage to target creature or player.'));
  it('players.who opponent is "creature or opponent"', () => {
    accepts(anyOrPlayer({ players: { who: 'opponent' } }), 'Test Card deals 2 damage to target creature or opponent.');
    rejects(anyOrPlayer({ players: { who: 'opponent' } }), 'Test Card deals 2 damage to target creature or player.');
  });
  it('a chooser other than the controller is refused', () => rejects(anyOrPlayer({ chooser: { ref: 'anOpponent' } }), 'Test Card deals 2 damage to target creature or player.'));
  it('players on an object target is refused', () => {
    const def = spell([{ op: 'destroy', what: t('c') } as EffectStep], [objTarget('c', { types: ['Creature'] }, { players: { who: 'opponent' } })]);
    rejects(def, 'Destroy target creature.');
  });
  it('a target required only if a condition holds needs that condition in the text', () => {
    const kicked = { cond: 'wasCast', kicked: true } as const;
    const spec = objTarget('c', { types: ['Creature'] }, { onlyIf: kicked });
    const withCond = spell([{ op: 'if', cond: kicked, then: [{ op: 'destroy', what: t('c') } as EffectStep] } as EffectStep], [spec]);
    accepts(withCond, 'If Test Card was kicked, destroy target creature.');
    const without = spell([{ op: 'destroy', what: t('c') } as EffectStep], [spec]);
    rejects(without, 'Destroy target creature.');
  });
});

describe('CR 108.3 and 406: the owner of a card in exile is stated', () => {
  const move = (filter: ObjectFilter): AbilityDef => spell([{ op: 'move', what: t('c'), to: { zone: 'battlefield' } } as EffectStep], [objTarget('c', filter)]);
  it.each(['exile', 'command'] as const)('owner in %s changes the words', (zone) => {
    const bare = text(move({ zone, types: ['Creature'] }));
    for (const owner of ['you', 'opponent'] as const) {
      const owned = text(move({ zone, types: ['Creature'], owner }));
      expect(owned, `${zone} ${owner}`).not.toBe(bare);
    }
  });
  it('a card you own in exile', () => {
    rejects(move({ zone: 'exile', types: ['Creature'], owner: 'you' }), 'Put target creature card in exile onto the battlefield.');
    accepts(move({ zone: 'exile', types: ['Creature'], owner: 'you' }), 'Put target creature card you own in exile onto the battlefield.');
  });
});

describe('CR 205.3: a type beside a subtype is consistent with it and is not dropped', () => {
  const destroy = (filter: ObjectFilter): AbilityDef => spell([{ op: 'destroy', what: t('c') } as EffectStep], [objTarget('c', filter)]);
  it('a creature type with the creature type says "creature"', () => {
    accepts(destroy({ types: ['Creature'], subtypes: ['Goblin'] }), 'Destroy target Goblin creature.');
    rejects(destroy({ types: ['Creature'], subtypes: ['Goblin'] }), 'Destroy target Goblin.');
  });
  it('a bare subtype is any permanent of that subtype', () => {
    accepts(destroy({ subtypes: ['Goblin'] }), 'Destroy target Goblin.');
    rejects(destroy({ subtypes: ['Goblin'] }), 'Destroy target Goblin creature.');
  });
  it('plural: Goblin creatures you control', () => {
    const all = spell([{ op: 'destroy', what: { ref: 'each', filter: { types: ['Creature'], subtypes: ['Goblin'], controller: 'you' } } } as EffectStep]);
    accepts(all, 'Destroy all Goblin creatures you control.');
    rejects(all, 'Destroy all Goblins you control.');
  });
  it('a type that contradicts the subtype is refused', () => {
    rejects(destroy({ types: ['Land'], subtypes: ['Goblin'] }), 'Destroy target Goblin.');
    rejects(destroy({ types: ['Instant'], subtypes: ['Goblin'] }), 'Destroy target Goblin.');
    rejects(destroy({ types: ['Creature'], subtypes: ['Equipment'] }), 'Destroy target Equipment.');
  });
  it('a type that the subtype implies adds nothing', () => {
    accepts(destroy({ types: ['Artifact'], subtypes: ['Equipment'] }), 'Destroy target Equipment.');
    accepts(destroy({ types: ['Land'], subtypes: ['Forest'] }), 'Destroy target Forest.');
    accepts(destroy({ subtypes: ['Equipment'] }), 'Destroy target Equipment.');
  });
});
