# Milestone 5 final design: ability model, keyword library, Oracle-text parser, effect interpreter

Status: **final design for implementation**, 2026-10-11. It supersedes `m5-candidate-grammar.md`, `m5-candidate-semantics.md` and `m5-candidate-templates.md` (kept for reference, each now carries a note at the top). Where this document and a candidate disagree, this document wins. Rule numbers refer to the Comprehensive Rules (effective 2026-06-19) in `rules/cr/`.

Inputs: `docs/ARCHITECTURE.md`, `docs/design/m3-casting-and-mana.md`, `m4-combat-and-sba.md`, `updates.md`, `m5-corpus-analysis.md`, the three candidates and the three judges' scores with their graft lists, `packages/engine/src/{types,core,rules,actions,cards}`, the Comprehensive Rules, and the local Oracle index (`.cache/scryfall/`, read locally, never downloaded). Nothing under `packages/` was modified by this design.

**Baseline.** git `HEAD` (a2e36a7, end of milestone 3) plus the uncommitted milestone 4 work that was in the working tree while this was written: `core/{apply,create,game}.ts`, `types/{ability,decisions,state}.ts`, `util/clone.ts`, `cards/keyword-list.ts`, `rules/quality.ts` (and, by the end of the session, `rules/attachment.ts`, `rules/combat-state.ts`, `rules/damage.ts`, `cards/keywords.ts`, `Chars.keywords`, `core/zones.ts#createToken`, Aura attachment on resolution in `core/resolve.ts`). Facts from that work that this design relies on: `KeywordAbilityDef.quality` is a canonical string (`rules/quality.ts`: `color:R`, `type:Artifact`, `subtype:goblins`, `multicolored`, `everything`), `KeywordAbilityDef.filter/player` carry Aura enchant restrictions, `GameObject.attachedTo` may be a player, `Game.addDef` adds token definitions copy-on-write, and `util/clone.ts#cloneState` shares `defs`, `log` entries and `lki` entries between states (hazards in section 4.3). **Work package WP0 starts only after milestone 4 is committed and re-bases the type changes of section 4 on it.**

**What was verified by running things** (scratch files outside the repository; the commands are in section 16):

- `types/ability.ts` and `types/automation.ts` (section 2.3), the state/decision/event additions (4.1), the API files of section 5 and the algorithm sketches of section 8.3 (resolution, the proposal funnel, the layer system, a handler) compile under `tsc --strict` with the repository's `tsconfig.base.json` against the real engine types (`Game`, `Chars`, `Denial`, `CardDef`, `StackInfo`, ...). An intentionally wrong example (a `draw` step without `who`) was confirmed to fail, so the type check is effective.
- Every JSON block of section 13 is printed from a typed TypeScript value (53 cards), so each is a valid instance of the model, and a prototype lint (16.3) passes for all of them. Ten keyword data files (7.2) were expanded with sample parameters by a script and the results compile as `AbilityDef[]`.
- Replacing the repository's `types/ability.ts` by the new one makes 47 type errors in 15 source files (section 4.4) against the working tree at the start of the session, and 51 errors in 18 files against the working tree at the end of it (milestone 4 keeps adding code that reads the old shapes: `cards/keywords.ts`, `rules/attachment.ts`, `rules/damage.ts`). That is the migration worklist of WP0, measured, not estimated; WP0 re-measures against the committed milestone 4.
- Oracle texts quoted in the examples were read from the local index.

**Not verified, by nature:** the coverage forecasts (section 15.5; they are forecasts and are replaced by measurements at every gate), the behavior of code that does not exist yet, and the Gatherer rulings listed in section 15.3 (pinned by tests before the handlers are written).

## Contents

1. Decisions: one page, the decision log (contradictions resolved), the graft ledger
2. The ability model: concept map and the final types (`types/ability.ts`)
3. Normative semantics the types cannot say
4. State, decision and event additions; migration from the current model
5. Module layout and the public APIs (the contracts parallel work packages build against)
6. The parser: pipeline, templates, partial understanding, taint, guards
7. The keyword library
8. The interpreter and triggers
9. Static abilities, layers, rule hooks, cost modifiers
10. Automation classification and the manual affordances
11. The LLM compile step
12. The card pool, rules packs and caches ("every card is known")
13. Worked examples (53 cards as JSON)
14. Milestone 6 hooks
15. Implementation plan: work packages, gates, forecast, rulings to pin, risks, open decisions
16. Appendix: verification, rule index

## How to read this document with the candidates

The candidates remain the detailed reference for material this document does not change. The table lists exactly which parts of `m5-candidate-semantics.md` ("Sem") are **inherited unchanged** (read them, they are normative), which are **inherited with the listed changes**, and which are **replaced**. Nothing in the grammar or templates candidates is normative except where section 1.3 says an idea was adopted and this document restates it.

| Sem section | Status | Notes |
|---|---|---|
| 1.2 CR concept to node map | inherited | table of which model node implements which rule |
| 1.4 a-k normative semantics | inherited with changes | changed items are in section 3: handles and rebase (a), defaults (b), unsupported filters (c), quantities (d), modes (e), `did` (a), locking (g), dependency (g), replacement (i) |
| 1.5 semantic events, matching algorithm | inherited | restated in 3.5 and 8.4 |
| 1.6 rule hooks table | inherited | restated in 9.4 |
| 1.7 state additions | inherited with changes | section 4.1 is the final text |
| 1.9 op catalog (CR, proposes, decisions per op) | inherited | `unless` is replaced by `pay`; `removeFromCombat` added; actors are required |
| 1.10 deliberately outside the model | inherited | restated in 10.6 |
| 2.1-2.5 keyword library | replaced | data-first (section 7) |
| 2.3 top-60 table, 2.4 keyword actions table | inherited with a "ships" column | section 7.4 and 7.5 |
| 3.1-3.8 parser | replaced | section 6 (same pipeline idea, different matching, taint and anaphora rules) |
| 4.3 resolution | replaced | section 8.3 (one legality check over all modes) |
| 4.4 references, LKI | inherited with the 400.7j fix | 3.1 |
| 4.5 proposal pipeline | inherited | 8.5 |
| 4.7 layers | inherited with changes | 9.2-9.3 |
| 4.8-4.11 decisions, determinism, manual steps, testing | inherited | 8.7-8.10 |
| 5 automation classification | replaced | section 10 |
| 6 LLM compile step | inherited with changes | section 11 |
| 7 worked examples | replaced | section 13 (re-typed against the final model) |
| 8 implementation plan | replaced | section 15 |

## 1. Decisions

### 1.1 The decisions on one page

1. **Base design: the rules-semantics-first model** (Sem), with the grafts of 1.3. All three judges scored it highest on rules fidelity (9, 9.5, 9) and it is the only candidate whose types, interpreter, layers and keyword code were type-checked against the real engine.
2. **One node per Comprehensive Rules concept**, cited. 57 effect ops (a closed union), one `action` op that dispatches to the CR 701 macro library, 10 static-effect kinds, 11 layers/sublayers, one event vocabulary (`EventPattern`) shared by triggers, replacement effects, delayed triggers, durations and history.
3. **The model is pure JSON and total about actors.** `who`, `payer`, `source`, `caster` and a battlefield `controller` are required by the types. A parser or an LLM cannot silently default "its controller" to "you" (Path to Exile, Thalia, Rabid Bite).
4. **There is no "unsupported" escape in an executable position.** A sentence whose filter, quantity, condition, duration or target the compiler cannot express is manual as a whole. A field the engine cannot evaluate is a missing *capability*, and the `degrade` pass turns the unit that uses it into a manual node. `ObjectFilter.unsupported` is removed.
5. **Manual is granular and honest**: whole ability, one step, one cost part, one condition, one quantity, plus manual trigger detection with an automated effect ("Trigger now"), manual shields with a chip, and activation restrictions the controller attests. Contagion and poisoning rules (6.7) keep an unparsed sentence from changing the meaning of an automated neighbor in either direction.
6. **Targets: CR 608.2b is decided once over the targets of all chosen modes**, with target ids unique across the whole ability. Illegal targets resolve to "nothing", information about them "fails to determine" (propagating `undefined`).
7. **`pay` is the one op for "may pay / unless pays" (CR 118.12, 118.12a)**: the payer decides first, the `else` branch follows (Rhystic Study, Mana Leak, Smothering Tithe, Mana Vault, Pact of Negation).
8. **Resolved effects fix their values (CR 611.2d) and their affected set (CR 611.2c)**; static abilities are live (CR 611.3a). The `effect` handler replaces every non-`live` quantity by its number.
9. **References are handles plus last known information** (CR 400.7, 608.2h). A `move` to a *public* zone re-bases bindings onto the new object (CR 400.7j); a move to a hidden zone does not.
10. **Linked abilities are a per-object store** (CR 607); cast history (kicker, alternative cost, X) lives on the permanent (CR 400.7d).
11. **Layers: one `computeAll` for the whole game**, layer by layer across all objects, with the "started set" (CR 613.6), dependency by trial application including existence (CR 613.8), one timestamp per effect. Milestone 5 ships layers 2, 4, 5, 6, 7a-d; milestone 6 adds 1a, 1b, 3.
12. **Replacement/prevention: every state-changing op goes through `propose()`.** Milestone 5 ships the funnel, regeneration and prevention shields, "can't" effects and the self `enters` replacement (tapped, tapped unless, with counters, choices, shock lands); milestone 6 adds the CR 616 loop for foreign replacements, copy, redirect, skip and nesting.
13. **Keywords are data first.** One JSON file per keyword is the single source of truth (`keywords/data/*.json`); TypeScript exists only for hooks at named engine call-sites, special actions, and CR 701 action macros that cannot be written as steps. No parallel TypeScript `expand` functions that can drift.
14. **The parser is a bidirectional typed-hole template system on an Earley chart**, not a list of whole-sentence regexes: hole grammars (filters, quantities, costs, conditions, durations, events) carry the long tail; the vocabulary is generated from the CR; out-of-sample retention of at least 90% gates every release step.
15. **Twelve guards (G1-G12, section 6.8)** keep unmatched text from becoming wrong behavior; the strongest is the **exact render gate**: canonical English regenerated from the JSON alone must equal the Oracle sentence.
16. **Anaphora is resolved by a unique-candidate rule only.** Zero or several compatible antecedents make the sentence manual. There is no salience ranking; the one typed exception is the focus rule of FAST5 T76 (after "The focus rule" in section 6.4 notes): the token a sentence created or the one object it worked on is what a bare pronoun of the next sentence means, under the conditions listed there, and never "the nearest noun".
17. **Classification is computed, never asserted** (`full` / `partial` / `manual`), with a local kill switch, an experimental-template cap, and an unreviewed-LLM cap at `partial`.
18. **The LLM step emits the same JSON for the units the parser left manual, with no display text**, behind schema, lint, capability record, render gate, executability smoke test and two-run agreement. It can only overlay manual units; it can never override something the parser accepted.
19. **Every card is known.** `compileCard` is total and never throws; stubs, physical image slots and an opt-in index of unsanctioned cards complete the requirement (section 12).
20. **Parallel implementation is planned around a skeleton-first work package (WP0)** that freezes every contract of section 5 as compilable stubs, so waves of agents can fill disjoint files (section 15).

### 1.2 Decision log: contradictions between the candidates, resolved

| # | Question | Candidates | Decision and why |
|---:|---|---|---|
| D1 | Modal spells and CR 608.2b | Sem's `resolveStackObject` re-checked targets per mode and removed the whole spell when one mode's targets were all illegal (Cryptic Command would lose its bounce). Grammar and Templates did it right. | One `ExecCtx` per resolution over the flattened program; legality computed once over all chosen modes' targets; target ids unique across modes (Cryptic Command is `t0` and `t1`). Test: counter target gone, permanent legal: bounce and draw still happen. |
| D2 | Filters the engine cannot test | Sem: `unsupported` "never matches" (a `destroy all` becomes a silent no-op). Templates: `unverified` qualifier attested by the controller (supersets). Grammar: sentence goes manual. | Removed from the type. Unrepresentable filter: the sentence is manual. Representable but not evaluable by this engine build: capability `filter:<field>` missing, `degrade` makes the unit manual. History fields (`dealtDamageThisTurn`, `attackedThisTurn`, `blockedThisTurn`, `enteredThisTurn`) and `happenedCount` are real. |
| D3 | "You may ... unless that player pays" order | Templates: `may` outside `unless` (wrong). Sem and Grammar: payer first. | CR 118.12a: payer first. `pay` wraps `may`. A scenario test pins it; the wrapper template cannot compose the other order. |
| D4 | Defaults for actors | Sem defaulted `who`, `source`, `caster`, battlefield controller. Grammar required some. | Required by the types (section 2.2). The only defaults are listed in 3.2. |
| D5 | Unparsed neighbors (contagion) | Grammar: forward contagion words. Templates: forward poisoning. Neither handles "It's still a land." (earlier sentence already automated) or "would die ... instead" (a prompt cannot intercept a later death). | Section 6.7: forward poisoning, whole-program contagion for modifier words and unresolved anaphora (earlier steps included), exemption and chip for recognized shield shapes. |
| D6 | Quantities in resolved effects (CR 611.2d) | Sem fixed them; Grammar and Templates drifted (Aspect of Hydra, Angelic Exaltation). | Fixed at creation; `live` is the opt-in (3.4). |
| D7 | Which bindings follow a move (CR 400.7j) | Sem re-based unconditionally. | Only moves to public zones (battlefield, graveyard, stack, exile, command) re-base; a move to a hand or library does not. |
| D8 | `ManaUnit.restriction` / `addMana.restriction` | Free text in Sem, Grammar; structured in Templates. | Structured `ManaRestriction`, enforced by payment, or the step is manual (Cavern of Souls, 177 cards). |
| D9 | Enters-the-battlefield bodies | Templates had `tappedUnless`, `tappedUnlessPay`; Sem lacked them. | Adopted and extended: `tapped`, `tappedUnless`, `tappedUnlessPay`, `counters`, `choose`, `copy`, `attachTo`, `faceDown`, `transformed`, `under`, `withAbilities`. A self `enters` replacement is consulted from the entering object whatever its `zone` (CR 614.12). |
| D10 | "Pay then did" ("you may pay X. If you do") | No candidate had an op (478 cards). | `pay` has `then` and `else`. |
| D11 | Keyword expansions | Sem: TypeScript `expand` functions plus a separate pack `template` form (drift). Grammar: macros in CR English compiled by the same grammar (bootstrap dependency). | JSON data files with a tiny placeholder language are the only form; the renderer and the engine read the same data. |
| D12 | Anaphora | Sem: salience list "most recent compatible", then "more than one: manual" (contradictory). Grammar: ranking tiers (a heuristic). | Unique compatible candidate or manual (6.5). |
| D13 | LLM trust | Sem: `autoverified` drives play with no review. Grammar: unreviewed capped at partial. | `autoverified` (non-high-risk) may drive play but the card is capped at `partial` with an "AI-compiled" mark; `reviewed` is required for `full` and for every high-risk node (11.5). |
| D14 | Render gate | Sem: exact equality. Templates: Jaccard >= 0.9 plus literals (too weak). Grammar: round trip through the same frames (self-consistent). | Exact equality of a JSON-only renderer (Sem). Gate false-reject rate is a measured metric, never a reason to loosen. |
| D15 | Layer engine scope in M5 | Sem: whole `computeAll` from P3. Templates: layer-lite, Humility and friends manual until M6. Grammar: timestamp only. | `computeAll` with dependency by trial application ships in M5 for layers 2, 4, 5, 6, 7a-d (it is the final structure, about 120 lines); 1a, 1b, 3 are empty hooks until M6. |
| D16 | Existence dependency (Blood Moon vs a land-type granter) | Sem's `signature` ignored whether the generating static still exists. | `signature` includes `stillExists` (9.3). |
| D17 | Where cast history lives | Grammar: `StackInfo.costsPaid` only (lost on resolution). | `GameObject.cast` copied from the spell (CR 400.7d, 607.2i). `cloneObject` must copy it (4.3). |
| D18 | Fireball "divided evenly" | Three different answers. | Section 15.3 pins one and a test; the handler reads `ctx` so switching is one line. |
| D19 | Step name clash | New `Step` collided with the turn `Step` exported by `types/state.ts`. | Effect union is `EffectStep` (the current name), turn step stays `Step`. |
| D20 | Automation types | `AutomationLevel` existed in both `card.ts` and the new `ability.ts`. | New `types/automation.ts` holds all automation types; `ability.ts` is JSON-only. |
| D21 | Image slots | ARCHITECTURE.md: one image per face. Grammar: physical slots. | Physical slots (split/adventure/flip/prepare one image; transform/MDFC two; meld three), a pure `imageSlots(def)`. Flagged for confirmation (15.6). |
| D22 | Silver-border and acorn cards | Excluded by the index today. | Opt-in `--include-unsanctioned` index option, manual-only, flagged `unsanctioned`. Flagged for confirmation. |
| D23 | Source precedence | updates.md: pack > LLM > parser > manual, per card. | Per face: pack entry (matching `textHash`) > parser; trusted LLM entries overlay only parser-manual units. |
| D24 | Parser location | Engine package (all). | Engine package; runs in the browser. |
| D25 | One spell ability per face | Implicit in Sem. | All spell-effect lines of an instant/sorcery face merge into ONE `SpellAbilityDef` (CR 113.3a, 608.2). |
| D26 | Required test data hygiene | Templates only. | Committed template examples are synthetic/minimal; verbatim Oracle text lives in `.cache/` tests only; packs strip examples. |
| D27 | Regression visibility | Grammar (snapshot of JSON), Templates (template ids). | Whole-index snapshot of `{oracle_id: [template ids, JSON hash]}` per change; adding a template may change only formerly-manual units (G10). |
| D28 | Targets by static analysis vs dynamic | Grammar: `targetDeps`. Sem: undefined propagation. | Dynamic propagation (smaller, same results); the CR's own Sorin's Thirst and Plague Spores examples become named tests. |
| D29 | Schema | Sem: generated JSON Schema plus an in-repo validator. | Kept; the generator is a dev dependency of the repository root, the validator lives in `model/` and has no runtime dependency. |
| D30 | Who owns hot files | Not addressed by any candidate. | Each file has exactly one owning work package (15.2); shared call-sites are reached through interfaces WP0 freezes (provider registries). |

### 1.3 Graft ledger

| From | Idea | Where it landed |
|---|---|---|
| Grammar | CR-generated lexicon (types, subtypes with plurals, keywords, actions, counters, tokens) with a staleness test | 6.11, WP5 |
| Grammar | Out-of-sample retention >= 90% as a gate, frame mining loop, frame induction invariant | 6.12, 11.4, 15.4 |
| Grammar | Contagion words; residue with `furthest`/`expected`; unsupported filter in an executable position makes the sentence manual | 6.6, 6.7 |
| Grammar | `TargetSpec.groupLimit`; generic subject-led damage; required `player` on draw/search; CR 608.2b worked cases (Sorin's Thirst, Plague Spores) | 2.2, 15.4 |
| Grammar | "Every card is known": total compile, stubs, image slots, unsanctioned cards, Art Series names | 12 |
| Grammar | Keyword flag traceability test; snapshot of expanded keywords | 7.7 |
| Templates | Contract C1-C5 (never throws, images independent of automation), `forceManual` kill switch | 10.4, 12.1 |
| Templates | Experimental templates cap at partial; synthetic examples; `unmatched --top`, `try`; template-id snapshots; PR template | 6.9, 6.10, 15.4 |
| Templates | UI affordances: Rules reminders panel, Triggers to check tray, "How OpenMTG plays this card", ability-level provenance, `autoRatio` | 10.5 |
| Templates | Enters bodies `tappedUnless`, `tappedUnlessPay`; manual trigger with automated effect; manual activation restriction | 2.2, 10.1 |
| Templates | `perform.*` funnel + lint forbidding direct state writes; per-resolution step budget | 8.5, 8.8 |
| Templates | Structured mana spending restriction | 2.2, D8 |
| Sem | Handles + LKI, link store, trial-application layers, 616.1a-e classes, look-back derived from the pattern, text-free LLM storage, exact render gate, ten guards | throughout |
| Judges | "Look-ahead taint", persistent manual-shield chip, `pay` op, required actors, `damagedThisTurn`-style fields | 6.7, 2.2 |

## 2. The ability model

### 2.1 Principles

1. **One model node per CR concept, cited.** If the Comprehensive Rules distinguish two things (a self-replacement from a continuous replacement, a "can't" effect from a replacement effect, a delayed trigger from a reflexive one), the model does too. If the rules treat two wordings as the same thing (CR 118.12 and 118.12a), the model has one representation and the parser normalizes.
2. **Rules semantics live in code that cites the rules; card data only selects among them.** Look-back (CR 603.10) is a function of the event pattern, the 616.1 priority classes are computed from the replacement body, the locking of a resolved effect's affected set (CR 611.2c) is decided by the kind of modification. None of these is a field on a card.
3. **Closed vocabularies, open composition.** Operations, events, layers, rule actions are closed unions; filters, quantities, conditions, durations and costs are small composable expression languages (corpus section 12: costs, triggers and targets are small vocabularies, effects and filters are open).
4. **Data is JSON and pure.** No functions, no code strings. A node can be validated, canonicalized, cached, diffed, shipped in a pack, rendered back to English and executed.
5. **Names, not pronouns.** "It", "that creature", "them" are resolved at compile time into explicit `Name` bindings (`as`) or event roles. The interpreter never guesses an antecedent.
6. **A player who acts is always named** (`who`, `payer`, `source`, `caster`, battlefield `controller`): required by the types.
7. **Honest incompleteness is a node** at every level where text can be unparseable (section 10.1). There is no node meaning "partly understood, run it anyway".
8. **Display text is derived data.** `text`, `span`, `TargetSpec.text` and manual `text` are regenerated by the renderer or hydrated from the player's local Oracle text; stored forms (packs, LLM cache) carry only `src` and `sentence` indices (12.3).
9. **Automation is not part of the ability JSON.** The level of an ability is computed (section 10) and stored in `CardDef.automation`, so the JSON never goes stale relative to the engine.

### 2.2 Concept map

Which model node implements which rule, and which code evaluates it. Section numbers are those of this document.

### 1.2 Mapping from the Comprehensive Rules to model nodes

| CR concept | Model node | Evaluated by |
| :--- | :--- | :--- |
| Spell ability (113.3a), resolution (608.2) | `SpellAbilityDef.effect: EffectProgram` | interpreter (8.3) |
| Activated (602), mana (605), loyalty (606) abilities | `ActivatedAbilityDef` (`isMana`, `isLoyalty`, `sorcerySpeed`, `limit`, `onlyIf`, `zone`) | `actions/activate.ts`, interpreter |
| Triggered ability (603.1), trigger event (603.2), intervening "if" (603.4), optional (603.5) | `TriggeredAbilityDef`, `TriggerDef.on: EventPattern[]`, `interveningIf`, `may` step | trigger collector (8.4) |
| Zone-change triggers and look-back (603.6, 603.10) | `EventPattern{ev:'zoneChange'}` + code | trigger collector |
| State triggers (603.8) | `EventPattern{ev:'state'}` | checked after each state-based action pass |
| Delayed (603.7) and reflexive (603.12) triggers | `delay`, `reflexive` steps; `DelayedTriggerRec` | trigger collector |
| Triggers an additional time (603.2d) | `TriggerModDef` | trigger collector |
| Static ability (604.1), functioning zones (113.6, 604.5, 604.6) | `StaticAbilityDef.effects`, `zone` | characteristics function, rule hooks, proposal pipeline |
| Characteristic-defining abilities (604.3) | `ContinuousEffectDef.cda` | layers (613.3, 613.4a) |
| Continuous effects: locked vs live (611.2c, 611.3a) | `ContinuousEffectDef` via `effect` step (fixed set, 9.1) or static (live) | `computeAll` (9.2) |
| Layers 1-7 (613.1-613.4) | `Modification.layer` | `computeAll` |
| Timestamps (613.7), dependency (613.8) | `ContinuousEffectRec.timestamp`; dependency computed | `computeAll` |
| Replacement (614), prevention (615), redirection (614.9), skip (614.10) | `ReplacementDef` + `ReplacementBody` | proposal pipeline (8.5) |
| Self-replacement (614.15) | `selfReplacement` flag; same-ability "instead" parsed to `if/else` | proposal pipeline (616.1a) |
| Enters-the-battlefield modification (614.1c-d, 614.12) | `ReplacementBody{b:'enters'}` | proposal pipeline |
| "Can't" effects (614.17), "must" (508.1d) | `RestrictionDef` | rule hooks (9.4) |
| "As though" permissions (609.4) | `PermissionDef` | rule hooks |
| Costs (118), cost parts (601.2h), X (107.3) | `CostDef`, `CostPart`, `{q:'X'}` | `rules/cost.ts`, `rules/pay.ts` |
| Additional (118.8) and alternative (118.9) costs | `AdditionalCostDef`, `AlternativeCostDef` (+ keyword `additionalCost`/`alternativeCost` statics) | `actions/cast.ts` |
| Cost increase/reduction (601.2f, 118.7) | `CostModDef` | `rules/cost.ts` |
| "Unless [player] pays" (118.12a) | `pay` step | interpreter |
| Targets (115), re-check (608.2b), division (601.2d) | `TargetSpec`, `StackInfo.division` | `rules/targets.ts`, `actions/announce.ts` |
| Modes (700.2) | `ModeSpec` | `actions/announce.ts` |
| Linked abilities (607) | `link`, `{ref:'linked'}`, `chosen` filter | link store (3.9) |
| Last known information (113.7a, 608.2h, 603.10) | `ObjHandle` + snapshots | interpreter (3.1) |
| Durations (611.2a-b, 514.2, 610.3) | `Duration` | effect expiry (3.7) |
| Keyword actions (701) | ops + `action` macros | keyword library (7.5) |
| Keyword abilities (702) | `KeywordAbilityDef` | keyword library (7.1) |
| Copying (707), face-down (708), DFC (712), merge (730) | layer `1a`/`1b`, `copy`, `changeFace`, `enters.copy` | `computeAll`, interpreter |
| Tokens and predefined tokens (111, 111.10) | `TokenDef` | interpreter + token index |

### 2.3 The final types: `packages/engine/src/types/ability.ts`

This is the replacement for the current file, compiled as shown. Its differences from the current file are listed in 4.4. Automation types live in the new `types/automation.ts` (shown after it). `Step` of the turn structure (`types/state.ts`) is imported as `TurnStep`; the effect union keeps the current name `EffectStep`.

```ts
/**
 * Structured ability model (final milestone 5 design, docs/design/m5-ability-model.md).
 *
 * Card behavior is DATA interpreted by the engine, never a hand-written function per card. Every node type
 * corresponds to a concept of the Comprehensive Rules (CR) and cites it. Conventions:
 *   - every union is discriminated by a short tag: kind (abilities, cost parts), op (steps), cond (conditions),
 *     q (quantities), ref (references), ev (events), s (static effects), layer (modifications), d (durations),
 *     b (replacement bodies);
 *   - JSON only: no functions, no `undefined`-sensitive logic, no code strings, so a node can be validated, cached,
 *     diffed, shipped in rules packs (docs/design/updates.md), produced by the LLM compile step, rendered back to
 *     English and executed;
 *   - there is NO "unsupported" escape inside an executable position. Anything the parser or the engine does not
 *     understand is a MANUAL node of the smallest enclosing unit (ManualAbilityDef, `manual` step, `ask` condition or
 *     quantity, manual cost part), see section 10 of the design;
 *   - a player who acts is always named: `who`, `payer`, `source`, `caster` are REQUIRED wherever a wrong default
 *     would change the rules (a missing `who` is a compile error, not a silent "you").
 */
import type { Color, ManaCost, ManaType } from './mana';
import type { Step as TurnStep, ZoneKind } from './state';

/** Version of this schema. Rules-pack entries and caches record it; a pack newer than the engine cannot be used (updates.md). */
export const ABILITY_MODEL_VERSION = 1;

// ---------------------------------------------------------------------------
// 0. Small shared types
// ---------------------------------------------------------------------------

/** Zones (CR 400.1). */
export type ZoneName = ZoneKind;

/** A name an earlier step gave to the objects/players it acted on ("it", "that creature", "the exiled card"). */
export type Name = string;

/** Key joining two abilities of one object that CR 607 links ("the exiled card", "the chosen color"). */
export type LinkId = string;

/** Counter kinds (CR 122.1): "+1/+1", "-1/-1", "loyalty", "lore", "charge", a keyword name ("flying"), "poison", "energy"... */
export type CounterKind = string;

export type Cmp = '<=' | '>=' | '==' | '!=' | '<' | '>';

/** Fixed number, "any number" (unbounded), or a computed value (e.g. "up to X"). */
export type Count = number | 'any' | Quantity;

export type PlayerPred = 'you' | 'opponent' | 'any' | PlayerRef;

export interface NumberCmp {
  op: Cmp;
  value: Quantity;
}

// ---------------------------------------------------------------------------
// 1. Abilities (CR 113)
// ---------------------------------------------------------------------------

export type AbilityDef =
  | SpellAbilityDef // CR 113.3a
  | ActivatedAbilityDef // CR 602, 605 (mana), 606 (loyalty)
  | TriggeredAbilityDef // CR 603
  | StaticAbilityDef // CR 604 (continuous, replacement, prevention, cost, restriction, rule-modifying)
  | KeywordAbilityDef // CR 702, implemented once in the keyword library
  | ChapterAbilityDef // CR 714 (sugar, expands to a triggered ability)
  | ClassLevelDef // CR 716
  | LevelBracketDef // CR 711
  | ManualAbilityDef; // text the engine does not automate

export interface Provenance {
  /** Who produced this ability. `fallback` = the compiler could not do better than manual. */
  by: 'keyword' | 'template' | 'llm' | 'pack' | 'hand' | 'fallback';
  /** Template id, keyword name, pack version or LLM prompt version. */
  id?: string;
  /** A human reviewed it (hand-written data and reviewed LLM/pack entries). Unreviewed LLM data caps the card at `partial`. */
  reviewed?: boolean;
}

export interface AbilityBase {
  /** The Oracle text this ability was compiled from, reminder text removed, "~" for the object's own name. Display data: derived, stripped from packs and caches. */
  text: string;
  /** Ability word or flavor word prefix, e.g. "Landfall" (CR 207.2c-d). Has no rules meaning. */
  label?: string;
  /** Indices of the normalized Oracle lines this ability came from. Packs and caches store this instead of any text (IP hygiene, updates.md). */
  src?: number[];
  prov?: Provenance;
}

/** The effect of an instant or sorcery spell (CR 113.3a, 608.2). */
export interface SpellAbilityDef extends AbilityBase {
  kind: 'spell';
  effect: EffectProgram;
}

/** "[Cost]: [Effect.]" (CR 602). Mana abilities (CR 605) and loyalty abilities (CR 606) are flags, not kinds. */
export interface ActivatedAbilityDef extends AbilityBase {
  kind: 'activated';
  cost: CostDef;
  effect: EffectProgram;
  /** CR 605.1a: no target, could add mana, not a loyalty ability. Does not use the stack (CR 605.3b). */
  isMana?: boolean;
  /** CR 606: sorcery timing and at most one per planeswalker per turn (CR 606.3). */
  isLoyalty?: boolean;
  /** "Activate only as a sorcery." (CR 602.5d) */
  sorcerySpeed?: boolean;
  /** "Activate only once each turn." (CR 602.5b) and similar ("only twice each turn", exhaust: once per game). */
  limit?: { per: 'turn' | 'game' | 'combat'; max: number };
  /**
   * "Activate only if/during ..." (CR 602.5b). Unlike every other condition position, `{cond:'ask'}` is allowed here:
   * the controller attests the restriction when activating and the ability is `partial`.
   */
  onlyIf?: Condition;
  /** Zones the ability functions from (CR 113.6), default battlefield. */
  zone?: ZoneName[];
}

/** "When/Whenever/At [event], [effect]." (CR 603) */
export interface TriggeredAbilityDef extends AbilityBase {
  kind: 'triggered';
  trigger: TriggerDef;
  /** Intervening "if" (CR 603.4): checked when the event happens and again on resolution. Never `ask`: an unknown one makes the whole ability manual. */
  interveningIf?: Condition;
  effect: EffectProgram;
  /** "Do this only once each turn." (CR 603.2h) and "triggers only once". */
  limit?: { per: 'turn' | 'game'; max: number };
  zone?: ZoneName[];
}

/** A static ability (CR 604): one printed paragraph can generate several effects (CR 607.2h, 613.6). */
export interface StaticAbilityDef extends AbilityBase {
  kind: 'static';
  effects: StaticEffect[];
  /** "As long as [condition], ..." wraps every effect (CR 611.3a). Never `ask`. */
  condition?: Condition;
  /** Zones it functions in (CR 113.6, 604.5, 604.6): battlefield by default; stack for cost/cast statics; hand for "you may cast". */
  zone?: ZoneName[];
}

/** A keyword ability (CR 702). The keyword library turns it into flags, hooks, generated abilities and cast options. */
export interface KeywordAbilityDef extends AbilityBase {
  kind: 'keyword';
  /** Canonical lower-case keyword: "flying", "kicker", "ward", "protection", "landwalk", ... */
  keyword: string;
  /** Cost parameter (kicker {2}{G}, equip {1}, ward--pay 3 life, flashback, cycling, ...). */
  cost?: CostDef;
  /** Numeric parameter (crew 2, annihilator 2, bushido 1, toxic 1, ...). A plain number everywhere except "X" (e.g. Ward-style scaling): then a Quantity. */
  amount?: Quantity;
  /**
   * Qualifier in the canonical string form of rules/quality.ts (milestone 4): the quality of protection / hexproof from X
   * ("color:R", "type:Artifact", "subtype:goblins", "multicolored", "everything"), the land words of a landwalk ("snow swamp").
   * A quality the engine cannot test parses to nothing and the keyword stays manual text.
   */
  quality?: string;
  /** Object-quality parameter that IS a filter: what an Aura's enchant ability allows (CR 702.5a), affinity for X, ward on X. */
  filter?: ObjectFilter;
  /** "Enchant player" / "Enchant opponent" (CR 702.5a, 303.4a). */
  player?: 'any' | 'opponent' | 'you';
}

/** Saga chapters "I, II -- ..." (CR 714). Expands to a triggered ability on lore counters (CR 714.2). */
export interface ChapterAbilityDef extends AbilityBase {
  kind: 'chapter';
  chapters: number[];
  effect: EffectProgram;
}

/** Class level N (CR 716): level-up activated ability plus abilities that function from that level on. */
export interface ClassLevelDef extends AbilityBase {
  kind: 'classLevel';
  level: number;
  /** Cost to reach this level (absent for level 1). */
  cost?: CostDef;
  abilities: AbilityDef[];
}

/** One bracket of a leveler card (CR 711.2): while the level counter count is in range, these P/T and abilities apply. */
export interface LevelBracketDef extends AbilityBase {
  kind: 'levelBracket';
  min: number;
  max: number | null;
  power?: string;
  toughness?: string;
  abilities: AbilityDef[];
}

/**
 * Text the engine cannot automate (docs/ARCHITECTURE.md item 5). Never silently skipped:
 *   spell:      a manualResolve prompt on resolution;
 *   activated:  the normal activation flow with the understood `cost`, then manualResolve;
 *   triggered:  listed in the "Triggers to check" tray with a "Trigger now" button; when `effect` is present
 *               (the effect was understood, only the event could not be detected) the button goes through normal
 *               announcement (targets, modes) and the effect is automated;
 *   static:     an "unenforced rule" chip while the object is in a functional zone;
 *   unknown:    shown on the card, nothing offered.
 */
export interface ManualAbilityDef extends AbilityBase {
  kind: 'manual';
  reason: string;
  shape: 'spell' | 'activated' | 'triggered' | 'static' | 'unknown';
  /** A cost that WAS understood (so the engine can still make players pay it), for shape 'activated'. */
  cost?: CostDef;
  /** An effect that WAS understood, for shape 'triggered' (manual trigger detection) and 'activated'. */
  effect?: EffectProgram;
  /** The line is an activated mana ability the recognizer rejected: the controller can still run it by hand (CR 605.3b). */
  mana?: boolean;
  /** Chip lifetime for one-shot text that works like a replacement/prevention shield ("If ... would die this turn, exile it instead"). */
  reminder?: Duration;
}

// ---------------------------------------------------------------------------
// 2. Costs (CR 118, 601.2f-h, 602.2)
// ---------------------------------------------------------------------------

export interface CostDef {
  mana?: ManaCost;
  tap?: boolean; // {T}, CR 107.5
  untap?: boolean; // {Q}
  /** Loyalty cost +N / -N / 0 (CR 606.4). */
  loyalty?: number;
  other?: CostPart[];
}

export type CostPart =
  | { kind: 'sacrifice'; filter: ObjectFilter; count: Count; self?: boolean }
  | { kind: 'payLife'; amount: Quantity }
  | { kind: 'discard'; filter?: ObjectFilter; count: Count; random?: boolean; self?: boolean; hand?: boolean }
  | { kind: 'exileFrom'; zone: ZoneName; filter?: ObjectFilter; count: Count; self?: boolean }
  | { kind: 'tapUntapped'; filter: ObjectFilter; count: Count; other?: boolean }
  /** Crew/saddle style: tap any number of untapped creatures with total power N or more (CR 702.122a). */
  | { kind: 'tapPower'; filter: ObjectFilter; power: Quantity; other?: boolean }
  | { kind: 'removeCounters'; counter: CounterKind; count: Quantity; self?: boolean; filter?: ObjectFilter }
  | { kind: 'putCounters'; counter: CounterKind; count: Quantity; self?: boolean; filter?: ObjectFilter }
  | { kind: 'returnToHand'; filter: ObjectFilter; count: Count; self?: boolean }
  | { kind: 'reveal'; zone: 'hand'; filter?: ObjectFilter; count: Count; self?: boolean }
  | { kind: 'mill'; count: Quantity }
  | { kind: 'payEnergy'; amount: Quantity }
  /** A keyword action used as a cost: exert, collect evidence N, forage, blight N, waterbend {N}, behold ... */
  | { kind: 'action'; action: KeywordActionName; arg?: Quantity }
  /** One cost word the compiler did not understand: the controller confirms it was paid; declining cancels the activation (CR 733.1). */
  | { kind: 'manual'; text: string };

// ---------------------------------------------------------------------------
// 3. Effect programs: targets, modes, steps (CR 115, 601.2b-d, 608.2, 700.2)
// ---------------------------------------------------------------------------

export interface EffectProgram {
  /**
   * Targets announced when the object goes on the stack (CR 115.1, 601.2c). Ids are unique inside the WHOLE ability,
   * including its modes (a modal ability numbers t0, t1, ... across all of its modes), because CR 608.2b is decided once
   * over the targets of all chosen modes.
   */
  targets: TargetSpec[];
  /** "Choose one --" (CR 700.2). Chosen modes run first, in printed order (CR 700.2d), then `steps`. */
  modes?: ModeSpec;
  /** Instructions performed in order on resolution (CR 608.2c). */
  steps: EffectStep[];
}

export interface ModeSpec {
  min: Count;
  max: Count;
  /** "You may choose the same mode more than once." (CR 700.2d) */
  allowRepeat?: boolean;
  /** Who chooses; the controller by default (CR 700.2e for others, CR 603.3c for triggers). */
  chooser?: PlayerRef;
  /** Condition under which the count changes, e.g. "If this spell was kicked, choose any number instead." (CR 601.4) */
  override?: { when: Condition; min: Count; max: Count };
  /** Additional cost of a mode (CR 700.2h). */
  options: { text: string; program: EffectProgram; cost?: CostDef }[];
}

export interface TargetSpec {
  /** Referenced as { ref: 'target', id } by steps. */
  id: string;
  kind: 'object' | 'player' | 'objectOrPlayer' | 'anyTarget' | 'spell' | 'ability' | 'stackObject';
  filter?: ObjectFilter;
  players?: { who: PlayerPred };
  /** Number of targets (CR 601.2c: variable counts are announced before the targets). */
  min: Count;
  max: Count;
  /** Prompt text, e.g. "target creature you don't control". Display data. */
  text: string;
  /** "another target ..." / "two other target ...": must differ from these specs' targets (CR 115.3 allows reuse otherwise). */
  distinctFrom?: string[];
  /** The caster announces a division of damage/counters among the targets (CR 601.2d). Every target gets at least 1. */
  divide?: { what: 'damage' | 'counters' | 'other'; total: Quantity };
  /** "Any number of target creatures with total power 5 or less": a limit on a statistic summed over the chosen targets (CR 115.1). */
  groupLimit?: { stat: 'power' | 'toughness' | 'manaValue'; cmp: NumberCmp };
  /** Required only if a condition holds at announcement (kicker, a mode, a cost paid; CR 601.2c, 700.2c). */
  onlyIf?: Condition;
  /** A player other than the controller chooses (CR 601.7). */
  chooser?: PlayerRef;
}

// ---- References ------------------------------------------------------------

/** Handle on one or more objects. Plural references (each, linked, bound) stand for sets. */
export type ObjRef =
  | { ref: 'self' } // the source object; uses last known information when it has left (CR 608.2h, 113.7a)
  | { ref: 'target'; id: string }
  | { ref: 'bound'; name: Name }
  | { ref: 'event'; role: EventRole }
  | { ref: 'attachedTo' } // "enchanted creature", "equipped creature", "fortified land" (CR 303.4, 301.5)
  | { ref: 'linked'; link: LinkId } // CR 607.2a, 607.2c: objects the linked ability exiled/created/put onto the battlefield
  | { ref: 'each'; filter: ObjectFilter } // "each creature", "all creatures you control"
  | { ref: 'subject' } // inside a continuous effect: the object currently being modified ("its mana value")
  | { ref: 'topCards'; player: PlayerRef; count: Quantity; zone?: 'library' } // ordered, top first
  | { ref: 'union'; of: ObjRef[] }
  /**
   * A set of objects fixed when a resolved effect was created (CR 611.2c). Written ONLY by the `effect` handler into
   * ContinuousEffectRec.effect (it rewrites every target/bound/event/linked/self reference and, for effects that change characteristics or
   * control, the `each` set); never by parsers, packs or the LLM (the validator rejects it in card data). Handles whose object is no longer in
   * the expected zone are skipped (a new object, CR 400.7).
   */
  | { ref: 'fixed'; objects: { id: string; zone: ZoneName }[] };

export type PlayerRef =
  | { ref: 'you' } // controller of the spell/ability (CR 109.5)
  | { ref: 'target'; id: string }
  | { ref: 'controllerOf'; object: ObjRef }
  | { ref: 'ownerOf'; object: ObjRef }
  | { ref: 'anOpponent' } // "an opponent": the controller picks one in multiplayer (CR 601.7a)
  | { ref: 'each'; who: 'player' | 'opponent' | 'otherPlayer' } // simultaneous / APNAP (CR 608.2e-f)
  | { ref: 'event'; role: EventRole }
  | { ref: 'bound'; name: Name }
  | { ref: 'linked'; link: LinkId } // "the chosen player", "the player you chose" (CR 607.2d)
  | { ref: 'active' } // CR 102.1
  | { ref: 'defending' } // CR 506.2
  | { ref: 'iterating' } // the current player inside a forEach over players
  /** Players fixed when a resolved effect was created (the player counterpart of ObjRef 'fixed'; written only by the `effect` handler and by the migration of milestone 4's player restrictions). */
  | { ref: 'fixed'; players: string[] };

/** Something damage, counters or a step can be directed at. */
export type Ref = ObjRef | PlayerRef;

/** What a trigger event exposes to its effect ("that creature", "that player", "that much"). Valid roles per event: design section 3.5. */
export type EventRole =
  | 'subject' // the object that did/underwent the event (for zone changes: the object in its new zone, CR 603.6)
  | 'object' // the second object (the blocked attacker, the damaged object)
  | 'source' // the damage source, the source of the targeting spell or ability
  | 'player' // the player who acted (caster, drawer, the player who gained life, the controller of the targeting spell or ability)
  | 'recipient' // the player damaged
  | 'spell' // the spell OR ability on the stack that the event concerns (cast spell, spell or ability that targeted)
  | 'attacker'
  | 'blocker'
  | 'defender'
  | 'newObject'; // the token or object created/produced by the event

// ---- Filters ---------------------------------------------------------------

/**
 * A predicate over objects. All set fields are ANDed; anyOf/not give full boolean structure.
 * There is no way to say "a word I could not test": a sentence whose filter cannot be expressed here is manual (design 6.6).
 * A field the running engine cannot evaluate (not in EngineCapabilities.filters) makes the unit that uses it manual (degrade pass).
 */
export interface ObjectFilter {
  anyOf?: ObjectFilter[];
  not?: ObjectFilter;

  /** Where to look, default battlefield. */
  zone?: ZoneName | ZoneName[] | 'any';
  controller?: PlayerPred;
  owner?: PlayerPred;

  // printed/derived characteristics (always read through the characteristics function, CR 109.3)
  types?: string[]; // any of
  allTypes?: string[];
  notTypes?: string[];
  subtypes?: string[]; // any of
  notSubtypes?: string[];
  supertypes?: string[];
  notSupertypes?: string[];
  colors?: Color[]; // any of
  notColors?: Color[];
  colorless?: boolean;
  multicolored?: boolean;
  monocolored?: boolean;
  name?: string;
  notName?: string;
  manaValue?: NumberCmp;
  power?: NumberCmp;
  toughness?: NumberCmp;
  keyword?: string | string[]; // has any of these keyword abilities
  notKeyword?: string | string[];
  /** Has an ability of a kind: "an activated ability", "a mana ability", "a triggered ability". */
  hasAbility?: 'activated' | 'mana' | 'triggered' | 'static';

  // status
  tapped?: boolean;
  token?: boolean;
  /** Tokens are not cards (CR 111.1): `isCard:true` matches cards only, `token:true` tokens only. */
  isCard?: boolean;
  faceDown?: boolean;
  transformed?: boolean;
  isCopy?: boolean;
  attacking?: boolean | { defender: PlayerPred };
  blocking?: boolean;
  blocked?: boolean;
  /** Is the object the source ("this creature"). */
  self?: boolean;
  /** Is one of these specific objects ("if THAT creature would die"): a reference resolved when an effect is created; see ObjRef 'fixed'. */
  is?: ObjRef;
  /** Is not the source ("another", "other"). */
  other?: boolean;
  /** Is attached to / has attachments. */
  attached?: boolean;
  /** Enchanted / equipped by the source. */
  attachedToSource?: boolean;
  counters?: { kind: CounterKind; cmp?: NumberCmp };

  // history (read from GameState.history, CR 603.4 style "this turn" facts)
  enteredThisTurn?: boolean;
  /** "that was dealt damage this turn" (Death-Rattle Oni, Swift Demise, Restore the Peace). */
  dealtDamageThisTurn?: boolean;
  attackedThisTurn?: boolean;
  blockedThisTurn?: boolean;

  /** Shares a quality with another object: "that shares a creature type with it". */
  sharesWith?: { with: ObjRef; quality: 'creatureType' | 'color' | 'cardType' | 'name' | 'landType' };
  /** Matches a quality chosen by a linked ability: "creatures of the chosen type", "the chosen color". */
  chosen?: { link: LinkId; quality: 'color' | 'creatureType' | 'cardType' | 'landType' | 'cardName' };
  /** Stack objects: what kind, and what it targets ("spell that targets ~", CR 115.9b). */
  stackKind?: 'spell' | 'activatedAbility' | 'triggeredAbility' | 'ability' | 'copy';
  targets?: ObjRef | PlayerRef;
  castFrom?: ZoneName;
}

// ---- Quantities ------------------------------------------------------------

export type Quantity =
  | number
  | { q: 'X' } // the announced X of the spell/ability being cast or resolved (CR 107.3)
  | { q: 'var'; name: string } // a value fixed earlier by a `let`, "that much", "where X is ..." (CR 608.2h)
  | { q: 'count'; of: ObjRef } // number of objects in a set: "the number of creatures you control"
  | { q: 'countPlayers'; of: PlayerRef }
  | { q: 'stat'; stat: 'power' | 'toughness' | 'manaValue' | 'loyalty' | 'defense'; of: ObjRef; sum?: boolean }
  | { q: 'life'; of: PlayerRef }
  | { q: 'zoneSize'; zone: ZoneName; of: PlayerRef }
  | { q: 'counters'; on: Ref; kind: CounterKind | 'any' }
  | { q: 'devotion'; to: Color[]; of: PlayerRef } // CR 700.5
  | { q: 'distinct'; what: 'colors' | 'cardTypes' | 'creatureTypes' | 'names' | 'landTypes' | 'manaValues'; among: ObjRef }
  /** Number of events that happened in a scope: "for each creature that died this turn", "the number of spells you've cast this turn" (reads GameState.history). */
  | { q: 'happenedCount'; event: EventPattern; scope: 'turn' | 'combat' | 'game'; by?: PlayerPred }
  | { q: 'eventAmount' } // "that much": damage dealt, life gained, cards drawn, counters put (CR 603.4 context)
  | { q: 'resultCount'; step: Name } // "the number of cards discarded this way"
  | { q: 'targetCount'; id: string } // number of targets announced for a spec of the SAME ability (CR 115.9a)
  | { q: 'spellTargetCount' } // the number of targets of the spell this static ability is on; only in self cost modifiers (CR 601.2c, 601.2f: costs are determined after targets)
  | { q: 'dieResult' }
  | { q: 'speed' | 'age' | 'level' | 'turnNumber' | 'cardsDrawnThisTurn' | 'spellsCastThisTurn' | 'lifeGainedThisTurn' }
  | { q: 'math'; op: '+' | '-' | '*' | 'floorDiv' | 'ceilDiv' | 'min' | 'max'; args: Quantity[] }
  /**
   * Keep re-evaluating (a granted characteristic-defining value); otherwise values are fixed when a resolved effect
   * is created (CR 611.2d, 608.2h: the `effect` handler replaces every non-live quantity by its number).
   */
  | { q: 'live'; value: Quantity }
  /** MANUAL: the controller types the number. Allowed only inside steps (never in costs, targets, triggers or static conditions). */
  | { q: 'ask'; text: string };

// ---- Conditions ------------------------------------------------------------

export type Condition =
  | { cond: 'all'; of: Condition[] }
  | { cond: 'any'; of: Condition[] }
  | { cond: 'not'; of: Condition }
  | { cond: 'compare'; left: Quantity; op: Cmp; right: Quantity }
  /** "if you control a creature", "if an opponent has no cards in hand". */
  | { cond: 'exists'; of: ObjRef; atLeast?: Quantity }
  /** "if it's a creature card", "if that creature has flying", "if enchanted creature is red". */
  | { cond: 'matches'; object: ObjRef; filter: ObjectFilter }
  | { cond: 'turnOf'; whose: PlayerPred; step?: TurnStep | TurnStep[] }
  /** Cast history of THIS object (CR 607.2i-j, 400.7d): kicked, an alternative cost, the zone it was cast from. */
  | { cond: 'wasCast'; kicked?: boolean | string; via?: string; from?: ZoneName; xAtLeast?: number }
  /** History queries over a scope: "if a creature died this turn", "if you've cast two spells this turn". */
  | { cond: 'happened'; event: EventPattern; scope: 'turn' | 'combat' | 'game'; times?: NumberCmp; by?: PlayerPred }
  /** Result of an earlier step: "if you do", "if you don't", "if that spell is countered this way" (CR 118.12, 603.12, 608.2c). */
  | { cond: 'did'; step: Name; not?: boolean }
  | { cond: 'designation'; who: PlayerRef; what: 'monarch' | 'initiative' | 'citysBlessing' | 'day' | 'night' }
  | { cond: 'chosen'; link: LinkId; equals: string }
  /** MANUAL: the named player (controller by default) is asked yes/no. Allowed only in step guards, `if` steps and activation restrictions. */
  | { cond: 'ask'; text: string; who?: PlayerRef };

// ---- Durations -------------------------------------------------------------

export type Duration =
  | { d: 'endOfTurn' } // "until end of turn", ends in the cleanup step (CR 514.2)
  | { d: 'endOfCombat' }
  | { d: 'permanent' } // no stated duration: until end of game (CR 611.2a)
  | { d: 'whileSource'; as: 'onBattlefield' | 'controlled' | 'attached' | 'tapped' } // "for as long as ..." (CR 611.2b)
  | { d: 'until'; event: EventPattern } // "until ~ leaves the battlefield" (CR 610.3)
  | { d: 'untilNextTurn'; whose: PlayerRef } // "until your next turn"
  | { d: 'untilNextStep'; step: TurnStep; whose?: PlayerPred }
  | { d: 'asLongAs'; cond: Condition };

// ---------------------------------------------------------------------------
// 4. Steps: the effect vocabulary (CR 609-610, 701)
// ---------------------------------------------------------------------------

export interface StepBase {
  /** Name the objects/players this step acted on or created, so later steps can say "it"/"that creature" (CR 608.2c). */
  as?: Name;
  /** Guard: the step is skipped unless the condition holds. */
  guard?: Condition;
  /** Index of the sentence inside the ability's text this step came from (stored form of the display text). */
  sentence?: number;
  /** Source sentence text, for manual fallback prompts and the log. Display data, hydrated from `sentence`. */
  span?: string;
}

export type EffectStep =
  // --- control flow -----------------------------------------------------------
  | (StepBase & { op: 'if'; cond: Condition; then: EffectStep[]; else?: EffectStep[] }) // also the form of self-replacement "instead" (CR 614.15)
  | (StepBase & { op: 'may'; who: PlayerRef; do: EffectStep[]; otherwise?: EffectStep[] }) // CR 608.2d; `as` records whether they did
  /**
   * "[Who] may pay [cost]. If [they do], [then]; if they don't, [else]." CR 118.12. "X unless [player] pays [cost]" is `else:[X]`
   * (CR 118.12a: the payer decides FIRST, so a "you may" inside the else branch is asked afterwards: Rhystic Study).
   * `times` pays the cost that many times (cumulative upkeep). `mandatory` = "pay N life" as an instruction, no choice (CR 119.4, 118.3).
   */
  | (StepBase & { op: 'pay'; who: PlayerRef; cost: CostDef; times?: Quantity; mandatory?: boolean; then?: EffectStep[]; else?: EffectStep[] })
  | (StepBase & { op: 'forEach'; over: Ref; as: Name; do: EffectStep[] }) // one at a time (CR 608.2f)
  | (StepBase & { op: 'repeat'; times: Quantity; do: EffectStep[] })
  | (StepBase & { op: 'let'; name: string; value: Quantity }) // fix a value once (CR 608.2h, 611.2d)
  | (StepBase & { op: 'chooseObjects'; who: PlayerRef; from: ObjRef; min: Count; max: Count; as: Name; random?: boolean })
  | (StepBase & { op: 'chooseValue'; who: PlayerRef; what: ChoiceKind; as: Name; link?: LinkId; options?: string[]; min?: Quantity; max?: Quantity })
  /** Players resolve it by hand (manualResolve). `reminder` also leaves a chip for text that outlives the step (manual shields). */
  | (StepBase & { op: 'manual'; text: string; reason: string; reminder?: Duration })
  // --- damage and life ----------------------------------------------------------
  | (StepBase & { op: 'damage'; source: ObjRef; to: Ref; amount: Quantity; divided?: 'announced' | 'evenlyRoundDown' | 'evenlyRoundUp'; unpreventable?: boolean })
  | (StepBase & { op: 'gainLife'; who: PlayerRef; amount: Quantity })
  | (StepBase & { op: 'loseLife'; who: PlayerRef; amount: Quantity })
  | (StepBase & { op: 'setLife'; who: PlayerRef; value: Quantity })
  // --- cards ---------------------------------------------------------------------
  | (StepBase & { op: 'draw'; who: PlayerRef; count: Quantity })
  | (StepBase & { op: 'discard'; who: PlayerRef; count: Quantity | 'hand'; filter?: ObjectFilter; mode?: 'choose' | 'random' | 'opponentChooses' })
  | (StepBase & { op: 'mill'; who: PlayerRef; count: Quantity })
  | (StepBase & { op: 'scry'; who: PlayerRef; count: Quantity })
  | (StepBase & { op: 'surveil'; who: PlayerRef; count: Quantity })
  | (StepBase & { op: 'reveal'; who: PlayerRef; what: ObjRef; to?: 'all' | PlayerRef })
  | (StepBase & { op: 'look'; who: PlayerRef; at: ObjRef })
  | (StepBase & { op: 'search'; who: PlayerRef; zone: ZoneName; owner?: PlayerRef; filter: ObjectFilter; min?: Count; max: Count; reveal?: boolean; as: Name })
  | (StepBase & { op: 'shuffle'; who: PlayerRef })
  /** `separator` separates the cards into two piles, `chooser` picks one (Fact or Fiction; no dedicated CR rule, choices follow CR 608.2d). */
  | (StepBase & { op: 'piles'; cards: ObjRef; separator: PlayerRef; chooser: PlayerRef; chosen: Name; other: Name })
  // --- moving objects --------------------------------------------------------------
  | (StepBase & { op: 'move'; what: ObjRef; to: Destination; until?: Duration; link?: LinkId })
  | (StepBase & { op: 'destroy'; what: ObjRef; regeneration?: 'allowed' | 'cant' })
  | (StepBase & { op: 'sacrifice'; what: ObjRef })
  | (StepBase & { op: 'sacrificeChoice'; who: PlayerRef; filter: ObjectFilter; count: Quantity; mode?: 'choose' | 'all' })
  | (StepBase & { op: 'counter'; what: ObjRef; to?: Destination })
  | (StepBase & { op: 'createToken'; who: PlayerRef; token: TokenDef; count: Quantity; tapped?: boolean; attacking?: boolean; attachTo?: ObjRef; counters?: CounterSpec[]; link?: LinkId })
  | (StepBase & { op: 'copy'; what: ObjRef; result: 'spell' | 'token'; who: PlayerRef; count?: Quantity; newTargets?: boolean | 'may'; except?: Modification[]; tapped?: boolean; attacking?: boolean })
  | (StepBase & { op: 'tap'; what: ObjRef })
  | (StepBase & { op: 'untap'; what: ObjRef })
  | (StepBase & { op: 'attach'; what: ObjRef; to: ObjRef | null })
  | (StepBase & { op: 'changeFace'; what: ObjRef; to: 'transform' | 'convert' | 'faceUp' | 'faceDown' | 'flip'; manifest?: boolean })
  | (StepBase & { op: 'phaseOut'; what: ObjRef })
  | (StepBase & { op: 'regenerate'; what: ObjRef; duration?: Duration })
  | (StepBase & { op: 'removeFromCombat'; what: ObjRef })
  | (StepBase & { op: 'fight'; a: ObjRef; b: ObjRef })
  | (StepBase & { op: 'exchange'; a: Ref; b: Ref; what: 'control' | 'life' | 'hands' | 'powerToughness' })
  | (StepBase & { op: 'cast'; who: PlayerRef; what: ObjRef; free?: boolean; costChange?: CostChange; optional?: boolean })
  // --- counters --------------------------------------------------------------------------
  | (StepBase & { op: 'putCounters'; on: Ref; kind: CounterKind; count: Quantity })
  | (StepBase & { op: 'removeCounters'; from: Ref; kind: CounterKind | 'any'; count: Quantity | 'all' })
  | (StepBase & { op: 'moveCounters'; from: ObjRef; to: ObjRef; kind: CounterKind; count: Quantity | 'all' })
  // --- mana ----------------------------------------------------------------------------
  /** `units` is the shape M3 already runs (one entry per unit, each a list of the types it may be). */
  | (StepBase & { op: 'addMana'; who: PlayerRef; units?: ManaType[][]; dynamic?: ManaProduction; restriction?: ManaRestriction })
  // --- durations, shields, delayed and reflexive triggers -----------------------------
  | (StepBase & { op: 'effect'; effects: StaticEffect[]; duration: Duration })
  | (StepBase & { op: 'delay'; when: DelayedWhen; do: EffectStep[]; capture?: Name[]; duration?: Duration })
  | (StepBase & { op: 'reflexive'; when: { did: Name }; targets: TargetSpec[]; do: EffectStep[] }) // CR 603.12
  // --- the game itself ---------------------------------------------------------------------
  | (StepBase & { op: 'extraTurn'; who: PlayerRef; count: Quantity })
  | (StepBase & { op: 'extraPhase'; phase: 'combat' | 'main'; after?: TurnStep })
  | (StepBase & { op: 'endTurn' })
  | (StepBase & { op: 'winGame'; who: PlayerRef })
  | (StepBase & { op: 'loseGame'; who: PlayerRef })
  | (StepBase & { op: 'createEmblem'; who: PlayerRef; abilities: AbilityDef[] })
  | (StepBase & { op: 'rollDie'; who: PlayerRef; sides: number; count?: number; table?: { min: number; max: number; do: EffectStep[] }[] })
  | (StepBase & { op: 'flipCoin'; who: PlayerRef; onWin?: EffectStep[]; onLose?: EffectStep[] })
  | (StepBase & { op: 'designate'; who: PlayerRef; what: 'monarch' | 'initiative' | 'day' | 'night' })
  /** Any other CR 701 keyword action, implemented once in the keyword library as a macro over the ops above. */
  | (StepBase & { op: 'action'; action: KeywordActionName; subject?: Ref; who: PlayerRef; n?: Quantity; arg?: string });

export type EffectOp = EffectStep['op'];

export type ChoiceKind = 'color' | 'creatureType' | 'cardType' | 'landType' | 'cardName' | 'number' | 'player' | 'opponent' | 'option' | 'oddEven';

/** CR 701 keyword actions that are not primitive steps. Library macros expand them (CR 701.x cited per action in design section 7.5). */
export type KeywordActionName =
  | 'investigate' | 'explore' | 'amass' | 'connive' | 'populate' | 'proliferate' | 'bolster' | 'adapt' | 'monstrosity'
  | 'support' | 'fabricate' | 'manifest' | 'cloak' | 'manifestDread' | 'suspect' | 'incubate' | 'discover' | 'learn'
  | 'goad' | 'detain' | 'exert' | 'clash' | 'vote' | 'ringTempts' | 'venture' | 'timeTravel' | 'meld' | 'planeswalk'
  | 'doubleCounters' | 'doublePT' | 'collectEvidence' | 'forage' | 'blight' | 'endure' | 'behold' | 'waterbend' | 'airbend' | 'earthbend'
  | 'abandon' | 'setInMotion' | 'assemble' | 'harness' | 'openAttraction' | 'rollToVisit' | 'cascade' | 'cycle' | 'transmute';

interface DestinationBase {
  /** Whose library/graveyard/hand/exile bin: the owner by default (CR 400.3). */
  owner?: PlayerRef;
  /** Library placement; `nth` counts from the top (CR 401.3). */
  position?: 'top' | 'bottom' | { nth: Quantity } | 'random';
  /** When several cards go to an ordered zone: owner's choice ("in any order"), random, or as listed. */
  order?: 'chosen' | 'random' | 'asBound';
  tapped?: boolean;
  faceDown?: boolean;
  transformed?: boolean;
  attacking?: boolean | { defender: PlayerRef };
  attachedTo?: ObjRef;
  counters?: CounterSpec[];
}

/**
 * Where an object goes. Moving to the battlefield REQUIRES `controller` (CR 110.2: an object put onto the battlefield enters under the
 * control of the player who put it there unless the effect says otherwise, and that player is not always the controller of the effect:
 * Path to Exile's searching player). "under its owner's control" is 'owner'.
 */
export type Destination = DestinationBase & (
  | { zone: 'battlefield'; controller: 'owner' | PlayerRef }
  | { zone: Exclude<ZoneName, 'battlefield'>; controller?: undefined }
);

export interface CounterSpec {
  kind: CounterKind;
  count: Quantity;
}

export interface CostChange {
  /** "without paying its mana cost" is `free`; otherwise reduce/increase/replace. */
  kind: 'reduce' | 'increase' | 'set';
  mana?: ManaCost;
  generic?: Quantity;
}

export type ManaProduction =
  | { kind: 'anyColor'; count: Quantity } // "one mana of any color" (each unit may differ)
  | { kind: 'anyOneColor'; count: Quantity } // "N mana of any one color"
  | { kind: 'chosen'; link: LinkId; count: Quantity } // "the chosen color"
  | { kind: 'ofType'; type: ManaType; count: Quantity } // "an amount of {G} equal to ..."
  | { kind: 'sameAsSpent' };

/**
 * "Spend this mana only to cast creature spells" (Cavern of Souls, 177 cards). Structured so the payment code can ENFORCE it;
 * restriction wording the engine cannot represent here makes the `addMana` step manual (never a free-text string that is ignored).
 */
export interface ManaRestriction {
  /** The mana can be spent only on spells matching this filter (a missing field means "not on those"). */
  spells?: ObjectFilter;
  /** ... and/or on activating abilities of sources matching this filter. */
  abilities?: ObjectFilter;
  /** Spells cast with this mana get a rider (Cavern of Souls: "that spell can't be countered"). */
  spellRider?: 'cantBeCountered';
}

export type DelayedWhen =
  /** "at the beginning of the next end step", "at the beginning of your next upkeep" (CR 603.7). */
  | { at: 'step'; step: TurnStep; whose?: PlayerPred; next?: boolean }
  | { at: 'endOfCombat' }
  /** "when ~ leaves the battlefield", "the next time ... this turn" */
  | { at: 'event'; event: EventPattern };

/** The definition of a token (CR 111.2-111.4) or a predefined token (CR 111.10). */
export interface TokenDef {
  /** CR 111.10: Treasure, Food, Clue, Blood, Map, Powerstone, Gold, Junk, Shard, Incubator ... (rules text comes from the CR). */
  predefined?: string;
  name?: string;
  colors?: Color[];
  supertypes?: string[];
  types?: string[];
  subtypes?: string[];
  power?: Quantity;
  toughness?: Quantity;
  /** Keyword shorthand ("with flying"). */
  keywords?: string[];
  /** Full nested abilities ("with 'When this creature dies, ...'"): 4% of cards. */
  abilities?: AbilityDef[];
}

// ---------------------------------------------------------------------------
// 5. Events and triggers (CR 603, 700.4)
// ---------------------------------------------------------------------------

export interface TriggerDef {
  /** Any of these events (disjunction): "whenever ~ enters or attacks". */
  on: EventPattern[];
  /** "one or more" triggers: once for the whole simultaneous batch (CR 603.2c). */
  batch?: boolean;
  /** FAST4 T27: a condition of the trigger event ("attacks while you control ...", "during an opponent's turn"), judged only when the event happens (CR 603.1, 603.2; not an intervening "if", CR 603.4). */
  while?: Condition;
  /** FAST4 T27: "for the first time each turn": only the first matching event of the turn, read from the game history (CR 603.2, 603.2c). */
  first?: 'turn';
}

/**
 * A pattern over the engine's semantic event stream. The same patterns serve triggers (CR 603.2),
 * replacement/prevention effects ("would", CR 614.1), delayed triggers, durations and history conditions.
 * Look-back (CR 603.10) is decided by code from the pattern, never stored per card. An unparsed trigger is never a pattern:
 * it makes the whole ability manual (ManualAbilityDef shape 'triggered', optionally with the understood effect).
 */
export type EventPattern =
  | { ev: 'zoneChange'; subject: ObjectFilter; from?: ZoneName | ZoneName[]; to?: ZoneName | ZoneName[] }
  | { ev: 'cast'; player?: PlayerPred; spell?: ObjectFilter; from?: ZoneName; orCopy?: boolean }
  | { ev: 'activate'; player?: PlayerPred; source?: ObjectFilter; manaAbility?: boolean }
  | { ev: 'attacks'; attacker?: ObjectFilter; alone?: boolean; defender?: PlayerPred | 'planeswalker' | 'battle'; count?: NumberCmp }
  | { ev: 'blocks'; blocker?: ObjectFilter; attacker?: ObjectFilter }
  | { ev: 'becomesBlocked'; attacker?: ObjectFilter; by?: ObjectFilter }
  | { ev: 'damage'; source?: ObjectFilter; recipient?: { object?: ObjectFilter; player?: PlayerPred }; combat?: boolean; amount?: NumberCmp }
  | { ev: 'step'; step: TurnStep; whose?: PlayerPred }
  | { ev: 'life'; change: 'gain' | 'loss'; player?: PlayerPred; amount?: NumberCmp }
  | { ev: 'draw'; player?: PlayerPred; nth?: number }
  | { ev: 'becomes'; what: 'tapped' | 'untapped' | 'targeted' | 'attached' | 'unattached' | 'transformed' | 'turnedFaceUp' | 'monstrous' | 'renowned' | 'saddled' | 'crewed'; object: ObjectFilter; by?: ObjectFilter }
  | { ev: 'counters'; change: 'put' | 'removed'; kind?: CounterKind; on: ObjectFilter | { player: PlayerPred }; atLeast?: Quantity }
  | { ev: 'action'; verb: KeywordActionName | 'sacrifice' | 'discard' | 'cycle' | 'scry' | 'surveil' | 'search' | 'shuffle' | 'mill' | 'create' | 'playLand' | 'regenerate' | 'exile' | 'destroy' | 'tap' | 'untap' | 'counter' | 'attach' | 'transform' | 'reveal'; actor?: PlayerPred; object?: ObjectFilter }
  | { ev: 'createToken'; player?: PlayerPred; token?: ObjectFilter }
  | { ev: 'dieRoll'; player?: PlayerPred; result?: NumberCmp }
  | { ev: 'state'; cond: Condition }
  | { ev: 'beginTurn'; whose?: PlayerPred; extra?: boolean }
  | { ev: 'resolves'; what: ObjectFilter };

// ---------------------------------------------------------------------------
// 6. Static effects: continuous, cost, restriction, replacement, permission, rule-modifying (CR 604, 611-616, 117.7, 601.2f)
// ---------------------------------------------------------------------------

/** What an object's static ability or a resolved effect does. Evaluated continuously (static) or created once (`effect` step). */
export type StaticEffect =
  | ContinuousEffectDef
  | CostModDef
  | RestrictionDef
  | ReplacementDef
  | PermissionDef
  | RuleModDef
  | TriggerModDef
  | AdditionalCostDef
  | AlternativeCostDef
  | PregameDef;

/** Continuous effects in layers (CR 613). Affected sets are re-evaluated for statics (CR 611.3a), locked in for resolved effects (CR 611.2c). */
export interface ContinuousEffectDef {
  s: 'continuous';
  affects: ObjRef | PlayerRef;
  mods: Modification[];
  /** Characteristic-defining ability (CR 604.3): applies in every zone, first within its layer (CR 613.3). */
  cda?: boolean;
}

export type Modification =
  /** Layer 1a: copy effects (CR 707, 613.2a). `except` are the copy exceptions ("except it's an artifact"). M6. */
  | { layer: '1a'; copyOf: ObjRef; except?: Modification[] }
  | { layer: '1b'; faceDown: true } // CR 708.2. M6.
  | { layer: 2; controller: PlayerRef }
  | { layer: 3; changeWord: { from: string; to: string; kind: 'color' | 'landType' | 'creatureType' } } // CR 612. M6.
  | { layer: 4; types?: TypeChange; subtypes?: TypeChange; supertypes?: TypeChange }
  | { layer: 5; colors: { set?: Color[]; add?: Color[]; remove?: Color[]; chosen?: LinkId } }
  | { layer: 6; add?: AbilityDef[]; removeAll?: boolean; remove?: string[]; cantHave?: string[] }
  | { layer: '7a'; power?: Quantity; toughness?: Quantity }
  | { layer: '7b'; power?: Quantity; toughness?: Quantity }
  | { layer: '7c'; power?: Quantity; toughness?: Quantity }
  | { layer: '7d'; switchPT: true };

export type Layer = Modification['layer'];

export interface TypeChange {
  /** "in addition to its other types". */
  add?: string[];
  /** "becomes a Mountain" (replaces the subtypes of that class; CR 305.7). */
  set?: string[];
  remove?: string[];
  /** All creature types (changeling, CR 702.73). */
  all?: boolean;
  /** The type chosen by a linked ability (CR 607.2d). */
  chosen?: LinkId;
}

/** "Spells you cast cost {1} less", "This spell costs {1} more for each target beyond the first" (CR 601.2f, 118.7-118.8). */
export interface CostModDef {
  s: 'costMod';
  /** What it applies to. `self` = the spell/ability this static ability is on (functions on the stack, CR 604.5). `caster` is REQUIRED. */
  applies: { self?: boolean; spells?: ObjectFilter; abilities?: { source?: ObjectFilter; kind?: 'activated' | 'loyalty' | 'mana' }; caster: PlayerPred };
  change: { kind: 'increase' | 'reduce' | 'set'; mana?: ManaCost; generic?: Quantity; floor?: 'zero' };
}

/** "Can't"/"must"/"only" effects (CR 614.17, 508.1d). They constrain actions; they are not replacement effects. */
export interface RestrictionDef {
  s: 'restrict';
  subject: ObjRef | PlayerRef;
  mode: 'cant' | 'mustIfAble' | 'onlyIf';
  action: RuleAction;
  /** The object the action concerns ("can't be blocked by creatures with power 2 or less", "can't cast spells with mana value 3 or less"). */
  other?: ObjectFilter;
  /** Limit rather than ban ("can't cast more than one spell each turn"). */
  max?: number;
  when?: Condition;
}

export type RuleAction =
  | 'attack' | 'block' | 'beBlocked' | 'beBlockedBy' | 'attackPlayer'
  | 'cast' | 'activate' | 'playLand' | 'draw' | 'gainLife' | 'loseLife' | 'lose' | 'win'
  | 'untap' | 'untapDuringUntapStep' | 'tap' | 'beTapped' | 'transform' | 'search' | 'sacrifice' | 'discard'
  | 'beTargeted' | 'beCountered' | 'beDestroyed' | 'beRegenerated' | 'beSacrificed' | 'beExiled' | 'beAttached' | 'beEnchanted' | 'beEquipped'
  | 'dealDamage' | 'receiveDamage' | 'preventDamage' | 'enter' | 'leave' | 'gainAbility' | 'haveCountersPut' | 'payLife' | 'castFromZone' | 'spendMana';

/** Replacement (CR 614), prevention (CR 615) and redirection (CR 614.9) effects. Event ordering: CR 616. Executed by the proposal pipeline (M6; design 8.5). */
export interface ReplacementDef {
  s: 'replace';
  /** The event that "would" happen. */
  replaces: EventPattern;
  body: ReplacementBody;
  condition?: Condition;
  /** "You may ..." (the affected object's controller or player chooses when applying, CR 616.1). */
  optional?: boolean;
  /** Self-replacement (CR 614.15): applied first (CR 616.1a). */
  selfReplacement?: boolean;
  /** Shield bookkeeping for resolved effects: "the next time", "prevent the next N damage" (CR 615.7-615.8). Static ones have none. */
  shield?: { uses: number | 'all'; amount?: Quantity };
}

export type ReplacementBody =
  /** Do these steps instead; the original event does not happen (CR 614.6). `event` roles stay readable. */
  | { b: 'instead'; do: EffectStep[] }
  /** Modify the event's parameters: amount, count, destination, entering status. */
  | { b: 'modify'; amount?: AmountChange; count?: AmountChange; destination?: Destination; to?: PlayerRef }
  | { b: 'prevent'; amount: Quantity | 'all'; then?: EffectStep[] } // CR 615
  | { b: 'redirect'; to: Ref } // CR 614.9
  | { b: 'skip' } // CR 614.10
  /**
   * Enters-the-battlefield modification (CR 614.1c-d, 614.12): tapped, tapped unless, with counters, choices, as a copy.
   * Choices are made first (CR 614.12a). `tappedUnlessPay` is the shock land ("you may pay 2 life; if you don't, it enters tapped").
   */
  | {
    b: 'enters';
    tapped?: boolean;
    tappedUnless?: Condition;
    tappedUnlessPay?: CostDef;
    counters?: CounterSpec[];
    choose?: { what: ChoiceKind; link: LinkId; options?: string[] }[];
    copy?: { of: ObjectFilter; optional: boolean; except?: Modification[] };
    attachTo?: ObjRef;
    faceDown?: boolean;
    transformed?: boolean;
    under?: PlayerRef;
    withAbilities?: AbilityDef[];
  }
  /** Regeneration shield (CR 614.8, 701.19): remove damage, tap, remove from combat. */
  | { b: 'regeneration' };

export interface AmountChange {
  /** x2, x0.5 rounded as stated. */
  mul?: number;
  add?: Quantity;
  set?: Quantity;
  round?: 'up' | 'down';
  min?: number;
}

/** "You may cast ... as though ...", "You may play an additional land", "spend mana as though it were any color" (CR 609.4). */
export interface PermissionDef {
  s: 'permit';
  who: PlayerRef;
  action: 'cast' | 'play' | 'playLand' | 'activate' | 'spendMana' | 'haveFlash' | 'attackAsThoughNoDefender' | 'blockAsThough' | 'lookAt' | 'revealTop';
  of?: ObjectFilter;
  from?: ZoneName;
  /** "as though they had flash", "mana of any type" ... */
  asThough?: string;
  /** Additional land plays etc. */
  count?: Quantity;
  costChange?: CostChange;
  /** Spells cast this way gain this (CR 610.5). */
  grants?: AbilityDef[];
}

/** Rule-modifying statics that read as numbers, not as restrictions. Each is a named hook the engine queries (design 9.4). */
export interface RuleModDef {
  s: 'rule';
  rule: 'maxHandSize' | 'startingLife' | 'landPlays' | 'combatDamageUsesToughness' | 'manaDoesNotEmpty' | 'attackTax' | 'extraBlockers' | 'extraAttackerBlocks' | 'handSizeNoLimit' | 'poisonLimit' | 'commanderTax' | 'lifeTotalSetAs';
  player?: PlayerRef;
  value?: Quantity | 'none';
  of?: ObjectFilter;
}

/** "Triggers an additional time" (CR 603.2d). */
export interface TriggerModDef {
  s: 'triggerMod';
  /** The event that causes the trigger. */
  cause: EventPattern;
  /** Whose triggered abilities are affected. */
  abilitiesOf: ObjectFilter;
  additional: Quantity;
}

/** "As an additional cost to cast this spell, ..." (CR 118.8, 601.2b, 604.5). */
export interface AdditionalCostDef {
  s: 'additionalCost';
  cost: CostDef;
  optional?: boolean;
  /** Name used by linked abilities: "if its kicker was paid" (CR 607.2i). */
  name?: string;
  repeatable?: boolean; // multikicker, replicate
}

/** "You may pay [cost] rather than pay this spell's mana cost" (CR 118.9, 601.2b). */
export interface AlternativeCostDef {
  s: 'alternativeCost';
  cost: CostDef;
  /** Zone it may be cast from (flashback: graveyard). */
  from?: ZoneName;
  /** Name used by linked abilities and by `wasCast.via`. */
  name: string;
  when?: Condition;
}

/** "If this card is in your opening hand, you may begin the game with it on the battlefield." (CR 103.6) */
export interface PregameDef {
  s: 'pregame';
  action: 'beginOnBattlefield' | 'reveal' | 'exileBeforeShuffle';
  optional: boolean;
}
```

```ts
/**
 * Automation classification types (design section 10), computed by classify() and stored in CardDef.automation, never inside ability JSON.
 * New file types/automation.ts; `Automation` in types/card.ts is replaced by `CardAutomation`.
 */

export type AutomationLevel = 'full' | 'partial' | 'manual';

/** Review state of LLM-derived data (design section 11). */
export type ReviewState = 'unreviewed' | 'autoverified' | 'reviewed' | 'rejected';

export interface ManualSpan {
  /** JSON pointer to the manual node inside the ability, e.g. "/effect/steps/2". */
  path: string;
  /** Oracle text of the unit (hydrated at load time, never stored in packs). */
  text: string;
  /** Why: "no template", "unknown verb meld", "needs-engine: op:copy", "gate-mismatch", "ambiguous", "unbound-reference", "contagion: instead", "forceManual". */
  reason: string;
  /** What kind of node is manual; decides how the engine behaves at run time (design 10.1). */
  impact: 'ability' | 'trigger' | 'static' | 'step' | 'condition' | 'quantity' | 'cost' | 'target' | 'restriction' | 'mana';
}

export interface AbilityAutomation {
  level: AutomationLevel;
  manual: ManualSpan[];
}

export interface CardAutomation {
  level: AutomationLevel;
  /** Per face, per ability (same indexes as FaceDef.abilities). */
  faces: { abilities: AbilityAutomation[] }[];
  /** Text fragments shown to players for manual resolution (the same meaning as today's `unsupported`). */
  unsupported: string[];
  /** Where the abilities came from (highest-precedence source that contributed). */
  source: 'pack' | 'llm-cache' | 'templates' | 'keywords-only' | 'none';
  /** Share (0..1) of non-reminder characters inside automated spans: sorts the deck screen and the work queue. */
  autoRatio: number;
  /** Capabilities the card needs that this engine build lacks ("op:copy", "keyword:morph", "layer:1a"). */
  requiresEngine?: string[];
  /** Review state of the data that drives the card; non-reviewed LLM data caps `level` at 'partial'. */
  review?: ReviewState;
  /** SHA-256 of the normalized Oracle text of all faces that this result was compiled from (packs, caches). */
  textHash?: string;
  /** Parser/compile version that produced it. */
  compilerVersion?: string;
}
```

### 2.4 Reading guide

| Family | Discriminator | Where | Count |
|---|---|---|---:|
| Ability kinds | `kind` | `AbilityDef` | 9 (spell, activated, triggered, static, keyword, chapter, classLevel, levelBracket, manual) |
| Effect ops | `op` | `EffectStep` | 57 (56 primitives + `action`) |
| Cost parts | `kind` | `CostPart` | 14 |
| References | `ref` | `ObjRef`, `PlayerRef` | 10 + 12 |
| Quantities | `q` | `Quantity` | 26 (plus number literals) |
| Conditions | `cond` | `Condition` | 13 |
| Durations | `d` | `Duration` | 8 |
| Event patterns | `ev` | `EventPattern` | 18 |
| Static effects | `s` | `StaticEffect` | 10 (continuous, costMod, restrict, replace, permit, rule, triggerMod, additionalCost, alternativeCost, pregame) |
| Layers | `layer` | `Modification` | 11 (1a, 1b, 2, 3, 4, 5, 6, 7a, 7b, 7c, 7d) |
| Rule actions | string | `RuleAction` (restrictions) | 40 |
| Replacement bodies | `b` | `ReplacementBody` | 7 (instead, modify, prevent, redirect, skip, enters, regeneration) |

Every discriminator value is also a **capability name** (`op:damage`, `ev:state`, `layer:1a`, `filter:sharesWith`, `static:replace`, `body:enters`, ...) the engine either has or lacks (5.2, 10.2).

## 3. Normative semantics the types cannot say

Everything in this section is a rule for the code that evaluates the model. Each item has a scenario test named after the rule it pins (15.4).

### 3.1 References, handles and last known information

| English | Model |
|---|---|
| "target creature" (the Nth word "target") | `{ref:'target', id}`; each instance of the word "target" is its own `TargetSpec` (CR 115.3, 601.2c) |
| "this creature", "~", CARDNAME | `{ref:'self'}` |
| "it", "that creature", "that card", "them", "the token" | `{ref:'bound', name}`; the parser names the producing step with `as` |
| "that creature" inside a trigger (the one that died, attacked, entered) | `{ref:'event', role:'subject'}` and the other roles of 3.5 |
| "enchanted creature", "equipped creature" | `{ref:'attachedTo'}` (CR 303.4, 301.5; the permanent `self` is attached to) |
| "each creature", "all creatures you control", "each other non-Aura enchantment" | `{ref:'each', filter}` (simultaneous when the op can be, CR 608.2f) |
| "the exiled card", "cards exiled with ~", "the creature it put onto the battlefield" | `{ref:'linked', link}` (CR 607.2a, 607.2c) |
| "the top three cards of your library" | `{ref:'topCards', player, count}` (ordered, top first) |
| "its controller", "its owner" | `{ref:'controllerOf', object}`, `{ref:'ownerOf', object}` (last known information if the object left) |
| "each opponent", "each player", "an opponent" | `{ref:'each', who}`, `{ref:'anOpponent'}` (the controller picks one in multiplayer, CR 601.7a) |
| "defending player", "the active player" | `{ref:'defending'}` (CR 506.2), `{ref:'active'}` (CR 102.1) |
| "tokens created this way" | the `createToken` step has `as: 'tok'`; later steps use `{ref:'bound', name:'tok'}` |
| "its mana value" inside a continuous effect | `{ref:'subject'}`: the object currently being modified |

**Handle semantics (CR 400.7, 608.2b, 603.7c).** A binding stores `ObjHandle {id, zone}` for each object plus a snapshot (`LastKnown`) taken when it was bound. Rules:

1. *Acting* on a handle (tap it, put a counter on it) applies only if an object with that `id` still exists in `zone`. Otherwise it is a new object and the part of the effect that refers to it does nothing (CR 608.2b, 603.7c, 610.3a).
2. **Re-basing (CR 400.7j, corrected from the candidate).** A `move` step re-bases *every binding that contains a moved object* onto the new object **only when the destination is a public zone** (battlefield, graveyard, stack, exile, command; CR 400.2). A move to a hand or a library does not re-base: those objects are new hidden objects other parts of the effect cannot find. The same holds for `cast` (CR 400.7h, the new object is on the stack) and for `createToken` (the token is bound). A token that ceased to exist drops out of the binding.
3. *Reading* information (power, controller, mana value, counters, colors) from a handle uses the **snapshot** if the object left the zone it was bound in during this resolution (CR 608.2h). Swords to Plowshares: after the exile, "its controller" and "its power" are the battlefield values. If nothing moved it, reads use current information.
4. `target` handles never re-base. To keep acting on a moved target ("Exile target creature. Return it to the battlefield.") the parser names the moving step with `as` and uses `{ref:'bound'}` afterwards; reads through the target handle use the snapshot.
5. A target whose object left its zone is illegal (CR 608.2b). If the ability's source left, its snapshot is used.
6. An **empty** binding (the player declined, nothing matched) is legal and makes dependent steps no-ops (CR 609.3). A name that was **never bound** is a lint error at compile time and an `EngineBug` in tests; in release builds it becomes a `manualResolve` prompt (G11).
7. **`did` semantics.** `{cond:'did', step}` looks up the `StepResult` of the step named `step`: `performed` is true if the step carried out its action at least once. For `may` and `pay`, `performed` means the player *chose* to (CR 118.12: the clause checks whether the player chose to pay or started to pay, regardless of what happened). For object steps (`move`, `chooseObjects`, `destroy`, ...) it means at least one object or player was affected.

### 3.2 Required fields and the only defaults

`who` (every op that has a player doing something), `payer`/`who` of `pay`, `damage.source`, `copy.who`, `cast.who`, `createToken.who`, `action.who`, `CostModDef.applies.caster`, and the `controller` of a battlefield `Destination` are **required** (the types enforce it). The complete list of defaults, and nothing else is defaulted:

- `ObjectFilter.zone` defaults to the battlefield (CR 609.2). `controller` and `owner` inside a filter are relative to the controller of the ability ("you", CR 109.5).
- `Destination.owner` defaults to the object's owner (CR 400.3). `Destination.position` defaults to the top for libraries.
- `ModeSpec.chooser` defaults to the controller. `TargetSpec.chooser` likewise (CR 601.7 for others).
- `StepBase.guard` absent means "always". `Duration` absent on `effect` is not allowed (the step always names one; "no duration stated" is `{d:'permanent'}`, CR 611.2a).
- `addMana`: exactly one of `units` and `dynamic` is present (lint).
- A quantity written as a plain number is that number.

### 3.3 Filters

An `ObjectFilter` is evaluated through the characteristics function (CR 109.3), never against `defs` directly. All present fields are ANDed; `anyOf` and `not` give OR and NOT. Inside `EventPattern.zoneChange.subject`, `zone` is ignored (the pattern's `from`/`to` say where). For an object that left the battlefield, `controller` is its controller as it last existed (look-back).

- **There is no `unsupported`.** A filter the compiler cannot express makes its sentence manual (6.6). A filter *field* this engine build cannot evaluate is a missing capability `filter:<field>`; the `degrade` pass (10.2) turns the unit that uses it into a manual node. A filter is therefore never "approximately right".
- Tokens are not cards (CR 111.1): `isCard:true` matches cards only, `token:true` tokens only, absent matches both. "A card would be put into a graveyard" (Leyline of the Void) is `isCard:true`; "a card or token" (Rest in Peace) is absent.
- "you don't control" is `not:{controller:'you'}`; "an opponent controls" is `controller:'opponent'`. They differ in team games.
- History fields (`enteredThisTurn`, `dealtDamageThisTurn`, `attackedThisTurn`, `blockedThisTurn`) read `GameState.history` (4.1).

### 3.4 Quantities and conditions

- Quantities are evaluated when a step runs and **fixed** (CR 608.2h) unless wrapped in `{q:'live'}`. In a **resolved** continuous effect they are fixed at creation: the `effect` handler returns a copy of the `StaticEffect` in which every Quantity outside a `live` wrapper has been replaced by its number, and stores that copy in `ContinuousEffectRec.effect` (CR 611.2d: Aspect of Hydra, Angelic Exaltation). In a **static** ability they are live (CR 611.3a).
- `{q:'X'}` is the value announced at cast or activation (CR 107.3a); in a copy it is the original's X (CR 707.2). `{q:'eventAmount'}` is "that much" from the trigger event. `{q:'var'}` is a value fixed by a `let`.
- A quantity that depends on an illegal target or an empty binding evaluates to `undefined`; a step with an `undefined` quantity does nothing (CR 608.2b "fails to determine any such information"). A `compare` with an `undefined` side is false.
- `{q:'ask'}` and `{cond:'ask'}` are the manual nodes; where they may appear is a validator rule (10.1): inside steps (guards, `if`, quantities of steps), and for `cond:'ask'` also in `ActivatedAbilityDef.onlyIf`. Never in costs, targets, trigger events, intervening-if or static conditions.
- `wasCast` reads `GameObject.cast`, which the engine copies from the resolving spell onto the permanent (CR 400.7d, 607.2i), so "if this creature was kicked" works after it entered. While a permanent is entering, `wasCast` is evaluated against the spell that is becoming it (the new object's record is written once it has entered).
- `happened` and `happenedCount` query `GameState.history` by scope. `scope:'turn'` entries are pruned in the cleanup step.
- A trigger's `interveningIf` is evaluated twice: when the event happens (does the ability trigger?) and on resolution before anything else (CR 603.4, 608.2a).

### 3.5 Events, roles, batches, look-back

Triggers, replacement effects, delayed triggers, durations and history all match the same `EventPattern` against **semantic events** (`SemEvent`, 4.1), derived from the engine's emitted `GameEvent`s by a normalizer. One simultaneous action (a spell resolving, combat damage, a turn-based action) produces a **batch**; triggers are collected at the end of a batch, which is how "one or more" triggers (CR 603.2c) and the "all permanents including the newcomers are checked" rule (CR 603.6a) work. Look-back (CR 603.10a-g) is derived from the pattern by `lookBackKinds(pattern)`: leaves-the-battlefield, sacrifice, leaves-a-graveyard, publicly visible object to a hand or library (603.10a), phase out, unattach, loss of control, a spell being countered, a player losing, a planeswalker leaving (603.10b-g). Also: an enters trigger whose ability is removed "as it enters" by a continuous effect (Humility) does not exist (CR 603.6b).

Triggers, replacements, delayed triggers, durations and history all match the same `EventPattern` against **semantic events** (`SemEvent`, 4.1), derived from the engine's emitted `GameEvent`s by a normalizer. One simultaneous action (a spell resolving, combat damage, a turn-based action) produces a **batch**; triggers are collected at the end of a batch, which is how "one or more" triggers (CR 603.2c) and the "all permanents including the newcomers are checked" rule (CR 603.6a) work.

| `ev` | Derived from engine event | Roles exposed to the effect | Notes |
| :--- | :--- | :--- | :--- |
| `zoneChange` | `zoneChanged` | `subject` (the object in its new zone if public and found, CR 603.6, 400.7e; else last known), `player` (its controller as it last existed) | enters/dies/leaves/exiled/returned/"put into a graveyard from anywhere" are patterns on `from`/`to`. "Dies" = battlefield -> graveyard (CR 700.4). Looks back when `from` is the battlefield, when a card leaves a graveyard, or when a publicly visible object goes to a hand or library (CR 603.10a); the `action sacrifice` pattern looks back too |
| `cast` | `spellCast` | `spell`, `player` | triggers at 601.2i; `orCopy` includes copies (CR 707.10) |
| `activate` | `abilityActivated` | `source`, `player` | not mana abilities unless `manaAbility` |
| `attacks` | `attackersDeclared` (one per attacker, plus the batch) | `attacker`, `defender`, `player` | `alone`, `count` for "attacks alone", "attack with N or more" |
| `blocks`, `becomesBlocked` | `blockersDeclared` | `blocker`, `attacker` | |
| `damage` | `damageDealt` (needs `combat`, source snapshot) | `source`, `object`, `recipient` | `amount` for "that much" |
| `step` | `stepBegan` | `player` (whose step) | "at the beginning of" (CR 603.2b); delayed `next:true` |
| `beginTurn` | `turnBegan` | `player` | extra turns |
| `life` | `lifeChanged` | `player` | |
| `draw` | `drew` | `player` | `nth` = "second card each turn" via `turnStats.cardsDrawn` |
| `becomes` | `tapped`, `untapped`, new `becameTarget`, `attached`, `transformed`, `turnedFaceUp`, ... | `subject`, `spell`, `player`, `object` | "becomes" events do not fire for an object entering in that state (CR 603.2e). FAST5 T59: `object` is `subject` under the name a damage event gives the damaged object, so "when enchanted creature becomes tapped or is dealt damage, destroy it" has one role for the creature in both events; a lone `becomes` never names it twice (`silentRole`) |
| `counters` | `countersChanged` | `subject`, `player` | `atLeast` for "Nth counter" (CR 122.7) |
| `action` | new `actionPerformed {verb, actor, object}` | `player`, `subject` | sacrifice, discard, cycle, scry, search, explore, ...; sacrifice looks back |
| `createToken` | new `tokenCreated` | `player`, `newObject` | |
| `dieRoll` | new `dieRolled` | `player` | |
| `state` | evaluated after each SBA pass | none | CR 603.8: triggers once until it leaves the stack |
| `resolves` | `resolved` | `subject` | CR 608.2p |

The `becomes` pattern with `what:'targeted'` exposes `subject` (the targeted object), `spell` (the spell or ability that targets it, which is what ward counters) and `player` (the controller of the spell or ability that targets it, as in the type comment of `EventRole`, NOT the controller of the targeted object). Ward therefore names its payer as `controllerOf(event spell)`, which does not depend on which reading a normalizer follows.

### 3.6 Targets, modes, announcement, resolution

- **Announcement order follows CR 601.2b-d:** modes (700.2), then X and optional costs, then the *number* of targets when variable (601.2c), then the targets, then the division (601.2d). `TargetSpec.onlyIf` is evaluated at that point against the cast choices. `min`/`max` may be quantities, evaluated after X is known.
- `distinctFrom` implements "another target": a target of this spec may not equal a target of the listed specs. The same object may be chosen for two different specs that both say "target" (CR 115.3).
- A division announces an integer per target, each at least 1 (CR 601.2d), stored in `StackInfo.division[specId]`. "Divided evenly, rounded down" (Fireball) is **not** announced; the handler computes it (ruling pinned in 15.3).
- A modal program's chosen modes run in printed order, as if each appeared in sequence (CR 700.2d), then the ability's own `steps`.
- **One program, one legality check.** The interpreter flattens the chosen modes and the ability's own steps into one program (target ids are unique across modes, 2.3) and checks legality once. The ability does not resolve (is removed from the stack) only if it has targets and *every* one is illegal (CR 608.2b). Otherwise each handler skips what refers to an illegal target.
- "Any number of target creatures with total power 5 or less" is `TargetSpec.groupLimit`.

### 3.7 Durations

| `Duration` | Ends | Engine mechanism |
|---|---|---|
| `endOfTurn` | cleanup step, simultaneously with damage removal (CR 514.2) | cleanup removes records with this duration |
| `endOfCombat` | end of the combat phase (CR 500.5a) | the end-of-combat cleanup in `core/steps.ts` (adapted to the object form) |
| `permanent` | never (CR 611.2a) | none |
| `whileSource` | when the source stops being on the battlefield / controlled / attached / tapped | checked whenever the effect is read; the record is deleted the first time it fails (design decision: such durations never restart; CR 611.2b only specifies the never-starts case) |
| `until` | when the event occurs; for one-shot "until" this creates the return effect (CR 610.3) | event listener; if the event already happened before resolution, nothing moves (CR 610.3a-b) |
| `untilNextTurn`, `untilNextStep` | when that turn/step begins | `turnBegan`/`stepBegan` events |
| `asLongAs` | the first time the condition is false after it began | evaluated live |

### 3.8 Replacement and prevention semantics

- A `ReplacementDef` without `shield` is static: it exists while its source functions (CR 113.6) and is consulted for every matching event. With `shield` it is created by an `effect` step, lasts until `uses` are spent or the duration ends (CR 614.3, 615.3); `amount` is the "prevent the next N damage" budget (CR 615.7).
- **Self-replacement (CR 614.15).** "Deal 3 damage. If you control X, deal 5 instead" is parsed to `{op:'if', cond, then:[5], else:[3]}`, which has exactly the self-replacement meaning for a single step, so no pipeline effect is involved. `selfReplacement:true` is only for text that replaces *another* effect of the same ability.
- `modify.destination` changes where an object goes without making a second event (Leyline of the Void exiles the same card), so triggers see one zone change to exile.
- **`enters` bodies** are applied before the object exists on the battlefield, choices first (CR 614.12a); its counters are "put on it as it enters" (CR 122.6), so a foreign counter-doubling effect applies to them (CR 614.16, 616.1g; milestone 6). **A static ability whose replacement has `subject:{self:true}` and `to:'battlefield'` is consulted from the entering object itself, whatever its `zone`** (CR 614.12: the replacement is checked against the permanent as it would exist). Its `condition` is evaluated with the cast record of the spell it came from.
- `tappedUnlessPay` (shock lands): the controller is asked whether to pay (a `payCost` decision with origin `optional`); if they do not or cannot, the object enters tapped.
- Prevented or replaced events do not trigger anything (CR 603.2g, 614.6); the modified event, if any, triggers normally. An event with amount 0 is no event (CR 614.7a).

### 3.9 Linked abilities (CR 607)

A producing step names a `link` (`move.link`, `createToken.link`, `chooseValue.link`, `enters.choose[].link`). The engine stores the result in `GameObject.links[link]` of the **source object instance**. A consumer (`{ref:'linked', link}` or `ObjectFilter.chosen`) reads only that store, so an ability can only see what the linked ability of the same object did (CR 607.1). A leaves-the-battlefield ability whose source has already left reads the link store from the source's last known information (the snapshot includes `links`). Because a zone change creates a new object, links reset with it (CR 400.7), which reproduces the Fiend Hunter race. Abilities granted as a linked pair keep the link only with each other (CR 607.5): the grant gives the link a fresh namespace `g<effectId>:<link>`. Undefined choices (CR 607.5a) read as "nothing". Kicker and other cast-time facts are not links but `GameObject.cast` (CR 607.2i-j).

### 3.10 What the interpreter never does

It never reads Oracle text, never branches on a card name, never guesses an antecedent, never approximates a filter, never executes a node whose capability is missing, never mutates state outside `propose()`/`perform`, and never catches `NeedDecision` (only `core/apply.ts` does).

## 4. State, decision and event additions; migration from the current model

### 4.1 The additions (compiled together; WP0 merges them into the existing files)

`GameObject` gains `links` and `cast`; `StackInfo` gains `division`, `event` and `inline`; `continuousEffects` and `delayedTriggers` get the typed records below (replacing the loosely typed fields of the same name); `history`, `designations` and `reminders` are new; `AbilityRef.source` widens; `PendingTrigger.context` becomes the typed `EventContext`; `ManaUnit.restriction` becomes structured; two decision kinds are added; engine events are added. Static abilities store nothing: their effects are re-derived at every computation (CR 611.3a), so a state never contains an outdated copy of a static effect.

```ts
/**
 * Additions to types/state.ts, types/decisions.ts, types/events.ts and types/mana.ts required by the ability model.
 * (In the repository they are merged into those files by work package WP0; they are shown together here so the whole
 * change set is one compilable unit.)  All plain JSON.
 */
import type {
  AbilityDef, Condition, Duration, EventPattern, EventRole, LinkId, ManaRestriction, Name, EffectStep, StaticEffect, TargetSpec,
} from './ability';
import type { ObjectId, PlayerId } from './ids';
import type { CostsPaid, GameObject, LastKnown, TargetChoice, ZoneKind } from './state';

// ---------------------------------------------------------------------------
// types/state.ts
// ---------------------------------------------------------------------------

/** An object reference that remembers where the object is expected to be (CR 400.7, 603.7c, 608.2b). */
export interface ObjHandle {
  id: ObjectId;
  /** Zone the object was in when the handle was made; a handle whose object is no longer there is stale (it is a new object). */
  zone: ZoneKind;
}

/** What a linked ability remembers about its source object (CR 607). Stored on the source object; fresh after any zone change (CR 400.7). */
export interface LinkValue {
  objects?: ObjHandle[];
  players?: PlayerId[];
  /** A chosen color, creature type, card name, number, ... as strings. */
  values?: string[];
}

/** Added to GameObject (types/state.ts). */
export interface GameObjectAdditions {
  /** CR 607 link store of THIS object instance. */
  links?: Record<LinkId, LinkValue>;
  /** Kept from the spell that became this permanent (CR 400.7d, 607.2i): costs paid, X, alternative cost, zone cast from. */
  cast?: { costsPaid: CostsPaid; x?: number; from: ZoneKind; via?: string; turn: number };
}

/** `AbilityRef.source` becomes this union (types/state.ts). `keyword` = generated by the keyword library, key `k:<face>:<index>:<n>`. */
export type AbilitySource = 'printed' | 'rule' | 'keyword' | 'granted' | 'delayed' | 'reflexive' | 'emblem';

/** Added to StackInfo (types/state.ts). */
export interface StackInfoAdditions {
  /** Announced division per target spec id (CR 601.2d), parallel to the chosen targets. */
  division?: Record<string, number[]>;
  /** The event that triggered this ability, with last known information of its participants (CR 603.10). Replaces TriggerContext. */
  event?: EventContext;
  /**
   * The ability itself, for abilities that do not come from the printed text of a living object: delayed and reflexive
   * triggers, emblem and granted abilities. It exists independently of its source (CR 113.7a).
   */
  inline?: AbilityDef;
}

/** Everything an effect may ask about the event that triggered it (replaces the loose TriggerContext). */
export interface EventContext {
  ev: EventPattern['ev'];
  roles: Partial<Record<EventRole, RoleValue>>;
  /** "that much": damage dealt, life gained, cards drawn, counters put. */
  amount?: number;
  /** Snapshots taken before the event for look-back events (CR 603.10). */
  before: Record<ObjectId, LastKnown>;
}

export type RoleValue = { objects: ObjHandle[] } | { players: PlayerId[] };

/** A continuous effect created by a resolving spell or ability (CR 611.2). Static abilities store nothing: they are re-derived (CR 611.3a). */
export interface ContinuousEffectRec {
  id: string;
  source: ObjHandle | null;
  sourceName: string;
  controller: PlayerId;
  /** CR 613.7b: one timestamp per effect (all its modifications share it). */
  timestamp: number;
  startedTurn: number;
  duration: Duration;
  /**
   * The effect as created: every non-`live` Quantity replaced by its number (CR 611.2d, 608.2h) and every reference to a specific object
   * replaced by `{ref:'fixed'}` (CR 611.2c: for effects that change characteristics or control the affected set, including an `each`
   * filter, is determined when the effect begins and never changes).
   */
  effect: StaticEffect;
  /** Remaining uses of a shield: "prevent the next 3 damage" (CR 615.7), "the next time" (CR 615.8). */
  usesLeft?: number;
}

/**
 * Milestone 4's two ad hoc uses of `GameState.continuousEffects` (regeneration shields in rules/destroy.ts, player restrictions in
 * rules/restrictions.ts): a record with a string `duration` and an open `effect: {kind}`. WP0 widens the array to `ContinuousEffectEntry` so
 * milestone 4 compiles and its tests pass unchanged; WP11 migrates the regeneration shields and WP16 the player restrictions to typed
 * records and then removes this type (transition T1, design 4.6).
 */
export interface LegacyContinuousEffect {
  id: string;
  sourceId?: ObjectId;
  sourceName?: string;
  controller: PlayerId;
  timestamp: number;
  duration: string;
  effect: { kind: string; [k: string]: unknown };
  affected?: ObjectId[];
}
export type ContinuousEffectEntry = ContinuousEffectRec | LegacyContinuousEffect;

/** A delayed triggered ability waiting for its event (CR 603.7). */
export interface DelayedTriggerRec {
  id: string;
  source: ObjHandle;
  /** CR 603.7d-g. */
  controller: PlayerId;
  when: Extract<EffectStep, { op: 'delay' }>['when'];
  do: EffectStep[];
  /** Names captured at creation with the zone each object was expected in (CR 603.7c). */
  captured: Record<Name, ObjHandle[]>;
  /** Variables fixed at creation (CR 608.2h). */
  vars: Record<string, number>;
  createdTurn: number;
  duration?: Duration;
  firedCount: number;
}

/** What the "happened this turn" conditions and the history filters read (CR 603.4 style). Pruned at cleanup, except game-scope entries. */
export interface HistoryEntry {
  turn: number;
  /** Combat number inside the turn, for scope 'combat'. */
  combat: number;
  ev: EventPattern['ev'];
  actor?: PlayerId;
  subject?: ObjectId;
  /** Characteristics summary good enough to re-run an ObjectFilter ("a creature died this turn"). */
  facts: Record<string, string | number | boolean>;
}

export interface DesignationState {
  monarch?: PlayerId;
  initiative?: PlayerId;
  dayNight?: 'day' | 'night';
  /** Player speed 0-4 (CR 702.179). */
  speed?: Record<PlayerId, number>;
}

/** A chip the UI shows until `until` passes: manual shields and unenforced one-shot text ("If it would die this turn, exile it instead."). */
export interface ManualReminder {
  id: string;
  text: string;
  sourceName: string;
  controller: PlayerId;
  until: Duration;
  createdTurn: number;
}

/** Added to GameState. `continuousEffects` and `delayedTriggers` REPLACE the loosely typed fields of the same name. */
export interface GameStateAdditions {
  continuousEffects: ContinuousEffectEntry[];
  delayedTriggers: DelayedTriggerRec[];
  history: HistoryEntry[];
  designations: DesignationState;
  reminders: ManualReminder[];
}

/** PendingTrigger.context becomes the typed EventContext (types/state.ts). */
export interface PendingTriggerAdditions {
  context: EventContext;
  /** For delayed/reflexive triggers: the inline ability. */
  inline?: AbilityDef;
  /** Targets already chosen when it was created (reflexive triggers choose on being put on the stack, CR 603.3d). */
  targetSpecs?: TargetSpec[];
}

/** LastKnown.chars is no longer `unknown`: the layered characteristics at the moment of leaving (filled by moveObject). Type lives in rules/characteristics.ts (Chars). */
export type LastKnownCharsNote = 'filled by moveObject through getChars before the object is removed';

/** One engine happening in the shape triggers, replacements and history need. Produced by the normalizer from GameEvents. */
export interface SemEvent {
  ev: EventPattern['ev'];
  seq: number;
  /** Events produced by one simultaneous action share a batch id (CR 603.2c, 603.6a, 603.10a). */
  batch: number;
  roles: Partial<Record<EventRole, RoleValue>>;
  data: Record<string, string | number | boolean | undefined>;
  /** Last known information of objects as they were just before the event (look-back events). */
  before: Record<ObjectId, LastKnown>;
}

/** Event kinds that "look back in time" (CR 603.10a-g); decided by code from the pattern, never stored in card data. */
export type LookBackKind =
  | 'leavesBattlefield' | 'sacrifice' | 'leavesGraveyard' | 'visibleToHandOrLibrary' // 603.10a
  | 'phaseOut' | 'unattach' | 'controlLost' | 'spellCountered' | 'playerLoses' | 'planeswalkAway'; // 603.10b-g

// ---------------------------------------------------------------------------
// types/mana.ts
// ---------------------------------------------------------------------------

/** ManaUnit.restriction changes from `string` to this structured form (types/state.ts). */
export type ManaUnitRestriction = ManaRestriction;

// ---------------------------------------------------------------------------
// types/decisions.ts
// ---------------------------------------------------------------------------

interface DecisionBase {
  id: string;
  player: PlayerId;
  prompt: string;
  rules?: string[];
  cancellable?: boolean;
}

/** CR 601.2d: the caster divides damage or counters among the announced targets; each gets at least 1. */
export interface ChooseDivisionDecision extends DecisionBase {
  kind: 'chooseDivision';
  what: 'damage' | 'counters' | 'other';
  total: number;
  targets: { id: ObjectId | PlayerId; label: string }[];
}

/** CR 607.2d, 608.2d: name a card, a creature type, a basic land type ... from a searchable list. */
export interface ChooseNameDecision extends DecisionBase {
  kind: 'chooseName';
  what: 'cardName' | 'creatureType' | 'cardType' | 'landType';
  /** Closed list for types; for card names the whole local Oracle name index (the UI searches it). */
  options?: string[];
}

/** `PayCostDecision` gains who pays and why: "unless that player pays" (CR 118.12a) is paid by a player other than the controller. */
export interface PayCostDecisionAdditions {
  forPlayer?: PlayerId;
  origin?: 'cast' | 'activate' | 'unless' | 'optional';
}

/** `ManualResolveDecision` gains the context the manual panel shows (design 10.5). */
export interface ManualResolveDecisionAdditions {
  /** Names bound so far in this resolution, with the objects' display names. */
  bound?: { name: string; objects: string[] }[];
  /** Sentences of the ability already resolved automatically (display text), in order. */
  done?: string[];
  /** The unit is a manual shield: after the answer a ManualReminder is created with this duration. */
  reminder?: Duration;
  /** Why the engine asks (reason of the manual node), shown verbatim. */
  reason?: string;
}

export type DecisionAdditions = ChooseDivisionDecision | ChooseNameDecision;
export type AnswerAdditions = { kind: 'chooseDivision'; amounts: number[] } | { kind: 'chooseName'; name: string };

// ---------------------------------------------------------------------------
// types/events.ts: new GameEvent variants (the normalizer needs them; existing events gain fields)
// ---------------------------------------------------------------------------

export type GameEventAdditions =
  | { type: 'actionPerformed'; verb: string; actor: PlayerId; objectId?: ObjectId }
  | { type: 'tokenCreated'; player: PlayerId; objectId: ObjectId }
  | { type: 'becameTarget'; objectId: ObjectId | PlayerId; byStackId: ObjectId; byController: PlayerId }
  | { type: 'attached'; objectId: ObjectId; to: ObjectId | null }
  | { type: 'transformed'; objectId: ObjectId }
  | { type: 'turnedFaceUp'; objectId: ObjectId }
  | { type: 'dieRolled'; player: PlayerId; sides: number; result: number }
  | { type: 'coinFlipped'; player: PlayerId; won: boolean }
  | { type: 'spellCopied'; objectId: ObjectId; copyOf: ObjectId }
  | { type: 'abilityCountered'; objectId: ObjectId }
  | { type: 'controlChanged'; objectId: ObjectId; from: PlayerId; to: PlayerId }
  | { type: 'phasedOut'; objectId: ObjectId }
  | { type: 'designationChanged'; what: 'monarch' | 'initiative' | 'day' | 'night'; to: PlayerId | 'day' | 'night' };

/** Existing events gain fields: zoneChanged.before (layered snapshot of the old object), spellCast.spellsBefore (storm). */
export interface ZoneChangedAdditions {
  before?: LastKnown;
}

export type _Unused = GameObject | TargetChoice | Condition;
```

### 4.2 Existing fields that change meaning

| Current | New | Notes |
|---|---|---|
| `GameObject.chosen: Record<string, unknown>` | stays (engine flags such as `onAdventure`); ability choices go to `GameObject.links` | choices made as an object enters are linked-ability data (CR 607.2d). `core/view.ts` redacts `links` and `cast` of hidden objects exactly as it redacts `chosen` |
| `StackInfo.trigger: TriggerContext` | `StackInfo.event: EventContext` | roles instead of loose fields |
| `StackInfo.costsPaid` | unchanged, plus copied to `GameObject.cast` on entering | CR 400.7d |
| `AbilityRef.source: 'printed' \| 'rule' \| 'granted'` | adds `keyword`, `delayed`, `reflexive`, `emblem` | keyword-generated abilities use keys `k:<face>:<index>:<n>` |
| `LastKnown.chars: unknown` (stored as `null`) | `Chars` filled by `moveObject` | needed by Swords to Plowshares, look-back triggers, 608.2b source checks |
| `ContinuousEffect` (`effect: {kind: string}`; milestone 4 uses it for regeneration shields and player restrictions) | `ContinuousEffectRec`, with the array widened to `ContinuousEffectEntry = ContinuousEffectRec \| LegacyContinuousEffect` during transition T1 (4.6) | |
| `GameState.delayedTriggers[].trigger: unknown` | `DelayedTriggerRec` | |
| `ManaUnit.restriction?: string` | `ManaRestriction` | payment enforces it |
| `Chars` | adds `controller`, `abilities: CharAbility[]` (keys, origin), `cantHave`; milestone 4's `keywords` stays and is recomputed from `abilities` after layer 6 | statics/api.ts; P/T are decimal strings after layers 7a-d; `ptNumbers(c)` of milestone 4 stays; M4's ad hoc `applyPtCounters` becomes the layer 7c counter effect (same result) |
| `CardDef.automation: Automation` | `CardAutomation` (types/automation.ts) | superset: `level`, `unsupported`, `source` keep their meaning |

### 4.3 Hazards of the structural sharing that milestone 4 introduced

`util/clone.ts#cloneState` shares `defs`, `log` entries and `lki` entries between states and copies each `GameObject` field by field (`cloneObject`). Consequences every work package must respect (each has a test in WP0):

1. **`cloneObject` must deep-copy `links` and `cast`** (and any later per-object record). If it does not, two states share one record and an in-place update corrupts replay determinism. WP0 owns the change and adds a test that mutates a clone's `links` and `cast` and checks the base state.
2. **`defs` are frozen.** Compile output, `degrade`, `classify`, keyword expansion and token definitions must be pure and return new objects. Token definitions are added with `Game.addDef` (copy-on-write); the token definition id is derived from the canonical JSON of the `TokenDef` (`token:<hash>`) so equal tokens share a definition.
3. **`lki` entries are written once**, when an object leaves a zone, and never edited: `LastKnown.chars` must be complete at that moment (layers applied).
4. **`log` entries are append-only.** The new `ManualReminder` chips are state (`GameState.reminders`), not log entries.
5. New top-level arrays (`history`, `reminders`, `continuousEffects`, `delayedTriggers`) are covered by the deep clone of the rest of the state; they are plain JSON.

### 4.4 Migration from the current `types/ability.ts` (measured)

Replacing the current `types/ability.ts` by the one in 2.3 makes **47 type errors in 15 source files** (working tree at the start of the design session) and **51 in 18 files** (working tree at the end of it; the extra files are milestone 4's new `cards/keywords.ts`, which assigns `string[]` where the model now says `Color[]` for `ObjectFilter.colors`, `rules/attachment.ts`, which builds `playerFilter` (now `players`), and `rules/damage.ts`, which adds a `Count`). The table is WP0's worklist and is re-measured against the committed milestone 4; no behavior changes in WP0, all milestone 1-4 tests must pass unchanged.

| File (errors) | Cause | Fix |
|---|---|---|
| `actions/announce.ts` (8) | `TargetSpec.min/max` and `ModeSpec.min/max` are `Count` (a quantity may appear) | `evalCount(count, {x})` helper in `effects/eval.ts` (WP4 API, stubbed by WP0 for numbers only); numbers behave as before |
| `rules/cost.ts` (6), `rules/cost-pick.ts` (2), `rules/pay.ts` (4) | `CostPart.count: Count`, new part kinds (`tapPower`, `putCounters`, `payEnergy`, `reveal`, `mill`, `action`, `manual`) | `CostPlan` resolves every `Count` to a number once X is fixed; new kinds are `unavailable` capabilities (cost part manual) until WP9 implements them |
| `rules/filter.ts` (11) | fields renamed: `powerCmp/toughnessCmp/manaValueCmp` to `power/toughness/manaValue`; `keyword` may be an array; `unsupported` removed; `zone` may be an array | adapt the evaluator; fields it cannot evaluate yet are not in the capability set |
| `rules/targets.ts` (3) | `playerFilter` to `players`; `min/max` are `Count` | adapt |
| `rules/abilities.ts` (2), `actions/activate.ts` (1), `core/legal.ts` (1), `rules/timing.ts` (1) | `ActivatedAbilityDef.zone` is `ZoneName[]`; `oncePerTurn` became `limit`; `addMana` step requires `who` | adapt; `AddManaStep` in `rules/mana-text.ts` gains `who` |
| `rules/cast-restriction.ts` (3), `actions/cast.ts` (1) | `StaticAbilityDef.static` became `effects: StaticEffect[]` | the timing restriction is `{s:'restrict', mode:'onlyIf', action:'cast', when}`; `cast.ts` reads `effects` |
| `cards/basic-compiler.ts` (2), `cards/compile.ts` (1) | `ManualAbilityDef.shape` is required | add `shape` ("unknown" for text of unknown form, "activated" for the manual mana abilities) |
| `index.ts` | exports | export `types/automation.ts`; the old `Step` name stays the turn step |

Old to new, by concept:

| Current | New |
|---|---|
| `EffectStep = {op: string; [k]: unknown}` | closed union `EffectStep` (57 ops); `AddManaStep {op:'addMana', units}` keeps the field `units` bit for bit |
| `StaticAbilityDef.static: StaticDef` | `effects: StaticEffect[]` (one paragraph, several effects) |
| `TriggeredAbilityDef.optional` | a `may` step (CR 603.5: the choice is made on resolution) |
| `ActivatedAbilityDef.oncePerTurn` | `limit {per, max}` |
| `CostPart.count: number` | `Count` |
| `ObjectFilter.controller: 'you'\|'opponent'\|'any'` | `PlayerPred` |
| `TargetSpec.playerFilter`, `different` | `players`, `distinctFrom`; plus `id`, `divide`, `groupLimit`, `onlyIf`, `chooser`, kinds `anyTarget`, `stackObject` |
| `ObjectRef`, `PlayerRef` | extended (`event`, `linked`, `attachedTo`, `topCards`, `anOpponent`, `iterating`, `subject`); `triggerObject` becomes `{ref:'event', role}` |
| `Duration` string literals | `Duration` objects |
| `Quantity` | extended (`X`, `var`, `eventAmount`, `targetCount`, `math`, `live`, `ask`, ...) |
| `ConditionDef`, `TriggerDef`, `StaticDef` open records | closed unions |
| `KeywordAbilityDef` (milestone 4 shape: `amount`, `quality`, `filter`, `player`) | unchanged shape; `amount` widens to `Quantity` |

### 4.5 Transition T1: milestone 4's ad hoc continuous effects

Milestone 4 already stores two things in `GameState.continuousEffects` with a string `duration` and an open `effect: {kind}`: **regeneration shields** (`rules/destroy.ts#addRegenerationShield`, consumed inside `destroy`) and **player restrictions** ("can't gain life", "can't lose the game", ...; `rules/restrictions.ts#addPlayerRestriction`, read by `rules/life.ts` and `core/sba.ts`). Its tests build such records directly. So that milestone 4 compiles and passes unchanged in WP0, the array becomes `ContinuousEffectEntry[]` (the typed record or `LegacyContinuousEffect`, 4.1) and the duration filters of `core/steps.ts` accept both forms. The migration is then done by the package that owns the behavior, each documented and each updating the milestone 4 tests that built raw records in the same pull request:

| Legacy record | Becomes | Package |
|---|---|---|
| `{kind:'regenerationShield', affected:[id]}`, duration `'endOfTurn'` | `ContinuousEffectRec` with `effect {s:'replace', replaces:{ev:'action', verb:'destroy', object:{is:{ref:'fixed', objects:[handle]}}}, body:{b:'regeneration'}, shield:{uses:1}}` and duration `{d:'endOfTurn'}`; `destroy()` keeps owning indestructible and regeneration and reads the typed record | WP11 |
| `{kind:'playerRestriction', restriction:'cantGainLife'\|'cantLoseLife'\|'cantLoseGame'\|'cantWinGame', player}` | `ContinuousEffectRec` with `{s:'restrict', subject:{ref:'fixed', players:[player]}, mode:'cant', action:'gainLife'\|'loseLife'\|'lose'\|'win'}` (for "your opponents can't win" the subject is the opponents' fixed set); `playerRestricted()` becomes a call into `staticEffectsFor`; `addPlayerRestriction` keeps its signature (the string durations map to `Duration` objects) | WP16 |
| duration strings `'endOfTurn'`, `'endOfCombat'`, `'whileSourceOnBattlefield'`, `'permanent'` | `Duration` objects | WP15 (`core/steps.ts`) |

After WP16 `LegacyContinuousEffect` and the string durations are removed.

### 4.6 Decisions added to `types/decisions.ts`

`chooseDivision` (CR 601.2d) and `chooseName` (CR 607.2d, a searchable list: the whole local name index for card names) are new kinds; `PayCostDecision` gains `forPlayer` and `origin`; `ManualResolveDecision` gains `bound`, `done`, `reminder`, `reason`. Both new kinds carry no hidden data, so `viewFor` redacts them like the others. Owner approval for the two new kinds is item 6 of 15.6; the plan assumes yes.

## 5. Module layout and the public APIs

### 5.1 Layout under `packages/engine/src`

Directories named in the task (`parser/`, `keywords/`, `effects/` interpreter, `triggers/`, `statics/`) plus `model/`, `render/` and the existing ones. A file is owned by exactly one work package (15.2). **WP0 creates every file below as a compilable stub exporting the contract of this section**, so the packages of later waves fill disjoint files and never edit a shared one.

```
packages/engine/src/
  types/
    ability.ts            the model (2.3)                                         WP0 (once, verbatim)
    automation.ts         AutomationLevel, CardAutomation, ManualSpan, ReviewState   WP0
    state.ts decisions.ts events.ts card.ts mana.ts   additions of 4.1             WP0
  model/                  JSON-level tooling, no game state, no I/O
    index.ts              re-exports the API of model/api.ts                       WP1
    validate.ts lint.ts   schema validator (subset, no dependency) + semantic lint   WP1
    schema.generated.json generated from types/ability.ts by scripts/gen-ability-schema.ts   WP1
    canonical.ts strip.ts hash.ts   canonical form, stored form (strip/hydrate), textHash   WP1
    capabilities.ts       capabilitiesOf, missingCapabilities, ENGINE_CAPABILITIES builder   WP1 (tables are imported from other modules)
    degrade.ts classify.ts   capability degradation, automation level                   WP1
  render/                 JSON -> canonical English (a function of the JSON only)
    render.ts cost.ts filter.ts quantity.ts condition.ts duration.ts event.ts step.ts static.ts keyword.ts   WP2
    equivalence.ts gate.ts   normalization table, the exact gate                        WP2
  keywords/
    types.ts registry.ts expand.ts capabilities.ts   (5.3, 7)                          WP3
    data/<name>.json      one KeywordDefData per keyword                              WP3
    hooks/*.ts            KeywordHooks implementations + hooks/index.ts (provider for rules/hookpoints.ts)   WP3
    special/*.ts          special actions (foretell, suspend, plot, morph, ...)       WP3
    actions/*.ts          CR 701 action macros + actions/index.ts                     WP3
  parser/                 (6)
    types.ts lexicon.generated.json preprocess.ts segment.ts tokenize.ts     WP5
    chart.ts holes/*.ts                                                       WP6
    lower/*.ts taint.ts parse.ts metrics.ts                                   WP17
    templates/*.json templates/effect/*.json                                  template packages WP19-WP23
  effects/                the interpreter (8)
    api.ts                types shared by all handlers                                WP0
    ctx.ts refs.ts eval.ts                                                    WP4
    run.ts manual.ts handlers/index.ts handlers/control.ts                    WP10
    propose.ts perform.ts                                                     WP11
    replacements.ts replace-bodies.ts cant.ts funnels.ts   (WP11 layout addition: applicable effects, bodies, "can't", the funnels of the primitives)   WP11
    handlers/{lifedamage,cards,counters,zones,tokens,lasting,game}.ts         WP12-WP15
    predefined-tokens.json (CR 111.10 definitions)                            WP14
  triggers/               (8.4)                                                       WP8
  statics/                (9)
    layers.ts live.ts mods.ts links.ts                                        WP9
    hooks.ts costmods.ts                                                      WP16
  rules/
    hookpoints.ts         the only place call-sites ask "may this happen?"             WP0
    base-chars.ts         baseChars moved out of characteristics.ts (breaks an import cycle)   WP0
    characteristics.ts abilities.ts   getChars calls computeAll; abilities enumerates CharAbility   WP9
    filter.ts             evaluator for every ObjectFilter field                      WP4
    targets.ts cost.ts cost-pick.ts pay.ts timing.ts   announcement/cost/payment side   WP7
  actions/announce.ts cast.ts activate.ts   modes, division, cast options, additional/alternative costs   WP7
  cards/
    compile.ts pipeline.ts spans.ts pack.ts   (12)                                 WP18
    pool.ts               stub cards, image slots, unsanctioned flags                 WP24
  core/
    resolve.ts            calls effects/run.ts#resolveStackObject                    WP10
    triggers.ts           one-line re-export of triggers/stack.ts                    WP8
    zones.ts              moveObject fills LastKnown.chars                           WP0

packages/cards/src/
  coverage/* smoke/*   coverage, try, unmatched, snapshot, mutation harness              WP25
  llm/*                the LLM compile tool (compile --llm, review)                 WP26
  pack/*               build-pack, update, install, validate                         WP27
scripts/
  gen-lexicon.ts gen-ability-schema.ts                                          WP5, WP1
packages/engine/test/m5/<area>/*.test.ts   every package writes its own tests in its own folder
```

### 5.2 Capabilities: how "the engine can do this" is known

`Capability` strings (`op:damage`, `cost:tapPower`, `ev:state`, `cond:happened`, `q:devotion`, `ref:topCards`, `filter:sharesWith`, `dur:until`, `target:anyTarget`, `static:replace`, `body:enters`, `layer:1a`, `rule:attack`, `permit:spendMana`, `rulemod:maxHandSize`, `keyword:ward`, `action:explore`, `decision:chooseDivision`, `feature:modes.override`) are produced by one walker, `capabilitiesOf(def)`, from the discriminators of the JSON. The engine's own set, `ENGINE_CAPABILITIES`, is **built from its own tables** (never from a second hand-kept list):

| Prefix | Built from | Table owner |
|---|---|---|
| `op:` | keys of `OP_HANDLERS` that also have a renderer (`RENDERERS`) | WP10 + WP2 |
| `cost:` | keys of `COST_PART_IMPLS` (`rules/cost.ts`) | WP7 |
| `ev:` | keys of `EVENT_MATCHERS` (`triggers/match.ts`) | WP8 |
| `cond:`, `q:`, `ref:`, `dur:` | keys of the evaluator tables in `effects/eval.ts`, `effects/refs.ts` | WP4 |
| `filter:` | `SUPPORTED_FILTER_FIELDS` exported by `rules/filter.ts` | WP4 |
| `target:` | kinds handled by `rules/targets.ts` | WP7 |
| `static:`, `body:`, `rule:`, `permit:`, `rulemod:` | `STATIC_KINDS`, `REPLACEMENT_BODIES`, `RULE_HOOK_ACTIONS` registered by `statics/*` and `effects/propose.ts` | WP9, WP11, WP16 |
| `layer:` | `LAYER_TABLE` (`statics/layers.ts`) | WP9 |
| `keyword:` | `KeywordRegistry.capabilities()` (status implemented or native) | WP3 |
| `action:` | `ACTION_MACROS` keys | WP3 |
| `decision:` | decision kinds `core/validate.ts` accepts | WP0 |
| `feature:` | explicit constants (`feature:trigger.batch`, `feature:replace.foreign`, ...) | each owner |

The `feature:` constants defined by this design: `feature:modes.override` (kicker-style mode counts, entwine), `feature:trigger.batch` ("one or more"), `feature:trigger.limit` ("only once each turn"), `feature:replace.self`, `feature:replace.foreign`, `feature:dependency` (trial-application ordering), `feature:history` (the `GameState.history` filters and quantities), `feature:manual.reminder`. WP8's review added the finer event forms of `triggers/forms.ts`, which the walker asks for with `eventPatternForms`, `delayedWhenForms` and `triggerForms` (`ev:<ev>` itself is registered only for kinds the engine emits): `feature:ev.action.<verb>`, `feature:ev.becomes.<what>` (registered for the verbs and changes whose events exist), `feature:ev.cast.orCopy`, `feature:ev.beginTurn.extra`, `feature:ev.becomes.by`, `feature:ev.cmp.quantity`, `feature:delayed.step.notNext`, `feature:trigger.mana` (a triggered mana ability, CR 605.1b; not registered). A feature is registered by the package that implements it.

Because the template parser skips templates whose `needs` capabilities are missing and `degrade` turns units that use a missing capability into manual nodes, **an unfinished work package can never make a card wrongly automated**: the card just stays `partial` or `manual` until the table gains the key.

### 5.3 The contracts (all compiled)

The files below are the frozen interfaces. The doc-comments are normative. They are shown in dependency order.

#### `model/api.ts` (WP1)

```ts
/**
 * model/: everything that treats ability JSON as data (no game state, no I/O). Owner: WP1.
 * Files: model/validate.ts, model/lint.ts, model/capabilities.ts, model/degrade.ts, model/classify.ts, model/strip.ts,
 * model/canonical.ts, model/hash.ts, model/schema.generated.json (+ model/index.ts re-exporting this API).
 */
import type { AbilityDef } from '../types/ability';
import type { AbilityAutomation, CardAutomation, ManualSpan, ReviewState } from '../types/automation';
import type { CardDef } from '../types/card';

// ---- validation: schema (types cannot say everything) + semantic lint -------------------------------------------------

export type IssueCode =
  | 'schema' // JSON does not match the generated JSON Schema (unknown op, missing required field, wrong tag)
  | 'unbound-name' // {ref:'bound'}, {cond:'did'}, {q:'resultCount'} names a step that is not earlier on every path
  | 'duplicate-name' | 'unknown-target' | 'duplicate-target' | 'bad-distinct' | 'bad-target-count'
  | 'bad-var' // {q:'var'} without a `let`; {q:'X'} in an ability whose cost has no X and that is not a spell with X
  | 'bad-event-role' // {ref:'event', role} not exposed by every pattern of the trigger (design 3.5), or `event` outside a trigger/replacement
  | 'bad-subject' // {ref:'subject'} outside a continuous effect or an `each`-scoped quantity
  | 'bad-layer' // layer 7a without `cda`; a modification in the wrong layer for its payload
  | 'bad-divide' // divided:'announced' without a TargetSpec.divide
  | 'bad-capture' // delay.capture names an unbound step
  | 'unlinked' // a `linked`/`chosen` consumer without a producer on the same object (or reverse: warning)
  | 'ask-position' // {cond:'ask'} / {q:'ask'} / CostPart manual in a position that must be automated (design 10.1)
  | 'live-position' // {q:'live'} outside a continuous-effect mod
  | 'modal-ids' // target ids not unique across modes
  | 'fixed-in-card-data' // {ref:'fixed'} is written only by the `effect` handler into game state, never in card data, packs or LLM output
  | 'spell-target-count' // {q:'spellTargetCount'} outside a self cost modifier
  | 'executable-gap'; // a node the interpreter has no semantics for (e.g. both `units` and `dynamic` on addMana)

export interface Issue {
  /** JSON pointer inside the ability, e.g. "/effect/steps/2/to". */
  path: string;
  code: IssueCode;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidateContext {
  /** True when the ability sits on a card that has a linked-ability producer for `link` (checked card-wide by validateCardAbilities). */
  cardHasX?: boolean;
  layout?: string;
}

/** Schema + lint for one ability. Pure. Errors make the ability unusable (the compiler turns it into a manual ability with the first message). */
export type ValidateAbility = (def: AbilityDef, ctx?: ValidateContext) => Issue[];
/** Card-wide checks: link producers/consumers across abilities, duplicate keywords, face structure. */
export type ValidateCardAbilities = (faces: { abilities: AbilityDef[] }[]) => Issue[];

// ---- capabilities ---------------------------------------------------------------------------------------------------

/**
 * Capability names, one per discriminator value the engine may or may not implement:
 *   op:<op>  cost:<kind>  ev:<ev>  cond:<cond>  q:<q>  ref:<ref>  filter:<ObjectFilter field>  dur:<d>  target:<kind>
 *   static:<s>  layer:<layer>  body:<b>  rule:<RuleAction>  permit:<action>  rulemod:<rule>  restrict:<mode>
 *   keyword:<name>  action:<KeywordActionName>  decision:<kind>  ability:<kind>  feature:<name>   (feature: modes.override, trigger.batch, ...)
 * The engine exports ENGINE_CAPABILITIES, a Set<string> BUILT from its own tables (OP_HANDLERS keys, keyword registry,
 * evaluator tables, layer table), so adding a handler registers its capability without a second list.
 */
export type Capability = string;
export type CapabilitySet = ReadonlySet<Capability>;

/** Walk an ability and list the capabilities it needs (deterministic order, no duplicates). */
export type CapabilitiesOf = (def: AbilityDef) => Capability[];

/** Capabilities of `def` that `caps` lacks. */
export type MissingCapabilities = (def: AbilityDef, caps: CapabilitySet) => Capability[];

// ---- degradation (the only place an understood node becomes manual because of the engine) ---------------------------

/** The normalized Oracle lines of one face, used to hydrate manual node text. */
export interface FaceLines {
  lines: string[];
  /** Sentences per line, same indexing as AbilityBase.src and StepBase.sentence. */
  sentences: string[][];
}

export interface DegradeResult {
  def: AbilityDef;
  /** Capabilities that were missing and caused a node to become manual (also copied to CardAutomation.requiresEngine). */
  requires: Capability[];
}

/**
 * Replace every node that uses a missing capability by the manual node of the smallest enclosing unit (design 10.2):
 *   step (op, quantity, condition, filter, ref, duration, decision)  -> {op:'manual'} for that step, then taint (design 6.7)
 *   cost part                                                         -> CostPart {kind:'manual'}
 *   target spec, trigger event, intervening if, static effect or condition, activation `onlyIf` of kind other than ask
 *                                                                      -> the whole ability becomes ManualAbilityDef (cost/effect kept when understood)
 * Pure and idempotent; run by compileCard on every ability from every source (parser, LLM cache, pack, hand).
 */
export type DegradeAbility = (def: AbilityDef, caps: CapabilitySet, lines: FaceLines) => DegradeResult;

// ---- classification -------------------------------------------------------------------------------------------------

export interface ClassifyInput {
  faces: { abilities: AbilityDef[]; lines: FaceLines }[];
  /** Data source of the highest-precedence ability on the card. */
  source: CardAutomation['source'];
  review?: ReviewState;
  textHash?: string;
  /** Local kill switch (design 10.4): the card is treated as manual. */
  forceManual?: boolean;
  /** Names of templates marked experimental that matched (cap at partial, design 6.9). */
  experimentalTemplates?: string[];
}

/** Pure: the level of every ability and of the card (rules in design 10.3), manual spans, autoRatio, requiresEngine. */
export type ClassifyCard = (input: ClassifyInput, caps: CapabilitySet) => CardAutomation;
export type ClassifyAbility = (def: AbilityDef, caps: CapabilitySet) => AbilityAutomation;
/** Manual nodes of an ability in document order (used by the UI to paint Oracle text). */
export type ManualNodes = (def: AbilityDef) => ManualSpan[];

// ---- stored form (packs, LLM cache): structure without any display text -----------------------------------------------

/**
 * Same shape as AbilityDef with every display field removed: AbilityBase.text, .label, StepBase.span, TargetSpec.text,
 * ModeSpec option text, manual node text. `src` and `sentence` indices stay. Typed as unknown-JSON because it is
 * validated by the generated schema with display fields optional.
 */
export type StoredAbility = Record<string, unknown>;

export type StripAbility = (def: AbilityDef) => StoredAbility;
/** Restores display text from the player's local Oracle lines. Returns null (and the caller discards the entry) when `textHash` differs. */
export type HydrateAbility = (stored: StoredAbility, lines: FaceLines, expectedHash: string, actualHash: string) => AbilityDef | null;

/** SHA-256 hex of the normalized Oracle text of all faces (NFC, straight quotes, collapsed spaces, "\n" between lines, faces joined by "\n//\n"). */
export type TextHash = (cardFacesOracleText: string[]) => string;

// ---- canonical form --------------------------------------------------------------------------------------------------

/**
 * One JSON form per meaning: fields in a fixed order, defaults removed (only where the type has a default: none of `who`, `source`, `caster`),
 * arrays sorted where order is meaningless (types, colors, anyOf), nested single-element `all`/`any` collapsed.
 * Used by the cache, the diff tools, the corpus snapshot and the "two LLM runs agree" check.
 */
export type Canonicalize = (def: AbilityDef) => AbilityDef;

export type _Keep = CardDef;
```

#### `render/api.ts` (WP2)

```ts
/**
 * render/: JSON -> canonical English, a pure function of the JSON ALONE (never of the text it came from). Owner: WP2.
 * Files: render/render.ts (dispatch), render/{cost,filter,quantity,condition,duration,event,step,static,keyword}.ts,
 * render/equivalence.ts (normalization table), render/gate.ts.
 */
import type { AbilityDef } from '../types/ability';

export interface RenderContext {
  /** Face name and the other face names of the card, for "~" handling. */
  selfNames: string[];
  /** Ability kind of the unit being rendered decides the grammatical frame. */
}

/** One string per sentence, same order and count as the ability's Oracle sentences (display, tooltips, "how OpenMTG plays this card"). */
export type RenderAbility = (def: AbilityDef, ctx: RenderContext) => string[];

export interface GateResult {
  ok: boolean;
  /** normalize(render(def)) */
  rendered: string;
  /** normalize(oracle line(s) of the ability) */
  expected: string;
  /** First differing word index, for diagnostics and the LLM repair prompt. */
  firstDiff?: number;
}

/**
 * Guard G6. EXACT equality after normalization (case, straight quotes, "~", number words vs digits, articles a/an/one in
 * quantity position, "its owner's"/"their owner's" where the model says the same, listed anaphora variants it/that creature/them
 * at positions the renderer marks anaphoric, reminder text removed). Anything else is a mismatch; the ability becomes manual
 * with diagnostic `gate-mismatch`. The false-reject rate is a tracked metric (design 6.12), not a reason to loosen the gate.
 */
export type RenderGate = (def: AbilityDef, oracleLines: string[], ctx: RenderContext) => GateResult;

/** The normalization used on both sides of the gate. Exported so tests and the LLM repair prompt use the same one. */
export type NormalizeForGate = (text: string, selfNames: string[]) => string;
```

#### `keywords/types.ts` (WP3)

```ts
/**
 * keywords/: the keyword library (CR 702 abilities, CR 701 actions), implemented once. Owner: WP3 (registry, data, hooks, actions).
 *
 * Files:
 *   keywords/types.ts          this file
 *   keywords/registry.ts       loads keywords/data/*.json, implements KeywordRegistry
 *   keywords/expand.ts         placeholder substitution ($cost, $amount, ...) -> AbilityDef[]; pure
 *   keywords/data/<name>.json  one KeywordDefData per keyword (single source of truth; NO parallel TypeScript expand functions)
 *   keywords/hooks/*.ts        KeywordHooks implementations (flying.ts, protection.ts, ...), registered by name in hooks/index.ts
 *   keywords/special/*.ts      special actions (foretell, suspend, plot, morph, ...), registered in special/index.ts
 *   keywords/actions/*.ts      CR 701 action macros, registered in actions/index.ts
 *   keywords/capabilities.ts   builds the keyword:* and action:* capability names
 */
import type { AbilityDef, CostDef, KeywordAbilityDef, KeywordActionName, EffectStep, ZoneName } from '../types/ability';
import type { Denial } from '../rules/denial';
import type { Chars } from '../rules/characteristics';
import type { Game } from '../core/game';
import type { ObjectId, PlayerId } from '../types/ids';

/** The six mechanisms by which a keyword plugs into the rules. A keyword may use several. */
export type Mechanism =
  | 'flag' // F: read through the characteristics function (c.abilities contains the keyword)
  | 'hook' // H: the engine consults the keyword at a named call-site (KeywordHooks)
  | 'expands' // X: expands into ordinary abilities (activated, triggered, static, replacement)
  | 'castOption' // C: contributes alternative/additional costs (as statics in `expand`) or special actions
  | 'replacement' // R: contributes replacement effects (inside `expand`)
  | 'structural'; // S: needs state machinery beyond abilities (face-down, day/night, speed, merge)

export interface KeywordParam {
  name: 'cost' | 'amount' | 'quality' | 'filter';
  type: 'cost' | 'number' | 'quality' | 'filter' | 'costOrNumber';
  optional?: boolean;
}

/** One file of keywords/data. Pure JSON. */
export interface KeywordDefData {
  /** Canonical lower-case name, the value of KeywordAbilityDef.keyword. */
  name: string;
  aliases?: string[];
  /** CR 702.x */
  rule: string;
  params: KeywordParam[];
  mechanisms: Mechanism[];
  /** CR reminder wording with {cost}, {n}, {quality}. Used to confirm a keyword line and by the renderer. Never executed. */
  reminder: string;
  /** What several instances of the keyword do together (CR 702.x rules about multiple instances). */
  multiple: 'redundant' | 'cumulative' | 'independent';
  /**
   * `implemented`: every mechanism listed exists in this engine build (flags are read, hooks registered, expansion valid).
   * `planned`: the line parses and displays, the engine cannot act (capability keyword:<name> absent -> manual with requiresEngine).
   * `native`: acted on by engine code that predates the data form (flashback exile in core/resolve.ts in M5); the data form is the spec, used by
   *           the renderer and enabled as the engine path the day the native code is removed (milestone 6).
   */
  status: 'implemented' | 'planned' | 'native';
  /** Names of KeywordHooks this keyword implements (hooks/ directory). */
  hooks?: HookName[];
  /**
   * Flag/hook keywords: the engine call-sites that read the keyword, as "<file>#<function>". A grep test fails if a keyword with status
   * `implemented` and mechanism flag or hook has no reader (no keyword is silently ignored).
   */
  readers?: string[];
  /**
   * Pack form of the keyword's expansion: ability JSON in which whole string values "$cost", "$amount", "$quality", "$filter" are
   * replaced by the keyword instance's parameters, and the objects {"$costAdd":{"base":"$cost","other":[...]}} / {"$ifParam":"amount","then":X,"else":Y}
   * are evaluated by keywords/expand.ts. Nothing else: no code, no arithmetic.
   */
  expand?: unknown[];
}

export type HookName = keyof KeywordHooks;

/** Engine call-sites a keyword can hook. Each returns a denial (with CR citation) or null, or adjusts a value. Table in design 7.3. */
export interface KeywordHooks {
  canAttack(g: Game, attacker: ObjectId, defender: PlayerId | ObjectId): Denial | null; // defender 702.3b
  canBeBlocked(g: Game, attacker: ObjectId, blocker: ObjectId): Denial | null; // flying, reach, shadow, fear, intimidate, horsemanship, skulk (702.118), landwalk, protection
  blockSetValid(g: Game, attacker: ObjectId, blockers: ObjectId[]): Denial | null; // menace 702.111b
  attackTaps(c: Chars): boolean; // vigilance 702.20b
  summoningSick(c: Chars): boolean; // haste 702.10b
  castTiming(c: Chars): 'instant' | null; // flash 702.8a
  canBeTargetedBy(g: Game, target: ObjectId, source: ObjectId, controller: PlayerId): Denial | null; // hexproof, shroud, protection
  combatDamageSteps(c: Chars): ('first' | 'regular')[]; // first strike, double strike 702.7b / 702.4b
  assignCombatDamage(c: Chars): { trample: boolean; deathtouch: boolean }; // 702.19b, 702.2c
  onDamageDealt(g: Game, source: ObjectId, amount: number, to: ObjectId | PlayerId): void; // lifelink 702.15b, deathtouch flag, infect/wither/toxic
  indestructible(c: Chars): boolean; // 702.12b
  canBeEnchantedBy(g: Game, aura: ObjectId, host: ObjectId): Denial | null; // protection, enchant
  canBeEquippedBy(g: Game, equipment: ObjectId, host: ObjectId): Denial | null;
  paymentOptions(g: Game, spell: ObjectId): PaymentOption[]; // convoke, improvise, delve, emerge
}

export interface PaymentOption {
  key: string;
  /** What the player may do instead of paying mana (tap creatures, exile cards from the graveyard, sacrifice a creature). */
  describe: string;
  reduces: { generic?: number; colors?: string[] };
  cost: CostDef;
}

/** A special action a keyword grants (CR 116.2): foretell, suspend, plot, turn a face-down permanent face up. */
export interface SpecialActionDef {
  key: string;
  rule: string;
  /** Zones the object must be in. */
  zones: ZoneName[];
  timing: 'priority' | 'sorceryTiming';
  check(g: Game, object: ObjectId, player: PlayerId): Denial | null;
  perform(g: Game, object: ObjectId, player: PlayerId): void;
}

export interface ExpandContext {
  /** Printed or granted. Granted keywords are expanded on the fly (CR 613.1f). */
  granted: boolean;
  faceName: string;
  types: string[];
  /** Prefix of the generated stable ability keys: `k:<face>:<index>` (design 7.1). */
  keyPrefix: string;
}

export interface KeywordDef extends KeywordDefData {
  hookImpl: Partial<KeywordHooks>;
  special: SpecialActionDef[];
}

export interface KeywordRegistry {
  get(name: string): KeywordDef | undefined;
  /** Canonical names, sorted. */
  names(): string[];
  /** Pure: AbilityDef[] a keyword instance stands for (may be empty for flag keywords). */
  expand(kw: KeywordAbilityDef, ctx: ExpandContext): AbilityDef[];
  /** `keyword:<name>` for every status implemented|native keyword, `action:<name>` for every implemented action. */
  capabilities(): string[];
}

/** A CR 701 keyword action as a pure expansion over the primitive ops. A few actions need engine state (vote, venture, ring) and set `native`. */
export interface ActionMacro {
  name: KeywordActionName;
  /** CR 701.x */
  rule: string;
  expand?: (step: Extract<EffectStep, { op: 'action' }>) => EffectStep[];
  /** Name of a handler in effects/handlers/actions-native.ts for actions that cannot be written as steps. */
  native?: string;
}
```

#### `rules/hookpoints.ts` (WP0)

```ts
/**
 * rules/hookpoints.ts: the ONE place engine call-sites ask "may this happen?". Owner: WP0 (final after WP0; never edited by later packages).
 *
 * Why it exists: keyword hooks (WP3) and static restrictions (WP17) both need to be consulted at the same call-sites (combat declaration,
 * targeting, casting, activating, ...). If both packages edited rules/combat.ts, rules/targets.ts and actions/cast.ts they would collide.
 * WP0 rewires every call-site ONCE to call a function of this file; each package contributes a provider object registered below.
 * Every function returns the first denial any provider produces ("can't" beats "can", CR 101.2) or null.
 */
import type { Game } from '../core/game';
import type { Denial } from './denial';
import type { ObjectId, PlayerId } from '../types/ids';
import type { Chars } from './characteristics';
import type { PaymentOption } from '../keywords/types';

/** Everything a provider may veto. Providers implement the subset they care about. */
export interface RuleHookProvider {
  name: 'keywords' | 'statics';
  canAttack?(g: Game, attacker: ObjectId, defender: PlayerId | ObjectId): Denial | null; // CR 508.1, 702.3b
  canBlock?(g: Game, blocker: ObjectId, attacker: ObjectId): Denial | null; // CR 509.1a-b: evasion keywords, protection, "can't block", "can't be blocked by"
  blockSetValid?(g: Game, attacker: ObjectId, blockers: ObjectId[]): Denial | null; // CR 509.1b: menace
  canBeTargeted?(g: Game, target: ObjectId | PlayerId, source: ObjectId, controller: PlayerId): Denial | null; // CR 115: hexproof, shroud, protection, "can't be the target"
  canCast?(g: Game, spell: ObjectId, player: PlayerId): Denial | null; // CR 601.3: "can't cast", castFromZone
  canActivate?(g: Game, source: ObjectId, abilityKey: string, player: PlayerId): Denial | null; // CR 602.5
  canPlayLand?(g: Game, land: ObjectId, player: PlayerId): Denial | null; // CR 305.2 (rule mod landPlays)
  canAttach?(g: Game, attachment: ObjectId, host: ObjectId): Denial | null; // CR 702.16c-d, 704.5m-n
  canBeCountered?(g: Game, spell: ObjectId): Denial | null; // CR 101.2: "can't be countered"
  /** Boolean/number queries (no denial text needed). */
  attackTaps?(c: Chars): boolean | undefined; // vigilance
  summoningSick?(c: Chars): boolean | undefined; // haste
  castsAsInstant?(c: Chars): boolean | undefined; // flash
  paymentOptions?(g: Game, spell: ObjectId): PaymentOption[]; // convoke, improvise, delve, emerge
}

/** Registered by WP0 (importing the two provider modules, which WP0 creates as empty providers). The order is irrelevant: any denial wins. */
export type Providers = readonly RuleHookProvider[];

export interface Hookpoints {
  canAttack(g: Game, attacker: ObjectId, defender: PlayerId | ObjectId): Denial | null;
  canBlock(g: Game, blocker: ObjectId, attacker: ObjectId): Denial | null;
  blockSetValid(g: Game, attacker: ObjectId, blockers: ObjectId[]): Denial | null;
  canBeTargeted(g: Game, target: ObjectId | PlayerId, source: ObjectId, controller: PlayerId): Denial | null;
  canCast(g: Game, spell: ObjectId, player: PlayerId): Denial | null;
  canActivate(g: Game, source: ObjectId, abilityKey: string, player: PlayerId): Denial | null;
  canPlayLand(g: Game, land: ObjectId, player: PlayerId): Denial | null;
  canAttach(g: Game, attachment: ObjectId, host: ObjectId): Denial | null;
  canBeCountered(g: Game, spell: ObjectId): Denial | null;
  attackTaps(c: Chars): boolean; // true unless some provider says false
  summoningSick(c: Chars): boolean; // true unless some provider says haste
  castsAsInstant(c: Chars): boolean;
  paymentOptions(g: Game, spell: ObjectId): PaymentOption[];
}
```

The keyword provider maps `canBlock(blocker, attacker)` to the keyword hook `canBeBlocked(attacker, blocker)` and `canBeTargeted` to `canBeTargetedBy`; the static provider answers from `RestrictionDef`s (9.4). Milestone 4's direct `hasKeyword` checks in combat, targeting and damage code are replaced by calls to these functions in WP0 (behavior unchanged), which is what lets WP3 and WP16 work in parallel.

#### `parser/types.ts` (WP5)

```ts
/**
 * parser/: Oracle text -> ability model. Pure, deterministic, no I/O, runs in the engine package (browser and Node). Owners: WP5 (front end),
 * WP6 (chart parser, hole grammars), WP17 (lowering, anaphora, taint, parseCard), WP19-WP23 (template data).
 *
 * Files:
 *   parser/types.ts                this file
 *   parser/lexicon.generated.json  GENERATED by scripts/gen-lexicon.ts from rules/cr/ (+ the local Oracle index for card-type words); a test fails if stale
 *   parser/preprocess.ts           normalize, reminder text, self reference "~", labels, ability words
 *   parser/segment.ts              lines -> abilities (classification) -> sentences; modal bullets, chapters, levels, dice rows, spree
 *   parser/tokenize.ts             tokens (WORD NUM X MANA TAP PT MOD ROMAN SELF PUNCT BULLET QUOTE ERR)
 *   parser/chart.ts                Earley chart parser over tokens, whole-derivation ambiguity detection, node budget (WP6)
 *   parser/holes/{filter,object,player,qty,cost,cond,dur,event,token,zone,misc}.ts   typed hole grammars (code)
 *   parser/templates/{cost,trigger,condition,duration,keyword,static,ability}.json, parser/templates/effect/*.json   template data (WP19-WP23)
 *   parser/lower/{targets,anaphora,riders,quantities,durations,conditions,optionality,sequencing,normalize}.ts   lowering passes (WP17)
 *   parser/taint.ts                contagion / poisoning / look-ahead taint (design 6.7)
 *   parser/parse.ts                parseCard (never throws)
 *   parser/metrics.ts              out-of-sample retention, ambiguity list, residue clustering (used by the coverage CLI)
 */
import type { AbilityDef } from '../types/ability';
import type { OracleCard } from '../types/card';
import type { GateResult } from '../render/api';

/** Pattern DSL (design 6.3): WORD, {name:Type}, [optional], (a|b), ~, word[s]/word[es], ^ sentence start. */
export type HoleType =
  | 'Qty' | 'Count' | 'Obj' | 'Objs' | 'Player' | 'Recipient' | 'Filter' | 'Cost' | 'Cond' | 'Dur' | 'Event' | 'Color' | 'Zone'
  | 'CounterKind' | 'ManaCost' | 'PT' | 'Keyword' | 'TokenDesc' | 'ChoiceKind' | 'Effects' | 'Text' | 'Abilities' | 'Name' | 'Lib';

export type TemplateKind = 'ability' | 'cost' | 'trigger' | 'condition' | 'effect' | 'static' | 'filter' | 'quantity' | 'duration' | 'event' | 'rider';

export interface TemplateExample {
  /** Minimal or synthetic wording (invented numbers/names), NOT verbatim card text: committed templates must not carry Wizards text (design 6.10). */
  text: string;
  /** JSON the example must lower to; omitted = "must parse, render identically and pass the gate". */
  expect?: unknown;
}

/** A bidirectional text pattern. Pure data: it ships in rules packs (examples are stripped from packs). */
export interface Template {
  id: string;
  kind: TemplateKind;
  /** Rules cited by the template (CR 608.2c, 118.12a, ...). At least one is required. */
  cr: string[];
  pattern: string;
  /**
   * JSON to produce; strings "$hole" and "$hole.field" are substituted by captured values;
   * {"$when":"hole","then":X,"else":Y} chooses by presence of an optional hole;
   * {"$patchPrevious":{...}} merges fields into the previous step (riders such as "They can't be regenerated").
   * Nothing else: no code, no expressions.
   */
  build: unknown;
  /** Effect/static templates: the sort of subject the pattern requires (prunes the search). */
  subject?: 'object' | 'player' | 'any' | 'none';
  /** Riders only: the op of the previous step the sentence attaches to. */
  attachTo?: string;
  examples: TemplateExample[];
  /** Wordings that look similar but MUST NOT match, or must parse to different JSON (mutation tests, guard G9). At least two. */
  counterExamples: string[];
  /** Words of rules meaning that this template interprets itself (so the critical-word check G2 passes). */
  consumes?: string[];
  priority?: number;
  /** `experimental` (fewer than 20 corpus matches and not yet reviewed): cards using it are capped at `partial` (design 6.9). */
  status: 'stable' | 'experimental';
  since: number;
  /** Capabilities the output needs; the template is skipped (the sentence stays manual with requiresEngine) on engines that lack them. */
  needs?: string[];
}

export interface LedgerEntry {
  /** Character range in the normalized text of the face. */
  range: [number, number];
  status: 'consumed' | 'reminder' | 'label' | 'structure' | 'manual';
  by?: string;
  reason?: string;
}

export type DiagnosticCode =
  | 'no-template' | 'unknown-word' | 'ambiguous' | 'critical-word' | 'leftover-text' | 'gate-mismatch' | 'unbound-reference'
  | 'needs-engine' | 'lint' | 'contagion' | 'poisoned' | 'budget' | 'parser-error' | 'unknown-keyword' | 'force-manual' | 'experimental';

export interface Diagnostic {
  level: 'info' | 'warning' | 'manual';
  code: DiagnosticCode;
  message: string;
  range?: [number, number];
  /** Furthest token the parser reached and the tokens it would have accepted there (LLM repair prompt, mining report). */
  furthest?: { token: string; expected: string[] };
  /** The lowered alternatives when code is 'ambiguous'. */
  alternatives?: unknown[];
}

export interface Lexicon {
  crEdition: string;
  cardTypes: string[];
  supertypes: string[];
  subtypes: { singular: string; plural: string; class: 'creature' | 'land' | 'artifact' | 'enchantment' | 'spell' | 'planeswalker' | 'battle' }[];
  colors: { word: string; color: string }[];
  keywordAbilities: { name: string; rule: string }[];
  keywordActions: { name: string; rule: string; forms: string[] }[];
  counterKinds: string[];
  predefinedTokens: { name: string; rule: string }[];
  abilityWords: string[];
}

export interface ParseOptions {
  templates: Template[];
  lexicon: Lexicon;
  /** `keyword:*`, `op:*` ... of the running engine; templates whose `needs` are missing are skipped. */
  capabilities: ReadonlySet<string>;
  /** Registered keyword names and parameter shapes (from KeywordRegistry). */
  keywords: { name: string; aliases: string[]; params: string[]; reminder: string }[];
  /** All card names of the local index, for "named X" and self-reference of other cards. Optional. */
  cardNames?: ReadonlySet<string>;
  /** Hard limit on chart items per ability; exceeding it makes the ability manual with code 'budget'. */
  budget?: number;
}

export interface FaceParse {
  abilities: AbilityDef[];
  ledger: LedgerEntry[];
  diagnostics: Diagnostic[];
  /** Render-gate result per ability (same order as `abilities`). Empty for manual abilities. */
  gate: GateResult[];
  templatesUsed: string[];
  /** Ids of experimental templates that matched (they cap the card at partial). */
  experimental: string[];
}

export interface ParseResult {
  faces: FaceParse[];
  parserVersion: string;
}

/** Never throws: an exception inside a face becomes one manual ability with diagnostic 'parser-error' (contract C1). */
export type ParseCard = (card: OracleCard, opts: ParseOptions) => ParseResult;
```

#### `effects/api.ts` (WP0 types; implementations WP4, WP10-WP15)

```ts
/**
 * effects/: the interpreter. Plain imperative code over the ability JSON, re-executed from the settled base state on every
 * decision (docs/ARCHITECTURE.md, "The decision model"). Owners: WP4 (ctx, refs, eval), WP10 (spine), WP11 (propose), WP12-WP15 (handler families).
 *
 * Files:
 *   effects/api.ts            this file (types shared by all handlers)
 *   effects/run.ts            resolveStackObject, runSteps, manualFallback             (WP10)
 *   effects/ctx.ts            makeCtx, target legality                                 (WP4)
 *   effects/refs.ts           resolveObjs, resolvePlayers, readInfo, rebase            (WP4)
 *   effects/eval.ts           evalQty, evalCond, evalCount, filter evaluation          (WP4; with rules/filter.ts)
 *   effects/handlers/index.ts OP_HANDLERS = { ...control, ...damage, ...cards, ... }   (WP0 writes it once, importing every family file as a stub)
 *   effects/handlers/control.ts      if may pay forEach repeat let chooseObjects chooseValue manual   (WP10)
 *   effects/handlers/lifedamage.ts   damage gainLife loseLife setLife fight                           (WP12)
 *   effects/handlers/counters.ts     putCounters removeCounters moveCounters                           (WP12)
 *   effects/handlers/cards.ts        draw discard mill scry surveil reveal look search shuffle piles addMana   (WP13)
 *   effects/handlers/zones.ts        move destroy sacrifice sacrificeChoice counter tap untap attach changeFace phaseOut regenerate removeFromCombat exchange   (WP14)
 *   effects/handlers/tokens.ts       createToken copy cast                                             (WP14)
 *   effects/handlers/lasting.ts      effect delay reflexive                                            (WP15)
 *   effects/handlers/game.ts         extraTurn extraPhase endTurn winGame loseGame createEmblem rollDie flipCoin designate action   (WP15)
 *   effects/propose.ts perform.ts  the proposal pipeline (CR 614-616) and the performers    (WP11)
 *   effects/manual.ts         manual step support (manualResolve prompts, reminders)       (WP10)
 */
import type { Game } from '../core/game';
import type { EventContext, ObjHandle } from '../types/state-additions';
import type { EffectProgram, Name, EffectStep, EffectOp, ReplacementDef } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameObject, LastKnown, StackInfo, TargetChoice, ZoneKind } from '../types/state';

/** What an earlier name was bound to, plus what the objects were like when bound (for last known information, CR 608.2h). */
export interface Binding {
  objects: ObjHandle[];
  players: PlayerId[];
  snapshots: Record<ObjectId, LastKnown>;
}

export interface StepResult {
  /** The step carried out its action at least once (for `may`/`pay`: the player chose to; CR 118.12). */
  performed: boolean;
  count: number;
}

export interface TargetSlot {
  handle: ObjHandle | null;
  player?: PlayerId;
  /** Result of the CR 608.2b re-check. */
  legal: boolean;
}

/** One resolution. Rebuilt on every re-execution, never stored in GameState. */
export interface ExecCtx {
  g: Game;
  /** Spell, or the source of the ability. Falls back to last known information once it has left (CR 113.7a, 608.2h). */
  source: ObjHandle;
  /** The spell or ability on the stack, if any. */
  stackId: ObjectId | null;
  controller: PlayerId;
  /** The effective program: chosen modes' programs concatenated in printed order (CR 700.2d), then the ability's own steps. */
  program: EffectProgram;
  stack: StackInfo | null;
  /** Per target spec id (unique across all chosen modes): chosen targets and their CR 608.2b legality. ONE legality check for the whole ability. */
  targets: Map<string, TargetSlot[]>;
  event: EventContext | null;
  bindings: Map<Name, Binding>;
  results: Map<Name, StepResult>;
  vars: Map<string, number>;
  /** Iteration variable inside forEach. */
  iterating?: PlayerId | ObjHandle;
  /** Set while a continuous effect's modifications are evaluated, for {ref:'subject'}. */
  subject?: ObjHandle;
}

export type StepHandler<S extends EffectStep = EffectStep> = (cx: ExecCtx, step: S) => StepResult;
export type OpHandlers = { [K in EffectOp]?: StepHandler<Extract<EffectStep, { op: K }>> };

/** An event the engine is about to perform, before replacement and prevention (CR 614.1, 616.1). */
export type Proposed =
  | { ev: 'damage'; source: ObjHandle; to: ObjHandle | PlayerId; amount: number; combat: boolean; unpreventable: boolean }
  | { ev: 'life'; change: 'gain' | 'loss'; player: PlayerId; amount: number }
  | { ev: 'draw'; player: PlayerId }
  | { ev: 'zoneChange'; object: ObjHandle; from: ZoneKind; to: ZoneKind; destination: DestinationFacts }
  | { ev: 'createToken'; player: PlayerId; count: number; token: string }
  | { ev: 'counters'; change: 'put' | 'removed'; on: ObjHandle | PlayerId; kind: string; count: number }
  | { ev: 'destroy'; object: ObjHandle; canRegenerate: boolean }
  | { ev: 'step'; step: string; whose: PlayerId };

export interface DestinationFacts {
  tapped?: boolean;
  faceDown?: boolean;
  controller?: PlayerId;
  counters?: { kind: string; count: number }[];
  /** Filled by an "enters as a copy" replacement (CR 614.12, 616.1c). */
  copyOf?: ObjHandle;
}

/** One replacement or prevention effect that currently applies (CR 616.1). */
export interface ApplicableReplacement {
  id: string;
  def: ReplacementDef;
  source: ObjHandle;
  /** CR 616.1a-e priority class: 0 self-replacement, 1 control, 2 copy, 3 back face, 4 everything else. */
  klass: 0 | 1 | 2 | 3 | 4;
}

/** The single funnel through which EVERY state-changing op acts (no handler mutates zones, life, damage or counters directly). */
export type Propose = (g: Game, e: Proposed) => boolean;

/** Entry point called by core/resolve.ts for the top object of the stack. Replaces the manual-only body of resolveSpell/resolveAbility. */
export type ResolveStackObject = (g: Game, obj: GameObject) => void;

export type _Keep = TargetChoice;
```

#### `triggers/api.ts` (WP8)

```ts
/**
 * triggers/: event normalization, trigger collection, delayed/reflexive/state triggers, stack placement. Owner: WP8 (all files in this directory).
 *
 * Files:
 *   triggers/api.ts          this file
 *   triggers/normalize.ts    GameEvent[] -> SemEvent[] (batches), history entries
 *   triggers/match.ts        matchEvent(pattern, sem, ctx): the ONE matcher for triggers, replacements, delayed triggers, durations, history filters
 *   triggers/lookback.ts     lookBackKinds(pattern): CR 603.10a-g, decided from the pattern
 *   triggers/collect.ts      collectTriggers(g, batch): candidates, intervening if (603.4), triggerMod count (603.2d), limits (603.2h)
 *   triggers/delayed.ts      delayed (603.7) and reflexive (603.12) records
 *   triggers/state.ts        state triggers (603.8), checked after each SBA pass
 *   triggers/stack.ts        putPendingTriggersOnStack: APNAP (603.3b), modes (603.3c), targets (603.3d)
 * core/triggers.ts becomes a one-line re-export of triggers/stack.ts#putPendingTriggersOnStack (the hook M3 left).
 */
import type { Game } from '../core/game';
import type { EventPattern } from '../types/ability';
import type { GameEvent } from '../types/events';
import type { ObjectId } from '../types/ids';
import type { GameObject, PendingTrigger } from '../types/state';
import type { LookBackKind, SemEvent } from '../types/state-additions';

/** Pure: the engine events of one simultaneous action become one batch of semantic events. */
export type Normalize = (g: Game, events: GameEvent[], batch: number) => SemEvent[];

export interface MatchContext {
  g: Game;
  /** The object whose ability (or the effect's source) owns the pattern; "self"/"other" filters are relative to it. */
  source: ObjectId;
  /** The controller "you"/"opponent" are relative to. */
  controller: string;
  /** Evaluate against snapshots in `e.before` instead of the current state (look-back events). */
  lookBack: boolean;
}

/** Does `e` match `pattern`? Filters are evaluated against the AFTER state, or the before snapshot for look-back events (CR 603.10). */
export type MatchEvent = (pattern: EventPattern, e: SemEvent, cx: MatchContext) => boolean;

/** Which CR 603.10 look-back applies to a pattern (empty = none). */
export type LookBackKinds = (pattern: EventPattern) => LookBackKind[];

/**
 * Collect the triggers caused by one batch (design 8.4):
 *  1. candidates: every permanent; every object in a zone where one of its abilities functions; every object that left a zone DURING the batch when a look-back kind applies;
 *  2. enumerate triggered abilities through the characteristics function (granted and generated ones count); for look-back use the snapshot's abilities;
 *  3. matchEvent for each pattern of trigger.on; CR 603.6b: a Humility-style effect that removes the ability "as it enters" stops an enters trigger;
 *  4. evaluate interveningIf (603.4); 5. count: 1 + sum of applicable TriggerModDef.additional (603.2d, never for delayed/reflexive/self);
 *  6. build the PendingTrigger with the EventContext and return it (collectPendingTriggers enqueues). NOT a dry run: it consumes limits, effect ids, log lines and delayed records.
 */
export type CollectTriggers = (g: Game, batch: SemEvent[]) => PendingTrigger[];

/** Called from core/turn.ts#advance each time a player would receive priority. Returns true if any trigger was put on the stack. */
export type PutPendingTriggersOnStack = (g: Game) => boolean;

/** Called each time triggers are collected, before and after each state-based action pass (CR 603.8): triggers state triggers that do not already have a copy on the stack. */
export type CheckStateTriggers = (g: Game) => PendingTrigger[];

export type _Keep = GameObject;
```

#### `statics/api.ts` (WP9, WP16)

```ts
/**
 * statics/: static abilities, continuous effects and the layer system (CR 604, 611, 613), rule hooks, cost modifiers. Owner: WP9 (layers,
 * live statics, links, characteristics), WP16 (rule hooks and cost modifiers).
 *
 * Files:
 *   statics/api.ts          this file
 *   statics/layers.ts       computeAll(s): CR 613 layer by layer across ALL objects, started-set (613.6), dependency by trial application (613.8)   (WP9)
 *   statics/live.ts         staticEffectsOf(s, chars, layer): effects generated by the CURRENT abilities of objects (611.3a); resolvedEffects(s) (611.2)   (WP9)
 *   statics/mods.ts         applyMods(chars, mods, subject): the per-layer functions                                                                     (WP9)
 *   statics/links.ts        CR 607 link store helpers; granted-pair namespaces                                                                           (WP9)
 *   statics/hooks.ts        staticEffectsFor(s, action, subject): restrictions, permissions, rule mods (collected after objects, 613.10-613.11)             (WP16)
 *   statics/costmods.ts     applicableCostMods(...) for actions/cast.ts (601.2f, 118.7-118.9)                                                           (WP16)
 *   rules/characteristics.ts#getChars calls computeAll (cached per Game by a revision counter, invalidated by the mutators that matter)
 */
import type { AbilityDef, ContinuousEffectDef, KeywordAbilityDef, Layer, Modification, ObjRef, PlayerPred, RuleAction, StaticEffect } from '../types/ability';
import type { Chars } from '../rules/characteristics';
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameState, AbilityRef } from '../types/state';
import type { ObjHandle } from '../types/state-additions';

/** Chars gains these fields (rules/characteristics.ts), all computed by computeAll. */
export interface CharsAdditions {
  /** Layer 2. */
  controller: PlayerId;
  /** Printed + keyword-generated + granted abilities, with stable keys. Keys: p:<face>:<i>, k:<face>:<i>:<n>, g:<effectId>:<n>, r:basic:<C>. */
  abilities: CharAbility[];
  /** Milestone 4's `Chars.keywords`: stays, and is recomputed from `abilities` after layer 6, so granted and removed keywords are seen by every `hasKeyword` caller. */
  keywords: KeywordAbilityDef[];
  /** Layer 6 "can't have or gain" markers. */
  cantHave: string[];
  /** P/T after layers 7a-7d as decimal strings ('*' only when a CDA could not be evaluated: then the card is manual). */
  power?: string;
  toughness?: string;
}

export interface CharAbility {
  key: string;
  origin: AbilityRef['source'];
  face: number;
  /** Index in FaceDef.abilities for printed/keyword origins, -1 otherwise. */
  index: number;
  def: AbilityDef;
  /** Effect id that granted it (origin 'granted'). */
  grantedBy?: string;
}

/** A continuous effect ready to be applied: from a static ability (live) or from a ContinuousEffectRec (resolved). */
export interface LiveEffect {
  id: string;
  source: ObjHandle | null;
  /** The static ability that generates it (for the existence check of CR 613.8a), absent for resolved effects. */
  origin?: { source: ObjHandle; abilityKey: string; effectIndex: number };
  /** CR 613.7: statics take the source's timestamp (or the granting effect's if later, 613.7a); resolved effects their creation time (613.7b). ONE per effect. */
  timestamp: number;
  /** Resolved effects that change characteristics or control carry `{ref:'fixed'}` in `affects` (CR 611.2c); statics are live (CR 611.3a). */
  effect: ContinuousEffectDef;
}

export const LAYERS: readonly Layer[] = ['1a', '1b', 2, 3, 4, 5, 6, '7a', '7b', '7c', '7d'];

/**
 * Characteristics of every relevant object, layer by layer across ALL objects (a filter in layer N sees layers < N of the others).
 * Final algorithm: design 9.2. Ships in M5 with layers 2, 4, 5, 6, 7a-7d populated and 1a, 1b, 3 present as empty hooks (M6).
 */
export type ComputeAll = (s: GameState) => Map<ObjectId, Chars>;

/** Apply the modifications of one layer to one object's characteristics. Pure. */
export type ApplyMods = (c: Chars, mods: Modification[], subject: ObjectId, s: GameState, all: Map<ObjectId, Chars>) => Chars;

/** CR 613.8a: does A depend on B in this layer? Trial application on a scratch copy, including "B changes whether A exists" (Blood Moon vs a land-type granter). */
export type DependsOn = (s: GameState, a: LiveEffect, b: LiveEffect, layer: Layer, all: Map<ObjectId, Chars>) => boolean;

/** All restriction/permission/rule-mod effects that apply to `subject` for `action`, in timestamp order (613.10-613.11), "can't" before "can" (101.2). */
export interface RuleQuery {
  action: RuleAction;
  subject: ObjectId | PlayerId;
  /** The other object/player of the action (the blocker for beBlocked, the spell for cast). */
  other?: ObjectId | PlayerId;
}
export type StaticEffectsFor = (s: GameState, q: RuleQuery) => StaticEffect[];

export type _Keep = ObjRef | PlayerPred;
```

#### `cards/pipeline.ts` (WP18)

```ts
/**
 * cards/: the compile pipeline that turns an OracleCard into a CardDef, and the card-pool contract. Owner: WP18 (pipeline), WP24 (pool).
 *
 * Files:
 *   cards/compile.ts       existing; keeps parseTypeLine/baseFace/compileCard(card, compiler) signature, the default compiler becomes pipelineCompiler
 *   cards/pipeline.ts      this file: compileCardV2 and the AbilityCompiler built on it
 *   cards/pool.ts          stubCardDef, imageSlots, tokenDefFor (predefined tokens table), unsanctioned flags
 *   cards/spans.ts         ledger -> display spans per ability (UI painting of automated/manual text)
 *   cards/basic-compiler.ts and cards/keywords.ts (milestone 4) are superseded by the parser and removed in WP18 after the golden tests pass
 *
 * Precedence per FACE (updates.md, refined): pack entry whose textHash matches > parser; then trusted LLM entries overlay ONLY the
 * units the parser left manual (same sentence indices), never a unit the parser accepted. If an overlay and the parser both
 * produced a unit and their canonical JSON differs, the parser wins and the entry is flagged `templates:disagree`.
 */
import type { AbilityDef } from '../types/ability';
import type { CardAutomation, ReviewState } from '../types/automation';
import type { CardDef, OracleCard } from '../types/card';
import type { StoredAbility, CapabilitySet } from '../model/api';
import type { ParseOptions } from '../parser/types';
import type { KeywordRegistry } from '../keywords/types';

/** One card of a rules pack or of the LLM cache: structure only, no Oracle text (updates.md, design 12.5). */
export interface CompiledCardEntry {
  oracleId: string;
  /** SHA-256 of the normalized Oracle text this entry was made for. A mismatch discards the entry (errata, new wording). */
  textHash: string;
  /** ABILITY_MODEL_VERSION the JSON conforms to. An entry newer than the engine is listed in requiresEngine and not used. */
  modelVersion: number;
  faces: { abilities: StoredAbility[]; /** sentence indices (per line) the entry covers, for overlay entries */ covers?: { line: number; sentence: number }[] }[];
  review: ReviewState;
  source: 'hand' | 'llm';
  flags: string[];
}

export type LlmTrust = 'off' | 'reviewed' | 'autoverified';

export interface CompileSources {
  parse: ParseOptions;
  keywords: KeywordRegistry;
  caps: CapabilitySet;
  /** oracle_id -> entry, already filtered by the pack's own validation. */
  pack?: ReadonlyMap<string, CompiledCardEntry>;
  /** Trusted LLM cache entries. `trust` decides which review states drive play (design 11.5). */
  llm?: ReadonlyMap<string, CompiledCardEntry>;
  trust: LlmTrust;
  /** Oracle names the local kill switch forces to manual (design 10.4). */
  forceManual?: ReadonlySet<string>;
  /** Parser version string stored in CardAutomation.compilerVersion. */
  compilerVersion: string;
}

/**
 * Total: never throws, never drops a card (contract C1). Worst case every ability is manual and automation.level is 'manual'.
 * Steps per face: lookup (pack, parser) -> overlay -> validate (schema + lint, failure => manual ability with the first message)
 * -> expand nothing (keywords stay KeywordAbilityDef; expansion happens in characteristics) -> degrade against `caps` -> classify.
 */
export type CompileCardV2 = (card: OracleCard, src: CompileSources) => CardDef;

/** Additions to CardDef (types/card.ts); `automation` is replaced by CardAutomation. */
export interface CardDefAdditions {
  automation: CardAutomation;
  /** A card the index does not know (new set, silver border, a typo the player confirmed): a text-less, rules-less, playable-by-hand definition. */
  stub?: { origin: 'decklist' | 'image' | 'manual' };
  /** Silver-border / acorn cards kept by the optional `--include-unsanctioned` index: manual-only, excluded from default deck validation. */
  unsanctioned?: boolean;
}

/** Physical image slots of a card (placeholder frame and uploaded art): one per printed side, not per rules face (design 12.2). */
export interface ImageSlot {
  /** Key used by the client to bind uploaded images; the Oracle name(s) it resolves from. */
  key: string;
  label: string;
  /** Oracle names that resolve to this slot ("Fire" and "Fire // Ice" both resolve to the one slot of a split card). */
  names: string[];
}
export type ImageSlots = (def: CardDef) => ImageSlot[];
export type StubCardDef = (name: string, origin: 'decklist' | 'image' | 'manual') => CardDef;


/** A run of the face's Oracle text with its automation status, for painting the card text in the UI (design 10.5). Derived from the ledger. */
export interface TextSpan {
  range: [number, number];
  status: 'auto' | 'manual' | 'reminder' | 'label';
  /** Index in FaceDef.abilities. */
  abilityIndex: number;
  /** JSON pointer of the manual node, when status is 'manual'. */
  path?: string;
  /** Tooltip: why it is manual ("no template", "needs-engine: op:copy", "forceManual"). */
  reason?: string;
}
export type SpansOf = (def: CardDef, face: number) => TextSpan[];

/** Per-card local settings the pipeline honors (design 10.4). Stored by the client, never in the engine state. */
export interface CompileSettings {
  forceManual: ReadonlySet<string>;
  llmTrust: LlmTrust;
}

export type _Keep = AbilityDef;
```

### 5.4 Import rules (no cycles)

`types` imports nothing. `model` imports `types`. `render` imports `types`, `model`. `keywords` imports `types`, `model` types, `rules/denial`, `core/game` (types only). `parser` imports `types`, `model`, `render`, `keywords/registry` data, and **nothing from `core`, `effects`, `rules` or `statics`** (it runs without a game). `statics` imports `types`, `rules/base-chars`, `keywords/registry`. `rules/characteristics` imports `statics/layers`; `statics/layers` imports `rules/base-chars` (so there is no cycle). `triggers` imports `types`, `statics`, `rules`, `core`. `effects` imports all of those and `keywords/actions`. `cards` imports `parser`, `model`, `keywords`, `render`. `packages/cards` imports the engine package only through its public `index.ts`. A lint test (`import-rules.test.ts`, WP0) parses the import graph and fails on a forbidden edge.

## 6. The parser

The parser maps Oracle text onto the section 2 model. Its two hard requirements come from the corpus (analysis section 12): whole-sentence templates plateau near 60% out of sample (28,776 distinct line templates for 60,925 lines), so the parser must **compose** (cost x trigger x condition x effect x filter x quantity x duration); and it must **never turn text it does not understand into behavior**.

It is pure and deterministic (`parseCard(card, options) -> ParseResult`, contract in `parser/types.ts`), lives in the engine package, uses no I/O and imports nothing from `core`, `rules`, `effects` or `statics`, so it runs in the browser (a deck has 30-100 distinct cards) and in the coverage CLI.

### 6.1 Pipeline

```
OracleCard
  [0] lookup            cards/pipeline.ts   pack entry with matching textHash wins for the face; else continue
  [1] faces, layout     cards/compile.ts    one FaceDef per face, as today (split, adventure, DFC, flip, saga, class, leveler, case, prepare)
  [2] preprocess        parser/preprocess   normalize, reminder text, self reference "~", labels, ability words, character ledger
  [3] segment           parser/segment      lines -> abilities (kind by shape, table 6.2) -> sentences
  [4] tokenize          parser/tokenize     tokens; quoted abilities are parsed recursively as sub-streams
  [5] chart parse       parser/chart+holes  templates x hole grammars over each unit; whole-derivation ambiguity detection
  [6] lower             parser/lower/*      targets, anaphora, riders, quantities, durations, conditions, optionality, sequencing, normalize
  [7] taint             parser/taint        contagion and poisoning (6.7)
  [8] verify            model + render      schema + lint, canonical form, capability degrade, exact render gate (6.8)
  [9] classify          model/classify      CardAutomation (section 10)
```

Steps 2-7 are `parseCard`. Steps 0, 8 and 9 belong to `cards/pipeline.ts` (WP18) because they need the engine's capability set, the packs and the LLM cache. `parseCard` never throws: an exception inside a face becomes one `ManualAbilityDef` with diagnostic `parser-error` (contract C1).

### 6.2 Preprocessing and segmentation

1. **Normalize.** Curly quotes and apostrophes to ASCII; U+2212, en and em dashes to `-` / `--` per context; non-breaking and repeated spaces to one; bullets kept as tokens; line breaks significant. An offset map back to the original text is kept (all ledger spans and `src` refer to the original).
2. **Reminder text.** Every balanced parenthesised span outside the token structure is removed from the parse text, recorded as a `reminder` ledger entry, and **never parsed for behavior** (CR 207.2). A line that is only reminder text produces no ability. One exception: a keyword line's reminder is compared with `KeywordDefData.reminder` to flag errata (diagnostic `info`).
3. **Names and self reference.** Card names from the local name index are single tokens before any comma splitting ("Bruna, the Fading Light"). `~` replaces, in order: `CARDNAME`; the face's full name; the legendary short name before the comma (CR 201.5c); the other faces' names of the same card; `this <noun>` where noun is one of the face's types or subtypes (`creature`, `Aura`, `Equipment`, `Saga`, `permanent`, `card`, `token`, and `spell` while the face is a spell) and is not followed by `turn`, `way`, `combat`, `game`, `step`, `phase`, `ability`. Only whole-word matches of **this object's own names**. Inside a quoted ability the scope changes: `this creature` there is the grantee, the outer card name is the outer source (CR 201.5a), so a quoted ability is a sub-stream with a fresh self scope. **Gendered pronouns (FAST5X E24).** A character card's own "he", "him", "his", "she", "her" (and "he's", "she's") become `~` / `~'s` / `~ is` too, by the unique-candidate rule of 6.4 applied to the whole face: the face is legendary, it refers to itself outside quotes (a name, a short name, another face's name or `this card`), its name is one character (no `&` / `and`), no other capitalized word outside sentence starts, labels, quotes and rules words could name a character, the pronouns agree in gender, and the old player wordings ("he or she", "his or her") are absent. "her" is a possessive only before a listed noun (`power`, `owner's`, `sneak` ...), an object otherwise. Pronouns inside quotes, "himself", "herself" and every face that fails a condition keep their words (unknown, manual). Since the parse text and the display text hold `~`, the render gate compares `~` with `~`; the renderer offers `~` beside `it` where the object itself is meant (moved object's counters and owner, entering counters). A legendary card's short name that is also a subtype (`Wolverine, ...`, `Huatli, ...`) is its name (CR 201.5c) except in a type position.
4. **Labels.** An ability word or flavor word is a prefix of up to four words followed by `--` at the start of a line (CR 207.2c-d). Keyword forms with a dash (`Ward--Pay 3 life`, `Escape--{3}{R}{R}`, `Boast--{1}`, `Cumulative upkeep--Pay 1 life`) are tried first through the keyword registry, then the ability-word list, then "unknown prefix whose remainder parses as an ability". The label goes to `AbilityBase.label` and never affects behavior.
5. **Lines to abilities** by a decision list (first match wins; every classification is re-checked by the chart parser, and a line whose classification fails falls through to a manual ability of the best-guess `shape`):

| Order | Shape | Result |
|---:|---|---|
| 1 | blank, or only reminder text | skipped (recorded in the ledger) |
| 2 | `LEVEL N-M` / `LEVEL N+` headers followed by a P/T line and ability lines (CR 711) | one `levelBracket` per band |
| 3 | `I, II -- ...` Roman numerals (CR 714.2) | one `chapter` ability per chapter group |
| 4 | dice rows such as `1-9 \| text` (CR 706) | folded into the preceding ability as `rollDie.table` |
| 5 | line ending `Choose one --`, `Choose two --`, `Choose one or both --`, `Choose up to N --` plus bullets; or `Spree` with `+ {cost} --` lines | one modal `EffectProgram`; if preceded by a trigger clause or cost, the modes belong to that ability |
| 6 | `+N:` / `-N:` / `0:` / `+X:` on a planeswalker face | loyalty ability (CR 606) |
| 7 | every comma- or semicolon-separated item matches a keyword line pattern | keyword abilities |
| 8 | first word `when`, `whenever`, `at` | triggered ability |
| 9 | an unquoted colon whose left side parses as a cost list | activated ability |
| 10 | instant, sorcery or spell-type face, not one of the static forms below | **spell ability; all such lines of the face form ONE `SpellAbilityDef`** (CR 113.3a, 608.2) |
| 11 | everything else | static ability (CR 604) |

Static forms recognised before rule 10 on spell faces: `This spell costs ...`, `As an additional cost to cast this spell ...`, `... can't be countered`, `You may cast ... rather than pay ...`, `... enters with ...`. Also: Aura `Enchant` lines are keyword lines; `Equip`, `Reconfigure`, `Fortify` too. Case lines (`To solve --`, `Solved --`) and `Prepare`-style layouts are recognized and kept as manual until their structural support exists (12.5).

6. **Sentences.** Split at a period outside quotes and braces. A sentence beginning with `Then`, `If you do`, `If you don't`, `Otherwise`, `It`, `They`, `That` is a continuation of the previous one. Modal bullets are units of their own.
7. **Ledger.** Every non-space character of the normalized text ends up in exactly one `LedgerEntry` (`consumed` by a template, `reminder`, `label`, `structure`, `manual`). A gap is a test failure (G4).

### 6.3 Templates, hole grammars, the chart

**A template is data** (type `Template` in `parser/types.ts`): `id`, `kind`, `cr[]`, `pattern`, `build`, optional `subject`/`attachTo`, `examples`, `counterExamples`, `consumes`, `priority`, `status`, `since`, `needs`. Pattern syntax: literal words (case-insensitive), `{name:Type}` typed holes, `[optional]`, `(a | b)` alternatives, `~` the object, `word[s]` / `word[es]` number agreement, `^` sentence start. `build` is JSON in which `"$name"` and `"$name.path"` are replaced by captured values, `{"$when":"name","then":X,"else":Y}` chooses by presence of an optional hole, `{"$concat":[X, Y, ...]}` (FAST5 T62) joins the arrays and items it lists into one array ("whenever A and whenever B": the events of both; a missing hole makes the member missing), and `{"$patchPrevious":{...}}` merges fields into the previous step (riders). Inside a patch (WP23 amendment; each fails closed, the rider is then manual): `"@previous"` / `"@previous.<path>"` is (a value inside) the previous step, `{"@new": X}` sets a key only when the previous step lacks it, and `"@replace": true` replaces the previous step by `if C then [X] else [previous]`, only when X replaces it as a whole (same op on the same things; another amount or destination; CR 614.15). A pack template using these markers needs a parser of WP23 or later. Nothing else: no code, no expressions.

**Templates parse only.** Rendering is a separate total function of the JSON (WP2); the same pattern is never used to print. That is deliberate: a round trip through the same table is self-consistent even when the lowering is wrong (a swapped filter round-trips cleanly), while an independent renderer is not.

**Hole grammars are code** (`parser/holes/*.ts`) and carry the long tail. Each hole type is a memoized recursive-descent function `(tokens, pos) -> alternatives[(end, value)]` that returns **all** parses, never the first: ambiguity is detected, not resolved. The informative EBNF below (from the grammar candidate) is the contract for the noun-phrase, quantity, condition, duration, cost and trigger-event productions; its `Sentence`/`Clause`/`Instructions` productions are informative only (the template set plays that role).

The code grammar owns structure: abilities, sentences, noun phrases, quantities, conditions, durations. Verb-specific shapes are frames (5.7). Notation: `::=` definition, `|` alternative, `[x]` optional, `{x}` repetition, quoted words are case-insensitive tokens, `<Class>` is a lexicon class, `(* *)` comments. Lowering notes (what each production becomes) follow `=>`.

```ebnf
(* ---- ability bodies ---- *)
Activated     ::= CostList ":" Instructions [ActivationLimit]
ActivationLimit ::= "activate" ("only" | "no more than") ("as a sorcery" | "once each turn" | "during" StepList | "if" Condition) "."
Triggered     ::= ("when" | "whenever" | "at") TriggerEvent ["," "if" Condition] "," Instructions
                  (* => TriggeredAbilityDef; "if" here is the intervening if, CR 603.4 *)
Instructions  ::= Sentence {Sentence}

(* ---- costs ---- *)
CostList      ::= CostPart {("," | "and") CostPart}
CostPart      ::= MANA | TAP | UNTAP | ENERGY
                | "sacrifice" (SELF | ObjectNP) | "discard" (SELF | "your hand" | ObjectNP) ["at random"]
                | "pay" Qty ("life" | ENERGY) | "exile" (SELF | ObjectNP) ["from" ZoneNP]
                | "return" (SELF | ObjectNP) "to" PlayerPoss "hand"
                | ("tap" | "untap") Qty ["other"] "untapped" ObjectNP
                | "remove" CounterSpec "from" (SELF | ObjectNP) | "reveal" (SELF | ObjectNP) ["from your hand"]
                | "mill" Qty | CostAction | LoyaltyCost            (* mana, {T}, sacrifice and discard alone cover 88% of cost parts, corpus 7.4 *)

(* ---- trigger events (22 shapes) ---- *)
TriggerEvent  ::= StepEvent | SubjectEvent {"or" SubjectEvent}
StepEvent     ::= "the beginning of" (PlayerPoss | "each" | "the") StepName       (* => {event:'step'} *)
SubjectEvent  ::= TriggerSubject EventPredicate
TriggerSubject ::= SELF | ObjectNP | PlayerNP | "one or more" ObjectNP | ObjectNP "or" ObjectNP
EventPredicate ::= "enters" ["the battlefield"] ["tapped"] | "dies" | "leaves the battlefield"
                | "is put into" ZoneNP "from" ZoneNP | "attacks" ["alone" | PlayerNP | "a" Head] | "blocks" [ObjectNP]
                | "becomes" ("blocked" ["by" ObjectNP] | "tapped" | "untapped" | "the target of" ObjectNP)
                | "deals" ["combat"] "damage" ["to" Recipient] | "is dealt" ["combat"] "damage" ["by" ObjectNP]
                | ("cast" | "cycle" | "sacrifice" | "discard" | "draw" | "gain" | "lose") (...frame-driven...)
                | "is turned face up" | "transforms" | "mutates" | "is unlocked" | ChapterGroup

(* ---- sentences ---- *)
Sentence      ::= [LeadIn] Clause {Link Clause} "." {Rider}
LeadIn        ::= "if" Condition "," | "as long as" Condition "," | Duration "," | "for each" ObjectNP ","
Link          ::= "," "then" | "then" | "and" | ","                     (* ordering only; "then" does not imply success, "if you do" does *)
Clause        ::= ["you may"] (Imperative | SubjectClause) {Tail}
Imperative    ::= <FrameVerb> Args                                       (* frames with subject: none *)
SubjectClause ::= Subject <FrameVerbAgreeing> Args                       (* frames with subject: object | player *)
Subject       ::= SELF | ObjectNP | PlayerNP
Tail          ::= Duration | "unless" PlayerNP "pays" Cost | "if" Condition | "for each" ObjectNP | "this way" | "instead"
Rider         ::= (a sentence that attaches to the previous step; see frames of kind rider)

(* ---- object noun phrases ---- *)
ObjectNP      ::= Anaphor | SELF | Determined | Group
Anaphor       ::= "it" | "them" | "that" Head | "those" Head | "the" Participle Head | PlayerPoss Head        (* "its controller", "that creature's power" *)
Determined    ::= Determiner {PreMod} Head {PostMod}
Determiner    ::= "target" | Count "target" | "up to" Count "target" | "another target" | "any target"
                | "each" ["other"] | "all" ["other"] | "every" | "a" | "an" | "the" | Count | "any number of" | "one or more"
                | PlayerPoss | "enchanted" | "equipped" | "fortified"
PreMod        ::= <Color> | "non" (<Color> | <CardType> | <Subtype> | "basic" | "token" | "legendary")
                | <CardType> | <Subtype> | "tapped" | "untapped" | "attacking" | "blocking" | "attacking or blocking"
                | "legendary" | "basic" | "snow" | "token" | "face-down" | "multicolored" | "colorless" | "historic"
Head          ::= <CardType> | <Subtype> | "permanent" | "card" | "spell" | "source" | "player" | "opponent" | "ability" (plural allowed)
PostMod       ::= "you control" | "you don't control" | PlayerNP "controls" | "you own" | "an opponent owns"
                | "with" Feature | "without" Feature | "that" RelClause | "of the chosen" ("type" | "color")
                | "named" NAME | "in" ZoneNP | "from" ZoneNP | "attached to" ObjectNP | "other than" ObjectNP
                | "with mana value" Cmp | "with" ("power" | "toughness") Cmp | "with a" CounterKind "counter on it"
                | "that shares a" ("creature type" | "color" | "card type") "with" ObjectNP
Feature       ::= <Keyword> | "an" ("activated" | "triggered") "ability" | "a" CounterKind "counter on it" | "power" Cmp | "toughness" Cmp | "mana value" Cmp
Cmp           ::= Qty ("or less" | "or greater" | "or more" | "or fewer") | ("less" | "greater") "than" Qty | "equal to" Qty
Group         ::= ObjectNP ("or" | "and") ObjectNP                        (* post-modifiers distribute over the coordination *)

(* ---- players, quantities, conditions, durations ---- *)
PlayerNP      ::= "you" | "target" PlayerHead | "each" PlayerHead | "an" "opponent" | "that player" | PlayerPoss "controller" | ...
PlayerPoss    ::= "your" | "its" | "their" | PlayerNP "'s" | "that player's" | "defending player's"
Qty           ::= NUM | NUMW | X | "a" | "an" | "twice" Qty | "half" Qty ["," "rounded" ("up" | "down")] | "that many" | "that much"
                | "the number of" ObjectNP | "equal to" QtyExpr | "for each" ObjectNP | PlayerPoss "life total"
                | "the" ("greatest" | "total") Stat "among" ObjectNP | Qty ("plus" | "minus") Qty
Condition     ::= Cond {("and" | "or") Cond}
Cond          ::= "you control" ObjectNP | "an opponent controls" ObjectNP | PlayerNP "has" Qty ("or more" | "or fewer") ObjectNP
                | ObjectNP "is" Description | "it's" Description | PlayerNP ("gained" | "lost") Qty "life this turn" (...frame-driven...)
                | "this spell was kicked" | "you do" | "you don't" | "it's your turn" | "there are" Qty ObjectNP ["in" ZoneNP]
Duration      ::= "until end of turn" | "this turn" | "until your next turn" | "until" SELF "leaves the battlefield"

In this EBNF `<FrameVerb>` and "(...frame-driven...)" mean "supplied by the template set" (there are no separate frames in this design: a frame is a `Template`); "22 shapes" is the grammar candidate's count of trigger shapes (the model has 18 `EventPattern`s because several shapes share one pattern); `{event:'step'}` is `{ev:'step'}` here.

Hole types and where their vocabulary comes from:

| Hole | Value (JSON) | Notes |
|---|---|---|
| `Filter`, `Obj`, `Objs` | `ObjectFilter` / `ObjRef` | determiners, pre-modifiers (colors, `non`-X, supertypes, `tapped`, `attacking`, ...), heads (card types, subtypes, `permanent`, `card`, `spell`), post-modifiers (`you control`, `with flying`, `with power N or less`, `named X`, `of the chosen type`, `in your graveyard`, `that shares a creature type with it`, `that was dealt damage this turn`, `except for ...`). Subtypes with plurals come from the generated lexicon. An unknown adjective **fails** the hole (no skipping). |
| `Player`, `Recipient` | `PlayerRef`, `Ref` | `you`, `target player`, `its controller`, `each opponent`, `that player`, `defending player`, ... |
| `Qty`, `Count` | `Quantity`, `Count` | numbers and number words, `X`, `a number of ... equal to`, `twice that many`, `for each`, `half ..., rounded down`, `where X is ...`, `that much` |
| `Cost` | `CostDef` | mana, `{T}`, `{Q}`, loyalty, sacrifice, discard, pay life/energy, exile, tap untapped, remove/put counters, return, reveal, mill, keyword-action costs |
| `Cond` | `Condition` | `you control`, `has N or more`, `it's your turn`, `was kicked`, `you do`, `you don't`, history ("this turn") |
| `Dur` | `Duration` | `until end of turn`, `this turn`, `until your next turn`, `for as long as`, `until ~ leaves the battlefield` |
| `Event` | `EventPattern[]` | the 18 event shapes of 3.5 |
| `TokenDesc` | `TokenDef` | `[P/T] [colors] [types] [subtypes] token[s] [with abilities]` or a predefined name |
| `Abilities` | `AbilityDef[]` | quoted or keyword abilities after `gains` / `has` / `with` |
| `Keyword` | `KeywordAbilityDef` | through the keyword registry (names, parameters, `parseQuality` of milestone 4) |

**The chart.** `parser/chart.ts` is an Earley parser over the token array. Items are templates of one `kind` (the goal is the whole unit: `ability`, `trigger`, `cost`, `condition`, `effect` sequences, `static`); a hole position calls its hole grammar and adds one chart edge per alternative. Templates are indexed by their first literal and their verb, so a unit is tried against tens of templates, not hundreds. Rules:

1. **Whole-unit.** A derivation must consume every token of the unit (G1). There is no prefix matching and no "best effort".
2. **Ranking.** Complete derivations are ranked by fewer unspecific holes, then `priority`.
3. **Ambiguity is failure (G5).** If two derivations remain whose *canonical lowered JSON* differs, the unit is manual with diagnostic `ambiguous` listing both. Identical JSON means the ambiguity is harmless (distributing "you control" over "artifact or creature") and the derivation is kept. Priority never breaks a tie between templates that both match completely with different outputs: that is an equal-priority conflict, and a CI check fails on any such pair over the corpus.
4. **Budget.** At most `budget` (default 200,000) chart items per ability; exceeding it makes the ability manual with `budget`.
5. **Diagnostics.** Every failed unit records the furthest token reached and the set of tokens it would have accepted there (`furthest`), which is the input of the LLM repair prompt (11.2) and of the mining report (6.12).

**Composition of effects.** `Effects` is a sequence of effect templates joined by `,`, `and`, `then`, `.`. `then` implies order only (CR 608.2c); success dependence exists only through `if you do` (`{cond:'did'}`). Wrapper templates (`may`, `pay ... unless`, `if ... instead`, `for each`, `X unless`) are templates over `{e:Effects}` and lower with the nesting the rules require (the `pay` node outside the `may` node, D3).

Twelve of the roughly 120 seed templates, to fix the style (full seed list: WP19-WP23):

| id | kind | pattern | build (abridged) |
|---|---|---|---|
| `eff.damage` | effect | `{src:Obj} deal[s] {n:Qty} damage to {to:Recipient}` | `{op:'damage', source:$src, to:$to, amount:$n}` |
| `eff.destroy` | effect | `destroy {o:Objs}` | `{op:'destroy', what:$o}` |
| `rid.noregen` | rider | `( they \| it ) can't be regenerated` | `{$patchPrevious:{regeneration:'cant'}}` |
| `eff.draw` | effect | `{p:Player} draw[s] {n:Qty} card[s]` | `{op:'draw', who:$p, count:$n}` |
| `eff.token` | effect | `{p:Player} create[s] {n:Qty} {t:TokenDesc}` | `{op:'createToken', who:$p, count:$n, token:$t}` |
| `eff.pump` | effect | `{o:Obj} get[s] {pt:PT} {d:Dur}` | `{op:'effect', duration:$d, effects:[{s:'continuous', affects:$o, mods:[{layer:'7c', power:$pt.p, toughness:$pt.t}]}]}` |
| `wrap.payelse` | effect | `{e:Effects} unless {p:Player} pay[s] {c:Cost}` | `{op:'pay', who:$p, cost:$c, else:$e}` (consumes `unless`; CR 118.12a) |
| `wrap.mayunless` | effect | `{q:Player} may {e:Effects} unless {p:Player} pay[s] {c:Cost}` | `{op:'pay', who:$p, cost:$c, else:[{op:'may', who:$q, do:$e}]}` (order pinned) |
| `trg.enters` | trigger | `when ~ enter[s]` | `{on:[{ev:'zoneChange', subject:{self:true}, to:'battlefield'}]}` |
| `trg.dies` | trigger | `whenever {s:Filter} die[s]` | `{on:[{ev:'zoneChange', subject:$s, from:'battlefield', to:'graveyard'}]}` |
| `cost.sac` | cost | `sacrifice {o:Filter}` | `{kind:'sacrifice', filter:$o, count:1}` |
| `sta.anthem` | static | `{f:Filter} you control get[s] {pt:PT}` | `{s:'continuous', affects:{ref:'each', filter:{...$f, controller:'you'}}, mods:[{layer:'7c', power:$pt.p, toughness:$pt.t}]}` |

### 6.4 Anaphora: the unique-candidate rule

After the sentences of an ability are parsed, pronouns are resolved against a **discourse model**: every mention in order (targets in word order, steps with `as`, event roles of the trigger, cost objects), each with sort (object/player/set/number), grammatical number and head noun. A reference (`it`, `its`, `them`, `that creature`, `that card`, `those cards`, `that player`, `its controller`, `that many`, `the exiled card`, `the chosen type`) resolves to the mention that is **the only one compatible by sort, number and head noun** ("that creature" needs a mention that can be a creature; "its controller" needs an object). The binding is written as an `as` name on the producing step and `{ref:'bound'}` / `{ref:'target'}` / `{ref:'event'}` / `{ref:'linked'}` at the use. **Zero or more than one compatible mention makes the sentence manual** (diagnostic `unbound-reference`). There is no ranking, no "most recent" tie-break. Property reads ("its power", "its controller") use last known information; property-less references to an object moved earlier follow it only when the move was to a public zone (3.1).

**Library digs (FAST5 T43).** "Look at the top four cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library in a random order." is three sentences, so the discourse model carries two groups between them. (1) A `look` of several top cards, and a `reveal` of them, make a plural mention with the participle `seen`; the `Seen` hole ("them", "those cards") accepts only such an antecedent, so cards that a mill, a search or an exile put elsewhere are never meant (the choice reads the group in the library: `{is: <group>, zone: 'library'}`). A single top card is no group. (2) A `chooseObjects` whose pool is such a group also makes the mention "the rest" (head noun `rest`; the `Rest` hole, "the rest" or "the other"): the set `{is: <group>, not: {is: <the chosen cards>}, zone: 'library'}`, written out at the use (`lower/mentions.ts#restOf`). Only that head noun names it, and only a mention with that head is a candidate for it. A "the rest" with no such choice before it (the sentence before it is not understood) is a plain manual step, not a contagious one: it names nothing an automated step produced. The renderer says these shapes in `render/fold.ts` (`putOfThemAndRest`, `chooseFromGroup`) and `render/refs.ts#restOfGroup`.

**"Its controller" names the source last (FAST5X E25).** The controller of the ability's own source is "you" in its own text (CR 109.5), so Oracle's "its controller" names another object whenever one could be meant: "Counter target spell. Its controller manifests dread." For "its controller" (not "its owner", not "it") the source is a candidate only when no other mention is (`AnaphorInfo.selfLast`, a demotion: a reference whose only candidate is the source still resolves to it). The renderer agrees: inside "X's controller" the source is no competing antecedent (render/refs.ts).

**The focus rule (FAST5 T76).** "Create a 1/1 Goblin creature token. It gains haste until end of turn. Sacrifice it at the beginning of the next end step.", "Put a +1/+1 counter on ~. It can't be blocked this turn.", "Exile target creature you control. Return that card to the battlefield ...": Oracle names with a bare pronoun the one thing the sentence before it made or worked on, though the trigger's subject or a spell on the stack is as compatible by sort and number. The pass keeps it typed (model/focus.ts, parser/lower/anaphora.ts#focusAt): the focus after an instruction is the token(s) it created (`createToken`, a token `copy`) or the one named object it worked on (`putCounters`, `removeCounters`, `tap`, `untap`, `move`, `destroy`, `sacrifice`, a continuous effect or a restriction of one object, a delayed instruction on it); any other instruction ends it. It decides between several compatible candidates only, and only when all of these hold, or the unique-candidate rule stays the only one: the previous sentence is understood and its last instruction is done for sure (top level, or inside an option / payment / reflexive / "if you do" whose following sentence the folding passes put into the same scope); the pronoun begins the first instruction of a sentence that has no target of its own, refers back to one thing only ("it" and "its" are one; a second "that X" is another), has no "~" before it and no mention of its own; and it is bare (or "that card" for a card the previous sentence moved, never the object itself, CR 201.5). The renderer says the same (render/steps.ts#clausesOf sets `RenderState.focus` per instruction and honors it in refs.ts#candidateCheck only while no other antecedent was named since the instruction began; an instruction with a condition that says the object, "If ~ was kicked", has no focus). Two nearby mention rules: the creatures a counters step put counters on (`putCounters` on a described group, recorded under its `as`) and the group a pump or grant gave a continuous effect (model/focus.ts#grantedGroup: types, controller or token-ness only, layers 6 and 7c) are mentions of the next sentence ("Untap them.", "Those creatures gain flying"); and a "~" named by a step, a condition or a quantity of the ability is never "that creature" (CR 201.5, `Mention.namedSelf`), nor is a "~" named only after the pronoun in its sentence its antecedent ("it endures X, where X is the number of counters on this creature").

**One card looked at (LOOK1).** "Whenever ~ attacks, look at the top card of your library. If it's a land card, you may put it onto the battlefield tapped.": the card looked at is no group (T43), but it is ONE card still on top of the library (looking moves nothing, CR 701.20b, 701.20e), and the "it" after the look is that card, never the trigger's object. Before LOOK1 the look added no mention, so "it" fell back to the event's object (the condition asked whether the attacking Vehicle was a land card, and the land was never put onto the battlefield). Now (model/focus.ts#looksAtOneCard: a look at the top card of ONE player's library; the top card of each player's library is several cards and stays without a mention) the look makes a singular mention (head `card`, participle `seen`, bound as `seen`), it is the focus after the look (`focusEffect` returns `makes`), so the focus rule binds the bare pronoun of the next sentence to it; the look idiom (lower/anaphora.ts#lookIdiom, as the search idiom) binds the "it" / "that card" of a move right after the look in the same sentence ("look at the top card of that player's library, then exile it face down"); and an "Otherwise" sentence that gives that `if` its `else` (one instruction, no target) begins with the focus the `if` began with (lower/anaphora.ts#elseFocus; render/steps.ts#clausesOf already lets an `else` inherit it). The "if" of the sentence after the look is no intervening "if" (CR 603.4): it is read as the ability resolves, after the look (CR 608.2c). Everywhere else the looked-at card is one more candidate, so a pronoun that could mean it or the trigger's object is manual, never guessed (a sentence not understood with such a pronoun is contagious, design 6.7 T2).

**"That card" after a moved binding (LOOK2).** "Whenever a Vehicle you control deals combat damage to a player, look at the top card of that player's library, then exile it face down. You may play that card for as long as it remains exiled.": LOOK1 left the second sentence manual and contagious, for two reasons. (1) The focus rule's "that card" for a card the previous sentence moved was checked as `movedBy`, which only a moved target or "~" gets (lower/mentions.ts#mentionsAt); a binding moved to a public zone is re-based instead (3.1 rule 2) and never has it, so a card looked at, found or chosen that a move put into exile or a graveyard was never "that card" by the focus, and the Vehicle stayed a second candidate (the source of a damage event is described without a zone, so the discourse model may call it a card, lower/scope.ts#roleObject; "a Vehicle you control" names no card type, so it has the wildcard head too). (2) The subject of "for as long as it remains exiled" counted as a second thing the sentence refers back to, so it had no focus at all. Now "that card" also takes the focus when the previous sentence's last instruction is a `move` of that binding into exile or a graveyard (lower/anaphora.ts#movedCardFocus: a card there, CR 400.7, 608.2c; not the battlefield or the stack, where the new object is a permanent or a spell, CR 110.1, 112.1; a move to a hand or a library is not re-based and has `movedBy` already), and the subject of that duration is no reference word of its own (lower/anaphora.ts#sentenceReferences, only when a step of the sentence has `{d:'remainsExiled'}`: the duration lasts while the objects of its permission stay exiled, CR 611.2b; model/cap-walk.ts allows it on object permissions only, render/dur.ts writes it as fixed words). The renderer already allowed "that card" for any focus (render/refs.ts#candidateCheck). Nothing else changes: the damage source keeps its heads (an extra candidate makes a sentence manual, never wrong), and any other second reference word (", and mana of any type can be spent to cast it") still leaves the sentence to the unique-candidate rule.

**"If you don't put the card onto the battlefield" (LOOK3).** "... If it's a land card, you may put it onto the battlefield. If you don't put the card onto the battlefield, put it into your hand." The last sentence is the negation of whether the move of that card was performed, not an `else`: it holds when the card was not a land card (the move never ran) and when the player declined (CR 608.2c), where "Otherwise" answers the condition alone. Templates `eff.look3.ifNotPut.*` (zz-cloud/look3.json; the zone "onto the battlefield" or "into your hand", the card "the card" or "it") build `if {cond:'did', not, to}` with the Cond hole's own `$step` marker (a template build may hold it since LOOK3, parser/chart.ts#buildRefs); the conditions pass names the move the instruction right before ends with, through its `if` (no `else`) and the controller's own `may` (no `otherwise`), a move of ONE named card (a bound card or a target) to that zone (model/focus.ts#notPutMove), and the condition reads it (a missing result is "not performed", effects/eval.ts#did; model/lint-flow.ts lets this one condition read a move bound inside a branch). The sentence is about that card: it is the focus of the sentence's instructions (lower/anaphora.ts#notPutFocus; render/steps.ts#clausesOf says the same), so its bare "it" is the card looked at, never the trigger's object; and inside it the move was not performed, so a move into a hidden zone ("If you don't put the card into your hand, you may put it into your graveyard") does not give the card that move's name (notPutPool). Anything else (another zone, an instruction in between, a second reference word, a sentence before it that is not understood) stays manual. A bare "If you don't" after "If C, you may X" stays unresolved (T3): those words do not say whether not being offered counts. Cloud std-fin (PR #12) read the same words in its Cond hole with the same JSON; in the merge these templates are the one reading (the hole alternative is gone, so no template and hole read the sentence twice), and `eff.look3.ifNotPut.hand` is stable with three hand-verified golden cards whose sentence before it std-fin's `eff.stdfin.may.reveal.putIntoHand` reads. With std-fin's `keptFocus` the renderer also refuses this condition when it names any other step than that move (render/steps.ts#clausesOf).

### 6.5 Lowering passes (each a pure function with its own tests)

1. **Self and scope**: resolve `~` and quoted sub-scopes; seed trigger roles from the event kind (3.5).
2. **Targets**: each noun phrase with determiner `target` becomes a `TargetSpec` in word order, ids `t0, t1, ...` unique across the ability **including modal bullets**. `two target creatures` is one spec `min:2 max:2`; `up to two` is `min:0 max:2`; `any number of target` is `min:0 max:'any'`; `target creature or planeswalker` is one spec with a type alternative; `another target` sets `distinctFrom`; `any target` is kind `anyTarget` (CR 115.4); a divided effect marks its spec with `divide`; `total power N or less` is `groupLimit`; a target inside a conditional sentence ("If this spell was kicked, ... target creature") gets `onlyIf`.
3. **Anaphora** (6.4).
4. **Riders**: a `rider` template merges its sentence into the previous step (`They can't be regenerated` sets `regeneration:'cant'`; `If you control a Forest, it deals 4 damage instead` rewrites the previous damage step into `if/else`, the self-replacement of CR 614.15; `It's still a land` switches a `becomes` from `set` to `add`; `If that spell is countered this way, put it on top of its owner's library instead` sets `counter.to`). A rider without a mergeable predecessor is manual (this is what makes CR 608.2c a compile-time property).
5. **Quantities**: `where X is ...` and `X is equal to ...` substitute the defined quantity for every `{q:'X'}` of the sentence (evaluated when the step runs, CR 608.2h, unless the text says "as you cast"); `for each` becomes `math *`; `twice`, `half` become `math` with the stated rounding; `that many` becomes `{q:'resultCount'}` or `{q:'eventAmount'}` of the producer.
6. **Durations**: attach to every continuous-effect clause of their sentence (one `effect` step with several `mods` shares one duration). A duration that could attach to either of two coordinated clauses with different results is ambiguous (manual). No duration on a resolved continuous effect means `permanent` (CR 611.2a).
7. **Conditions**: lead-in `if` wraps the sentence's steps in `if`; the condition after a trigger clause becomes `interveningIf`; `unless ... pays` and `may pay ... if you do/don't` become `pay`; `if you do` / `if you don't` become `{cond:'did'}` against the `as` name of the previous `may`/`pay` step; `when you do` becomes a `reflexive` step.
8. **Optionality**: a leading `you may` on the whole effect of a triggered ability becomes a `may` step wrapping it (CR 603.5, the choice is made on resolution); elsewhere it wraps the clause. Rhystic Study: `pay` outside `may`.
9. **Sequencing and normalize**: `then`, `and`, comma and sentence boundaries produce steps in textual order; defaults removed only where the type has a default (3.2: none of `who`, `source`, `caster`); fields in canonical order; `text` and `src` filled; link groups assigned and checked (CR 607); a spell's lines merged into one `SpellAbilityDef`.

### 6.6 Partial understanding: where manual nodes go

Understanding is a tree. Each unit that cannot be lowered becomes a manual node at the **smallest** level that cannot change control flow:

| Unparsed thing | Becomes | Run-time behavior | Card level |
|---|---|---|---|
| a whole line (unknown shape, unknown keyword, unknown static) | `ManualAbilityDef {shape, reason}` (+ `cost` if the activation cost was understood) | spell: `manualResolve` at resolution; activated: normal activation, cost paid, then `manualResolve`; static: "unenforced rule" chip while in a functional zone | partial or manual |
| a trigger clause | `ManualAbilityDef {shape:'triggered', effect?}` (the effect is kept when it was understood) | listed in "Triggers to check" with **Trigger now**; with an understood effect the button goes through normal announcement and the effect is automated | partial |
| an intervening "if" the compiler cannot express | the same: manual triggered ability with the understood effect | an `ask` here would prompt on every event | partial |
| an effect sentence in an otherwise understood ability | `{op:'manual', text, reason}` | `manualResolve` at that point; the steps before and after run automatically; taint rules apply (6.7) | partial |
| a lead-in condition or guard (not intervening) | `{cond:'ask', text}` in `if` / `guard` | the controller is asked yes/no once per resolution | partial |
| a quantity inside a step | `{q:'ask', text}` | the controller types the number | partial |
| a cost part | `CostPart {kind:'manual', text}` | before the ability goes on the stack the controller confirms the payment; cancelling reverses the activation (CR 733.1) | partial |
| an "Activate only if/during ..." restriction | `onlyIf: {cond:'ask'}` | the controller attests when activating | partial |
| a filter in a target spec, `each`, `chooseObjects`, a count, a trigger subject | **the sentence is manual**; for a trigger subject the ability is a manual triggered ability | offering a superset or an empty set would be wrong; the engine never approximates legality | partial |
| a target phrase | the sentence is manual | a target that cannot be described cannot be announced (CR 601.2c) | partial |
| a duration | the sentence is manual | | partial |
| a static or replacement line | `ManualAbilityDef {shape:'static'}` | chip + log line on entry | manual unless other abilities exist |
| render gate mismatch | the ability is manual; the diagnostic carries both strings | | manual |
| a keyword not in the registry, or with status `planned` | `KeywordAbilityDef` kept, capability missing, `degrade` makes it a manual static with `requiresEngine: ['keyword:X']` | chip | partial |

### 6.7 Taint: contagion and poisoning

An unparsed sentence can change the meaning of its neighbors in both directions. Three mechanical rules decide the radius of a manual island; they run after lowering, on each `EffectProgram` (and on each mode option) separately:

- **T1 forward poisoning.** A step that references (`bound`, `did`, `resultCount`, `var`, `linked`) a name produced by a manual step is manual too, transitively.
- **T2 contagion.** If a manual sentence contains a **modifier word**, or an anaphor that could not be resolved, the **whole `EffectProgram` becomes one manual step** (earlier automated steps included). Targets, modes, cost and trigger that parsed are kept: the player still announces them, the engine still pays the cost. Modifier words (a closed list, tested against the corpus): `instead`, `rather than`, `except`, `unless`, `can't`, `cannot`, `additional`, `also`, `in addition`, `as though`, `if able`, `only`, `each other`, `each time`, `still`, `this way`, `would`, `until`, `twice`, `half`, `double`, `triple`, `again`, `extra`, `that many`, `that much`, `no more than`, `at least`, `up to`, `any number`, `random`, `chosen`, `different`, `same`.
- **E1 exemption (manual shields).** A manual sentence recognized by the shape `If [object] would [event] this turn, [replacement] instead.` / `Prevent the next N damage ...` creates a future replacement and cannot modify an earlier step. It is a `manual` step with `reminder: {d:'endOfTurn'}` (or the stated duration) and **does not taint** its neighbors. The chip stays until the duration ends, because a prompt during resolution cannot intercept an event that happens later (a death in state-based actions).

Worked cases (each is a golden test):

| Card | Text | Result |
|---|---|---|
| Mutavault | `{1}: This land becomes a 2/2 creature with all creature types until end of turn. It's still a land.` | Rider template present: `types.add` (automated). Rider absent: sentence 2 is manual, contains `still`: T2 makes the whole effect manual; the land is never turned into a non-land creature by a half-understood ability. |
| Magma Spray | `~ deals 2 damage to target creature. If that creature would die this turn, exile it instead.` | damage automated; the second sentence matches E1: manual step with a chip until end of turn. |
| Memory Lapse | `Counter target spell. If that spell is countered this way, put it on top of its owner's library instead of into that player's graveyard.` | Rider template folds into `counter.to`. Without it: contains `instead` and `this way`: the whole effect is manual (counter still announced), so the spell is never countered into the graveyard by a half-parse. |
| Elspeth Tirel -5 | `Destroy all other permanents except for lands and tokens.` | `except` must be consumed by a template (`consumes`); otherwise G3 sends the sentence to manual. |
| Frost Breath | `Tap up to two target creatures. Those creatures don't untap during their controller's next untap step.` | The second sentence has no template yet. It is not an E1 shape and contains no modifier word, so the tap stays automated and the second sentence is a manual step ('those creatures' is bound to the targets, which are legal) that the controller applies by hand. |

### 6.8 The twelve guards

Each is mechanical and has a test.

| # | Guard | What it stops | Enforced at |
|---:|---|---|---|
| G1 | **Sentence atomicity.** A unit is accepted only if one derivation consumes every token. No prefix matching, no skipping. | "Destroy target creature unless it is blue." parsed as "Destroy target creature." | chart goal item |
| G2 | **Closed vocabulary.** Words come from the generated lexicon or a template; an unknown word fails the hole; no stemming, stop words or fuzzy matching. Nonsense-word mutation test: replacing one content word of each sentence of 5,000 random cards by an invented word must never leave a `full` ability. | typos and new mechanics becoming "mostly right" parses | lexicon + CI |
| G3 | **Critical words.** If a word of the critical list (the modifier words of 6.7 plus `each`, `all`, `another`, `other`, `may`, `if`, `whenever`, `when`, `not`, `never`, `must`) occurs in an accepted sentence and no template listed it in `consumes` or a hole grammar interpreted it, the sentence is manual. | a template consuming the words around a modifier it cannot express | after derivation |
| G4 | **Ledger completeness.** Every non-space character belongs to exactly one ledger entry. | text lost between lines, labels, quotes | assertion in `parseCard`, corpus test |
| G5 | **Ambiguity is failure** (6.3). | picking the wrong reading ("target creature or planeswalker you control") | chart |
| G6 | **Exact render gate.** `render(ability)` regenerates canonical English from the JSON alone; the normalized result must equal the normalized Oracle sentence(s) (table of equivalences in `render/equivalence.ts`: case, straight quotes, `~`, number words, a/an/one in quantity position, listed anaphora variants at positions the renderer marks anaphoric, reminder text). Mismatch: the ability is manual. The gate is one-sided: it can falsely reject a correct parse; that costs automation, never correctness, and the rate is a tracked metric that drives renderer work. | a correct-looking parse whose JSON does not mean the text | verify step |
| G7 | **Schema and semantic lint** (`model/validate`): bound names, target ids, event roles, `X`, links, layers, divide, captures, positions of `ask` nodes, modal id uniqueness. | dangling names, wrong roles | verify step |
| G8 | **Capability degrade.** Valid JSON that uses something this engine build lacks keeps its structure but the unit becomes manual with `requiresEngine`. Removing an op from the table demotes exactly the cards using it (test). | packs or LLM output newer than the engine | pipeline |
| G9 | **Template tests.** Every template's `examples` must lower to the stated JSON and pass the gate; every `counterExample` must not parse or must parse to different JSON; near-miss mutations are generated per template (append `unless ...`, swap `target`/`each`/`all`, add `instead`, insert `up to`, negate with `don't`, drop the duration) and must fail or differ; `experimental` templates cap their cards at `partial`. | silent loosening when a template is edited | CI |
| G10 | **Golden corpus and snapshots.** Hand-verified JSON for 500 representative cards (every top template, every layout, the 40 hard cards of the corpus analysis, the cards of section 13); a whole-index snapshot of `{oracle_id: [template ids, hash of the canonical JSON]}` that every PR must diff; **adding a template may change only formerly-manual units** (CI fails otherwise). | regressions | CI |
| G11 | **Run-time backstop.** An op without a handler, a name that was never bound, an impossible shape: `manualResolve` with the sentence, never a skip; `EngineBug` in tests. | an op bug becoming a wrong game state silently | interpreter |
| G12 | **Source gating.** Pack and cache entries carry `textHash` and `modelVersion`; a changed Oracle text or a newer model discards the entry; `forceManual` overrides any source. | stale JSON attached to errata | pipeline |

### 6.9 Authoring workflow ("add a template, add a test")

1. `npm run cards -- unmatched --top 40` prints the most frequent unmatched *shapes* (units with the holes abstracted) with counts and example names: the work queue, ordered by cards unlocked.
2. `npm run cards -- try "<sentence>"` prints the parse trace (tokens, hole results, candidate templates, ambiguity, manual level).
3. Add the template JSON with CR citations, at least two examples and two counterExamples. A template with fewer than 20 corpus matches is `experimental` until it has 20 reviewed matches or three independently verified golden cards.
4. `npm test` runs the template tests, golden set, mutation tests; `npm run cards -- coverage --diff` lists cards that moved between levels and every previously-full card whose output changed (G10).
5. The pull request template asks for the CR rule, the diff report and a confirmation that examples are synthetic (6.10).
6. A local setting `forceManual: [oracle names]` makes the engine treat a card as manual even if a template parsed it (the escape hatch against a wrong template while it is fixed).

### 6.10 Test data hygiene

Committed template examples and tests use minimal or synthetic wordings (invented numbers and names, "target creature gets +2/+2"), not verbatim card text; golden files hold JSON keyed by oracle name; corpus tests read `.cache/` locally and are skipped when it is absent. Rules packs strip `examples` and `counterExamples`. (The examples of section 13 quote real wording because this is a design document.)

### 6.11 The lexicon is generated, never hand-typed

`scripts/gen-lexicon.ts` reads `rules/cr/` and the local index and writes `parser/lexicon.generated.json`: card types and supertypes (CR 205.2a, 205.4a), subtypes with plural forms (CR 205.3g-q; about 450, of which about 320 creature types; irregular plurals Elf/Elves, Wolf/Wolves, Fungus/Fungi, Mouse/Mice from a short exception table), colors, keyword ability names (CR 702 headings, which supersede milestone 4's `cards/keyword-list.ts`), keyword action names (CR 701), counter kinds (CR 122.1; counter names are an open class accepted in the pattern `N <word> counter(s)`), predefined tokens (CR 111.10), ability words (CR 207.2c), numbers. A new CR edition or a new set updates the vocabulary by re-running it; a test fails if the checked-in file is stale. Open classes that remain: card names (after `named`), counter names, and plural creature-type heads, which must still be in the subtype table.

### 6.12 Metrics and acceptance

The coverage CLI (WP25) reports, per run and per gate: cards by level; by reason (no template, unknown word, ambiguous, gate mismatch, needs-engine, contagion); the top unparsed shapes by cards unlocked; templates used; **gate false-reject rate** (target below 5% of accepted derivations after the first plateau, tracked, never a reason to loosen G6); ambiguity rate; ledger completeness (must be 100%); and **out-of-sample retention**: templates are written while looking at a tuning half of the corpus (the cards whose key, `oracle_id` else `name:<name>`, has an even 32-bit FNV-1a hash, `parser/metrics.ts#halfOfKey`; a property of the card, so a Scryfall refresh that adds cards moves no card between the halves; until 2026-10-19 the halves alternated by index in `oracle_id` order and every refresh reshuffled them; Standard-legal cards are open in both halves, owner decision 2026-10-17), coverage is reported on the held-out half, and the ratio held-out / tuning must be **at least 90% at every release gate** (a fixed template list scores 73-83%, corpus analysis 9.3; falling below 90% means templates are memorizing sentences instead of composing). A template-mining loop (`coverage --mine`) clusters residue by abstract shape and ranks clusters by cards unlocked.

### 6.13 Performance and non-goals

Target: the whole index (about 70,000 ability lines) in under 90 seconds on a CI machine, results cached by `(compilerVersion, textHash)` so a normal game load compiles only the deck's cards. Non-goals: free-form text (Un-cards, dexterity, ante, subgames), Alchemy digital-only verbs (conjure, seek, perpetually; flagged `digitalOnly`, manual), genuinely ambiguous English that needs world knowledge (these go to the LLM repair step), interactions between cards (Panharmonicon's text is parseable; its effect is the collector's `triggerMod`).

## 7. The keyword library

Keyword actions (CR 701) are verbs inside effects; keyword abilities (CR 702) are abilities. Both are implemented **once** and referenced by name from card data. Milestone 4 already implements the combat, targeting and damage keywords with direct checks; WP3 moves those checks behind the registry (through `rules/hookpoints.ts`) without changing behavior.

### 7.1 Architecture

A keyword ability stays in `Chars.abilities` as a `KeywordAbilityDef {keyword, cost?, amount?, quality?, filter?, player?}`. It is never replaced by its expansion, so `hasKeyword`, the rendering of the card, "loses all abilities" (layer 6) and "gains flying" work uniformly for printed, granted and keyword-counter keywords (CR 613.1f, 122.1b). The library gives a keyword **up to six ways to act on the game**:

| Mechanism | Code | Where it is read | Example |
|---|---|---|---|
| **F**lag | the keyword's presence in `getChars(...).abilities` | engine code calls `hasKeyword(c, 'flying')` | vigilance, haste, defender |
| **H**ook | `KeywordDefData.hooks` implemented in `keywords/hooks/<name>.ts` | the call-site (via `rules/hookpoints.ts`) asks each keyword of the objects involved | flying/reach/menace (block legality), protection, deathtouch (damage), first strike (combat steps) |
| e**X**pansion | `KeywordDefData.expand` (JSON) | `abilitiesFromChars` appends the generated abilities with keys `k:<face>:<index>:<n>`; activate, trigger, static and replacement code see ordinary abilities | equip, cycling, ward, prowess, crew, kicker, flashback |
| **C**ast option | `additionalCost` / `alternativeCost` statics in the expansion; special actions in `keywords/special/` | `castCheck` offers each as a cast `method` (replacing the hard-coded `'flashback'` string of `actions/cast.ts`) | flashback, evoke, kicker, buyback, foretell, plot, morph |
| **R**eplacement | `ReplacementDef` inside the expansion (self scope in M5, `feature:replace.self`) | the proposal pipeline (8.5) | buyback's "return to hand", flashback's "exile instead", madness (M6) |
| **S**tructural | dedicated state: face-down, day/night, speed, merge | `computeAll`, turn-based actions | morph/disguise (CR 708), daybound (CR 731), start your engines (CR 702.179), mutate (CR 730) |

Principles:

1. **Data first, one source of truth.** If the CR defines the keyword as a rewrite ("X means ..."), the keyword's expansion is that rewrite as JSON in `keywords/data/<name>.json`. There are **no parallel TypeScript expand functions** (the candidates' drift risk). The renderer (WP2) and the engine read the same file; a snapshot test of every expansion for sample parameters makes a change visible in review.
2. **Hooks only where the CR defines an effect on a rule rather than on game state.** Evasion, protection, combat damage and timing keywords change how a rule evaluates, so they hook that rule (7.3).
3. **Reminder text is stored** (`KeywordDefData.reminder`, with `{cost}`, `{n}`, `{quality}`): the parser uses it only to confirm a keyword line, the renderer to print it. Reminder text has no rules meaning (CR 207.2).
4. **Parameters are typed**: none, cost, number, quality, filter, costOrNumber. The corpus has 393 distinct keyword-item shapes; the top 10 cover 56% and the top 100 cover 91% (analysis 4.3), all instances of these types. Non-mana costs ("Ward--Pay 3 life", "Cumulative upkeep--Pay 1 life", "Escape--exile three other cards") are a `CostDef`. Protection and hexproof use the canonical `quality` string of milestone 4 (`rules/quality.ts`); a quality the engine cannot test leaves the keyword manual.
5. **A keyword not in the registry, or with status `planned`, is a manual node** (6.6) with `requiresEngine: ['keyword:X']`.
6. **Traceability test (flag keywords).** Each flag/hook keyword lists its engine reader call-sites in its data file's `readers` list (file path and function); a grep test fails if a keyword whose status is `implemented` has no reader, so no keyword is silently ignored.

### 7.2 The data format and sample files

Placeholders: a whole string value `"$cost"`, `"$amount"`, `"$quality"`, `"$filter"` is replaced by the parameter of the keyword instance; `{"$costAdd":{"base":"$cost","other":[...]}}` appends cost parts; `{"$ifParam":"amount","then":X,"else":Y}` handles an optional parameter. Nothing else. `status` is `implemented` (every mechanism exists), `planned` (parses and displays; the engine cannot act), or `native` (acted on by engine code that predates the data form; flashback's exile in M5; the data is the spec used by the renderer and enabled the day the native code goes). The files below were expanded with sample parameters by a script and the results type-check as `AbilityDef[]`.

`keywords/data/flying.json`

```json
{
  "name": "flying",
  "rule": "702.9",
  "params": [],
  "mechanisms": ["flag","hook"],
  "reminder": "This creature can't be blocked except by creatures with flying or reach.",
  "multiple": "redundant",
  "status": "implemented",
  "hooks": ["canBeBlocked"],
  "readers": ["rules/hookpoints.ts#canBlock"]
}
```

`keywords/data/kicker.json`

```json
{
  "name": "kicker",
  "rule": "702.33",
  "params": [{"name":"cost","type":"cost"}],
  "mechanisms": ["castOption"],
  "reminder": "You may pay an additional {cost} as you cast this spell.",
  "multiple": "independent",
  "status": "implemented",
  "expand": [
    {
      "kind": "static",
      "text": "Kicker {cost}",
      "zone": ["stack"],
      "effects": [{"s":"additionalCost","cost":"$cost","optional":true,"name":"kicker"}]
    }
  ]
}
```

`keywords/data/buyback.json`

```json
{
  "name": "buyback",
  "rule": "702.27",
  "params": [{"name":"cost","type":"cost"}],
  "mechanisms": ["castOption","replacement"],
  "reminder": "You may pay an additional {cost} as you cast this spell. If you do, put this spell into your hand as it resolves.",
  "multiple": "independent",
  "status": "implemented",
  "expand": [
    {
      "kind": "static",
      "text": "Buyback {cost}",
      "zone": ["stack"],
      "effects": [{"s":"additionalCost","cost":"$cost","optional":true,"name":"buyback"}]
    },
    {
      "kind": "static",
      "text": "If the buyback cost was paid, put this spell into its owner's hand instead of into its owner's graveyard as it resolves.",
      "zone": ["stack"],
      "effects": [
        {
          "s": "replace",
          "replaces": {"ev":"zoneChange","subject":{"self":true},"from":"stack","to":"graveyard"},
          "condition": {"cond":"wasCast","kicked":"buyback"},
          "body": {"b":"modify","destination":{"zone":"hand"}}
        }
      ]
    }
  ]
}
```

`keywords/data/ward.json`

```json
{
  "name": "ward",
  "rule": "702.21",
  "params": [{"name":"cost","type":"cost"}],
  "mechanisms": ["expands"],
  "reminder": "Whenever this permanent becomes the target of a spell or ability an opponent controls, counter it unless that player pays {cost}.",
  "multiple": "independent",
  "status": "implemented",
  "expand": [
    {
      "kind": "triggered",
      "text": "Whenever ~ becomes the target of a spell or ability an opponent controls, counter that spell or ability unless that player pays {cost}.",
      "trigger": {"on":[{"ev":"becomes","what":"targeted","object":{"self":true},"by":{"controller":"opponent"}}]},
      "effect": {
        "targets": [],
        "steps": [
          {
            "op": "pay",
            "who": {"ref":"event","role":"player"},
            "cost": "$cost",
            "else": [{"op":"counter","what":{"ref":"event","role":"spell"}}]
          }
        ]
      }
    }
  ]
}
```

`keywords/data/equip.json`

```json
{
  "name": "equip",
  "rule": "702.6",
  "params": [{"name":"cost","type":"cost"}],
  "mechanisms": ["expands"],
  "reminder": "{cost}: Attach to target creature you control. Equip only as a sorcery.",
  "multiple": "independent",
  "status": "implemented",
  "expand": [
    {
      "kind": "activated",
      "text": "Equip {cost}",
      "cost": "$cost",
      "sorcerySpeed": true,
      "effect": {
        "targets": [
          {
            "id": "t0",
            "kind": "object",
            "filter": {"types":["Creature"],"controller":"you"},
            "min": 1,
            "max": 1,
            "text": "target creature you control"
          }
        ],
        "steps": [{"op":"attach","what":{"ref":"self"},"to":{"ref":"target","id":"t0"}}]
      }
    }
  ]
}
```

`keywords/data/cycling.json`

```json
{
  "name": "cycling",
  "rule": "702.29",
  "params": [{"name":"cost","type":"cost"}],
  "mechanisms": ["expands"],
  "reminder": "{cost}, Discard this card: Draw a card.",
  "multiple": "independent",
  "status": "implemented",
  "expand": [
    {
      "kind": "activated",
      "text": "Cycling {cost}",
      "zone": ["hand"],
      "cost": {"$costAdd":{"base":"$cost","other":[{"kind":"discard","self":true,"count":1}]}},
      "effect": {"targets":[],"steps":[{"op":"draw","who":{"ref":"you"},"count":1}]}
    }
  ]
}
```

`keywords/data/cumulative-upkeep.json`

```json
{
  "name": "cumulative upkeep",
  "rule": "702.24",
  "params": [{"name":"cost","type":"cost"}],
  "mechanisms": ["expands"],
  "reminder": "At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.",
  "multiple": "independent",
  "status": "implemented",
  "expand": [
    {
      "kind": "triggered",
      "text": "At the beginning of your upkeep, put an age counter on ~. Then sacrifice it unless you pay its cumulative upkeep cost for each age counter on it.",
      "trigger": {"on":[{"ev":"step","step":"upkeep","whose":"you"}]},
      "effect": {
        "targets": [],
        "steps": [
          {"op":"putCounters","on":{"ref":"self"},"kind":"age","count":1},
          {
            "op": "pay",
            "who": {"ref":"you"},
            "cost": "$cost",
            "times": {"q":"counters","on":{"ref":"self"},"kind":"age"},
            "else": [{"op":"sacrifice","what":{"ref":"self"}}]
          }
        ]
      }
    }
  ]
}
```


Notes: `ward` and `cumulative upkeep` need no engine code beyond the ops `pay`, `counter`, `putCounters`, `sacrifice` and the event `becomes targeted`; `crew` needs the cost part `tapPower`; `equip` needs `attach` and sorcery timing. Of the top 60 keywords, 26 are pure expansions or statics (data-deliverable), 23 are flags/hooks, 10 need structural state or special actions, 1 has no in-game effect (partner).

### 7.3 Hooks: the call-sites

`KeywordHooks` (in `keywords/types.ts`) are the only places where keyword logic is code. A hook is invoked for each keyword the object has *now* (through the characteristics function), so granting and removal work. The keyword provider of `rules/hookpoints.ts` adapts them.

| Hook | Call-site | Keywords | CR |
| :--- | :--- | :--- | :--- |
| `canAttack` | `declareAttackers` candidates (`rules/combat.ts`) | defender | 702.3b |
| `canBeBlocked` | `declareBlockers` candidates | flying, reach (blocker side), fear, intimidate, shadow, horsemanship, skulk, landwalk, protection | 702.9b, 702.17b, 702.36b, 702.13b, 702.28b, 702.31b, 702.118b, 702.14c, 702.16b |
| `blockSetValid` | validation of the whole block declaration | menace | 702.111b |
| `attackTaps` | declare attackers, tapping | vigilance | 702.20b, 508.1f |
| `summoningSick` | `isSummoningSick` (`rules/timing.ts`) | haste | 702.10b, 302.6 |
| `castTiming` | `castTiming` | flash | 702.8a, 117.1a |
| `canBeTargetedBy` | `rules/targets.ts#isTargetable` | hexproof, shroud, protection, ward is a trigger (X) | 702.11, 702.18a, 702.16b |
| `combatDamageSteps` | combat damage step planning | first strike, double strike | 702.7b, 702.4b, 510.4 |
| `assignCombatDamage` | combat damage assignment | trample, deathtouch (lethal = 1) | 702.19b, 702.2c, 510.1c-d |
| `onDamageDealt` | the damage handler after the event | lifelink, deathtouch flag, infect/wither (-1/-1 counters), toxic (poison) | 702.15b, 702.2b, 702.90b-c, 702.80a, 702.164c |
| `indestructible` | `destroy` handler and the lethal-damage SBA | indestructible | 702.12b, 704.5g |
| `canBeEnchantedBy`, `canBeEquippedBy` | Aura/Equipment attachment legality and SBAs | protection, enchant | 702.16c-d, 704.5m, 704.5n |
| `paymentOptions` | payment step of casting | convoke, improvise, delve, emerge | 702.51a, 702.126a, 702.66a, 702.119a |

### 7.4 The top 60 keyword abilities and their mechanism

Counts are cards with the keyword printed (analysis 4.2). Mechanism letters as in 7.1. **Ships**: `M3`/`M4` = already implemented by that milestone (WP3 only moves it behind the registry), `M5 data` = a JSON expansion plus the ops it needs, `M5 hook` / `M5 action macro` = code in WP3/WP7, `M6` = needs layers 1/3, replacement loop, face-down or merge, `later` = long-tail data or structural state after milestone 6.

| # | Keyword | CR | Cards | Mech. | How it plugs in | Ships |
| ---: | :--- | :--- | ---: | :---: | :--- | :--- |
| 1 | Flying | 702.9 | 3,249 | F H | `canBeBlocked`: only flying/reach creatures can block it (702.9a-b, 702.17b) | M4 |
| 2 | Enchant | 702.5 | 1,248 | S H | derives the Aura spell's `TargetSpec` from `filter` (115.1b, 702.5a); Aura attaches on resolution (608.3c); `canBeEnchantedBy` + SBA 704.5m; several instances all apply (702.5c) | M4 + M5 (Aura target from `filter`) |
| 3 | Trample | 702.19 | 1,024 | F H | `assignCombatDamage`: lethal damage to all blockers first, rest to the player (702.19b, 510.1c-d) | M4 |
| 4 | Vigilance | 702.20 | 748 | F H | `attackTaps` | M4 |
| 5 | Haste | 702.10 | 670 | F H | `summoningSick` (302.6) | M3 |
| 6 | Flash | 702.8 | 629 | F H | `castTiming`; functions in any zone it could be cast from | M3 |
| 7 | Equip | 702.6 | 606 | X | sorcery-speed activated ability "attach to target creature you control"; SBA 704.5n; data | M5 data |
| 8 | Reach | 702.17 | 436 | F H | blocker side of `canBeBlocked` | M4 |
| 9 | Menace | 702.111 | 408 | F H | `blockSetValid`: at least two blockers (702.111b) | M4 |
| 10 | Cycling | 702.29 | 404 | X | activated from hand, discard self as cost, draw; emits `action cycle` for "when you cycle"; typecycling = search; data | M5 data |
| 11 | First strike | 702.7 | 390 | F H | `combatDamageSteps` | M4 |
| 12 | Lifelink | 702.15 | 387 | F H | `onDamageDealt`: controller gains that much, part of the damage event (702.15b, 120.3f) | M4 |
| 13 | Deathtouch | 702.2 | 346 | F H | lethal = 1 in assignment (702.2c); flag then SBA 704.5h | M4 |
| 14 | Defender | 702.3 | 309 | F H | `canAttack` | M4 |
| 15 | Kicker | 702.33 | 252 | C | `AdditionalCostDef` optional, name "kicker"; paid per 601.2b/f-h; recorded for `wasCast.kicked` (607.2i); multikicker = repeatable; data | M5 data (cast support exists since M3) |
| 16 | Ward | 702.21 | 211 | X | triggered: becomes target of an opponent's spell/ability -> counter it unless that player pays; data | M5 data |
| 17 | Flashback | 702.34 | 209 | C R | `AlternativeCostDef` from graveyard + stack replacement "exile instead of leaving the stack"; data | M5 native exile (M3) + data spec |
| 18 | Protection | 702.16 | 190 | F H | `canBeTargetedBy`, `canBeBlocked`, damage prevention in the damage proposal (702.16e), `canBeEnchantedBy/EquippedBy` (702.16c-d) | M4 |
| 19 | Morph | 702.37 | 184 | C S | cast face down for {3} (702.37c); face-down characteristics (708.2, layer 1b); turn face up special action (116.2b) | M6 |
| 20 | Crew | 702.122 | 183 | X | activated: tap creatures with total power N; becomes an artifact creature until end of turn; data | M5 data |
| 21 | Devoid | 702.114 | 133 | X | characteristic-defining ability, colorless (layer 5, `cda`); data | M5 data |
| 22 | Landwalk | 702.14 | 131 | F H | `canBeBlocked`: defending player controls a land of the type (702.14c) | M4 |
| 23 | Double strike | 702.4 | 130 | F H | `combatDamageSteps` | M4 |
| 24 | Indestructible | 702.12 | 111 | F H | `indestructible` (destroy, lethal damage) | M4 |
| 25 | Convoke | 702.51 | 106 | C H | `paymentOptions`: tap untapped creatures for colored/generic mana | M5 hook |
| 26 | Partner | 702.124 | 103 | - | deck construction only (CR 903); no in-game effect | deck rules only |
| 27 | Hexproof | 702.11 | 97 | F H | `canBeTargetedBy` (opponents' spells and abilities); "hexproof from X" via `filter` | M4 |
| 28 | Prowess | 702.108 | 97 | X | triggered: cast noncreature spell -> +1/+1 until end of turn; data | M5 data |
| 29 | Cumulative upkeep | 702.24 | 79 | X | upkeep trigger: age counter, then `unless` pay cost x counters else sacrifice; data (cost scaled by `{q:'counters'}`) | M5 data |
| 30 | Affinity | 702.41 | 74 | X C | `CostModDef` on the stack: reduce generic by the count of the filter (702.41a); data | M5 data |
| 31 | Suspend | 702.62 | 66 | C S X | special action from hand (116.2f); upkeep trigger removes a time counter; last one cast free + haste (608.2g) | later |
| 32 | Changeling | 702.73 | 64 | X | characteristic-defining ability, all creature types (layer 4 `all`); data | M5 data |
| 33 | Madness | 702.35 | 62 | R X | hand replacement: discard -> may exile; triggered ability to cast it for the madness cost | M6 |
| 34 | Unearth | 702.84 | 58 | X R | activated from graveyard (sorcery speed): return, haste, delayed exile; replacement exile instead of leaving; data | M6 |
| 35 | Foretell | 702.143 | 52 | C | special action (116.2h): pay {2}, exile face down; cast later for the foretell cost | later |
| 36 | Echo | 702.30 | 50 | X | upkeep trigger with intervening state "came under your control since your last upkeep"; sacrifice unless pay; data | M5 data |
| 37 | Disguise | 702.168 | 46 | C S | like morph, face-down 2/2 with ward {2} | M6 |
| 38 | Start your engines! | 702.179 | 46 | S | player designation `speed` (0-4); SBA sets speed 1 (702.179a) | later |
| 39 | Infect | 702.90 | 45 | F H | `onDamageDealt`: -1/-1 counters on creatures, poison counters on players (120.3b, 120.3d) | M4 |
| 40 | Bestow | 702.103 | 43 | C S | alternative cost cast as an Aura; becomes a creature if its enchanted permanent leaves (702.103f) | M6 |
| 41 | Toxic | 702.164 | 43 | F H | static (702.164a): combat damage to a player also gives poison counters (total toxic value, 702.164b) | M4 |
| 42 | Exhaust | 702.177 | 40 | X | wraps the next activated ability: `limit {per:'game', max:1}` (702.177a); data | M5 data |
| 43 | Fear | 702.36 | 40 | F H | `canBeBlocked` | M4 |
| 44 | Max speed | 702.178 | 40 | X | static conditional on speed 4 granting the ability (702.178a); data | later |
| 45 | Buyback | 702.27 | 39 | C R | additional optional cost + stack replacement "return to hand instead of graveyard" (702.27a); data | M5 data |
| 46 | Shadow | 702.28 | 39 | F H | `canBeBlocked` | M4 |
| 47 | Cascade | 702.85 | 37 | X | triggered on cast from the stack; macro `action cascade` (exile until lesser nonland, may cast free, rest to bottom random) | M5 action macro |
| 48 | Daybound / Nightbound | 702.145 | 37 | S | game designation (731); turn-based transform checks | later |
| 49 | Ninjutsu | 702.49 | 37 | X | activated from hand: return an unblocked attacker, put this onto the battlefield tapped and attacking | M5 data |
| 50 | Power-up | 702.193 | 37 | X | wraps the next activated ability: cost reduced by the mana cost if it entered this turn, once (702.193a); data | later (data) |
| 51 | Warp | 702.185 | 37 | C X | alternative cost from hand + delayed exile at the next end step + later permission to cast from exile | later |
| 52 | Bushido | 702.45 | 36 | X | triggered: blocks or becomes blocked -> +N/+N until end of turn; data | M5 data |
| 53 | Evoke | 702.74 | 36 | C X | alternative cost + triggered "when it enters, if evoked, sacrifice it"; data | M5 data |
| 54 | Rebound | 702.88 | 36 | R X | stack replacement (exile if cast from hand) + delayed trigger at next upkeep to cast it free | M6 |
| 55 | Shroud | 702.18 | 36 | F H | `canBeTargetedBy` | M4 |
| 56 | Exalted | 702.83 | 35 | X | triggered: a creature you control attacks alone -> +1/+1; data | M5 data |
| 57 | Storm | 702.40 | 35 | X | triggered on cast from the stack; `copy` repeated per spell cast earlier this turn (`spellsCastThisTurn - 1`), may choose new targets | M5 action macro |
| 58 | Mutate | 702.140 | 34 | C S | alternative cost targeting a non-Human creature; merge (CR 730); layer `1a` merged permanent | M6 |
| 59 | Plot | 702.170 | 33 | C | special action from hand (116.2k): exile and pay; cast later free on a main phase | later |
| 60 | Entwine | 702.42 | 32 | C | additional cost that makes `ModeSpec.max` = all modes (601.4); data | M5 (modes override) |

The 127 remaining keywords have at most 32 cards each; their expansions are mostly data too and are added by pack or by the long-tail package. The 60 above account for 88% of printed keyword occurrences (14,415 of 16,451).

### 7.5 Keyword actions (CR 701)

A keyword action is either a **primitive op** (the verbs that are the effect vocabulary) or an **action macro**: a pure function `expand(step) -> EffectStep[]` over the primitive ops, registered in `keywords/actions/` (`ACTION_MACROS`), or, for the few that need engine state (vote, venture, the Ring), a named native handler. The step is `{op:'action', action:'explore', who, subject?}`. The interpreter expands the macro and runs the resulting steps, so the renderer and the gate see the primitive form.

| CR | Action (cards) | Representation | Ships |
| :--- | :--- | :--- | :--- |
| 701.2 | Activate (1,464) | the engine action `activate`; no op | engine |
| 701.3 | Attach (433) | op `attach` | M5 op |
| 701.4 | Behold (25) | cost part / macro `behold` (reveal or control a card of a quality) | later |
| 701.5 | Cast (3,873) | op `cast` (608.2g), event `cast` | M5 op |
| 701.6 | Counter (627) | op `counter` | M5 op |
| 701.7 | Create (3,593) | op `createToken`; predefined tokens by name (CR 111.10) | M5 op |
| 701.8 | Destroy (1,802) | op `destroy` | M5 op |
| 701.9 | Discard (1,796) | op `discard`; madness replacement is the proposal pipeline | M5 op |
| 701.10-11 | Double, Triple (175) | macro `doubleCounters`, `doublePT`; life/mana by `math` quantities | M5 macro |
| 701.12 | Exchange (57) | op `exchange` | M5 op |
| 701.13 | Exile (2,877) | op `move` to exile (`until` for 610.3) | M5 op |
| 701.14 | Fight (151) | op `fight` | M5 op |
| 701.15 | Goad (88) | macro: duration effect with must-attack and can't-attack-the-goader restrictions | M5 macro |
| 701.16 | Investigate (135) | macro: `createToken` predefined Clue | M5 macro |
| 701.17 | Mill (583) | op `mill` | M5 op |
| 701.18 | Play (524) | op `cast` with a land branch | M5 op |
| 701.19 | Regenerate (423) | op `regenerate` (shield, 614.8) | M5 op |
| 701.20 | Reveal (1,353) | op `reveal` | M5 op |
| 701.21 | Sacrifice (3,435) | ops `sacrifice`, `sacrificeChoice`; cost part | M5 op |
| 701.22-25 | Scry, Search, Shuffle, Surveil | ops | M5 ops |
| 701.26 | Tap and untap (5,210) | ops `tap`, `untap`; cost parts | M5 ops |
| 701.27-28 | Transform, Convert (305) | op `changeFace` | M5 (transform), M6 (convert) |
| 701.30 | Clash (32) | macro (both reveal, compare mana values) | M5 macro |
| 701.34 | Proliferate (98) | native handler (PUSH1 T1): choosing among permanents AND players and reading each one's kinds of counters is no fixed list of primitive steps (keywords/actions/native.ts), so it runs in effects/handlers/actions-native-counters.ts like cascade and discover (WP32) | M5 native |
| 701.35 | Detain (13) | macro: effect with can't attack/block/activate until your next turn | M5 macro |
| 701.36 | Populate (26) | macro: `copy` as token of a chosen creature token you control | M5 macro |
| 701.37 | Monstrosity (36) | macro: `putCounters` + becomes monstrous event | M5 macro |
| 701.38 | Vote (41) | macro (APNAP choices, tally) | M5 native |
| 701.39 | Bolster (24) | native handler (PUSH1 T1): "the least toughness among creatures you control" is an extremum no ObjectFilter has (keywords/actions/native.ts); effects/handlers/actions-native-counters.ts | M5 native |
| 701.40, 701.58, 701.62 | Manifest, Cloak, Manifest dread (77) | macros over `move` face down + 2/2 characteristics (708) | M6 |
| 701.41 | Support (19) | macro | M5 macro |
| 701.42 | Meld (7) | macro (`meld`); manual until CR 712.4 machinery exists | M6 |
| 701.43 | Exert (36) | macro + cost part | M5 macro |
| 701.44 | Explore (47) | macro: reveal top, land -> hand, else counter and may graveyard | M5 macro |
| 701.46 | Adapt (25) | macro | M5 macro |
| 701.47 | Amass (70) | macro: find/create Army token, add counters | M5 macro |
| 701.48 | Learn (23) | macro (sideboard/discard-draw; manual outside constructed-with-sideboard) | later |
| 701.49 | Venture (38) | macro + dungeon objects (command zone) | later |
| 701.50 | Connive (51) | macro: draw, discard, counter if nonland | M5 macro |
| 701.53 | Incubate (32) | macro: Incubator token | M5 macro |
| 701.54 | The Ring tempts you (54) | macro + designation | later |
| 701.56-57 | Time travel, Discover (43) | macros | later |
| 701.59-61 | Collect evidence, Suspect, Forage (58) | cost-part actions / macros | M5 macros |
| 701.31-33, 701.45, 701.51-52 | Planeswalk, Set in motion, Abandon, Assemble, attractions | out of scope (section 1.10) | out of scope |

Verbs the corpus counts without a CR 701 entry (conjure, seek, perpetually, specialize, draft) are Alchemy: flagged `digitalOnly`, manual.

### 7.6 Ability words, predefined tokens, structural keywords

- **Ability words and flavor words** (landfall, threshold, "Wild Magic Surge", ...) are labels: the parser stores them in `AbilityBase.label` and parses the rest as an ordinary ability (CR 207.2c-d). 1,358 lines carry one.
- **Predefined tokens** (Treasure, Food, Clue, Blood, Map, Powerstone, Gold, Junk, Shard, Incubator, ...) are `TokenDef.predefined`; their rules text is data in `effects/predefined-tokens.json` (CR 111.10, written once by WP14, generated into the lexicon's `predefinedTokens` list); the effect that creates one may add to it (CR 111.10).
- **Saga chapters, class levels, leveler brackets** are structural ability kinds (`chapter`, `classLevel`, `levelBracket`) expanded by the library: chapter N is a triggered ability on lore counters crossing N (CR 714.2), class level N is a sorcery-speed activated ability that sets the class level plus static abilities conditioned on the level (CR 716.2), leveler brackets are conditional characteristic changes (CR 711.2).

### 7.7 What a rules pack may add

A pack may add keyword definitions (`KeywordDefData` with `status: implemented`, `mechanisms` limited to `expands`, `castOption` over existing statics, and `replacement` in self scope) and nothing that needs a hook or structural state: those need an engine release and are listed in `requiresEngine`. A new alternative or additional cost keyword (evoke, dash, blitz, bestow's cost, buyback, entwine, spectacle, prowl, surge, ...) is therefore a pack, not a release, as long as its effect parts use existing ops.

## 8. The interpreter and triggers

The interpreter is **plain imperative TypeScript over the data**, in the engine's existing style: it mutates `g.s` (a private clone), asks decisions with `g.choose`, emits events with `g.emit`, and is re-executed from the settled base state each time a decision is answered (docs/ARCHITECTURE.md, "The decision model"). Contract types: `effects/api.ts` (5.3). The algorithms in 8.3, 8.5, 8.6 and 9.2 are type-checked sketches: the behavior is the contract, the code is a starting point.

### 8.1 Where it plugs in

| Module | Change | Responsibility | WP |
|---|---|---|---|
| `core/resolve.ts` | `resolveTopOfStack` calls `resolveStackObject` for spells and abilities; the manual-only `manualTexts`/`resolveByHand` become the `manual` step handler; `leaveStack` keeps the layout rules (aftermath, adventure, omen; flashback natively until M6) | resolution entry | WP10 |
| `effects/{ctx,refs,eval}.ts` | new | `makeCtx`, target legality, `resolveObjs`, `resolvePlayers`, `readInfo`, `rebase`, `evalQty`, `evalCond`, `evalCount`; filter evaluation extends `rules/filter.ts` | WP4 |
| `effects/run.ts`, `handlers/*` | new | `resolveStackObject`, `runSteps`, `OP_HANDLERS`, `manualFallback` | WP10, WP12-WP15 |
| `effects/propose.ts`, `perform.ts` | new | the proposal funnel (8.5) | WP11 |
| `triggers/*` | new | normalizer, collector, delayed, reflexive, state triggers, stack placement (8.4) | WP8 |
| `actions/announce.ts`, `cast.ts`, `activate.ts` | changed | ids, `Count`, division, `onlyIf`, cast options, cost mods | WP7 |

### 8.2 Announcement (CR 601.2, 602.2, 603.3)

`cast` and `activate` follow CR 601.2b-i and are kept. What changes:

1. **Modes** (601.2b, 700.2): `chooseModes` reads `ModeSpec` (`min`/`max` as `Count`, `override` for "if kicked, choose any number instead", `chooser` for opponent-chosen modes). Options with no legal targets are disabled as today (700.2a). Entwine is an additional cost that sets `max` to all modes (`feature:modes.override`).
2. **X and optional costs** (601.2b): kicker, buyback and the like come from the `additionalCost` statics of the card (and of anything that grants them); the choice is recorded as `costsPaid` and later copied to `GameObject.cast`.
3. **Targets** (601.2c): `chooseTargets` iterates the flattened program's `targets`; skips a spec whose `onlyIf` is false; evaluates `min`/`max` quantities (X is known); applies `distinctFrom` and `groupLimit`; the player picks how many when the range is variable, *before* the targets. A `TargetSpec` kind or filter field this engine lacks makes the whole ability manual at compile time (10.2), never a guess here.
4. **Division** (601.2d): if a spec has `divide`, a `chooseDivision` decision follows; the answer is stored in `StackInfo.division[specId]`.
5. **Total cost** (601.2f): base cost (mana cost or the chosen alternative cost) + additional costs + increases - reductions, from every applicable `CostModDef` (9.5). Generic reductions apply to generic mana only and the mana part is floored at {0} (118.7). A self cost modifier that reads `targetCount` is evaluated here, after targets. Every `Count` in a cost part is resolved to a number here (CR 107.3a) and the result is locked in.
6. **Payment** (601.2g-h): unchanged (`rules/pay.ts`), plus `paymentOptions` hooks (convoke, delve, improvise, emerge) and the new cost parts (`tapPower`, `putCounters`, `payEnergy`, `reveal`, `mill`, `action`); `ManaRestriction` is enforced by the solver.
7. **Triggered abilities** (603.3c-d): modes, then targets, by the same functions; a mode or target that cannot be chosen removes the ability (603.3d). The `EventContext` is stored in `StackInfo.event`.

### 8.3 Resolution (CR 608) and the three sketches

`abilityOnStack` finds the definition behind a stack object from its `AbilityRef`: *printed* and *keyword* abilities from the card definition (a keyword-generated ability is the expansion of the printed keyword at that index, element `n`, a pure function of the data); *rule* abilities from the rule table (basic land mana, CR 305.6); *granted*, *delayed*, *reflexive* and *emblem* abilities from `StackInfo.inline`, because such an ability exists independently of its source (CR 113.7a).

The entry point flattens the chosen modes and the ability's own steps into **one program**, checks the intervening "if" (CR 608.2a), checks target legality **once** (CR 608.2b), runs the steps in order (CR 608.2c) and finishes the object (CR 608.2n). The unknown-shape backstop (`manualFallback`) is guard G11.

```ts
/**
 * Normative sketches of the three algorithms every other piece depends on (type-checked against the real engine types with the
 * collaborators declared). The WP that owns the file implements these; the behavior (not the exact code) is the contract.
 */
import type { Game } from '../core/game';
import type { AbilityDef, Condition, EffectProgram, EffectStep, Quantity } from '../types/ability';
import type { GameObject, GameState } from '../types/state';
import type { ObjectId, PlayerId } from '../types/ids';
import type { ApplicableReplacement, ExecCtx, OpHandlers, Proposed, StepResult } from './api';
import type { ObjHandle } from '../types/state-additions';
import type { LiveEffect } from '../statics/api';
import { LAYERS } from '../statics/api';
import type { Chars } from '../rules/characteristics';
import type { Layer, Modification } from '../types/ability';

declare function abilityOnStack(s: GameState, o: GameObject): AbilityDef;
declare function flattenProgram(def: AbilityDef, modes: number[] | undefined): EffectProgram;
declare function makeCtx(g: Game, obj: GameObject, program: EffectProgram): ExecCtx;
declare function evalCond(cx: ExecCtx, c: Condition): boolean;
declare function evalQty(cx: ExecCtx, q: Quantity): number | undefined;
declare function recheckAll(cx: ExecCtx): { legal: number; total: number };
declare function removeFromStack(g: Game, obj: GameObject, why: string): void;
declare function finishSpell(g: Game, obj: GameObject): void;
declare function currentZone(g: Game, id: ObjectId): string | null;
declare const OP_HANDLERS: OpHandlers;
declare function applicable(g: Game, e: Proposed): ApplicableReplacement[];
declare function applyBody(g: Game, e: Proposed, r: ApplicableReplacement): Proposed | null;
declare function perform(g: Game, e: Proposed): void;
declare function forbidden(g: Game, e: Proposed): boolean;
declare function affectedPlayer(g: Game, e: Proposed): PlayerId;

const NOTHING: StepResult = { performed: false, count: 0 };

// ---- 8.3 resolution entry: ONE re-check over the targets of ALL chosen modes (CR 608.2b) -----------------------------
export function resolveStackObject(g: Game, obj: GameObject): void {
  const info = obj.stack!;
  const def = abilityOnStack(g.s, obj);
  const program = flattenProgram(def, info.modes); // chosen modes' programs in printed order (CR 700.2d), then the ability's own steps; target ids unique
  const cx = makeCtx(g, obj, program);

  // CR 608.2a / 603.4: a triggered ability with an intervening "if" checks it again.
  if (def.kind === 'triggered' && def.interveningIf && !evalCond(cx, def.interveningIf)) {
    removeFromStack(g, obj, 'intervening if is false (CR 603.4)');
    return;
  }
  // CR 608.2b: it does not resolve only if EVERY target (of every instance of the word "target", across all chosen modes) is illegal.
  const { legal, total } = recheckAll(cx);
  if (total > 0 && legal === 0) {
    removeFromStack(g, obj, 'all targets are illegal (CR 608.2b)');
    return;
  }
  runSteps(cx, program.steps); // CR 608.2c: in the order written; illegal targets resolve to "nothing" inside the handlers
  finishSpell(g, obj); // CR 608.2n; abilities that trigger on resolution trigger now (608.2p)
}

export function runSteps(cx: ExecCtx, steps: EffectStep[]): void {
  for (const st of steps) {
    if (st.guard && !evalCond(cx, st.guard)) continue;
    const handler = OP_HANDLERS[st.op] as ((cx: ExecCtx, st: EffectStep) => StepResult) | undefined;
    const res = handler ? handler(cx, st) : manualFallback(cx, st); // guard G11: unknown shape -> ask the players, never skip
    if (st.as) cx.results.set(st.as, res);
  }
}

function manualFallback(cx: ExecCtx, st: EffectStep): StepResult {
  cx.g.choose({
    kind: 'manualResolve',
    player: cx.controller,
    prompt: `The engine cannot perform this step (${st.op}): resolve it by hand.`,
    sourceName: cx.stack?.sourceName ?? 'effect',
    text: st.span ?? st.op,
    rules: ['CR 608.2'],
  });
  return NOTHING;
}

// ---- 8.5 the proposal funnel (CR 614-616). M5 ships the funnel; `applicable` returns only what the capability set allows --
export function propose(g: Game, e: Proposed): boolean {
  if (forbidden(g, e)) return false; // CR 614.17: an event that can't happen is dropped before any replacement (only self-replacements could still apply)
  const used = new Set<string>(); // CR 614.5: an effect gets one chance per event
  let cur: Proposed | null = e;
  for (let i = 0; cur && i < 64; i++) {
    const pool: ApplicableReplacement[] = applicable(g, cur).filter((r) => !used.has(r.id));
    if (pool.length === 0) break;
    const klass = Math.min(...pool.map((r) => r.klass)); // CR 616.1a-d: self, control, copy, back face go first
    const next = klass < 4 ? pool.filter((r) => r.klass === klass) : pool; // 616.1e: otherwise any
    const chosen: ApplicableReplacement =
      next.length === 1
        ? next[0]!
        : (() => {
            const ans = g.choose({
              kind: 'chooseReplacement',
              player: affectedPlayer(g, cur!), // CR 616.1: the affected object's controller (owner if none) or the affected player
              prompt: 'Choose which replacement or prevention effect to apply first.',
              options: next.map((r) => ({ id: r.id, label: r.source.id })),
              rules: ['CR 616.1'],
            });
            return next.find((r) => r.id === ans.id) ?? next[0]!;
          })();
    used.add(chosen.id);
    cur = applyBody(g, cur, chosen); // null: replaced by "instead", prevented or skipped (614.6, 615.6)
  }
  if (!cur) return false;
  perform(g, cur); // does the change and emits the engine events (triggers see only what happened, CR 603.2g)
  return true;
}

// ---- 9.2 the layer system (CR 613) -----------------------------------------------------------------------------------
declare function baseChars(s: GameState, id: ObjectId): Chars;
declare function candidateObjects(s: GameState): ObjectId[];
declare function staticEffectsOf(s: GameState, chars: Map<ObjectId, Chars>, layer: Layer): LiveEffect[];
declare function resolvedEffects(s: GameState): LiveEffect[];
declare function matchSet(s: GameState, e: LiveEffect, chars: Map<ObjectId, Chars>): ObjectId[];
declare function applyMods(c: Chars, mods: Modification[], subject: ObjectId, s: GameState, chars: Map<ObjectId, Chars>): Chars;
declare function stillExists(s: GameState, e: LiveEffect, chars: Map<ObjectId, Chars>): boolean;
declare function cloneChars<T>(x: T): T;

type Started = Map<string, { e: LiveEffect; set: ObjectId[] }>;

export function computeAll(s: GameState): Map<ObjectId, Chars> {
  const chars = new Map<ObjectId, Chars>();
  for (const id of candidateObjects(s)) chars.set(id, baseChars(s, id));

  // CR 613.6: once an effect has started to apply to a set in one layer, it keeps applying to the SAME set in the later layers
  // it has modifications in, even if its source loses the ability meanwhile.
  const started: Started = new Map();
  const has = (e: LiveEffect, layer: Layer): boolean => e.effect.mods.some((m) => m.layer === layer);

  for (const layer of LAYERS) {
    // New effects come from the abilities objects have NOW (after the layers before this one): an ability granted in layer 6 produces layer 7
    // effects; one removed in layer 6 produces none unless it already started.
    const fresh = [...staticEffectsOf(s, chars, layer), ...resolvedEffects(s)].filter((e) => has(e, layer) && !started.has(e.id));
    const carried = [...started.values()].map((x) => x.e).filter((e) => has(e, layer));
    const here = [...carried, ...fresh];
    // CR 613.3 / 613.4a: characteristic-defining effects first. CR 613.8a(c): a dependency exists only between two CDAs or two non-CDAs.
    applyGroup(s, here.filter((e) => e.effect.cda), layer, chars, started);
    applyGroup(s, here.filter((e) => !e.effect.cda), layer, chars, started);
  }
  return chars;
}

/** Timestamp order, with dependency overriding it (CR 613.7, 613.8). Applied one at a time: the order is re-evaluated after each (CR 613.8c). */
function applyGroup(s: GameState, input: LiveEffect[], layer: Layer, chars: Map<ObjectId, Chars>, started: Started): void {
  let remaining = [...input].sort((a, b) => a.timestamp - b.timestamp || (a.id < b.id ? -1 : 1));
  while (remaining.length > 0) {
    // CR 613.8b: an effect that depends on an effect not yet applied waits. A dependency loop is ignored (timestamp order).
    const free = remaining.filter((a) => !remaining.some((b) => b !== a && dependsOn(s, a, b, layer, chars)));
    const next = free[0] ?? remaining[0]!;
    remaining = remaining.filter((x) => x !== next);
    const set = started.get(next.id)?.set ?? matchSet(s, next, chars); // the set is fixed once the effect has started (CR 613.6)
    started.set(next.id, { e: next, set });
    const mods = next.effect.mods.filter((m) => m.layer === layer);
    for (const id of set) chars.set(id, applyMods(chars.get(id)!, mods, id, s, chars));
  }
}

/**
 * CR 613.8a: A depends on B if applying B would change A's EXISTENCE, what A applies to, or what A does to it. Trial application on a scratch copy.
 * "Existence" matters for Blood Moon vs a static that grants a land type: B can change whether the static ability that generates A is still there.
 */
function dependsOn(s: GameState, a: LiveEffect, b: LiveEffect, layer: Layer, chars: Map<ObjectId, Chars>): boolean {
  const before = signature(s, a, layer, chars);
  const trial = new Map<ObjectId, Chars>([...chars].map(([k, v]) => [k, cloneChars(v)] as const));
  for (const id of matchSet(s, b, trial)) trial.set(id, applyMods(trial.get(id)!, b.effect.mods.filter((m) => m.layer === layer), id, s, trial));
  return before !== signature(s, a, layer, trial);
}

function signature(s: GameState, a: LiveEffect, layer: Layer, chars: Map<ObjectId, Chars>): string {
  if (!stillExists(s, a, chars)) return 'gone';
  const mods = a.effect.mods.filter((m) => m.layer === layer);
  return matchSet(s, a, chars)
    .map((id) => `${id}:${JSON.stringify(applyMods(cloneChars(chars.get(id)!), mods, id, s, chars))}`)
    .join('|');
}


// ---- 8.6 a representative handler: the five stages every handler has -----------------------------------------------------
declare function resolveObjs(cx: ExecCtx, ref: import('../types/ability').ObjRef): ObjHandle[];
declare function resolveRecipients(cx: ExecCtx, ref: import('../types/ability').Ref): { objects: ObjHandle[]; players: PlayerId[] };
declare function splitAmount(cx: ExecCtx, how: 'announced' | 'evenlyRoundDown' | 'evenlyRoundUp' | undefined, total: number, n: number, specId: string | null): number[];

export const damageHandler = (cx: ExecCtx, st: Extract<EffectStep, { op: 'damage' }>): StepResult => {
  const total = evalQty(cx, st.amount); // 1. information that "fails to determine" (illegal target, empty binding) is undefined: the step does nothing (CR 608.2b)
  if (total === undefined) return NOTHING;
  const [source] = resolveObjs(cx, st.source); // 2. resolve references: legal targets only, last known information for sources that left (CR 608.2h)
  if (!source) return NOTHING;
  const to = resolveRecipients(cx, st.to);
  const recipients = [...to.objects.map((o) => o.id), ...to.players]; // zone order, then id (determinism, 8.8)
  const amounts = splitAmount(cx, st.divided, total, recipients.length, st.to.ref === 'target' ? st.to.id : null); // 3. no decisions here: the division was announced (601.2d)
  let count = 0;
  recipients.forEach((r, i) => {
    const amount = amounts[i] ?? 0;
    if (amount <= 0) return; // CR 614.7a: 0 damage is no event
    const ok = propose(cx.g, { ev: 'damage', source, to: to.objects.find((o) => o.id === r) ?? (r as PlayerId), amount, combat: false, unpreventable: st.unpreventable === true }); // 4. act ONLY through the funnel
    if (ok) count++;
  });
  return { performed: count > 0, count }; // 5. record the result for `as` / `did`
};

export type _Keep = ObjHandle;
```

Rule by rule:

| CR | Where |
|---|---|
| 608.2a intervening "if" re-check | start of `resolveStackObject` |
| 608.2b targets re-check: only if ALL are illegal does it not resolve; illegal targets are not affected; information about an illegal target "fails to determine" | `recheckAll`; `resolveObjs('target')` drops illegal targets; `evalQty` returns `undefined`; the dependent step does nothing. Named tests (from the CR's own examples): Sorin's Thirst (one target, illegal: no life gained), Swords to Plowshares with protection given in response, Plague Spores (the same permanent chosen for both targets, turned black: the creature step skips it, the land step still destroys it, "can't be regenerated" still applies), Cryptic Command with one mode's target gone |
| 608.2c order of instructions; later text modifying earlier | `runSteps` in order; the parser folds modifiers into the earlier step (riders), so the interpreter never reads ahead |
| 608.2d choices while resolving, no impossible choices | `chooseObjects` clamps `min` to what exists (609.3); `may` does not ask if its first action cannot be performed |
| 608.2e multiple players choose in APNAP order, then act simultaneously | handlers with a plural `who` collect every player's choice first (`g.apnap()`), then apply |
| 608.2f actions on multiple objects: simultaneous when they can be | `each` refs are applied as one batch (one `propose` per object, one batch of events); `forEach` is one at a time and asks an `order` decision when the controller must choose |
| 608.2g casting during resolution | the `cast` handler runs 601.2a-i without giving priority; the new spell goes above the resolving object |
| 608.2h information fixed when applied; last known information | `evalQty` when the step runs; `readInfo` (3.1) |
| 608.2m an object that leaves the stack while resolving continues to resolve | `ExecCtx` holds everything it needs; it never looks at the stack |
| 608.2n instant/sorcery to graveyard, ability ceases to exist | `finishSpell` (the existing `leaveStack`) |
| 608.2p abilities that trigger on resolution | the batch ends with `finishSpell`; the collector runs |
| 608.3 permanent spells | `enters` replacements are applied by the pipeline as the object enters (614.12) |

### 8.4 Triggers at run time

**Detection and collection.** `collectTriggers(g, batch)` (`triggers/collect.ts`):

1. For each `SemEvent` of the batch and each candidate object: every permanent; every object in a zone where one of its abilities functions (hand for cycling triggers, graveyard for madness-like abilities, stack for cast triggers such as cascade and storm, command zone for emblems); plus every object that left a zone **during** the batch when a look-back kind applies (CR 603.10).
2. Enumerate the object's triggered abilities through the characteristics function (granted and keyword-generated ones count). For look-back events use the snapshot's abilities.
3. For each pattern of `trigger.on`, `matchEvent` evaluates filters against the *after* state, or the *before* snapshot for look-back events. An enters trigger is also checked with continuous effects applied "as it enters" (CR 603.6b).
4. Evaluate `interveningIf` now (CR 603.4); if false, do not trigger.
5. Count: 1, plus the `additional` of every applicable `TriggerModDef` (CR 603.2d; never for the trigger-modifying effect itself, for delayed or for reflexive triggers). `TriggerDef.batch` collapses to once per batch. `limit` ("do this only once each turn", CR 603.2h) is counted per (object, ability) in the turn tables.
6. Build the `PendingTrigger` with the `EventContext` (roles, amount, `before` snapshots) and return it; `collectPendingTriggers` enqueues it. Collecting consumes limits, effect ids, log lines and delayed records (it is not a dry run).

**When.** `advance()` calls `collectPendingTriggers` before **each** state-based action pass, not only before triggers are put on the stack (CR 603.2, 603.10, 704.3): the events since the last collection are matched against the state they happened in, and the events of a pass are the next window. So a creature that the damage or the pass kills still saw the damage (Boros Reckoner), an enters trigger of a 1/0 creature exists, and a watcher that died in the first pass does not see what happens in the second. Only objects that left a zone **in the window** look back (the old ids of the window's zone changes, CR 603.10a). A pattern with no stated origin zone ("is put into a graveyard from anywhere") never looks back (CR 603.6c).

**Putting triggers on the stack** (`putPendingTriggersOnStack`, the hook M3 left in `core/triggers.ts`): per player in APNAP order, an `order` decision when several (603.3b); then for each: modes (603.3c), targets (603.3d), no cost; `abilityTriggered` is emitted. `advance()` calls it each time a player would receive priority, as today.

- **Delayed triggers** (`delay` op, `DelayedTriggerRec`): the handler writes a record with the captured handles and fixed variables. The collector tests its `when` against each batch; on a match it creates a pending trigger whose source and controller follow CR 603.7d-g. Unless the duration says otherwise it fires once (603.7b) and is deleted. Captured objects are re-validated against their expected zone when it resolves (603.7c).
- **Reflexive triggers** (`reflexive` op, CR 603.12): when the step runs and the named step `did`, the handler queues a `PendingTrigger` (`putReflexiveTrigger`: the inline ability and its target specs). It triggers now, but like every triggered ability it goes on the stack the next time a player would receive priority (CR 603.3), in APNAP order with the other abilities that triggered meanwhile and in the order its controller chooses among their own (603.3b); its targets are chosen then (603.3d), after the parent has finished resolving. It is not stored anywhere else.
- **State triggers** (CR 603.8): evaluated each time triggers are collected (before and after every SBA pass); each carries a "has a copy on the stack" flag keyed by (object, ability), cleared when it leaves the stack. One whose modes or targets cannot be chosen is removed from the stack (603.3c-d) and stays quiet until its state has been false once (it would otherwise re-trigger at once, forever: a mandatory loop, CR 104.4b).
- **Manual triggers** (`ManualAbilityDef shape 'triggered'`): not collected. They appear in the "Triggers to check" tray (10.5); **Trigger now** creates the stack object through normal announcement, so understood targets, modes and effect are automated.
- **Triggers from replacement bodies** (CR 603.7f): a replacement body with `delay` steps creates delayed triggers with the static ability's object as source.

### 8.5 The proposal pipeline (CR 614-616)

Every op that changes the game does so through `propose(g, event)`; **no handler mutates zones, life, damage or counters directly** (a lint test forbids writes to `g.s.*` outside `effects/perform.ts`, `core/zones.ts` and the existing primitives). The pipeline is the only place that knows replacement and prevention effects; the sketch is in 8.3.

**The performers call milestone 4's primitives** (they stay the single implementation of each rule; `perform` adds the replacement funnel in front of them):

| Proposed event | Performer calls | Notes |
|---|---|---|
| `damage` | `rules/damage.ts#dealDamage(g, sourceId, target, amount, opts)` | protection prevention (CR 702.16e), lifelink, toxic, infect/wither results are inside it; `unpreventable` and `combat` are options |
| `life` | `rules/life.ts` (`gainLife`, `loseLife`, `payLife`, `givePoison`) | "can't gain/lose life" restrictions are read there (T1 migration moves them onto typed `RestrictionDef`s) |
| `zoneChange` | `core/zones.ts#moveObject`; tokens through `createToken` / `Game.addDef`; `removeFromCombat` is called by `moveObject` | `LastKnown.chars` filled by WP0 |
| `draw` | `core/zones.ts#drawCard` | |
| `counters` | `rules/counters.ts#addCounters` | |
| `destroy` | `rules/destroy.ts#destroy(g, id, {cantRegenerate})` | owns indestructible and regeneration shields (it reads the typed shield record after the T1 migration) |
| game end | `core/sba.ts` (`winGame`, `loseGame`, `drawGame`) | "can't lose/win the game" restrictions read there |

What ships when:

| | M5 | M6 |
|---|---|---|
| `forbidden(g, e)`: "can't" effects before any replacement (CR 614.17, 101.2) | yes (static `restrict`, 9.4) | same |
| shields from `effect` steps: regeneration (CR 614.8, 701.19), prevention "next N damage" / "all combat damage" (CR 615), "the next time" (CR 615.8) | yes (`body:regeneration`, `body:prevent`) | same |
| replacement defs whose subject is the object itself (`feature:replace.self`): `enters` (tapped, tapped unless, with counters, choices, shock lands, with abilities), buyback/flashback style `modify.destination` while on the stack | yes | same |
| replacement defs of other objects (`feature:replace.foreign`): Leyline of the Void, Rest in Peace, Doubling Season, "creatures enter tapped" | **no**: such a static is `partial` (unenforced chip) | yes |
| bodies `instead`, `redirect`, `skip`, `modify` (foreign) | no | yes |
| priority classes 616.1a-e, player choice `chooseReplacement`, once-per-event 614.5, newly applicable 616.2, nesting 616.1g (events inside events) | the loop exists with one candidate at most | full |
| copy as it enters (`enters.copy`, 616.1c) | no | yes (layer 1a) |

- **Priority classes (CR 616.1a-e):** self-replacement `0`, effects that change who controls the entering object `1`, copy effects `2`, back-face entry `3`, everything else `4`. Within the lowest nonempty class below 4 the affected player *must* choose among that class; for class 4 any may be chosen. **Who chooses:** the controller of the affected object (the owner if it has none) or the affected player; APNAP when several players are affected; decision `chooseReplacement`.
- **Once per chain (CR 614.5):** `used` makes each effect apply at most once to an event and its modifications. **Newly applicable effects (CR 616.2):** after each application the loop recomputes `applicable` for the modified event.
- **Events inside events (CR 616.1g):** `createToken` is replaced first, then each token entering is its own `zoneChange` proposal where "as it enters" effects apply. The same for `enters` with counters, which are `counters` proposals contained in the enter event (CR 122.6, 614.16).
- **Cast history in conditions:** `wasCast` on an entering permanent is evaluated against the spell that is becoming it (CR 400.7d).
- **Prevented or replaced events do not trigger anything (CR 603.2g, 614.6);** the modified event triggers normally. 0 damage is no event (CR 614.7a).

Traces:

*Doubling Season and Rest in Peace on the battlefield; a spell resolves "Create two 1/1 Soldier tokens".* `createToken(count 2)`: applicable: Doubling Season (class 4) -> single candidate, applied: count 4 -> no more candidates -> 4 tokens, each proposed as `zoneChange(null -> battlefield)`; Rest in Peace's pattern needs `to: graveyard`, so it does not apply. Four `zoneChanged` events in one batch; "whenever a creature enters" triggers collect four times (603.2c).

*Leyline of the Void and Rest in Peace, Bob's creature is destroyed.* `destroy` is proposed and performed; the card is to be put into its owner's graveyard: `zoneChange(battlefield -> graveyard)` is proposed. Both patterns match, both class 4; Bob (the affected object's controller) chooses (616.1). Whichever is chosen sets `destination: exile`; the other's pattern (`to: graveyard`) no longer matches. One `zoneChanged` to exile is emitted: "dies" triggers do not fire, look-back "leaves the battlefield" triggers do (CR 603.10a). A token that dies is exiled only by Rest in Peace (`isCard`).

*Wrath of God against a creature with a regeneration shield.* `destroy(each creature, regeneration:'cant')`: each creature is its own `destroy` proposal with `canRegenerate:false`, so the shield does not apply (701.19c); without "can't" the shield replaces the destruction with "remove damage, tap, remove from combat" and no zone change happens.

### 8.6 The handler contract

Every handler in `OP_HANDLERS` has the same five stages (representative code in 8.3: `damageHandler`):

1. **Evaluate** quantities; an `undefined` result (information about an illegal target or empty binding) means the step does nothing (CR 608.2b).
2. **Resolve references** with `resolveObjs` / `resolvePlayers`: legal targets only, current object if still in the expected zone, otherwise last known information (CR 608.2h); `{ref:'each'}` is evaluated once, when the step starts, in zone order then id order.
3. **Decide** with `g.choose` (APNAP when several players, CR 608.2e), never in the middle of mutating.
4. **Act** only through `propose` (or the performer of a non-proposable action such as `tap`); `rebase` bindings after a move (3.1); emit nothing directly (the performers emit).
5. **Record** the `StepResult` (the loop stores it under `step.as`), set `GameObject.links` for `link`, log with CR citations at level `action`.

Handlers never catch `NeedDecision`, never read the stack object after `makeCtx`, never branch on whether an answer exists.

### 8.7 Op catalog: rules, events proposed, decisions raised

CR = the rule the handler implements and cites in the log. "Proposes" = the event it submits to `propose`. "Decisions" = the kinds it can raise via `g.choose`; new kinds are **bold**.

| Op | CR | Proposes | Decisions |
| :--- | :--- | :--- | :--- |
| `if`, `repeat`, `let`, `forEach` | 608.2c, 608.2f | none | none (`forEach` over several of the controller's own objects asks `order`) |
| `may` | 608.2d, 603.5 | none | `yesNo` |
| `pay` | 118.12, 118.12a, 119.4 | none | `yesNo` and `payCost` for the payer (**`payCost.forPlayer`**, origin `unless` or `optional`) |
| `chooseObjects` | 608.2d | none | `chooseObjects` |
| `chooseValue` | 607.2d, 608.2d | none | `chooseColor`, `chooseOption`, `chooseNumber`, **`chooseName`** (card names) |
| `manual` | 113.1 (text), ARCHITECTURE | none | `manualResolve` |
| `damage` | 120.2-120.4, 510.1, 702.15 | `damage` | **`chooseDivision`** only at announcement |
| `gainLife`, `loseLife`, `setLife` | 119.3, 119.5 | `life` | none |
| `draw` | 121.1-121.2 (one at a time), 614.11 | `draw` per card | none |
| `discard` | 701.9 | `zoneChange` hand -> graveyard (madness replacement) | `chooseObjects` (or none for random/hand) |
| `mill` | 701.17 | `zoneChange` library -> graveyard | none |
| `scry`, `surveil` | 701.22, 701.25 | `zoneChange` (surveil) | `chooseObjects`, `order` |
| `reveal`, `look` | 701.20 | none | none (visibility via `revealedTo`) |
| `search` | 701.23 | none | `chooseObjects` (hidden info to the chooser only) |
| `shuffle` | 701.24 | none | none |
| `piles` | 608.2d | none | `chooseObjects` (separator), `chooseOption` (chooser) |
| `move` | 400.x, 401-408, 610.3, 614.12 | `zoneChange` | `order` for "any order", `chooseOption` on replacement clashes |
| `destroy` | 701.8, 701.19, 702.12b | `destroy`, then `zoneChange` | none |
| `sacrifice`, `sacrificeChoice` | 701.21 | `zoneChange` (looks back) | `chooseObjects` per player, APNAP |
| `counter` | 701.6, 608.2c | `zoneChange` stack -> graveyard (or `to`) | none |
| `createToken` | 701.7, 111 | `createToken`, then `zoneChange` (enter) | none |
| `copy` | 707.10, 707.12, 707.2 | `zoneChange` (token enters) | `yesNo`, `chooseTargets` for new targets |
| `tap`, `untap` | 701.26 | `tap`/`untap` | none |
| `attach` | 701.3, 303.4, 301.5 | `attach` | none |
| `changeFace` | 701.27, 701.28, 708.x, 712 | `transform` | none |
| `phaseOut` | 702.26 | `phaseOut` | none |
| `regenerate` | 701.19 | creates a shield | none |
| `fight` | 701.14 | two `damage` events | none |
| `removeFromCombat` | 506.4 | none (combat bookkeeping) | none |
| `exchange` | 701.12 | control/life events | none |
| `cast` | 701.5, 608.2g, 400.7h | the cast itself (601.2a-i) | all casting decisions; `chooseOption` for the cast method |
| `putCounters`, `removeCounters`, `moveCounters` | 122, 122.5-122.6 | `counters` | `chooseObjects` for "any one counter kind" |
| `addMana` | 106, 605.3b | `addMana` | `chooseColor` |
| `effect` | 611.2, 613, 614-615 | none (creates records) | none |
| `delay` | 603.7 | none (creates a record) | none |
| `reflexive` | 603.12 | queues a trigger (stacked at the next priority) | targets (603.3d), chosen then |
| `extraTurn`, `extraPhase`, `endTurn` | 500.7, 500.8, 724.1 | `skip`-able via replacement | none |
| `winGame`, `loseGame` | 104.2b, 104.3 | none | none |
| `createEmblem` | 114 | none | none |
| `rollDie`, `flipCoin` | 706, 705 | none | `chooseOption` (call) |
| `designate` | 725, 726, 731 | none | none |
| `action` | 701.x (table 2.4) | per macro | per macro |

### 8.8 Determinism rules for handlers

Re-execution only works if handler code makes the same `g.choose` calls in the same order on every run from the same base state and answers. Each rule is a code-review item and has a test.

1. Iterate only arrays with defined order. Object sets from filters are sorted by (zone order, then numeric object id); never iterate `Object.keys` of ids or a `Set` of unordered things without sorting.
2. Randomness only through the state RNG (`shuffleLibrary`, a `randomIndex(g, n)` helper); "at random" is never `Math.random`. A random choice is made when the step runs.
3. No caching of anything across actions outside the state; the characteristics cache is per `Game` and keyed by a revision counter.
4. Never branch on whether an answer exists; branch only on state and prior answers.
5. Decision ids come from `g.s.counters.decision`; object ids and timestamps from the state counters. A handler that creates objects creates them in a defined order (APNAP, then left to right in the printed text).
6. **Step budget:** a resolution that executes more than 10,000 steps (a loop `repeat`/`forEach` gone wrong) aborts to `manualResolve` with the reason `budget`.

The cost is that a resolution with `k` decisions executes `O(k^2)` handler work; resolutions have a handful of decisions. If it ever matters, `ExecCtx` can be checkpointed at the last answered decision without changing any handler.

### 8.9 Manual steps at run time

- A `manual` step raises `manualResolve` with the source name, the sentence, the controller as decider, `bound` (names and display names of what was bound so far), `done` (the sentences already resolved) and `reason`. The answer's `ManualOp`s are applied by the existing `applyManualOps`; every operation is logged at level `manual`. Steps before it have already run; steps after it run next. If the step has a `reminder`, a `ManualReminder` is created with that duration after the answer.
- After a manual step the state may differ arbitrarily from what bindings expected. Handles are re-validated on every use, so stale references are skipped, not crashed on.
- `cond:'ask'` and `q:'ask'` are `yesNo` / `chooseNumber` decisions addressed to the named player and logged at level `manual`.
- A manual **ability** is shown by the UI as described in 10.5; it uses the same stack object and log as automated ones.

### 8.10 Testing the interpreter

1. **Scenario tests named after rules** (`"CR 608.2b: a spell with one illegal target of two still resolves"`), one per op handler and per row of 8.3, built on the existing test helpers and the fixture card set.
2. **The worked examples of section 13** become golden scenarios: set up a board, run the ability, assert the result (Lightning Bolt kills a 3-toughness creature; Swords gains life equal to the creature's battlefield power even with a +1/+1 counter; Raise the Alarm under Doubling Season; Humility+Opalescence by timestamp; the Fiend Hunter race returns nothing; Rhystic Study asks the opponent first; Cryptic Command with one dead target).
3. **Determinism:** random seeded games over the fixture cards, replayed from the action log, produce identical states (extends the existing replay test); `cloneObject` hazards (4.3).
4. **Layer property tests:** random sets of continuous effects vs a straightforward timestamp-only oracle when no dependency exists; the cached vs uncached equality test.
5. **Executability smoke test** (also used by the LLM gate, 11.3): every automated ability of every card runs on a generated board that satisfies its targets; no `EngineBug`, no unbound name, no exception.

## 9. Static abilities, layers, rule hooks, cost modifiers

### 9.1 Live statics and locked resolved effects

- **Static abilities store nothing.** Their effects are re-derived at every computation from the abilities objects have *at that layer* (CR 611.3a), so a state never contains an outdated copy, an ability granted in layer 6 produces layer 7 effects, and an ability removed in layer 6 produces none unless it had already started to apply (CR 613.6).
- **Resolved effects** (`effect` step) are stored as `ContinuousEffectRec` with a timestamp (CR 613.7b, one per effect), their duration and **the effect as created**: every non-`live` quantity replaced by its number (CR 611.2d, 3.4) and every reference to specific objects (`target`, `bound`, `event`, `linked`, `self`) replaced by `{ref:'fixed', objects}`. For effects that change characteristics or control (every `Modification` layer), the `affects` set itself, including an `each` filter, is evaluated once and stored as `fixed` (CR 611.2c): the set never changes afterwards. A fixed handle stays valid across zone changes only for a permanent spell becoming a permanent (CR 400.7a); otherwise a handle in the wrong zone is skipped. Rule-affecting effects (restrictions, cost mods, permissions, replacements) keep a live `each` filter (CR 611.2c, second sentence) but still fix identities and quantities. `{ref:'fixed'}` is written only by the handler; the validator rejects it in card data.
- Effects created while some targets are illegal are built from the legal targets only (CR 608.2b).
- A static ability functions in its `zone` (default battlefield). CDAs (`cda:true`, CR 604.3) function in every zone and are applied first within their layer.

### 9.2 `computeAll`: the characteristics function

`getChars(s, id)` keeps its signature (`rules/characteristics.ts`). Internally characteristics of all relevant objects are computed **layer by layer across all objects together** (a filter in layer 4 must see the layer 1-3 results of other objects) by `statics/layers.ts#computeAll` (sketch in 8.3), cached per `Game` and invalidated by a revision counter bumped by the mutators that matter (zone changes, controller, counters, attachments, face changes, effect creation or expiry). A property test compares the cached answer with a from-scratch computation after random action sequences.

| `Modification.layer` | CR | What it changes | M5 | Notes |
|---|---|---|:---:|---|
| `1a` | 613.2a | copiable values: copy effects, merged permanents | M6 | `except` lists copy exceptions (CR 707.9) |
| `1b` | 613.2b | face-down characteristics (CR 708.2) | M6 | |
| `2` | 613.1b | controller | yes | gain control, exchange control (`exchange` op) |
| `3` | 613.1c, 612 | text-changing | M6 | color words, land types, creature types only (CR 612.2) |
| `4` | 613.1d | card types, subtypes, supertypes | yes | `all` = changeling (CR 702.73); `set` replaces a class (CR 305.7) |
| `5` | 613.1e | colors | yes | |
| `6` | 613.1f | add abilities, remove abilities, "can't have" | yes | keyword counters are rule-based layer-6 effects (CR 122.1b) |
| `7a` | 613.4a | characteristic-defining P/T | yes | only with `cda` |
| `7b` | 613.4b | set base P/T | yes | |
| `7c` | 613.4c | modify P/T (+N/-N); +1/+1 and -1/-1 counters apply here (CR 122.1a) | yes | counters are effects generated by a rule, with the timestamp of the counter (CR 613.7c) |
| `7d` | 613.4d | switch P/T | yes | |

Within a layer: characteristic-defining effects first, then timestamp order, with dependency overriding (CR 613.3, 613.7, 613.8). Timestamps (CR 613.7): the engine's counter already exists; Auras and Equipment get a new one when they attach (613.7e), permanents when they turn face up/down (613.7f) or transform (613.7g), simultaneous entries are ordered in APNAP order with the active player's choice (613.7m). **Players and rules** (CR 613.10-613.11) are applied after objects: `RestrictionDef`, `PermissionDef`, `RuleModDef`, `CostModDef` are collected in timestamp order by `staticEffectsFor` (9.4), except cost effects, which follow 601.2f. `Chars` gains `controller`, `abilities: CharAbility[]` (printed, keyword-expanded, granted, rule-generated, all with stable keys) and `cantHave` (`statics/api.ts`); P/T are decimal strings after 7a-7d.

### 9.3 Dependency (CR 613.8)

Effect A depends on B if both are in the same layer (and sublayer, and both CDAs or both not) and applying B would change **A's existence, what A applies to, or what A does to it**. Because effects are pure data this is computed by **trial application**: apply B on a scratch copy and compare A's `signature` (existence via `stillExists`, affected set, per-object result) before and after. The existence check is what makes Blood Moon versus a static that grants a land type come out right (B can remove the ability that generates A). The result of the loop: an effect that depends on one not yet applied waits (CR 613.8b); a dependency loop is ignored and timestamp order is used; the order is re-evaluated after each application (613.8c). Effects per layer are few; the quadratic loop is bounded and memoized per computation.

Humility and Opalescence: Opalescence's layer 4 effect makes every other non-Aura enchantment a creature, **including Humility**; Humility's layer 6 and 7b effect then applies to "all creatures", including Opalescence's enchantments (and Humility itself). Within layer 7b, "base P/T 1/1" and "base P/T = mana value" are both setting effects of the same sublayer, so they apply in timestamp order (CR 613.4b, 613.7) and the later wins; no dependency exists inside 7b (neither changes the other's affected set or action), so 613.8 does not reorder them. Humility's effect started in layer 6 on the set of creatures at that point and keeps applying in 7b to that set even though Humility itself has lost its abilities (CR 613.6). The interpreter derives all of this from the data; no card-specific code. (The candidates' prose that claimed a 613.8 dependency across layers 4 and 6 was wrong: dependencies exist only within a layer.)

### 9.4 Rule hooks: where restrictions, permissions and rule modifications are consulted

`RestrictionDef.action`, `PermissionDef.action` and `RuleModDef.rule` are not interpreted by a generic engine; each is a **named hook at an existing or planned call-site** that reaches `staticEffectsFor(state, query)` through `rules/hookpoints.ts` (statics provider, WP16). This keeps rule semantics in cited engine code. An action no hook exists for is not in the union, so the parser cannot produce it; the sentence becomes manual (an "unenforced rule" chip).

`RestrictionDef.action`, `PermissionDef.action` and `RuleModDef.rule` are not interpreted by a generic engine; each is a **named hook at an existing or planned call-site** that asks `staticEffectsFor(state, action, subject)`. This keeps rule semantics in cited engine code.

| Action / rule | Call-site | CR |
| :--- | :--- | :--- |
| `attack`, `mustIfAble` attack | `declareAttackers` candidates and validation (`rules/combat.ts`) | 508.1c, 508.1d |
| `block`, `beBlocked`, `beBlockedBy` | `declareBlockers` candidates and validation | 509.1a-b |
| `cast`, `castFromZone` | `castCheck` | 601.3, 601.3a |
| `activate` | `activationDenial` | 602.5 |
| `playLand`, `rule landPlays` | `actions/land.ts` | 305.1-305.2 |
| `draw`, `gainLife`, `loseLife`, `payLife` | proposal pipeline, "can't" check before replacement (an event that can't happen can only be replaced by self-replacements) | 614.17b-c, 119.7-119.8, 119.4 |
| `lose`, `win` | `loseGame`/`checkGameOver` | 104.2b, 104.3 |
| `untap`, `tap`, `beTapped`, `transform`, `search`, `sacrifice`, `discard` | the matching op handlers | 502.3, 701.26, 701.27, 701.23, 701.21, 701.9 |
| `beTargeted` | `rules/targets.ts#isTargetable` | 115, 702.11, 702.18, 702.16 |
| `beCountered` | `counter` handler | 701.6a, 101.2 |
| `beDestroyed`, `beRegenerated` | `destroy` handler | 701.8, 701.19c, 702.12b |
| `enter`, `haveCountersPut` | proposal pipeline | 614.17d, 122.6 |
| `dealDamage`, `receiveDamage`, `preventDamage` | damage proposal | 120, 615 |
| `gainAbility` | layer 6 | 613.1f |
| `rule maxHandSize` | cleanup discard (`core/steps.ts`) | 402.2, 514.1 |
| `rule combatDamageUsesToughness` | combat damage assignment | 510.1 |

Capability names: `rule:<action>` is present only when the call-site for that action consults the provider (an unfinished call-site cannot make a card falsely `full`).

### 9.5 Cost modifiers (CR 601.2f, 118.7-118.9)

`CostModDef` (`applies.self` for a spell's own modifier that functions on the stack, CR 604.5; `applies.spells` / `applies.abilities` for modifiers of others; `caster` required) are gathered by `applicableCostMods(...)` (`statics/costmods.ts`) and applied by `actions/cast.ts#applyCostModifiers` in the order 601.2f allows: increases and additional costs first, then reductions in any order, generic reductions affect generic mana only, the mana part never goes below {0}. Alternative costs replace the mana cost before modifiers (CR 118.9d). `AdditionalCostDef` / `AlternativeCostDef` are offered by `castCheck` as cast methods with their `name` recorded in `costsPaid` (what `wasCast` reads).

### 9.6 Links (CR 607) and cast history

`statics/links.ts` exposes `setLink(obj, link, value)`, `readLink(obj, link)` and `grantNamespace(effectId, link)`. Links live on `GameObject.links` (deep-copied by `cloneObject`, 4.3) and in the `LastKnown` snapshot of an object that left. `GameObject.cast` is written when a spell becomes a permanent. Both reset on any zone change (CR 400.7).

### 9.7 What ships when

| | M5 | M6 |
|---|---|---|
| `computeAll` with dependency, started set, CDA first, timestamps | layers 2, 4, 5, 6, 7a-d | + 1a (copy), 1b (face-down), 3 (text change), merged permanents |
| static `continuous` | all that use shipped layers | all |
| `restrict`, `permit`, `rule`, `costMod`, `triggerMod`, `additionalCost`, `alternativeCost`, `pregame` | each when its call-site is wired (capability `rule:<action>` etc.) | the rest |
| `replace` | `feature:replace.self` (8.5) | foreign, all bodies |
| layer-sensitive cards (Humility, Opalescence, Blood Moon, Oko, Mutavault, Rancor, anthems, Auras, Equipment) | `full` | same; copy/face-down cards (Clone, morph) become `full` |

## 10. Automation classification and the manual affordances

Every card gets one of three levels, computed by a pure function from the compiled abilities and the running engine's capability set. Nothing is asserted by hand. The result is stored in `CardDef.automation` (`CardAutomation`, 2.3) together with exactly which fragments are manual.

### 10.1 Manual nodes: what they are and where they may appear

A node is **manual** if it is a `ManualAbilityDef`, an `{op:'manual'}` step, a `{cond:'ask'}` condition, a `{q:'ask'}` quantity, or a `CostPart {kind:'manual'}`. A node is **unavailable** if it is understood but uses a capability this engine build lacks (5.2). Unavailable nodes are turned into manual nodes by the `degrade` pass (10.2) with the reason `needs-engine: <capability>`; the card lists them in `requiresEngine`, so the Update screen can say "12 cards from this set need OpenMTG 0.7 or newer" (updates.md).

The validator (G7) enforces **where** each manual node may appear, because the wrong place changes game behavior:

| Position | Allowed manual node | Anything the compiler cannot express here |
|---|---|---|
| step `guard`, `if.cond` | `{cond:'ask'}` | n/a (the condition is asked once per resolution) |
| a quantity inside a step | `{q:'ask'}` | n/a |
| a step | `{op:'manual'}` | n/a |
| cost part | `CostPart manual` | n/a (the controller confirms payment) |
| `ActivatedAbilityDef.onlyIf` | `{cond:'ask'}` | n/a (the controller attests) |
| `TargetSpec` (kind, filter, `min`/`max`, `onlyIf`, `groupLimit`) | none | the sentence is manual |
| trigger event, `interveningIf` | none | manual triggered ability (understood effect kept) |
| static `condition`, static effects | none | manual static ability |
| `ModeSpec` counts and `override` | none | the ability is manual (announcement cannot be guessed) |
| `Duration` | none | the sentence is manual |
| `ManaRestriction` | none | the `addMana` step is manual |
| `Destination` | none | the step is manual |

### 10.2 The degrade pass (the only place the engine's capability set matters)

`degradeAbility(def, caps, lines)` (contract in `model/api.ts`) is pure and idempotent and runs in the pipeline on **every ability from every source** (parser, LLM cache, pack, hand-written data):

1. Compute `missingCapabilities(def, caps)`. Empty: unchanged.
2. For each missing capability find the smallest enclosing unit by position: a step (op, quantity, condition, filter field, reference kind, duration, destination) becomes `{op:'manual', text, reason}` and the taint rules of 6.7 run again (T1/T2) so dependents become manual too; a cost part becomes `CostPart manual`; a target spec, trigger event, intervening if, static effect or static condition, mode count, or a non-`ask` activation restriction makes the whole ability a `ManualAbilityDef` (keeping the understood `cost` and, for a triggered ability, the understood `effect`).
3. Record the capabilities in `requires`.

Because the pass is pure data to data, a pack or cache entry produced by a newer build is usable by an older one: it just plays more manually, and plays fully the day the engine gains the capability.

### 10.3 The rule

```
abilityLevel(a):
  if a.kind == 'manual'                                  -> manual
  nodes = manualNodes(a)            (after degrade)
  if nodes is empty                                      -> full
  if a has no automated effect content                   -> manual
  else                                                   -> partial
  where "automated effect content" = at least one step, static effect or trigger event that is neither manual nor unavailable
        (costs and targets alone do not count: Mindslaver's {4},{T}, sacrifice is understood, its effect is not)

cardLevel(card):
  abilities = every ability of every face (keyword abilities count; reminder text does not)
  if abilities is empty                                  -> full      (vanilla, basic land)
  if every ability is full                               -> full
  if no ability is automated at all                      -> manual
  else                                                   -> partial
  then the caps of 10.4 are applied
```

Properties: **monotone** (adding a handler, a template or a capability can only move a card up); a `full` card has no manual node, passed the exact render gate on every ability (a failed gate produced a manual ability in the first place) and uses only capabilities the engine has; `partial` is never reported when the card is in fact entirely manual. `autoRatio` is the share of non-reminder characters inside automated spans (for sorting work and the deck screen).

| Card | Level | Why |
|---|---|---|
| Serra Angel | full | two keywords, both flag/hook keywords the engine has |
| Lightning Bolt, Cryptic Command, Jace TMS (section 13) | full | every node understood and available |
| Mutavault without the rider template | partial | the mana ability is automated; the second ability is one manual step (6.7) |
| Magma Spray (M5) | partial | damage automated; manual shield step with a chip |
| A vanilla creature, a basic land | full | no abilities (a basic land's mana ability is rule-generated, CR 305.6) |
| Chaos Orb | manual | the activation cost is understood but the effect is manual |
| Mindslaver | manual | cost understood, "You control target player during that player's next turn" manual (CR 723) |
| A creature with flying and an unparsed activated ability | partial | the keyword is automated |
| A card whose only keyword is `planned` | manual | `requiresEngine: ['keyword:X']` |
| Doubling Season, Leyline of the Void in M5 | partial / manual | `feature:replace.foreign` missing; full in M6 |

### 10.4 Overrides and caps (applied after the rule)

- **`forceManual`**: a local setting (`CompileSettings.forceManual`, a set of Oracle names) makes the pipeline classify the card `manual` and replace every ability by a `ManualAbilityDef` (reason `forceManual`), whatever any source said. It is the escape hatch against a wrong template while it is being fixed. Games record the setting in the log.
- **Experimental templates**: a card whose result used a template with `status:'experimental'` is capped at `partial` (6.9).
- **LLM data**: units from an entry with review state other than `reviewed` cap the card at `partial` and show an "AI-compiled" mark; high-risk nodes (11.5) from a non-`reviewed` entry are not used at all.
- **Stubs and unsanctioned cards**: `manual` by definition (12.1).
- **Alchemy digital-only** cards (`digitalOnly`): `manual`.

### 10.5 What the player sees (the contract with the client of milestone 8)

The UI renders from `CardDef`, the character ledger and `CardAutomation`; none of this needs card art (the placeholder frame is drawn from `FaceDef`).

- **Badge** on the frame, in zones, in the deck list and on the deck-import report: full (check), partial (half circle, "Partly automated"), manual (hand, "Resolve by hand"). Colour is never the only signal. The import report summarizes "58 full, 2 partial, 0 manual, 0 stubs" and lists the non-full cards with their reasons. Opponents see the same badges (they are rules knowledge, not hidden information).
- **Oracle text painting.** `cards/spans.ts#spansOf(def, face)` turns the ledger into `TextSpan[]` (`pipeline.ts`): automated spans plain; manual spans amber with a dotted underline and a tooltip with the reason; reminder text dimmed; labels plain. Understood costs stay plain.
- **"How OpenMTG plays this card" drawer.** Per ability: status, provenance (`prov`: keyword, template id, LLM cache, pack, hand), the renderer's reading of the JSON ("Understood as: ..."), the manual text with its `reason`, missing capabilities, and **Report a mistake** (copies card name, `textHash` and the parse diagnostics; no network call). By guard G6 the reading equals the Oracle sentence for automated abilities.
- **On the battlefield:** a permanent with a manual triggered ability shows an "M" chip and its entries appear in the **Triggers to check** tray at the end of each step with a **Trigger now** button (an optional toast "2 manual triggers may apply" at step boundaries). A manual activated ability uses the normal activation flow (the engine charges the understood cost, then `manualResolve`). A manual **static** or replacement shows a persistent **Rules reminders** panel entry with the controller and exact text, plus one log line when the card enters. `ManualReminder` chips (manual shields) show until their duration ends.
- **On the stack / at resolution:** the `manualResolve` panel shows the card, the sentence in context (the parts already resolved are shown as done), what was bound so far ("it = Grizzly Bears"), the reason, and the existing manual operations (move, life, counters, tap, draw, shuffle, control, damage, attach, mana, note). Every manual operation is logged at level `manual`.
- **Deck screen** on import: "N full, M partial, K manual, S stubs" with expandable lists; a setting "warn before starting with manual cards" (default on) never blocks play.
- **Game summary:** how many times the game needed hand resolution and for which cards (feeds coverage priorities).
- **Coverage report** (CLI): counts by level and by reason, the most frequent unparsed shapes by cards unlocked (6.12).

### 10.6 Deliberately outside the model

| Group | Examples | Policy |
|---|---|---|
| Physical or dexterity actions | Chaos Orb, flip/toss cards, stickers (CR 123) | `ManualAbilityDef` with the understood cost |
| Subgames and ante | Shahrazad (CR 729), ante cards | manual |
| Controlling another player | Mindslaver (CR 723) | manual; cost paid automatically |
| Digital-only Alchemy | conjure, seek, perpetually, specialize, draft (712 cards) | flagged `digitalOnly`; manual |
| Non-deck objects | planes, phenomena, schemes, vanguard, attractions (CR 717, 901-905) | defs compile; abilities manual until a later milestone adds the command-zone machinery |
| Commander/companion deck rules | Partner, Companion, Choose a Background | deck validation, no in-game effect |

## 11. The LLM compile step

The optional LLM step produces **the same JSON** as the parser, only for the units the parser left manual, under stricter gates than the parser, and caches it as reviewable data. The game never needs it (docs/ARCHITECTURE.md, "Abilities are data" item 4). It is a CLI of `@openmtg/cards` (WP26) on the user's machine, never part of the client or the engine.

### 11.1 Selection, modes, and what it may change

`npm run cards -- compile --llm [--only partial|manual] [--limit N] [--set X] [--oracle-id ...] [--model M] [--yes]`. Input: cards the parser classified `partial` or `manual` (from the last coverage run), ordered by popularity (cards in the owner's decks first, then recent sets). Sentences the parser already accepted are not sent as work: the unit is the **face**, with the parser's accepted abilities shown as context and only the failing sentence indices requested.

Three modes, one validator:

| Mode | Input | Output |
|---|---|---|
| **full** | a face the parser could not read at all | all abilities of the face |
| **repair** | the parser's partial result, the failing spans, and for each span `furthest` / `expected` (the parser's own "stuck at" diagnostic) | JSON for those spans only |
| **template induction** | a sentence shape that many manual units share, with up to 20 example sentences | a proposed `Template` (6.3) |

**Authority.** LLM output can only **overlay a unit the parser left manual** (same `src` line and `sentence` index). It never replaces a unit the parser accepted. If an overlay and a parser result both exist for the same unit and their canonical JSON differs, the parser wins and the entry gets the flag `templates:disagree`.

### 11.2 Prompt shape

Two messages. The system message is long, stable and cacheable; the user message is per card.

```
SYSTEM  (prompt version N, cached prefix)
  You convert Magic: The Gathering Oracle rules text into the JSON model below.
  Output ONLY a JSON object that validates against the schema. Never write card text.
  Rules:
   1. Use only the ops, events, statics and refs in the schema. If a sentence needs something the schema cannot say,
      emit {"op":"manual","sentence":N,"reason":"..."} for that sentence (or {"kind":"manual",...} for a whole ability). Never approximate.
   2. Represent every word of rules meaning in the sentence (unless, instead, up to, another, each, can't, until, twice, half, ...).
      If you cannot represent one, emit manual.
   3. Name anaphora explicitly with "as" and {"ref":"bound","name":...}; use "event" roles inside triggers. Ambiguous pronoun: manual.
   4. One TargetSpec per word "target"; ids t0, t1, ... in reading order across the whole ability (modes included).
   5. Every acting player is explicit ("who", "payer", "source", "controller" of a battlefield move).
   6. Conventions: the normative notes of section 3 of the design (handles, defaults, quantities, targets and modes).
  <SCHEMA>   ability.schema.json (generated from types/ability.ts)
  <GLOSSARY> op catalog (8.7), event roles (3.5), keyword list with parameter shapes (7.4), layer table (9.2)
  <EXAMPLES> 5 canonical cards always, plus the 8 nearest verified examples by text similarity

USER
  Card: <oracle_id>   Layout: <layout>   Type line / P/T / loyalty per face
  Face 0 normalized text, with sentence indices:  [0] "..." [1] "..."
  Already understood by the parser (do not redo): abilities 0,1 (as JSON)
  Needed: sentence indices [2]       Parser diagnostics for [2]: stuck at "unless" after "target creature", expected: ".", ",", "and"
  Return: { "faces": [ { "abilities": [ ... ] } ], "notes": "..." }

ASSISTANT  JSON only
```

No `text`, `span`, `label` or `TargetSpec.text` fields are requested: the model gives `src` line indices and `sentence` indices and the loader hydrates display text from the local Oracle text. This removes the main hallucination surface (inventing or altering card text) and keeps card text out of the cache (11.4).

### 11.3 Validation pipeline (a result is rejected at the first failing gate)

1. **JSON** parses; top level has the expected shape.
2. **Schema** validation against `model/schema.generated.json`, generated from `types/ability.ts` with `ts-json-schema-generator` (a dev dependency of the repository root, MIT) and checked in; a CI test regenerates it and fails on any diff, so the TypeScript and the schema cannot drift. The same schema validates rules-pack entries on install.
3. **Semantic lint** (`model/lint`, G7).
4. **Capability record** (G8): ops and keywords the engine lacks are allowed but recorded in `requiresEngine`.
5. **Render gate** (G6): hydrate display fields, `render(ability)`, compare with the Oracle sentence. Up to 2 repair attempts: the failing diagnostic ("rendered 'destroy all creatures' but the card says 'destroy all nonblack creatures'") is sent back.
6. **Critical-word check on the sentence** (G3 applied to the source sentence): if a critical word of the lexicon is in the sentence and the rendered text lacks it, the gate fails.
7. **Executability smoke test** (WP25 `packages/cards/src/smoke`): each ability is run in the interpreter on a generated board (targets satisfied, hand/graveyard populated, an opponent present); it must complete without `EngineBug`, unbound names or exceptions and leave the state valid (SBAs consistent).
8. **Agreement:** a second independent run (different model or temperature, fresh context). Canonical JSON of both must be equal. Equal: `autoverified`. Different: `unreviewed` with `twoRuns:disagree`.
9. **Risk flags:** `highRisk:*` is added when the JSON uses replacement effects, layers 1-3, layer 2 (control), `exchange`, delayed triggers, `copy`, `piles` or `createEmblem`: nodes where a plausible-looking error does the most damage. Such entries are never auto-trusted: they need `reviewed`.

### 11.4 Cache layout and stored form

```
.cache/compiled/                      git-ignored, on the player's machine
  index.json                          oracle_id -> CompileIndexEntry
  entries/ab/<oracle_id>.json         CompiledCardEntry (abilities WITHOUT any text)
  raw/<oracle_id>.<n>.json            raw model replies, for audit and offline re-validation
  review-queue.jsonl                  one line per entry waiting for review
  logs/compile-<date>.jsonl           token counts, gate failures, costs
```

`CompiledCardEntry` is in `cards/pipeline.ts` (5.3). **Stored form = no Oracle text.** `strip(ability)` removes every display field (`text`, `label`, `span`, `TargetSpec.text`, mode option `text`, manual `text`); what remains is the structure plus `src` and `sentence` indices. `hydrate(ability, lines, expectedHash, actualHash)` restores them and refuses (the caller discards the entry) if the `textHash` of the player's current text differs. This keeps packs publishable under the project's rule that it ships no Wizards text (updates.md) and makes the cache robust to errata: a changed text invalidates the entry instead of attaching old behavior to new wording. Schema or `ABILITY_MODEL_VERSION` bumps invalidate entries; raw replies are re-validated first and re-requested only if they fail.

### 11.5 Review, trust, flags

`npm run cards -- review` walks `unreviewed` and `autoverified` entries sorted by risk and popularity. For each it shows the Oracle sentence, the rendered text, the JSON and a diff against the parser's output; the reviewer accepts (`reviewed`), edits, or rejects (`rejected`, never used again for that `textHash`). Flags: `usesManual`, `highRisk:replacement|layers|delayed|control|copy|exchange|piles|emblem`, `gate:failedOnce`, `twoRuns:disagree`, `templates:disagree`, `lint:warning`, `executability:failed`.

**Trust policy** (setting `compile.llmTrust`, default `autoverified`):

| Setting | Which entries drive play | Card level |
|---|---|---|
| `off` | none | parser only |
| `reviewed` | only `reviewed` entries | may be `full` |
| `autoverified` (default) | `reviewed`, plus `autoverified` entries without any `highRisk` flag | `reviewed` data may be `full`; any `autoverified` unit caps the card at `partial` and shows an "AI-compiled" mark |

Entries not trusted by the policy are simply not used and the card stays manual. This is deliberately conservative: a manual card costs the players a few clicks, a wrong automated card silently changes the game. (The semantics candidate let `autoverified` entries drive play with no cap; the grammar candidate capped everything unreviewed; the cap-at-partial with play enabled is the compromise.)

### 11.6 Template induction and promotion

`reviewed` entries are the input of `coverage --promote`: it replaces filters, numbers, colors and names in the reviewed JSON and its sentence by holes of the matching type, proposes a `Template` (status `experimental`), and runs G9 and G10 on it. The invariant (G10) is that **adding a template may change only formerly-manual units**; the whole-index snapshot diff proves it. A human approves the template; the template count grows with reviewed data and the LLM is needed less over time.

### 11.7 Safety, privacy, cost

- Only public rules text is sent (normalized Oracle text of the face and the schema); no player data, decklists or game states.
- It needs an explicit API key in the environment and refuses to run without `--yes`, after printing a cost estimate (cards x tokens).
- It reads the local Oracle index only; it never downloads from Scryfall.
- Each reply is stored raw so the whole pipeline can be re-run offline (gate changes, schema bumps) without calling the model again.

### 11.8 Failure modes

| Failure | Mitigation |
|---|---|
| Valid JSON that means something else than the text | exact render gate; two-run agreement; `highRisk` needs human review |
| Plausible but wrong rare shapes (layers, copy, replacement) | `highRisk` flag forces review; golden scenario per promoted template |
| Hallucinated ops/fields | schema validation rejects them |
| Silently dropped modifier ("unless", "up to") | critical-word check on the sentence (gate 6) |
| Cost and drift | cache keyed by (oracle_id, textHash, promptVersion, modelVersion); only failing sentences requested |
| Errata | `textHash` mismatch discards the entry |
| Returns `manual` too eagerly | counted; prompt and examples tuned from the manual-rate metric |

## 12. The card pool, rules packs and caches ("every card is known")

The requirement: the program knows every Magic card; placeholders stand in for images; players upload decklists and images and the game recognizes which cards they are. `docs/ARCHITECTURE.md` ("Card images") fixes the front end (text-frame placeholder, name-resolved uploads kept in the browser). What the ability compiler must add is the guarantee that **no card is ever unplayable because its rules text is not understood**, plus the pieces that make "every card" literally true.

### 12.1 Contracts

| # | Contract | Mechanism |
|---|---|---|
| C1 | `compileCard` is total: it never throws and never drops a card. | A parser exception on a face becomes one `ManualAbilityDef` (`prov.by:'fallback'`, diagnostic `parser-error`); worst case every ability is manual and `automation.level` is `manual`. |
| C2 | A card with manual abilities is fully playable: it can be drawn, cast, enter the battlefield, attack, and be resolved by hand. | `manualResolve` and `ManualOp`s (`core/manual.ts`); permanent spells never depend on their text to enter (CR 608.3). |
| C3 | Images are independent of rules automation. | The engine carries only `CardDef.name`, face names and `oracleId`; the client keys images by `(Oracle name, slot)` (12.2). Classification never affects image binding. |
| C4 | A name the local index does not know still loads. | `stubCardDef(name, origin)` (`cards/pool.ts`): one face, no cost, no types, no text, `stub:true`, `automation.level:'manual'`. It is placeable in any zone by a manual move and exists so the game is never blocked and an uploaded image has somewhere to go. The Update button replaces a stub by the real card when the index learns the name. **Behavior change** from today's "unknown name is an error" in `resolveDecklist`: the client (M8) asks the player to confirm; the engine only provides the function. |
| C5 | Tokens are defined inline or by name. | `TokenDef` is `{predefined}` (Treasure, Food, Clue, ... from `effects/predefined-tokens.json`, CR 111.10; newer ones from the local `tokens.jsonl` through the Update flow) or inline (P/T, colors, types, abilities). The engine synthesizes a frozen `CardDef` with `isToken:true` through `Game.addDef`, id `token:<hash of canonical TokenDef>`; the client binds token images by token name and variant. |

### 12.2 Image slots

ARCHITECTURE.md says multi-faced cards accept one image per face. The rules faces of a card are not always printed sides: a split card, adventure card, flip card, prepare card and aftermath card are one physical card with one picture. `imageSlots(def)` (`cards/pool.ts`, pure) is the only place that knows this table; if the literal "one image per rules face" it returns one slot per face and nothing else changes.

| Layout | Rules faces | Image slots | Slot key and names that resolve to it |
|---|---|---|---|
| normal, saga, class, case, leveler, mutate, prototype, planar, scheme, vanguard | 1 | 1 | `Name` |
| split, adventure, flip, prepare | 2 | 1 | `Full // Name`; either face name resolves to it |
| transform, modal_dfc, reversible_card, double_faced_token | 2 | 2 | `Front name`, `Back name` |
| meld | 2 front cards plus a combined back | 3 | `Front A`, `Front B`, `Melded name` |
| token, emblem | 1 | 1 per token variant | `Token name (variant)` |
| stub | 0 | 1 | `Name as given` |

**Art Series** names (excluded from the index today) resolve to the real card they depict, for image matching only.

### 12.3 Unsanctioned cards

The index builder excludes 2,244 Art Series, 291 `front_card` objects (not game cards) and 603 silver-border and acorn cards. To honor "every single card", `packages/cards` gains an opt-in index option `--include-unsanctioned` that keeps the 603 as `CardDef`s flagged `unsanctioned`, `manual`-only, excluded from default deck validation but recognizable in decklists and image uploads. It touches `packages/cards` (WP24) and needs the owner's confirmation (15.6); the default stays as today.

### 12.4 Layout support

| Layout | Treatment in M5 | Level until supported |
|---|---|---|
| normal, token, emblem | supported | n/a |
| split (CR 709), adventure (CR 715) | spell half per face; characteristics already split in M3 | n/a |
| transform, modal_dfc (CR 712) | abilities per face; `changeFace transform` (face index, new timestamp, CR 613.7g) in M5; daybound/nightbound later | partial where the card has a transform trigger |
| flip (CR 710) | abilities per face; the flip op is M6 | partial |
| saga (CR 714) | `chapter` abilities, lore counters, SBA 704.5s | n/a |
| leveler (CR 711), class (CR 716) | `levelBracket`, `classLevel` | n/a |
| case (CR 719), prepare (CR 722) | recognized, manual | manual until structural support |
| meld (CR 701.42, 712), mutate (CR 730), prototype (CR 718) | merging/meld machinery | manual until M6 or later |
| planar, scheme, vanguard (CR 901-905) | not deck cards | manual, flagged `outsideDeckPlay` |

### 12.5 Rules packs

updates.md defines the pack and the Update button; this design fixes the contents. A pack is JSON, validated before install, never executed:

```jsonc
{
  "format": "openmtg-rules-pack", "formatVersion": 1, "packVersion": "2026.10.11-1",
  "minEngineVersion": "0.5.0", "modelVersion": 1, "createdAt": "...",
  "keywords":  [ /* KeywordDefData: status implemented, mechanisms limited to expands/castOption/replacement(self) (7.7) */ ],
  "templates": [ /* Template without examples/counterExamples (stripped); validated against the corpus locally at install */ ],
  "cards": { "<oracle_id>": /* CompiledCardEntry: structure only, textHash, review state, source */ },
  "requiresEngine": { "<oracle_id>": ["op:copy", "keyword:morph"] }
}
```

Rules: **no Wizards or Scryfall content** (no names, Oracle text, images; `examples` stripped); entries apply only when `textHash` matches the player's local text; a pack entry's JSON passes the same gates as any source (schema, lint, capability degrade, and the exact render gate at install, on the player's own text); installed in `.cache/packs/` (git-ignored); precedence per face: pack entry > parser (and trusted LLM overlay on parser-manual units, 11.1). `npm run cards -- build-pack` gathers `reviewed` entries and hand-written overrides, strips everything except our data, validates it, writes `packs/openmtg-rules-pack.json` plus its manifest and prints coverage deltas. Pack installation reports "new cards known, cards newly automated, cards still manual, cards needing a newer OpenMTG".

### 12.6 Caches

Compiled `CardDef`s are cached in `.cache/compiled-defs/<compilerVersion>.jsonl` keyed by `textHash` (pure derived data, safe to delete); the LLM cache is `.cache/compiled/` (11.4). A change of parser, templates, keyword data, capability set, pack or `forceManual` setting recompiles only the affected cards; the engine's `compileCard` is called by the client for the 30-100 cards of a deck.

## 13. Worked examples

Every JSON block below is printed from a typed TypeScript value (`examples/cards.ts`, 53 cards plus one milestone 6 form in section 14) that compiles against the section 2.3 model, so each is a valid instance of the types. A prototype semantic lint (16.3, about 100 lines, the starting point of WP1) passes for all of them (listing in 16.3): names are bound before use, target ids exist and are unique across modes, event roles appear only inside triggers and replacements, `subject` only inside continuous effects, every link has a producer and a consumer, `divided:"announced"` has a division spec, `addMana` has exactly one of `units`/`dynamic`, layer 7a only with `cda`. Running it found one real mistake in the first draft of the examples (a cost modifier that named a target id belonging to another ability, which is why `spellTargetCount` exists) and one bug in the lint itself, which is the argument for making the lint part of the build. The examples are also the first entries of the golden corpus (G10) and the acceptance cards of the work packages (15.2). Conventions: `text` is the normalized Oracle text of the ability (`~` is the object's own name); single-face cards show only `abilities`; multi-face cards show `faces`; targets are hoisted into `targets` with ids `t0, t1, ...` unique across the whole ability; optional fields at their default are omitted, but `who`, `source`, `payer`, `caster` and the battlefield `controller` are always written. The oracle text shown is the current wording in the local index. "Classification" is the level once every node the example uses is implemented; where the card needs milestone 6 it says so.

Coverage of the set: target specs and `anyTarget` (Lightning Bolt), modes with per-mode targets (Cryptic Command), X and division (Fireball, Fire // Ice), kicker and cast history (Kavu Titan), counters/destination (Memory Lapse), `pay` in its three roles (Mana Leak, Rhystic Study, Smothering Tithe, Mana Vault, Pact of Negation), resolved effects with fixed quantities (Aspect of Hydra) and a multi-layer effect with a fixed set (Oko), live statics and layers (Anthem, Humility, Opalescence, Rancor, Equipment), history filters and quantities (Death-Rattle Oni), required actors (Path to Exile, Rabid Bite, Thalia), linked abilities (Fiend Hunter, Paradise Plume, Cavern of Souls), `enters` bodies (Kavu Titan, shock and check lands, Clone), replacement effects (Doubling Season, Leyline of the Void, Rest in Peace), triggers (Blood Artist, FTK, Panharmonicon), delayed triggers (Sneak Attack, Pact of Negation), structural kinds (saga chapters), manual cards (Chaos Orb) and manual shields (Magma Spray).

### 13.1 One-shot spells

#### Lightning Bolt

> Lightning Bolt deals 3 damage to any target.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "spell",
      "text": "~ deals 3 damage to any target.",
      "effect": {
        "targets": [{"id":"t0","kind":"anyTarget","min":1,"max":1,"text":"any target"}],
        "steps": [{"op":"damage","source":{"ref":"self"},"to":{"ref":"target","id":"t0"},"amount":3}]
      }
    }
  ]
}
```

`source` is required: here the spell itself. `anyTarget` is CR 115.4 (creature, planeswalker, battle, player).

#### Counterspell

> Counter target spell.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "spell",
      "text": "Counter target spell.",
      "effect": {
        "targets": [{"id":"t0","kind":"spell","min":1,"max":1,"text":"target spell"}],
        "steps": [{"op":"counter","what":{"ref":"target","id":"t0"}}]
      }
    }
  ]
}
```

#### Mana Leak

> Counter target spell unless its controller pays {3}.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "spell",
      "text": "Counter target spell unless its controller pays {3}.",
      "effect": {
        "targets": [{"id":"t0","kind":"spell","min":1,"max":1,"text":"target spell"}],
        "steps": [
          {
            "op": "pay",
            "who": {"ref":"controllerOf","object":{"ref":"target","id":"t0"}},
            "cost": {"mana":[{"kind":"generic","amount":3}]},
            "else": [{"op":"counter","what":{"ref":"target","id":"t0"}}]
          }
        ]
      }
    }
  ]
}
```

CR 118.12a: "X unless [player] pays" means "[the player] may pay; if they don't, X". One op, `pay`, with the payer named; the counter is its `else` branch. The payer is the spell's controller, not the caster of Mana Leak.

#### Memory Lapse

> Counter target spell. If that spell is countered this way, put it on top of its owner's library instead of into that player's graveyard.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "spell",
      "text": "Counter target spell. If that spell is countered this way, put it on top of its owner's library instead of into that player's graveyard.",
      "effect": {
        "targets": [{"id":"t0","kind":"spell","min":1,"max":1,"text":"target spell"}],
        "steps": [{"op":"counter","what":{"ref":"target","id":"t0"},"to":{"zone":"library","position":"top"}}]
      }
    }
  ]
}
```

The second sentence modifies the destination of the first (CR 608.2c): the parser folds it into `counter.to`. The word "instead" is a critical word consumed by the fold template; if no template consumed it the sentence would be manual.

#### Giant Growth

> Target creature gets +3/+3 until end of turn.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "spell",
      "text": "Target creature gets +3/+3 until end of turn.",
      "effect": {
        "targets": [{"id":"t0","kind":"object","min":1,"max":1,"text":"target creature","filter":{"types":["Creature"]}}],
        "steps": [
          {
            "op": "effect",
            "effects": [{"s":"continuous","affects":{"ref":"target","id":"t0"},"mods":[{"layer":"7c","power":3,"toughness":3}]}],
            "duration": {"d":"endOfTurn"}
          }
        ]
      }
    }
  ]
}
```

A resolved continuous effect: layer 7c, locked affected set (CR 611.2c), duration end of turn (CR 514.2).

#### Aspect of Hydra

> Target creature gets +X/+X until end of turn, where X is your devotion to green.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "spell",
      "text": "Target creature gets +X/+X until end of turn, where X is your devotion to green.",
      "effect": {
        "targets": [{"id":"t0","kind":"object","min":1,"max":1,"text":"target creature","filter":{"types":["Creature"]}}],
        "steps": [
          {
            "op": "effect",
            "effects": [
              {
                "s": "continuous",
                "affects": {"ref":"target","id":"t0"},
                "mods": [
                  {
                    "layer": "7c",
                    "power": {"q":"devotion","to":["G"],"of":{"ref":"you"}},
                    "toughness": {"q":"devotion","to":["G"],"of":{"ref":"you"}}
                  }
                ]
              }
            ],
            "duration": {"d":"endOfTurn"}
          }
        ]
      }
    }
  ]
}
```

CR 611.2d: the value of X is determined once, on resolution. The `effect` handler replaces every non-`live` Quantity by its number when it creates the record, so the bonus does not drift when the board changes.

#### Doom Blade

> Destroy target nonblack creature.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "spell",
      "text": "Destroy target nonblack creature.",
      "effect": {
        "targets": [
          {
            "id": "t0",
            "kind": "object",
            "min": 1,
            "max": 1,
            "text": "target nonblack creature",
            "filter": {"types":["Creature"],"notColors":["B"]}
          }
        ],
        "steps": [{"op":"destroy","what":{"ref":"target","id":"t0"}}]
      }
    }
  ]
}
```

#### Swords to Plowshares

> Exile target creature. Its controller gains life equal to its power.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "spell",
      "text": "Exile target creature. Its controller gains life equal to its power.",
      "effect": {
        "targets": [{"id":"t0","kind":"object","min":1,"max":1,"text":"target creature","filter":{"types":["Creature"]}}],
        "steps": [
          {"op":"move","what":{"ref":"target","id":"t0"},"to":{"zone":"exile"}},
          {
            "op": "gainLife",
            "who": {"ref":"controllerOf","object":{"ref":"target","id":"t0"}},
            "amount": {"q":"stat","stat":"power","of":{"ref":"target","id":"t0"}}
          }
        ]
      }
    }
  ]
}
```

CR 608.2h: both "its" read the creature as it last existed on the battlefield (last known information) after the move. If the creature was an illegal target on resolution the spell does not resolve at all (CR 608.2b) and nobody gains life.

#### Wrath of God

> Destroy all creatures. They can't be regenerated.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "spell",
      "text": "Destroy all creatures. They can't be regenerated.",
      "effect": {
        "targets": [],
        "steps": [{"op":"destroy","what":{"ref":"each","filter":{"types":["Creature"]}},"regeneration":"cant"}]
      }
    }
  ]
}
```

The second sentence is a rider folded into the first step (`regeneration: "cant"`), so the interpreter never reads ahead (CR 608.2c).

#### Raise the Alarm

> Create two 1/1 white Soldier creature tokens.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "spell",
      "text": "Create two 1/1 white Soldier creature tokens.",
      "effect": {
        "targets": [],
        "steps": [
          {
            "op": "createToken",
            "who": {"ref":"you"},
            "count": 2,
            "token": {"name":"Soldier","colors":["W"],"types":["Creature"],"subtypes":["Soldier"],"power":1,"toughness":1}
          }
        ]
      }
    }
  ]
}
```

Tokens: inline `TokenDef`; the controller (`who`) is named. The engine builds a token CardDef with `Game.addDef` (frozen, shared).

#### Think Twice

> Draw a card.
>
> Flashback {2}{U}

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "spell",
      "text": "Draw a card.",
      "effect": {"targets":[],"steps":[{"op":"draw","who":{"ref":"you"},"count":1}]}
    },
    {
      "kind": "keyword",
      "text": "Flashback {2}{U}",
      "keyword": "flashback",
      "cost": {"mana":[{"kind":"generic","amount":2},{"kind":"colored","color":"U"}]}
    }
  ]
}
```

Flashback stays a `keyword` ability; its alternative cost and the exile replacement come from the keyword library (M5: native exile in core/resolve.ts, data form from M6).

#### Rabid Bite

> Target creature you control deals damage equal to its power to target creature you don't control.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "spell",
      "text": "Target creature you control deals damage equal to its power to target creature you don't control.",
      "effect": {
        "targets": [
          {
            "id": "t0",
            "kind": "object",
            "min": 1,
            "max": 1,
            "text": "target creature you control",
            "filter": {"types":["Creature"],"controller":"you"}
          },
          {
            "id": "t1",
            "kind": "object",
            "min": 1,
            "max": 1,
            "text": "target creature you don't control",
            "filter": {"types":["Creature"],"not":{"controller":"you"}}
          }
        ],
        "steps": [
          {
            "op": "damage",
            "source": {"ref":"target","id":"t0"},
            "to": {"ref":"target","id":"t1"},
            "amount": {"q":"stat","stat":"power","of":{"ref":"target","id":"t0"}}
          }
        ]
      }
    }
  ]
}
```

`source` is a TARGET, not the spell (it is required in the type, so a parser cannot default it to `self`). "you don't control" is `not:{controller:you}`, "an opponent controls" is `controller: "opponent"` (they differ in team games).

#### Path to Exile

> Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "spell",
      "text": "Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.",
      "effect": {
        "targets": [{"id":"t0","kind":"object","min":1,"max":1,"text":"target creature","filter":{"types":["Creature"]}}],
        "steps": [
          {"op":"move","what":{"ref":"target","id":"t0"},"to":{"zone":"exile"}},
          {
            "op": "may",
            "who": {"ref":"controllerOf","object":{"ref":"target","id":"t0"}},
            "do": [
              {
                "op": "search",
                "who": {"ref":"controllerOf","object":{"ref":"target","id":"t0"}},
                "zone": "library",
                "filter": {"zone":"library","types":["Land"],"supertypes":["Basic"]},
                "max": 1,
                "as": "land"
              },
              {
                "op": "move",
                "what": {"ref":"bound","name":"land"},
                "to": {
                  "zone": "battlefield",
                  "controller": {"ref":"controllerOf","object":{"ref":"target","id":"t0"}},
                  "tapped": true
                }
              },
              {"op":"shuffle","who":{"ref":"controllerOf","object":{"ref":"target","id":"t0"}}}
            ]
          }
        ]
      }
    }
  ]
}
```

Every actor is explicit: `may.who`, `search.who` and the battlefield `controller` are the exiled creature's controller (CR 110.2), not "you". A missing `who` would be a compile error.

#### Magma Spray

> Magma Spray deals 2 damage to target creature. If that creature would die this turn, exile it instead.

Classification: **partial**.

```json
{
  "abilities": [
    {
      "kind": "spell",
      "text": "~ deals 2 damage to target creature. If that creature would die this turn, exile it instead.",
      "effect": {
        "targets": [{"id":"t0","kind":"object","min":1,"max":1,"text":"target creature","filter":{"types":["Creature"]}}],
        "steps": [
          {"op":"damage","source":{"ref":"self"},"to":{"ref":"target","id":"t0"},"amount":2},
          {
            "op": "manual",
            "text": "If that creature would die this turn, exile it instead.",
            "reason": "replacement effect (needs milestone 6)",
            "reminder": {"d":"endOfTurn"}
          }
        ]
      }
    }
  ]
}
```

M5: the damage is automated; the one-shot replacement is a `manual` step with `reminder` (a chip stays until end of turn, because a prompt during resolution cannot intercept a death that happens later in state-based actions). M6 form: an `effect` step whose StaticEffect is a shielded `ReplacementDef` (see the M6 example in section 14). Contagion: the manual sentence contains "would" and "instead", so no earlier state-changing step may stay automated unless the parser can prove it is independent (damage is not modified by the sentence: it is kept).

#### Pact of Negation

> Counter target spell.
>
> At the beginning of your next upkeep, pay {3}{U}{U}. If you don't, you lose the game.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "spell",
      "text": "Counter target spell. At the beginning of your next upkeep, pay {3}{U}{U}. If you don't, you lose the game.",
      "effect": {
        "targets": [{"id":"t0","kind":"spell","min":1,"max":1,"text":"target spell"}],
        "steps": [
          {"op":"counter","what":{"ref":"target","id":"t0"}},
          {
            "op": "delay",
            "when": {"at":"step","step":"upkeep","whose":"you","next":true},
            "do": [
              {
                "op": "pay",
                "who": {"ref":"you"},
                "cost": {"mana":[{"kind":"generic","amount":3},{"kind":"colored","color":"U"},{"kind":"colored","color":"U"}]},
                "else": [{"op":"loseGame","who":{"ref":"you"}}]
              }
            ]
          }
        ]
      }
    }
  ]
}
```

A delayed trigger (CR 603.7) created by the spell; `pay` with an `else` branch (CR 118.12).


### 13.2 Mana, keywords, Auras, Equipment, planeswalkers

#### Llanowar Elves

> {T}: Add {G}.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "activated",
      "text": "{T}: Add {G}.",
      "cost": {"tap":true},
      "isMana": true,
      "effect": {"targets":[],"steps":[{"op":"addMana","who":{"ref":"you"},"units":[["G"]]}]}
    }
  ]
}
```

`units` is the exact shape milestone 3 already runs (`rules/mana-text.ts` keeps working). A mana ability does not use the stack (CR 605.3b).

#### Serra Angel

> Flying
>
> Vigilance

Classification: **full**.

```json
{
  "abilities": [{"kind":"keyword","text":"Flying","keyword":"flying"},{"kind":"keyword","text":"Vigilance","keyword":"vigilance"}]
}
```

Flag/hook keywords: nothing is expanded; `canBeBlocked` and `attackTaps` hooks read the keyword through characteristics.

#### Vampire Nighthawk

> Flying
>
> Deathtouch
>
> Lifelink

Classification: **full**.

```json
{
  "abilities": [
    {"kind":"keyword","text":"Flying","keyword":"flying"},
    {"kind":"keyword","text":"Deathtouch","keyword":"deathtouch"},
    {"kind":"keyword","text":"Lifelink","keyword":"lifelink"}
  ]
}
```

Three keyword abilities, three hooks (`canBeBlocked`, `assignCombatDamage`/`onDamageDealt`); several instances of redundant keywords are harmless (CR 702.9b).

#### Rancor

> Enchant creature
>
> Enchanted creature gets +2/+0 and has trample.
>
> When this Aura is put into a graveyard from the battlefield, return it to its owner's hand.

Classification: **full**.

```json
{
  "abilities": [
    {"kind":"keyword","text":"Enchant creature","keyword":"enchant","filter":{"types":["Creature"]}},
    {
      "kind": "static",
      "text": "Enchanted creature gets +2/+0 and has trample.",
      "effects": [
        {
          "s": "continuous",
          "affects": {"ref":"attachedTo"},
          "mods": [
            {"layer":6,"add":[{"kind":"keyword","text":"Trample","keyword":"trample"}]},
            {"layer":"7c","power":2,"toughness":0}
          ]
        }
      ]
    },
    {
      "kind": "triggered",
      "text": "When ~ is put into a graveyard from the battlefield, return it to its owner's hand.",
      "trigger": {"on":[{"ev":"zoneChange","subject":{"self":true},"from":"battlefield","to":"graveyard"}]},
      "effect": {"targets":[],"steps":[{"op":"move","what":{"ref":"event","role":"subject"},"to":{"zone":"hand"}}]}
    }
  ]
}
```

One sentence, two layers (6 and 7c) of one effect, the same affected set in both (CR 613.6). The trigger looks back (CR 603.10a) and finds the new object in the graveyard (CR 400.7e): `event.subject`.

#### Bonesplitter

> Equipped creature gets +2/+0.
>
> Equip {1}

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "static",
      "text": "Equipped creature gets +2/+0.",
      "effects": [{"s":"continuous","affects":{"ref":"attachedTo"},"mods":[{"layer":"7c","power":2,"toughness":0}]}]
    },
    {"kind":"keyword","text":"Equip {1}","keyword":"equip","cost":{"mana":[{"kind":"generic","amount":1}]}}
  ]
}
```

Equip is a keyword; its expansion (data, `keywords/data/equip.json`) is a sorcery-speed activated ability with one target.

#### Sword of Fire and Ice

> Equipped creature gets +2/+2 and has protection from red and from blue.
>
> Whenever equipped creature deals combat damage to a player, this Equipment deals 2 damage to any target and you draw a card.
>
> Equip {2}

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "static",
      "text": "Equipped creature gets +2/+2 and has protection from red and from blue.",
      "effects": [
        {
          "s": "continuous",
          "affects": {"ref":"attachedTo"},
          "mods": [
            {
              "layer": 6,
              "add": [
                {"kind":"keyword","text":"Protection from red","keyword":"protection","quality":"color:R"},
                {"kind":"keyword","text":"Protection from blue","keyword":"protection","quality":"color:U"}
              ]
            },
            {"layer":"7c","power":2,"toughness":2}
          ]
        }
      ]
    },
    {
      "kind": "triggered",
      "text": "Whenever equipped creature deals combat damage to a player, ~ deals 2 damage to any target and you draw a card.",
      "trigger": {"on":[{"ev":"damage","source":{"attachedToSource":true},"recipient":{"player":"any"},"combat":true}]},
      "effect": {
        "targets": [{"id":"t0","kind":"anyTarget","min":1,"max":1,"text":"any target"}],
        "steps": [
          {"op":"damage","source":{"ref":"self"},"to":{"ref":"target","id":"t0"},"amount":2},
          {"op":"draw","who":{"ref":"you"},"count":1}
        ]
      }
    },
    {"kind":"keyword","text":"Equip {2}","keyword":"equip","cost":{"mana":[{"kind":"generic","amount":2}]}}
  ]
}
```

Protection uses the canonical quality string of rules/quality.ts (milestone 4). The trigger subject is "the creature this Equipment is attached to": `attachedToSource`.

#### Jace Beleren

> +2: Each player draws a card.
>
> -1: Target player draws a card.
>
> -10: Target player mills twenty cards.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "activated",
      "text": "+2: Each player draws a card.",
      "isLoyalty": true,
      "cost": {"loyalty":2},
      "effect": {"targets":[],"steps":[{"op":"draw","who":{"ref":"each","who":"player"},"count":1}]}
    },
    {
      "kind": "activated",
      "text": "-1: Target player draws a card.",
      "isLoyalty": true,
      "cost": {"loyalty":-1},
      "effect": {
        "targets": [{"id":"t0","kind":"player","min":1,"max":1,"text":"target player"}],
        "steps": [{"op":"draw","who":{"ref":"target","id":"t0"},"count":1}]
      }
    },
    {
      "kind": "activated",
      "text": "-10: Target player mills twenty cards.",
      "isLoyalty": true,
      "cost": {"loyalty":-10},
      "effect": {
        "targets": [{"id":"t0","kind":"player","min":1,"max":1,"text":"target player"}],
        "steps": [{"op":"mill","who":{"ref":"target","id":"t0"},"count":20}]
      }
    }
  ]
}
```

Loyalty abilities are activated abilities with `isLoyalty` and a loyalty cost (CR 606).

#### Oko, Thief of Crowns

> +2: Create a Food token.
>
> +1: Target artifact or creature loses all abilities and becomes a green Elk creature with base power and toughness 3/3.
>
> -5: Exchange control of target artifact or creature you control and target creature an opponent controls with power 3 or less.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "activated",
      "text": "+2: Create a Food token.",
      "isLoyalty": true,
      "cost": {"loyalty":2},
      "effect": {"targets":[],"steps":[{"op":"createToken","who":{"ref":"you"},"count":1,"token":{"predefined":"Food"}}]}
    },
    {
      "kind": "activated",
      "text": "+1: Target artifact or creature loses all abilities and becomes a green Elk creature with base power and toughness 3/3.",
      "isLoyalty": true,
      "cost": {"loyalty":1},
      "effect": {
        "targets": [
          {
            "id": "t0",
            "kind": "object",
            "min": 1,
            "max": 1,
            "text": "target artifact or creature",
            "filter": {"types":["Artifact","Creature"]}
          }
        ],
        "steps": [
          {
            "op": "effect",
            "duration": {"d":"permanent"},
            "effects": [
              {
                "s": "continuous",
                "affects": {"ref":"target","id":"t0"},
                "mods": [
                  {"layer":4,"types":{"set":["Creature"]},"subtypes":{"set":["Elk"]}},
                  {"layer":5,"colors":{"set":["G"]}},
                  {"layer":6,"removeAll":true},
                  {"layer":"7b","power":3,"toughness":3}
                ]
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "activated",
      "text": "-5: Exchange control of target artifact or creature you control and target creature an opponent controls with power 3 or less.",
      "isLoyalty": true,
      "cost": {"loyalty":-5},
      "effect": {
        "targets": [
          {
            "id": "t0",
            "kind": "object",
            "min": 1,
            "max": 1,
            "text": "target artifact or creature you control",
            "filter": {"types":["Artifact","Creature"],"controller":"you"}
          },
          {
            "id": "t1",
            "kind": "object",
            "min": 1,
            "max": 1,
            "text": "target creature an opponent controls with power 3 or less",
            "filter": {"types":["Creature"],"controller":"opponent","power":{"op":"<=","value":3}}
          }
        ],
        "steps": [{"op":"exchange","a":{"ref":"target","id":"t0"},"b":{"ref":"target","id":"t1"},"what":"control"}]
      }
    }
  ]
}
```

The +1 is one resolved effect spanning layers 4, 5, 6 and 7b with a locked set and no duration (CR 611.2a, 611.2c); "becomes a creature" with subtypes `set` (CR 305.7) replaces creature types. The -5 is the `exchange` op (CR 701.12).

#### Mutavault

> {T}: Add {C}.
>
> {1}: This land becomes a 2/2 creature with all creature types until end of turn. It's still a land.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "activated",
      "text": "{T}: Add {C}.",
      "cost": {"tap":true},
      "isMana": true,
      "effect": {"targets":[],"steps":[{"op":"addMana","who":{"ref":"you"},"units":[["C"]]}]}
    },
    {
      "kind": "activated",
      "text": "{1}: ~ becomes a 2/2 creature with all creature types until end of turn. It's still a land.",
      "cost": {"mana":[{"kind":"generic","amount":1}]},
      "effect": {
        "targets": [],
        "steps": [
          {
            "op": "effect",
            "duration": {"d":"endOfTurn"},
            "effects": [
              {
                "s": "continuous",
                "affects": {"ref":"self"},
                "mods": [
                  {"layer":4,"types":{"add":["Creature"]},"subtypes":{"all":true}},
                  {"layer":"7b","power":2,"toughness":2}
                ]
              }
            ]
          }
        ]
      }
    }
  ]
}
```

The rider "It's still a land" decides `types.add` (not `set`). If the rider had no template, the taint rule (design 6.7) would make the whole second ability one manual step: the permanent must never stop being a land because the first sentence parsed and the second did not.


### 13.3 Triggers and linked abilities

#### Blood Artist

> Whenever this creature or another creature dies, target player loses 1 life and you gain 1 life.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "triggered",
      "text": "Whenever ~ or another creature dies, target player loses 1 life and you gain 1 life.",
      "trigger": {"on":[{"ev":"zoneChange","subject":{"types":["Creature"]},"from":"battlefield","to":"graveyard"}]},
      "effect": {
        "targets": [{"id":"t0","kind":"player","min":1,"max":1,"text":"target player"}],
        "steps": [
          {"op":"loseLife","who":{"ref":"target","id":"t0"},"amount":1},
          {"op":"gainLife","who":{"ref":"you"},"amount":1}
        ]
      }
    }
  ]
}
```

The subject is "a creature": it includes Blood Artist itself, which triggers by looking back in time (CR 603.10a).

#### Flametongue Kavu

> When this creature enters, it deals 4 damage to target creature.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "triggered",
      "text": "When ~ enters, it deals 4 damage to target creature.",
      "trigger": {"on":[{"ev":"zoneChange","subject":{"self":true},"to":"battlefield"}]},
      "effect": {
        "targets": [{"id":"t0","kind":"object","min":1,"max":1,"text":"target creature","filter":{"types":["Creature"]}}],
        "steps": [{"op":"damage","source":{"ref":"self"},"to":{"ref":"target","id":"t0"},"amount":4}]
      }
    }
  ]
}
```

#### Fiend Hunter

> When this creature enters, you may exile another target creature.
>
> When this creature leaves the battlefield, return the exiled card to the battlefield under its owner's control.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "triggered",
      "text": "When ~ enters, you may exile another target creature.",
      "trigger": {"on":[{"ev":"zoneChange","subject":{"self":true},"to":"battlefield"}]},
      "effect": {
        "targets": [
          {
            "id": "t0",
            "kind": "object",
            "min": 1,
            "max": 1,
            "text": "another target creature",
            "filter": {"types":["Creature"],"other":true}
          }
        ],
        "steps": [
          {
            "op": "may",
            "who": {"ref":"you"},
            "do": [{"op":"move","what":{"ref":"target","id":"t0"},"to":{"zone":"exile"},"link":"exiled"}]
          }
        ]
      }
    },
    {
      "kind": "triggered",
      "text": "When ~ leaves the battlefield, return the exiled card to the battlefield under its owner's control.",
      "trigger": {"on":[{"ev":"zoneChange","subject":{"self":true},"from":"battlefield"}]},
      "effect": {
        "targets": [],
        "steps": [{"op":"move","what":{"ref":"linked","link":"exiled"},"to":{"zone":"battlefield","controller":"owner"}}]
      }
    }
  ]
}
```

Linked abilities (CR 607.2a): the first stores what it exiled under link `exiled` on THIS object instance; the second reads only that store, from the last known information of the departed source (the snapshot carries `links`). If the leaves ability resolves first, nothing is linked yet and nothing returns (the famous race).

#### Paradise Plume

> As this artifact enters, choose a color.
>
> Whenever a player casts a spell of the chosen color, you may gain 1 life.
>
> {T}: Add one mana of the chosen color.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "static",
      "text": "As ~ enters, choose a color.",
      "effects": [
        {
          "s": "replace",
          "replaces": {"ev":"zoneChange","subject":{"self":true},"to":"battlefield"},
          "body": {"b":"enters","choose":[{"what":"color","link":"color"}]}
        }
      ],
      "zone": ["stack","battlefield"]
    },
    {
      "kind": "triggered",
      "text": "Whenever a player casts a spell of the chosen color, you may gain 1 life.",
      "trigger": {"on":[{"ev":"cast","player":"any","spell":{"stackKind":"spell","chosen":{"link":"color","quality":"color"}}}]},
      "effect": {
        "targets": [],
        "steps": [{"op":"may","who":{"ref":"you"},"do":[{"op":"gainLife","who":{"ref":"you"},"amount":1}]}]
      }
    },
    {
      "kind": "activated",
      "text": "{T}: Add one mana of the chosen color.",
      "cost": {"tap":true},
      "isMana": true,
      "effect": {
        "targets": [],
        "steps": [{"op":"addMana","who":{"ref":"you"},"dynamic":{"kind":"chosen","link":"color","count":1}}]
      }
    }
  ]
}
```

CR 607.4: the first ability is linked to both others through the link id `color`.

#### Rhystic Study

> Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "triggered",
      "text": "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.",
      "trigger": {"on":[{"ev":"cast","player":"opponent"}]},
      "effect": {
        "targets": [],
        "steps": [
          {
            "op": "pay",
            "who": {"ref":"event","role":"player"},
            "cost": {"mana":[{"kind":"generic","amount":1}]},
            "else": [{"op":"may","who":{"ref":"you"},"do":[{"op":"draw","who":{"ref":"you"},"count":1}]}]
          }
        ]
      }
    }
  ]
}
```

CR 118.12a: the PAYER decides first (the `pay` op), and only if they decline does the controller get the `may`. The nesting order is pinned by a scenario test; the wrapper template composes `pay` OUTSIDE `may` for every "you may ... unless" card.

#### Smothering Tithe

> Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "triggered",
      "text": "Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token.",
      "trigger": {"on":[{"ev":"draw","player":"opponent"}]},
      "effect": {
        "targets": [],
        "steps": [
          {
            "op": "pay",
            "who": {"ref":"event","role":"player"},
            "cost": {"mana":[{"kind":"generic","amount":2}]},
            "else": [{"op":"createToken","who":{"ref":"you"},"count":1,"token":{"predefined":"Treasure"}}]
          }
        ]
      }
    }
  ]
}
```

CR 118.12 gives the two-sentence wording and the "unless" wording the same meaning, so both parse to the same `pay` node. Treasure is a predefined token (CR 111.10).

#### Mana Vault

> This artifact doesn't untap during your untap step.
>
> At the beginning of your upkeep, you may pay {4}. If you do, untap this artifact.
>
> At the beginning of your draw step, if this artifact is tapped, it deals 1 damage to you.
>
> {T}: Add {C}{C}{C}.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "static",
      "text": "~ doesn't untap during your untap step.",
      "effects": [{"s":"restrict","subject":{"ref":"self"},"mode":"cant","action":"untapDuringUntapStep"}]
    },
    {
      "kind": "triggered",
      "text": "At the beginning of your upkeep, you may pay {4}. If you do, untap ~.",
      "trigger": {"on":[{"ev":"step","step":"upkeep","whose":"you"}]},
      "effect": {
        "targets": [],
        "steps": [
          {
            "op": "pay",
            "who": {"ref":"you"},
            "cost": {"mana":[{"kind":"generic","amount":4}]},
            "then": [{"op":"untap","what":{"ref":"self"}}]
          }
        ]
      }
    },
    {
      "kind": "triggered",
      "text": "At the beginning of your draw step, if ~ is tapped, it deals 1 damage to you.",
      "trigger": {"on":[{"ev":"step","step":"draw","whose":"you"}]},
      "interveningIf": {"cond":"matches","object":{"ref":"self"},"filter":{"tapped":true}},
      "effect": {"targets":[],"steps":[{"op":"damage","source":{"ref":"self"},"to":{"ref":"you"},"amount":1}]}
    },
    {
      "kind": "activated",
      "text": "{T}: Add {C}{C}{C}.",
      "cost": {"tap":true},
      "isMana": true,
      "effect": {"targets":[],"steps":[{"op":"addMana","who":{"ref":"you"},"units":[["C"],["C"],["C"]]}]}
    }
  ]
}
```

"You may pay. If you do" is `pay.then`. An intervening "if" (CR 603.4) is checked when the trigger event happens and again on resolution.

#### Sneak Attack

> {R}: You may put a creature card from your hand onto the battlefield. That creature gains haste. Sacrifice the creature at the beginning of the next end step.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "activated",
      "text": "{R}: You may put a creature card from your hand onto the battlefield. That creature gains haste. Sacrifice the creature at the beginning of the next end step.",
      "cost": {"mana":[{"kind":"colored","color":"R"}]},
      "effect": {
        "targets": [],
        "steps": [
          {
            "op": "chooseObjects",
            "who": {"ref":"you"},
            "from": {"ref":"each","filter":{"zone":"hand","owner":"you","types":["Creature"]}},
            "min": 0,
            "max": 1,
            "as": "c"
          },
          {"op":"move","what":{"ref":"bound","name":"c"},"to":{"zone":"battlefield","controller":{"ref":"you"}}},
          {
            "op": "effect",
            "guard": {"cond":"did","step":"c"},
            "duration": {"d":"permanent"},
            "effects": [
              {
                "s": "continuous",
                "affects": {"ref":"bound","name":"c"},
                "mods": [{"layer":6,"add":[{"kind":"keyword","text":"Haste","keyword":"haste"}]}]
              }
            ]
          },
          {
            "op": "delay",
            "guard": {"cond":"did","step":"c"},
            "when": {"at":"step","step":"end","next":true},
            "capture": ["c"],
            "do": [{"op":"sacrifice","what":{"ref":"bound","name":"c"}}]
          }
        ]
      }
    }
  ]
}
```

Anaphora is resolved at compile time ("that creature", "the creature" both become the name `c`). The `move` re-bases `c` onto the new battlefield object (CR 400.7j: the destination is a public zone). The delayed trigger captures `c` with the zone it is expected in (CR 603.7c). `guard: did c` skips the rest when the player chose no card.

#### Panharmonicon

> If an artifact or creature entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "static",
      "text": "If an artifact or creature entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.",
      "effects": [
        {
          "s": "triggerMod",
          "cause": {"ev":"zoneChange","subject":{"types":["Artifact","Creature"]},"to":"battlefield"},
          "abilitiesOf": {"controller":"you"},
          "additional": 1
        }
      ]
    }
  ]
}
```

CR 603.2d. Not a replacement effect: the trigger collector counts it. It never applies to delayed/reflexive triggers or to itself.

#### History of Benalia

> I, II -- Create a 2/2 white Knight creature token with vigilance.
>
> III -- Knights you control get +2/+1 until end of turn.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "chapter",
      "text": "I, II -- Create a 2/2 white Knight creature token with vigilance.",
      "chapters": [1,2],
      "effect": {
        "targets": [],
        "steps": [
          {
            "op": "createToken",
            "who": {"ref":"you"},
            "count": 1,
            "token": {
              "name": "Knight",
              "colors": ["W"],
              "types": ["Creature"],
              "subtypes": ["Knight"],
              "power": 2,
              "toughness": 2,
              "keywords": ["vigilance"]
            }
          }
        ]
      }
    },
    {
      "kind": "chapter",
      "text": "III -- Knights you control get +2/+1 until end of turn.",
      "chapters": [3],
      "effect": {
        "targets": [],
        "steps": [
          {
            "op": "effect",
            "duration": {"d":"endOfTurn"},
            "effects": [
              {
                "s": "continuous",
                "affects": {"ref":"each","filter":{"subtypes":["Knight"],"controller":"you"}},
                "mods": [{"layer":"7c","power":2,"toughness":1}]
              }
            ]
          }
        ]
      }
    }
  ]
}
```

Saga chapters (CR 714): a structural ability kind; lore counters and the sacrifice after the last chapter (SBA 704.5s) are rules code.


### 13.4 Modes, X, division, kicker, split cards

#### Cryptic Command

> Choose two --
>
> * Counter target spell.
>
> * Return target permanent to its owner's hand.
>
> * Tap all creatures your opponents control.
>
> * Draw a card.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "spell",
      "text": "Choose two -- Counter target spell. / Return target permanent to its owner's hand. / Tap all creatures your opponents control. / Draw a card.",
      "effect": {
        "targets": [],
        "modes": {
          "min": 2,
          "max": 2,
          "options": [
            {
              "text": "Counter target spell.",
              "program": {
                "targets": [{"id":"t0","kind":"spell","min":1,"max":1,"text":"target spell"}],
                "steps": [{"op":"counter","what":{"ref":"target","id":"t0"}}]
              }
            },
            {
              "text": "Return target permanent to its owner's hand.",
              "program": {
                "targets": [{"id":"t1","kind":"object","min":1,"max":1,"text":"target permanent","filter":{}}],
                "steps": [{"op":"move","what":{"ref":"target","id":"t1"},"to":{"zone":"hand"}}]
              }
            },
            {
              "text": "Tap all creatures your opponents control.",
              "program": {
                "targets": [],
                "steps": [{"op":"tap","what":{"ref":"each","filter":{"types":["Creature"],"controller":"opponent"}}}]
              }
            },
            {"text":"Draw a card.","program":{"targets":[],"steps":[{"op":"draw","who":{"ref":"you"},"count":1}]}}
          ]
        },
        "steps": []
      }
    }
  ]
}
```

Target ids are numbered across ALL modes (t0 for the first mode, t1 for the second). CR 608.2b is decided ONCE over the targets of the modes actually chosen: if the countered spell is gone but the permanent is still legal, the bounce still happens and the spell is not removed from the stack.

#### Fireball

> This spell costs {1} more to cast for each target beyond the first.
>
> Fireball deals X damage divided evenly, rounded down, among any number of targets.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "static",
      "text": "This spell costs {1} more to cast for each target beyond the first.",
      "zone": ["stack"],
      "effects": [
        {
          "s": "costMod",
          "applies": {"self":true,"caster":"you"},
          "change": {
            "kind": "increase",
            "generic": {"q":"math","op":"max","args":[0,{"q":"math","op":"-","args":[{"q":"spellTargetCount"},1]}]}
          }
        }
      ]
    },
    {
      "kind": "spell",
      "text": "~ deals X damage divided evenly, rounded down, among any number of targets.",
      "effect": {
        "targets": [{"id":"t0","kind":"anyTarget","min":0,"max":"any","text":"any number of targets"}],
        "steps": [
          {
            "op": "damage",
            "source": {"ref":"self"},
            "to": {"ref":"target","id":"t0"},
            "amount": {"q":"X"},
            "divided": "evenlyRoundDown"
          }
        ]
      }
    }
  ]
}
```

A self cost modifier that functions on the stack and reads the number of targets of the spell it is on (`spellTargetCount`; known after targets are chosen, CR 601.2c, 601.2f). It cannot name a target id: ids belong to one ability and this static is a different ability of the card. "Divided evenly" is computed on resolution among the announced targets (pinned ruling, section 15.3).

#### Kavu Titan

> Kicker {2}{G}
>
> If this creature was kicked, it enters with three +1/+1 counters on it and with trample.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "keyword",
      "text": "Kicker {2}{G}",
      "keyword": "kicker",
      "cost": {"mana":[{"kind":"generic","amount":2},{"kind":"colored","color":"G"}]}
    },
    {
      "kind": "static",
      "text": "If ~ was kicked, it enters with three +1/+1 counters on it and with trample.",
      "condition": {"cond":"wasCast","kicked":true},
      "effects": [
        {
          "s": "replace",
          "replaces": {"ev":"zoneChange","subject":{"self":true},"to":"battlefield"},
          "body": {"b":"enters","counters":[{"kind":"+1/+1","count":3}]}
        },
        {
          "s": "continuous",
          "affects": {"ref":"self"},
          "mods": [{"layer":6,"add":[{"kind":"keyword","text":"Trample","keyword":"trample"}]}]
        }
      ]
    }
  ]
}
```

One printed sentence, two effects: an enters replacement (CR 614.1c) and a conditional layer-6 grant. Both read the cast record of the spell that became this permanent (CR 400.7d, 607.2i): `GameObject.cast`. A self `enters` replacement is consulted from the entering object itself whatever its `zone` (CR 614.12).

#### Fire // Ice

> Fire: Fire deals 2 damage divided as you choose among one or two targets.
>
> Ice: Tap target permanent. Draw a card.

Classification: **full**.

```json
{
  "faces": [
    {
      "name": "Fire",
      "abilities": [
        {
          "kind": "spell",
          "text": "~ deals 2 damage divided as you choose among one or two targets.",
          "effect": {
            "targets": [
              {
                "id": "t0",
                "kind": "anyTarget",
                "min": 1,
                "max": 2,
                "text": "one or two targets",
                "divide": {"what":"damage","total":2}
              }
            ],
            "steps": [{"op":"damage","source":{"ref":"self"},"to":{"ref":"target","id":"t0"},"amount":2,"divided":"announced"}]
          }
        }
      ]
    },
    {
      "name": "Ice",
      "abilities": [
        {
          "kind": "spell",
          "text": "Tap target permanent. Draw a card.",
          "effect": {
            "targets": [{"id":"t0","kind":"object","min":1,"max":1,"text":"target permanent","filter":{}}],
            "steps": [{"op":"tap","what":{"ref":"target","id":"t0"}},{"op":"draw","who":{"ref":"you"},"count":1}]
          }
        }
      ]
    }
  ]
}
```

Split card: one `faces[]` entry per half (CR 709). "Divided as you choose" is announced at casting (CR 601.2d): `TargetSpec.divide` and `damage.divided: "announced"`.


### 13.5 Static abilities and layers

#### Glorious Anthem

> Creatures you control get +1/+1.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "static",
      "text": "Creatures you control get +1/+1.",
      "effects": [
        {
          "s": "continuous",
          "affects": {"ref":"each","filter":{"types":["Creature"],"controller":"you"}},
          "mods": [{"layer":"7c","power":1,"toughness":1}]
        }
      ]
    }
  ]
}
```

A static ability is live (CR 611.3a): its affected set is re-evaluated at every computation, unlike a resolved effect (CR 611.2c).

#### Humility

> All creatures lose all abilities and have base power and toughness 1/1.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "static",
      "text": "All creatures lose all abilities and have base power and toughness 1/1.",
      "effects": [
        {
          "s": "continuous",
          "affects": {"ref":"each","filter":{"types":["Creature"]}},
          "mods": [{"layer":6,"removeAll":true},{"layer":"7b","power":1,"toughness":1}]
        }
      ]
    }
  ]
}
```

One sentence, two layers (CR 613.6): the ability removal (layer 6) and the base P/T (layer 7b) apply to the same set even though Humility itself loses its abilities in layer 6.

#### Opalescence

> Each other non-Aura enchantment is a creature in addition to its other types and has base power and base toughness each equal to its mana value.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "static",
      "text": "Each other non-Aura enchantment is a creature in addition to its other types and has base power and base toughness each equal to its mana value.",
      "effects": [
        {
          "s": "continuous",
          "affects": {"ref":"each","filter":{"types":["Enchantment"],"notSubtypes":["Aura"],"other":true}},
          "mods": [
            {"layer":4,"types":{"add":["Creature"]}},
            {
              "layer": "7b",
              "power": {"q":"stat","stat":"manaValue","of":{"ref":"subject"}},
              "toughness": {"q":"stat","stat":"manaValue","of":{"ref":"subject"}}
            }
          ]
        }
      ]
    }
  ]
}
```

`{ref:"subject"}` is the object currently being modified. Humility + Opalescence resolve by timestamp inside layer 7b (no CR 613.8 dependency between them); the layer-4 effect makes Humility a creature, so Humility's layers 6/7b then apply to Opalescence too.

#### Thalia, Guardian of Thraben

> First strike
>
> Noncreature spells cost {1} more to cast.

Classification: **full**.

```json
{
  "abilities": [
    {"kind":"keyword","text":"First strike","keyword":"first strike"},
    {
      "kind": "static",
      "text": "Noncreature spells cost {1} more to cast.",
      "zone": ["battlefield"],
      "effects": [
        {
          "s": "costMod",
          "applies": {"spells":{"zone":"stack","notTypes":["Creature"]},"caster":"any"},
          "change": {"kind":"increase","generic":1}
        }
      ]
    }
  ]
}
```

`applies.caster` is required: here every player ("any"), not "you".

#### Death-Rattle Oni

> Flash
>
> This spell costs {2} less to cast for each creature that died this turn.
>
> When this creature enters, destroy all other creatures that were dealt damage this turn.

Classification: **full**.

```json
{
  "abilities": [
    {"kind":"keyword","text":"Flash","keyword":"flash"},
    {
      "kind": "static",
      "text": "This spell costs {2} less to cast for each creature that died this turn.",
      "zone": ["stack"],
      "effects": [
        {
          "s": "costMod",
          "applies": {"self":true,"caster":"you"},
          "change": {
            "kind": "reduce",
            "generic": {
              "q": "math",
              "op": "*",
              "args": [
                2,
                {
                  "q": "happenedCount",
                  "event": {"ev":"zoneChange","subject":{"types":["Creature"]},"from":"battlefield","to":"graveyard"},
                  "scope": "turn"
                }
              ]
            },
            "floor": "zero"
          }
        }
      ]
    },
    {
      "kind": "triggered",
      "text": "When ~ enters, destroy all other creatures that were dealt damage this turn.",
      "trigger": {"on":[{"ev":"zoneChange","subject":{"self":true},"to":"battlefield"}]},
      "effect": {
        "targets": [],
        "steps": [
          {
            "op": "destroy",
            "what": {"ref":"each","filter":{"types":["Creature"],"other":true,"dealtDamageThisTurn":true}}
          }
        ]
      }
    }
  ]
}
```

History is a first-class filter field (`dealtDamageThisTurn`) and a first-class quantity (`happenedCount`). Neither can be "unsupported": a filter the engine cannot evaluate would make the step manual instead of destroying nothing.


### 13.6 Replacement effects

#### Doubling Season

> If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.
>
> If an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.

Classification: **full from milestone 6 (partial or manual in M5)**.

M6-1 (2026-10-13): both patterns carry `byEffect: true` ("if an EFFECT would", CR 614.16; m6 design 2.1), so counters the rules put are not doubled.

```json
{
  "abilities": [
    {
      "kind": "static",
      "text": "If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.",
      "effects": [{"s":"replace","replaces":{"ev":"createToken","player":"you","byEffect":true},"body":{"b":"modify","count":{"mul":2}}}]
    },
    {
      "kind": "static",
      "text": "If an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.",
      "effects": [
        {
          "s": "replace",
          "replaces": {"ev":"counters","change":"put","byEffect":true,"on":{"controller":"you"}},
          "body": {"b":"modify","count":{"mul":2}}
        }
      ]
    }
  ]
}
```

M5 ships the data model and the proposal-pipeline funnel; executing `replace` statics is milestone 6 (capability `static:replace`). Until then the card is `partial`: both lines are shown as "unenforced rule" chips.

#### Leyline of the Void

> If this card is in your opening hand, you may begin the game with it on the battlefield.
>
> If a card would be put into an opponent's graveyard from anywhere, exile it instead.

Classification: **full from milestone 6 (partial or manual in M5)**.

```json
{
  "abilities": [
    {
      "kind": "static",
      "text": "If ~ is in your opening hand, you may begin the game with it on the battlefield.",
      "zone": ["hand"],
      "effects": [{"s":"pregame","action":"beginOnBattlefield","optional":true}]
    },
    {
      "kind": "static",
      "text": "If a card would be put into an opponent's graveyard from anywhere, exile it instead.",
      "effects": [
        {
          "s": "replace",
          "replaces": {"ev":"zoneChange","subject":{"isCard":true,"owner":"opponent"},"to":"graveyard"},
          "body": {"b":"modify","destination":{"zone":"exile"}}
        }
      ]
    }
  ]
}
```

`isCard: true`: tokens are not cards (CR 111.1), so a token that dies is NOT exiled by Leyline (contrast Rest in Peace, "card or token"). `modify.destination` changes where the SAME event goes: triggers see one zone change to exile, not a graveyard entry.

#### Rest in Peace

> When this enchantment enters, exile all graveyards.
>
> If a card or token would be put into a graveyard from anywhere, exile it instead.

Classification: **full from milestone 6 (partial or manual in M5)**.

```json
{
  "abilities": [
    {
      "kind": "triggered",
      "text": "When ~ enters, exile all graveyards.",
      "trigger": {"on":[{"ev":"zoneChange","subject":{"self":true},"to":"battlefield"}]},
      "effect": {"targets":[],"steps":[{"op":"move","what":{"ref":"each","filter":{"zone":"graveyard"}},"to":{"zone":"exile"}}]}
    },
    {
      "kind": "static",
      "text": "If a card or token would be put into a graveyard from anywhere, exile it instead.",
      "effects": [
        {
          "s": "replace",
          "replaces": {"ev":"zoneChange","subject":{},"to":"graveyard"},
          "body": {"b":"modify","destination":{"zone":"exile"}}
        }
      ]
    }
  ]
}
```

Contrast with Leyline of the Void: no `isCard`, no `owner`. The enters trigger is automated in M5; the replacement waits for M6.

#### Clone

> You may have this creature enter as a copy of any creature on the battlefield.

Classification: **full from milestone 6 (partial or manual in M5)**.

```json
{
  "abilities": [
    {
      "kind": "static",
      "text": "You may have ~ enter as a copy of any creature on the battlefield.",
      "zone": ["stack","battlefield"],
      "effects": [
        {
          "s": "replace",
          "replaces": {"ev":"zoneChange","subject":{"self":true},"to":"battlefield"},
          "body": {"b":"enters","copy":{"of":{"types":["Creature"]},"optional":true}}
        }
      ]
    }
  ]
}
```

Copy effects are layer 1a (CR 613.2a); the `enters.copy` body is applied before the object exists on the battlefield, the choice made first (CR 614.12a, 616.1c).

#### Hallowed Fountain

> ({T}: Add {W} or {U}.)
>
> As this land enters, you may pay 2 life. If you don't, it enters tapped.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "static",
      "text": "As ~ enters, you may pay 2 life. If you don't, it enters tapped.",
      "zone": ["stack","battlefield"],
      "effects": [
        {
          "s": "replace",
          "replaces": {"ev":"zoneChange","subject":{"self":true},"to":"battlefield"},
          "body": {"b":"enters","tappedUnlessPay":{"other":[{"kind":"payLife","amount":2}]}}
        }
      ]
    }
  ]
}
```

Shock lands: `enters.tappedUnlessPay`. The intrinsic mana abilities come from the basic land types (CR 305.6), not from the JSON. Check lands use `tappedUnless: Condition`; pain lands are ordinary mana abilities with a damage step.

#### Glacial Fortress

> This land enters tapped unless you control a Plains or an Island.
>
> {T}: Add {W} or {U}.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "static",
      "text": "~ enters tapped unless you control a Plains or an Island.",
      "zone": ["stack","battlefield"],
      "effects": [
        {
          "s": "replace",
          "replaces": {"ev":"zoneChange","subject":{"self":true},"to":"battlefield"},
          "body": {
            "b": "enters",
            "tapped": true,
            "tappedUnless": {"cond":"exists","of":{"ref":"each","filter":{"subtypes":["Plains","Island"],"controller":"you"}}}
          }
        }
      ]
    },
    {
      "kind": "activated",
      "text": "{T}: Add {W} or {U}.",
      "cost": {"tap":true},
      "isMana": true,
      "effect": {"targets":[],"steps":[{"op":"addMana","who":{"ref":"you"},"units":[["W","U"]]}]}
    }
  ]
}
```

#### Cavern of Souls

> As this land enters, choose a creature type.
>
> {T}: Add {C}.
>
> {T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type, and that spell can't be countered.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "static",
      "text": "As ~ enters, choose a creature type.",
      "zone": ["stack","battlefield"],
      "effects": [
        {
          "s": "replace",
          "replaces": {"ev":"zoneChange","subject":{"self":true},"to":"battlefield"},
          "body": {"b":"enters","choose":[{"what":"creatureType","link":"type"}]}
        }
      ]
    },
    {
      "kind": "activated",
      "text": "{T}: Add {C}.",
      "cost": {"tap":true},
      "isMana": true,
      "effect": {"targets":[],"steps":[{"op":"addMana","who":{"ref":"you"},"units":[["C"]]}]}
    },
    {
      "kind": "activated",
      "text": "{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type, and that spell can't be countered.",
      "cost": {"tap":true},
      "isMana": true,
      "effect": {
        "targets": [],
        "steps": [
          {
            "op": "addMana",
            "who": {"ref":"you"},
            "units": [["W","U","B","R","G"]],
            "restriction": {
              "spells": {"types":["Creature"],"chosen":{"link":"type","quality":"creatureType"}},
              "spellRider": "cantBeCountered"
            }
          }
        ]
      }
    }
  ]
}
```

The spending restriction is STRUCTURED (`ManaRestriction`), so the payment code can enforce it. Restriction wording the engine cannot represent makes the `addMana` step manual instead of becoming an ignored string.


### 13.7 Cards, zones and manual cards

#### Fact or Fiction

> Reveal the top five cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other into your graveyard.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "spell",
      "text": "Reveal the top five cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other into your graveyard.",
      "effect": {
        "targets": [],
        "steps": [
          {"op":"reveal","who":{"ref":"you"},"what":{"ref":"topCards","player":{"ref":"you"},"count":5},"as":"cards"},
          {
            "op": "piles",
            "cards": {"ref":"bound","name":"cards"},
            "separator": {"ref":"anOpponent"},
            "chooser": {"ref":"you"},
            "chosen": "keep",
            "other": "rest"
          },
          {"op":"move","what":{"ref":"bound","name":"keep"},"to":{"zone":"hand"}},
          {"op":"move","what":{"ref":"bound","name":"rest"},"to":{"zone":"graveyard"}}
        ]
      }
    }
  ]
}
```

`piles` names the separator and the chooser; the two piles are bound as `keep` and `rest`.

#### Jace, the Mind Sculptor

> +2: Look at the top card of target player's library. You may put that card on the bottom of that player's library.
>
> 0: Draw three cards, then put two cards from your hand on top of your library in any order.
>
> -1: Return target creature to its owner's hand.
>
> -12: Exile all cards from target player's library, then that player shuffles their hand into their library.

Classification: **full**.

```json
{
  "abilities": [
    {
      "kind": "activated",
      "text": "+2: Look at the top card of target player's library. You may put that card on the bottom of that player's library.",
      "isLoyalty": true,
      "cost": {"loyalty":2},
      "effect": {
        "targets": [{"id":"t0","kind":"player","min":1,"max":1,"text":"target player"}],
        "steps": [
          {
            "op": "look",
            "who": {"ref":"you"},
            "at": {"ref":"topCards","player":{"ref":"target","id":"t0"},"count":1},
            "as": "top"
          },
          {
            "op": "may",
            "who": {"ref":"you"},
            "do": [
              {
                "op": "move",
                "what": {"ref":"bound","name":"top"},
                "to": {"zone":"library","owner":{"ref":"target","id":"t0"},"position":"bottom"}
              }
            ]
          }
        ]
      }
    },
    {
      "kind": "activated",
      "text": "0: Draw three cards, then put two cards from your hand on top of your library in any order.",
      "isLoyalty": true,
      "cost": {"loyalty":0},
      "effect": {
        "targets": [],
        "steps": [
          {"op":"draw","who":{"ref":"you"},"count":3},
          {
            "op": "chooseObjects",
            "who": {"ref":"you"},
            "from": {"ref":"each","filter":{"zone":"hand","owner":"you"}},
            "min": 2,
            "max": 2,
            "as": "back"
          },
          {"op":"move","what":{"ref":"bound","name":"back"},"to":{"zone":"library","position":"top","order":"chosen"}}
        ]
      }
    },
    {
      "kind": "activated",
      "text": "-1: Return target creature to its owner's hand.",
      "isLoyalty": true,
      "cost": {"loyalty":-1},
      "effect": {
        "targets": [{"id":"t0","kind":"object","min":1,"max":1,"text":"target creature","filter":{"types":["Creature"]}}],
        "steps": [{"op":"move","what":{"ref":"target","id":"t0"},"to":{"zone":"hand"}}]
      }
    },
    {
      "kind": "activated",
      "text": "-12: Exile all cards from target player's library, then that player shuffles their hand into their library.",
      "isLoyalty": true,
      "cost": {"loyalty":-12},
      "effect": {
        "targets": [{"id":"t0","kind":"player","min":1,"max":1,"text":"target player"}],
        "steps": [
          {
            "op": "move",
            "what": {"ref":"each","filter":{"zone":"library","owner":{"ref":"target","id":"t0"}}},
            "to": {"zone":"exile"}
          },
          {
            "op": "move",
            "what": {"ref":"each","filter":{"zone":"hand","owner":{"ref":"target","id":"t0"}}},
            "to": {"zone":"library","owner":{"ref":"target","id":"t0"}}
          },
          {"op":"shuffle","who":{"ref":"target","id":"t0"}}
        ]
      }
    }
  ]
}
```

Library peeks, ordered insertion (`order: "chosen"`), whole-zone moves.

#### Chaos Orb

> {1}, {T}: If this artifact is on the battlefield, flip it onto the battlefield from a height of at least one foot. If this artifact turns over completely at least once during the flip, destroy all nontoken permanents it touches. Then destroy this artifact.

Classification: **manual**.

```json
{
  "abilities": [
    {
      "kind": "manual",
      "text": "{1}, {T}: If ~ is on the battlefield, flip it onto the battlefield from a height of at least one foot. If ~ turns over completely at least once during the flip, destroy all nontoken permanents it touches. Then destroy ~.",
      "reason": "Requires a physical flip (dexterity); no rules engine can perform it.",
      "shape": "activated",
      "cost": {"mana":[{"kind":"generic","amount":1}],"tap":true}
    }
  ]
}
```

A physical dexterity action cannot be performed by any rules engine. `ManualAbilityDef` with `shape: "activated"` keeps the UNDERSTOOD cost: players are still made to pay {1} and tap it, and the effect is resolved by hand. Never guessed. (Classification: no automated effect content, so the CARD level is `manual`.)

## 14. Milestone 6 hooks

**Principle: milestone 6 adds capabilities and never changes stored card data.** Every card's JSON is the same in M5 and M6; what changes is which capability strings the engine's tables contain, so cards that were `partial` or `manual` become `full` by themselves (monotonicity, 10.3). M5 therefore ships the *shape* of everything below as compiled, tested extension points. The table lists the hooks, where they are, what M5 does with them, and what M6 adds.

| Area | Hook (file) | M5 behavior | M6 adds |
|---|---|---|---|
| Layers 1a, 1b, 3 | `statics/layers.ts` (`LAYERS` includes them; `applyMods` has empty cases); `rules/base-chars.ts#baseChars` | no card produces these modifications that M5 runs; `layer:1a/1b/3` capabilities absent, so such cards degrade | 1a: `copiableValues(s, id)` (CR 707.2-707.3) and `Modification {layer:'1a', copyOf, except}` incl. "except it's an artifact" (CR 707.9); 1b: face-down characteristics become a layer-1b modification (today's `FACE_DOWN` constant in `characteristics.ts` moves into it, CR 708.2); 3: text-changing words (CR 612) |
| Copy | `effects/handlers/tokens.ts#copy` | spell copies (storm, Twincast style, CR 707.10) and token copies of a *plain* permanent (its `CardDef` is reused; no exceptions, no copy of a copy) | copies of anything via copiable values and `except`; `enters.copy` (Clone, CR 614.12, 616.1c); "becomes a copy" as a 1a effect |
| Face-down | `changeFace faceDown/faceUp`, special action `turnFaceUp` (`keywords/special/morph.ts`) | capability absent: morph, disguise, manifest, cloak, manifest dread stay manual | morph/megamorph/disguise (CR 702.37, 702.168), manifest/cloak (CR 701.40, 701.58), face-down 2/2 via layer 1b, timestamp rule 613.7f |
| Multi-faced | `changeFace transform` (face index + new timestamp, CR 613.7g); `imageSlots` | transform/convert-less DFC cards: front/back abilities, transform triggers | `convert`, daybound/nightbound designation (CR 731) and its turn-based check, `flip` (CR 710), meld (CR 701.42, 712.4: two permanents become one object with a back face), prepare/case |
| Replacement | `effects/propose.ts#applicable` returns self replacements, shields and `forbidden` | `feature:replace.self`, `body:enters` (self), `body:regeneration`, `body:prevent` | `feature:replace.foreign`; bodies `instead`, `modify`, `redirect`, `skip`; classes 616.1a-e with `chooseReplacement`; 614.5; 616.1g nesting; counters on entering permanents (CR 122.6, 614.16); madness/dredge/rebound/unearth as keyword data using these |
| Prevention | shields | "prevent the next N damage", "all combat damage" shields; protection's damage prevention (CR 702.16e) is M4 | prevention that redirects (CR 614.9), damage prevention by static effects, "can't be prevented" (the `unpreventable` flag already exists on `damage`) |
| Dependency | `statics/layers.ts#dependsOn` | shipped for the layers M5 runs | extends automatically to 1a/1b/3 |
| Triggers | `triggers/lookback.ts` | full 603.10a-g list already | 603.6b for effects that remove abilities as the object enters, 603.6d |
| Structural keywords | `keywords/data/*.json` with `status: planned` and `special/*.ts` stubs | listed, parse, display, manual with `requiresEngine` | suspend, foretell, plot, bestow, mutate (CR 730 merge via 1a), start your engines/max speed (designation `speed`), daybound |

The Magma Spray example (end of this section) shows the same card going from `partial` to `full`: the manual shield step is replaced by a shielded `ReplacementDef`, with no change to anything else.

### 14.1 Acceptance for milestone 6

- The Comprehensive Rules' own worked examples for 613.8, 614.5, 614.12, 614.16, 616.1 and 707.9 become scenario tests (WP29 prepares the harness and the M5-scope ones; the M6 ones are added by the M6 packages).
- Cards: Humility + Opalescence (already M5, timestamp variants re-tested), Doubling Season, Leyline of the Void, Rest in Peace, Clone, Panharmonicon (already M5), Oko's +1 and -5 (M5), Blood Moon vs a land-type granter, Magma Spray, a morph creature, a transform creature, a manifest.
- The coverage report shows the "M6 gate" row of 15.5 within 5 points.

### 14.2 The same card in milestone 6

#### Magma Spray (milestone 6 form)

> Magma Spray deals 2 damage to target creature. If that creature would die this turn, exile it instead.

```json
{
  "abilities": [
    {
      "kind": "spell",
      "text": "~ deals 2 damage to target creature. If that creature would die this turn, exile it instead.",
      "effect": {
        "targets": [{"id":"t0","kind":"object","min":1,"max":1,"text":"target creature","filter":{"types":["Creature"]}}],
        "steps": [
          {"op":"damage","source":{"ref":"self"},"to":{"ref":"target","id":"t0"},"amount":2},
          {
            "op": "effect",
            "duration": {"d":"endOfTurn"},
            "effects": [
              {
                "s": "replace",
                "replaces": {"ev":"zoneChange","subject":{"is":{"ref":"target","id":"t0"}},"from":"battlefield","to":"graveyard"},
                "body": {"b":"modify","destination":{"zone":"exile"}},
                "shield": {"uses":1}
              }
            ]
          }
        ]
      }
    }
  ]
}
```

The second sentence becomes a one-shot replacement effect created by an `effect` step: a shielded `ReplacementDef` (CR 614.1, 615.8-style "the next time") whose subject is the specific target (`is`, fixed to a handle when the effect is created, CR 611.2c). `modify.destination` changes where the SAME event goes, so "dies" triggers do not fire. Nothing in the JSON of any other card changes between M5 and M6; only this ability goes from `partial` to `full` because capabilities `feature:replace.foreign` and `body:modify` appear.

## 15. Implementation plan

### 15.1 Method

1. **Skeleton first.** WP0 lands every contract of section 5 as compilable stubs plus the migrated types; after it, every other work package replaces stub bodies in files it **owns exclusively** and never renames an export. Two packages never edit the same file; the shared call-sites are reached through `rules/hookpoints.ts`, the table registries of 5.2 and the aggregator `effects/handlers/index.ts`, all of which WP0 writes once.
2. **Waves.** Packages of a wave touch disjoint files and can be implemented in parallel by separate agents; a wave starts when the packages it needs have merged (the "Needs" lines). Inside a wave, merge order is free.
3. **Changing a contract** (anything in an `api.ts`, `types/*`) after WP0 is an *interface change*: a separate small PR by the owner of that file, reviewed by every consumer, merged before the dependent work continues. Work packages fake the neighbors they depend on with the stubs and fixtures of WP0 until the real ones land.
4. **Definition of done for every package:** `npm test` and `npm run typecheck` green; tests named after the rules they pin (`"CR 608.2b: ..."`), living in `packages/engine/test/m5/<area>/` and offline (fixture cards only; corpus tests read `.cache/` and skip when absent); no `any`; CR citations in code comments and log lines; the package's acceptance cards from section 13 run as scenario or golden tests; no new runtime dependency in the engine.
5. **Capability discipline.** A package that finishes an op, event, filter field, layer or keyword adds the *table entry* that makes the capability visible (5.2). Until then the cards stay `partial`; nothing is falsely `full`.
6. **Ownership transfers once.** A file that WP0 touches for the type migration (`rules/*`, `actions/*`, `cards/*`, `core/*`) is owned by WP0 only until WP0 merges; afterwards it belongs to the package named for it in 5.1 and in the lists below. Packages never edit milestone 4 files that no list names.
7. **Inside a wave**, packages that depend on a neighbor of the same wave (WP12-WP15 on WP10/WP11, WP11 on WP16, WP8 on WP9) develop against the WP0 stubs and fixtures and **merge after** the neighbor; their tests that need the real neighbor are marked and enabled at that merge.
8. **Behavior neutrality of WP0.** WP0 changes no behavior: the replay of every existing action log and the M3/M4 soak tests must produce identical states.

### 15.2 Work packages

Dependency waves: **W0** WP0. **W1** WP1-WP9 (all need only WP0). **W2** WP10-WP17 (need the W1 packages named). **W3** WP18-WP25. **W4** WP26-WP29. Size: S under 1 day of focused agent work, M 1-2, L 3-5, XL 5-10.

#### WP0: Contracts, migration, skeleton (W0, L, precondition: milestone 4 committed)

- **Owns:** `types/{ability,automation,state,decisions,events,card,mana}.ts`, `index.ts`, `util/clone.ts` (`cloneObject` copies `links`, `cast`), `core/{zones,view,validate}.ts` (LKI chars filled; redaction of `links`/`cast`; validation of `chooseDivision`/`chooseName`), `rules/hookpoints.ts`, `rules/base-chars.ts`, the **type migration** of `rules/{filter,targets,cost,cost-pick,pay,abilities,timing,cast-restriction,mana-text,characteristics}.ts`, `actions/{announce,activate,cast}.ts`, `cards/{compile,basic-compiler}.ts` (the 47 errors of 4.4), the mechanical move of milestone 4's inline keyword/restriction checks into `keywords/hooks/index.ts` behind `rules/hookpoints.ts`, every stub file of 5.1 (exporting the contract of 5.3 with `throw new Error('not implemented: WPn')` bodies or empty tables), `effects/handlers/index.ts` (aggregator importing the seven family stubs), `model/capabilities.ts` (the builder reading all tables), the widening of `GameState.continuousEffects` to `ContinuousEffectEntry[]` (transition T1, 4.5) with the duration filters of `core/steps.ts` accepting both forms, `test/m5/{helpers.ts,skeleton/*}`.
- **Needs:** this document; committed milestone 4.
- **Delivers:** the repository compiles with the new model; all M1-M4 tests unchanged; contract stubs importable; `import-rules.test.ts` (5.4); clone-hazard tests (4.3); skeleton test (every module exports what 5.3 says); `ENGINE_CAPABILITIES` built from (empty) tables.
- **Tests:** the existing suites plus the three above. **Exit:** replay and soak tests produce identical states.

#### WP1: `model/` (W1, L)

- **Owns:** `model/{validate,lint,canonical,strip,hash,capabilities(walker part),degrade,classify,schema.generated.json,index}.ts`, `scripts/gen-ability-schema.ts`, the root devDependency `ts-json-schema-generator`.
- **Needs:** WP0. **Delivers:** everything in `model/api.ts`: `validateAbility`, `validateCardAbilities`, `capabilitiesOf`, `missingCapabilities`, `degradeAbility`, `classifyAbility`, `classifyCard`, `manualNodes`, `stripAbility`, `hydrateAbility`, `textHash`, `canonicalize`; the generated schema (CI regenerates and diffs).
- **Tests:** one test per `IssueCode` (the 53 examples pass; breaking a binding fails with `unbound-name`); `ask-position` table of 10.1; degrade per position of 10.2 and idempotence; classification table of 10.3 with fake capability sets; strip/hydrate round trip and refusal on `textHash` mismatch; canonicalization idempotence; schema drift test.

#### WP2: `render/` (W1, L)

- **Owns:** `render/*`. **Needs:** WP0. **Delivers:** `renderAbility`, `normalizeForGate`, `renderGate` for every model node (a renderer per op, cost part, quantity, condition, duration, event, static kind, keyword, with the equivalence table). A node without a renderer is not a capability (5.2).
- **Tests:** all 53 examples render to exactly their Oracle text after normalization; negative tests (a swapped filter, a dropped duration, a missing "unless" each fail the gate); the false-reject measurement hook for WP25.

#### WP3: `keywords/` (W1, L)

- **Owns:** `keywords/*` (registry, expand, capabilities, `data/*.json` for all 193 CR 702 keywords with status `implemented` for the top-60 rows marked M3/M4/M5 and `planned` for the rest, `hooks/` split per keyword from WP0's mechanical provider, `special/` stubs, `actions/` macros marked "M5 macro/op").
- **Needs:** WP0. **Delivers:** `KeywordRegistry` (`get`, `names`, `expand`, `capabilities`); keyword expansions as data; hook provider; action macros; the traceability test (7.1.6); snapshots of expanded keywords.
- **Tests:** every data file validates (`KeywordDefData` schema + expansion type-check through WP1 once merged); expansion snapshots for sample parameters; M4 combat/targeting scenario suites unchanged through the provider; one scenario per hook of 7.3.

#### WP4: evaluators, references, filters (W1, L)

- **Owns:** `effects/{ctx,refs,eval}.ts`, `rules/filter.ts`.
- **Needs:** WP0. **Delivers:** `makeCtx`, `recheckAll` (per-target legality), `resolveObjs`, `resolvePlayers`, `resolveRecipients`, `readInfo`, `rebase`, `evalQty`, `evalCond`, `evalCount`, `matchesFilter` for every `ObjectFilter` field (history fields read `GameState.history`), the tables `COND_EVALUATORS`, `QTY_EVALUATORS`, `REF_RESOLVERS`, `SUPPORTED_FILTER_FIELDS`.
- **Tests:** one per filter field; handle semantics of 3.1 (rebase only to public zones; snapshot reads; empty bindings; stale handles); 608.2b cases with synthetic states (Sorin's Thirst, Plague Spores, Swords with protection, Cryptic Command with one mode's target gone); `undefined` propagation; `did` for `may`/`pay`/object steps.

#### WP5: parser front end and lexicon (W1, M)

- **Owns:** `parser/{lexicon.generated.json,preprocess,segment,tokenize}.ts`, `scripts/gen-lexicon.ts`.
- **Needs:** WP0. **Delivers:** `preprocess` (normalize, reminder text, self reference, labels, ledger), `segment` (the table of 6.2), `tokenize`, the generated lexicon with its staleness test.
- **Tests:** reminder text never parsed; self-reference cases (legendary short names, `this creature` on non-creature faces, quoted scopes); ledger tiling over the fixture cards (and the whole local index when `.cache/` exists); segmentation of every layout in the fixtures (saga, split, adventure, class, leveler, modal with bullets, spree, dice rows, loyalty); lexicon contains every subtype with plural forms; stale lexicon fails.

#### WP6: chart parser and hole grammars (W1, XL)

- **Owns:** `parser/chart.ts`, `parser/holes/*`.
- **Needs:** WP0. **Delivers:** the Earley parser (whole-unit derivations, ambiguity detection by canonical JSON, budget, `furthest`/`expected` diagnostics) and the hole grammars `Filter/Obj/Objs, Player/Recipient, Qty/Count, Cost, Cond, Dur, Event, TokenDesc, Abilities, Keyword, Zone, Color, CounterKind, ManaCost, PT` (6.3).
- **Tests:** the 60 most frequent target phrases of the corpus (analysis 8.1) parse to the expected filters; costs (top 20 parts), quantities, conditions, durations, the 18 event shapes; ambiguity cases (`target artifact or creature you control`: harmless; coordination scope with different JSON: ambiguous); unknown word never skipped (nonsense-word mutation on the hole tests); budget.

#### WP7: announcement, casting, costs, payment (W1, L)

- **Owns:** `rules/{targets,cost,cost-pick,pay,timing,mana,solver,sources}.ts` (as needed), `actions/{announce,cast,activate}.ts`.
- **Needs:** WP0 (WP16 later for real cost modifiers; stubbed). **Delivers:** target ids across modes, `Count` resolution (CR 107.3a), `distinctFrom`, `groupLimit`, `onlyIf`, per-target legality used by WP4; `chooseDivision` (CR 601.2d); modes with `override`, `chooser`, entwine (`feature:modes.override`); additional and alternative costs read from the card's `additionalCost`/`alternativeCost` statics (kicker, multikicker, flashback, buyback, evoke, escape, ...) offered as cast methods and recorded in `costsPaid`; `GameObject.cast` written when a spell becomes a permanent; new cost parts (`tapPower`, `putCounters`, `payEnergy`, `reveal`, `mill`, `action`, `manual`); `paymentOptions` (convoke, improvise, delve, emerge); `ManaRestriction` enforcement in the solver; `becameTarget` event emission; `isTargetable` through `hookpoints`.
- **Tests:** the M3 suites unchanged; one scenario per new announcement rule (601.2b-d, 601.2f-h, 118.7-118.9, 702.51 convoke, kicker/multikicker/entwine/buyback); restricted mana (Cavern of Souls) payable only for the right spell.

#### WP8: `triggers/` (W1, L)

- **Owns:** `triggers/*`, `core/triggers.ts`.
- **Needs:** WP0 (WP9 and WP4 for characteristics and filters at integration time; fakes until then). **Delivers:** normalizer with batches, `matchEvent`, `lookBackKinds`, `collectTriggers` (8.4), delayed and reflexive records, state triggers, `putPendingTriggersOnStack` with APNAP ordering, modes and targets (603.3b-d), `limit`.
- **Tests:** CR 603.2c (batch), 603.2d (Panharmonicon), 603.3b-d, 603.4 (twice), 603.6a-b, 603.7c, 603.8, 603.10a (Blood Artist dies with another creature), 603.12, 400.7e (Rancor returns itself), Fiend Hunter race, APNAP with two players.

#### WP9: layers, live statics, characteristics, links (W1, L)

- **Owns:** `statics/{layers,live,mods,links}.ts`, `rules/{characteristics,abilities}.ts`.
- **Needs:** WP0 (WP3's `expand` for keyword abilities; a fake registry until then). **Delivers:** `computeAll` (9.2, sketch in 8.3) with the started set, CDA first, dependency by trial application including existence, timestamps (613.7a-m), counters in layer 7c; `Chars` additions; `getChars` through `computeAll` with a revision-counter cache; `CharAbility` enumeration with stable keys (printed `p:`, keyword `k:`, granted `g:`, rule `r:`); link helpers.
- **Tests:** the layer table (one test per layer 2, 4, 5, 6, 7a-d); 613.6 (Humility's second layer after losing abilities); 613.8 (Blood Moon vs a land-type granter; a loop falls back to timestamps); Humility + Opalescence both timestamp orders; CDA before others; +1/+1 counters; a property test against a timestamp-only oracle; cached vs uncached equality after random actions.

#### WP10: interpreter spine (W2, L)

- **Owns:** `effects/{run,manual}.ts`, `effects/handlers/control.ts`, `core/resolve.ts`, `core/manual.ts`.
- **Needs:** WP4, WP0. **Delivers:** `resolveStackObject`, `runSteps`, `manualFallback`, handlers for `if, may, pay, forEach, repeat, let, chooseObjects, chooseValue, manual`, `ManualReminder` creation, the step budget, `finishSpell` keeping the layout rules of M3's `leaveStack` and milestone 4's Aura attachment on resolution (CR 303.4f, `rules/attachment.ts`).
- **Tests:** 608.2a (intervening if on resolution), 608.2b (one check over all modes), 608.2c-d, 608.2e-f ordering, 118.12/118.12a (`pay`: payer first; Rhystic Study asks the opponent, then the controller), `did` after `may`, manual steps in the middle of a resolution, `NeedDecision` replay determinism.

#### WP11: proposal pipeline and performers (W2, L)

- **Owns:** `effects/{propose,perform}.ts`.
- **Needs:** WP0, WP4, WP16 (`forbidden` uses the statics provider; fake until then). **Delivers:** `propose` (8.5, M5 scope), `perform` for every proposed event (calling milestone 3/4 primitives: `moveObject`, `dealDamage`, `changeLife`, `drawCard`, counters; emitting the engine events including the new ones of 4.1), shields (regeneration, prevention), self replacements (`enters` in full: tapped, tappedUnless, tappedUnlessPay, counters, choose, withAbilities, attachTo, under; stack-time `modify.destination`), the lint that forbids state writes outside the performers; **transition T1**: migrates milestone 4's regeneration shields to typed `ContinuousEffectRec`s (`rules/destroy.ts`, and the raw-record tests of `test/m4/damage.test.ts` in the same PR).
- **Tests:** the three traces of 8.5 (the foreign ones asserted as `partial` in M5), 614.5, 614.17, 614.12a (choices first), shock/check lands, Kavu Titan with and without kicker, regeneration vs "can't be regenerated", prevention shield budgets, 614.7a, LKI `chars` filled.

#### WP12 to WP15: handler families (W2, four packages)

Each owns exactly its handler files (listed in `effects/api.ts`), needs WP4 + WP10 + WP11, delivers the handlers for its ops (all five stages of 8.6), their table entries and their renderers' acceptance, and tests one scenario per op plus the section 13 cards that use them.

| WP | Files | Ops | Size | Notable rules |
|---|---|---|---|---|
| WP12 | `handlers/{lifedamage,counters}.ts` | `damage gainLife loseLife setLife fight putCounters removeCounters moveCounters` | M | 120, 119, 122, 701.14 (damage through milestone 4's `rules/damage.ts#dealDamage` and `rules/life.ts`); divided damage (announced / evenly), 704.5q counter annihilation is M4 |
| WP13 | `handlers/cards.ts` | `draw discard mill scry surveil reveal look search shuffle piles addMana` | L | 121, 701.9, 701.17-25; hidden information: `search` and `look` reveal only to the chooser; `addMana` with `ManaRestriction`; CR 106.3 |
| WP14 | `handlers/{zones,tokens}.ts`, `predefined-tokens.json` | `move destroy sacrifice sacrificeChoice counter tap untap attach phaseOut regenerate removeFromCombat exchange changeFace(transform) createToken copy(spell, plain token) cast` | XL | 701.3-701.8, 701.12, 701.19, 701.21, 701.26, 707.10, 111, 608.2g, 400.7h; token `CardDef`s through milestone 4's `core/zones.ts#createToken` / `Game.addDef` (a definition id that exists is reused, so ids come from canonical JSON); `removeFromCombat` through `rules/combat-state.ts`; `rebase` (3.1) |
| WP15 | `handlers/{lasting,game}.ts`, `core/turn.ts` and `core/steps.ts` edits for durations/extra turns | `effect delay reflexive extraTurn extraPhase endTurn winGame loseGame createEmblem rollDie flipCoin designate action` | L | 611.2a-d, 603.7, 603.12, 500.7, 104, 114, 705, 706; the `effect` handler fixes quantities and references (9.1); `action` expands macros from WP3; duration expiry for the object form of `Duration` |

#### WP16: rule hooks and cost modifiers (W2, L)

- **Owns:** `statics/{hooks,costmods}.ts` (and the statics provider registered in `rules/hookpoints.ts`).
- **Needs:** WP0, WP9. **Delivers:** `staticEffectsFor`, `forbidden` support, **transition T1** for milestone 4's player restrictions (`rules/restrictions.ts` keeps `addPlayerRestriction`/`playerRestricted` as thin wrappers over typed `RestrictionDef` records; `LegacyContinuousEffect` is removed at the end), a hook per `RestrictionDef.action` / `PermissionDef.action` / `RuleModDef.rule` row of 9.4 (each registers its `rule:` / `permit:` / `rulemod:` capability when wired), `applicableCostMods`, affinity/Thalia/Fireball/Death-Rattle Oni style modifiers.
- **Tests:** one per row of 9.4 with a fixture card (Thalia, Platinum Angel's win/lose, a "can't attack" Pacifism-style Aura, Mana Vault's untap restriction, "can't be countered"), cost modifier order (601.2f), generic-only reductions floor at {0}.

#### WP17: lowering, taint, `parseCard` (W2, XL)

- **Owns:** `parser/{lower/*,taint,parse,metrics}.ts` and `parser/templates/bootstrap.json` (the 12 templates of 6.3 plus the minimum to parse Lightning Bolt, Giant Growth, Doom Blade, Llanowar Elves, Serra Angel, Glorious Anthem).
- **Needs:** WP5, WP6, WP1, WP2 (for the gate), WP3 (registry names). **Delivers:** the ten lowering passes of 6.5, the unique-candidate anaphora (6.4), taint T1/T2/E1 (6.7), `parseCard` (never throws), the metrics module (out-of-sample retention, ambiguity list, residue clustering).
- **Tests:** a pass-by-pass unit suite; the worked cases of 6.7 (Mutavault, Magma Spray, Memory Lapse, Elspeth Tirel, Frost Breath); anaphora with zero, one, two candidates; every ledger tiles; the bootstrap cards produce exactly the JSON of section 13.

#### Waves 3 and 4

| WP | Title | Owns | Needs | Delivers | Tests | Size |
|---|---|---|---|---|---|:---:|
| WP18 | Compile pipeline | `cards/{compile,pipeline,spans,pack}.ts`; removes `cards/basic-compiler.ts` and milestone 4's `cards/keywords.ts` once the golden set passes | W1, W2 | `compileCardV2` (total, 6.1 steps 0, 8, 9), precedence and overlay (11.1), degrade, classify with caps (10.4), `spansOf`, pack/LLM entry loading, `forceManual` | M3/M4 tests with the new default compiler; totality fuzz (random garbage text never throws); precedence matrix; stub/layout cases | L |
| WP19 | Templates A: costs, triggers, conditions, durations, keyword lines | `parser/templates/{cost,trigger,condition,duration,keyword}.json` | WP17, WP2 | all 20 cost parts, the 18 event shapes (about 60 trigger templates), conditions, durations, keyword-line templates incl. dash forms, labels | each template's examples/counterExamples; mutation tests; golden: Blood Artist, FTK, Mana Vault, Rhystic Study triggers | XL |
| WP20 | Templates B: damage, life, cards, mana | `parser/templates/effect/{damage,life,cards,mana}.json` | WP17 | about 40 templates for the ops of WP12/WP13 incl. subject-led damage (Rabid Bite), `divided` forms, `addMana` incl. restrictions, mills/scry/look/reveal/search wrappers | same; golden: Lightning Bolt, Fireball, Fire // Ice, Jace Beleren, Fact or Fiction, Llanowar Elves, Cavern of Souls | L |
| WP21 | Templates C: zones, tokens, counters, attach | `parser/templates/effect/{move,destroy,tokens,counters,attach}.json` | WP17 | about 50 templates: destroy/exile/return/put onto battlefield/graveyard/hand/library, sacrifice, tokens (inline and predefined), counters, attach/equip/enchant | same; golden: Doom Blade, Swords, Wrath, Raise the Alarm, Path to Exile, Rancor, Bonesplitter | L |
| WP22 | Templates D: statics, continuous effects, restrictions, cost mods, replacement shapes, ability-level | `parser/templates/{static,ability}.json`, `parser/templates/effect/{continuous,restrict,costmod,replace}.json` | WP17 | about 60 templates: P/T and ability grants, `becomes`, anthems, "can't" forms, cost mods, enters-tapped/with-counters/choose, replacement statics (parse to the model even if M5 can't run foreign ones), activated/triggered/loyalty/modal/saga/class/leveler wrappers | same; golden: Giant Growth, Glorious Anthem, Humility, Opalescence, Kavu Titan, Thalia, Doubling Season, Leyline, Clone, Oko, Mutavault, History of Benalia | XL |
| WP23 | Templates E: choice, control flow, modes, delayed, reflexive, riders, shields | `parser/templates/effect/{choice,flow,delayed,reflexive,search,copy,rider,shield}.json` | WP17 | `may`, `pay` wrappers (the order of D3), `for each`, `repeat`, `if/else` and "instead" folds, `if you do`, reflexive, delayed, search/shuffle sequences, exchange, copy, riders (`can't be regenerated`, `it's still a land`, `countered this way`), the E1 manual-shield recognizer | same; golden: Mana Leak, Rhystic Study, Smothering Tithe, Sneak Attack, Fiend Hunter, Memory Lapse, Pact of Negation, Magma Spray | XL |
| WP24 | Card pool | `cards/pool.ts`; `packages/cards/src/{index-store,trim}.ts` (opt-in `--include-unsanctioned`), decklist stub hook | WP0 | `stubCardDef`, `imageSlots`, unsanctioned flag, Art Series name resolution for images, token variant lookup | slot table cases for every layout in the fixtures; stub is playable; default index unchanged | M |
| WP25 | Coverage, snapshots, mutation, smoke | `packages/cards/src/{coverage,smoke}/*` and CLI commands `coverage` (with `--diff`, `--mine`, `--promote`), `try`, `unmatched`, `snapshot`; `packages/engine/test/m5/golden/*` harness | WP18 | the reports of 6.12, whole-index snapshot (G10), nonsense-word and near-miss mutation harness (G2, G9), executability smoke test boards, retention split, false-reject rate | the harness tests itself on the fixture set; CI job definitions | L |
| WP26 | LLM compile tool | `packages/cards/src/llm/*`, commands `compile --llm`, `review` | WP1, WP2, WP18, WP25 | section 11 end to end with an injectable model client | mock-model tests for every gate; hydrate refusal; overlay-only rule | L |
| WP27 | Rules packs | `packages/cards/src/pack/*`, commands `build-pack`, `update` | WP18, WP26 | 12.5 end to end; pack validation; install; coverage delta | tamper tests; textHash mismatch; requiresEngine; examples stripped | M |
| WP28 | Documentation | `docs/ARCHITECTURE.md`, `STATUS.md`, `CONTRIBUTING.md` (template workflow), `docs/design/updates.md` (pointer) | all | update the "Abilities are data" section, the card-image section (slots), contribution steps | doc links check | S |
| WP29 | CR example suite | `packages/engine/test/m5/cr-examples/*` | W2 | the worked examples of CR 603, 608, 613 (M5 layers), 614.5, 614.12, 615, 616 (marked M6 where foreign), 118.12, 607 as named tests | n/a (they are the tests) | M |

### 15.3 Rulings to pin before the handlers are written

The CR does not settle these on its own; each gets a named test written first (by the package in parentheses), and the model supports either answer.

| # | Question | Pinned default |
|---:|---|---|
| 1 | **Fireball** after one of several targets becomes illegal: is the damage still divided by the original number of targets? CR 608.2b says illegal targets are not affected but not how "divided evenly" counts. | divide by the number of targets announced; the share of an illegal target is lost. Verify against the Gatherer rulings before implementing (WP12); the handler reads `splitAmount`, so changing it is one line. |
| 2 | **Rhystic Study** "may ... unless pays". | payer first (CR 118.12a): `pay` outside `may` (WP10, WP23). |
| 3 | **Kavu Titan** "enters with three +1/+1 counters and with trample": an enters replacement plus a conditional layer-6 grant. | as modeled; confirm no observable difference for a copy of Kavu Titan (WP11). |
| 4 | **"For as long as"** durations: once the condition fails the effect is deleted and never restarts (CR 611.2b only covers "never starts"). | design decision (3.7). |
| 5 | **`anOpponent` in multiplayer**: who is chosen and when (CR 601.7a covers casting; resolution-time choices have no rule). | the controller chooses when the reference is first needed (WP4). |
| 6 | **Panharmonicon** scope: permanents only; never delayed or reflexive triggers (CR 603.2d). | `abilitiesOf` is a battlefield filter (WP8). |
| 7 | **Intervening "if" the compiler cannot express** makes the whole ability a manual triggered ability. A weaker policy (ask each time) would prompt on every event. | manual (6.6). |
| 8 | **Where `leaveStack` special cases live.** M3 hard-codes flashback, aftermath, adventure, omen. | all stay native in M5; flashback and buyback have data forms that M6 enables (7.2). |
| 9 | **Tokens and `isCard`** (Leyline of the Void vs Rest in Peace). | tokens are not cards (CR 111.1) (WP4, WP29). |
| 10 | **Order of "you may" and "unless" for any other wrapper.** | the payer or chooser named by the sentence decides first (CR 118.12a), never the controller by default. |

### 15.4 Test strategy and the gates every release step must pass

| Layer | What | Owner |
|---|---|---|
| Unit | per module, per op, per hole grammar, per template (examples, counterExamples, near-miss mutations, nonsense word) | the owning WP |
| Scenario | tests named after rules (`"CR 608.2b: ..."`) on fixture cards; the CR's own worked examples | owning WP, WP29 |
| Golden | hand-verified JSON for 500 cards: every top template, every layout, the 40 hard cards of the corpus analysis (section 10 of the analysis), the 53 cards of section 13 | WP25 harness, WP19-23 content |
| Snapshot | `{oracle_id: [template ids, canonical JSON hash]}` over the whole local index; every PR diffs it; adding a template may change only formerly-manual units (G10) | WP25 |
| Property | replay determinism over random games with the new cards; compile idempotence; layer oracle; cached vs uncached characteristics; `cloneObject` isolation | WP0, WP9, WP10 |
| Corpus | ledger completeness 100%; render-gate false-reject rate; ambiguity list; out-of-sample retention >= 90%; coverage by level | WP25 |
| Smoke | every automated ability of every card runs on a generated board without `EngineBug` | WP25 |

**Release gates.** Each gate is a measurement point, not a milestone: the coverage CLI is run, the forecast row is compared and corrected (never ignored), and these must hold:

- all CI tests green; the coverage CLI reports the gate's numbers within 5 points of the forecast (otherwise the forecast table is corrected);
- guards G1-G12 hold on the whole corpus: ledger complete for 100% of cards, zero `EngineBug` in the smoke run, mutation tests green, no equal-priority template conflicts;
- out-of-sample retention (6.12) at least 90%;
- the gate's acceptance cards run as scenario tests (table below);
- the list of the top 50 unparsed sentence shapes is committed as the next gate's backlog.

### 15.5 Coverage forecast

Method: for each gate the set of operations and keywords it implements was defined, and the share of the 33,541 corpus cards whose **every** operation and **every** keyword is implemented was computed from the per-card operation atoms of the corpus analysis. **Ceiling** assumes the argument layer (filters, quantities, durations) works perfectly (it is in-sample but stable out of sample: 74.42% vs 74.71% at 50 ops); **Expected** applies fidelity `f = a^3.6` (`a` = per-argument success rate, about 0.91 early and 0.95 late, so `f` of 0.72 rising to 0.84) to the ceiling; **At least half** = share of cards where at least half of the operations and keywords are implemented; **Keyword items** = share of printed keyword items whose keyword is implemented. These are forecasts; the coverage CLI replaces them with measurements at every gate. Paper-core numbers are 0.2 to 2.2 points higher.

| Gate | Packages merged | Scope | Ceiling (full) | **Expected (full)** | At least half | Keyword items | Acceptance cards |
|---|---|---|---:|---:|---:|---:|---|
| R0 | WP0-WP3, WP5, WP6, WP17 (bootstrap), WP18 | model, validator, renderer, keyword flags and hooks, mana abilities, vanilla and keyword-only cards | 3.8% | **3.6%** | 10.8% | 59.9% | Serra Angel, Llanowar Elves; all 348 vanilla, 22 reminder-only and 1,363 keyword-only cards classified |
| R1 | + W2 (WP10-WP15), WP20, WP21, WP23 core | core spells and interpreter spine: damage, destroy, exile, return, draw, discard, life, counter, tap, tokens, sacrifice, add mana, `may`/`pay`/`if` | 12.8% | **9.2%** | 50.1% | 59.9% | Lightning Bolt, Counterspell, Mana Leak, Doom Blade, Swords, Wrath, Raise the Alarm, Think Twice (no flashback yet), Path to Exile, Rabid Bite |
| R2 | + WP8, WP19 | triggers: enters, attacks, dies, upkeep, end step, combat, cast, damage, leaves, blocks; intervening if; delayed; reflexive | 22.7% | **16.3%** | 69.4% | 67.3% | Blood Artist, Flametongue Kavu, Rhystic Study, Smothering Tithe, Mana Vault, Fiend Hunter race, Sneak Attack |
| R3 | + WP9, WP16, WP22 | continuous effects, statics, layers 2/4/5/6/7, restrictions, cost mods, counters, attach, Auras, Equipment | 46.2% | **34.2%** | 89.3% | 80.6% | Giant Growth, Aspect of Hydra, Glorious Anthem, Rancor, Bonesplitter, Sword of Fire and Ice, Jace Beleren, Humility, Opalescence, Oko, Mutavault, Thalia |
| R4 | + WP7 options, WP3 data, WP13 flow | library and card flow, cast options and keyword data (kicker, flashback, cycling, buyback, evoke, entwine, convoke, ...), modes, X, division | 65.2% | **50.2%** | 97.5% | 96.8% | Jace TMS, Fact or Fiction, Paradise Plume, Kavu Titan, Think Twice, Cryptic Command, Fireball, Fire // Ice, Death-Rattle Oni, Cavern of Souls, shock/check lands |
| R5 (M6) | M6 packages | replacement and prevention loop, layers 1a/1b/3, copy, face-down, DFC | 87.1% | **69.7%** | 99.5% | 99.2% | Doubling Season, Leyline of the Void, Rest in Peace, Clone, Magma Spray (M6 form), Blood Moon |
| R6 | long tail + WP27 | dice/coin/vote, designations, emblems, class/leveler/case/prepare, daybound, speed, mutate, meld, the other 127 keywords as data, packs | 90.2% | **75.8%** | 99.5% | 99.2% | the 40 hard cards of the corpus analysis each end in their documented level; pack round trip |
| R7 | WP26 | reviewed LLM entries applied to the parser's misses | n/a | **about 85%** (80-88) | n/a | n/a | gate pass, agreement and smoke rates on a 500-card sample reviewed by a human; promoted templates pass G9/G10 |

The LLM estimate: of the in-ceiling cards the parser misses at R6 (90.2 x 0.16 = 14.4 points) about 60% pass all gates, plus 10% of the 6.7% of cards with out-of-vocabulary sentences: about 9 points. Remaining after R7: about 15% of cards partial or manual (Alchemy, non-deck objects, Un-style, physical actions, the true long tail). "At least half automated" stays above 99%: in play almost every card needs at most a few manual clicks.

#### 15.5.1 Measured at the end of milestone 5 (correction, WP28)

The work packages did not merge gate by gate: W1-W3 merged as waves, so the gates R1-R4 were measured at the wave merges, on the game path (`compileCard(card)`, the coverage CLI since W3b), over the local index of 34,473 cards (Scryfall bulk of 2026-10-11, schema 2):

| Measurement point | Scope actually merged | Templates (stable) | **Full (measured)** | Partial | Manual | Text at least half automated (`autoRatio >= 0.5`) | Acceptance cards at their level (cumulative) |
|---|---|---|---:|---:|---:|---:|---|
| Milestone 4 | keyword-line recognizer only | none | 1,256 (3.6%) | 9,896 (28.7%) | 23,317 (67.6%) | n/a | n/a |
| W2 (informative: `parseCard` + classify, not the game) | R0 + interpreter | 15 bootstrap | 2,592 (7.5%) | 13,083 (38.0%) | 18,791 (54.5%) | n/a | n/a |
| W3, gate R1 | R0-R4 libraries, bootstrap templates in the game | 15 (15) | 2,828 (8.2%) | 13,417 (38.9%) | 18,228 (52.9%) | 3,953 (11.5%) | R0 2/2, R1 6/12 |
| **W3b = end of milestone 5** | **everything of R0-R4 that was built** | **305 (245)** | **9,427 (27.3%)** | **14,647 (42.5%)** | **10,399 (30.2%)** | **13,063 (37.9%)** | **R0 2/2, R1 12/12, R2 17/19, R3 24/31, R4 28/42** |

**Corrections.** (1) The R1 forecast (9.2%) held for R1's scope (8.2% measured, within 5 points). (2) The cumulative forecast for the whole milestone-5 scope, R4 at 50.2% full, is **corrected to the measured 27.3%** (ratio 0.54): the per-argument fidelity was close to the forecast where templates exist, but whole families the forecast counted as R3/R4 scope are not built or are deliberately fail-closed: layouts (saga chapters `feature:chapter` 231 cards; class, case, leveler, mutate, prototype, prepare, meld at 0%), `keyword:kicker` (209) and `static:additionalCost` (210), morph (147), layer-2 control (`feature:control.layered`, 126), and 20,126 manual units with no template at all. "At least half automated" was forecast per operation (97.5% at R4); the measure the tools report is per character (`autoRatio`), 37.9%, and is not comparable. (3) The forecasts of the later gates are scaled by the same measured ratio until they are measured: **R5 (milestone 6) about 38% full** (69.7% x 0.54), **R6 about 41%** (75.8% x 0.54); R7 (LLM, milestone 7) stays an estimate of +9 points over whatever R6 measures. Each gate replaces its row with a measurement, as 15.4 requires. (4) The acceptance cards below their level at the end of milestone 5 (14): R2 Fiend Hunter (partial), Sneak Attack (manual); R3 Aspect of Hydra (manual), Humility, Opalescence, Oko, Mutavault (partial: experimental templates or one manual sentence); R4 Jace, the Mind Sculptor, Fact or Fiction, Paradise Plume, Kavu Titan, Fireball, Death-Rattle Oni, Cavern of Souls (partial).

#### 15.5.2 R5 measured (milestone 6, M6-10)

Decision 9.3 #4 of `docs/design/m6-replacement-copy-faces.md`: the R5 row above (69.7%, and the scaled 38% of 15.5.1) is replaced by milestone 6's own forecast
(its section 8: gate = low row 12,411 = 36.0%) and by the measurement at M6-10: **13,691 full (39.7%)**, partial 36.7%, manual 23.6% of 34,473 cards, on the
merged milestone 6 tree (which includes template packages merged since milestone 5). The M6 gate result, pass/fail with causes, is in STATUS.md.

**Why this order.** Spells and resolution are needed by everything, and the funnel exists from the first op so replacement effects arrive without touching handlers (R1 before R2). R3 is the biggest jump (+23.5 ceiling points: ability grants 19% of cards, P/T changes 16%, counters 9%, "can't" 9%) and is where the layer system's shape must be right, so `computeAll` is written whole with only the M5 layers populated. Card flow and cast options (R4) are more frequent than replacement and copy (R5), and R5 is the hardest, so it benefits from a stable interpreter and test suite. The LLM step (R7) comes after the parser so it only attacks the residue and its output can be promoted into templates.

### 15.6 Open decisions

Defaults are chosen so work is not blocked; none changes the plan if answered differently.

| # | Decision | Default in this plan | Touches |
|---:|---|---|---|
| 1 | Keep silver-border and acorn cards (603) as manual-only `unsanctioned` cards so "every card" is literally true | opt-in index option, off by default | `packages/cards` (WP24) |
| 2 | Image slots per physical side instead of per rules face (12.2) | per physical side | ARCHITECTURE.md "Card images" (WP28), client |
| 3 | Unknown names become stubs instead of an error in `resolveDecklist` (C4) | engine provides `stubCardDef`; the client confirms with the player | `packages/cards` decklist, client (M8) |
| 4 | Default LLM trust (11.5) | `autoverified` drives play, capped at `partial`; `reviewed` for `full` | settings |
| 5 | Alchemy digital-only verbs (535 cards) | flagged `digitalOnly`, manual | none |
| 6 | New decision kinds `chooseDivision` and `chooseName` (4.6) | approved | `types/decisions.ts` |
| 7 | Parser location for the browser client | in the engine, in the browser | none |
| 8 | **Scope of milestone 5**: this design pulls layers 2/4/5/6/7 with dependency into milestone 5 (pump spells, Auras, Equipment and anthems cannot work without them), leaving 1a/1b/3, foreign replacement, copy and face-down for milestone 6 | pulled in | STATUS.md milestone table |
| 9 | Suggested split of STATUS.md milestone 5: M5a = gates R0-R2, M5b = R3-R4; M6 = R5; M7 = R6-R7 | as stated | STATUS.md (WP28) |
| 10 | Publication location of the rules pack (updates.md) | unchanged: `OPENMTG_PACK_URL` | none |

### 15.7 Risks

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| Parser fidelity `f` is below the forecast | medium / affects the "full" percentage, not correctness | forecasts replaced by measurements each gate; partial automation still covers more than half of almost every card; LLM and template promotion attack the residue |
| The exact render gate false-rejects correct parses | medium / costs automation, never correctness | measured; equivalence table and renderer tuned on the corpus; a rejected ability is manual, visible, usable |
| Op vocabulary gaps for real cards | medium / `requiresEngine` entries | `action` macros add verbs without changing the union; a new op is a model-version bump that invalidates caches deliberately |
| Parallel work packages diverge from the contracts | medium / integration cost | skeleton-first WP0, one owner per file, contract tests (`skeleton` test, import-rules lint), interface changes as separate PRs |
| Milestone 4 changes drift under the types | medium | WP0 starts after M4 is committed and re-bases section 4; the tsc worklist (4.4) is re-measured |
| Re-execution hazards (shared structure of `cloneState`) | medium / determinism bugs | the clone hazards of 4.3 each have a test in WP0; `defs` frozen; handlers pure |
| Layer computation cost in the client | low-medium | computed once per revision, cached; effects per layer are few; the quadratic dependency loop is bounded and memoized |
| Earley parser performance on the whole index | medium | first-literal indexing, node budget, results cached by `(compilerVersion, textHash)`, a 90 s whole-index target measured in WP6/WP25 |
| Hidden information in new decisions (`search`, `look`, `piles`, manual panels) | medium / privacy | `viewFor` already redacts decisions; new kinds carry no hidden data; `search` reveals found cards only to the chooser until revealed |
| Too many manual prompts early (R0-R2) | high / UX | the import report tells players beforehand; the coverage list drives which shapes to automate next; hot-seat play is the target |
| IP in caches and packs | low if enforced | stored form carries no text; `hydrate` refuses a mismatching `textHash`; pack build strips display fields and examples |
| Multiplayer APNAP corner cases | medium | the model is player-count independent (`each`, `anOpponent`, `defending`); two-player tests first, three-player scenario tests for 608.2e-f |
| Template maintenance burden | medium | promotion tool, mutation tests, experimental status, snapshot diffs, one hole grammar instead of whole-sentence lists |

## 16. Appendix

### 16.1 Reproducing the checks

All files are in the session scratchpad (outside the repository). `mig/` is a copy of `packages/engine/src` with `types/ability.ts` replaced; `m5final/` holds the standalone type check.

| Check | Command (from the scratch directory) | Result |
|---|---|---|
| The model, the additions, the APIs, the sketches and the 54 typed examples compile | `tsc -p mig/tsconfig.json`, filtered to the new files | no errors |
| The type check is effective | append `const bad: EffectStep = { op: 'draw', count: 1 }` | error TS2322 (missing `who`) |
| Migration worklist | `tsc -p mig/tsconfig.json` (unfiltered); repeated in `mig2/` against the later working tree | 47 errors in 15 files; 51 in 18 files (4.4) |
| Keyword expansions | `tsx kw/expand.mts` expands 10 keyword data files with sample parameters; the output compiles as `AbilityDef[]` | no errors |
| JSON blocks of section 13 | `tsx mig/print-examples.mts` | 53 examples + 1 milestone 6 form |
| CR rule numbers cited in this document | a script checks each against the headings of `rules/cr/` | all exist |

If the design is accepted the natural promotion is: `types/ability.ts` and `types/automation.ts` from section 2.3, the state additions from 4.1, the API files of 5.3 and the sketches of 8.3 into WP0's skeleton; `examples/cards.ts` into `packages/engine/test/m5/golden/` as the first golden cards; the keyword data files into `keywords/data/`.

### 16.3 The prototype lint

The starting point of WP1's `model/lint.ts` (about 100 lines; it passes for the 54 typed examples). It checks what the types cannot say: names bound before use, target ids, event roles, `subject`, links, `divided`, `addMana`, battlefield destinations, layer 7a.

```ts
/** Prototype semantic lint (a starting point for WP1): checks the things types cannot say, over the typed examples. */
import { EXAMPLES } from './src/examples/cards';
import { M6_EXAMPLES } from './src/examples/m6';
import { readFileSync } from 'node:fs';

type J = any;
interface Issue { card: string; path: string; msg: string }
const issues: Issue[] = [];

function lintAbility(card: string, ab: J, ai: number, linkProducers: Set<string>, linkConsumers: Set<string>): void {
  const base = `/abilities/${ai}`;
  const targetIds = new Set<string>();
  const dupTargets: string[] = [];
  const collectTargets = (x: J): void => {
    if (Array.isArray(x)) return x.forEach(collectTargets);
    if (x && typeof x === 'object') {
      if (Array.isArray(x.targets)) for (const t of x.targets) { if (targetIds.has(t.id)) dupTargets.push(t.id); targetIds.add(t.id); }
      for (const v of Object.values(x)) collectTargets(v);
    }
  };
  collectTargets(ab);
  for (const d of dupTargets) issues.push({ card, path: base, msg: `duplicate target id ${d}` });

  const isTrigger = ab.kind === 'triggered' || ab.kind === 'chapter';
  const declared = new Set<string>();
  const vars = new Set<string>();
  let inContinuous = 0;
  let inReplace = 0;

  const walk = (x: J, path: string): void => {
    if (Array.isArray(x)) { x.forEach((y, i) => walk(y, `${path}/${i}`)); return; }
    if (!x || typeof x !== 'object') return;
    // uses
    if (x.ref === 'bound' && !declared.has(x.name)) issues.push({ card, path, msg: `bound name "${x.name}" used before it is produced` });
    if (x.ref === 'target' && !targetIds.has(x.id)) issues.push({ card, path, msg: `unknown target id ${x.id}` });
    if (x.q === 'targetCount' && !targetIds.has(x.id)) issues.push({ card, path, msg: `unknown target id ${x.id}` });
    if (x.cond === 'did' && !declared.has(x.step)) issues.push({ card, path, msg: `did "${x.step}" names no earlier step` });
    if (x.q === 'resultCount' && !declared.has(x.step)) issues.push({ card, path, msg: `resultCount "${x.step}" names no earlier step` });
    if (x.q === 'var' && !vars.has(x.name)) issues.push({ card, path, msg: `var ${x.name} without let` });
    if (x.ref === 'event' && !(isTrigger || inReplace || ab.kind === 'manual')) issues.push({ card, path, msg: 'event reference outside a trigger or replacement' });
    if (x.ref === 'subject' && inContinuous === 0) issues.push({ card, path, msg: 'subject outside a continuous effect' });
    if (x.ref === 'linked') linkConsumers.add(x.link);
    if (x.chosen && typeof x.chosen === 'object' && x.chosen.link) linkConsumers.add(x.chosen.link);
    if (x.dynamic && x.dynamic.kind === 'chosen') linkConsumers.add(x.dynamic.link);
    if (x.layer === '7a' && !x.__cda) { /* checked at the effect level below */ }
    for (const id of x.distinctFrom ?? []) if (!targetIds.has(id)) issues.push({ card, path, msg: `distinctFrom ${id} unknown` });
    // divided announced needs a divide spec
    if (x.divided === 'announced') {
      let ok = false;
      const find = (y: J): void => { if (Array.isArray(y)) y.forEach(find); else if (y && typeof y === 'object') { if (y.divide) ok = true; Object.values(y).forEach(find); } };
      find(ab);
      if (!ok) issues.push({ card, path, msg: 'divided:announced without a TargetSpec.divide' });
    }
    // addMana: exactly one of units / dynamic
    if (x.op === 'addMana' && !!x.units === !!x.dynamic) issues.push({ card, path, msg: 'addMana needs exactly one of units / dynamic' });
    // battlefield destinations need a controller
    if (x.zone === 'battlefield' && x.op === undefined && 'controller' in x === false && (path.endsWith('/to') || path.includes('/destination'))) {
      issues.push({ card, path, msg: 'move to the battlefield without a controller' });
    }
    // continuous effect layer 7a only with cda
    if (x.s === 'continuous') {
      for (const m of x.mods) if (m.layer === '7a' && !x.cda) issues.push({ card, path, msg: 'layer 7a without cda' });
    }
    // order of evaluation: steps in order, producers register after their step's uses are walked
    if (x.s === 'continuous') inContinuous++;
    if (x.s === 'replace') inReplace++;
    for (const [k, v] of Object.entries(x)) {
      if (k === 'text' || k === 'span') continue;
      walk(v, `${path}/${k}`);
    }
    if (x.s === 'continuous') inContinuous--;
    if (x.s === 'replace') inReplace--;
    // producers
    if (x.op && x.as) declared.add(x.as);
    if (x.op === 'piles') { declared.add(x.chosen); declared.add(x.other); }
    if (x.op === 'let') vars.add(x.name);
    if (x.link && (x.op === 'move' || x.op === 'createToken' || x.op === 'chooseValue')) linkProducers.add(x.link);
    if (x.b === 'enters' && x.choose) for (const c of x.choose) linkProducers.add(c.link);
  };

  // walk steps in order so declarations precede uses
  walk(ab, base);
  // delay.capture must name declared steps
  const caps = (y: J): void => { if (Array.isArray(y)) y.forEach(caps); else if (y && typeof y === 'object') { if (y.op === 'delay') for (const n of y.capture ?? []) if (!declared.has(n)) issues.push({ card, path: base, msg: `capture ${n} unbound` }); Object.values(y).forEach(caps); } };
  caps(ab);
}

for (const e of [...EXAMPLES, ...M6_EXAMPLES]) {
  const abs: J[] = e.faces ? e.faces.flatMap((f) => f.abilities) : e.abilities!;
  const prod = new Set<string>();
  const cons = new Set<string>();
  abs.forEach((a, i) => lintAbility(e.name, a, i, prod, cons));
  for (const c of cons) if (!prod.has(c)) issues.push({ card: e.name, path: '', msg: `link "${c}" consumed but never produced` });
  for (const p of prod) if (!cons.has(p)) console.log(`warning: ${e.name}: link "${p}" produced but never consumed`);
}
console.log(issues.length === 0 ? 'lint: OK for ' + (EXAMPLES.length + M6_EXAMPLES.length) + ' examples' : issues);
void readFileSync;
```

### 16.2 Rule index (where each cited rule family is used)

| Rules | Used for |
|---|---|
| 101.2, 614.17 | "can't" beats "can": `RestrictionDef`, forbidden-before-propose |
| 101.4, 608.2e-f, 603.3b, 616.1 | APNAP: choices, trigger ordering, replacement choice |
| 102.1, 109.5, 506.2 | `active`, `you`, `defending` references |
| 107.3, 601.2b | `{q:'X'}` announcement |
| 111, 111.10 | `TokenDef`, predefined tokens |
| 113.3, 113.6, 604.5-604.6 | ability kinds and functioning zones |
| 113.7a, 608.2h, 603.10, 400.7 | `ObjHandle`, snapshots, look-back |
| 115, 601.2c-d, 608.2b, 700.2 | `TargetSpec`, division, the single re-check, modes |
| 118.7-118.9, 118.12, 601.2f | cost modifiers, additional/alternative costs, `pay` |
| 119, 120, 121, 122 | life, damage, draw, counters ops |
| 400.7a-k, 607 | handle re-basing, links, cast record |
| 500.5, 514.2, 610.3 | durations |
| 603.1-603.12 | triggers, intervening if, delayed, reflexive, state triggers, additional times |
| 604.3, 613 | characteristic-defining abilities, layers, timestamps, dependency |
| 605, 606 | mana and loyalty ability flags |
| 608.2a-p, 608.3 | resolution algorithm |
| 609.2-609.4 | defaults, do as much as possible, "as though" |
| 611, 612 | resolved vs static continuous effects, fixing of values and sets, text-changing |
| 614, 615, 616 | replacement, prevention, ordering |
| 701.x | keyword actions: ops and macros (7.5) |
| 702.x | keyword abilities (7.4); skulk is 702.118 (milestone 4's document cites 702.120, which is escalate) |
| 707, 708, 712, 714, 716, 730, 731 | copy, face-down, DFC, sagas, classes, merge, day/night |
