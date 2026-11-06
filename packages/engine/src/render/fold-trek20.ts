/**
 * trek-20: the reading of its template eff.trek20.eachPlayer.vowKeepOne.cantAttackYou (parser/templates/zz-cloud/trek-20.json), called from render/fold.ts#foldAt.
 *
 * `vowKeepOne` (CR 101.4, 122.1, 608.2d, 611.2b, 701.21a; Promise of Loyalty): "Each player puts a vow counter on a creature they control and sacrifices the rest. Each of those
 * creatures can't attack you or planeswalkers you control for as long as it has a vow counter on it." is four steps: each player keeps one creature they control (chooseObjects
 * per player, in turn order), a counter goes on each kept creature, every other creature is sacrificed (each player sacrifices all of theirs, sacrificeChoice mode all), and for each kept creature one lasting effect that
 * ends when THAT creature loses the counter (CR 611.2b; judged object by object, so a creature that loses its counter is free while the others stay held). Null for any other shape.
 */
import type { EffectStep, ObjectFilter } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const keys = (o: object, allowed: string[]): boolean => Object.keys(o).every((k) => allowed.includes(k));
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const boundRef = (name: string): unknown => ({ ref: 'bound', name });
const withArticle = (kind: string): string => `${/^[aeiou]/i.test(kind) ? 'an' : 'a'} ${kind}`;

export function foldTrek20(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b, c, d] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'putCounters' || c?.op !== 'sacrificeChoice' || d?.op !== 'forEach') return null;
  if (!keys(a, ['op', 'who', 'from', 'min', 'max', 'perPlayer', 'as']) || a.min !== 1 || a.max !== 1 || !same(a.who, { ref: 'iterating' }) || !same(a.perPlayer, { ref: 'each', who: 'player' })) return null;
  const from = a.from;
  if (from.ref !== 'each' || !('filter' in from)) return null;
  const ff = from.filter as ObjectFilter;
  if (!keys(ff, ['anyOf', 'controller']) || !same(ff.controller, { ref: 'iterating' }) || ff.anyOf === undefined || ff.anyOf.length !== 1) return null;
  const kind = String(b.kind);
  if (!keys(b, ['op', 'on', 'kind', 'count']) || b.count !== 1 || !same(b.on, boundRef(a.as))) return null;
  if (!keys(c, ['op', 'who', 'filter', 'count', 'mode']) || c.count !== 1 || c.mode !== 'all' || !same(c.who, { ref: 'each', who: 'player' })) return null;
  if (!same(c.filter, { anyOf: ff.anyOf, not: { is: boundRef(a.as) } })) return null;
  if (!keys(d, ['op', 'over', 'as', 'do']) || !same(d.over, boundRef(a.as)) || d.do.length !== 1) return null;
  const e = d.do[0]!;
  if (e.op !== 'effect' || !keys(e, ['op', 'duration', 'effects']) || e.effects.length !== 2) return null;
  const dur = e.duration;
  if (dur.d !== 'whileObject' || dur.as !== 'counter' || !same(dur.object, boundRef(d.as)) || typeof dur.counter !== 'string') return null;
  const [r1, r2] = e.effects;
  if (!same(r1, { s: 'restrict', subject: boundRef(d.as), mode: 'cant', action: 'attackPlayer', otherPlayer: { ref: 'you' } })) return null;
  if (!same(r2, { s: 'restrict', subject: boundRef(d.as), mode: 'cant', action: 'attack', other: { types: ['Planeswalker'], controller: 'you' } })) return null;
  const what = K.np(ff.anyOf[0]!, st, { det: 'a' });
  const text = `each player puts ${withArticle(kind)} counter on ${what} they control and sacrifices the rest. each of those creatures can't attack you or planeswalkers you control for as long as it has ${withArticle(dur.counter)} counter on it`;
  return { clauses: [plain(text, { standalone: true })], consumed: 4 };
}
