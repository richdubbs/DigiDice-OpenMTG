/**
 * Standard round 5, r5-refs (references and durations): folds of adjacent steps that Oracle writes as one idiom (render/fold.ts#foldAt tries `foldR5Refs` after
 * r4-refs' folds). As there, a fold applies only when every part is exactly what the idiom says (same players, bound names, nothing else in between).
 */
import type { EffectStep } from '../types/ability';
import { acting, plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { countersText } from './steps-life';
import { bind } from './steps-util';
import { alt, numWord } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const ITERATING = { ref: 'iterating' };
const CREATURES_THEY_CONTROL = { types: ['Creature'], controller: ITERATING };

/**
 * "Each player chooses any number of creatures they control with total power 4 or less, then sacrifices all other creatures they control." (CR 101.4, 608.2d,
 * 701.21a, 109.2): every player, in APNAP order, chooses among their own creatures with a total power limit (`chooseObjects` with `perPlayer` each player and
 * `who` the player of the iteration), then each player sacrifices every creature they control that was not chosen. Exactly those two steps (template
 * eff.r5refs.eachPlayer.chooses.totalPower.sacrificesOther).
 */
function eachChoosesTotalPowerSacrificesOther(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || a.guard !== undefined || a.random === true || a.min !== 0 || a.max !== 'any' || a.as === undefined) return null;
  if (!same(a.who, ITERATING) || !same(a.perPlayer, { ref: 'each', who: 'player' }) || !same(a.from, { ref: 'each', filter: CREATURES_THEY_CONTROL })) return null;
  const limit = a.groupLimit;
  if (limit === undefined || limit.stat !== 'power' || limit.cmp.op !== '<=') return null;
  if (b?.op !== 'sacrificeChoice' || b.guard !== undefined || b.mode !== 'all' || b.as !== undefined || b.cantAs !== undefined || !same(b.who, { ref: 'each', who: 'player' })) return null;
  if (!same(b.filter, { ...CREATURES_THEY_CONTROL, not: { is: { ref: 'bound', name: a.as } } })) return null;
  const n = K.qty(limit.cmp.value, st);
  bind(st, a.as, { nouns: ['creature'], plural: true });
  return { clauses: [plain(`each player chooses any number of creatures they control with total power ${n} or less, then sacrifices all other creatures they control`, { standalone: true })], consumed: 2 };
}

/**
 * "Put each creature card exiled with ~ onto the battlefield under your control with a flying counter on it." (CR 607.2a, 110.2, 122.6, 614.1c): every card of one
 * kind that the object's linked ability exiled, still in exile, enters under the controller's control with one counter of a kind. One `move` of exactly that
 * group (template eff.r5refs.linked.putEach.bf.counter); "Each of them" of the next sentence is that group (bound under the move's `as`).
 */
function linkedPutEach(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'move' || a.guard !== undefined || a.until !== undefined || a.what.ref !== 'each' || !('filter' in a.what)) return null;
  const f = a.what.filter;
  const kinds = f.anyOf;
  if (!same(f.is, { ref: 'linked', link: 'exiled' }) || f.zone !== 'any' || f.isCard !== true || kinds?.length !== 1 || Object.keys(f).some((k) => !['is', 'zone', 'isCard', 'anyOf'].includes(k))) return null;
  const to = a.to;
  const counters = to.counters;
  if (to.zone !== 'battlefield' || !same(to.controller, { ref: 'you' }) || counters?.length !== 1 || counters[0]!.count !== 1 || Object.keys(to).some((k) => !['zone', 'controller', 'counters'].includes(k))) return null;
  const card = `${K.np(kinds[0]!, st, { det: 'none' })} card`;
  const self = K.obj({ ref: 'self' }, st, 'object').text;
  if (a.as !== undefined) bind(st, a.as, { nouns: [...K.nounsOf(kinds[0]!), 'card'], plural: true });
  const text = `put each ${card} exiled with ${self} onto the battlefield under your control with ${countersText(1, counters[0]!.kind, st)} on it`;
  return { clauses: [acting('you', text, `you ${text.replace(/^put /, 'put ')}`)], consumed: 1 };
}

/**
 * "Whenever a creature is dealt damage, its controller may exile that many cards from the top of their library. They may play those cards until the end of their next
 * turn." (CR 608.2d, 406.1, 601.3, 611.2a): another player's option to exile cards from the top of their own library, and the permission, in the same option, for that
 * player to play the cards exiled (lower/conditions.ts#foldMayFollowers). Exactly a `may` of one player (not you, not a group) whose instructions are that move and that
 * lasting permission for the cards it bound.
 */
function playerMayImpulse(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  if (m?.op !== 'may' || m.guard !== undefined || m.otherwise !== undefined || m.as !== undefined || m.do.length !== 2 || m.who.ref === 'you' || m.who.ref === 'each') return null;
  const [mv, perm] = m.do;
  if (mv?.op !== 'move' || mv.guard !== undefined || mv.until !== undefined || mv.link !== undefined || mv.as === undefined || mv.what.ref !== 'topCards' || !same(mv.what.player, m.who)) return null;
  if (Object.keys(mv.to).length !== 1 || mv.to.zone !== 'exile') return null;
  if (perm?.op !== 'effect' || perm.guard !== undefined || perm.as !== undefined || perm.effects.length !== 1) return null;
  const e = perm.effects[0]!;
  if (e.s !== 'permit' || e.action !== 'play' || !same(e.who, m.who) || !same(e.of, { is: { ref: 'bound', name: mv.as } }) || Object.keys(e).length !== 4) return null;
  const n = mv.what.count;
  const cards = typeof n === 'object' && n.q === 'eventAmount' ? 'that many cards' : typeof n === 'number' && n >= 2 ? `${numWord(n)} cards` : null;
  if (cards === null) return null;
  const who = K.player(m.who, st, 'subject').text;
  bind(st, mv.as, { nouns: ['card'], plural: true });
  const dur = K.dur(perm.duration, st);
  const text = `${who} may ${alt(`exile ${cards} from the top of their library`, `exile the top ${cards.replace(/ cards$/, '')} cards of their library`)}. ${alt('they', 'that player')} may play ${alt('those cards', 'them')} ${dur}`;
  return { clauses: [plain(text, { standalone: true })], consumed: 1 };
}

/**
 * "Each player exiles all but the bottom six cards of their library face down." (CR 401.1, 406.3, 101.4, 107.1b): for each player, the top cards of their own library
 * but the last N, face down (none when the library has N cards or fewer). Exactly the `forEach` of template eff.r5refs.eachPlayer.exiles.allButBottom.faceDown.
 */
function allButBottomFaceDown(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const f = list[i];
  if (f?.op !== 'forEach' || f.guard !== undefined || !same(f.over, { ref: 'each', who: 'player' }) || f.do.length !== 1) return null;
  const mv = f.do[0]!;
  if (mv.op !== 'move' || mv.guard !== undefined || mv.as !== undefined || mv.until !== undefined || mv.link !== undefined || !same(mv.to, { zone: 'exile', faceDown: true })) return null;
  if (mv.what.ref !== 'topCards' || !same(mv.what.player, ITERATING)) return null;
  const c = mv.what.count;
  if (typeof c !== 'object' || c.q !== 'math' || c.op !== 'max' || c.args.length !== 2 || c.args[0] !== 0) return null;
  const minus = c.args[1]!;
  if (typeof minus !== 'object' || minus.q !== 'math' || minus.op !== '-' || minus.args.length !== 2 || !same(minus.args[0], { q: 'zoneSize', zone: 'library', of: ITERATING })) return null;
  const n = minus.args[1]!;
  const cards = typeof n === 'number' ? (n === 1 ? 'card' : `${numWord(n)} cards`) : `${K.qty(n, st)} cards`;
  return { clauses: [plain(`each player exiles all but the bottom ${cards} of their library face down`, { standalone: true })], consumed: 1 };
}

/** The folds of r5-refs, tried after r4-refs' (render/fold.ts#foldAt). */
export function foldR5Refs(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return eachChoosesTotalPowerSacrificesOther(list, i, st) ?? linkedPutEach(list, i, st) ?? playerMayImpulse(list, i, st) ?? allButBottomFaceDown(list, i, st);
}
