/**
 * Resolving a triggered mana ability at once, without the stack (CR 605.4a). Owner: WP32. triggers/mana-now.ts finds them right after the mana ability that
 * triggered them was activated; this runs each one's effect with the interpreter, the way `resolveStackObject` (run.ts) runs an ability on the stack, minus
 * everything the stack brings: there is no stack object, no target (CR 605.1b: an ability with a target is not a mana ability), no mode, nothing to fizzle and
 * nothing to finish (CR 605.3b: it can't be responded to). It still checks an intervening "if" again (CR 603.4), and it reads the event that triggered it
 * ("that player adds ...", "one mana of any type that land produced") from the trigger's context, as an ability on the stack does.
 */
import type { Game } from '../core/game';
import type { TriggeredAbilityDef } from '../types/ability';
import type { GameObject, PendingTrigger } from '../types/state';
import { interveningIfHolds } from '../triggers/cond';
import { makeCtx } from './ctx';
import { askManual, startNotes } from './manual';
import { runSteps, STEP_BUDGET, StepBudgetExceeded, syncHistoryFor } from './run';

/** CR 605.4a: resolve the triggered mana ability `t` (with its definition) now. */
export function resolveTriggeredManaAbility(g: Game, t: PendingTrigger, def: TriggeredAbilityDef): void {
  const src = g.s.objects[t.sourceId] ?? g.s.lki[t.sourceId]?.object;
  if (!src) {
    g.log(`${t.sourceName}: the source of a triggered mana ability is gone without a trace; add the mana by hand if it should have.`, { rules: ['CR 605.4a'], level: 'warning' });
    return;
  }
  // The context of an ability whose source is `src` and whose controller is the one who controlled the source when it triggered (CR 603.3a). It is built on a
  // copy of the source without its stack information (a source that is a spell has some): this ability is not on the stack and has no targets.
  const { stack: _stack, ...rest } = src;
  const host: GameObject = { ...rest, controller: t.controller };
  const cx = makeCtx(g, host, def.effect);
  cx.event = t.context;
  startNotes(cx, { sourceName: t.sourceName, text: def.text, origins: new Map() });

  // CR 603.4: an intervening "if" is checked again as it resolves.
  if (def.interveningIf) {
    syncHistoryFor(g, def.interveningIf);
    if (!interveningIfHolds(g, def.interveningIf, { source: cx.source, controller: cx.controller, event: cx.event })) {
      g.log(`${t.sourceName}'s triggered mana ability does nothing: its "if" condition is no longer true.`, { rules: ['CR 603.4', 'CR 605.4a'], level: 'info' });
      return;
    }
  }
  try {
    runSteps(cx, def.effect.steps);
  } catch (e) {
    if (!(e instanceof StepBudgetExceeded)) throw e;
    g.log(`${t.sourceName}'s triggered mana ability executed more than ${STEP_BUDGET} steps; the rest of it is resolved by hand.`, { rules: ['CR 608.2c'], level: 'warning' });
    askManual(cx, `the rest of ${def.text}`, 'budget');
  }
  g.log(`${t.sourceName}'s triggered mana ability resolves at once, without the stack.`, { rules: ['CR 605.4a'], level: 'info' });
}
