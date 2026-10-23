/**
 * Phase 2 lane p2-coinflip, round p2-coinflip-1: the folds of its random choices (CR 608.2d: a choice "at random" is made by no player). Owner: p2-coinflip-1.
 *
 *   `returnRandomFromGraveyard`: "return a creature card at random from your graveyard to your hand", "return X cards at random from your graveyard to your hand";
 *                                p2-coinflip-3: "return a Zombie creature card at random from your graveyard to the battlefield"
 *   `revealRandomFromHand`: "target player reveals a card at random from their hand"
 */
import type { EffectStep } from '../types/ability';
import { acting, type Clause } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { bind, byPlayer } from './steps-util';
import { numWord } from './text';

const isBound = (r: unknown, name: string): boolean => typeof r === 'object' && r !== null && (r as { ref?: unknown }).ref === 'bound' && (r as { name?: unknown }).name === name;

/**
 * CR 608.2d, 404.1, 400.7: "return a creature card at random from your graveyard to your hand" (Viconia, Drow Apostate; Woodland Sleuth), "return X cards at random
 * from your graveyard to your hand" (Reap the Past): the cards of your graveyard (of one description, or any) chosen at random, then put into your hand. Only that
 * exact shape: one choice by you, at random, of exactly N cards (one with a description, or a number of any cards) among the cards of your graveyard, then the move
 * of exactly the chosen cards to their owner's hand.
 */
export function returnRandomFromGraveyard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const m = list[i + 1];
  if (a?.op !== 'chooseObjects' || a.as === undefined || a.random !== true || a.guard !== undefined || a.who.ref !== 'you' || a.groupLimit !== undefined || a.perPlayer !== undefined) return null;
  if (a.from.ref !== 'each' || !('filter' in a.from) || a.from.filter === undefined) return null;
  const { zone, owner, isCard, anyOf, ...rest } = a.from.filter;
  if (zone !== 'graveyard' || owner !== 'you' || isCard !== true || Object.keys(rest).length > 0) return null;
  if (m?.op !== 'move' || m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined || !isBound(m.what, a.as)) return null;
  // p2-coinflip-3 (CR 110.2, 400.7): or onto the battlefield under your control, "... at random from your graveyard to the battlefield" (Tomb Tyrant)
  const toHand = JSON.stringify(m.to) === JSON.stringify({ zone: 'hand' });
  if (!toHand && JSON.stringify(m.to) !== JSON.stringify({ zone: 'battlefield', controller: { ref: 'you' } })) return null;
  if (JSON.stringify(a.min) !== JSON.stringify(a.max)) return null;
  if (a.min === 'any') return null; // "any number of cards at random" is no reading of this fold
  let what: string;
  if (anyOf !== undefined) {
    if (anyOf.length !== 1 || a.min !== 1) return null;
    what = K.np({ ...anyOf[0]!, zone: 'graveyard' }, st, { det: 'a', noZone: true });
    if (!/ card$/.test(what)) what = `${what} card`;
    bind(st, a.as, { nouns: K.nounsOf(anyOf[0]!), plural: false, hand: toHand });
  } else {
    if (a.min === 1) return null;
    what = `${typeof a.min === 'number' ? numWord(a.min) : K.qty(a.min, st)} cards`;
    if (!toHand) return null; // "return two cards at random from your graveyard to the battlefield" is printed nowhere
    bind(st, a.as, { nouns: ['card'], plural: true, hand: true });
  }
  const text = `return ${what} at random from your graveyard to ${toHand ? 'your hand' : 'the battlefield'}`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 2 };
}

/**
 * CR 701.20a, 608.2d: "target player reveals a card at random from their hand" (Merfolk Spy, Ignite Memories, Singe-Mind Ogre): one card of that player's hand chosen
 * at random, then revealed by that player; "that card" names it afterwards. Only that exact shape: a choice by a player, at random, of exactly one card among the
 * cards of that same player's hand (no description), then that player's reveal of exactly that card. One player only: "each opponent reveals a card at random" is not
 * this (one card each, a per-player choice the step does not state), so it stays manual (fail closed).
 */
export function revealRandomFromHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'reveal' || a.as === undefined || a.random !== true || a.guard !== undefined || a.groupLimit !== undefined || a.perPlayer !== undefined) return null;
  if (a.min !== 1 || a.max !== 1 || b.guard !== undefined || b.to !== undefined || !isBound(b.what, a.as)) return null;
  // one player only: a group ("each opponent") would pick one card among all of their hands (effects/handlers/choose.ts draws from one pool), never one each
  if (a.who.ref === 'each') return null;
  if (a.from.ref !== 'each' || !('filter' in a.from) || a.from.filter === undefined) return null;
  const f = a.from.filter;
  if (Object.keys(f).some((k) => k !== 'zone' && k !== 'owner') || f.zone !== 'hand' || JSON.stringify(f.owner) !== JSON.stringify(a.who) || JSON.stringify(b.who) !== JSON.stringify(a.who)) return null;
  bind(st, a.as, { nouns: ['card'], plural: false, hand: true, alts: ['the revealed card'] }); // the chosen card is the one "that card" names (the parser's binding; one binding: two would be ambiguous)
  // p2-coinflip-2 (CR 119.3, 202.3): "..., then loses life equal to that card's mana value" (Singe-Mind Ogre): the same player loses life equal to the chosen card's mana value
  const l = list[i + 2];
  const mv = { q: 'stat', stat: 'manaValue', of: { ref: 'bound', name: a.as } };
  if (l?.op === 'loseLife' && l.guard === undefined && JSON.stringify(l.who) === JSON.stringify(a.who) && JSON.stringify(l.amount) === JSON.stringify(mv) && a.who.ref !== 'you') {
    return { clauses: [byPlayer(a.who, st, 'reveal', "a card at random from their hand, then loses life equal to that card's mana value", { standalone: true })], consumed: 3 };
  }
  const c: Clause = byPlayer(a.who, st, 'reveal', 'a card at random from their hand', { standalone: true });
  return { clauses: [c], consumed: 2 };
}
