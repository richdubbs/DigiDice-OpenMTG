/**
 * `npm run cards -- update` (updates.md "Two sources, one button"): (1) refresh the Scryfall Oracle data (the 24 h rule of `refresh`), (2) download the
 * latest rules pack from $OPENMTG_PACK_URL (or take a local file), verify and install it, (3) re-compile the cards it touches and print the summary:
 * new cards known, cards newly automated, cards still manual, cards needing a newer OpenMTG. The I/O is injected (`UpdateDeps`); the milestone 8 Update
 * button calls the same function.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CompileSources, CompiledCardEntry, LlmTrust, OracleCard } from '@openmtg/engine';
import { fileExists } from '../fsutil';
import { coverageDeltaSteps, packApplicabilitySteps, runAll, runSliced, type Steps, type TimeSlice } from './delta';
import { downloadPack } from './fetch';
import type { PackManifest } from './format';
import { MANIFEST_FILE, PackError, installPack, loadInstalledPack, readManifestFile, type LoadedPack } from './install';
import { sourcesWith } from './sources';

export type PackSource = { url: string } | { file: string; manifest?: string } | null;

export interface UpdateDeps {
  /** Step 1: refresh the Scryfall data; omitted with --no-refresh (offline). */
  refresh?: () => Promise<{ action: string; reason: string }>;
  /** The game cards of the local index (called before and after the refresh). */
  listCards: () => Promise<OracleCard[]>;
  source: PackSource;
  fetch?: typeof fetch;
  packsDir: string;
  /** The LLM cache and the trust setting (design 11.5), so the delta shows what the player will actually play. */
  llm?: ReadonlyMap<string, CompiledCardEntry>;
  trust?: LlmTrust;
  /** The parser's sources (default: the game path). */
  base?: CompileSources;
  now: Date;
  out: (line: string) => void;
  /**
   * Step 3 compiles up to the whole pool (every card is new on a first card download; changed templates reach every card): about a minute. Given a
   * slice, it runs in time slices and pauses between them (the local server: its event loop also serves the API and online play), reporting
   * `progress(done, total)` in compiled cards and pack entries. Without one (the CLI) it runs at once.
   */
  slice?: TimeSlice & { progress?: (done: number, total: number) => void };
}

export interface UpdateSummary {
  refresh?: { action: string; reason: string };
  /** The Scryfall refresh failed (offline, ...): the update went on with the local card data. */
  refreshError?: string;
  newCards: string[];
  pack?: { version: string; installed: number; rejected: number; verifiedBy: 'manifest' | 'none' };
  /** Entries the gates refuse on the player's own text (design 12.5), with the reason: reported, never used. */
  rejectedForYourText: { name: string; reason: string }[];
  /** The pack templates changed, so the delta covers every card. */
  templatesChanged: boolean;
  newlyAutomated: number;
  lessAutomated: number;
  stillManual: number;
  needsNewer: { name: string; missing: string[] }[];
}

const listSome = (names: readonly string[], n = 10): string => `${names.slice(0, n).join(', ')}${names.length > n ? `, ... (${names.length - n} more)` : ''}`;

/** The manifest next to a local pack file: <file>.manifest.json, or openmtg-rules-pack.manifest.json in the same folder. */
async function siblingManifest(file: string): Promise<string | undefined> {
  for (const m of [file.replace(/\.json$/, '.manifest.json'), path.join(path.dirname(file), MANIFEST_FILE)]) if (m !== file && (await fileExists(m))) return m;
  return undefined;
}

export async function runUpdate(d: UpdateDeps): Promise<{ code: number; summary: UpdateSummary }> {
  const out = d.out;
  const summary: UpdateSummary = { newCards: [], rejectedForYourText: [], templatesChanged: false, newlyAutomated: 0, lessAutomated: 0, stillManual: 0, needsNewer: [] };
  const before = new Set((await d.listCards()).map((c) => c.oracle_id ?? c.name));
  if (d.refresh) {
    // a failed refresh (offline, Scryfall down) never blocks the pack step: "Load update file" works offline (updates.md)
    try {
      const r = await d.refresh();
      summary.refresh = r;
      out(`Card data: ${r.action === 'skipped' ? 'already current' : r.action} (${r.reason})`);
    } catch (e) {
      summary.refreshError = e instanceof Error ? e.message : String(e);
      out(`Card data: not refreshed (${summary.refreshError}); going on with the local card data`);
    }
  } else out('Card data: not refreshed (--no-refresh)');
  const cards = await d.listCards();
  const byId = new Map(cards.flatMap((c) => (c.oracle_id ? [[c.oracle_id, c] as const] : [])));
  const fresh = cards.filter((c) => !before.has(c.oracle_id ?? c.name));
  summary.newCards = fresh.map((c) => c.name);
  out(`New cards known: ${fresh.length}${fresh.length > 0 ? ` (${listSome(summary.newCards)})` : ''}`);

  let old: LoadedPack | null = null;
  try {
    old = await loadInstalledPack(d.packsDir);
  } catch (e) {
    out(`warning: the installed rules pack is not used: ${e instanceof Error ? e.message : String(e)}`);
  }
  let next: LoadedPack | null = old;
  if (d.source === null) {
    out('Rules pack: no source configured (set OPENMTG_PACK_URL to the pack manifest URL, or use --file <pack.json>)'
      + `${old ? `; keeping the installed pack ${old.record.packVersion}` : ''}.`);
  } else {
    try {
      let bytes: Uint8Array;
      let manifest: PackManifest | null = null;
      let label: string;
      if ('url' in d.source) {
        const got = await downloadPack(d.source.url, d.fetch ?? fetch);
        bytes = got.bytes;
        manifest = got.manifest;
        label = got.packUrl;
      } else {
        bytes = await readFile(d.source.file);
        const m = d.source.manifest ?? (await siblingManifest(d.source.file));
        if (m) manifest = await readManifestFile(m);
        else out('warning: no manifest next to the pack file: its integrity is not verified (install only files you made or trust).');
        label = path.resolve(d.source.file);
      }
      const { validated, record } = await installPack(bytes, manifest, d.packsDir, label, d.now);
      next = { ...validated, record };
      summary.pack = { version: record.packVersion, installed: validated.entries.size, rejected: validated.problems.length, verifiedBy: record.verifiedBy };
      out(`Rules pack ${record.packVersion} installed (${record.verifiedBy === 'manifest' ? 'SHA-256 verified against its manifest' : 'not verified: no manifest'}): `
        + `${validated.entries.size} card entries, ${validated.templates.length} templates, ${validated.keywords.length} keyword definitions`);
      for (const p of validated.problems.slice(0, 5)) out(`  rejected ${p.where}: ${p.reason}`);
      if (validated.problems.length > 5) out(`  ... ${validated.problems.length - 5} more rejected`);
      if (validated.keywords.length > 0) out('  note: keyword definitions are kept but not used yet (this OpenMTG has no loader for keyword data).');
    } catch (e) {
      out(`Rules pack NOT installed: ${e instanceof Error ? e.message : String(e)}${old ? ` (keeping ${old.record.packVersion})` : ''}`);
      return { code: 1, summary };
    }
  }

  // [3] the cards the old or the new pack touch, plus the new cards: everything else compiles as before. Pack templates reach every card's parse
  // (pack/sources.ts), so when they change, every card is compiled again.
  summary.templatesChanged = JSON.stringify(old?.templates ?? []) !== JSON.stringify(next?.templates ?? []);
  const touchedIds = new Set([...(old?.entries.keys() ?? []), ...(next?.entries.keys() ?? []), ...fresh.flatMap((c) => (c.oracle_id ? [c.oracle_id] : []))]);
  const touched = summary.templatesChanged ? cards : [...touchedIds].flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  if (summary.templatesChanged) out(`Pack templates changed (${old?.templates.length ?? 0} -> ${next?.templates.length ?? 0}): every card is compiled again for this summary.`);
  const trust = d.trust ?? 'autoverified';
  const beforeSrc = sourcesWith({ pack: old, ...(d.llm ? { llm: d.llm } : {}), trust }, d.base);
  const afterSrc = sourcesWith({ pack: next, ...(d.llm ? { llm: d.llm } : {}), trust }, d.base);
  // the two sources differ only by the pack's entries (per oracle id) and templates (pack/sources.ts): a new card neither pack has an entry for compiles
  // alike before and after, so it is compiled once (a first card download: the whole pool once, not twice)
  const packed = new Set([...(old?.entries.keys() ?? []), ...(next?.entries.keys() ?? [])]);
  const sameSources = summary.templatesChanged ? undefined : (c: OracleCard): boolean => !c.oracle_id || !packed.has(c.oracle_id);
  const total = touched.length + (next?.entries.size ?? 0);
  let done = 0;
  const slice = d.slice;
  const run = async <T>(steps: Steps<T>): Promise<T> => (slice
    ? runSliced(steps, slice, () => slice.progress?.(++done, total))
    : runAll(steps));
  const delta = await run(coverageDeltaSteps(touched, beforeSrc, afterSrc, sameSources));
  summary.newlyAutomated = delta.up.length;
  summary.lessAutomated = delta.down.length;
  summary.stillManual = delta.after.manual;
  if (next) {
    // design 12.5: each entry passes the gates again on the player's own text; refused ones are reported, not counted as applying
    const app = await run(packApplicabilitySteps(next, byId, afterSrc));
    summary.rejectedForYourText = app.rejected;
    out(`Pack entries for your cards: ${app.matching} apply; ${app.rejected.length} refused on your card text`
      + `${app.rejected.length > 0 ? ` (${listSome(app.rejected.map((r) => `${r.name}: ${r.reason}`), 5)})` : ''}; `
      + `${app.textChanged.length} not used because the card's text changed since (errata: the parser decides)`
      + `${app.textChanged.length > 0 ? ` (${listSome(app.textChanged, 5)})` : ''}; ${app.unknown} for cards your data does not know yet.`);
    summary.needsNewer = app.needsNewer;
  }
  out(`Newly automated: ${delta.up.length}${delta.up.length > 0 ? ` (${listSome(delta.up.map((u) => `${u.name} ${u.from} -> ${u.to}`))})` : ''}`);
  if (delta.down.length > 0) out(`Less automated: ${delta.down.length} (${listSome(delta.down.map((u) => `${u.name} ${u.from} -> ${u.to}`))})`);
  out(`Still manual (of the ${touched.length} ${summary.templatesChanged ? 'cards' : 'new or pack cards'}): ${delta.after.manual}; partial ${delta.after.partial}, full ${delta.after.full}.`);
  if (summary.needsNewer.length > 0) {
    out(`${summary.needsNewer.length} card(s) need a newer OpenMTG (they play with manual resolution until then): `
      + listSome(summary.needsNewer.map((n) => `${n.name} (${n.missing.join(', ')})`)));
  }
  // a failed refresh is an error, except on the offline path (a local pack file: "Load update file")
  const offline = d.source !== null && 'file' in d.source;
  return { code: summary.refreshError !== undefined && !offline ? 1 : 0, summary };
}
