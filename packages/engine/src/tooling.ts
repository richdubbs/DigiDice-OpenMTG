/**
 * Tooling surface of the engine for the Node card tool (packages/cards: the coverage CLI, snapshots, mutation and smoke harnesses of WP25; later the LLM
 * tool and the pack builder). Design 5.4: `packages/cards` imports the engine package only through its public `index.ts`, which re-exports this module.
 *
 * WP25 INTERFACE CHANGE (additive, re-exports only): the parser's template defaults, its metrics module (design 6.12), the chart entry points used by
 * `try` and the equal-priority conflict check, the front end's ledger check (guard G4) and preprocessing (the parse text the parser tokenizes), the
 * render gate's false-reject measurement hook (render/metrics.ts) and the degrade pass for card-level culprits. Nothing here has behavior of its own;
 * every function lives in, and is owned by, the module it comes from. Pure (no I/O), like the rest of the engine.
 */
export { BOOTSTRAP_TEMPLATES, PARSER_VERSION, defaultParseOptions, registryKeywords } from './parser/parse';
export { TEMPLATE_SET, TEMPLATE_FILES } from './parser/template-set';
export {
  RETENTION_GATE, abstractShape, ambiguityList, ambiguityRate, fnv1a32, halfOfKey, parseLevel, residueClusters, residueOf, retention, splitHalves,
  type AmbiguityEntry, type CardOutcome as ParseOutcome, type Half, type HalfCoverage, type ParseLevel, type ResidueCluster, type Retention,
} from './parser/metrics';
export { DEFAULT_BUDGET, chartInputFrom, parseUnit, validateTemplates, type ChartGoal, type ChartResult, type Derivation } from './parser/chart';
export { tokenize, type Token, type TokenKind } from './parser/tokenize';
export { adaptTokens } from './parser/holes';
export { GENERATED_LEXICON, faceContexts, ledgerProblems, normalizeText, preprocessFace, selfExtents, type PreprocessedFace } from './parser/preprocess';
export { measureGate, type GateDiff, type GateReport, type GateSample } from './render/metrics';
// the degrade pass for card-level culprits (design 6.1 step 8, 10.2): the coverage fallback demotes the consumer of a link no ability produces
export { degradeWith, type Culprit } from './model/degrade';
