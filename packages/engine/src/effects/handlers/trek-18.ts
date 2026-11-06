/**
 * Op handlers of round trek-18 (Star Trek), in a table of their own so the WP-owned tables keep their pinned contents (design 5.2: `op:<op>` is a capability because it
 * has a handler here AND a renderer). Ops: endCombatPhase (CR 724.2; Merciful Mandate), reselectAttack (CR 508.7; Tuvok, Chief Tactical Officer).
 */
import { dropWaitingTriggers, markCombatPhaseEnding } from '../../core/turn-effects';
import { attackableDefenders } from '../../rules/status';
import { controllerOf } from '../../rules/characteristics';
import type { OpHandlers, StepResult } from '../api';
import { propose } from '../propose';
import { resolveObjs } from '../refs';

const NOTHING: StepResult = { performed: false, count: 0 };
const COMBAT_STEPS = ['beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage', 'endCombat'];

/** The value forms of the reselectAttack op this module runs (model/cap-walk.ts emits them; model/capabilities.ts registers them). edh-d-88: "which player" (CR 508.7c). */
export const OP_FORMS: readonly string[] = ['op:reselectAttack.playersOnly'];

export const TREK18_HANDLERS: OpHandlers = {
  /**
   * CR 724.2: end the combat phase. 724.2g: outside a combat phase nothing happens. 724.2a-b as for the turn (pending triggers cease to exist, every object on the
   * stack is exiled, each move proposed so replacements apply); 724.2c-f happen in the turn loop (core/turn.ts#endTheCombatPhase). A turn already ending has nothing left to do.
   */
  endCombatPhase: (cx) => {
    const g = cx.g;
    if (!COMBAT_STEPS.includes(g.s.turn.step) || g.s.turn.ending === true) return NOTHING;
    dropWaitingTriggers(g);
    const onStack = g.s.zones.stack; // read only: the copy below is reversed, not the zone (design 8.5 lint)
    for (const id of [...onStack].reverse()) {
      if (g.s.objects[id]?.zone !== 'stack') continue;
      propose(g, { ev: 'zoneChange', object: { id, zone: 'stack' }, from: 'stack', to: 'exile', destination: {} });
    }
    markCombatPhaseEnding(g);
    g.log(`${g.nameOf(cx.source.id)} ends the combat phase.`, { rules: ['CR 724.2', 'CR 724.2b'], level: 'action' });
    return { performed: true, count: 1 };
  },

  /**
   * CR 508.7: "you may reselect which player or permanent that creature is attacking". The effect's controller chooses, for each attacking creature it names, among the players
   * the creature's controller attacks, and the planeswalkers they control and battles they protect (508.7c-d; none, or only the one it already attacks, is nothing to choose), or
   * keeps it as it is. 508.7a: the creature stays in combat and is not considered to have attacked again (no attack trigger, no tax: 508.7b), and it still counts as having
   * attacked the player or permanent chosen when it was declared (history is untouched). A creature that is not attacking is left alone.
   */
  reselectAttack: (cx, step) => {
    const g = cx.g;
    const combat = g.s.combat;
    if (!combat) return NOTHING;
    let n = 0;
    for (const h of resolveObjs(cx, step.what)) {
      const att = combat.attackers.find((a) => a.id === h.id);
      const o = g.s.objects[h.id];
      if (!att || !o || o.zone !== 'battlefield') continue;
      // edh-d-88 (CR 508.7c; Capricopian): "which player" offers the players only
      const options = attackableDefenders(g, controllerOf(g.s, o)).filter((x) => x.id !== att.defender && (step.playersOnly !== true || x.id === x.player));
      if (options.length === 0) continue;
      const ans = g.choose({
        kind: 'chooseOption', player: cx.controller, prompt: `Reselect what ${g.nameOf(h.id)} is attacking.`, min: 0, max: 1,
        options: options.map(({ id, label }) => ({ id, label })), rules: ['CR 508.7'],
      });
      const pick = options.find((x) => x.id === ans.ids[0]);
      if (!pick) continue;
      att.defender = pick.id;
      att.defendingPlayer = pick.player;
      n++;
      g.log(`${g.nameOf(h.id)} is now attacking ${pick.label}.`, { rules: ['CR 508.7', 'CR 508.7a'], level: 'action' });
    }
    return { performed: n > 0, count: n };
  },
};
