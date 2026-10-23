/**
 * Compile Scryfall Oracle data into a CardDef. Pure: no I/O.
 * Multi-faced layouts (CR 709 split, 710 flip, 712 double-faced, 715 adventurer) are represented as several FaceDefs (cards/faces.ts).
 *
 * The default compiler is the milestone 5 compile pipeline (cards/pipeline.ts#compileCardV2, WP18): the template parser, packs and the LLM cache,
 * the capability degrade against the running engine and the classification of design 10. `compileCard(card)` uses it with `defaultCompileSources()`.
 * An explicit `AbilityCompiler` (tests, `noAbilityCompiler`) still runs face by face as in milestones 2-4.
 *
 * The engine's capability set is installed ONCE by the package entry point (index.ts calls `installEngineCapabilities(ENGINE_CAPABILITIES)`, which is not
 * re-exported): this module cannot import model/capabilities.ts, which builds the set from the interpreter's tables, because the interpreter's manual
 * operations (core/manual.ts) compile tokens through compileCard (that would be an import cycle, design 5.4). Install-once keeps every compile of a
 * process, tokens compiled mid-game included, against the same set (determinism and replay): a second install of a different set throws. Until the set
 * is installed (a module graph that never loads the package entry), the default sources carry an EMPTY set: every understood node then degrades to manual
 * (fail closed, never silently automated). A caller that wants another set passes it explicitly: `defaultCompileSources({ caps })`.
 */
import type { CardDef, FaceDef, OracleCard } from '../types/card';
import type { AutomationLevel, CardAutomation } from '../types/automation';
import type { AbilityDef } from '../types/ability';
import type { CapabilitySet } from '../model/api';
import { keywordRegistry } from '../keywords/registry';
import { defaultParseOptions, PARSER_VERSION } from '../parser/parse';
import { buildFaces, cardShell } from './faces';
import { badCostAbility, compileCardV2, type CompileSources } from './pipeline';
import { markUnsanctioned } from './unsanctioned';
import { memoCompile } from './compile-memo';

export { parseTypeLine, type ParsedTypeLine } from './faces';

/** Ability compiler signature: Oracle text of one face -> abilities + what was not understood. */
export type AbilityCompiler = (face: Omit<FaceDef, 'abilities'>, card: OracleCard) => { abilities: AbilityDef[]; unsupported: string[] };

/** Understands nothing, so any rules text is flagged for manual resolution. */
export const noAbilityCompiler: AbilityCompiler = (face) => {
  const text = face.oracleText.trim();
  return text ? { abilities: [{ kind: 'manual', shape: 'unknown', text, reason: 'No ability compiler installed' }], unsupported: [text] } : { abilities: [], unsupported: [] };
};

/** Version of the compile pipeline output (CardAutomation.compilerVersion; caches key on it, design 12.6). */
export const COMPILER_VERSION = `${PARSER_VERSION}+w3b.1+m6.0`; // M6-0 (m6 design 1.1 #1): the M6 walker names (replace.on, ...) recompile every cache

let engineCaps: CapabilitySet = new Set();
let installed = false;
let defaults: CompileSources | undefined;

/** Installs the running engine's capability set, once (index.ts does this with ENGINE_CAPABILITIES). Installing the same set again is a no-op. */
export function installEngineCapabilities(caps: CapabilitySet): void {
  if (installed) {
    if (caps !== engineCaps) throw new Error('the engine capability set is installed once per process (cards/compile.ts): pass other caps explicitly');
    return;
  }
  engineCaps = caps;
  installed = true;
  defaults = undefined;
}

/** The capability set the default compiler classifies against (empty until installed). */
export const installedCapabilities = (): CapabilitySet => engineCaps;

/**
 * The sources `compileCard(card)` uses: every committed template (parser/template-set.ts#TEMPLATE_SET, W3b; it was the bootstrap set until then), the keyword
 * registry, the engine's capabilities, no pack, no LLM cache, and
 * the default LLM trust of design 11.5 (`autoverified`; it matters only when a caller adds an LLM cache or a pack with LLM entries).
 */
export function defaultCompileSources(over: Partial<CompileSources> = {}): CompileSources {
  defaults ??= { parse: defaultParseOptions({ capabilities: engineCaps }), keywords: keywordRegistry, caps: engineCaps, trust: 'autoverified', compilerVersion: COMPILER_VERSION };
  return Object.keys(over).length === 0 ? defaults : { ...defaults, ...over };
}

/**
 * The pipeline as an AbilityCompiler, for callers that pass a compiler explicitly: the face is looked up by name in the whole card's compile (the
 * pipeline parses a card as a whole). `compileCard(card, pipelineCompiler)` is the same as `compileCard(card)`.
 */
export const pipelineCompiler: AbilityCompiler = (face, card) => {
  const def = compileCardV2(card, defaultCompileSources());
  const i = Math.max(0, def.faces.findIndex((f) => f.name === face.name));
  const f = def.faces[i];
  const auto = def.automation.faces?.[i];
  const unsupported = auto ? [...new Set(auto.abilities.flatMap((a) => a.manual.map((m) => m.text)).filter((t) => t !== ''))] : [];
  return { abilities: f ? f.abilities : [], unsupported };
};

export function compileCard(card: OracleCard, compiler?: AbilityCompiler, source: CardAutomation['source'] = 'templates'): CardDef {
  if (compiler === undefined || compiler === pipelineCompiler) {
    const sources = defaultCompileSources();
    return memoCompile(sources, card, (c) => compileCardV2(c, sources)); // P1: a card compiled before is copied, not compiled again (cards/compile-memo.ts)
  }
  // An explicit face-by-face compiler (milestones 2-4 form). Total like the pipeline: an unknown mana symbol is a manual ability, not an exception.
  const built = buildFaces(card);
  const unsupported: string[] = [];
  let anyAutomated = false;
  let anyBadCost = false;
  const faces: FaceDef[] = built.faces.map((base, i) => {
    const r = compiler(base, card);
    const abilities = [...r.abilities];
    unsupported.push(...r.unsupported);
    const bad = built.badCosts[i];
    if (bad) {
      const m = badCostAbility(bad);
      abilities.push(m);
      unsupported.push(m.text);
      anyBadCost = true;
    }
    if (abilities.some((a) => a.kind !== 'manual')) anyAutomated = true;
    return { ...base, abilities };
  });
  const hasText = faces.some((f) => f.oracleText.trim() !== '');
  // an unreadable mana cost: the engine cannot cast the card (CR 202.1b, 118.6), so it is manual whatever its text (as in the pipeline)
  const level: AutomationLevel = anyBadCost ? 'manual' : unsupported.length === 0 ? 'full' : anyAutomated ? 'partial' : hasText ? 'manual' : 'full';
  const def: CardDef = {
    ...cardShell(card),
    faces,
    automation: { level, unsupported, source: unsupported.length === faces.length && !anyAutomated && hasText ? 'none' : source },
  };
  // WP24 INTERFACE CHANGE: a card the rules do not cover (CR 100.7), flagged by the card index, is manual-only apart from its keywords (design 12.3).
  // (The pipeline path applies it in cards/pipeline.ts#compileCardDetailed.)
  return card.unsanctioned === true ? markUnsanctioned(def) : def;
}
