/**
 * edh-players-11 (Commander lane edh-players): the folds of its templates (parser/templates/zz-cloud/edh-players-11.json), called from render/fold.ts#foldAt and
 * render/steps-lasting.ts. CR cites from memory, unverified unless the record says otherwise.
 *
 * `eachPlayerCantAttackYouTheirNextTurn` (CR 508.1b, 508.1c, 611.2a, 101.4; The Second Doctor): a forEach over some players, each getting a lasting ban on the creatures they
 * control attacking you or the permanents you control (a `cant` attackPlayer of you and a `cant` attack of what you control) through the end of their own next turn:
 * "Each opponent who does can't attack you or permanents you control during their next turn." Only that exact shape (eff.edhp11.player.cantAttackYouOrPermanents.theirNextTurn).
 *
 * `didPlayersCantAttackYou` (CR 508.1b, 508.1c, 608.2c, 611.2a; Orzhov Advokist): the lasting ban of the creatures controlled by the players of a group `may` who did it, "If a player
 * does, creatures that player controls can't attack you or planeswalkers you control until your next turn." Only after the `may` of each player that names them.
 *
 * `eachPlayerPutsCounters` (CR 608.2d, 122.1, 101.4; Orzhov Advokist): the iterating player chooses one permanent of a description they control and puts counters on it,
 * "put two +1/+1 counters on a creature they control" (inside "each player may ...").
 */
import type { EffectStep, ObjectFilter, ObjRef, Quantity, StaticEffect } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { withVariants, type RenderState } from './state';
import { bind } from './steps-util';
import { countersText } from './steps-life';
import { alt } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const ITERATING = { ref: 'iterating' } as const;

const CREATURES_OF_ITERATING = { ref: 'each', filter: { types: ['Creature'], controller: ITERATING } };

function eachPlayerCantAttackYouTheirNextTurn(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'forEach' || s.guard !== undefined || s.as === undefined || s.gather !== undefined || s.do.length !== 1) return null;
  const [e] = s.do;
  if (e?.op !== 'effect' || e.guard !== undefined || e.as !== undefined || e.effects.length !== 2) return null;
  if (!same(e.duration, { d: 'endOfNextTurn', whose: ITERATING })) return null;
  const [a, b] = e.effects;
  const keys = (r: StaticEffect, extra: string): boolean => Object.keys(r).every((k) => ['s', 'subject', 'mode', 'action', extra].includes(k));
  if (a?.s !== 'restrict' || b?.s !== 'restrict' || a.mode !== 'cant' || b.mode !== 'cant' || a.action !== 'attackPlayer' || b.action !== 'attack') return null;
  if (!keys(a, 'otherPlayer') || !keys(b, 'other') || !same(a.otherPlayer, { ref: 'you' }) || !same(b.other, { controller: 'you' })) return null;
  if (!same(a.subject, CREATURES_OF_ITERATING) || !same(b.subject, CREATURES_OF_ITERATING)) return null;
  const who = K.player(s.over as never, st, 'subject');
  const tail = alt('during their next turn', 'until the end of their next turn');
  return { clauses: [plain(`${who.text} can't attack you or permanents you control ${tail}`, { standalone: true })], consumed: 1 };
}

/**
 * The lasting ban of an `effect` step whose two restrictions are on the creatures controlled by the players a group `may` before it bound (`bound` name with
 * `eachMay` in the render state): "if a player does, creatures that player controls can't attack you or planeswalkers you control <duration>". Null for any other step.
 */
export function didPlayersCantAttackYou(effects: readonly StaticEffect[], duration: string, st: RenderState): string | null {
  const [a, b] = effects;
  if (effects.length !== 2 || a?.s !== 'restrict' || b?.s !== 'restrict' || a.mode !== 'cant' || b.mode !== 'cant' || a.action !== 'attackPlayer' || b.action !== 'attack') return null;
  const keys = (r: StaticEffect, extra: string): boolean => Object.keys(r).every((k) => ['s', 'subject', 'mode', 'action', extra].includes(k));
  if (!keys(a, 'otherPlayer') || !keys(b, 'other') || !same(a.otherPlayer, { ref: 'you' }) || !same(b.other, { types: ['Planeswalker'], controller: 'you' })) return null;
  if (!same(a.subject, b.subject) || a.subject.ref !== 'each' || !('filter' in a.subject)) return null;
  const f = a.subject.filter as ObjectFilter;
  const c = f.controller as unknown as { ref?: string; name?: string } | undefined;
  if (Object.keys(f).sort().join(',') !== 'controller,types' || !same(f.types, ['Creature']) || c?.ref !== 'bound' || c.name === undefined) return null;
  const info = st.info.get(`b:${c.name}`);
  if (info?.eachMay !== 'player') return null;
  return `if a player ${alt('does', 'did')}, creatures that player controls can't attack you or planeswalkers you control${duration === '' ? '' : ` ${duration}`}`;
}

function eachPlayerPutsCounters(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'putCounters' || a.random === true || a.guard !== undefined || b.guard !== undefined || b.as !== undefined || a.groupLimit !== undefined || a.link !== undefined) return null;
  if (!same(a.who, ITERATING) || a.min !== 1 || a.max !== 1 || a.perPlayer !== undefined || a.startingWith !== undefined || a.eachCardType !== undefined || a.distinct !== undefined || a.damageSource !== undefined || a.as === undefined) return null;
  if (b.on.ref !== 'bound' || b.on.name !== a.as || b.upTo !== undefined) return null;
  const from = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (from === null || Object.keys(from).sort().join(',') !== 'anyOf,controller' || !same(from.controller, ITERATING) || from.anyOf?.length !== 1) return null;
  const kind = from.anyOf[0]!;
  const text = `put ${countersText(b.count, b.kind, st)} on ${K.np(kind, st, { det: 'a' })} they control`;
  bind(st, a.as, { nouns: K.nounsOf(kind), plural: false });
  return { clauses: [plain(text)], consumed: 2 };
}

/** Does a step (or anything in it) name the link `link` ({cond:'chosen'} or a linked reference)? */
function readsChoice(x: unknown, link: string): boolean {
  if (Array.isArray(x)) return x.some((y) => readsChoice(y, link));
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return Object.entries(o).some(([k, v]) => ((k === 'link' || k === 'chosen') && v === link) || readsChoice(v, link));
}

/**
 * `choosePumpXOrMinusX` (CR 608.2d, 613.4c, 107.3; template eff.edhp11.pump.xOrMinusX.whereX; Liliana of the Dark Realms): "Target creature gets +X/+X or -X/-X until end of turn, where X is
 * the number of Swamps you control." A choice between the two changes made as the ability resolves (a chooseValue of the two options, spelled as the changes), then one change per option
 * of the same computed amount, positive or negated, for the same object and duration. Only that exact shape; the choice is read by these two branches only.
 */
function choosePumpXOrMinusX(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  if (c?.op !== 'chooseValue' || c.link === undefined || c.who.ref !== 'you' || c.guard !== undefined || c.what !== 'option' || c.as === undefined || !same(c.options, ['+X/+X', '-X/-X'])) return null;
  let first: Extract<EffectStep, { op: 'effect' }> | null = null;
  let amount: unknown;
  for (let k = 0; k < 2; k++) {
    const b = list[i + 1 + k];
    if (b?.op !== 'if' || b.else !== undefined || b.guard !== undefined || b.as !== undefined || b.then.length !== 1 || b.cond.cond !== 'chosen' || b.cond.link !== c.link || b.cond.equals !== c.options![k]) return null;
    const e = b.then[0]!;
    if (e.op !== 'effect' || e.effects.length !== 1 || e.guard !== undefined || e.as !== undefined) return null;
    const ce = e.effects[0]!;
    if (ce.s !== 'continuous' || ce.cda !== undefined || ce.mods.length !== 1) return null;
    const m = ce.mods[0]!;
    if (m.layer !== '7c' || typeof m.power !== 'object' || !same(m.power, m.toughness) || Object.keys(m).length !== 3) return null;
    if (k === 0) { amount = m.power; first = e; }
    else {
      if (!same(m.power, { q: 'math', op: '*', args: [-1, amount] }) || !same(e.duration, first!.duration) || !same(ce.affects, (first!.effects[0] as typeof ce).affects)) return null;
    }
  }
  if (list.slice(i + 3).some((x) => readsChoice(x, c.link!))) return null;
  const ce = first!.effects[0]!;
  if (ce.s !== 'continuous' || ce.affects.ref === 'each') return null;
  const subj = K.obj(ce.affects as ObjRef, st, 'subject');
  const dur = K.dur(first!.duration, st);
  const text = `${subj.text} ${subj.plural ? 'get' : 'gets'} +X/+X or -X/-X${dur ? ` ${dur}` : ''}, where X is ${K.qty(amount as Quantity, st)}`;
  return { clauses: [plain(text)], consumed: 3 };
}

const UNFOLDING = new WeakSet<EffectStep>();

/**
 * `putAllFromAmongThem` (CR 701.13a, 608.2c, 400.7j; template eff.edhp11.dig.putAll.bf; Tezzeret, Master of the Bridge): after an instruction that made a group of cards ("Exile the
 * top ten cards of your library."), "Put all artifact cards from among them onto the battlefield.": every card of the group of a description, all at once, under your control. The move
 * written apart ("put all artifacts exiled this way onto the battlefield under your control") stays a reading.
 */
function putAllFromAmongThem(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'move' || a.guard !== undefined || a.as !== undefined || UNFOLDING.has(a) || a.what.ref !== 'each' || !('filter' in a.what)) return null;
  const f = a.what.filter;
  if (Object.keys(f).sort().join(',') !== 'anyOf,is,zone' || f.zone !== 'any' || f.anyOf?.length !== 1 || f.is?.ref !== 'bound') return null;
  if (!same(a.to, { zone: 'battlefield', controller: { ref: 'you' } })) return null;
  if (st.info.get(`b:${f.is.name}`) === undefined) return null;
  const kind = f.anyOf[0]!;
  const unfold = (v: RenderState): string => {
    UNFOLDING.add(a);
    try { return K.steps([a], v); } finally { UNFOLDING.delete(a); }
  };
  const [folded, unfolded] = withVariants(st, [(v) => `put all ${K.np(kind, v, { det: 'none', plural: true, head: 'card' })} from among them onto the battlefield`, unfold]);
  return { clauses: [plain(alt(folded!, unfolded!))], consumed: 1 };
}

/** The folds of edh-players-11 (render/fold.ts#foldAt). */
export function foldEdhP11(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return eachPlayerCantAttackYouTheirNextTurn(list, i, st) ?? eachPlayerPutsCounters(list, i, st) ?? putAllFromAmongThem(list, i, st) ?? choosePumpXOrMinusX(list, i, st);
}
