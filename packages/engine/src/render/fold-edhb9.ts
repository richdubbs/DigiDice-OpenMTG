/**
 * edh-b-9 (Commander coordinator B): the folds of its templates (parser/templates/zz-cloud/edh-b-9.json), called from render/fold.ts#foldAt. Each applies only when every part is
 * exactly what the idiom says.
 *
 * `counterEachOfUpTo` (CR 122.1, 608.2d; SOLDIER Military Program, eff.edhb9.putCounters.eachOfUpTo): "Put a +1/+1 counter on each of up to two Soldiers you control.": the controller
 * chooses up to N permanents of a description as the ability resolves (no targets) and a number of counters of one kind go on each of them. Exactly those two steps, the chosen
 * objects named by nothing but the counters.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { rangeWords } from './refs';
import type { RenderState } from './state';
import { countersText } from './steps-life';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function counterEachOfUpTo(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [c, p] = [list[i], list[i + 1]];
  if (c?.op !== 'chooseObjects' || p?.op !== 'putCounters' || c.as !== 'upToChosen' || c.guard !== undefined || p.guard !== undefined || c.random !== undefined || c.groupLimit !== undefined || c.perPlayer !== undefined || c.link !== undefined) return null;
  if (!same(c.who, { ref: 'you' }) || c.min !== 0 || typeof c.max !== 'number' || c.max < 2 || c.from.ref !== 'each' || !('filter' in c.from)) return null;
  if (!same(p.on, { ref: 'bound', name: c.as }) || p.as !== undefined || p.upTo !== undefined || p.distribute !== undefined || p.by !== undefined || p.kindOfChoice !== undefined || typeof p.count !== 'number' || p.kind === 'any') return null;
  const rw = rangeWords(c.min, c.max, st);
  if (rw.count === undefined) return null;
  return { clauses: [plain(`put ${countersText(p.count, p.kind, st)} on each of ${K.np(c.from.filter, st, { det: 'none', plural: true, count: rw.count })}`)], consumed: 2 };
}

export function foldEdhB9(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return counterEachOfUpTo(list, i, st);
}
