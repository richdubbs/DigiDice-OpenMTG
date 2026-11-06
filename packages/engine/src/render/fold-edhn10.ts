/**
 * edh-next-10 (Commander lane edh-next, EDHREC ranks 12,501-15,000, third pass): the folds of its templates (parser/templates/zz-cloud/edh-next-10.json), called from
 * render/fold.ts#foldAt.
 *
 * `pumpChoice` (CR 608.2d, 611.2c, 613.1e-f, 613.4c; Alchemist's Gift, Wild Mongrel): a pump and a quality chosen as the ability resolves, "Target creature gets +1/+1 and
 * gains your choice of deathtouch or lifelink until end of turn." and "This creature gets +1/+1 and becomes the color of your choice until end of turn.": a choice among
 * the listed keywords (or the five colors), then one `if` per answer whose effect gives the same fixed pump and that answer. The effect is fixed as it begins. Only those
 * exact shapes (the same affected object and duration in every branch, nothing after them reading the choice).
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { alt, joinList, signed } from './text';

const COLORS = ['W', 'U', 'B', 'R', 'G'];

function pumpChoice(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  if (c?.op !== 'chooseValue' || c.link === undefined || c.who.ref !== 'you' || c.guard !== undefined || (c.what !== 'color' && c.what !== 'option')) return null;
  if (c.min !== undefined || c.max !== undefined || c.exclude !== undefined || c.secret !== undefined || c.random !== undefined) return null;
  const answers: readonly string[] = c.what === 'color' ? COLORS : c.options ?? [];
  if (answers.length < 2 || (c.what === 'color' && c.options !== undefined)) return null;
  let first: Extract<EffectStep, { op: 'effect' }> | null = null;
  const keywords: string[] = [];
  for (let k = 0; k < answers.length; k++) {
    const b = list[i + 1 + k];
    if (b?.op !== 'if' || b.else !== undefined || b.guard !== undefined || b.as !== undefined || b.then.length !== 1) return null;
    if (b.cond.cond !== 'chosen' || b.cond.link !== c.link || b.cond.equals !== answers[k]) return null;
    const e = b.then[0]!;
    if (e.op !== 'effect' || e.effects.length !== 1 || e.guard !== undefined || e.as !== undefined || e.duration === undefined) return null;
    const ce = e.effects[0]!;
    if (ce.s !== 'continuous' || ce.cda !== undefined || ce.mods.length !== 2) return null;
    const [pump, quality] = ce.mods as [typeof ce.mods[number], typeof ce.mods[number]];
    if (pump.layer !== '7c' || typeof pump.power !== 'number' || typeof pump.toughness !== 'number' || Object.keys(pump).some((x) => !['layer', 'power', 'toughness'].includes(x))) return null;
    if (c.what === 'color') {
      if (JSON.stringify(quality) !== JSON.stringify({ layer: 5, colors: { set: [answers[k]] } })) return null;
    } else {
      if (quality.layer !== 6 || quality.add?.length !== 1 || quality.remove !== undefined || quality.removeAll !== undefined || quality.cantHave !== undefined) return null;
      const a = quality.add[0]!;
      if (a.kind !== 'keyword' || a.text !== answers[k] || a.quality !== undefined) return null;
      keywords.push(a.text);
    }
    if (first === null) first = e;
    else {
      const f = first.effects[0] as typeof ce;
      if (JSON.stringify(e.duration) !== JSON.stringify(first.duration) || JSON.stringify(ce.affects) !== JSON.stringify(f.affects) || JSON.stringify(pump) !== JSON.stringify(f.mods[0])) return null;
    }
  }
  if (JSON.stringify(list.slice(i + 1 + answers.length)).includes(`"${c.link}"`)) return null;
  const ce = first!.effects[0]!;
  if (ce.s !== 'continuous' || ce.affects.ref === 'each') return null;
  const pump = ce.mods[0]!;
  if (pump.layer !== '7c') return null;
  const subj = K.obj(ce.affects as ObjRef, st, 'subject');
  const dur = K.dur(first!.duration, st);
  if (!dur || subj.plural) return null;
  const what = c.what === 'color' ? 'becomes the color of your choice' : `gains your choice of ${joinList(keywords, 'or')}`;
  return { clauses: [plain(alt(`${subj.text} gets ${signed(pump.power as number)}/${signed(pump.toughness as number)} and ${what} ${dur}`, `${dur}, ${subj.text} gets ${signed(pump.power as number)}/${signed(pump.toughness as number)} and ${what}`))], consumed: 1 + answers.length };
}

export function foldEdhN10(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return pumpChoice(list, i, st);
}
