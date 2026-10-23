/**
 * Ways to pay part of a spell's mana by doing something else (CR 601.2f-h). Owner: WP7.
 *
 *  - PAYMENT OPTIONS from the keyword library through `hookpoints.paymentOptions` (convoke CR 702.51a, improvise 702.126a, delve 702.66a): "for each generic mana in
 *    the total cost you may [tap / exile] one object rather than pay that mana". They apply only after the total cost is determined and are not additional or
 *    alternative costs (702.51b, 702.66b, 702.126b). An option names ONE pick part (`cost.other[0]`: tap an untapped creature, exile a card from a graveyard) that is
 *    paid once per object, and what each object pays for: `reduces.generic` generic mana (default 1), or one mana of a color the object has when `reduces.colors`
 *    lists it (convoke: a green creature may pay {G}). The caster names the objects, the matching mana is removed from the total, and the objects become a pick part
 *    of the plan that is already chosen, so the usual payment code taps or exiles them before the mana is paid.
 *  - EMERGE (CR 702.119) is not an option here, on purpose (a deviation from design 7.3 / 8.2.6): this contract reduces the mana by a FIXED amount per object, but
 *    "its total cost is reduced by an amount of generic mana equal to the sacrificed creature's mana value" depends on the creature named when the cost is announced
 *    (CR 702.119c). It is read from the alternative cost named "emerge" (a cost with a sacrifice part) in actions/cast.ts using `emergeReduction`, applied to the
 *    TOTAL cost, and `emergePayableCandidates` offers only the creatures that leave the total payable.
 */
import type { CostDef, ObjectFilter } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import type { ManaSymbol } from '../types/mana';
import type { GameState } from '../types/state';
import type { PaymentOption } from '../keywords/types';
import { IllegalAction, type Game } from '../core/game';
import { charsOfObject } from './characteristics';
import { toPlanPart, planDenial, type CostPlan, type PlanPart } from './cost';
import { isPickPart, partCandidates, type PickPart } from './cost-pick';
import type { Denial } from './denial';
import { gameOf, hookpoints } from './hookpoints';
import { overlayAsSpell } from '../statics/rule-sources';

/** Remove up to `n` generic mana from the symbols (CR 118.7a: a generic reduction touches only the generic component). Returns the new symbols and how many were removed. */
export function reduceGeneric(mana: readonly ManaSymbol[], n: number): { mana: ManaSymbol[]; removed: number } {
  let left = n;
  const out: ManaSymbol[] = [];
  for (const sym of mana) {
    if (sym.kind === 'generic' && left > 0) {
      const take = Math.min(left, sym.amount);
      left -= take;
      if (sym.amount - take > 0) out.push({ kind: 'generic', amount: sym.amount - take });
    } else out.push(sym);
  }
  return { mana: out, removed: n - left };
}

/** Remove one colored symbol of `color` (the colored component convoke may pay). */
function reduceColored(mana: readonly ManaSymbol[], color: string): ManaSymbol[] | null {
  const i = mana.findIndex((m) => m.kind === 'colored' && m.color === color);
  return i < 0 ? null : [...mana.slice(0, i), ...mana.slice(i + 1)];
}

/** The pick part an option pays once per object, as a plan part (or null when the option has a shape this build can't pay). */
function optionPart(opt: PaymentOption): PickPart | null {
  const cost: CostDef = opt.cost;
  const raw = cost.other?.[0];
  if (!raw || (cost.other?.length ?? 0) !== 1) return null;
  const part = toPlanPart(raw, 0);
  return isPickPart(part) && (part.kind === 'tapUntapped' || part.kind === 'exileFrom' || part.kind === 'sacrifice' || part.kind === 'returnToHand') ? part : null;
}

/** The objects already named by other parts of the plan (they can't pay twice). */
const takenBy = (plan: CostPlan): Set<ObjectId> => new Set(plan.other.flatMap((p) => ('chosen' in p && p.chosen ? p.chosen : [])));

/** What using `ids` for `opt` does to the mana of `plan`: the reduced symbols, or null if some object pays for nothing (it would be wasted, CR 702.51a). */
function reduction(s: GameState, opt: PaymentOption, mana: readonly ManaSymbol[], ids: readonly ObjectId[]): ManaSymbol[] | null {
  let symbols = [...mana];
  // FAST4 T24 FIX (CR 702.51a, 702.126a, 702.66a): each object pays for {1} of generic mana; `reduces.generic` is what ALL the objects could pay (the convoke
  // hook reports the number of creatures, keywords/hooks/convoke.ts), as `usable` reads it, never the amount ONE object pays (one creature paid the whole {3})
  const perObject = (opt.reduces.generic ?? 1) > 0 ? 1 : 0;
  for (const id of ids) {
    const o = s.objects[id];
    if (!o) return null;
    const colors = charsOfObject(s, o).colors as string[];
    const matching = (opt.reduces.colors ?? []).filter((c) => colors.includes(c));
    let reduced: ManaSymbol[] | null = null;
    for (const c of matching) { reduced = reduceColored(symbols, c); if (reduced) break; } // a colored symbol first: it can't be paid by just any land
    if (!reduced && perObject > 0) {
      const g = reduceGeneric(symbols, perObject);
      if (g.removed > 0) reduced = g.mana;
    }
    if (!reduced) return null;
    symbols = reduced;
  }
  return symbols;
}

/**
 * FXC (audit m1, CR 702.51a, 601.2h): the candidates that could pay for some of `mana` on their own: any object while generic mana is left (for an option that
 * pays generic mana), otherwise only an object of a color the option pays whose symbol is still in the cost (a green creature can't convoke for {R}).
 */
const useful = (s: GameState, opt: PaymentOption, mana: readonly ManaSymbol[], cands: readonly ObjectId[]): ObjectId[] => cands.filter((id) => reduction(s, opt, mana, [id]) !== null);

/** How many objects at most `opt` could pay for in `mana`: the generic mana plus the colored symbols it can pay. */
function usable(mana: readonly ManaSymbol[], opt: PaymentOption): number {
  const generic = (opt.reduces.generic ?? 1) > 0 ? mana.reduce((n, m) => n + (m.kind === 'generic' ? m.amount : 0), 0) : 0;
  const colored = (opt.reduces.colors ?? []).length > 0 ? mana.filter((m) => m.kind === 'colored' && (opt.reduces.colors ?? []).includes(m.color)).length : 0;
  return generic + colored;
}

/**
 * Pure: CR 601.2g-h, could this player pay `plan` for the spell `spellId` if they used the payment options available to it? Used by `castCheck` so a spell that
 * is castable only with convoke or delve is listed. Counts the objects an option could use without naming them (the cost-pick search finds a way).
 */
export function payableWithOptions(s: GameState, player: PlayerId, spellId: ObjectId, plan: CostPlan): Denial | null {
  if (!planDenial(s, player, null, plan)) return null;
  // FAST4 T24: the options of the card AS A SPELL (CR 601.2a: it is on the stack while it is cast), so a payment keyword another object grants to spells
  // ("artifact spells you cast have convoke", CR 613.1f) is seen while the card is still in hand (statics/rule-sources.ts#overlayAsSpell)
  return payableWith(s, player, null, plan, hookpoints.paymentOptions(gameOf(overlayAsSpell(s, spellId, player)), spellId, player));
}

/** `payableWithOptions` for a given list of options; `sourceId` is the object whose cost it is (an activated ability's source, null for a spell). Pure. */
export function payableWith(s: GameState, player: PlayerId, sourceId: ObjectId | null, plan: CostPlan, opts: readonly PaymentOption[]): Denial | null {
  const direct = planDenial(s, player, sourceId, plan);
  if (!direct) return null;
  for (const opt of opts) {
    const part = optionPart(opt);
    if (!part) continue;
    const taken = takenBy(plan);
    const cands = useful(s, opt, plan.mana, partCandidates(s, player, sourceId, part).filter((id) => !taken.has(id)));
    for (let k = Math.min(cands.length, usable(plan.mana, opt)); k >= 1; k--) {
      const mana = reduction(s, opt, plan.mana, cands.slice(0, k));
      const reduced = mana ?? reduceGeneric(plan.mana, k).mana; // colors only help when the objects match; assume generic for the count check
      const trial: CostPlan = { ...plan, mana: reduced, other: [...plan.other, { ...part, count: k } as PlanPart] };
      if (!planDenial(s, player, sourceId, trial)) return null;
    }
  }
  return direct;
}

/**
 * CR 601.2f-h: after the total cost is fixed, the caster may use each payment option available to the spell. For each one the caster names the objects (none
 * to decline); the matching mana leaves the cost and the objects join the plan as an already chosen part. Cancellable. Returns the plan to pay.
 */
export function applyPaymentOptions(g: Game, player: PlayerId, spellId: ObjectId, plan: CostPlan, label: string): CostPlan {
  return applyOptions(g, player, null, plan, label, hookpoints.paymentOptions(gameOf(g.s), spellId, player));
}

/** `applyPaymentOptions` for a given list of options; `sourceId` is the object whose cost it is (an activated ability's source, null for a spell). */
export function applyOptions(g: Game, player: PlayerId, sourceId: ObjectId | null, plan: CostPlan, label: string, opts: readonly PaymentOption[]): CostPlan {
  let current = plan;
  for (const opt of opts) {
    const part = optionPart(opt);
    if (!part) continue;
    const taken = takenBy(current);
    const cands = useful(g.s, opt, current.mana, partCandidates(g.s, player, sourceId, part).filter((id) => !taken.has(id)));
    const max = Math.min(cands.length, usable(current.mana, opt));
    if (max <= 0) continue;
    const ids = g.choose({
      kind: 'chooseObjects', player, prompt: `${opt.describe} to pay part of ${label}? Choose up to ${max} (none to pay all the mana).`, options: cands, min: 0, max, cancellable: true, rules: ['CR 601.2f', 'CR 601.2h'],
    }).ids;
    if (ids.length === 0) continue;
    const mana = reduction(g.s, opt, current.mana, ids);
    if (!mana) throw new IllegalAction(`Each object you choose must pay for some mana of ${label} (${opt.describe}).`, ['CR 601.2h']);
    current = { ...current, mana, other: [...current.other, { ...part, count: ids.length, chosen: [...ids] } as PlanPart] };
    if (planDenial(g.s, player, sourceId, current)) {
      throw new IllegalAction(`With those choices the rest of the cost of ${label} could not be paid.`, ['CR 118.3', 'CR 601.2h']);
    }
    g.log(`${g.player(player).name} pays part of ${label} by choosing ${ids.map((id) => g.nameOf(id)).join(', ')} (${opt.key}).`, { rules: ['CR 601.2h'], level: 'info' });
  }
  return current;
}

/**
 * std-rx27 (CR 601.2f-h, 602.2b): "For each mana in this ability's activation cost, you may tap an untapped creature you control rather than pay that mana."
 * (ActivatedAbilityDef.tapForMana): the option of an activated ability, convoke's way of paying (CR 702.51a) for one generic mana per tapped permanent. The
 * source tapped by a {T} in the same cost is not a candidate (rules/cost-pick.ts). Tapping a permanent this way is not a {T} cost of it, so summoning sickness
 * does not matter (CR 302.6).
 */
export function tapForManaOption(filter: ObjectFilter): PaymentOption {
  return {
    key: 'tapForMana',
    describe: 'Tap untapped permanents rather than pay mana: each pays for {1}',
    reduces: { generic: 1 },
    cost: { other: [{ kind: 'tapUntapped', filter: JSON.parse(JSON.stringify(filter)) as ObjectFilter, count: 'any' }] },
  };
}

/**
 * CR 702.119a: with emerge the total cost is reduced by generic mana equal to the sacrificed permanent's mana value. `id` is the permanent chosen when the
 * emerge cost was announced (CR 702.119c); it becomes the already chosen object of the plan's sacrifice part.
 */
export function emergeReduction(s: GameState, plan: CostPlan, id: ObjectId): CostPlan | null {
  const o = s.objects[id];
  if (!o) return null;
  const i = plan.other.findIndex((p) => p.kind === 'sacrifice' && !p.self);
  if (i < 0) return null;
  const mv = charsOfObject(s, o).manaValue;
  const other = plan.other.map((p, j) => (j === i && p.kind === 'sacrifice' ? { ...p, count: 1, chosen: [id] } : p));
  return { ...plan, mana: reduceGeneric(plan.mana, mv).mana, other };
}

/**
 * The permanents whose sacrifice makes the emerge cost payable: `plan` is the total cost (base + additional costs) with the sacrifice part; each candidate is tried with
 * the reduction by its mana value and every payment option (CR 702.119a, 601.2h). Pure.
 */
export function emergePayableCandidates(s: GameState, player: PlayerId, spellId: ObjectId, plan: CostPlan): ObjectId[] {
  return emergeCandidates(s, player, plan).filter((c) => {
    const reduced = emergeReduction(s, plan, c);
    return reduced !== null && payableWithOptions(s, player, spellId, reduced) === null;
  });
}

/** The permanents that could be sacrificed for the emerge cost of `plan` (CR 702.119a-b). */
export function emergeCandidates(s: GameState, player: PlayerId, plan: CostPlan): ObjectId[] {
  const part = plan.other.find((p) => p.kind === 'sacrifice' && !p.self);
  return part ? partCandidates(s, player, null, part) : [];
}
