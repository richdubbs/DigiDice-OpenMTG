/**
 * Lane trek, round trek-9 (Star Trek: All Good Things...): the condition reading of `Cond` that the round adds (parser/templates/zz-cloud/trek-9.json reads it
 * through the generic "if <cond>, <effects>" templates). CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 * `allExiledShareCond` (CR 205.2a, 105.2, 607.2a, 608.2c): "all cards exiled with ~ share a card type" / "... share a color": every card the face's linked exiling
 * instruction exiled and that is still in exile has a card type (a color) in common (`share` with `count: 'all'`, effects/eval.ts). The cards are the link
 * `exiled` of the object (parser/parse.ts#linkExiled finds the exiling instruction of the face's other abilities, or the sentence stays manual).
 */
import type { Condition, CostPart, ObjectFilter } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, anyPhraseAt, phraseAt } from './core';

const W_ALL_EXILED_SHARE: readonly [string[], 'cardType' | 'color'][] = [
  [P('all cards exiled with ~ share a card type'), 'cardType'],
  [P('all cards exiled with ~ share a color'), 'color'],
];

export function allExiledShareCond(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const [words, what] of W_ALL_EXILED_SHARE) {
    const e = phraseAt(ctx, pos, words);
    if (e >= 0) out.push({ end: e, value: { cond: 'share', what, of: { ref: 'each', filter: { zone: 'exile', is: { ref: 'linked', link: 'exiled' } } }, count: 'all' } satisfies Condition });
  }
  return out;
}

const W_A_AN = [P('a'), P('an')];
const W_ATTACHED_TO_IT_THEM = [P('attached to it'), P('attached to them')];

/**
 * `attachedWithAt` (CR 301.5, 303.4, 205.3g-h): the feature "a Communicator attached to it" / "an Equipment attached to them" after "with": a permanent with that artifact or
 * enchantment type is attached to the object (`attachedWith`, rules/filter.ts, statics/match.ts). "it" and "them" say the objects the description is of, the head noun of
 * the phrase it ends (the one grammar position this feature has), so neither is a reference to anything named earlier. Only an Equipment-, Aura- or Fortification-like
 * type word of the lexicon (class artifact or enchantment) and only after "with" (never "without").
 */
export function attachedWithAt(ctx: HoleCtx, pos: number): { end: number; frag: ObjectFilter }[] {
  const out: { end: number; frag: ObjectFilter }[] = [];
  const art = anyPhraseAt(ctx, pos, W_A_AN);
  if (art < 0) return out;
  const t = ctx.toks[art];
  const entry = t !== undefined && t.kind === 'WORD' ? ctx.vocab.subtypes.get(t.norm) : undefined;
  if (entry === undefined || entry.plural || (entry.cls !== 'artifact' && entry.cls !== 'enchantment')) return out;
  const e = anyPhraseAt(ctx, art + 1, W_ATTACHED_TO_IT_THEM);
  if (e >= 0) out.push({ end: e, frag: { attachedWith: entry.name } });
  return out;
}

const W_PUT = P('put');
const W_FROM_YOUR_GRAVEYARD = P('from your graveyard');
const W_ON_BOTTOM = P('on the bottom of your library');
const W_ON_TOP = P('on top of your library');

/**
 * `putSelfIntoLibrary` (CR 118.3, 602.2b, 401.4, 113.6j): the cost "Put this card from your graveyard on the bottom of your library" (Daniels, Temporal Agent): the source
 * itself, from your graveyard, to the bottom (or the top) of its owner's library (`putIntoLibrary`, rules/cost.ts). Only the source (`~`) and only your graveyard (an
 * activated ability of a card in a graveyard, CR 113.6j; the part says where it is, so the ability functions there, parser/lower/activation.ts#activationZone).
 */
export function putSelfIntoLibrary(ctx: HoleCtx, pos: number): { end: number; part: CostPart }[] {
  const out: { end: number; part: CostPart }[] = [];
  const e = phraseAt(ctx, pos, W_PUT);
  if (e < 0 || ctx.toks[e]?.kind !== 'SELF') return out;
  const z = phraseAt(ctx, e + 1, W_FROM_YOUR_GRAVEYARD);
  if (z < 0) return out;
  const bottom = phraseAt(ctx, z, W_ON_BOTTOM);
  if (bottom >= 0) out.push({ end: bottom, part: { kind: 'putIntoLibrary', zone: 'graveyard', self: true, position: 'bottom' } });
  const top = phraseAt(ctx, z, W_ON_TOP);
  if (top >= 0) out.push({ end: top, part: { kind: 'putIntoLibrary', zone: 'graveyard', self: true, position: 'top' } });
  return out;
}
