/**
 * edh-d-102 (CR 115.1, 601.2c, 608.2f, 406.1, 120.3, 202.3, 611.2a; Soulfire Eruption): the program "Choose any number of target creatures, planeswalkers, and/or players. For each of
 * them, exile the top card of your library, then ~ deals damage equal to that card's mana value to that permanent or player. You may play the exiled cards until the end of your next
 * turn.": one target of creatures, planeswalkers and players (any number), a loop over it that exiles the top card of your library and deals damage equal to its mana value to the one
 * the loop is on, the exiled cards gathered, then a permission to play those cards until the end of your next turn. Null for any other program (only that exact shape).
 */
import type { EffectProgram } from '../types/ability';
import { K } from './kernel';
import { cloneState, type RenderState } from './state';

const canon = (v: unknown): string => JSON.stringify(v);

export function chosenEachExileDamage(p: EffectProgram, st: RenderState): string | null {
  const [t] = p.targets;
  if (p.targets.length !== 1 || t === undefined || p.steps.length !== 2) return null;
  if (canon(t) !== canon({ id: t.id, kind: 'objectOrPlayer', min: 0, max: 'any', text: t.text, filter: { types: ['Creature', 'Planeswalker'] }, players: { who: 'any' } })) return null;
  const [loop, permit] = p.steps;
  if (loop?.op !== 'forEach' || typeof loop.gather !== 'string' || loop.inDirection !== undefined || loop.guard !== undefined || canon(loop.over) !== canon({ ref: 'target', id: t.id }) || loop.do.length !== 2) return null;
  const [mv, dmg] = loop.do;
  const g = loop.gather;
  if (canon(mv) !== canon({ op: 'move', what: { ref: 'topCards', player: { ref: 'you' }, count: 1 }, to: { zone: 'exile' }, as: g })) return null;
  if (dmg?.op !== 'damage' || dmg.source === undefined || Object.keys(dmg).length !== 4 || canon(dmg.to) !== canon({ ref: 'bound', name: loop.as }) || canon(dmg.amount) !== canon({ q: 'stat', stat: 'manaValue', of: { ref: 'bound', name: g } })) return null;
  if (canon(permit) !== canon({ op: 'effect', duration: { d: 'endOfNextTurn', whose: { ref: 'you' } }, effects: [{ s: 'permit', who: { ref: 'you' }, action: 'play', of: { is: { ref: 'bound', name: g } } }] })) return null;
  const v = cloneState(st);
  const src = K.obj(dmg.source, v, 'subject').text;
  return `choose any number of target creatures, planeswalkers, and/or players. for each of them, exile the top card of your library, then ${src} deals damage equal to that card's mana value to that permanent or player. you may play the exiled cards until the end of your next turn`;
}
