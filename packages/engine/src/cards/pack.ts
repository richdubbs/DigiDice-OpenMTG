/**
 * Loading and validating rules-pack and LLM-cache entries (`CompiledCardEntry`, cards/pipeline.ts) for the compile pipeline (design 11.1, 11.4-11.5, 12.5).
 * Owner: WP18. Pure: the CLI (WP26, WP27) reads the files and hands the parsed JSON here; nothing in this file touches a disk.
 *
 *   readCompiledEntry(json)        one entry: shape, hash form, model version, every stored ability against the schema (display fields optional) and the lint
 *   loadEntries(jsons)             many entries -> oracle_id -> entry, plus the problems of the rejected ones (a pack is validated before install, never executed)
 *   unusableReason(entry, ...)     may this entry drive play for the player's text? (textHash match, model version, review and the trust policy of 11.5)
 *   hydrateEntryFace(...)          the stored abilities of one face with display text restored from the player's own lines, or null (the face is discarded)
 *
 * An entry is structure only (no Oracle text, no names): the hash says which wording it was made for, and a different wording discards it (errata).
 */
import type { AbilityDef } from '../types/ability';
import { ABILITY_MODEL_VERSION } from '../types/ability';
import type { ReviewState } from '../types/automation';
import type { FaceLines, StoredAbility } from '../model/api';
import { hydrateAbility } from '../model/strip';
import { validateStoredAbility } from '../model/validate';
import type { CompiledCardEntry, LlmTrust } from './pipeline';

export const OWNER = 'WP18' as const;

const REVIEW_STATES: ReadonlySet<string> = new Set<ReviewState>(['unreviewed', 'autoverified', 'reviewed', 'rejected']);
const SOURCES: ReadonlySet<string> = new Set(['hand', 'llm']);
const HASH = /^[0-9a-f]{64}$/;

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);

/** One problem found while loading entries. */
export interface EntryProblem {
  oracleId?: string;
  reason: string;
}

/** Validate one entry (the JSON of `entries/ab/<oracle_id>.json` or one value of a pack's `cards`). Never throws. */
export function readCompiledEntry(x: unknown): { entry: CompiledCardEntry } | { problem: EntryProblem } {
  const fail = (reason: string): { problem: EntryProblem } => ({ problem: { ...(isRec(x) && typeof x['oracleId'] === 'string' ? { oracleId: x['oracleId'] } : {}), reason } });
  if (!isRec(x)) return fail('not an object');
  const { oracleId, textHash, modelVersion, faces, review, source, flags } = x;
  if (typeof oracleId !== 'string' || oracleId === '') return fail('oracleId missing');
  if (typeof textHash !== 'string' || !HASH.test(textHash)) return fail('textHash is not a SHA-256 hex string');
  if (typeof modelVersion !== 'number' || !Number.isInteger(modelVersion) || modelVersion < 1) return fail('modelVersion is not a positive integer');
  if (typeof review !== 'string' || !REVIEW_STATES.has(review)) return fail(`unknown review state ${JSON.stringify(review)}`);
  if (typeof source !== 'string' || !SOURCES.has(source)) return fail(`unknown source ${JSON.stringify(source)}`);
  if (!Array.isArray(flags) || !flags.every((f) => typeof f === 'string')) return fail('flags must be strings');
  if (!Array.isArray(faces) || faces.length === 0) return fail('faces missing');
  const outFaces: CompiledCardEntry['faces'] = [];
  for (let i = 0; i < faces.length; i++) {
    const f: unknown = faces[i];
    if (!isRec(f) || !Array.isArray(f['abilities'])) return fail(`face ${i}: abilities missing`);
    const covers = f['covers'];
    if (covers !== undefined && !(Array.isArray(covers) && covers.every((c) => isRec(c) && Number.isInteger(c['line']) && Number.isInteger(c['sentence'])))) {
      return fail(`face ${i}: covers must be {line, sentence} pairs`);
    }
    // An entry made for a newer model is kept unvalidated: the pipeline lists it in requiresEngine and never uses it.
    if (modelVersion <= ABILITY_MODEL_VERSION) {
      for (let k = 0; k < f['abilities'].length; k++) {
        let issues;
        try {
          issues = validateStoredAbility(f['abilities'][k]).filter((s) => s.severity === 'error');
        } catch (e) {
          return fail(`face ${i} ability ${k}: not a valid ability (${e instanceof Error ? e.message : String(e)})`);
        }
        if (issues.length > 0) return fail(`face ${i} ability ${k}: ${issues[0]!.code} at ${issues[0]!.path || '/'}: ${issues[0]!.message}`);
      }
    }
    outFaces.push({ abilities: f['abilities'] as StoredAbility[], ...(covers !== undefined ? { covers: covers as { line: number; sentence: number }[] } : {}) });
  }
  return { entry: { oracleId, textHash, modelVersion, faces: outFaces, review: review as ReviewState, source: source as CompiledCardEntry['source'], flags: [...(flags as string[])] } };
}

/** Load many entries (an array, or a pack's `cards` object); a later entry for the same oracle_id replaces an earlier one. Never throws. */
export function loadEntries(items: Iterable<unknown> | Readonly<Record<string, unknown>>): { entries: Map<string, CompiledCardEntry>; problems: EntryProblem[] } {
  const list: unknown[] = Symbol.iterator in Object(items) ? [...(items as Iterable<unknown>)] : Object.values(items as Record<string, unknown>);
  const entries = new Map<string, CompiledCardEntry>();
  const problems: EntryProblem[] = [];
  for (const x of list) {
    const r = readCompiledEntry(x);
    if ('entry' in r) entries.set(r.entry.oracleId, r.entry);
    else problems.push(r.problem);
  }
  return { entries, problems };
}

/** `highRisk:*` flags (design 11.3 step 9): such data never drives play unless a human reviewed it. */
export const isHighRisk = (flags: readonly string[]): boolean => flags.some((f) => f.startsWith('highRisk'));

/** Ops of design 11.3 step 9: exchange, delayed triggers, copy, piles, emblems. */
const HIGH_RISK_OPS: ReadonlySet<unknown> = new Set(['exchange', 'delay', 'copy', 'piles', 'createEmblem']);
/** Layers 1-3 (copy, face down, control, text, CR 613.1a-c). */
const HIGH_RISK_LAYERS: ReadonlySet<unknown> = new Set(['1a', '1b', 2, 3]);

/**
 * The high-risk nodes of design 11.3 step 9 found in the stored JSON of an entry, as `highRisk:*` names (empty: none). Computed, never asserted (design
 * 1.1.17): an entry that forgot its flags is still recognized. Replacement effects (static `replace`), layers 1-3, `exchange`, delayed triggers, `copy`,
 * `piles` and `createEmblem`, at any depth (quoted abilities included).
 */
export function highRiskNodes(entry: Pick<CompiledCardEntry, 'faces'>): string[] {
  const found = new Set<string>();
  const visit = (x: unknown): void => {
    if (Array.isArray(x)) {
      for (const y of x) visit(y);
      return;
    }
    if (!isRec(x)) return;
    if (HIGH_RISK_OPS.has(x['op'])) found.add(`highRisk:${x['op'] === 'delay' ? 'delayed' : x['op'] === 'createEmblem' ? 'emblem' : String(x['op'])}`);
    if (x['s'] === 'replace') found.add('highRisk:replacement');
    if (HIGH_RISK_LAYERS.has(x['layer'])) found.add(x['layer'] === 2 ? 'highRisk:control' : 'highRisk:layers');
    for (const v of Object.values(x)) visit(v);
  };
  for (const f of entry.faces) visit(f.abilities);
  return [...found].sort();
}

/**
 * The trust policy of design 11.5 for one entry. Hand-written pack data (`source: 'hand'`) is trusted as reviewed unless it says `rejected`. Every LLM
 * entry, from the LLM cache or inside a pack, follows the player's `llmTrust` setting: `off` uses none; `reviewed` only `reviewed` entries;
 * `autoverified` also `autoverified` entries without high risk. High risk is the entry's `highRisk:*` flags OR the high-risk nodes computed from its JSON
 * (11.3 step 9: such entries need `reviewed`). `rejected` and `unreviewed` never play.
 */
export function trusted(entry: CompiledCardEntry, trust: LlmTrust, kind: 'pack' | 'llm'): boolean {
  if (entry.review === 'rejected') return false;
  if (kind === 'pack' && entry.source === 'hand') return true;
  if (trust === 'off') return false;
  if (entry.review === 'reviewed') return true;
  if (entry.review === 'autoverified') return trust === 'autoverified' && !isHighRisk(entry.flags) && highRiskNodes(entry).length === 0;
  return false;
}

export type Unusable = 'hash' | 'model' | 'faces' | 'trust';

/** Why an entry cannot drive play for this text, or null when it can. A newer model version is 'model' (the card lists it in requiresEngine). */
export function unusableReason(entry: CompiledCardEntry, actualHash: string, faceCount: number, trust: LlmTrust, kind: 'pack' | 'llm'): Unusable | null {
  if (entry.textHash !== actualHash) return 'hash';
  if (entry.modelVersion > ABILITY_MODEL_VERSION) return 'model';
  if (entry.faces.length !== faceCount) return 'faces';
  return trusted(entry, trust, kind) ? null : 'trust';
}

/**
 * The abilities of one face of an entry, display text restored from the player's lines (model/strip.ts#hydrateAbility). Null when any ability refuses
 * (hash, schema, an index outside the lines): the whole face of the entry is discarded, never half-applied.
 */
export function hydrateEntryFace(entry: CompiledCardEntry, face: number, lines: FaceLines, actualHash: string): AbilityDef[] | null {
  const stored = entry.faces[face];
  if (stored === undefined) return null;
  const out: AbilityDef[] = [];
  for (const s of stored.abilities) {
    let h: AbilityDef | null;
    try {
      h = hydrateAbility(s, lines, entry.textHash, actualHash);
    } catch {
      h = null;
    }
    if (h === null) return null;
    out.push(h);
  }
  return out;
}
