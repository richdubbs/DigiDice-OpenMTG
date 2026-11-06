/**
 * edh-next-89 (Commander top-rank part 5, EDHREC ranks 10,501-12,000): the folds of its readings, called from render/fold.ts#foldAtPlain.
 *
 * `thenIfCountersRemoveTransform` (CR 122.1, 701.28a, 608.2c; Smoldering Egg, family if-counters-remove-them-transform): the `if` step of a self that has N or more counters of a kind,
 * which removes all of them and transforms it, is said "Then if ~ has seven or more ember counters on it, remove them and transform ~." after an earlier instruction of the same
 * ability (the model's own "if it has ... remove all of them and transform it" stays a reading). Only an `if` with no else whose two instructions are the removal of all counters of
 * that kind from the object and its transform.
 */
import type { EffectStep } from '../types/ability';
import type { Folded } from './fold';
import { plain } from './clause';
import type { RenderState } from './state';
import { alt } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function thenIfCountersRemoveTransform(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (i === 0 || s?.op !== 'if' || s.else !== undefined || s.then.length !== 2) return null;
  const [rm, tf] = s.then;
  if (rm?.op !== 'removeCounters' || rm.count !== 'all' || !same(rm.from, { ref: 'self' }) || typeof rm.kind !== 'string' || tf?.op !== 'changeFace' || tf.to !== 'transform' || !same(tf.what, { ref: 'self' })) return null;
  const c = s.cond as { cond?: string; object?: unknown; filter?: { counters?: { kind?: string; cmp?: { op?: string } } } };
  if (c.cond !== 'matches' || !same(c.object, { ref: 'self' }) || Object.keys(c.filter ?? {}).join() !== 'counters' || c.filter?.counters?.kind !== rm.kind || c.filter.counters.cmp?.op !== '>=') return null;
  const n = (c.filter.counters as { cmp: { value?: unknown } }).cmp.value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) return null;
  const test = (me: string): string => `${me} has ${n} or more ${rm.kind} counters on it`;
  void st;
  return { clauses: [plain(alt(`then if ${test('~')}, remove them and transform ~`, `then if ${test('it')}, remove them and transform it`, `then if ${test('~')}, remove them and transform it`, `then if ${test('it')}, remove them and transform ~`), { standalone: true })], consumed: 1 };
}

export function foldEdhN89(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return thenIfCountersRemoveTransform(list, i, st);
}
