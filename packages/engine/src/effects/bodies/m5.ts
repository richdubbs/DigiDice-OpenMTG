/**
 * The replacement bodies of milestone 5 (CR 614.1, 614.12, 615), moved unchanged out of effects/replace-bodies.ts by M6-0 (m6 design 2.6, E17) and registered
 * in effects/registries.ts#BODY_KINDS (`enters`, `modify`, `prevent`, `regeneration`). Owner: M6-1 from W1 (it extends `modify` with amount, count and to).
 * Every body returns the modified event, or null when the event no longer happens (prevented entirely, CR 615.6, 614.7a; an Aura with nothing to enchant
 * stays where it is, CR 303.4g, 303.4i).
 *
 *   enters   (CR 614.1c-d, 614.12): tapped, tapped unless, tapped unless a cost is paid (shock lands), with counters, choices (made FIRST, CR 614.12a), under a
 *            player's control (CR 616.1b), attached to something (CR 303.4f), with abilities. The M6 fields (copy, faceDown, transformed, prepared) are
 *            effects/registries.ts#ENTERS_PARTS, checked and applied by the dispatcher (effects/replacements.ts#bodyFits, effects/replace-bodies.ts#applyBody).
 *   modify   with a `destination` only (CR 614.1a "put it ... instead"): the SAME event goes elsewhere, so no second zone change happens (design 3.8). The
 *            fields carried out here: zone, library position (random = shuffled into the library, CR 701.24c), face down outside the battlefield (CR 406.3),
 *            controller, tapped, counters; the others are effects/registries.ts#DESTINATION_PARTS (checked and applied by the dispatcher).
 *   prevent  (CR 615): all or N of the damage; shields count down (CR 615.7), divided among simultaneous damage as the player chose (`shares`, CR 615.7);
 *            unpreventable damage is not reduced and shields are not used (CR 615.12). Additional steps (CR 615.5) are `body:prevent.then`: not run here.
 *   regeneration  applied by rules/destroy.ts for every destruction (design 8.5): never applied by the pipeline (`fits` is false), registered for its capability.
 * Every state change a body needs (a cost paid as it enters, what is left of a shield) is made by a performer (effects/perform-events.ts, design 8.5).
 */
import type { Game } from '../../core/game';
import type { AmountChange, ChoiceKind, Destination, EffectStep, ObjectFilter, Quantity, ReplacementBody } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import type { ObjHandle } from '../../types/state';
import { CARD_TYPES } from '../../types/card';
import { type ContinuousEffectRec, type EventContext, type GameObject } from '../../types/state';
import { charsOfObject, controllerOf } from '../../rules/characteristics';
import { auraCanEnchantObject, enchantRestriction, isAura } from '../../rules/attachment';
import { gameOf, hookpoints } from '../../rules/hookpoints';
import { costText, planDenial, planFromCostDef } from '../../rules/cost';
import { onBattlefield, ruleDenial } from '../../statics/hooks';
import { matchesFilter } from '../../rules/filter';
import { CREATURE_TYPES, LAND_TYPES } from '../../statics/subtypes';
import type { DestinationFacts, ExecCtx, Proposed } from '../api';
import { evalCond, evalQty, PREVENTED_AMOUNT_VAR } from '../eval';
import { replacementCtx } from '../instead';
import { deferAfter, OPTIONAL_ANSWERS, runNested } from '../nested';
import { performAddToLink, performPayment, setShieldLeft } from '../perform-events';
import { filterCtxOf, resolveObjs, resolvePlayers } from '../refs';
import { contextFor } from '../replace-ctx';
import { enteringState } from '../entering-state';
import { showCards } from '../../core/zones';
import type { BodyKind } from '../registries';
import type { Candidate } from '../replacements';

type ZoneChange = Extract<Proposed, { ev: 'zoneChange' }>;
type Damage = Extract<Proposed, { ev: 'damage' }>;

/** The object the event is about, if it is still where the event expects it. */
const current = (g: Game, id: ObjectId, zone: string): GameObject | undefined => {
  const o = g.s.objects[id];
  return o && o.zone === zone ? o : undefined;
};


// ---- enters (CR 614.1c-d, 614.12) --------------------------------------------------------------------------------------------------

const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;

/** One "as it enters, choose ..." choice (CR 614.12a, 607.2d), asked of the player it enters under. */
function askChoice(g: Game, player: PlayerId, ch: { what: ChoiceKind; link: string; options?: string[]; exclude?: string[]; min?: number; max?: number; cardKind?: 'land' | 'nonland' }, name: string): NonNullable<DestinationFacts['chosen']>[number] | null {
  const rules = ['CR 614.12a', 'CR 607.2d'];
  const prompt = (what: string): string => `As ${name} enters, choose ${what}.`;
  const option = (ids: string[], what: string, labels: (x: string) => string = (x) => x): string =>
    g.choose({ kind: 'chooseOption', player, prompt: prompt(what), options: ids.map((id) => ({ id, label: labels(id) })), min: 1, max: 1, rules }).ids[0]!;
  switch (ch.what) {
    case 'color': {
      // CMD3: "choose a color other than white" never offers the excluded colors
      const opts = (ch.options ?? COLORS).filter((x): x is (typeof COLORS)[number] => (COLORS as readonly string[]).includes(x) && !(ch.exclude ?? []).includes(x));
      return { link: ch.link, values: [g.choose({ kind: 'chooseColor', player, prompt: prompt('a color'), options: [...opts], rules }).color] };
    }
    case 'creatureType': case 'cardType': case 'landType': case 'cardName': {
      const all = ch.options ?? (ch.what === 'creatureType' ? CREATURE_TYPES : ch.what === 'cardType' ? CARD_TYPES : ch.what === 'landType' ? LAND_TYPES : undefined);
      // std-rx28 (CR 205.2a, 614.12a): "choose a card type other than creature" never offers the excluded values (the closed lists of CR 205; no template writes
      // an exclusion for a card name, which has no closed list)
      const list = all !== undefined && (ch.exclude ?? []).length > 0 ? all.filter((x) => !(ch.exclude ?? []).includes(x)) : all;
      const what = ch.what === 'cardName' && ch.cardKind !== undefined ? `a ${ch.cardKind} card name` : { creatureType: 'a creature type', cardType: 'a card type', landType: 'a land type', cardName: 'a card name' }[ch.what];
      // std-rx28 (CR 201.3): "choose a nonland card name" (Skyseer's Chariot) names only such a card (ChooseNameDecision.cardKind)
      const kind = ch.what === 'cardName' && ch.cardKind !== undefined ? { cardKind: ch.cardKind } : {};
      const ans = g.choose({ kind: 'chooseName', player, prompt: prompt(what), what: ch.what, ...(list ? { options: [...list] } : {}), ...kind, rules });
      return { link: ch.link, values: [ans.name] };
    }
    case 'number': {
      if (ch.options) return { link: ch.link, values: [option(ch.options, 'a number')] };
      // std-rx5: "choose a number between 1 and 10" (Talion, the Kindly Lord) offers only that range
      const [min, max] = [ch.min ?? 0, ch.max ?? 999];
      const what = ch.min !== undefined && ch.max !== undefined ? `a number between ${min} and ${max}` : 'a number';
      return { link: ch.link, values: [String(g.choose({ kind: 'chooseNumber', player, prompt: prompt(what), min, max, rules }).n)] };
    }
    case 'player': case 'opponent': {
      const ids = g.s.players.filter((p) => !p.hasLost && (ch.what === 'player' || p.id !== player)).map((p) => p.id);
      if (ids.length === 0) return null;
      return { link: ch.link, players: [ids.length === 1 ? ids[0]! : option(ids, ch.what === 'player' ? 'a player' : 'an opponent', (id) => g.player(id).name)] };
    }
    case 'oddEven': return { link: ch.link, values: [option(['odd', 'even'], 'odd or even')] };
    case 'option': {
      if (!ch.options || ch.options.length === 0) return null;
      return { link: ch.link, values: [option(ch.options, 'one')] };
    }
  }
}

/** CR 303.4f, 303.4i, 301.5: what the object may enter attached to; for an Aura, only what its enchant ability allows. */
function attachChoice(g: Game, cx: ExecCtx, o: GameObject, ref: NonNullable<Extract<ReplacementBody, { b: 'enters' }>['attachTo']>, player: PlayerId): ObjectId | PlayerId | null {
  const c = charsOfObject(g.s, o);
  const kw = isAura(c) ? enchantRestriction(c) : undefined;
  const legal = (id: ObjectId): boolean => {
    const host = g.s.objects[id];
    if (!host || host.zone !== 'battlefield' || host.id === o.id) return false;
    if (kw) return auraCanEnchantObject(g.s, o, c, kw, host);
    return hookpoints.canAttach(gameOf(g.s), o.id, id) === null;
  };
  const options = resolveObjs(cx, ref).map((h) => h.id).filter(legal);
  if (options.length === 0) return null; // (an object reference never names a player: "Enchant player" Auras are attached to players by other means)
  if (options.length === 1) return options[0]!;
  return g.choose({ kind: 'chooseObjects', player, prompt: `Choose what ${g.nameOf(o.id)} enters attached to.`, options, min: 1, max: 1, rules: ['CR 303.4f', 'CR 614.12a'] }).ids[0]!;
}

/**
 * std-rx15 (CR 702.82a-b, 701.21a): devour. The player the permanent enters under chooses any number of OTHER permanents they control that match `filter` and
 * sacrifices them (the `sacrifice` step, run at once in the replacement's context: CR 701.21a, a permanent that can't be sacrificed stays). Returns how many
 * were sacrificed ("that many", CR 702.82a).
 */
function devour(g: Game, cx: ExecCtx, o: GameObject, filter: ObjectFilter, player: PlayerId, name: string): number {
  const fc = filterCtxOf(cx);
  const options = (g.s.zones.battlefield ?? []).filter((id) => {
    const p = g.s.objects[id];
    return p !== undefined && p.id !== o.id && !p.phasedOut && controllerOf(g.s, p) === player && matchesFilter(g.s, p, filter, fc);
  });
  if (options.length === 0) return 0;
  const picked = g.choose({ kind: 'chooseObjects', player, prompt: `As ${name} enters, you may sacrifice any number of permanents (devour).`, options, min: 0, max: options.length, rules: ['CR 702.82a', 'CR 614.12a'] }).ids;
  if (picked.length === 0) return 0;
  const DEVOURED = '$devoured';
  cx.bindings.set(DEVOURED, { objects: picked.map((id) => ({ id, zone: 'battlefield' as const })), players: [], snapshots: {} });
  runNested(cx, [{ op: 'sacrifice', what: { ref: 'bound', name: DEVOURED } }]);
  cx.bindings.delete(DEVOURED);
  const n = picked.filter((id) => g.s.objects[id]?.zone !== 'battlefield').length;
  g.log(`${name} devours ${n} permanent${n === 1 ? '' : 's'}.`, { rules: ['CR 702.82a'], level: 'info' });
  return n;
}

/**
 * std-cardcopy-3 (CR 614.1c, 614.12a, 607.2a): "As Mimeoplasm enters, exile up to X creature cards from your graveyard.": the player it enters under chooses up to
 * `max` cards matching `filter` (read for that player) and exiles them (the `move` step, run at once in the replacement's context). Returns the cards now in
 * exile (the ones a replacement sent elsewhere are not "exiled this way").
 */
function exileAsEnters(g: Game, cx: ExecCtx, spec: { filter: ObjectFilter; max: Quantity }, player: PlayerId, name: string): ObjHandle[] {
  const max = Math.max(0, Math.floor(evalQty(cx, spec.max) ?? 0)); // X of a permanent that was not cast is 0 (CR 107.3m)
  const options = resolveObjs(cx, { ref: 'each', filter: spec.filter }).map((h) => h.id);
  if (max === 0 || options.length === 0) return [];
  const picked = g.choose({ kind: 'chooseObjects', player, prompt: `As ${name} enters, exile up to ${max} card${max === 1 ? '' : 's'}.`, options, min: 0, max: Math.min(max, options.length), rules: ['CR 614.12a', 'CR 607.2a'] }).ids;
  if (picked.length === 0) return [];
  const EXILING = '$exiledAsEnters';
  cx.bindings.set(EXILING, { objects: picked.map((id) => ({ id, zone: g.s.objects[id]!.zone })), players: [], snapshots: {} });
  runNested(cx, [{ op: 'move', what: { ref: 'bound', name: EXILING }, to: { zone: 'exile' } }]);
  cx.bindings.delete(EXILING);
  // the new object each card became (CR 400.7; as effects/handlers/zones-util.ts#newObjectOf reads it, not imported here: that module imports this one's registry)
  const out = picked.flatMap((id): ObjHandle[] => {
    if (g.s.objects[id]) return [];
    const n = g.s.lki[id]?.newId;
    const o = n ? g.s.objects[n] : undefined;
    return o && o.zone === 'exile' ? [{ id: o.id, zone: o.zone }] : [];
  });
  g.log(`As ${name} enters, ${out.length} card${out.length === 1 ? ' is' : 's are'} exiled.`, { rules: ['CR 614.12a'], level: 'info' });
  return out;
}

export function applyEnters(g: Game, e: ZoneChange, b: Extract<ReplacementBody, { b: 'enters' }>, c: Candidate): Proposed | null {
  const o = current(g, e.object.id, e.object.zone);
  if (!o) return e;
  const name = g.nameOf(o.id);
  const facts: DestinationFacts = { ...e.destination };
  let player = facts.controller ?? o.controller;
  // M6-1 (m6 design 3.2): the body of ANOTHER object's effect or of a shield ("creatures your opponents control enter tapped", Gather Specimens' "it enters
  // under your control instead") is read for that effect: its source, and "you" = its controller (CR 109.5). An object's own body is read for the object, with
  // "you" = the player it would enter under (CR 614.12).
  const own = c.source.id === o.id;
  const src = own ? o : g.s.objects[c.source.id] ?? g.s.lki[c.source.id]?.object;
  const cx = own ? contextFor(g, o, player) : contextFor(g, src ?? o, c.controller); // a sourceless shield: its controller still is "you"
  // CR 614.12a: every choice the replacement needs is made before the permanent enters. Who it enters under first (CR 616.1b), then the choices.
  if (b.under) {
    const who = resolvePlayers(cx, b.under);
    if (who.length > 0) {
      player = who.length === 1 ? who[0]! : g.choose({ kind: 'chooseOption', player: own ? player : c.controller, prompt: `Under whose control does ${name} enter?`, options: who.map((p) => ({ id: p, label: g.player(p).name })), min: 1, max: 1, rules: ['CR 614.12a', 'CR 110.2'] }).ids[0]!;
      facts.controller = player;
      if (own) cx.controller = player;
    }
  }
  // std-rx6 (CR 614.12a, 402.3, 701.20e): "look at an opponent's hand, then choose ...": the opponent first, then only that player looks at the cards
  if (b.lookAtHand === 'opponent') {
    const opps = g.s.players.filter((p) => !p.hasLost && p.id !== player).map((p) => p.id);
    const opp = opps.length <= 1 ? opps[0]
      : g.choose({ kind: 'chooseOption', player, prompt: `As ${name} enters, choose an opponent whose hand you look at.`, options: opps.map((p) => ({ id: p, label: g.player(p).name })), min: 1, max: 1, rules: ['CR 614.12a', 'CR 402.3'] }).ids[0]!;
    if (opp !== undefined) {
      const ids = resolveObjs(cx, { ref: 'each', filter: { zone: 'hand', owner: { ref: 'fixed', players: [opp] } } }).map((h) => h.id);
      showCards(g, ids, [player]); // only the looking player sees them (CR 701.20e)
      g.log(`${g.player(player).name} looks at ${g.player(opp).name}'s hand.`, { rules: ['CR 614.12a', 'CR 402.3'], level: 'info' });
    }
  }
  for (const ch of b.choose ?? []) {
    const v = askChoice(g, player, ch, name);
    if (v) facts.chosen = [...(facts.chosen ?? []), v];
    else g.log(`${name}: the choice "${ch.what}" has no option the engine can offer; make it by hand.`, { rules: ['CR 614.12a'], level: 'manual' });
    // M6-6 INTERFACE CHANGE (additive): a chosen number is read by the rest of this body as the variable named by its link (CR 614.12a: the counters a
    // read-ahead Saga enters with are the chosen number, CR 714.3b; statics/levels.ts)
    if (ch.what === 'number' && v?.values?.length === 1 && /^\d+$/.test(v.values[0]!)) cx.vars.set(ch.link, Number(v.values[0]));
    // Cloud r4-repl (CR 614.12a, 607.2d): ... and every choice is read by the rest of the body under its link ("As ~ enters, choose a creature type. ~ enters with a
    // fellowship counter on it for each creature you control of the chosen type."): the permanent's own links are written only as it enters
    if (v) cx.choices = new Map([...(cx.choices ?? []), [ch.link, { ...(v.values ? { values: v.values } : {}), ...(v.players ? { players: v.players } : {}) }]]);
  }
  if (b.attachTo) {
    const host = attachChoice(g, cx, o, b.attachTo, player);
    if (host === null) {
      if (isAura(charsOfObject(g.s, o))) {
        if (o.zone === 'stack') {
          // CR 303.4g, 608.3e: an Aura that would enter from the stack with nothing it could enchant is put into its owner's graveyard instead.
          g.log(`${name} has nothing it could enchant, so it is put into its owner's graveyard instead.`, { rules: ['CR 303.4g', 'CR 608.3e'], level: 'info' });
          return { ...e, to: 'graveyard', destination: e.destination.cause !== undefined ? { cause: e.destination.cause } : {} };
        }
        // CR 303.4g, 303.4i: from any other zone it stays where it is (an Aura token is not created).
        g.log(`${name} has nothing it could enchant, so it stays where it is.`, { rules: ['CR 303.4g', 'CR 303.4i'], level: 'info' });
        return null;
      }
      g.log(`${name} has nothing to enter attached to; it enters unattached.`, { rules: ['CR 303.4h'], level: 'info' });
    } else facts.attachTo = host;
  }
  // Tapped (CR 614.1c): "enters tapped", "enters tapped unless [condition]" (check lands), "you may pay [cost]. If you don't, it enters tapped" (shock lands).
  if (b.tappedUnlessPay) {
    const plan = planFromCostDef(b.tappedUnlessPay, 0);
    const label = costText(plan).replace(/^Pay /, '').replace(/^[A-Z]/, (c) => c.toLowerCase()); // "2 life", "{1}", "discard a card"
    // CR 119.4, 119.8, 614.17b: a cost that can't be paid isn't offered (life a "can't pay life" effect forbids included, design 9.4 `payLife`).
    const lifeForbidden = plan.other.some((p) => p.kind === 'payLife') && ruleDenial(g.s, { action: 'payLife', subject: player }, {}) !== null;
    const can = !lifeForbidden && planDenial(g.s, player, null, plan) === null;
    const pays = can && g.choose({ kind: 'yesNo', player, prompt: `As ${name} enters, you may pay ${label}. If you don't, it enters tapped.`, yesLabel: `Pay ${label}`, noLabel: 'Enter tapped', rules: ['CR 614.12a', 'CR 118.12'] }).yes;
    if (pays) performPayment(g, player, plan, name, 'optional'); // design 3.8: a payCost decision with origin `optional` for its mana
    else facts.tapped = true;
  } else if (b.tappedUnless) {
    if (!evalCond(cx, b.tappedUnless)) facts.tapped = true;
  } else if (b.tapped) facts.tapped = true;
  if (b.attacking === true) facts.attacking = true; // trek-8 (CR 614.1c, 508.4): joins combat once it is on the battlefield (effects/perform-events.ts#applyEnterFacts)
  // r5-fxb (CR 614.1d, 616.1): "enter untapped" undoes a tapped entry that the event or an earlier replacement gave it (unverified: the Spelunking rulings)
  if (b.untapped === true) delete facts.tapped;
  for (const spec of b.counters ?? []) {
    const n = evalQty(cx, spec.count) ?? 0; // X of a permanent that was not cast is 0 (CR 107.3m)
    if (n > 0) facts.counters = [...(facts.counters ?? []), { kind: spec.kind, count: Math.floor(n) }];
  }
  // CMD3 (CR 614.12, 702.44a): counters that depend on what the permanent is as it would exist on the battlefield (sunburst: a creature or not), read on a copy of
  // the state with it there under the player it enters under, with the face it enters with and the facts the enters parts already decided (effects/entering.ts
  // #enteringState: the copy it enters as, CR 616.1c, 707.5; face down, CR 708.3; transformed): type-changing effects that would apply to it there count (March
  // of the Machines makes an artifact enter as a creature; an artifact creature that enters as a copy of a noncreature artifact is not a creature)
  if (b.countersIf && b.countersIf.length > 0) {
    const alt = enteringState(g, { ...e, destination: { ...facts, controller: player } }) ?? onBattlefield(g.s, o.id, player, { ...(facts.face !== undefined ? { face: facts.face } : {}) });
    const there = alt.objects[o.id]!;
    const chars = charsOfObject(alt, there);
    for (const branch of b.countersIf) {
      if (!matchesFilter(alt, there, branch.if, { ...filterCtxOf(cx), chars })) continue;
      for (const spec of branch.counters) {
        const n = evalQty(cx, spec.count) ?? 0;
        if (n > 0) facts.counters = [...(facts.counters ?? []), { kind: spec.kind, count: Math.floor(n) }];
      }
    }
  }
  // std-rx15 (CR 702.82a-b): devour, a choice and a sacrifice made as the permanent enters; the counters are for the permanents actually sacrificed
  if (b.devour) {
    const n = devour(g, cx, o, b.devour.filter, player, name);
    const per = evalQty(cx, b.devour.times) ?? 0;
    if (n * per > 0) facts.counters = [...(facts.counters ?? []), { kind: '+1/+1', count: Math.floor(n * per) }];
  }
  // std-cardcopy-3 (CR 614.12a, 607.2a): cards exiled as it enters, kept under the link for the abilities that read "exiled with ~", and its counters for each
  if (b.exileCards) {
    const exiled = exileAsEnters(g, cx, b.exileCards, player, name);
    if (b.exileCards.link !== undefined && exiled.length > 0) facts.chosen = [...(facts.chosen ?? []), { link: b.exileCards.link, objects: exiled }];
    const per = b.exileCards.counters ? evalQty(cx, b.exileCards.counters.per) ?? 0 : 0;
    if (b.exileCards.counters && exiled.length * per > 0) facts.counters = [...(facts.counters ?? []), { kind: b.exileCards.counters.kind, count: Math.floor(exiled.length * per) }];
  }
  // p2-misc-1 (CR 731.1, 614.12; unverified): "If it's neither day nor night, it becomes day as ~ enters": decided as it enters, not by a trigger
  // (the designate step's handler is the performer, effects/handlers/game.ts)
  if (b.dayIfNeither === true && g.s.designations.dayNight === undefined) runNested(cx, [{ op: 'designate', who: { ref: 'you' }, what: 'day' }]);
  if (b.withAbilities && b.withAbilities.length > 0) facts.abilities = [...(facts.abilities ?? []), ...b.withAbilities];
  // std-freecast-2 (CR 614.1c, 205.1b): "... and is a Vampire in addition to its other types"
  if (b.subtypes && b.subtypes.length > 0) facts.subtypes = [...new Set([...(facts.subtypes ?? []), ...b.subtypes])];
  // FAST5X E28 (riot, CR 702.136a, 614.12a): "enters with your choice of A or B": chosen as it enters, by the player it enters under
  if (b.choice && b.choice.length > 0) {
    const noCounters = ruleDenial(g.s, { action: 'haveCountersPut', subject: o.id }, {}) !== null; // riot's ruling: it can't have the counter, so it gains haste
    const offered = b.choice.map((opt, i) => ({ opt, id: String(i) })).filter((x) => !(noCounters && (x.opt.counters ?? []).length > 0));
    // Merge wave 8 (audit D3, CR 614.12a, 702.136a): ONE decision, asked before the option is looked up by its id; asked inside `find`'s callback it was asked
    // again for every option tested (the decision replay of core/game.ts#choose), and a different second answer matched no option
    const chosenId = offered.length > 1
      ? g.choose({ kind: 'chooseOption', player, prompt: `As ${name} enters, choose one.`, options: offered.map((x) => ({ id: x.id, label: x.opt.label })), min: 1, max: 1, rules: ['CR 614.12a', 'CR 702.136a'] }).ids[0]
      : undefined;
    const pick = offered.length === 1 ? offered[0] : offered.find((x) => x.id === chosenId);
    if (pick) {
      for (const spec of pick.opt.counters ?? []) {
        const n = evalQty(cx, spec.count) ?? 0;
        if (n > 0) facts.counters = [...(facts.counters ?? []), { kind: spec.kind, count: Math.floor(n) }];
      }
      if (pick.opt.withAbilities && pick.opt.withAbilities.length > 0) facts.abilities = [...(facts.abilities ?? []), ...pick.opt.withAbilities];
      g.log(`${name} enters with ${pick.opt.label} (the choice of ${g.player(player).name}).`, { rules: ['CR 614.12a', 'CR 702.136a'], level: 'info' });
    }
  }
  return { ...e, destination: facts };
}

// ---- modify: a different destination (CR 614.1a) -------------------------------------------------------------------------------------

export function applyDestination(g: Game, e: ZoneChange, d: Destination, c: Candidate): Proposed | null {
  const o = current(g, e.object.id, e.object.zone);
  if (!o) return e;
  // The new destination replaces the old one (a tapped entry or a library position of the original event does not carry over); why it moves stays.
  const facts: DestinationFacts = {
    ...(e.destination.cause !== undefined ? { cause: e.destination.cause } : {}),
    ...(d.zone === 'battlefield' && e.destination.face !== undefined ? { face: e.destination.face } : {}),
  };
  const cx = contextFor(g, o, c.controller);
  if (d.zone === 'library') {
    const pos = d.position;
    if (pos === 'bottom') facts.position = 'bottom';
    else if (pos === 'random') facts.shuffle = true; // "shuffle it into its owner's library" (CR 701.24a, 701.24c): the performer shuffles that library
    else if (pos !== undefined && pos !== 'top') facts.position = Math.max(0, Math.floor((evalQty(cx, pos.nth) ?? 1) - 1)); // "Nth from the top" (CR 401.3)
  }
  if (d.faceDown === true) facts.faceDown = true; // CR 406.3: "exile it face down" (never onto the battlefield here: replacements.ts#destinationFits)
  if (d.zone === 'battlefield') {
    const who = d.controller === 'owner' ? [o.owner] : resolvePlayers(cx, d.controller);
    facts.controller = who[0] ?? o.owner;
    if (d.tapped) facts.tapped = true;
    for (const spec of d.counters ?? []) {
      const n = evalQty(cx, spec.count) ?? 0;
      if (n > 0) facts.counters = [...(facts.counters ?? []), { kind: spec.kind, count: Math.floor(n) }];
    }
  }
  if (d.zone !== e.to) g.log(`${g.nameOf(o.id)} is put into ${d.zone === 'exile' ? 'exile' : `its owner's ${d.zone}`} instead (${c.sourceName}).`, { rules: ['CR 614.1a', 'CR 614.6'], level: 'action' });
  return { ...e, to: d.zone, destination: facts };
}

// ---- prevent (CR 615) ------------------------------------------------------------------------------------------------------------

/** The shield record with this id (a performer edits it: effects/perform.ts#setShieldLeft). */
function shieldById(g: Game, recId: string | undefined): { rec: ContinuousEffectRec; uses: number | 'all'; budget: number | undefined } | null {
  if (!recId) return null;
  const rec = g.s.continuousEffects.find((r) => r.id === recId);
  if (!rec || rec.effect.s !== 'replace' || !rec.effect.shield) return null;
  const sh = rec.effect.shield;
  const body = rec.effect.body;
  // "Prevent the next N damage" (CR 615.7): the budget is the shield's amount, or the body's number on a shield (the renderer reads it as "the next N").
  const budget = typeof sh.amount === 'number' ? sh.amount : body.b === 'prevent' && typeof body.amount === 'number' ? body.amount : undefined;
  return { rec, uses: sh.uses, budget };
}

const shieldRecord = (g: Game, c: Candidate): ReturnType<typeof shieldById> => shieldById(g, c.recId);

/** What is left of a "prevent the next N damage" shield (CR 615.7), or undefined when the record is not such a shield. */
export function shieldBudgetLeft(g: Game, recId: string): number | undefined {
  const sh = shieldById(g, recId);
  return sh && sh.budget !== undefined ? sh.rec.usesLeft ?? sh.budget : undefined;
}

/** "Prevent N of that damage" (CR 615.10): N of a static ability is live (CR 611.3a), evaluated now for the effect's source; one that can't be determined prevents nothing. */
function preventAmount(g: Game, q: Exclude<Extract<ReplacementBody, { b: 'prevent' }>['amount'], 'all'>, c: Candidate): number {
  if (typeof q === 'number') return q;
  const src = g.s.objects[c.source.id] ?? g.s.lki[c.source.id]?.object;
  return src ? evalQty(contextFor(g, src, c.controller), q) ?? 0 : 0;
}

export function applyPrevent(g: Game, e: Damage, b: Extract<ReplacementBody, { b: 'prevent' }>, c: Candidate, share: number | undefined): Proposed | null {
  const sh = shieldRecord(g, c);
  const target = typeof e.to === 'string' ? g.player(e.to).name : g.nameOf(e.to.id);
  if (e.unpreventable) {
    g.log(`${c.sourceName} can't prevent the damage to ${target}: it can't be prevented.`, { rules: ['CR 615.12'], level: 'info' });
    // CR 615.12, 615.12a: the effect is still applied (once: the pipeline's used set), prevents nothing, and its additional effect still happens
    if (b.then && b.then.length > 0) thenSteps(g, e, b.then, c, 0, b.as);
    return e; // CR 615.12: nothing is prevented and a shield is not reduced
  }
  let prevented: number;
  if (sh && sh.budget !== undefined) {
    const budget = sh.rec.usesLeft ?? sh.budget;
    prevented = Math.max(0, Math.min(budget, e.amount, share ?? budget)); // CR 615.7: the player's division among simultaneous damage, if any
    if (prevented > 0) setShieldLeft(g, sh.rec.id, budget - prevented); // CR 615.7: preventing 1 damage reduces the remaining shield by 1
  } else {
    prevented = b.amount === 'all' ? e.amount : Math.min(e.amount, Math.max(0, Math.floor(preventAmount(g, b.amount, c))));
    if (sh && sh.uses !== 'all') setShieldLeft(g, sh.rec.id, (sh.rec.usesLeft ?? sh.uses) - 1); // CR 615.8: "the next time"
  }
  if (prevented <= 0) return e;
  const source = g.nameOf(e.source.id);
  g.log(`${prevented} damage ${source} would deal to ${target} is prevented (${c.sourceName}).`, { rules: ['CR 615.1', ...(sh ? ['CR 615.7'] : [])], level: 'action' });
  // M6-1, CR 615.13: one event per application of a prevention effect (the simultaneous funnel merges those of one batch: effects/funnels.ts)
  g.emit({ type: 'damagePrevented', effect: c.id, batch: g.events.length, amount: prevented, source: [e.source.id], target: [typeof e.to === 'string' ? e.to : e.to.id] });
  if (b.then && b.then.length > 0) thenSteps(g, e, b.then, c, prevented, b.as);
  const rest = e.amount - prevented;
  return rest > 0 ? { ...e, amount: rest } : null; // CR 615.6, 614.7a: damage prevented entirely never happens
}

/**
 * CR 615.5: a prevention effect's additional effect, which may refer to the amount it prevented (`{q:'preventedAmount'}`), takes place immediately after the
 * damage event would have happened (effects/nested.ts#deferAfter), in the effect's context (its source and controller, the event's roles).
 */
function thenSteps(g: Game, e: Damage, steps: EffectStep[], c: Candidate, prevented: number, as?: string): void {
  const cx = replacementCtx(g, e, c);
  cx.vars.set(PREVENTED_AMOUNT_VAR, prevented);
  // std-library-2 (CR 603.12, 615.5): the prevention named by the body's `as` was "carried out" when it prevented damage, for a reflexive step on it
  if (as !== undefined) cx.results.set(as, { performed: prevented > 0, count: prevented });
  const used = g.chain;
  deferAfter(() => {
    const saved = g.chain;
    g.chain = used; // CR 614.5: the steps' events are in the branch of the prevented event
    try {
      runNested(cx, steps);
    } finally {
      g.chain = saved;
    }
  });
}

// ---- the entries (effects/registries.ts#BODY_KINDS) -------------------------------------------------------------------------------------------------------

/** CR 614.1c-d, 614.12: an `enters` body applies to a permanent entering the battlefield. The M6 fields are checked by the dispatcher (ENTERS_PARTS). */
export const ENTERS_BODY: BodyKind<Extract<ReplacementBody, { b: 'enters' }>> = {
  capabilities: ['enters', 'enters.attachTo', 'enters.under', 'enters.choice', 'enters.countersIf' /* CMD3: sunburst, CR 702.44a, 614.12 */, 'enters.untapped' /* r5-fxb: CR 614.1d, 616.1 */, 'enters.lookAtHand' /* std-rx6: CR 614.12a, 402.3 */, 'enters.devour' /* std-rx15: CR 702.82a */, 'enters.exileCards' /* std-cardcopy-3: CR 614.12a, 607.2a */, 'enters.dayIfNeither' /* p2-misc-1: CR 731.1 */, 'enters.attacking' /* trek-8: CR 508.4 */], // body:enters (tapped, tapped unless, counters, choices, with abilities), CR 303.4f, 616.1b; FAST5X E28: "your choice of" (CR 702.136a)
  fits: (_g, e) => e.ev === 'zoneChange' && e.to === 'battlefield',
  apply: (g, e, b, c) => (e.ev === 'zoneChange' ? applyEnters(g, e, b, c) : e),
};

// ---- modify: an amount, a count, another player (M6-1, m6 design 3.2; CR 614.1a, 614.5, 614.7a, 616.1g) -----------------------------------------------

type Modify = Extract<ReplacementBody, { b: 'modify' }>;

/** An `AmountChange` the pipeline carries out: `set`, `mul` (rounded down unless it says up), `add`; `min` has no reading yet (fail closed). */
const amountChangeFits = (a: AmountChange): boolean => a.min === undefined && (a.set !== undefined || a.mul !== undefined || a.add !== undefined);

/**
 * Apply a change to a number (m6 design 3.2): `set`, then `mul` (rounded as stated, down by default: "half that many, rounded down", CR 107.1a), then
 * `add`. The quantities are read for the effect's source with "you" = its controller (CR 109.5), and `{q:'eventAmount'}` is the number being changed.
 * An amount that can't be determined leaves the number unchanged.
 */
function changeNumber(g: Game, n: number, a: AmountChange, c: Candidate, e: Proposed): number {
  const src = g.s.objects[c.source.id] ?? g.s.lki[c.source.id]?.object;
  const cx = src ? contextFor(g, src, c.controller) : undefined;
  if (cx) cx.event = { ev: (e.ev === 'destroy' ? 'action' : e.ev) as EventContext['ev'], roles: {}, amount: n, before: {} };
  const q = (x: Quantity): number | undefined => (cx ? evalQty(cx, x) : typeof x === 'number' ? x : undefined);
  let v = n;
  if (a.set !== undefined) {
    const s = q(a.set);
    if (s === undefined) return n;
    v = s;
  }
  if (a.mul !== undefined) v = a.round === 'up' ? Math.ceil(v * a.mul) : Math.floor(v * a.mul);
  if (a.add !== undefined) {
    const d = q(a.add);
    if (d === undefined) return n;
    v += d;
  }
  return Math.max(0, Math.floor(v));
}

/** What a `modify` body without a destination changes, for which events: an amount (damage, life, counters), a count (tokens, counters), a player (draw, damage to a player). */
function modifyNumbersFit(e: Proposed, b: Modify): boolean {
  if (b.destination !== undefined) return false;
  const fields = [b.amount, b.count, b.to].filter((x) => x !== undefined).length;
  if (fields !== 1) return false; // one change per body (the templates write one); several would need an order the data does not state
  if (b.amount) return amountChangeFits(b.amount) && (e.ev === 'damage' || e.ev === 'life' || e.ev === 'counters');
  if (b.count) return amountChangeFits(b.count) && (e.ev === 'createToken' || e.ev === 'counters' || e.ev === 'mill' || e.ev === 'drawMany'); // Cloud r3-repl: a mill's number of cards (CR 701.17a); r4-repl: a draw's (CR 121.2)
  return e.ev === 'draw' || (e.ev === 'damage' && typeof e.to === 'string'); // "that player draws instead", "is dealt to that player instead"
}

export function applyModifyNumbers(g: Game, e: Proposed, b: Modify, c: Candidate): Proposed | null {
  const change = b.amount ?? b.count;
  if (change) {
    const name = c.sourceName;
    switch (e.ev) {
      case 'damage': case 'life': {
        const amount = changeNumber(g, e.amount, change, c, e);
        if (amount !== e.amount) g.log(`${name}: ${e.ev === 'damage' ? `${amount} damage instead of ${e.amount}` : `${amount} life instead of ${e.amount}`}.`, { rules: ['CR 614.1a'], level: 'info' });
        return amount > 0 ? { ...e, amount } : null; // CR 614.7a
      }
      case 'counters': case 'createToken': {
        const count = changeNumber(g, e.count, change, c, e);
        if (count !== e.count) g.log(`${name}: ${count} ${e.ev === 'counters' ? `${e.kind} counter${count === 1 ? '' : 's'}` : `token${count === 1 ? '' : 's'}`} instead of ${e.count}.`, { rules: ['CR 614.1a', 'CR 616.1g'], level: 'info' });
        return count > 0 ? { ...e, count } : null;
      }
      case 'drawMany': { // Cloud r4-repl (CR 121.2, 614.1a): "you draw that many cards plus one instead"
        const count = changeNumber(g, e.count, change, c, e);
        if (count !== e.count) g.log(`${name}: ${g.player(e.player).name} draws ${count} card${count === 1 ? '' : 's'} instead of ${e.count}.`, { rules: ['CR 614.1a', 'CR 121.2'], level: 'info' });
        return count > 0 ? { ...e, count } : null;
      }
      case 'mill': { // Cloud r3-repl (CR 701.17a, 614.1a): "they mill that many cards plus four instead"
        const count = changeNumber(g, e.count, change, c, e);
        if (count !== e.count) g.log(`${name}: ${g.player(e.player).name} mills ${count} card${count === 1 ? '' : 's'} instead of ${e.count}.`, { rules: ['CR 614.1a', 'CR 701.17a'], level: 'info' });
        return count > 0 ? { ...e, count } : null;
      }
      default: return e;
    }
  }
  if (b.to) {
    const src = g.s.objects[c.source.id] ?? g.s.lki[c.source.id]?.object;
    const who = src ? resolvePlayers(contextFor(g, src, c.controller), b.to).filter((p) => !g.player(p).hasLost) : [];
    if (who.length !== 1) return e; // no single player to give it to: the event is not modified
    const p = who[0]!;
    if (e.ev === 'draw') {
      g.log(`${g.player(p).name} draws instead of ${g.player(e.player).name} (${c.sourceName}).`, { rules: ['CR 614.1a'], level: 'info' });
      return { ...e, player: p };
    }
    if (e.ev === 'damage' && typeof e.to === 'string') return { ...e, to: p }; // the event keeps its source (m6 design 3.2)
  }
  return e;
}

/**
 * CR 614.1a: a `modify` body. With a destination (milestone 5): the same zone change goes elsewhere; the M6 destination fields are checked by the dispatcher.
 * M6-1 (m6 design 3.2): with an amount (damage, life, counters: "double that damage", "that much life plus 1"), a count (tokens, counters: "twice that many
 * of those tokens", CR 616.1g) or another player ("that player draws instead").
 */
export const MODIFY_BODY: BodyKind<Modify> = {
  // CR 701.24c; CR 406.3 outside the battlefield; M6-1: amount, count, to; M6-12: then (CR 702.35a)
  // std-ru: link (CR 607.2a)
  capabilities: ['modify', 'modify.destination', 'modify.destination.random', 'modify.destination.faceDown', 'modify.amount', 'modify.count', 'modify.to', 'modify.then', 'modify.link'],
  fits: (_g, e, b) => (e.ev === 'zoneChange' && b.destination !== undefined && b.amount === undefined && b.count === undefined && b.to === undefined)
    || (b.then === undefined && b.link === undefined && modifyNumbersFit(e, b))
    || (e.ev === 'createToken' && b.then !== undefined && b.destination === undefined && b.amount === undefined && b.count === undefined && b.to === undefined), // Cloud r3-repl
  apply: (g, e, b, c) => {
    // Cloud r3-repl (CR 614.1a, 614.5): "instead create those tokens plus an additional Map token": the same tokens, and the steps right after them
    if (e.ev === 'createToken' && b.then) {
      thenAfterCreate(g, e, b.then, c);
      return e;
    }
    if (!(e.ev === 'zoneChange' && b.destination)) return applyModifyNumbers(g, e, b, c);
    const r = applyDestination(g, e, b.destination, c);
    if (r && r.ev === 'zoneChange' && b.then) thenAfterMove(g, e, r.to, b.then, c);
    if (r && r.ev === 'zoneChange' && b.link !== undefined && r.to === 'exile') linkAfterMove(g, e, b.link, c);
    return r;
  },
};

/**
 * Cloud r3-repl (CR 614.1a, 614.5, 616.1): the steps of a `modify` body on a token creation ("If you would create one or more artifact tokens, instead create those
 * tokens plus an additional Map token", Worldwalker Helm): the event is carried out as it is, and the steps run immediately after it (effects/nested.ts#deferAfter)
 * in the replacement's context and in the branch of that event. The added tokens are part of the modified event from the moment this effect applies, so an effect
 * applied to the event AFTER this one (a doubling, CR 616.1e: Helm first, then "twice that many": two Treasures and two Maps) applies to them as well, while one
 * applied BEFORE it does not (it saw the event without them): the steps' chain is the set of effects used when this one applied, plus the other effects of this
 * kind applied to the same event (each adds its own tokens itself, CR 614.5: two Helms make two Maps, not three).
 * w8-followups (CR 614.5, 616.1, 616.1e): an OPTIONAL effect applied after this one is applied to the added tokens with the answer its controller gave for the
 * event, never asked again: "those tokens plus a Food token" first, then "you may instead create that many tokens that are copies of ..." accepted makes three
 * copies, declined two Soldiers and a Food; a different answer for the Food (two Soldiers and a copy) is not a result the rules allow.
 */
const THEN_CREATE = new WeakMap<ReadonlySet<string>, Set<string>>();
/**
 * pc-tokens-2 (CR 614.5, 616.1; Academy Manufactor): how many replacements applied to one event add tokens "of each kind" (`createToken.exceptReplaced`). Two of them multiply
 * (Manufactor and its clone: three of each), which the one-pass `then` below cannot do: with more than one, none runs and the players make the tokens by hand.
 */
const EXCEPT_ADDERS = new WeakMap<ReadonlySet<string>, number>();
function thenAfterCreate(g: Game, e: Extract<Proposed, { ev: 'createToken' }>, then: NonNullable<Modify['then']>, c: Candidate): void {
  const cx = replacementCtx(g, e, c);
  const live = g.chain;
  const before = new Set<string>(live?.used ?? []);
  const exceptive = then.do.some((x) => x.op === 'createToken' && x.exceptReplaced === true);
  if (live) {
    const adders = THEN_CREATE.get(live.used) ?? new Set<string>();
    adders.add(c.id);
    THEN_CREATE.set(live.used, adders);
    if (exceptive) EXCEPT_ADDERS.set(live.used, (EXCEPT_ADDERS.get(live.used) ?? 0) + 1);
  }
  deferAfter(() => {
    if (exceptive && live && (EXCEPT_ADDERS.get(live.used) ?? 0) > 1) {
      g.log(`${c.sourceName}: more than one replacement creates one of each kind of token for the same event; create the tokens by hand (CR 616.1).`, { rules: ['CR 614.5', 'CR 616.1'], level: 'manual' });
      return;
    }
    cx.results.set(then.as, { performed: true, count: e.count });
    const saved = g.chain;
    if (live) {
      const adders = THEN_CREATE.get(live.used) ?? new Set<string>();
      // the optional effects answered for the event after this one applied (in `live.used`, the event's set, by now complete; not before it, not an adder)
      const asked = OPTIONAL_ANSWERS.get(live.used);
      const decided = new Map<string, boolean>();
      for (const id of live.used) if (!before.has(id) && !adders.has(id) && asked?.has(id) === true) decided.set(id, asked.get(id)!);
      g.chain = { ...live, used: new Set<string>([...before, ...adders]), decided };
    }
    try {
      runNested(cx, then.do);
    } finally {
      g.chain = saved;
    }
  });
}

/**
 * M6-12, CR 702.35a ("When this card is exiled this way, ..."), 603.2: what a `modify` body says happens once its modified zone change was carried out. The
 * steps run immediately after the event (effects/nested.ts#deferAfter, as a prevention effect's additional steps do, CR 615.5), in the replacement's context
 * (its source and controller, CR 109.5), with the object the event moved bound as `then.as` and that name's result performed, so a `reflexive` step on it
 * puts its triggered ability on the stack the next time a player would receive priority (CR 603.3). If the object did not arrive in `to` (the event was not
 * carried out, or a later replacement sent it elsewhere), nothing happens: it was not moved "this way".
 */
function thenAfterMove(g: Game, e: ZoneChange, to: string, then: NonNullable<Modify['then']>, c: Candidate): void {
  const cx = replacementCtx(g, e, c);
  const used = g.chain;
  deferAfter(() => {
    const next = g.s.lki[e.object.id]?.newId;
    const o = next ? g.s.objects[next] : undefined;
    if (!o || o.zone !== to) return;
    cx.bindings.set(then.as, { objects: [{ id: o.id, zone: o.zone }], players: [], snapshots: {} });
    cx.results.set(then.as, { performed: true, count: 1 });
    const saved = g.chain;
    g.chain = used; // CR 614.5: the steps' events are in the branch of the moved object's event
    try {
      runNested(cx, then.do);
    } finally {
      g.chain = saved;
    }
  });
}

/**
 * std-ru (CR 607.2a, 614.1a, 400.7): a `modify` body with a link: once its modified zone change was carried out, the object it put into exile is recorded under
 * the link of the replacement's source (added to what earlier events recorded, as effects/handlers/zones-util.ts#addToLink), so "the cards exiled with ~" of a
 * linked ability are what this replacement exiled. Nothing is recorded when the object did not arrive in exile (the event was not carried out, or a later
 * replacement sent it elsewhere), or when the source is no longer the object it was (CR 400.7: a new object has no link store of the old one).
 */
function linkAfterMove(g: Game, e: ZoneChange, link: string, c: Candidate): void {
  const cx = replacementCtx(g, e, c);
  deferAfter(() => {
    const next = g.s.lki[e.object.id]?.newId;
    const o = next ? g.s.objects[next] : undefined;
    if (!o || o.zone !== 'exile') return;
    performAddToLink(g, cx.source, link, { id: o.id, zone: o.zone }); // CR 607.2c: added to the store; only the source as it is now has one
  });
}

/** CR 615: prevention; M6-1: with additional steps (CR 615.5, `body:prevent.then`). */
export const PREVENT_BODY: BodyKind<Extract<ReplacementBody, { b: 'prevent' }>> = {
  capabilities: ['prevent', 'prevent.then', 'prevent.as' /* std-library-2: CR 603.12, 615.5 */],
  fits: (_g, e) => e.ev === 'damage',
  apply: (g, e, b, c, shares) => (e.ev === 'damage' ? applyPrevent(g, e, b, c, c.recId !== undefined ? shares?.get(c.recId) : undefined) : e),
};

/** CR 614.8, 701.19: regeneration shields are applied by rules/destroy.ts, never by the pipeline. */
export const REGENERATION_BODY: BodyKind<Extract<ReplacementBody, { b: 'regeneration' }>> = {
  capabilities: ['regeneration'],
  fits: () => false,
  apply: (_g, e) => e,
};
