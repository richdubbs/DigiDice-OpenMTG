/**
 * edh-d-93 (Commander coordinator D, EDHREC ranks 5,001-10,000, group counters; code edhd93): the hole `FewerPut`, "you put fewer than <N> <cards> onto the battlefield this
 * way" (CR 608.2c, 608.2h; Expand the Sphere: "Put up to two land cards from among them onto the battlefield tapped and the rest on the bottom of your library in a random order.
 * If you put fewer than two lands onto the battlefield this way, proliferate a number of times equal to the difference."). The value is the condition "the objects the ONE earlier
 * move onto the battlefield reported are fewer than N", as C7's `$moved` count (parser/holes/moved-words.ts; lower/quantities.ts binds the count to that move, or the sentence is
 * manual), the same shape as edh-c-73's `FewerDiscarded` (parser/holes/edhv73.ts); the template reads the number and the count from its `left` and `right`.
 */
import type { Condition } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, anaphorObj, phraseAt } from './core';
import { npAlts } from './filter';
import { MOVED_MARK } from './moved-words';

const W_YOU_PUT_FEWER_THAN = P('you put fewer than');
const W_ONTO_BF_THIS_WAY = P('onto the battlefield this way');

export function fewerPut(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const at = phraseAt(ctx, pos, W_YOU_PUT_FEWER_THAN);
  if (at < 0) return out;
  for (const q of ctx.call('Qty', at)) {
    if (typeof q.value !== 'number' || q.value < 2) continue;
    for (const n of npAlts(ctx, q.end)) {
      const f = n.filter as Record<string, unknown>;
      if (n.number !== 'plural' || n.flags.some((x) => x !== 'zone-unstated') || Object.keys(f).some((k) => k !== 'isCard' && k !== 'types' && k !== 'subtypes' && k !== 'supertypes' && k !== 'not')) continue;
      const e = phraseAt(ctx, n.end, W_ONTO_BF_THIS_WAY);
      if (e < 0) continue;
      const counted = { ref: 'each', filter: { ...n.filter, [MOVED_MARK]: 'battlefield' } };
      out.push({ end: e, value: { cond: 'compare', left: { q: 'count', of: counted }, op: '<', right: q.value } as unknown as Condition });
    }
  }
  return out;
}

const W_ONE_OR_MORE = P('one or more');
const W_COUNTERS_ARE_MOVED_THIS_WAY = P('counters are moved this way');

/**
 * edh-d-93 (CR 122.5, 608.2c, 608.2h; Black Panther, Wakandan King): the hole `CountersMoved`, "one or more <kind> counters are moved this way" after "Move all <kind> counters from A onto B.": the
 * counters the moveCounters instruction right before it put onto B (`{q:'countersPut', $step, $move}`, resolved by parser/lower/conditions.ts#resolveCountersPut to that move only, of the same kind), at
 * least one. The template reads the count from its `left` ("that much").
 */
export function countersMoved(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const at = phraseAt(ctx, pos, W_ONE_OR_MORE);
  if (at < 0) return out;
  for (const k of ctx.call('CounterKind', at)) {
    if (typeof k.value !== 'string') continue;
    const e = phraseAt(ctx, k.end, W_COUNTERS_ARE_MOVED_THIS_WAY);
    if (e < 0) continue;
    out.push({ end: e, value: { cond: 'compare', left: { q: 'countersPut', step: '', $step: 'previous', $move: true, kind: k.value }, op: '>=', right: 1 } as unknown as Condition });
  }
  return out;
}

const W_ITS_POWER_DIFFERENT_FROM_BASE = [P('its power was different from its base power'), P('its power is different from its base power')];

/**
 * edh-d-93 (CR 208.1, 613.4, 603.4, 603.10a, 608.2h; Jason Bright, Glowing Prophet: "Whenever a Zombie or Mutant you control dies, if its power was different from its base power, draw a card."): the
 * condition "its power was (is) different from its base power" of the object "it" names (the anaphor the lowering binds: the dying creature of the trigger), read as it last existed when it
 * left the battlefield (`ObjectFilter.powerDiffersFromBase`, rules/filter.ts, core/zones.ts records the base power as it left).
 */
export function edhd93CondAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const w of W_ITS_POWER_DIFFERENT_FROM_BASE) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    out.push({ end: e, value: { cond: 'matches', object: anaphorObj({ sort: 'object', number: 'singular', text: 'it' }), filter: { powerDiffersFromBase: true } } as unknown as Condition });
  }
  return out;
}
