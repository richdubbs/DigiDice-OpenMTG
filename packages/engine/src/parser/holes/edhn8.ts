/**
 * edh-next-8 (Commander lane edh-next, template code edhn8): readings of the `Qty` hole said after "for each" (a spell's own cost change and other per-object amounts).
 *  - "for each creature type among creatures you control" (Valiant Changeling): the number of different creature types among them (`distinct creatureTypes`, CR 205.3m;
 *    a changeling has every creature type, CR 702.73a, statics/match.ts#evalQuantity).
 *  - "for each counter among players and permanents" (Lumbering Megasloth): the counters of every kind on all the permanents plus the counters of every kind all the
 *    players have (CR 122.1, 122.1f: poison, energy, experience and rad counters are counters players have).
 */
import type { ObjectFilter, Quantity } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, phraseAt } from './core';

const W_CREATURE_TYPE_AMONG = P('creature type among');
const W_COUNTER_AMONG_PLAYERS_AND_PERMANENTS = P('counter among players and permanents');

/** True right after the words "for each" (in front of this hole, or written by a template): only then is the singular noun a count. */
function afterForEach(ctx: HoleCtx, pos: number): boolean {
  return ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each';
}

export function edhn8QtyAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  if (!afterForEach(ctx, pos)) return out;
  const ct = phraseAt(ctx, pos, W_CREATURE_TYPE_AMONG);
  if (ct >= 0) for (const f of ctx.call('Filter', ct)) out.push({ end: f.end, value: { q: 'distinct', what: 'creatureTypes', among: { ref: 'each', filter: f.value as ObjectFilter } }, ...(f.flags ? { flags: f.flags } : {}) });
  const cp = phraseAt(ctx, pos, W_COUNTER_AMONG_PLAYERS_AND_PERMANENTS);
  if (cp >= 0) {
    const value: Quantity = { q: 'math', op: '+', args: [{ q: 'counters', on: { ref: 'each', filter: {} }, kind: 'any' }, { q: 'counters', on: { ref: 'each', who: 'player' }, kind: 'any' }] };
    out.push({ end: cp, value });
  }
  return out;
}
