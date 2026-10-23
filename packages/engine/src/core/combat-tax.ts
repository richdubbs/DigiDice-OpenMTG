/**
 * r5-static: paying the costs to attack or block (CR 508.1h-j, 509.1d-f). statics/combat-tax.ts says what a declaration costs; here the declaring player
 * pays it or declares again.
 *
 *   - CR 508.1h / 509.1d: the total cost is determined once the declaration is legal (every effect adds its share).
 *   - The player isn't required to pay (CR 508.1d, 509.1c: "the player may choose not to pay"): they are asked, and a player who doesn't pay declares again
 *     (CR 733: the illegal declaration is reversed; nothing was paid or tapped yet). A total the player can't pay rejects the declaration at once (CR 118.3).
 *   - CR 508.1f comes first: attacking creatures are tapped before the cost is paid, so an attacker without vigilance can't tap for the mana. Payability is
 *     judged on the state with those creatures tapped.
 *   - CR 508.1i-j / 509.1e-f: mana abilities may be activated, then the cost is paid. The payment decision is not cancellable: this is a turn-based action,
 *     whose cancel would reach back to the action that began the step; declining is done before paying.
 *   - A share that can't be determined (statics/combat-tax.ts `cost: null`) is the players' to settle: a manual log line, never a free attack.
 */
import type { CostDef } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import type { CombatTax } from '../statics/combat-tax';
import { cloneState } from '../util/clone';
import { canonicalManaSymbols, costText, planDenial, planFromCostDefs, type CostPlan } from '../rules/cost';
import { payPlan } from '../rules/pay';
import { IllegalAction, type DecisionInput, type Game } from './game';

/** What the player decided about the cost of a declaration: nothing to pay, pay this plan, or declare again. */
export type TaxDecision = { kind: 'free' } | { kind: 'pay'; plan: CostPlan; text: string; label: string } | { kind: 'again' };

const RULES = { attack: ['CR 508.1h', 'CR 508.1i', 'CR 508.1j'], block: ['CR 509.1d', 'CR 509.1e', 'CR 509.1f'] } as const;

/** The game as the payer sees it while paying a turn-based cost: the payment decision can't be cancelled (CR 733.1 reverses actions, not this step). */
function nonCancellable(g: Game): Game {
  return new Proxy(g, {
    get(target, prop) {
      if (prop === 'choose') return (input: DecisionInput) => target.choose({ ...input, cancellable: false } as DecisionInput);
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
    set: (target, prop, value) => Reflect.set(target, prop, value, target),
  });
}

/**
 * Determine the cost of a legal declaration and ask the player whether they pay it (CR 508.1h, 509.1d). `tapping`: the creatures the declaration taps
 * (CR 508.1f), tapped in the copy of the state payability is judged on. Throws IllegalAction when the player can't pay (the declaration is rejected and the
 * decision stays open, CR 733).
 */
export function decideTax(g: Game, player: PlayerId, kind: 'attack' | 'block', taxes: readonly CombatTax[], tapping: readonly ObjectId[]): TaxDecision {
  if (taxes.length === 0) return { kind: 'free' };
  const rules = [...RULES[kind]];
  const verb = kind === 'attack' ? 'Attacking' : 'Blocking';
  for (const t of taxes.filter((x) => x.cost === null)) {
    g.log(`${t.sourceName}: the cost of ${kind === 'attack' ? 'attacking' : 'blocking'} with ${g.nameOf(t.creature)} is not paid by the engine (${t.why ?? 'unknown'}); settle it by hand.`, { rules, level: 'manual' });
  }
  const costs = taxes.flatMap((t) => (t.cost === null ? [] : [t.cost]));
  if (costs.length === 0) return { kind: 'free' };
  const summed = planFromCostDefs(costs as CostDef[], 0);
  const plan = { ...summed, mana: canonicalManaSymbols(summed.mana) }; // {2} twice is {4} (CR 508.1h: the total)
  const text = costText(plan);
  const shares = [...new Set(taxes.filter((t) => t.cost !== null).map((t) => `${t.sourceName}: ${g.nameOf(t.creature)}`))].join(', ');
  const label = `${kind === 'attack' ? 'attacking' : 'blocking'} (${shares})`;
  const after = cloneState(g.s);
  for (const id of tapping) {
    const o = after.objects[id];
    if (o) o.tapped = true;
  }
  const denial = planDenial(after, player, null, plan);
  if (denial) throw new IllegalAction(`${verb} this way costs ${text} (${shares}), which you can't pay: ${denial.message}`, ['CR 118.3', ...rules]);
  const yes = g.choose({
    kind: 'yesNo', player, prompt: `${verb} this way costs ${text} (${shares}). Pay it, or declare again?`, yesLabel: `Pay ${text}`, noLabel: 'Declare again', rules,
  }).yes;
  if (!yes) {
    g.log(`${g.player(player).name} doesn't pay ${text} and declares again.`, { rules: [...rules, 'CR 733.1'], level: 'action' });
    return { kind: 'again' };
  }
  return { kind: 'pay', plan, text, label };
}

/** CR 508.1i-j, 509.1e-f: pay a cost the player chose to pay (after the attackers were tapped, CR 508.1f). */
export function payTax(g: Game, player: PlayerId, kind: 'attack' | 'block', d: TaxDecision): void {
  if (d.kind !== 'pay') return;
  payPlan(nonCancellable(g), player, null, d.plan, d.label, {});
  g.log(`${g.player(player).name} pays ${d.text} for ${d.label}.`, { rules: [...RULES[kind]], level: 'action' });
}
