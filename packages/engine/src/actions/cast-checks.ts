/**
 * FAST5X E17: conditions a spell checks AS IT IS CAST ("deals 4 damage to that creature instead if you controlled a Mount as you cast this spell"; CR 601.2,
 * 601.2i, 608.2h). Owner: FAST5X E17.
 *
 * The condition `{cond:'asCast', held}` is about the moment the spell was cast, not the moment it resolves: whether `held` was true is decided once, when the
 * spell becomes cast (CR 601.2i, actions/cast.ts calls `recordCastChecks`), and kept on the spell (`StackInfo.castChecks`, keyed by the condition's JSON,
 * rules/resolutions.ts#castCheckKey).
 * As the spell resolves, the condition reads that record (effects/eval.ts): a Mount that left the battlefield since still counts, one that arrived since does
 * not. A spell that was not cast (a copy put on the stack, CR 707.10) or a condition that could not be checked has no record: the condition is false.
 */
import type { Game } from '../core/game';
import type { Condition, EffectProgram } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import { castCheckKey } from '../rules/resolutions';
import { holds } from '../triggers/cond';

/** Every `asCast` condition inside a JSON tree (the spell's programs: steps, guards, modes). */
function asCastConditions(node: unknown, out: Condition[]): void {
  if (Array.isArray(node)) { for (const v of node) asCastConditions(v, out); return; }
  if (node === null || typeof node !== 'object') return;
  const o = node as Record<string, unknown>;
  if (o['cond'] === 'asCast' && o['held'] !== null && typeof o['held'] === 'object') out.push(o['held'] as Condition);
  for (const k in o) asCastConditions(o[k], out);
}

/** CR 601.2i: the spell has become cast: decide each "as you cast" condition of its programs now, as the spell's controller, and keep the answers. */
export function recordCastChecks(g: Game, spellId: ObjectId, caster: PlayerId, programs: readonly EffectProgram[]): void {
  const found: Condition[] = [];
  asCastConditions(programs, found);
  if (found.length === 0) return;
  const spell = g.obj(spellId);
  if (!spell.stack) return;
  const checks: Record<string, boolean> = {};
  for (const held of found) {
    const ok = holds(g, held, { source: { id: spellId, zone: 'stack' }, controller: caster, event: null });
    if (ok === undefined) {
      g.log(`${g.nameOf(spellId)}: the engine can't check "as you cast" here; it counts as not having been true.`, { rules: ['CR 601.2i'], level: 'warning' });
      continue;
    }
    checks[castCheckKey(held)] = ok;
  }
  spell.stack.castChecks = checks;
}
