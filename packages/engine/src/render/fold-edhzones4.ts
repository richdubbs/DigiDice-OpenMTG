/**
 * edh-zones-4 (Commander lane edh-zones): the folds of its templates (parser/templates/zz-cloud/edh-zones-4.json), called from render/fold.ts#foldAt.
 *
 * `playerSearchesThenTop` (CR 701.23a, 701.24a, 401.2; Varragoth, Bloodsky Sire): "Target player searches their library for a card, then shuffles and puts that card on top.":
 * another player's search of their own library for one card, their shuffle, then the found card on top of that library. Only that exact shape: a search for one card of
 * any description (nothing revealed), the shuffle by the same player, the move of the found card to the top of a library with no owner, order or duration.
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { acting } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { playerKey } from './state';
import { alt } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const isBound = (ref: ObjRef, name: string | undefined): boolean => name !== undefined && ref.ref === 'bound' && ref.name === name;

function playerSearchesThenTop(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, sh, m] = [list[i], list[i + 1], list[i + 2]];
  if (a?.op !== 'search' || sh?.op !== 'shuffle' || m?.op !== 'move' || a.who.ref === 'you' || a.who.ref === 'each') return null;
  if (!same(sh.who, a.who) || a.guard !== undefined || sh.guard !== undefined || m.guard !== undefined || sh.as !== undefined || m.as !== undefined) return null;
  if (a.as === undefined || a.max !== 1 || a.min !== undefined || a.zone !== 'library' || a.owner !== undefined || a.reveal !== undefined || a.differentNames !== undefined || a.and !== undefined
    || a.alsoZones !== undefined || Object.keys(a.filter).length !== 0) return null;
  if (m.what.ref !== 'bound' || m.what.name !== a.as || m.until !== undefined || m.link !== undefined || m.remember !== undefined || !same(m.to, { zone: 'library', position: 'top' })) return null;
  if (list.slice(i + 3).some((x) => JSON.stringify(x).includes(`"${a.as}"`))) return null;
  const key = playerKey(a.who) ?? 'x';
  // edh-zones-4 (Scheming Symmetry): two target players announced in a sentence of their own (render/program.ts#chosenFirst), "Each of them searches their library for a card,
  // then shuffles and puts that card on top." Several players are only said so, after that sentence
  const spec = a.who.ref === 'target' ? st.specs.get(a.who.id) : undefined;
  const group = spec !== undefined && spec.max !== 1;
  if (group) {
    if (st.chosen?.key !== key || spec.kind !== 'player') return null;
    return { clauses: [acting(key, '', 'each of them searches their library for 1 card, then shuffles and puts that card on top', { standalone: true })], consumed: 3 };
  }
  const ca = K.clause(a, st);
  const that = K.obj(m.what, st, 'object').text;
  const tail = (it: string): string => `then shuffle and put ${it} on top`;
  return { clauses: [acting(key, `${ca.imp}, ${tail(alt(that, 'it'))}`, `${ca.sub}, then shuffles and puts ${alt(that, 'it')} on top`, { standalone: true })], consumed: 3 };
}

/**
 * `playerPutsHandBottomDraws` (CR 401.4, 400.3, 121.1, 608.2c; Teferi's Puzzle Box): "That player puts the cards in their hand on the bottom of their library in any order, then
 * draws that many cards.": every card in a player's hand goes to the bottom of that player's library in an order they choose (as one move), then they draw as many cards as
 * were put there. Only that exact shape: one move with no guard, duration or link, the draw of that player with the count of that move and no name, and the name used by
 * nothing after.
 */
function playerPutsHandBottomDraws(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [m, d] = [list[i], list[i + 1]];
  if (m?.op !== 'move' || d?.op !== 'draw' || m.as === undefined || m.guard !== undefined || d.guard !== undefined || d.as !== undefined) return null;
  if (m.until !== undefined || m.link !== undefined || m.remember !== undefined || m.what.ref !== 'each') return null;
  const who = m.what.filter.owner;
  if (typeof who !== 'object' || Object.keys(m.what.filter).length !== 2 || m.what.filter.zone !== 'hand') return null;
  if (!same(m.to, { zone: 'library', position: 'bottom', order: 'chosen' }) || !same(d.who, who) || !same(d.count, { q: 'resultCount', step: m.as })) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"${m.as}"`))) return null;
  const key = playerKey(who) ?? 'x';
  const subj = K.player(who, st, 'subject');
  const imp = who.ref === 'you' ? 'put the cards in your hand on the bottom of your library in any order, then draw that many cards' : '';
  const them = who.ref === 'you' ? 'your' : 'their';
  const sub = `${subj.text} ${subj.person !== 'sg' ? 'put' : 'puts'} the cards in ${them} hand on the bottom of ${them} library in any order, then ${subj.person !== 'sg' ? 'draw' : 'draws'} that many cards`;
  return { clauses: [acting(key, imp === '' ? sub : imp, sub, { standalone: true })], consumed: 2 };
}

/**
 * `returnAnyDifferentNames` (CR 608.2d, 201.2, 400.7; Eerie Ultimatum): "Return any number of permanent cards with different names from your graveyard to the battlefield.":
 * your choice of any number of the cards of a description in your graveyard, no two with a name in common (`distinct: 'name'`), and the move of exactly those onto the
 * battlefield under your control. Only that exact shape, with nothing after it reading the choice.
 */
function returnAnyDifferentNames(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || a.as === undefined || a.distinct !== 'name' || a.who.ref !== 'you' || a.min !== 0 || a.max !== 'any' || a.random === true) return null;
  if (a.guard !== undefined || b.guard !== undefined || b.as !== undefined || b.until !== undefined || b.link !== undefined || b.remember !== undefined || !isBound(b.what, a.as)) return null;
  if (!same(b.to, { zone: 'battlefield', controller: { ref: 'you' } }) || a.from.ref !== 'each') return null;
  const { anyOf, zone, owner, isCard, ...others } = a.from.filter;
  if (anyOf?.length !== 1 || zone !== 'graveyard' || owner !== 'you' || isCard !== true || Object.values(others).some((v) => v !== undefined)) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`))) return null;
  const np = K.np({ ...anyOf[0]!, isCard: true, zone: 'graveyard' }, st, { det: 'none', plural: true, noZone: true, total: 'different names' });
  return { clauses: [acting('you', `return any number of ${np} from your graveyard to the battlefield`, `you return any number of ${np} from your graveyard to the battlefield`)], consumed: 2 };
}

export function foldEdhZones4(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return playerSearchesThenTop(list, i, st) ?? playerPutsHandBottomDraws(list, i, st) ?? returnAnyDifferentNames(list, i, st);
}
