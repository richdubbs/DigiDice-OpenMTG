# OpenMTG architecture

Read this before changing the engine. It records the design decisions every module relies on.

## Packages

| Package | Runs in | Depends on | Purpose |
|---|---|---|---|
| `@openmtg/engine` | anywhere (pure TS) | nothing | Rules engine, ability model, keyword library, Oracle-text parser |
| `@openmtg/cards` | Node | engine (types, compiler) | Scryfall client, bulk-data cache, name lookup, decklists, coverage report, LLM compile tool |
| `@openmtg/ai` | anywhere (pure TS) | engine | Heuristic AI opponent: answers every decision from `viewFor(state, botPlayer)` and `legalActions` |
| `@openmtg/client` | browser | engine, ai (server API types only from server) | React UI: decks, images, hot-seat play and play against the computer (the AI runs in the browser, on its own player's view) |
| `@openmtg/server` | Node, on the player's machine (127.0.0.1 only) | engine, cards | Serves the built client and the local JSON API over the card cache (`/api/cards/...`, `/api/decks/...`, `/api/images/match`, `/api/update`: the Update button); docs/design/m8-client.md |
| `@openmtg/net` | Node | engine | Online two-player play over UDP, host-authoritative (`GameHost`/`GameGuest`) |

**Deviation from the two-package default:** card data lives in a third package, `@openmtg/cards`,
because it needs Node APIs (file system, network) that must never enter the engine, and the
browser client cannot read the local cache directly. The local server (`@openmtg/server`, not
Vite middleware: the same process serves the production build and, in milestone 9, the online
link) exposes the card tool over a local HTTP API on the user's own machine; in development Vite
proxies `/api` to it.

Packages are consumed from source (`main: src/index.ts`); no build step between packages. Vitest,
Vite and tsx all compile TypeScript on the fly. `npm test` runs every package's tests.

## Engine principles

1. **Pure and deterministic.** `applyAction(state, action) -> { state, events, error? }`. The
   input state is never mutated. The RNG (sfc32) lives in the state. Never use `Math.random`,
   `Date`, or iteration over anything with unspecified order. Same seed + same actions = same game.
2. **Plain data.** `GameState` is JSON: no classes, Maps, Sets, functions or `undefined`-sensitive
   logic. Card definitions are embedded in `state.defs`, so a state is self-contained (replay, save files, a future
   authoritative server). **Structural sharing (milestone 4):** every action runs on `cloneState(state)`
   (`util/clone.ts`), which deep-clones what the engine edits in place (objects, players, zones, combat, counters...) and
   *shares* the parts that are immutable once written: `defs` (a `CardDef` is never mutated in place; the definitions are
   deep-frozen when a game is created, and `Game.addDef` shallow-copies the map before adding a token definition),
   the append-only `log` (only the array is copied, entries are shared and never edited), `lki` (entries are written once, when an object
   leaves a zone) and `suspended`. So: never edit a `CardDef`, a log entry or an LKI entry; add tokens through `createToken` (or `g.addDef`).
3. **One entry point.** All player input is an `Action` (`types/actions.ts`). Exactly one
   `Decision` is pending at any time (`state.pending`), including priority. UIs and bots look at
   `pending` and answer it.
4. **Illegal actions are rejected, never half-applied** (CR 733). `applyAction` returns the
   unchanged state plus `error: { message, rules }`.
5. **Rules citations everywhere.** Code comments and log lines cite rule numbers ("CR 704.5g").
   Log entries carry `rules: string[]`.

## The decision model (re-execution)

Engine code is plain imperative code that mutates `g.s`, a private clone. When a player must
decide something mid-action it calls:

```ts
const ans = g.choose({ kind: 'chooseObjects', player, prompt, options, min: 1, max: 1, rules: ['CR 701.9'] });
```

- If the answer was already supplied, `choose` validates and returns it.
- Otherwise it throws `NeedDecision`. `run()` catches it and returns the partially-advanced state
  (for display) with `pending` = the decision and `suspended = { base, action, answers }`.
- When the player answers, `run(base, action, [...answers, newAnswer])` re-executes the action from
  the settled base state. Determinism guarantees it reaches the same point and continues.
- `cancel` (only when `pending.cancellable`) returns the base state: the whole action is reversed
  (CR 733.1). Used while casting spells and activating abilities.

Rules for engine code that follow from this:

- Everything between two settled states must be deterministic, including decision ids and object
  ids (they come from counters in the state).
- No data outside the state may influence a result. The only exception is pure memoization:
  a process-wide memo of a deterministic function, keyed by exactly everything it reads (by
  identity for immutable inputs such as the frozen `defs` map, by value snapshot otherwise), with
  frozen results and a bounded size, listed here and covered by a cached-vs-uncached test.
  Current memos (P1, accepted 2026-10-12): `rules/characteristics.ts` `RECENT` (layered
  characteristics), `parser/parse-memo.ts`, `cards/compile-memo.ts`, `parser/chart.ts`
  `BY_CONTENT` (grammars), and WP32's `RULE_ZONES`. M6-1 (m6 design E1): `effects/replacement-index.ts`
  (the replacement effects of other objects: keyed by the `allChars` Map on the layered path, by the
  `defs` map and a snapshot of the relevant objects on the intrinsic path; indexed-versus-scanned test in
  `test/m6/replace/foreign.test.ts`). M6-8: `statics/text-change.ts` (a text change's rewrite of a frozen
  ability definition, keyed by the definition's identity, the change and the object's names; the word
  patterns per word; cached-versus-uncached test in `test/m6/text/rewrite.test.ts`).
- `g.choose` may be called anywhere (resolution, SBAs, turn-based actions, cost payment).
- Do not catch `NeedDecision` except in `core/apply.ts`.

A run ends "settled" when some player has priority (`pending.kind === 'priority'`, `suspended ===
null`) or the game is over.

## Game flow

`core/turn.ts#advance` loops: SBAs (CR 704) -> put pending triggers on the stack (CR 603.3) ->
give priority (with Arena-style auto-pass) -> on all-pass resolve the top of the stack or end the
step (CR 117.4) -> next step with its turn-based actions (CR 703).

Auto-pass (`shouldAutoPass`, smart auto-pass of package AP1; it replaced
FAST1's M2 rule, which read no hand): a player without `stops.fullControl` or `stops.holdPriority` is
passed automatically if the top of the stack is their own object, if the stack is empty and the step
is not one of their stops, or if they can do nothing but pass and use mana abilities
(`hasPriorityActions`: their real legal actions, hand included, with the costs they can pay; mana
abilities and the by-hand tools don't count). So a player with two untapped lands and no instant
is passed for when the opponent casts a spell, and one who could respond decides. OpenMTG accepts
that the other players may infer "no response" from it (the M2 concern, CR 400.2). An automatic pass
with something on the stack is logged like a manual one ("Bob passes."). `stops.holdPriority` is the
temporary "hold priority" toggle (client: next to Pass, key H): while on, the player gets every
priority, also right after their own spell or ability (CR 117.3c); `beginNextTurn` clears it.
Tests usually set `fullControl: true`.

## Objects and zones

- Every card, token, spell copy, ability on the stack and emblem is a `GameObject` in
  `state.objects`. Zones hold ordered id arrays (`library[0]` = top; `stack`/`graveyard` last =
  top).
- **CR 400.7:** moving zones creates a new object with a new id (`core/zones.ts#moveObject`). The old
  object's last known information is stored in `state.lki[oldId]` (CR 608.2h, 603.10) with
  `newId` linking to the new object. `cardId` is the stable physical-card identity.
- Library, hand and graveyard are always the owner's (CR 400.3), so `obj.zone` + `obj.owner`
  locate any object.

## Combat, damage and state-based actions (milestone 4)

- **Combat state** (`GameState.combat`, created at the beginning of combat, discarded at the end of the end of combat step, CR 511.3):
  attackers (`defender`: the player, planeswalker or battle; `null` once that planeswalker/battle left combat, CR 506.4c;
  `defendingPlayer`; `blockedBy`; `blocked`, which survives the blockers leaving, CR 509.1h) and blockers. `moveObject` removes an object that
  leaves the battlefield from combat (`rules/combat-state.ts#removeFromCombat`); the state-based action check also drops creatures that changed
  controller or stopped being creatures (CR 506.4).
- **Turn-based actions** (`core/steps.ts` calls them): `core/combat.ts` (beginning of combat, declare attackers, declare blockers) and
  `core/combat-damage.ts`. Legality is pure and lives in `rules/combat-rules.ts` (`attackCandidates`, `blockCandidates`, `blocksDenial`): the decisions
  offer only legal choices, and a declaration that is illegal as a whole (menace needs two blockers) is rejected by `blocksDenial` after the answer
  with an `IllegalAction`, leaving the decision open. No decision is created when there is nothing to choose (no creature can attack or block).
- **Requirements** (milestone 6: M6-7a, M6-7; CR 508.1d, 509.1c). "Attacks/blocks each combat if able", "must be blocked if able", "target creature blocks ~ this
  turn if able" and Lure are `RestrictionDef`s with `mode: 'mustIfAble'` (`other` names the other creature), collected from functioning static abilities and
  resolved effects (`statics/requirements.ts`, the same sources as the restrictions). A declaration that obeys every restriction is legal only if it obeys as
  many requirements as the best declaration could (`rules/requirements.ts`): an exact search over the creatures that have requirements, with a node budget;
  requirements that need a cost don't count. When the maximum can't be known (the budget is exceeded, a requirement can't be evaluated, or manual text that
  mentions attacking or blocking is in play, `rules/requirements-manual.ts`) the declaration is accepted and the players are told so: never a wrong rejection.
  The declare decisions carry `requirements` (and `mustAttack`) so a client can pre-select and hint them.
- **Combat damage steps.** There is one `combatDamage` step in `STEP_ORDER`; when a creature has first strike or double strike the step happens twice
  (`combat.damageSteps`, `combat.extraDamageStep`, `combat.firstStrikers`, CR 510.4) and players get priority after each. `combat.attacked` records that
  attackers were declared (CR 508.8), so the declare blockers and damage steps happen even if every attacker has died.
- **Damage assignment.** This edition of the rules has no damage assignment order: a creature with several blockers divides its damage freely
  (CR 510.1c-d). The `assignDamage` decision is created only when there is a real choice; `recipients[].lethal` is what counts as lethal for trample
  (marked damage and damage assigned by other creatures in the same step are included, deathtouch makes it 1) and `trampleTarget` marks what the
  attacker attacks, which may only get damage once every other recipient has its lethal amount (CR 702.19b, validated in `core/validate.ts`).
- **`rules/damage.ts#dealDamage`** is the only way damage is dealt (combat or not). Source characteristics come from last known information if the source
  left (CR 702.2e...); protection prevents (CR 702.16e); results follow CR 120.3 (life or poison, loyalty, defense, -1/-1 counters or marked damage); lifelink
  and toxic are applied there. Since milestone 5 every damage event first goes through the proposal pipeline (see "Abilities are data"), so prevention shields
  and a permanent's own prevention effects apply before the results (CR 120.4, 615); manual `damage` operations go through it too.
- **Life and restrictions.** `rules/life.ts` (`gainLife`, `loseLife`, `payLife`, `givePoison`); "can't gain/lose life" and "can't lose/win the game" are
  player restrictions stored as continuous effects (`rules/restrictions.ts`), checked by the life helpers and by `core/sba.ts` (`loseGame`, `winGame`,
  `drawGame`, `concedeGame`; concession and "the last player remaining wins" ignore restrictions, CR 104.3a, 104.2a).
- **State-based actions.** `core/sba.ts` checks players (704.5a-c), `core/sba-objects.ts` everything else (704.5d-q, v-z): one call determines every
  applicable action from the current state, performs them as one event, and `advance` repeats the check until nothing happens. The legend rule is the one
  place a player decides (a `chooseObjects` decision made before anything is performed). Destruction goes through `rules/destroy.ts#destroy`, which honors
  indestructible and regeneration shields (resolved replacement effects `{s: "replace", body: {b: "regeneration"}, shield}`, `addRegenerationShield`); toughness 0, the legend rule,
  Auras and the like put permanents into the graveyard without destroying them.
- **Auras and attachments.** An Aura spell has the target its `enchant` keyword defines (`rules/attachment.ts#auraTargetProgram`, added by `spellPrograms`) and enters
  attached to it (CR 303.4f). `GameObject.attachedTo` holds an object or a player id; `rules/attachment.ts` decides legality for 704.5m/n/p. Since milestone 5
  Equip is a keyword of the keyword library and the `attach` op attaches; the manual `attach` operation and the manual `move` operation with `attachTo` remain for text that is not automated.
- **Power and toughness.** `getChars` applies the layers (7a-7d, CR 613.4), counters included (layer 7c). A printed "*" that no characteristic-defining
  ability sets is not evaluated (`ptNumbers` returns `null`: the creature is never judged by toughness and assigns no combat damage; the log says so).

## Keywords

Rules code reads keyword abilities through `getChars(...).keywords` / `hasKeyword`, never from Oracle text. Since milestone 5 the keyword library
(`keywords/`, see "Abilities are data") defines every CR 702 keyword once; milestone 4's line recognizer (`cards/keywords.ts`) survives only as one of the native
recognizers of `cards/native.ts`, the lowest source of the compile pipeline. Qualities of protection and hexproof are canonical strings (`rules/quality.ts`:
`color:R`, `type:Artifact`, `subtype:goblins`, `multicolored`, `everything`; a subtype must be in the lexicon, G2). Ability keys are `p:<face>:<index>` in printed order.

## Characteristics and continuous effects

Never read characteristics (types, P/T, abilities, colors, controller...) from `state.defs`
directly in rules code. Use the characteristics function (`rules/characteristics.ts`), which starts
from the face definition (current face, face-down status) and applies continuous
effects in layer order (CR 613) with timestamps and dependencies. Static abilities generate their
effects during this computation (CR 604, 611.3); resolved effects are stored in
`state.continuousEffects` with their affected set locked in where CR 611.2c requires.

- `getChars(state, id)` / `charsOfObject` call `statics/layers.ts#computeAll` (milestone 5, design 9.2) whenever the state has a layer source: layers 4 (type),
  5 (color), 6 (abilities, including keyword-generated and granted ones), 7a-7d (P/T: characteristic-defining abilities, setting, modifying incl. counters,
  switching), with CR 613.3-613.4 sublayers, timestamps (613.7) and dependency (613.8, `statics/layers.ts#dependsOn`). Layer 2 (control, MX2): the
  stored `GameObject.controller` of a permanent or spell IS the controller after layer 2. The layers start from `baseController` (present only while a
  control-changing effect gives the object another controller), and `core/control.ts#syncControl` writes their answer back after every performed event,
  first in each state-based action check, when a resolved effect begins and when effects end; a permanent whose controller changes is removed from combat
  (CR 506.4) and is under its new controller only since that turn (CR 302.6). So every call-site that reads the stored controller (attackers, blockers,
  activations, the untap step, the legend rule) sees the current one, and `feature:control.layered` and `op:exchange.control` (CR 701.12b) are advertised.
  Layers 1a, 1b and 3 are milestone 6 (below).
- **Layer 1a, copy effects** (milestone 6, M6-2; CR 707, 613.2a-c; `statics/copy.ts`). The copiable values of an object are ALL of layer 1 (`copiableValuesOf`):
  its own face (a flip card's half chosen by the affected object's flip status), its 1a effects in 1a order (copy effects, merges, "as ... enters" P/T
  records), then for a face-down permanent or spell its face-down profile, never the hidden card. A copy effect stores a snapshot when it begins
  (`ContinuousEffectRec.copy`: a definition reference plus concrete exceptions, CR 707.9: `retain` materialized from the copy's own values, conditional
  exceptions judged then, the copied characteristic-defining abilities an exception overrides dropped), so the original can change or leave afterwards. The
  1a applier replaces the characteristics with the snapshot; copied abilities are keyed `c:<effectId>:<face>:<index>` with `AbilityRef.source: 'copied'` and
  their links in the copy effect's namespace (E5, E20). "Enters as a copy" is the `enters.copy` part of the entering pipeline (`effects/enters-parts/copy.ts`,
  applied first, CR 616.1c), its additional effects (`additional`, CR 707.9e) only if no later copy effect replaces it; token copies get their own definition
  (`effects/handlers/tokens-copy.ts`, double-faced for a double-faced original, CR 707.8a). Views carry every snapshot's definition (`core/view-parts/copy-defs.ts`).
- **Layer 1b, face-down** (M6-3; CR 708, 613.2b; `statics/face-down.ts`). A face-down permanent or spell gets one rule-generated 1b effect, after layer 1a
  (CR 708.10): its characteristics are the profile of its pseudo-definition (a 2/2 with no name, color, subtypes, mana cost or abilities; `ward2` adds ward
  {2} for disguise and cloak). On the fast path (no layer source in the state) `intrinsicChars` applies the same profile through an `INTRINSIC_PARTS` entry, so
  a face-down object is never shown with its real characteristics. A card exiled face down has no characteristics at all (CR 406.3a,
  `rules/base-parts/face-down.ts`). Turning face up or down (`rules/face-down.ts`) gives a new timestamp (CR 613.7f); the turn-face-up special action pays the
  cost the permanent would have face up, its 1a effects included (CR 702.37e, 707.3).
- **Layer 3, text change** (M6-8; CR 612, 613.1c; `statics/text-change.ts`). A text-changing effect is a pure rewrite of the typed positions of ability JSON
  where a color word, basic land type or creature type is used as such (filters, tokens, layer 4/5 changes, qualities of protection and landwalk, choices),
  never of mana symbols or names (CR 612.2). Every ability that is rules text of the object is rewritten: printed, its keywords' expansions, copied and
  merged-component abilities; abilities granted by layer 6 and rule-generated ones are not (CR 612.3).
- **Merged permanents** (M6-9; CR 730, 702.140; `statics/merge.ts`) and **melded permanents** (M6-4; CR 712.4) are one object with `GameObject.components`:
  a merged object's characteristics come from a rule-generated 1a effect of its topmost component plus the abilities of all components; leaving the
  battlefield is ONE proposed event whose chosen replacement applies to every component (CR 712.21d, 730.3d).
- **Other layout structures** (M6-6; `statics/levels.ts`): Saga lore counters (rule-generated "enters with" abilities, CR 714.3a-b; the precombat main lore
  counter, `core/lore.ts`, CR 714.3c), Class levels (CR 716), leveler brackets (CR 711), Cases (CR 719), prototype (alternative characteristics as a cast
  choice, CR 718) and prepare (a designation whose castable exile copy persists while the permanent is prepared, CR 722.3c) are ordinary abilities and
  designations; double-faced cards, convert, flip, day and night are M6-4 (`core/day-night.ts`, the transform proposal with `during`, CR 701.27, 712).
- The result of `computeAll` is cached per distinct state (`allChars`, keyed by the state object and a fingerprint of the fields the layers read;
  `readingStable` checks the cache once for a caller that reads many objects of an unchanged state). Across actions only the pure memos listed under the decision model rules are kept.
- Filters (`rules/filter.ts`) read an ability on the stack as an object with no card type, color, mana value or P/T (glossary "Card Type").
- An object about to enter the battlefield is judged "as it would exist on the battlefield" (CR 614.12, 614.17d): `statics/hooks.ts#onBattlefield` builds that
  hypothetical state for "can't enter" checks and for the object's own replacement effects (`effects/replacements.ts`).

## Rule checks, legal actions and costs (milestone 3)

- **Rule checks are pure and return `Denial | null`** (`rules/denial.ts`: a message plus CR citations). The same check
  serves the action handler (`assertAllowed` throws `IllegalAction`, so the whole action is reversed, CR 733.1) and
  `legalActions` (which just filters). Examples: `castCheck`, `landCheck`, `activationDenial`, `manaAbilityDenial`, `planDenial`.
  New rules that restrict an action belong in the check, never only in the handler, or `legalActions` would list illegal actions.
- **`legalActions(state, player)`** lists every priority action (`LegalAction.action` can be passed to `applyAction` as it is).
  Contract: every listed action is accepted; an action that is not listed is rejected (the soak test checks both for
  lands and spells). Mana abilities are listed with `isMana: true` and never count as "something to do" for auto-pass.
- **Ability keys** (`rules/abilities.ts`) are stable: `p:<face>:<index>` for printed abilities, `r:basic:<W|U|B|R|G>` for the
  intrinsic mana ability of a basic land type (CR 305.6). `activate` actions and `payCost` answers refer to them.
- **Costs.** A `CostPlan` (`rules/cost.ts`) is the total cost once X, additional and alternative costs are fixed (CR 601.2f).
  `rules/pay.ts#payPlan` pays in the order of CR 601.2g-h: the tap costs first (those permanents can't make mana any more), then the mana through one
  cancellable `payCost` decision (so a creature can be tapped for mana and then sacrificed as a cost), then the other parts in order (loyalty, life,
  sacrifice, discard, exile, return to hand; choices are cancellable `chooseObjects` decisions). `rules/cost-pick.ts` decides whether the whole plan can be
  paid when its parts compete for the same permanents and offers only choices that leave a way to pay the rest. Cost modifiers
  (cost increases and reductions) plug into `applyCostModifiers` in `actions/cast.ts`.
- **Mana payment** (`rules/solver.ts`): every cost symbol becomes alternatives (hybrid, monohybrid, Phyrexian with life, snow, {C});
  atoms are matched to providers (floating mana and the units mana abilities would produce) as a minimum-cost assignment
  (Hungarian algorithm), so "can this be paid?" is exact and auto-pay keeps flexible sources (dual lands, any-color
  creatures) untapped. The auto-payer activates the chosen mana abilities (filling the pool, CR 605.3b) and then the same
  solver matches the pool against the cost. Manual payment is the same second step after the player's own activations.
  The tests cross-check the solver against an exhaustive search.
- **Casting and activating** (`actions/cast.ts`, `actions/activate.ts`) follow CR 601.2a-i / 602.2 in order, asking
  modes, kicker, X and targets through the announce helpers in `actions/announce.ts`. The cast is checked *before*
  anything moves (`castCheck` includes a payability check at X = 0), so impossible casts are rejected immediately.
- **Per-turn bookkeeping in the state:** `GameState.turnActivations` ("once each turn", loyalty abilities) and
  `PlayerState.lastTurnStarted` (summoning sickness, CR 302.6).
- **Manual resolution.** Since milestone 5 effects run through the interpreter (see "Abilities are data"). Whatever the engine cannot run (a `manual`
  ability, a manual step inside an automated one, an op without a handler) raises a non-cancellable `manualResolve` decision at the point where it is reached
  (`effects/manual.ts`, `core/manual.ts` applies the `ManualOp`s, logging each at level `manual`). A permanent or land that enters with unautomated text logs a
  `manual` warning, and one that enters with counters the engine can't work out (CR 614.1c, a variable printed loyalty) asks its controller for them before
  state-based actions. Nothing is silently skipped.
- **Ability compiler.** `compileCard(card)` is the compile pipeline of milestone 5 (`cards/pipeline.ts#compileCardV2`, see "Abilities are data").
  `compileCard(card, compiler)` with an explicit face-by-face compiler is kept for tests (`noAbilityCompiler` understands nothing; `scenario({ manual })` in the
  tests keeps a card's text manual).

## Abilities are data (milestone 5)

Card behavior is never a hand-written function per card: every card is JSON in one ability model, produced from its Oracle text, and one interpreter runs it.
The design is `docs/design/m5-ability-model.md` (section numbers below refer to it); what was built differently is recorded in the file
headers.

```
OracleCard --compile pipeline (cards/)--> CardDef { faces[].abilities: AbilityDef JSON, automation }
              pack entry > parser (templates) > native recognizers > LLM overlay ; lint, render gate, degrade, classify
CardDef --game--> announce (actions/) -> stack -> interpreter (effects/run.ts) -> op handlers -> propose (CR 614-616) -> perform -> events -> triggers
                                                    characteristics: layers (statics/) ; "may this happen?": rule hooks (rules/hookpoints.ts)
```

1. **The model** (`types/ability.ts`, design 2-3): abilities (`spell`, `activated`, `triggered`, `static`, `keyword`, `manual`) made of costs, targets, modes,
   an `EffectProgram` of steps (`op`: 57 ops such as `damage`, `move`, `createToken`, `effect`, `delay`, `reflexive`, `if`, `may`, `pay`, `manual`), references
   (`self`, `target`, `bound`, `each`, `linked`, ...), filters, quantities, conditions, durations, event patterns and static effects (`continuous` with layer
   modifications, `replace`, `restrict`, `permit`, `rule`, `costMod`). `model/` holds the JSON tooling, with no game state: schema validation
   (`model/schema.generated.json`, generated by `npm run gen:schema`), semantic lint, canonical form, stored form and `textHash`, the capability walker, the
   degrade pass and the classifier.
2. **The keyword library** (`keywords/`, design 7): one data file per keyword (`keywords/data/*.json`, 196: 52 implemented, 1 native, 143 planned) expanded
   into model JSON (`expand.ts`), hooks for keywords that change rules (`keywords/hooks/*`: flying, protection, landwalk, ...), CR 701 keyword actions as
   macros (`keywords/actions/*`; cascade, discover and vote are native in `effects/handlers/actions-native.ts`; MX4: venture into the dungeon in `effects/handlers/venture.ts` over `core/dungeons.ts`, the dungeon cards being data in `core/dungeons.json` generated by `scripts/gen-dungeons.ts`, and the initiative in `core/designations.ts`; FAST5 MX6: endure, earthbend with its implied target and its delayed return, and "empower Jace N" in `keywords/actions/bending.ts`, firebending's mana kept until end of combat by `ManaUnit.keep` and `core/steps.ts#endOfStepCleanup`; behold is an `UNREGISTERED_ACTIONS` entry with its reason; FAST5X E10: airbend is native in `effects/handlers/airbend.ts` (the exiled card is marked, `rules/airbent.ts`, and its owner casts it for {2} through the cast option `actions/cast-opt/airbend.ts`), waterbend is only a cost: a `waterbend` plan part whose generic mana is in the total cost and may be paid by tapping artifacts and creatures, chosen in `rules/pay.ts#resolveWaterbend`, checked in `rules/cost.ts#planDenial`; FAST5X E18: recruit (reminder text, connive's shape) in `keywords/actions/library.ts`, and Storied's enduring story, a player designation kept for the rest of the game, given "immediately" by `core/enduring-story.ts` (an `IMMEDIATE_CHECKS` entry; keyword data `rule: "reminder"` for a keyword newer than the CR); FAST5X E28: exert expands to the untap restriction lasting through your next untap step (as a cost, `rules/pay-parts.ts#exertForCost`), forage is native in `effects/handlers/forage.ts` (as a cost, `rules/pay-parts.ts`); shield counters are rule replacements of the proposal pipeline in `effects/rule-replacements/shield.ts` (body `shieldCounter`: destruction by an effect and damage, one counter per batch, CR 122.1c); riot's "your choice of" is the `enters` body's `choice` (CR 702.136a)) and special actions (`keywords/special/*`,
   planned stubs for milestone 6). A keyword whose status is `planned` parses and displays but stays manual with `requiresEngine: ['keyword:<name>']`.
3. **The parser** (`parser/`, design 6; pure, runs in the browser): `parseCard(card, options)` = preprocess (normalize, reminder text, `~`, labels, character
   ledger) -> segment (lines, abilities, sentences) -> tokenize -> chart parse (templates x hole grammars, `parser/chart.ts`, `parser/holes/*`) -> lower
   (targets, anaphora, riders, quantities, durations, conditions, optionality, sequencing, `parser/lower/*`) -> taint (contagion: a sentence that depends on a
   manual one is manual too). Templates are data: `parser/templates/*.json` and `parser/templates/effect/*.json` (305 templates, 245 `stable`, 60
   `experimental`), loaded by a static import (`parser/template-set.ts`, so the engine stays I/O free); the vocabulary is the generated lexicon
   (`parser/lexicon.generated.json`, `scripts/gen-lexicon.ts`). `parseCard` never throws.
   **The twelve guards** (design 6.8) keep a parse from becoming wrong behavior: G1 a unit is accepted only if one derivation consumes every token; G2 closed
   vocabulary (an unknown word fails); G3 critical words (`each`, `may`, `if`, `unless`, `instead`, ...) must be interpreted; G4 every character is in the
   ledger; G5 ambiguity is failure; G6 the exact render gate (`render/`: the JSON is rendered back to English and must equal the Oracle sentence); G7 schema and
   lint; G8 capability degrade; G9 template examples, counter-examples and near-miss mutations; G10 golden corpus and the whole-corpus snapshot (adding a
   template may change only formerly manual units); G11 run-time backstop (`manualResolve`, `EngineBug` in tests); G12 source gating (`textHash`, `forceManual`).
4. **The compile pipeline** (`cards/compile.ts`, `cards/pipeline.ts`, design 6.1, 12): per face, a rules-pack entry with a matching `textHash` wins; otherwise the
   parser; the milestone 3/4 native recognizers (`cards/native.ts`: simple mana abilities, keyword lines, timing restrictions) replace a line only when their
   reading passes the same gate and is fully automated; trusted LLM entries may overlay only units the parser left manual. Every source's output goes through
   lint, the render gate and the degrade pass, then `model/classify.ts` sets `CardDef.automation`. Layouts the engine does not implement are capped
   (`LAYOUT_CAPS`). `cards/spans.ts#spansOf` turns the ledger into display spans (automated text plain, manual text marked) for the client.
5. **The interpreter** (`effects/`, design 8): `effects/run.ts#resolveStackObject` re-checks targets (CR 608.2b) and runs the steps in order with an
   execution context (`effects/ctx.ts`; references `effects/refs.ts`, quantities and conditions `effects/eval.ts`); each op has one handler
   (`effects/handlers/index.ts#OP_HANDLERS`). Handlers are pure functions of the game and their step, follow the re-execution decision model (`g.choose`), and
   never write the state directly: every state change is proposed. Manual steps raise `manualResolve` where they stand (`effects/manual.ts`).
   **Triggers** (`triggers/`, design 8.4): engine events are matched against trigger patterns (`triggers/match.ts`, look-back for leaves-the-battlefield and
   similar events, CR 603.10, `triggers/lookback.ts`), intervening "if" checked on trigger and on resolution (CR 603.4), delayed and reflexive triggers
   (CR 603.7, 603.12), put on the stack in APNAP order with the controller's ordering (CR 603.3b). Triggered abilities that the rules give a whole class
   of permanents and no card prints are inline data in `triggers/intrinsic.ts` (FXC: the Siege defeat trigger, CR 310.12b, which casts the card
   "transformed", CR 712.11a).
6. **The proposal pipeline** (`effects/propose.ts`, design 8.5): every event (zone change, damage, life, counters, tokens, draw, destroy, ...) is proposed
   before it happens: "can't" effects (CR 614.17, `effects/cant.ts`), then the replacement/prevention loop of CR 616.1 (each effect once per event, CR 614.5;
   `chooseReplacement` when several apply), then the body (`effects/replace-bodies.ts`), then `effects/perform.ts`, which emits the events (only what happened
   triggers anything, CR 603.2g). The milestone 3/4 primitives (`moveObject`, `createToken`, `dealDamage`, `destroy`) are funneled through the same pipeline
   (`effects/funnels.ts`). Milestone 5 applies an object's own replacement effects about itself (`feature:replace.self`: "enters tapped", "as ~ enters",
   "if ~ would die") and shields created by resolved effects (prevention, regeneration). **Milestone 6** (M6-1)
   adds the replacement effects of other objects (`feature:replace.foreign`): an index of the replacement statics that function where their objects are
   (`effects/replacement-index.ts`, bucketed by event kind, memoized on the characteristics map), the chooser of CR 616.1 by the affected player (judged after
   layer 2), "used" per event branch (CR 614.5: two "draw two instead" effects draw four), the bodies `instead`, `redirect`, `skip`, `modify.amount|count|to`
   and their shields, and simultaneous events in APNAP order (`proposeSimultaneous`, CR 615.7 shares). Every event kind is a `PROPOSAL_KINDS` entry (its
   translation for the matcher, its affected player, its performer), so the steps, phases and turns are proposed too ("skip", CR 614.10), and so is the draw of
   the draw step (`core/steps.ts`, CR 504.1, 614.6; fixed in M6-10: before, Thought Reflection, dredge and Laboratory Maniac never saw that draw).
7. **Static abilities** (`statics/`, design 9): continuous effects through the layers (see "Characteristics and continuous effects"); restrictions,
   permissions and rule modifications through the rule hooks (`statics/hooks.ts`, asked at the call-sites through `rules/hookpoints.ts`, the only place
   rules code asks "may this happen?"); cost modifiers in the CR 601.2f order (`statics/costmods.ts`); linked abilities and their stores (CR 607,
   `statics/links.ts`, `GameObject.links`).
8. **Capability discipline** (design 5.2): every JSON node needs capability strings (`op:damage`, `ev:zoneChange`, `layer:6`, `keyword:ward`,
   `feature:replace.foreign`, ...) computed by one walker (`model/capabilities.ts`). The engine's own set, `ENGINE_CAPABILITIES` (634 entries at the end of
   milestone 5, 764 on the merged milestone 6 tree), is built from its
   tables (handlers, renderers, evaluators, matchers, keyword registry, ...), never from a hand-kept list. A template whose capabilities are missing is
   skipped, and the degrade pass turns any unit that needs a missing capability into a manual node with `requiresEngine`: **an unfinished feature can never
   make a card wrongly automated**, and adding a capability only moves cards up (monotonicity).
9. **Classification and manual affordances** (design 10): per ability and per card, `full` (every node understood and available), `partial` (some
   automated effect content plus manual nodes) or `manual`; a card that used an `experimental` template, a stub, an unsanctioned or digital-only card is capped.
   The manual nodes of a keyword's expansion data count too (`model/classify.ts`): ninjutsu's defender step (CR 702.49c) is manual, so a ninjutsu card is
   `partial`, never `full`, and the step is listed in its manual text (M5Z review).
   Anything not understood stays a `manual` node: the engine runs everything around it and asks the players (`manualResolve`) exactly where the manual text
   would act. The client shows the level, paints the manual text and lists missing capabilities. **Never silently do the wrong thing.**
10. **Optional LLM compile step** (`@openmtg/cards`, design 11; milestone 7): produces the same JSON for text the templates cannot parse, cached as reviewable
    JSON keyed by `textHash`; the game runs without it.

**Milestone 6 capabilities** (each a table entry in its package's file, registered only by the commit
that made its tests pass): the replacement loop for every source (`feature:replace.foreign`, `feature:replace.on.<ev>[.<verb>]` per translated event kind,
the `body:` names of `BODY_KINDS`, `ENTERS_PARTS` and `DESTINATION_PARTS`: `effects/registries.ts`), layers `layer:1a` (`statics/copy.ts`), `layer:1b`
(`statics/face-down.ts`) and `layer:3` (`statics/text-change.ts`) in `statics/layers.ts#LAYER_TABLE`, the value forms of the ops that run them
(`op:copy.except`, `op:changeFace.faceUp|faceDown|manifest|convert|flip|delayedSelf`, `op:designate.day|night`, `op:designateObject.*`: `OP_FORMS` next to each
handler), the new event forms (`feature:ev.becomes.turnedFaceUp|converted|flipped|melded|classLevel|solved|prepared|mutated`: `triggers/forms-*.ts`), the
layout structures (`feature:chapter`, `feature:class.level`, `feature:leveler.bracket`, `feature:case`, `feature:prepare`: `statics/levels.ts`), the cast
statics of additional and alternative costs (`static:additionalCost|alternativeCost`: `actions/cast-kinds.ts`), combat requirements (`restrict:mustIfAble`,
`feature:require.other.*`, M6-12 `feature:require.player.attack`: `rules/requirements.ts`), the status filter fields (`filter:flipped|solved|prepared|prototyped`:
`rules/filter-parts/`) and the keywords whose data now runs (kicker, multikicker, entwine, buyback, evoke, escape, dredge, rebound, unearth, morph, megamorph,
disguise, daybound, nightbound, disturb, more than meets the eye, read ahead, level up, prototype, mutate; M6-12: madness, embalm, eternalize, encore, myriad,
squad, offspring, replicate, conspire). M6-12 also registered `op:cast.costChange` (an alternative cost paid while a resolving ability casts the card, CR 118.9:
`effects/handlers/tokens-cast.ts#OP_FORMS`; every other changed cost is `op:cast.costChange.<kind>`), `body:modify.then` (what follows a modified zone change:
madness's "when this card is exiled this way"), `feature:castCost.granted` (the cast path reads the costs of abilities granted to the card where it is:
`actions/cast.ts#withGrantedCosts`) and `static:triggerMod` with `feature:triggerMod.enters` (CR 603.2d for a permanent entering: Panharmonicon;
`triggers/collect.ts#TRIGGER_MOD_CAPABILITIES`). A keyword is advertised only when every name the general walker gives its expansion is registered
(`keywords/needs.ts#expansionNeeds` adds the value forms of steps and bodies since M6-12). The layouts meld, mutate, case, prototype and prepare are lifted
from `LAYOUT_CAPS` (`cards/layout-support/`). Deliberately not registered (fail closed): `feature:copy.static` (a static ability's copy effect, CR 707.2c),
`feature:copy.asEntersPT` (CR 613.2a P/T choices as entering), `feature:control.layered` (registered by MX2), `op:move.until.other` (FAST4 MX1 registered `op:move.until`,
"exile ... until ~ leaves the battlefield", CR 610.3: `GameState.untilMoves`, core/durations.ts, effects/until-return.ts; and `static:pregame` with
`feature:pregame.beginOnBattlefield`, the opening-hand action of CR 103.6a: core/pregame.ts), `feature:castCost.lasting` and
`feature:keyword.missing.<param>` (a keyword instance without the parameter its expansion needs: "gains embalm. The embalm cost is equal to its mana cost."), and the triggerMod forms not reviewed (`feature:triggerMod.cause.<ev>`: dying
looks back at abilities that left, CR 603.10a; `feature:triggerMod.computed`; `feature:triggerMod.lasting`).

**The Ring tempts you (FAST5 MX3, CR 701.54).** `core/ring.ts` is the keyword action (native `action:ringTempts`, `effects/handlers/ring.ts`): the emblem
named The Ring in the player's command zone (CR 701.54c; its four abilities are ordinary data, and its definition is replaced by the one for the new count
each time the count grows, so they are cumulative), the choice of a Ring-bearer among the creatures the player controls (CR 701.54a; none is no choice, and
the Ring still tempted them, CR 701.54d) and the `actionPerformed` event with verb `ringTempts` (with the chosen creature as its object, if any). The state is
`GameState.designations.ring` (count, Ring-bearer, emblem per player); the designation is read by `ObjectFilter.ringBearer` in both evaluators (rules/filter.ts,
statics/match.ts) as CR 701.54e says (on the battlefield, under that player's control) and ends when another player gains control
(`core/ring-state.ts#ringControlChanged`, called by core/control.ts and core/manual.ts). The parser reads "the Ring tempts you", the trigger events "the Ring
tempts you" and "you choose a creature as your Ring-bearer", "your Ring-bearer", "a Ring-bearer", "~ is your Ring-bearer" and "you chose a creature other
than ~ as your Ring-bearer" (the event's chosen creature, CR 603.4). Not modelled: "the Ring has tempted you N or more times" as a quantity.

**Coverage and the work queue.** `npm run cards -- coverage` measures the game path over the whole local index (levels, reasons, missing capabilities, top
unparsed shapes, render-gate reject rate, out-of-sample retention); `try`, `unmatched`, `snapshot`, `smoke` and `mutate` are its tools (CONTRIBUTING.md, "Adding a
template"). Milestone 5 ended at 27.3% of the index `full` and 42.5% `partial`.

## Card images

The engine knows nothing about images.

- **Every card is known.** Rules data for the whole card pool (about 34k cards plus tokens) comes
  from the local Oracle index, so any card in a decklist plays immediately.
- **A. Placeholders + player-supplied images (default).** The client renders each card as a text
  frame (name, mana cost, type line, rules text, P/T or loyalty) styled by color, with no Wizards
  symbols or frames. Players can upload images of their own cards (single files, a folder, or with
  a decklist). The client recognizes which card each image shows by resolving its file name with
  the decklist name resolver (exact, face alias, loose punctuation-insensitive match,
  suggestions), prioritizing names in the uploaded decklist; unmatched or ambiguous images go to a
  review screen where the player picks the card. Stored only in the player's browser (IndexedDB), keyed by image slot; never uploaded.
- **Image slots: one per printed side, not per rules face** (design 12.2 and 15.6 #2). `cards/pool.ts#imageSlots(def)` (pure) is the only
  place that knows the table: normal, saga, class, case, leveler, mutate, prototype and similar one-sided cards have one slot (`Name`); split, adventure,
  flip and prepare cards are one physical card with one picture (one slot `Full // Name`, either face name resolves to it); transform, modal double-faced,
  reversible cards and double-faced tokens have two (`Front name`, `Back name`); each meld front has two (its front and the shared melded back) and the melded card one, so a meld pair has three pictures in all; tokens and emblems one per
  token variant; a stub one (the name as given). Art Series names resolve to the card they depict, for image matching only.
- **B. Opt-in Scryfall images (off by default).** A setting "Show card images from Scryfall" makes
  the player's own browser hot-link the `normal`/`large` image URLs stored in the local index
  (taken from Scryfall's `image_uris`, never built by hand). Nothing is downloaded into the
  project, cached by OpenMTG, bundled or redistributed. Follow Scryfall's image rules: keep the
  aspect ratio, no crops, filters, tints or blur, never cover the artist/copyright line, no
  watermarks, logos or DigiDice branding on the image. On the battlefield
  the board draws game state ON the card like a tabletop counter (`board/CardOverlay.tsx`): the
  current P/T or loyalty/defense on the card's own P/T corner and each counter as a small icon with
  its number on the art's left edge, always above the artist/copyright line. Damage, highlights,
  combat and other status chips and every automation badge stay outside the image. CSP `img-src`
  must allow `*.scryfall.io`.
- **Priority:** player-uploaded image > Scryfall image (if enabled) > our own frame.
- **A card keeps its picture when it changes zones**. A card in another zone is a
  new object id, so the board draws it with a new component: that component must know the picture in its first render. Scryfall look-ups and uploaded
  images are kept by card name / slot and read at once (`ScryfallUrls.peek`, `UploadedImages.peek`), the chosen pictures are held loaded
  (`images/pictures.ts`), the pictures of the cards a view brings are read ahead (`cards/prefetch.ts`), and a card whose picture is still on its way marks
  its stand-in frame `data-picture-pending`, so the animator holds the flying ghost until the picture shows (the ghost is a copy of the picture the card shows).
- **Our own frame** (`packages/client/src/cards`): toned bevelled border, name bar with glossy mana orbs, a
  procedural art box, type line, rules text and a P/T (loyalty, defense) plate. The art is inline SVG over a CSS
  sky, drawn from a hash of the card's name plus its colors and types (`CardArt.tsx`, `artScenes.tsx`): fiery sky,
  deep water, forest canopy, smoke and moon, radiant dawn, gold blends for several colors, brass plates for
  artifacts, pale crystal for colorless, landscapes for lands; a creature silhouette follows the subtypes. No
  canvas, no animation, no network, no official art or symbols. Below 120px of card width a container query hides
  the type line and rules text visually (they stay in the DOM) and gives the room to the art.
- Test fixtures never contain image URLs.

## Sound

Sound effects for everything, in a Tron / grid / digital style.

- **Synthesized, never recorded.** `packages/client/src/audio`: `dsp.ts` (oscillators, envelopes, filters, effects, an 8-line
  FDN reverb, the mixer and `master`, which levels every sound), `palette.ts` (the key of D minor, the three shared rooms, the
  building blocks), `catalog.ts` (113 sounds: purpose, moment, frequency, loudness, length, variants; `renderSound`),
  `sounds/<group>.ts` (the recipes). Pure functions: the same numbers in the browser, the tests and `scripts/sound`. No audio
  files, no dependencies, nothing to license.
- **Playback.** `engine.ts` (Web Audio): renders a sound on first need (or while the page is idle: `main.tsx` pre-renders
  everything, most needed first), plays it through its category's volume (interface, game, ambience), the master volume and a
  limiter; frequent sounds rotate variants and detune slightly; one sound never stacks more than a few voices. Nothing plays
  before the page's first user gesture (browser rule). `sfx.ts` is the page-wide entry (`sfx(id)`), bound to Settings, Sound.
- **Interface.** `uiSounds.ts` delegates from the document: every button, toggle, select, slider and text field gets its sound
  (`data-sfx="<id>"` or `"none"` on an element overrides; `data-sfx-scope="manual"` silences a subtree, the game table). A
  handler that plays its own sound in a click replaces the generic one (the engine's play count tells).
- **The game.** The board animator (`board/fx/Animator.ts`) plays each beat's sound at the beat, panned to where it happens;
  `board/fx/sounds.ts` maps plans and events to sounds (pure, tested) and `game/sound.ts` plays them without ever throwing and
  keeps a clock so cues give way to each other (the "your move" prompt waits for the turn banner, the result for the final
  blow). A change shown without animation (animations off, a catch-up, the hot-seat cover) is reported by the paced
  connection (`PacedOptions.unanimated`) and gets a condensed set of sounds instead. Prompts, the hand, zone viewers, the
  result screen and the online link play their own.

## Hidden information

`core/view.ts#viewFor(state, player)` returns what a player may see: other players' hands and all
libraries are redacted (`defId = '__hidden__'`), the RNG and suspended base state are removed,
private log text is replaced, and other players' decision details are hidden (they see who is deciding, not what about).
While a player is in the middle of a cancellable action (casting, activating) everyone else sees the state the action
started from, so abandoning a cast reveals nothing. A log line about a card that moves between hidden zones or stays in one names it
only in `privateText` to the players who can see it ("A card is put into Alice's hand.", audit C3), and an action naming an object the
player can't see gets one generic error whatever the card is (`HIDDEN_CAST`, `HIDDEN_ACTIVATE`, audit M1). Another player's hand cards
appear in a view under aliases (a hash of the secret seed, the viewer and the hand's hidden cards), sorted by alias: renewed whenever
that hand changes, so neither ids nor order tell the draw order (audit m4); no action ever names such a card, so nothing translates an
alias back. Hidden objects must not give their identity away through ids: object ids,
card ids and timestamps are handed out in a random order (`core/create.ts`), not in decklist order. A card the viewer cannot see
in a hidden zone is a blank card (id, kind, owner, controller, zone; no card id, timestamp, creation turn or face); a face-down
object loses its card id, face and what it remembers but keeps what everybody sees of it (CR 708.6), and its last known
information is shown only to those who could see it, unless it was revealed as it moved (CR 708.9). Shuffling a library, any
reorder (scry, surveil), and cards put into a library in an order nobody else may learn (their owner's arrangement, CR 401.4;
"in a random order", CR 702.85a) give the cards concerned new object ids (`core/zones.ts`, H1). Those cards are moved in an order
everybody may know and arranged afterwards, and no last known information or event a player is shown links an old id to an
object that player cannot see, so no player can follow a card they once knew into a library and through a shuffle
(CR 400.2, 401.2, 701.24a). Nothing in the state records the old ids (the state does not grow with shuffles); engine code of the
same action that still holds one follows the card through `Game.renewed`. The client renders views, never raw states.
The events of a change get the same treatment from one function, `core/view-events.ts#eventsFor` (RPL-0: packages/net and the browser's
local games share it; NETFIX1 and NETFIX2: no event names another player's hidden hand card by any id). A replay may also show the open view
(`core/view.ts#openView`: every card, every library in order, every private log line), only where its reveal policy allows. The browser plays a
replay back through `connection/ReplayConnection.ts` (RPL-2), which enforces that policy itself (`setPerspective` refuses a seat or the open view the
replay does not allow, replays/viewer/policy.ts) and redacts each view and event batch as `LocalConnection` does. The board draws the open view
(`view.open`) with every hand face up and each library listed in order in the zone viewer (board/Hand.tsx, board/PlayerPanel.tsx); any other view keeps
another player's hand as card backs and every library as a pile, whatever the view carries. A bug report (RPL-4, `packages/client/src/bugs`) holds
no more than the reporter's own replay may: a local game's report carries the game (the engine ran in that page), a report made while watching a
replay carries that replay (but an online game's replay that not every person agreed to show only what the saver's seat was shown up to that moment),
and any other (an online game) carries only what that screen was shown (its recording, or the view with its log and last events); the dialog keeps the
game file in a closure, never in React props or state, and shows nothing of it. Online replays (RPL-3, packages/net game/record.ts, packages/client
online/recording.ts): a guest keeps a recording of exactly the views and events it was shown; the host keeps the game (its server ran it) and sends a
guest the whole game (`replayGame`, protocol 5) only after the game is over for everyone and only when every player agreed ("Show my cards in
replays", default off; a leaver's last choice counts), never during a game, whose seed and log would reveal every hidden card.

**Face-down objects** (milestone 6, M6-3; CR 708, m6 design D7). Hidden information is a view property, never a rule exception. Every game has two
face-down pseudo-definitions (`core/create.ts#FACE_DOWN_DEFS`, ids `__facedown__` and `__facedown_ward2__`: real frozen `CardDef`s), and an opponent's view
shows a face-down permanent or spell as that pseudo-definition (`core/view.ts`) with what everybody sees of it (tapped, counters, damage, attachments), so
`getChars` works on a view and a client shows the 2/2 (or 3/3 under an anthem, ward {2} for disguise and cloak) with every effect that applies. What put it face
down is public (CR 708.6), a megamorph announced as morph (CR 702.37b-c); its card, name, links and cast record are not. No state a view carries names a
face-down object's card: a copy snapshot of a face-down object holds only the pseudo-definition (CR 708.2: the profile is its copiable values), face-down
components of a merged permanent are redacted, and moves log and emit the face-down name. A face-down object is revealed when it leaves the battlefield,
when it leaves the stack for any zone but the battlefield, when its owner leaves the game and at the end of the game (CR 708.9); a card exiled face down
has no characteristics (CR 406.3a) and stays hidden. The controller always sees its own face-down objects (CR 708.5) and may turn one face up as a special
action (`LegalAction.kind: 'special'` with `via` for the procedure, CR 116.2b, 702.37e). The hidden-information property test
(`test/m6/face-down/hidden-property.test.ts`) searches the whole view of random games with morph, megamorph, disguise, manifest, Clone and token copies for
any trace of a face-down card.

## Testing

- Combat and state-based action tests (`test/m4/`) build a board with real fixture cards (`test/m3/scenario.ts`), then drive it with real actions and answers
  (`test/m4/helpers.ts`: `runCombat`, `toDeclareAttackers`, ...). The soak test (`test/m3/soak.test.ts`) plays random games including combat and checks, whenever a
  player has priority, that no state-based action is pending (no lethal damage, no unattached Aura, no duplicate legend, no token outside the battlefield) and that
  the combat structure is consistent. Note that the scenario helper deep-clones its state, which un-freezes the card definitions (only `createGame` freezes them).
- Vitest. Tests run offline from `packages/engine/test/fixtures/cards.json` (Oracle fields only for
  a named list of test cards; generated by the cards package from the local cache).
- Scenario tests set up a board, perform actions, and assert results. Name tests after the rule they
  check (`"CR 704.5g: lethal damage destroys a creature"`).
- Milestone 5 tests live in `packages/engine/test/m5/<area>/` (one folder per work package). The Comprehensive Rules' own worked examples are scenario suites
  per milestone: `test/m3/cr-examples.test.ts`, `test/m4/cr-examples.test.ts` and `test/m5/cr-examples/` (CR 603, 608, 613, 614-616, 118.12, 607; examples
  that are not run are tests that pin the card as not automated: "milestone 6" when the card names the missing capability in `requiresEngine`, "no template
  yet" when no template matches its sentence and the compiler names no capability). They use real fixture cards compiled by the default compiler; when a
  card's wording has no template yet, an "equivalent" card carries hand-built JSON of the same behavior, checked by `validateAbility` (schema and lint) but
  not accepted by the render gate yet, so the compiler could not produce it; the test says so. `docs` links are checked by
  `packages/cards/test/docs/links.test.ts`. `scripts/m5-games.ts` replays the milestone 5 verification (seeded random-bot games with decks of full cards,
  and a spot-check sample).
- Template tests (G9), the golden corpus (`test/m5/golden`, hand-verified JSON) and the fixture snapshot (`packages/cards/test/coverage/fixtures.snapshot.json`,
  G10) guard the parser; `npm run cards -- coverage --fixtures --gate R1 --diff` is the CI job over the fixture set.
