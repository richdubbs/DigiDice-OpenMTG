/**
 * The rules-pack commands of the card tool (updates.md, design 12.5, WP27): `build-pack` (maintainers) and `update` (players: Scryfall refresh +
 * rules pack). Each returns an exit code; I/O is injectable for tests (`PackDeps`).
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { defaultCompileSources, type LlmTrust, type OracleCard } from '@openmtg/engine';
import type { Io } from '../commands';
import { fixtureCards } from '../coverage/corpus';
import { CardDatabase } from '../database';
import { writeFileAtomic } from '../fsutil';
import { LlmCache, defaultCompiledDir } from '../llm/cache';
import { repoRoot } from '../paths';
import { decodeText } from '../text';
import { buildPack } from './build';
import { PACK_READER_VERSION } from './format';
import { MANIFEST_FILE, PACK_FILE, defaultPacksDir } from './install';
import { runUpdate, type PackSource } from './update';

export const PACK_COMMANDS = ['build-pack', 'update'] as const;

export const PACK_USAGE = `
Rules packs (milestone 7; docs/design/updates.md):
  update [--file PACK [--manifest FILE]] [--url URL] [--no-refresh] [--force] [--trust off|reviewed|autoverified]
                                Refresh the Scryfall data (at most once per 24 h), then install the rules pack from
                                $OPENMTG_PACK_URL (the manifest URL; --url overrides) or a local file, verified by SHA-256,
                                into .cache/packs (or $OPENMTG_PACKS_DIR), and print what changed.
  build-pack [--out DIR] [--overrides DIR] [--pack-version V] [--min-engine-version V] [--fixtures]
                                Maintainers: pack the reviewed LLM entries and the hand-written overrides (packs/overrides/*.json,
                                source "hand" only) into DIR/${PACK_FILE} plus its manifest (default DIR: packs/), with the
                                coverage delta. --min-engine-version: the oldest OpenMTG that may read the pack (default
                                ${PACK_READER_VERSION}); entries for a newer ability model are listed per card, never refuse the pack.`;

export interface PackDeps {
  env?: Record<string, string | undefined>;
  now?: () => Date;
  fetch?: typeof fetch;
  /** The corpus (tests). */
  cards?: OracleCard[];
  /** Step 1 of update (tests); default: CardDatabase.refresh. */
  refresh?: () => Promise<{ action: string; reason: string }>;
  packsDir?: string;
  compiledDir?: string;
}

interface Args { positional: string[]; flags: Set<string>; values: Map<string, string> }
const VALUED = new Set(['--file', '--manifest', '--url', '--trust', '--out', '--overrides', '--pack-version', '--min-engine-version']);
const BOOL = new Set(['--no-refresh', '--force', '--fixtures']);

function parse(argv: readonly string[]): Args | string {
  const a: Args = { positional: [], flags: new Set(), values: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]!;
    if (!x.startsWith('--')) {
      a.positional.push(x);
      continue;
    }
    const eq = x.indexOf('=');
    const name = eq > 0 ? x.slice(0, eq) : x;
    if (VALUED.has(name)) {
      const v = eq > 0 ? x.slice(eq + 1) : argv[++i];
      if (v === undefined) return `${name} needs a value`;
      a.values.set(name, v);
    } else if (BOOL.has(name)) a.flags.add(name);
    else return `Unknown option ${name}`;
  }
  return a.positional.length > 0 ? `Unexpected argument ${a.positional[0]}` : a;
}

const TRUST = new Set(['off', 'reviewed', 'autoverified']);

/** The override files (packs/overrides/*.json: one entry or a list), read like every text file of the tool (BOM and UTF-16 accepted); a file that cannot be read is reported and skipped. */
export async function readOverrides(dir: string): Promise<{ entries: unknown[]; problems: { file: string; reason: string }[] }> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return { entries: [], problems: [] };
  }
  const entries: unknown[] = [];
  const problems: { file: string; reason: string }[] = [];
  for (const f of files) {
    try {
      const json = JSON.parse(decodeText(await readFile(path.join(dir, f)))) as unknown;
      if (Array.isArray(json)) entries.push(...(json as unknown[]));
      else entries.push(json);
    } catch (e) {
      problems.push({ file: path.join(dir, f), reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { entries, problems };
}

export async function packCommand(command: string, argv: readonly string[], io: Io, deps: PackDeps = {}): Promise<number> {
  const a = parse(argv);
  if (typeof a === 'string') {
    io.err(a);
    return 2;
  }
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const compiledDir = deps.compiledDir ?? defaultCompiledDir(env);
  const trust = a.values.get('--trust') ?? 'autoverified';
  if (!TRUST.has(trust)) {
    io.err('--trust must be off, reviewed or autoverified');
    return 2;
  }

  if (command === 'build-pack') {
    const cards = deps.cards ?? (a.flags.has('--fixtures') ? fixtureCards() : [...(await CardDatabase.open({ log: (m) => io.err(m) })).cards()]);
    const cardsById = new Map(cards.flatMap((c) => (c.oracle_id ? [[c.oracle_id, c] as const] : [])));
    const { entries, problems } = await new LlmCache(compiledDir).allEntries();
    for (const p of problems) io.err(`LLM cache entry ${p.oracleId ?? '?'} skipped: ${p.reason}`);
    const overridesDir = a.values.get('--overrides') ?? path.join(repoRoot(), 'packs', 'overrides');
    const at = now();
    const packVersion = a.values.get('--pack-version') ?? `${at.toISOString().slice(0, 10).replace(/-/g, '.')}-1`;
    const overrides = await readOverrides(overridesDir);
    const minEngineVersion = a.values.get('--min-engine-version');
    let r: ReturnType<typeof buildPack>;
    try {
      r = buildPack({ llm: entries.values(), overrides: overrides.entries, cardsById, sources: defaultCompileSources(), packVersion, createdAt: at.toISOString(), ...(minEngineVersion ? { minEngineVersion } : {}) });
    } catch (e) {
      io.err(e instanceof Error ? e.message : String(e));
      return 1;
    }
    const outDir = a.values.get('--out') ?? path.join(repoRoot(), 'packs');
    await writeFileAtomic(path.join(outDir, PACK_FILE), r.bytes);
    await writeFileAtomic(path.join(outDir, MANIFEST_FILE), `${JSON.stringify(r.manifest, null, 2)}\n`);
    io.out(`Wrote ${path.join(outDir, PACK_FILE)} (${r.bytes.length} bytes, SHA-256 ${r.manifest.sha256}) and its manifest: pack ${packVersion}, ${r.included.length} card entries`
      + ` (readable by OpenMTG ${r.pack.minEngineVersion} or newer).`);
    for (const p of overrides.problems) io.out(`  excluded override file ${p.file}: ${p.reason}`);
    for (const x of r.excluded) io.out(`  excluded ${x.oracleId}: ${x.reason}`);
    io.out(`Coverage delta on ${r.pack.templates.length > 0 ? `all ${r.delta.cards} cards (the pack has templates)` : `the ${r.delta.cards} packed cards`}: `
      + `full ${r.delta.before.full} -> ${r.delta.after.full}, partial ${r.delta.before.partial} -> ${r.delta.after.partial}, manual ${r.delta.before.manual} -> ${r.delta.after.manual}`
      + ` (${r.delta.up.length} up, ${r.delta.down.length} down).`);
    const needs = Object.keys(r.pack.requiresEngine).length;
    if (needs > 0) io.out(`${needs} packed card(s) list engine features this build lacks (requiresEngine).`);
    return 0;
  }

  // update
  const file = a.values.get('--file');
  const url = a.values.get('--url') ?? env['OPENMTG_PACK_URL']?.trim();
  const source: PackSource = file ? { file, ...(a.values.has('--manifest') ? { manifest: a.values.get('--manifest')! } : {}) } : url ? { url } : null;
  let listCards: () => Promise<OracleCard[]>;
  let refresh = deps.refresh;
  if (deps.cards) {
    const cards = deps.cards;
    listCards = async () => cards;
  } else if (a.flags.has('--fixtures')) {
    listCards = async () => fixtureCards();
  } else {
    const db = await CardDatabase.open({ allowEmpty: true, log: (m) => io.err(m) });
    listCards = async () => [...db.cards()];
    refresh ??= async () => db.refresh({ force: a.flags.has('--force') });
  }
  const { entries } = await new LlmCache(compiledDir).allEntries();
  const { code } = await runUpdate({
    ...(a.flags.has('--no-refresh') || a.flags.has('--fixtures') ? {} : refresh ? { refresh } : {}),
    listCards, source, ...(deps.fetch ? { fetch: deps.fetch } : {}), packsDir: deps.packsDir ?? defaultPacksDir(env),
    llm: entries, trust: trust as LlmTrust, now: now(), out: io.out,
  });
  return code;
}
