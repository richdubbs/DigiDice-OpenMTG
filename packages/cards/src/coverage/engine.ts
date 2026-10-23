/**
 * How the coverage tools turn an Oracle card into what the game plays (design 6.1): the parse (steps 2-7, `parseCard`, for the parser's own metrics:
 * diagnostics, ledger, gate, templates) and the compiled `CardDef` with its classification (steps 0, 8, 9: degrade against the engine's capabilities,
 * classify, design 10).
 *
 * The compiled card comes from WP18's `compileCardV2` with the merged template set. Until WP18 is merged that function is a stub that throws
 * `not implemented: WP18`; the adapter then falls back to the same steps done here, in the order of design 6.1 (parse, degrade per face with
 * `degradeAbilities`, the card-level lint of step 8 with its errors demoted (`enforceCardLint`), `classifyCard` with the experimental-template cap of
 * 10.4) on the face shell of `compileCard`. The fallback is announced in every report (`pipeline`), so a measurement is never mistaken for the other.
 * WP18's `compileCardV2` must run the same card-level lint; the report counts any compiled card that still has a lint error and the gates fail on it.
 */
import {
  COMPILER_VERSION, ENGINE_CAPABILITIES, PARSER_VERSION, classifyCard, compileCard, compileCardV2, defaultCompileSources, defaultParseOptions, degradeAbilities, degradeWith,
  keywordRegistry, parseCard,
  validateCardAbilities, type AbilityCompiler, type AbilityDef, type AutomationLevel, type CapabilitySet, type CardAutomation, type CardDef, type CompileSources,
  type Culprit, type FaceLines, type Issue, type OracleCard, type ParseOptions, type ParseResult, type Template,
} from '@openmtg/engine';

export type PipelineKind = 'compileCardV2' | 'parse+degrade (WP18 not merged)' | typeof GAME_PIPELINE;

/**
 * The game path (W3b): `compileCard(card)`, the default compiler a decklist card gets (cards/compile.ts#defaultCompileSources: the engine's default
 * template set, keyword registry and installed capabilities). Guard G10 of the game path diffs snapshots written by this engine (design 6.8, 10.3).
 */
export const GAME_PIPELINE = 'compileCard (default compiler)';

/** One card through the parser and the compile pipeline. */
export interface CardRun {
  card: OracleCard;
  parse: ParseResult;
  /** The compiled definition; null only when even the face shell could not be built (an unknown mana symbol on the fallback path). */
  def: CardDef | null;
  level: AutomationLevel;
  /** Capabilities the card needs that the engine lacks (design 10.1). */
  requiresEngine: string[];
  /** Why `def` is null or the card was forced manual by the adapter. */
  error?: string;
}

export interface CoverageEngineOptions {
  /**
   * The template set to parse with. Omitted: the GAME path, exactly what `compileCard(card)` builds for a decklist card (the default compiler's own
   * sources; `caps` and `forceFallback` must then be omitted too).
   */
  templates?: readonly Template[];
  /** Default: the engine's own ENGINE_CAPABILITIES. */
  caps?: CapabilitySet;
  /** Force the fallback path even when compileCardV2 is implemented (tests of the adapter itself). */
  forceFallback?: boolean;
}

export interface CoverageEngine {
  caps: CapabilitySet;
  parseOptions: ParseOptions;
  /** Which pipeline produced `def`; decided on the first card (compileCardV2 when WP18 is merged). */
  pipeline(): PipelineKind;
  compilerVersion: string;
  /** Never throws. */
  run(card: OracleCard): CardRun;
}

const COVERAGE_TAG = 'wp25-coverage';

/** The normalized lines of a face for hydrating manual text (only display text depends on it). */
export function faceLines(text: string): FaceLines {
  const lines = text.split(/\r\n|\r|\n/);
  return { lines, sentences: lines.map((l) => l.split(/(?<=\.)\s+(?=\S)/)) };
}

function sourceOf(faces: readonly { abilities: AbilityDef[] }[]): CardAutomation['source'] {
  const live = faces.flatMap((f) => f.abilities).filter((a) => a.kind !== 'manual');
  if (live.some((a) => a.kind !== 'keyword')) return 'templates';
  if (live.length > 0) return 'keywords-only';
  return faces.some((f) => f.abilities.length > 0) ? 'none' : 'templates';
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The card-level lint errors of compiled faces (design 6.1 step 8: `validateCardAbilities`; an unlinked consumer, CR 607.1; a second spell ability). */
export function cardLintErrors(faces: readonly { abilities: AbilityDef[] }[]): Issue[] {
  return validateCardAbilities(faces.map((f) => ({ abilities: f.abilities }))).filter((i) => i.severity === 'error');
}

const POINTER = /^\/faces\/(\d+)\/abilities\/(\d+)(.*)$/;
const SHAPE: Readonly<Record<string, 'spell' | 'activated' | 'triggered' | 'static' | 'unknown'>> = {
  spell: 'spell', activated: 'activated', triggered: 'triggered', chapter: 'triggered', static: 'static', keyword: 'static', classLevel: 'static', levelBracket: 'static',
};

function plainManual(a: AbilityDef, reason: string): AbilityDef {
  const r = a as unknown as Record<string, unknown>;
  const shape = a.kind === 'manual' ? ((r['shape'] as string | undefined) ?? 'unknown') : (SHAPE[a.kind] ?? 'unknown');
  const out: Record<string, unknown> = { kind: 'manual', text: typeof r['text'] === 'string' ? r['text'] : '', shape, reason };
  for (const k of ['src', 'label', 'prov']) if (r[k] !== undefined) out[k] = r[k];
  return out as unknown as AbilityDef;
}

/**
 * Design 6.1 step 8 and 10.2 ("the abilities of a face are degraded together"): the card-level lint runs on the degraded faces, and every node it finds
 * in error becomes manual through the degrade pass (a `taint` culprit: the step that reads the link, or the whole ability when the node is not inside a
 * step). `degradeAbilities` only taints a consumer whose producer it demoted itself; a consumer whose link no ability EVER produced (a template that
 * drops `link`, CR 607.2a: Fiend Hunter's exile) is caught here, so a card is never classified as automating a return that reads nothing. Repeated
 * until the lint is clean (a ManualAbilityDef may keep an effect that still reads the link); an ability the pass cannot fix becomes a plain manual
 * ability (no automated cost or effect kept).
 */
export function enforceCardLint<F extends { abilities: AbilityDef[] }>(faces: readonly F[], lines: readonly FaceLines[]): F[] {
  let out = faces.map((f) => ({ ...f, abilities: [...f.abilities] }));
  for (let round = 0; round < 6; round++) {
    const issues = cardLintErrors(out);
    if (issues.length === 0) return out;
    const culprits = new Map<string, Culprit[]>();
    for (const i of issues) {
      const m = POINTER.exec(i.path);
      // an issue about the card as a whole (no face) has no ability to demote; it cannot occur on a compiled card with faces
      if (!m) continue;
      const key = `${m[1]}/${m[2]}`;
      culprits.set(key, [...(culprits.get(key) ?? []), { path: m[3]!, taint: `card lint (design 6.1 step 8): ${i.message}` }]);
    }
    const last = round === 5;
    let changed = false;
    out = out.map((f, fi) => ({
      ...f,
      abilities: f.abilities.map((a, ai) => {
        const cs = culprits.get(`${fi}/${ai}`);
        if (!cs) return a;
        const reason = cs.map((c) => c.taint!).join('; ');
        const next = last || cs.some((c) => c.path === '') ? plainManual(a, reason) : degradeWith(a, cs, lines[fi] ?? { lines: [], sentences: [] });
        if (JSON.stringify(next) === JSON.stringify(a)) return plainManual(a, reason); // the pass could not demote the node in place
        changed = true;
        return next;
      }),
    }));
    if (!changed) break;
  }
  return out;
}

/** The fallback path (design 6.1 steps 8-9 without packs or LLM data): parse -> degrade per face -> classify. */
export function compileFromParse(card: OracleCard, parse: ParseResult, caps: CapabilitySet, compilerVersion: string): { def: CardDef | null; error?: string } {
  let next = 0;
  const compiler: AbilityCompiler = (face) => {
    const f = parse.faces[next++];
    const text = face.oracleText.trim();
    if (f) return { abilities: f.abilities, unsupported: [] };
    return text ? { abilities: [{ kind: 'manual', shape: 'unknown', text, reason: 'coverage: no parsed face for this face' }], unsupported: [text] } : { abilities: [], unsupported: [] };
  };
  let shell: CardDef;
  try {
    shell = compileCard(card, compiler);
  } catch (e) {
    return { def: null, error: `compileCard: ${message(e)}` };
  }
  if (next !== parse.faces.length) {
    // the parser and the face shell disagree on the faces: nothing of the parse is attributed to a face it may not belong to
    const faces = shell.faces.map((f) => ({ ...f, abilities: f.oracleText.trim() ? [{ kind: 'manual', shape: 'unknown', text: f.oracleText, reason: 'coverage: the parser and the compiler disagree on the faces' } as AbilityDef] : [] }));
    shell = { ...shell, faces };
  }
  const lines = shell.faces.map((f) => faceLines(f.oracleText));
  const degraded = shell.faces.map((f, k) => degradeAbilities(f.abilities, caps, lines[k]!));
  const faces = enforceCardLint(shell.faces.map((f, k) => ({ ...f, abilities: degraded[k]!.abilities })), lines);
  const experimental = [...new Set(parse.faces.flatMap((f) => f.experimental))];
  const automation = classifyCard({ faces: faces.map((f, k) => ({ abilities: f.abilities, lines: lines[k]! })), source: sourceOf(faces), ...(experimental.length ? { experimentalTemplates: experimental } : {}) }, caps);
  const requires = new Set([...(automation.requiresEngine ?? []), ...degraded.flatMap((d) => d.requires)]);
  const full: CardAutomation = { ...automation, compilerVersion };
  if (requires.size > 0) full.requiresEngine = [...requires].sort();
  return { def: { ...shell, faces, automation: full } };
}

const isWp18Stub = (e: unknown): boolean => message(e).includes('not implemented: WP18');

export function createCoverageEngine(opts: CoverageEngineOptions = {}): CoverageEngine {
  if (opts.templates === undefined) return gameEngine(opts);
  const caps = opts.caps ?? ENGINE_CAPABILITIES;
  const parseOptions = defaultParseOptions({ templates: [...opts.templates], capabilities: caps });
  const compilerVersion = `${PARSER_VERSION}+${COVERAGE_TAG}`;
  const sources: CompileSources = { parse: parseOptions, keywords: keywordRegistry, caps, trust: 'off', compilerVersion };
  let kind: PipelineKind | undefined = opts.forceFallback ? 'parse+degrade (WP18 not merged)' : undefined;

  const manualRun = (card: OracleCard, parse: ParseResult, error: string): CardRun => ({ card, parse, def: null, level: 'manual', requiresEngine: [], error });

  const run = (card: OracleCard): CardRun => {
    let parse: ParseResult;
    try {
      parse = parseCard(card, parseOptions);
    } catch (e) {
      // contract C1 says parseCard never throws; if it does, the card is manual and the report shows why
      return manualRun(card, { faces: [], parserVersion: PARSER_VERSION }, `parseCard threw (contract C1): ${message(e)}`);
    }
    if (kind !== 'parse+degrade (WP18 not merged)') {
      try {
        const def = compileCardV2(card, sources);
        kind = 'compileCardV2';
        return { card, parse, def, level: def.automation.level, requiresEngine: [...(def.automation.requiresEngine ?? [])] };
      } catch (e) {
        if (kind === undefined && isWp18Stub(e)) kind = 'parse+degrade (WP18 not merged)';
        else return manualRun(card, parse, `compileCardV2 threw (contract C1): ${message(e)}`);
      }
    }
    const r = compileFromParse(card, parse, caps, compilerVersion);
    if (!r.def) return manualRun(card, parse, r.error ?? 'no definition');
    return { card, parse, def: r.def, level: r.def.automation.level, requiresEngine: [...(r.def.automation.requiresEngine ?? [])] };
  };

  return { caps, parseOptions, compilerVersion, pipeline: () => kind ?? 'compileCardV2', run };
}

/** The coverage engine of the game path: every card through `compileCard(card)`, the parse with the default compiler's own parse options. */
function gameEngine(opts: CoverageEngineOptions): CoverageEngine {
  if (opts.caps !== undefined || opts.forceFallback) throw new Error('the game-path coverage engine compiles with the default compiler sources: pass `templates` for another configuration');
  const sources = defaultCompileSources();
  const run = (card: OracleCard): CardRun => {
    let parse: ParseResult;
    try {
      parse = parseCard(card, sources.parse);
    } catch (e) {
      return { card, parse: { faces: [], parserVersion: PARSER_VERSION }, def: null, level: 'manual', requiresEngine: [], error: `parseCard threw (contract C1): ${message(e)}` };
    }
    try {
      const def = compileCard(card);
      return { card, parse, def, level: def.automation.level, requiresEngine: [...(def.automation.requiresEngine ?? [])] };
    } catch (e) {
      return { card, parse, def: null, level: 'manual', requiresEngine: [], error: `compileCard threw (contract C1): ${message(e)}` };
    }
  };
  return { caps: sources.caps, parseOptions: sources.parse, compilerVersion: COMPILER_VERSION, pipeline: () => GAME_PIPELINE, run };
}
