/**
 * The suspend special action's performer (CR 702.62a, 116.2f), installed into core/special/suspend.ts when this module loads (that module can import neither
 * the cost payer nor the zone mover: see its file comment). Owner: std-rx22.
 *
 * Paying the suspend cost and exiling the card are one special action (CR 116.2f): the cost is paid with cancellable decisions (cancelling reverses the whole
 * action, CR 733.1), then the card is exiled from the hand and the card in exile gets its time counters (CR 702.62a: "exile it with N time counters on it"),
 * which makes it suspended (CR 702.62b). A replacement effect that sends the card elsewhere leaves nothing suspended: the counters go only on a card in exile.
 */
import type { Game } from '../../core/game';
import { installSuspend, type SuspendTerms } from '../../core/special/suspend';
import type { CostDef } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import { formatManaCost } from '../../types/mana';
import { costHasX, planDenial, planFromCostDef, type CostPlan } from '../../rules/cost';
import { resolveAnyCounts } from '../../rules/pay';
import { performEffectPayment } from '../perform';
import { proposeResult } from '../propose';

/** The plan of a suspend cost: mana for this special action (not a spell or an ability, CR 116.2f; the card is the source, as for plot), CR 106.6. */
const planOf = (cost: CostDef, id: ObjectId): CostPlan => ({ ...planFromCostDef(cost, 0), spend: { kind: 'special', id } });

function performSuspend(g: Game, player: PlayerId, id: ObjectId, terms: SuspendTerms): void {
  const name = g.nameOf(id);
  const what = `suspending ${name}`;
  performEffectPayment(g, player, id, resolveAnyCounts(g, player, id, planOf(terms.cost, id), what), what); // CR 702.62a: pay [cost]
  // CR 702.62a: exile it, as a proposed zone change (design 8.5: only the performers move objects; a replacement effect applies, CR 614)
  const from = g.s.objects[id]?.zone;
  const r = from === undefined ? null : proposeResult(g, { ev: 'zoneChange', object: { id, zone: from }, from, to: 'exile', destination: { cause: 'suspend' } });
  const n = r?.newIds[0];
  const o = n !== undefined ? g.s.objects[n] : undefined;
  const exiled = o !== undefined && o.zone === 'exile';
  // CR 702.62a: "with N time counters on it", as a proposed event (design 8.5: the performer puts them; a replacement effect applies, CR 614)
  if (exiled) proposeResult(g, { ev: 'counters', change: 'put', on: { id: o.id, zone: 'exile' }, kind: 'time', count: terms.amount, by: player });
  g.log(exiled
    ? `${g.player(player).name} suspends ${name} for ${terms.cost.mana ? formatManaCost(terms.cost.mana) : 'its suspend cost'}: it is exiled with ${terms.amount} time counter${terms.amount === 1 ? '' : 's'} on it.`
    : `${g.player(player).name} pays to suspend ${name}, but it was not exiled, so it is not suspended.`, { rules: ['CR 116.2f', 'CR 702.62a', 'CR 702.62b'], level: 'action' });
}

installSuspend({
  // a suspend cost with X is not offered (X would have to be chosen as the action is taken, CR 107.3a)
  payable: (s, player, id, cost) => !costHasX(cost) && planDenial(s, player, id, planOf(cost, id)) === null,
  perform: performSuspend,
});
