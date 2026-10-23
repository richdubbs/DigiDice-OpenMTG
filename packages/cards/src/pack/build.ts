/**
 * `npm run cards -- build-pack` (updates.md "Producing a pack", design 12.5, WP27): gather the `reviewed` entries of the LLM cache and the hand-written
 * overrides, strip everything except our data, validate, check each entry against the maintainer's own card data, and produce the pack, its manifest and
 * the coverage delta. Pure: the CLI reads and writes the files.
 *
 * "No Wizards or Scryfall content": entries are keyed by oracle_id; abilities are stored without display text or provenance, and every free-text
 * `reason` is replaced by a fixed placeholder (pack/card-text.ts); an entry with any other string that contains the card's name or a run of its Oracle
 * text (printed or "~" form) is excluded. Entries made for another wording than the maintainer's current data (errata), or that the render gate or lint
 * refuses on it, are excluded too, so a pack never ships an entry nobody can use. The overrides folder takes hand-written entries only (`source: "hand"`):
 * LLM entries reach a pack only through review in the LLM cache.
 */
import { ABILITY_MODEL_VERSION, readCompiledEntry, type CompiledCardEntry, type CompileSources, type KeywordDefData, type OracleCard, type Template } from '@openmtg/engine';
import { storedForm } from '../llm/gates';
import { checkPackEntry } from './check';
import { coverageDelta, type CoverageDelta } from './delta';
import { MANIFEST_FORMAT, PACK_FORMAT, PACK_FORMAT_VERSION, PACK_READER_VERSION, compareVersions, packTemplate, validatePack, type PackManifest, type RulesPack } from './format';
import { PACK_FILE, sha256 } from './install';
import { sourcesWith } from './sources';

export { cardTextIn } from './card-text';

export interface BuildInput {
  /** Every entry of the LLM cache; only `reviewed` ones are taken. */
  llm: Iterable<CompiledCardEntry>;
  /** Hand-written override entries (raw JSON, `source: "hand"`); they win over LLM entries for the same card. */
  overrides: readonly unknown[];
  cardsById: ReadonlyMap<string, OracleCard>;
  /** The parser's sources (the game path). */
  sources: CompileSources;
  packVersion: string;
  createdAt: string;
  /** The oldest OpenMTG that can read the pack (default PACK_READER_VERSION: the first reader of format version 1). */
  minEngineVersion?: string;
  templates?: readonly Template[];
  keywords?: readonly KeywordDefData[];
}

export interface BuildResult {
  pack: RulesPack;
  bytes: Uint8Array;
  manifest: PackManifest;
  included: string[];
  excluded: { oracleId: string; reason: string }[];
  /** Over the packed cards, or over every card when the pack has templates (templates can change any card). */
  delta: CoverageDelta;
}

export function buildPack(input: BuildInput): BuildResult {
  const minEngineVersion = input.minEngineVersion ?? PACK_READER_VERSION;
  if (!/^\d+\.\d+\.\d+$/.test(minEngineVersion)) throw new Error(`--min-engine-version must be a version like ${PACK_READER_VERSION} (got ${JSON.stringify(minEngineVersion)})`);
  if (compareVersions(minEngineVersion, PACK_READER_VERSION) < 0) throw new Error(`OpenMTG before ${PACK_READER_VERSION} cannot read rules packs (got ${minEngineVersion})`);
  const chosen = new Map<string, CompiledCardEntry>();
  const excluded: BuildResult['excluded'] = [];
  for (const e of input.llm) if (e.review === 'reviewed') chosen.set(e.oracleId, e);
  for (const raw of input.overrides) {
    const r = readCompiledEntry(raw);
    if ('problem' in r) {
      excluded.push({ oracleId: r.problem.oracleId ?? '?', reason: `override: ${r.problem.reason}` });
      continue;
    }
    if (r.entry.source !== 'hand') {
      excluded.push({ oracleId: r.entry.oracleId, reason: 'override: only hand-written entries (source "hand") are taken from the overrides folder; LLM entries reach a pack through review in the LLM cache' });
      continue;
    }
    if (r.entry.review === 'rejected') continue;
    chosen.set(r.entry.oracleId, r.entry);
  }
  const cards: Record<string, CompiledCardEntry> = {};
  const requiresEngine: Record<string, string[]> = {};
  const included: string[] = [];
  for (const id of [...chosen.keys()].sort()) {
    const e = chosen.get(id)!;
    const card = input.cardsById.get(id);
    if (!card) {
      excluded.push({ oracleId: id, reason: 'not in the local card data (refresh first)' });
      continue;
    }
    // strip everything except our data: structure, src/sentence indices, hash, review state, source, flags; free text replaced
    const clean: CompiledCardEntry = {
      oracleId: id, textHash: e.textHash, modelVersion: e.modelVersion, review: e.source === 'hand' ? 'reviewed' : e.review, source: e.source, flags: [...e.flags].sort(),
      faces: e.faces.map((f) => ({ abilities: f.abilities.map(storedForm), ...(f.covers ? { covers: f.covers.map((c) => ({ line: c.line, sentence: c.sentence })) } : {}) })),
    };
    const check = checkPackEntry(card, clean, input.sources);
    if (check.status === 'textChanged') {
      excluded.push({ oracleId: id, reason: 'made for another wording of the card (errata since): compile it again' });
      continue;
    }
    if (check.status === 'rejected') {
      excluded.push({ oracleId: id, reason: `not usable on this card (${check.reason})` });
      continue;
    }
    cards[id] = clean;
    included.push(id);
    const req = check.status === 'apply' ? check.requiresEngine : [`model:${clean.modelVersion}`];
    if (req.length > 0) requiresEngine[id] = [...req];
  }
  const templates = (input.templates ?? []).map(packTemplate);
  const pack: RulesPack = {
    format: PACK_FORMAT, formatVersion: PACK_FORMAT_VERSION, packVersion: input.packVersion, minEngineVersion,
    modelVersion: ABILITY_MODEL_VERSION, createdAt: input.createdAt, keywords: [...(input.keywords ?? [])], templates, cards, requiresEngine,
  };
  // the pack must pass the installer's own validation (the same code the players run), as the oldest reader it names
  const check = validatePack(JSON.parse(JSON.stringify(pack)), pack.minEngineVersion);
  if ('fatal' in check) throw new Error(`the built pack does not validate: ${check.fatal}`);
  for (const p of check.problems) {
    const id = p.where.replace(/^card /, '');
    if (cards[id]) {
      delete cards[id];
      delete requiresEngine[id];
      included.splice(included.indexOf(id), 1);
      excluded.push({ oracleId: id, reason: p.reason });
    }
  }
  const bytes = new TextEncoder().encode(`${JSON.stringify(pack, null, 1)}\n`);
  const manifest: PackManifest = { format: MANIFEST_FORMAT, formatVersion: PACK_FORMAT_VERSION, packVersion: pack.packVersion, file: PACK_FILE, sha256: sha256(bytes), size: bytes.length };
  // templates are added to the parser for every card (pack/sources.ts): with templates, every card can change
  const touched = templates.length > 0 ? [...input.cardsById.values()] : included.map((id) => input.cardsById.get(id)!);
  const delta = coverageDelta(touched, input.sources, sourcesWith({ pack: { entries: new Map(Object.entries(cards)), templates } }, input.sources));
  return { pack, bytes, manifest, included, excluded, delta };
}
