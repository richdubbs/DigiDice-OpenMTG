/**
 * Commander lane group-choices (concept round), round edh-d-63 (coordinator D): the folds of the steps its templates build (render/fold.ts#foldAt tries `foldEdhD63` after the other
 * slices' own folds). A fold applies only when every part is exactly what the idiom says. This file imports no value from render/fold.ts (an import cycle); it takes the types only.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { cloneState, type RenderState } from './state';

const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/**
 * "Put a charge counter on this artifact or remove one from it." (Jinxed Choker, Sigurd, Jarl of Ravensthorpe; CR 122.1, 608.2d, template eff.edhd63.counters.putOrRemoveOne): you choose,
 * as it resolves, whether to put one counter of a kind on an object or to remove one counter of that kind from the same object (the choice `counterMode`, put or remove). Exactly those
 * three steps: the choice, the put and the removal, the object and the kind the same in both.
 */
function putOrRemoveOne(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [c, a, b] = [list[i], list[i + 1], list[i + 2]];
  if (c?.op !== 'chooseValue' || a?.op !== 'if' || b?.op !== 'if' || [c, a, b].some((x) => x.guard !== undefined)) return null;
  if (!same(c, { op: 'chooseValue', who: { ref: 'you' }, what: 'option', as: 'counterMode', link: 'counterMode', options: ['put', 'remove'] })) return null;
  if (!same(a.cond, { cond: 'chosen', link: 'counterMode', equals: 'put' }) || !same(b.cond, { cond: 'chosen', link: 'counterMode', equals: 'remove' })) return null;
  if (a.then.length !== 1 || b.then.length !== 1 || a.else !== undefined || b.else !== undefined || Object.keys(a).length !== 3 || Object.keys(b).length !== 3) return null;
  const [put, rem] = [a.then[0], b.then[0]];
  if (put?.op !== 'putCounters' || rem?.op !== 'removeCounters' || put.guard !== undefined || rem.guard !== undefined) return null;
  if (!same(put.on, rem.from) || put.kind !== rem.kind || rem.count !== 1 || rem.upTo !== undefined || rem.among !== undefined || rem.kindOfChoice !== undefined) return null;
  if (Object.keys(put).some((k) => !['op', 'on', 'kind', 'count'].includes(k)) || Object.keys(rem).some((k) => !['op', 'from', 'kind', 'count'].includes(k))) return null;
  if (put.count !== 1 || put.kind === 'any') return null;
  if (list.slice(i + 3).some((x) => JSON.stringify(x).includes('"counterMode"'))) return null;
  const text = K.steps([put], cloneState(st), {});
  return { clauses: [plain(`${text} or remove one from ${put.on.ref === 'self' ? 'it' : 'it'}`)], consumed: 3 };
}

/**
 * "Starting with you and proceeding in the chosen direction, each player chooses a creature controlled by the next player in that direction. Each player gains control of the creature they chose."
 * (Order of Succession; CR 101.4, 608.2c, 611.2c, templates eff.edhd63.startingWithYou.eachPlayerChoosesCreatureNext and eff.edhd63.eachPlayer.gainsControlOfCreatureTheyChose): each player,
 * beginning with you and going on in the chosen direction, chooses one creature the next player controls; the creatures chosen all change control at once, each to the player who chose it.
 * Exactly those two steps (the direction itself was chosen by the step before).
 */
function succession(list: EffectStep[], i: number): Folded | null {
  const [f, e] = [list[i], list[i + 1]];
  if (f?.op !== 'forEach' || e?.op !== 'effect' || f.guard !== undefined || e.guard !== undefined) return null;
  const expectedFor = { op: 'forEach', over: { ref: 'each', who: 'player' }, as: 'chooser', inDirection: 'direction', gather: 'chosen', do: [{ op: 'chooseObjects', who: { ref: 'iterating' }, from: { ref: 'each', filter: { types: ['Creature'], controller: { ref: 'seat', side: 'left', chosen: 'direction', of: { ref: 'iterating' } } } }, min: 1, max: 1, as: 'chosen' }] };
  const expectedEffect = { op: 'effect', duration: { d: 'permanent' }, effects: [{ s: 'continuous', affects: { ref: 'bound', name: 'chosen' }, mods: [{ layer: 2, controller: { ref: 'seat', side: 'left', chosen: 'direction', inverse: true, of: { ref: 'controllerOf', object: { ref: 'subject' } } } }] }] };
  if (!same(f, expectedFor) || !same(e, expectedEffect)) return null;
  if (list.slice(0, i).filter((x) => x.op === 'chooseValue' && x.link === 'direction').length !== 1) return null;
  return { clauses: [plain('starting with you and proceeding in the chosen direction, each player chooses a creature controlled by the next player in that direction. each player gains control of the creature they chose', { standalone: true })], consumed: 2 };
}

export function foldEdhD63(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return putOrRemoveOne(list, i, st) ?? succession(list, i);
}
