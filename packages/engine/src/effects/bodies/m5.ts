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
import { damageBatchId, firstApplicationInBatch, shieldHeldInBatch, shieldUsedInBatch } from '../damage-batch';
import type { Game } from '../../core/game';
import type { AbilityDef, AmountChange, ChoiceKind, Destination, EffectStep, Modification, ObjectFilter, Quantity, ReplacementBody } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import type { ObjHandle } from '../../types/state';
import { CARD_TYPES } from '../../types/card';
import { type ContinuousEffectRec, type EventContext, type GameObject } from '../../types/state';
import { charsOfObject, controllerOf } from '../../rules/characteristics';
import { auraCanEnchantObject, enchantRestriction, isAura } from '../../rules/attachment';
import { gameOf, hookpoints } from '../../rules/hookpoints';
import { costText, planDenial, planFromCostDef } from '../../rules/cost';
import { lifeBudget } from '../../rules/life';
import { diceAdvantage, onBattlefield, ruleDenial } from '../../statics/hooks';
import { countersPutDenial } from '../../rules/counters';
import { matchesFilter } from '../../rules/filter';
import { CREATURE_TYPES, LAND_TYPES, PLANESWALKER_TYPES } from '../../statics/subtypes';
import type { DestinationFacts, ExecCtx, Proposed } from '../api';
import { DIE_RESULT_VAR, evalCond, evalQty, PREVENTED_AMOUNT_VAR } from '../eval';
import { rollDice, rollHookFor } from '../../core/dice'; // edh-next-128 (the roller's options through core/dice.ts's provider: no import of effects/roll-options.ts, which imports back)
import { carryEnterFacts, replacementCtx } from '../instead';
import { deferAfter, OPTIONAL_ANSWERS, runNested } from '../nested';
import { performAddToLink, performPayment, setShieldLeft } from '../perform-events';
import { filterCtxOf, resolveObjs, resolvePlayers } from '../refs';
import { contextFor } from '../replace-ctx';
import { enteringState } from '../entering-state';
import { beginTextExchange } from '../text-exchange';
import { ENTERING_TOGETHER } from '../entering-together';
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
      // edh-d-45 (CR 614.12a, 105.1; Seal of the Guildpact): "choose two colors": two different colors, one choice after the other
      if (ch.min === 2 && ch.max === 2) {
        const first = g.choose({ kind: 'chooseColor', player, prompt: prompt('two colors (the first)'), options: [...opts], rules }).color;
        const second = g.choose({ kind: 'chooseColor', player, prompt: prompt('two colors (the second)'), options: opts.filter((x) => x !== first), rules }).color;
        return { link: ch.link, values: [first, second] };
      }
      return { link: ch.link, values: [g.choose({ kind: 'chooseColor', player, prompt: prompt('a color'), options: [...opts], rules }).color] };
    }
    case 'creatureType': case 'cardType': case 'landType': case 'cardName': case 'planeswalkerType': { // edh-d-94: planeswalkerType (CR 205.3j)
      const all = ch.options ?? (ch.what === 'creatureType' ? CREATURE_TYPES : ch.what === 'cardType' ? CARD_TYPES : ch.what === 'landType' ? LAND_TYPES : ch.what === 'planeswalkerType' ? PLANESWALKER_TYPES : undefined);
      // std-rx28 (CR 205.2a, 614.12a): "choose a card type other than creature" never offers the excluded values (the closed lists of CR 205; no template writes
      // an exclusion for a card name, which has no closed list)
      const list = all !== undefined && (ch.exclude ?? []).length > 0 ? all.filter((x) => !(ch.exclude ?? []).includes(x)) : all;
      const what = ch.what === 'cardName' && ch.cardKind !== undefined ? `a ${ch.cardKind} card name` : { creatureType: 'a creature type', cardType: 'a card type', landType: 'a land type', cardName: 'a card name', planeswalkerType: 'a planeswalker type' }[ch.what];
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
      // edhd63 (CR 614.12a, 607.2d, 102.1; Sower of Discord): "choose two players": two different players still in the game (the chooser may be one of them), one choice after the other; fewer than two left: all of them
      if (ch.what === 'player' && ch.min === 2 && ch.max === 2) {
        if (ids.length <= 2) return { link: ch.link, players: ids };
        const first = option(ids, 'two players (the first)', (id) => g.player(id).name);
        const second = option(ids.filter((x) => x !== first), 'two players (the second)', (id) => g.player(id).name);
        return { link: ch.link, players: [first, second] };
      }
      return { link: ch.link, players: [ids.length === 1 ? ids[0]! : option(ids, ch.what === 'player' ? 'a player' : 'an opponent', (id) => g.player(id).name)] };
    }
    case 'oddEven': return { link: ch.link, values: [option(['odd', 'even'], 'odd or even')] };
    case 'landOrNonland': return { link: ch.link, values: [option(['land', 'nonland'], 'land or nonland')] };
    case 'lifeTotal': return { link: ch.link, values: [String(g.player(player).life)] }; // edh-next-144 (CR 614.12a, 119.1; Sigarda's Splendor): "As ~ enters, note your life total."
    case 'manaTypeSpent': return null; // edh-mana-keywords-12: a note of the mana spent on an activation is no "as it enters" choice
    case 'option': {
      if (!ch.options || ch.options.length === 0) return null;
      // edhd63 (CR 614.12a, 607.2d; Greymond): "choose two abilities from among ...": two different options, one choice after the other (fewer options than that: all of them)
      if (ch.min === 2 && ch.max === 2) {
        if (ch.options.length <= 2) return { link: ch.link, values: [...ch.options] };
        const first = option(ch.options, 'two abilities (the first)');
        const second = option(ch.options.filter((x) => x !== first), 'two abilities (the second)');
        return { link: ch.link, values: [first, second] };
      }
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
/** edh-c-35: the link under which an object keeps how many permanents it devoured (CR 702.82c; `{q:'chosenNumber', link}`). */
const DEVOURED_LINK = 'devoured';

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
 * edh-c-42 (CR 702.38a, 701.20a): amplify. The player the permanent enters under chooses any number of cards in their hand that match `filter` (the entering
 * object is "it") and reveals them (no zone change). Returns how many were revealed.
 */
function revealHand(g: Game, cx: ExecCtx, o: GameObject, filter: ObjectFilter, player: PlayerId, name: string): number {
  const fc = filterCtxOf(cx);
  const options = (g.s.zones.hand?.[player] ?? []).filter((id) => {
    const c = g.s.objects[id];
    return c !== undefined && c.id !== o.id && matchesFilter(g.s, c, filter, fc);
  });
  if (options.length === 0) return 0;
  const picked = g.choose({ kind: 'chooseObjects', player, prompt: `As ${name} enters, you may reveal any number of cards in your hand (amplify).`, options, min: 0, max: options.length, rules: ['CR 702.38a', 'CR 614.12a'] }).ids;
  if (picked.length > 0) g.log(`${name} reveals ${picked.length} card${picked.length === 1 ? '' : 's'} from hand: ${picked.map((id) => g.nameOf(id)).join(', ')}.`, { rules: ['CR 702.38a'], level: 'info' });
  return picked.length;
}

/**
 * std-cardcopy-3 (CR 614.1c, 614.12a, 607.2a): "As Mimeoplasm enters, exile up to X creature cards from your graveyard.": the player it enters under chooses up to
 * `max` cards matching `filter` (read for that player) and exiles them (the `move` step, run at once in the replacement's context). Returns the cards now in
 * exile (the ones a replacement sent elsewhere are not "exiled this way").
 */
/**
 * edh-d-78 (CR 614.12a, 122.1; Sin, Unending Cataclysm): "As ~ enters, remove all counters from any number of artifacts, creatures, and enchantments." The player it enters under chooses
 * any number of the permanents on the battlefield that match `filter` (any controller's) and every counter of every kind is removed from each (the `removeCounters` step, run at once in
 * the replacement's context, so a rule that stops a removal is respected). Returns how many counters were actually removed ("the number of counters removed this way").
 */
function removeCountersAsEnters(g: Game, cx: ExecCtx, spec: { filter: ObjectFilter }, player: PlayerId, name: string): number {
  const total = (id: string): number => Object.values(g.s.objects[id]?.counters ?? {}).reduce((n, c) => n + (c > 0 ? c : 0), 0);
  const options = resolveObjs(cx, { ref: 'each', filter: spec.filter }).map((h) => h.id).filter((id) => total(id) > 0);
  if (options.length === 0) return 0;
  const picked = g.choose({ kind: 'chooseObjects', player, prompt: `As ${name} enters, remove all counters from any number of permanents.`, options, min: 0, max: options.length, rules: ['CR 614.12a', 'CR 122.1'] }).ids;
  if (picked.length === 0) return 0;
  const before = picked.reduce((n, id) => n + total(id), 0);
  const REMOVING = '$removedAsEnters';
  cx.bindings.set(REMOVING, { objects: picked.map((id) => ({ id, zone: 'battlefield' as const })), players: [], snapshots: {} });
  runNested(cx, [{ op: 'removeCounters', from: { ref: 'bound', name: REMOVING }, kind: 'any', count: 'all' }]);
  cx.bindings.delete(REMOVING);
  const removed = before - picked.reduce((n, id) => n + total(id), 0);
  g.log(`As ${name} enters, ${removed} counter${removed === 1 ? ' is' : 's are'} removed.`, { rules: ['CR 614.12a', 'CR 122.1'], level: 'info' });
  return removed;
}

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
  cx.subject = { id: o.id, zone: o.zone }; // edh-perms-14 (CR 614.12): the entering permanent is the subject its counters' quantities read (`spellManaSpent` of it)
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
  // edh-c-84 (CR 614.12a, 701.20a, 201.3; Alhammarret, High Arbiter): "each opponent reveals their hand": every opponent's hand is shown to all players; "the name of a nonland card revealed this
  // way" offers only those names (none: no name is chosen and nothing is linked, so the static abilities that read the chosen name affect nothing, CR 607.2d)
  const revealedNames: string[] = [];
  if (b.revealHands === 'eachOpponent') {
    const everyone = g.s.players.map((p) => p.id);
    for (const opp of g.s.players.filter((p) => !p.hasLost && p.id !== player)) {
      const ids = resolveObjs(cx, { ref: 'each', filter: { zone: 'hand', owner: { ref: 'fixed', players: [opp.id] } } }).map((h) => h.id);
      showCards(g, ids, everyone);
      for (const id of ids) {
        const ho = g.s.objects[id];
        if (ho === undefined) continue;
        const ch = charsOfObject(g.s, ho);
        if (!ch.types.includes('Land')) for (const nm of ch.names) if (!revealedNames.includes(nm)) revealedNames.push(nm); // a split card in a hand has both names (CR 709.4a, 201.3)
        // CR 201.4d, 201.4f, 712.19, 715.5: the other faces' names (a double-faced card's back, an Adventure's) may be named too, when that face is no land
        for (const f of g.s.defs[ho.defId]?.faces ?? []) if (!/\bLand\b/.test(f.typeLine ?? '') && f.name && !revealedNames.includes(f.name)) revealedNames.push(f.name);
      }
      g.log(`${opp.name} reveals their hand.`, { rules: ['CR 701.20a', 'CR 614.12a'], level: 'info' });
    }
  }
  // edh-next-137 (CR 614.12, 114.2; Tibalt, Cosmic Impostor): "As ~ enters, you get an emblem with ...": the player it enters under gets it as it enters (effects/perform-events.ts#applyEnterFacts)
  if (b.emblem !== undefined && b.emblem.length > 0 && own) facts.emblems = [...(facts.emblems ?? []), { player, abilities: b.emblem }];
  for (const rawCh of b.choose ?? []) {
    let ch = rawCh;
    if (rawCh.fromRevealed === true) {
      if (revealedNames.length === 0) {
        g.log(`${name}: no nonland card was revealed, so no name is chosen.`, { rules: ['CR 614.12a', 'CR 201.3'], level: 'info' });
        continue;
      }
      ch = { ...rawCh, options: [...revealedNames] };
    }
    // edh-d-72 (CR 614.12a, 608.2d; Callous Oppressor): "an opponent chooses a creature type": the player it enters under picks the opponent (no choice with one left); that opponent chooses
    let chooserPlayer = player;
    if (rawCh.chooser === 'opponent') {
      const opps = g.opponents(player).filter((p) => !p.hasLost).map((p) => p.id);
      if (opps.length === 0) { g.log(`${name}: no opponent is left to choose, so nothing is chosen.`, { rules: ['CR 614.12a'], level: 'info' }); continue; }
      chooserPlayer = opps.length === 1 ? opps[0]! : g.choose({ kind: 'chooseOption', player, prompt: `As ${name} enters, choose the opponent who chooses.`, options: opps.map((id) => ({ id, label: g.player(id).name })), min: 1, max: 1, rules: ['CR 614.12a', 'CR 607.2d'] }).ids[0]!;
    }
    const v = askChoice(g, chooserPlayer, ch, name);
    if (v) facts.chosen = [...(facts.chosen ?? []), v];
    else g.log(`${name}: the choice "${ch.what}" has no option the engine can offer; make it by hand.`, { rules: ['CR 614.12a'], level: 'manual' });
    // M6-6 INTERFACE CHANGE (additive): a chosen number is read by the rest of this body as the variable named by its link (CR 614.12a: the counters a
    // read-ahead Saga enters with are the chosen number, CR 714.3b; statics/levels.ts)
    if (ch.what === 'number' && v?.values?.length === 1 && /^\d+$/.test(v.values[0]!)) cx.vars.set(ch.link, Number(v.values[0]));
    // Cloud r4-repl (CR 614.12a, 607.2d): ... and every choice is read by the rest of the body under its link ("As ~ enters, choose a creature type. ~ enters with a
    // fellowship counter on it for each creature you control of the chosen type."): the permanent's own links are written only as it enters
    if (v) cx.choices = new Map([...(cx.choices ?? []), [ch.link, { ...(v.values ? { values: v.values } : {}), ...(v.players ? { players: v.players } : {}) }]]);
  }
  // edh-next-138 (CR 614.12a, 119.4, 107.1b, 607.2d; Phyrexian Processor): "As ~ enters, pay any amount of life.": the player it enters under chooses how much (0 up to their life total; only 0
  // when a "can't pay life" effect applies or their life is 0 or less) and pays it as it enters; the amount is the object's own number under the link, read as "the life paid as ~ entered"
  if (b.payLifeAny) {
    // (review: the most life the player can pay, rules/life.ts#lifeBudget: none when they can't lose life, CR 119.8, or can't pay life, CR 614.17b)
    const max = Math.max(0, lifeBudget(g.s, player));
    const n = max === 0 ? 0 : g.choose({ kind: 'chooseNumber', player, prompt: `As ${name} enters, pay any amount of life (0 to ${max}).`, min: 0, max, rules: ['CR 614.12a', 'CR 119.4', 'CR 107.1b'] }).n;
    if (n > 0) performPayment(g, player, planFromCostDef({ other: [{ kind: 'payLife', amount: n }] }, 0), name, 'optional');
    g.log(`${g.player(player).name} pays ${n} life as ${name} enters.`, { rules: ['CR 614.12a', 'CR 119.4'], level: 'info' });
    const v = { link: b.payLifeAny.link, values: [String(n)] };
    facts.chosen = [...(facts.chosen ?? []), v];
    cx.vars.set(b.payLifeAny.link, n);
    cx.choices = new Map([...(cx.choices ?? []), [b.payLifeAny.link, { values: v.values }]]);
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
  // edh-perms-12 (CR 614.1c, 614.12; Temple of the Dragon Queen): "you may reveal a Dragon card from your hand. ~ enters tapped unless you revealed a Dragon card this way or you
  // control a Dragon": the condition beside the payment; when it holds the permanent enters untapped whatever is paid, so nothing is asked
  if (b.tappedUnlessPay && b.tappedUnless && evalCond(cx, b.tappedUnless)) {
    // untapped: nothing to pay
  } else if (b.tappedUnlessPay) {
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
  // edh-next-106 (CR 614.1c, 614.12a; Mariposa Military Base): "You may have this land enter tapped. If you do, <steps>": the player it enters under chooses; the steps run once it has entered
  if (b.tappedMay) {
    const steps = b.tappedMay.then;
    if (g.choose({ kind: 'yesNo', player, prompt: `You may have ${name} enter tapped.`, yesLabel: 'Enter tapped', noLabel: 'Enter untapped', rules: ['CR 614.12a'] }).yes) {
      facts.tapped = true;
      const rcx = replacementCtx(g, e, c);
      rcx.controller = player;
      deferAfter(() => runNested(rcx, steps));
    }
  }
  // edh-next-120 (CR 614.12, 612.5, 701.12h; Deadpool, Trading Card): "As ~ enters, you may exchange his text box and another creature's.": the player it enters under may choose
  // another creature (not targeted); once it is on the battlefield the two text boxes are exchanged (effects/text-exchange.ts). No other creature: nothing to choose
  if (b.exchangeText) {
    const options = resolveObjs(cx, { ref: 'each', filter: { ...b.exchangeText.with, zone: 'battlefield' } }).map((h) => h.id).filter((id) => id !== o.id && g.s.objects[id]?.phasedOut !== true && ENTERING_TOGETHER.get(g)?.has(id) !== true); // CR 614.12a: not one entering at the same time
    if (options.length > 0 && g.choose({ kind: 'yesNo', player, prompt: `As ${name} enters, you may exchange its text box and another creature's.`, yesLabel: 'Exchange', noLabel: "Don't", rules: ['CR 614.12a', 'CR 701.12h'] }).yes) {
      const other = options.length === 1 ? options[0]! : g.choose({ kind: 'chooseObjects', player, prompt: `As ${name} enters, choose another creature to exchange text boxes with.`, options, min: 1, max: 1, rules: ['CR 614.12a', 'CR 701.12h'] }).ids[0]!;
      const self = o.id;
      deferAfter(() => {
        // the permanent it became (a new object, CR 400.7: the id of the card that moved points at it, `LastKnown.newId`)
        let id: ObjectId | undefined = self;
        for (let k = 0; k < 4 && id !== undefined && g.s.objects[id]?.zone !== 'battlefield'; k++) id = g.s.lki[id]?.newId;
        const a = id === undefined ? undefined : g.s.objects[id];
        const bo = g.s.objects[other];
        if (a?.zone !== 'battlefield' || bo?.zone !== 'battlefield') return; // either left as it entered: nothing to exchange
        const r = beginTextExchange(g, a, bo, { source: { id: a.id, zone: a.zone }, sourceName: name, controller: player });
        if ('reason' in r) { g.log(`${name}: the text box exchange can't be applied exactly (${r.reason}); make it by hand.`, { rules: ['CR 701.12h'], level: 'manual' }); return; }
        // edh-next-120 review (CR 614.12, 616.1): the text it got applies to how it enters ("enters with three +1/+1 counters", "enters tapped", "As ~ enters, choose ...");
        // this build applies the exchange once it is on the battlefield, so such an acquired replacement is settled by hand (fail closed), never skipped
        const now = g.s.objects[a.id];
        const entersOwn = now === undefined ? [] : charsOfObject(g.s, now).abilities.filter((x) => x.origin !== 'granted' && x.def.kind === 'static'
          && x.def.effects.some((fx) => fx.s === 'replace' && fx.replaces.ev === 'zoneChange' && fx.replaces.to === 'battlefield' && fx.replaces.subject?.self === true));
        if (entersOwn.length > 0) runNested(cx, [{ op: 'manual', text: entersOwn.map((x) => x.def.text ?? '').join(' '), reason: `${name} entered with this text from the text box exchange (CR 614.12): apply how it enters by hand` }]);
      });
    }
  }
  // edh-d-54 (CR 614.12a, 701.20a; Dragon's Disciple): counters it enters with when a cost is paid as it enters (a reveal from the hand) or another condition holds
  if (b.countersIfPay) {
    const spec = b.countersIfPay;
    let yes = spec.or !== undefined && evalCond(cx, spec.or);
    if (!yes) {
      const plan = planFromCostDef(spec.cost, 0);
      const label = costText(plan).replace(/^Pay /, '').replace(/^[A-Z]/, (c) => c.toLowerCase());
      if (planDenial(g.s, player, null, plan) === null && g.choose({ kind: 'yesNo', player, prompt: `As ${name} enters, you may ${label}. If you do, it enters with counters.`, yesLabel: label[0]!.toUpperCase() + label.slice(1), noLabel: "Don't", rules: ['CR 614.12a', 'CR 701.20a'] }).yes) {
        performPayment(g, player, plan, name, 'optional');
        yes = true;
      }
    }
    if (yes) {
      for (const c of spec.counters) {
        const n = evalQtyBeforeGroup(g, cx, c.count) ?? 0;
        if (n > 0) facts.counters = [...(facts.counters ?? []), { kind: c.kind, count: Math.floor(n) }];
      }
    }
  }
  if (b.attacking === true) facts.attacking = true; // trek-8 (CR 614.1c, 508.4): joins combat once it is on the battlefield (effects/perform-events.ts#applyEnterFacts)
  // r5-fxb (CR 614.1d, 616.1): "enter untapped" undoes a tapped entry that the event or an earlier replacement gave it (unverified: the Spelunking rulings)
  if (b.untapped === true) delete facts.tapped;
  // edh-next-128 (CR 614.12a, 706.2, 107.3m; Neverwinter Hydra): "As ~ enters, roll X d6. It enters with ... counters equal to the total of those results": the player it enters
  // under rolls before it is on the battlefield (the roller's own dice options apply, as in effects/handlers/game.ts#rollDie); the total is the `dieResult` its counters read
  if (b.roll) {
    const n = Math.floor(evalQtyBeforeGroup(g, cx, b.roll.count) ?? 0);
    let total = 0;
    if (n > 0) for (const r of rollDice(g, player, b.roll.sides, n, diceAdvantage(g.s, player), 0, rollHookFor(g, player, b.roll.sides))) total += r.result;
    cx.vars.set(DIE_RESULT_VAR, total);
    g.log(`${name} enters with the total of ${n} d${b.roll.sides}: ${total}.`, { rules: ['CR 614.12a', 'CR 706.2'], level: 'info' });
  }
  for (const spec of b.counters ?? []) {
    const n = evalQtyBeforeGroup(g, cx, spec.count) ?? 0; // X of a permanent that was not cast is 0 (CR 107.3m)
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
    // edh-c-35 (CR 702.82c; Tar Fiend, Marrow Chomper): "for each creature it devoured" counts the permanents it devoured as it entered: kept under the link `devoured` (a number, read by `chosenNumber`)
    const dl = b.devour.link ?? DEVOURED_LINK;
    facts.chosen = [...(facts.chosen ?? []).filter((c) => c.link !== dl), { link: dl, values: [String(n)] }];
  }
  // edh-c-37 (CR 702.104a-b, 614.12a): tribute. The player it enters under chooses an opponent, who may have it enter with the counters; what they answered is kept under the
  // link for the "if tribute wasn't paid" trigger. A counter rule that forbids the +1/+1 counters (judged as the creature there, as riot does) makes tribute unpaid
  if (b.tribute) {
    const opps = g.s.players.filter((p) => !p.hasLost && p.id !== player).map((p) => p.id);
    const payer = opps.length <= 1 ? opps[0] : g.choose({ kind: 'chooseOption', player, prompt: `As ${name} enters, choose an opponent (tribute).`, options: opps.map((p) => ({ id: p, label: g.player(p).name })), min: 1, max: 1, rules: ['CR 702.104a', 'CR 614.12a'] }).ids[0]!;
    const n = Math.floor(evalQty(cx, b.tribute.count) ?? 0);
    let paid = false;
    if (payer !== undefined && n > 0) {
      const asEntering = onBattlefield(g.s, o.id, player, { ...(facts.face !== undefined ? { face: facts.face } : {}), ...(facts.faceDown !== undefined ? { faceDown: facts.faceDown } : {}) });
      const forbidden = countersPutDenial(g, o.id, asEntering, '+1/+1') !== null;
      if (!forbidden && g.choose({ kind: 'yesNo', player: payer, prompt: `Tribute ${n}: have ${name} enter with ${n} +1/+1 counter${n === 1 ? '' : 's'} on it?`, yesLabel: 'Pay tribute', noLabel: "Don't pay tribute", rules: ['CR 702.104a', 'CR 614.12a'] }).yes) {
        facts.counters = [...(facts.counters ?? []), { kind: '+1/+1', count: n }];
        paid = true;
      }
    }
    facts.chosen = [...(facts.chosen ?? []), { link: b.tribute.link, values: [paid ? 'paid' : 'unpaid'], ...(payer !== undefined ? { players: [payer] } : {}) }];
    g.log(`${name}: tribute ${paid ? 'was paid' : "wasn't paid"}${payer !== undefined ? ` (${g.player(payer).name})` : ''}.`, { rules: ['CR 702.104a-b'], level: 'info' });
  }
  // edh-c-42 (CR 702.38a, 614.12a): amplify, cards revealed from the hand as it enters; the counters are for the cards actually revealed
  if (b.revealHand) {
    const n = revealHand(g, cx, o, b.revealHand.filter, player, name);
    const per = evalQty(cx, b.revealHand.times) ?? 0;
    if (n * per > 0) facts.counters = [...(facts.counters ?? []), { kind: b.revealHand.kind ?? '+1/+1', count: Math.floor(n * per) }];
  }
  // std-cardcopy-3 (CR 614.12a, 607.2a): cards exiled as it enters, kept under the link for the abilities that read "exiled with ~", and its counters for each
  // edh-d-78 (CR 614.12a, 122.1; Sin, Unending Cataclysm): counters removed from other permanents as it enters; it enters with `times` counters for each one removed
  if (b.removeCounters) {
    const removed = removeCountersAsEnters(g, cx, b.removeCounters, player, name);
    const per = evalQty(cx, b.removeCounters.times) ?? 0;
    if (removed * per > 0) facts.counters = [...(facts.counters ?? []), { kind: b.removeCounters.kind, count: Math.floor(removed * per) }];
  }
  // edh-next-146 (CR 614.12a, 607.2d; Dauntless Bodyguard): "As ~ enters, choose another creature you control.": one permanent on the battlefield now, kept under the link
  if (b.chooseObject !== undefined) {
    const options = resolveObjs(cx, { ref: 'each', filter: b.chooseObject.filter }).map((h) => h.id).filter((id) => id !== o.id && g.s.objects[id]?.zone === 'battlefield');
    if (options.length === 0) g.log(`${name}: there is nothing to choose as it enters.`, { rules: ['CR 614.12a', 'CR 607.2d'], level: 'info' });
    else {
      const id = g.choose({ kind: 'chooseObjects', player, prompt: `As ${name} enters, choose one.`, options, min: 1, max: 1, rules: ['CR 614.12a', 'CR 607.2d'] }).ids[0]!;
      if (b.chooseObject.link !== undefined) facts.chosen = [...(facts.chosen ?? []), { link: b.chooseObject.link, objects: [{ id, zone: 'battlefield' }] }];
      g.log(`${name} enters with ${g.nameOf(id)} chosen.`, { rules: ['CR 614.12a', 'CR 607.2d'], level: 'info' });
    }
  }
  if (b.exileCards) {
    const exiled = exileAsEnters(g, cx, b.exileCards, player, name);
    if (b.exileCards.link !== undefined && exiled.length > 0) facts.chosen = [...(facts.chosen ?? []), { link: b.exileCards.link, objects: exiled }];
    const per = b.exileCards.counters ? evalQty(cx, b.exileCards.counters.per) ?? 0 : 0;
    if (b.exileCards.counters && exiled.length * per > 0) facts.counters = [...(facts.counters ?? []), { kind: b.exileCards.counters.kind, count: Math.floor(exiled.length * per) }];
  }
  // edh-d-54 (CR 614.12a, 400.3; Ulamog's Despoiler): the cards put from exile into their owners' graveyards as it enters, all or none; its counters if they were
  if (b.putToGraveyard) {
    const spec = b.putToGraveyard;
    const options = resolveObjs(cx, { ref: 'each', filter: { ...spec.filter, faceDown: false } }).map((h) => h.id); // face-down cards in exile are not looked at (ruling of Ulamog's Despoiler): never offered
    if (options.length >= spec.count && g.choose({ kind: 'yesNo', player, prompt: `As ${name} enters, put ${spec.count} card${spec.count === 1 ? '' : 's'} from exile into their owners' graveyards?`, yesLabel: 'Put them', noLabel: "Don't", rules: ['CR 614.12a'] }).yes) {
      const picked = options.length === spec.count ? options : g.choose({ kind: 'chooseObjects', player, prompt: `As ${name} enters, put ${spec.count} card${spec.count === 1 ? '' : 's'} from exile into their owners' graveyards.`, options, min: spec.count, max: spec.count, rules: ['CR 614.12a'] }).ids;
      const MOVING = '$putToGraveyardAsEnters';
      cx.bindings.set(MOVING, { objects: picked.map((id) => ({ id, zone: g.s.objects[id]!.zone })), players: [], snapshots: {} });
      runNested(cx, [{ op: 'move', what: { ref: 'bound', name: MOVING }, to: { zone: 'graveyard' } }]);
      cx.bindings.delete(MOVING);
      g.log(`As ${name} enters, ${spec.count} card${spec.count === 1 ? ' is' : 's are'} put from exile into their owners' graveyards.`, { rules: ['CR 614.12a', 'CR 400.3'], level: 'info' });
      facts.counters = [...(facts.counters ?? []), { kind: spec.counters.kind, count: spec.counters.count }];
    }
  }
  // edh-d-73 (CR 614.12a, 708.2; Ixidron): the permanents that match are turned face down as it enters (a 2/2 face-down creature each, whatever the card is)
  if (b.turnFaceDown) {
    // ruling 2006-09-25: a creature entering at the same time enters face up (CR 614.12: it is not on the battlefield yet), so the objects of the same entering group are left out
    const together = ENTERING_TOGETHER.get(g);
    const hit = resolveObjs(cx, { ref: 'each', filter: b.turnFaceDown.filter }).filter((h) => together?.has(h.id) !== true);
    if (hit.length > 0) {
      const TURNING = '$turnFaceDownAsEnters';
      cx.bindings.set(TURNING, { objects: hit.map((h) => ({ id: h.id, zone: g.s.objects[h.id]!.zone })), players: [], snapshots: {} });
      runNested(cx, [{ op: 'changeFace', what: { ref: 'bound', name: TURNING }, to: 'faceDown' }]);
      cx.bindings.delete(TURNING);
    }
  }
  // p2-misc-1 (CR 731.1, 614.12; unverified): "If it's neither day nor night, it becomes day as ~ enters": decided as it enters, not by a trigger
  // (the designate step's handler is the performer, effects/handlers/game.ts)
  if (b.dayIfNeither === true && g.s.designations.dayNight === undefined) runNested(cx, [{ op: 'designate', who: { ref: 'you' }, what: 'day' }]);
  if (b.withAbilities && b.withAbilities.length > 0) facts.abilities = [...(facts.abilities ?? []), ...b.withAbilities];
  // std-freecast-2 (CR 614.1c, 205.1b): "... and is a Vampire in addition to its other types"
  if (b.subtypes && b.subtypes.length > 0) facts.subtypes = [...new Set([...(facts.subtypes ?? []), ...b.subtypes])];
  // edh-perms-21 (CR 614.1c, 205.1b, 613.4b): "it becomes a 7/7 Dinosaur creature in addition to its other types" (Displaced Dinosaurs), the last such replacement's wording wins the base power and toughness
  if (b.becomes !== undefined) {
    const was = facts.becomes;
    facts.becomes = {
      ...(was?.types !== undefined || b.becomes.types !== undefined ? { types: [...new Set([...(was?.types ?? []), ...(b.becomes.types ?? [])])] } : {}),
      ...(was?.subtypes !== undefined || b.becomes.subtypes !== undefined ? { subtypes: [...new Set([...(was?.subtypes ?? []), ...(b.becomes.subtypes ?? [])])] } : {}),
      ...(b.becomes.power !== undefined ? { power: b.becomes.power, toughness: b.becomes.toughness! } : was?.power !== undefined ? { power: was.power, toughness: was.toughness! } : {}),
    };
  }
  // edh-next-146 (CR 614.1c, 614.12a, 613.2a; Corrupted Shapeshifter): "As ~ enters, it becomes your choice of a 3/3 creature with flying, ...": the player it enters under picks one
  // option as it enters; the permanent is that creature from the moment it enters (a copiable effect, layer 1a: effects/perform-events.ts#applyEnterFacts)
  if (b.becomesOneOf !== undefined && b.becomesOneOf.length > 0) {
    const label = (x: NonNullable<typeof b.becomesOneOf>[number]): string => `a ${x.power}/${x.toughness} ${[...(x.subtypes ?? []), ...x.types].join(' ').toLowerCase()}${(x.add ?? []).length > 0 ? ` with ${(x.add ?? []).map((a) => a.text.toLowerCase()).join(', ')}` : ''}`;
    const ids = b.becomesOneOf.map((_, i) => String(i));
    const pick = ids.length === 1 ? '0' : g.choose({ kind: 'chooseOption', player, prompt: `As ${name} enters, it becomes your choice of:`, options: b.becomesOneOf.map((x, i) => ({ id: String(i), label: label(x) })), min: 1, max: 1, rules: ['CR 614.12a', 'CR 613.2a'] }).ids[0]!;
    const opt = b.becomesOneOf[Number(pick)]!;
    const mods: Modification[] = [
      { layer: 4, types: opt.typesAdded === true ? { add: [...opt.types] } : { set: [...opt.types] }, ...(opt.subtypes !== undefined && opt.subtypes.length > 0 ? { subtypes: { add: [...opt.subtypes] } } : {}) } as Modification,
      ...((opt.add ?? []).length > 0 ? [{ layer: 6, add: JSON.parse(JSON.stringify(opt.add)) as AbilityDef[] } as Modification] : []),
      { layer: '7b', power: opt.power, toughness: opt.toughness },
    ];
    facts.becomesAsEntry = { mods, label: label(opt) };
  }
  // FAST5X E28 (riot, CR 702.136a, 614.12a): "enters with your choice of A or B": chosen as it enters, by the player it enters under
  if (b.choice && b.choice.length > 0) {
    // riot's ruling (2019-01-25): it can't have the counter, so it gains haste. Judged as the permanent it would be (a creature on the battlefield, CR 614.12): a
    // restriction on creatures ("counters can't be put on creatures") names the type, which a card on the stack does not show; the ones entering with it are not asked
    const asEntering = onBattlefield(g.s, o.id, player, { ...(facts.face !== undefined ? { face: facts.face } : {}), ...(facts.faceDown !== undefined ? { faceDown: facts.faceDown } : {}) });
    const noCounters = (kind: string): boolean => countersPutDenial(g, o.id, asEntering, kind) !== null; // edh-b-2: a restriction of one kind of counter (Blightbeetle) leaves the others
    const offered = b.choice.map((opt, i) => ({ opt, id: String(i) })).filter((x) => !(x.opt.counters ?? []).some((c) => noCounters(c.kind)));
    // Merge wave 8 (audit D3, CR 614.12a, 702.136a): ONE decision, asked before the option is looked up by its id; asked inside `find`'s callback it was asked
    // again for every option tested (the decision replay of core/game.ts#choose), and a different second answer matched no option
    const chosenId = offered.length > 1
      ? g.choose({ kind: 'chooseOption', player, prompt: `As ${name} enters, choose one.`, options: offered.map((x) => ({ id: x.id, label: (x.opt.counters?.length ?? 0) > 1 ? x.opt.counters!.map((c) => c.kind).join(' and ') /* edhn63 (Grimdancer): two counters named */ : x.opt.label })), min: 1, max: 1, rules: ['CR 614.12a', 'CR 702.136a'] }).ids[0]
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
    ...(e.destination.cause === 'discard' && e.destination.causedBy !== undefined ? { causedBy: e.destination.causedBy } : {}), // edh-next-132 (CR 701.9a, 702.35a): a discard sent elsewhere is still that effect's discard
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
function preventAmount(g: Game, q: Exclude<Extract<ReplacementBody, { b: 'prevent' }>['amount'], 'all'>, c: Candidate, e: Damage): number {
  if (typeof q === 'number') return q;
  const src = g.s.objects[c.source.id] ?? g.s.lki[c.source.id]?.object;
  if (!src) return 0;
  const cx = contextFor(g, src, c.controller);
  // edh-replace-1 (CR 615.1, 107.1a; Gisela, Blade of Goldnight): "prevent half that damage, rounded up" reads the damage being dealt, `{q:'eventAmount'}`
  cx.event = { ev: 'damage', roles: {}, amount: e.amount, before: {} };
  return evalQty(cx, q) ?? 0;
}

/** edhd67 (Sokrates, Athenian Teacher; CR 615.12, 107.1a): a draw of "half that many cards" (a math of the damage prevented): "that many" is the damage even when it can't be prevented, unlike "equal to the damage prevented this way". */
const drawsHalfThatMany = (t: EffectStep): boolean => t.op === 'draw' && typeof t.count === 'object' && t.count !== null && (t.count as { q?: string }).q === 'math' && JSON.stringify(t.count).includes('preventedAmount');

/** edh-b-5: `oncePerBatch` is for steps that do not read the amount (a fixed number of counters); steps that read `preventedAmount` ("remove that many counters") run for each application. */
const onceInBatch = (b: Extract<ReplacementBody, { b: 'prevent' }>): boolean => b.oncePerBatch === true && !JSON.stringify(b.then ?? []).includes('preventedAmount');

export function applyPrevent(g: Game, e: Damage, b: Extract<ReplacementBody, { b: 'prevent' }>, c: Candidate, share: number | undefined): Proposed | null {
  const sh = shieldRecord(g, c);
  const target = typeof e.to === 'string' ? g.player(e.to).name : g.nameOf(e.to.id);
  if (e.unpreventable) {
    g.log(`${c.sourceName} can't prevent the damage to ${target}: it can't be prevented.`, { rules: ['CR 615.12'], level: 'info' });
    // CR 615.12, 615.12a: the effect is still applied (once: the pipeline's used set), prevents nothing, and its additional effect still happens
    if (b.then && b.then.length > 0 && (!onceInBatch(b) || firstApplicationInBatch(g, c.id, typeof e.to === 'string' ? e.to : e.to.id))) thenSteps(g, e, b.then, c, b.amount === 'all' && b.then.some((t) => (t.op === 'putCounters' && JSON.stringify(t.count).includes('preventedAmount')) || drawsHalfThatMany(t)) ? e.amount : 0, b.as); // edh-next-82 review; edhd67 (ruling 2024-07-05 of Sokrates, Athenian Teacher): "half that many cards" when the damage can't be prevented is half the damage that would have been prevented (only the "that many" form reads it; a trigger on damage actually prevented is not reached) (ruling 2020-11-10 of Jared Carthalion, True Heir): "prevent that damage and put that many counters": the damage that would have been prevented
    return e; // CR 615.12: nothing is prevented and a shield is not reduced
  }
  let prevented: number;
  if (sh && sh.budget !== undefined) {
    const budget = sh.rec.usesLeft ?? sh.budget;
    prevented = Math.max(0, Math.min(budget, e.amount, share ?? budget)); // CR 615.7: the player's division among simultaneous damage, if any
    if (prevented > 0) setShieldLeft(g, sh.rec.id, budget - prevented); // CR 615.7: preventing 1 damage reduces the remaining shield by 1
  } else {
    prevented = b.amount === 'all' ? e.amount : Math.min(e.amount, Math.max(0, Math.floor(preventAmount(g, b.amount, c, e))));
    if (sh && sh.uses !== 'all') {
      // CR 615.8: "the next time"; edh-d-15: damage dealt at the same moment (one simultaneous batch) is one time (the later events of the batch are prevented too)
      const left = (sh.rec.usesLeft ?? sh.uses) - 1;
      // only a shield over ONE named source ("the next time that creature would deal damage"): CR 615.8 makes simultaneous damage of that source one time; "a creature of that type" is not one source
      const rp = sh.rec.effect.s === 'replace' ? (sh.rec.effect.replaces as { source?: { is?: unknown } }) : undefined;
      const oneSource = rp?.source?.is !== undefined;
      if (!oneSource || !shieldUsedInBatch(g, sh.rec.id, left <= 0, b.amount === 'all' ? JSON.stringify(rp) : `own:${sh.rec.id}`)) {
        if (left > 0 || !shieldHeldInBatch(g, sh.rec.id)) setShieldLeft(g, sh.rec.id, left);
        // else: held as it is until the batch ends (damage-batch.ts#releaseSpentShields removes it)
      }
    }
  }
  if (prevented <= 0) return e;
  const source = g.nameOf(e.source.id);
  g.log(`${prevented} damage ${source} would deal to ${target} is prevented (${c.sourceName}).`, { rules: ['CR 615.1', ...(sh ? ['CR 615.7'] : [])], level: 'action' });
  // M6-1, CR 615.13: one event per application of a prevention effect (the simultaneous funnel merges those of one batch: effects/funnels.ts)
  g.emit({ type: 'damagePrevented', effect: c.id, batch: damageBatchId(g), amount: prevented, source: [e.source.id], target: [typeof e.to === 'string' ? e.to : e.to.id] });
  if (b.then && b.then.length > 0 && (!onceInBatch(b) || firstApplicationInBatch(g, c.id, typeof e.to === 'string' ? e.to : e.to.id))) thenSteps(g, e, b.then, c, prevented, b.as);
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
  capabilities: ['enters', 'enters.putToGraveyard' /* edh-d-54: CR 614.12a */, 'enters.turnFaceDown' /* edh-d-73: CR 614.12a, 708.2 */, 'enters.countersIfPay' /* edh-d-54: CR 614.12a */, 'enters.tappedMay' /* edh-next-106: CR 614.12a */, 'enters.attachTo', 'enters.under', 'enters.choice', 'enters.revealHand' /* edh-c-42: CR 702.38a */, 'enters.countersIf' /* CMD3: sunburst, CR 702.44a, 614.12 */, 'enters.untapped' /* r5-fxb: CR 614.1d, 616.1 */, 'enters.lookAtHand' /* std-rx6: CR 614.12a, 402.3 */, 'enters.devour' /* std-rx15: CR 702.82a */, 'enters.exileCards' /* std-cardcopy-3: CR 614.12a, 607.2a */, 'enters.dayIfNeither' /* p2-misc-1: CR 731.1 */, 'enters.attacking' /* trek-8: CR 508.4 */, 'enters.becomes' /* edh-perms-21: CR 614.1c, 205.1b */, 'enters.subtypes' /* edh-perms-24: CR 614.1c, 205.1b */, 'enters.tribute' /* edh-c-37: CR 702.104a */, 'enters.revealHands' /* edh-c-84: CR 701.20a, 614.12a */, 'enters.exchangeText' /* edh-next-120: CR 614.12a, 701.12h */, 'enters.removeCounters' /* edh-d-78: CR 614.12a, 122.1 */, 'enters.payLifeAny' /* edh-next-138: CR 614.12a, 119.4 */, 'enters.roll' /* edh-next-128: CR 614.12a, 706.2 */, 'enters.emblem' /* edh-next-137: CR 614.12, 114.2 */, 'enters.becomesOneOf' /* edh-next-146: CR 614.1c, 613.2a */, 'enters.chooseObject' /* edh-next-146: CR 614.12a, 607.2d */], // body:enters (tapped, tapped unless, counters, choices, with abilities), CR 303.4f, 616.1b; FAST5X E28: "your choice of" (CR 702.136a)
  fits: (_g, e) => e.ev === 'zoneChange' && e.to === 'battlefield',
  apply: (g, e, b, c) => (e.ev === 'zoneChange' ? applyEnters(g, e, b, c) : e),
};

// ---- modify: an amount, a count, another player (M6-1, m6 design 3.2; CR 614.1a, 614.5, 614.7a) -----------------------------------------------

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
  if (b.count) return amountChangeFits(b.count) && (e.ev === 'createToken' || e.ev === 'counters' || e.ev === 'mill' || e.ev === 'drawMany' || e.ev === 'scry' || (e.ev === 'search' && b.count.set !== undefined && b.count.mul === undefined && b.count.add === undefined)); // edh-zones-14: a search's top N (CR 701.23a) is only ever "set"; // Cloud r3-repl: a mill's number of cards (CR 701.17a); r4-repl: a draw's (CR 121.2)
  return e.ev === 'draw' || e.ev === 'createToken' || (e.ev === 'damage' && typeof e.to === 'string'); // "that player draws instead", "is dealt to that player instead"; edh-next-61: "is created under your control instead"
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
        // edh-perms-1 (CR 614.5, 616.1): a doubler applied after a "plus" effect doubles the tokens that effect added too, so a later "that many" counts them doubled
        if (e.ev === 'createToken' && typeof change.mul === 'number' && g.chain) { const added = ADDED_TOKENS.get(g.chain.used); if (added) ADDED_TOKENS.set(g.chain.used, Math.floor(added * change.mul)); }
        if (count !== e.count) g.log(`${name}: ${count} ${e.ev === 'counters' ? `${e.kind} counter${count === 1 ? '' : 's'}` : `token${count === 1 ? '' : 's'}`} instead of ${e.count}.`, { rules: ['CR 614.1a'], level: 'info' });
        return count > 0 ? { ...e, count } : null;
      }
      case 'drawMany': { // Cloud r4-repl (CR 121.2, 614.1a): "you draw that many cards plus one instead"
        const count = changeNumber(g, e.count, change, c, e);
        if (count !== e.count) g.log(`${name}: ${g.player(e.player).name} draws ${count} card${count === 1 ? '' : 's'} instead of ${e.count}.`, { rules: ['CR 614.1a', 'CR 121.2'], level: 'info' });
        return count > 0 ? { ...e, count } : null;
      }
      case 'search': { // edh-zones-14 (CR 701.23a, 614.1a): "that player searches the top four cards of that library instead"; a second limit keeps the smaller
        const top = Math.min(e.top ?? Number.MAX_SAFE_INTEGER, changeNumber(g, 0, change, c, e));
        if (top !== e.top) g.log(`${name}: ${g.player(e.player).name} searches only the top ${top} card${top === 1 ? '' : 's'} of that library.`, { rules: ['CR 614.1a', 'CR 701.23a'], level: 'info' });
        return { ...e, top };
      }
      case 'scry': { // edh-b-6 (CR 701.22a, 614.1a; Kenessos, Priest of Thassa): "scry that many cards plus one instead"
        const count = changeNumber(g, e.count, change, c, e);
        if (count !== e.count) g.log(`${name}: ${g.player(e.player).name} scries ${count} instead of ${e.count}.`, { rules: ['CR 614.1a', 'CR 701.22a'], level: 'info' });
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
    // edh-next-61 (CR 614.1a, 111.2; Crafty Cutpurse): "each token that would be created under an opponent's control this turn is created under your control instead": the token's creator (and so its controller) is the other player
    if (e.ev === 'createToken') {
      g.log(`${g.player(p).name} creates the tokens instead of ${g.player(e.player).name} (${c.sourceName}).`, { rules: ['CR 614.1a', 'CR 111.2'], level: 'info' });
      return { ...e, player: p };
    }
  }
  return e;
}

/**
 * CR 614.1a: a `modify` body. With a destination (milestone 5): the same zone change goes elsewhere; the M6 destination fields are checked by the dispatcher.
 * M6-1 (m6 design 3.2): with an amount (damage, life, counters: "double that damage", "that much life plus 1"), a count (tokens, counters: "twice that many
 * of those tokens", CR 614.1a) or another player ("that player draws instead").
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
/** edh-perms-1 (CR 614.5, 616.1): how many tokens the `modify.then` effects applied so far to one event add (a literal count, or "that many" of the event as it stood), so a later "that many" sees them. */
const ADDED_TOKENS = new WeakMap<ReadonlySet<string>, number>();
function thenAfterCreate(g: Game, e: Extract<Proposed, { ev: 'createToken' }>, then: NonNullable<Modify['then']>, c: Candidate): void {
  const cx = replacementCtx(g, e, c);
  carryEnterFacts(cx, e); // edh-fix-1 (CR 614.6, 110.5b, 122.6; Chatterfang ruling 2021-06-18): the added tokens enter tapped and with counters as the creating instruction says
  const live = g.chain;
  const before = new Set<string>(live?.used ?? []);
  if (live && cx.event?.amount !== undefined) {
    // an earlier "plus" effect applied to this event already adds tokens: "that many" of this one counts them (Xorn, then Chatterfang: two Treasures, two Squirrels)
    const earlier = ADDED_TOKENS.get(live.used) ?? 0;
    cx.event.amount += earlier;
    let own = 0;
    for (const x of then.do) if (x.op === 'createToken') own += typeof x.count === 'number' ? x.count : (typeof x.count === 'object' && x.count.q === 'eventAmount' ? cx.event.amount : 0);
    ADDED_TOKENS.set(live.used, earlier + own);
  }
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
  capabilities: ['prevent', 'prevent.then', 'prevent.as' /* std-library-2: CR 603.12, 615.5 */, 'prevent.oncePerBatch' /* edh-b-5: CR 615.5, 614.5 */],
  fits: (_g, e) => e.ev === 'damage',
  apply: (g, e, b, c, shares) => (e.ev === 'damage' ? applyPrevent(g, e, b, c, c.recId !== undefined ? shares?.get(c.recId) : undefined) : e),
};

/** CR 614.8, 701.19: regeneration shields are applied by rules/destroy.ts, never by the pipeline. */
export const REGENERATION_BODY: BodyKind<Extract<ReplacementBody, { b: 'regeneration' }>> = {
  capabilities: ['regeneration'],
  fits: () => false,
  apply: (_g, e) => e,
};

/**
 * trek-14 (CR 614.12, 614.1c; Jean-Luc, Mon Capitaine: "for each creature type among non-Borg creatures you already control"): a count of an "enters with" counters replacement is read
 * before any of the objects entering at the same time (one event or instruction, effects/entering-together.ts) is on the battlefield, so the others of the group are not among
 * the permanents counted.
 */
function evalQtyBeforeGroup(g: Game, cx: ExecCtx, q: Quantity): number | undefined {
  const group = ENTERING_TOGETHER.get(g);
  if (typeof q === 'number' || group === undefined || group.size === 0) return evalQty(cx, q);
  const bf = g.s.zones.battlefield;
  const saved = bf.slice();
  const kept = saved.filter((id) => !group.has(id));
  bf.length = 0;
  bf.push(...kept);
  try { return evalQty(cx, q); } finally { bf.length = 0; bf.push(...saved); }
}
