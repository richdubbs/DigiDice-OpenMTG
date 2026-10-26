/**
 * Which replacement and prevention effects apply to a proposed event (CR 614, 615, 616.1), for the proposal pipeline (effects/propose.ts, design 8.5).
 * Owner: WP11 (an addition to the files of design 5.1, split out of propose.ts to keep each file small).
 *
 * Milestone 5 scope (design 8.5, 14): the replacement effects of an object's OWN static abilities about itself (`feature:replace.self`: "as ~ enters" bodies,
 * consulted from the entering object whatever its zone, CR 614.12; "if ~ would be put into ... , put it ... instead" while it is on the stack or wherever its
 * ability functions; "prevent all damage that would be dealt to / by ~"), and the shields created by resolved effects (prevention shields, CR 615.7-615.8;
 * one-shot "the next time" replacements, CR 614.1). Regeneration shields are applied by rules/destroy.ts, which owns regeneration for every destruction
 * (design 8.5, transition T1).
 *
 * M6-1 (m6 design 3.1.1, E1, D2): the replacement effects of OTHER objects (`feature:replace.foreign`: Leyline of the Void, Doubling Season, Rest in Peace,
 * Orb of Dreams) are found through the index of effects/replacement-index.ts and matched against the entering object as it would exist on the battlefield
 * (CR 614.12, effects/entering.ts); "you" is the source's controller after layer 2 (CR 109.5, 613.1b). The replacement effects that resolved spells and
 * abilities create and that are not shields ("prevent all combat damage that would be dealt this turn", CR 615.1, 611.2a) are candidates while they last, and
 * a shield may have any body the pipeline applies (`feature:shield.<b>`, m6 design 3.2).
 *
 * Patterns are matched by THE matcher of triggers/match.ts on a semantic event built from the proposal (the state is the one before the event, as CR 614.12 and
 * 616.1 want it). One field the matcher leaves to its callers is evaluated here: `is` (a fixed set of objects, CR 611.2c) at the top of a role filter; a pattern
 * with `is` anywhere else never matches. `zoneChange.cause` is compared with the cause of the move.
 */
import { ENTERING_TOGETHER } from './entering-together';
import type { Game } from '../core/game';
import type { Condition, Destination, EventPattern, ObjectFilter, ReplacementBody, ReplacementDef, StaticAbilityDef } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import { type ContinuousEffectRec, type GameObject, type ObjHandle, type SemEvent } from '../types/state';
import { isIndestructible } from '../rules/destroy';
import { charsOfObject, controllerOf, faceChars, hasKeyword } from '../rules/characteristics';
import { onBattlefield } from '../statics/hooks';
import { matchEvent } from '../triggers/match';
import type { ApplicableReplacement, ExecCtx, Proposed } from './api';
import { evalCond } from './eval';
import { eventAmount } from './instead';
import type { GameState } from '../types/state';
import { contextFor } from './replace-ctx';
import { BODY_KINDS, DESTINATION_PARTS, ENTERS_PARTS, kindOf, PROPOSAL_KINDS, RULE_REPLACEMENTS, type BodyKind } from './registries';
import { DESTINATION_PART_FIELDS, destinationFieldSet, ENTERS_PART_FIELDS, entersFieldSet } from './replace-bodies';
import { aboutSelf as aboutSelfPattern, replacementIndex } from './replacement-index';
import { asItWouldEnter, isEntering } from './entering';

export { contextFor } from './replace-ctx';

/** One applicable effect, with what the pipeline needs to apply it and to tell the player about it. */
export interface Candidate extends ApplicableReplacement {
  /** For the chooseReplacement prompt and the log. */
  sourceName: string;
  /** The player "you" means for this effect (its controller, CR 109.5). */
  controller: PlayerId;
  /** Shield record id (effects created by a resolving spell or ability, CR 614.1, 615.7). */
  recId?: string;
  /**
   * M11-1 INTERFACE CHANGE (additive): a replacement effect the RULES generate that asks its own question and applies itself (CR 903.9b: the commander's
   * owner answers `commanderZone`, and the commander goes to the command zone with the cause 'commander'). Called by effects/propose.ts#runPipeline once
   * the CR 616.1 order chose this effect, instead of the yes/no of an optional effect and the body: the modified event, or null when the player declined
   * (the event goes on unchanged; the effect counts as used, CR 614.5).
   */
  rule?: (g: Game, e: Proposed) => Proposed | null;
}

/**
 * The fields of a new destination the pipeline carries out (CR 614.1a): the zone, a library position (top, bottom, Nth, random = shuffled in, CR 701.24c), face
 * down outside the battlefield (CR 406.3), and on the battlefield its controller, tapped and counters (effects/bodies/m5.ts). M6-0: each other field (transformed,
 * attacking, attachedTo, order, owner, face down on the battlefield, CR 708.2a) fits only when a registered destination part (effects/registries.ts
 * #DESTINATION_PARTS) takes it; none does in M6-0, so such an ability is never applied half (design 5.2).
 */
function destinationFits(e: Proposed, d: Destination): boolean {
  return DESTINATION_PART_FIELDS.every((f) => !destinationFieldSet(d, f) || DESTINATION_PARTS.some((p) => p.field === f && p.fits(e, d)));
}

/**
 * Bodies the pipeline applies, and for which events (m6 design 2.6): the body kind's own test (effects/registries.ts#BODY_KINDS; the milestone 5 kinds in
 * effects/bodies/m5.ts), and every M6 field of an `enters` body or of a destination taken by a registered part. Capabilities `body:<b>` and their forms are
 * built from the same entries (effects/propose.ts#REPLACEMENT_BODIES).
 */
export function bodyFits(e: Proposed, b: ReplacementBody, g?: Game): boolean {
  const kind = BODY_KINDS[b.b] as BodyKind | undefined;
  if (!kind || !kind.fits(g as Game, e, b)) return false; // instead, redirect, skip, during: until their owners register them; regeneration: rules/destroy.ts
  if (b.b === 'enters') return ENTERS_PART_FIELDS.every((f) => !entersFieldSet(b, f) || ENTERS_PARTS.some((p) => p.field === f));
  if (b.b === 'modify' && b.destination !== undefined) return destinationFits(e, b.destination);
  return true;
}

/** Does the pattern concern the object the ability is on (design 8.5: `feature:replace.self`)? The same test as the capability walker's (model/cap-walk.ts). */
export const aboutSelf = (p: EventPattern): boolean => aboutSelfPattern(p);

// ---- the event as a pattern sees it ------------------------------------------------------------------------------------------------

const handleOf = (g: Game, id: ObjectId): ObjHandle | null => {
  const o = g.s.objects[id];
  if (o) return { id, zone: o.zone };
  const l = g.s.lki[id];
  return l ? { id, zone: l.leftZone } : null;
};


/**
 * The semantic event (types/state.ts#SemEvent) the proposed event would be, as triggers/match.ts reads it. M6-0: dispatched through
 * effects/registries.ts#PROPOSAL_KINDS (the milestone 5 cases moved unchanged to effects/proposal-kinds/m5.ts).
 */
export function semOf(g: Game, e: Proposed): SemEvent {
  return kindOf(e).semOf(g, e);
}

/**
 * M6-0 (m6 design D2): the `feature:replace.on.<ev>[.<verb>]` names of the pattern kinds the pipeline translates: those of the registered proposal kinds.
 * model/capabilities.ts adds them to the engine's set; the walker names one for every replacement pattern (model/cap-walk.ts#replaceOnName).
 */
export const REPLACE_ON_CAPABILITIES: readonly string[] = [...new Set(Object.values(PROPOSAL_KINDS).flatMap((k) => [...k.capabilities]))].sort();

/** A filter with `is` anywhere below its top level cannot be evaluated by this module. */
const nestedIs = (f: ObjectFilter | undefined): boolean => f !== undefined && ((f.anyOf ?? []).some((x) => x.is !== undefined || nestedIs(x)) || (f.not !== undefined && (f.not.is !== undefined || nestedIs(f.not))));

/** Objects a top-level `is` stands for, as handles (a fixed set, or the source itself); null when the reference can't be read here. */
function isSet(g: Game, ref: NonNullable<ObjectFilter['is']>, source: ObjectId): ObjHandle[] | null {
  if (ref.ref === 'fixed') return ref.objects.map((h) => ({ id: h.id, zone: h.zone }));
  if (ref.ref === 'self') {
    const h = handleOf(g, source);
    return h ? [h] : [];
  }
  return null; // any other reference needs an interpreter context: the pattern does not match (fail closed)
}

/**
 * audit-fix-1 (CR 609.7a, 608.2h, 400.7; from memory, unverified): beyond the object itself, what a chosen "source of your choice" stands for as a damage source
 * (a chosen ability on the stack is bound as its source already, effects/handlers/choose.ts#sourceStoodFor):
 * - a permanent spell: the permanent it became as it resolved ("any damage dealt by the permanent that spell becomes");
 * - an object that has left its zone (a creature that died with its trigger on the stack): the new object its move made, which is how the engine names "it" of
 *   that trigger ("When this creature dies, it deals 2 damage ...": the creature as it last existed, CR 608.2h).
 * Only that one move: the object after any later zone change is a different object (CR 400.7).
 */
function standsForSource(g: Game, h: ObjHandle, obj: ObjHandle): boolean {
  const lk = g.s.lki[h.id];
  if (lk === undefined || lk.newId === undefined || lk.newId !== obj.id || g.s.objects[h.id] !== undefined) return false;
  if (h.zone === 'stack') return (lk.object.kind === 'card' || lk.object.kind === 'spellCopy') && lk.leftZone === 'stack' && obj.zone === 'battlefield';
  return lk.leftZone === h.zone;
}

/** The pattern's role filters that may carry `is`, with the object of the event each one is about. */
function roleFilters(p: EventPattern, e: Proposed): { get: () => ObjectFilter | undefined; set: (f: ObjectFilter | undefined) => EventPattern; object: ObjHandle | null }[] {
  switch (p.ev) {
    case 'zoneChange': return e.ev === 'zoneChange' ? [{ get: () => p.subject, set: (f) => ({ ...p, subject: f ?? {} }), object: e.object }] : [];
    case 'damage':
      if (e.ev !== 'damage') return [];
      return [
        { get: () => p.source, set: (f) => ({ ...p, source: f }) as EventPattern, object: e.source },
        { get: () => p.recipient?.object, set: (f) => ({ ...p, recipient: { ...p.recipient, object: f } }) as EventPattern, object: typeof e.to === 'string' ? null : e.to },
      ];
    case 'counters': return e.ev === 'counters' && !('player' in p.on) ? [{ get: () => ('player' in p.on ? undefined : p.on), set: (f) => ({ ...p, on: f ?? {} }), object: typeof e.on === 'string' ? null : e.on }] : [];
    case 'action': return e.ev === 'destroy' ? [{ get: () => p.object, set: (f) => ({ ...p, object: f }) as EventPattern, object: e.object }] : [];
    default: return [];
  }
}

/** Does the proposed event match the pattern, for an effect whose source is `source` and whose controller is `controller`? Fails closed on what it can't read. */
/** r5-repl (CR 504.1): would this draw be the first card the player draws in their own draw step this turn? */
function firstInDrawStep(g: Game, player: PlayerId): boolean {
  const stats = g.player(player).turnStats;
  return g.s.turn.step === 'draw' && g.s.turn.activePlayer === player && stats.drawStepFrom !== undefined && stats.drawStepFrom === stats.cardsDrawn;
}

export function matchProposed(g: Game, pattern: EventPattern, e: Proposed, source: ObjectId, controller: PlayerId): boolean {
  let p = pattern;
  // Each role filter is rewritten on the CURRENT pattern (one role per entry, so the rewrites compose).
  for (const [i] of roleFilters(pattern, e).entries()) {
    const r = roleFilters(p, e)[i]!;
    const f = r.get();
    if (f === undefined) continue;
    if (nestedIs(f)) return false;
    if (f.is === undefined) continue;
    // PUSH1 T2 (CR 115.4): a damage recipient with an object part and a player part is either (triggers/match.ts): damage to a player is judged by the
    // player part alone, and an object part that matched leaves "any object" so that the player part does not exclude it
    const either = pattern.ev === 'damage' && i === 1 && pattern.recipient?.player !== undefined;
    const obj = r.object;
    if (either && !obj) {
      p = r.set(undefined);
      continue;
    }
    const set = isSet(g, f.is, source);
    // audit-fix-1 (CR 609.7a): a chosen "source of your choice" (fixed with `source`, effects/handlers/lasting-fix.ts#fixRef) also covers what it stands for
    const chosenSource = pattern.ev === 'damage' && i === 0 && f.is.ref === 'fixed' && f.is.source === true;
    if (!set || !obj || !set.some((h) => (h.id === obj.id && h.zone === obj.zone) || (chosenSource && standsForSource(g, h, obj)))) return false;
    const { is: _is, ...rest } = f;
    p = r.set(Object.keys(rest).length > 0 ? rest : either ? {} : undefined);
  }
  if (p.ev === 'zoneChange' && p.cause !== undefined) {
    if (e.ev !== 'zoneChange' || e.destination.cause !== p.cause) return false; // CR 608.2n "as it resolves" (buyback) is a move with the cause "resolve"
    const { cause: _cause, ...rest } = p;
    p = rest;
  }
  if (p.ev === 'draw' && p.exceptFirstInDrawStep === true) {
    // r5-repl (CR 504.1, 614.1a): "except the first one you draw in each of your draw steps": not a draw in the player's own draw step before they have drawn a
    // card in it (core/steps.ts records where that step's draws begin). A first draw that was replaced drew no card, so the next one is the first (unverified)
    if (e.ev !== 'draw' || firstInDrawStep(g, e.player)) return false;
    const { exceptFirstInDrawStep: _x, ...rest } = p;
    p = rest;
  }
  if (p.ev === 'zoneChange' && p.byOpponent === true) {
    // FAST5 T36 (CR 701.9a): the discard is the effect of a spell or ability an opponent of the discarding player (the card's owner) controls
    if (e.ev !== 'zoneChange' || e.destination.causedBy === undefined || e.destination.causedBy === g.s.objects[e.object.id]?.owner) return false;
    const { byOpponent: _by, ...rest } = p;
    p = rest;
  }
  // M6-1: a replacement of counters put on or removed from an OBJECT is about permanents ("on a creature you control", "on a permanent", CR 122.6): the
  // pattern's filter cannot say "on the battlefield" (the matcher reads no zone from a role filter), so a card elsewhere (time counters on a card in exile)
  // never matches one (fail closed: Doubling Season does not double them).
  if (p.ev === 'counters' && !('player' in p.on) && (e.ev !== 'counters' || typeof e.on === 'string' || e.on.zone !== 'battlefield')) return false;
  if ((p.ev === 'counters' || p.ev === 'createToken') && p.byEffect !== undefined) {
    // M6-1, CR 614.16: "if an EFFECT would put counters / create tokens" sees only what an effect does (a replacement effect included: the counters a
    // permanent enters with, CR 122.6); not what the rules do (CR 714.3c) nor what a cost does. Absent `cause` is an effect (effects/api.ts#ProposalCause).
    if (p.byEffect === true && (e.ev !== p.ev || (e.cause !== undefined && e.cause !== 'effect' && e.cause !== 'replacement'))) return false;
    const { byEffect: _byEffect, ...rest } = p;
    p = rest as EventPattern;
  }
  if (p.ev === 'createToken' && p.token !== undefined) {
    // Cloud r3-repl (CR 111.1, 614.1a): "if one or more creature tokens would be created": the proposal names the token's definition, not an object yet, so
    // the filter is read from that definition's characteristics (the face it enters with, CR 707.8a). Only card types (and "token") are read; any other
    // filter field fails closed (the trigger matcher's `newObject` role does not exist before the token does).
    if (e.ev !== 'createToken' || !tokenDefMatches(g, p.token, e.token, e.enter?.face ?? 0)) return false;
    const { token: _token, ...rest } = p;
    p = rest;
  }
  return matchEvent(p, semOf(g, e), { g, source, controller, lookBack: false });
}

/**
 * Cloud r3-repl: does the token definition `defId` (the face `face`) match `f`, a filter of card types (any of, CR 205.2a) and `token`? Fails closed otherwise.
 * pc-tokens-2 (CR 205.3, 111.10): also subtypes (all of them) and `anyOf` (one of several such filters): "a Clue, Food, or Treasure token" (Academy Manufactor).
 */
function tokenDefMatches(g: Game, f: ObjectFilter, defId: string, face: number): boolean {
  if (Object.keys(f).some((k) => k !== 'types' && k !== 'token' && k !== 'subtypes' && k !== 'anyOf')) return false;
  if (f.token === false) return false;
  const chars = g.s.defs[defId]?.faces[face];
  const types = chars?.types;
  if (!types) return false;
  if (f.types !== undefined && !f.types.some((t) => (types as string[]).includes(t))) return false;
  if (f.subtypes !== undefined && !f.subtypes.every((t) => ((chars?.subtypes ?? []) as string[]).includes(t))) return false;
  if (f.anyOf !== undefined && !f.anyOf.some((a) => tokenDefMatches(g, a, defId, face))) return false;
  return true;
}

// ---- conditions ---------------------------------------------------------------------------------------------------------------------

const holds = (cx: ExecCtx, c: Condition | undefined): boolean => c === undefined || evalCond(cx, c);
/**
 * std-library-4 (CR 614.1a): a replacement effect's own condition may read the amount of the event it would replace, "If you would pay life while your library has at
 * least that many cards in it" (Ashiok, Wicked Manipulator): `{q:'eventAmount'}` is that amount there (effects/instead.ts#eventAmount); the static ability's condition
 * is about the game, not the event, and reads none.
 */
const holdsFor = (cx: ExecCtx, c: Condition | undefined, e: Proposed): boolean => {
  if (c === undefined) return true;
  const amount = eventAmount(e);
  return evalCond(amount === undefined ? cx : { ...cx, event: { ev: 'action', roles: {}, before: {}, amount } }, c);
};

// ---- collecting the candidates ----------------------------------------------------------------------------------------------------

/**
 * CR 616.1a-e priority class of a replacement (design 8.5; m6 design 3.1.3). Class 1 (CR 616.1b): it would change who controls the object as it enters, by an
 * `enters` body's `under` or a new destination on the battlefield with a controller; class 2 (CR 616.1c): it would make it enter as a copy, self or foreign;
 * class 3 (CR 616.1d): it would make it enter transformed, by an `enters` body or a new destination on the battlefield.
 */
export function klassOf(def: ReplacementDef): 0 | 1 | 2 | 3 | 4 {
  if (def.selfReplacement === true) return 0; // CR 614.15, 616.1a
  const b = def.body;
  const toBattlefield = b.b === 'modify' && b.destination?.zone === 'battlefield' ? b.destination : undefined;
  if ((b.b === 'enters' && b.under !== undefined) || (toBattlefield !== undefined && toBattlefield.controller !== 'owner')) return 1; // CR 616.1b: who controls it as it enters
  if (b.b === 'enters' && b.copy !== undefined) return 2; // CR 616.1c
  if ((b.b === 'enters' && b.transformed === true) || toBattlefield?.transformed === true) return 3; // CR 616.1d
  return 4; // CR 616.1e
}

/** The objects whose own abilities may replace or prevent this event (their abilities "about themselves"). */
function involved(g: Game, e: Proposed): { o: GameObject; face?: number; controller: PlayerId }[] {
  const live = (h: ObjHandle | null): GameObject | undefined => {
    const o = h ? g.s.objects[h.id] : undefined;
    return o && h && o.zone === h.zone ? o : undefined;
  };
  const out: { o: GameObject; face?: number; controller: PlayerId }[] = [];
  const add = (o: GameObject | undefined, controller?: PlayerId, face?: number): void => {
    if (o && o.kind !== 'ability' && !out.some((x) => x.o.id === o.id)) out.push({ o, controller: controller ?? o.controller, ...(face !== undefined ? { face } : {}) });
  };
  switch (e.ev) {
    case 'zoneChange':
      // CR 708.2a, 614.12: a permanent entering face down has no abilities as it would exist on the battlefield, so its own "as it enters" effects don't apply.
      // (An object already face down outside a hand or library has none in its current zone either: rules/base-chars.ts.)
      if (e.to === 'battlefield' && e.destination.faceDown === true) break;
      add(live(e.object), e.to === 'battlefield' ? e.destination.controller : undefined, e.destination.face);
      break;
    case 'damage': add(live(typeof e.to === 'string' ? null : e.to)); add(live(e.source)); break;
    case 'counters': add(live(typeof e.on === 'string' ? null : e.on)); break;
    case 'destroy': add(live(e.object)); break;
    default: break;
  }
  return out;
}

/**
 * The static abilities an object has (CR 113.6: printed, keyword-generated and granted). For an object entering the battlefield from another zone they are
 * those of the permanent as it would exist on the battlefield (CR 614.12): the face it enters as (CR 712.12) with the continuous effects that would apply
 * to it there, not those that apply only where it is now (WP29: "Cards in graveyards lose all abilities" does not stop a card returned from a graveyard
 * from entering tapped; Humility, which applies on the battlefield, does).
 */
function staticsOf(g: Game, o: GameObject, face: number | undefined, entering: PlayerId | undefined, e?: Proposed): { key: string; def: StaticAbilityDef }[] {
  const def = g.s.defs[o.defId];
  let c;
  if (entering !== undefined && o.zone !== 'battlefield') {
    const there = withEntersFacts(g, onBattlefield(g.s, o.id, entering, face !== undefined ? { face } : {}), o.id, e);
    c = charsOfObject(there, there.objects[o.id]!);
  } else c = face !== undefined && face !== o.face && def?.faces[face] ? faceChars(def, face) : charsOfObject(g.s, o);
  const out: { key: string; def: StaticAbilityDef }[] = [];
  for (const a of c.abilities) if (a.def.kind === 'static') out.push({ key: a.key, def: a.def });
  return out;
}

/**
 * CR 614.12, 616.1c, 616.1f: "taking into account replacement effects that have already modified how it enters": the facts the enters parts of this chain
 * already decided are put onto the hypothetical permanent (effects/registries.ts#ENTERS_PARTS `hypothetical`; a copy of the state, never the live one). Once a
 * copy effect is applied, the replacement effects that apply as it enters are the copied object's (Clone copying a creature that "enters with two +1/+1
 * counters" gets them), and the entering card's own are gone (Rusted Sentinel entering as a copy of Essence of the Wild enters untapped, CR 616.1f example).
 * A token being created (`from: null`) that enters as a copy already is one: its copy effect began as the choice was made (effects/enters-parts/copy.ts).
 */
function withEntersFacts(g: Game, there: GameState, id: ObjectId, e: Proposed | undefined): GameState {
  if (!e || e.ev !== 'zoneChange' || e.to !== 'battlefield') return there;
  const d = e.destination;
  const parts = ENTERS_PARTS.filter((p) => {
    const set = d[p.field === 'copy' ? 'copyOf' : p.field === 'faceDown' ? 'faceDownInfo' : p.field];
    return set !== undefined && set !== false && !(p.field === 'copy' && e.from === null);
  });
  if (parts.length === 0) return there;
  const alt: GameState = { ...there, objects: { ...there.objects, [id]: { ...there.objects[id]! } } }; // the parts may write to the state and the object
  for (const p of parts) p.hypothetical(alt, alt.objects[id]!, d);
  return alt;
}

const isEnters = (r: ReplacementDef, e: Proposed): boolean => (r.body.b === 'enters' || selfEntryInstead(r)) && e.ev === 'zoneChange' && e.to === 'battlefield';

/**
 * p2-replace-events-1 (CR 614.12, 614.1a): "If this land would enter, sacrifice a Swamp instead. If you do, put this land onto the battlefield. ..." (Lake of the
 * Dead; Mox Diamond from the stack) replaces how the object itself enters, so like an enters replacement it is consulted from the entering object whatever its
 * zone: the `insteadThen` with a condition, of the object itself entering the battlefield.
 */
const selfEntryInstead = (r: ReplacementDef): boolean => r.body.b === 'insteadThen' && r.body.if !== undefined && r.replaces.ev === 'zoneChange' && r.replaces.subject.self === true
  && [r.replaces.to].flat().join() === 'battlefield';

/** CR 614.12: an enters replacement is consulted from the entering object whatever its zone; any other ability only where it functions (CR 113.6, 604.1). */
const functions = (a: StaticAbilityDef, o: GameObject, r: ReplacementDef, e: Proposed): boolean => isEnters(r, e) || (a.zone ?? ['battlefield']).includes(o.zone);

/**
 * M6-0 (m6 design 2.6): a kind with `selfCandidatesFrom` (turning face up, transforming: CR 708.11, 712.20) names the one object whose own replacement effects
 * apply and the characteristics they are read from (those it WILL have); the others use the objects the event involves (`involved`, `staticsOf`).
 */
function selfSources(g: Game, e: Proposed): { o: GameObject; controller: PlayerId; statics: { key: string; def: StaticAbilityDef }[] }[] {
  const from = kindOf(e).selfCandidatesFrom?.(g, e);
  if (from !== undefined) {
    const o = from ? g.s.objects[from.object] : undefined;
    if (!from || !o) return [];
    return [{ o, controller: o.controller, statics: from.chars.abilities.flatMap((a) => (a.def.kind === 'static' ? [{ key: a.key, def: a.def }] : [])) }];
  }
  return involved(g, e).map(({ o, face, controller }) => ({ o, controller, statics: staticsOf(g, o, face, e.ev === 'zoneChange' && e.to === 'battlefield' ? controller : undefined, e) }));
}

function selfCandidates(g: Game, e: Proposed): Candidate[] {
  const out: Candidate[] = [];
  for (const { o, controller, statics } of selfSources(g, e)) {
    let cx: ExecCtx | undefined;
    for (const { key, def: a } of statics) {
      a.effects.forEach((eff, i) => {
        if (eff.s !== 'replace' || eff.shield !== undefined) return;
        if (eff.selfReplacement !== true && !aboutSelf(eff.replaces)) return; // another object's replacement: milestone 6 (feature:replace.foreign)
        if (!bodyFits(e, eff.body, g) || !functions(a, o, eff, e)) return;
        if (!matchProposed(g, eff.replaces, e, o.id, controller)) return;
        cx ??= contextFor(g, o, controller);
        if (!holds(cx, a.condition) || !holdsFor(cx, eff.condition, e)) return; // CR 611.3a; Kavu Titan: the spell's cast record (CR 400.7d, 607.2i)
        out.push({ id: `self:${o.id}:${key}:${i}`, def: eff, source: { id: o.id, zone: o.zone }, klass: klassOf(eff), sourceName: g.nameOf(o.id), controller });
      });
    }
  }
  return out;
}

/** Is the shield still in force? Durations other than "while the source ..." end through the turn structure (CR 514.2, 611.2). */
function shieldAlive(g: Game, rec: ContinuousEffectRec): boolean {
  if (rec.duration.d !== 'whileSource') return true;
  const src = rec.source ? g.s.objects[rec.source.id] : undefined;
  return src !== undefined && src.zone === rec.source!.zone;
}

/**
 * The game a pattern of another object's effect is matched in: for a permanent entering the battlefield, the state in which it already is there as it would
 * enter (CR 614.12, effects/entering.ts); otherwise the game itself. Computed once per `applicable` call, and only if needed.
 */
type MatchGame = () => Game;
const matchGameFor = (g: Game, e: Proposed): MatchGame => {
  let m: Game | undefined;
  return () => (m ??= isEntering(e) ? asItWouldEnter(g, e) : g);
};

/**
 * The replacement effects that resolved spells and abilities created (CR 614.1, 615.7-615.8, 611.2a), in timestamp order: the shields ("the next time", "the
 * next N damage", `rec.effect.shield`) and the effects that last for a duration ("prevent all combat damage that would be dealt this turn"). Milestone 5 ran
 * prevention shields only; M6-1 (m6 design 3.2) runs every body as a shield (`feature:shield.<b>`) and the effects without a shield (part of
 * `feature:replace.foreign`). "You" is the record's controller (CR 109.5); a subject fixed when the effect was created is matched as that object only
 * (CR 611.2c, `is: {ref:'fixed'}`).
 */
function recordCandidates(g: Game, e: Proposed, at: MatchGame): Candidate[] {
  const out: Candidate[] = [];
  for (const rec of g.s.continuousEffects) {
    if (rec.effect.s !== 'replace') continue;
    const def = rec.effect;
    if (!bodyFits(e, def.body, g) || !shieldAlive(g, rec)) continue;
    const source = rec.source?.id ?? '';
    if (!matchProposed(at(), def.replaces, e, source, rec.controller)) continue;
    if (def.condition !== undefined) {
      const src = rec.source ? g.s.objects[rec.source.id] ?? g.s.lki[rec.source.id]?.object : undefined;
      if (!src || !evalCond(contextFor(g, src, rec.controller), def.condition)) continue;
    }
    const shield = def.shield !== undefined;
    out.push({
      id: `${shield ? 'shield' : 'effect'}:${rec.id}`, def, source: rec.source ?? { id: source, zone: 'battlefield' }, klass: klassOf(def), sourceName: rec.sourceName,
      controller: rec.controller, ...(shield ? { recId: rec.id } : {}),
    });
  }
  return out;
}

/**
 * M6-1 (m6 design 3.1.1, E1, D2): the replacement effects of the static abilities of OTHER objects that apply: from the index (effects/replacement-index.ts,
 * bucketed by the pattern's event kind, only where the ability functions, CR 113.6, 604.1), whose body the pipeline applies to this event, whose pattern
 * matches the event (for an entering permanent: as it would exist on the battlefield, CR 614.12), and whose static and effect conditions hold (CR 611.3a).
 * "You" is the source's controller after layer 2 (CR 109.5, 613.1b).
 */
function foreignCandidates(g: Game, e: Proposed, at: MatchGame): Candidate[] {
  const entries = replacementIndex(g.s).get(semOf(g, e).ev);
  if (!entries || entries.length === 0) return [];
  const out: Candidate[] = [];
  for (const x of entries) {
    const o = g.s.objects[x.object];
    if (!o || o.zone !== x.zone) continue;
    if (x.effect.body.b === 'enters' && ENTERING_TOGETHER.get(g)?.has(o.id) === true) continue; // CR 614.12: entering at the same time
    if (!bodyFits(e, x.effect.body, g)) continue;
    const controller = controllerOf(g.s, o);
    if (!matchProposed(at(), x.effect.replaces, e, o.id, controller)) continue;
    const cx = contextFor(g, o, controller);
    if (!holds(cx, x.ability.condition) || !holdsFor(cx, x.effect.condition, e)) continue;
    out.push({ id: `foreign:${o.id}:${x.key}:${x.index}`, def: x.effect, source: { id: o.id, zone: o.zone }, klass: klassOf(x.effect), sourceName: g.nameOf(o.id), controller });
  }
  return out;
}

/**
 * Every replacement and prevention effect that applies to the event now (design 8.5; m6 design 3.1.1), in a fixed order: the objects' own, then the effects of
 * resolved spells and abilities by age (shields and effects with a duration), then (M6-0, m6 design 2.6) the replacement effects the rules generate
 * (`RULE_REPLACEMENTS`, CR 714.3a-b; empty until M6-6), then (M6-1) the static abilities of other objects.
 */
export function applicable(g: Game, e: Proposed): Candidate[] {
  // trek-8 review (CR 702.12b, 614.6; the Hyena Umbra ruling of 2024-06-07): an indestructible permanent is not destroyed by an effect that says "destroy" ("effects that
  // try to destroy it simply have no effect"), so there is no destruction for any "if it would be destroyed" replacement effect to replace: none applies to it
  // (rules/destroy.ts reports 'indestructible', and a regeneration shield is not used up)
  if (e.ev === 'destroy') {
    const o = g.s.objects[e.object.id];
    if (o !== undefined && o.zone === 'battlefield' && isIndestructible(g, o)) return [];
  }
  const at = matchGameFor(g, e);
  const out = [...selfCandidates(g, e), ...recordCandidates(g, e, at)];
  for (const r of RULE_REPLACEMENTS) out.push(...r(g, e));
  out.push(...foreignCandidates(g, e, at));
  return out;
}

export { handleOf };
