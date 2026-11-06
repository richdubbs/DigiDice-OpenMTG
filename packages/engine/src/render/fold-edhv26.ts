/**
 * edh-c-26 (Commander lane edh-c, EDHREC ranks 21,001-21,500): the folds of its templates (parser/templates/zz-cloud/edh-c-26.json), called from
 * render/fold.ts#foldAt.
 *
 * `chooseCreatureTypeThenDestroyAll` (CR 205.3m, 608.2c, 701.8a; Extinction, eff.edhv26.destroy.all.typeOfYourChoice): the choice of a creature type and the
 * destruction of every creature of that type, said in one sentence, "Destroy all creatures of the creature type of your choice." Both readings are the two steps
 * (the choice first, family choose-type-destroy-all): "Choose a creature type. Destroy all creatures of the chosen type." Only that exact shape.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { alt } from './text';

function chooseCreatureTypeThenDestroyAll(list: EffectStep[], i: number): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseValue' || b?.op !== 'destroy') return null;
  if (a.guard !== undefined || b.guard !== undefined || a.what !== 'creatureType' || JSON.stringify(a.who) !== '{"ref":"you"}' || a.link !== 'chosenCreatureType' || a.as !== 'chosenCreatureType') return null;
  if (JSON.stringify(b.what) !== '{"ref":"each","filter":{"types":["Creature"],"chosen":{"link":"chosenCreatureType","quality":"creatureType"}}}') return null;
  if (Object.keys(b).some((k) => !['op', 'what'].includes(k))) return null;
  const text = alt('choose a creature type. destroy all creatures of the chosen type', 'destroy all creatures of the creature type of your choice');
  return { clauses: [plain(text, { standalone: true })], consumed: 2 };
}

export function foldEdhV26(list: EffectStep[], i: number): Folded | null {
  return chooseCreatureTypeThenDestroyAll(list, i);
}
