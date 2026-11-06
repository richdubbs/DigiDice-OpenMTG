/**
 * edh-d-87 (Commander coordinator D, band 5,001-10,000, group combat): the folds of its templates (parser/templates/zz-cloud/edh-d-87.json), called from render/fold.ts#foldAtPlain.
 *
 * `searchedCreatureNotNamed` (CR 701.23a, 201.2, 201.4, 608.2c; Sphinx Ambassador; eff.edhd87.ifSearched.creatureNotNamed.mayPutBattlefieldUnderYou): "If you searched for a creature card that doesn't
 * have that name, you may put it onto the battlefield under your control.": the one card an earlier search of the ability found, when it is a creature card without the name an earlier
 * "chooses a card name" chose, may be put onto the battlefield under your control. Only that `if` with that one `may` of that one move.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function searchedCreatureNotNamed(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'if' || s.guard !== undefined || s.else !== undefined || s.then.length !== 1) return null;
  const c = s.cond as { cond?: string; object?: { ref?: string; name?: string }; filter?: unknown };
  if (c.cond !== 'matches' || c.object?.ref !== 'bound' || typeof c.object.name !== 'string') return null;
  if (!same(c.filter, { types: ['Creature'], isCard: true, not: { chosen: { link: 'chosenCardName', quality: 'cardName' } } })) return null;
  const searched = list.slice(0, i).find((x) => x.op === 'search' && x.as === c.object!.name);
  const named = list.slice(0, i).some((x) => x.op === 'chooseValue' && x.what === 'cardName' && x.link === 'chosenCardName');
  if (searched?.op !== 'search' || searched.max !== 1 || !named) return null;
  const m = s.then[0]!;
  if (m.op !== 'may' || m.who.ref !== 'you' || m.do.length !== 1 || m.as !== undefined || m.guard !== undefined) return null;
  const mv = m.do[0]!;
  if (mv.op !== 'move' || !same(mv.what, c.object) || !same(mv.to, { zone: 'battlefield', controller: { ref: 'you' } }) || mv.guard !== undefined || mv.as !== undefined) return null;
  void st;
  return { clauses: [plain("if you searched for a creature card that doesn't have that name, you may put it onto the battlefield under your control", { standalone: true })], consumed: 1 };
}

export function foldEdhD87(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return searchedCreatureNotNamed(list, i, st);
}
