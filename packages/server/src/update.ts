/**
 * GET and POST /api/update (UPD1, milestone 7): the client's Update button (docs/design/updates.md, "Two sources, one button"). POST starts the same flow
 * as `npm run cards -- update` (`runUpdate` of @openmtg/cards): (1) refresh the Scryfall Oracle bulk data, respecting the 24 h rule ("already current"),
 * (2) download the project-published rules pack from the configured manifest URL, verify its SHA-256 and install it (data only, never executed),
 * (3) re-compile the cards it touches and summarize. The update runs in the background; GET reports its progress lines, phase and result, which the
 * client polls.
 *
 * - One update at a time per card cache (a second POST answers 409 `updateRunning`).
 * - The pack part is off until the owner configures a URL (OPENMTG_PACK_URL; no default until the project has a public home): the update then refreshes
 *   the card data only, and the result says so (`pack.state: 'notConfigured'`).
 * - Offline or failing sources never break the local data: the Scryfall refresh writes the new index only after a complete download, a pack is installed
 *   only after it is verified, and a failed part is reported with its reason (`outcome`, `offline`).
 * - Coverage before and after: the classification index of the whole pool (cache.ts `coverageCounts`) when the update starts, and again once the index of
 *   the new card data is built (`afterPending` until then).
 * - The summary's compile (step 3) can cover the whole pool: on a first card download (an empty cache, a fresh install) every card is new, and changed
 *   pack templates reach every card. It runs in time slices of `UPDATE_SLICE_MS` and yields to the event loop between them (`progress` counts the
 *   cards), like the classification index (automation.ts): the API, the client's polling and online play, all on this event loop, keep answering.
 *
 * The network is injectable (`ServerContext.updateIo`): tests use a fake fetch and never reach Scryfall or a pack host.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CardDatabase, LlmCache, loadInstalledPack, runUpdate, type PackSource, type UpdateSummary } from '@openmtg/cards';
import type { OracleCard } from '@openmtg/engine';
import type { CoverageCounts, UpdateJob, UpdatePackResult, UpdatePhase, UpdateResult, UpdateStatusResponse } from './api';
import { cardStore, coverageCounts } from './cache';
import type { Handler, ServerContext } from './context';

/** Progress lines kept per job (the CLI's summary is a dozen lines; a long Scryfall log is cut from the front). */
export const MAX_LOG_LINES = 200;
/** Milliseconds of compiling between two turns of the event loop (automation.ts uses the same). */
export const UPDATE_SLICE_MS = 40;
const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const MAX_NAMES = 20;

interface JobRecord {
  job: UpdateJob;
  /** Resolves when the job has finished (tests). */
  done: Promise<void>;
}

const jobs = new Map<string, JobRecord>();
let nextId = 1;

const keyOf = (ctx: ServerContext): string => path.resolve(ctx.cacheDir);

/** The packs directory of a context (http.ts `contextFrom` fills it in; a bare test context uses `packs` next to the card cache). */
export const packsDirOf = (ctx: ServerContext): string => ctx.packsDir ?? path.join(path.dirname(ctx.cacheDir), 'packs');

/** The installed rules pack's version from its install record (no hash check: `loadInstalledPack` does that when the pack is used). Null when none. */
export async function installedPackVersion(ctx: ServerContext): Promise<string | null> {
  try {
    const record = JSON.parse(await readFile(path.join(packsDirOf(ctx), 'installed.json'), 'utf8')) as { packVersion?: unknown };
    return typeof record.packVersion === 'string' && record.packVersion !== '' ? record.packVersion : null;
  } catch {
    return null;
  }
}

/** Templates of the installed pack, or 0 (none installed, or a pack that no longer verifies: runUpdate reports that itself). */
async function packTemplates(dir: string): Promise<number> {
  try {
    return (await loadInstalledPack(dir))?.templates.length ?? 0;
  } catch {
    return 0;
  }
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The pack's error as runUpdate prints it ("Rules pack NOT installed: <reason> (keeping <version>)"). */
function packFailure(log: readonly string[]): string {
  const line = [...log].reverse().find((l) => l.startsWith('Rules pack NOT installed: '));
  return line ? line.slice('Rules pack NOT installed: '.length).replace(/ \(keeping [^)]*\)$/, '') : 'the rules pack could not be installed (see the log)';
}

/** A download that never reached its server (no connection, DNS, refused): what "offline" means for the summary. */
const UNREACHABLE = /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|network ?error/i;

export function summarize(
  s: UpdateSummary,
  code: number,
  ctx: { log: readonly string[]; packConfigured: boolean; installedBefore: string | null; templatesBefore: number; templatesAfter: number; coverageBefore: CoverageCounts | null },
): UpdateResult {
  const cardData: UpdateResult['cardData'] = s.refreshError !== undefined
    ? { state: 'failed', detail: s.refreshError }
    : s.refresh && s.refresh.action !== 'skipped'
      ? { state: 'refreshed', detail: `${s.refresh.action} (${s.refresh.reason})` }
      : { state: 'current', detail: s.refresh?.reason ?? 'not refreshed' };
  let pack: UpdatePackResult;
  if (!ctx.packConfigured) pack = { state: 'notConfigured', installed: ctx.installedBefore };
  else if (s.pack) pack = { state: 'installed', version: s.pack.version, entries: s.pack.installed, rejected: s.pack.rejected, verified: s.pack.verifiedBy === 'manifest' };
  else pack = { state: 'failed', error: packFailure(ctx.log), kept: ctx.installedBefore };

  const cardsFailed = cardData.state === 'failed';
  const packFailed = pack.state === 'failed';
  const newPack = pack.state === 'installed' && pack.version !== ctx.installedBefore;
  const changed = cardData.state === 'refreshed' || s.newCards.length > 0 || newPack;
  // a pack reinstalled at the same version is not "new"; an exit code 1 without a failed part (should not happen) still counts as a failure
  const outcome: UpdateResult['outcome'] = cardsFailed && (packFailed || pack.state === 'notConfigured')
    ? 'failed'
    : cardsFailed || packFailed || code !== 0
      ? 'partial'
      : changed
        ? 'updated'
        : 'current';
  const offline = cardsFailed && UNREACHABLE.test(cardData.detail) && (pack.state === 'notConfigured' || (pack.state === 'failed' && UNREACHABLE.test(pack.error)));
  return {
    outcome,
    offline,
    cardData,
    cardsAdded: s.newCards.length,
    newCards: s.newCards.slice(0, MAX_NAMES),
    pack,
    templates: { before: ctx.templatesBefore, after: ctx.templatesAfter, added: Math.max(0, ctx.templatesAfter - ctx.templatesBefore) },
    coverage: { before: ctx.coverageBefore, after: null, afterPending: false },
    delta: { newlyAutomated: s.newlyAutomated, lessAutomated: s.lessAutomated, stillManual: s.stillManual },
    needsNewer: { count: s.needsNewer.length, names: s.needsNewer.slice(0, MAX_NAMES).map((n) => n.name) },
    refusedForYourText: s.rejectedForYourText.length,
  };
}

/** The phase a progress line ends: after "Card data: ..." the pack step runs, after the pack's own line the summary's compile. */
function phaseAfter(line: string, current: UpdatePhase | null): UpdatePhase | null {
  if (line.startsWith('Card data:') || line.startsWith('New cards known:')) return 'pack';
  if (line.startsWith('Rules pack') || line.startsWith('Pack templates changed')) return 'compile';
  return current;
}

async function run(ctx: ServerContext, job: UpdateJob): Promise<void> {
  const io = ctx.updateIo ?? {};
  const out = (line: string): void => {
    job.log.push(line);
    if (job.log.length > MAX_LOG_LINES) job.log.splice(0, job.log.length - MAX_LOG_LINES);
    job.phase = phaseAfter(line, job.phase);
  };
  const packsDir = packsDirOf(ctx);
  const packUrl = ctx.packUrl ?? null;
  const coverageBefore = await coverageCounts(ctx);
  const installedBefore = await installedPackVersion(ctx);
  const templatesBefore = await packTemplates(packsDir);
  // the CLI's own database (not the API's store): refresh() rewrites the index files, and the API's store reopens on its next request (cache.ts stamps)
  const db = await CardDatabase.open({ cacheDir: ctx.cacheDir, allowEmpty: true, log: out, ...(io.scryfall ? { client: io.scryfall } : {}), ...(io.clock ? { clock: io.clock } : {}) });
  const source: PackSource = packUrl ? { url: packUrl } : null;
  const { entries } = await new LlmCache(ctx.compiledDir).allEntries();
  const { code, summary } = await runUpdate({
    refresh: async () => {
      job.phase = 'cards';
      return db.refresh();
    },
    listCards: async () => [...db.cards()] as OracleCard[],
    source,
    ...(io.packFetch ? { fetch: io.packFetch } : {}),
    packsDir,
    llm: entries,
    trust: 'autoverified',
    now: (io.now ?? (() => new Date()))(),
    out,
    slice: {
      ms: io.sliceMs ?? UPDATE_SLICE_MS,
      pause: yieldToEventLoop,
      progress: (done, total) => {
        job.progress = { done, total };
      },
    },
  });
  job.progress = null;
  const result = summarize(summary, code, { log: job.log, packConfigured: packUrl !== null, installedBefore, templatesBefore, templatesAfter: await packTemplates(packsDir), coverageBefore });
  // open the API's store over the new card data now, so its classification index (the coverage "after") starts building in the background
  if (result.cardData.state === 'refreshed') await cardStore(ctx).catch(() => undefined);
  job.result = result;
}

/** Fill in the coverage "after" of a finished job (the classification index of the current card data, once built). */
async function withCoverageNow(ctx: ServerContext, job: UpdateJob): Promise<UpdateJob> {
  if (job.state !== 'done' || !job.result) return job;
  const after = await coverageCounts(ctx);
  const hasData = (await cardStore(ctx).catch(() => ({ ok: false as const }))).ok;
  return { ...job, log: [...job.log], result: { ...job.result, coverage: { ...job.result.coverage, after, afterPending: after === null && hasData } } };
}

async function statusOf(ctx: ServerContext): Promise<UpdateStatusResponse> {
  const rec = jobs.get(keyOf(ctx));
  const packUrl = ctx.packUrl ?? null;
  return { packConfigured: packUrl !== null, packUrl, job: rec ? await withCoverageNow(ctx, rec.job) : null };
}

/** Start an update for this context's card cache; null when one is already running. */
export function startUpdate(ctx: ServerContext): JobRecord | null {
  const key = keyOf(ctx);
  if (jobs.get(key)?.job.state === 'running') return null;
  const now = ctx.updateIo?.now ?? (() => new Date());
  const job: UpdateJob = { id: nextId++, state: 'running', phase: 'cards', startedAt: now().toISOString(), finishedAt: null, log: [], progress: null, result: null };
  const done = run(ctx, job).then(
    () => {
      job.state = 'done';
    },
    (e: unknown) => {
      job.state = 'failed';
      job.error = errorText(e);
      job.log.push(`Update failed: ${job.error}`);
    },
  ).finally(() => {
    job.phase = null;
    job.progress = null;
    job.finishedAt = now().toISOString();
  });
  const rec = { job, done };
  jobs.set(key, rec);
  return rec;
}

/** Wait for the update of a context to finish (tests). */
export async function updateFinished(ctx: ServerContext): Promise<void> {
  await jobs.get(keyOf(ctx))?.done;
}

/** Forget every finished update (tests). */
export function clearUpdates(): void {
  for (const [k, r] of jobs) if (r.job.state !== 'running') jobs.delete(k);
}

export const getUpdate: Handler<'GET /api/update'> = async (_req, ctx) => ({ status: 200, body: await statusOf(ctx) });

export const postUpdate: Handler<'POST /api/update'> = async (req, ctx) => {
  const b = req.body;
  if (b !== undefined && (b === null || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).length > 0)) {
    return { status: 400, body: { error: 'POST /api/update takes an empty JSON object: {}' } };
  }
  if (!startUpdate(ctx)) return { status: 409, body: { error: 'An update is already running.', code: 'updateRunning' } };
  return { status: 200, body: await statusOf(ctx) };
};
