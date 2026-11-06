/**
 * edh-b-13 (Commander lane edh-b, third pass over EDHREC ranks 9,001-10,000): the folds of its templates (parser/templates/zz-cloud/edh-b-13.json), called from render/fold.ts#foldAt.
 * Each applies only when every part is exactly what the idiom says.
 *
 * `drawEqualThenDiscardEach` (CR 121.1, 701.9a, 608.2c; Ancient Excavation, eff.edhb13.draw.equal.thenDiscardEachDrawn): "Draw cards equal to <amount>, then discard a card for each card
 * drawn this way.": you draw the amount, then discard as many cards as the draw drew (its resultCount, which counts the cards actually drawn). Exactly those two steps.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { countParts, qty } from './qty';
import { tokenText } from './steps-zones';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function drawEqualThenDiscardEach(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [d, x] = [list[i], list[i + 1]];
  if (d?.op !== 'draw' || x?.op !== 'discard' || d.as !== 'drawn' || d.guard !== undefined || x.guard !== undefined || d.upTo !== undefined) return null;
  if (!same(d.who, { ref: 'you' }) || !same(x.who, { ref: 'you' }) || !same(x.count, { q: 'resultCount', step: 'drawn' })) return null;
  if (x.as !== undefined || x.filter !== undefined || x.mode !== undefined || x.cantAs !== undefined) return null;
  if (typeof d.count !== 'object' || d.count.q === 'resultCount') return null;
  return { clauses: [plain(`draw cards equal to ${qty(d.count, st)}, then discard a card for each card drawn this way`)], consumed: 2 };
}

/**
 * `drawThenAdditionalPerCounter` (CR 121.1, 122.1, 608.2c; ED-E, Lonesome Eyebot, eff.edhb13.draw.thenAdditionalPerCounter): "Draw a card, then draw an additional card for each quest
 * counter on ~.": a draw of one card, then a draw of as many as the counters of one kind on an object. Exactly those two steps, both yours.
 */
function drawThenAdditionalPerCounter(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'draw' || b?.op !== 'draw' || a.count !== 1 || a.as !== undefined || b.as !== undefined || a.guard !== undefined || b.guard !== undefined || a.upTo !== undefined || b.upTo !== undefined) return null;
  if (!same(a.who, { ref: 'you' }) || !same(b.who, { ref: 'you' }) || typeof b.count !== 'object' || b.count.q !== 'counters' || b.count.kind === 'any') return null;
  const parts = countParts(b.count, st);
  if (parts === null) return null;
  return { clauses: [plain(`draw a card, then draw an additional card for each ${parts.singular}`)], consumed: 2 };
}

/**
 * `eachPlayerDiscardsHandThenTokens` (CR 701.9a, 111.2, 608.2c, 101.4; Awaken the Erstwhile, eff.edhb13.eachPlayer.discardsHand.thenCreatesThatMany): "Each player discards all the cards in their
 * hand, then creates that many <tokens>.": every player in turn order discards their whole hand and creates as many tokens (under their own control) as cards they discarded. Exactly those two steps.
 */
function eachPlayerDiscardsHandThenTokens(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const f = list[i];
  if (f?.op !== 'forEach' || f.guard !== undefined || f.do.length !== 2 || f.as !== 'each' || !same(f.over, { ref: 'each', who: 'player' })) return null;
  const [d, c] = [f.do[0], f.do[1]];
  const each = { ref: 'bound', name: 'each' };
  if (d?.op !== 'discard' || c?.op !== 'createToken' || d.as !== 'discarded' || d.count !== 'hand' || d.guard !== undefined || c.guard !== undefined || d.filter !== undefined || d.mode !== undefined || d.cantAs !== undefined) return null;
  if (!same(d.who, each) || !same(c.who, each) || !same(c.count, { q: 'resultCount', step: 'discarded' })) return null;
  if (c.tapped !== undefined || c.attacking !== undefined || c.blocking !== undefined || c.attachTo !== undefined || c.counters !== undefined || c.exceptReplaced !== undefined || c.link !== undefined) return null;
  return { clauses: [plain(`each player discards all the cards in their hand, then creates ${tokenText(c.token, 'that many', true, st)}`)], consumed: 1 };
}

export function foldEdhB13(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return drawEqualThenDiscardEach(list, i, st) ?? drawThenAdditionalPerCounter(list, i, st) ?? eachPlayerDiscardsHandThenTokens(list, i, st);
}
