/**
 * edh-d-99 (Commander coordinator D, EDHREC ranks 5,001-10,000, group graveyard-exile-cast): the folds of its templates (parser/templates/zz-cloud/edh-d-99.json), called from
 * render/fold.ts#foldAt. Each applies only when every part is exactly what the idiom says.
 *
 * `searchExileRestChosenOnTop` (CR 701.23a, 701.23d, 401.4, 608.2c; Doomsday, eff.edhd99.search.libraryAndGraveyard.exactly.exileRest.chosenOnTop): "Search your library and graveyard for
 * N cards and exile the rest. Put the chosen cards on top of your library in any order.": a search of both zones for exactly N cards of any kind, every other card of those two zones
 * exiled, and the found cards put on top of the library in the order the player chooses.
 *
 * `poisonedExileLookPlay` (CR 122.1f, 406.3, 601.3, 609.4b; Ixhel, Scion of Atraxa, eff.edhd99.eachOpp.poisonAtLeast.exileTopFaceDown.lookPlay.anyColor): "each opponent who has N or more poison
 * counters exiles the top card of their library face down. You may look at and play those cards for as long as they remain exiled, and you may spend mana as though it were mana of any color
 * to cast those spells.": each opponent in turn, if they have at least N poison counters, exiles their top card face down; the group of those cards is looked at by you, and you may play them
 * (spending mana as though of any color) while each remains exiled.
 *
 * `racket` (CR 608.2c, 101.4, 119.4, 202.3; Protection Racket, eff.edhd99.repeat.eachOpp.revealTop.mayPayLifeMv.exileElseHand): "repeat the following process for each opponent in turn order. Reveal the
 * top card of your library. That player may pay life equal to that card's mana value. If they do, exile that card. Otherwise, put it into your hand.": for each opponent in turn, the top card of
 * your library is revealed, that opponent may pay life equal to its mana value, and the card is exiled if they paid, else put into your hand.
 *
 * `mayExileOneFromEachGraveyard` (CR 608.2c, 608.2d, 101.4, 406.1; King Narfi's Betrayal, eff.edhd99.mayExile.oneCard.fromEachGraveyard): "you may exile a creature or planeswalker card from each
 * graveyard": for each player in turn order you choose none or one card of the description in that player's graveyard, and every card chosen is exiled.
 *
 * `exileHandDifference` (CR 608.2c, 402.1, 406.1, 107.1; Isildur's Fateful Strike, eff.edhd99.ifHandMoreThan.exileTheDifference): "if its controller has more than four cards in hand, they exile
 * cards from their hand equal to the difference": that player, with more cards in hand than N, chooses and exiles as many cards from their hand as they have over N (down to N).
 */
import type { EffectStep, PlayerRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function searchExileRestChosenOnTop(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  const rest = list[i + 1];
  const top = list[i + 2];
  if (s?.op !== 'search' || rest?.op !== 'move' || top?.op !== 'move' || s.guard !== undefined || rest.guard !== undefined || top.guard !== undefined) return null;
  const { min, max, as, ...shape } = s;
  if (as === undefined || !same(min, max) || typeof max === 'string') return null;
  if (!same(shape, { op: 'search', who: { ref: 'you' }, zone: 'library', alsoZones: ['graveyard'], allZones: true, filter: {} })) return null;
  if (!same(rest, { op: 'move', what: { ref: 'each', filter: { zone: ['library', 'graveyard'], owner: 'you', not: { is: { ref: 'bound', name: as } } } }, to: { zone: 'exile' } })) return null;
  if (!same(top, { op: 'move', what: { ref: 'bound', name: as }, to: { zone: 'library', position: 'top', order: 'chosen' } })) return null;
  const n = K.qty(max as Parameters<typeof K.qty>[0], st);
  return { clauses: [plain(`search your library and graveyard for ${n} cards and exile the rest. put the chosen cards on top of your library in any order`, { standalone: true })], consumed: 3 };
}

function poisonedExileLookPlay(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const f = list[i];
  const look = list[i + 1];
  const perm = list[i + 2];
  if (f?.op !== 'forEach' || look?.op !== 'look' || perm?.op !== 'effect' || f.guard !== undefined || look.guard !== undefined || perm.guard !== undefined || f.gather === undefined || f.do.length !== 1) return null;
  const g = f.gather;
  const c = f.do[0]!;
  if (c.op !== 'if' || c.else !== undefined || c.cond.cond !== 'compare' || c.then.length !== 1) return null;
  const n = c.cond.right;
  if (typeof n !== 'number') return null;
  const expected = {
    op: 'forEach', over: { ref: 'each', who: 'opponent' }, as: f.as, gather: g, do: [{ op: 'if', cond: { cond: 'compare', left: { q: 'counters', on: { ref: 'bound', name: f.as }, kind: 'poison' }, op: '>=', right: n },
      then: [{ op: 'move', what: { ref: 'topCards', player: { ref: 'bound', name: f.as }, count: 1 }, to: { zone: 'exile', faceDown: true }, as: g }] }],
  };
  if (!same(f, expected)) return null;
  if (!same(look, { op: 'look', who: { ref: 'you' }, at: { ref: 'bound', name: g } })) return null;
  if (!same(perm, { op: 'effect', duration: { d: 'remainsExiled' }, effects: [{ s: 'permit', who: { ref: 'you' }, action: 'play', of: { is: { ref: 'bound', name: g } }, anyManaColor: true }] })) return null;
  void st;
  return { clauses: [plain(`each opponent who has ${n} or more poison counters exiles the top card of their library face down. you may look at and play those cards for as long as they remain exiled, and you may spend mana as though it were mana of any color to cast those spells`, { standalone: true })], consumed: 3 };
}

function racket(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const f = list[i];
  if (f?.op !== 'forEach' || f.guard !== undefined || f.gather !== undefined || f.inDirection !== undefined || f.do.length !== 2) return null;
  const r = f.do[0]!;
  if (r.op !== 'reveal' || r.as === undefined) return null;
  const rev = { ref: 'bound', name: r.as };
  const expected = {
    op: 'forEach', over: { ref: 'each', who: 'opponent' }, as: f.as, do: [
      { op: 'reveal', who: { ref: 'you' }, what: { ref: 'topCards', player: { ref: 'you' }, count: 1 }, as: r.as },
      { op: 'pay', who: { ref: 'bound', name: f.as }, cost: { other: [{ kind: 'payLife', amount: { q: 'stat', stat: 'manaValue', of: rev } }] }, then: [{ op: 'move', what: rev, to: { zone: 'exile' } }], else: [{ op: 'move', what: rev, to: { zone: 'hand' } }] },
    ],
  };
  if (!same(f, expected)) return null;
  void st;
  return { clauses: [plain("repeat the following process for each opponent in turn order. reveal the top card of your library. that player may pay life equal to that card's mana value. if they do, exile that card. otherwise, put it into your hand", { standalone: true })], consumed: 1 };
}

function mayExileOneFromEachGraveyard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  const m = list[i + 1];
  if (c?.op !== 'chooseObjects' || m?.op !== 'move' || c.guard !== undefined || m.guard !== undefined || c.as === undefined || m.as !== undefined) return null;
  const { from, ...rest } = c;
  if (!same(rest, { op: 'chooseObjects', who: { ref: 'you' }, min: 0, max: 1, perPlayer: { ref: 'each', who: 'player' }, as: c.as })) return null;
  if (from.ref !== 'each' || !('filter' in from)) return null;
  const f = from.filter as { anyOf?: Record<string, unknown>[] } & Record<string, unknown>;
  if (f.anyOf?.length !== 1 || !same({ ...f, anyOf: undefined }, { anyOf: undefined, zone: 'graveyard', isCard: true, owner: { ref: 'iterating' } })) return null;
  const kind = f.anyOf[0]!;
  if (Object.keys(kind).length !== 1 || kind.types === undefined) return null;
  const { link, ...move } = m;
  if (link !== undefined && link !== 'exiled') return null;
  if (!same(move, { op: 'move', what: { ref: 'bound', name: c.as }, to: { zone: 'exile' } })) return null;
  const noun = K.np(kind as never, st, { det: 'a' });
  return { clauses: [plain(`you may exile ${noun} card from each graveyard`)], consumed: 2 };
}

function exileHandDifference(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'if' || s.guard !== undefined || s.else !== undefined || s.cond.cond !== 'compare' || s.then.length !== 2) return null;
  const n = s.cond.right;
  const left = s.cond.left as { q?: string; of?: unknown };
  if (typeof n !== 'number' || s.cond.op !== '>' || left.q !== 'zoneSize' || left.of === undefined) return null;
  const p = left.of as PlayerRef;
  const hand = { q: 'zoneSize', zone: 'hand', of: p };
  const diff = { q: 'math', op: '-', args: [hand, n] };
  if (!same(s.cond.left, hand)) return null;
  const [c, m] = s.then as [EffectStep, EffectStep];
  if (c.op !== 'chooseObjects' || c.as === undefined) return null;
  if (!same(c, { op: 'chooseObjects', who: p, from: { ref: 'each', filter: { zone: 'hand', owner: p } }, min: diff, max: diff, as: c.as })) return null;
  if (!same(m, { op: 'move', what: { ref: 'bound', name: c.as }, to: { zone: 'exile' } })) return null;
  const who = K.player(p, st, 'subject');
  if (who.person !== 'sg') return null;
  return { clauses: [plain(`if ${who.text} has more than ${n} cards in hand, they exile cards from their hand equal to the difference`, { standalone: true })], consumed: 1 };
}

export function foldEdhD99(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return searchExileRestChosenOnTop(list, i, st) ?? poisonedExileLookPlay(list, i, st) ?? racket(list, i, st) ?? mayExileOneFromEachGraveyard(list, i, st) ?? exileHandDifference(list, i, st);
}
