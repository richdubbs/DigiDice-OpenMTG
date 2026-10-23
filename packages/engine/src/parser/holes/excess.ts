/**
 * FAST5X E16: excess damage in the `Qty` and `Cond` grammars (CR 120.4a, 120.10, 608.2c; glossary "Excess Damage").
 *
 *  - Qty: "the excess damage dealt this way", "the [amount of] excess damage dealt to <that creature> this way", "that excess damage" (the excess the
 *    condition of the same instruction named, "where X is that excess damage").
 *  - Cond: "excess damage was / is dealt [to <that creature>] this way", "<that creature> is / was dealt excess damage this way".
 *
 * "This way" is the damage or fight instruction RIGHT BEFORE (CR 608.2c), like "if you do": the value carries a `$step` marker that parser/lower/conditions.ts
 * resolves to that step's name (`{q:'excessDamage', step}`); anything else there leaves the sentence manual. "<that creature>" is a reference of the Obj
 * hole (resolved by the anaphora pass), or "the creature an opponent controls" / "the creature the opponent controls" after a fight (the fighting creature an
 * opponent controls: `{ref:'each'}` of that filter, intersected with what the step damaged, effects/eval.ts).
 */
import type { Condition, ObjectFilter, Quantity } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, anyPhraseAt, phraseAt } from './core';

const W_THE_EXCESS = [P('the excess damage dealt'), P('the amount of excess damage dealt')];
const W_THAT_EXCESS = P('that excess damage');
const W_THIS_WAY = P('this way');
const W_TO = P('to');
const W_EXCESS_WAS_DEALT = [P('excess damage was dealt'), P('excess damage is dealt')];
const W_IS_DEALT_EXCESS = [P('is dealt excess damage'), P('was dealt excess damage')];
const W_THE_OPPONENTS_CREATURE = [P('the creature an opponent controls'), P('the creature the opponent controls')];

const OPPONENTS_CREATURE: ObjectFilter = { types: ['Creature'], controller: 'opponent' };

/** The excess damage of the instruction before (`$step`), optionally to `to`. `$that`: "that excess damage" (lower/conditions.ts copies the condition's `to`). */
const excessQty = (to?: unknown, that = false): Quantity => ({ q: 'excessDamage', step: '', $step: 'previous', ...(to !== undefined ? { to } : {}), ...(that ? { $that: true } : {}) } as unknown as Quantity);
const excessCond = (to?: unknown): Condition => ({ cond: 'compare', left: excessQty(to), op: '>', right: 0 });

/** "<that creature>": an Obj reference, or the fighting creature an opponent controls. */
function recipients(ctx: HoleCtx, pos: number): { end: number; value: unknown; flags?: string[] }[] {
  const out: { end: number; value: unknown; flags?: string[] }[] = [];
  for (const ws of W_THE_OPPONENTS_CREATURE) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, value: { ref: 'each', filter: OPPONENTS_CREATURE } }); }
  for (const o of ctx.call('Obj', pos)) out.push({ end: o.end, value: o.value, ...(o.flags ? { flags: o.flags } : {}) });
  return out;
}

/** "... [to <that creature>] this way" after `pos`: each reading with the end of "this way". */
function toThisWay(ctx: HoleCtx, pos: number): { end: number; to?: unknown; flags?: string[] }[] {
  const out: { end: number; to?: unknown; flags?: string[] }[] = [];
  const bare = phraseAt(ctx, pos, W_THIS_WAY);
  if (bare >= 0) out.push({ end: bare });
  const to = phraseAt(ctx, pos, W_TO);
  if (to >= 0) {
    for (const r of recipients(ctx, to)) {
      const e = phraseAt(ctx, r.end, W_THIS_WAY);
      if (e >= 0) out.push({ end: e, to: r.value, ...(r.flags ? { flags: r.flags } : {}) });
    }
  }
  return out;
}

/** Qty atoms. */
export function excessQtyAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const lead = anyPhraseAt(ctx, pos, W_THE_EXCESS);
  if (lead >= 0) for (const r of toThisWay(ctx, lead)) out.push({ end: r.end, value: excessQty(r.to) as never, ...(r.flags ? { flags: r.flags } : {}) });
  const that = phraseAt(ctx, pos, W_THAT_EXCESS);
  if (that >= 0) out.push({ end: that, value: excessQty(undefined, true) as never });
  return out;
}

/** Cond atoms. */
export function excessCondAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const lead = anyPhraseAt(ctx, pos, W_EXCESS_WAS_DEALT);
  if (lead >= 0) for (const r of toThisWay(ctx, lead)) out.push({ end: r.end, value: excessCond(r.to) as never, ...(r.flags ? { flags: r.flags } : {}) });
  for (const r of recipients(ctx, pos)) {
    const e = anyPhraseAt(ctx, r.end, W_IS_DEALT_EXCESS);
    if (e < 0) continue;
    const w = phraseAt(ctx, e, W_THIS_WAY);
    if (w >= 0) out.push({ end: w, value: excessCond(r.value) as never, ...(r.flags ? { flags: r.flags } : {}) });
  }
  return out;
}
