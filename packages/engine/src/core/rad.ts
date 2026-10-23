/**
 * Rad counters (CR 122.1i, 728; std-rx17, cites from memory, unverified): "At the beginning of each player's precombat main phase, if that player has one or more
 * rad counters, that player mills cards equal to the number of rad counters they have. For each nonland card milled this way, that player loses 1 life and removes
 * one rad counter." A triggered ability with no source (CR 728.1), like the monarch's (core/designations.ts): it uses the stack, its "if" is checked again as it
 * resolves (CR 603.4), and the count is read then (the counters the player has as it resolves, CR 608.2h).
 */
import type { AbilityDef, Quantity } from '../types/ability';
import type { PlayerId } from '../types/ids';
import type { PendingTrigger } from '../types/state';
import type { Game } from './game';

/** The counter kind (CR 122.1i); `counter:rad` is registered by model/capabilities.ts from this list. */
export const RAD_COUNTER_KINDS: readonly string[] = Object.freeze(['rad']);

/** The rad counters' triggered ability has no source (CR 728.1), as the monarch's (designations.ts#MONARCH_SOURCE): an id that is never an object's. */
export const RAD_SOURCE = 'rule:rad';

/** CR 728.1: the ability of one player (the step's `as` names the cards milled; only the nonland ones count). */
export function radAbility(player: PlayerId): AbilityDef {
  const who = { ref: 'fixed' as const, players: [player] };
  const rads: Quantity = { q: 'counters', on: who, kind: 'rad' };
  const nonland: Quantity = { q: 'count', of: { ref: 'each', filter: { notTypes: ['Land'], is: { ref: 'bound', name: 'radMilled' }, zone: 'any' } } };
  return {
    kind: 'triggered',
    text: 'At the beginning of your precombat main phase, if you have one or more rad counters, mill cards equal to the number of rad counters you have. For each nonland card milled this way, you lose 1 life and remove a rad counter.',
    trigger: { on: [] },
    interveningIf: { cond: 'compare', left: rads, op: '>=', right: 1 }, // CR 603.4: checked again as it resolves (effects/run.ts)
    effect: {
      targets: [],
      steps: [
        { op: 'mill', who, count: rads, as: 'radMilled' },
        { op: 'loseLife', who, amount: nonland },
        { op: 'removeCounters', from: who, kind: 'rad', count: nonland },
      ],
    },
  };
}

/** CR 728.1: as the active player's precombat main phase begins, the ability triggers if they have one or more rad counters (core/registries.ts#TURN_BASED). */
function radTrigger(g: Game): void {
  const ap = g.s.turn.activePlayer;
  const p = g.player(ap);
  if (p.hasLost || (p.counters['rad'] ?? 0) <= 0) return;
  const ability = radAbility(ap);
  const t: PendingTrigger = {
    id: `t${g.s.counters.effect++}`,
    sourceId: RAD_SOURCE,
    sourceName: 'Rad counters',
    controller: ap,
    abilityRef: { source: 'rule', face: 0, index: -1, key: 'rad:mill' },
    context: { ev: 'state', roles: {}, before: {} },
    inline: ability,
  };
  g.s.pendingTriggers.push(t);
  g.log(`The rad counters' triggered ability triggers: ${ability.text}`, { rules: ['CR 728.1'], level: 'info' });
}

export const RAD_PRECOMBAT_MAIN: readonly ((g: Game) => void)[] = [radTrigger];
