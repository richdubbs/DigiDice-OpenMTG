/**
 * Capabilities: how "the engine can do this" is known (design 5.2). Owner: WP1 (the walker `capabilitiesOf`, `missingCapabilities`); WP0 wrote
 * the builder below, which reads every table the other packages own. A capability is never declared in a second, hand-kept list: it exists because
 * the table entry exists, so an unfinished work package cannot make a card wrongly automated.
 */
import { DECISION_KINDS } from '../core/validate';
import { FEATURES as ANNOUNCE_FEATURES } from '../actions/announce';
import { CAST_COST_FEATURES, CAST_STATIC_KINDS } from '../actions/cast-kinds';
import { COND_EVALUATORS, DUR_EVALUATORS, QTY_EVALUATORS, QTY_FEATURES } from '../effects/eval';
import { OP_HANDLERS } from '../effects/handlers';
import { FEATURES as NATIVE_ACTION_FEATURES } from '../effects/handlers/actions-native';
import { FEATURES as CARDS_FEATURES } from '../effects/handlers/cards';
import { CHANGE_FACE } from '../effects/handlers/change-face';
import { FEATURES as MANUAL_FEATURES } from '../effects/manual';
import { FEATURES as PROPOSE_FEATURES, REPLACEMENT_BODIES, STATIC_KINDS as REPLACE_STATIC_KINDS } from '../effects/propose';
import { REPLACE_ON_CAPABILITIES } from '../effects/replacements';
import { FILTER_PARTS, FILTER_STATUS_FIELDS } from '../rules/registries';
import { REF_FEATURES, REF_RESOLVERS } from '../effects/refs';
import { keywordCapabilities } from '../keywords/capabilities';
import { keywordRegistry } from '../keywords/registry';
import { RENDERERS } from '../render/step';
import { COST_FORMS, COST_PART_IMPLS } from '../rules/cost';
import { SUPPORTED_FILTER_FIELDS } from '../rules/filter';
import { RULED_COUNTER_KINDS } from '../rules/status';
import { FINALITY_COUNTER_KINDS } from '../effects/rule-replacements/finality';
import { HONE_COUNTER_KINDS } from '../statics/hone';
import { SHIELD_COUNTER_KINDS } from '../effects/rule-replacements/shield';
import { RAD_COUNTER_KINDS } from '../core/rad';
import { TARGET_KINDS } from '../rules/targets';
import { FEATURES as LAYER_FEATURES, LAYER_TABLE } from '../statics/layers';
import { RULE_HOOK_ACTIONS } from '../statics/hooks';
import { STATIC_KINDS } from '../statics/live';
import { STATIC_CONDITION_KINDS, STATIC_FILTER_FIELDS, STATIC_OBJREF_KINDS, STATIC_QUANTITY_KINDS, STATIC_STATUS_FIELDS } from '../statics/match';
import { FEATURES as MATCH_FEATURES, EVENT_MATCHERS } from '../triggers/match';
import { FEATURES as NORMALIZE_FEATURES } from '../triggers/normalize';
import { delayedWhenForms, eventPatternForms, triggerOwnForms } from '../triggers/forms';
import { installTokenClassifier, PREDEFINED_TOKENS } from '../effects/handlers/token-defs';
import { OP_FORMS as COPY_OP_FORMS } from '../effects/handlers/tokens-copy';
import { OP_FORMS as CAST_OP_FORMS } from '../effects/handlers/tokens-cast';
import { TRIGGER_MOD_CAPABILITIES } from '../triggers/collect';
import { OP_FORMS as DAY_NIGHT_OP_FORMS } from '../core/day-night';
import { INITIATIVE_OP_FORMS } from '../core/designations';
import { CITYS_BLESSING_OP_FORMS } from '../core/citys-blessing';
import { OP_FORMS as LEVELS_OP_FORMS } from '../effects/handlers/levels';
import { OP_FORMS as MOVE_OP_FORMS } from '../effects/handlers/zones-move';
import { OP_FORMS as COUNTERS_OP_FORMS } from '../effects/handlers/counters';
import { OP_FORMS as PAY_OP_FORMS } from '../effects/handlers/pay';
import { OP_FORMS as SEARCH_OP_FORMS } from '../effects/handlers/cards-library';
import { OP_FORMS as CHOOSE_OP_FORMS } from '../effects/handlers/choose';
import { EXILE_UNTIL_OP_FORMS } from '../effects/handlers/actions-native';
import { OP_FORMS as SACRIFICE_OP_FORMS } from '../effects/handlers/zones-remove';
import { OP_FORMS as DISCARD_OP_FORMS } from '../effects/handlers/cards-draw';
import { OP_FORMS as LIFE_OP_FORMS } from '../effects/handlers/lifedamage';
import { OP_FORMS as OUTSIDE_OP_FORMS } from '../effects/handlers/outside';
import { OP_FORMS as MANA_OP_FORMS } from '../effects/handlers/cards-mana';
import { PREGAME_FEATURES, PREGAME_STATIC_KINDS } from '../core/pregame';
import { COMMANDER_FEATURES, COMMANDER_STATIC_KINDS } from '../core/commander';
import { LEVELS_FEATURES } from '../statics/levels';
import { CONTROL_FEATURES, OP_FORMS as CONTROL_OP_FORMS } from '../core/control';
import { CHOSEN_QUALITY_FEATURES } from '../statics/mods';
import { COPY_CHOOSE_FEATURES, COPY_THIS_ABILITY_FEATURES, EFFECT_OP_FORMS } from '../effects/handlers/lasting';
import { LIFE_TOUGHNESS_OP_FORMS } from '../effects/handlers/zones-status';

import { TOKEN_FEATURES } from '../effects/handlers/tokens-create';
import { renderGate } from '../render/gate';
import type { AbilityDef, DelayedWhen, EventPattern } from '../types/ability';
import type { CapabilitiesOf, CapabilitySet, MissingCapabilities } from './api';
import { capabilitiesOfDef, installCastCostKeywords, installEventForms, installKeywordParams, predefinedTokenCapability } from './cap-walk';
import { classifyCard, expansionManuals, installKeywordManuals } from './classify';
import { installKeywordLinks } from './lint-card';
import { OP_FORMS as FLOW_OP_FORMS } from '../effects/handlers/control';
import { OP_FORMS as GAME_OP_FORMS } from '../effects/handlers/game';

// The walker's event forms come from WP8's triggers/forms.ts (design 5.4: the walker can't import it). Patterns are visited one by one, so a triggered
// ability adds only what is not a pattern's (`feature:trigger.mana`, `feature:trigger.mana.modal`). W2 merge INTERFACE CHANGE; WP32 review: triggerOwnForms.
installEventForms({
  pattern: (p) => eventPatternForms(p as unknown as EventPattern),
  trigger: (def) => triggerOwnForms(def as unknown as AbilityDef),
  delayed: (w) => (w['at'] === 'event' ? [] : delayedWhenForms(w as unknown as DelayedWhen)), // an event `when` is an EventPattern node of its own
});

// The classifier counts the manual nodes of keyword expansions (design 10.3; ninjutsu's defender step, CR 702.49c). model/classify.ts can't read the keyword
// library (design 5.4), so the builder installs the table, like the event forms above. M5Z review INTERFACE CHANGE.
installKeywordManuals(keywordRegistry.all().filter((d) => d.status === 'implemented').map((d) => [d.name, expansionManuals(d.expand ?? [])] as const).filter(([, m]) => m.length > 0));

// FAST5X E26 (CR 607.2a): the links an implemented keyword's expansion produces (a step's `link`: hideaway's "exiled"), read by model/lint-card.ts#collectLinks
const stepLinks = (x: unknown, out: Set<string>): Set<string> => {
  if (Array.isArray(x)) x.forEach((y) => stepLinks(y, out));
  else if (typeof x === 'object' && x !== null) {
    const r = x as Record<string, unknown>;
    if (typeof r['op'] === 'string' && typeof r['link'] === 'string') out.add(r['link']);
    // std-rh (CR 702.167c, 607.2a): a move that `remember`s objects in the link store of what it puts onto the battlefield (craft's "the exiled cards used to craft it")
    const rem = r['remember'];
    if (typeof rem === 'object' && rem !== null && typeof (rem as Record<string, unknown>)['link'] === 'string') out.add((rem as Record<string, string>)['link']!);
    Object.values(r).forEach((y) => stepLinks(y, out));
  }
  return out;
};
installKeywordLinks(keywordRegistry.all().filter((d) => d.status === 'implemented' && d.expand !== undefined).map((d) => [d.name, [...stepLinks(d.expand, new Set())]] as const).filter(([, l]) => l.length > 0));

// M6-5a (m6 design 3.8): the keywords whose expansion is an additional or alternative cost (kicker, buyback, evoke, ...). The cast path reads those costs from
// the printed card only, so the walker marks such a keyword GRANTED to another object `feature:castCost.granted` (unregistered). INTERFACE CHANGE (cap-walk.ts).
const isCastStatic = (e: unknown): boolean => typeof e === 'object' && e !== null && Object.hasOwn(CAST_STATIC_KINDS, String((e as { s?: unknown }).s));
const castStaticAbility = (a: unknown): boolean => {
  const r = (typeof a === 'object' && a !== null ? a : {}) as { kind?: unknown; effects?: unknown };
  return r.kind === 'static' && Array.isArray(r.effects) && r.effects.some(isCastStatic);
};
installCastCostKeywords(keywordRegistry.all().filter((d) => ((d.expand ?? []) as unknown[]).some(castStaticAbility)).map((d) => d.name));
// M6-12: the parameters an expansion keyword's instance must carry (an instance without one can't be expanded: model/cap-walk.ts#installKeywordParams)
installKeywordParams(new Map(keywordRegistry.all().filter((d) => d.expand !== undefined).map((d) => [d.name, d.params.filter((p) => p.optional !== true).map((p) => p.name)] as const)));

/** Walk an ability and list the capabilities it needs (design 5.2; the walker is model/cap-walk.ts, which does not import the engine). Sorted, no duplicates. */
export const capabilitiesOf: CapabilitiesOf = (def) => capabilitiesOfDef(def);

/** Capabilities of `def` that `caps` lacks. */
export const missingCapabilities: MissingCapabilities = (def, caps) => capabilitiesOfDef(def).filter((c) => !caps.has(c));

const keys = (table: object): string[] => Object.keys(table);

/** Build the engine's capability set from its own tables (design 5.2). Pure; `ENGINE_CAPABILITIES` is one call of it. */
export function buildEngineCapabilities(): Set<string> {
  const caps = new Set<string>();
  const add = (prefix: string, names: Iterable<string>): void => {
    for (const n of names) caps.add(`${prefix}:${n}`);
  };
  add('op', keys(OP_HANDLERS).filter((op) => Object.hasOwn(RENDERERS, op))); // an op is a capability only when it can also be rendered back to English
  // M6-3 INTERFACE CHANGE (m6 design 2.6, 7): the `changeFace` forms other than plain transform are capabilities once their entry exists in CHANGE_FACE
  // (faceUp/faceDown/manifest: M6-3, effects/handlers/face-ops.ts; convert/flip/delayedSelf: M6-4); the walker names them `op:changeFace.<form>` (cap-walk.ts)
  if (Object.hasOwn(OP_HANDLERS, 'changeFace') && Object.hasOwn(RENDERERS, 'changeFace')) add('op', keys(CHANGE_FACE).filter((f) => f !== 'transform').map((f) => `changeFace.${f}`));
  add('cost', [...keys(COST_PART_IMPLS), ...COST_FORMS]); // kinds, then their value forms (model/forms.ts)
  add('ev', keys(EVENT_MATCHERS));
  add('cond', keys(COND_EVALUATORS));
  add('q', keys(QTY_EVALUATORS));
  add('ref', keys(REF_RESOLVERS));
  add('feature', REF_FEATURES); // audit-fix-1: `which` of a bound reference (effects/refs.ts#resolveObjs)
  add('dur', keys(DUR_EVALUATORS));
  add('filter', SUPPORTED_FILTER_FIELDS);
  add('target', keys(TARGET_KINDS));
  add('static', [...keys(STATIC_KINDS), ...keys(REPLACE_STATIC_KINDS)]); // the layer system's kinds, and the replacement effects the proposal pipeline runs (WP11)
  add('static', keys(CAST_STATIC_KINDS)); // M6-5a (m6 design 3.8): additional and alternative costs, read by the cast path (CR 118.8-118.9, 601.2b)
  // What the layer system itself can evaluate INSIDE a static ability or a resolved continuous effect (statics/match.ts evaluates over the characteristics computed
  // so far, not through rules/filter.ts): a filter field, quantity, condition or reference there needs the `s...` capability, so a field only the general tables know
  // (history, events, variables) cannot make a static ability look automated while the layers never match it.
  // M6-0 (m6 design 2.6): the four status fields only once a package's mechanism sets them (rules/registries.ts#FILTER_PARTS), like `filter:`
  add('sfilter', STATIC_FILTER_FIELDS);
  add('sfilter', [...STATIC_STATUS_FIELDS].filter((f) => (FILTER_STATUS_FIELDS as readonly string[]).includes(f) && FILTER_PARTS.some((p) => (p as readonly string[]).includes(f))));
  add('sq', STATIC_QUANTITY_KINDS);
  add('scond', STATIC_CONDITION_KINDS);
  add('sref', STATIC_OBJREF_KINDS);
  add('body', keys(REPLACEMENT_BODIES));
  // T20 (FAST4) INTERFACE CHANGE: the counter kinds with rules beyond the engine core whose rules run (model/cap-walk.ts#counterForms; CR 122.1d stun)
  add('counter', RULED_COUNTER_KINDS);
  add('counter', FINALITY_COUNTER_KINDS); // FAST5X E13: CR 122.1h, a rule replacement of the proposal pipeline (effects/rule-replacements/finality.ts)
  add('counter', HONE_COUNTER_KINDS); // std-ra: CR 122.1, 613.4c, a rule-generated layer 7c effect of the layer system (statics/hone.ts)
  add('counter', RAD_COUNTER_KINDS); // std-rx17: CR 728.1, the inherent trigger of the precombat main phase (core/rad.ts)
  add('counter', SHIELD_COUNTER_KINDS); // FAST5X E28: CR 122.1c, a rule replacement and prevention of the proposal pipeline (effects/rule-replacements/shield.ts)
  add('layer', keys(LAYER_TABLE));
  add('decision', DECISION_KINDS);
  for (const name of keys(RULE_HOOK_ACTIONS)) caps.add(name); // already `rule:`, `permit:` or `rulemod:` prefixed
  add('feature', [...ANNOUNCE_FEATURES, ...MANUAL_FEATURES, ...PROPOSE_FEATURES, ...LAYER_FEATURES, ...MATCH_FEATURES, ...NORMALIZE_FEATURES, ...CARDS_FEATURES]);
  add('feature', QTY_FEATURES); // FAST5X E19: the spell whose mana spent `spellManaSpent.of` reads (CR 601.2h)
  add('feature', CAST_COST_FEATURES); // M6-5 (m6 design 3.8): the choice between grouped additional costs (CR 601.2b), actions/cast-kinds.ts
  add('feature', NATIVE_ACTION_FEATURES); // WP32 INTERFACE CHANGE: the native keyword actions (cascade, discover, vote) that keywords/needs.ts#actionNeeds asks for
  // M6-0 (m6 design D2): `feature:replace.on.<ev>[.<verb>]` for the event kinds the proposal pipeline translates (effects/registries.ts#PROPOSAL_KINDS)
  for (const name of REPLACE_ON_CAPABILITIES) caps.add(name);
  // M6-2 INTERFACE CHANGE (m6 design 7, `OP_FORMS`): the value forms of the copy op its handler runs (op:copy.except, op:copy.permanentSpell)
  for (const name of COPY_OP_FORMS) caps.add(name);
  // M6-12 INTERFACE CHANGE (m6 design 7, `OP_FORMS`): "cast it by paying [cost] rather than paying its mana cost" (op:cast.costChange, madness CR 702.35a-b)
  if (Object.hasOwn(OP_HANDLERS, 'cast')) for (const name of CAST_OP_FORMS) caps.add(name);
  // M6-12 INTERFACE CHANGE (m6 design 7): "that ability triggers an additional time" for the reviewed causes (triggers/collect.ts, CR 603.2d)
  for (const name of TRIGGER_MOD_CAPABILITIES) caps.add(name);
  // M6-4 INTERFACE CHANGE (m6 design 7, `OP_FORMS`): "it becomes day / night" (op:designate.day|night) acts on daybound and nightbound permanents (core/day-night.ts)
  if (Object.hasOwn(OP_HANDLERS, 'designate')) for (const name of DAY_NIGHT_OP_FORMS) caps.add(name);
  // std-cardcopy-1 (m6 design 7, `OP_FORMS`): "repeat this process" with no count (op:repeat.again, effects/handlers/control.ts)
  if (Object.hasOwn(OP_HANDLERS, 'repeat')) for (const name of FLOW_OP_FORMS) caps.add(name);
  // p2-coinflip-1 (m6 design 7, `OP_FORMS`): "flip a coin until you lose a flip" (op:flipCoin.untilLose, effects/handlers/game.ts); p2-coinflip-3: called flips (op:flipCoin.called)
  if (Object.hasOwn(OP_HANDLERS, 'flipCoin')) for (const name of GAME_OP_FORMS) caps.add(name);
  // FAST5X E16: a reflexive trigger that waits for a result of the step ("When excess damage is dealt to ... this way", CR 603.12, 120.10)
  if (Object.hasOwn(OP_HANDLERS, 'reflexive')) caps.add('op:reflexive.if');
  // FAST5X-4: "your speed increases by N" (CR 702.179c), with speed's state-based action and inherent ability in core/designations.ts
  if (Object.hasOwn(OP_HANDLERS, 'designate')) caps.add('op:designate.speed');
  if (Object.hasOwn(OP_HANDLERS, 'designate')) caps.add('op:designate.speed.reduce'); // std-control-1 (CR 702.179): core/designations.ts#reduceSpeed
  // MX4 INTERFACE CHANGE (`OP_FORMS`): "take the initiative" (op:designate.initiative): its inherent abilities venture into Undercity (core/designations.ts, CR 726.2)
  if (Object.hasOwn(OP_HANDLERS, 'designate')) for (const name of INITIATIVE_OP_FORMS) caps.add(name);
  if (Object.hasOwn(OP_HANDLERS, 'designate')) for (const name of CITYS_BLESSING_OP_FORMS) caps.add(name); // CMD3: ascend (CR 702.131a)
  // M6-6 INTERFACE CHANGE (m6 design 3.7, 7): the layout structures (Saga chapters, Class levels, leveler brackets, Cases: statics/levels.ts and their call-sites)
  // and the designations the `designateObject` op sets (effects/handlers/levels.ts#OP_FORMS)
  add('feature', LEVELS_FEATURES);
  for (const name of LEVELS_OP_FORMS) caps.add(name);
  // FAST4 MX1 INTERFACE CHANGE (`OP_FORMS`): "exile ... until ~ leaves the battlefield" (op:move.until, CR 610.3; effects/handlers/zones-move.ts, core/durations.ts)
  if (Object.hasOwn(OP_HANDLERS, 'move')) for (const name of MOVE_OP_FORMS) caps.add(name);
  if (Object.hasOwn(OP_HANDLERS, 'removeCounters')) for (const name of COUNTERS_OP_FORMS) caps.add(name); // FAST4 T31: "remove up to N counters"
  if (Object.hasOwn(OP_HANDLERS, 'pay')) for (const name of PAY_OP_FORMS) caps.add(name); // std-rx24: an exile cost's link (CR 607.2k)
  if (Object.hasOwn(OP_HANDLERS, 'search')) for (const name of SEARCH_OP_FORMS) caps.add(name); // FAST5 T42: "... cards with different names"
  if (Object.hasOwn(OP_HANDLERS, 'sacrificeChoice')) for (const name of SACRIFICE_OP_FORMS) caps.add(name); // FAST5 T66: "chooses a permanent of each permanent type and sacrifices the rest"
  if (Object.hasOwn(OP_HANDLERS, 'exileUntil')) for (const name of EXILE_UNTIL_OP_FORMS) caps.add(name); // std-rx31: "until you exile cards with total mana value N or greater"
  if (Object.hasOwn(OP_HANDLERS, 'chooseObjects')) for (const name of CHOOSE_OP_FORMS) caps.add(name); // FAST5 T66: "up to two creature cards with total mana value 4 or less"
  if (Object.hasOwn(OP_HANDLERS, 'addMana')) for (const name of MANA_OP_FORMS) caps.add(name); // FAST5 MX6: firebending's mana lasts until end of combat
  if (Object.hasOwn(OP_HANDLERS, 'discard')) for (const name of DISCARD_OP_FORMS) caps.add(name); // C6: "each opponent who can't" (the players who could not discard, CR 101.3)
  if (Object.hasOwn(OP_HANDLERS, 'loseLife')) for (const name of LIFE_OP_FORMS) caps.add(name);
  if (Object.hasOwn(OP_HANDLERS, 'fromOutside')) for (const name of OUTSIDE_OP_FORMS) caps.add(name); // std-rx30: another player's choice among cards revealed from outside the game // std-rx30: an amount read for each player of the group (CR 608.2e)
  // FAST4 MX1 INTERFACE CHANGE: opening-hand actions (CR 103.6a), run by core/pregame.ts after the mulligans (`static:pregame`, `feature:pregame.beginOnBattlefield`)
  add('static', keys(PREGAME_STATIC_KINDS));
  add('feature', PREGAME_FEATURES);
  // M11-0 INTERFACE CHANGE (m11 design 4.6): the Commander features M11-1 runs (core/commander.ts#COMMANDER_FEATURES; empty in M11-0)
  add('feature', COMMANDER_FEATURES);
  add('static', COMMANDER_STATIC_KINDS); // CMDF: "~ can be your commander", a deck-construction ability with no in-game effect (CR 113.6n, 903.3a)
  // MX2 INTERFACE CHANGE: layer-2 control runs (the stored controller is the controller after layer 2, core/control.ts; CR 613.1b), and with it the exchange of
  // control (op:exchange.control, CR 701.12b, effects/handlers/zones-status.ts)
  add('feature', CONTROL_FEATURES);
  if (Object.hasOwn(OP_HANDLERS, 'exchange')) for (const name of CONTROL_OP_FORMS) caps.add(name);
  // MX2 INTERFACE CHANGE: a granted keyword's quality read from the linked color choice ("protection from the chosen color", CR 607.2d, statics/mods.ts)
  add('feature', CHOSEN_QUALITY_FEATURES);
  // MX2 INTERFACE CHANGE: a resolved copy effect "except it has this ability" (CR 707.9a, effects/handlers/lasting.ts)
  add('feature', COPY_THIS_ABILITY_FEATURES);
  // FAST5 T64 INTERFACE CHANGE: a copy effect that picks one of several objects ("a creature card exiled with it", effects/copy.ts)
  add('feature', COPY_CHOOSE_FEATURES);
  // CLOUD std-tmt INTERFACE CHANGE (`OP_FORMS`): the objects a group's control change locked are bound to the step's `as` ("Untap them", CR 611.2c, 608.2c)
  if (Object.hasOwn(OP_HANDLERS, 'effect')) for (const name of EFFECT_OP_FORMS) caps.add(name);
  add('feature', TOKEN_FEATURES); // cmd1: tokens created attacking a named player (effects/handlers/tokens-create.ts, CR 508.4)
  // p2-pt-1 INTERFACE CHANGE: the exchange of a player's life total and a creature's toughness (op:exchange.lifeToughness, CR 701.12a, 613.4b; effects/handlers/zones-status.ts)
  if (Object.hasOwn(OP_HANDLERS, 'exchange')) for (const name of LIFE_TOUGHNESS_OP_FORMS) caps.add(name);
  // Last, because a keyword is advertised only when the capabilities its expansion needs exist (keywords/needs.ts), and a predefined token only when its own
  // abilities run (WP14 review). They read each other (a Vibranium token has indestructible; investigate creates a Clue), so they are added until nothing changes.
  for (let size = -1; size !== caps.size;) {
    size = caps.size;
    for (const name of keywordCapabilities(keywordRegistry, caps)) caps.add(name); // `keyword:` (only those whose expansion the capabilities above can run) and `action:`
    for (const name of predefinedTokenCapabilities(caps)) caps.add(name); // `feature:token.<name>`
  }
  return caps;
}

// ---- predefined tokens (WP14 review, INTERFACE CHANGE of this WP0 file) --------------------------------------------------------------------------------

/** The abilities of the predefined tokens (CR 111.10, effects/predefined-tokens.json) that fail the exact render gate (design 6.8): they are not automated. */
const PREDEFINED_GATE_FAILURES: ReadonlySet<AbilityDef> = new Set(
  PREDEFINED_TOKENS.flatMap((t) => t.faces.flatMap((f) => (f.abilities as AbilityDef[]).filter((a) => a.kind !== 'manual'
    && !renderGate(a, a.text.split('\n'), { selfNames: [f.name, 'this token'], selfTypes: [...f.types, ...f.subtypes] }).ok))),
);

/** Is this ability of a predefined token automated by an engine with `caps`? (Not manual, through the render gate, every capability present.) */
const tokenAbilityRuns = (a: AbilityDef, caps: ReadonlySet<string>): boolean =>
  a.kind !== 'manual' && !PREDEFINED_GATE_FAILURES.has(a) && capabilitiesOfDef(a).every((c) => caps.has(c));

/**
 * `feature:token.<name>` for each predefined token every ability of which runs (model/cap-walk.ts#predefinedTokenCapability): the walker gives "create a Food
 * token" that capability, so a card is not classified automated while the token it makes is not (design 5.2: built from the tables, never hand-kept).
 */
function predefinedTokenCapabilities(caps: ReadonlySet<string>): string[] {
  return PREDEFINED_TOKENS.filter((t) => t.faces.every((f) => (f.abilities as AbilityDef[]).every((a) => tokenAbilityRuns(a, caps)))).map((t) => predefinedTokenCapability(t.name));
}

/** What this engine build can do. Rebuilt from the tables at import time; a work package adds a table entry and the capability appears. */
export const ENGINE_CAPABILITIES: CapabilitySet = buildEngineCapabilities();

const NO_LINES = { lines: [], sentences: [] };

/**
 * The classification of a token definition (design 10.3), installed into effects/handlers/token-defs.ts (the interpreter may not import the model, design 5.4):
 * `classifyCard` over ENGINE_CAPABILITIES, with a predefined ability that fails the render gate counted as manual ("gate-mismatch", design 6.8).
 */
installTokenClassifier((faces) => {
  const gated = (a: AbilityDef): AbilityDef => (PREDEFINED_GATE_FAILURES.has(a) ? { kind: 'manual', text: a.text, reason: 'gate-mismatch', shape: 'unknown' } : a);
  return classifyCard({ faces: faces.map((f) => ({ abilities: f.abilities.map(gated), lines: NO_LINES })), source: 'templates' }, ENGINE_CAPABILITIES);
});
