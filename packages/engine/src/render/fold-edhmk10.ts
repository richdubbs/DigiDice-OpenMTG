/**
 * Commander lane edh-mana-keywords, round edh-mana-keywords-10: the folds of its readings. Owner: edh-mana-keywords-10.
 *
 *   `lookAtRandomInHand`: "look at a card at random in target player's hand"
 */
import type { EffectStep, PlayerRef } from '../types/ability';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { bind, byPlayer } from './steps-util';

const isBound = (r: unknown, name: string): boolean => typeof r === 'object' && r !== null && (r as { ref?: unknown }).ref === 'bound' && (r as { name?: unknown }).name === name;

/**
 * CR 701.20e, 608.2d, 402.3: "look at a card at random in target player's hand" (Urza's Bauble): one card of that player's hand chosen at random (no player decides),
 * then you look at exactly that card. Only that exact shape: a choice by you, at random, of exactly one card among the cards of one player's hand (no description),
 * then your look at exactly that card. A group of players ("each opponent's hand") is not this (one card among all their hands), it stays manual (fail closed).
 */
export function lookAtRandomInHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'look' || a.as === undefined || a.random !== true || a.guard !== undefined || a.groupLimit !== undefined || a.perPlayer !== undefined) return null;
  if (a.min !== 1 || a.max !== 1 || a.who.ref !== 'you' || b.who.ref !== 'you' || b.guard !== undefined || !isBound(b.at, a.as)) return null;
  if (a.from.ref !== 'each' || !('filter' in a.from) || a.from.filter === undefined) return null;
  const f = a.from.filter;
  if (Object.keys(f).some((k) => k !== 'zone' && k !== 'owner') || f.zone !== 'hand' || f.owner === undefined || typeof f.owner !== 'object' || (f.owner as { ref?: string }).ref === 'each') return null;
  const poss = K.player(f.owner as unknown as PlayerRef, st, 'possessive').text;
  const c = byPlayer(b.who, st, 'look', `at a card at random in ${poss} hand`, { standalone: true });
  bind(st, a.as, { nouns: ['card'], plural: false, hand: true, alts: ['the card you looked at'] });
  return { clauses: [c], consumed: 2 };
}
