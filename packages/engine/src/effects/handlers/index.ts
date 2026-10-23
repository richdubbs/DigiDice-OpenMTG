/**
 * The op handler table: `OP_HANDLERS = { ...control, ...lifedamage, ... }` (design 8.6). Owner: WP10; WP0 wrote it once, importing every family stub, so
 * the other families (WP12-WP15) fill disjoint files and never touch this one. WP10 added the hand-off below. The `op:` capabilities are the keys that also
 * have a renderer (design 5.2).
 *
 * The table is handed to effects/run.ts when this module loads (`installOpHandlers`): the control family imports `runSteps` from run.ts, so run.ts can't
 * import this module back (design 5.4, no cycles). Whoever resolves (core/resolve.ts) imports this module.
 */
import type { OpHandlers } from '../api';
import { installOpHandlers } from '../run';
import { CARDS_HANDLERS } from './cards';
import { CONTROL_HANDLERS } from './control';
import { COUNTERS_HANDLERS } from './counters';
import { GAME_HANDLERS } from './game';
import { LASTING_HANDLERS } from './lasting';
import { LEVELS_HANDLERS } from './levels';
import { LIFEDAMAGE_HANDLERS } from './lifedamage';
import { TOKENS_HANDLERS } from './tokens';
import { ZONES_HANDLERS } from './zones';
import { OUTSIDE_HANDLERS } from './outside';
import { R4_FXB_HANDLERS } from './r4-fxb';
import { NEW_TARGETS_HANDLERS } from './new-targets';
import { NEXT_SPELL_HANDLERS } from './next-spell';
import { REPORT_ACTION_HANDLERS } from './report-action';
import { BECOME_BLOCKED_HANDLERS } from './become-blocked';
import './plot-ops'; // FAST5X E6: installs the plot special action's performer (core/special/plot.ts)
import './foretell-ops'; // cloud r3-mech: installs the foretell special action's performer (core/special/foretell.ts, CR 702.143a)
import './suspend-ops'; // std-rx22: installs the suspend special action's performer (core/special/suspend.ts, CR 702.62a)
import './companion-ops'; // CMP1: installs the companion special action's performer (core/special/companion.ts)

export const OP_HANDLERS: OpHandlers = {
  ...CONTROL_HANDLERS,
  ...LIFEDAMAGE_HANDLERS,
  ...COUNTERS_HANDLERS,
  ...CARDS_HANDLERS,
  ...ZONES_HANDLERS,
  ...TOKENS_HANDLERS,
  ...LASTING_HANDLERS,
  ...GAME_HANDLERS,
  ...LEVELS_HANDLERS, // M6-6 INTERFACE CHANGE: designateObject (CR 716.2a, 719.3b, 722.3a-b)
  ...OUTSIDE_HANDLERS, // cloud r3-mech: fromOutside (CR 400.11b)
  ...R4_FXB_HANDLERS, // r4-fxb: changeTarget (CR 115.7a), extraStep (CR 500.9)
  ...NEW_TARGETS_HANDLERS, // E3XP: chooseNewTargets (CR 115.7d)
  ...NEXT_SPELL_HANDLERS, // Standard round 10: nextSpell (CR 601.2i, 611.2)
  ...REPORT_ACTION_HANDLERS, // std-mana-12: reportAction (CR 603.2; earthbend, firebend)
  ...BECOME_BLOCKED_HANDLERS, // p2-combat-flow-2: becomeBlocked (CR 509.1h)
};

installOpHandlers(OP_HANDLERS);
