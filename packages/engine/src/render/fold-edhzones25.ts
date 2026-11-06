/**
 * edh-zones-25 (Commander lane edh-zones): the folds of its templates (parser/templates/zz-cloud/edh-zones-25.json), called from render/fold.ts#foldAt. Each applies only when
 * every part is exactly what the idiom says.
 *
 * `searchUpToInstead` (CR 608.2c, 614.15, 701.23a; Nissa's Pilgrimage): "Search your library for up to two basic Forest cards, reveal those cards, and put one onto the battlefield tapped
 * and the rest into your hand. Then shuffle. If C, search your library for up to three basic Forest cards instead of two.": the rider (template rid.edhz25.search.upToInstead) made the
 * search an `if` of two searches that differ only in the most cards it finds; the choice, the two moves and an optional shuffle follow it as for the plain sentence. Printed as the
 * plain sentence of the smaller search (the ordinary renderings of its steps), then the rider sentence.
 */
import type { EffectStep } from '../types/ability';
import type { Clause } from './clause';
import type { Folded } from './fold';
import type { RenderState } from './state';
import { acting } from './clause';
import { bind } from './steps-util';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The renderer's own functions, handed in by render/steps.ts (which imports render/fold.ts; a value import of either here would make an import cycle). */
export interface FoldDeps {
  foldAt: (list: EffectStep[], i: number, st: RenderState) => Folded | null;
  clause: (step: EffectStep, st: RenderState) => Clause;
  clausesOf: (list: EffectStep[], st: RenderState) => Clause[];
}

/** The folds of this round that print other steps through the renderer (called from render/steps.ts#clausesOf before `foldAt`). */
export function foldEdhZones25(list: EffectStep[], i: number, st: RenderState, deps: FoldDeps): Folded | null {
  return searchUpToInstead(list, i, st, deps) ?? searchRestPlain(list, i, st, deps) ?? searchCountInstead(list, i, st, deps);
}

/**
 * The plain sentence of the template eff.edhz25.search.reveal.oneTapped.restHand without its shuffle: the clauses of `search` (the search `a` with its reveal) and the three instructions
 * after it, the first said with the serial comma ("..., reveal those cards, and put one ..."). Null when the three do not fold as one sentence.
 */
function searchThenRest(a: EffectStep, after: EffectStep[], st: RenderState, { foldAt, clause }: FoldDeps): Clause[] | null {
  if (after[0]?.op !== 'chooseObjects' || after[1]?.op !== 'move' || after[2]?.op !== 'move') return null;
  // exactly the template's shape: your choice of exactly one, the card onto the battlefield tapped under your control, the rest into your hand
  if (!same(after[0].who, { ref: 'you' }) || after[0].min !== 1 || after[0].max !== 1 || !same(after[1].to, { zone: 'battlefield', controller: { ref: 'you' }, tapped: true }) || !same(after[2].to, { zone: 'hand' })) return null;
  const first = clause(a, st);
  const mid = foldAt([a, ...after.slice(0, 3)], 1, st);
  if (mid === null || mid.consumed !== 3) return null;
  return [{ ...first, serial: true }, ...mid.clauses]; // ("..., reveal those cards, and put one ...")
}

function searchRestPlain(list: EffectStep[], i: number, st: RenderState, deps: FoldDeps): Folded | null {
  const a = list[i];
  if (a?.op !== 'search' || a.guard !== undefined || a.reveal !== true) return null;
  const items = searchThenRest(a, list.slice(i + 1), st, deps);
  return items === null ? null : { clauses: items, consumed: 4 };
}

function searchUpToInstead(list: EffectStep[], i: number, st: RenderState, deps: FoldDeps): Folded | null {
  const f = list[i];
  if (f?.op !== 'if' || f.guard !== undefined || f.else?.length !== 1 || f.then.length !== 1) return null;
  const [a, b] = [f.then[0], f.else[0]];
  if (a?.op !== 'search' || b?.op !== 'search' || a.guard !== undefined || b.guard !== undefined || typeof a.max !== 'number' || typeof b.max !== 'number' || a.max <= b.max) return null;
  const { max: _am, ...ra } = a;
  const { max: _bm, ...rb } = b;
  if (!same(ra, rb) || a.reveal !== true || a.min !== 0 || a.as === undefined) return null;
  const after = list.slice(i + 1);
  const items = searchThenRest(b, after, st, deps);
  if (items === null) return null;
  const shuffle = after[3]?.op === 'shuffle' ? after[3] : undefined;
  if (shuffle !== undefined) items.push(deps.clause(shuffle, st));
  const { reveal: _r, ...bare } = a;
  const rider = deps.clause({ op: 'if', cond: f.cond, then: [bare as EffectStep] } as EffectStep, st);
  const tail = ` instead of ${b.max}`;
  items.push({ ...rider, imp: rider.imp + tail, sub: rider.sub + tail, standalone: true, ...(rider.have !== undefined ? { have: rider.have + tail } : {}) });
  return { clauses: items, consumed: 4 + (shuffle !== undefined ? 1 : 0) };
}

/**
 * `exileOneOfThemFromGraveyard` (CR 701.13a, 608.2c, 608.2d; Conspiracy Theorist): "you may exile one of them from your graveyard" after a trigger about a batch of cards that were put into the
 * graveyard (`{ref:'event', role:'subject'}`): your choice of exactly one of them that is still in a graveyard, then its exile. Exactly the two steps of template eff.edhz25.exile.oneOfThem.fromYourGraveyard.
 */
export function exileOneOfThemFromGraveyard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || a.guard !== undefined || b.guard !== undefined || typeof a.as !== 'string' || b.as !== undefined || b.until !== undefined) return null;
  if (!same(a.who, { ref: 'you' }) || a.min !== 1 || a.max !== 1 || a.random === true || !same(b.what, { ref: 'bound', name: a.as }) || b.link !== undefined || b.remember !== undefined) return null;
  if (!same(a.from, { ref: 'each', filter: { is: { ref: 'event', role: 'subject' }, zone: 'graveyard' } }) || !same(b.to, { zone: 'exile' })) return null;
  bind(st, a.as, { nouns: ['card'], plural: false, optional: true });
  const text = 'exile one of them from your graveyard';
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 2 };
}

/**
 * edh-next-20 `searchCountInstead` (CR 608.2c, 614.15, 701.23a, 702.33d; Reclaim the Wastes): "Search your library for a basic land card, reveal it, put it into your hand, then shuffle. If this spell was
 * kicked, search your library for two basic land cards instead of one.": the rider (template rid.edhn20.search.countInstead) made the search an `if` of two searches that differ only in how many
 * cards they find; the moves and the shuffle after it are the plain sentence's. Printed as the plain sentence of the smaller search (the ordinary renderings of its steps), then the rider.
 */
function searchCountInstead(list: EffectStep[], i: number, st: RenderState, { clause, clausesOf }: FoldDeps): Folded | null {
  const f = list[i];
  if (f?.op !== 'if' || f.guard !== undefined || f.else?.length !== 1 || f.then.length !== 1) return null;
  const [a, b] = [f.then[0], f.else[0]];
  if (a?.op !== 'search' || b?.op !== 'search' || a.guard !== undefined || b.guard !== undefined || typeof a.max !== 'number' || typeof b.max !== 'number' || a.max <= b.max) return null;
  const { max: _am, min: _an, ...ra } = a;
  const { max: _bm, ...rb } = b;
  if (!same(ra, rb) || a.reveal !== true || a.min !== a.max || b.min !== undefined || a.as === undefined) return null;
  const move = list[i + 1];
  if (move?.op !== 'move' || !same(move.what, { ref: 'bound', name: a.as }) || !same(move.to, { zone: 'hand' })) return null;
  const shuffle = list[i + 2]?.op === 'shuffle' ? list[i + 2]! : undefined;
  const items = clausesOf([b, move, ...(shuffle !== undefined ? [shuffle] : [])], st);
  const { reveal: _r, ...bare } = a;
  const rider = clause({ op: 'if', cond: f.cond, then: [bare as EffectStep] } as EffectStep, st);
  const tail = ` instead of ${b.max}`;
  return { clauses: [...items, { ...rider, imp: rider.imp + tail, sub: rider.sub + tail, standalone: true, ...(rider.have !== undefined ? { have: rider.have + tail } : {}) }], consumed: 2 + (shuffle !== undefined ? 1 : 0) };
}
