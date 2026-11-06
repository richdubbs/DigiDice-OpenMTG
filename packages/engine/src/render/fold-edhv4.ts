/**
 * edh-c-4 (Commander lane edh-c): the folds of its templates (parser/templates/zz-cloud/edh-c-4.json), called from render/fold.ts#foldAt. Each applies only when every part is
 * exactly what the idiom says.
 *
 * `eachReturnsOwnChoice` (CR 608.2d, 101.4, 400.7; Curfew, eff.edhv4.each*.returnsOwnToHand): "Each player returns a creature they control to its owner's hand.": every player of the
 * group chooses one object of the description among those they control (`chooseObjects` with `perPlayer` and `who` `iterating`) and the chosen objects go to their owners' hands.
 * Exactly those two steps, the chosen objects named by nothing but the move.
 *
 * `shuffleAnyFromHandThenDraw` (CR 701.24a, 121.1, 608.2c; Credit Voucher, eff.edhv4.shuffleAnyNumberFromHand.thenDrawThatMany): "Shuffle any number of cards from your hand into your
 * library, then draw that many cards.": the chosen cards go to the library, the library is shuffled, and as many cards are drawn as were put there. Exactly those four steps.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { groupPool } from './refs';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function eachReturnsOwnChoice(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [c, m] = [list[i], list[i + 1]];
  // only the pair the template builds (its choice is named `returned`): the same two steps written as two sentences ("Each opponent chooses a creature ... Return those creatures to their owners' hands.") keep their own wording
  if (c?.op !== 'chooseObjects' || m?.op !== 'move' || c.as !== 'returned' || c.guard !== undefined || m.guard !== undefined || c.random !== undefined || c.groupLimit !== undefined || c.link !== undefined) return null;
  const per = c.perPlayer;
  if (per === undefined || per.ref !== 'each' || (per.who !== 'player' && per.who !== 'opponent') || !same(c.who, { ref: 'iterating' }) || c.min !== 1 || c.max !== 1 || c.from.ref !== 'each') return null;
  if (!same(m.what, { ref: 'bound', name: c.as }) || !same(m.to, { zone: 'hand' }) || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined) return null;
  const what = K.np(c.from.filter, st, { det: 'a' });
  return { clauses: [plain(`each ${per.who} returns ${what} to its owner's hand`)], consumed: 2 };
}

function shuffleAnyFromHandThenDraw(list: EffectStep[], i: number): Folded | null {
  const [c, m, sh, d] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  if (c?.op !== 'chooseObjects' || m?.op !== 'move' || sh?.op !== 'shuffle' || d?.op !== 'draw' || c.as === undefined || m.as === undefined) return null;
  if (c.guard !== undefined || m.guard !== undefined || sh.guard !== undefined || d.guard !== undefined || c.random !== undefined || c.groupLimit !== undefined || c.perPlayer !== undefined || c.link !== undefined) return null;
  if (!same(c.who, { ref: 'you' }) || c.min !== 0 || c.max !== 'any' || c.from.ref !== 'each' || !same(c.from.filter, { zone: 'hand', owner: 'you' })) return null;
  if (!same(m.what, { ref: 'bound', name: c.as }) || !same(m.to, { zone: 'library', owner: { ref: 'you' } }) || m.until !== undefined || m.link !== undefined || m.remember !== undefined) return null;
  if (!same(sh.who, { ref: 'you' }) || !same(d.who, { ref: 'you' }) || !same(d.count, { q: 'resultCount', step: m.as })) return null;
  return { clauses: [plain('shuffle any number of cards from your hand into your library, then draw that many cards')], consumed: 4 };
}

/**
 * `eachSacrificesAllExcept` (CR 701.21a, 608.2e, 101.4; Keldon Firebombers, eff.edhv4.eachPlayer.sacrificesAllExceptN): "Each player sacrifices all lands they control except for three.":
 * every player sacrifices their own permanents of the description beyond N of their choice (the greater of 0 and the number they control minus N; they keep the N they choose).
 */
function eachSacrificesAllExcept(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'sacrificeChoice' || s.guard !== undefined || s.mode !== undefined || s.cantAs !== undefined || s.exploit !== undefined || s.keepTypes !== undefined || s.keepFilter !== undefined || s.chooser !== undefined) return null;
  if (!same(s.who, { ref: 'each', who: 'player' }) || typeof s.count !== 'object' || s.count.q !== 'math' || s.count.op !== 'max' || s.count.args.length !== 2 || s.count.args[0] !== 0) return null;
  const sub = s.count.args[1];
  if (typeof sub !== 'object' || sub.q !== 'math' || sub.op !== '-' || sub.args.length !== 2 || typeof sub.args[1] !== 'number') return null;
  if (!same(sub.args[0], { q: 'count', of: { ref: 'each', filter: s.filter } })) return null;
  return { clauses: [plain(`each player sacrifices ${K.np(s.filter, st, { det: 'all', plural: true })} except for ${sub.args[1]}`)], consumed: 1 };
}

/**
 * `exileNOfThem` (CR 701.13a, 701.20e, 608.2c-d; Thoughtpicker Witch, eff.edhv4.look.topN.thenExileNOfThem): "exile one of them" after a look at the top cards of a library: your choice of
 * exactly N cards of the group looked at, and the move of exactly those cards into exile. Only that exact shape, nothing after it reading the choice.
 */
function exileNOfThem(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [c, m] = [list[i], list[i + 1]];
  if (c?.op !== 'chooseObjects' || m?.op !== 'move' || c.as === undefined || !same(c.who, { ref: 'you' }) || typeof c.min !== 'number' || c.max !== c.min || c.min < 1) return null;
  if (c.random === true || c.guard !== undefined || c.distinct !== undefined || c.groupLimit !== undefined || c.perPlayer !== undefined || c.startingWith !== undefined || c.link !== undefined) return null;
  if (m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined || !same(m.what, { ref: 'bound', name: c.as }) || !same(m.to, { zone: 'exile' })) return null;
  const pool = groupPool(c.from);
  if (pool === null || pool.desc !== null || list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":"${c.as}"`))) return null;
  const them = K.obj(pool.group, st, 'object');
  if (!them.plural) return null;
  return { clauses: [plain(`exile ${c.min} of ${them.text}`)], consumed: 2 };
}

export function foldEdhV4(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return eachReturnsOwnChoice(list, i, st) ?? shuffleAnyFromHandThenDraw(list, i) ?? eachSacrificesAllExcept(list, i, st) ?? exileNOfThem(list, i, st);
}
