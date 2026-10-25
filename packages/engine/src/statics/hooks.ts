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
import type { Condition, CostChange, ObjectFilter, CostDef, KeywordAbilityDef, PermissionDef, RestrictionDef, RuleAction, RuleModDef, StaticEffect, ZoneName } from '../types/ability';
import type { CardDef } from '../types/card';
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameState } from '../types/state';
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
  haveFlash: ['of', 'asThough', 'costChange', 'addCost'], // FAST5 T56: costChange is "if you pay {2} more" (hookpoints.castFlashCosts); a free permission has none; std-rx10: addCost (castFlashAddCosts)
  attackAsThoughNoDefender: ['of', 'asThough'],
  blockAsThough: ['of', 'asThough', 'attacker'], // p2-attack-block-1: attacker (the attackers it concerns, any blocker; CR 609.4, 702.14c)
  activate: ['of', 'asThough'], // r4-fxz: "activate abilities of creatures you control as though those creatures had haste" (activatesAsThoughHaste)
  playLand: ['count'],
  assignAsUnblocked: [], // FAST5 T37: only the source itself (no `of`), mayAssignAsUnblocked below
  activateLoyaltyAsInstant: ['of'], // r4-mech: loyaltyAsInstant below (CR 606.3)
};
const OPTIONAL_PERMIT_FIELDS = ['of', 'from', 'asThough', 'count', 'costChange', 'grants', 'fromTop', 'oncePerTurn', 'attacker'] as const; // FAST5X E14: never honored here; p2-attack-block-1: attacker

/** FAST5 T56: the amount of a cost change that is a fixed generic increase ("pay {2} more"), the only form of a flash permission's price that is implemented; null for any other. */
export function genericIncrease(c: CostChange): number | null {
  const m = c.mana;
  if (c.kind !== 'increase' || Object.keys(c).length !== 2 || m === undefined || m.length !== 1) return null;
  const s = m[0]!;
  return s.kind === 'generic' && Number.isInteger(s.amount) && s.amount > 0 ? s.amount : null;
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
  'preventCombatDamage', // Cloud r5-repl: the damage's source (effects/propose.ts#unpreventableIfRuled, its one call-site), "combat damage that would be dealt by creatures you control"
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
  'feature:costMod.life': true, // r5-cost: "cost an additional 3 life to cast" (actions/cast.ts#modifiedPlan adds the life to the spell's total cost, CR 601.2f, 119.4)
  'feature:costMod.times': true, // FAST4 T21: `mana` applied `times` times ("{2}{R} more for each target beyond the first", statics/costmods.ts#modifyMana)
  'feature:spellTargetCount.filter': true, // FAST4 T21: "if it targets a tapped creature" (statics/costmods.ts#filteredTargetCount, CR 601.2c, 601.2f)
  'feature:cost.abilityTargets': true, // r4-cost: an activated ability's announced targets in its cost (statics/costmods.ts#targetValue, actions/activate.ts, CR 601.2c, 602.2b)
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
  // r5-static: "No more than one creature can attack (you / this planeswalker) / block each combat" (CR 508.1c, 509.1b): judged on the whole declaration
  // (`declarationLimitDenial`, core/combat.ts); the requirement search is then not checked (rules/requirements-manual.ts)
  'feature:restrict.max.attack': true,
  'feature:restrict.max.attackPlayer': true,
  'feature:restrict.max.block': true,
  // FAST5 T57: "~ can't be blocked except by three or more creatures" (CR 509.1b, 702.111b): a `cant` beBlocked restriction with a numeric `min` and no `other`,
  // judged against the whole set of blockers of the attacker (`blockSetValid` below; model/cap-walk.ts names only that form so)
  'feature:restrict.min.beBlocked': true,
  // Restrictions, by call-site.
  'rule:attack': true, // rules/combat-rules.ts via hookpoints.canAttack (CR 508.1c)
  'rule:block': true, // hookpoints.canBlock (CR 509.1b)
  'rule:beBlocked': true,
  'rule:beBlockedBy': true,
  'rule:cast': true, // actions/cast.ts#castCheck via hookpoints.canCast (CR 601.3)
  'rule:castFromZone': true,
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
  'rule:beSuspected': true, // std-mkm: effects/handlers/levels.ts, the `suspected` designation of every suspect instruction (CR 701.60a, 101.2)
  'rule:beCopied': true, // std-copy-1: effects/handlers/tokens-copy.ts#copySpells, the one place a copy of a spell is put onto the stack (CR 707.10, 101.2)
  'rule:beBeamedUp': true, // trek-1: rules/cant.ts#costUseDenial, the returnToHand part of a beam me up cost (rules/cost-pick.ts), the one way to beam a permanent up
  // Permissions.
  'permit:haveFlash': true, // rules/timing.ts via hookpoints.castsAsInstant (CR 601.3b, 702.8a)
  'permit:attackAsThoughNoDefender': true, // hookpoints.permits (CR 609.4, 702.3b)
  'permit:blockAsThough': true,
  'permit:activate': true, // r4-fxz: rules/timing.ts#isSummoningSickToActivate via hookpoints.activatesAsThoughHaste (CR 302.6, 602.5a, 609.4)
  'permit:playLand': true, // actions/land.ts#landsAllowed (CR 305.2)
  'permit:assignAsUnblocked': true, // core/combat-damage.ts via mayAssignAsUnblocked (CR 510.1b-c; FAST5 T37)
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
  'rulemod:untapDuringOtherUntapSteps': true, // T20 (FAST4): core/steps.ts, the untap step (CR 502.3), the source itself (no `of`); r4-static: or the permanents of `of`
  // FAST5X E19: core/steps.ts#endOfStepCleanup via unspentManaRules, as each step and phase ends (CR 106.4, 500.5, 614.1)
  'rulemod:manaDoesNotEmpty': true,
  'rulemod:unspentManaBecomes': true,
  'rulemod:tapManaMultiplier': true, // std-mana-1: rules/mana.ts#addMana via tapManaMultiplier (CR 106.12, 614.1a)
  // FAST5X E3: rules/cost-pick.ts#valueOf via crewSaddleValue, for crew and saddle costs (CR 702.122a, 702.171a), the source itself only (no `of`)
  'rulemod:crewSaddlePowerBonus': true,
  'rulemod:crewSaddleUsesToughness': true,
  'feature:costMod.unlock': true, // std-rh: core/rooms.ts#listed via effects/handlers/rooms.ts and statics/costmods.ts#unlockManaCost (CR 116.2m, 709.5e, 118.7)
  'feature:costMod.abilities.keyword': true, // FAST5 T60: actions/activate.ts#costChangeOf via statics/costmods.ts#abilityCostModsFor (CR 601.2f, 602.2b)
  'feature:cost.collectEvidence.link': true, // std-rx27: rules/pay-parts.ts records, actions/activate.ts stores on the source (CR 607.2a, 701.59a)
  'feature:costMod.abilities.firstEachTurn': true, // std-rx27: the same, for the first such ability the player activates each turn (CR 602.2b, 118.9)
  'feature:costMod.abilities.increase': true, // std-rx28: the same, and a mana ability it applies to is paid by hand (rules/mana.ts#manaCostShapeNow, rules/pay.ts; CR 601.2f, 605.1a)
  'feature:costMod.abilities.reduce': true, // Cloud std-woe: the same, and rules/pay.ts / rules/sources.ts for mana abilities via statics/costmods.ts#abilityManaCost (CR 605.1a)
  'feature:costMod.plot': true, // std-rx26: core/special/plot.ts#plotCostAfterMods via statics/costmods.ts#plotCostModsFor (CR 702.170a, 601.2f)
  'feature:costMod.floor.one': true, // r3-cost: "can't reduce the mana in that cost to less than one mana", statics/costmods.ts#modifyMana (CR 601.2f, 118.7)
  'rulemod:combatDamageUsesToughness': true, // FAST5 T60: core/combat-damage.ts via assignsCombatDamageAsToughness (CR 510.1a)
  // r3-static: core/sba-objects.ts (the legend rule, CR 704.5j) via legendRuleExempt; core/sba.ts (CR 704.5a) via losesForZeroLife
  'rulemod:legendRuleExempt': true,
  'rulemod:noLossForZeroLife': true,
  'rulemod:additionalActivation': true, // r3-static: rules/timing.ts#activationRestrictionDenial via additionalActivations (CR 602.5b)
  'rulemod:activateAsUnactivated': true, // std-rx27: rules/timing.ts#activationRestrictionDenial via activatesAsUnactivated (CR 602.5b, 702.177a)
  'rulemod:negativePowerAssignsAsPositive': true, // r3-static: core/combat-damage.ts via assignsNegativePowerAsPositive (CR 510.1a), the source itself only
  'rulemod:stationUsesToughness': true, // cloud r3-mech: effects/eval.ts (`stat` with `station`) via stationsUsingToughness (CR 702.184a)
  // M12-3: effects/handlers/actions-native.ts#vote via extraVotes (CR 701.38d), the source's controller
  'rulemod:additionalVote': true,
  'rulemod:mayVoteAdditional': true,
  'rulemod:zeroLoyaltyKept': true, // r4-mech: core/sba-objects.ts, the 0-loyalty state-based action, via zeroLoyaltyKept (CR 704.5i)
  'rulemod:targetableThroughHexproof': true, // std-rx32: keywords/hooks/targeting.ts via hexproofIgnored (CR 702.11b, 115.1)
  'rulemod:mayNotUntap': true, // std-rx13: core/steps.ts, the untap step, via mayNotUntap (CR 502.3), the source itself only
  'rulemod:untapLimit': true, // p2-player-rules-1: core/steps.ts, the untap step, via untapLimits (CR 502.3): "players can't untap more than one land during their untap steps"
  // std-ry8: core/combat.ts, the declaration of attackers, via attackOptions (CR 701.43a, 702.154a, 508.1), the source itself only; with `then` (CR 603.12)
  'rulemod:mayExertAsAttacks': true,
  'rulemod:enlist': true,
  'feature:rule.attackOption.then': true,
  'rulemod:damageNotRemovedInCleanup': true, // r4-mech: core/steps.ts, the cleanup step, via damageKeptInCleanup (CR 514.2)
  'rulemod:firstCoinFlipsWon': true, // r4-mech: effects/handlers/game.ts#flipCoin via firstCoinFlipsWon (CR 705.1-705.2, 614.1a), the source's controller
  // r5-static: a static ability's effects while its condition is false (CR 611.3a): statics/live.ts (continuous effects, with statics/layers.ts#stillExists)
  // and statics/rule-sources.ts (restrictions); model/cap-walk.ts names every other kind `feature:static.otherwise.<kind>`
  'feature:static.otherwise': true,
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
  // std-control-1: "power-up abilities can't be activated" (CR 602.5, 702.193a): canActivate tells the ability's wrapper keyword
  'feature:restrict.abilityKeyword.activate': true,
  // p2-graveyard-2: "players can't cast spells from graveyards or libraries" (CR 601.3): canCast tells the zone the card is cast from
  'feature:restrict.fromZones.castFromZone': true,
  // FAST5 T37: "~ can't attack alone / block alone" (CR 506.5): judged on the whole declaration by core/combat.ts through cantActAlone
  'feature:restrict.alone.attack': true,
  'feature:restrict.alone.block': true,
  'rulemod:diceAdvantage': true, // p2-c-dieroll-1: effects/handlers/game.ts#rollDie via diceAdvantage (CR 706.6, 614.1a, unverified), the source's controller
  'rule:phaseIn': true, // trek-4: rules/phasing.ts#phaseInForUntapStep via phaseInDenied, the only phase-in the engine performs (CR 502.1, 702.26c, 101.2; unverified)
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
  beCopied: ['CR 707.10', 'CR 101.2'], // std-copy-1
  phaseIn: ['CR 702.26c', 'CR 502.1', 'CR 101.2'], // trek-4 (unverified)
  beBeamedUp: ['CR 101.2', 'CR 614.17b'], // trek-1 (beam me up: Star Trek, CR 702 rule number unverified)
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

function verdict(cx: EvalCx, r: RestrictionDef, q: Asked): Verdict {
  if (r.mode === 'mustIfAble') return 'allowed';
  if (r.alone === true) return 'allowed'; // FAST5 T37: "can't attack alone" forbids a whole declaration, not the creature (cantActAlone)
  if (r.min !== undefined) return 'allowed'; // FAST5 T57: "can't be blocked except by N or more creatures" is a rule about the set of blockers (blockSetValid)
  if (isDeclarationLimit(r)) return 'allowed'; // r5-static: "No more than one creature can attack each combat" limits a whole declaration (declarationLimitDenial)
  if (!refIncludes(cx, r.subject, q.subject)) return 'allowed';
  // FAST4 T33: "unless they're mana abilities" (CR 605.1a): a mana ability is not restricted; an ability of unknown kind is (fail closed)
  if (r.exceptMana === true) {
    if (q.manaAbility === undefined) return 'unknown';
    if (q.manaAbility) return 'allowed';
  }
  // std-control-1 (CR 602.5, 702.193a): "power-up abilities can't be activated": only the abilities with that wrapper keyword; one of unknown keyword is (fail closed)
  if (r.abilityKeyword !== undefined) {
    if (q.abilityKeyword === undefined) return 'unknown';
    if (q.abilityKeyword !== r.abilityKeyword) return 'allowed';
  }
  // p2-graveyard-2 (CR 601.3): "can't cast spells from graveyards or libraries": only a card cast from one of the zones the restriction names (the graveyard when it
  // names none); asked with no zone, it is applied (fail closed)
  if (r.action === 'castFromZone') {
    if (q.fromZone === undefined) return 'unknown';
    if (!(r.fromZones ?? ['graveyard']).includes(q.fromZone as ZoneName)) return 'allowed';
  }
  // FAST4 T33: `otherPlayer` is the player attacked (`attackPlayer`, "can't attack you", CR 508.1b-c); asked with no player, it is applied (fail closed)
  if (r.otherPlayer !== undefined) {
    if (q.other === undefined || !cx.s.players.some((p) => p.id === q.other)) return 'unknown';
    if (!playersOf(cx, r.otherPlayer).includes(q.other as PlayerId)) return r.mode === 'onlyIf' ? 'forbidden' : 'allowed';
  }
  // A restriction with `other` asked at a call-site that names no other object can't be evaluated: applied, never read as "does not apply" (fail closed; WP31
  // review). `feature:restrict.other.<action>` is advertised only for the actions whose call-sites pass it (OTHER_ACTIONS), so no automated card gets here.
  const other = r.other === undefined ? true : q.other === undefined ? undefined : objectMatches(cx, q.other, r.other, q.actor);
  const when = r.when === undefined ? true : whenHolds(cx, r.when);
  if (other === undefined || when === undefined) return 'unknown';
  if (r.mode === 'onlyIf') return other && when ? 'allowed' : 'forbidden';
  if (!other || !when) return 'allowed';
  if (r.max === undefined) return 'forbidden';
  const n = q.already ?? (r.action === 'cast' && r.other !== undefined ? castCountOfKind(cx, q.subject, r.other) : countFor(cx.s, r.action, q.subject));
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

interface Hit {
  src: RuleSource;
  r: RestrictionDef;
  unknown: boolean;
}

function restrictionHits(ctx: RuleContext, q: Asked, test: (cx: EvalCx, r: RestrictionDef) => Verdict): Hit[] {
  const out: Hit[] = [];
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'restrict' || e.action !== q.action) continue;
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

function denialIn(ctx: RuleContext, q: Asked): Denial | null {
  const hit = restrictionHits(ctx, q, (cx, r) => verdict(cx, r, q))[0];
  return hit ? denialOf(hit) : null;
}

/**
 * CR 101.2, 614.17: does a "can't" (or "only if") effect forbid this action right now? The first one in timestamp order, as a denial, or null. This is the check
 * WP11's `forbidden` makes before any replacement effect, and the one every hook below makes.
 */
export function cantHappen(s: GameState, q: RuleQuery): Denial | null {
  const ctx = ruleContext(s);
  return ctx ? denialIn(ctx, q) : null;
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

// ---- Limits on a whole declaration (r5-static) ----------------------------------------------------------------------------------------------------------

/**
 * r5-static, CR 508.1c, 509.1b: "No more than one creature can attack each combat", "No more than two creatures can attack you each combat", "No more than one
 * creature can block each combat", and the planeswalker's granted "No more than one creature can attack this planeswalker each combat": a `cant` restriction of
 * `attack`, `attackPlayer` or `block` with a numeric `max` (and nothing but `other` / `otherPlayer` naming what is attacked). It forbids no creature by itself
 * (`verdict`): a declaration in which more than `max` of the creatures it names attack (attack what it names) or block is illegal.
 */
export const isDeclarationLimit = (r: RestrictionDef): boolean =>
  r.mode === 'cant' && typeof r.max === 'number' && (r.action === 'attack' || r.action === 'attackPlayer' || r.action === 'block')
  && r.alone === undefined && r.min === undefined && r.goad === undefined && r.exceptMana === undefined;

/** One limit that applies now: at most `max` of the declared pairs it `counts`; `unknown` when part of it can't be judged (then it is not enforced: said). */
export interface DeclarationLimit {
  max: number;
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
    const n = new Set(pairs.filter((p) => l.counts(p.creature, p.defender) === true).map((p) => p.creature)).size;
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
  if (p.of !== undefined || p.attacker === undefined || typeof attacker !== 'string' || ctx.view.get(attacker as ObjectId) === undefined) return false;
  const cx = cxOf(ctx, src);
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
  return kw.length > 0 && words.some((_, i) => kw.every((w, j) => words[i + j] === w));
}

/**
 * FAST5 T37 (CR 510.1b-c): may this blocked attacker's controller have it assign its combat damage as though it weren't blocked ("You may have ~ assign its
 * combat damage as though it weren't blocked")? Only the permanent the static ability is on (a permission with `of` is not implemented: `permitImplemented`).
 */
export function mayAssignAsUnblocked(s: GameState, id: ObjectId): boolean {
  const ctx = ruleContext(s);
  if (!ctx) return false;
  return permitted(ctx, 'assignAsUnblocked', (src, p) => permitsObject(ctx, src, p, id));
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
  return denialIn(ctx, { action: 'untapDuringUntapStep', subject: id }) ?? denialIn(ctx, { action: 'untap', subject: id });
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
 * std-rx32 (CR 702.11b, 115.1): is this permanent targeted as though it didn't have hexproof (`targetableThroughHexproof`, "Creatures your opponents control can be the
 * targets of spells and abilities as though they didn't have hexproof")? `of` is matched as the permanent is now, relative to the effect's source and controller; a
 * filter the statics can't judge covers nothing (hexproof applies).
 */
export function hexproofIgnored(s: GameState, id: ObjectId): boolean {
  const ctx = ruleContext(s);
  if (!ctx) return false;
  return ctx.sources.some((src) => src.effect.s === 'rule' && src.effect.rule === 'targetableThroughHexproof' && src.effect.of !== undefined && objectMatches(cxOf(ctx, src), id, src.effect.of) === true);
}

/** r4-mech (CR 704.5i): is this planeswalker exempt from being put into its owner's graveyard for having 0 loyalty (`zeroLoyaltyKept`, as damageKeptInCleanup)? */
export function zeroLoyaltyKept(s: GameState, id: ObjectId): boolean {
  const ctx = ruleContext(s);
  if (!ctx) return false;
  return ctx.sources.some((src) => src.effect.s === 'rule' && src.effect.rule === 'zeroLoyaltyKept'
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
export function crewSaddleValue(s: GameState, id: ObjectId, c: Chars): number {
  const num = (v: string | undefined): number => (v !== undefined && /^-?\d+$/.test(v) ? Number(v) : 0);
  const ctx = ruleContext(s);
  const mods = ctx ? ctx.sources.filter((src) => src.source === id && src.effect.s === 'rule' && src.effect.of === undefined
    && (src.effect.rule === 'crewSaddlePowerBonus' || src.effect.rule === 'crewSaddleUsesToughness')) : [];
  const base = mods.some((m) => (m.effect as RuleModDef).rule === 'crewSaddleUsesToughness') ? num(c.toughness) : num(c.power);
  let bonus = 0;
  for (const src of mods) {
    const e = src.effect as RuleModDef;
    if (e.rule !== 'crewSaddlePowerBonus' || e.value === undefined || e.value === 'none') continue;
    bonus += evalQuantity(cxOf(ctx!, src), e.value) ?? 0;
  }
  return base + bonus;
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
  const applies = ctx.sources.some((src) => src.effect.s === 'rule' && src.effect.rule === 'untapDuringOtherUntapSteps' && src.controller === o.controller
    && (src.effect.of === undefined ? src.source === id : objectMatches(cxOf(ctx, src), id, src.effect.of) === true));
  return applies ? { kept: denialIn(ctx, { action: 'untap', subject: id }) } : null;
}

/**
 * FAST5X E19, CR 106.4, 500.5, 614.1: what happens to a player's unspent mana as a step or phase ends. `keepTypes`: the mana types that player doesn't lose
 * (`manaDoesNotEmpty`, all of them when one such rule names no type: "Players don't lose unspent mana", "You don't lose unspent red mana"); `becomes`: the
 * distinct types the rest of it becomes instead of being lost (`unspentManaBecomes`, "If you would lose unspent mana, that mana becomes red instead"), in
 * timestamp order (CR 616.1: the affected player chooses when they differ; core/steps.ts asks).
 */
export function unspentManaRules(s: GameState, player: PlayerId): { keepAll: boolean; keepTypes: ManaType[]; becomes: ManaType[] } {
  const ctx = ruleContext(s);
  const out = { keepAll: false, keepTypes: [] as ManaType[], becomes: [] as ManaType[] };
  if (!ctx) return out;
  for (const { m } of ruleMods(ctx, ['manaDoesNotEmpty', 'unspentManaBecomes'], player)) {
    if (m.rule === 'manaDoesNotEmpty') {
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

// ---- The provider of rules/hookpoints.ts ----------------------------------------------------------------------------------------------------------------

/** The flag actions/cast.ts leaves on a spell cast with mana that makes it uncounterable (`FLAG_CANT_BE_COUNTERED`, CR 106.6; a test pins that the two are equal). */
export const CANT_BE_COUNTERED_FLAG = 'cantBeCountered';

const forbid = (s: GameState, q: Asked): Denial | null => {
  const ctx = ruleContext(s);
  return ctx ? denialIn(ctx, q) : null;
};

/**
 * The view in which a card that is not on the stack yet is the spell being cast: on the stack (CR 601.2a), with the characteristics of the face being cast
 * (CR 601.3e, 709.3a, 712.11) and the caster as its controller. A spell already on the stack is seen as it is.
 */
function asSpell(base: CharsView, spell: ObjectId, player: PlayerId, face: number, fused: boolean, override?: Chars): CharsView | undefined {
  const o = base.s.objects[spell];
  if (!o || o.zone === 'stack') return undefined;
  const c = override ?? spellFaceChars(base.s, o, face, player, fused); // M6-0: a cast option's characteristics (CR 708.4, 718.3a-b, 712.8c)
  return c ? base.with(overlayZone(base.s, spell, 'stack'), new Map([[spell, c]])) : undefined;
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
      if (r.min !== undefined) return minVerdict(cx, r, q, blockers.length);
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
    const own = def !== undefined && defHasRuleEffects(def); // its own restrictions function only once it is a spell: read them from the card
    if (!o || (!ctx && !own)) return null;
    // P1: the spell's view (an overlay of the whole object map) is built only when something will read it: its own restrictions, or a "can't cast" effect
    const castRestricted = ctx !== null && ctx.sources.some((src) => src.effect.s === 'restrict' && (src.effect.action === 'cast' || src.effect.action === 'castFromZone'));
    const view = own || castRestricted ? asSpell(ctx?.view ?? charsViewOf(g.s), spell, player, face, via.fused === true, via.chars) : undefined;
    const actor = spellActor(o);
    const ownDenial = own ? ownCastDenial(view, spell, player, actor) : null;
    if (ownDenial || !ctx) return ownDenial;
    const q = { subject: player, other: spell, actor, ...(view ? { view } : {}) };
    return denialIn(ctx, { action: 'cast', ...q })
      // "can't cast spells from graveyards"; p2-graveyard-2: from any zone other than a hand, with the zone (`fromZones`: "from graveyards or libraries")
      ?? (o.zone !== 'hand' && o.zone !== 'stack' ? denialIn(ctx, { action: 'castFromZone', ...q, fromZone: o.zone }) : null);
  },
  // CR 602.5 (mana abilities too, 605.1a): "its activated abilities can't be activated", "players can't activate abilities of artifacts".
  // FAST4 T33: with the kind of the ability (a mana ability, CR 605.1a), for "unless they're mana abilities"
  canActivate: (g, source, key, player) => {
    const ctx = ruleContext(g.s);
    if (!ctx) return null;
    const def = ctx.view.get(source)?.abilities.find((a) => a.key === key)?.def;
    const kind = def === undefined ? {} : {
      manaAbility: (def.kind === 'activated' && def.isMana === true) || (def.kind === 'manual' && def.mana === true),
      ...(def.kind === 'activated' ? { abilityKeyword: def.keyword ?? '' } : {}), // std-control-1: a manual ability's keyword is not known (fail closed)
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
  // CR 601.3b, 702.8a: "you may cast [spells] as though they had flash". `c` is the face being cast; the card is seen as the spell on the stack (CR 601.2a).
  castsAsInstant: (g, spell, player, c) => {
    const o = g.s.objects[spell];
    if (o && ownFlashGrant(g.s, o.id, o.zone, player, c)) return true; // r3-static: "~ has flash as long as ..." (CR 702.8a, 113.6e)
    const ctx = ruleContext(g.s);
    if (!ctx || !o) return undefined;
    let view: CharsView | undefined; // P1: built only when a "haveFlash" permission is there to read it (an overlay of the whole object map)
    const actor = spellActor(o);
    const ok = permitted(ctx, 'haveFlash', (src, p) => {
      if (p.costChange !== undefined || p.addCost !== undefined) return false; // FAST5 T56: a permission with a price is not flash by itself (castFlashCosts); std-rx10: castFlashAddCosts
      // std-rx27 (CR 607.2a, 400.7): "cast them as though they had flash" of the cards a linked ability exiled: that it is one of them is judged where the card
      // is (in exile, before it moves: on the stack it would be a new object); its other qualities, if any, as the spell it would be (CR 601.3e)
      const linked = linkedFlashNames(g.s, src, p, spell);
      if (linked === false) return false;
      const of = linked === undefined ? p.of : linked.quality ?? undefined;
      view ??= ctx.view.with(overlayZone(g.s, spell, 'stack'), new Map([[spell, c]]));
      const cx: EvalCx = { s: view.s, all: view, source: src.source, controller: src.controller };
      return refIncludes(cx, p.who, player) && (of === undefined || objectMatches(cx, spell, of, actor) === true);
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
  // CR 609.4: "can attack as though it didn't have defender", "can block as though it had flying".
  permits: (g, q) => {
    const ctx = ruleContext(g.s);
    if (!ctx) return false;
    if (q.action === 'attackAsThoughNoDefender') return permitted(ctx, 'attackAsThoughNoDefender', (src, p) => permitsObject(ctx, src, p, q.subject));
    if (q.action === 'targetAsThoughNoHexproof') return hexproofIgnored(g.s, q.subject); // std-rx32 (CR 702.11b): the rule modification targetableThroughHexproof
    return permitted(ctx, 'blockAsThough', (src, p) => namesKeyword(p.asThough, q.asThough) && (p.attacker !== undefined ? permitsAttacker(ctx, src, p, q.subject, q.other) : permitsObject(ctx, src, p, q.subject)));
  },
};
