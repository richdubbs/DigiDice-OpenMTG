/**
 * The OpenMTG rules pack (docs/design/updates.md, design 12.5, WP27): data only, never executed. Pure validation.
 *
 *   { format: "openmtg-rules-pack", formatVersion: 1, packVersion, minEngineVersion, modelVersion, createdAt,
 *     keywords: KeywordDefData[], templates: Template[] (examples stripped), cards: { <oracle_id>: CompiledCardEntry },
 *     requiresEngine: { <oracle_id>: ["op:copy", "keyword:morph"] } }
 *
 * No Wizards or Scryfall content: no card names, no Oracle text, no images. Cards are keyed by `oracle_id` and apply only when the `textHash` of the
 * player's own text matches. Entries are validated one by one (schema and lint, no display text, no free text) and rejected individually.
 *
 * "Needs a newer OpenMTG" is per card (updates.md, design 5.3, 12.5): an entry whose `modelVersion` is newer than this engine's is kept unvalidated,
 * never used, and listed (`ValidatedPack.newer`, the pipeline's requiresEngine `model:N`); the rest of the pack plays. Only the pack FORMAT can refuse a
 * whole pack: `minEngineVersion` is the oldest OpenMTG that reads the format (PACK_READER_VERSION by default), not the builder's version.
 */
import { ABILITY_MODEL_VERSION, readCompiledEntry, stripAbility, validateTemplates, type AbilityDef, type CompiledCardEntry, type KeywordDefData, type Template } from '@openmtg/engine';
import { freeTextIn } from './card-text';

export const PACK_FORMAT = 'openmtg-rules-pack';
export const MANIFEST_FORMAT = 'openmtg-rules-pack-manifest';
export const PACK_FORMAT_VERSION = 1;

/**
 * The OpenMTG version of this build (what `validatePack` compares a pack's `minEngineVersion` with). Milestone 5's ability model is 0.5.0 (updates.md's
 * example); bump it with each release.
 */
export const OPENMTG_VERSION = '0.5.0';

/**
 * The oldest OpenMTG that reads pack format version 1: the default `minEngineVersion` of a built pack. Raise it only when the pack format itself changes
 * in a way older readers cannot handle; newer ability models are handled per entry.
 */
export const PACK_READER_VERSION = '0.5.0';

export interface RulesPack {
  format: typeof PACK_FORMAT;
  formatVersion: number;
  packVersion: string;
  minEngineVersion: string;
  modelVersion: number;
  createdAt: string;
  keywords: KeywordDefData[];
  templates: Template[];
  cards: Record<string, CompiledCardEntry>;
  requiresEngine: Record<string, string[]>;
}

/** The small file the pack URL serves (updates.md "Integrity"): the pack's SHA-256 and size, and where the pack is (relative to the manifest). */
export interface PackManifest {
  format: typeof MANIFEST_FORMAT;
  formatVersion: number;
  packVersion: string;
  file: string;
  sha256: string;
  size: number;
}

export interface PackProblem {
  where: string;
  reason: string;
}

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** -1, 0, 1 for semantic versions "a.b.c" (anything else sorts as 0.0.0). */
export function compareVersions(a: string, b: string): number {
  const pa = (SEMVER.exec(a) ?? [0, 0, 0, 0]).slice(1).map(Number);
  const pb = (SEMVER.exec(b) ?? [0, 0, 0, 0]).slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (pa[i]! !== pb[i]!) return pa[i]! < pb[i]! ? -1 : 1;
  return 0;
}

/** Does the stored ability carry display text (text, label, span: card text has no place in a pack)? */
export function hasDisplayText(a: unknown): boolean {
  try {
    return JSON.stringify(stripAbility(a as AbilityDef)) !== JSON.stringify(a);
  } catch {
    return true;
  }
}

/** Mechanisms a pack keyword may use (design 7.7): no hooks, no structural state. */
const PACK_MECHANISMS = new Set(['expands', 'castOption', 'replacement']);

function keywordProblem(k: unknown): string | null {
  if (!isRec(k) || typeof k['name'] !== 'string' || typeof k['rule'] !== 'string') return 'a keyword needs a name and a rule';
  if (k['status'] !== 'implemented') return `keyword ${k['name']}: status must be "implemented" (design 7.7)`;
  const m = k['mechanisms'];
  if (!Array.isArray(m) || m.length === 0 || !m.every((x) => typeof x === 'string' && PACK_MECHANISMS.has(x))) {
    return `keyword ${k['name']}: mechanisms limited to expands, castOption, replacement (design 7.7: hooks and structural state need an engine release)`;
  }
  return null;
}

/** A pack template as installed: examples stripped (no Wizards text in packs), status experimental (design 6.9: not reviewed against this corpus). */
export function packTemplate(t: Template): Template {
  return { ...t, examples: [], counterExamples: [], status: 'experimental' };
}

function templateProblems(ts: readonly Template[]): PackProblem[] {
  // the template compiler's own errors; the example and counter-example rules do not apply (packs ship templates without them)
  const out: PackProblem[] = [];
  for (const t of ts) {
    if (!isRec(t) || typeof t.id !== 'string' || typeof t.pattern !== 'string') {
      out.push({ where: 'templates', reason: 'a template needs an id and a pattern' });
      continue;
    }
    if ((t.examples?.length ?? 0) > 0 || (t.counterExamples?.length ?? 0) > 0) out.push({ where: `template ${t.id}`, reason: 'templates in a pack must not carry examples (no card text in packs)' });
  }
  const valid = ts.filter((t) => isRec(t) && typeof t.id === 'string');
  for (const p of validateTemplates(valid.map((t) => ({ ...t, examples: [{ text: 'x' }], counterExamples: ['a', 'b'] })))) out.push({ where: `template ${p.id}`, reason: p.message });
  return out;
}

export interface ValidatedPack {
  pack: RulesPack;
  /** Entries that passed (rejected ones are listed in `problems`). */
  entries: Map<string, CompiledCardEntry>;
  templates: Template[];
  keywords: KeywordDefData[];
  problems: PackProblem[];
  /** Oracle ids of entries made for a newer ability model than this engine's: kept in `entries` unvalidated, never used (the card needs a newer OpenMTG). */
  newer: string[];
}

/**
 * Validate a parsed pack. `fatal` refuses the whole pack (not a pack, another format version, or a format newer than this OpenMTG reads); other problems
 * reject single entries. A newer header `modelVersion` is not fatal: entries are judged one by one.
 */
export function validatePack(x: unknown, version = OPENMTG_VERSION): { fatal: string } | ValidatedPack {
  if (!isRec(x)) return { fatal: 'not a JSON object' };
  if (x['format'] !== PACK_FORMAT) return { fatal: `not an OpenMTG rules pack (format ${JSON.stringify(x['format'])})` };
  if (x['formatVersion'] !== PACK_FORMAT_VERSION) return { fatal: `pack format version ${String(x['formatVersion'])} is not supported (this OpenMTG reads version ${PACK_FORMAT_VERSION})` };
  const { packVersion, minEngineVersion, modelVersion, createdAt } = x;
  if (typeof packVersion !== 'string' || packVersion === '') return { fatal: 'packVersion missing' };
  if (typeof minEngineVersion !== 'string' || !SEMVER.test(minEngineVersion)) return { fatal: 'minEngineVersion must be a version like 0.5.0' };
  if (compareVersions(minEngineVersion, version) > 0) return { fatal: `this pack needs OpenMTG ${minEngineVersion} or newer (this is ${version}): update OpenMTG first` };
  if (typeof modelVersion !== 'number' || !Number.isInteger(modelVersion) || modelVersion < 1) return { fatal: 'modelVersion must be a positive integer' };
  if (typeof createdAt !== 'string') return { fatal: 'createdAt missing' };
  const cardsIn = x['cards'];
  const reqIn = x['requiresEngine'];
  const kwIn = x['keywords'];
  const tplIn = x['templates'];
  if (!isRec(cardsIn)) return { fatal: '"cards" must be an object keyed by oracle_id' };
  if (!isRec(reqIn ?? {})) return { fatal: '"requiresEngine" must be an object keyed by oracle_id' };
  if (!Array.isArray(kwIn ?? []) || !Array.isArray(tplIn ?? [])) return { fatal: '"keywords" and "templates" must be arrays' };

  const problems: PackProblem[] = [];
  const entries = new Map<string, CompiledCardEntry>();
  const newer: string[] = [];
  for (const [id, raw] of Object.entries(cardsIn)) {
    const where = `card ${id}`;
    if (!isRec(raw) || raw['oracleId'] !== id) {
      problems.push({ where, reason: 'the key must equal the entry\'s oracleId' });
      continue;
    }
    const isNewer = typeof raw['modelVersion'] === 'number' && raw['modelVersion'] > ABILITY_MODEL_VERSION;
    // a newer model's abilities cannot be read by this build's schema: they are kept unread (and never used)
    if (!isNewer && Array.isArray(raw['faces']) && (raw['faces'] as unknown[]).some((f) => isRec(f) && Array.isArray(f['abilities']) && (f['abilities'] as unknown[]).some(hasDisplayText))) {
      problems.push({ where, reason: 'the entry carries display text (text, label or span): packs ship structure only' });
      continue;
    }
    if (freeTextIn(raw['faces']) !== null) {
      problems.push({ where, reason: 'the entry carries free text (a reason other than the fixed placeholder): packs ship structure only, never card text' });
      continue;
    }
    const r = readCompiledEntry(raw);
    if ('problem' in r) problems.push({ where, reason: r.problem.reason });
    else {
      entries.set(id, r.entry);
      if (isNewer) newer.push(id);
    }
  }
  const requiresEngine: Record<string, string[]> = {};
  for (const [id, caps] of Object.entries((reqIn ?? {}) as Rec)) {
    if (Array.isArray(caps) && caps.every((c) => typeof c === 'string')) requiresEngine[id] = [...(caps as string[])];
    else problems.push({ where: `requiresEngine ${id}`, reason: 'must be a list of capability names' });
  }
  const keywords: KeywordDefData[] = [];
  for (const k of (kwIn ?? []) as unknown[]) {
    const p = keywordProblem(k);
    if (p === null) keywords.push(k as KeywordDefData);
    else problems.push({ where: 'keywords', reason: p });
  }
  const tplList = (tplIn ?? []) as Template[];
  const tplProblems = templateProblems(tplList);
  problems.push(...tplProblems);
  const badTemplates = new Set(tplProblems.map((p) => p.where.replace(/^template /, '')));
  const templates = tplList.filter((t) => isRec(t) && typeof t.id === 'string' && !badTemplates.has(t.id)).map(packTemplate);
  const pack: RulesPack = {
    format: PACK_FORMAT, formatVersion: PACK_FORMAT_VERSION, packVersion, minEngineVersion, modelVersion, createdAt, keywords, templates,
    cards: Object.fromEntries(entries), requiresEngine,
  };
  return { pack, entries, templates, keywords, problems, newer };
}

export function validateManifest(x: unknown): PackManifest | string {
  if (!isRec(x) || x['format'] !== MANIFEST_FORMAT) return 'not an OpenMTG rules pack manifest';
  if (x['formatVersion'] !== PACK_FORMAT_VERSION) return `manifest format version ${String(x['formatVersion'])} is not supported`;
  if (typeof x['file'] !== 'string' || x['file'] === '') return 'manifest: file missing';
  if (typeof x['sha256'] !== 'string' || !/^[0-9a-f]{64}$/.test(x['sha256'])) return 'manifest: sha256 must be a SHA-256 hex string';
  if (typeof x['size'] !== 'number' || !Number.isInteger(x['size']) || x['size'] < 0) return 'manifest: size missing';
  if (typeof x['packVersion'] !== 'string') return 'manifest: packVersion missing';
  return x as unknown as PackManifest;
}
