/**
 * Op handlers of round edh-combat-7 (Commander lane edh-combat), in a table of their own so the WP-owned tables keep their pinned contents (design 5.2: `op:<op>` is a capability
 * because it has a handler here AND a renderer). Ops: controlBlocks (CR 509.1, 723.1; Odric, Master Tactician; edh-d-90: its "this turn" form, Brutal Hordechief).
 */
import type { OpHandlers, StepResult } from '../api';
import { resolveRecipients } from '../refs';
import { chooseDeclarationsThisTurn } from '../../core/combat';

const NOTHING: StepResult = { performed: false, count: 0 };

export const EDH_CB7_HANDLERS: OpHandlers = {
  /**
   * "You choose which creatures block this combat and how those creatures block": from now until blockers are declared the declare blockers decisions of this combat are made by the
   * player (core/combat.ts#declareBlockers names them in `Decision.decidedBy`). Nothing happens outside a declare attackers step or before (the creature's attack trigger resolves
   * there) or once blockers were declared: the effect only concerns the declaration that is still to come.
   */
  controlBlocks: (cx, st) => {
    const g = cx.g;
    const combat = g.s.combat;
    const [who] = resolveRecipients(cx, st.who).players;
    // edh-d-89 (CR 509.1a, 723.1; Master Warcraft): "which creatures block THIS TURN": every declare blockers step of the rest of the turn (core/combat.ts#declareBlockers), whatever the step now
    if (st.turn === true) {
      if (who === undefined) return NOTHING;
      chooseDeclarationsThisTurn(g, 'block', who);
      g.log(`${g.player(who).name} will choose which creatures block this turn and how those creatures block (${g.nameOf(cx.source.id)}).`, { rules: ['CR 509.1', 'CR 723.1'], level: 'action' });
      return { performed: true, count: 1 };
    }
    if (!combat || who === undefined || (g.s.turn.step !== 'declareAttackers' && g.s.turn.step !== 'beginCombat')) return NOTHING;
    combat.blocksBy = who;
    g.log(`${g.player(who).name} will choose which creatures block this combat and how those creatures block (${g.nameOf(cx.source.id)}).`, { rules: ['CR 509.1', 'CR 723.1'], level: 'action' });
    return { performed: true, count: 1 };
  },
};
