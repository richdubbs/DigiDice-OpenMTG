/**
 * edh-d-27 (Commander coordinator D, lane vote, second pass): the folds of its templates (parser/templates/zz-cloud/edh-d-27.json), called from render/fold.ts#foldAt. Each applies only
 * when every part is exactly what the idiom says.
 *
 * `forEachOpponentVoteDamage` (CR 701.38a, 608.2c, 120.3; Mob Verdict, eff.edhd27.forEachOpponentVote.damageThatPlayerAndCreatures): "For each vote an opponent received, ~ deals 2 damage to
 * that player and each creature that player controls.": each opponent in turn, once per vote they received (the vote right before), damage to them and to each creature they control.
 *
 * `forEachVotedCreature` (CR 701.38a, 122.1, 608.2c, 608.2f; Trap the Trespassers, eff.edhd27.forEachVotedCreature.stunTap): "For each creature with one or more votes, put that many stun
 * counters on it, then tap it.": each object the vote could be for, kept when it got a vote, gets that many counters and is tapped.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { bind } from './steps-util';
import { alt, numWord } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const ITERATING = { ref: 'iterating' };

function forEachOpponentVoteDamage(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const f = list[i];
  if (f?.op !== 'forEach' || f.guard !== undefined || f.gather !== undefined || f.do.length !== 1 || !same(f.over, { ref: 'each', who: 'opponent' })) return null;
  const r = f.do[0];
  if (r?.op !== 'repeat' || r.guard !== undefined || r.do.length !== 1 || r.until !== undefined || r.optional !== undefined || r.gather !== undefined) return null;
  const t = r.times;
  if (typeof t !== 'object' || t.q !== 'votesFor' || !same(t.of, ITERATING)) return null;
  const d = r.do[0];
  if (d?.op !== 'damage' || d.guard !== undefined || typeof d.amount !== 'number' || !same(d.to, ITERATING) || d.also?.length !== 1) return null;
  const a = d.also[0]!;
  if (a.amount !== d.amount || !same(a.to, { ref: 'each', filter: { types: ['Creature'], controller: ITERATING } }) || Object.keys(a).length !== 2) return null;
  if (Object.keys(d).some((k) => !['op', 'source', 'to', 'amount', 'also'].includes(k))) return null;
  return { clauses: [plain(`for each vote an opponent received, ${K.obj(d.source, st, 'subject').text} deals ${d.amount} damage to that player and each creature that player controls`)], consumed: 1 };
}

function forEachVotedCreature(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const f = list[i];
  if (f?.op !== 'forEach' || f.guard !== undefined || f.gather !== undefined || f.do.length !== 1 || f.over.ref !== 'each' || !('filter' in f.over) || f.as === undefined) return null;
  const types = f.over.filter.types;
  if (types === undefined || types.length !== 1) return null;
  const it = { ref: 'bound', name: f.as };
  const votes = { q: 'votesFor', step: (f.do[0] as { cond?: { left?: { step?: string } } } | undefined)?.cond?.left?.step ?? '', of: it };
  const c = f.do[0];
  if (c?.op !== 'if' || c.guard !== undefined || c.else !== undefined || c.intervening !== undefined || !same(c.cond, { cond: 'compare', left: votes, op: '>=', right: 1 }) || c.then.length !== 2) return null;
  const [p, tp] = c.then;
  if (p?.op !== 'putCounters' || p.guard !== undefined || typeof p.kind !== 'string' || !/^[a-z]+$/.test(p.kind) || !same(p.on, it) || !same(p.count, votes) || Object.keys(p).some((k) => !['op', 'on', 'kind', 'count'].includes(k))) return null;
  if (tp?.op !== 'tap' || tp.guard !== undefined || !same(tp.what, it) || Object.keys(tp).some((k) => !['op', 'what'].includes(k))) return null;
  return { clauses: [plain(`for each ${types[0]!.toLowerCase()} with one or more votes, put that many ${p.kind} counters on it, then tap it`)], consumed: 1 };
}

/**
 * `eachPlayerNoVotesMayPut` (CR 701.38a, 101.4, 608.2d, 110.2a; Círdan the Shipwright, eff.edhd27.eachPlayerNoVotes.may.putFromHand.bf): "Each player who received no votes may put a permanent card
 * from their hand onto the battlefield.": each player in turn who got no vote (the vote right before) chooses up to one of the described cards in their own hand and it is put onto the battlefield.
 */
function eachPlayerNoVotesMayPut(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const f = list[i];
  if (f?.op !== 'forEach' || f.guard !== undefined || f.gather !== undefined || f.do.length !== 1 || !same(f.over, { ref: 'each', who: 'player' })) return null;
  const c = f.do[0];
  if (c?.op !== 'if' || c.guard !== undefined || c.else !== undefined || c.intervening !== undefined || c.then.length !== 2) return null;
  const cond = c.cond;
  if (cond.cond !== 'compare' || cond.op !== '==' || cond.right !== 0 || typeof cond.left !== 'object' || cond.left.q !== 'votesFor' || !same(cond.left.of, ITERATING)) return null;
  const [a, b] = c.then;
  if (a?.op !== 'chooseObjects' || a.guard !== undefined || a.random !== undefined || a.groupLimit !== undefined || a.startingWith !== undefined || a.perPlayer !== undefined || a.min !== 0 || a.max !== 1 || !same(a.who, ITERATING) || a.from.ref !== 'each' || a.as === undefined) return null;
  const fl = a.from.filter;
  if (fl.anyOf?.length !== 1 || fl.zone !== 'hand' || !same(fl.owner, ITERATING) || fl.isCard !== true || Object.keys(fl).some((k) => !['anyOf', 'zone', 'owner', 'isCard'].includes(k))) return null;
  if (b?.op !== 'move' || b.guard !== undefined || b.as !== undefined || b.until !== undefined || b.link !== undefined || !same(b.what, { ref: 'bound', name: a.as }) || !same(b.to, { zone: 'battlefield', controller: 'owner' })) return null;
  const kind = fl.anyOf[0]!;
  bind(st, a.as, { nouns: [...K.nounsOf(kind), 'card'], plural: true });
  const card = K.np({ ...kind, isCard: true, zone: 'hand' }, st, { det: 'a', noZone: true });
  return { clauses: [plain(`each player who received no votes may put ${card} from their hand onto the battlefield`, { standalone: true })], consumed: 1 };
}

/**
 * `ringTemptsThenCounter` (CR 701.54a, 122.1, 608.2c; Galadriel, Elven-Queen; family ring-tempts-then-counter): "The Ring tempts you, then you put a +1/+1 counter on your Ring-bearer.": the
 * Ring tempts you, then (as the Ring has a Ring-bearer now) counters are put on it; the same two steps as "The Ring tempts you. Put a +1/+1 counter on your Ring-bearer."
 */
function ringTemptsThenCounter(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'action' || a.action !== 'ringTempts' || a.guard !== undefined || a.as !== undefined || !same(a.who, { ref: 'you' }) || a.n !== undefined || a.subject !== undefined || a.arg !== undefined) return null;
  if (b?.op !== 'putCounters' || b.guard !== undefined || typeof b.kind !== 'string' || !/^[+\-\d/]+$|^[a-z]+$/.test(b.kind) || typeof b.count !== 'number' || b.count < 1) return null;
  if (!same(b.on, { ref: 'each', filter: { ringBearer: 'you' } }) || Object.keys(b).some((k) => !['op', 'on', 'kind', 'count'].includes(k))) return null;
  const counters = b.count === 1 ? `a ${b.kind} counter` : `${numWord(b.count)} ${b.kind} counters`;
  return { clauses: [plain(alt(`the Ring tempts you, then you put ${counters} on your Ring-bearer`, `the Ring tempts you. put ${counters} on your Ring-bearer`))], consumed: 2 };
}

export function foldEdhD27(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return forEachOpponentVoteDamage(list, i, st) ?? forEachVotedCreature(list, i, st) ?? eachPlayerNoVotesMayPut(list, i, st) ?? ringTemptsThenCounter(list, i, st);
}
