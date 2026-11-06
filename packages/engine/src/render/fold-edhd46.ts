/**
 * Commander lane lands, second pass, round edh-d-46 (coordinator D): the folds of the steps its templates build (render/fold.ts#foldAt tries `foldEdhD46` after the other slices' own folds).
 * A fold applies only when every part is exactly what the idiom says. This file imports no value from render/fold.ts (an import cycle); it takes the types only.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { cloneState, type RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The land-count difference of a chosen player (the earlier "choose an opponent who controls more lands than you") over the controller, never below 0 (eff.edhd46.search.numberEqualToDifference.oneBfRestHand). */
export const LAND_DIFFERENCE_OF_CHOSEN = {
  q: 'math', op: 'max', args: [0, { q: 'math', op: '-', args: [
    { q: 'count', of: { ref: 'each', filter: { types: ['Land'], controller: { ref: 'bound', name: 'chosenPlayer' } } } },
    { q: 'count', of: { ref: 'each', filter: { types: ['Land'], controller: 'you' } } }] }],
};

/**
 * "Search your library for a number of Plains cards equal to the difference, reveal those cards, put one of them onto the battlefield tapped and the rest into your hand, then
 * shuffle." (Boreas Charger, after "choose an opponent who controls more lands than you"; CR 701.23a, 701.20a, 608.2c): the difference is the land count of the opponent the same ability chose less yours (read after "choose an opponent who
 * controls more lands than you"). Exactly those five steps.
 */
function searchDifferenceOneBattlefieldRestHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const ch = list[i];
  const [s, c, m1, m2, sh] = [list[i + 1], list[i + 2], list[i + 3], list[i + 4], list[i + 5]];
  if (ch?.op !== 'chooseValue' || ch.guard !== undefined || ch.as !== 'chosenPlayer' || ch.what !== 'opponent' || ch.who.ref !== 'you' || ch.controlsMore === undefined || !same(ch.controlsMore, { types: ['Land'] })) return null;
  if (s?.op !== 'search' || c?.op !== 'chooseObjects' || m1?.op !== 'move' || m2?.op !== 'move' || sh?.op !== 'shuffle') return null;
  if ([s, c, m1, m2, sh].some((x) => x.guard !== undefined)) return null;
  if (!same(s.max, LAND_DIFFERENCE_OF_CHOSEN) || s.min !== 0 || s.reveal !== true || s.who.ref !== 'you' || s.as !== 'search' || s.zone !== 'library') return null;
  if (c.as !== 'chosen' || m1.as !== undefined || m2.as !== undefined) return null;
  if (!same(m1.to, { zone: 'battlefield', controller: { ref: 'you' }, tapped: true }) || !same(m2.to, { zone: 'hand' })) return null;
  const f = s.filter as { subtypes?: string[] };
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined);
  const nouns = f.subtypes?.length === 1 && keys.join() === 'subtypes' ? f.subtypes[0]!.toLowerCase() : K.np({ ...(s.filter as object), isCard: undefined } as never, st, { det: 'none', plural: true });
  return { clauses: [plain(`choose an opponent who controls more lands than you. search your library for a number of ${nouns.replace(/ cards$/, '')} cards equal to the difference, reveal those cards, put one of them onto the battlefield tapped and the rest into your hand, then shuffle`, { standalone: true })], consumed: 6 };
}


const IT = { ref: 'iterating' };
const LAND = { types: ['Land'] };
/** "the difference" between the most lands any player controls and the iterating player's (eff.edhd46.eachPlayerFewerLands.searchUpToDifference.bfTapped). */
export const MOST_LANDS_DIFFERENCE = { q: 'math', op: '-', args: [{ q: 'mostByController', of: { ref: 'each', filter: LAND } }, { q: 'count', of: { ref: 'each', filter: { types: ['Land'], controller: IT } } }] };

/**
 * "Each player who controls fewer lands than the player who controls the most lands searches their library for a number of basic land cards less than or equal to the difference,
 * puts those cards onto the battlefield tapped, then shuffles." (Scholarship Sponsor; CR 109.4, 101.4, 608.2e, 701.23a): the players below the largest land count each search for
 * up to the difference. Exactly that loop (eff.edhd46.eachPlayerFewerLands.searchUpToDifference.bfTapped).
 */
function eachPlayerFewerLandsSearch(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  const f = list[i];
  if (f?.op !== 'forEach' || f.guard !== undefined || f.as !== 'fewerLands' || f.gather !== undefined) return null;
  const expected = {
    op: 'forEach', over: { ref: 'controlsMost', filter: LAND, below: true }, as: 'fewerLands',
    do: [
      { op: 'search', who: IT, zone: 'library', filter: { supertypes: ['Basic'], types: ['Land'] }, min: 0, max: MOST_LANDS_DIFFERENCE, as: 'search' },
      { op: 'move', what: { ref: 'bound', name: 'search' }, to: { zone: 'battlefield', controller: IT, tapped: true } },
      { op: 'shuffle', who: IT },
    ],
  };
  if (!same(f, expected)) return null;
  return { clauses: [plain('each player who controls fewer lands than the player who controls the most lands searches their library for a number of basic land cards less than or equal to the difference, puts those cards onto the battlefield tapped, then shuffles', { standalone: true })], consumed: 1 };
}

/**
 * "Search your library for a Plains card. If target opponent controls more lands than you, you may search your library for an additional Plains card. Reveal those cards, put them into your
 * hand, then shuffle." (Tithe; CR 701.23a, 608.2c, 109.4): the first find goes to the hand, a second one when the target player controls more lands than you, one shuffle. Exactly those four steps
 * (eff.edhd46.search.additional.ifOpponentMoreLands.toHand).
 */
function searchAdditionalIfMoreLands(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [s1, m1, c, sh] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  if (s1?.op !== 'search' || m1?.op !== 'move' || c?.op !== 'if' || sh?.op !== 'shuffle' || [s1, m1, c, sh].some((x) => x.guard !== undefined)) return null;
  if (!same(s1.who, { ref: 'you' }) || s1.zone !== 'library' || s1.max !== 1 || s1.min !== undefined || s1.reveal !== true || s1.as !== 'search' || !same(m1.what, { ref: 'bound', name: 'search' }) || !same(m1.to, { zone: 'hand' }) || m1.as !== undefined) return null;
  if (c.else !== undefined || c.intervening !== undefined || c.then.length !== 1 || c.then[0]!.op !== 'may') return null;
  const cond = c.cond;
  if (cond.cond !== 'compare' || cond.op !== '>' || !same(cond.right, { q: 'count', of: { ref: 'each', filter: { types: ['Land'], controller: 'you' } } })) return null;
  const left = cond.left;
  if (typeof left !== 'object' || left.q !== 'count' || left.of.ref !== 'each' || !same(Object.keys(left.of.filter).sort(), ['controller', 'types']) || !same(left.of.filter.types, ['Land'])) return null;
  const who = left.of.filter.controller;
  if (typeof who !== 'object' || who.ref !== 'target') return null;
  const may = c.then[0] as Extract<EffectStep, { op: 'may' }>;
  if (!same(may.who, { ref: 'you' }) || may.do.length !== 2 || may.guard !== undefined) return null;
  const [s2, m2] = [may.do[0]!, may.do[1]!];
  if (s2.op !== 'search' || m2.op !== 'move' || !same(s2.who, { ref: 'you' }) || s2.zone !== 'library' || s2.max !== 1 || s2.reveal !== true || s2.as !== 'searchExtra' || !same(s2.filter, s1.filter)) return null;
  if (!same(m2.what, { ref: 'bound', name: 'searchExtra' }) || !same(m2.to, { zone: 'hand' }) || !same(sh.who, { ref: 'you' })) return null;
  const card = `${K.np(s1.filter, st, { det: 'a' })} card`;
  const target = K.player(who, st, 'subject').text;
  return { clauses: [plain(`search your library for ${card}. if ${target} controls more lands than you, you may search your library for an additional ${card.replace(/^an? /, '')}. reveal those cards, put them into your hand, then shuffle`, { standalone: true })], consumed: 4 };
}

const COLOR_WORD: Readonly<Record<string, string>> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
const NUM_WORD: Readonly<Record<number, string>> = { 1: 'one', 2: 'two', 3: 'three', 4: 'four' };

/**
 * "Search your library for up to two Forest cards, put them onto the battlefield tapped, then shuffle. If this spell was kicked, untap all Forests put onto the battlefield this way. They
 * become 3/3 green creatures with haste that are still lands." (Hunting Wilds; CR 702.33a, 701.26b, 613.1d, 613.4b): the search that puts the lands onto the battlefield tapped, then the
 * kicked rider on exactly those lands (eff.edhd46.ifKicked.untapAllPutThisWay.become.creatures). Only one ability (haste) and one color is said.
 */
function searchThenKickedLandsBecomeCreatures(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [s, m, sh, c] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  if (s?.op !== 'search' || m?.op !== 'move' || sh?.op !== 'shuffle' || c?.op !== 'if' || [s, m, sh, c].some((x) => x.guard !== undefined)) return null;
  if (!same(s.who, { ref: 'you' }) || s.zone !== 'library' || s.min !== 0 || typeof s.max !== 'number' || !NUM_WORD[s.max] || s.reveal !== undefined || s.as !== 'search' || !same(m.what, { ref: 'bound', name: 'search' })) return null;
  if (!same(m.to, { zone: 'battlefield', controller: { ref: 'you' }, tapped: true }) || m.as !== undefined || !same(sh.who, { ref: 'you' })) return null;
  if (!same(c.cond, { cond: 'wasCast', kicked: true }) || c.else !== undefined || c.intervening !== undefined || c.then.length !== 2) return null;
  const [u, e] = [c.then[0]!, c.then[1]!];
  if (u.op !== 'untap' || !same(u.what, { ref: 'bound', name: 'search' }) || e.op !== 'effect' || e.effects.length !== 1 || !same(e.duration, { d: 'permanent' }) || e.as !== undefined) return null;
  const f = e.effects[0]!;
  if (f.s !== 'continuous' || !same(f.affects, { ref: 'bound', name: 'search' }) || f.mods.length !== 4) return null;
  const [t4, c5, p7, a6] = f.mods as unknown as [Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>];
  const col = ((c5['colors'] as { set?: string[] } | undefined)?.set ?? [])[0];
  if (!same(t4, { layer: 4, types: { add: ['Creature'] } }) || col === undefined || COLOR_WORD[col] === undefined || !same(c5, { layer: 5, colors: { set: [col] } })) return null;
  if (p7['layer'] !== '7b' || typeof p7['power'] !== 'number' || typeof p7['toughness'] !== 'number' || !same(Object.keys(p7).sort(), ['layer', 'power', 'toughness'])) return null;
  const add = a6['add'] as { kind?: string; keyword?: string }[] | undefined;
  if (a6['layer'] !== 6 || !same(Object.keys(a6).sort(), ['add', 'layer']) || add === undefined || add.length !== 1 || add[0]!.kind !== 'keyword' || add[0]!.keyword !== 'haste') return null;
  if (s.filter.subtypes?.length !== 1 || Object.keys(s.filter).filter((k) => (s.filter as Record<string, unknown>)[k] !== undefined).join() !== 'subtypes') return null;
  const cards = `up to ${NUM_WORD[s.max]} ${s.filter.subtypes[0]!.toLowerCase()}`;
  const lands = K.np({ ...s.filter, zone: undefined } as never, cloneState(st), { det: 'none', plural: true });
  return { clauses: [plain(`search your library for ${cards} cards, put them onto the battlefield tapped, then shuffle. if ~ was kicked, untap all ${lands.replace(/ cards$/, '')} put onto the battlefield this way. they become ${p7['power']}/${p7['toughness']} ${COLOR_WORD[col]} creatures with haste that are still lands`, { standalone: true })], consumed: 4 };
}

const NONBASIC_LAND_TYPES = ['Cave', 'Desert', 'Gate', 'Lair', 'Locus', 'Mine', 'Planet', 'Power-Plant', 'Sphere', 'Tower', 'Town', "Urza's"];
/**
 * "Draw a card. Then discard a card unless that land had a nonbasic land type." (Wonderscape Sage; CR 205.3i, 608.2c, 608.2h): the land the cost returned, as it last existed, has a land type
 * other than the five basic ones (the list of CR 205.3i). Exactly that step (eff.edhd46.discard.unlessReturnedLandNonbasicType).
 */
function discardUnlessReturnedLandNonbasic(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  const c = list[i];
  if (c?.op !== 'if' || c.guard !== undefined || c.else !== undefined || c.intervening !== undefined || c.then.length !== 1) return null;
  if (!same(c.cond, { cond: 'not', of: { cond: 'matches', object: { ref: 'costReturned' }, filter: { subtypes: NONBASIC_LAND_TYPES } } })) return null;
  if (!same(c.then[0], { op: 'discard', who: { ref: 'you' }, count: 1 })) return null;
  return { clauses: [plain('discard a card unless that land had a nonbasic land type', { standalone: true, leadThen: true })], consumed: 1 };
}

/** The folds of edh-d-46 (render/fold.ts#foldAt). */
export function foldEdhD46(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return searchDifferenceOneBattlefieldRestHand(list, i, st) ?? eachPlayerFewerLandsSearch(list, i, st) ?? searchAdditionalIfMoreLands(list, i, st) ?? searchThenKickedLandsBecomeCreatures(list, i, st) ?? discardUnlessReturnedLandNonbasic(list, i, st);
}
