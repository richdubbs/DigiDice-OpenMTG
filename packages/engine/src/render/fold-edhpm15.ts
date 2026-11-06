/**
 * edh-perms-15 (Commander lane edh-perms): the folds of its templates (parser/templates/zz-cloud/edh-perms-15.json), called from render/fold.ts#foldAt.
 *
 * `twoGuardedPuts` (CR 122.1, 608.2c; Forge of Heroes): "Put a +1/+1 counter on it if it's a creature and a loyalty counter on it if it's a planeswalker." Two guarded counter
 * steps on the same one object, each with its own condition, said as one sentence. Exactly the two steps of template eff.edhpm15.counters.put.ifCond.andPutIfCond.
 */
import type { EffectStep } from '../types/ability';
import { fragment, plain } from './clause';
import { alt } from './text';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { countersText } from './steps-life';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function twoGuardedPuts(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'putCounters' || b?.op !== 'putCounters' || a.guard === undefined || b.guard === undefined) return null;
  for (const s of [a, b]) if (s.as !== undefined || s.upTo === true || s.distribute === true || s.kindOfChoice !== undefined || typeof s.count !== 'number' || s.on.ref === 'each') return null;
  if (!same(a.on, b.on)) return null;
  const { guard: _g, ...bare } = a;
  const first = fragment(K.clause(bare as EffectStep, st));
  const condA = K.cond(a.guard, st);
  const second = `${countersText(b.count, b.kind, st)} on ${K.obj(b.on as never, st, 'object').text}`;
  const condB = K.cond(b.guard, st);
  // the same two steps are also two sentences ("Put a +1/+1 counter on it if it's a creature. Put a loyalty counter on it if it's a planeswalker.", family two-guarded-puts)
  return { clauses: [plain(alt(`${first} if ${condA} and ${second} if ${condB}`, `${first} if ${condA}. put ${second} if ${condB}`), { standalone: true })], consumed: 2 };
}

/**
 * `drawStatDiscardStat` (CR 608.2h, 121.1, 701.9a; Felothar the Steadfast): "Draw cards equal to the sacrificed creature's toughness, then discard cards equal to its power."
 * You draw that many cards, then discard that many, each a stat (power or toughness) of the creature sacrificed as this ability's cost (last known information). Exactly
 * the two steps of template eff.edhpm15.sacrificed.drawStatDiscardStat.
 */
function drawStatDiscardStat(list: EffectStep[], i: number): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'draw' || b?.op !== 'discard' || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined || a.upTo !== undefined) return null;
  if (a.who.ref !== 'you' || b.who.ref !== 'you' || b.filter !== undefined || b.mode !== undefined || b.cantAs !== undefined || b.count === 'hand') return null;
  const statOf = (q: unknown): string | null => {
    const x = q as { q?: string; stat?: string; of?: unknown } | null;
    return typeof x === 'object' && x !== null && x.q === 'stat' && (x.stat === 'power' || x.stat === 'toughness') && same(x.of, { ref: 'costSacrificed' }) ? x.stat : null;
  };
  const [first, second] = [statOf(a.count), statOf(b.count)];
  if (first === null || second === null) return null;
  return { clauses: [plain(`draw cards equal to the sacrificed creature's ${first}, then discard cards equal to its ${second}`, { standalone: true })], consumed: 2 };
}

/** The folds of edh-perms-15 (render/fold.ts#foldAt). */
export function foldEdhPm15(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return twoGuardedPuts(list, i, st) ?? drawStatDiscardStat(list, i);
}
