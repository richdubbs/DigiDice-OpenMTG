/**
 * edh-next-7 (Commander lane edh-next, EDHREC ranks 5,001-6,500, third pass): the folds of its templates (parser/templates/zz-cloud/edh-next-7.json), called from
 * render/fold.ts#foldAt.
 *
 * `chooseColorThenReturnAll` (CR 105.4, 608.2c, 400.3; Wash Out, eff.edhn7.return.all.colorOfYourChoice): the choice of a color and the return of every permanent of
 * that color to its owner's hand, said in one sentence, "Return all permanents of the color of your choice to their owners' hands." Both readings are the two steps
 * (the choice first, family choose-color-in-the-group): "Choose a color. Return all permanents of the chosen color to their owners' hands." Only that exact shape.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { alt } from './text';

function chooseColorThenReturnAll(list: EffectStep[], i: number): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseValue' || b?.op !== 'move') return null;
  if (a.guard !== undefined || b.guard !== undefined || a.what !== 'color' || JSON.stringify(a.who) !== '{"ref":"you"}' || a.link !== 'color' || typeof a.as !== 'string') return null;
  if (JSON.stringify(b.what) !== '{"ref":"each","filter":{"chosen":{"link":"color","quality":"color"}}}' || JSON.stringify(b.to) !== '{"zone":"hand"}') return null;
  if (Object.keys(b).some((k) => !['op', 'what', 'to'].includes(k))) return null;
  const text = alt("choose a color. return all permanents of the chosen color to their owners' hands", "return all permanents of the color of your choice to their owners' hands");
  return { clauses: [plain(text, { standalone: true })], consumed: 2 };
}

export function foldEdhN7(list: EffectStep[], i: number): Folded | null {
  return chooseColorThenReturnAll(list, i);
}
