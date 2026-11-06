/**
 * edh-d-8 (Commander coordinator D, EDHREC ranks 11,251-12,500; CR 303.4, 301.5, 613.7): conditions about the Auras attached to an object.
 *
 *  - "~ is enchanted by exactly two Auras" (Timber Paladin): the number of Auras attached to the object is that number, a `compare` of the count of the Auras attached to
 *    it (`attachedToObject`) with the number. "three or more Auras" is the existing at-least reading of edh-next-1 (`exists` with `atLeast`), which counts the same Auras.
 *  - "another Aura is attached to enchanted creature" (Face of Divinity): an Aura other than the source, attached to the object (`exists` of the Auras attached to it,
 *    `other`, read against the source of the ability; an Aura is not "another" Aura than itself, CR 109.1).
 *
 * Only Auras (an Equipment or a Fortification is attached to an object too, but "enchanted by" is about Auras, CR 303.4a), only a literal number written as a word or a digit.
 */
import { P, numberAt, phraseAt, type Alt, type HoleCtx } from './core';
import type { ObjRef } from '../../types/ability';

const W_IS_ENCHANTED_BY = P('is enchanted by');
const W_EXACTLY = P('exactly');
const W_OR_MORE = P('or more');
const W_AURA = P('aura');
const W_AURAS = P('auras');
const W_ANOTHER_AURA_IS_ATTACHED_TO = P('another aura is attached to');

/** Every Aura attached to the object `of`. */
const aurasOn = (of: ObjRef): { ref: 'each'; filter: { subtypes: string[]; attachedToObject: ObjRef } } => ({ ref: 'each', filter: { subtypes: ['Aura'], attachedToObject: of } });

export function edhd8CondAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const o of ctx.call('Obj', pos)) {
    const e = phraseAt(ctx, o.end, W_IS_ENCHANTED_BY);
    if (e < 0) continue;
    const of = o.value as ObjRef;
    const flags = o.flags ? { flags: o.flags } : {};
    // "exactly one Aura" / "exactly two Auras"
    const ex = phraseAt(ctx, e, W_EXACTLY);
    if (ex >= 0) {
      const n = numberAt(ctx, ex);
      if (n === undefined || n < 1) continue;
      const end = phraseAt(ctx, ex + 1, n === 1 ? W_AURA : W_AURAS);
      if (end >= 0) out.push({ end, value: { cond: 'compare', left: { q: 'count', of: aurasOn(of) }, op: '==', right: n }, ...flags });
      continue;
    }
    // "three or more Auras" (two or more is edh-next-1's wording "two or more Auras are attached to it", the same condition)
    const n = numberAt(ctx, e);
    if (n === undefined || n < 2) continue;
    const m = phraseAt(ctx, e + 1, W_OR_MORE);
    if (m < 0) continue;
    const end = phraseAt(ctx, m, W_AURAS);
    if (end >= 0) out.push({ end, value: { cond: 'exists', of: aurasOn(of), atLeast: n }, ...flags });
  }
  const a = phraseAt(ctx, pos, W_ANOTHER_AURA_IS_ATTACHED_TO);
  if (a >= 0) {
    for (const o of ctx.call('Obj', a)) {
      out.push({ end: o.end, value: { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Aura'], attachedToObject: o.value as ObjRef, other: true } } }, ...(o.flags ? { flags: o.flags } : {}) });
    }
  }
  return out;
}
