/**
 * edh-d-28 (Commander coordinator D, lane random, second pass): the folds of its templates (parser/templates/zz-cloud/edh-d-28.json), called from render/fold.ts#foldAt.
 *
 * `destroyOneOfThemAtRandom` (CR 608.2d, 701.8a, 700.2; Chaos Defiler): "Destroy one of them chosen at random." The game picks one object of a group an earlier instruction chose
 * (no player chooses), then it is destroyed. The pick leaves out the chosen objects with indestructible (Chaos Defiler ruling 2022-10-07: one without indestructible is picked when there is one;
 * an indestructible permanent picked when all of them are destroys nothing, so an empty pick is the same). Exactly the two steps of template eff.edhd28.destroy.oneOfThem.atRandom.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { bind } from './steps-util';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function destroyOneOfThemAtRandom(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || a.random !== true || a.guard !== undefined || a.groupLimit !== undefined || a.perPlayer !== undefined || a.startingWith !== undefined || a.eachCardType !== undefined
    || a.link !== undefined || a.distinct !== undefined || a.damageSource !== undefined || a.as === undefined || a.min !== 1 || a.max !== 1 || a.who.ref !== 'you' || a.from.ref !== 'each' || !('filter' in a.from) || a.from.filter.is?.ref !== 'bound' || a.from.filter.notKeyword !== 'indestructible' || Object.keys(a.from.filter).length !== 2) return null;
  if (b?.op !== 'destroy' || b.guard !== undefined || b.as !== undefined || !same(b.what, { ref: 'bound', name: a.as })) return null;
  const them = K.obj(a.from.filter.is, st, 'object');
  if (!them.plural) return null;
  bind(st, a.as, { nouns: ['permanent'], plural: false }); // (the destroyed object is named by no later sentence of the card; "it" would be ambiguous: fail closed)
  return { clauses: [plain(`destroy one of ${them.text} chosen at random`, { standalone: true })], consumed: 2 };
}

/**
 * `returnTwoOfThemAtRandom` (CR 608.2d, 400.7, 115.1; Sinister Waltz, eff.edhd28.return.twoOfThem.atRandom.otherBottom): "Return two of them at random to the battlefield and put the
 * other on the bottom of your library." after "Choose three target creature cards in your graveyard.": two of the targets chosen at random come back under your control, the target
 * still in the graveyard goes to the bottom of your library. Exactly the three steps of the template.
 */
function returnTwoOfThemAtRandom(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  const c = list[i + 2];
  if (a?.op !== 'chooseObjects' || a.random !== true || a.guard !== undefined || a.groupLimit !== undefined || a.perPlayer !== undefined || a.startingWith !== undefined || a.eachCardType !== undefined
    || a.link !== undefined || a.distinct !== undefined || a.damageSource !== undefined || a.as === undefined || a.min !== 2 || a.max !== 2 || a.who.ref !== 'you' || a.from.ref !== 'each' || !('filter' in a.from) || a.from.filter.is?.ref !== 'target' || a.from.filter.zone !== 'graveyard' || Object.keys(a.from.filter).length !== 2) return null;
  if (b?.op !== 'move' || b.guard !== undefined || b.as !== undefined || b.until !== undefined || b.link !== undefined || b.remember !== undefined || !same(b.what, { ref: 'bound', name: a.as })
    || !same(b.to, { zone: 'battlefield', controller: { ref: 'you' } })) return null;
  if (c?.op !== 'move' || c.guard !== undefined || c.as !== undefined || c.until !== undefined || c.link !== undefined || c.remember !== undefined || !same(c.to, { zone: 'library', position: 'bottom' })
    || !same(c.what, { ref: 'each', filter: { is: a.from.filter.is, not: { is: { ref: 'bound', name: a.as } }, zone: 'graveyard' } })) return null;
  const spec = st.specs.get(a.from.filter.is.id);
  if (spec?.kind !== 'object' || spec.min !== 3 || spec.max !== 3 || spec.filter?.zone !== 'graveyard' || spec.filter.isCard !== true) return null; // (cards in a graveyard: the template reads the graveyard) // two of exactly three targets: "the other" is the one left
  const them = K.obj(a.from.filter.is, st, 'object');
  if (!them.plural) return null;
  return { clauses: [plain(`return two of ${them.text} at random to the battlefield and put the other on the bottom of your library`, { standalone: true })], consumed: 3 };
}

/** The folds of edh-d-28 (render/fold.ts#foldAt). */
export function foldEdhD28(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return destroyOneOfThemAtRandom(list, i, st) ?? returnTwoOfThemAtRandom(list, i, st);
}
