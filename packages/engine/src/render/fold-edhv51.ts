/**
 * edh-c-51 (coordinator C, EDHREC ranks 23,501-24,000): the folds of its templates (parser/templates/zz-cloud/edh-c-51.json), called from render/fold.ts#foldAt.
 *
 * `preventAllFromSourceOfChoice` (CR 609.7a, 615.1, 615.9; eff.edhv51.prevent.all.sourceOfChoice.dur; Burrenton Forge-Tender): "Prevent all damage a red source of your choice would
 * deal this turn.": the source is chosen as the ability resolves (`chooseObjects` with `damageSource`, among the objects of that color), then a prevention of all the damage that
 * source would deal, for the duration (no shield: not "the next time"). Only that shape.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { COLOR_WORD, withArticle } from './text';

/** render/fold.ts#SOURCE_CHOICE_ZONES (FAST5 T36, CR 609.7a), said again here: a value import of fold.ts would be an import cycle (design 5.4; coordinator A, 2026-10-31). */
const SOURCE_CHOICE_ZONES = ['battlefield', 'stack', 'command'];

function preventAllFromSourceOfChoice(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  const e = list[i + 1];
  if (c?.op !== 'chooseObjects' || c.who.ref !== 'you' || c.guard !== undefined || c.as === undefined || c.min !== 1 || c.max !== 1 || c.random === true || c.damageSource !== true) return null;
  if (c.perPlayer !== undefined || c.startingWith !== undefined || c.from.ref !== 'each' || !('filter' in c.from)) return null;
  const colors = c.from.filter.colors;
  const color = colors?.[0];
  if (colors !== undefined && (colors.length !== 1 || color === undefined || COLOR_WORD[color] === undefined)) return null;
  if (JSON.stringify(c.from.filter) !== JSON.stringify(color === undefined ? { zone: SOURCE_CHOICE_ZONES } : { zone: SOURCE_CHOICE_ZONES, colors: [color] })) return null;
  if (e?.op !== 'effect' || e.guard !== undefined || e.as !== undefined || e.effects.length !== 1 || e.duration.d === 'permanent') return null;
  const r = e.effects[0]!;
  if (r.s !== 'replace' || r.condition !== undefined || r.optional !== undefined || r.selfReplacement !== undefined || r.shield !== undefined || r.replaces.ev !== 'damage') return null;
  const source = { is: { ref: 'bound', name: c.as }, ...(color === undefined ? {} : { colors: [color] }) };
  if (JSON.stringify(r.replaces) !== JSON.stringify({ ev: 'damage', source }) || JSON.stringify(r.body) !== JSON.stringify({ b: 'prevent', amount: 'all' })) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":${JSON.stringify(c.as)}`))) return null;
  const dur = K.dur(e.duration, st);
  const which = color === undefined ? 'a' : withArticle(COLOR_WORD[color]!);
  return { clauses: [plain(`prevent all damage ${which} source of your choice would deal${dur ? ` ${dur}` : ''}`, { standalone: true })], consumed: 2 };
}

export function foldEdhV51(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return preventAllFromSourceOfChoice(list, i, st);
}
