/**
 * edh-c-110 ADDITION: readings of the `Cond` hole (parser/holes/cond.ts#atoms):
 *  - "you've controlled ~ continuously since the beginning of your most recent turn" (CR 302.6, 400.7; Rocket Launcher): the object has been under your control since before your most
 *    recent turn began, the condition `controlledSinceTurnStart` (effects/eval.ts). Only the object itself (this artifact / this creature / ...), only "your" most recent turn.
 */
import type { Condition } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, phraseAt } from './core';

const W_CONTROLLED = [P("you've controlled"), P('you have controlled')];
const W_CONTINUOUSLY_SINCE = P('continuously since the beginning of your most recent turn');

export function edhv110CondAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const w of W_CONTROLLED) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0 || ctx.toks[e]?.kind !== 'SELF') continue;
    const end = phraseAt(ctx, e + 1, W_CONTINUOUSLY_SINCE);
    if (end >= 0) out.push({ end, value: { cond: 'controlledSinceTurnStart', object: { ref: 'self' } } as Condition });
  }
  return out;
}
