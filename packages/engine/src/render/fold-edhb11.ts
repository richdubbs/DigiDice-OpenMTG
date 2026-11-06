/**
 * edh-b-11 (Commander coordinator B): the folds of its templates (parser/templates/zz-cloud/edh-b-11.json), called from render/fold.ts#foldAt. Each applies only when every part is
 * exactly what the idiom says.
 *
 * `counterOnUpTo` (CR 122.1, 608.2d; Gix's Command, eff.edhb9.putCounters.eachOfUpTo (pattern extended by edh-b-11 to "on up to one")): "Put two +1/+1 counters on up to one creature.": the controller chooses up to N permanents of a
 * description as the ability resolves (no targets) and a number of counters of one kind go on each of them. Exactly those two steps, the chosen objects named by the counters and by
 * the pronoun of a later instruction ("It gains lifelink until end of turn.").
 *
 * `doublePowerNTimes` (CR 701.10a-c, 608.2c; Exponential Growth, eff.edhb11.double.power.nTimes): "Until end of turn, double target creature's power X times.": the one doubling of
 * power (render/double.ts#doubledBy) repeated a counted number of times, each reading the power left by the one before.
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { doubledBy } from './double';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { rangeWords } from './refs';
import type { RenderState } from './state';
import { countersText } from './steps-life';
import { bind } from './steps-util';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function counterOnUpTo(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [c, p] = [list[i], list[i + 1]];
  if (c?.op !== 'chooseObjects' || p?.op !== 'putCounters' || c.as !== 'upToChosen' || c.guard !== undefined || p.guard !== undefined || c.random !== undefined || c.groupLimit !== undefined || c.perPlayer !== undefined || c.link !== undefined) return null;
  if (!same(c.who, { ref: 'you' }) || c.min !== 0 || typeof c.max !== 'number' || c.max !== 1 || c.from.ref !== 'each' || !('filter' in c.from)) return null;
  if (!same(p.on, { ref: 'bound', name: c.as }) || p.as !== undefined || p.upTo !== undefined || p.distribute !== undefined || p.by !== undefined || p.kindOfChoice !== undefined || typeof p.count !== 'number' || p.kind === 'any') return null;
  const rw = rangeWords(c.min, c.max, st);
  if (rw.count === undefined) return null;
  const text = `put ${countersText(p.count, p.kind, st)} on ${K.np(c.from.filter, st, { det: 'none', plural: rw.plural, count: rw.count })}`;
  bind(st, c.as, { nouns: K.nounsOf(c.from.filter), plural: rw.plural, optional: true });
  return { clauses: [plain(text)], consumed: 2 };
}

function doublePowerNTimes(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const r = list[i];
  if (r?.op !== 'repeat' || r.guard !== undefined || r.as !== undefined || r.process !== undefined || r.again !== undefined || r.optional !== undefined || r.until !== undefined || r.gather !== undefined || r.do.length !== 1) return null;
  const e = r.do[0]!;
  if (e.op !== 'effect' || e.guard !== undefined || e.duration === undefined || e.effects.length !== 1 || doubledBy(e.effects[0]!) !== 'power') return null;
  const eff = e.effects[0]!;
  if (eff.s !== 'continuous' || !['target', 'self', 'bound', 'event'].includes(eff.affects.ref)) return null; // one named object, not a player or a group
  const obj = eff.affects as ObjRef;
  return { clauses: [plain(`${K.dur(e.duration, st)}, double ${K.obj(obj, st, 'possessive').text} power ${K.qty(r.times, st)} times`)], consumed: 1 };
}

export function foldEdhB11(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return counterOnUpTo(list, i, st) ?? doublePowerNTimes(list, i, st);
}
