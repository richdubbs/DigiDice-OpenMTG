/**
 * Op handlers of round edh-d-89 (Commander coordinator D, EDHREC band 5,001-10,000, group combat), in a table of their own so the WP-owned tables keep their pinned contents (design 5.2: `op:<op>` is a
 * capability because it has a handler here AND a renderer). Ops: controlAttacks (CR 508.1a-b, 723.1; Master Warcraft).
 */
import type { OpHandlers, StepResult } from '../api';
import { resolveRecipients } from '../refs';
import { chooseDeclarationsThisTurn } from '../../core/combat';

const NOTHING: StepResult = { performed: false, count: 0 };

export const EDH_D89_HANDLERS: OpHandlers = {
  /**
   * "You choose which creatures attack this turn": from now until the turn ends the declare attackers decisions are made by the player (core/combat.ts#declareAttackers names them in
   * `Decision.decidedBy` and lets the active player choose what each chosen creature attacks, ruling 2008-04-01). The most recent such effect decides (it overwrites `turn.attacksBy`).
   */
  controlAttacks: (cx, st) => {
    const g = cx.g;
    const [who] = resolveRecipients(cx, st.who).players;
    if (who === undefined) return NOTHING;
    chooseDeclarationsThisTurn(g, 'attack', who);
    g.log(`${g.player(who).name} will choose which creatures attack this turn (${g.nameOf(cx.source.id)}).`, { rules: ['CR 508.1a', 'CR 723.1'], level: 'action' });
    return { performed: true, count: 1 };
  },
};
