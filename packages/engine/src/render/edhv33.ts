/**
 * edh-c-33: the words of the conditions parser/holes/edhv33.ts reads (CR 603.4 intervening "if" clauses). render/boot.ts wraps the condition renderer with
 * `withEdhV33`: a condition of one of these shapes is also said the way Oracle prints it, beside the generic wording (or alone when the generic renderer has
 * none). Null for any other shape.
 */
import type { Condition } from '../types/ability';
import { K } from './kernel';
import { cloneState, type RenderState } from './state';
import { alt, NoRenderer } from './text';

const json = (v: unknown): string => JSON.stringify(v);
const ATTACKED = json({ cond: 'happened', event: { ev: 'attacks', attacker: { self: true } }, scope: 'turn' });
const BLOCKED = json({ cond: 'happened', event: { ev: 'blocks', blocker: { self: true } }, scope: 'turn' });
const PLAYED_LAND = json({ cond: 'happened', event: { ev: 'action', verb: 'playLand', actor: 'you' }, scope: 'turn' });

function phrase(c: Condition, st: RenderState): string | null {
  // "~ didn't attack this turn" (CR 508.1)
  if (c.cond === 'not' && json(c.of) === ATTACKED) {
    const self = K.obj({ ref: 'self' }, st, 'subject').text;
    return alt(`${self} didn't attack this turn`, `${self} did not attack this turn`);
  }
  // "you didn't play a land this turn" (CR 305.1)
  if (c.cond === 'not' && json(c.of) === PLAYED_LAND) return alt("you didn't play a land this turn", 'you did not play a land this turn');
  // "~ attacked or blocked this turn" (CR 508.1, 509.1)
  if (c.cond === 'any' && c.of.length === 2 && json(c.of[0]) === ATTACKED && json(c.of[1]) === BLOCKED) {
    return `${K.obj({ ref: 'self' }, st, 'subject').text} attacked or blocked this turn`;
  }
  return null;
}

/** Wraps the condition renderer: the generic wording, and Oracle's for the shapes above (only Oracle's when the generic renderer has none). */
export function withEdhV33(base: (c: Condition, st: RenderState) => string): (c: Condition, st: RenderState) => string {
  return (c, st) => {
    const mine = phrase(c, cloneState(st));
    if (mine === null) return base(c, st);
    try {
      return alt(base(c, st), mine);
    } catch (e) {
      if (!(e instanceof NoRenderer)) throw e;
      return phrase(c, st) ?? mine;
    }
  };
}
