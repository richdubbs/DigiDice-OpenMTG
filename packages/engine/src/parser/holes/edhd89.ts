/**
 * edh-d-89 (Commander coordinator D, band 5,001-10,000, group combat; CR 702.122c, 702.122e, 603.4): readings of the `Cond` hole (parser/holes/cond.ts#atoms).
 *  - "it was crewed by exactly two creatures" (Mighty Servant of Leuk-o): after "whenever ~ becomes crewed", the number of creatures tapped to pay the cost of the crew ability that triggered it
 *    (`eventCrewers`, CR 702.122e: "only creatures that were tapped to pay the cost of the crew ability that caused it to trigger"). Only the pronoun "it" and a literal number; "this turn" is another
 *    condition (every crewer of the turn) and is not read.
 *  - "no other creatures are attacking that player" (Jin Sakai, Ghost of Tsushima): see `noOtherAttackingThatPlayer`.
 */
import type { Condition, PlayerRef } from '../../types/ability';
import { P, anaphorObj, numberAt, phraseAt, type Alt, type HoleCtx } from './core';

const W_IT_WAS_CREWED_BY_EXACTLY = P('it was crewed by exactly');
const W_NO_OTHER_CREATURES_ARE_ATTACKING_THAT_PLAYER = P('no other creatures are attacking that player');

/**
 * "no other creatures are attacking that player" (Jin Sakai, Ghost of Tsushima; CR 506.3, 508.1b, 603.4): after "whenever a creature you control attacks a player", no creature other than the one
 * that attacked (the event's attacker, never the source) is attacking the player it attacks (the event's defending player, the pronoun "that player"; a planeswalker or battle of that player is not
 * the player). `not` of `exists`.
 */
export function noOtherAttackingThatPlayer(): Condition {
  const that = anaphorObj({ sort: 'player', number: 'singular', head: 'player', text: 'that player' }) as PlayerRef;
  return { cond: 'not', of: { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], not: { is: { ref: 'event', role: 'attacker' } }, attacking: { defender: that as never } } } } };
}

export function edhd89CondAt(ctx: HoleCtx, pos: number): Alt[] {
  const no = phraseAt(ctx, pos, W_NO_OTHER_CREATURES_ARE_ATTACKING_THAT_PLAYER);
  if (no >= 0) return [{ end: no, value: noOtherAttackingThatPlayer() }];
  const e = phraseAt(ctx, pos, W_IT_WAS_CREWED_BY_EXACTLY);
  if (e < 0) return [];
  const n = numberAt(ctx, e);
  if (n === undefined || n < 1) return [];
  const end = phraseAt(ctx, e + 1, P(n === 1 ? 'creature' : 'creatures'));
  if (end < 0 || ctx.toks[end]?.norm === 'this') return [];
  return [{ end, value: { cond: 'eventCrewers', count: n } satisfies Condition }];
}
