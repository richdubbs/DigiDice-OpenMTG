/**
 * The companion special action's performer (CR 702.139a, 116.2g), installed into core/special/companion.ts when this module loads (that module can import
 * neither the cost payer nor the zone mover: see its file comment). Owner: CMP1.
 *
 * Paying {3} and putting the card into the hand are one special action (CR 116.2g): the cost is paid with cancellable decisions (cancelling reverses the
 * whole action, CR 733.1), then the companion comes into the game from outside it into its owner's hand as a new object (CR 400.11b, 702.139c;
 * effects/perform-direct.ts#performBringIntoGame, as learn does) and `CompanionRec.inHand` records the turn (CR 116.2g: once per game). The mana is spent on a special action,
 * neither a spell nor an ability (CR 116.2), so mana that may be spent only on spells or abilities (CR 106.6) does not pay it: the plan names no spend
 * context, which rules/sources.ts#spendAllows reads as exactly that.
 */
import type { Game } from '../../core/game';
import { COMPANION_COST, installCompanion } from '../../core/special/companion';
import type { PlayerId } from '../../types/ids';
import { planDenial, planFromCostDef, type CostPlan } from '../../rules/cost';
import { performEffectPayment } from '../perform';
import { performBringIntoGame } from '../perform-direct';

const plan = (): CostPlan => planFromCostDef(COMPANION_COST, 0);

function performCompanion(g: Game, player: PlayerId): void {
  const rec = g.player(player).companion!;
  const name = g.s.defs[rec.defId]?.name ?? 'their companion';
  const what = `putting ${name} into your hand (companion)`;
  performEffectPayment(g, player, null, plan(), what); // CR 702.139a: pay {3}
  const id = performBringIntoGame(g, player, rec.defId); // CR 702.139a: put that card into your hand
  rec.inHand = g.s.turn.number; // CR 116.2g: only once per game
  g.log(
    id !== null
      ? `${g.player(player).name} pays {3} and puts their companion ${name} into their hand.`
      : `${g.player(player).name} pays {3}, but their companion ${name} is no longer outside the game.`,
    { rules: ['CR 116.2g', 'CR 702.139a'], level: 'action' },
  );
}

installCompanion({
  payable: (s, player) => planDenial(s, player, null, plan()) === null,
  perform: performCompanion,
});
