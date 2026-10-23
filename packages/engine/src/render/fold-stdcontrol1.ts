/**
 * std-control-1 (lane std-control): the folds of its templates (parser/templates/zz-cloud/std-control-1.json), called from render/fold.ts#foldAt.
 *
 * `forEachColorCounterWinIfFive` (CR 105.1, 608.2c, 122.6, 104.2b): "for each color, put a +1/+1 counter on a Dragon you control of that color. If you put +1/+1
 * counters on five Dragons this way, you win the game." (Call the Spirit Dragons; the parser's eff.stdcontrol1.forEachColor.counter.winIfFive): for each of the five
 * colors in turn, your choice of one Dragon you control of that color and a +1/+1 counter on it (a multicolored Dragon may be chosen for more than one color), then
 * the win if five different Dragons got a counter this way. Only that exact shape: the five choices in the order white, blue, black, red, green, each with its
 * counter, and the condition on the union of the five puts.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import type { RenderState } from './state';

const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;

/** The steps eff.stdcontrol1.forEachColor.counter.winIfFive builds, for the subtype `subtype` and the names of its first step. */
function fiveColorSteps(subtype: string, chosen: (c: string) => string, put: (c: string) => string): EffectStep[] {
  const steps: EffectStep[] = [];
  for (const c of COLORS) {
    steps.push({ op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { subtypes: [subtype], controller: 'you', colors: [c] } }, min: 1, max: 1, as: chosen(c) });
    steps.push({ op: 'putCounters', on: { ref: 'bound', name: chosen(c) }, kind: '+1/+1', count: 1, as: put(c) });
  }
  steps.push({ op: 'if', cond: { cond: 'compare', left: { q: 'count', of: { ref: 'union', of: COLORS.map((c) => ({ ref: 'bound' as const, name: put(c) })) } }, op: '>=', right: 5 }, then: [{ op: 'winGame', who: { ref: 'you' } }] });
  return steps;
}

function forEachColorCounterWinIfFive(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || a.from.ref !== 'each' || !('filter' in a.from) || a.from.filter.subtypes?.length !== 1 || b?.op !== 'putCounters' || b.as === undefined) return null;
  const subtype = a.from.filter.subtypes[0]!;
  const stem = (name: string): string | null => (name.endsWith('W') ? name.slice(0, -1) : null);
  const cs = stem(a.as);
  const ps = stem(b.as);
  if (cs === null || ps === null) return null;
  const want = fiveColorSteps(subtype, (c) => `${cs}${c}`, (c) => `${ps}${c}`);
  if (JSON.stringify(list.slice(i, i + want.length)) !== JSON.stringify(want)) return null;
  const rest = JSON.stringify(list.slice(i + want.length));
  if (COLORS.some((c) => rest.includes(`"name":"${cs}${c}"`) || rest.includes(`"name":"${ps}${c}"`))) return null;
  const plural = `${subtype}s`;
  const text = `for each color, put a +1/+1 counter on a ${subtype} you control of that color. If you put +1/+1 counters on five ${plural} this way, you win the game`;
  return { clauses: [plain(text, { standalone: true })], consumed: want.length };
}

export function foldStdControl1(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return forEachColorCounterWinIfFive(list, i, st);
}
