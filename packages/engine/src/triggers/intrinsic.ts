/**
 * Intrinsic triggered abilities the Comprehensive Rules give a whole class of permanents, which no card prints (FXC, audit C2).
 *
 * CR 310.12b: "Sieges have the intrinsic ability 'When the last defense counter is removed from this permanent, exile it, then you may cast it transformed
 * without paying its mana cost.'" It triggers when a `counters` event removes defense counters from a Siege on the battlefield and leaves it with none (CR
 * 603.2). Because it is then the source of a triggered ability that has not left the stack, the defense-0 state-based action leaves the battle alone until it
 * resolves (CR 310.7, 704.5v; core/sba-objects.ts). Its controller is the Siege's controller as it triggered (CR 603.3a): "you" casts it.
 *
 * The ability is data (an inline TriggeredAbilityDef, as the monarch's inherent triggers in core/designations.ts): exile the Siege, then the `cast` op with
 * `transformed` casts its back face (CR 712.11a, 712.8c) for free (CR 118.9), if its controller wants (CR 608.2d).
 *
 * Pure apart from `g.s.counters.effect` and the log line, like triggers/collect.ts.
 */
import type { Game } from '../core/game';
import type { TriggeredAbilityDef } from '../types/ability';
import type { PendingTrigger, SemEvent } from '../types/state';
import { charsOfObject } from '../rules/characteristics';
import { contextOf } from './context';

export const SIEGE_DEFEAT_KEY = 'rule:siege.defeat';

/** CR 310.12b, as data. `it` is the Siege as it is exiled; the cast finds it in exile (CR 400.7: the new object is bound by the move). */
export const SIEGE_DEFEAT: TriggeredAbilityDef = {
  kind: 'triggered',
  text: 'When the last defense counter is removed from this permanent, exile it, then you may cast it transformed without paying its mana cost.',
  trigger: { on: [] },
  effect: {
    targets: [],
    steps: [
      { op: 'move', what: { ref: 'self' }, to: { zone: 'exile' }, as: 'it' },
      { op: 'cast', who: { ref: 'you' }, what: { ref: 'bound', name: 'it' }, free: true, optional: true, transformed: true },
    ],
  },
};

/** The subject of a `counters` event that removed the last defense counter from an object (CR 310.12b), or undefined. */
function lastDefenseRemoved(e: SemEvent): string | undefined {
  if (e.ev !== 'counters' || e.data['change'] !== 'removed' || e.data['kind'] !== 'defense' || e.data['onPlayer'] === true) return undefined;
  if (e.data['total'] !== 0 || typeof e.data['amount'] !== 'number' || e.data['amount'] <= 0) return undefined;
  const subject = e.roles.subject;
  return subject && 'objects' in subject ? subject.objects[0]?.id : undefined;
}

/** CR 310.12b: the Siege defeat triggers of one batch of semantic events (triggers/stack.ts#collectPendingTriggers adds them). */
export function intrinsicTriggers(g: Game, batch: readonly SemEvent[]): PendingTrigger[] {
  const out: PendingTrigger[] = [];
  for (const e of batch) {
    const id = lastDefenseRemoved(e);
    if (id === undefined) continue;
    const o = g.s.objects[id];
    if (!o || o.zone !== 'battlefield' || o.phasedOut) continue; // it left at the same time: a new object (CR 400.7)
    const chars = charsOfObject(g.s, o);
    if (!chars.types.includes('Battle') || !chars.subtypes.includes('Siege')) continue; // CR 310.12: Sieges only
    if (g.player(o.controller).hasLost) continue;
    out.push({
      id: `t${g.s.counters.effect++}`,
      sourceId: id,
      sourceName: chars.name,
      controller: o.controller, // CR 603.3a
      abilityRef: { source: 'rule', face: 0, index: -1, key: SIEGE_DEFEAT_KEY },
      context: contextOf([e], {}),
      inline: SIEGE_DEFEAT,
    });
    g.log(`${chars.name} triggers: ${SIEGE_DEFEAT.text}`, { rules: ['CR 310.12b', 'CR 603.2'], level: 'info' });
  }
  return out;
}
