/**
 * edh-players-21 (Commander lane edh-players): the folds of its templates (parser/templates/zz-cloud/edh-players-21.json), called from render/fold.ts#foldAt. Each applies only when
 * every part is exactly what the idiom says.
 *
 * `eachExilesOwnChoice` (CR 608.2d, 101.4, 406.1; Olórin's Searing Light, eff.edhp21.exile.ownPerPlayer.*): "Each opponent exiles a creature with the greatest power among creatures
 * that player controls.": every player of the group chooses one object of the description among those they control (`chooseObjects` with `perPlayer` and `who` `iterating`) and the
 * chosen objects are exiled. Exactly those two steps, the chosen objects named by nothing but the exile. edh-d-96: the exile may last for a duration ("until ~ leaves the battlefield").
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function eachExilesOwnChoice(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [c, m] = [list[i], list[i + 1]];
  if (c?.op !== 'chooseObjects' || m?.op !== 'move' || c.guard !== undefined || m.guard !== undefined || c.random !== undefined || c.groupLimit !== undefined || c.link !== undefined) return null;
  const per = c.perPlayer;
  if (per === undefined || per.ref !== 'each' || (per.who !== 'player' && per.who !== 'opponent') || !same(c.who, { ref: 'iterating' }) || c.min !== 1 || c.max !== 1 || c.from.ref !== 'each') return null;
  if (!same(m.what, { ref: 'bound', name: c.as }) || !same(m.to, { zone: 'exile' }) || m.as !== undefined || (m.link !== undefined && m.link !== 'exiled') /* trek-22 (CR 607.2a): the link a reader of "exiled with" gives the move says nothing in the sentence */ || m.remember !== undefined) return null;
  const nouns = K.nounsOf(c.from.filter);
  st.info.set(`b:${c.as}`, { nouns, plural: false, ownExile: true }); // read by render/qty.ts#statPhrase (`stat.by`)
  const what = K.np(c.from.filter, st, { det: 'a' });
  // edh-d-96 (CR 610.3, 610.3c; Intellect Devourer, eff.edhd96.exile.ownPerPlayer.opponent.until): with a duration, "... until ~ leaves the battlefield" (the cards return to the zone they came from)
  const until = m.until === undefined ? '' : ` ${K.dur(m.until, st)}`;
  return { clauses: [plain(`each ${per.who} exiles ${what}${until}`)], consumed: 2 };
}

export function foldEdhP21(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return eachExilesOwnChoice(list, i, st);
}
