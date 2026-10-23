/**
 * The LLM compile cache (design 11.4), git-ignored, on the user's machine:
 *
 *   .cache/compiled/
 *     index.json                     oracle_id -> CompileIndexEntry (text hash, prompt version, model, model version, schema hash, status, review, flags)
 *     entries/ab/<oracle_id>.json    CompiledCardEntry: abilities WITHOUT any text (stored form), keyed by oracle_id + textHash
 *     raw/<oracle_id>.<n>.json       raw model replies, for audit and offline re-validation (llm/revalidate.ts)
 *     backups/<oracle_id>.<n>.json   an entry file as it was before a later compile or edit replaced it
 *     review-queue.jsonl             one line per entry waiting for review (unreviewed or autoverified), rewritten from the index on every change
 *     logs/compile-<date>.jsonl      token counts, gate failures
 *
 * Location: $OPENMTG_COMPILED_DIR or <repo>/.cache/compiled (design 11.4; compiled CardDefs belong in .cache/compiled-defs, design 12.6).
 */
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ABILITY_MODEL_VERSION, loadEntries, readCompiledEntry, type CompiledCardEntry, type EntryProblem } from '@openmtg/engine';
import { readJsonIfExists, writeFileAtomic } from '../fsutil';
import { repoRoot } from '../paths';
import { decodeText } from '../text';
import type { CompileIndexEntry } from './types';
import { currentSchemaHash } from './versions';

export function defaultCompiledDir(env: Record<string, string | undefined> = process.env): string {
  const o = env['OPENMTG_COMPILED_DIR']?.trim();
  return o ? path.resolve(o) : path.join(repoRoot(), '.cache', 'compiled');
}

/** An oracle id as Scryfall writes it (hex digits and dashes; letters and digits accepted). */
export const isOracleId = (id: string): boolean => /^[0-9a-zA-Z-]+$/.test(id);

const safeId = (id: string): string => {
  if (!isOracleId(id)) throw new Error(`not an oracle id: ${JSON.stringify(id)}`);
  return id;
};

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Is this JSON an LLM compile index (every value a CompileIndexEntry)? Another tool's index.json in the same folder must never be overwritten. */
function isCompileIndex(x: unknown): x is Record<string, CompileIndexEntry> {
  return isRec(x) && Object.entries(x).every(([k, v]) => isRec(v) && v['oracleId'] === k && typeof v['textHash'] === 'string' && (v['status'] === 'entry' || v['status'] === 'failed'));
}

/** One stored raw reply (llm/run.ts writes them). */
export interface RawReply {
  n: number;
  purpose: 'compile' | 'repair' | 'agreement';
  model: string;
  stopReason: string;
  promptVersion: number;
  textHash: string;
  text: string;
}

export class LlmCache {
  private index: Record<string, CompileIndexEntry> | undefined;

  constructor(readonly dir: string) {}

  entryFile(oracleId: string): string {
    const id = safeId(oracleId);
    return path.join(this.dir, 'entries', id.slice(0, 2), `${id}.json`);
  }

  async readIndex(): Promise<Record<string, CompileIndexEntry>> {
    if (this.index) return this.index;
    const file = path.join(this.dir, 'index.json');
    const raw = (await readJsonIfExists<unknown>(file)) ?? {};
    if (!isCompileIndex(raw)) {
      throw new Error(`${file} is not an LLM compile index (another tool's cache in the same folder?): set OPENMTG_COMPILED_DIR to a folder of its own`);
    }
    this.index = raw;
    return raw;
  }

  async record(oracleId: string): Promise<CompileIndexEntry | undefined> {
    return (await this.readIndex())[oracleId];
  }

  private async writeIndex(): Promise<void> {
    const idx = await this.readIndex();
    const sorted = Object.fromEntries(Object.keys(idx).sort().map((k) => [k, idx[k]!]));
    await writeFileAtomic(path.join(this.dir, 'index.json'), `${JSON.stringify(sorted, null, 1)}\n`);
    await this.writeQueue();
  }

  /**
   * Store an entry (structure only) and its index record, stamped with the entry's model version and the current schema hash. An existing entry file is
   * copied to backups/ first; returns that backup's path (undefined when there was none).
   */
  async putEntry(entry: CompiledCardEntry, rec: Omit<CompileIndexEntry, 'status' | 'review' | 'flags' | 'oracleId' | 'textHash' | 'modelVersion' | 'schemaHash'>): Promise<string | undefined> {
    const backup = await this.backup(entry.oracleId);
    await writeFileAtomic(this.entryFile(entry.oracleId), `${JSON.stringify(entry)}\n`);
    (await this.readIndex())[entry.oracleId] = {
      ...rec, oracleId: entry.oracleId, textHash: entry.textHash, modelVersion: entry.modelVersion, schemaHash: currentSchemaHash(), status: 'entry', review: entry.review, flags: [...entry.flags],
    };
    await this.writeIndex();
    return backup;
  }

  /** Record a card whose every attempt failed a gate (no entry; a later run with --retry-failed asks again). */
  async putFailure(rec: Omit<CompileIndexEntry, 'status' | 'review' | 'modelVersion' | 'schemaHash'>): Promise<void> {
    (await this.readIndex())[rec.oracleId] = { ...rec, modelVersion: ABILITY_MODEL_VERSION, schemaHash: currentSchemaHash(), status: 'failed' };
    await this.writeIndex();
  }

  async getEntry(oracleId: string): Promise<CompiledCardEntry | undefined> {
    const raw = await readJsonIfExists<unknown>(this.entryFile(oracleId));
    if (raw === undefined) return undefined;
    const r = readCompiledEntry(raw);
    return 'entry' in r ? r.entry : undefined;
  }

  /** Change the review state (and flags) of a stored entry. */
  async setReview(oracleId: string, review: CompiledCardEntry['review'], addFlags: string[] = []): Promise<CompiledCardEntry> {
    const e = await this.getEntry(oracleId);
    if (!e) throw new Error(`no LLM entry for ${oracleId}`);
    const next: CompiledCardEntry = { ...e, review, flags: [...new Set([...e.flags, ...addFlags])].sort() };
    await writeFileAtomic(this.entryFile(oracleId), `${JSON.stringify(next)}\n`);
    const idx = await this.readIndex();
    const rec = idx[oracleId];
    if (rec) idx[oracleId] = { ...rec, review, flags: next.flags };
    await this.writeIndex();
    return next;
  }

  /** Every stored entry (the files are the truth; the index is a summary). Invalid files are reported, never used. */
  async allEntries(): Promise<{ entries: Map<string, CompiledCardEntry>; problems: EntryProblem[] }> {
    const root = path.join(this.dir, 'entries');
    const jsons: unknown[] = [];
    let dirs: string[] = [];
    try {
      dirs = await readdir(root);
    } catch {
      return { entries: new Map(), problems: [] };
    }
    for (const d of dirs.sort()) {
      let files: string[] = [];
      try {
        files = await readdir(path.join(root, d));
      } catch {
        continue;
      }
      for (const f of files.filter((x) => x.endsWith('.json')).sort()) {
        try {
          jsons.push(JSON.parse(decodeText(await readFile(path.join(root, d, f)))));
        } catch (e) {
          jsons.push({ oracleId: f.replace(/\.json$/, ''), broken: String(e) });
        }
      }
    }
    return loadEntries(jsons);
  }

  /** Store a raw model reply: raw/<oracle_id>.<n>.json, n counting up. Returns n. */
  async putRaw(oracleId: string, reply: Omit<RawReply, 'n'> & Rec): Promise<number> {
    const dir = path.join(this.dir, 'raw');
    await mkdir(dir, { recursive: true });
    const existing = (await readdir(dir)).filter((f) => f.startsWith(`${safeId(oracleId)}.`)).length;
    await writeFileAtomic(path.join(dir, `${oracleId}.${existing}.json`), `${JSON.stringify(reply)}\n`);
    return existing;
  }

  /** The stored raw replies of a card, oldest first (unreadable files are skipped). */
  async rawReplies(oracleId: string): Promise<RawReply[]> {
    const dir = path.join(this.dir, 'raw');
    let files: string[];
    try {
      files = (await readdir(dir)).filter((f) => f.startsWith(`${safeId(oracleId)}.`) && f.endsWith('.json'));
    } catch {
      return [];
    }
    const out: RawReply[] = [];
    for (const f of files) {
      const n = Number(f.slice(oracleId.length + 1, -'.json'.length));
      if (!Number.isInteger(n)) continue;
      try {
        const r = JSON.parse(decodeText(await readFile(path.join(dir, f)))) as Rec;
        if (typeof r['text'] === 'string' && typeof r['textHash'] === 'string') out.push({ ...(r as unknown as Omit<RawReply, 'n'>), n });
      } catch {
        /* an unreadable reply is not re-validated */
      }
    }
    return out.sort((a, b) => a.n - b.n);
  }

  /** Copy an existing entry file to backups/<oracle_id>.<n>.json; returns its path, or undefined when there is no entry file. */
  private async backup(oracleId: string): Promise<string | undefined> {
    let bytes: Buffer;
    try {
      bytes = await readFile(this.entryFile(oracleId));
    } catch {
      return undefined;
    }
    const dir = path.join(this.dir, 'backups');
    await mkdir(dir, { recursive: true });
    const n = (await readdir(dir)).filter((f) => f.startsWith(`${oracleId}.`)).length;
    const file = path.join(dir, `${oracleId}.${n}.json`);
    await writeFileAtomic(file, bytes);
    return file;
  }

  /** review-queue.jsonl: exactly the entries waiting for review (unreviewed and autoverified), from the index. */
  private async writeQueue(): Promise<void> {
    const idx = await this.readIndex();
    const lines = Object.keys(idx).sort().flatMap((k) => {
      const r = idx[k]!;
      return r.status === 'entry' && (r.review === 'unreviewed' || r.review === 'autoverified') ? [`${JSON.stringify({ oracleId: r.oracleId, textHash: r.textHash, review: r.review, flags: r.flags })}\n`] : [];
    });
    await writeFileAtomic(path.join(this.dir, 'review-queue.jsonl'), lines.join(''));
  }

  async log(date: string, line: Record<string, unknown>): Promise<void> {
    const dir = path.join(this.dir, 'logs');
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, `compile-${date}.jsonl`), `${JSON.stringify(line)}\n`);
  }
}
