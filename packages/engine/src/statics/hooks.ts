/**
 * Rule hooks: restrictions, permissions and rule modifications from static abilities and resolved effects (design 9.4), applied after the objects' own
 * characteristics (CR 613.10-613.11). Owner: WP16.
 *
 * Nothing here interprets a `RestrictionDef.action` generically: each action is answered at a NAMED call-site that already exists (the hookpoints of
 * rules/hookpoints.ts, the untap step, the cleanup step, the land-play count, the life and game-end rules through rules/restrictions.ts), and its capability
 * (`rule:<action>`, `permit:<action>`, `rulemod:<rule>`) is registered in `RULE_HOOK_ACTIONS` only because that call-site consults this module. An action whose
 * call-site does not exist yet is listed in `UNWIRED_RULE_ACTIONS` with the package that owns it; a card that uses it stays manual (design 5.2).
 *
 * Semantics of a `RestrictionDef` (CR 101.2, 614.17):
 *   - it concerns an action of its `subject` (a player or an object, evaluated relative to the restriction's source: "you" is its controller, `self` its object);
 *   - `other` is the other object of the action (the attacker a creature blocks, the blocker of an attacker, what an attacker attacks, the spell being cast, the
 *     source of an ability being activated, the land being played, the spell or the source of the ability targeting, the attachment), matched in whatever zone
 *     it is, as what it is for the action (a card being cast is a spell on the stack, CR 601.2a, 601.3e; a targeting source is a spell or an ability, read
 *     from last known information when it has left, CR 113.7a; statics/rule-match.ts); a player never matches it;
 *   - `mode: 'cant'` forbids the action when `when` holds (or always) and `other` matches (or is absent); `max` turns it into a limit for the actions that have a
 *     per-turn count (cast: spells cast this turn, CR 601.2i; playLand: lands played, CR 305.2a) and is applied as a plain ban for any other action (fail closed;
 *     `feature:restrict.max` is not advertised, so no automated card has one);
 *   - `mode: 'onlyIf'` forbids the action UNLESS `when` holds and `other` matches ("cast this spell only during combat", "can block only creatures with flying");
 *   - `mode: 'mustIfAble'` is a requirement (CR 508.1d, 509.1c), not a prohibition: it never forbids anything here. R1 (M6-7a): the declare steps enforce the
 *     combat ones (statics/requirements.ts collects them, rules/requirements.ts maximizes the obeyed count), so `restrict:mustIfAble` is advertised;
 *     M6-7: also with `other` (`feature:require.other.<action>`: the creature to attack or block, the creatures to be blocked by).
 * An `other` or a `when` the statics can't evaluate (statics/rule-match.ts), or an `other` asked at a call-site that names no other object, is never read as
 * "does not apply": the restriction is applied and its denial says so (fail closed). Such data never comes from an automated card: the capability walker
 * names it (`rfilter:`, `rcond:`, `feature:restrict.other.<action>`), and only what is evaluated is registered (`OTHER_ACTIONS`).
 * "Can't" beats "can" (CR 101.2): the hookpoints return the first denial of any provider, and a permission never waives a restriction (only a keyword rule's
 * `Denial.waivedBy`).
 *
 * Forbidden events (design 8.5, for WP11's `forbidden`): `cantHappen(s, query)` is the "can't" check of CR 614.17 for any action; the proposal pipeline maps its
 * event to a query (draw -> `draw` of the player, a life gain -> `gainLife`, destroy -> `beDestroyed` of the object, a zone change to the battlefield ->
 * `enter`, counters put -> `haveCountersPut`, damage -> `dealDamage` of the source and `receiveDamage` of the recipient).
 *
 * WP31 wired the actions whose call-sites W2 left without a check: every call-site (effects/cant.ts for the pipeline, rules/cant.ts for the primitives and the
 * costs, the op handlers, core/resolve.ts for an Aura spell) asks `ruleDenial`, which answers only wired actions and judges `enter` as the permanent would exist
 * on the battlefield (`enterDenial`, CR 614.17d). Six actions stay unwired, each with its reason (`UNWIRED_RULE_ACTIONS`).
 */
import { playerAttackedPlayerLastTurn } from './last-turn-attack';
import { readLink } from './links';
import { seatNeighbor } from './seats';
import type { Condition, CostChange, ObjectFilter, PlayerPred, CostDef, KeywordAbilityDef, PermissionDef, RestrictionDef, RuleAction, RuleModDef, StaticEffect, ZoneName } from '../types/ability';
import type { CardDef } from '../types/card';
import type { ObjectId, PlayerId } from '../types/ids';
import { castOriginOf, type GameState } from '../types/state';
import type { ManaType } from '../types/mana';
import type { Denial } from '../rules/denial';
import type { Chars } from '../rules/characteristics';
import type { RuleHookProvider } from '../rules/hookpoints';
import type { RuleQuery, StaticEffectsFor } from './api';
import { expansionOf } from './abilities';
import { COST_QUANTITY_KINDS } from './costmods';
import { evalCondition, evalQuantity, playersOf, STATIC_CONDITION_KINDS, STATIC_QUANTITY_KINDS, type EvalCx } from './match';
import { objectMatches, RULE_FILTER_FIELDS, sourceView, spellActor, staticallyEvaluable, type Actor } from './rule-match';
import { REQUIREMENT_ACTIONS as REQUIREMENT_OTHER_ACTIONS, REQUIREMENT_PLAYER_ACTIONS } from './requirements';
import { linkedFlashNames, PLAY_PERMIT_CAPABILITIES } from './play-permits';
import { carriedIntoHypothetical } from './spell-carry';
import {
  charsViewOf, cxOf, defHasRuleEffects, overlayZone, refIncludes, ruleContext, ruleSourcesPresent, spellFaceChars, type CharsView, type RuleContext, type RuleSource,
} from './rule-sources';

/**
 * The optional `PermissionDef` fields each wired permission honors (design 5.2: `feature:permit.<action>.<field>`, emitted by model/cap-walk.ts). A
 * permission with any other field ("as though it had flash if you pay {2} more") is not applied here, and its card stays manual because the capability is
 * missing. GY1: "You may play lands from your graveyard" (a `play` permission with `from`) is read by statics/play-permits.ts, not here.
 */
const PERMIT_FIELDS: Readonly<Partial<Record<PermissionDef['action'], readonly string[]>>> = {
  haveFlash: ['of', 'asThough', 'costChange', 'addCost', 'ifTargets', 'ifXAtMost', 'firstOfKind'], // FAST5 T56: costChange is "if you pay {2} more" (hookpoints.castFlashCosts); a free permission has none; std-rx10: addCost (castFlashAddCosts)
  attackAsThoughNoDefender: ['of', 'asThough'],
  attackAsThoughHaste: ['of', 'opponentsOnly'], // edh-b-14: attacksAsThoughHaste below (CR 302.6, 508.1a, 609.4)
  blockAsThough: ['of', 'asThough', 'attacker'], // p2-attack-block-1: attacker (the attackers it concerns, any blocker; CR 609.4, 702.14c)
  activate: ['of', 'asThough'], // r4-fxz: "activate abilities of creatures you control as though those creatures had haste" (activatesAsThoughHaste)
  playLand: ['count'],
  assignAsUnblocked: ['of', 'mandatory'], // edh-d-25: mandatory (Outmaneuver), mustAssignAsUnblocked below; FAST5 T37: the source itself; edh-combat-3: or the objects `of` matches whose controller is `who` (Invasion of Ikoria, Indomitable Might), mayAssignAsUnblocked below
  activateLoyaltyAsInstant: ['of'], // r4-mech: loyaltyAsInstant below (CR 606.3)
  activateEquipAsInstant: [], // edh-mana-keywords-8: equipAsInstant below (CR 702.6a, 602.5d)
};
const OPTIONAL_PERMIT_FIELDS = ['of', 'from', 'asThough', 'count', 'costChange', 'grants', 'fromTop', 'oncePerTurn', 'attacker', 'ifTargets', 'ifXAtMost', 'firstOfKind', 'opponentsOnly', 'mandatory'] as const; // FAST5X E14: never honored here; p2-attack-block-1: attacker

/** FAST5 T56: the amount of a cost change that is a fixed generic increase ("pay {2} more"), the only form of a flash permission's price that is implemented; null for any other. */
export function genericIncrease(c: CostChange): number | null {
  const m = c.mana;
  if (c.kind !== 'increase' || Object.keys(c).length !== 2 || m === undefined || m.length !== 1) return null;
  const s = m[0]!;
  return s.kind === 'generic' && Number.isInteger(s.amount) && s.amount > 0 ? s.amount : null;
}

/**
 * edh-perms-4 (CR 601.3b): the spell's own "you may cast this spell as though it had flash. If you cast it any time a sorcery couldn't have been cast, ... sacrifices it" is not counted while
 * `fn` runs: rules/timing.ts#flashWithoutOffTimingPermit asks whether anything ELSE gives the spell flash (a choice of permission the player makes, CR 601.3: with another source they use that
 * one, and nothing is sacrificed). Synchronous and contained: set and cleared around one hookpoint call.
 */
let ignoreOffTimingPermits = false;
export function withoutOffTimingPermits<T>(fn: () => T): T {
  const before = ignoreOffTimingPermits;
  ignoreOffTimingPermits = true;
  try {
    return fn();
  } finally {
    ignoreOffTimingPermits = before;
  }
}

/** Does this module implement every field the permission has? */
const permitImplemented = (p: PermissionDef): boolean => OPTIONAL_PERMIT_FIELDS.every((k) => p[k] === undefined || (PERMIT_FIELDS[p.action] ?? []).includes(k));

/**
 * p2-player-rules-1 (CR 601.2i): the fields of a spell description that a limit on casting spells of a kind ("can't cast more than one noncreature spell each
 * turn") is counted with, from the turn's `cast` history (rules/history.ts#factsMatchFilter: the spell's characteristics as it was cast). model/cap-walk.ts names
 * only such limits `feature:restrict.max.cast.other`; `stackKind` and `zone` say only that it is a spell, as every cast entry is.
 */
export const CAST_KIND_LIMIT_FIELDS: readonly string[] = ['types', 'notTypes', 'allTypes', 'subtypes', 'notSubtypes', 'allSubtypes', 'supertypes', 'notSupertypes', 'colors', 'notColors', 'colorless', 'multicolored', 'monocolored', 'stackKind', 'zone'];

const named = (prefix: string, list: Iterable<string>): Record<string, true> => Object.fromEntries([...list].map((n) => [`${prefix}${n}`, true as const]));

/**
 * WP31 review: the rule actions whose EVERY call-site names the other object of the action, so a restriction's `other` filter is honored there
 * (`feature:restrict.other.<action>`, emitted by model/cap-walk.ts). Elsewhere a restriction with `other` is applied whatever the other object is (fail
 * closed, `verdict`) and its card is not automated, because the capability is missing.
 *   attack (what it attacks), block / beBlocked / beBlockedBy (the other creature), beTargeted (the spell or the source of the ability), cast / castFromZone
 *   (the spell), activate (the source), playLand (the land), beAttached / beEnchanted / beEquipped (the attachment), dealDamage / receiveDamage (the recipient
 *   / the source), sacrifice (the permanent, rules/cant.ts#costUseDenial at the handler and every cost), discard (the card: the handler, the cleanup step and
 *   the costs), beCountered (the spell or ability countering it, at the counter handler), preventCombatDamage (the damage's source, Cloud r5-repl).
 */
export const OTHER_ACTIONS: readonly RuleAction[] = [
  'attack', 'block', 'beBlocked', 'beBlockedBy', 'beTargeted', 'cast', 'castFromZone', 'activate', 'playLand', 'beAttached', 'beEnchanted', 'beEquipped',
  'dealDamage', 'receiveDamage', 'sacrifice', 'discard', 'beCountered',
  'search', // edh-zones-14: the spell or ability that causes the search, its source (effects/handlers/cards-library.ts; CR 701.23a)
  'preventCombatDamage', // Cloud r5-repl: the damage's source (effects/propose.ts#unpreventableIfRuled, its one call-site), "combat damage that would be dealt by creatures you control"
  'preventDamage', // edh-cast-12 (Banefire, "the damage can't be prevented"): the damage's source, asked at the same one call-site (effects/propose.ts#unpreventableIfRuled)
];

/**
 * FAST5 T36 INTERFACE CHANGE (additive): a restriction's `when` may read ONE piece of history, "a creature attacked a player this combat / this turn" ("only if
 * you've been attacked this step", CR 506.3, 601.3): `{cond:'happened', event:{ev:'attacks', defender:'you'|'opponent'|'any'}, scope:'combat'|'turn'}` with no
 * `times` or `by`. It is read from `GameState.history` here (model/cap-walk.ts names this one `rcond:happened.attacked`). FAST5X E9: every other history
 * condition is read as the statics read it (statics/match.ts `happened`, `scond:happened` / `rcond:happened`; the layer cache keys on the history since).
 */
export function isAttackedHistory(c: Condition): boolean {
  if (c.cond !== 'happened' || c.event.ev !== 'attacks' || c.times !== undefined || c.by !== undefined || (c.scope !== 'combat' && c.scope !== 'turn')) return false;
  const d = c.event.defender;
  return Object.keys(c.event).every((k) => k === 'ev' || k === 'defender') && (d === 'you' || d === 'opponent' || d === 'any');
}

/** The condition kinds a restriction's `when` is evaluated for: the statics' own and the one history reading above. */
export const RESTRICTION_CONDITION_KINDS: ReadonlySet<string> = new Set([...STATIC_CONDITION_KINDS, 'happened.attacked']);

/** The truth of a restriction's `when`, or undefined when part of it can't be evaluated here (the restriction then applies: fail closed). */
function whenHolds(cx: EvalCx, c: Condition): boolean | undefined {
  switch (c.cond) {
    case 'all': case 'any': {
      const parts = c.of.map((x) => whenHolds(cx, x));
      if (parts.some((x) => x === undefined)) return undefined;
      return c.cond === 'all' ? parts.every((x) => x === true) : parts.some((x) => x === true);
    }
    case 'not': { const x = whenHolds(cx, c.of); return x === undefined ? undefined : !x; }
    case 'happened': {
      if (!isAttackedHistory(c) || c.event.ev !== 'attacks') return evalCondition(cx, c); // FAST5X E9: any other history condition, as the statics read it
      const want = c.event.defender;
      const s = cx.s;
      return s.history.some((e) => e.turn === s.turn.number && e.ev === 'attacks' && (c.scope === 'turn' || (s.combat !== null && e.combat === s.combat.number))
        && e.facts['defenderKind'] === 'player' && typeof e.facts['defendingPlayer'] === 'string'
        && (want === 'any' || (want === 'you' ? e.facts['defendingPlayer'] === cx.controller : e.facts['defendingPlayer'] !== cx.controller)));
    }
    default: return staticallyEvaluable(c) ? evalCondition(cx, c) : undefined;
  }
}

/**
 * The rule hooks this engine build wires (design 9.4), keyed by their full capability name (design 5.2; model/capabilities.ts adds the keys as they are).
 * Besides `rule:` / `permit:` / `rulemod:` it holds the names of the restriction forms every wired action honors (`restrict:<mode>`,
 * `feature:restrict.<field>`), the permission fields each wired permission honors (`feature:permit.<action>.<field>`), what the hooks evaluate inside a rule
 * effect (`rfilter:<field>`, `rq:<kind>`, `rq:cost.<kind>` for a cost modifier's amount, `rcond:<kind>`; model/cap-walk.ts emits them for the nodes of a rule
 * effect, so a filter, quantity or condition the hooks can't evaluate keeps its card manual instead of silently doing nothing), and the `static:<s>` kinds
 * this module and statics/costmods.ts make work (statics/live.ts#STATIC_KINDS lists the layer system's own kind, `continuous`).
 */
export const RULE_HOOK_ACTIONS: Readonly<Record<string, true>> = {
  ...named('rfilter:', RULE_FILTER_FIELDS), // statics/rule-match.ts
  ...named('rq:', STATIC_QUANTITY_KINDS), // maxHandSize, landPlays, permit counts, quantities inside filters and conditions (statics/match.ts)
  ...named('rq:cost.', COST_QUANTITY_KINDS), // a cost modifier's amount (statics/costmods.ts, with actions/cast.ts's history count)
  ...named('rcond:', RESTRICTION_CONDITION_KINDS), // `when` of a restriction
  ...Object.fromEntries(Object.entries(PERMIT_FIELDS).flatMap(([action, fields]) => (fields ?? []).map((f) => [`feature:permit.${action}.${f}`, true as const]))),
  'static:restrict': true,
  'static:permit': true,
  'static:rule': true,
  'static:costMod': true, // statics/costmods.ts, applied to spells by actions/cast.ts#applyCostModifiers (an ability cost modifier needs feature:costMod.abilities)
  'feature:costMod.spellTargets.self': true, // FAST4 T21: "spells your opponents cast that target ~" (statics/costmods.ts#spellTargetsSource, CR 601.2c, 601.2f)
  'feature:costMod.spellTargets.each': true, // p2-cost-statics-2: "spells your opponents cast that target a creature you control" (statics/costmods.ts#spellTargetsSource, CR 115.9b, 601.2f)
  'feature:costMod.spellTargets.orYou': true, // edh-next-58: "spells your opponents cast that target you or a permanent you control" (statics/costmods.ts#appliesToSpell, CR 115.1, 601.2c, 601.2f)
  'feature:costMod.life': true, // r5-cost: "cost an additional 3 life to cast" (actions/cast.ts#modifiedPlan adds the life to the spell's total cost, CR 601.2f, 119.4)
  'feature:costMod.coloredOnly': true, // edh-cast-4: "This effect reduces only the amount of colored mana you pay" (statics/costmods.ts#modifyMana, CR 601.2f, 118.7)
  'feature:costMod.times': true, // FAST4 T21: `mana` applied `times` times ("{2}{R} more for each target beyond the first", statics/costmods.ts#modifyMana)
  'feature:spellTargetCount.filter': true, // FAST4 T21: "if it targets a tapped creature" (statics/costmods.ts#filteredTargetCount, CR 601.2c, 601.2f)
  'feature:cost.abilityTargets': true, // r4-cost: an activated ability's announced targets in its cost (statics/costmods.ts#targetValue, actions/activate.ts, CR 601.2c, 602.2b)
  'feature:keyword.costChange.if': true, // pc-statics-1: "Equip {2}. This ability costs {2} less to activate if you have one or fewer cards in hand." (the same, under a condition)
  'feature:keyword.costChange': true, // r4-cost: "Equip {4}. This ability costs ..." (keywords/expand.ts gives it to the keyword's activated ability, CR 601.2f, 702.6a)
  'restrict:cant': true,
  'restrict:onlyIf': true,
  // R1 (M6-7a): attack and block requirements ("attacks / blocks each combat if able", "must be blocked if able"), enforced by core/combat.ts through
  // rules/requirements.ts (CR 508.1d, 509.1c). Only the combat actions without `other` (model/cap-walk.ts names the rest `feature:require.*`).
  'restrict:mustIfAble': true,
  // M6-7 (design m6 3.9): the requirements that name the other creature of the action ("blocks target creature this turn if able", Lure's "All creatures
  // able to block enchanted creature do so.", "must be blocked by a Dalek if able"), matched by statics/requirements.ts against the declaration's objects.
  // A requirement about a non-combat action (`feature:require.<action>`) has no call-site and stays unregistered.
  ...named('feature:require.other.', REQUIREMENT_OTHER_ACTIONS),
  // M6-12: "attacks that opponent this turn if able" (encore, CR 702.141a, 508.1d): the requirement names the player to attack (statics/requirements.ts)
  ...named('feature:require.player.', REQUIREMENT_PLAYER_ACTIONS),
  // Cloud C3 (batch 3): a static goad ("enchanted creature is goaded", CR 701.15a-c): the goad pair of requirements (statics/requirements.ts#goadHits) and the
  // `goaded` filter (statics/rule-sources.ts#staticGoaders; rules/filter.ts, with last known information as it left, core/zones.ts)
  'feature:require.goad': true,
  ...named('feature:restrict.other.', OTHER_ACTIONS),
  'feature:restrict.when': true,
  // FAST4 T24: "each player can't cast more than one spell each turn" (CR 601.2i, 101.2): a `cant` cast restriction with a numeric `max` and no `other`,
  // judged against the casting player's spells cast this turn (`verdict`/`countFor`; model/cap-walk.ts names only that form so)
  'feature:restrict.max.cast': true,
  // p2-player-rules-1: "each player can't draw more than one card each turn" (CR 121.1, 614.17): a `cant` draw restriction with a numeric `max` and no `other`,
  // judged against the player's cards drawn this turn (`countFor`) at each card's own `draw` proposal (effects/proposal-kinds/m5.ts; a draw of several cards is
  // proposed card by card, so the second card is the one refused)
  'feature:restrict.max.draw': true,
  // p2-player-rules-1: "each player can't cast more than one noncreature spell each turn" (CR 601.2i): a `cant` cast limit with an `other` of the fields of
  // CAST_KIND_LIMIT_FIELDS (one capability per field, `feature:restrict.max.cast.other.<field>`), counted from the turn's cast history (`castCountOfKind`)
  'feature:restrict.max.cast.other': true,
  ...named('feature:restrict.max.cast.other.', CAST_KIND_LIMIT_FIELDS),
  // MX5: "~ can't be blocked by more than one creature" (CR 509.1b): a `cant` beBlocked restriction with a numeric `max` and no `other`, judged against the
  // blockers of the attacker (`blockSetValid` below, through rules/combat-rules.ts and rules/requirements.ts; model/cap-walk.ts names only that form so)
  'feature:restrict.max.beBlocked': true,
  // edh-next-145 (CR 601.2i, 611.2c; Irencrag Feat): a cast limit counted from when the resolved effect began (`countFrom`, fixed to a number then; verdict above)
  'feature:restrict.max.cast.countFrom': true,
  // r5-static: "No more than one creature can attack (you / this planeswalker) / block each combat" (CR 508.1c, 509.1b): judged on the whole declaration
  // (`declarationLimitDenial`, core/combat.ts); the requirement search is then not checked (rules/requirements-manual.ts)
  'feature:restrict.max.attack': true,
  'feature:restrict.max.attackPlayer': true,
  'feature:restrict.max.block': true,
  // FAST5 T57: "~ can't be blocked except by three or more creatures" (CR 509.1b, 702.111b): a `cant` beBlocked restriction with a numeric `min` and no `other`,
  // judged against the whole set of blockers of the attacker (`blockSetValid` below; model/cap-walk.ts names only that form so)
  'feature:restrict.min.beBlocked': true,
  // edh-d-38 (CR 509.1c; Gorm the Great): a `mustIfAble` beBlocked requirement with a numeric `min` of two or more and no `other`: blocked by at least that many creatures if able
  // (rules/requirements.ts counts the blockers of the attacker; model/cap-walk.ts names only that form so)
  'feature:require.min.beBlocked': true,
  // edh-d-75 (CR 508.1d; Seeker of Slaanesh, Trove of Temptation): a `mustIfAble` attack requirement with `atLeastOne`: the controller of the subject's creatures attacks with at least one of them
  // (rules/requirements.ts counts one requirement for the group; model/cap-walk.ts names only that form so)
  'feature:require.atLeastOne.attack': true,
  // edh-d-75 (CR 509.1c; Nacatl War-Pride): a `mustIfAble` beBlocked requirement with `exactly`, no `other`: blocked by exactly that many creatures if able (rules/requirements.ts)
  'feature:require.exactly.beBlocked': true,
  // edh-d-88 (CR 508.1d; War's Toll): a `mustIfAble` attack requirement with `allIfAny`: each creature of the subject attacks if able once a creature of its controller's group attacks
  // (rules/requirements.ts: obeyed when it attacks or none of the group does; model/cap-walk.ts names only that form so)
  'feature:require.allIfAny.attack': true,
  // Restrictions, by call-site.
  'rule:attack': true, // rules/combat-rules.ts via hookpoints.canAttack (CR 508.1c)
  'rule:block': true, // hookpoints.canBlock (CR 509.1b)
  'rule:beBlocked': true,
  'rule:beBlockedBy': true,
  'rule:cast': true, // actions/cast.ts#castCheck via hookpoints.canCast (CR 601.3)
  'rule:castFromZone': true,
  'rule:castAtInstantSpeed': true, // rules/timing.ts#castTiming via castsOnlySorcerySpeed below (CR 117.1a, 101.2): Teferi, Time Raveler
  'rule:activate': true, // actions/activate.ts, rules/mana.ts via hookpoints.canActivate (CR 602.5)
  'rule:playLand': true, // actions/land.ts via hookpoints.canPlayLand (CR 305.2)
  'rule:beTargeted': true, // rules/targets.ts, effects/ctx.ts via hookpoints.canBeTargeted (CR 115.1, 608.2b)
  'rule:beEquipped': true, // rules/attachment.ts (equip, CR 301.5c, and the state-based action, CR 704.5n) via hookpoints.canAttach
  'rule:gainLife': true, // rules/life.ts through rules/restrictions.ts (CR 119.7)
  'rule:loseLife': true, // rules/life.ts, rules/cost.ts (CR 119.8, 119.4)
  'rule:lose': true, // core/sba.ts through rules/restrictions.ts (CR 104.3)
  'rule:win': true,
  'rule:untapDuringUntapStep': true, // core/steps.ts, the untap step (CR 502.3)
  // WP31: the W2 call-sites. Each asks `ruleDenial` (the full evaluator: `other`, `when`, `onlyIf`, fail closed on what it can't evaluate).
  'rule:beEnchanted': true, // core/resolve.ts (an Aura spell, CR 303.4i, 608.3e), rules/attachment.ts (players too, CR 303.4c), via hookpoints.canAttach
  'rule:beAttached': true,
  'rule:draw': true, // effects/cant.ts (the `draw` proposal, CR 614.17) and core/zones.ts#drawCards (the draw step and the opening hand, CR 504.1, 121.1)
  'rule:enter': true, // effects/cant.ts (every zone change to the battlefield and every token, CR 614.17d), hookpoints.canPlayLand (CR 305.1)
  'rule:leave': true, // effects/cant.ts (every zone change from the battlefield); rules/cant.ts for costs that move a permanent (CR 614.17b)
  'rule:beExiled': true, // effects/cant.ts; rules/cant.ts (exile costs)
  'rule:beDestroyed': true, // effects/cant.ts (the `destroy` proposal: effects, lethal damage and deathtouch, CR 701.8, 704.5g-h)
  'rule:beRegenerated': true, // rules/destroy.ts (shields are not applied to any destruction, CR 701.19c)
  'rule:dealDamage': true, // effects/cant.ts (the `damage` proposal of every damage event, combat damage included, CR 120.1, 510.2)
  'rule:receiveDamage': true,
  // FAST5 T57: "damage can't be prevented" (CR 615.12): effects/propose.ts#unpreventableIfRuled asks `preventDamage` of the recipient (the restriction's subject) with
  // the damage's source as `other`; "Damage can't be prevented this turn" is one restriction on every permanent and one on every player. An `other` (whose damage)
  // is not evaluated here (`feature:restrict.other.preventDamage` is not registered), so a card that names the damage's source stays manual.
  'rule:preventDamage': true,
  // r5-repl: "Combat damage can't be prevented" (CR 615.12, 510.2): the same question, asked only of combat damage (effects/propose.ts#unpreventableIfRuled)
  'rule:preventCombatDamage': true,
  'rule:haveCountersPut': true, // effects/cant.ts, rules/counters.ts#addCounters (as it enters, wither, costs, CR 122.6), rules/life.ts#givePoison (players)
  'rule:payLife': true, // rules/cost.ts (life payments and Phyrexian mana, CR 119.4, 119.8, 614.17b), effects/replace-bodies.ts ("as it enters, you may pay")
  'rule:beCountered': true, // effects/handlers/zones-remove.ts via hookpoints.canBeCountered (CR 701.6a, 101.2)
  'rule:untap': true, // the untap step, effects/handlers/zones-status.ts#untap (CR 701.26b), the {Q} cost (rules/cost.ts, CR 107.6)
  'rule:transform': true, // effects/handlers/zones-status.ts#changeFace (CR 701.27)
  'rule:search': true, // effects/handlers/cards-library.ts#search (CR 701.23)
  'rule:discard': true, // effects/handlers/cards-*.ts#discard (CR 701.9), discard costs (rules/cant.ts), the cleanup discard (CR 514.1)
  'rule:sacrifice': true, // effects/handlers/zones-remove.ts (CR 701.21a), sacrifice costs (rules/cant.ts, rules/mana.ts, actions/activate.ts)
  'rule:beSacrificed': true,
  // FAST5X E25: effects/proposal-kinds/turn-face-up.ts (every effect, CR 708.7, 614.17) and core/special/turn-face-up.ts (the special action is not offered,
  // CR 116.2b, 702.37e, 701.40b, 701.58b)
  'rule:beTurnedFaceUp': true,
  'rule:becomeMonarch': true, // edh-next-82: core/designations.ts#setMonarch (CR 725.1, 101.2)
  'rule:beSuspected': true, // std-mkm: effects/handlers/levels.ts, the `suspected` designation of every suspect instruction (CR 701.60a, 101.2)
  'rule:beCopied': true, // std-copy-1: effects/handlers/tokens-copy.ts#copySpells, the one place a copy of a spell is put onto the stack (CR 707.10, 101.2)
  'rule:beBeamedUp': true, // trek-1: rules/cant.ts#costUseDenial, the returnToHand part of a beam me up cost (rules/cost-pick.ts), the one way to beam a permanent up
  // Permissions.
  'permit:haveFlash': true, // rules/timing.ts via hookpoints.castsAsInstant (CR 601.3b, 702.8a)
  'permit:attackAsThoughNoDefender': true, // hookpoints.permits (CR 609.4, 702.3b)
  'permit:attackAsThoughHaste': true, // edh-b-14: rules/combat-rules.ts#attackOptions via hookpoints.attacksAsThoughHaste (CR 302.6, 508.1a, 609.4)
  'feature:permit.attackAsThoughHaste.opponentsOnly': true,
  'permit:blockAsThough': true,
  'permit:activate': true, // r4-fxz: rules/timing.ts#isSummoningSickToActivate via hookpoints.activatesAsThoughHaste (CR 302.6, 602.5a, 609.4)
  'permit:playLand': true, // actions/land.ts#landsAllowed (CR 305.2)
  'permit:assignAsUnblocked': true, // core/combat-damage.ts via mayAssignAsUnblocked (CR 510.1b-c; FAST5 T37)
  'feature:permit.assignAsUnblocked.mandatory': true, // edh-d-25: core/combat-damage.ts via mustAssignAsUnblocked (CR 510.1b-c; Outmaneuver)
  'permit:activateLoyaltyAsInstant': true, // r4-mech: rules/timing.ts#abilityTiming via hookpoints.loyaltyAsInstant (CR 606.3)
  // FAST4 T31: a play or cast permission a resolving effect gives for the cards it names ("you may play that card this turn"): actions/cast.ts#castCheck,
  // actions/land.ts#landCheck and core/legal.ts consult statics/play-permits.ts (CR 601.2a, 305.1, 611.2c). FAST5X E14: and the top-card permissions
  // ("you may cast creature spells from the top of your library", "once each turn", CR 601.3, 305.1) and "you may look at the top card of your library any
  // time" (core/view.ts#canSee, CR 401.5)
  ...Object.fromEntries(PLAY_PERMIT_CAPABILITIES.map((c) => [c, true as const])),
  // Rule modifications.
  'rulemod:maxHandSize': true, // core/steps.ts, the cleanup step (CR 402.2, 514.1)
  'feature:rulemod.maxHandSize.delta': true, // std-ry3: "your maximum hand size is increased|reduced by N" (maxHandSize, CR 402.2)
  'rulemod:handSizeNoLimit': true,
  'rulemod:landPlays': true, // actions/land.ts#landsAllowed (CR 305.2)
  'rulemod:extraBlockers': true, // FAST4 T24: rules/combat-rules.ts (the declare-blockers candidates and blocksDenial) via `maxBlocks` (CR 509.1a)
  'feature:rulemod.untapDuringOtherUntapSteps.opponents': true, // edh-next-124: statics/hooks.ts#untapsDuringOthersUntapStep, "each opponent's untap step" (CR 502.3, 102.3)
  'rulemod:drawDuringOpponentsDrawSteps': true, // edh-next-124: core/steps.ts, the draw step (CR 504.1), via statics/hooks.ts#drawsDuringDrawStep
  'rulemod:revealFirstDraw': true, // edh-next-144: triggers/reveal-draw.ts, as the first card of a turn is drawn (CR 701.20a, 121.2), via statics/hooks.ts#revealFirstDrawSources
  'rulemod:untapDuringOtherUntapSteps': true, // T20 (FAST4): core/steps.ts, the untap step (CR 502.3), the source itself (no `of`); r4-static: or the permanents of `of`
  // FAST5X E19: core/steps.ts#endOfStepCleanup via unspentManaRules, as each step and phase ends (CR 106.4, 500.5, 614.1)
  'rulemod:manaDoesNotEmpty': true,
  'rulemod:unspentManaBecomes': true,
  'rulemod:manaBurn': true, // edh-next-141: core/steps.ts#endOfStepCleanup and #loseUnspentMana via unspentManaRules (CR 106.4, 500.5, 119.3)
  'rulemod:tapManaMultiplier': true, // std-mana-1: rules/mana.ts#addMana via tapManaMultiplier (CR 106.12, 614.1a)
  // FAST5X E3: rules/cost-pick.ts#valueOf via crewSaddleValue, for crew and saddle costs (CR 702.122a, 702.171a), the source itself only (no `of`)
  'rulemod:crewSaddlePowerBonus': true,
  'rulemod:crewSaddleUsesToughness': true,
  'rulemod:crewUsesToughness': true, // edh-next-15: crewSaddleValue for a crew cost only (CR 702.122a)
  'rulemod:crewPowerBonus': true, // edh-perms-15: crewSaddleValue for a crew cost only (CR 702.122a)
  'rulemod:crewStationPowerTripled': true, // trek-18: crewSaddleValue for a crew cost, stationPowerFactor for a station cost (CR 702.122a, 702.184a, 701.11)
  'feature:costMod.unlock': true, // std-rh: core/rooms.ts#listed via effects/handlers/rooms.ts and statics/costmods.ts#unlockManaCost (CR 116.2m, 709.5e, 118.7)
  'feature:costMod.abilities.keyword': true, // FAST5 T60: actions/activate.ts#costChangeOf via statics/costmods.ts#abilityCostModsFor (CR 601.2f, 602.2b)
  'feature:cost.collectEvidence.link': true, // std-rx27: rules/pay-parts.ts records, actions/activate.ts stores on the source (CR 607.2a, 701.59a)
  'feature:costMod.abilities.firstOfType': true, // edh-next-124: the first activation this turn of an ability of a permanent of one card type, mana abilities too (rules/typed-activations.ts; CR 602.2, 601.2f)
  'feature:costMod.abilities.firstEachTurn': true, // std-rx27: the same, for the first such ability the player activates each turn (CR 602.2b, 118.9)
  'feature:costMod.abilities.manaLife': true, // edh-next-106: "Mana abilities of this land cost an additional 1 life to activate" (rules/pay.ts#modifiedManaAbilityPlan; CR 601.2f, 605.1a, 119.4)
  'feature:costMod.abilities.increase': true, // std-rx28: the same, and a mana ability it applies to is paid by hand (rules/mana.ts#manaCostShapeNow, rules/pay.ts; CR 601.2f, 605.1a)
  'feature:costMod.abilities.reduce': true, // Cloud std-woe: the same, and rules/pay.ts / rules/sources.ts for mana abilities via statics/costmods.ts#abilityManaCost (CR 605.1a)
  'feature:costMod.abilities.targets.self': true, // edh-next-107: actions/activate.ts#costChangeOf via statics/costmods.ts#abilityCostModsFor (CR 601.2c, 602.2b)
  'feature:costMod.plot': true, // std-rx26: core/special/plot.ts#plotCostAfterMods via statics/costmods.ts#plotCostModsFor (CR 702.170a, 601.2f)
  'feature:costMod.floorTotal': true, // edh-next-12: "each spell that would cost less than three mana to cast costs three mana to cast", statics/costmods.ts#modifyMana (CR 601.2f, 118.7)
  'feature:costMod.floor.one': true, // r3-cost: "can't reduce the mana in that cost to less than one mana", statics/costmods.ts#modifyMana (CR 601.2f, 118.7)
  'feature:costMod.abilities.loyalty': true, // edh-next-142: "loyalty abilities you activate cost an additional [+1]" (actions/activate.ts#costChangeOf; CR 606.4, 601.2f)
  'rulemod:combatDamageUsesToughness': true, // FAST5 T60: core/combat-damage.ts via assignsCombatDamageAsToughness (CR 510.1a)
  'rulemod:lethalDamageUsesPower': true, // edh-next-145: core/sba-objects.ts, core/combat-damage.ts and rules/damage.ts via lethalDamageUsesPower (CR 120.6, 704.5g)
  // r3-static: core/sba-objects.ts (the legend rule, CR 704.5j) via legendRuleExempt; core/sba.ts (CR 704.5a) via losesForZeroLife
  'rulemod:legendRuleExempt': true,
  'rulemod:noLossForZeroLife': true,
  'rulemod:radiationGainsLife': true, // edh-next-93: effects/handlers/lifedamage.ts via radiationGainsLife (CR 728.1, 119.3)
  'rulemod:damageAsWither': true, // edh-d-44: rules/damage.ts#dealDamage via damageAsWither (CR 702.80a, 120.3d)
  'rulemod:devotionBonus': true, // edh-next-140: effects/eval.ts, actions/announce-cond.ts and statics/match.ts (devotion) via statics/devotion-bonus.ts#devotionBonusOf (CR 700.5)
  'rulemod:roomAbilitiesExtra': true, // edh-next-75: core/dungeons.ts#triggerRoom via extraRoomTriggers (CR 309.4c, 603.2d)
  'rulemod:damageAsInfect': true, // edh-next-49: rules/damage.ts#dealDamage via damageAsInfect (CR 120.3b)
  'rulemod:additionalActivation': true, // r3-static: rules/timing.ts#activationRestrictionDenial via additionalActivations (CR 602.5b)
  'rulemod:activateAsUnactivated': true, // std-rx27: rules/timing.ts#activationRestrictionDenial via activatesAsUnactivated (CR 602.5b, 702.177a)
  'rulemod:negativePowerAssignsAsPositive': true, // r3-static: core/combat-damage.ts via assignsNegativePowerAsPositive (CR 510.1a), the source itself only
  'rulemod:stationUsesToughness': true, // cloud r3-mech: effects/eval.ts (`stat` with `station`) via stationsUsingToughness (CR 702.184a)
  // M12-3: effects/handlers/actions-native.ts#vote via extraVotes (CR 701.38d), the source's controller
  'rulemod:additionalVote': true,
  'rulemod:mayVoteAdditional': true,
  'rulemod:choosesVotes': true,
  'rulemod:villainousChoiceExtra': true, // edh-next-135: effects/handlers/control.ts#mayHandler via villainousChoiceTimes (CR 701.55c) // edh-next-135: effects/handlers/actions-native.ts#vote via voteChooser (CR 701.38a, 608.2d)
  'rulemod:surveilLookAdditional': true, // edh-d-96: effects/handlers/cards-library.ts#surveilHandler via surveilExtraLooks (CR 701.25a), the source's controller
  'rulemod:zeroLoyaltyKept': true, // r4-mech: core/sba-objects.ts, the 0-loyalty state-based action, via zeroLoyaltyKept (CR 704.5i)
  'rulemod:damageLeavesOneLoyalty': true, // edh-d-94: rules/damage.ts, the loyalty damage removes, via damageLeavesOneLoyalty (CR 120.3c, 614.1a)
  'rulemod:targetableThroughHexproof': true, // std-rx32: keywords/hooks/targeting.ts via hexproofIgnored (CR 702.11b, 115.1)
  'rulemod:mayNotUntap': true, // std-rx13: core/steps.ts, the untap step, via mayNotUntap (CR 502.3), the source itself only
  'rulemod:untapLimit': true, // p2-player-rules-1: core/steps.ts, the untap step, via untapLimits (CR 502.3): "players can't untap more than one land during their untap steps"
  // std-ry8: core/combat.ts, the declaration of attackers, via attackOptions (CR 701.43a, 702.154a, 508.1), the source itself only; with `then` (CR 603.12)
  'rulemod:mayExertAsAttacks': true,
  'rulemod:enlist': true,
  'feature:rule.attackOption.then': true,
  'feature:rule.attackOption.unlessExertedThisTurn': true, // edh-combat-1: core/attack-options.ts, CR 701.43a
  'rulemod:countersRemain': true, // edhn81: core/zones.ts#moveObject via countersRemainOnMove (CR 122.2, 400.7)
  'rulemod:damageNotRemovedInCleanup': true, // r4-mech: core/steps.ts, the cleanup step, via damageKeptInCleanup (CR 514.2)
  'rulemod:firstCoinFlipsWon': true, // r4-mech: effects/handlers/game.ts#flipCoin via firstCoinFlipsWon (CR 705.1-705.2, 614.1a), the source's controller
  // r5-static: a static ability's effects while its condition is false (CR 611.3a): statics/live.ts (continuous effects, with statics/layers.ts#stillExists)
  // and statics/rule-sources.ts (restrictions); model/cap-walk.ts names every other kind `feature:static.otherwise.<kind>`
  'feature:static.otherwise': true,
  'feature:static.effectWhen': true, // edh-next-147 (CR 611.3a): a continuous effect's own condition, statics/live.ts#staticEffectsOf
  // r5-static: core/combat.ts via statics/combat-tax.ts and core/combat-tax.ts, the costs to attack and block (CR 508.1h-j, 509.1d-f)
  'rulemod:attackTax': true,
  'rulemod:blockTax': true,
  'rulemod:commanderTaxAsLife': true, // CMD2: actions/cast-costs.ts#commanderTaxCost, the card's own ability as it is cast from the command zone (CR 903.8, 119.4)
  // FAST4 T33: "can't attack you" (CR 508.1b-c): canAttack asks it for each player the creature could attack, with that player as `other`; a `cant`
  // attackPlayer restriction names the players in `otherPlayer` ("Creatures with flying can't attack you or planeswalkers you control" is this one and an
  // `attack` restriction whose `other` is a planeswalker you control)
  'rule:attackPlayer': true,
  'feature:restrict.otherPlayer.attackPlayer': true,
  // FAST4 T33: "its activated abilities can't be activated unless they're mana abilities" (CR 602.5, 605.1a): canActivate tells the ability's kind
  'feature:restrict.exceptMana.activate': true,
  'feature:restrict.exceptMana.payLife': true, // edh-d-3 (CR 605.1a, 118.3): payLife forCosts, the cost of a mana ability is exempt (rules/cant.ts, rules/sources.ts#costKindOf)
  'feature:restrict.exceptLoyalty.activate': true, // edh-b-12: "... that aren't mana abilities or loyalty abilities" (CR 606.1): canActivate tells the wrapper keyword
  // std-control-1: "power-up abilities can't be activated" (CR 602.5, 702.193a): canActivate tells the ability's wrapper keyword
  'feature:restrict.abilityKeyword.activate': true,
  // p2-graveyard-2: "players can't cast spells from graveyards or libraries" (CR 601.3): canCast tells the zone the card is cast from
  'feature:restrict.fromZones.castFromZone': true,
  // edh-next-18 (CR 118.3, 119.4, 701.21a): "players can't pay life or sacrifice creatures to cast spells or activate abilities": only the payment of a cost of a spell or ability (RuleQuery.cost)
  'feature:restrict.forCosts.payLife': true,
  'feature:restrict.forCosts.sacrifice': true,
  'feature:restrict.unlessAllBlock.beBlocked': true, // edh-next-18: "can't be blocked unless all creatures defending player controls block it" (blockSetValid, CR 509.1b)
  'feature:restrict.counter.haveCountersPut': true, // edh-b-2: "can't have +1/+1 counters put on them" (CR 122.6): countersPutDenial tells the kind
  // FAST5 T37: "~ can't attack alone / block alone" (CR 506.5): judged on the whole declaration by core/combat.ts through cantActAlone
  'feature:restrict.alone.attack': true,
  'feature:restrict.alone.block': true,
  // edh-combat-6: "~ can only attack alone" (CR 506.5, 508.1c): judged on the whole declaration by core/combat.ts through onlyAttacksAlone
  'feature:restrict.onlyAlone.attack': true,
  'rulemod:assignsNoCombatDamage': true, // edh-combat-6: core/combat-damage.ts via assignsNoCombatDamage (CR 510.1)
  // edh-combat-1: "~ can't attack a player it has already attacked this turn" (CR 508.1b-c): canAttack asks it for each player the creature could attack
  'feature:restrict.alreadyAttacked.attackPlayer': true,
  'feature:restrict.onlyNearest.attack': true, // edhd63: verdict below (CR 101.4, 506.2, 508.1b)
  // edh-combat-6: "Each opponent can't block with more than one creature this combat" (CR 509.1b): the block declaration limit counted for each player on their own (declarationLimits)
  'feature:restrict.perPlayer.block': true,
  // edh-combat-6: "~ can attack players who attacked you during their last turn as though it didn't have defender" (CR 609.4): permits asks it with the player attacked as `other`
  'feature:permit.attackAsThoughNoDefender.attackedYouLastTurn': true,
  'rulemod:tappedLandManaColorless': true, // edh-next-12: rules/mana.ts#addMana and rules/sources.ts via tappedManaCollapseAt (CR 106.12, 614.1a)
  'rulemod:coinAdvantage': true, // edh-next-12: effects/handlers/game.ts#flipCoin via coinAdvantage (CR 705.1, 614.1a), the source's controller
  'rulemod:diceAdvantage': true, // p2-c-dieroll-1: effects/handlers/game.ts#rollDie via diceAdvantage (CR 706.6, 614.1a, unverified), the source's controller
  'rulemod:rollAdjust': true, // edh-d-49: effects/roll-options.ts via rollOptions (CR 706.2), the source's controller
  'rulemod:rollReroll': true, // edh-d-49: effects/roll-options.ts via rollOptions (CR 706.2, 706.6), the source's controller
  'feature:rulemod.rollOption.oncePerTurn': true, // edh-d-49: PlayerState.turnStats.rollOptionsUsed
  'rule:phaseIn': true, // trek-4: rules/phasing.ts#phaseInForUntapStep via phaseInDenied, the only phase-in the engine performs (CR 502.1, 702.26c, 101.2; unverified)
  // edh-players-5: "Players gain hexproof" (CR 702.11c): the `other` of a `cant` beTargeted restriction is read relative to the player asked about (verdict)
  'feature:restrict.relativeToSubject.beTargeted': true,
  // edh-zones-14: "Spells and abilities your opponents control can't cause their controller to search their library" (CR 701.23a): the search instruction asks with its source
  'feature:restrict.causedByOwn.search': true,
  'feature:restrict.ignoreFor': true, // edh-next-143 (CR 116.2d): core/special/ignore-effect.ts, restrictionHits
  'feature:restrict.causedByOpponents.sacrifice': true, // edh-next-69: effects/handlers/zones-remove.ts asks with its source (CR 701.21a)
  'feature:restrict.causedByOpponents.discard': true, // edh-next-136: effects/handlers/cards-draw.ts#discardable and edh-c-84.ts ask with their source, rules/cant.ts#costUseDenial with the effect's (CR 701.9a, 109.5)
  'feature:restrict.causedByOwnTriggered.sacrifice': true, // edh-next-122: effects/run.ts#resolveStackObject says what resolves (CR 701.21a, 603.1)
  'feature:restrict.causedByOwnTriggered.beExiled': true, // edh-next-122: the same, for the exile of a zone change (effects/proposal-kinds/m5.ts, CR 406.1)
  'permit:activateEquipAsInstant': true, // edh-mana-keywords-8: rules/timing.ts#activationRestrictionDenial via hookpoints.equipAsInstant (CR 702.6a, 602.5d)
  // edh-cast-11: "Each opponent can't cast noncreature spells with mana value greater than the number of lands that player controls" (CR 601.3): the `other` of a `cant` cast restriction, read for the casting player
  'feature:restrict.relativeToSubject.cast': true,
  // edh-next-12: "Players can cast spells only during their own turns" (CR 601.3): an `onlyIf` cast restriction whose `when` is read for the casting player (verdict)
  'feature:restrict.relativeToSubject.whenCast': true,
  'feature:restrict.relativeToSubject.whenActivate': true, // edh-d-15: City of Solitude
  'rulemod:extraSpellCopy': true, // edh-cast-13: effects/handlers/tokens-copy.ts#copySpells via extraSpellCopies (CR 707.10, 614.1a)
  'feature:spellTargetCount.filter.dealtDamageThisTurn': true, // edh-d-10: "if it targets a creature that was dealt damage this turn" (statics/costmods.ts#filteredTargetCount, CR 120.1, 601.2c)
  'feature:spellTargetCount.filter.targets': true, // edh-cast-15: "if it targets a spell or ability that targets a creature you control with power 7 or greater" (statics/costmods.ts#filteredTargetCount, CR 115.9b, 601.2c)
  'rule:haveStunCountersRemoved': true, // edh-players-22: rules/counters.ts#stunRemovalDenial (addCounters, the untap replacement of rules/status.ts, removal and {Q} costs), effects/proposal-kinds/m5.ts (CR 122.1d, 614.17)
  'feature:rulemod.targetableThroughHexproof.players': true, // edh-players-22: statics/hooks.ts#hexproofIgnored (a player's hexproof, the restriction that waives, CR 702.11c, 609.4)
  'feature:rulemod.targetableThroughHexproof.player': true, // edh-players-22: only the spells and abilities of that player
  'rule:crew': true, // edh-c-72: rules/cant.ts#costUseDenial, the tapPower part of a crew cost (rules/cost-pick.ts#costUse), the one way a creature crews (CR 702.122a, 101.2)
  'rulemod:tappedLandManaOnlyColorless': true, // edh-c-72: rules/mana.ts#addMana and rules/sources.ts via tappedManaOnlyColorless (CR 106.12, 614.1a)
  'rulemod:tappedLandManaOnlyType': true, // edh-next-45: statics/hooks.ts#tappedManaOnlyColorless (CR 106.12, 614.1a)
  'rulemod:controlSearching': true, // edh-next-119: effects/handlers/search-control.ts via searchControllerOf (CR 723.2, 723.5, 701.23a)
  'rulemod:searchFoundExiled': true, // edh-next-119: effects/handlers/search-control.ts via searchExilersOf (CR 614.1a, 609.4b, 701.23a)
  'feature:rulemod.revealFirstDraw.optional': true, // edh-next-132: triggers/reveal-draw.ts asks the controller (CR 701.20a), via revealFirstDrawOptional
  'rulemod:cascadeLandTapped': true, // edh-d-97: effects/handlers/actions-native.ts#cascade via cascadeLandPuts (CR 702.85b), the source's controller
  'rulemod:chooseAsAttached': true, // edh-next-146: rules/status.ts#attachPermanent via asAttachedChoices (CR 701.3a, 607.2d), the source itself only
};

/**
 * Restriction actions whose call-site does not consult this module yet, with the package that owns the call-site. The function the call-site needs exists
 * (`cantHappen`); the owner adds the `rule:<action>` key above in the change that wires it. Pinned by a test, so a wired action cannot stay listed here.
 */
export const UNWIRED_RULE_ACTIONS: Readonly<Partial<Record<RuleAction, string>>> = {
  // WP31 wired the other W2 actions (above). These stay unwired on purpose: a card that uses one stays manual (never silently wrong).
  tap: 'many call-sites tap without a hook: the mana solver (rules/sources.ts) and mana abilities, attacking (CR 508.1f), convoke and improvise (rules/payment-options.ts), crew and other tapPower costs; the tap handler alone would make such a card falsely automated (CR 701.26a)',
  beTapped: 'the same call-sites as `tap` (CR 701.26a)',
  gainAbility: 'layer 6 would have to read restrictions that are themselves computed after the layers (CR 613.1f, 613.10): statics/layers.ts has only the `cantHave` marker of its own modifications (milestone 6)',
  spendMana: 'no call-site: "can\'t spend mana" would have to be read by the mana solver and every payment (rules/sources.ts, rules/pay.ts, CR 106.6, 601.2h)',
};

/** Rule citations per action, for denials and logs. */
const ACTION_RULES: Partial<Record<RuleAction, string[]>> = {
  attack: ['CR 508.1c'], attackPlayer: ['CR 508.1b', 'CR 508.1c'], block: ['CR 509.1b'], beBlocked: ['CR 509.1b'], beBlockedBy: ['CR 509.1b'], cast: ['CR 601.3'], castFromZone: ['CR 601.3'],
  activate: ['CR 602.5'], playLand: ['CR 305.2'], beTargeted: ['CR 115.1', 'CR 601.2c', 'CR 602.2b', 'CR 603.3d', 'CR 608.2b'], gainLife: ['CR 119.7'],
  loseLife: ['CR 119.8'], lose: ['CR 104.3'], win: ['CR 104.2'], untap: ['CR 502.3', 'CR 701.26b'], untapDuringUntapStep: ['CR 502.3'], beAttached: ['CR 303.4', 'CR 301.5'],
  beEnchanted: ['CR 303.4'], beEquipped: ['CR 301.5'], beCountered: ['CR 701.6a'], draw: ['CR 121.1', 'CR 614.17'], enter: ['CR 614.17d'], leave: ['CR 614.17'],
  beExiled: ['CR 614.17'], beDestroyed: ['CR 701.8'], beRegenerated: ['CR 701.19c'], dealDamage: ['CR 120.1'], receiveDamage: ['CR 120.1'],
  haveCountersPut: ['CR 122.6', 'CR 614.17'], payLife: ['CR 119.4', 'CR 119.8'], transform: ['CR 701.27'], search: ['CR 701.23'], discard: ['CR 701.9'],
  sacrifice: ['CR 701.21a'], beSacrificed: ['CR 701.21a'], beTurnedFaceUp: ['CR 708.7', 'CR 101.2'],
  beSuspected: ['CR 701.60a', 'CR 101.2'], // std-mkm
  becomeMonarch: ['CR 725.1', 'CR 101.2'], // edh-next-82
  beCopied: ['CR 707.10', 'CR 101.2'], // std-copy-1
  phaseIn: ['CR 702.26c', 'CR 502.1', 'CR 101.2'], // trek-4 (unverified)
  beBeamedUp: ['CR 101.2', 'CR 614.17b'], // trek-1 (beam me up: Star Trek, CR 702 rule number unverified)
  haveStunCountersRemoved: ['CR 122.1d', 'CR 614.17'], // edh-players-22
  crew: ['CR 702.122a', 'CR 101.2', 'CR 614.17b'], // edh-c-72
};

const deny = (message: string, rules: string[]): Denial => ({ message, rules });

// ---- Restrictions ---------------------------------------------------------------------------------------------------------------------------------------

/** A query with, optionally, other characteristics for the objects it names and what `other` is for the action (statics/rule-match.ts). */
interface Asked extends RuleQuery {
  view?: CharsView;
  actor?: Actor;
  /** FAST3 T16: the defending player of an attack (CR 506.2), what `{ref:'defending'}` in a restriction's `when` means (statics/match.ts#EvalCx.defending). */
  defending?: PlayerId;
  /** FAST4 T33: the ability being activated is a mana ability (CR 605.1a), for a restriction with `exceptMana`; undefined when it is not known. */
  manaAbility?: boolean;
  /** std-control-1: the wrapper keyword of the ability being activated ('' for none, `ActivatedAbilityDef.keyword`), for `abilityKeyword`; undefined when not known. */
  abilityKeyword?: string;
  /**
   * MX5: how many of the limited actions already happened, for a `max` the engine keeps no per-turn count of: the OTHER creatures blocking the attacker
   * ("can't be blocked by more than one creature", CR 509.1b; `blockSetValid` and `canBlock` below).
   */
  already?: number;
  /** p2-graveyard-2: the zone the card of a `castFromZone` question is cast from (CR 601.2a), for a restriction's `fromZones`; undefined when not known. */
  fromZone?: string;
  /**
   * edh-c-94 (CR 502.3, 611.2a; Blinding Beam): the player whose untap step it is. A resolved effect lasting through the next untap step of one player
   * (`RuleSource.untapStepOf`) applies only in an untap step of that player, not in the untap steps of the players before them.
   */
  untapStepOf?: PlayerId;
  /** edh-c-94: only those timed effects count (the permanent untaps during an untap step that is not its controller's, Seedborn Muse: CR 502.3, ruling 2013-06-07 of Blinding Beam). */
  untapTimedOnly?: true;
}

const evalCx = (ctx: RuleContext, src: RuleSource, view?: CharsView, defending?: PlayerId): EvalCx => {
  const cx = view ? { s: view.s, all: view, source: src.source, controller: src.controller } : cxOf(ctx, src);
  return defending === undefined ? cx : { ...cx, defending };
};

/** The per-turn count a limit (`max`) compares with, or undefined when the action has none. */
function countFor(s: GameState, action: RuleAction, who: ObjectId | PlayerId): number | undefined {
  const p = s.players.find((x) => x.id === who);
  if (!p) return undefined;
  if (action === 'cast') return p.turnStats.spellsCast; // CR 601.2i
  if (action === 'playLand') return p.landsPlayedThisTurn; // CR 305.2a
  if (action === 'draw') return p.turnStats.cardsDrawn; // p2-player-rules-1 (CR 121.1): "can't draw more than one card each turn", every card drawn this turn so far
  return undefined;
}

/** p2-player-rules-1 (CR 601.2i): how many spells of the kind `f` describes `who` cast this turn; undefined when `f` has a field the history can't answer. */
function castCountOfKind(cx: EvalCx, who: ObjectId | PlayerId, f: ObjectFilter): number | undefined {
  if (Object.keys(f).some((k) => !CAST_KIND_LIMIT_FIELDS.includes(k)) || !cx.s.players.some((p) => p.id === who)) return undefined;
  const { stackKind: _kind, zone: _zone, ...kind } = f;
  // the turn's history through the installed reader (statics may not import rules/history, design 5.4); a cast copy is cast too (CR 707.12), as turnStats.spellsCast counts it
  return evalQuantity(cx, { q: 'happenedCount', event: { ev: 'cast', spell: kind, orCopy: true }, scope: 'turn', by: { ref: 'fixed', players: [who as PlayerId] } });
}

/** Does this restriction forbid the action right now? `unknown`: part of it can't be evaluated, so it is applied (fail closed). (`mustIfAble` never forbids.) */
type Verdict = 'allowed' | 'forbidden' | 'unknown';

/**
 * edh-next-122 (CR 608.2, 603.1, 113.3c): the kind and controller of the spell or ability on the stack whose instructions are being followed now (set by effects/run.ts#resolveStackObject for the
 * whole resolution), for a restriction about what a triggered ability can cause (`causedByOwnTriggered`). Undefined outside a resolution.
 */
let resolvingAbility: { kind: 'spell' | 'activated' | 'triggered'; controller: PlayerId } | undefined;
export function withResolvingAbility<T>(info: { kind: 'spell' | 'activated' | 'triggered'; controller: PlayerId } | undefined, f: () => T): T {
  const prev = resolvingAbility;
  resolvingAbility = info;
  try { return f(); } finally { resolvingAbility = prev; }
}

function verdict(cx: EvalCx, r: RestrictionDef, q: Asked): Verdict {
  if (r.mode === 'mustIfAble') return 'allowed';
  if (r.onlyAlone === true) return 'allowed'; // edh-combat-6: "can only attack alone" forbids a declaration of two or more attackers, not the creature (onlyAttacksAlone)
  if (r.alone === true) return 'allowed'; // FAST5 T37: "can't attack alone" forbids a whole declaration, not the creature (cantActAlone)
  if (r.unlessAllBlock === true) return 'allowed'; // edh-next-18: "can't be blocked unless all creatures defending player controls block it" is a rule about the set of blockers (blockSetValid)
  if (r.min !== undefined) return 'allowed'; // FAST5 T57: "can't be blocked except by N or more creatures" is a rule about the set of blockers (blockSetValid)
  if (isDeclarationLimit(r)) return 'allowed'; // r5-static: "No more than one creature can attack each combat" limits a whole declaration (declarationLimitDenial)
  if (!refIncludes(cx, r.subject, q.subject)) return 'allowed';
  // edh-next-122 (CR 701.21a, 406.1, 113.3c, 603.1, 101.2; The Master, Multiplied): "Triggered abilities you control can't cause you to sacrifice or exile creature tokens you control": only while a
  // triggered ability that the restriction's controller controls resolves (effects/run.ts#resolveStackObject, `withResolvingAbility`); a cost of a spell or activated ability, a spell, an activated
  // ability, another player's triggered ability or a rule is not that cause. The subject and `other` are then judged as for any restriction
  if (r.causedByOwnTriggered === true) {
    if (r.mode !== 'cant' || (r.action !== 'sacrifice' && r.action !== 'beExiled') || r.max !== undefined || r.when !== undefined || r.otherPlayer !== undefined || r.forCosts !== undefined || r.causedByOpponents !== undefined) return 'unknown';
    const cause = resolvingAbility;
    // review: the cost of a spell cast or an ability activated meanwhile (a mana ability's sacrifice, Tajuru Preserver ruling 2010-06-15 on the like wording) is not caused by the trigger
    if (q.cost === true || cause === undefined || cause.kind !== 'triggered' || cause.controller !== cx.controller) return 'allowed';
  }
  // edh-next-18 (CR 118.3, 119.4, 701.21a; Angel of Jubilation): "can't pay life / sacrifice ... to cast spells or activate abilities": only a payment asked as the cost of a spell or ability (edh-d-3: asked before exceptMana, an effect that makes a player pay life is never banned, Karn's Sylex ruling 2022-09-09)
  if (r.forCosts === true) {
    if (r.mode !== 'cant' || (r.action !== 'payLife' && r.action !== 'sacrifice')) return 'unknown';
    if (q.cost !== true) return 'allowed';
  }
  // edhd63 (CR 101.4, 506.2, 508.1b-c; Pramikon, Mystic Barrier, Teyo): "Each player may attack only the nearest opponent in the chosen direction and planeswalkers controlled by that opponent": the defender of an
  // attack is that nearest player (the player the creature's controller sits next to on the side), or a planeswalker that player controls; a battle, or anything else, is forbidden. No side to read: applied
  if (r.onlyNearest !== undefined) {
    if (r.mode !== 'cant' || r.action !== 'attack' || r.other !== undefined || r.otherPlayer !== undefined || r.max !== undefined || r.min !== undefined || r.alone !== undefined) return 'unknown';
    const when = r.when === undefined ? true : whenHolds(cx, r.when);
    if (when === undefined) return 'unknown';
    if (!when) return 'allowed';
    const side = 'side' in r.onlyNearest ? r.onlyNearest.side : readLink(cx.source === null ? undefined : cx.s.objects[cx.source], r.onlyNearest.chosen)?.values?.[0];
    const attacker = cx.s.objects[q.subject as ObjectId];
    if (side !== 'left' && side !== 'right') return 'allowed'; // no direction was chosen (a copy that did not enter, a countered trigger): the ability has no effect (Pramikon ruling 2019-08-23)
    if (attacker === undefined || q.other === undefined) return 'forbidden';
    const nearest = seatNeighbor(cx.s, attacker.controller, side);
    if (nearest === undefined) return 'forbidden';
    if (cx.s.players.some((p) => p.id === q.other)) return q.other === nearest ? 'allowed' : 'forbidden';
    const target = cx.s.objects[q.other as ObjectId];
    return target !== undefined && target.controller === nearest && objectMatches(cx, target.id, { types: ['Planeswalker'] }) === true ? 'allowed' : 'forbidden';
  }
  // FAST4 T33: "unless they're mana abilities" (CR 605.1a): a mana ability is not restricted; an ability of unknown kind is (fail closed)
  if (r.exceptMana === true) {
    if (q.manaAbility === undefined) return 'unknown';
    if (q.manaAbility) return 'allowed';
  }
  // edh-b-12 (CR 606.1): "... or loyalty abilities": a loyalty ability is not restricted either; an ability of unknown keyword is (fail closed)
  if (r.exceptLoyalty === true) {
    if (r.exceptMana !== true) return 'unknown';
    if (q.abilityKeyword === undefined) return 'unknown';
    if (q.abilityKeyword === 'loyalty') return 'allowed';
  }
  // std-control-1 (CR 602.5, 702.193a): "power-up abilities can't be activated": only the abilities with that wrapper keyword; one of unknown keyword is (fail closed)
  if (r.abilityKeyword !== undefined) {
    if (q.abilityKeyword === undefined) return 'unknown';
    if (q.abilityKeyword !== r.abilityKeyword) return 'allowed';
  }
  // edh-b-2 (CR 122.6, 614.17): "can't have +1/+1 counters put on them": only counters of that kind; asked with no kind, it is applied (fail closed)
  if (r.counter !== undefined) {
    if (r.action !== 'haveCountersPut') return 'unknown';
    if (q.counter === undefined) return 'unknown';
    if (q.counter !== r.counter) return 'allowed';
  }
  // p2-graveyard-2 (CR 601.3): "can't cast spells from graveyards or libraries": only a card cast from one of the zones the restriction names (the graveyard when it
  // names none); asked with no zone, it is applied (fail closed)
  if (r.action === 'castFromZone') {
    if (q.fromZone === undefined) return 'unknown';
    if (!(r.fromZones ?? ['graveyard']).includes(q.fromZone as ZoneName)) return 'allowed';
  }
  // edh-combat-1 (CR 508.1b-c, 506.2): "~ can't attack a player it has already attacked this turn": an `attacks` entry of this turn for this creature whose defender is that
  // player (the entry's facts: defenderKind 'player', defendingPlayer); asked with no player (or for a form this does not read) it is applied (fail closed)
  if (r.alreadyAttacked === true) {
    if (r.mode !== 'cant' || r.action !== 'attackPlayer' || r.otherPlayer !== undefined || r.max !== undefined || r.min !== undefined || r.alone !== undefined) return 'unknown';
    if (q.other === undefined || !cx.s.players.some((p) => p.id === q.other)) return 'unknown';
    const when = r.when === undefined ? true : whenHolds(cx, r.when);
    if (when === undefined) return 'unknown';
    const did = cx.s.history.some((e) => e.turn === cx.s.turn.number && e.ev === 'attacks' && e.subject === q.subject && e.facts['defenderKind'] === 'player' && e.facts['defendingPlayer'] === q.other);
    return when && did ? 'forbidden' : 'allowed';
  }
  // FAST4 T33: `otherPlayer` is the player attacked (`attackPlayer`, "can't attack you", CR 508.1b-c); asked with no player, it is applied (fail closed)
  if (r.otherPlayer !== undefined) {
    if (q.other === undefined || !cx.s.players.some((p) => p.id === q.other)) return 'unknown';
    if (!playersOf(cx, r.otherPlayer).includes(q.other as PlayerId)) return r.mode === 'onlyIf' ? 'forbidden' : 'allowed';
  }
  // A restriction with `other` asked at a call-site that names no other object can't be evaluated: applied, never read as "does not apply" (fail closed; WP31
  // review). `feature:restrict.other.<action>` is advertised only for the actions whose call-sites pass it (OTHER_ACTIONS), so no automated card gets here.
  // edh-players-5 (CR 702.11b-c, 101.2; Everybody Lives!): "Players gain hexproof": the spell or ability's controller is an opponent of the player that is targeted, whoever the
  // restriction's source belongs to; asked about anything but a player it is applied (fail closed)
  // edh-zones-14 (CR 701.23a, 109.5; Ashiok, Dream Render): "Spells and abilities your opponents control can't cause their controller to search their library": only when the player
  // who would search controls the spell or ability that causes it (its source is `other`); asked about anything else it is applied (fail closed)
  // edh-next-69 (CR 701.21a, 109.5; Sigarda, Host of Herons): "Spells and abilities your opponents control can't cause you to sacrifice permanents": the player who would sacrifice is the restriction's
  // subject, and the effect asking is a spell or ability an opponent of the restriction's controller controls (its source is `cause`); a sacrifice paid as a cost, or asked with no source, is not caused by one
  if (r.causedByOpponents === true) {
    // edh-next-136 (CR 701.9a, 109.5; Tamiyo, Collector of Tales): the same for a discard ("can't cause you to discard cards")
    if (r.mode !== 'cant' || (r.action !== 'sacrifice' && r.action !== 'discard') || r.other !== undefined || r.max !== undefined || r.when !== undefined || r.otherPlayer !== undefined || !cx.s.players.some((p) => p.id === q.subject)) return 'unknown';
    if (!refIncludes(cx, r.subject, q.subject)) return 'allowed';
    if (q.cause === undefined) return 'allowed';
    const cause = cx.s.objects[q.cause] ?? cx.s.lki[q.cause]?.object;
    if (cause === undefined) return 'unknown';
    return cause.controller !== cx.controller ? 'forbidden' : 'allowed';
  }
  if (r.causedByOwn === true) {
    if (r.mode !== 'cant' || r.action !== 'search' || r.other === undefined || r.max !== undefined || r.when !== undefined || JSON.stringify(r.other) !== '{"controller":"opponent"}' || !cx.s.players.some((p) => p.id === q.subject)) return 'unknown';
    // asked with no source: the search is of another player's library, which the ban is not about ("their library")
    if (q.other === undefined) return 'allowed';
    const cause = cx.s.objects[q.other as ObjectId] ?? cx.s.lki[q.other as ObjectId]?.object;
    if (cause === undefined) return 'unknown';
    // the cause is judged as it last existed (CR 113.7a, a sacrificed fetch land's ability): its controller is the searcher and an opponent of the restriction's controller
    return cause.controller === q.subject && cause.controller !== cx.controller ? 'forbidden' : 'allowed';
  }
  let ocx = cx;
  if (r.relativeToSubject === true) {
    // edh-cast-11 (CR 601.3, 101.2; Lavinia, Azorius Renegade): or a `cant` `cast` restriction whose `other` counts something of "that player" (the player who casts)
    // edh-next-12 (CR 601.3, 101.2, 102.1; Dosan the Falling Leaf): or an `onlyIf` `cast` restriction whose `when` is read with the casting player as `you`: "Players can cast spells
    // only during their own turns" (no `other`; the turn is the casting player's own)
    // edh-d-15 (CR 602.5, 605.1a, 101.2, 102.1; City of Solitude): and an `onlyIf` `activate` one: "Players can cast spells and activate abilities only during their own turns" (the
    // activating player's own turn; canActivate asks once with the source as subject, which no player restriction includes, and once with the player)
    const ownTurnOnly = r.mode === 'onlyIf' && (r.action === 'cast' || r.action === 'activate') && r.other === undefined && r.when !== undefined && r.max === undefined;
    if ((r.mode !== 'cant' && !ownTurnOnly) || (r.action !== 'beTargeted' && r.action !== 'cast' && !(ownTurnOnly && r.action === 'activate')) || !cx.s.players.some((p) => p.id === q.subject)) return 'unknown';
    ocx = { ...cx, controller: q.subject as PlayerId };
    if (ownTurnOnly) {
      const own = whenHolds(ocx, r.when!);
      return own === undefined ? 'unknown' : own ? 'allowed' : 'forbidden';
    }
  }
  const other = r.other === undefined ? true : q.other === undefined ? undefined : objectMatches(ocx, q.other, r.other, q.actor);
  const when = r.when === undefined ? true : whenHolds(cx, r.when);
  if (other === undefined || when === undefined) return 'unknown';
  if (r.mode === 'onlyIf') return other && when ? 'allowed' : 'forbidden';
  if (!other || !when) return 'allowed';
  if (r.max === undefined) return 'forbidden';
  // edh-next-145 (CR 601.2i, 611.2c; Irencrag Feat): "only one more spell this turn": the spells cast before the effect began (fixed as it was created) are not counted
  if (r.countFrom !== undefined && (typeof r.countFrom !== 'number' || r.action !== 'cast' || r.other !== undefined)) return 'forbidden';
  const n0 = q.already ?? (r.action === 'cast' && r.other !== undefined ? castCountOfKind(cx, q.subject, r.other) : countFor(cx.s, r.action, q.subject));
  const n = n0 === undefined ? undefined : n0 - (typeof r.countFrom === 'number' ? r.countFrom : 0);
  return n === undefined || n >= r.max ? 'forbidden' : 'allowed'; // a limit the engine can't count is applied as a ban (never silently looser)
}

/**
 * FAST5 T57 (CR 509.1b, 702.111b): a `min` restriction ("~ can't be blocked except by three or more creatures") against a set of `count` blockers: forbidden
 * while the set is smaller than the minimum (the empty set is no block at all and is never asked). A `min` beside anything this does not evaluate (`other`,
 * a mode other than `cant`, a minimum that is not a number) is applied (fail closed); the capability walker keeps such data off automated cards.
 */
function minVerdict(cx: EvalCx, r: RestrictionDef, q: Asked, count: number): Verdict {
  if (r.mode !== 'cant' || r.other !== undefined || typeof r.min !== 'number') return 'unknown';
  if (!refIncludes(cx, r.subject, q.subject)) return 'allowed';
  const when = r.when === undefined ? true : whenHolds(cx, r.when);
  if (when === undefined) return 'unknown';
  return when && count < r.min ? 'forbidden' : 'allowed';
}

/**
 * edh-next-18 (CR 509.1b, 101.2; Tromokratis): "~ can't be blocked unless all creatures defending player controls block it": forbidden unless every creature the blockers' controller
 * (the defending player) controls is among the blockers. Anything else about the restriction (a filter, a limit ...) is not read: applied (fail closed).
 */
function allBlockVerdict(cx: EvalCx, r: RestrictionDef, q: Asked, blockers: readonly ObjectId[], defender: PlayerId | undefined): Verdict {
  if (r.mode !== 'cant' || r.action !== 'beBlocked' || r.other !== undefined || r.max !== undefined || r.min !== undefined || r.alone !== undefined || defender === undefined) return 'unknown';
  if (!refIncludes(cx, r.subject, q.subject)) return 'allowed';
  const when = r.when === undefined ? true : whenHolds(cx, r.when);
  if (when === undefined) return 'unknown';
  if (!when) return 'allowed';
  const theirs = cx.s.zones.battlefield.filter((id) => cx.s.objects[id]?.controller === defender && !cx.s.objects[id]?.phasedOut && objectMatches(cx, id, { types: ['Creature'] }) === true);
  return theirs.every((id) => blockers.includes(id)) ? 'allowed' : 'forbidden';
}

interface Hit {
  src: RuleSource;
  r: RestrictionDef;
  unknown: boolean;
}

/** edh-c-94 (CR 502.3, 611.2a): is `player` the one whose untap step an effect lasting through "the next untap step of <whose>" names? ('you' is the effect's controller; a fixed set of players is written when the effect begins) */
function untapStepIsOf(whose: PlayerPred, player: PlayerId, controller: PlayerId): boolean {
  if (whose === 'you') return player === controller;
  if (whose === 'opponent') return player !== controller;
  if (whose === 'any') return true;
  return whose.ref === 'fixed' && whose.players.includes(player);
}

function restrictionHits(ctx: RuleContext, q: Asked, test: (cx: EvalCx, r: RestrictionDef) => Verdict, now?: GameState): Hit[] {
  const out: Hit[] = [];
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'restrict' || e.action !== q.action) continue;
    // edh-next-143 (CR 116.2d; Leonin Arbiter): a player who paid to ignore this object's effect this turn is not restricted by it (read from the state asked about)
    if (e.ignoreFor !== undefined && src.source !== null && ignoringNow(now ?? ctx.view.s, src.source, q.subject)) continue;
    if (src.source !== null && q.ignoreSources?.has(src.source) === true) continue; // edh-fix-4 (CR 614.12): it enters in the same event as the subject
    // edh-c-94 (CR 502.3, 611.2a): an effect that lasts through one player's next untap step does nothing in another player's untap step
    if (q.untapStepOf !== undefined && src.untapStepOf !== undefined && !untapStepIsOf(src.untapStepOf, q.untapStepOf, src.controller)) continue;
    if (q.untapTimedOnly === true && src.untapStepOf === undefined) continue;
    const v = test(evalCx(ctx, src, q.view, q.defending), e);
    if (v !== 'allowed') out.push({ src, r: e, unknown: v === 'unknown' });
  }
  return out;
}

function denialOf(h: Hit): Denial {
  const { src, r } = h;
  const what = src.text ? `"${src.text}" (${src.name})` : `an effect of ${src.name} (${r.mode === 'cant' ? "can't" : 'only if'} ${r.action})`;
  const why = h.unknown ? " The engine can't evaluate what this effect covers, so it is applied rather than ignored; settle it by hand if it should not apply." : '';
  return deny(`Not allowed: ${what}.${why}`, [...(ACTION_RULES[r.action] ?? []), 'CR 101.2']);
}

/** edh-cast-4: does the filter (or one of its branches) compare a mana value? */
function filterMentionsManaValue(f: ObjectFilter | undefined): boolean {
  return f !== undefined && (f.manaValue !== undefined || f.manaValueParity !== undefined || (f.anyOf ?? []).some(filterMentionsManaValue) || filterMentionsManaValue(f.not));
}

/** edh-next-143 (CR 116.2d): has `player` paid to ignore the effect of `source` this turn (`GameState.ignoredEffects`)? */
export function ignoringNow(s: GameState, source: ObjectId, player: ObjectId | PlayerId): boolean {
  return (s.ignoredEffects ?? []).some((x) => x.source === source && x.player === player && x.turn === s.turn.number);
}

function denialIn(ctx: RuleContext, q: Asked, now?: GameState): Denial | null {
  const hit = restrictionHits(ctx, q, (cx, r) => verdict(cx, r, q), now)[0];
  if (!hit) return null;
  // edh-players-22 (CR 702.11c, 609.4): a player's hexproof is this restriction; "as though they didn't have hexproof" waives it (hookpoints.ts, `permits`)
  return q.action === 'beTargeted' && ctx.view.s.players.some((p) => p.id === q.subject) && hexproofShaped(hit.r) ? { ...denialOf(hit), waivedBy: { action: 'targetAsThoughNoHexproof' as const } } : denialOf(hit); // (rules/denial.ts#waivable, as a type-only import)
}

/**
 * CR 101.2, 614.17: does a "can't" (or "only if") effect forbid this action right now? The first one in timestamp order, as a denial, or null. This is the check
 * WP11's `forbidden` makes before any replacement effect, and the one every hook below makes.
 */
export function cantHappen(s: GameState, q: RuleQuery): Denial | null {
  const ctx = ruleContext(s);
  return ctx ? denialIn(ctx, q, s) : null;
}

/**
 * edh-cast-3 (CR 117.1a, 307.1, 101.2; Teferi, Time Raveler): "Each opponent can cast spells only any time they could cast a sorcery": is this player under a `cant`
 * `castAtInstantSpeed` restriction? Then every spell they cast needs sorcery timing, an instant or a spell with flash included.
 */
export function castsOnlySorcerySpeed(s: GameState, player: PlayerId): boolean {
  return cantHappen(s, { action: 'castAtInstantSpeed', subject: player }) !== null;
}

/**
 * FAST5 T37 (CR 506.5, 508.1c, 509.1b): "~ can't attack alone" / "~ can't block alone". Is `id` forbidden to be the only creature declared as an attacker (or as a
 * blocker)? Asked of a declaration of exactly this one creature; null when no such restriction applies. A condition the statics cannot evaluate applies (fail closed).
 */
export function cantActAlone(s: GameState, action: 'attack' | 'block', id: ObjectId): Denial | null {
  const ctx = ruleContext(s);
  if (!ctx) return null;
  const q: Asked = { action, subject: id };
  const hit = restrictionHits(ctx, q, (cx, r) => {
    if (r.alone !== true || r.mode !== 'cant' || !refIncludes(cx, r.subject, id)) return 'allowed';
    const when = r.when === undefined ? true : staticallyEvaluable(r.when) ? evalCondition(cx, r.when) : undefined;
    return when === undefined ? 'unknown' : when ? 'forbidden' : 'allowed';
  })[0];
  if (!hit) return null;
  const what = hit.src.text ? `"${hit.src.text}" (${hit.src.name})` : `an effect of ${hit.src.name}`;
  return deny(`Not allowed: ${what}. It can't ${action} alone: another creature must ${action} too.`, [action === 'attack' ? 'CR 508.1c' : 'CR 509.1b', 'CR 506.5']);
}

/**
 * edh-combat-6 (CR 506.5, 508.1c; Master of Cruelties): "~ can only attack alone". Is `id` forbidden to be declared as an attacker together with another creature? Asked of a
 * declaration of two or more attackers; null when no such restriction applies. A condition the statics cannot evaluate applies (fail closed).
 */
export function onlyAttacksAlone(s: GameState, id: ObjectId): Denial | null {
  const ctx = ruleContext(s);
  if (!ctx) return null;
  const q: Asked = { action: 'attack', subject: id };
  const hit = restrictionHits(ctx, q, (cx, r) => {
    if (r.onlyAlone !== true || r.mode !== 'cant' || !refIncludes(cx, r.subject, id)) return 'allowed';
    const when = r.when === undefined ? true : staticallyEvaluable(r.when) ? evalCondition(cx, r.when) : undefined;
    return when === undefined ? 'unknown' : when ? 'forbidden' : 'allowed';
  })[0];
  if (!hit) return null;
  const what = hit.src.text ? `"${hit.src.text}" (${hit.src.name})` : `an effect of ${hit.src.name}`;
  return deny(`Not allowed: ${what}. It can only attack alone: no other creature may attack with it.`, ['CR 508.1c', 'CR 506.5']);
}

/** edh-combat-6 (CR 508.1c-d): the sources of "can only attack alone" now in play, so the requirement search can say it does not know them (rules/requirements-manual.ts). */
export function onlyAloneTexts(s: GameState): { sourceName: string; text: string }[] {
  const ctx = ruleContext(s);
  if (!ctx) return [];
  return ctx.sources.filter((src) => src.effect.s === 'restrict' && src.effect.onlyAlone === true).map((src) => ({ sourceName: src.name, text: src.text }));
}

/**
 * edh-combat-6 (CR 510.1; Master of Cruelties): does this creature assign no combat damage? A rule modification `assignsNoCombatDamage` applies to the creatures its `of` matches
 * (relative to its source), or to its source when it has none. Not damage prevention: the creature assigns none, so nothing is dealt, whatever can't be prevented.
 */
export function assignsNoCombatDamage(s: GameState, id: ObjectId): boolean {
  const ctx = ruleContext(s);
  if (!ctx) return false;
  return ctx.sources.some((src) => {
    const e = src.effect;
    return e.s === 'rule' && e.rule === 'assignsNoCombatDamage' && (e.of === undefined ? src.source === id : objectMatches(cxOf(ctx, src), id, e.of) === true);
  });
}

// ---- Limits on a whole declaration (r5-static) ----------------------------------------------------------------------------------------------------------

/**
 * r5-static, CR 508.1c, 509.1b: "No more than one creature can attack each combat", "No more than two creatures can attack you each combat", "No more than one
 * creature can block each combat", and the planeswalker's granted "No more than one creature can attack this planeswalker each combat": a `cant` restriction of
 * `attack`, `attackPlayer` or `block` with a numeric `max` (and nothing but `other` / `otherPlayer` naming what is attacked). It forbids no creature by itself
 * (`verdict`): a declaration in which more than `max` of the creatures it names attack (attack what it names) or block is illegal.
 */
export const isDeclarationLimit = (r: RestrictionDef): boolean =>
  r.mode === 'cant' && typeof r.max === 'number' && (r.action === 'attack' || r.action === 'attackPlayer' || r.action === 'block')
  && r.alone === undefined && r.onlyAlone === undefined && r.min === undefined && r.goad === undefined && r.exceptMana === undefined;

/** One limit that applies now: at most `max` of the declared pairs it `counts`; `unknown` when part of it can't be judged (then it is not enforced: said). */
export interface DeclarationLimit {
  max: number;
  /** edh-combat-6 (CR 509.1b): the creatures are counted for each player on their own (`RestrictionDef.perPlayer`). */
  perPlayer: boolean;
  sourceName: string;
  text: string;
  counts: (creature: ObjectId, defender: PlayerId | ObjectId | null) => boolean | undefined;
}

/** CR 508.1c, 509.1b: the limits on the whole attack (`attack`) or block (`block`) declaration that apply now, in timestamp order. */
export function declarationLimits(s: GameState, kind: 'attack' | 'block'): DeclarationLimit[] {
  const ctx = ruleContext(s);
  if (!ctx) return [];
  const out: DeclarationLimit[] = [];
  for (const src of ctx.sources) {
    const r = src.effect;
    if (r.s !== 'restrict' || !isDeclarationLimit(r) || (kind === 'block') !== (r.action === 'block')) continue;
    const cx = evalCx(ctx, src);
    const when = r.when === undefined ? true : whenHolds(cx, r.when);
    if (when === false) continue;
    out.push({
      max: r.max!,
      perPlayer: r.perPlayer === true,
      sourceName: src.name,
      text: src.text,
      counts: (creature, defender) => {
        if (when === undefined || !refIncludes(cx, r.subject, creature)) return when === undefined ? undefined : false;
        if (r.action === 'attackPlayer') return defender !== null && s.players.some((p) => p.id === defender) && r.otherPlayer !== undefined && playersOf(cx, r.otherPlayer).includes(defender as PlayerId);
        if (r.action === 'attack' && r.other !== undefined) return defender === null || s.players.some((p) => p.id === defender) ? false : objectMatches(cx, defender, r.other);
        return true;
      },
    });
  }
  return out;
}

/** CR 508.1c, 509.1b: the first limit this declaration breaks, as a denial, or null (a limit that can't be judged is not enforced here: core/combat.ts says so). */
export function declarationLimitDenial(s: GameState, kind: 'attack' | 'block', pairs: readonly { creature: ObjectId; defender: PlayerId | ObjectId | null }[]): Denial | null {
  for (const l of declarationLimits(s, kind)) {
    const counted = [...new Set(pairs.filter((p) => l.counts(p.creature, p.defender) === true).map((p) => p.creature))];
    // edh-combat-6 (CR 509.1b; Mirri, Weatherlight Duelist): "Each opponent can't block with more than one creature": each player's creatures on their own
    const byPlayer = new Map<string, number>();
    if (l.perPlayer) for (const id of counted) byPlayer.set(s.objects[id]?.controller ?? '', (byPlayer.get(s.objects[id]?.controller ?? '') ?? 0) + 1);
    const n = l.perPlayer ? Math.max(0, ...byPlayer.values()) : counted.length;
    if (n > l.max) {
      const what = l.text ? `"${l.text}" (${l.sourceName})` : `an effect of ${l.sourceName}`;
      return deny(`Not allowed: ${what}. No more than ${l.max} of these creatures can ${kind} this combat.`, [kind === 'attack' ? 'CR 508.1c' : 'CR 509.1b', 'CR 101.2']);
    }
  }
  return null;
}

/** Is this rule action wired (`rule:<action>` registered)? A call-site consults only wired actions, so what it enforces is what the capabilities promise. */
export const isWired = (action: RuleAction): boolean => Object.hasOwn(RULE_HOOK_ACTIONS, `rule:${action}`);

/**
 * WP31: the one question every wired call-site asks (design 9.4): does a "can't" effect forbid this action now (CR 101.2, 614.17)? Only wired actions are
 * answered (an unwired one is "allowed": its cards are not automated). `enter` is judged as the permanent would exist on the battlefield (`enterDenial`).
 */
export function ruleDenial(s: GameState, q: RuleQuery, opts: { controller?: PlayerId } & EnterFacts = {}): Denial | null {
  if (!isWired(q.action)) return null;
  if (q.action === 'enter') return enterDenial(s, q.subject, opts.controller, { ...(opts.face !== undefined ? { face: opts.face } : {}), ...(opts.faceDown !== undefined ? { faceDown: opts.faceDown } : {}) });
  return cantHappen(s, q);
}

// ---- Entering the battlefield (CR 614.17d) --------------------------------------------------------------------------------------------------------------

/** The rule actions some restriction in this definition is about (its own static abilities, keyword expansions, granted abilities, effects it creates). */
const DEF_ACTIONS = new WeakMap<CardDef, ReadonlySet<string>>();
const KW_CTX = { granted: false, faceName: '', types: [] as string[], keyPrefix: 'k:0:0' };

function collectActions(v: unknown, out: Set<string>, depth = 0): void {
  if (depth > 40 || v === null || typeof v !== 'object') return;
  if (Array.isArray(v)) {
    for (const x of v) collectActions(x, out, depth + 1);
    return;
  }
  const r = v as Record<string, unknown>;
  if (r['s'] === 'restrict' && typeof r['action'] === 'string') out.add(r['action']);
  if (r['kind'] === 'keyword' && typeof r['keyword'] === 'string') for (const x of expansionOf(r as unknown as KeywordAbilityDef, KW_CTX)) collectActions(x, out, depth + 1);
  for (const k in r) collectActions(r[k], out, depth + 1);
}

function defActions(def: CardDef): ReadonlySet<string> {
  let v = DEF_ACTIONS.get(def);
  if (!v) {
    const out = new Set<string>();
    if (defHasRuleEffects(def)) collectActions(def.faces.map((f) => f.abilities), out);
    DEF_ACTIONS.set(def, (v = out));
  }
  return v;
}

/** Can anything in this game restrict `action` (a definition or a resolved effect that names it)? A cheap guard before an expensive question. */
export function actionMayBeRestricted(s: GameState, action: RuleAction): boolean {
  for (const k in s.defs) if (defActions(s.defs[k]!).has(action)) return true;
  return s.continuousEffects.some((e) => e.effect.s === 'restrict' && e.effect.action === action);
}

/**
 * How a permanent enters that is already fixed when "can't enter" is asked (WP31 review, CR 614.17d: "taking into account replacement effects that have
 * already modified how it enters"): the face it enters with (a modal double-faced card played as its land face, CR 712.12; put onto the battlefield
 * transformed, CR 712.14a) and whether it enters face down (CR 708.3).
 */
export interface EnterFacts {
  face?: number;
  faceDown?: boolean;
}

/**
 * The state with the object on the battlefield under `controller` (a card in another zone, a spell resolving, a token about to be created), as it enters.
 * Also read by effects/replacements.ts (WP29: an entering object's own replacement effects are those it would have on the battlefield, CR 614.12).
 */
export function onBattlefield(s: GameState, id: ObjectId, controller: PlayerId, facts: EnterFacts): GameState {
  const o = s.objects[id]!;
  const listed = s.zones.battlefield.includes(id);
  const face = facts.face ?? (o.zone === 'battlefield' || o.zone === 'stack' ? o.face : 0); // CR 712.14: from another zone, front face up by default
  const faceDown = facts.faceDown ?? (o.zone === 'battlefield' || o.zone === 'stack' ? o.faceDown : false); // a face-down spell enters face down (CR 708.4)
  if (o.zone === 'battlefield' && o.controller === controller && listed && o.face === face && o.faceDown === faceDown) return s;
  // CMD4 (CR 614.12, 400.7a): a permanent spell keeps the characteristics that effects gave it on the stack (statics/spell-carry.ts)
  const carried = carriedIntoHypothetical(s, id);
  return {
    ...s, objects: { ...s.objects, [id]: { ...o, zone: 'battlefield', controller, face, faceDown } }, zones: { ...s.zones, battlefield: listed ? s.zones.battlefield : [...s.zones.battlefield, id] },
    ...(carried !== null ? { continuousEffects: carried } : {}),
  };
}

/**
 * CR 614.17d: may this object enter the battlefield (under `controller`, its controller by default)? The "can't" effects are checked twice: against the object
 * as it is now (a restriction that names its current zone: "creature cards in graveyards can't enter the battlefield") and against the permanent as it would
 * exist on the battlefield, with the continuous effects that would apply to it there, its own static abilities included ("lands can't enter the
 * battlefield"). Of its own abilities only those about itself count (CR 614.17d: "if they affect only that permanent"). WP31 review: the permanent has the
 * face it enters with and is face down if it enters so (`facts`); the check "as it is now" reads the card in its zone, where it has its front face (CR 712.8a).
 */
export function enterDenial(s: GameState, id: ObjectId, controller?: PlayerId, facts: EnterFacts = {}): Denial | null {
  const o = s.objects[id];
  if (!o || !actionMayBeRestricted(s, 'enter')) return null;
  const now = o.zone === 'battlefield' ? null : cantHappen(s, { action: 'enter', subject: id });
  if (now) return now;
  const after = onBattlefield(s, id, controller ?? o.controller, facts);
  if (!ruleSourcesPresent(after)) return null;
  const ctx = ruleContext(after);
  if (!ctx) return null;
  const sources = ctx.sources.filter((src) => src.source !== id || (src.effect.s === 'restrict' && (src.effect.subject as { ref?: string }).ref === 'self'));
  return denialIn({ view: ctx.view, sources }, { action: 'enter', subject: id });
}

/**
 * All restriction and permission effects that apply to `q.subject` for `q.action` right now (design 5.3), in timestamp order (CR 613.10-613.11), restrictions
 * ("can't") before permissions ("can", CR 101.2). A restriction is listed when it currently constrains the action: a `cant` that forbids it (or can't be
 * evaluated), an `onlyIf` whose condition is not met, a `mustIfAble` requirement on the subject. A permission is listed when it is about the same action and its
 * `who` includes the subject.
 */
export const staticEffectsFor: StaticEffectsFor = (s, q) => {
  const ctx = ruleContext(s);
  if (!ctx) return [];
  const constraining: StaticEffect[] = restrictionHits(ctx, q, (cx, r) => (r.mode === 'mustIfAble' ? (refIncludes(cx, r.subject, q.subject) ? 'forbidden' : 'allowed') : verdict(cx, r, q))).map((h) => h.r);
  const permissions: StaticEffect[] = [];
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s === 'permit' && (e.action as string) === q.action && refIncludes(cxOf(ctx, src), e.who, q.subject)) permissions.push(e);
  }
  return [...constraining, ...permissions];
};

// ---- Permissions ----------------------------------------------------------------------------------------------------------------------------------------

/** Is the permission's object (`of`, or the source itself when it has none: "~ can block as though it had flying") this object, with its controller among `who`? */
function permitsObject(ctx: RuleContext, src: RuleSource, p: PermissionDef, id: ObjectId): boolean {
  const cx = cxOf(ctx, src);
  if (p.of === undefined) return src.source === id;
  const controller = ctx.view.get(id)?.controller;
  return controller !== undefined && refIncludes(cx, p.who, controller) && objectMatches(cx, id, p.of) === true; // unknown: no permission ("can't" wins)
}

/**
 * p2-attack-block-1 (CR 609.4, 702.14c): "Creatures with islandwalk can be blocked as though they didn't have islandwalk": the attacker (`other`) matches the
 * permission's `attacker` filter and the blocker's controller is one of its `who` players; no `of` (a blocker filter with it is not implemented: no permission).
 */
function permitsAttacker(ctx: RuleContext, src: RuleSource, p: PermissionDef, blocker: ObjectId, attacker: ObjectId | PlayerId): boolean {
  if (p.attacker === undefined || typeof attacker !== 'string' || ctx.view.get(attacker as ObjectId) === undefined) return false;
  const cx = cxOf(ctx, src);
  // edhv31 (CR 609.4, 702.28; Aetherflame Wall): "~ can block creatures with shadow as though they didn't have shadow": a blocker filter with the attackers it concerns
  if (p.of !== undefined) return permitsObject(ctx, src, p, blocker) && objectMatches(cx, attacker as ObjectId, p.attacker) === true;
  const controller = ctx.view.get(blocker)?.controller;
  return controller !== undefined && refIncludes(cx, p.who, controller) && objectMatches(cx, attacker as ObjectId, p.attacker) === true; // unknown: no permission
}

/**
 * "as though it had flying" / "creatures with shadow as though they didn't have shadow": does the permission's wording name this evasion keyword? p2-attack-block-1:
 * the keyword may be more than one word ("snow swampwalk", "nonbasic landwalk", CR 702.14b), named as those words in a row.
 */
function namesKeyword(asThough: string | undefined, keyword: string | undefined): boolean {
  if (keyword === undefined) return false;
  const words = (asThough ?? 'as though it had flying').toLowerCase().split(/[^a-z]+/);
  const kw = keyword.toLowerCase().split(/[^a-z]+/).filter((w) => w !== '');
  // edh-c-106 (CR 702.17b, 609.4): "as though it had reach" lets the creature block what flying keeps from it (reach only changes what a flying attacker's rule lets through)
  if (keyword.toLowerCase() === 'flying' && words.includes('reach')) return true;
  return kw.length > 0 && words.some((_, i) => kw.every((w, j) => words[i + j] === w));
}

/**
 * FAST5 T37 (CR 510.1b-c): may this blocked attacker's controller have it assign its combat damage as though it weren't blocked ("You may have ~ assign its
 * combat damage as though it weren't blocked")? The permanent the static ability is on, or (edh-combat-3, "for each non-Human creature you control, you may have that creature assign
 * ...", "enchanted creature's controller may have it assign ...") the objects `of` matches whose controller is one of `who` (`permitsObject`). The player who chooses
 * is always the attacking creature's controller (CR 510.1c: the attacking player announces the assignment).
 */
export function mayAssignAsUnblocked(s: GameState, id: ObjectId): boolean {
  const ctx = ruleContext(s);
  if (!ctx) return false;
  return permitted(ctx, 'assignAsUnblocked', (src, p) => permitsObject(ctx, src, p, id));
}

/**
 * edh-d-25 (CR 510.1b-c, 609.4; Outmaneuver): is this blocked attacker made to assign its combat damage as though it weren't blocked (a permission with `mandatory`, "X target blocked creatures assign
 * their combat damage this turn as though they weren't blocked"): no question is asked, all of it goes to what the attacker attacks.
 */
export function mustAssignAsUnblocked(s: GameState, id: ObjectId): boolean {
  const ctx = ruleContext(s);
  if (!ctx) return false;
  return permitted(ctx, 'assignAsUnblocked', (src, p) => p.mandatory === true && permitsObject(ctx, src, p, id));
}

/**
 * r3-static (CR 702.8a, 113.6e, 601.3d, 611.3a): "~ has flash as long as you control a Desert" (Colossal Rattlewurm): a static ability of the card itself that
 * grants it flash and functions in the zone the card is cast from (parser/templates/zz-cloud/r3-static.json states the zones). The face being cast is `c`
 * (its printed abilities: the casting rules read flash from them, rules/timing.ts); its condition is judged with the card as its source and the caster as
 * "you". Only an ability whose every effect is that one grant counts; a condition the statics can't judge grants nothing (sorcery timing stays).
 */
function ownFlashGrant(s: GameState, id: ObjectId, zone: string, player: PlayerId, c: Chars): boolean {
  for (const a of c.abilities) {
    const d = a.def;
    if (d.kind !== 'static' || d.zone === undefined || !d.zone.includes(zone as never) || d.effects.length === 0) continue;
    const grants = d.effects.every((e) => e.s === 'continuous' && e.affects.ref === 'self' && e.mods.length === 1 && e.mods[0]!.layer === 6
      && JSON.stringify(Object.keys(e.mods[0]!)) === '["layer","add"]' && (e.mods[0] as { add: { kind: string; keyword?: string }[] }).add.length === 1
      && (e.mods[0] as { add: { kind: string; keyword?: string }[] }).add[0]!.kind === 'keyword' && (e.mods[0] as { add: { keyword?: string }[] }).add[0]!.keyword === 'flash');
    if (!grants) continue;
    if (d.condition === undefined || evalCondition({ s, all: charsViewOf(s), source: id, controller: player }, d.condition) === true) return true;
  }
  return false;
}

/** The permissions for this action that this module implements fully (a field it does not honor makes the permission inapplicable, `permitImplemented`). */
/**
 * edh-combat-6 (CR 500.1, 506.3, 508.1b; Weathered Sentinels): did `attacker` attack the player `victim` (the player, never a planeswalker or battle) during the most recent turn that
 * `attacker` was the active player before the current one? "Their last turn" is that player's own last turn, not the turn before this one (in a game of several players the player's last
 * turn is several turns back). Read from the `beginTurn` entries (whose turn began) and the `attacks` entries of that turn (the history is never pruned); a player who has had no turn
 * yet attacked nobody.
 */
function permitted(ctx: RuleContext, action: PermissionDef['action'], test: (src: RuleSource, p: PermissionDef) => boolean): boolean {
  return ctx.sources.some((src) => src.effect.s === 'permit' && src.effect.action === action && permitImplemented(src.effect) && test(src, src.effect));
}

// ---- Rule modifications ---------------------------------------------------------------------------------------------------------------------------------

function ruleMods(ctx: RuleContext, rules: RuleModDef['rule'][], player: PlayerId): { src: RuleSource; m: RuleModDef }[] {
  const out: { src: RuleSource; m: RuleModDef }[] = [];
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'rule' || !rules.includes(e.rule)) continue;
    if (refIncludes(cxOf(ctx, src), e.player ?? { ref: 'you' }, player)) out.push({ src, m: e });
  }
  return out;
}

/**
 * r3-static, CR 704.5j: does a "legend rule doesn't apply" effect cover this permanent ("The "legend rule" doesn't apply to permanents you control", Mirror
 * Gallery's every permanent)? `of` is matched as the permanent is now, "you" the effect's controller. A filter the statics can't judge covers nothing (the
 * rule applies: the player keeps the choice the rule gives, never a silent extra permanent).
 */
export function legendRuleExempt(s: GameState, id: ObjectId): boolean {
  const ctx = ruleContext(s);
  if (!ctx) return false;
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'rule' || e.rule !== 'legendRuleExempt') continue;
    if (e.of === undefined || objectMatches(cxOf(ctx, src), id, e.of) === true) return true;
  }
  return false;
}

/**
 * r3-static, CR 602.5b, 702.193a: how many more times than its printed limit an activated ability with this wrapper keyword of this source may be activated
 * ("Each power-up ability of permanents you control can be activated an additional time"). `of` is matched as the source is now, "you" the effect's controller.
 */
/**
 * std-rx27 (CR 602.5b, 702.177a): may `player` activate an ability with the wrapper keyword `keyword` of a permanent they control as though it hadn't been
 * activated ("During your turn, as long as you haven't activated an exhaust ability this turn, you may activate exhaust abilities as though they haven't been
 * activated", Elvish Refueler)? A rule `activateAsUnactivated` of that keyword that applies now (its static ability's condition, CR 611.3a) and is `player`'s.
 */
export function activatesAsUnactivated(s: GameState, player: PlayerId, source: ObjectId, keyword: string | undefined): boolean {
  if (keyword === undefined || s.objects[source]?.zone !== 'battlefield' || s.objects[source]?.controller !== player) return false;
  const ctx = ruleContext(s);
  if (!ctx) return false;
  return ctx.sources.some((src) => {
    const e = src.effect;
    if (e.s !== 'rule' || e.rule !== 'activateAsUnactivated' || e.keyword !== keyword || e.of !== undefined || e.value !== undefined) return false;
    return refIncludes(cxOf(ctx, src), e.player ?? { ref: 'you' }, player);
  });
}

/**
 * edh-cast-13 (CR 707.10, 614.1a, 616.1; Twinning Staff): how many additional copies of a spell the player makes when an effect has them copy it, one for each "If you would copy a spell one or
 * more times, instead copy it that many times plus an additional time" that applies to them (each replacement effect applies once to the event, CR 614.5, 616.1f).
 */
export function extraSpellCopies(s: GameState, player: PlayerId): number {
  const ctx = ruleContext(s);
  return ctx ? ruleMods(ctx, ['extraSpellCopy'], player).length : 0;
}

export function additionalActivations(s: GameState, source: ObjectId, keyword: string | undefined): number {
  if (keyword === undefined) return 0;
  const ctx = ruleContext(s);
  if (!ctx) return 0;
  let n = 0;
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'rule' || e.rule !== 'additionalActivation' || e.keyword !== keyword) continue;
    if (e.of !== undefined && objectMatches(cxOf(ctx, src), source, e.of) !== true) continue;
    const v = e.value === undefined ? 1 : e.value === 'none' ? undefined : evalQuantity(cxOf(ctx, src), e.value);
    if (v !== undefined && v > 0) n += v;
  }
  return n;
}

/** r3-static, CR 704.5a, 104.3b: does the player lose the game for having 0 or less life? Not while a "you don't lose the game for having 0 or less life" applies. */
export function losesForZeroLife(s: GameState, player: PlayerId): boolean {
  const ctx = ruleContext(s);
  if (!ctx) return true;
  return ruleMods(ctx, ['noLossForZeroLife'], player).length === 0;
}

/** edh-next-93 (CR 728.1, 119.3, 614.1a; Strong, the Brutish Thespian): does `player` gain life rather than lose life from radiation? A rule `radiationGainsLife` of that player that applies now. */
export function radiationGainsLife(s: GameState, player: PlayerId): boolean {
  const ctx = ruleContext(s);
  return !!ctx && ruleMods(ctx, ['radiationGainsLife'], player).length > 0;
}

/** edh-d-44 (CR 702.80a, 120.3d; Everlasting Torment): is all damage dealt to creatures dealt as though its source had wither? A rule `damageAsWither` of an object that applies now. */
export function damageAsWither(s: GameState): boolean {
  const ctx = ruleContext(s);
  return !!ctx && ctx.sources.some((src) => src.effect.s === 'rule' && src.effect.rule === 'damageAsWither');
}

/**
 * edh-next-49, CR 120.3b, 122.6 (Phyrexian Unlife): is all damage dealt to `player` dealt as though its source had infect? A rule `damageAsInfect` of that player that applies now
 * (its static ability's condition, CR 611.3a: "As long as you have 0 or less life"). Read where the damage is dealt (rules/damage.ts#dealDamage).
 */
export function damageAsInfect(s: GameState, player: PlayerId): boolean {
  const ctx = ruleContext(s);
  if (!ctx) return false;
  return ruleMods(ctx, ['damageAsInfect'], player).length > 0;
}

/**
 * edh-next-75, CR 309.4c, 603.2d (Hama Pashar, Ruin Seeker; Dungeon Delver): how many more times than once a room ability of a dungeon `owner` owns triggers: one for each rule
 * `roomAbilitiesExtra` of that player that applies now (a granted rule counts while its permanent has it).
 */
export function extraRoomTriggers(s: GameState, owner: PlayerId): number {
  const ctx = ruleContext(s);
  return ctx ? ruleMods(ctx, ['roomAbilitiesExtra'], owner).length : 0;
}

/**
 * CR 402.2, 514.1: the player's maximum hand size, or null for "no maximum hand size". Seven unless a rule modification says otherwise; several apply in
 * timestamp order (CR 613.11), so the latest wins. A value the statics can't evaluate (`rq:` capability missing, so such a card is manual) leaves the previous one.
 */
export function maxHandSize(s: GameState, player: PlayerId): number | null {
  const ctx = ruleContext(s);
  let max: number | null = 7;
  if (!ctx) return max;
  for (const { src, m } of ruleMods(ctx, ['maxHandSize', 'handSizeNoLimit'], player)) {
    if (m.rule === 'handSizeNoLimit' || m.value === 'none') {
      max = null;
      continue;
    }
    const v = m.value === undefined ? undefined : evalQuantity(cxOf(ctx, src), m.value);
    if (v === undefined) continue;
    // std-ry3 (CR 402.2): "is increased by N" / "is reduced by N" changes the size the earlier modifications left; no maximum stays no maximum
    if (m.delta !== undefined) {
      if (max !== null) max = Math.max(0, max + (m.delta === 'increase' ? v : -v));
    } else max = Math.max(0, v);
  }
  return max;
}

/**
 * CR 305.2: how many lands the player may play this turn beyond the one the rules allow: rule modifications `landPlays` (Azusa: "two additional lands") and
 * permissions `playLand` (Explore's resolved effect: "an additional land this turn"), each 1 when it states no number. A `playLand` permission with a field this
 * module does not implement (`from`: Crucible of Worlds; `of`) grants nothing here (`feature:permit.playLand.<field>` is not advertised). CR 305.2b ("can't
 * play lands") is a restriction and wins anyway (hookpoints.canPlayLand).
 */
export function additionalLandPlays(s: GameState, player: PlayerId): number {
  const ctx = ruleContext(s);
  if (!ctx) return 0;
  let n = 0;
  for (const { src, m } of ruleMods(ctx, ['landPlays'], player)) {
    const v = m.value === undefined ? 1 : m.value === 'none' ? 0 : evalQuantity(cxOf(ctx, src), m.value);
    n += v ?? 0;
  }
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'permit' || e.action !== 'playLand' || !permitImplemented(e) || !refIncludes(cxOf(ctx, src), e.who, player)) continue;
    n += e.count === undefined ? 1 : evalQuantity(cxOf(ctx, src), e.count) ?? 0;
  }
  return Math.max(0, n);
}

/** CR 502.3: is this permanent kept from untapping during its controller's untap step ("doesn't untap during your untap step", "can't untap")? */
export function untapPrevented(s: GameState, id: ObjectId): Denial | null {
  const ctx = ruleContext(s);
  if (!ctx) return null;
  return denialIn(ctx, { action: 'untapDuringUntapStep', subject: id, untapStepOf: s.turn.activePlayer }) ?? denialIn(ctx, { action: 'untap', subject: id });
}

/**
 * trek-4 (CR 702.26c, 502.1, 101.2; unverified): is this phased-out permanent kept from phasing in ("Permanents can't phase in.")? A phased-out permanent is
 * treated as though it doesn't exist (CR 702.26b), so the restriction's subject is matched against an overlay of the state in which this one permanent is
 * phased in: the rule names phasing in itself. The restrictions are those of the state as it is (a phased-out source has none, CR 702.26b).
 */
export function phaseInDenied(s: GameState, id: ObjectId): Denial | null {
  const o = s.objects[id];
  if (!o || o.zone !== 'battlefield' || !o.phasedOut || !actionMayBeRestricted(s, 'phaseIn')) return null;
  const ctx = ruleContext(s);
  if (!ctx) return null;
  const view = ctx.view.with({ ...s, objects: { ...s.objects, [id]: { ...o, phasedOut: false } } }, new Map());
  return denialIn(ctx, { action: 'phaseIn', subject: id, view });
}

/**
 * FAST4 T24, CR 509.1a: how many attacking creatures this creature may block. One, plus each "can block an additional creature each combat" (`extraBlockers`
 * with a number) that applies to it; `Infinity` for "can block any number of creatures" (`extraBlockers` with value 'none' or no value). A rule modification
 * applies to the creatures its `of` matches (relative to its source), or to its source when it has none. A number the statics can't evaluate adds nothing
 * (such a card is manual: its `rq:` capability is missing).
 */
export function maxBlocks(s: GameState, id: ObjectId): number {
  const ctx = ruleContext(s);
  if (!ctx) return 1;
  let n = 1;
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'rule' || e.rule !== 'extraBlockers') continue;
    const cx = cxOf(ctx, src);
    if (!(e.of === undefined ? src.source === id : objectMatches(cx, id, e.of) === true)) continue;
    if (e.value === undefined || e.value === 'none') return Infinity;
    n += Math.max(0, evalQuantity(cx, e.value) ?? 0);
  }
  return n;
}

/** r3-static, CR 510.1a: does this creature with negative power assign combat damage as though its power were positive (its own static ability, no `of`)? */
export function assignsNegativePowerAsPositive(s: GameState, id: ObjectId): boolean {
  const ctx = ruleContext(s);
  if (!ctx) return false;
  return ctx.sources.some((src) => src.effect.s === 'rule' && src.effect.rule === 'negativePowerAssignsAsPositive' && src.effect.of === undefined && src.source === id);
}

/**
 * FAST5 T60, CR 510.1a, 613.11: does this creature assign combat damage equal to its toughness rather than its power? A rule modification `combatDamageUsesToughness`
 * applies to the creatures its `of` matches (relative to its source), or to its source when it has none; with `onlyIf` only while the creature's toughness is greater
 * than its power. `c` is the creature's characteristics as combat damage is assigned. A toughness or power that is not a number never qualifies (a conditional rule
 * can't be judged; an unconditional one with no numeric toughness assigns nothing different, the caller reads a null toughness as it reads a null power).
 */
export function assignsCombatDamageAsToughness(s: GameState, id: ObjectId, c: Chars): boolean {
  const ctx = ruleContext(s);
  if (!ctx) return false;
  const num = (v: string | undefined): number | null => (v !== undefined && /^-?\d+$/.test(v) ? Number(v) : null);
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'rule' || e.rule !== 'combatDamageUsesToughness') continue;
    if (!(e.of === undefined ? src.source === id : objectMatches(cxOf(ctx, src), id, e.of) === true)) continue;
    if (e.onlyIf === undefined) return true;
    const p = num(c.power);
    const t = num(c.toughness);
    if (p !== null && t !== null && t > p) return true;
  }
  return false;
}

/**
 * edh-next-145 (CR 120.6, 704.5g, 613.11; Zilortha, Strength Incarnate): is lethal damage to this creature determined by its power rather than its toughness? A rule modification
 * `lethalDamageUsesPower` applies to the creatures its `of` matches (relative to its source), or to its source when it has none.
 */
export function lethalDamageUsesPower(s: GameState, id: ObjectId): boolean {
  return lethalByPowerReader(s)(id);
}

/**
 * edh-next-145: the same question for many creatures of one state (the state-based actions ask it for every creature): the rule sources are gathered once, and none of the rule means
 * no question at all (review: ruleContext rebuilds its sources on each call in a state with no layer sources).
 */
export function lethalByPowerReader(s: GameState): (id: ObjectId) => boolean {
  const ctx = ruleContext(s);
  const mine = ctx === null ? [] : ctx.sources.filter((src) => src.effect.s === 'rule' && src.effect.rule === 'lethalDamageUsesPower');
  if (ctx === null || mine.length === 0) return () => false;
  return (id) => mine.some((src) => {
    const e = src.effect as Extract<StaticEffect, { s: 'rule' }>;
    return e.of === undefined ? src.source === id : objectMatches(cxOf(ctx, src), id, e.of) === true;
  });
}

/**
 * The number lethal damage is checked against (CR 120.6, 704.5g): the toughness, or the power when `lethalDamageUsesPower` applies, at least 1 then (a creature with 0 or less power
 * needs 1 damage marked: Zilortha ruling 2020-04-17); null when that value is not a number.
 */
export function lethalThreshold(s: GameState, id: ObjectId, c: Chars, byPower: (id: ObjectId) => boolean = lethalByPowerReader(s)): number | null {
  const num = (v: string | undefined): number | null => (v !== undefined && /^-?\d+$/.test(v) ? Number(v) : null);
  if (!byPower(id)) return num(c.toughness);
  const p = num(c.power);
  return p === null ? null : Math.max(1, p);
}

/**
 * Cloud r3-mech (CR 702.184a, 613.11): does this creature station permanents using its toughness rather than its power? A rule modification `stationUsesToughness`
 * applies to the creatures its `of` matches (relative to its source), or to its source when it has none; with `onlyIf` only while the creature's toughness is greater
 * than its power, as assignsCombatDamageAsToughness. `c` is the creature's characteristics as the station ability resolves.
 */
export function stationsUsingToughness(s: GameState, id: ObjectId, c: Chars): boolean {
  const ctx = ruleContext(s);
  if (!ctx) return false;
  const num = (v: string | undefined): number | null => (v !== undefined && /^-?\d+$/.test(v) ? Number(v) : null);
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'rule' || e.rule !== 'stationUsesToughness') continue;
    if (!(e.of === undefined ? src.source === id : objectMatches(cxOf(ctx, src), id, e.of) === true)) continue;
    if (e.onlyIf === undefined) return true;
    const p = num(c.power);
    const t = num(c.toughness);
    if (p !== null && t !== null && t > p) return true;
  }
  return false;
}

/**
 * M12-3, CR 701.38d: the votes `player` has besides their one vote: `must` from each "While voting, you get an additional vote" (`additionalVote`) and `may`
 * from each "While voting, you may vote an additional time" (`mayVoteAdditional`) whose source `player` controls ("you"; `player` of the rule when it names
 * another). The votes all happen at the same time the player would otherwise have voted (the vote handler asks them in one decision).
 */
export function extraVotes(s: GameState, player: PlayerId): { must: number; may: number } {
  const ctx = ruleContext(s);
  const out = { must: 0, may: 0 };
  if (!ctx) return out;
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'rule' || (e.rule !== 'additionalVote' && e.rule !== 'mayVoteAdditional')) continue;
    const cx = cxOf(ctx, src);
    const who = e.player === undefined ? [cx.controller] : playersOf(cx, e.player);
    if (!who.includes(player)) continue;
    if (e.rule === 'additionalVote') out.must++;
    else out.may++;
  }
  return out;
}

/**
 * edh-next-135 (CR 701.55c; The Valeyard): how many times `player` faces a villainous choice they would face once: one, plus one for each `villainousChoiceExtra` effect whose `player`
 * (default the controller; "an opponent" for The Valeyard) includes them.
 */
export function villainousChoiceTimes(s: GameState, player: PlayerId): number {
  const ctx = ruleContext(s);
  if (!ctx) return 1;
  let n = 1;
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'rule' || e.rule !== 'villainousChoiceExtra') continue;
    const cx = cxOf(ctx, src);
    const who = e.player === undefined ? [cx.controller] : playersOf(cx, e.player);
    if (who.includes(player)) n++;
  }
  return n;
}

/**
 * edh-next-135 (CR 701.38a, 608.2d; Illusion of Choice, rulings 2016-08-23): the player who chooses how each player votes now, or undefined: the controller of the `choosesVotes` effect
 * with the latest order (timestamp, CR 613.7: the one that resolved most recently), while that player is still in the game (CR 800.4a).
 */
export function voteChooser(s: GameState): PlayerId | undefined {
  const ctx = ruleContext(s);
  if (!ctx) return undefined;
  let best: { player: PlayerId; order: readonly number[] } | undefined;
  const later = (a: readonly number[], b: readonly number[]): boolean => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? -1) !== (b[i] ?? -1)) return (a[i] ?? -1) > (b[i] ?? -1);
    return false;
  };
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'rule' || e.rule !== 'choosesVotes') continue;
    const player = cxOf(ctx, src).controller;
    if (s.players.find((p) => p.id === player)?.hasLost !== false) continue;
    if (best === undefined || later(src.order, best.order)) best = { player, order: src.order };
  }
  return best?.player;
}

/**
 * edh-d-97 (CR 702.85b; Averna, the Chaos Bloom): how many "As you cascade, you may put a land card from among the exiled cards onto the battlefield tapped." (`cascadeLandTapped`)
 * apply to a cascade of `player`: one for each such source `player` controls (each is an ability of its own: one land card each).
 */
export function cascadeLandPuts(s: GameState, player: PlayerId): number {
  const ctx = ruleContext(s);
  if (!ctx) return 0;
  let n = 0;
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'rule' || e.rule !== 'cascadeLandTapped' || e.player !== undefined) continue;
    if (cxOf(ctx, src).controller === player) n++;
  }
  return n;
}

/**
 * edh-d-96 (CR 701.25a, 609.3; Enhanced Surveillance): the additional numbers of cards `player` may look at as they surveil, one entry per "You may look at an additional N cards each
 * time you surveil" (`surveilLookAdditional`) whose source `player` controls (the rulings of 2018-10-05: two such permanents let them look at an additional 2 + 2 cards). A value that
 * is not a fixed number adds nothing (fail closed: the parser writes only a number).
 */
export function surveilExtraLooks(s: GameState, player: PlayerId): number[] {
  const ctx = ruleContext(s);
  const out: number[] = [];
  if (!ctx) return out;
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'rule' || e.rule !== 'surveilLookAdditional' || typeof e.value !== 'number' || e.value <= 0) continue;
    if (cxOf(ctx, src).controller !== player) continue;
    out.push(e.value);
  }
  return out;
}

/**
 * std-rx32 (CR 702.11b, 115.1): is this permanent targeted as though it didn't have hexproof (`targetableThroughHexproof`, "Creatures your opponents control can be the
 * targets of spells and abilities as though they didn't have hexproof")? `of` is matched as the permanent is now, relative to the effect's source and controller; a
 * filter the statics can't judge covers nothing (hexproof applies).
 */
export function hexproofIgnored(s: GameState, id: ObjectId | PlayerId, by?: PlayerId): boolean {
  const ctx = ruleContext(s);
  if (!ctx) return false;
  const isPlayer = s.players.some((p) => p.id === id);
  return ctx.sources.some((src) => {
    const e = src.effect;
    if (e.s !== 'rule' || e.rule !== 'targetableThroughHexproof') return false;
    const cx = cxOf(ctx, src);
    // edh-players-22 (CR 609.4, 109.5; Detection Tower): "... spells and abilities you control": only what that player controls may target through hexproof; the controller unknown: not waived (fail closed)
    if (e.player !== undefined && (by === undefined || !refIncludes(cx, e.player, by))) return false;
    // ... and "your opponents" (a player's hexproof, the restriction `hexproofShaped`): only a rule that names players covers a player
    if (isPlayer) return e.ofPlayers !== undefined && refIncludes(cx, e.ofPlayers, id as PlayerId);
    // edh-players-22 (Detection Tower ruling 2018-07-13): "creatures your opponents control with hexproof" also covers those with "hexproof from [quality]", which are targeted as though they didn't have it either
    const of = e.of !== undefined && e.of.keyword === 'hexproof' ? (({ keyword: _k, ...rest }) => rest)(e.of) : e.of;
    return of !== undefined && objectMatches(cx, id as ObjectId, of) === true;
  });
}

/** edh-players-22 (CR 702.11c, 115.1): a restriction of a player that is exactly what "you have hexproof" means: "can't be the target of spells or abilities your opponents control". */
function hexproofShaped(r: RestrictionDef): boolean {
  return r.mode === 'cant' && r.action === 'beTargeted' && r.other !== undefined && JSON.stringify(r.other) === '{"controller":"opponent"}' && r.max === undefined && r.when === undefined;
}

/**
 * edh-next-146 (CR 701.3a, 607.2d, 613.7e; Psychic Paper): the choices the attachment `id` makes as it becomes attached to `host` ("As this Equipment becomes attached to a creature,
 * choose ..."): those of its own `chooseAsAttached` rule modifications whose `of` the host matches (an object only; a player host matches none), in the order printed.
 */
export function asAttachedChoices(s: GameState, id: ObjectId, host: ObjectId | PlayerId): NonNullable<RuleModDef['asAttached']> {
  const ctx = ruleContext(s);
  if (!ctx || s.objects[host] === undefined) return [];
  return ctx.sources.flatMap((src) => (src.effect.s === 'rule' && src.effect.rule === 'chooseAsAttached' && src.source === id
    && (src.effect.of === undefined || objectMatches(cxOf(ctx, src), host as ObjectId, src.effect.of) === true) ? [...(src.effect.asAttached ?? [])] : []));
}

/** r4-mech (CR 704.5i): is this planeswalker exempt from being put into its owner's graveyard for having 0 loyalty (`zeroLoyaltyKept`, as damageKeptInCleanup)? */
export function zeroLoyaltyKept(s: GameState, id: ObjectId): boolean {
  const ctx = ruleContext(s);
  if (!ctx) return false;
  return ctx.sources.some((src) => src.effect.s === 'rule' && src.effect.rule === 'zeroLoyaltyKept'
    && (src.effect.of === undefined ? src.source === id : objectMatches(cxOf(ctx, src), id, src.effect.of) === true));
}

/**
 * edh-d-94 (CR 120.3c, 614.1a; Deification): would damage that removes every loyalty counter of this planeswalker remove all but one instead? A rule modification
 * `damageLeavesOneLoyalty` whose `of` matches it (relative to the source; the source itself without `of`), read as the damage is dealt.
 */
export function damageLeavesOneLoyalty(s: GameState, id: ObjectId): boolean {
  const ctx = ruleContext(s);
  if (!ctx) return false;
  return ctx.sources.some((src) => src.effect.s === 'rule' && src.effect.rule === 'damageLeavesOneLoyalty'
    && (src.effect.of === undefined ? src.source === id : objectMatches(cxOf(ctx, src), id, src.effect.of) === true));
}

/**
 * std-rx13 (CR 502.3): may this permanent's controller choose not to untap it during their untap step? A rule modification `mayNotUntap` of the permanent itself
 * ("You may choose not to untap ~ during your untap step"), controlled by that player.
 */
export function mayNotUntap(s: GameState, id: ObjectId): boolean {
  const o = s.objects[id];
  const ctx = ruleContext(s);
  if (!o || !ctx) return false;
  return ctx.sources.some((src) => src.effect.s === 'rule' && src.effect.rule === 'mayNotUntap' && src.effect.of === undefined && src.effect.player === undefined
    && src.source === id && src.controller === o.controller);
}

/**
 * p2-player-rules-1 (CR 502.3): the limits on how many permanents `player` untaps during their own untap step ("Players can't untap more than one nonbasic land
 * during their untap steps", `untapLimit`): for each rule that names the player (default its controller), the most permanents (`max`) and whether a permanent
 * counts (`counts`, `of` matched as the permanent is now, relative to the rule's source and controller; every permanent without `of`). A permanent `of` can't
 * be judged on counts (the limit is applied, never silently looser); a number that can't be evaluated is 0 (fail closed).
 */
export function untapLimits(s: GameState, player: PlayerId): { max: number; counts: (id: ObjectId) => boolean }[] {
  const ctx = ruleContext(s);
  if (!ctx) return [];
  return ruleMods(ctx, ['untapLimit'], player).map(({ src, m }) => {
    const cx = cxOf(ctx, src);
    const max = m.value === undefined || m.value === 'none' ? 0 : Math.max(0, evalQuantity(cx, m.value) ?? 0);
    return { max, counts: (id: ObjectId) => m.of === undefined || objectMatches(cx, id, m.of) !== false };
  });
}

/**
 * std-ry8 (CR 701.43a, 702.154a, 508.1): the options its controller has as this creature attacks: "You may exert ~ as it attacks" (`mayExertAsAttacks`) and enlist
 * (`enlist`), rule modifications of the creature itself controlled by its controller, in the order of their sources (one entry per instance: two instances of
 * enlist each work separately).
 */
export function attackOptions(s: GameState, id: ObjectId): RuleSource[] {
  const o = s.objects[id];
  const ctx = ruleContext(s);
  if (!o || !ctx) return [];
  return ctx.sources.filter((src) => src.effect.s === 'rule' && (src.effect.rule === 'mayExertAsAttacks' || src.effect.rule === 'enlist') && src.effect.of === undefined
    && src.effect.player === undefined && src.source === id && src.controller === o.controller);
}

/**
 * r4-mech (CR 514.2): is the damage marked on this permanent kept as the cleanup step removes damage? A rule modification `damageNotRemovedInCleanup` applies to its
 * source (no `of`) or to each permanent its `of` matches, relative to its source.
 */
export function damageKeptInCleanup(s: GameState, id: ObjectId): boolean {
  const ctx = ruleContext(s);
  if (!ctx) return false;
  return ctx.sources.some((src) => src.effect.s === 'rule' && src.effect.rule === 'damageNotRemovedInCleanup'
    && (src.effect.of === undefined ? src.source === id : objectMatches(cxOf(ctx, src), id, src.effect.of) === true));
}

/**
 * r4-mech (CR 705.1-705.2, 614.1a): does `player` control a source of "The first time you flip one or more coins each turn, those coins come up heads and you win
 * those flips" (`firstCoinFlipsWon`, the source's controller only)? The caller knows whether this is the first time this turn (PlayerState.turnStats.coinFlips).
 */
/**
 * p2-c-dieroll-1 (CR 706.6, 614.1a, 616.1; unverified cites): how many "If you would roll one or more dice, instead roll that many dice plus one and ignore the
 * lowest roll" apply to `player`'s rolls: each adds one die and ignores one more of the lowest (`diceAdvantage`, the source's controller).
 */
export function diceAdvantage(s: GameState, player: PlayerId): number {
  const ctx = ruleContext(s);
  if (!ctx) return 0;
  return ctx.sources.filter((src) => src.effect.s === 'rule' && src.effect.rule === 'diceAdvantage' && cxOf(ctx, src).controller === player).length;
}

/**
 * edh-d-49 (CR 706.2, 706.6; Night Shift of the Living Dead, Xenosquirrels, Monitor Monitor): the sources of "After you roll a die, you may pay ...
 * increase or decrease the result by 1" (`rollAdjust`) and "you may pay {1} to reroll one or more dice you rolled" (`rollReroll`) that apply to `player`'s rolls (the
 * source's controller), in timestamp order.
 */
export function rollOptions(s: GameState, player: PlayerId): RuleSource[] {
  const ctx = ruleContext(s);
  if (!ctx) return [];
  return ctx.sources.filter((src) => src.effect.s === 'rule' && (src.effect.rule === 'rollAdjust' || src.effect.rule === 'rollReroll') && cxOf(ctx, src).controller === player);
}

/**
 * edh-next-12 (CR 705.1, 614.1a; Krark's Thumb): how many "If you would flip a coin, instead flip two coins and ignore one" apply to `player`'s flips: each adds one coin
 * to every flip (`coinAdvantage`, the source's controller).
 */
export function coinAdvantage(s: GameState, player: PlayerId): number {
  const ctx = ruleContext(s);
  if (!ctx) return 0;
  return ctx.sources.filter((src) => src.effect.s === 'rule' && src.effect.rule === 'coinAdvantage' && cxOf(ctx, src).controller === player).length;
}

/**
 * edh-next-12 (CR 106.12, 614.1a; Damping Sphere): the least amount of mana at which a land tapped for mana produces {C} instead of what it would, or null when no
 * `tappedLandManaColorless` effect applies to this land (the effect's `player` includes the land's controller; only lands). The land is `source`, tapped by `player`.
 */
export function tappedManaCollapseAt(s: GameState, player: PlayerId, source: ObjectId): { at: number; type: ManaType } | null {
  const ctx = ruleContext(s);
  if (!ctx) return null;
  let out: { at: number; type: ManaType } | null = null;
  for (const { src, m } of ruleMods(ctx, ['tappedLandManaColorless'], player)) {
    if (typeof m.value !== 'number' || m.value < 1 || objectMatches(cxOf(ctx, src), source, { types: ['Land'] }) !== true) continue;
    // edh-next-140 (CR 106.12, 614.1a; Contamination: "If a land is tapped for mana, it produces {B} instead of any other type and amount"): the one mana is of `manaType` (default {C});
    // of two such effects the one that applies from the least mana is taken, the first by timestamp among equals (CR 616.1: the land's controller would choose)
    if (out === null || m.value < out.at) out = { at: m.value, type: m.manaType ?? 'C' };
  }
  return out;
}

/**
 * edh-c-72 (CR 106.12, 614.1a, 106.1b; Ritual of Subdual): does a `tappedLandManaOnlyColorless` effect apply to this land (the effect's `player` includes the land's controller; only lands)?
 * Its mana is then all {C}, as much of it as before. The land is `source`, tapped by `player`.
 */
export function tappedManaOnlyColorless(s: GameState, player: PlayerId, source: ObjectId): ManaType | null {
  const ctx = ruleContext(s);
  if (!ctx) return null;
  if (ruleMods(ctx, ['tappedLandManaOnlyColorless'], player).some(({ src }) => objectMatches(cxOf(ctx, src), source, { types: ['Land'] }) === true)) return 'C';
  // edh-next-45 (CR 106.12, 614.1a, 106.1b; Infernal Darkness): "it produces {B} instead of any other type": the type of the first such effect that applies (CR 616.1: the land's controller
  // would choose among several; the first by timestamp is taken)
  for (const { src, m } of ruleMods(ctx, ['tappedLandManaOnlyType'], player)) if (m.manaType !== undefined && objectMatches(cxOf(ctx, src), source, { types: ['Land'] }) === true) return m.manaType;
  return null;
}

export function firstCoinFlipsWon(s: GameState, player: PlayerId): boolean {
  const ctx = ruleContext(s);
  if (!ctx) return false;
  return ctx.sources.some((src) => src.effect.s === 'rule' && src.effect.rule === 'firstCoinFlipsWon' && cxOf(ctx, src).controller === player);
}

/**
 * FAST5X E3, CR 702.122a, 702.171a: what a creature counts for the total power of a crew or saddle cost (a `tapPower` part with `as`, rules/cost-pick.ts):
 * its power, or its toughness with "~ saddles Mounts and crews Vehicles using its toughness rather than its power" (`crewSaddleUsesToughness`), plus N for
 * each "... as though its power were N greater" (`crewSaddlePowerBonus`). Both apply to their source itself only (no `of`, model/cap-walk.ts). `c` is the
 * creature's characteristics; a power or toughness that is not a number counts 0, as for crew before.
 */
export function crewSaddleValue(s: GameState, id: ObjectId, c: Chars, as?: 'crew' | 'saddle'): number {
  const num = (v: string | undefined): number => (v !== undefined && /^-?\d+$/.test(v) ? Number(v) : 0);
  const ctx = ruleContext(s);
  const mods = ctx ? ctx.sources.filter((src) => src.source === id && src.effect.s === 'rule' && src.effect.of === undefined
    && (src.effect.rule === 'crewSaddlePowerBonus' || src.effect.rule === 'crewSaddleUsesToughness' || ((src.effect.rule === 'crewPowerBonus' || src.effect.rule === 'crewUsesToughness') && as === 'crew'))) : []; // edh-perms-15: crewPowerBonus is for crew costs only
  const usesToughness = mods.some((m) => (m.effect as RuleModDef).rule === 'crewSaddleUsesToughness' || (m.effect as RuleModDef).rule === 'crewUsesToughness');
  const base = usesToughness ? num(c.toughness) : num(c.power);
  let bonus = 0;
  for (const src of mods) {
    const e = src.effect as RuleModDef;
    if ((e.rule !== 'crewSaddlePowerBonus' && e.rule !== 'crewPowerBonus') || e.value === undefined || e.value === 'none') continue;
    bonus += evalQuantity(cxOf(ctx!, src), e.value) ?? 0;
  }
  // trek-18 (CR 702.122a, 701.11): "as though its power were tripled" for a crew cost (a saddle cost never)
  const tripled = as === 'crew' && !!ctx && ctx.sources.some((src) => src.source === id && src.effect.s === 'rule' && src.effect.of === undefined && src.effect.rule === 'crewStationPowerTripled');
  return (tripled && !usesToughness ? base * 3 : base) + bonus;
}

/**
 * trek-18 (CR 702.184a, 701.11; Sulu, Heroic Helmsman): what a creature tapped for a station cost counts for is multiplied by 3 when it has "stations Spacecraft ... as though its power
 * were tripled" (`crewStationPowerTripled`, the source itself only); 1 otherwise.
 */
export function stationPowerFactor(s: GameState, id: ObjectId): number {
  const ctx = ruleContext(s);
  return !!ctx && ctx.sources.some((src) => src.source === id && src.effect.s === 'rule' && src.effect.of === undefined && src.effect.rule === 'crewStationPowerTripled') ? 3 : 1;
}

/**
 * T20 (FAST4): CR 502.3 with the rule modification `untapDuringOtherUntapSteps` ("Untap ~ during each other player's untap step"): does this permanent, whose
 * controller is not the active player, untap together with the active player's permanents? Null when no such ability applies to it; else whether an effect
 * keeps it tapped: "can't untap" does (action `untap`), "doesn't untap during your untap step" does not (that is its controller's own untap step).
 */
export function untapsDuringOthersUntapStep(s: GameState, id: ObjectId): { kept: Denial | null } | null {
  const o = s.objects[id];
  if (!o || o.zone !== 'battlefield' || o.controller === s.turn.activePlayer) return null;
  const ctx = ruleContext(s);
  if (!ctx) return null;
  // r4-static: also a set of permanents ("Untap each creature you control during each other player's untap step", Seedborn Muse's kind): `of` matched as the
  // permanent is now with the effect's controller as "you", and only a permanent that controller controls (it is that player's ability; CR 502.3)
  // edh-next-124 (CR 502.3, 102.3; Teferi, Who Slows the Sunset's emblem): `opponents`, "during each opponent's untap step": only while the active player is an opponent of that controller
  const applies = ctx.sources.some((src) => src.effect.s === 'rule' && src.effect.rule === 'untapDuringOtherUntapSteps' && src.controller === o.controller
    && (src.effect.opponents !== true || isOpponentOf(s, src.controller, s.turn.activePlayer))
    && (src.effect.of === undefined ? src.source === id : objectMatches(cxOf(ctx, src), id, src.effect.of) === true));
  // edh-c-94 (CR 502.3; Blinding Beam, ruling 2013-06-07): "Creatures don't untap during target player's next untap step" keeps it tapped too, whoever controls it
  return applies ? { kept: denialIn(ctx, { action: 'untap', subject: id }) ?? denialIn(ctx, { action: 'untapDuringUntapStep', subject: id, untapStepOf: s.turn.activePlayer, untapTimedOnly: true }) } : null;
}

/**
 * edh-next-124 (CR 504.1, 504.2, 101.4; Teferi, Who Slows the Sunset's emblem, ruling 2021-09-24): "You draw a card during each opponent's draw step.": the players who draw a card in this
 * draw step after the active player's own draw, in APNAP order, once for each such rule they control (two emblems, two cards). Only a player still in the game, whose opponent the active
 * player is (CR 102.3). Read by core/steps.ts as part of the draw step's turn-based action: no player gets priority between these draws.
 */
/** edh-next-124 (CR 102.3): the engine plays free-for-all games only (no teams): every other player is an opponent. */
const isOpponentOf = (_s: GameState, a: PlayerId, b: PlayerId): boolean => a !== b;
/** CR 101.4: the players in turn order from the active player, those who left the game out. */
const apnapOrder = (s: GameState): PlayerId[] => {
  const ids = s.players.map((p) => p.id);
  const i = Math.max(0, ids.indexOf(s.turn.activePlayer));
  return [...ids.slice(i), ...ids.slice(0, i)].filter((id) => s.players.find((p) => p.id === id)?.hasLost !== true);
};

/**
 * edh-next-144 (CR 701.20a, 121.2, 607.2; Keranos, God of Storms): the objects whose `revealFirstDraw` rule reveals the card `player` has just drawn as their first this turn: rules of a
 * static ability of a permanent controlled by that player (the source itself, so a reveal is "this way" for that object's linked triggers), on that player's own turn only with
 * `onYourTurns`. In timestamp order; an object with two such rules reveals once.
 */
export function revealFirstDrawSources(s: GameState, player: PlayerId): ObjectId[] {
  const ctx = ruleContext(s);
  if (!ctx) return [];
  const out: ObjectId[] = [];
  for (const src of ctx.sources) {
    if (src.effect.s !== 'rule' || src.effect.rule !== 'revealFirstDraw' || src.controller !== player || src.source === null || out.includes(src.source)) continue;
    if (src.effect.onYourTurns === true && s.turn.activePlayer !== player) continue;
    out.push(src.source);
  }
  return out;
}

/** edh-next-132 (CR 701.20a; God-Eternal Kefnet): is the `revealFirstDraw` rule of `source` controlled by `player` the optional one ("You may reveal ... as you draw it")? */
export function revealFirstDrawOptional(s: GameState, player: PlayerId, source: ObjectId): boolean {
  const ctx = ruleContext(s);
  return (ctx?.sources ?? []).some((src) => src.effect.s === 'rule' && src.effect.rule === 'revealFirstDraw' && src.source === source && src.controller === player && src.effect.optional === true);
}

export function drawsDuringDrawStep(s: GameState): PlayerId[] {
  const ctx = ruleContext(s);
  if (!ctx) return [];
  const ap = s.turn.activePlayer;
  const out: PlayerId[] = [];
  for (const p of apnapOrder(s)) {
    if (p === ap || s.players.find((x) => x.id === p)?.hasLost === true || !isOpponentOf(s, p, ap)) continue;
    for (const src of ctx.sources) if (src.effect.s === 'rule' && src.effect.rule === 'drawDuringOpponentsDrawSteps' && src.controller === p) out.push(p);
  }
  return out;
}

/**
 * FAST5X E19, CR 106.4, 500.5, 614.1: what happens to a player's unspent mana as a step or phase ends. `keepTypes`: the mana types that player doesn't lose
 * (`manaDoesNotEmpty`, all of them when one such rule names no type: "Players don't lose unspent mana", "You don't lose unspent red mana"); `becomes`: the
 * distinct types the rest of it becomes instead of being lost (`unspentManaBecomes`, "If you would lose unspent mana, that mana becomes red instead"), in
 * timestamp order (CR 616.1: the affected player chooses when they differ; core/steps.ts asks).
 */
export function unspentManaRules(s: GameState, player: PlayerId): { keepAll: boolean; keepTypes: ManaType[]; becomes: ManaType[]; burn: boolean } {
  const ctx = ruleContext(s);
  const out = { keepAll: false, keepTypes: [] as ManaType[], becomes: [] as ManaType[], burn: false };
  if (!ctx) return out;
  for (const { m } of ruleMods(ctx, ['manaDoesNotEmpty', 'unspentManaBecomes', 'manaBurn'], player)) {
    // edh-next-141 (CR 106.4, 119.3; Yurlok of Scorch Thrash): the player loses life for the mana they lose; several such rules lose no more (ruling 2020-11-10)
    if (m.rule === 'manaBurn') out.burn = true;
    else if (m.rule === 'manaDoesNotEmpty') {
      if (m.manaType === undefined) out.keepAll = true;
      else if (!out.keepTypes.includes(m.manaType)) out.keepTypes.push(m.manaType);
    } else if (m.manaType !== undefined && !out.becomes.includes(m.manaType)) out.becomes.push(m.manaType);
  }
  return out;
}

/**
 * std-mana-1, CR 106.12, 614.1a: how many times each unit of mana is produced when `player` taps `source` for mana (a mana ability with {T} in its cost):
 * the product of the factors of every "If you tap a basic land for mana, it produces three times as much of that mana instead" that applies (`of` matched as
 * the source is now, "you" the effect's controller and the player tapping). A filter the statics can't judge applies to nothing (the plain amount).
 */
export function tapManaMultiplier(s: GameState, player: PlayerId, source: ObjectId): number {
  const ctx = ruleContext(s);
  if (!ctx) return 1;
  let n = 1;
  for (const { src, m } of ruleMods(ctx, ['tapManaMultiplier'], player)) {
    if (m.of !== undefined && objectMatches(cxOf(ctx, src), source, m.of) !== true) continue;
    if (typeof m.value === 'number' && m.value >= 1) n *= m.value;
  }
  return n;
}

/** edh-misc-2: the sources of the factors `tapManaMultiplier` multiplies, as [source of the rule, factor]: rules/mana.ts keeps those read before the costs were paid and applies the ones still on the battlefield (CR 113.6, 614.1a). */
export function tapManaMultiplierSources(s: GameState, player: PlayerId, source: ObjectId): [ObjectId, number][] {
  const ctx = ruleContext(s);
  if (!ctx) return [];
  const out: [ObjectId, number][] = [];
  for (const { src, m } of ruleMods(ctx, ['tapManaMultiplier'], player)) {
    if (m.of !== undefined && objectMatches(cxOf(ctx, src), source, m.of) !== true) continue;
    if (typeof m.value === 'number' && m.value >= 1) out.push([src.source ?? '', m.value]); // '' : a resolved effect, which lasts without its source
  }
  return out;
}

// ---- The provider of rules/hookpoints.ts ----------------------------------------------------------------------------------------------------------------

/** The flag actions/cast.ts leaves on a spell cast with mana that makes it uncounterable (`FLAG_CANT_BE_COUNTERED`, CR 106.6; a test pins that the two are equal). */
export const CANT_BE_COUNTERED_FLAG = 'cantBeCountered';

const forbid = (s: GameState, q: Asked): Denial | null => {
  const ctx = ruleContext(s);
  return ctx ? denialIn(ctx, q, s) : null; // edh-next-143: the state asked about (ignoredEffects)
};

/**
 * The view in which a card that is not on the stack yet is the spell being cast: on the stack (CR 601.2a), with the characteristics of the face being cast
 * (CR 601.3e, 709.3a, 712.11) and the caster as its controller. A spell already on the stack is seen as it is.
 */
function asSpell(base: CharsView, spell: ObjectId, player: PlayerId, face: number, fused: boolean, override?: Chars, xZero = false): CharsView | undefined {
  const o = base.s.objects[spell];
  if (!o || o.zone === 'stack') return undefined;
  const c = override ?? spellFaceChars(base.s, o, face, player, fused); // M6-0: a cast option's characteristics (CR 708.4, 718.3a-b, 712.8c)
  if (!c) return undefined;
  // edh-cast-4 (CR 107.3b, 202.3e): a spell cast free during a resolution announces no X: it is on the stack with X = 0 (rules/base-chars.ts#manaValueParityMatches)
  const s = overlayZone(base.s, spell, 'stack');
  return base.with(xZero ? { ...s, objects: { ...s.objects, [spell]: { ...s.objects[spell]!, stack: { x: 0 } as never } } } : s, new Map([[spell, c]]));
}

/**
 * The spell's own restrictions on being cast ("Cast this spell only ...", CR 601.3, 604.5): static abilities of the face being cast that function on the
 * stack, read before the card moves (a spell already on the stack is a source like any other).
 */
function ownCastDenial(view: CharsView | undefined, spell: ObjectId, player: PlayerId, actor: Actor): Denial | null {
  const c = view?.get(spell);
  if (!view || !c) return null;
  const cx: EvalCx = { s: view.s, all: view, source: spell, controller: player };
  for (const a of c.abilities) {
    const d = a.def;
    if (d.kind !== 'static' || !(d.zone ?? []).includes('stack')) continue;
    for (const e of d.effects) {
      if (e.s !== 'restrict' || e.action !== 'cast') continue;
      const v = verdict(cx, e, { action: 'cast', subject: spell, other: spell, actor });
      if (v === 'allowed') continue;
      return denialOf({ src: { effect: e, source: spell, controller: player, timestamp: 0, order: [], name: c.name, text: d.text }, r: e, unknown: v === 'unknown' });
    }
  }
  return null;
}

const hasSubtype = (view: CharsView, id: ObjectId, t: string): boolean => (view.get(id)?.subtypes ?? []).includes(t);

/**
 * FAST3 T16, CR 506.2: the defending player of an attack on `defender`: that player, the protector of a battle (CR 310.9b) or the controller of a planeswalker
 * (as core/combat.ts#defendingPlayerFor records it once the attack is declared).
 */
function defendingOf(s: GameState, view: CharsView, defender: PlayerId | ObjectId): PlayerId | undefined {
  if (s.players.some((p) => p.id === defender)) return defender as PlayerId;
  const o = s.objects[defender as ObjectId];
  if (!o) return undefined;
  return o.protector !== undefined && (view.get(o.id)?.types ?? []).includes('Battle') ? o.protector : o.controller;
}

/** The statics side of rules/hookpoints.ts: one function per wired row of design 9.4. */
export const staticsProvider: RuleHookProvider = {
  name: 'statics',
  // CR 508.1c: "can't attack"; `other` is what it would attack (a planeswalker or battle; a player never matches a filter). FAST3 T16: asked once per possible
  // defender (rules/combat-rules.ts#attackOptions), with that attack's defending player (CR 506.2) for "can't attack unless defending player controls ...".
  canAttack: (g, attacker, defender) => {
    const ctx = ruleContext(g.s);
    if (!ctx) return null;
    const defending = defendingOf(g.s, ctx.view, defender);
    const d = defending !== undefined ? { defending } : {};
    // FAST4 T33: and, for a player, "can't attack you" (`attackPlayer` with that player as `other`, CR 508.1b-c)
    return denialIn(ctx, { action: 'attack', subject: attacker, other: defender, ...d })
      ?? (g.s.players.some((p) => p.id === defender) ? denialIn(ctx, { action: 'attackPlayer', subject: attacker, other: defender, ...d }) : null);
  },
  // CR 509.1b: "can't block", "can't be blocked", "can't be blocked by ...", "can block only ...".
  // FAST4 T33: asked with the defending player of that block, the blocker's controller (CR 506.2, 509.1a: the defending player declares blockers among the
  // creatures they control), for "~ can't be blocked as long as defending player controls an artifact" (`{ref:'defending'}` in a `when`, statics/match.ts).
  canBlock: (g, blocker, attacker) => {
    const controller = g.s.objects[blocker]?.controller;
    const defending = controller !== undefined ? { defending: controller } : {};
    return forbid(g.s, { action: 'block', subject: blocker, other: attacker, ...defending })
      ?? forbid(g.s, { action: 'beBlocked', subject: attacker, other: blocker, already: 0, ...defending }) // MX5: one blocker alone (a limit is for the set)
      ?? forbid(g.s, { action: 'beBlockedBy', subject: attacker, other: blocker, ...defending });
  },
  // MX5, CR 509.1b: "~ can't be blocked by more than one creature": the blockers of one attacker as a set (checked on the whole declaration, like menace,
  // CR 702.111b). Only the limits (`max`) and the minimums (`min`, FAST5 T57: "can't be blocked except by three or more creatures") are asked here; every
  // other restriction on blocking was asked of each blocker by `canBlock`.
  blockSetValid: (g, attacker, blockers) => {
    if (blockers.length < 1) return null;
    const ctx = ruleContext(g.s);
    if (!ctx) return null;
    const controller = g.s.objects[blockers[0]!]?.controller;
    const q: Asked = { action: 'beBlocked', subject: attacker, already: blockers.length - 1, ...(controller !== undefined ? { defending: controller } : {}) };
    const hit = restrictionHits(ctx, q, (cx, r) => {
      if (r.mode === 'mustIfAble') return 'allowed'; // edh-d-38 (CR 509.1c): a requirement ("must be blocked by two or more creatures if able") forbids no set of blockers (rules/requirements.ts)
      if (r.min !== undefined) return minVerdict(cx, r, q, blockers.length);
      if (r.unlessAllBlock === true) return allBlockVerdict(cx, r, q, blockers, controller); // edh-next-18
      return blockers.length < 2 || r.max === undefined ? 'allowed' : verdict(cx, r, q);
    })[0];
    return hit ? denialOf(hit) : null;
  },
  // CR 115.1, 601.2c, 602.2b, 603.3d, 608.2b (and 702.11, 702.18 for the keyword forms): "can't be the target of ...". `other` is the spell or the source of
  // the ability, as a spell or an ability, read from last known information when it has left (CR 113.7a), controlled by the spell or ability's controller.
  canBeTargeted: (g, target, source, controller) => {
    const ctx = ruleContext(g.s);
    if (!ctx) return null;
    if (source === null) return denialIn(ctx, { action: 'beTargeted', subject: target });
    const sv = sourceView(ctx.view, source, controller);
    return denialIn(ctx, { action: 'beTargeted', subject: target, other: source, ...(sv ? { view: sv.view, actor: sv.actor } : {}) });
  },
  // CR 601.3: the spell's own casting restrictions, then "can't cast" effects on the player (`other` = the spell, on the stack as the face being cast, CR 601.2a, 601.3e).
  canCast: (g, spell, player, face, via) => {
    const ctx = ruleContext(g.s);
    const o = g.s.objects[spell];
    const def = o ? g.s.defs[o.defId] : undefined;
    // edh-cast-4 (CR 601.2b, 202.3e, 601.3; Void Winnower): the check again with X announced and the spell on the stack, for the effects that read a mana value only
    if (via.xAnnounced === true) {
      if (!o || !ctx) return null;
      const qx = { action: 'cast' as const, subject: player, other: spell, actor: spellActor(o, player) };
      const hit = restrictionHits(ctx, qx, (cx, r) => (r.max === undefined && filterMentionsManaValue(r.other) ? verdict(cx, r, qx) : 'allowed'))[0];
      return hit ? denialOf(hit) : null;
    }
    const own = def !== undefined && defHasRuleEffects(def); // its own restrictions function only once it is a spell: read them from the card
    if (!o || (!ctx && !own)) return null;
    // P1: the spell's view (an overlay of the whole object map) is built only when something will read it: its own restrictions, or a "can't cast" effect
    const castRestricted = ctx !== null && ctx.sources.some((src) => src.effect.s === 'restrict' && (src.effect.action === 'cast' || src.effect.action === 'castFromZone'));
    const view = own || castRestricted ? asSpell(ctx?.view ?? charsViewOf(g.s), spell, player, face, via.fused === true, via.chars, via.xZero === true) : undefined;
    const actor = spellActor(o, player);
    const ownDenial = own ? ownCastDenial(view, spell, player, actor) : null;
    if (ownDenial || !ctx) return ownDenial;
    const q = { subject: player, other: spell, actor, ...(view ? { view } : {}) };
    return denialIn(ctx, { action: 'cast', ...q })
      // "can't cast spells from graveyards"; p2-graveyard-2: from any zone other than a hand, with the zone (`fromZones`: "from graveyards or libraries")
      // edh-next-17 (CR 601.3, 101.2; Experimental Frenzy): and from a hand, for a restriction whose `fromZones` names it (the default, graveyards, never matches a hand)
      ?? (o.zone !== 'stack' ? denialIn(ctx, { action: 'castFromZone', ...q, fromZone: castOriginOf(o, player) /* edh-next-143: another player's hand is no hand of the caster's */ }) : null);
  },
  // CR 602.5 (mana abilities too, 605.1a): "its activated abilities can't be activated", "players can't activate abilities of artifacts".
  // FAST4 T33: with the kind of the ability (a mana ability, CR 605.1a), for "unless they're mana abilities"
  canActivate: (g, source, key, player) => {
    const ctx = ruleContext(g.s);
    if (!ctx) return null;
    const def = ctx.view.get(source)?.abilities.find((a) => a.key === key)?.def;
    const kind = def === undefined ? {} : {
      manaAbility: (def.kind === 'activated' && def.isMana === true) || (def.kind === 'manual' && def.mana === true),
      ...(def.kind === 'activated' ? { abilityKeyword: def.keyword ?? (def.isLoyalty === true || def.cost.loyalty !== undefined ? 'loyalty' : '') } : {}), // std-control-1: a manual ability's keyword is not known (fail closed); edh-players-6 (CR 606.1): a loyalty ability is the one of the keyword 'loyalty' ("Players can't activate planeswalkers' loyalty abilities")
    };
    return denialIn(ctx, { action: 'activate', subject: source, other: source, ...kind }) ?? denialIn(ctx, { action: 'activate', subject: player, other: source, ...kind });
  },
  // CR 305.2b: "can't play lands"; with `max`, "can't play more than N lands each turn".
  // WP31: a land that can't enter the battlefield can't be played (CR 305.1: playing a land is putting it onto the battlefield; CR 614.17d).
  // WP31 review: judged with the face it is played with (CR 712.12: a modal double-faced card enters with the land face chosen).
  canPlayLand: (g, land, player, face) => forbid(g.s, { action: 'playLand', subject: player, other: land }) ?? enterDenial(g.s, land, player, face !== undefined ? { face } : {}),
  // CR 303.4, 301.5, 704.5m-n: "can't be enchanted / equipped / attached".
  canAttach: (g, attachment, host) => {
    const ctx = ruleContext(g.s);
    if (!ctx) return null;
    const q = { subject: host, other: attachment };
    return denialIn(ctx, { action: 'beAttached', ...q })
      ?? (hasSubtype(ctx.view, attachment, 'Aura') ? denialIn(ctx, { action: 'beEnchanted', ...q }) : null)
      ?? (hasSubtype(ctx.view, attachment, 'Equipment') ? denialIn(ctx, { action: 'beEquipped', ...q }) : null);
  },
  // CR 101.2, 701.6a: "can't be countered", from a static ability or from the mana that paid for it (Cavern of Souls, CR 106.6). The counter handler asks (WP31).
  // WP31 review: `other` is what counters it (the spell, or the source of the ability, read as a spell or an ability, from last known information when it has
  // left, CR 113.7a), for "can't be countered by blue spells"; without `by` a restriction with `other` is applied (fail closed).
  canBeCountered: (g, spell, by) => {
    if (g.s.objects[spell]?.stack?.flags?.includes(CANT_BE_COUNTERED_FLAG)) return deny("This spell can't be countered (the mana spent to cast it said so).", ['CR 106.6', 'CR 101.2']);
    const ctx = ruleContext(g.s);
    if (!ctx) return null;
    if (!by) return denialIn(ctx, { action: 'beCountered', subject: spell });
    const sv = sourceView(ctx.view, by.source, by.controller);
    return denialIn(ctx, { action: 'beCountered', subject: spell, other: by.source, ...(sv ? { view: sv.view, actor: sv.actor } : {}) });
  },
  // r4-fxz (CR 302.6, 602.5a, 609.4): "you may activate abilities of creatures you control as though those creatures had haste": a permission that names haste
  activatesAsThoughHaste: (g, object, _player, _c) => {
    const ctx = ruleContext(g.s);
    if (!ctx) return undefined;
    return permitted(ctx, 'activate', (src, p) => namesKeyword(p.asThough, 'haste') && permitsObject(ctx, src, p, object)) ? true : undefined;
  },
  // edh-b-14 (CR 302.6, 508.1a, 609.4; Frenzied Saddlebrute): "All creatures can attack your opponents and planeswalkers your opponents control as though those creatures had haste": the permission
  // names the attacker (`of`, whose controller is one of `who`) and, with `opponentsOnly`, what is attacked: an opponent of the permission's controller, or a planeswalker one of them controls
  attacksAsThoughHaste: (g, object, defender) => {
    const ctx = ruleContext(g.s);
    if (!ctx) return undefined;
    return permitted(ctx, 'attackAsThoughHaste', (src, p) => {
      if (!permitsObject(ctx, src, p, object)) return false;
      if (p.opponentsOnly !== true) return true;
      const target = g.s.objects[defender as ObjectId];
      const player = g.s.players.some((pl) => pl.id === defender) ? (defender as PlayerId) : target !== undefined && ctx.view.get(target.id)?.types.includes('Planeswalker') === true ? target.controller : undefined;
      return player !== undefined && player !== src.controller && g.s.players.some((pl) => pl.id === player && !pl.hasLost);
    }) ? true : undefined;
  },
  // CR 601.3b, 702.8a: "you may cast [spells] as though they had flash". `c` is the face being cast; the card is seen as the spell on the stack (CR 601.2a).
  castsAsInstant: (g, spell, player, c) => {
    const o = g.s.objects[spell];
    if (o && ownFlashGrant(g.s, o.id, o.zone, player, c)) return true; // r3-static: "~ has flash as long as ..." (CR 702.8a, 113.6e)
    // edh-next-18 (CR 601.3b, 702.8a, 611.2; Quicken): "the next sorcery spell you cast this turn can be cast as though it had flash": a waiting `flash` rider of this
    // player whose filter the card matches, as the spell it would be (CR 601.3e); core/turn-effects.ts#takeNextSpellRiders uses it up with the next matching spell
    const waiting = o ? (g.s.turn.nextSpell ?? []).filter((r) => r.rider === 'flash' && r.player === player) : [];
    if (o && waiting.length > 0) {
      const view = charsViewOf(g.s).with(overlayZone(g.s, spell, 'stack'), new Map([[spell, { ...c, controller: player }]]));
      for (const r of waiting) {
        const cx: EvalCx = { s: view.s, all: view, source: r.sourceId ?? null, controller: r.controller };
        if (r.filter === undefined || objectMatches(cx, spell, r.filter, spellActor(o)) === true) return true; // a filter the hooks can't evaluate matches nothing
      }
    }
    const ctx = ruleContext(g.s);
    if (!ctx || !o) return undefined;
    let view: CharsView | undefined; // P1: built only when a "haveFlash" permission is there to read it (an overlay of the whole object map)
    const actor = spellActor(o);
    const ok = permitted(ctx, 'haveFlash', (src, p) => {
      if (p.offTimingSacrifice === true && ignoreOffTimingPermits) return false; // edh-perms-4: see `flashWithoutOffTimingPermit`
      if (p.ifXAtMost !== undefined) return false; // edh-d-44: flash only with an X up to the limit (castFlashXLimit), not flash by itself
      if (p.ifTargets !== undefined) return false; // edht4: flash only when the spell's targets include a match (castFlashIfTargets), not flash by itself
      if (p.costChange !== undefined || p.addCost !== undefined) return false; // FAST5 T56: a permission with a price is not flash by itself (castFlashCosts); std-rx10: castFlashAddCosts
      // std-rx27 (CR 607.2a, 400.7): "cast them as though they had flash" of the cards a linked ability exiled: that it is one of them is judged where the card
      // is (in exile, before it moves: on the stack it would be a new object); its other qualities, if any, as the spell it would be (CR 601.3e)
      const linked = linkedFlashNames(g.s, src, p, spell);
      if (linked === false) return false;
      const of = linked === undefined ? p.of : linked.quality ?? undefined;
      view ??= ctx.view.with(overlayZone(g.s, spell, 'stack'), new Map([[spell, c]]));
      const cx: EvalCx = { s: view.s, all: view, source: src.source, controller: src.controller };
      if (!(refIncludes(cx, p.who, player) && (of === undefined || objectMatches(cx, spell, of, actor) === true))) return false;
      // edh-d-44 (CR 601.3b, 601.2i; The Blue Spirit): "the first creature spell you cast each turn": none of that kind cast yet this turn (the spell being cast is not cast yet)
      if (p.firstOfKind === true) return p.of !== undefined && castCountOfKind(cx, player, p.of) === 0;
      return true;
    });
    return ok ? true : undefined;
  },
  // r4-mech (CR 606.3): "you may activate loyalty abilities of Jace planeswalkers you control ... any time you could cast an instant": the permanent is the source
  // itself without `of`, else one `of` matches (relative to the permission's source)
  loyaltyAsInstant: (g, source, player) => {
    const ctx = ruleContext(g.s);
    if (!ctx) return undefined;
    const ok = permitted(ctx, 'activateLoyaltyAsInstant', (src, p) => refIncludes(cxOf(ctx, src), p.who, player)
      && (p.of === undefined ? src.source === source : objectMatches(cxOf(ctx, src), source, p.of) === true));
    return ok ? true : undefined;
  },
  // edh-mana-keywords-8 (CR 702.6a, 602.5d): "During your turn, you may activate equip abilities any time you could cast an instant": the equip abilities `who` activates
  equipAsInstant: (g, _source, player) => {
    const ctx = ruleContext(g.s);
    if (!ctx) return undefined;
    const ok = permitted(ctx, 'activateEquipAsInstant', (src, p) => refIncludes(cxOf(ctx, src), p.who, player));
    return ok ? true : undefined;
  },
  // FAST5 T56 (CR 601.2f, 601.3b): "You may cast ~ as though it had flash if you pay {2} more to cast it": the increase of each such permission that applies to this
  // spell (only a fixed generic increase is implemented: cap-walk.ts names any other form `feature:permit.haveFlash.costChange.form`, which nothing registers).
  castFlashCosts: (g, spell, player, c): number[] => {
    const ctx = ruleContext(g.s);
    const o = g.s.objects[spell];
    if (!ctx || !o) return [];
    let view: CharsView | undefined;
    const actor = spellActor(o);
    const out: number[] = [];
    for (const src of ctx.sources) {
      const p = src.effect;
      const price = p.s === 'permit' && p.costChange !== undefined ? genericIncrease(p.costChange) : null;
      if (p.s !== 'permit' || p.action !== 'haveFlash' || price === null || p.addCost !== undefined || !permitImplemented(p)) continue;
      view ??= ctx.view.with(overlayZone(g.s, spell, 'stack'), new Map([[spell, c]]));
      const cx: EvalCx = { s: view.s, all: view, source: src.source, controller: src.controller };
      if (refIncludes(cx, p.who, player) && (p.of === undefined || objectMatches(cx, spell, p.of, actor) === true)) out.push(price);
    }
    return out;
  },
  // std-rx10 (CR 601.2b, 601.2f, 601.3b, 118.8): "You may cast this spell as though it had flash if you behold a Dragon as an additional cost to cast it": the
  // additional cost of each such permission that applies to this spell (one with a mana price too is castFlashCosts' alone, never both)
  castFlashAddCosts: (g, spell, player, c): CostDef[] => {
    const ctx = ruleContext(g.s);
    const o = g.s.objects[spell];
    if (!ctx || !o) return [];
    let view: CharsView | undefined;
    const actor = spellActor(o);
    const out: CostDef[] = [];
    for (const src of ctx.sources) {
      const p = src.effect;
      if (p.s !== 'permit' || p.action !== 'haveFlash' || p.addCost === undefined || p.costChange !== undefined || !permitImplemented(p)) continue;
      view ??= ctx.view.with(overlayZone(g.s, spell, 'stack'), new Map([[spell, c]]));
      const cx: EvalCx = { s: view.s, all: view, source: src.source, controller: src.controller };
      if (refIncludes(cx, p.who, player) && (p.of === undefined || objectMatches(cx, spell, p.of, actor) === true)) out.push(p.addCost);
    }
    return out;
  },
  // edht4 (CR 601.3b, 601.2c; Timely Ward): "You may cast this spell as though it had flash if it targets a commander": the target filter of each such permission that applies to this spell
  castFlashIfTargets: (g, spell, player, c): ObjectFilter[] => {
    const ctx = ruleContext(g.s);
    const o = g.s.objects[spell];
    if (!ctx || !o) return [];
    let view: CharsView | undefined;
    const actor = spellActor(o);
    const out: ObjectFilter[] = [];
    for (const src of ctx.sources) {
      const p = src.effect;
      if (p.s !== 'permit' || p.action !== 'haveFlash' || p.ifTargets === undefined || p.costChange !== undefined || p.addCost !== undefined || !permitImplemented(p)) continue;
      view ??= ctx.view.with(overlayZone(g.s, spell, 'stack'), new Map([[spell, c]]));
      const cx: EvalCx = { s: view.s, all: view, source: src.source, controller: src.controller };
      if (refIncludes(cx, p.who, player) && (p.of === undefined || objectMatches(cx, spell, p.of, actor) === true)) out.push(p.ifTargets);
    }
    return out;
  },
  // edh-d-44 (CR 601.3b, 601.2b, 107.3a; Silver Scrutiny): "You may cast this spell as though it had flash if X is 3 or less": the largest X of each such permission that applies to this spell
  castFlashXLimit: (g, spell, player, c): number[] => {
    const ctx = ruleContext(g.s);
    const o = g.s.objects[spell];
    if (!ctx || !o) return [];
    let view: CharsView | undefined;
    const actor = spellActor(o);
    const out: number[] = [];
    for (const src of ctx.sources) {
      const p = src.effect;
      if (p.s !== 'permit' || p.action !== 'haveFlash' || p.ifXAtMost === undefined || p.costChange !== undefined || p.addCost !== undefined || p.ifTargets !== undefined || !permitImplemented(p)) continue;
      view ??= ctx.view.with(overlayZone(g.s, spell, 'stack'), new Map([[spell, c]]));
      const cx: EvalCx = { s: view.s, all: view, source: src.source, controller: src.controller };
      if (refIncludes(cx, p.who, player) && (p.of === undefined || objectMatches(cx, spell, p.of, actor) === true)) out.push(p.ifXAtMost);
    }
    return out;
  },
  // CR 609.4: "can attack as though it didn't have defender", "can block as though it had flying".
  permits: (g, q) => {
    const ctx = ruleContext(g.s);
    if (!ctx) return false;
    // edh-combat-6 (CR 609.4, 508.1b; Weathered Sentinels): "can attack players who attacked you during their last turn as though it didn't have defender": only that player is attacked, never a planeswalker or battle
    if (q.action === 'attackAsThoughNoDefender') {
      return permitted(ctx, 'attackAsThoughNoDefender', (src, p) => permitsObject(ctx, src, p, q.subject)
        && (p.attackedYouLastTurn !== true || (g.s.players.some((pl) => pl.id === q.other) && playerAttackedPlayerLastTurn(g.s, q.other as PlayerId, src.controller))));
    }
    if (q.action === 'targetAsThoughNoHexproof') {
      // std-rx32 (CR 702.11b): the rule modification targetableThroughHexproof; edh-players-22: and who controls the spell or ability that targets (`other`: its source, else its controller)
      const o = typeof q.other === 'string' ? g.s.objects[q.other] ?? g.s.lki[q.other]?.object : undefined;
      const by = o !== undefined ? o.controller : g.s.players.some((p) => p.id === q.other) ? (q.other as PlayerId) : undefined;
      return hexproofIgnored(g.s, q.subject, by);
    }
    return permitted(ctx, 'blockAsThough', (src, p) => namesKeyword(p.asThough, q.asThough) && (p.attacker !== undefined ? permitsAttacker(ctx, src, p, q.subject, q.other) : permitsObject(ctx, src, p, q.subject)));
  },
};

/** One functioning rule of the search control of edh-next-119 (statics/hooks.ts#searchControllerOf, #searchExilersOf). */
export interface SearchRuleSource {
  controller: PlayerId;
  /** The rule's source object (null for a resolved effect whose source has left). */
  source: ObjectId | null;
  name: string;
  timestamp: number;
}

/** The players a search rule of `src` covers: `player` relative to the rule's source and controller, default the controller's opponents; never the controller. */
function searchRulePlayers(ctx: RuleContext, src: RuleSource, e: RuleModDef): PlayerId[] {
  const cx = cxOf(ctx, src);
  const who = e.player === undefined ? ctx.view.s.players.filter((p) => p.id !== src.controller && p.hasLost !== true).map((p) => p.id) : playersOf(cx, e.player);
  return who.filter((p) => p !== src.controller);
}

/**
 * edh-next-119 (CR 723.2, 723.5, 701.23a; Opposition Agent: "You control your opponents while they're searching their libraries."): who controls `searcher` while they search their own library:
 * the controller of the functioning `controlSearching` rule that covers them whose source most recently entered the battlefield (the greatest timestamp, CR 613.7d; the card's ruling of
 * 2020-11-10), or null when no rule covers them.
 */
export function searchControllerOf(s: GameState, searcher: PlayerId): SearchRuleSource | null {
  const ctx = ruleContext(s);
  if (!ctx) return null;
  let best: SearchRuleSource | null = null;
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'rule' || e.rule !== 'controlSearching') continue;
    if (!searchRulePlayers(ctx, src, e).includes(searcher)) continue;
    if (best === null || src.timestamp > best.timestamp) best = { controller: src.controller, source: src.source, name: src.name, timestamp: src.timestamp };
  }
  return best;
}

/**
 * edh-next-119 (CR 614.1a, 616.1, 609.4b; Opposition Agent: "While an opponent is searching their library, they exile each card they find. You may play those cards ..."): the functioning
 * `searchFoundExiled` rules that cover `searcher` searching their own library, one per source, in timestamp order.
 */
export function searchExilersOf(s: GameState, searcher: PlayerId): SearchRuleSource[] {
  const ctx = ruleContext(s);
  if (!ctx) return [];
  const out: SearchRuleSource[] = [];
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'rule' || e.rule !== 'searchFoundExiled') continue;
    if (!searchRulePlayers(ctx, src, e).includes(searcher)) continue;
    if (out.some((x) => x.source !== null && x.source === src.source && x.controller === src.controller)) continue;
    out.push({ controller: src.controller, source: src.source, name: src.name, timestamp: src.timestamp });
  }
  return out;
}
