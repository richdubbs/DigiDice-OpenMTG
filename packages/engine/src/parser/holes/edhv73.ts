/**
 * edh-c-73 (Commander lane edh-c, ranks 22,501-23,000, second pass): the hole `FewerDiscarded`, "fewer than <N> cards were discarded this way" (CR 701.9a, 608.2c,
 * 608.2h; Skull Raid: "Target opponent discards two cards. If fewer than two cards were discarded this way, you draw cards equal to the difference."). The value is the
 * condition "the cards the discard right before reported are fewer than N", as C7's `$moved` count (parser/holes/moved-words.ts; lower/quantities.ts binds the count to the
 * ONE earlier discard, or the sentence is manual); the template reads the number and the count from its `left` and `right`.
 */
import type { Condition } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, anaphorObj, phraseAt } from './core';
import { npAlts } from './filter';
import { MOVED_MARK } from './moved-words';

const W_FEWER_THAN = P('fewer than');
const W_WERE_DISCARDED_THIS_WAY = P('were discarded this way');

export function fewerDiscarded(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const at = phraseAt(ctx, pos, W_FEWER_THAN);
  if (at < 0) return out;
  for (const q of ctx.call('Qty', at)) {
    if (typeof q.value !== 'number' || q.value < 2) continue;
    for (const n of npAlts(ctx, q.end)) {
      const f = n.filter as Record<string, unknown>;
      if (n.number !== 'plural' || n.head !== 'card' || n.flags.some((x) => x !== 'zone-unstated') || Object.keys(f).some((k) => k !== 'isCard' && k !== 'types' && k !== 'subtypes' && k !== 'supertypes' && k !== 'not')) continue;
      const e = phraseAt(ctx, n.end, W_WERE_DISCARDED_THIS_WAY);
      if (e < 0) continue;
      const counted = { ref: 'each', filter: { ...n.filter, [MOVED_MARK]: 'discarded' } };
      out.push({ end: e, value: { cond: 'compare', left: { q: 'count', of: counted }, op: '<', right: q.value } as unknown as Condition });
    }
  }
  return out;
}

/**
 * edh-c-73 (CR 608.2c, 115.1; Wojek Embermage): the hole `ItNotSource`, the pronoun "it" for an object the sentence names besides the source ("~ deals 1 damage to target creature and each
 * other creature that shares a color with it": the target, never the source whose name starts the sentence). An anaphor that is never the ability's own source (`notSelf`).
 */
export const itNotSource = (ctx: HoleCtx, pos: number): Alt[] => (ctx.toks[pos]?.norm === 'it'
  ? [{ end: pos + 1, value: anaphorObj({ sort: 'object', number: 'singular', text: 'it', notSelf: true }) }]
  : []);
