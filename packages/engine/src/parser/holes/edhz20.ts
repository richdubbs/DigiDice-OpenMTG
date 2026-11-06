/**
 * edh-zones-20 ADDITION: readings of the `Cond` hole (parser/holes/cond.ts#atoms) for the condition a trigger's event states about the player it names.
 *  - "who controls more lands than you" (after "deals combat damage to a player"): the description counted for the player the event names and for you, the first strictly
 *    greater (CR 603.1, 109.4). The player is the anaphor "that player", which the trigger lowering resolves to the player of the event (lower/ability.ts#resolveCondAnaphors,
 *    `TriggerDef.while`, judged once as the event happens), and which stays unresolved (the ability manual) anywhere else.
 */
import type { Condition, ObjectFilter } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, anaphorObj, mergeFilter, phraseAt } from './core';
import { npAlts } from './filter';

const W_WHO_CONTROLS_MORE = P('who controls more');
const W_THAN_YOU = P('than you');

export function edhz20CondAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const more = phraseAt(ctx, pos, W_WHO_CONTROLS_MORE);
  if (more < 0) return out;
  for (const n of npAlts(ctx, more)) {
    if (n.number !== 'plural' || n.filter.controller !== undefined || n.filter.zone !== undefined || n.filter.owner !== undefined) continue;
    const than = phraseAt(ctx, n.end, W_THAN_YOU);
    if (than < 0) continue;
    const player = anaphorObj({ sort: 'player', number: 'singular', head: 'player', text: 'that player' });
    const theirs: ObjectFilter | null = mergeFilter(n.filter, { controller: player as never });
    const mine: ObjectFilter | null = mergeFilter(n.filter, { controller: 'you' });
    if (theirs === null || mine === null) continue;
    const value: Condition = { cond: 'compare', left: { q: 'count', of: { ref: 'each', filter: theirs } }, op: '>', right: { q: 'count', of: { ref: 'each', filter: mine } } };
    out.push({ end: than, value, ...(n.flags.length > 0 ? { flags: [...n.flags] } : {}) });
  }
  return out;
}
