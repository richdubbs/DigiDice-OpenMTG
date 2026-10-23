/**
 * RPL-3 (replays design 7.2, 6): the host's replay of an online game. The game runs in the host's own OpenMTG server, which writes its record to its
 * data directory as it goes (packages/server online/replays.ts). The host's page reads it from there as a replay file (kind 'game', mode 'onlineHost':
 * the config, the log, the checkpoints, every player's choice) when the game is over, when the player leaves the game screen (an unfinished game reads
 * as abandoned), and at the next start for a game the page was not there for (`collectHostReplays`). It keeps it like a local game: in the library,
 * with the fallback recording the worker makes (replays/completion.ts), and then the server removes its record.
 *
 * The host's machine holds the whole game anyway (online.md's known limitation), so its file holds every hand; the replay viewer shows what the reveal
 * policy allows (replays/viewer/policy.ts: the host's seat and the public view, every seat and the open view only once every player agreed). The
 * players' choices can change after the end, until the game was shared: the kept file's reveal record follows the status (`replay.agreed`).
 *
 * RPL-4's seam (replays/live.ts `soFar`) is left out here: the host's page holds no game while it runs (its server does), so a bug report carries the
 * view on screen (bugs/capture.ts).
 */
import { checkReplay, type PlayerId, type ReplayFile } from '@openmtg/engine';
import { ONLINE_REPLAYS_PATH, type OnlineReplayList, type OnlineStatus } from '@openmtg/server/online';
import type { ReplayEnv } from '../replays/env';
import { defaultTitle, revealOf } from '../replays/file';
import type { LibraryEntry } from '../replays/library';
import type { LiveReplay, LiveReplayState } from '../replays/live';
import type { OnlineLink } from './OnlineLink';

/** A request to this player's own server (OnlineLink.request; the page's fetch at start). */
export type ServerRequest = (path: string, init?: RequestInit) => Promise<Response>;

/** The page's own server, with the page's fetch (same origin). */
export const pageRequest: ServerRequest = (path, init = {}) => fetch(path, { headers: { Accept: 'application/json' }, cache: 'no-store', ...init });

export type Collected = { ok: true; entry: LibraryEntry } | { ok: false; status: number | null; reason: string };

/** How often, and how long apart, a record still being closed by the server (409: it is processing the leave) is asked for again. */
const RETRIES = 10;
const RETRY_MS = 300;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Read the record `id` from this player's server as a replay file, check it as any replay file (engine `checkReplay`), keep it in the library (a replay
 * already there only takes the record's reveal record: its fallback recording stays) and have the server remove the record. Never throws.
 */
export async function collectHostReplay(env: ReplayEnv, request: ServerRequest, id: string): Promise<Collected> {
  const path = `${ONLINE_REPLAYS_PATH}/${encodeURIComponent(id)}`;
  let res: Response;
  try {
    res = await request(path);
  } catch (e) {
    return { ok: false, status: null, reason: `the local OpenMTG server does not answer (${e instanceof Error ? e.message : String(e)})` };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const error = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : `HTTP ${res.status}`;
    return { ok: false, status: res.status, reason: error };
  }
  const checked = checkReplay(body);
  if (!checked.ok) return { ok: false, status: res.status, reason: checked.error.message };
  const file = checked.value;
  if (file.id !== id || file.kind !== 'game' || file.game.mode !== 'onlineHost') return { ok: false, status: res.status, reason: 'it is not this game\'s replay' };
  try {
    const { library } = env;
    const existing = await library.entry(id);
    let entry: LibraryEntry | null;
    if (existing) entry = await library.update(id, (f) => (sameReveal(f, file) ? null : { ...f, reveal: { ...file.reveal, agreed: [...file.reveal.agreed] } }));
    else {
      const next: ReplayFile = { ...file, app: { ...env.app }, title: defaultTitle(file.game.players, file.game.format) };
      entry = await library.add(next, { toComplete: true });
      void env.completion?.enqueue(entry.key);
    }
    if (!entry) return { ok: false, status: res.status, reason: 'it could not be kept' };
    await request(path, { method: 'DELETE' }).catch(() => undefined);
    return { ok: true, entry };
  } catch (e) {
    return { ok: false, status: res.status, reason: e instanceof Error ? e.message : String(e) };
  }
}

const sameReveal = (a: ReplayFile, b: ReplayFile): boolean => a.reveal.policy === b.reveal.policy && a.reveal.agreed.join() === b.reveal.agreed.join();

/** What this page's server lists (`ONLINE_REPLAYS_PATH`: its records, the game it has open); null when it does not answer. Never throws. */
export async function serverReplays(request: ServerRequest = pageRequest): Promise<OnlineReplayList | null> {
  try {
    const res = await request(ONLINE_REPLAYS_PATH);
    if (!res.ok) return null;
    const list = (await res.json()) as Partial<OnlineReplayList> | null;
    if (!list || typeof list !== 'object') return null;
    return { replays: Array.isArray(list.replays) ? list.replays : [], open: typeof list.open === 'string' ? list.open : null };
  } catch {
    return null;
  }
}

/**
 * At start (design 7.2): the records the server still keeps of games no longer running there (a page that closed before the end, or before it read the
 * record) come into the library. `listed`: the server's list as read already (`serverReplays`). Returns the ids kept. Never throws; a server without the
 * replays API (or none at all) keeps nothing.
 */
export async function collectHostReplays(env: ReplayEnv, request: ServerRequest = pageRequest, listed?: OnlineReplayList | null): Promise<string[]> {
  const list = listed !== undefined ? listed : await serverReplays(request);
  if (!list) return [];
  const kept: string[] = [];
  for (const r of list.replays) {
    if (!r || typeof r.id !== 'string' || r.running) continue;
    const got = await collectHostReplay(env, request, r.id);
    if (got.ok) kept.push(r.id);
  }
  return kept;
}

/** The game is over at the server (CR 104): its record is complete. */
const isOver = (s: OnlineStatus, link: OnlineLink): boolean => s.phase === 'over' || link.view()?.view.result != null;

/** The host page's replay of the game on `link` (see the file comment). */
export class OnlineHostReplay {
  readonly live: LiveReplay;
  private entry: Promise<LibraryEntry | null> | null = null;
  private agreed: readonly PlayerId[] = [];
  private kept = false;
  /** Reading the record failed for another reason than a game still closing: the status no longer asks again (Watch and leaving do). */
  private gaveUp = false;
  private snapshot: LiveReplayState;
  private readonly listeners = new Set<() => void>();
  private readonly off: () => void;
  /** Why the replay could not be read, when it could not (diagnostics, tests). */
  problem: string | null = null;

  private constructor(
    private readonly link: OnlineLink,
    private readonly env: ReplayEnv,
    readonly id: string,
    me: PlayerId,
    name: string,
  ) {
    this.snapshot = { phase: 'recording', error: null, agreed: [], kept: false };
    this.live = {
      people: [{ id: me, name }],
      // The choice is the online panel's (OnlineGamePanel), as for every player.
      asksAgreement: false,
      state: () => this.snapshot,
      subscribe: (l) => {
        this.listeners.add(l);
        return () => {
          this.listeners.delete(l);
        };
      },
      setAgreed: (_p, on) => void this.link.setReplayConsent(on),
      setKept: (k) => this.setKept(k),
      file: () => this.file(),
      left: () => void this.collect(RETRIES),
    };
    this.off = link.subscribe(() => this.onStatus());
    this.onStatus();
  }

  /** The replay of the game the host's link has open; null when its server keeps none (`status.replay`). */
  static start(link: OnlineLink, env: ReplayEnv, name: string): OnlineHostReplay | null {
    const s = link.status();
    if (s.role !== 'host' || !s.replay || !s.me) return null;
    return new OnlineHostReplay(link, env, s.replay.id, s.me, name);
  }

  private changed(next: Partial<LiveReplayState>): void {
    this.snapshot = { ...this.snapshot, ...next };
    for (const l of [...this.listeners]) l();
  }

  private onStatus(): void {
    const s = this.link.status();
    const r = s.replay;
    if (!r || r.id !== this.id) return; // the game was left (or another one is open): what was read stays
    const mine = r.agree ? [this.live.people[0]!.id] : [];
    if (mine.length !== this.snapshot.agreed.length) this.changed({ agreed: mine });
    const agreed = r.agreed ?? [];
    const moved = agreed.join() !== this.agreed.join();
    this.agreed = [...agreed];
    if (isOver(s, this.link)) {
      if (!this.entry) {
        if (!this.gaveUp) void this.collect(RETRIES);
      } else if (moved) void this.entry.then((e) => e && this.followReveal());
    }
  }

  /** The choices changed after the end: the kept file's reveal record follows them (until the game was shared, they may). */
  private followReveal(): Promise<unknown> {
    const agreed = this.agreed;
    return this.env.library.update(this.id, (f) => {
      const reveal = revealOf(f.game.players, agreed);
      return reveal.policy === f.reveal.policy && reveal.agreed.join() === f.reveal.agreed.join() ? null : { ...f, reveal };
    });
  }

  /** Read the record and keep it (once it is read; a record the server is still closing is asked for again, `tries` times). */
  private collect(tries: number): Promise<LibraryEntry | null> {
    if (this.entry) return this.entry;
    this.changed({ phase: 'saving' });
    this.entry = (async () => {
      for (let i = 0; i < tries; i++) {
        const got = await collectHostReplay(this.env, (p, init) => this.link.request(p, init), this.id);
        if (got.ok) {
          if (this.kept) await this.env.library.setKeep(got.entry.key, true);
          return got.entry;
        }
        this.problem = got.reason;
        // Kept already by an earlier page of this game (a reload after the end): the server removed its record then.
        if (got.status === 404) {
          const kept = await this.env.library.entry(this.id);
          if (kept) return kept;
        }
        if (got.status !== 409) break; // only a game the server is still closing is worth waiting for
        await sleep(RETRY_MS);
      }
      // Not now: the next start asks the server again (collectHostReplays).
      return null;
    })().then(
      (entry) => {
        if (entry) void this.followReveal();
        this.changed(entry ? { phase: 'saved', error: null } : { phase: 'failed', error: this.problem });
        if (!entry) {
          this.entry = null;
          this.gaveUp = true;
        }
        return entry;
      },
      (e: unknown) => {
        this.entry = null;
        this.changed({ phase: 'failed', error: e instanceof Error ? e.message : String(e) });
        return null;
      },
    );
    return this.entry;
  }

  private setKept(keep: boolean): void {
    this.kept = keep;
    this.changed({ kept: keep });
    void this.entry?.then((e) => e && this.env.library.setKeep(e.key, keep));
  }

  private async file(): Promise<ReplayFile | null> {
    const entry = await (this.entry ?? (isOver(this.link.status(), this.link) ? this.collect(RETRIES) : Promise.resolve(null)));
    if (!entry) return null;
    const read = await this.env.library.read(entry.key);
    return read.ok ? read.value : null;
  }

  /** Stop following the link. */
  stop(): void {
    this.off();
  }
}
