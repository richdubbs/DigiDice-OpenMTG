/**
 * cards/: the compile pipeline that turns an OracleCard into a CardDef, and the card-pool contract. Owner: WP18 (pipeline), WP24 (pool).
 *
 * Files:
 *   cards/compile.ts       existing; keeps parseTypeLine/compileCard(card, compiler) signature, the default compiler becomes the pipeline (compileCardV2)
 *   cards/pipeline.ts      this file: compileCardV2 and the AbilityCompiler built on it
 *   cards/faces.ts         faces and card shell (layouts, type lines, costs, colors), shared by both compile paths (WP18 layout addition)
 *   cards/face-text.ts     the front end's view of a face and its FaceLines (hydration, degrade) (WP18 layout addition)
 *   cards/native.ts        milestone 3/4 recognizers kept as the lowest source until the template packages cover their lines (WP18 layout addition)
 *   cards/pack.ts          loading and validating pack / LLM-cache entries
 *   cards/target-ids.ts    target ids unique across a split card's halves (CR 702.102d) (WP18 layout addition)
 *   cards/pool.ts          stubCardDef, imageSlots, tokenDefFor (predefined tokens table), unsanctioned flags
 *   cards/spans.ts         ledger -> display spans per ability (UI painting of automated/manual text)
 *   cards/basic-compiler.ts (milestone 4) is superseded by this pipeline and removed in WP18; cards/keywords.ts stays as long as cards/native.ts needs it
 *
 * Precedence per FACE (updates.md, refined): pack entry whose textHash matches > parser; then trusted LLM entries overlay ONLY the
 * units the parser left manual (same sentence indices), never a unit the parser accepted. If an overlay and the parser both
 * produced a unit and their canonical JSON differs, the parser wins and the entry is flagged `templates:disagree`.
 *
 * WP18 refinements (recorded here because the contract above is terse):
 *   - A "unit" is the set of the face's abilities with the same `src` lines: ONE ability, or one keyword line (its keyword abilities and manual items,
 *     CR 702). Foreign data (pack, LLM) must keep that shape: a group of two non-keyword abilities for a line, or a line claimed by two units, is refused
 *     (it would be played twice: a trigger triggering twice); a whole pack face must also claim every non-empty line of the face (`report.pack:
 *     'coverage'`, the parser drives the face): nothing of the card's text silently disappears (design 10.3: full means every unit understood).
 *   - An overlay unit replaces the parser's only when the parser left every one of its abilities manual at the level of design 10.3 (nothing but costs or
 *     targets understood), judged on the parser's own output BEFORE the capability degrade: a unit the parser understood but this build cannot run is
 *     "unavailable" (10.1), not parser-manual, and is never replaced. A partly automated unit is never overlaid (step-level repair overlays are not
 *     implemented: the parser wins): an entry that agrees with what the parser accepted is reported as not applied (`notApplied`, 'repair overlays
 *     unsupported'), one that contradicts an accepted step or sentence is a disagreement.
 *   - Below the parser, before the LLM overlay, the native recognizers of milestones 3/4 (cards/native.ts) may replace the abilities of a single line
 *     whose parser abilities are not all fully automated (manual or PARTLY automated) or used an experimental template (W3b), when their reading of the WHOLE line passes the lint, the exact
 *     render gate (decision D14: never loosened for a source) and the degrade and is then fully automated. Lines they read but the gate rejected are
 *     listed in `CompileReport.faces[].nativeUngated` (WP25's false-reject metric) and keep the parser's abilities.
 *   - Every pack or LLM ability goes through the parser's own lint and exact render gate (parser/lower/verify.ts) before the degrade pass, a keyword
 *     line as a whole (render/gate.ts#renderGateKeywordLine); a failure makes it a manual ability with the first message.
 *   - A split card's halves get distinct target ids (cards/target-ids.ts), so a fused split spell is one ability with unique ids (CR 702.102d).
 *   - The text of a manual ability that alone owns its lines is the printed line (the card's name, not "~"): players read it, and the engine's checks on
 *     manual text (an unchecked casting restriction, CR 601.3; enters with counters, CR 614.1c, `entersWithCounters`) read that wording.
 *   - Card caps: layouts the engine does not implement (design 12.4, `LAYOUT_CAPS`), Alchemy digital-only cards (`set_type: 'alchemy'`, design 10.4,
 *     10.6) and an unknown mana symbol (CR 107.4: the engine can't cast the card, CR 202.1b)
 *     make the card manual AND demote every ability with the cap's reason, as `forceManual` does: the level, the abilities' statuses and the spans agree
 *     and nothing runs by itself on a card the player was told to resolve by hand.
 *   - An enchant keyword whose filter names a zone other than the battlefield ("Enchant creature card in a graveyard", CR 702.5a, 303.4a) is manual
 *     (`needs-engine: feature:enchant.zone`): the engine attaches Auras to permanents only.
 */
import type { AbilityDef, KeywordAbilityDef, ManualAbilityDef } from '../types/ability';
import type { CardAutomation, ReviewState } from '../types/automation';
import type { CardDef, FaceDef, OracleCard } from '../types/card';
import type { StoredAbility, CapabilitySet, FaceLines } from '../model/api';
import type { ParseOptions, FaceParse } from '../parser/types';
import type { KeywordRegistry } from '../keywords/types';
import type { RenderContext } from '../render/api';
import { canonicalize } from '../model/canonical';
import { classifyAbility, classifyCard, manualNodes } from '../model/classify';
import { capabilitiesOfDef } from '../model/cap-walk';
import { degradeAbilities } from '../model/degrade-card';
import { textHash } from '../model/hash';
import { validateAbility } from '../model/validate';
import { cardHasXCost, cyclingHasX, parseCard } from '../parser/parse';
import { renderGate, renderGateKeywordLine } from '../render/gate';
import { demote, verifyAbility } from '../parser/lower/verify';
import { markUnsanctioned } from './unsanctioned';
import { LAYOUT_SUPPORT } from './layout-support';
import { variableCounterText } from './variable-counters';
import { buildFaces, cardShell, type BadCost, type FaceBase } from './faces';
import { cardFaceTexts, type FaceText } from './face-text';
import { flagEntersWithCounters, nativeLine } from './native';
import { hydrateEntryFace, unusableReason, type Unusable } from './pack';
import { uniqueSplitTargetIds } from './target-ids';
import { copyData } from '../util/copy-data';

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
  /**
   * Not read by compileCardV2: the parser reads the registry's keywords from `parse.keywords` (ParseOptions), and the capability degrade reads `caps`.
   * Kept in the contract for the tools that build prompts and packs from the same sources (WP26, WP27).
   */
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

/** The additions to CardDef this pipeline relies on (`automation: CardAutomation`, `stub`, `unsanctioned`) were merged into types/card.ts by WP0. */

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
  /** Index in FaceDef.abilities; -1 for text no ability of the face claims (painted manual, reason "no ability of the card claims this text"). */
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

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The pipeline (WP18)
// ---------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Layouts whose structure the engine does not implement yet (design 12.4, "level until supported: manual"): the card is `manual` whatever its text
 * says, so a meld, a mutate or a plane is never shown as automated while the structural rule is missing. M6-0 (m6 design 2.6): a layout a package lists in
 * cards/layout-support.ts#LAYOUT_SUPPORT is lifted from the caps (none in M6-0).
 */
const LAYOUT_CAP_REASONS: Readonly<Record<string, string>> = {
  meld: 'layout meld: melding (CR 701.42, 712.4) is not implemented',
  mutate: 'layout mutate: merged permanents (CR 730) are not implemented',
  prototype: 'layout prototype: prototyped characteristics (CR 718) are not implemented',
  case: 'layout case: solving a Case (CR 719) is not implemented',
  prepare: 'layout prepare: preparing (CR 722) is not implemented',
  planar: 'layout planar: planes and phenomena (CR 901) are outside deck play',
  scheme: 'layout scheme: schemes (CR 904) are outside deck play',
  vanguard: 'layout vanguard: vanguard (CR 902) is outside deck play',
};
export const LAYOUT_CAPS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(LAYOUT_CAP_REASONS).filter(([layout]) => LAYOUT_SUPPORT[layout] !== true),
);

/** What the pipeline did with a card, beyond the CardDef: for the coverage sweep (WP25), the LLM tool (WP26) and the pack builder (WP27). */
export interface CompileReport {
  textHash: string;
  /**
   * Per face: which source drove it, the lines the native recognizers took, the lines they read completely but the exact render gate rejected (not
   * used: WP25's false-reject metric, D14), the lines an overlay replaced.
   */
  faces: { source: 'pack' | 'parser'; nativeLines: number[]; nativeUngated: number[]; overlaid: number[] }[];
  /** Why a pack or LLM entry for this card was not used (null: used, or none). 'coverage': a whole pack face left a line unclaimed or claimed one twice. */
  pack: Unusable | 'hydrate' | 'coverage' | null;
  llm: Unusable | 'hydrate' | null;
  /** LLM units for which the parser had an accepted unit with different canonical JSON: the parser won; the entry deserves `templates:disagree`. */
  disagreements: { face: number; src: number[] }[];
  /** Units of a pack or LLM entry that were not applied, and why ('repair overlays unsupported', two abilities for one line, ...). `src` [] = the face. */
  notApplied: { face: number; src: number[]; reason: string }[];
  /** Templates the parser used on faces it drove. */
  templatesUsed: string[];
}

const EMPTY_LINES: FaceLines = { lines: [], sentences: [] };

const srcKey = (def: AbilityDef): string => (Array.isArray(def.src) ? def.src.join(',') : '');

const shapeOf = (def: AbilityDef): ManualAbilityDef['shape'] =>
  def.kind === 'manual' ? def.shape : def.kind === 'spell' ? 'spell' : def.kind === 'activated' ? 'activated' : def.kind === 'triggered' ? 'triggered' : def.kind === 'static' || def.kind === 'keyword' ? 'static' : 'unknown';

/**
 * The local kill switch and the card caps (design 10.4, 12.4): every ability becomes manual with `reason` (`forceManual`, or the cap's reason); an
 * activated ability keeps its cost and mana status (the engine still charges the understood cost, CR 605.3b).
 */
function forceManualAbility(def: AbilityDef, reason = 'forceManual'): ManualAbilityDef {
  const m: ManualAbilityDef = def.kind === 'manual' ? { ...def, reason, prov: { by: 'fallback' } } : demote(def, reason);
  delete m.effect; // nothing of a forced card runs by itself, not even the effect of a manual trigger ("Trigger now")
  m.shape = shapeOf(def);
  return m;
}

/** A face the compiler could not read at all (contract C1). */
function errorAbility(text: string, message: string): ManualAbilityDef {
  return { kind: 'manual', text, reason: `parser-error: ${message}`, shape: 'unknown', prov: { by: 'fallback' } };
}

/**
 * A mana cost with a symbol CR 107.4 does not define: the face has no readable mana cost, so the engine can't cast it (CR 202.1b, 118.6) and counts its
 * mana value as 0 although the printed cost has one (CR 202.3). Shape 'static': it is a reminder, never a resolution step of a spell.
 */
export function badCostAbility(bad: BadCost): ManualAbilityDef {
  return {
    kind: 'manual',
    text: `Mana cost ${bad.text}`,
    reason: `unknown mana symbol: ${bad.message} (not in CR 107.4): the engine can't cast this card (CR 202.1b) and doesn't know its mana value (it counts 0, CR 202.3); `
      + 'move it with a manual move (to the battlefield or another zone) and pay its cost by hand',
    shape: 'static',
    prov: { by: 'fallback' },
  };
}

/**
 * W3b: a printed loyalty or defense that is not a number ("X", CR 306.5b, 310.4b; Nissa, Steward of Elements) is set by hand as the permanent enters
 * (core/zones.ts#enterWithPrintedCounters asks), so it is a manual part of the card, shown and classified as one: never a full card that prompts.
 * Its text is the one core/zones.ts gives the prompt (`variableCounterText`).
 */
export function variableCounterAbilities(face: Pick<FaceBase, 'types' | 'loyalty' | 'defense'>): ManualAbilityDef[] {
  const out: ManualAbilityDef[] = [];
  const rows = [
    { type: 'Planeswalker', printed: face.loyalty, counter: 'loyalty' as const, rule: 'CR 306.5b' },
    { type: 'Battle', printed: face.defense, counter: 'defense' as const, rule: 'CR 310.4b' },
  ];
  for (const { type, printed, counter, rule } of rows) {
    if (!face.types.includes(type as never) || printed === undefined || /^\d+$/.test(printed)) continue;
    out.push({
      kind: 'manual', text: variableCounterText(counter, printed), shape: 'static', prov: { by: 'fallback' },
      reason: `variable ${counter} (${rule}): the engine can't set it yet; as the permanent enters, its controller puts the ${counter} counters on it by hand`,
    });
  }
  return out;
}

/** Is an ObjectFilter's zone the battlefield (or unstated, which means the battlefield for an Aura, CR 303.4a)? */
const battlefieldOnly = (zone: unknown): boolean => zone === undefined || zone === 'battlefield' || (Array.isArray(zone) && zone.length === 1 && zone[0] === 'battlefield');

/**
 * Structures the model can say but the engine does not implement and the capability walker does not name: an enchant keyword that names another zone
 * (CR 702.5a, 303.4a; Animate Dead's "Enchant creature card in a graveyard"): rules/attachment.ts attaches Auras to permanents only.
 */
function engineStructure(def: AbilityDef, requires: Set<string>): AbilityDef {
  if (def.kind === 'keyword' && def.keyword === 'enchant' && def.player === undefined && !battlefieldOnly(def.filter?.zone)) {
    requires.add('feature:enchant.zone');
    return demote(def, 'needs-engine: feature:enchant.zone; an Aura that enchants a card outside the battlefield is not implemented (CR 702.5a, 303.4a)');
  }
  return def;
}

function renderCtx(face: FaceBase, otherNames: string[]): RenderContext {
  return { selfNames: [face.name, ...otherNames], selfTypes: face.typeLine.split(/\s+/).filter((w) => w !== '' && w !== '—' && w !== '--' && w !== '-' && w !== '//') };
}

interface FaceEnv {
  face: FaceBase;
  otherNames: string[];
  lines: FaceLines;
  cardHasX: boolean;
  /** CLOUD std-dft: the cycling cost has an X (parser/parse.ts#cyclingHasX). */
  cyclingX: boolean;
  layout: string;
}

/** The Oracle lines (FaceLines: label and reminder text removed, "~" for the name) an ability's `src` names. */
const oracleOf = (def: AbilityDef, env: FaceEnv): string[] => (def.src ?? []).map((i) => env.lines.lines[i] ?? '').filter((l) => l !== '');

/** The units of a list of abilities: `src` key -> indices, in order of first appearance. Abilities without `src` are not units of the card's text. */
function unitsOf(defs: readonly AbilityDef[]): Map<string, number[]> {
  const units = new Map<string, number[]>();
  defs.forEach((d, i) => {
    const key = srcKey(d);
    if (key !== '') units.set(key, [...(units.get(key) ?? []), i]);
  });
  return units;
}

/** A keyword line's item: a keyword ability, or a keyword the parser could not read (a manual static ability, parser/lower/ability.ts#keywordLine). */
const keywordItem = (d: AbilityDef): boolean => d.kind === 'keyword' || (d.kind === 'manual' && d.shape === 'static');

/**
 * Why one unit of foreign data is malformed (null: it is fine). A unit is one ability or one keyword line (CR 702: "Flying, vigilance" is two keyword
 * abilities on one line): two other abilities for the same line(s) would play the line twice (CR 603.2: a trigger would trigger twice).
 */
function unitProblem(group: readonly AbilityDef[]): string | null {
  if (group.length <= 1) return null;
  if (group.some((d) => d.kind === 'keyword') && group.every(keywordItem)) return null;
  return `two abilities for the same line(s) ${srcKey(group[0]!)}: a unit is one ability or one keyword line`;
}

/** Lines claimed by two different units (keys). */
function clashingUnits(keys: Iterable<string>): Set<string> {
  const owner = new Map<number, string>();
  const clash = new Set<string>();
  for (const key of keys) {
    for (const l of key.split(',').map(Number)) {
      const other = owner.get(l);
      if (other !== undefined && other !== key) {
        clash.add(other);
        clash.add(key);
      } else owner.set(l, key);
    }
  }
  return clash;
}

/**
 * Why the abilities of a whole pack face cannot drive the face (null: they can): a malformed unit, a line claimed by two units, or a non-empty line of
 * the face that no ability claims (its behavior would silently disappear, design 10.3).
 */
function faceProblem(defs: readonly AbilityDef[], lines: FaceLines): string | null {
  const units = unitsOf(defs);
  for (const idx of units.values()) {
    const p = unitProblem(idx.map((i) => defs[i]!));
    if (p !== null) return p;
  }
  const clash = clashingUnits(units.keys());
  if (clash.size > 0) return `a line claimed by two units (${[...clash].join(' / ')})`;
  const claimed = new Set([...units.keys()].flatMap((k) => k.split(',').map(Number)));
  const missing = lines.lines.flatMap((l, i) => (l !== '' && !claimed.has(i) ? [i] : []));
  return missing.length > 0 ? `line(s) ${missing.join(',')} claimed by no ability of the entry` : null;
}

/**
 * Lint and gate abilities that did not come from the parser (pack, LLM): the same checks the parser applies to its own (design 6.8 G6, G7). Display text
 * is hydrated per line, so a keyword line ("Flying, vigilance") is gated AS A LINE (render/gate.ts#renderGateKeywordLine, as `nativeStage` does): each
 * of its keywords alone would never render the whole line. A keyword line with a manual item cannot be checked as a whole, so its keywords are manual.
 */
function verifyForeign(defs: AbilityDef[], env: FaceEnv): AbilityDef[] {
  const ctx = renderCtx(env.face, env.otherNames);
  const out = [...defs];
  const asLine = new Set<number>();
  for (const idx of unitsOf(defs).values()) {
    const group = idx.map((i) => defs[i]!);
    if (group.length < 2 || !group.some((d) => d.kind === 'keyword') || !group.every(keywordItem)) continue;
    const oracle = oracleOf(group[0]!, env);
    const keywords = group.filter((d): d is KeywordAbilityDef => d.kind === 'keyword');
    const gate = group.some((d) => d.kind === 'manual') || oracle.length === 0 ? null : renderGateKeywordLine(keywords, oracle, { ...ctx, oracleLines: oracle });
    const why = gate === null ? 'gate-mismatch: a keyword line with a manual item (or no Oracle line) cannot be checked as a whole' : `gate-mismatch: rendered "${gate.rendered}", Oracle "${gate.expected}"`;
    for (const i of idx) {
      asLine.add(i);
      const d = defs[i]!;
      if (d.kind === 'manual') continue;
      out[i] = gate?.ok === true ? lintOnly(d, env) : demote(d, why);
    }
  }
  return out.map((def, i) => {
    if (def.kind === 'manual' || asLine.has(i)) return def;
    const oracle = oracleOf(def, env);
    if (oracle.length === 0) return demote(def, 'gate-mismatch: no Oracle line to check the ability against');
    try {
      return verifyAbility(def, oracle, { ...ctx, oracleLines: oracle }, { cardHasX: env.cardHasX, cyclingX: env.cyclingX, layout: env.layout }).def;
    } catch (e) {
      return demote(def, `lint: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
}

/** Schema and lint only (G7), for keyword items whose line was gated as a whole. */
function lintOnly(def: AbilityDef, env: FaceEnv): AbilityDef {
  const issues = validateAbility(def, { cardHasX: env.cardHasX, ...(env.cyclingX ? { cyclingX: true } : {}), layout: env.layout }).filter((i) => i.severity === 'error');
  return issues.length === 0 ? def : demote(def, `lint: ${issues[0]!.code} at ${issues[0]!.path || '/'}: ${issues[0]!.message}`);
}

/** Not fully automated: an ability is manual or has a manual node (after the capability degrade). */
const notFull = (defs: readonly AbilityDef[], caps: CapabilitySet): boolean =>
  defs.some((d) => d.kind === 'manual') || classifyCard({ faces: [{ abilities: [...defs], lines: EMPTY_LINES }], source: 'templates' }, caps).level !== 'full';

/**
 * The native stage (cards/native.ts): for each single line whose parser abilities are not all fully automated (manual, or PARTLY automated), the
 * milestone 3/4 recognizers' complete reading of the line replaces them if it passes the lint and the exact render gate (G6, decision D14: the gate is
 * never loosened for a source) and is fully automated after the capability degrade. Never touches an ability that spans several lines or a line the
 * parser fully understood. A line the recognizers read but the gate rejected keeps the parser's abilities and is listed in `ungated`.
 */
function nativeStage(abilities: AbilityDef[], original: string, env: FaceEnv, caps: CapabilitySet, experimentalOf: (def: AbilityDef) => readonly string[] = () => []): { abilities: AbilityDef[]; hits: number[]; ungated: number[] } {
  const rawLines = original.split(/\r\n|\r|\n/);
  const byLine = new Map<number, number[]>();
  const multi = new Set<number>();
  abilities.forEach((a, i) => {
    const src = a.src ?? [];
    if (src.length !== 1) {
      src.forEach((l) => multi.add(l));
      return;
    }
    const l = src[0]!;
    byLine.set(l, [...(byLine.get(l) ?? []), i]);
  });
  const replace = new Map<number, AbilityDef[]>();
  const hits: number[] = [];
  const ungated: number[] = [];
  for (const [line, idx] of byLine) {
    if (multi.has(line)) continue;
    // W3b: a line the parser read with an experimental template is offered too (that template caps the card at partial, design 6.9); a gated, fully
    // automated native reading of the whole line wins over it, so a unit milestone 4 automated keeps its full result (guard G10)
    if (!notFull(idx.map((i) => abilities[i]!), caps) && !idx.some((i) => experimentalOf(abilities[i]!).length > 0)) continue;
    const native = nativeLine(rawLines[line] ?? '', env.face.name, line);
    if (native === null) continue;
    // Each ability gets the lint (G7) and the line the exact render gate (G6). The renderer cannot print some of the recognizers' forms yet ("protection
    // from X and from Y", "protection from each color", "legendary landwalk", "Add {R}, {G}, or {W}"): those lines are not taken (a measured false
    // reject, D14) and stay as the parser left them until the template packages add the forms; the report lists them for WP25's false-reject metric.
    const text = (rawLines[line] ?? '').replace(/\s*\([^)]*\)/g, '').trim();
    const ctx: RenderContext = { ...renderCtx(env.face, env.otherNames), oracleLines: [text] };
    const gateOk = native.every((d) => d.kind === 'keyword')
      ? renderGateKeywordLine(native as KeywordAbilityDef[], [text], ctx).ok
      : native.length === 1 && renderGate(native[0]!, [text], ctx).ok;
    if (!gateOk) {
      ungated.push(line);
      continue;
    }
    const checked = native.map((d) => lintOnly(d, env));
    const degraded = degradeAbilities(checked, caps, env.lines).abilities;
    if (notFull(degraded, caps)) continue;
    replace.set(idx[0]!, degraded);
    for (const i of idx.slice(1)) replace.set(i, []);
    hits.push(line);
  }
  if (replace.size === 0) return { abilities, hits: [], ungated: ungated.sort((a, b) => a - b) };
  const out: AbilityDef[] = [];
  abilities.forEach((a, i) => out.push(...(replace.get(i) ?? [a])));
  return { abilities: out, hits: hits.sort((a, b) => a - b), ungated: ungated.sort((a, b) => a - b) };
}

/** The meaning of an ability, for agreement checks: canonical form without provenance or display text. */
function comparable(def: AbilityDef): string {
  let c: AbilityDef;
  try {
    c = canonicalize(def);
  } catch {
    c = def;
  }
  return JSON.stringify(c, (k, v: unknown) => (k === 'prov' || k === 'text' || k === 'span' || k === 'label' ? undefined : v));
}

/**
 * Did the parser leave this ability manual (design 10.3: a manual ability, or one whose only understood parts are costs and targets)? Judged on the
 * parser's own output, BEFORE the capability degrade (design 10.1: a node the parser understood but this build lacks is "unavailable", not manual;
 * the degrade of step [8] makes it manual later, and an overlay must not take its place, 11.1).
 */
function parserLeftManual(def: AbilityDef): boolean {
  if (def.kind === 'manual') return true;
  return classifyAbility(def, new Set(capabilitiesOfDef(def))).level === 'manual';
}

/** JSON pointers of an ability's manual nodes (model/classify.ts#manualNodes): '/effect/steps/2', '/cost/parts/0', ... */
const manualPaths = (def: AbilityDef): string[] => manualNodes(def).map((m) => m.path);

/** The top-level steps of an ability's effect, if it has one. */
const stepsOf = (def: AbilityDef): Record<string, unknown>[] | null => {
  const effect = (def as { effect?: { steps?: unknown } }).effect;
  return effect && Array.isArray(effect.steps) ? (effect.steps as Record<string, unknown>[]) : null;
};

/**
 * Do the parts the parser ACCEPTED in `p` agree with the overlay's `o` (design 11.1: the parser wins where it understood)? The skeleton (everything but
 * the effect's steps) is compared when the parser has no manual node in it; the steps are compared sentence by sentence (`StepBase.sentence`) for
 * every sentence whose parser steps have no manual node, or, without sentence indices, the parser's accepted steps must appear in order among the
 * overlay's. Sentences and steps the parser left manual are what a repair overlay changes: not compared.
 */
function acceptedAgree(p: AbilityDef, o: AbilityDef): boolean {
  if (p.kind !== o.kind) return false;
  const paths = manualPaths(p);
  if (paths.length === 0) return comparable(p) === comparable(o);
  const ps = stepsOf(p);
  const os = stepsOf(o);
  if (ps === null || os === null) return paths.every((x) => x === '') || comparable(p) === comparable(o);
  const skeleton = (d: AbilityDef): string => comparable({ ...d, effect: { ...(d as { effect: object }).effect, steps: [] } } as unknown as AbilityDef);
  if (!paths.some((x) => !x.startsWith('/effect/steps/')) && skeleton(p) !== skeleton(o)) return false;
  const manualStep = (i: number): boolean => paths.some((x) => x === `/effect/steps/${i}` || x.startsWith(`/effect/steps/${i}/`));
  const key = (s: Record<string, unknown>): string => (typeof s['sentence'] === 'number' ? String(s['sentence']) : '-');
  const stepKey = (s: Record<string, unknown>): string => comparable({ kind: 'spell', text: '', effect: { targets: [], steps: [s] } } as unknown as AbilityDef);
  if (ps.every((s) => key(s) === '-')) {
    // no sentence indices: the steps the parser accepted must appear, in order, among the overlay's (a repair replaces or adds only manual steps)
    const theirs = os.map(stepKey);
    let at = 0;
    for (const [i, s] of ps.entries()) {
      if (manualStep(i)) continue;
      const k = stepKey(s);
      while (at < theirs.length && theirs[at] !== k) at++;
      if (at === theirs.length) return false;
      at++;
    }
    return true;
  }
  const touched = new Set(ps.flatMap((s, i) => (manualStep(i) ? [key(s)] : [])));
  const bySentence = (steps: Record<string, unknown>[], k: string): string => steps.filter((s) => key(s) === k).map(stepKey).join('\n');
  return [...new Set(ps.map(key))].filter((k) => !touched.has(k)).every((k) => bySentence(ps, k) === bySentence(os, k));
}

/** The parser's unit against the overlay's: 'same' (nothing to do), 'repair' (agrees with what the parser accepted, changes what it left manual), 'disagree'. */
function compareUnit(mine: readonly AbilityDef[], group: readonly AbilityDef[]): 'same' | 'repair' | 'disagree' {
  if (mine.map(comparable).join('\n') === group.map(comparable).join('\n')) return 'same';
  if (mine.length === 1 && group.length === 1) return acceptedAgree(mine[0]!, group[0]!) ? 'repair' : 'disagree';
  // a keyword line (several abilities): every ability the parser accepted must be in the overlay, a partly accepted one must agree with one of it
  const theirs = group.map(comparable);
  const ok = mine.every((a) => a.kind === 'manual' || (manualPaths(a).length === 0 ? theirs.includes(comparable(a)) : group.some((o) => acceptedAgree(a, o))));
  return ok && mine.some((a) => manualPaths(a).length > 0) ? 'repair' : 'disagree';
}

/**
 * The overlay of one face (design 11.1): the overlay's units (abilities with the same `src` lines) replace the parser's only when the parser left every
 * one of its abilities manual (`parserLeftManual`, before the degrade). A malformed unit (two abilities for one line, a line claimed by two units) is
 * not applied. Where the parser accepted something, the parser wins: an overlay that agrees with the accepted parts and only changes manual ones is a
 * repair (not implemented: reported in `notApplied`), one that contradicts an accepted part is a disagreement (the entry deserves `templates:disagree`).
 * `covers` limits the overlay to the listed lines. `_caps` is unused since the parser-manual decision is made before the degrade (kept for the signature).
 */
export function overlayFace(parser: readonly AbilityDef[], overlay: readonly AbilityDef[], _caps: CapabilitySet, covers?: readonly { line: number; sentence: number }[]): {
  abilities: AbilityDef[];
  overlaid: number[];
  disagreements: number[][];
  notApplied: { src: number[]; reason: string }[];
} {
  const groups = new Map<string, AbilityDef[]>();
  for (const a of overlay) groups.set(srcKey(a), [...(groups.get(srcKey(a)) ?? []), a]);
  const clash = clashingUnits([...groups.keys()].filter((k) => k !== ''));
  const coveredLines = covers ? new Set(covers.map((c) => c.line)) : undefined;
  let out = [...parser];
  const overlaid: number[] = [];
  const disagreements: number[][] = [];
  const notApplied: { src: number[]; reason: string }[] = [];
  for (const [key, group] of groups) {
    if (key === '') continue; // an ability without src is not a unit of the card's text
    const src = group[0]!.src!;
    if (coveredLines && !src.every((l) => coveredLines.has(l))) continue;
    const idx = out.map((a, i) => (srcKey(a) === key ? i : -1)).filter((i) => i >= 0);
    if (idx.length === 0) continue;
    const problem = clash.has(key) ? 'a line claimed by two units of the entry' : unitProblem(group);
    if (problem !== null) {
      notApplied.push({ src: [...src], reason: problem });
      continue;
    }
    const mine = idx.map((i) => out[i]!);
    if (mine.every(parserLeftManual)) {
      const first = idx[0]!;
      const drop = new Set(idx);
      out = out.flatMap((a, i) => (i === first ? [...group] : drop.has(i) ? [] : [a]));
      overlaid.push(...src);
      continue;
    }
    if (group.every((a) => a.kind === 'manual')) {
      // the parser accepted something; the entry has nothing automated for the unit (or its gate failed in verifyForeign): nothing to disagree with
      notApplied.push({ src: [...src], reason: `the entry has no automated ability for this unit (${(group[0] as ManualAbilityDef).reason})` });
      continue;
    }
    const verdict = compareUnit(mine, group);
    if (verdict === 'disagree') disagreements.push([...src]);
    else if (verdict === 'repair') notApplied.push({ src: [...src], reason: 'repair overlays unsupported' });
  }
  return { abilities: out, overlaid: [...new Set(overlaid)].sort((a, b) => a - b), disagreements, notApplied };
}

function withProv(defs: AbilityDef[], by: 'pack' | 'llm', id: string, reviewed: boolean): AbilityDef[] {
  return defs.map((d) => ({ ...d, prov: { by, id, ...(reviewed ? { reviewed: true } : {}) } }) as AbilityDef);
}

const hasX = (card: OracleCard): boolean => cardHasXCost(card);

function sourceOf(usedPack: boolean, usedLlm: boolean, faces: readonly { abilities: AbilityDef[] }[]): CardAutomation['source'] {
  if (usedPack) return 'pack';
  if (usedLlm) return 'llm-cache';
  const live = faces.flatMap((f) => f.abilities).filter((a) => a.kind !== 'manual');
  if (live.some((a) => a.kind !== 'keyword')) return 'templates';
  if (live.length > 0) return 'keywords-only';
  return faces.some((f) => f.abilities.length > 0) ? 'none' : 'templates';
}

/** The weakest review state of the entries that drove the card (undefined when none did). */
function weakestReview(states: readonly ReviewState[]): ReviewState | undefined {
  const order: ReviewState[] = ['rejected', 'unreviewed', 'autoverified', 'reviewed'];
  let best: ReviewState | undefined;
  for (const s of states) if (best === undefined || order.indexOf(s) < order.indexOf(best)) best = s;
  return best;
}

const packReview = (e: CompiledCardEntry): ReviewState => (e.source === 'hand' && e.review !== 'rejected' ? 'reviewed' : e.review);

/** compileCardV2 with what it did (for tools: coverage, LLM, packs). Total: never throws. */
export function compileCardDetailed(card: OracleCard, src: CompileSources): { def: CardDef; report: CompileReport } {
  let out: { def: CardDef; report: CompileReport };
  try {
    out = compileInner(card, src);
  } catch (e) {
    out = compileFallback(card, src, e);
  }
  // WP24 (W3 integration): a card the rules do not cover (CR 100.7), flagged `unsanctioned` by the card index, is manual-only apart from its keywords
  // (design 12.3, types/card.ts#OracleCard.unsanctioned), on every compile path.
  return (card as OracleCard | null)?.unsanctioned === true ? { ...out, def: markUnsanctioned(out.def) } : out; // `card` may be malformed, even null (C1)
}

function compileInner(card: OracleCard, src: CompileSources): { def: CardDef; report: CompileReport } {
  const shell = cardShell(card);
  const built = buildFaces(card);
  const hash = textHash(built.faces.map((f) => f.oracleText));
  const parsed = parseCard(card, src.parse);
  const cardHasX = hasX(card);
  const cyclingX = cyclingHasX(card);
  const forced = src.forceManual !== undefined && [card.name, ...built.faces.map((f) => f.name)].some((n) => src.forceManual!.has(n));
  const oracleId = typeof card.oracle_id === 'string' ? card.oracle_id : undefined;
  const packEntry = oracleId !== undefined ? src.pack?.get(oracleId) : undefined;
  const llmEntry = oracleId !== undefined ? src.llm?.get(oracleId) : undefined;
  const packUnusable = packEntry ? unusableReason(packEntry, hash, built.faces.length, src.trust, 'pack') : null;
  const llmUnusable = llmEntry ? unusableReason(llmEntry, hash, built.faces.length, src.trust, 'llm') : null;
  // The front end's FaceLines are needed only to hydrate and gate stored entries (the parser's own abilities carry their text): skip the second read otherwise.
  const texts: FaceText[] = (packEntry && packUnusable === null) || (llmEntry && llmUnusable === null) ? cardFaceTexts(card, src.parse) : [];
  const report: CompileReport = { textHash: hash, faces: [], pack: packUnusable, llm: llmUnusable, disagreements: [], notApplied: [], templatesUsed: [] };
  const requires = new Set<string>();
  for (const [entry, why] of [[packEntry, packUnusable], [llmEntry, llmUnusable]] as const) {
    if (entry && why === 'model') requires.add(`model:${entry.modelVersion}`); // an entry for a newer engine: listed, never used (contract above)
  }
  const caps = cardCaps(card, built.faces, built.badCosts);
  caps.forEach((c) => c.requires && requires.add(c.requires));
  const reviews: ReviewState[] = [];
  const experimental: string[] = [];
  let usedPack = false;
  let usedLlm = false;

  const compiled: FaceDef[] = built.faces.map((base, i) => {
    const env: FaceEnv = { face: base, otherNames: built.multi ? built.faces.filter((_, j) => j !== i).map((f) => f.name) : [], lines: texts[i]?.lines ?? EMPTY_LINES, cardHasX, cyclingX, layout: card.layout };
    const fp: FaceParse | undefined = parsed.faces[i];
    let abilities: AbilityDef[];
    let source: 'pack' | 'parser' = 'parser';
    let nativeLines: number[] = [];
    let nativeUngated: number[] = [];
    let overlaid: number[] = [];

    // [0] lookup: a pack entry whose textHash matches wins for the face, if it claims every line of the face exactly once (design 10.3, 12.5)
    let fromPack = packEntry && packUnusable === null ? hydrateEntryFace(packEntry, i, env.lines, hash) : null;
    if (packEntry && packUnusable === null && fromPack === null) report.pack = 'hydrate';
    const wholeFace = fromPack !== null && packEntry !== undefined && packEntry.faces[i]?.covers === undefined;
    const problem = wholeFace ? faceProblem(fromPack!, env.lines) : null;
    if (problem !== null) {
      report.pack = 'coverage';
      report.notApplied.push({ face: i, src: [], reason: problem });
      fromPack = null; // the parser drives the face
    }
    if (fromPack !== null && packEntry && wholeFace) {
      abilities = verifyForeign(withProv(fromPack, 'pack', packEntry.oracleId, packReview(packEntry) === 'reviewed'), env);
      source = 'pack';
      usedPack = true;
      reviews.push(packReview(packEntry));
    } else {
      // [1-7] the parser; a face it returns nothing for is one manual ability (contract C1)
      // P1: the parser's abilities are COPIED: parse results are shared and deep-frozen by the parse memo (parser/parse-memo.ts), and a compiled
      // definition is its caller's own mutable data, as it was before P1 (cards/compile-memo.ts states the contract)
      abilities = fp ? fp.abilities.map(copyData) : base.oracleText.trim() !== '' ? [errorAbility(base.oracleText, 'the parser returned no result for this face')] : [];
      // W3b: the experimental templates each parser ability used (by identity: the stages below keep the objects they do not replace)
      const expOf = new Map<AbilityDef, readonly string[]>();
      let unattributed: string[] = [];
      if (fp) {
        abilities.forEach((a, k) => expOf.set(a, fp.experimentalBy?.[k] ?? fp.experimental)); // keyed by the copies, which the stages below see
        const attributed = new Set(fp.experimentalBy ? fp.experimentalBy.flat() : fp.experimental);
        unattributed = fp.experimental.filter((t) => !attributed.has(t));
        for (const t of fp.templatesUsed) if (!report.templatesUsed.includes(t)) report.templatesUsed.push(t);
      }
      // a pack face that covers only some units overlays like LLM data, under the same rule
      if (fromPack !== null && packEntry) {
        const ov = overlayFace(abilities, verifyForeign(withProv(fromPack, 'pack', packEntry.oracleId, packReview(packEntry) === 'reviewed'), env), src.caps, packEntry.faces[i]?.covers);
        abilities = ov.abilities;
        overlaid = ov.overlaid;
        for (const d of ov.disagreements) report.disagreements.push({ face: i, src: d });
        for (const n of ov.notApplied) report.notApplied.push({ face: i, ...n });
        if (ov.overlaid.length > 0) {
          usedPack = true;
          reviews.push(packReview(packEntry));
        }
      }
      // the native recognizers of milestones 3/4 for single lines the parser did not fully automate (cards/native.ts)
      const nat = nativeStage(abilities, base.oracleText, env, src.caps, (a) => expOf.get(a) ?? []);
      abilities = nat.abilities;
      nativeLines = nat.hits;
      nativeUngated = nat.ungated;
      // trusted LLM entries overlay ONLY the units the parser left manual (design 11.1)
      if (llmEntry && llmUnusable === null) {
        const fromLlm = hydrateEntryFace(llmEntry, i, env.lines, hash);
        if (fromLlm === null) report.llm = 'hydrate';
        else {
          const ov = overlayFace(abilities, verifyForeign(withProv(fromLlm, 'llm', llmEntry.oracleId, llmEntry.review === 'reviewed'), env), src.caps, llmEntry.faces[i]?.covers);
          abilities = ov.abilities;
          overlaid = [...new Set([...overlaid, ...ov.overlaid])].sort((a, b) => a - b);
          for (const d of ov.disagreements) report.disagreements.push({ face: i, src: d });
          for (const n of ov.notApplied) report.notApplied.push({ face: i, ...n });
          if (ov.overlaid.length > 0) {
            usedLlm = true;
            reviews.push(llmEntry.review);
          }
        }
      }
      // the experimental cap (design 6.9) counts the templates of the parser abilities that are still played
      for (const t of [...unattributed, ...abilities.flatMap((a) => expOf.get(a) ?? [])]) if (!experimental.includes(t)) experimental.push(t);
    }

    abilities = abilities.map((a) => engineStructure(a, requires));
    // card caps (design 10.4, 12.4, CR 709.5, 202.1b): every printed ability is manual with the first cap's reason, nothing runs by itself
    if (caps.length > 0) abilities = abilities.map((a) => forceManualAbility(a, caps[0]!.reason));
    abilities.push(...variableCounterAbilities(base)); // W3b: appended after the printed abilities (their keys stay p:<face>:<index>)
    const bad = built.badCosts[i];
    if (bad) {
      abilities.push(badCostAbility(bad)); // appended: the printed abilities keep their keys (p:<face>:<index>)
      requires.add(`mana:${bad.message.replace(/^Unknown mana symbol /, '')}`);
    }
    if (forced) abilities = abilities.map((a) => forceManualAbility(a));
    // [8] capability degrade: understood nodes this engine build cannot run become manual (design 10.2); a face's links are degraded together (CR 607)
    const degraded = degradeAbilities(abilities, src.caps, env.lines);
    degraded.requires.forEach((c) => requires.add(c));
    abilities = printedManualTexts(degraded.abilities, base.oracleText).map(flagEntersWithCounters);
    report.faces.push({ source, nativeLines, nativeUngated, overlaid });
    return { ...base, abilities };
  });

  // a fused split spell is one spell (CR 702.102d): its halves' target ids must not collide (cards/target-ids.ts)
  const faces = card.layout === 'split' ? uniqueSplitTargetIds(compiled) : compiled;

  // [9] classify (design 10.3), with the caps of 10.4 (forceManual, experimental templates, unreviewed data) and 12.4 (layouts)
  const review = weakestReview(reviews);
  const automation = classifyCard(
    {
      faces: faces.map((f, i) => ({ abilities: f.abilities, lines: texts[i]?.lines ?? EMPTY_LINES })),
      source: sourceOf(usedPack, usedLlm, faces),
      ...(review !== undefined ? { review } : {}),
      textHash: hash,
      forceManual: forced,
      experimentalTemplates: experimental,
    },
    src.caps,
  );
  applyCaps(automation, caps, requires);
  automation.compilerVersion = src.compilerVersion;
  return { def: { ...shell, faces, automation }, report };
}

/** Line `text` as printed, reminder text (CR 207.2a) and the ability word `label` removed, spaces collapsed; null when nothing is left. */
function printedLine(text: string | undefined, label: string | undefined): string | null {
  if (text === undefined) return null;
  let t = text.replace(/\s*\([^()]*\)/g, '').replace(/\s+/g, ' ').trim();
  if (label !== undefined && t.startsWith(label)) t = t.slice(label.length).replace(/^\s*(?:—|–|-{1,2})\s*/, '').trim();
  return t === '' ? null : t;
}

/**
 * A manual ability is read by a player, so its text is the line as printed (the card's own name, not "~"; reminder text and the label removed), as
 * milestone 4 showed it; the engine's text checks on manual abilities (an unchecked casting restriction, CR 601.3; "enters with counters", CR 614.1c)
 * read that wording. Only for a manual ability that is the sole ability of its lines: a manual keyword item next to an automated one keeps its own words.
 */
function printedManualTexts(abilities: AbilityDef[], original: string): AbilityDef[] {
  const raw = original.split(/\r\n|\r|\n/); // the parser's line indices: normalization keeps the lines (parser/front/text.ts)
  const owners = new Map<number, number>();
  for (const a of abilities) for (const l of a.src ?? []) owners.set(l, (owners.get(l) ?? 0) + 1);
  return abilities.map((a) => {
    if (a.kind !== 'manual' || !a.src || a.src.length === 0 || a.src.some((l) => owners.get(l) !== 1)) return a;
    const lines = a.src.map((l) => printedLine(raw[l], a.label));
    return lines.every((l): l is string => l !== null) ? { ...a, text: lines.join('\n') } : a;
  });
}

/** A card cap: why the whole card is manual, and the engine feature it waits for (if any). */
interface CardCap {
  reason: string;
  requires?: string;
}

export const ALCHEMY_CAP = 'digital-only (Alchemy): not part of the Comprehensive Rules (design 10.4, 10.6)';

/**
 * The caps that make a whole card manual (design 10.4, 10.6, 12.4): a layout the engine does not implement, an Alchemy digital-only card (Scryfall
 * `set_type: 'alchemy'`) and a mana cost the engine cannot read (CR 107.4, 202.1b: it can't cast the card). FAST5X E8: Rooms (split cards with a shared type
 * line, CR 709.5) are no longer capped: the unlocked designations are implemented (core/rooms.ts, rules/base-parts/room.ts).
 */
function cardCaps(card: OracleCard, faces: readonly FaceBase[], badCosts: readonly (BadCost | undefined)[]): CardCap[] {
  const caps: CardCap[] = [];
  const layout = LAYOUT_CAPS[card.layout];
  if (layout !== undefined) caps.push({ reason: layout });
  if (card.set_type === 'alchemy') caps.push({ reason: ALCHEMY_CAP });
  const bad = badCosts.find((b) => b !== undefined);
  if (bad !== undefined) caps.push({ reason: `mana cost ${bad.text}: ${bad.message} (not in CR 107.4), so the engine can't cast this card (CR 202.1b)` });
  return caps;
}

/** The card caps and the extra `requiresEngine` entries (unknown mana symbols, newer model versions, missing features). Mutates the fresh automation object. */
function applyCaps(automation: CardAutomation, caps: readonly CardCap[], requires: Set<string>): void {
  if (caps.length > 0) automation.level = 'manual';
  for (const c of caps) if (!automation.unsupported.includes(c.reason)) automation.unsupported.push(c.reason);
  const all = new Set([...(automation.requiresEngine ?? []), ...requires]);
  if (all.size > 0) automation.requiresEngine = [...all].sort();
}

/** The last resort of contract C1: something above threw. Every face is one manual ability; the card is manual. */
function compileFallback(card: OracleCard, src: CompileSources, e: unknown): { def: CardDef; report: CompileReport } {
  const message = e instanceof Error ? e.message : String(e);
  const loose = (card ?? {}) as unknown as Partial<Record<string, unknown>>;
  const str = (x: unknown): string => (typeof x === 'string' ? x : '');
  let shell: Omit<CardDef, 'faces' | 'automation'>;
  let bases: FaceBase[];
  try {
    shell = cardShell(card);
    bases = buildFaces(card).faces;
  } catch {
    const name = str(loose['name']);
    shell = { id: name, name, layout: str(loose['layout']) || 'normal', isToken: false };
    bases = [{ name, manaCost: null, typeLine: str(loose['type_line']), supertypes: [], types: [], subtypes: [], oracleText: str(loose['oracle_text']), colors: [], keywords: [] }];
  }
  const faces: FaceDef[] = bases.map((b) => ({ ...b, abilities: [errorAbility(b.oracleText, message)] }));
  let hash = '';
  try {
    hash = textHash(bases.map((b) => b.oracleText));
  } catch {
    hash = '';
  }
  const automation: CardAutomation = {
    level: 'manual',
    faces: faces.map((f) => ({ abilities: f.abilities.map((a) => ({ level: 'manual' as const, manual: [{ path: '', text: a.text, reason: (a as ManualAbilityDef).reason, impact: 'ability' as const }] })) })),
    unsupported: faces.map((f) => f.oracleText).filter((t) => t.trim() !== '').concat(`parser-error: ${message}`),
    source: 'none',
    autoRatio: 0,
    compilerVersion: src.compilerVersion,
    ...(hash !== '' ? { textHash: hash } : {}),
  };
  return { def: { ...shell, faces, automation }, report: { textHash: hash, faces: faces.map(() => ({ source: 'parser' as const, nativeLines: [], nativeUngated: [], overlaid: [] })), pack: null, llm: null, disagreements: [], notApplied: [], templatesUsed: [] } };
}

/** The compile pipeline entry point (design 6.1 steps 0, 8, 9). Total: never throws (contract C1). */
export const compileCardV2: CompileCardV2 = (card, src) => compileCardDetailed(card, src).def;
