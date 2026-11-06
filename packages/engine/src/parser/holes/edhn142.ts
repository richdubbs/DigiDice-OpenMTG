/**
 * edh-next-142 (must-finish round, library, draw and search; template code edhn142): the `LoyaltySym` hole.
 *  - "[+1]", "[−2]", "[0]" (CR 606.4, 107.7): one loyalty symbol of a loyalty cost written in running text ("cost an additional [+1] to activate", Carth the Lion), value the signed
 *    number of loyalty counters (+1 puts one, -2 removes two).
 */
import type { Alt, HoleCtx } from './core';

export function loyaltySym(ctx: HoleCtx, pos: number): Alt[] {
  const t = ctx.toks[pos];
  const n = ctx.toks[pos + 1];
  if (t?.kind !== 'PUNCT' || t.norm !== '[' || ctx.toks[pos + 2]?.norm !== ']' || n === undefined) return [];
  if (n.kind === 'MOD' && /^[+-]\d+$/.test(n.norm)) return [{ end: pos + 3, value: Number(n.norm) }];
  if (n.kind === 'NUM' && n.norm === '0') return [{ end: pos + 3, value: 0 }];
  return [];
}
