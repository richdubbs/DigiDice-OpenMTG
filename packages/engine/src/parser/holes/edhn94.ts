/**
 * edh-next-94 (Commander top-rank second pass 2, template code edhn94): readings of the `Qty` hole.
 *  - "the number of creatures tapped this way", "for each Gate tapped this way" (CR 701.26a, 608.2c; Angel's Trumpet, Guild Summit): what an earlier tap step of the ability tapped (its
 *    result count: only a permanent that was untapped and became tapped is "tapped this way", the step counts exactly those). A number anaphor with the participle `tapped` and the noun
 *    as its head: the quantities pass (parser/lower/quantities.ts#tappedNounFits) binds it to the ONE tap step before it, and only when the noun names everything that step can tap (a card
 *    type or a subtype the step's description requires), else the sentence stays manual.
 */
import type { Condition, ObjectFilter } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, anaphorObj, anaphorQty, phraseAt } from './core';

const W_NUMBER_OF = P('the number of');
const W_TAPPED_THIS_WAY = P('tapped this way');

/** The one card type or subtype a plain noun description names ("creatures", "Gates"), lower case; null for anything with other qualities (those count a part of what a step tapped). */
function plainHead(f: ObjectFilter): string | null {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined);
  if (keys.length !== 1) return null;
  if (f.types !== undefined && f.types.length === 1) return String(f.types[0]).toLowerCase();
  if (f.subtypes !== undefined && f.subtypes.length === 1) return String(f.subtypes[0]).toLowerCase();
  return null;
}

export function edhn94QtyAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const emit = (start: number, text: (h: string) => string, number: 'singular' | 'plural'): void => {
    for (const f of ctx.call('Filter', start)) {
      const head = plainHead(f.value as ObjectFilter);
      if (head === null) continue;
      const end = phraseAt(ctx, f.end, W_TAPPED_THIS_WAY);
      // weak: the older templates that name the tap step themselves ("create a token for each creature tapped this way", `tappedThisWay`) keep their reading
      if (end >= 0) out.push({ end, value: anaphorQty({ sort: 'number', number, participle: 'tapped', head, text: text(head) }), weak: 1 });
    }
  };
  if (ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each') emit(pos, (h) => `${h} tapped this way`, 'singular');
  const n = phraseAt(ctx, pos, W_NUMBER_OF);
  if (n >= 0) emit(n, (h) => `the number of ${h}s tapped this way`, 'plural');
  return out;
}

const W_CONTROL_NEITHER = P('you control neither creature');

/**
 * `Cond` readings of edh-next-94. "you control neither creature" (CR 108.4, 110.2, 608.2c; Modify Memory): of the two creatures an earlier sentence named (the targets of an exchange of
 * control), you control none after the instruction. The group is the antecedent set "creature"; the condition is that no object of it is controlled by you.
 */
export function edhn94CondAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const e = phraseAt(ctx, pos, W_CONTROL_NEITHER);
  if (e >= 0) {
    const is = anaphorObj({ sort: 'set', number: 'plural', head: 'creature', text: 'neither creature' });
    out.push({ end: e, value: { cond: 'not', of: { cond: 'exists', of: { ref: 'each', filter: { is, controller: 'you' } } } } as unknown as Condition });
  }
  return out;
}
