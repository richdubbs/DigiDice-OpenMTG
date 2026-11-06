/**
 * edh-d-39 (Commander lane pile-open-phase, second pass): the folds of its templates (parser/templates/zz-cloud/edh-d-39.json), called from render/fold.ts#foldAt. Each
 * applies only when every part is exactly what the idiom says. A new fold file never imports a value from render/fold.ts (an import cycle).
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { acting } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const PILE = { zone: 'exile', faceDown: true };
const plainMove = (m: EffectStep | undefined): m is Extract<EffectStep, { op: 'move' }> =>
  m?.op === 'move' && m.guard === undefined && m.until === undefined && m.link === undefined && m.remember === undefined && m.as !== undefined && same(m.to, PILE);

/** Nothing after the fold's steps reads one of the names. */
const unread = (list: EffectStep[], from: number, ...names: (string | undefined)[]): boolean =>
  !list.slice(from).some((x) => names.some((n) => n !== undefined && JSON.stringify(x).includes(`"name":"${n}"`)));

/**
 * `exileAllPileManifest` (CR 406.3, 701.40a, 701.40e, 701.24a; Ghastly Conscription, eff.edhd39.exileAllPile.manifest): "Exile all creature cards from target player's
 * graveyard in a face-down pile, shuffle that pile, then manifest those cards.": the cards of the description exiled face down, then exactly those cards manifested in a
 * random order (the pile's shuffle, the `shuffle` argument of the manifest). Only that exact shape.
 */
function exileAllPileManifest(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  const a = list[i + 1];
  if (!plainMove(m) || m.what.ref !== 'each' || a?.op !== 'action' || a.guard !== undefined) return null;
  if (a.action !== 'manifest' || a.arg !== 'shuffle' || !same(a.who, { ref: 'you' }) || a.n !== undefined || a.as !== undefined || !same(a.subject, { ref: 'bound', name: m.as })) return null;
  if (!unread(list, i + 2, m.as)) return null;
  const what = K.obj(m.what, st, 'object').text;
  return { clauses: [acting('you', `exile ${what} in a face-down pile, shuffle that pile, then manifest those cards`, `you exile ${what} in a face-down pile, shuffle that pile, then manifest those cards`)], consumed: 2 };
}

/**
 * `exileItAndTopPileManifest` (CR 406.3, 701.40a, 701.40e, 701.24a; Jeskai Infiltrator, eff.edhd39.exileItAndTop.pile.manifest): "exile it and the top card of your library in a
 * face-down pile, shuffle that pile, then manifest those cards": the object and your top card exiled face down, then exactly those two cards manifested in a random order.
 */
function exileItAndTopPileManifest(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [m1, m2, a] = [list[i], list[i + 1], list[i + 2]];
  if (!plainMove(m1) || !plainMove(m2) || a?.op !== 'action' || a.guard !== undefined || m1.what.ref === 'each' || m1.what.ref === 'topCards') return null;
  if (!same(m2.what, { ref: 'topCards', player: { ref: 'you' }, count: 1 })) return null;
  if (a.action !== 'manifest' || a.arg !== 'shuffle' || !same(a.who, { ref: 'you' }) || a.n !== undefined || a.as !== undefined) return null;
  if (!same(a.subject, { ref: 'union', of: [{ ref: 'bound', name: m1.as }, { ref: 'bound', name: m2.as }] })) return null;
  if (!unread(list, i + 3, m1.as, m2.as)) return null;
  const what = K.obj(m1.what as ObjRef, st, 'object').text;
  return { clauses: [acting('you', `exile ${what} and the top card of your library in a face-down pile, shuffle that pile, then manifest those cards`, `you exile ${what} and the top card of your library in a face-down pile, shuffle that pile, then manifest those cards`)], consumed: 3 };
}

export function foldEdhD39(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return exileItAndTopPileManifest(list, i, st) ?? exileAllPileManifest(list, i, st);
}
