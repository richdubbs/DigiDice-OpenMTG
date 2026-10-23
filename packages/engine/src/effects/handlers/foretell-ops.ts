/**
 * The foretell special action's performer (CR 702.143a-b, 116.2h), installed into core/special/foretell.ts when this module loads (that module can import
 * neither the cost payer nor the zone mover: see its file comment). Owner: cloud r3-mech.
 *
 * Paying {2} and exiling the card are one special action (CR 116.2h): the cost is paid with cancellable decisions (cancelling reverses the whole action,
 * CR 733.1), then the card is exiled face down from the hand (CR 406.3) and the card in exile becomes foretold (`chosen.foretold` = this turn, CR 702.143a).
 * Its owner may look at it (CR 406.3, `revealedTo`). A replacement effect that sends the card elsewhere leaves nothing foretold (only a card in exile is).
 */
import type { Game } from '../../core/game';
import { FORETELL_ACTION_COST, FORETOLD_KEY, installForetell } from '../../core/special/foretell';
import type { ObjectId, PlayerId } from '../../types/ids';
import { planDenial, planFromCostDef, type CostPlan } from '../../rules/cost';
import { resolveAnyCounts } from '../../rules/pay';
import { performEffectPayment } from '../perform';
import { performExiledSeers } from '../perform-direct';
import { proposeResult } from '../propose';

/** The plan of {2}: mana for this special action (not a spell or an ability, CR 116.2h; the card is the source, as for plot), CR 106.6. */
const planOf = (id: ObjectId): CostPlan => ({ ...planFromCostDef(FORETELL_ACTION_COST, 0), spend: { kind: 'special', id } });

function performForetell(g: Game, player: PlayerId, id: ObjectId): void {
  const name = g.nameOf(id);
  const what = 'foretelling a card'; // CR 406.3, 400.2: the card stays hidden from the other players (the payment's prompts and log lines are public)
  performEffectPayment(g, player, id, resolveAnyCounts(g, player, id, planOf(id), what), what); // CR 702.143a: pay {2}
  // CR 702.143a: exile this card from your hand face down, as a proposed zone change (design 8.5; a replacement effect applies, CR 614)
  const from = g.s.objects[id]?.zone;
  const r = from === undefined ? null : proposeResult(g, { ev: 'zoneChange', object: { id, zone: from }, from, to: 'exile', destination: { cause: 'foretell', faceDown: true } });
  const n = r?.newIds[0];
  const o = n !== undefined ? g.s.objects[n] : undefined;
  const foretold = o !== undefined && o.zone === 'exile' && o.faceDown;
  if (foretold) {
    o.chosen = { ...(o.chosen ?? {}), [FORETOLD_KEY]: g.s.turn.number };
    performExiledSeers(g, [o.id], [o.owner]); // CR 406.3: its owner may look at it
  }
  g.log(foretold
    ? `${g.player(player).name} foretells a card: it is exiled face down and may be cast for its foretell cost on a later turn.`
    : `${g.player(player).name} pays to foretell a card, but it was not exiled face down, so it is not foretold.`,
  { rules: ['CR 116.2h', 'CR 702.143a'], level: 'action', ...(foretold ? { privateText: { players: [player], text: `${g.player(player).name} foretells ${name}.` } } : {}) });
}

installForetell({
  payable: (s, player, id) => planDenial(s, player, id, planOf(id)) === null,
  perform: performForetell,
});
