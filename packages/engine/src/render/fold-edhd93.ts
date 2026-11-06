/**
 * edh-d-93 (Commander coordinator D, EDHREC ranks 5,001-10,000, group counters; code edhd93): the folds of its readings (parser/templates/zz-cloud/edh-d-93.json), called from
 * render/fold.ts#foldAt. Each applies only when every part is exactly what the idiom says.
 *
 * `putUpToTappedAndRestBottom` (CR 608.2c, 608.2d, 401.4, 110.2a; Expand the Sphere, eff.edhd93.dig.putUpTo.bf.tapped.rest.bottomRandom): "Put up to two land cards from among them onto
 * the battlefield tapped and the rest on the bottom of your library in a random order.": your choice of none to N cards of one description among the group looked at, their move onto
 * the battlefield tapped under your control (named, for a later "this way"), and the rest of the group to the bottom of your library in a random order.
 *
 * `proliferateDifference` (CR 701.34a, 608.2c, 608.2h; Expand the Sphere, eff.edhd93.proliferate.difference.ifFewerPut): "If you put fewer than two lands onto the battlefield this way,
 * proliferate a number of times equal to the difference.": a proliferate guarded by "the cards the move onto the battlefield right before reported are fewer than N", done N minus those
 * cards times.
 */
import type { EffectStep, ObjectFilter, ObjRef } from '../types/ability';
import { acting, plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { movedInfo } from './moved';
import type { RenderState } from './state';
import { alt, numWord, pluralize } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const keys = (f: object): string => Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join(',');

function putUpToTappedAndRestBottom(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b, c] = [list[i], list[i + 1], list[i + 2]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || c?.op !== 'move') return null;
  if (a.guard !== undefined || b.guard !== undefined || c.guard !== undefined || a.as === undefined || b.as === undefined || c.as !== undefined || a.random === true || a.groupLimit !== undefined) return null;
  if (b.until !== undefined || c.until !== undefined || b.link !== undefined || c.link !== undefined || b.remember !== undefined || c.remember !== undefined) return null;
  if (a.who.ref !== 'you' || a.min !== 0 || typeof a.max !== 'number' || a.max < 2 || a.from.ref !== 'each' || !('filter' in a.from)) return null;
  const fa = a.from.filter;
  if (keys(fa) !== 'anyOf,is,zone' || fa.zone !== 'library' || fa.anyOf?.length !== 1 || fa.is?.ref !== 'bound') return null;
  if (!same(b.what, { ref: 'bound', name: a.as }) || !same(b.to, { zone: 'battlefield', controller: { ref: 'you' }, tapped: true })) return null;
  if (!same(c.what, { ref: 'each', filter: { is: fa.is, not: { is: { ref: 'bound', name: a.as } }, zone: 'library' } })) return null;
  if (!same(c.to, { zone: 'library', position: 'bottom', order: 'random' })) return null;
  // the choice is read by nothing later (the move of what it chose is named instead)
  if (list.slice(i + 3).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`))) return null;
  const them = K.obj(fa.is, st, 'object');
  if (!them.plural) return null;
  const desc: ObjectFilter = fa.anyOf[0]!;
  const kind = K.np({ ...desc, zone: 'library' }, st, { det: 'none', plural: true, noZone: true });
  // the cards put are what a later "<cards> put onto the battlefield this way" counts (render/moved.ts)
  st.info.set(`r:${b.as}`, movedInfo('battlefield', [...K.nounsOf(desc), 'permanent']));
  st.mentioned.delete(`b:${fa.is.name}`);
  const text = `put up to ${numWord(a.max)} ${kind} from among ${them.text} onto the battlefield tapped and the rest on the bottom of your library in a random order`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 3 };
}

function proliferateDifference(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const d = list[i];
  if (d?.op !== 'action' || d.action !== 'proliferate' || d.who.ref !== 'you' || d.as !== undefined) return null;
  const n = (d as { n?: unknown }).n as { q?: string; op?: string; args?: unknown[] } | undefined;
  if (n?.q !== 'math' || n.op !== '-' || n.args?.length !== 2) return null;
  const [limit, got] = n.args as [unknown, { q?: string; step?: string; which?: ObjectFilter }];
  const g = d.guard;
  if (typeof limit !== 'number' || g === undefined || g.cond !== 'compare' || g.op !== '<' || g.right !== limit || !same(g.left, got)) return null;
  if (typeof got !== 'object' || got.q !== 'resultCount' || got.step === undefined || st.info.get(`r:${got.step}`)?.moved !== 'battlefield') return null;
  const w = got.which ?? {};
  if (keys(w) !== 'types' || w.types?.length !== 1) return null;
  const noun = pluralize(w.types[0]!.toLowerCase());
  return { clauses: [plain(`if you put fewer than ${numWord(limit)} ${noun} onto the battlefield this way, proliferate a number of times equal to the difference`, { standalone: true })], consumed: 1 };
}

/** The condition "you control <object>" as playerIs of the object's controller (CR 608.2h: a gone object's controller is its last known one), or null. */
function youControl(c: unknown): ObjRef | null {
  const x = c as { cond?: string; who?: { ref?: string; object?: ObjRef }; is?: string } | undefined;
  if (x?.cond !== 'playerIs' || x.is !== 'you' || x.who?.ref !== 'controllerOf' || x.who.object === undefined || Object.keys(x.who).length !== 2) return null;
  return x.who.object;
}

/**
 * `drawIfYouControl` (CR 608.2c, 608.2h, 121.1; Auntie Ool, Cursewretch, eff.edhd93.draw.ifYouControlObj): "draw a card if you control that creature": an `if` whose condition is that the
 * object's controller is you, holding your draw of one card.
 */
function drawIfYouControl(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const d = list[i];
  if (d?.op !== 'if' || d.guard !== undefined || d.as !== undefined || d.else !== undefined || d.then.length !== 1) return null;
  const o = youControl(d.cond);
  const t = d.then[0]!;
  if (o === null || t.op !== 'draw' || t.guard !== undefined || t.as !== undefined || t.who.ref !== 'you' || t.count !== 1 || Object.keys(t).length !== 3) return null;
  const text = `draw a card if you control ${K.obj(o, st, 'object').text}`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 1 };
}

/**
 * `itsControllerLosesUnlessYours` (CR 608.2c, 608.2h, 119.3; Auntie Ool, Cursewretch, eff.edhd93.ifYouDontControlObj.itsControllerLoses): "If you don't control it, its controller loses 1 life.":
 * an `if` whose condition is that the object's controller is not you, holding that controller's loss of life.
 */
function itsControllerLosesUnlessYours(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const d = list[i];
  if (d?.op !== 'if' || d.guard !== undefined || d.as !== undefined || d.else !== undefined || d.then.length !== 1) return null;
  const c = d.cond as { cond?: string; of?: unknown };
  const o = c.cond === 'not' ? youControl(c.of) : null;
  const t = d.then[0]!;
  if (o === null || t.op !== 'loseLife' || t.guard !== undefined || t.as !== undefined || !same(t.who, { ref: 'controllerOf', object: o }) || Object.keys(t).length !== 3) return null;
  const it = alt('it', K.obj(o, st, 'object').text);
  return { clauses: [plain(`if you don't control ${it}, its controller loses ${K.qty(t.amount, st)} life`, { standalone: true })], consumed: 1 };
}

/**
 * `gainThatMuchIfMoved` (CR 122.5, 608.2c, 608.2h; Black Panther, Wakandan King, eff.edhd93.ifCountersMoved.gainThatMuch.draw): "If one or more +1/+1 counters are moved this way, you gain that much life
 * and draw a card.": after the move of every counter of one kind (the step right before, named), an `if` that at least one was put onto the other object, holding your gain of that many life and
 * your draw of a card.
 */
function gainThatMuchIfMoved(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [m, d] = [list[i - 1], list[i]];
  if (m?.op !== 'moveCounters' || m.as === undefined || m.count !== 'all' || d?.op !== 'if' || d.guard !== undefined || d.as !== undefined || d.else !== undefined || d.then.length !== 2) return null;
  const moved = { q: 'countersPut', step: m.as, kind: m.kind };
  if (!same(d.cond, { cond: 'compare', left: moved, op: '>=', right: 1 })) return null;
  const [g, r] = d.then as [EffectStep, EffectStep];
  if (g.op !== 'gainLife' || g.guard !== undefined || g.as !== undefined || !same(g.who, { ref: 'you' }) || !same(g.amount, moved) || Object.keys(g).length !== 3) return null;
  if (r.op !== 'draw' || r.guard !== undefined || r.as !== undefined || !same(r.who, { ref: 'you' }) || r.count !== 1 || Object.keys(r).length !== 3) return null;
  if (list.slice(i + 1).some((x) => JSON.stringify(x).includes(`"step":"${m.as}"`))) return null;
  return { clauses: [plain(`if one or more ${m.kind} counters are moved this way, you gain that much life and draw a card`, { standalone: true })], consumed: 1 };
}

/**
 * `attachedControllerSacrificesIt` (CR 701.21a, 303.4, 608.2h; Reality Acid, eff.edhb11.controllerOf.sacrifices.it with parser/lower/anaphora.ts's edh-d-93 rule): "enchanted permanent's controller
 * sacrifices it.": the controller of the object the source is (or, once it left, was) attached to sacrifices exactly that object.
 */
function attachedControllerSacrificesIt(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'sacrificeChoice' || s.guard !== undefined || s.as !== undefined || s.cantAs !== undefined || s.exploit !== undefined || s.mode !== undefined || s.keepTypes !== undefined || s.keepFilter !== undefined || s.chooser !== undefined) return null;
  const host = { ref: 'attachedTo' };
  if (!same(s.who, { ref: 'controllerOf', object: host }) || !same(s.filter, { is: host }) || s.count !== 1) return null;
  const owner = K.obj(host as ObjRef, st, 'possessive').text;
  // the object again is "it" or, as the general renderer says it, "that creature" (family attached-controller-sacrifices-it)
  return { clauses: [plain(`${owner} controller sacrifices ${alt('it', K.obj(host as ObjRef, st, 'object').text)}`)], consumed: 1 };
}

export function foldEdhD93(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return putUpToTappedAndRestBottom(list, i, st) ?? proliferateDifference(list, i, st) ?? drawIfYouControl(list, i, st) ?? itsControllerLosesUnlessYours(list, i, st) ?? gainThatMuchIfMoved(list, i, st) ?? attachedControllerSacrificesIt(list, i, st);
}
