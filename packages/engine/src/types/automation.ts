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
  /**
   * Per face, per ability (same indexes as FaceDef.abilities).
   * WP0 DEVIATION: optional until WP18. Milestone 4's compiler (still the default) produces only `level`, `unsupported` and `source`, and its tests compare
   * that exact object; `classifyCard` (WP1) and `compileCardV2` (WP18) always fill it.
   */
  faces?: { abilities: AbilityAutomation[] }[];
  /** Text fragments shown to players for manual resolution (the same meaning as today's `unsupported`). */
  unsupported: string[];
  /** Where the abilities came from (highest-precedence source that contributed). */
  source: 'pack' | 'llm-cache' | 'templates' | 'keywords-only' | 'none';
  /** Share (0..1) of non-reminder characters inside automated spans: sorts the deck screen and the work queue. */
  autoRatio?: number; // WP0 DEVIATION: optional until WP18, see `faces`.
  /** Capabilities the card needs that this engine build lacks ("op:copy", "keyword:morph", "layer:1a"). */
  requiresEngine?: string[];
  /** Review state of the data that drives the card; non-reviewed LLM data caps `level` at 'partial'. */
  review?: ReviewState;
  /** SHA-256 of the normalized Oracle text of all faces that this result was compiled from (packs, caches). */
  textHash?: string;
  /** Parser/compile version that produced it. */
  compilerVersion?: string;
}
