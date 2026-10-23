/**
 * The `pay` op (CR 118.12, 118.12a, 119.4): "[who] may pay [cost]. If they do, [then]; if they don't, [else]" and "[else] unless [who] pays [cost]". Owner: WP10
 * (part of the control family, handlers/control.ts).
 *
 * The PAYER decides first (CR 118.12a): a "you may" inside `else` is asked only after the payer declined (Rhystic Study, Mana Leak, design D3). The payer is
 * asked only if they can pay (CR 118.3); the payment uses milestone 3's `payPlan` (mana abilities may be activated while paying, CR 608.2g) with every decision
 * non-cancellable (a resolution can't be taken back, CR 733.1) and the `payCost` decision addressed to the payer (`forPlayer`, origin `unless`/`optional`).
 * `did` on a `pay` step is whether the player chose to pay (CR 118.12), whatever happened afterwards; for a payment of one of two costs, either payment (std-rw8).
 */
import type { DecisionInput, Game } from '../../core/game';
import type { CostDef, CostPart, EffectStep, Quantity } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import type { GameState } from '../../types/state';
import { enumerateAbilities } from '../../rules/abilities';
import { costText, partsDenial, planDenial, planFromCostDefs, type CostPlan } from '../../rules/cost';
import { resolveAnyCounts } from '../../rules/pay';
import type { ExecCtx, StepHandler, StepResult } from '../api';
import { evalQty } from '../eval';
import { resolvePlayers } from '../refs';
import { askManual, notesOf } from '../manual';
import { performEffectPayment, performLink, performRecordDiscarded, performRecordSacrificed } from '../perform';
import { runSteps } from '../run';
import { COND, fixNode } from './lasting-fix';

type PayStep = Extract<EffectStep, { op: 'pay' }>;
type Origin = 'unless' | 'optional';

/**
 * The game as the payer sees it while paying during a resolution: every decision non-cancellable (CR 733.1 lets a player take back a cast or an activation,
 * not a resolution), and the `payCost` decision says who pays and why (CR 118.12a). Everything else is the game itself.
 */
function payingGame(g: Game, payer: PlayerId, origin: Origin): Game {
  return new Proxy(g, {
    get(target, prop) {
      if (prop === 'choose') {
        return (input: DecisionInput) => target.choose({ ...input, cancellable: false, ...(input.kind === 'payCost' ? { forPlayer: payer, origin } : {}) } as DecisionInput);
      }
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
    set: (target, prop, value) => Reflect.set(target, prop, value, target),
  });
}

const QTY_KEYS = ['count', 'amount', 'power', 'arg'] as const;

/** The cost with the computed quantities of its parts fixed now (CR 608.2h). X stays: `planFromCostDefs` substitutes the announced X (CR 107.3a). */
function fixedCost(cx: ExecCtx, cost: CostDef): CostDef {
  if (!cost.other) return cost;
  const other = cost.other.map((part): CostPart => {
    const out: Record<string, unknown> = { ...part };
    // FAST5 T78 (CR 608.2c, 608.2h): "you may sacrifice a permanent other than that creature or this Equipment" names the objects of this resolution in the part's filter
    // (`is`): they are fixed now, as the effect begins, so the plan can be made without the resolution (Saw)
    if ('filter' in part && part.filter !== undefined && JSON.stringify(part.filter).includes('"is":')) out['filter'] = fixNode(cx, part.filter, COND);
    for (const k of QTY_KEYS) {
      const v = out[k];
      if (typeof v !== 'object' || v === null || (v as { q?: unknown }).q === 'X') continue;
      const n = evalQty(cx, v as Quantity);
      if (n !== undefined) out[k] = Math.max(0, n); // CR 107.1b; a quantity that fails to determine stays, and the part is paid by hand
    }
    return out as CostPart;
  });
  return { ...cost, other };
}

/** The source pays its own {T} or "sacrifice this" parts only for its controller; for anyone else the cost has no source. */
function sourceFor(cx: ExecCtx, payer: PlayerId): ObjectId | null {
  const o = cx.g.s.objects[cx.source.id];
  return o && o.zone === cx.source.zone && o.controller === payer ? o.id : null;
}

/**
 * Does the payer control a permanent with a mana ability the engine can't run (a manual ability flagged `mana`, CR 605.3b)? CR 605.3a lets a player activate
 * mana abilities whenever an effect asks for a mana payment, even mid-resolution, so its mana may pay what the engine can't count. Deliberately generous: the
 * full check (actions/activate.ts#manualManaDenial: {T} and summoning sickness, "can't activate") lives in `actions`, which `effects` may not import
 * (design 5.4), and asking a player who then declines is safe where not asking would decide for them.
 */
function hasManualMana(s: GameState, payer: PlayerId): boolean {
  return s.zones.battlefield.some((id) => {
    const o = s.objects[id];
    if (!o || o.controller !== payer || o.phasedOut) return false;
    return enumerateAbilities(s, o).some((a) => a.def.kind === 'manual' && a.def.mana === true);
  });
}

/** std-rx24 (CR 607.2k): the forms of `pay` this handler runs beyond the plain one (model/cap-walk.ts names them): an exile cost part with a `link`. */
export const OP_FORMS: readonly string[] = ['op:pay.costLink', 'op:pay.upTo'];

/**
 * M12-2 (m12 design 4.5): "do you pay?" is a cost decision (CR 800.4f: not paid by a player who left the game, core/game.ts#choose); only a multiplayer game
 * carries the field (D16).
 */
const costAsker = (cx: ExecCtx): { asker?: { kind: 'cost'; controller: PlayerId } } =>
  cx.g.s.options.multiplayer !== undefined ? { asker: { kind: 'cost', controller: cx.controller } } : {};

/**
 * The payment made by hand: the payer chooses to pay (unless it is `mandatory`, CR 119.4: an instruction, no choice), then adjusts the game with manual
 * operations. Returns whether they paid.
 */
function payByHand(cx: ExecCtx, st: PayStep, payer: PlayerId, text: string, why: string, rules: string[]): boolean {
  const g = cx.g;
  const name = g.player(payer).name;
  if (!st.mandatory) {
    const yes = g.choose({
      kind: 'yesNo', player: payer, ...costAsker(cx), prompt: `${notesOf(cx).sourceName}: do you pay ${text}? ${why} If you pay, you pay it by hand.`, yesLabel: 'Pay', noLabel: "Don't pay", rules,
    }).yes;
    if (!yes) {
      g.log(`${name} doesn't pay ${text}.`, { rules, level: 'action' });
      return false;
    }
  }
  g.log(`${name} pays ${text} by hand.`, { rules, level: 'manual' });
  askManual(cx, `${name} pays ${text}.`, 'a cost the engine cannot pay automatically', undefined, { player: payer });
  return true;
}

/** One payer's turn to pay. Returns whether they paid (chose to pay, CR 118.12). */
function offer(cx: ExecCtx, st: PayStep, payer: PlayerId, plan: CostPlan, text: string, origin: Origin): boolean {
  const g = cx.g;
  const name = g.player(payer).name;
  const source = notesOf(cx).sourceName;
  const rules = origin === 'unless' ? ['CR 118.12a'] : ['CR 118.12'];
  if (g.s.options.multiplayer !== undefined && g.player(payer).hasLost) {
    // M12-2 (m12 design 4.5): CR 800.4f, "If an object requires a player who has left the game to pay a cost or choose whether to pay a cost, that cost is not paid."
    g.log(`${name} has left the game: ${text} is not paid.`, { rules: ['CR 800.4f', ...rules], level: 'info' });
    return false;
  }
  // A part this build can't pay automatically (a cost part it can't evaluate, or a CostPart `manual`): the payer still decides, and pays by hand. Never
  // treated as "can't pay".
  const byHand = plan.other.flatMap((p) => (p.kind === 'manual' || p.kind === 'confirm' ? [p.text] : []));
  if (byHand.length > 0) return payByHand(cx, st, payer, text, `The engine can't pay "${byHand.join('", "')}" for you.`, rules);
  const src = sourceFor(cx, payer);
  const denial = planDenial(g.s, payer, src, plan);
  if (denial) {
    if (!partsDenial(g.s, payer, src, plan) && hasManualMana(g.s, payer)) {
      // Only the mana is short, and the payer has mana abilities the engine can't run (CR 605.3a, 605.3b): they may still pay, by hand.
      return payByHand(cx, st, payer, text, "The engine can't count the mana of your mana abilities activated by hand.", [...rules, 'CR 605.3a', 'CR 605.3b']);
    }
    g.log(`${name} can't pay ${text} (${denial.message})`, { rules: ['CR 118.3', ...rules], level: 'info' });
    return false;
  }
  if (!st.mandatory) {
    const yes = g.choose({ kind: 'yesNo', player: payer, ...costAsker(cx), prompt: `${source}: pay ${text}?`, yesLabel: 'Pay', noLabel: "Don't pay", rules }).yes;
    if (!yes) {
      g.log(`${name} doesn't pay ${text}.`, { rules, level: 'action' });
      return false;
    }
  }
  const pg = payingGame(g, payer, origin);
  const label = `${source}'s effect`;
  const paid = performEffectPayment(pg, payer, src, resolveAnyCounts(pg, payer, src, plan, label), label);
  if (cx.stack !== null) performRecordSacrificed(cx.stack, paid.sacrificed ?? []); // FAST5 T78: "the sacrificed creature" of an optional cost (ObjRef costSacrificed)
  if (cx.stack !== null) performRecordDiscarded(cx.stack, paid.discarded ?? []); // CLOUD C8: "the discarded card" of an optional cost (ObjRef costDiscarded)
  // std-rx24 (CR 607.2k, 702.72a): an exile cost with a `link` ("sacrifice it unless you exile another Faerie you control", champion) is remembered by the source
  // of the ability, as long as it is still the object the ability belongs to (effects/perform.ts#performLink); "the exiled card" of its linked ability reads it
  for (const [link, objects] of Object.entries(paid.costLinks ?? {})) performLink(g, cx.source, link, { objects });
  g.log(`${name} pays ${text}.`, { rules, level: 'action' });
  return true;
}

/**
 * CR 118.12, 118.12a. Several payers ("unless any player pays") are offered the payment one at a time in the order `who` gives (APNAP for "each", CR 101.4)
 * until one pays. `times` pays the cost that many times (cumulative upkeep); a count that fails to determine can't be paid (CR 608.2b).
 */
export const payHandler: StepHandler<PayStep> = (cx, st): StepResult => {
  if (st.upTo !== undefined) { // std-combat-2
    const n = payUpTo(cx, st);
    runSteps(cx, (n > 0 ? st.then : st.else) ?? []);
    return { performed: n > 0, count: n };
  }
  const times = st.times === undefined ? 1 : evalQty(cx, st.times);
  let paid = false;
  if (times === undefined) {
    cx.g.log(`${notesOf(cx).sourceName}: how much to pay can't be determined, so it is not paid.`, { rules: ['CR 608.2b', 'CR 118.3'], level: 'info' });
  } else if (choosesX(cx, st)) {
    paid = payChosenX(cx, st);
  } else {
    const n = Math.max(0, Math.floor(times));
    const cost = fixedCost(cx, st.cost);
    const plan = planFromCostDefs(Array.from({ length: n }, () => cost), evalQty(cx, { q: 'X' }) ?? 0);
    const text = costText(plan);
    const origin: Origin = st.else && !st.then ? 'unless' : 'optional';
    for (const payer of resolvePlayers(cx, st.who)) {
      if (offer(cx, st, payer, plan, text, origin)) {
        paid = true;
        break;
      }
    }
  }
  const rest = runSteps(cx, (paid ? st.then : st.else) ?? []);
  // std-rw8 (CR 118.12, 603.12): a payment of one of two costs ("you may sacrifice an artifact or discard a nonland card"), stored as `pay A else [pay B]` (the second
  // by the same player, with no branches of its own besides "if you do"): "you do" is either payment, so the step's result is the second one's when the first
  // was declined ("When you do, ...", parser/lower/conditions.ts#resolveDid)
  const did = paid || (eitherOr(st) && rest.performed);
  return { performed: did, count: did ? 1 : 0 };
};

/** std-rw8: `pay A else [pay B]`, B by the same player with no `else` and no count of its own (parser/lower/conditions.ts#eitherOrPay before "if you do" was folded in). */
function eitherOr(st: PayStep): boolean {
  const inner = st.else?.length === 1 ? st.else[0] : undefined;
  return inner !== undefined && inner.op === 'pay' && inner.else === undefined && inner.times === undefined && inner.mandatory === undefined && st.times === undefined
    && st.mandatory === undefined && JSON.stringify(inner.who) === JSON.stringify(st.who);
}

/** A mana symbol {X} in the cost. */
const variableMana = (cost: CostDef): boolean => (cost.mana ?? []).some((m) => m.kind === 'variable');

/**
 * r5-cost (CR 107.3, 107.3f, 118.12; 107.3f checked against rules/cr in merge wave 8): "you may pay {X}. If you do / When you do, ... X ..." in an ability that announced no X (a triggered ability; a spell
 * or activated ability with {X} in its cost announced it, CR 601.2b, 602.2b): the controller chooses X as they pay, and that X is the X of the rest of this
 * resolution (the ability's own X from now on: a reflexive trigger made from it fixes it, CR 603.12). Only the controller paying one cost once.
 */
function choosesX(cx: ExecCtx, st: PayStep): boolean {
  return cx.stack !== null && cx.stack.x === undefined && st.times === undefined && st.who.ref === 'you' && !st.mandatory && st.else === undefined && variableMana(st.cost); // not "pay {X}. If you don't, ...": no card says it
}

/** The largest X from 0 the payer could pay with (the plan is checked for each value, as a cast's X is, CR 601.2f-h); -1 when not even X = 0 can be paid. */
function largestX(cx: ExecCtx, payer: PlayerId, cost: CostDef): number {
  const src = sourceFor(cx, payer);
  let best = -1;
  for (let x = 0; x <= 99; x++) {
    if (planDenial(cx.g.s, payer, src, planFromCostDefs([cost], x)) !== null) break;
    best = x;
  }
  return best;
}

function payChosenX(cx: ExecCtx, st: PayStep): boolean {
  const g = cx.g;
  const payer = cx.controller;
  const name = g.player(payer).name;
  const source = notesOf(cx).sourceName;
  const cost = fixedCost(cx, st.cost);
  const rules = ['CR 118.12', 'CR 107.3'];
  const max = largestX(cx, payer, cost);
  // the cost as printed, with its X: "{X}", "{X}{R}" (the rest of it written by costText)
  const rest = { ...cost, mana: (cost.mana ?? []).filter((m) => m.kind !== 'variable') };
  const restText = rest.mana.length === 0 && (rest.other ?? []).length === 0 ? '' : costText(planFromCostDefs([rest], 0));
  const plain = `{X}${restText.startsWith('{') ? restText : restText === '' ? '' : ` and ${restText}`}`;
  if (max < 0) {
    g.log(`${name} can't pay ${plain}.`, { rules: ['CR 118.3', ...rules], level: 'info' });
    return false;
  }
  const yes = g.choose({ kind: 'yesNo', player: payer, ...costAsker(cx), prompt: `${source}: pay ${plain}?`, yesLabel: 'Pay', noLabel: "Don't pay", rules }).yes;
  if (!yes) {
    g.log(`${name} doesn't pay ${plain}.`, { rules, level: 'action' });
    return false;
  }
  const x = max === 0 ? 0 : g.choose({ kind: 'chooseNumber', player: payer, prompt: `${source}: choose X for ${plain}.`, min: 0, max, cancellable: false, rules }).n;
  cx.stack!.x = x; // the X of the rest of this resolution (effects/eval.ts reads the stack object's X first)
  const plan = planFromCostDefs([cost], x);
  const text = costText(plan);
  const pg = payingGame(g, payer, 'optional');
  const label = `${source}'s effect`;
  performEffectPayment(pg, payer, sourceFor(cx, payer), resolveAnyCounts(pg, payer, sourceFor(cx, payer), plan, label), label);
  g.log(`${name} pays ${text} (X = ${x}).`, { rules, level: 'action' });
  return true;
}

/**
 * std-combat-2 (CR 118.12, 608.2d, 118.3): "you may pay {1} up to three times": the controller chooses how many times to pay, from 0 to that many (only as many as
 * they can pay: each number is checked as one payment of the cost that many times), then pays it. Returns the number of times paid (0: not paid). Only the
 * controller, a mana cost, no `times`, no `else`; anything else is asked by hand.
 */
function payUpTo(cx: ExecCtx, st: PayStep): number {
  const g = cx.g;
  const payer = cx.controller;
  const name = g.player(payer).name;
  const source = notesOf(cx).sourceName;
  const rules = ['CR 118.12', 'CR 608.2d'];
  const limit = evalQty(cx, st.upTo!);
  const cost = fixedCost(cx, st.cost);
  if (limit === undefined || st.who.ref !== 'you' || st.mandatory === true || st.times !== undefined || st.else !== undefined || (cost.other ?? []).length > 0 || variableMana(cost)) {
    askManual(cx, `${source}: ${name} may pay a cost a number of times the engine cannot offer.`, 'a payment the engine cannot make automatically', undefined, { player: payer });
    return 0;
  }
  const src = sourceFor(cx, payer);
  let max = 0;
  for (let k = 1; k <= Math.floor(limit); k++) {
    if (planDenial(g.s, payer, src, planFromCostDefs(Array.from({ length: k }, () => cost), 0)) !== null) break;
    max = k;
  }
  const once = costText(planFromCostDefs([cost], 0));
  if (max === 0) {
    g.log(`${name} can't pay ${once}.`, { rules: ['CR 118.3', ...rules], level: 'info' });
    return 0;
  }
  const k = g.choose({ kind: 'chooseNumber', player: payer, ...costAsker(cx), prompt: `${source}: pay ${once} how many times? (up to ${max})`, min: 0, max, cancellable: false, rules }).n;
  if (k <= 0) {
    g.log(`${name} doesn't pay ${once}.`, { rules, level: 'action' });
    return 0;
  }
  const plan = planFromCostDefs(Array.from({ length: k }, () => cost), 0);
  const pg = payingGame(g, payer, 'optional');
  const label = `${source}'s effect`;
  performEffectPayment(pg, payer, src, resolveAnyCounts(pg, payer, src, plan, label), label);
  g.log(`${name} pays ${once} ${k === 1 ? 'once' : `${k} times`}.`, { rules, level: 'action' });
  return k;
}
