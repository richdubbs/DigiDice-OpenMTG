/**
 * edh-d-87 (Commander coordinator D, band 5,001-10,000, group combat; template code edhd87): readings of the `Cond` hole (parser/holes/cond.ts#atoms).
 *  - "an Assassin crewed it this turn" (CR 702.122c, 603.4; Adrestia, rulings 2024-07-05): a creature of that description was tapped this turn to pay the cost of a crew ability of the
 *    Vehicle "it" names. The turn's history keeps each such payment with the creature as it was when it was tapped (a `becomes` 'crewCostPaid' entry, its `by.` facts), so the
 *    creature counts even if it has left the battlefield or stopped being an Assassin since, and one that became an Assassin only after it crewed does not. "it" is resolved like
 *    any pronoun of the condition (the event's attacking Vehicle in "Whenever ~ attacks, if ..."); a description of the creature alone (a singular noun phrase after "a"/"an").
 */
import type { Condition, EventPattern, ObjectFilter } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, anaphorObj, phraseAt } from './core';
import { npAlts } from './filter';

const W_CREWED_IT_THIS_TURN = P('crewed it this turn');

export function edhd87CondAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const a = ctx.toks[pos]?.norm;
  if (a !== 'a' && a !== 'an') return out;
  for (const n of npAlts(ctx, pos + 1)) {
    if (n.number !== 'singular') continue;
    const e = phraseAt(ctx, n.end, W_CREWED_IT_THIS_TURN);
    if (e < 0) continue;
    const by: ObjectFilter = n.filter;
    const it = anaphorObj({ sort: 'object', number: 'singular', text: 'it' });
    out.push({ end: e, value: { cond: 'happened', scope: 'turn', event: { ev: 'becomes', what: 'crewCostPaid', object: { is: it }, by } } as unknown as Condition });
  }
  return out;
}

/**
 * edh-d-87 (CR 701.17a, 701.8a, 603.2, 603.10a; Jaws, Relentless Predator): "a noncreature artifact is sacrificed or destroyed" (also "is sacrificed", "is destroyed"): an object of the
 * description is sacrificed, or destroyed, by anyone (the `action` events of the zone change, triggers/normalize.ts), one trigger for each object; the object is read as it last existed on
 * the battlefield (a leaves-the-battlefield event). The subject is one singular noun phrase after "a"/"an".
 */
const W_IS = P('is');
const PASSIVES: [string[], ('sacrifice' | 'destroy')[]][] = [[P('sacrificed or destroyed'), ['sacrifice', 'destroy']], [P('destroyed or sacrificed'), ['destroy', 'sacrifice']], [P('sacrificed'), ['sacrifice']], [P('destroyed'), ['destroy']]];
export function sacrificedOrDestroyed(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const a = ctx.toks[pos]?.norm;
  if (a !== 'a' && a !== 'an') return out;
  for (const n of npAlts(ctx, pos + 1)) {
    if (n.number !== 'singular') continue;
    const is = phraseAt(ctx, n.end, W_IS);
    if (is < 0) continue;
    for (const [ws, verbs] of PASSIVES) {
      const e = phraseAt(ctx, is, ws);
      if (e >= 0) out.push({ end: e, value: verbs.map((verb) => ({ ev: 'action', verb, object: n.filter })) as unknown as EventPattern[] });
    }
  }
  return out;
}
