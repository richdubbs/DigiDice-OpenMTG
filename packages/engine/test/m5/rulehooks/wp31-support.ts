/**
 * Shared setup of the WP31 tests (the rule actions wired at the W2 call-sites): a board with lands for both players, spells written as model JSON, and a way
 * to cast one with its targets and let it resolve through the real interpreter and pipeline (no fakes).
 */
import type { AbilityDef, CardDef, DecisionAnswer, EffectStep, GameState, ObjectId, TargetSpec } from '../../../src/index';
import { castAuto, find, passBoth, scenario, synth } from '../helpers';

export const LANDS = ['Island', 'Island', 'Island', 'Forest', 'Forest', 'Plains', 'Plains', 'Mountain'];

/** p1 and p2 with untapped lands (so spells are payable) and the given extra definitions and objects. */
export function board(defs: CardDef[], p1: { battlefield?: string[]; hand?: string[]; graveyard?: string[] } = {}, p2: { battlefield?: string[]; hand?: string[]; graveyard?: string[] } = {}, cards: string[] = []): GameState {
  return scenario([...new Set([...LANDS, ...cards])], {
    defs,
    p1: { battlefield: [...LANDS, ...(p1.battlefield ?? [])], hand: p1.hand ?? [], graveyard: p1.graveyard ?? [] },
    p2: { battlefield: [...LANDS, ...(p2.battlefield ?? [])], hand: p2.hand ?? [], graveyard: p2.graveyard ?? [] },
  });
}

/** A sorcery (or instant) whose only ability is a spell ability written as model JSON. */
export const spellCard = (name: string, text: string, steps: EffectStep[], targets: TargetSpec[] = [], type = 'Sorcery'): CardDef =>
  synth({ name, cost: '{1}', type, abilities: [{ kind: 'spell', text, effect: { targets, steps } } as AbilityDef] });

export const creatureTarget: TargetSpec = { id: 't0', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature' };
export const TARGET = { ref: 'target', id: 't0' } as const;

/** p1 casts the card (choosing these object targets) and both players pass until it has resolved. */
export function castAndResolve(s: GameState, name: string, targets: ObjectId[] = [], answers: DecisionAnswer[] = []): GameState {
  const chosen: DecisionAnswer[] = targets.length > 0 ? [{ kind: 'chooseTargets', targets: targets.map((id) => ({ kind: 'object' as const, id })) }] : [];
  return passBoth(castAuto(s, name, { answers: [...chosen, ...answers] }));
}

export const count = (s: GameState, zone: 'hand' | 'library' | 'graveyard', p: 'p1' | 'p2'): number => s.zones[zone][p]!.length;
export const here = (s: GameState, id: ObjectId): boolean => s.objects[id]?.zone === 'battlefield';
export { find };
