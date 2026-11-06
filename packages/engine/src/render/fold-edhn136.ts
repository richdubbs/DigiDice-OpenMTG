/**
 * edh-next-136 (CR 406.1, 611.2c, 608.2c, 400.7; Chandra, Legacy of Fire; the parser's impulse idiom, parser/lower/anaphora.ts#impulseIdiom): "Exile that many cards from the top of your
 * library. You may play them this turn.": the move of a counted number (an earlier instruction's result) of your top cards into exile, named, then the permission to play exactly
 * those cards until end of turn. The permission's "them" is the cards just exiled, whatever group an earlier instruction named (the parser binds it so); the general renderer's
 * pronoun check would refuse "them" beside that group. Null for any other shape (the general renderers then say it or refuse).
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { cloneState, type RenderState } from './state';
import { alt } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function exileCountedTopThenPlayThem(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  const p = list[i + 1];
  if (m?.op !== 'move' || p?.op !== 'effect' || typeof m.as !== 'string' || m.guard !== undefined || m.until !== undefined || p.guard !== undefined) return null;
  if (Object.keys(m).some((k) => !['op', 'as', 'what', 'to', 'span'].includes(k)) || !same(m.to, { zone: 'exile' })) return null;
  const w = m.what;
  if (w.ref !== 'topCards' || !same(w.player, { ref: 'you' }) || typeof w.count !== 'object' || w.count.q !== 'resultCount' || Object.keys(w).some((k) => !['ref', 'player', 'count'].includes(k))) return null;
  if (!same(p.duration, { d: 'endOfTurn' }) || p.effects.length !== 1 || Object.keys(p).some((k) => !['op', 'duration', 'effects', 'span'].includes(k))) return null;
  if (!same(p.effects[0], { s: 'permit', who: { ref: 'you' }, action: 'play', of: { is: { ref: 'bound', name: m.as } } })) return null;
  const exile = K.clause(m, st).imp;
  const general = ((): string | null => { try { return K.steps([p], cloneState(st)); } catch { return null; } })();
  const play = general === null ? 'you may play them this turn' : alt(general, 'you may play them this turn');
  return { clauses: [plain(`${exile}. ${play}`, { standalone: true })], consumed: 2 };
}

/**
 * edh-next-136 (CR 608.2g, 601.2, 118.9, 305.9, 406.3; Ashiok, Nightmare Muse, rulings 2020-01-24): "You may cast up to three spells from among face-up cards your opponents own from exile
 * without paying their mana costs.": your choice of up to N nonland face-up cards in exile that opponents own (any of them, not only those this permanent exiled), then their free cast
 * during the resolution. Only that exact choice and cast.
 */
function castFaceUpOpponentsExiledFree(list: EffectStep[], i: number): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'cast' || typeof a.as !== 'string' || a.guard !== undefined || b.guard !== undefined || a.random === true || a.groupLimit !== undefined || a.perPlayer !== undefined) return null;
  if (!same(a.who, { ref: 'you' }) || a.min !== 0 || typeof a.max !== 'number' || a.max < 1) return null;
  if (!same(a.from, { ref: 'each', filter: { notTypes: ['Land'], zone: 'exile', owner: 'opponent', faceDown: false, isCard: true } })) return null;
  if (!same(b, { op: 'cast', who: { ref: 'you' }, what: { ref: 'bound', name: a.as }, free: true })) return null;
  const n = a.max === 1 ? 'one' : a.max === 2 ? 'two' : a.max === 3 ? 'three' : String(a.max);
  return { clauses: [plain(`you may cast up to ${n} spells from among face-up cards your opponents own from exile without paying their mana costs`, { standalone: true, closesScope: true })], consumed: 2 };
}

/**
 * edh-next-136 (CR 115.1, 109.4, 701.9a, 701.21a, 608.2b; Nicol Bolas, Planeswalker; template eff.edhn136.playerOrController.discards.thenSacrifices): "That player or that planeswalker's controller
 * discards seven cards, then sacrifices seven permanents of their choice." after "target player or planeswalker": the discard and the sacrifice once for the target if it is a player and once for
 * the controller of the target if it is a planeswalker (exactly one of each pair has anybody to act), as edh-c-22's discard alone (render/fold-edhv22.ts). Only that exact shape.
 */
function playerOrControllerDiscardsThenSacrifices(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b, c, d] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  if (a?.op !== 'discard' || b?.op !== 'discard' || c?.op !== 'sacrificeChoice' || d?.op !== 'sacrificeChoice') return null;
  if (a.who.ref !== 'target') return null;
  const ctl = { ref: 'controllerOf', object: { ref: 'target', id: a.who.id } };
  if (!same(b.who, ctl) || !same(c.who, a.who) || !same(d.who, ctl)) return null;
  if (!same(Object.keys(a).sort(), ['count', 'op', 'who']) || !same(Object.keys(b).sort(), ['count', 'op', 'who']) || !same(a.count, b.count) || typeof a.count !== 'number' || a.count < 1) return null;
  if (!same(Object.keys(c).sort(), ['count', 'filter', 'op', 'who']) || !same(Object.keys(d).sort(), ['count', 'filter', 'op', 'who']) || !same(c.filter, {}) || !same(d.filter, {}) || !same(c.count, d.count) || typeof c.count !== 'number' || c.count < 1) return null;
  const who = K.player(a.who, st, 'subject').text;
  const whose = K.obj((b.who as { object: ObjRef }).object, st, 'possessive').text;
  const words = (n: number): string => (n === 1 ? 'one' : n === 2 ? 'two' : n === 3 ? 'three' : n === 4 ? 'four' : n === 5 ? 'five' : n === 6 ? 'six' : n === 7 ? 'seven' : String(n));
  const cards = a.count === 1 ? 'a card' : `${words(a.count)} cards`;
  const perms = c.count === 1 ? 'a permanent' : `${words(c.count)} permanents`;
  return { clauses: [plain(`${who} or ${whose} controller discards ${cards}, then sacrifices ${perms} of their choice`, { standalone: true })], consumed: 4 };
}

/**
 * edh-next-136 (CR 608.2f, 101.4, 701.23a, 608.2g, 118.9; Jace, Architect of Thought, rulings 2012-10-01; templates eff.edhn136.forEachPlayer.searchTheirLibrary.exile.shuffle and
 * eff.edhn136.mayCast.exiledEach.free): "For each player, search that player's library for a nonland card and exile it, then that player shuffles. You may cast those cards without
 * paying their mana costs.": one loop over every player (you search each library, yours too), the cards exiled gathered, then your free casts of any of them. Only that exact shape.
 */
const SEARCH_EACH = {
  op: 'forEach', over: { ref: 'each', who: 'player' }, as: 'each', gather: 'exiledEach', do: [
    { op: 'search', who: { ref: 'you' }, zone: 'library', owner: { ref: 'bound', name: 'each' }, filter: { notTypes: ['Land'] }, max: 1, as: 'search' },
    { op: 'move', what: { ref: 'bound', name: 'search' }, to: { zone: 'exile' }, as: 'exiledEach' },
    { op: 'shuffle', who: { ref: 'bound', name: 'each' } },
  ],
};
function searchEachPlayerThenCastFree(list: EffectStep[], i: number): Folded | null {
  const [a, b, c] = [list[i], list[i + 1], list[i + 2]];
  if (a?.op !== 'forEach' || b?.op !== 'chooseObjects' || c?.op !== 'cast') return null;
  const { span: _s, ...bare } = a as typeof a & { span?: string };
  const strip = (x: unknown): unknown => JSON.parse(JSON.stringify(x, (k, v) => (k === 'span' ? undefined : v)));
  if (!same(strip(bare), SEARCH_EACH)) return null;
  if (!same(strip(b), { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { notTypes: ['Land'], is: { ref: 'bound', name: 'exiledEach' }, zone: 'exile' } }, min: 0, max: 'any', as: b.as }) || typeof b.as !== 'string') return null;
  if (!same(strip(c), { op: 'cast', who: { ref: 'you' }, what: { ref: 'bound', name: b.as }, free: true })) return null;
  return { clauses: [plain("for each player, search that player's library for a nonland card and exile it, then that player shuffles. you may cast those cards without paying their mana costs", { standalone: true, closesScope: true })], consumed: 3 };
}

export function foldEdhN136(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return exileCountedTopThenPlayThem(list, i, st) ?? castFaceUpOpponentsExiledFree(list, i) ?? playerOrControllerDiscardsThenSacrifices(list, i, st) ?? searchEachPlayerThenCastFree(list, i);
}
