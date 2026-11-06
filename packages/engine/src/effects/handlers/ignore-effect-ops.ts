/**
 * edh-next-143: the performer of the "pay to ignore this effect" special action (CR 116.2d; core/special/ignore-effect.ts), installed there when this module loads (that module can
 * import neither the cost payer nor the effects: as effects/handlers/companion-ops.ts). The cost is paid with cancellable decisions (cancelling reverses the whole action, CR 733.1);
 * the mana is spent on a special action, neither a spell nor an ability (CR 116.2), so the plan names no spend context. Then the player is recorded for that object and turn.
 */
import type { Game } from '../../core/game';
import { installIgnoreEffect, recordIgnored } from '../../core/special/ignore-effect';
import { planDenial, planFromCostDef } from '../../rules/cost';
import { performEffectPayment } from '../perform';

installIgnoreEffect({
  payable: (s, player, cost) => planDenial(s, player, null, planFromCostDef(cost, 0)) === null,
  perform: (g: Game, player, source, cost) => {
    const name = g.nameOf(source);
    performEffectPayment(g, player, null, planFromCostDef(cost, 0), `ignoring ${name}'s effect until end of turn`); // CR 116.2d
    recordIgnored(g, source, player);
    g.log(`${g.player(player).name} pays to ignore ${name}'s effect until end of turn.`, { rules: ['CR 116.2d'], level: 'action' });
  },
});
