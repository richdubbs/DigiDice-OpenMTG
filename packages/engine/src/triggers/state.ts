/** State triggers (CR 603.8), checked each time triggers are collected: before each state-based action pass and again after it (design 8.4). Owner: WP8. Contract: triggers/api.ts#CheckStateTriggers. */
import type { EventPattern } from '../types/ability';
import type { ObjectId } from '../types/ids';
import type { Game } from '../core/game';
import type { PendingTrigger } from '../types/state';
import type { CheckStateTriggers } from './api';
import { candidatesFor, triggeredAbilitiesOf } from './collect';
import { holds } from './cond';
import { triggersPossible } from './possible';

/** Is a copy of this object's ability already waiting or on the stack? (CR 603.8: a state trigger does not trigger again until its ability has left the stack.) */
function hasCopy(g: Game, source: ObjectId, key: string, pending: readonly PendingTrigger[]): boolean {
  if (pending.some((t) => t.sourceId === source && t.abilityRef.key === key)) return true;
  return g.s.zones.stack.some((id) => {
    const o = g.s.objects[id];
    return o?.kind === 'ability' && o.stack?.kind === 'triggered' && o.stack.sourceId === source && o.stack.abilityRef?.key === key;
  });
}

/** The key, in the source's `chosen` record, of "this state trigger was removed from the stack and its state has not been false since" (see `suppressStateTrigger`). */
const offKey = (abilityKey: string): string => `stateOff:${abilityKey}`;

/**
 * CR 603.8 + 603.3c-d: a state trigger whose modes or targets could not be chosen was removed from the stack. Its state is still true, so by the letter of
 * CR 603.8 it would trigger again at once, forever (a mandatory loop, CR 104.4b). The engine does not end the game over it: the ability stays quiet until its
 * state has been false at least once, or its source is a new object (CR 400.7: the record lives on the object).
 */
export function suppressStateTrigger(g: Game, sourceId: ObjectId, abilityKey: string | undefined): void {
  const o = g.s.objects[sourceId];
  if (o && abilityKey !== undefined) (o.chosen ??= {})[offKey(abilityKey)] = true;
}

/**
 * CR 603.8: "when/whenever [state]": triggers as soon as the game state matches and goes on the stack at the next opportunity. The "has a copy on the stack" flag
 * the design speaks of is not stored: it is read from the stack and from the triggers still waiting, so it is cleared by construction when the ability leaves.
 * A condition this build cannot evaluate never triggers (its card is manual, `cond:` capability, so it does not get here with one).
 */
export const checkStateTriggers: CheckStateTriggers = (g) => {
  const out: PendingTrigger[] = [];
  if (!triggersPossible(g.s)) return out; // WP32: no definition of the game has a triggered ability (possible.ts)
  for (const cand of candidatesFor(g, [])) {
    if (cand.snapshot || g.player(cand.controller).hasLost) continue;
    for (const ab of triggeredAbilitiesOf(cand)) {
      if (ab.def.kind !== 'triggered') continue;
      const states = ab.def.trigger.on.filter((p): p is Extract<EventPattern, { ev: 'state' }> => p.ev === 'state');
      if (states.length === 0) continue;
      if (hasCopy(g, cand.id, ab.info.key, [...g.s.pendingTriggers, ...out])) continue;
      const env = { source: { id: cand.id, zone: cand.zone }, controller: cand.controller, event: null };
      const off = offKey(ab.info.key);
      if (!states.some((p) => holds(g, p.cond, env) === true)) {
        if (cand.obj.chosen && off in cand.obj.chosen) delete cand.obj.chosen[off]; // the state was false: it may trigger again
        continue;
      }
      if (cand.obj.chosen?.[off] === true) continue; // removed from the stack for lack of a legal choice, and the state has not changed since
      if (ab.def.interveningIf && holds(g, ab.def.interveningIf, env) === false) continue; // CR 603.4
      out.push({
        id: `t${g.s.counters.effect++}`, sourceId: cand.id, sourceName: cand.chars.name, controller: cand.controller,
        abilityRef: { source: ab.info.origin, face: ab.info.face, index: ab.info.index, key: ab.info.key },
        context: { ev: 'state', roles: {}, before: {} },
      });
      g.log(`${cand.chars.name} triggers (state trigger): ${ab.def.text}`, { rules: ['CR 603.8'], level: 'info' });
    }
  }
  return out;
};
