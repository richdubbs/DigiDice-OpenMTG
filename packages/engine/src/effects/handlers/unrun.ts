import type { EffectStep } from '../../types/ability';
import type { ExecCtx } from '../api';

/**
 * edh-zones-22 (CR 608.2c; Birthing Ritual, "If you do, you may put a creature card ... from among those cards onto the battlefield. Put the rest on the bottom ..."): the names the
 * instructions of a branch that was not taken would have bound (the `as` of the steps of its options, the cards a `revealUntil` revealed) are bound to
 * nothing, so a later instruction that reads them does nothing (an instruction that refers to something that doesn't exist does nothing, as for a declined option, declinedNames).
 * A name already bound is kept. Called for the branch of an `if` and of a `pay` that has no `else`; the `as` of the steps of a `pay`'s `then` (`direct`) are bound too, those of an `if` only when its condition is "if you did" (any other keeps FAST5 T78's reading), else only through a `may` or a reveal.
 */
export function bindUnrun(cx: ExecCtx, steps: readonly EffectStep[], direct: boolean): void {
  const names: string[] = [];
  const add = (d: EffectStep): void => {
    if (d.op !== 'forEach' && typeof d.as === 'string') names.push(d.as);
    if (d.op === 'revealUntil' && typeof d.revealed === 'string') names.push(d.revealed);
    if (d.op === 'exileUntil' && typeof d.exiled === 'string') names.push(d.exiled);
  };
  for (const d of steps) {
    if (direct || d.op === 'revealUntil' || d.op === 'exileUntil') add(d);
    if (d.op === 'may' && d.otherwise === undefined && d.who.ref !== 'each') d.do.forEach(add);
  }
  for (const n of names) if (!cx.bindings.has(n)) cx.bindings.set(n, { objects: [], players: [], snapshots: {} });
}
