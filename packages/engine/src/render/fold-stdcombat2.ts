/**
 * std-combat-2 (lane std-combat): the fold of its template eff.stdcombat2.sameFor (parser/lower/same-for.ts), called from render/fold.ts#foldAt.
 *
 * `sameForKeywords` (CR 608.2c, 122.1b; Super-Adaptoid): "If that creature has haste and ~ doesn't, put a haste counter on ~. Do the same for flying, first strike,
 * ... and vigilance." Two or more steps in a row that are one step said again with one keyword replaced (its keyword tests `filter.keyword` and its keyword
 * counters) read as the first step, then "do the same for" the other keywords in order (family do-the-same-for). The steps one by one stay a reading.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { cloneState, type RenderState } from './state';
import { alt, joinList } from './text';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every node of the value, depth first. */
function nodes(v: unknown, out: Rec[] = []): Rec[] {
  if (Array.isArray(v)) v.forEach((x) => nodes(x, out));
  else if (isRec(v)) { out.push(v); Object.values(v).forEach((x) => nodes(x, out)); }
  return out;
}

/** The one keyword the step names in its keyword tests and keyword counters, or null (none, two, or a list of keywords). */
function oneKeyword(step: EffectStep): string | null {
  const seen = new Set<string>();
  for (const n of nodes(step)) {
    if ('keyword' in n) { if (typeof n['keyword'] !== 'string') return null; seen.add(n['keyword']); }
    if ('notKeyword' in n) return null;
  }
  if (seen.size !== 1) return null;
  const kw = [...seen][0]!;
  return nodes(step).some((n) => n['op'] === 'putCounters' && typeof n['kind'] === 'string' && n['kind'] !== kw) ? null : kw;
}

/** The step's JSON with the keyword `from` (keyword tests and counters of that kind) made `to`. */
function swapped(step: EffectStep, from: string, to: string): string {
  const copy = JSON.parse(JSON.stringify(step)) as unknown;
  for (const n of nodes(copy)) {
    if (n['keyword'] === from) n['keyword'] = to;
    if (n['op'] === 'putCounters' && n['kind'] === from) n['kind'] = to;
  }
  return JSON.stringify(copy);
}

function sameForKeywords(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a === undefined) return null;
  const from = oneKeyword(a);
  if (from === null) return null;
  const others: string[] = [];
  for (let j = i + 1; j < list.length; j++) {
    const b = list[j]!;
    const to = oneKeyword(b);
    if (to === null || to === from || others.includes(to) || swapped(a, from, to) !== JSON.stringify(b)) break;
    others.push(to);
  }
  if (others.length === 0) return null;
  const apart = cloneState(st);
  const oneByOne = list.slice(i, i + 1 + others.length).map((s) => K.steps([s], apart)).join('. ');
  const first = K.steps([a], st);
  return { clauses: [plain(alt(`${first}. do the same for ${joinList(others, 'and')}`, oneByOne), { standalone: true })], consumed: 1 + others.length };
}

export function foldStdCombat2(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return sameForKeywords(list, i, st);
}
