/**
 * Shared JSON of the M6-1 tests (m6 design 5, M6-1; section 6): the replacement statics of the acceptance cards, written by hand as the templates produce them
 * (or would, for a wording no template covers yet), on the real fixture cards (`withAbilities`), and small helpers to run the pipeline on a state.
 */
import type { AbilityDef, CardDef, EffectStep, ReplacementDef, StaticEffect } from '../../../src/index';
import { staticAbility, withAbilities } from '../../m5/propose/support';
import { synth } from '../../m5/helpers';

export { eventsOf, run, shieldRecord, staticAbility, withAbilities } from '../../m5/propose/support';

const replace = (r: Omit<ReplacementDef, 's'>): StaticEffect => ({ s: 'replace', ...r });

/** "If a source would deal damage to a permanent or player, it deals double that damage to that permanent or player instead." */
export const FURNACE = withAbilities('Furnace of Rath', [
  staticAbility('If a source would deal damage to a permanent or player, it deals double that damage to that permanent or player instead.', [
    replace({ replaces: { ev: 'damage' }, body: { b: 'modify', amount: { mul: 2 } } }),
  ]),
]);

/** "If you would draw a card, draw two cards instead." */
export const THOUGHT_REFLECTION = withAbilities('Thought Reflection', [
  staticAbility('If you would draw a card, draw two cards instead.', [
    replace({ replaces: { ev: 'draw', player: 'you' }, body: { b: 'instead', do: [{ op: 'draw', who: { ref: 'you' }, count: 2 }] } }),
  ]),
]);

/** Doubling Season (rep.double.tokens, rep.double.counters with `byEffect`, CR 614.16). */
export const DOUBLING_SEASON = withAbilities('Doubling Season', [
  staticAbility('If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.', [
    replace({ replaces: { ev: 'createToken', player: 'you', byEffect: true }, body: { b: 'modify', count: { mul: 2 } } }),
  ]),
  staticAbility('If an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.', [
    replace({ replaces: { ev: 'counters', change: 'put', on: { controller: 'you' }, byEffect: true }, body: { b: 'modify', count: { mul: 2 } } }),
  ]),
]);

/** "If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead." (any cause) */
export const HARDENED_SCALES = withAbilities('Hardened Scales', [
  staticAbility('If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.', [
    replace({ replaces: { ev: 'counters', change: 'put', kind: '+1/+1', on: { types: ['Creature'], controller: 'you' } }, body: { b: 'modify', count: { add: 1 } } }),
  ]),
]);

export const LEYLINE = withAbilities('Leyline of the Void', [
  staticAbility('If a card would be put into an opponent\'s graveyard from anywhere, exile it instead.', [
    replace({ replaces: { ev: 'zoneChange', subject: { isCard: true, owner: 'opponent' }, to: 'graveyard' }, body: { b: 'modify', destination: { zone: 'exile' } } }),
  ]),
]);

export const REST_IN_PEACE = withAbilities('Rest in Peace', [
  staticAbility('If a card or token would be put into a graveyard from anywhere, exile it instead.', [
    replace({ replaces: { ev: 'zoneChange', subject: {}, to: 'graveyard' }, body: { b: 'modify', destination: { zone: 'exile' } } }),
  ]),
]);

/** "Permanents enter tapped." (CR 614.12: it doesn't affect itself, it isn't on the battlefield yet). */
export const ORB_OF_DREAMS = withAbilities('Orb of Dreams', [
  staticAbility('Permanents enter tapped.', [replace({ replaces: { ev: 'zoneChange', subject: {}, to: 'battlefield' }, body: { b: 'enters', tapped: true } })]),
]);

/** "All damage that would be dealt to you is dealt to enchanted creature instead." (with Enchant creature from the card's keyword line) */
export function pariah(): CardDef {
  return withAbilities('Pariah', [
    { kind: 'keyword', keyword: 'enchant', filter: { types: ['Creature'] }, text: 'Enchant creature' } as AbilityDef,
    staticAbility('All damage that would be dealt to you is dealt to enchanted creature instead.', [
      replace({ replaces: { ev: 'damage', recipient: { player: 'you' } }, body: { b: 'redirect', to: { ref: 'attachedTo' } } }),
    ]),
  ]);
}

/** "If you would draw a card while your library has no cards in it, you win the game instead." */
export const LAB_MANIAC = withAbilities('Laboratory Maniac', [
  staticAbility('If you would draw a card while your library has no cards in it, you win the game instead.', [
    replace({
      replaces: { ev: 'draw', player: 'you' },
      condition: { cond: 'compare', left: { q: 'zoneSize', zone: 'library', of: { ref: 'you' } }, op: '==', right: 0 },
      body: { b: 'instead', do: [{ op: 'winGame', who: { ref: 'you' } }] },
    }),
  ]),
]);

/** A synthetic enchantment with these replacement statics (for wordings with no real card in the fixture). */
export const enchantment = (name: string, effects: StaticEffect[], text = name): CardDef => synth({ name, type: 'Enchantment', abilities: [staticAbility(text, effects)] });

/** A synthetic creature with these abilities. */
export const creatureWith = (name: string, pt: [string, string], abilities: AbilityDef[]): CardDef => synth({ name, type: 'Creature — Test', pt, abilities });

/** A spell step that creates a shield (CR 615.7-615.8) or a replacement effect lasting a duration. */
export const effectStep = (effect: ReplacementDef, d: 'endOfTurn' | 'permanent' = 'endOfTurn'): EffectStep => ({ op: 'effect', effects: [effect], duration: { d } });
