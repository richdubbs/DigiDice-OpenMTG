/**
 * Commander lane lands, round edh-d-37 (coordinator D): the folds of the steps its templates build (render/fold.ts#foldAt tries `foldEdhD37` after the other slices' own folds).
 * A fold applies only when every part is exactly what the idiom says. This file imports no value from render/fold.ts (an import cycle); it takes the types only.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * "Exile all artifacts, creatures, and lands from the battlefield, all cards from all graveyards, and all cards from all hands." (Decree of Annihilation; CR 406.2, 400.7, 608.2c):
 * every permanent of a description, every card in every graveyard and every card in every hand are exiled. Exactly those three move steps (eff.edhd37.exileAll.battlefieldGraveyardsHands).
 */
function exileAllBattlefieldGraveyardsHands(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b, c] = [list[i], list[i + 1], list[i + 2]];
  if (a?.op !== 'move' || b?.op !== 'move' || c?.op !== 'move' || [a, b, c].some((x) => x.guard !== undefined || x.as !== undefined)) return null;
  if (!same(a.to, { zone: 'exile' }) || !same(b.to, { zone: 'exile' }) || !same(c.to, { zone: 'exile' })) return null;
  if (!same(b.what, { ref: 'each', filter: { zone: 'graveyard', isCard: true } }) || !same(c.what, { ref: 'each', filter: { zone: 'hand', isCard: true } })) return null;
  if (a.what.ref !== 'each' || Object.keys(a).some((k) => !['op', 'what', 'to'].includes(k)) || Object.keys(b).some((k) => !['op', 'what', 'to'].includes(k)) || Object.keys(c).some((k) => !['op', 'what', 'to'].includes(k))) return null;
  const f = a.what.filter;
  const types = f.types;
  if (types === undefined || types.length < 2 || Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).join() !== 'types') return null;
  const nouns = types.map((t) => K.np({ types: [t] }, st, { det: 'none', plural: true }));
  const list3 = nouns.length === 2 ? `${nouns[0]} and ${nouns[1]}` : `${nouns.slice(0, -1).join(', ')}, and ${nouns[nouns.length - 1]}`;
  return { clauses: [plain(`exile all ${list3} from the battlefield, all cards from all graveyards, and all cards from all hands`, { standalone: true })], consumed: 3 };
}


const ctl = (n: string) => ({ ref: 'controllerOf', object: { ref: 'bound', name: n } });
/** The loop "its controller may search their library for a basic land card and put it onto the battlefield[ tapped]" over the lands of the group `name` (eff.edhd37.*). */
function landSearchLoop(name: string, as: string, tapped: boolean): unknown {
  return {
    op: 'forEach', over: { ref: 'each', filter: { is: { ref: 'bound', name }, types: ['Land'], zone: 'any' } }, as,
    do: [{ op: 'may', who: ctl(as), do: [
      { op: 'search', who: ctl(as), zone: 'library', filter: { supertypes: ['Basic'], types: ['Land'] }, max: 1, as: 'search' },
      { op: 'move', what: { ref: 'bound', name: 'search' }, to: { zone: 'battlefield', controller: ctl(as), ...(tapped ? { tapped: true } : {}) } },
    ] }],
  };
}

/**
 * "Each player sacrifices all artifacts, enchantments, and nonbasic lands they control. For each land sacrificed this way, its controller may search their library for a basic land card
 * and put it onto the battlefield tapped." (Wave of Vitriol; CR 701.21a, 608.2c, 608.2h, 701.23a): every player sacrifices all the permanents of the listed kinds they control, then
 * for each land among the sacrificed permanents its controller (as it last existed) may search for a basic land card and put it onto the battlefield tapped. Only that exact shape
 * (eff.edhd37.playerSacrificesAll.forEachLandSearchBasicTapped).
 */
function sacrificeAllThenLandSearch(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'sacrificeChoice' || b?.op !== 'forEach' || a.guard !== undefined || b.guard !== undefined || a.as !== 'sacrificedThisWay') return null;
  if (!same(a.who, { ref: 'each', who: 'player' }) || a.count !== 1 || a.mode !== 'all' || a.cantAs !== undefined || a.exploit !== undefined || a.chooser !== undefined) return null;
  if (!same(b, landSearchLoop('sacrificedThisWay', 'landSacrificed', true))) return null;
  const f = a.filter;
  if (!same(f.controller, { ref: 'iterating' })) return null;
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join();
  // the kinds said as an any-of of descriptions ("artifacts, enchantments, and nonbasic lands") or as a plain list of card types ("artifacts, enchantments, and lands")
  const kinds = keys === 'anyOf,controller' && f.anyOf !== undefined && f.anyOf.length >= 2 ? f.anyOf
    : keys === 'controller,types' && f.types !== undefined && f.types.length >= 2 ? f.types.map((t) => ({ types: [t] })) : null;
  if (kinds === null) return null;
  const nouns = kinds.map((k) => K.np(k, st, { det: 'none', plural: true }));
  const said = nouns.length === 2 ? `${nouns[0]} and ${nouns[1]}` : `${nouns.slice(0, -1).join(', ')}, and ${nouns[nouns.length - 1]}`;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes('sacrificedThisWay') || JSON.stringify(x).includes('landSacrificed'))) return null;
  return { clauses: [plain(`each player sacrifices all ${said} they control. for each land sacrificed this way, its controller may search their library for a basic land card and put it onto the battlefield tapped`, { standalone: true })], consumed: 2 };
}

/** The folds of edh-d-37 (render/fold.ts#foldAt). */
export function foldEdhD37(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return exileAllBattlefieldGraveyardsHands(list, i, st) ?? sacrificeAllThenLandSearch(list, i, st);
}
