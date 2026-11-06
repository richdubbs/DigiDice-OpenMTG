/**
 * edh-zones-24 (Commander lane edh-zones): the folds of its templates (parser/templates/zz-cloud/edh-zones-24.json), called from render/fold.ts#foldAt. Each applies only when
 * every part is exactly what the idiom says.
 *
 * `youAndPlayerEachRevealTop` (CR 701.20a, 401.2; Keen Duelist, eff.edhz24.youAndPlayer.eachRevealTop): "you and target opponent each reveal the top card of your library.": you
 * reveal the top card of your library and one other named player the top card of theirs, each card remembered under a name (`duelMine`, `duelTheirs`). Exactly those two steps.
 *
 * `eachLoseLifeOtherRevealed` (CR 119.3, 202.3; eff.edhz24.eachLoseLife.otherRevealed): "You each lose life equal to the mana value of the card revealed by the other player.":
 * you lose life equal to the mana value of the card the other player revealed, and that player loses life equal to the mana value of yours. Only right after the reveal fold.
 *
 * `eachPutRevealedIntoHand` (CR 400.3, 701.20a; eff.edhz24.eachPutRevealed.hand): "You each put the card you revealed into your hand.": both revealed cards go to their owners' hands.
 *
 * `shuffleEachIntoOwnersLibrary` (CR 701.24a, 400.3, 608.2c; Teferi, Temporal Pilgrim, eff.edhz24.shuffle.eachIntoOwnersLibrary): "Then they shuffle each nonland permanent they control into its
 * owner's library.": every permanent of a description a player controls goes to its owner's library and the library of each owner it went to is shuffled. The player who does it is the
 * one the description says controls them. Exactly those two steps.
 */
import type { EffectStep } from '../types/ability';
import { acting } from './clause';
import { alt } from './text';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const OTHER = 'duel:other';

function youAndPlayerEachRevealTop(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'reveal' || b?.op !== 'reveal' || a.guard !== undefined || b.guard !== undefined || a.as !== 'duelMine' || b.as !== 'duelTheirs' || a.to !== undefined || b.to !== undefined) return null;
  if (!same(a.who, { ref: 'you' }) || !same(a.what, { ref: 'topCards', player: { ref: 'you' }, count: 1 }) || b.who.ref === 'you' || b.who.ref === 'each' || !same(b.what, { ref: 'topCards', player: b.who, count: 1 })) return null;
  const other = K.player(b.who, st, 'subject');
  if (other.person !== 'sg') return null;
  st.info.set(OTHER, { key: JSON.stringify(b.who) } as never);
  const text = `you and ${other.text} each reveal the top card of your library`;
  return { clauses: [acting('you', text, text)], consumed: 2 };
}

const manaValueOf = (n: unknown, name: string): boolean => same(n, { q: 'stat', stat: 'manaValue', of: { ref: 'bound', name } });

function eachLoseLifeOtherRevealed(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'loseLife' || b?.op !== 'loseLife' || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined) return null;
  const known = st.info.get(OTHER) as { key?: string } | undefined;
  if (known === undefined || !same(a.who, { ref: 'you' }) || !manaValueOf(a.amount, 'duelTheirs') || !manaValueOf(b.amount, 'duelMine')) return null;
  // (the other player of the reveal, named again: "that player" for the target an earlier sentence announced, resolved to the same target by the parser)
  if (b.who.ref === 'you' || b.who.ref === 'each' || JSON.stringify(b.who) !== known.key) return null;
  const text = 'you each lose life equal to the mana value of the card revealed by the other player';
  return { clauses: [acting('you', text, text)], consumed: 2 };
}

function eachPutRevealedIntoHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'move' || b?.op !== 'move' || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined || a.until !== undefined || b.until !== undefined) return null;
  if (a.link !== undefined || b.link !== undefined || a.remember !== undefined || b.remember !== undefined || st.info.get(OTHER) === undefined) return null;
  if (!same(a.what, { ref: 'bound', name: 'duelMine' }) || !same(b.what, { ref: 'bound', name: 'duelTheirs' }) || !same(a.to, { zone: 'hand' }) || !same(b.to, { zone: 'hand' })) return null;
  const text = 'you each put the card you revealed into your hand';
  return { clauses: [acting('you', text, text, { standalone: true })], consumed: 2 };
}

function shuffleEachIntoOwnersLibrary(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'forEach' || a.guard !== undefined || a.gather !== undefined || a.over.ref !== 'each' || !('filter' in a.over) || a.do.length !== 2) return null;
  const [m, b] = a.do as [EffectStep, EffectStep];
  const it = { ref: 'bound', name: a.as };
  if (m.op !== 'move' || b.op !== 'shuffle' || m.guard !== undefined || b.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined || b.ifSearched !== undefined) return null;
  if (!same(m.to, { zone: 'library' }) || !same(m.what, it) || !same(b.who, { ref: 'ownerOf', object: it })) return null;
  if (list.slice(i + 1).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`))) return null;
  const f = a.over.filter;
  const actor = f.controller;
  if (actor === undefined || actor === 'you' || actor === 'opponent' || actor === 'any' || typeof actor !== 'object') return null;
  const who = K.player(actor as never, st, 'subject');
  if (who.person !== 'sg') return null;
  const what = K.np(f, st, { det: 'each' });
  const tail = `${what} into its owner's library`;
  const sub = (who as { they?: boolean }).they === true ? alt(`${who.text} shuffles ${tail}`, `they shuffle ${tail}`) : `${who.text} shuffles ${tail}`;
  return { clauses: [acting('x', `shuffle ${tail}`, sub, { leadThen: true })], consumed: 2 };
}

export function foldEdhZones24(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return youAndPlayerEachRevealTop(list, i, st) ?? eachLoseLifeOtherRevealed(list, i, st) ?? eachPutRevealedIntoHand(list, i, st) ?? shuffleEachIntoOwnersLibrary(list, i, st);
}
