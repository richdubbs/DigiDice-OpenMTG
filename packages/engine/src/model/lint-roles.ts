/**
 * Which `EventRole`s each event pattern exposes to the effect it triggers (design 3.5, the "Roles exposed to the effect" column). Owner: WP1.
 * Data only; the lint (`bad-event-role`) and the parser's role resolution read it. A role not listed for an `ev` is a compile error, not a guess.
 */
import type { EventPattern, EventRole, PlayerRef } from '../types/ability';

export const EVENT_ROLES: Readonly<Record<EventPattern['ev'], readonly EventRole[]>> = {
  zoneChange: ['subject', 'player'], // CR 603.6: the object in its new zone; its controller as it last existed
  cast: ['spell', 'player'], // CR 601.2i
  activate: ['source', 'player', 'spell'], // CR 602.2: the activated ability is on the stack ("copy that ability", Rings of Brighthearth)
  // std-rx16 (INTERFACE CHANGE, additive): `subject` is the combatant the event is about (attacks: the attacker; blocks: the blocker; becomes blocked: the
  // attacker), so "Whenever a creature you control attacks or blocks, it ..." names one role in both patterns; only such a disjunction names it (silentRole)
  attacks: ['attacker', 'defender', 'player', 'subject'], // CR 508.1
  // FAST3 T14 (INTERFACE CHANGE): `object` is the other combatant of the pair (blocks: the attacker; becomes blocked: the blocker), CR 509.1, 509.3; the
  // parser names it only where the patterns of a disjunction differ in who the other creature is (parser/lower/scope.ts#eventMentions)
  blocks: ['blocker', 'attacker', 'object', 'subject'], // CR 509.1
  becomesBlocked: ['blocker', 'attacker', 'object', 'subject'],
  attacksUnblocked: ['attacker', 'player'], // std-rx35 (CR 509.1h): the unblocked attacker and its controller
  damage: ['source', 'object', 'recipient'], // CR 120.1
  step: ['player'], // CR 603.2b: whose step it is
  beginTurn: ['player'],
  life: ['player'],
  draw: ['player'],
  // FAST5 T59 (INTERFACE CHANGE, additive): `object` is `subject` under the name a damage event gives the damaged object, so a trigger of "becomes tapped or is dealt damage" has one role
  // for the creature in both events (parser/lower/scope.ts#eventMentions); a lone "becomes" never names it twice (silentRole)
  becomes: ['subject', 'spell', 'player', 'object'], // `targeted` exposes the targeting spell or ability as `spell`
  counters: ['subject', 'player'],
  action: ['player', 'subject'],
  createToken: ['player', 'newObject'],
  dieRoll: ['player'],
  coinFlip: ['player'], // cloud r3-mech (CR 705.2)
  state: [], // CR 603.8: a state trigger has no event to read
  resolves: ['subject'], // CR 608.2p
  phase: ['player'], // M6-0, CR 614.10: whose phase it is (replacement patterns only)
  dayNight: [], // M6-0, CR 731.1a: no object or player
  loseGame: ['player'], // M12-3, CR 603.9: the player who lost the game
  abilityTriggered: ['subject', 'spell'], // std-copy-6 (CR 603.2): the object whose triggered ability triggered, and that ability ("copy that ability")
  controlChange: ['subject', 'player'], // Standard round 3, r3-trig (CR 108.4): the permanent, and the player who gained control of it
};

/** Does every pattern expose the role? (A trigger with several `on` patterns is a disjunction, so each must supply it.) */
export const patternsExpose = (patterns: readonly EventPattern[], role: EventRole): boolean =>
  patterns.length > 0 && patterns.every((p) => (EVENT_ROLES[p.ev] ?? []).includes(role));

/** Events whose occurrence has a number that "that much" / "that many" can read (design 3.5; `{q:'eventAmount'}`): damage dealt, life, cards drawn, counters, a batch. */
export const AMOUNT_EVENTS: ReadonlySet<EventPattern['ev']> = new Set(['damage', 'life', 'draw', 'counters', 'zoneChange', 'createToken']);

/**
 * FAST4 T26 INTERFACE CHANGE (additive, optional `batch`): a "one or more" attack trigger has an amount too ("whenever one or more Dinosaurs you control
 * attack, create that many Treasure tokens"): each attacking creature that matched is one event of the batch, so the amount is how many attacked
 * (triggers/context.ts, CR 508.1, 603.2c). A trigger for one attacker ("whenever ~ attacks") has no number to read.
 *
 * Does every pattern have an amount to read? FAST4 T22 INTERFACE CHANGE (additive): a discard action too ("whenever you discard one or more cards, put that
 * many +1/+1 counters on ~"): each discarded card is one event, so the amount is the number of cards discarded (triggers/context.ts, CR 701.9a, 603.2c).
 * Merge train 8 (additive, optional `replaced`): the patterns are the event a replacement replaces (model/lint-nodes.ts#providerIsReplacement); a scry has its
 * number only there, so "Whenever you scry, discover again for the same value" has no amount to read (CR 701.57a, 701.22a) and "that many" of a scry trigger none.
 */
export const patternsHaveAmount = (patterns: readonly EventPattern[], batch = false, replaced = false): boolean =>
  patterns.length > 0 && patterns.every((p) => AMOUNT_EVENTS.has(p.ev) || (p.ev === 'action' && (p.verb === 'discard' || p.verb === 'discover' /* std-rx26: its N, CR 701.57a */ || p.verb === 'payLife' /* std-library-4: the life paid, CR 119.4 (a replacement's pattern only) */ || (replaced && p.verb === 'scry') /* p2-replace-events-3: the number of cards, CR 701.22a: only the scry proposal carries it (effects/proposal-kinds/scry.ts); the "whenever you scry" event has none (triggers/normalize.ts) */)) || (batch && p.ev === 'attacks')
    || (batch && p.ev === 'becomes' && p.untapStep === true)); // Standard round 5, r5-trig: the permanents untapped in the untap step (CR 502.3)

/**
 * PUSH1 T2 (INTERFACE CHANGE of this WP1 file; design 6.4): an exposed role that is NOT a candidate for a pronoun of the effect. Shared by the parser's
 * discourse model (parser/lower/scope.ts) and the renderer's unique-candidate check (render/refs.ts#markTriggerRoles), so the two never disagree.
 *  1. A role the event never fills for this pattern (triggers/normalize.ts): the `spell` of a "becomes" event other than "becomes the target of" (only a
 *     targeting has a spell or ability), and the damaged `object` of damage dealt to a player (CR 120.3: one recipient per damage event).
 *  2. In a trigger of ONE pattern, the other combatant of "blocks" / "becomes blocked" when the clause does not name it ("Whenever ~ blocks, it gets
 *     +0/+2": the attacker is no phrase of the text, CR 509.1). In a disjunction ("blocks or becomes blocked") a role is a different combatant per
 *     pattern (~ blocks; something blocks ~), so it stays a candidate and such a pronoun stays ambiguous (manual).
 *  3. Except when every pattern is ~ itself blocking or becoming blocked with no other combatant named ("Whenever ~ blocks or becomes blocked, it gets
 *     +1/+1", `selfCombatOnly`): then no combatant role is a candidate, and the object itself is (parser/lower/scope.ts adds it as {ref:'self'}: a block
 *     does not move it, CR 509.1).
 */
export function silentRole(on: readonly EventPattern[], role: EventRole): boolean {
  if (selfCombatOnly(on)) return role === 'attacker' || role === 'blocker' || role === 'object' || role === 'subject';
  // std-rx16 (CR 508.1, 509.1): the `subject` of a combat event is a candidate only in a disjunction of combat events whose own combatants are different roles
  // ("attacks or blocks": the attacker, then the blocker) and are not ~ itself (named as ~, parser/lower/scope.ts); everywhere else the attacker or blocker
  // role already names the same creature
  if (role === 'subject' && on.some((p) => COMBAT_EVENTS.has(p.ev))) return !combatSubjectNamed(on);
  return on.length > 0 && on.every((p) => {
    // (the renderer also reads `source` of "becomes" and `object` of "blocks" / "becomes blocked" as names of the same places: render/refs.ts#roleIn)
    if (p.ev === 'becomes' && (role === 'spell' || role === 'source')) return p.what !== 'targeted';
    // std-rx31: except the permanent "becomes attached to a <permanent>" names (`by`), the event's own object (triggers/normalize.ts)
    if (p.ev === 'becomes' && role === 'object') return !(p.what === 'attached' && p.by !== undefined); // FAST5 T59: the same object as `subject` (a pronoun already has it)
    if (p.ev === 'damage' && role === 'object') return p.recipient?.player !== undefined && p.recipient.object === undefined;
    // FAST1 T4, CR 605.3b: a mana ability doesn't use the stack, so the activation of one has no ability on the stack to name ("its controller" is the land's)
    if (p.ev === 'activate' && role === 'spell') return p.manaAbility === true;
    // FAST1 T4: in "becomes the target of a spell or ability an opponent controls" the player the text names is the one who controls that spell or ability, while
    // the event's `player` is the targeted object's controller: "that player" would bind to the wrong one, so the role is no antecedent (the sentence stays manual)
    if (p.ev === 'becomes' && p.what === 'targeted' && role === 'player') return p.by?.controller !== undefined;
    // FAST5X E20: committing a crime (CR 700.13) and expending N (CR 700.14) are a player's; they have no object (rules/crime.ts emits none)
    if (p.ev === 'action' && role === 'subject' && p.object === undefined && SUBJECTLESS_VERBS.has(p.verb)) return true;
    if (on.length !== 1) return false;
    if (p.ev === 'blocks' && (role === 'attacker' || role === 'object')) return p.attacker === undefined;
    if (p.ev === 'becomesBlocked' && (role === 'blocker' || role === 'object')) return p.by === undefined;
    return false;
  });
}

const COMBAT_EVENTS: ReadonlySet<EventPattern['ev']> = new Set(['attacks', 'blocks', 'becomesBlocked']);
const COMBATANT = (p: EventPattern): unknown => (p.ev === 'attacks' ? p.attacker : p.ev === 'blocks' ? p.blocker : p.ev === 'becomesBlocked' ? p.attacker : undefined);

/**
 * std-rx16 (T3 of the push wave, CR 509.1): in a disjunction of "attacks" or "becomes blocked" with "blocks", the attacker or blocker role is a different
 * creature per pattern (the creature that attacks; the attacker it blocks), so it is no antecedent (parser/lower/scope.ts#eventMentions, render/refs.ts#antecedents).
 */
export function mixedCombatRole(on: readonly EventPattern[], role: EventRole): boolean {
  if (role !== 'attacker' && role !== 'blocker') return false;
  if (!(on.some((p) => p.ev === 'blocks') && on.some((p) => p.ev === 'attacks' || p.ev === 'becomesBlocked'))) return false;
  const side = (p: EventPattern): boolean => (p.ev === 'blocks' ? 'blocker' : p.ev === 'attacks' || p.ev === 'becomesBlocked' ? 'attacker' : undefined) === role;
  return !on.every((p) => side(p) === side(on[0]!));
}

/** std-rx16: a disjunction of combat events whose own combatant is the attacker in one and the blocker in another, none of them ~ itself. */
function combatSubjectNamed(on: readonly EventPattern[]): boolean {
  if (on.length < 2 || !on.every((p) => COMBAT_EVENTS.has(p.ev)) || on.some((p) => onlySelf(COMBATANT(p)))) return false;
  const sides = new Set(on.map((p) => (p.ev === 'blocks' ? 'blocker' : 'attacker')));
  return sides.size > 1;
}

/** FAST5X E20: actions of a player that no object takes part in (triggers/normalize.ts gives them no `subject`). */
export const SUBJECTLESS_VERBS: ReadonlySet<string> = new Set(['commitCrime', 'expend', 'faceDilemma' /* trek-2: a player's mode choice (actions/announce.ts#chooseModes emits no object) */]);

const onlySelf = (f: unknown): boolean => typeof f === 'object' && f !== null && Object.entries(f).every(([k, v]) => (k === 'self' ? v === true : v === undefined)) && (f as { self?: unknown }).self === true;

/** PUSH1 T2: every pattern of a disjunction is ~ itself blocking or becoming blocked, the other combatant never named ("blocks or becomes blocked"). */
export function selfCombatOnly(on: readonly EventPattern[]): boolean {
  return on.length > 1 && on.every((p) => (p.ev === 'blocks' && onlySelf(p.blocker) && p.attacker === undefined) || (p.ev === 'becomesBlocked' && onlySelf(p.attacker) && p.by === undefined));
}

/**
 * PUSH1 T2 (design 6.4): a role of a lone trigger pattern that the clause does not name is a participant of the event, never a phrase of the text: a
 * description can still pick it out ("that source", the damage's source), a bare pronoun cannot ("Whenever ~ is dealt damage, put a +1/+1 counter on it":
 * "it" is ~, not the unnamed source). Shared by the parser (lower/anaphora.ts#compatible) and the renderer (render/refs.ts#candidateCheck).
 */
export function implicitRole(on: readonly EventPattern[], role: EventRole): boolean {
  if (on.length !== 1) return false;
  const p = on[0]!;
  if (p.ev === 'damage') return (role === 'source' && p.source === undefined) || (role === 'object' && p.recipient?.object === undefined);
  return false;
}

/** std-rx19: "becomes the target of a spell or ability an opponent controls" (CR 115.1), the pattern ward expands to (keywords/data/ward.json). */
export const opponentTargets = (p: EventPattern): boolean =>
  p.ev === 'becomes' && p.what === 'targeted' && p.by?.controller === 'opponent' && Object.keys(p.by).length === 1;

/** std-rx19: the controller of the spell or ability that targeted (CR 109.5), the player ward's "that player" names; "that player" of such a trigger's effect. */
export const TARGETING_CONTROLLER: PlayerRef = { ref: 'controllerOf', object: { ref: 'event', role: 'spell' } };
