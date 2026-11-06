/**
 * Which `EventRole`s each event pattern exposes to the effect it triggers (design 3.5, the "Roles exposed to the effect" column). Owner: WP1.
 * Data only; the lint (`bad-event-role`) and the parser's role resolution read it. A role not listed for an `ev` is a compile error, not a guess.
 */
import type { EventPattern, EventRole, PlayerRef } from '../types/ability';

export const EVENT_ROLES: Readonly<Record<EventPattern['ev'], readonly EventRole[]>> = {
  zoneChange: ['subject', 'player'], // CR 603.6: the object in its new zone; its controller as it last existed
  cast: ['spell', 'player', 'spellTarget'], // CR 601.2i; edh-perms-21: `spellTarget`, the one target of a spell that "targets only a single X" (silentRole)
  activate: ['source', 'player', 'spell'], // CR 602.2: the activated ability is on the stack ("copy that ability", Rings of Brighthearth)
  // std-rx16 (INTERFACE CHANGE, additive): `subject` is the combatant the event is about (attacks: the attacker; blocks: the blocker; becomes blocked: the
  // attacker), so "Whenever a creature you control attacks or blocks, it ..." names one role in both patterns; only such a disjunction names it (silentRole)
  attacks: ['attacker', 'defender', 'player', 'subject'], // CR 508.1
  // FAST3 T14 (INTERFACE CHANGE): `object` is the other combatant of the pair (blocks: the attacker; becomes blocked: the blocker), CR 509.1, 509.3; the
  // parser names it only where the patterns of a disjunction differ in who the other creature is (parser/lower/scope.ts#eventMentions)
  blocks: ['blocker', 'attacker', 'object', 'subject'], // CR 509.1
  becomesBlocked: ['blocker', 'attacker', 'object', 'subject', 'defender'], // edh-c-68 (CR 508.1b, 509.1; Rakdos Roustabout): `defender`, the player or planeswalker the blocked creature attacks (silentRole)
  attacksUnblocked: ['attacker', 'player', 'defender'], // std-rx35 (CR 509.1h): the unblocked attacker and its controller; edh-combat-6: the player attacked (silentRole)
  damage: ['source', 'object', 'recipient'], // CR 120.1
  damagePrevented: ['source', 'object', 'recipient'], // edh-replace-3 (CR 615.13): the same roles as the damage that was prevented
  step: ['player'], // CR 603.2b: whose step it is
  beginTurn: ['player'],
  life: ['player'],
  draw: ['player'],
  reveal: ['player', 'subject', 'source'], // edh-next-144 (CR 701.20a, 607.2): the revealing player, the revealed card, the object whose rule revealed it
  // FAST5 T59 (INTERFACE CHANGE, additive): `object` is `subject` under the name a damage event gives the damaged object, so a trigger of "becomes tapped or is dealt damage" has one role
  // for the creature in both events (parser/lower/scope.ts#eventMentions); a lone "becomes" never names it twice (silentRole)
  becomes: ['subject', 'spell', 'player', 'object'], // `targeted` exposes the targeting spell or ability as `spell`
  counters: ['subject', 'player'],
  action: ['player', 'subject', 'by'], // edh-players-22: `by`, the controller of the spell or ability that destroyed the permanent (a destroy action with `by`; silent otherwise)
  createToken: ['player', 'newObject'],
  dieRoll: ['player'],
  coinFlip: ['player'], // cloud r3-mech (CR 705.2)
  state: [], // CR 603.8: a state trigger has no event to read
  resolves: ['subject', 'abilitySource'], // CR 608.2p; edhn102: `abilitySource`, the Saga whose final chapter ability resolved (CR 714.2e; silentRole)
  phase: ['player'], // M6-0, CR 614.10: whose phase it is (replacement patterns only)
  dayNight: [], // M6-0, CR 731.1a: no object or player
  monarch: ['player'], // edh-players-18, CR 725.3: the player who became the monarch
  loseGame: ['player'], // M12-3, CR 603.9: the player who lost the game
  abilityTriggered: ['subject', 'spell'], // std-copy-6 (CR 603.2): the object whose triggered ability triggered, and that ability ("copy that ability")
  controlChange: ['subject', 'player'], // Standard round 3, r3-trig (CR 108.4): the permanent, and the player who gained control of it
};

/** Does every pattern expose the role? (A trigger with several `on` patterns is a disjunction, so each must supply it.) */
export const patternsExpose = (patterns: readonly EventPattern[], role: EventRole): boolean =>
  patterns.length > 0 && patterns.every((p) => (EVENT_ROLES[p.ev] ?? []).includes(role));

/** Events whose occurrence has a number that "that much" / "that many" can read (design 3.5; `{q:'eventAmount'}`): damage dealt, life, cards drawn, counters, a batch. */
export const AMOUNT_EVENTS: ReadonlySet<EventPattern['ev']> = new Set(['damage', 'damagePrevented' /* edh-replace-3: the damage prevented, CR 615.13 */, 'life', 'draw', 'counters', 'zoneChange', 'createToken']);

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
  patterns.length > 0 && patterns.every((p) => AMOUNT_EVENTS.has(p.ev) || (p.ev === 'activate' && p.lifePaid === true /* edh-next-74: the life the cost paid, CR 602.2b, 118.3 */) || (p.ev === 'action' && (p.verb === 'discard' || p.verb === 'mill' /* edh-perms-20: the cards milled, CR 701.17a */ || p.verb === 'discover' /* std-rx26: its N, CR 701.57a */ || p.verb === 'payLife' /* std-library-4: the life paid, CR 119.4 (a replacement's pattern only) */ || p.verb === 'scry' /* edh-next-38: the cards looked at, the scry action's x (effects/handlers/cards-library.ts) */ || p.verb === 'scryBottom' /* edh-d-96: the cards put on the bottom, its x (CR 701.22a) */ )) || (batch && p.ev === 'attacks')
    || (!batch && p.ev === 'dieRoll') /* edh-next-43: the die's natural result, triggers/normalize.ts `amount`, CR 706.2 (Atomwheel Acrobats) */
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
  // edh-c-68: the defender of a blocked attacker is named by no phrase of "Whenever ~ becomes blocked" (only "the player or planeswalker it's attacking" reads it)
  if (role === 'defender' && on.length > 0 && on.every((p) => p.ev === 'becomesBlocked')) return true;
  if (selfCombatOnly(on)) return role === 'attacker' || role === 'blocker' || role === 'object' || role === 'subject';
  // std-rx16 (CR 508.1, 509.1): the `subject` of a combat event is a candidate only in a disjunction of combat events whose own combatants are different roles
  // ("attacks or blocks": the attacker, then the blocker) and are not ~ itself (named as ~, parser/lower/scope.ts); everywhere else the attacker or blocker
  // role already names the same creature
  if (role === 'subject' && on.some((p) => COMBAT_EVENTS.has(p.ev))) return !(combatSubjectNamed(on) || entersOrAttacks(on));
  // edh-perms-21 (CR 115.9c): the one target of a cast spell is a role only where the cast pattern says "targets only a single X" (spell.targetsOnly, each)
  // edhn102 (CR 714.2e, 113.7a; Narci, Fable Singer): the Saga a resolving final chapter ability came from is a role only of that pattern, where Oracle calls it "that Saga"
  if (role === 'abilitySource') return !on.every((p) => p.ev === 'resolves' && p.what.stackKind === 'finalChapterAbility');
  if (role === 'spellTarget') return !on.every((p) => p.ev === 'cast' && (p.spell?.targetsOnly as { ref?: string } | undefined)?.ref === 'each');
  return on.length > 0 && on.every((p) => {
    // (the renderer also reads `source` of "becomes" and `object` of "blocks" / "becomes blocked" as names of the same places: render/refs.ts#roleIn)
    if (p.ev === 'becomes' && (role === 'spell' || role === 'source')) return p.what !== 'targeted';
    // std-rx31: except the permanent "becomes attached to a <permanent>" names (`by`), the event's own object (triggers/normalize.ts)
    if (p.ev === 'becomes' && role === 'object') return !((p.what === 'attached' || p.what === 'unattached' /* edh-perms-10 */) && p.by !== undefined); // FAST5 T59: the same object as `subject` (a pronoun already has it)
    // edh-combat-6 (CR 509.1h, 508.5; Master of Cruelties): the player attacked by an unblocked attacker is a role only where the pattern says it attacks "a player" (any player; the other forms name them, "you")
    if (p.ev === 'attacksUnblocked' && role === 'defender') return p.defender !== 'any';
    // edh-players-22 (CR 109.5; Karmic Justice): the destroying player is a role only of a destroy pattern that names it (`by`); then "that opponent" is that player, and the event's `player` (the
    // controller of the destroyed permanent) is no antecedent (the clause names the destroyer)
    if (p.ev === 'action' && role === 'by') return p.verb !== 'destroy' || p.by === undefined;
    if (p.ev === 'action' && role === 'player' && p.verb === 'destroy' && p.by !== undefined) return true;
    if (p.ev === 'damage' && role === 'object') return p.recipient?.player !== undefined && p.recipient.object === undefined;
    // FAST1 T4, CR 605.3b: a mana ability doesn't use the stack, so the activation of one has no ability on the stack to name ("its controller" is the land's)
    if (p.ev === 'activate' && role === 'spell') return p.manaAbility === true;
    // FAST1 T4: in "becomes the target of a spell or ability an opponent controls" the player the text names is the one who controls that spell or ability, while
    // the event's `player` is the targeted object's controller: "that player" would bind to the wrong one, so the role is no antecedent (the sentence stays manual)
    if (p.ev === 'becomes' && p.what === 'targeted' && role === 'player') return p.by?.controller !== undefined;
    // edh-players-23 (CR 506.2, 508.1, 603.3a; Balor; the parser's rules of parser/lower/scope.ts, std-misc and trek-7, shared here so the renderer's candidates agree): the attacking player of "Whenever ~ attacks" and the
    // player of ~'s own zone change both control the ability, "you", never "they" or "that player": no antecedent of a pronoun ("Whenever ~ attacks or dies, ... equal to the number of cards in their hand")
    if (role === 'player' && (p.ev === 'attacks' || (p.ev === 'attacksUnblocked' && p.defender === 'any')) && p.attacker !== undefined && (onlySelf(p.attacker) || p.attacker.controller === 'you')) return true;
    if (role === 'player' && on.length > 1 && p.ev === 'zoneChange' && onlySelf(p.subject)) return true;
    // FAST5X E20: committing a crime (CR 700.13) and expending N (CR 700.14) are a player's; they have no object (rules/crime.ts emits none)
    if (p.ev === 'action' && role === 'subject' && p.object === undefined && SUBJECTLESS_VERBS.has(p.verb)) return true;
    if (on.length !== 1) return false;
    if (p.ev === 'blocks' && (role === 'attacker' || role === 'object')) return p.attacker === undefined;
    if (p.ev === 'becomesBlocked' && (role === 'blocker' || role === 'object')) return p.by === undefined || p.byAtLeast !== undefined /* edh-c-48 (CR 509.3e): a group of blockers is no one creature */;
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

/**
 * trek-22 (CR 603.2, 508.1, 608.2c; Janice Rand, Essential Aide: "Whenever a commander you control enters or attacks, put a +1/+1 counter on it"): a disjunction of an object
 * entering the battlefield and an object attacking, none of them ~ itself. The creature of the event is the `subject` of both (a zone change's object; an attack's `subject`
 * is the attacker, EVENT_ROLES), so "it" names it in either.
 */
export function entersOrAttacks(on: readonly EventPattern[]): boolean {
  if (on.length < 2 || on.some((p) => !((p.ev === 'zoneChange' && p.to === 'battlefield' && !onlySelf(p.subject)) || (p.ev === 'attacks' && p.attacker !== undefined && !onlySelf(p.attacker))))) return false;
  return on.some((p) => p.ev === 'zoneChange') && on.some((p) => p.ev === 'attacks');
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
  // edh-mana-keywords-5 (CR 602.2; Rings of Brighthearth, The Enigma Jewel): the source of "Whenever you activate an ability that isn't a mana ability" is not named: "it" and "that ability" are the ability
  if (p.ev === 'activate') return role === 'source' && p.source === undefined && p.activated === undefined;
  // edh-players-23 (CR 506.2, 508.1b; Star Athlete): the player a creature of yours attacks is named by no phrase of "Whenever ~ attacks" / "Whenever a creature you control attacks" (it says nothing of whom
  // it attacks): "that player" and "they" after an earlier phrase that names a player ("Its controller may sacrifice it. If they don't, ~ deals 5 damage to that player") are that player alone
  if (p.ev === 'attacks') return (role === 'defender' || role === 'player') && p.defender === undefined && (onlySelf(p.attacker) || p.attacker?.controller === 'you');
  return false;
}

/** std-rx19: "becomes the target of a spell or ability an opponent controls" (CR 115.1), the pattern ward expands to (keywords/data/ward.json). */
export const opponentTargets = (p: EventPattern): boolean =>
  p.ev === 'becomes' && p.what === 'targeted' && p.by?.controller === 'opponent' && Object.keys(p.by).length === 1;

/** std-rx19: the controller of the spell or ability that targeted (CR 109.5), the player ward's "that player" names; "that player" of such a trigger's effect. */
export const TARGETING_CONTROLLER: PlayerRef = { ref: 'controllerOf', object: { ref: 'event', role: 'spell' } };
