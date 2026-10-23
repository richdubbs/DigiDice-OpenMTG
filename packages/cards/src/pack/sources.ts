/**
 * The compile sources with the player's installed data (updates.md "Precedence"; design 12.5, 11.5): pack entry (matching textHash) > trusted LLM
 * cache entries on the units the parser left manual > template parser > manual. The precedence itself is the engine's pipeline
 * (cards/pipeline.ts#compileCardV2); this file only assembles its sources. A pack's templates are added to the parser's (as experimental: design 6.9).
 * A pack's keyword definitions are validated and kept, but this engine build has no loader for data keywords: they are reported, not used.
 */
import { defaultCompileSources, type CompiledCardEntry, type CompileSources, type LlmTrust, type Template } from '@openmtg/engine';

export interface DataSources {
  pack?: { entries: ReadonlyMap<string, CompiledCardEntry>; templates: readonly Template[] } | null;
  llm?: ReadonlyMap<string, CompiledCardEntry>;
  trust?: LlmTrust;
}

export function sourcesWith(data: DataSources, base: CompileSources = defaultCompileSources()): CompileSources {
  const pack = data.pack ?? null;
  const templates = pack && pack.templates.length > 0 ? [...base.parse.templates, ...pack.templates] : null;
  return {
    ...base,
    ...(templates ? { parse: { ...base.parse, templates } } : {}),
    ...(pack ? { pack: pack.entries } : {}),
    ...(data.llm ? { llm: data.llm } : {}),
    trust: data.trust ?? base.trust,
  };
}
