/**
 * Commander lane edh-perms, round edh-perms-8: folds of adjacent steps that Oracle writes as one idiom (render/fold.ts#foldAt tries `foldEdhPm8` last).
 * A fold applies only when every part is exactly what the idiom says (same bound name, nothing else in between).
 */
import type { EffectStep } from '../types/ability';
import type { Folded } from './fold';
import { plain } from './clause';
import { K } from './kernel';
import type { RenderState } from './state';

/**
 * "Put a +1/+1 counter on target creature you control, then double the number of +1/+1 counters on each creature that had a +1/+1 counter put on it this way."
 * (CR 122.1, 701.10e, 608.2c; Fangs of Kalonia): the counters are put, then the creatures that actually received them (the bound objects of the putting step) have
 * the counters of that kind doubled.
 */
function putThenDoublePut(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'putCounters' || a.as === undefined || a.guard !== undefined || a.distribute !== undefined || a.upTo !== undefined) return null;
  if (b?.op !== 'action' || b.action !== 'doubleCounters' || b.guard !== undefined || b.as !== undefined || b.arg === undefined || b.subject === undefined || !('name' in b.subject) || b.subject.ref !== 'bound' || b.subject.name !== a.as) return null;
  if (a.kind !== b.arg || list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"${a.as}"`))) return null;
  const first = K.clause(a, st);
  const second = `double the number of ${b.arg} counters on each creature that had a ${a.kind} counter put on it this way`; // "a counter", whatever the number put (the creature had counters put on it)
  return { clauses: [{ ...first, imp: `${first.imp}, then ${second}`, sub: `${first.sub}, then ${second}`, standalone: true }], consumed: 2 };
}

/**
 * "You draw cards equal to the sacrificed creature's power, then you gain life equal to its toughness." (CR 118.8, 608.2h, 119.1; Momentous Fall): you draw that many cards, then
 * gain that much life, each a stat (power or toughness) of the creature sacrificed as this spell's additional cost (last known information).
 */
function drawPowerGainToughness(list: EffectStep[], i: number): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'draw' || b?.op !== 'gainLife' || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined || a.upTo !== undefined) return null;
  if (a.who.ref !== 'you' || b.who.ref !== 'you') return null;
  const statOf = (q: unknown): string | null => {
    const x = q as { q?: string; stat?: string; of?: unknown } | null;
    return typeof x === 'object' && x !== null && x.q === 'stat' && (x.stat === 'power' || x.stat === 'toughness') && JSON.stringify(x.of) === JSON.stringify({ ref: 'costSacrificed' }) ? x.stat : null;
  };
  const [first, second] = [statOf(a.count), statOf(b.amount)];
  if (first === null || second === null) return null;
  return { clauses: [plain(`you draw cards equal to the sacrificed creature's ${first}, then you gain life equal to its ${second}`)], consumed: 2 };
}

/**
 * "Put a number of +1/+1 counters on each other creature you control equal to that creature's toughness." (CR 122.1, 608.2c, 208.1; Canopy Gargantuan): each creature of the
 * group gets counters equal to its own toughness (a forEach of one putCounters step that reads the iterated object's toughness).
 */
function countersEqualOwnToughness(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'forEach' || a.guard !== undefined || a.as === undefined || a.do.length !== 1 || a.over.ref !== 'each' || !('filter' in a.over)) return null;
  const p = a.do[0];
  if (p?.op !== 'putCounters' || p.guard !== undefined || p.as !== undefined || p.distribute !== undefined || p.upTo !== undefined) return null;
  const mine = { ref: 'bound', name: a.as };
  if (JSON.stringify(p.on) !== JSON.stringify(mine) || JSON.stringify(p.count) !== JSON.stringify({ q: 'stat', stat: 'toughness', of: mine })) return null;
  const group = K.obj(a.over, st, 'object');
  if (!group.plural && !group.text.startsWith('each ')) return null;
  const k = p.kind;
  return { clauses: [plain(`put a number of ${k} counters on ${group.text} equal to that creature's toughness`)], consumed: 1 };
}

export function foldEdhPm8(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return putThenDoublePut(list, i, st) ?? drawPowerGainToughness(list, i) ?? countersEqualOwnToughness(list, i, st);
}
