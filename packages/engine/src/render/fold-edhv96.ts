/**
 * edh-c-96 (Commander lane edh-c, ranks 27,001-27,500, third pass): the folds of its templates (parser/templates/zz-cloud/edh-c-96.json), called from render/fold.ts#foldAt. Each
 * applies only when every part is exactly what the idiom says.
 *
 * `losesChoice` (CR 608.2d, 611.2c, 613.1f, 702.1; Walking Sponge, eff.edhv96.losesYourChoiceOfThree): "Target creature loses your choice of flying, first strike, or trample
 * until end of turn.": a choice among the listed keywords as the ability resolves, then one `if` per answer whose effect removes that keyword for the same object and
 * duration. The effect is fixed as it begins. Only that shape (nothing after it reading the choice).
 *
 * `losesAllThenDamage` (CR 122.1, 120.3, 608.2c, 608.2h; Leeches): "Target player loses all poison counters. ~ deals that much damage to that player.": the removal of every counter
 * of one kind from a target player and damage from the source to that same player equal to the counters removed. Exactly those two steps.
 */
import type { EffectStep, ObjRef, PlayerRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { joinList } from './text';

function losesChoice(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  if (c?.op !== 'chooseValue' || c.link === undefined || c.who.ref !== 'you' || c.guard !== undefined || c.what !== 'option') return null;
  if (c.min !== undefined || c.max !== undefined || c.exclude !== undefined || c.secret !== undefined || c.random !== undefined) return null;
  const answers = c.options ?? [];
  if (answers.length < 2) return null;
  let first: Extract<EffectStep, { op: 'effect' }> | null = null;
  for (let k = 0; k < answers.length; k++) {
    const b = list[i + 1 + k];
    if (b?.op !== 'if' || b.else !== undefined || b.guard !== undefined || b.as !== undefined || b.then.length !== 1) return null;
    if (b.cond.cond !== 'chosen' || b.cond.link !== c.link || b.cond.equals !== answers[k]) return null;
    const e = b.then[0]!;
    if (e.op !== 'effect' || e.effects.length !== 1 || e.guard !== undefined || e.as !== undefined || e.duration === undefined) return null;
    const ce = e.effects[0]!;
    if (ce.s !== 'continuous' || ce.cda !== undefined || ce.mods.length !== 1) return null;
    const m = ce.mods[0]!;
    if (m.layer !== 6 || m.remove?.length !== 1 || m.remove[0] !== answers[k] || m.add !== undefined || m.removeAll !== undefined || m.cantHave !== undefined) return null;
    if (first === null) first = e;
    else if (JSON.stringify(e.duration) !== JSON.stringify(first.duration) || JSON.stringify(ce.affects) !== JSON.stringify((first.effects[0] as typeof ce).affects)) return null;
  }
  if (JSON.stringify(list.slice(i + 1 + answers.length)).includes(`"${c.link}"`)) return null;
  const ce = first!.effects[0]!;
  if (ce.s !== 'continuous' || ce.affects.ref === 'each') return null;
  const subj = K.obj(ce.affects as ObjRef, st, 'subject');
  const dur = K.dur(first!.duration, st);
  if (!dur || subj.plural) return null;
  return { clauses: [plain(`${subj.text} loses your choice of ${joinList([...answers], 'or')} ${dur}`)], consumed: 1 + answers.length };
}

function losesAllThenDamage(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [r, d] = [list[i], list[i + 1]];
  if (r?.op !== 'removeCounters' || d?.op !== 'damage' || r.as === undefined || r.kind === 'any' || r.count !== 'all' || r.upTo !== undefined || r.kindOfChoice !== undefined || r.guard !== undefined) return null;
  if (d.guard !== undefined || d.as !== undefined || d.divided !== undefined || d.also !== undefined || d.unpreventable === true || d.perSource === true || d.excessToController === true) return null;
  if (r.from.ref !== 'target' || JSON.stringify(d.to) !== JSON.stringify(r.from) || d.source.ref !== 'self') return null;
  const q = d.amount;
  if (typeof q !== 'object' || q.q !== 'countersRemoved' || q.step !== r.as || q.kind !== undefined) return null;
  if (JSON.stringify(list.slice(i + 2)).includes(`"${r.as}"`)) return null;
  const who = K.player(r.from as PlayerRef, st, 'subject');
  const src = K.obj(d.source, st, 'subject');
  return { clauses: [plain(`${who.text} loses all ${r.kind} counters`, { standalone: true }), plain(`${src.text} deals that much damage to that player`, { standalone: true })], consumed: 2 };
}

export function foldEdhV96(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return losesChoice(list, i, st) ?? losesAllThenDamage(list, i, st);
}
