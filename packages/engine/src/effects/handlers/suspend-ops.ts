/**
 * The suspend special action's performer (CR 702.62a, 116.2f), installed into core/special/suspend.ts when this module loads (that module can import neither
 * the cost payer nor the zone mover: see its file comment). Owner: std-rx22.
 *
 * Paying the suspend cost and exiling the card are one special action (CR 116.2f): the cost is paid with cancellable decisions (cancelling reverses the whole
 * action, CR 733.1), then the card is exiled from the hand and the card in exile gets its time counters (CR 702.62a: "exile it with N time counters on it"),
 * which makes it suspended (CR 702.62b). A replacement effect that sends the card elsewhere leaves nothing suspended: the counters go only on a card in exile.
 */
import type { Game } from '../../core/game';
import type { GameState } from '../../types/state';
import { installSuspend, type SuspendTerms } from '../../core/special/suspend';
import type { CostDef } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import { formatManaCost } from '../../types/mana';
import { costFilterHasX, costHasX, payableXs, planDenial, planFromCostDef, type CostPlan } from '../../rules/cost';
import { IllegalAction } from '../../core/game';
import { resolveAnyCounts } from '../../rules/pay';
import { performEffectPayment } from '../perform';
import { proposeResult } from '../propose';

/** The plan of a suspend cost: mana for this special action (not a spell or an ability, CR 116.2f; the card is the source, as for plot), CR 106.6. */
const planOf = (cost: CostDef, id: ObjectId, x = 0): CostPlan => ({ ...planFromCostDef(cost, x), spend: { kind: 'special', id } });

/** edhn81 (CR 107.3a, 601.2b-style announcement of X): the values of X (at least `min`) whose cost this player can pay now. */
function payableSuspendXs(s: GameState, player: PlayerId, id: ObjectId, terms: SuspendTerms): number[] {
  return payableXs((n) => planDenial(s, player, id, planOf(terms.cost, id, n)) === null, costFilterHasX(terms.cost)).filter((n) => n >= (terms.x?.min ?? 0));
}

function performSuspend(g: Game, player: PlayerId, id: ObjectId, terms: SuspendTerms): void {
  const name = g.nameOf(id);
  const what = `suspending ${name}`;
  // edhn81 (CR 702.62a, 107.3a): "Suspend X": X is chosen as the action is taken, then the cost is paid with it and the card gets X time counters
  let amount = terms.amount;
  if (terms.x) {
    const xs = payableSuspendXs(g.s, player, id, terms);
    if (xs.length === 0) throw new IllegalAction(`You can't pay to suspend ${name} with any value of X.`, ['CR 702.62a', 'CR 107.3a']);
    // as actions/announce.ts#chooseX (that module may not be imported from effects/): the values between the least and the most, a value that can't be paid refused
    const min = xs[0]!;
    const max = xs[xs.length - 1]!;
    amount = max <= min ? max : g.choose({ kind: 'chooseNumber', player, prompt: `Choose a value for X for ${what}.`, min, max, cancellable: true, rules: ['CR 702.62a', 'CR 107.3a'] }).n;
    if (!xs.includes(amount)) throw new IllegalAction(`You can't pay to suspend ${name} with X = ${amount}.`, ['CR 107.3a', 'CR 601.2h']);
  }
  performEffectPayment(g, player, id, resolveAnyCounts(g, player, id, planOf(terms.cost, id, terms.x ? amount : 0), what), what); // CR 702.62a: pay [cost]
  // CR 702.62a: exile it, as a proposed zone change (design 8.5: only the performers move objects; a replacement effect applies, CR 614)
  const from = g.s.objects[id]?.zone;
  const r = from === undefined ? null : proposeResult(g, { ev: 'zoneChange', object: { id, zone: from }, from, to: 'exile', destination: { cause: 'suspend' } });
  const n = r?.newIds[0];
  const o = n !== undefined ? g.s.objects[n] : undefined;
  const exiled = o !== undefined && o.zone === 'exile';
  // CR 702.62a: "with N time counters on it", as a proposed event (design 8.5: the performer puts them; a replacement effect applies, CR 614)
  if (exiled) proposeResult(g, { ev: 'counters', change: 'put', on: { id: o.id, zone: 'exile' }, kind: 'time', count: amount, by: player });
  g.log(exiled
    ? `${g.player(player).name} suspends ${name} for ${terms.cost.mana ? formatManaCost(terms.cost.mana) : 'its suspend cost'}: it is exiled with ${amount} time counter${amount === 1 ? '' : 's'} on it.`
    : `${g.player(player).name} pays to suspend ${name}, but it was not exiled, so it is not suspended.`, { rules: ['CR 116.2f', 'CR 702.62a', 'CR 702.62b'], level: 'action' });
}

installSuspend({
  // a cost with X is offered only for "Suspend X" (X chosen as the action is taken, CR 107.3a; SuspendTerms.x), when some X can be paid
  payable: (s, player, id, terms) => (terms.x ? payableSuspendXs(s, player, id, terms).length > 0 : !costHasX(terms.cost) && planDenial(s, player, id, planOf(terms.cost, id)) === null),
  perform: performSuspend,
});
