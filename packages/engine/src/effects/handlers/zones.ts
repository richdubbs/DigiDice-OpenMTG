/**
 * Op handlers: moving and changing objects (CR 701.3-701.8, 701.12, 701.19, 701.21, 701.26, 701.27, 702.26, 506.4). Owner: WP14. The aggregator
 * (handlers/index.ts) spreads this table into OP_HANDLERS; the capability `op:<op>` appears only when the op has a handler here AND a renderer (design 5.2), so
 * an unfinished package can never make a card wrongly automated. Value forms this build does not run (`op:move.until`, `op:exchange.control`, ...) are named by
 * the capability walker and resolved by hand at run time.
 * Ops: move destroy sacrifice sacrificeChoice counter tap untap attach changeFace phaseOut regenerate removeFromCombat exchange.
 *
 * Files: zones-move.ts (move), zones-remove.ts (destroy, sacrifice, sacrificeChoice, counter), zones-status.ts (tap, untap, attach, changeFace, phaseOut,
 * regenerate, removeFromCombat, exchange), zones-util.ts (the stages every handler shares).
 */
import type { OpHandlers } from '../api';
import { move } from './zones-move';
import { counter, destroy, sacrifice, sacrificeChoice } from './zones-remove';
import { attach, exchange, phaseOut, regenerate, removeFromCombat, tap, untap } from './zones-status';
import { changeFace } from './change-face'; // M6-0: the CHANGE_FACE dispatch (m6 design 2.6)

export const ZONES_HANDLERS: OpHandlers = {
  move, destroy, sacrifice, sacrificeChoice, counter, tap, untap, attach, changeFace, phaseOut, regenerate, removeFromCombat, exchange,
};
