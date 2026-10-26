/**
 * pc-exile-play-3: the fold of its template eff.pcep3.nextSpell.two.each.cascade (parser/templates/zz-cloud/pc-exile-play-3.json), called from render/fold.ts#foldAt.
 *
 * `nextTwoEachHave`: "the next instant spell and the next sorcery spell you cast this turn each have cascade." (CR 601.2a, 611.2c, 613.1f, 702.85a): two riders of
 * `nextSpell` for the same keyword, each with its own spell description (the first spell of each kind you cast this turn). Only that exact shape: two consecutive
 * keyword riders of you, with a filter each, giving the same keyword.
 */
import type { EffectStep } from '../types/ability';
import type { Folded } from './fold';
import { plain } from './clause';
import { K } from './kernel';
import { keywordWords } from './kw';
import type { RenderState } from './state';

type Next = Extract<EffectStep, { op: 'nextSpell' }>;
const ok = (s: EffectStep | undefined): s is Next =>
  s?.op === 'nextSpell' && s.guard === undefined && s.who.ref === 'you' && s.rider === 'keyword' && s.keyword !== undefined && s.filter !== undefined && s.as === undefined;

export function nextTwoEachHave(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (!ok(a) || !ok(b) || JSON.stringify(a.keyword) !== JSON.stringify(b.keyword)) return null;
  const spell = (s: Next): string => K.np(s.filter!, st, { det: 'none', noZone: true, noController: true });
  const text = `the next ${spell(a)} and the next ${spell(b)} you cast this turn each have ${keywordWords(a.keyword!, st)}`;
  return { clauses: [plain(text)], consumed: 2 };
}

export function foldPcEp3(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return nextTwoEachHave(list, i, st);
}
