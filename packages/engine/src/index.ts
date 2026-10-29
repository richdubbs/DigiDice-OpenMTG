/** @openmtg/engine public API. */
export * from './types/ids';
export * from './types/mana';
export * from './types/card';
export * from './types/ability';
export * from './types/automation';
export * from './types/state';
export * from './types/decisions';
export * from './types/actions';
export * from './types/events';
export * from './rng';
export { applyAction, replayedEvents, type ApplyResult, type ActionError } from './core/apply';
export { createGame, initialState, DEFAULT_STOPS, ConfigError, type GameConfig, type PlayerConfig } from './core/create';
// M11-0 (m11 design 4): the Commander variants and the pure readers of the Commander state
export { COMMANDER_VARIANTS, commanderOptions } from './core/commander';
export { commanderCastsOf, commanderDamageTo, commanderIdentity, commanderOfCard, commandersOf, commanderTax, isCommander, isCommanderGame } from './statics/commander';
// M12-1 (m12 design 4.2): the pure readers of a multiplayer game
export { isMultiplayer, placements, playersInGame, seatNeighbor, type Placement } from './core/multiplayer';
export { viewFor, canSee, lkiVisible, unaliasAction, HIDDEN_DEF, type GameView } from './core/view';
export { controllerOfPlayer, decidingPlayer, mayActAs, playersControlledBy } from './core/player-control'; // std-control-3: controlling another player (CR 723)
export { replay, GameSession, type ReplayResult } from './core/replay';
// RPL-0 INTERFACE CHANGE (additive; replays design 13): the replay contracts. The open view and the view schema (core/view.ts), the event redaction shared
// by packages/net and the client (core/view-events.ts, moved from net game/redact.ts), checkpoint digests (core/digest.ts), view patches (core/view-patch.ts,
// moved from the parked milestone 13 branch) and the replay and bug report files (replay/*). All browser-safe.
export { openView, ENGINE_VIEW_SCHEMA, OLDEST_READ_VIEW_SCHEMA, readsViewSchema, adaptRecordedView } from './core/view';
export { viewCharsOf, type ViewChars, type ViewCharsAbility } from './core/view-chars';
export { eventsFor, replayedEventsFor, hiddenActionInProgress, UNSEEN_ID, type EventsForOptions } from './core/view-events';
export { gameDigest, digestSummary, checkpointDue, CHECKPOINT_EVERY, DIGEST_VERSION } from './core/digest';
export { diffViews, applyViewPatch, nextView, diffJson, applyPatch, jsonEqual, PatchError, PATCH_MAX_WORK, type PatchOp, type JsonPath, type ApplyPatchOptions } from './core/view-patch';
export * from './replay/index';
// RPL-0 (review): the shape check of an action from outside (packages/net's guest actions and a replay's log), moved from packages/net.
export { actionShapeProblem, unknownActionField, ACTION_BOUNDS, type ActionShapeOptions, type PlayerAction } from './core/action-shape';
// RPL-0 (review): the control-character rule of shown text (player names, titles), moved from packages/net, for the browser's game setup too.
export { cleanText, hasControl, CONTROL_CLASS } from './util/shown-text';
export { IllegalAction, IllegalAnswer, EngineBug } from './core/game';
export { chooseObjectsLimitHolds } from './core/validate'; // FAST5 T66: a bot's or a UI's choice keeps the total a chooseObjects decision limits
export { compileCard, parseTypeLine, noAbilityCompiler, pipelineCompiler, defaultCompileSources, COMPILER_VERSION, type AbilityCompiler, type ParsedTypeLine } from './cards/compile';
export { legalActions, listLegalActions, isByHandKind, type LegalAction } from './core/legal';
export { byHandAbilities, byHandUser, type ByHandKind, type ByHandInfo } from './rules/by-hand';
export { getChars, charsOfObject, faceChars, hasKeyword, hasType, isPermanentCard, type Chars, type PrintedAbility } from './rules/characteristics';
export { enumerateAbilities, activatedAbilities, findAbility, type AbilityInfo, type ActivatedInfo } from './rules/abilities';
export { manaSources, type ManaSource } from './rules/sources';
export { poolTypes, manaText } from './rules/mana';
export { parseManaAbilityLine, type AddManaStep } from './rules/mana-text';
export { isSummoningSick } from './rules/timing';
export { ptNumbers } from './rules/characteristics';
// Review 2026-10-26, Finding 19: the client checks a view's characteristics cache once per view instead of once per card (packages/client board/model.ts).
export { readingStable } from './rules/characteristics';
export { parseKeywordLine, parseEnchant, parseLandwalk, AUTOMATED_KEYWORDS, SUBTYPE_QUALITY_WORDS, type KeywordLine } from './cards/keywords';
export { KEYWORD_RULES } from './cards/keyword-list';
export { parseQuality, hasQuality, qualityText } from './rules/quality';
export { dealDamage, settleLifelink, type DamageOptions, type LifelinkLedger } from './rules/damage';
export { destroy, addRegenerationShield, type DestroyResult, type DestroyOptions } from './rules/destroy';
export { gainLife, loseLife, payLife, canPayLife, givePoison, changeLife } from './rules/life';
export { addPlayerRestriction, playerRestricted, type PlayerRestriction } from './rules/restrictions';
export { attackCandidates, blockCandidates, blocksDenial, attackDenial, blockDenial, attackableBy } from './rules/combat-rules';
// R1 (M6-7a) INTERFACE CHANGE: attack and block requirements (CR 508.1d, 509.1c): `requirementsFor` (design m6 3.9), the pure check `requirementsDenial` on a
// plan, and `obeyRequirements` for a client or bot (the search itself stays internal).
export { attackPlan, blockPlan, obeyRequirements, requirementsDenial, requirementsFor, type DeclarationPlan } from './rules/requirements';
export { landwalkApplies } from './keywords/hooks'; // the landwalk test is a keyword rule (CR 702.14c); the keyword provider owns it
export { attackerState, isAttacking, isBlocking, isBlocked, isUnblocked, removeFromCombat } from './rules/combat-state';
export { loseGame, winGame, drawGame, concedeGame, checkGameOver } from './core/sba';
export { createToken } from './core/zones';
// MX4 INTERFACE CHANGE (additive): the dungeon cards (CR 309) and the read-only questions about them, for views and tools
export { DUNGEONS, dungeonByName, dungeonOfObject, type Dungeon, type DungeonRoom } from './core/dungeon-data';
export { dungeonDef } from './core/dungeons';
export { cloneState, deepFreeze } from './util/clone';
export { hasProtectionFrom, canBeTargeted } from './rules/protection';

// ---- Milestone 5: the ability model, keyword library, parser, interpreter and rule hooks (design 5.3). The skeleton (WP0) exports every contract; the
// ---- work packages named in each file fill in the bodies without renaming anything here.
export type * from './model/api';
export {
  validateAbility, validateCardAbilities, lintAbility, capabilitiesOf, missingCapabilities, buildEngineCapabilities, ENGINE_CAPABILITIES,
  degradeAbility, degradeAbilities, classifyAbility, classifyCard, manualNodes, stripAbility, hydrateAbility, textHash, canonicalize,
} from './model';
export type * from './render/api';
export { renderAbility } from './render/render';
export { renderGate } from './render/gate';
export { normalizeForGate } from './render/equivalence';
export type * from './keywords/types';
export { keywordRegistry } from './keywords/registry';
export type * from './parser/types';
export { parseCard } from './parser/parse';
export type * from './cards/pipeline';
export { compileCardV2, compileCardDetailed, overlayFace, LAYOUT_CAPS } from './cards/pipeline';
export { spansOf } from './cards/spans';
export { loadEntries, readCompiledEntry, trusted, unusableReason, hydrateEntryFace, isHighRisk, type EntryProblem, type Unusable } from './cards/pack';
export { stubCardDef, imageSlots, tokenDefFor, markUnsanctioned, tokenVariantKey, oracleTokenVariantKeys, tokenBaseName, artSeriesNames, STUB_ID_PREFIX, UNSANCTIONED_REASON } from './cards/pool';
export { hookpoints, gameOf, type GameLike, type RuleHookProvider, type Hookpoints } from './rules/hookpoints';
export { evalCount } from './effects/eval';
export * from './tooling'; // WP25 INTERFACE CHANGE: the tooling surface for packages/cards (coverage, snapshots, mutation, smoke)
export type * from './effects/api';
export { OP_HANDLERS } from './effects/handlers';
export type * from './triggers/api';
export type * from './statics/api';
export { LAYERS } from './statics/api';

// The default compiler (cards/compile.ts) classifies against the running engine's capability set; it is installed here, at the package entry point,
// because cards/compile.ts cannot import model/capabilities.ts without an import cycle (core/manual.ts compiles tokens through compileCard).
import { installEngineCapabilities as installCaps } from './cards/compile';
import { ENGINE_CAPABILITIES as ENGINE_CAPS } from './model';
installCaps(ENGINE_CAPS);
