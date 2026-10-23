/**
 * p2-counters-state-1 (CR 702.33b, 702.33d, 702.33f): "was kicked with its {1}{R} kicker" names ONE kicker cost of a card with two ("Kicker {1}{R} and/or {G}",
 * the Invasion volvers and battlemages). The cast record names the kicker costs by position on the face, "kicker" for the first and "kicker:2" for the second
 * (keywords/expand.ts `$ordinal`, actions/cast-options.ts#isKickerName), which a hole cannot see: the reading is the marker `kicker@<cost>` (the cost's
 * symbols as printed, lower case), and parser/parse.ts#resolveKickerCosts turns it into the name of the face's kicker cost with those symbols before the
 * ability is linted and gated. A marker with no such cost on the face is left over, and the renderer refuses it (the ability stays manual, fail closed).
 */
import { P, anyPhraseAt, phraseAt, type HoleCtx, type HoleFn } from './core';

export const KICKER_MARK = 'kicker@';
const W_WITH_ITS = P('with its');
const W_KICKER = [P('kicker')];

/** "with its {1}{R} kicker" at `pos`: the end and the marker, or null. */
export function kickedWithCost(ctx: HoleCtx, pos: number): { end: number; mark: string } | null {
  const w = phraseAt(ctx, pos, W_WITH_ITS);
  if (w < 0) return null;
  let p = w;
  let cost = '';
  while (ctx.toks[p]?.kind === 'MANA' && ctx.toks[p]!.norm !== '{e}') cost += ctx.toks[p++]!.norm;
  if (cost === '') return null;
  const k = anyPhraseAt(ctx, p, W_KICKER);
  return k < 0 ? null : { end: k, mark: `${KICKER_MARK}${cost}` };
}

/** The kicker costs printed on a face, in order ("Kicker {1}{R} and/or {G}" -> ["{1}{r}", "{g}"]); a multikicker line is no kicker cost of this list. */
export function faceKickerCosts(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const m = /^kicker ((?:\{[^}]+\})+)(?: and\/or ((?:\{[^}]+\})+))?(?:\s*\(|\s*$)/i.exec(line.trim());
    if (m) out.push(...[m[1], m[2]].filter((x): x is string => x !== undefined).map((x) => x.toLowerCase()));
  }
  return out;
}

/** The kicker name of a cost on the face ("kicker", "kicker:2"), or undefined. */
export function kickerNameOf(costs: readonly string[], cost: string): string | undefined {
  const i = costs.indexOf(cost);
  return i < 0 ? undefined : i === 0 ? 'kicker' : `kicker:${i + 1}`;
}

/**
 * `KickedWith`: "~ was kicked with its {1}{R} kicker" and nothing else (the condition of the volvers' "If ~ was kicked with its {1}{R} kicker, it enters with ...",
 * CR 702.33f, 614.1c). Value: the condition `{cond:'wasCast', kicked:'kicker@<cost>'}` (resolved by the face, see above).
 */
export const kickedWith: HoleFn = (ctx, pos) => {
  if (ctx.toks[pos]?.kind !== 'SELF') return [];
  const k = phraseAt(ctx, pos + 1, W_WAS_KICKED);
  const kw = k >= 0 ? kickedWithCost(ctx, k) : null;
  return kw === null ? [] : [{ end: kw.end, value: { cond: 'wasCast', kicked: kw.mark } }];
};
const W_WAS_KICKED = P('was kicked');
