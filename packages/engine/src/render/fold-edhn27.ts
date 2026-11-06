/**
 * Commander lane edh-next, round edh-next-27: the folds of its templates (parser/templates/zz-cloud/edh-next-27.json), called from render/fold.ts#foldAt. A fold applies only when
 * every part is exactly what the idiom says. (A value is never imported from render/fold.ts: it imports this file.)
 *
 * `eachExilesNFromHand` (CR 406.1, 608.2d, 101.4, 109.4; Nicol Bolas, God-Pharaoh, eff.edhn27.each.exilesNFromHand.opponent): "Each opponent exiles two cards from their hand.": every player
 * of the group chooses, from their OWN hand, that many cards (a player with fewer gives all of them, CR 608.2d), and the cards chosen are exiled. Exactly those two steps, the cards chosen
 * named by nothing but the exile.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import { withArticle } from './text';
import type { ObjRef } from '../types/ability';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function eachExilesNFromHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [c, m] = [list[i], list[i + 1]];
  if (c?.op !== 'chooseObjects' || m?.op !== 'move' || c.guard !== undefined || m.guard !== undefined || c.random !== undefined || c.groupLimit !== undefined || c.link !== undefined) return null;
  if (c.startingWith !== undefined || c.eachCardType !== undefined || c.distinct !== undefined || c.damageSource !== undefined || c.span !== undefined) return null;
  const per = c.perPlayer;
  if (per === undefined || per.ref !== 'each' || (per.who !== 'player' && per.who !== 'opponent') || !same(c.who, { ref: 'iterating' }) || !same(c.min, c.max) || typeof c.min === 'string') return null;
  if (c.from.ref !== 'each' || !same(c.from.filter, { zone: 'hand', owner: { ref: 'iterating' } })) return null;
  if (!same(m.what, { ref: 'bound', name: c.as }) || !same(m.to, { zone: 'exile' }) || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined) return null;
  if (JSON.stringify(list.slice(i + 2)).includes(`"name":"${c.as}"`)) return null; // a later sentence names the cards exiled: not this idiom
  const n = K.qty(c.min, st);
  return { clauses: [plain(`each ${per.who} exiles ${n} cards from their hand`, { standalone: true })], consumed: 2 };
}

/**
 * `twoKindsOnTwoObjects` (CR 122.1, 608.2c; Arwen, Mortal Queen, eff.edhn27.counters.twoKindsTwoObjects): "Put a +1/+1 counter and a lifelink counter on that creature and a +1/+1 counter and a
 * lifelink counter on ~.": one counter of each of two kinds on the first object, then the same two kinds on the second. Exactly those four steps (one counter each, no guard, no name).
 */
function twoKindsOnTwoObjects(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const four = list.slice(i, i + 4);
  if (four.length < 4 || four.some((x) => x.op !== 'putCounters')) return null;
  const [a1, a2, b1, b2] = four as Extract<EffectStep, { op: 'putCounters' }>[];
  for (const x of four as Extract<EffectStep, { op: 'putCounters' }>[]) {
    if (x.count !== 1 || x.guard !== undefined || x.as !== undefined || x.by !== undefined || x.upTo !== undefined || x.distribute !== undefined || x.kindOfChoice !== undefined || x.kind === 'any') return null;
  }
  if (!same(a1!.on, a2!.on) || !same(b1!.on, b2!.on) || same(a1!.on, b1!.on) || a1!.kind === a2!.kind || b1!.kind === b2!.kind) return null;
  const first = K.obj(a1!.on as ObjRef, st, 'object').text;
  const second = K.obj(b1!.on as ObjRef, st, 'object').text;
  const kinds = (x: { kind: string }, y: { kind: string }): string => `${withArticle(`${x.kind} counter`)} and ${withArticle(`${y.kind} counter`)}`;
  return { clauses: [plain(`put ${kinds(a1!, a2!)} on ${first} and ${kinds(b1!, b2!)} on ${second}`)], consumed: 4 };
}

/** The folds of edh-next-27 (render/fold.ts#foldAt). */
export function foldEdhNext27(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return eachExilesNFromHand(list, i, st) ?? twoKindsOnTwoObjects(list, i, st);
}
