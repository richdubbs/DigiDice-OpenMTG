/**
 * edh-zones-10 (Commander lane edh-zones): the folds of its templates (parser/templates/zz-cloud/edh-zones-10.json), called from render/fold.ts#foldAt.
 *
 * `repeatUntilHandOrSameName` (CR 608.2c, 201.2; Tainted Pact): "Exile the top card of your library. You may put that card into your hand unless it has the same name as
 * another card exiled this way. Repeat this process until you put a card into your hand or you exile two cards with the same name, whichever comes first." is ONE `repeat` whose
 * body is the exile and the optional put (parser/lower/repeat-process.ts moves them in), read after a run: a card was put into the hand, or two of the cards gathered over the
 * runs share a name. Only that exact shape, every part of it compared whole: nothing else is said in these words.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function repeatUntilHandOrSameName(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  const r = list[i];
  if (r?.op !== 'repeat' || r.process !== true || r.until === undefined || r.gather === undefined || r.do.length !== 2 || r.guard !== undefined || r.as !== undefined) return null;
  if (r.times !== 1 || r.again !== undefined || r.optional !== undefined) return null;
  const [exile, put] = r.do as [EffectStep, EffectStep];
  if (exile.op !== 'move' || put.op !== 'may' || typeof exile.as !== 'string') return null;
  const card = { ref: 'bound', name: exile.as };
  // face up only: a face-down card has no name for the same-name test (review: the face-down shape is no reading)
  if (!same(exile, { op: 'move', what: { ref: 'topCards', player: { ref: 'you' }, count: 1 }, to: { zone: 'exile' }, as: exile.as })) return null;
  const expectPut = {
    op: 'may', who: { ref: 'you' }, as: 'putIntoHand',
    guard: { cond: 'not', of: { cond: 'matches', object: card, filter: { sharesWith: { with: { ref: 'bound', name: 'exiledThisWay' }, quality: 'name' } } } },
    do: [{ op: 'move', what: card, to: { zone: 'hand' } }],
  };
  if (!same(put, expectPut)) return null;
  const expectUntil = { cond: 'any', of: [{ cond: 'did', step: 'putIntoHand' }, { cond: 'compare', left: { q: 'mostSharingName', among: { ref: 'bound', name: 'exiledThisWay' } }, op: '>=', right: 2 }] };
  if (!same(r.until, expectUntil) || !same(r.gather, { as: 'exiledThisWay', of: exile.as })) return null;
  const text = `exile the top card of your library. you may put that card into your hand unless it has the same name as another card exiled this way. `
    + `repeat this process until you put 1 card into your hand or you exile 2 cards with the same name, whichever comes first`;
  return { clauses: [plain(text, { standalone: true })], consumed: 1 };
}

export function foldEdhZones10(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return repeatUntilHandOrSameName(list, i, st);
}
