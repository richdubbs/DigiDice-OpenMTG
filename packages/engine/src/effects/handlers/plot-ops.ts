/**
 * The plot special action's performer (CR 702.170a-b, 116.2k), installed into core/special/plot.ts when this module loads (that module can import neither the
 * cost payer nor the zone mover: see its file comment). Owner: FAST5X E6.
 *
 * Paying the plot cost and exiling the card are one special action (CR 116.2k): the cost is paid with cancellable decisions (cancelling reverses the whole
 * action, CR 733.1), then the card is exiled from the hand and the card in exile becomes plotted (`chosen.plotted` = this turn, CR 702.170a, 702.170d). A
 * replacement effect that sends the card elsewhere leaves nothing plotted (only a card in exile is plotted, CR 702.170a).
 */
import type { Game } from '../../core/game';
import { installPlot, PLOTTED_KEY } from '../../core/special/plot';
import type { CostDef } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import { formatManaCost } from '../../types/mana';
import { costHasX, planDenial, planFromCostDef, type CostPlan } from '../../rules/cost';
import { resolveAnyCounts } from '../../rules/pay';
import { performEffectPayment } from '../perform';
import { proposeResult } from '../propose';

/**
 * The plan of a plot cost: mana for this special action (not a spell or an ability, CR 116.2k; the card is the source, as for turning face up). FAST5X E23
 * (CR 106.6): spent as a special action's cost, so mana restricted to abilities ("Spend this mana only to activate abilities") does not pay it.
 */
const planOf = (cost: CostDef, id: ObjectId): CostPlan => ({ ...planFromCostDef(cost, 0), spend: { kind: 'special', id } });

function performPlot(g: Game, player: PlayerId, id: ObjectId, cost: CostDef): void {
  const name = g.nameOf(id);
  const what = `plotting ${name}`;
  performEffectPayment(g, player, id, resolveAnyCounts(g, player, id, planOf(cost, id), what), what); // CR 702.170a: pay [cost]
  // CR 702.170a: exile this card from your hand, as a proposed zone change (design 8.5: only the performers move objects; a replacement effect applies, CR 614)
  const from = g.s.objects[id]?.zone;
  const r = from === undefined ? null : proposeResult(g, { ev: 'zoneChange', object: { id, zone: from }, from, to: 'exile', destination: { cause: 'plot' } });
  const n = r?.newIds[0];
  const o = n !== undefined ? g.s.objects[n] : undefined;
  const plotted = o !== undefined && o.zone === 'exile';
  if (plotted) {
    o.chosen = { ...(o.chosen ?? {}), [PLOTTED_KEY]: g.s.turn.number };
    g.emit({ type: 'objectDesignation', objectId: o.id, what: 'plotted' }); // "When this card becomes plotted" (CR 702.170a, 603.2; triggers/forms-plot.ts)
  }
  g.log(plotted
    ? `${g.player(player).name} plots ${name} for ${cost.mana ? formatManaCost(cost.mana) : 'its plot cost'}: it is exiled and may be cast without paying its mana cost during a main phase of a later turn of theirs.`
    : `${g.player(player).name} pays to plot ${name}, but it was not exiled, so it is not plotted.`, { rules: ['CR 116.2k', 'CR 702.170a', 'CR 702.170d'], level: 'action' });
}

installPlot({
  // a plot cost with X is not offered (no printed plot cost has one; X would have to be chosen as the action is taken, CR 107.3a)
  payable: (s, player, id, cost) => !costHasX(cost) && planDenial(s, player, id, planOf(cost, id)) === null,
  perform: performPlot,
});
