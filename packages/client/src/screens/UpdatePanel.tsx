/**
 * The Update button (UPD1, milestone 7; docs/design/updates.md "Two sources, one button"), on the About screen next to the card-data date and the
 * rules-pack version. "Check for updates" asks the local server (POST /api/update) to run the update flow of `npm run cards -- update`: refresh the
 * Scryfall card data (at most once a day; "already current" otherwise) and install the project-published rules pack. The server runs it in the
 * background; this panel polls GET /api/update for the progress and shows the result: cards added, templates added, coverage before and after, and what
 * failed (offline, Scryfall or the pack host down, a pack that does not verify).
 *
 * The pack part is off until the owner sets the pack URL (OPENMTG_PACK_URL on the server; no default until the project publishes a pack): the panel says
 * so, and the button then refreshes the card data only.
 *
 * When an update the panel watched ends, it sounds its outcome (finishedSound): ui.success when installed or already current, ui.notify when partly
 * installed, ui.error when it failed or could not start. An update that had already ended when the panel opened is silent.
 */
import { useEffect, useRef, useState } from 'react';
import type { CoverageCounts, UpdateJob, UpdatePhase, UpdateResult, UpdateStatusResponse } from '@openmtg/server/api';
import { ApiRequestError, apiGet, apiPost } from '../api/http';
import type { SoundId } from '../audio/catalog';
import { sfx } from '../audio/sfx';

/** How often the panel asks for progress while an update runs, and while the new coverage is being computed. */
export const POLL_RUNNING_MS = 1000;
export const POLL_COVERAGE_MS = 4000;

const PHASE_TEXT: Record<UpdatePhase, string> = {
  cards: 'Checking Scryfall for new card data…',
  pack: 'Getting the rules pack…',
  compile: 'Compiling the new and changed cards…',
};

const OUTCOME_TEXT: Record<UpdateResult['outcome'], string> = {
  updated: 'Update installed.',
  current: 'Everything is up to date.',
  partial: 'Update partly installed: one part failed (details below).',
  failed: 'The update failed: nothing was changed.',
};

/** A GET /api/update answer as the server sends it (a stubbed or older server may answer something else: then the panel is not shown as usable). */
function isStatus(x: unknown): x is UpdateStatusResponse {
  return typeof x === 'object' && x !== null && typeof (x as UpdateStatusResponse).packConfigured === 'boolean' && 'job' in x;
}

const pct = (n: number, total: number): string => (total > 0 ? `${((100 * n) / total).toFixed(1)}%` : '0%');
const num = (n: number): string => n.toLocaleString('en-US');

function coverageText(c: CoverageCounts): string {
  return `${pct(c.full, c.total)} full, ${pct(c.partial, c.total)} partial, ${pct(c.manual, c.total)} manual (${num(c.total)} cards)`;
}

function CoverageLine({ coverage }: { coverage: UpdateResult['coverage'] }) {
  const before = coverage.before ? coverageText(coverage.before) : 'not computed';
  const after = coverage.after ? coverageText(coverage.after) : coverage.afterPending ? 'being computed for the new card data…' : 'not computed';
  return (
    <>
      <dt>Coverage before</dt>
      <dd>{before}</dd>
      <dt>Coverage now</dt>
      <dd>{after}</dd>
    </>
  );
}

function packText(r: UpdateResult): string {
  const p = r.pack;
  switch (p.state) {
    case 'notConfigured':
      return `Not checked: no rules-pack address is set${p.installed ? ` (installed: ${p.installed})` : ''}.`;
    case 'installed':
      return `${p.version} installed${p.verified ? ', checked against its published SHA-256' : ''}: ${num(p.entries)} card entries${p.rejected > 0 ? `, ${num(p.rejected)} refused by the validator` : ''}.`;
    case 'failed':
      return `Not installed: ${p.error}${p.kept ? ` (still using ${p.kept})` : ''}.`;
  }
}

function cardDataText(r: UpdateResult): string {
  const c = r.cardData;
  if (c.state === 'refreshed') return `Downloaded the latest Scryfall data (${c.detail}).`;
  if (c.state === 'current') return `Already current (${c.detail}).`;
  return `Not refreshed: ${c.detail}. Your local card data is unchanged.`;
}

function ResultView({ result }: { result: UpdateResult }) {
  const r = result;
  return (
    <div className="update-result" data-outcome={r.outcome}>
      <p className="update-outcome">
        <strong>{OUTCOME_TEXT[r.outcome]}</strong>
      </p>
      {r.offline && (
        <p className="update-offline" role="alert">
          You seem to be offline: nothing could be downloaded. Your cards and rules are unchanged and keep working; try again when you are connected.
        </p>
      )}
      <dl>
        <dt>Card data</dt>
        <dd>{cardDataText(r)}</dd>
        <dt>Cards added</dt>
        <dd>
          {num(r.cardsAdded)}
          {r.newCards.length > 0 && ` (${r.newCards.join(', ')}${r.cardsAdded > r.newCards.length ? `, and ${num(r.cardsAdded - r.newCards.length)} more` : ''})`}
        </dd>
        <dt>Rules pack</dt>
        <dd>{packText(r)}</dd>
        <dt>Templates added</dt>
        <dd>
          {num(r.templates.added)} (rules-pack templates: {num(r.templates.before)} before, {num(r.templates.after)} now)
        </dd>
        <CoverageLine coverage={r.coverage} />
        <dt>New and changed cards</dt>
        <dd>
          {num(r.delta.newlyAutomated)} more automated, {num(r.delta.lessAutomated)} less automated, {num(r.delta.stillManual)} still manual
        </dd>
        {r.needsNewer.count > 0 && (
          <>
            <dt>Needs a newer OpenMTG</dt>
            <dd>
              {num(r.needsNewer.count)} card(s) need a newer OpenMTG and play with manual resolution until then ({r.needsNewer.names.join(', ')}
              {r.needsNewer.count > r.needsNewer.names.length ? ', …' : ''}).
            </dd>
          </>
        )}
        {r.refusedForYourText > 0 && (
          <>
            <dt>Refused entries</dt>
            <dd>{num(r.refusedForYourText)} rules-pack entries do not fit your card text and are not used.</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function JobView({ job }: { job: UpdateJob }) {
  const last = job.log[job.log.length - 1];
  // the summary's compile counts its cards (a first card download compiles the whole pool); an older server sends no `progress`
  const compiled = job.phase === 'compile' ? job.progress ?? null : null;
  return (
    <>
      {job.state === 'running' && (
        <div className="update-progress" role="status" aria-live="polite">
          {compiled ? <progress aria-label="Update progress" value={compiled.done} max={compiled.total} /> : <progress aria-label="Update progress" />}
          <p>{job.phase ? PHASE_TEXT[job.phase] : 'Working…'}</p>
          {compiled && <p>{num(compiled.done)} of {num(compiled.total)} cards compiled</p>}
          {last && <p className="update-last-line">{last}</p>}
        </div>
      )}
      {job.state === 'failed' && (
        <p className="update-error" role="alert">
          The update stopped with an error: {job.error ?? 'unknown error'}. Your local data is unchanged.
        </p>
      )}
      {job.state === 'done' && job.result && <ResultView result={job.result} />}
      {job.log.length > 0 && (
        <details className="update-log">
          <summary>Details</summary>
          <pre>{job.log.join('\n')}</pre>
        </details>
      )}
    </>
  );
}

/** The sound of an update's end (null: still running). */
export function finishedSound(job: UpdateJob): SoundId | null {
  if (job.state === 'running') return null;
  if (job.state === 'failed' || !job.result) return 'ui.error';
  return job.result.outcome === 'partial' ? 'ui.notify' : job.result.outcome === 'failed' ? 'ui.error' : 'ui.success';
}

type PanelState = { kind: 'loading' } | { kind: 'unavailable'; message: string } | { kind: 'ready'; status: UpdateStatusResponse };

/** The Update control. `onFinished` runs when an update this panel watched finishes, and again when its new coverage is ready (the About screen reloads). */
export function UpdatePanel({ onFinished, pollMs = { running: POLL_RUNNING_MS, coverage: POLL_COVERAGE_MS } }: { onFinished?: () => void; pollMs?: { running: number; coverage: number } }) {
  const [state, setState] = useState<PanelState>({ kind: 'loading' });
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const seen = useRef<{ id: number; running: boolean; pending: boolean } | null>(null);
  const finishedCb = useRef(onFinished);
  finishedCb.current = onFinished;
  const pollRef = useRef<() => Promise<void>>(async () => undefined);

  const schedule = (ms: number | null): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = ms === null ? null : setTimeout(() => void pollRef.current(), ms);
  };

  const apply = (s: unknown): void => {
    if (!alive.current) return;
    if (!isStatus(s)) {
      setState({ kind: 'unavailable', message: 'this server has no Update support' });
      return;
    }
    setState({ kind: 'ready', status: s });
    const job = s.job;
    const prev = seen.current;
    const now = job ? { id: job.id, running: job.state === 'running', pending: job.result?.coverage.afterPending === true } : null;
    seen.current = now;
    if (now && prev && !now.running && (prev.id !== now.id || prev.running || (prev.pending && !now.pending))) finishedCb.current?.();
    // The end itself, once (not again when the new coverage arrives).
    const sound = job && now && prev && !now.running && (prev.id !== now.id || prev.running) ? finishedSound(job) : null;
    if (sound) sfx(sound);
    schedule(now?.running ? pollMs.running : now?.pending ? pollMs.coverage : null);
  };

  pollRef.current = async () => {
    try {
      apply(await apiGet('GET /api/update'));
    } catch (e) {
      if (!alive.current) return;
      setState((prev) => (prev.kind === 'ready' ? prev : { kind: 'unavailable', message: e instanceof Error ? e.message : String(e) }));
      // while an update runs, keep asking: the server may be busy for a moment
      if (seen.current?.running) schedule(pollMs.coverage);
    }
  };

  useEffect(() => {
    alive.current = true;
    void pollRef.current();
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const start = async () => {
    setStartError(null);
    setStarting(true);
    seen.current = { id: -1, running: true, pending: false }; // an update started here: its end is reported even when the answer already says done
    try {
      apply(await apiPost('POST /api/update', {}));
    } catch (e) {
      if (e instanceof ApiRequestError && e.body?.code === 'updateRunning') void pollRef.current();
      else {
        setStartError(e instanceof Error ? e.message : String(e));
        sfx('ui.error');
      }
    } finally {
      if (alive.current) setStarting(false);
    }
  };

  if (state.kind === 'loading') return <p className="update-panel">Checking the update service…</p>;
  if (state.kind === 'unavailable') {
    return (
      <div className="update-panel">
        <h3>Updates</h3>
        <p>The local server cannot run updates right now ({state.message}). From a terminal: npm run cards -- update</p>
      </div>
    );
  }
  const s = state.status;
  const running = s.job?.state === 'running';
  return (
    <div className="update-panel" aria-label="Updates">
      <h3>Updates</h3>
      <p className="update-hint">
        New sets: the card data comes from Scryfall (downloaded at most once a day); how to automate new cards and mechanics comes from the OpenMTG rules
        pack.
      </p>
      {!s.packConfigured && (
        <p className="update-pack-off">
          Rules-pack updates are off: no pack address is set yet, because the project has not published a rules pack. Check for updates refreshes the
          card data only. (The owner turns it on by setting OPENMTG_PACK_URL to the pack&apos;s manifest URL before starting OpenMTG.)
        </p>
      )}
      <button type="button" className="button-primary" onClick={() => void start()} disabled={running || starting}>
        {running ? 'Updating…' : 'Check for updates'}
      </button>
      {startError && (
        <p className="update-error" role="alert">
          Could not start the update: {startError}
        </p>
      )}
      {s.job && <JobView job={s.job} />}
    </div>
  );
}
