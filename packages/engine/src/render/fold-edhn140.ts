/**
 * edh-next-140 (must-finish round, group "mana-costs"): the folds of its templates (parser/templates/zz-cloud/edh-next-140.json), called from render/fold.ts#foldAt.
 *
 * `colorOrColorsOfChoice` (CR 105.1, 105.3, 608.2d, 611.2c, 613.1e; Scuttlemutt, eff.edhn140.becomes.colorOrColorsOfChoice.dur): "Target creature becomes the color or colors of your choice
 * until end of turn.": you choose one or more colors as it resolves (`chooseValue` of `color` with `min` 1 and `max` 5, a link), then the object's colors are set to the chosen ones for the
 * duration (layer 5, `colors.chosen`: effects/handlers/lasting-fix.ts#fixChosen stores every chosen color). Only that exact pair, the link read by nothing after.
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

function colorOrColorsOfChoice(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [c, e] = [list[i], list[i + 1]];
  if (c?.op !== 'chooseValue' || e?.op !== 'effect' || c.what !== 'color' || c.min !== 1 || c.max !== 5 || c.link === undefined || c.who.ref !== 'you' || Object.keys(c.who).length !== 1) return null;
  if (c.guard !== undefined || e.guard !== undefined || e.as !== undefined || c.options !== undefined || c.exclude !== undefined || c.random !== undefined || c.secret !== undefined) return null;
  if (e.effects.length !== 1) return null;
  const x = e.effects[0]!;
  if (x.s !== 'continuous' || x.mods.length !== 1 || x.cda === true) return null;
  const m = x.mods[0]!;
  if (m.layer !== 5 || m.colors.chosen !== c.link || Object.keys(m.colors).length !== 1) return null;
  if (list.slice(i + 2).some((s) => JSON.stringify(s).includes(`"${c.link}"`) || JSON.stringify(s).includes(`"name":"${c.as}"`))) return null;
  if (x.affects.ref === 'each' || x.affects.ref === 'fixed' || !('id' in x.affects || x.affects.ref === 'self' || x.affects.ref === 'bound')) return null;
  const who = K.obj(x.affects as ObjRef, st, 'subject');
  if (who.plural) return null;
  return { clauses: [plain(`${who.text} becomes the color or colors of your choice ${K.dur(e.duration, st)}`)], consumed: 2 };
}

export function foldEdhN140(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return colorOrColorsOfChoice(list, i, st);
}
