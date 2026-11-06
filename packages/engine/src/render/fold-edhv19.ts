/**
 * edh-c-19 (Commander lane edh-c): the folds of its templates (parser/templates/zz-cloud/edh-c-19.json), called from render/fold.ts#foldAt. Each applies only when every part is
 * exactly what the idiom says.
 *
 * `shuffleUpToFromGraveyard` (CR 701.24a, 608.2d, 404.1; Stream of Thought, eff.edhv19.shuffle.upTo.graveyard): "You shuffle up to four cards from your graveyard into your library.":
 * you choose up to that many cards of your graveyard, they go to your library and you shuffle it. Exactly those three steps.
 *
 * `handToBottomDrawThatMany` (CR 401.4, 400.3, 121.1, 608.2h; Mindmoil, eff.edhv19.handToBottom.drawThatMany): "put the cards in your hand on the bottom of your library in any order, then draw
 * that many cards.": all the cards of your hand go to the bottom of your library in the order you choose, then you draw one card for each that moved. Exactly those two steps.
 */
import type { EffectStep } from '../types/ability';
import { acting } from './clause';
import type { Folded } from './fold';
import { alt } from './text';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function shuffleUpToFromGraveyard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b, c] = [list[i], list[i + 1], list[i + 2]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || c?.op !== 'shuffle' || a.as === undefined || a.min !== 0 || typeof a.max === 'string') return null;
  if (a.guard !== undefined || b.guard !== undefined || c.guard !== undefined || b.as !== undefined || b.until !== undefined || b.link !== undefined || b.remember !== undefined || c.ifSearched !== undefined) return null;
  if (!same(a.who, { ref: 'you' }) || !same(c.who, { ref: 'you' }) || !same(a.from, { ref: 'each', filter: { zone: 'graveyard', owner: 'you' } })) return null;
  if (!same(b.what, { ref: 'bound', name: a.as }) || !same(b.to, { zone: 'library' })) return null;
  if (list.slice(i + 3).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`))) return null;
  const text = `you shuffle up to ${K.qty(a.max as never, st)} cards from your graveyard into your library`;
  return { clauses: [acting('you', text, text, { standalone: true })], consumed: 3 };
}

function handToBottomDrawThatMany(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'move' || b?.op !== 'draw' || a.as === undefined || a.guard !== undefined || b.guard !== undefined || a.until !== undefined || a.link !== undefined || a.remember !== undefined || b.as !== undefined) return null;
  if (!same(a.what, { ref: 'each', filter: { zone: 'hand', owner: 'you' } }) || !same(a.to, { zone: 'library', position: 'bottom', order: 'chosen' })) return null;
  if (!same(b.who, { ref: 'you' }) || !same(b.count, { q: 'resultCount', step: a.as })) return null;
  const text = 'put the cards in your hand on the bottom of your library in any order, then draw that many cards';
  return { clauses: [acting('you', text, text, { standalone: true })], consumed: 2 };
}

function mayTapHumansDrawPerTapped(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  const [a, b, c] = [list[i], list[i + 1], list[i + 2]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'tap' || c?.op !== 'draw' || a.as === undefined || b.as === undefined || a.guard !== undefined || b.guard !== undefined || c.guard !== undefined || c.as !== undefined) return null;
  if (!same(a.who, { ref: 'you' }) || a.min !== 0 || a.max !== 'any' || !same(a.from, { ref: 'each', filter: { subtypes: ['Human'], controller: 'you', tapped: false } })) return null;
  if (!same(b.what, { ref: 'bound', name: a.as }) || !same(c.who, { ref: 'you' }) || !same(c.count, { q: 'resultCount', step: b.as })) return null;
  if (list.slice(i + 3).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`) || JSON.stringify(x).includes(`"step":"${b.as}"`))) return null;
  const text = 'you may tap any number of untapped humans you control. draw a card for each human tapped this way';
  return { clauses: [acting('you', text, text, { standalone: true })], consumed: 3 };
}

function revealTopIfCardPutHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'reveal' || b?.op !== 'if' || a.as === undefined || a.guard !== undefined || b.guard !== undefined || a.to !== undefined || b.else !== undefined || b.then.length !== 1) return null;
  const m = b.then[0]!;
  if (m.op !== 'move' || m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined || !same(m.what, { ref: 'bound', name: a.as }) || !same(m.to, { zone: 'hand' })) return null;
  if (a.who.ref === 'you' || a.who.ref === 'each' || !same(a.what, { ref: 'topCards', player: a.who, count: 1 })) return null;
  const c = b.cond;
  if (c.cond !== 'matches' || !same(c.object, { ref: 'bound', name: a.as }) || c.filter.isCard !== true || (c.filter.types ?? []).length === 0) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`))) return null;
  const who = K.player(a.who, st, 'subject');
  if (who.person !== 'sg') return null;
  if (Object.keys(c.filter).length !== 2 || c.filter.types!.length !== 1) return null;
  const type = c.filter.types![0]!.toLowerCase();
  const kind = `${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type} card`;
  const text = `${who.text} reveals the top card of their library. If it's ${kind}, that player puts it into their hand`;
  return { clauses: [acting('x', text, text, { standalone: true })], consumed: 2 };
}

export function foldEdhV19(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return shuffleUpToFromGraveyard(list, i, st) ?? handToBottomDrawThatMany(list, i, st) ?? revealTopIfCardPutHand(list, i, st) ?? mayTapHumansDrawPerTapped(list, i, st);
}
