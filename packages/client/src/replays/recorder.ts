/**
 * RPL-1 (replays design 7.1): the recorder of a local game (hot-seat, against the computer, 2-4 players). It watches the game's log on its
 * `LocalConnection` (`observeLog`) and appends each applied action, its time and, where the checkpoint rule takes one (design 4: each turn start,
 * every 20th action), its digest to the game's in-progress record (inProgress.ts), so a closed tab or a crash keeps the game. An undo truncates the
 * record (design D8: a replay shows the game as it was finally played). A restored game continues its record (`resume`).
 *
 * When the game ends (CR 104), or the player leaves the game screen, the record becomes a library entry (library.ts): the game replay file with the
 * last action's checkpoint, the facts of the game and the reveal record (file.ts), and the in-progress record is removed. Then a worker makes the
 * fallback recording (completion.ts). A game left before its first action is not kept.
 *
 * At start, every in-progress record whose game screen is gone (no page holds it, liveness.ts) becomes an `'abandoned'` entry the same way
 * (`finishAbandoned`); a record made by another build is kept without a recording and plays as far as it checks out (design 5). Then every replay
 * still waiting for its recording is completed (a page closed while its worker ran, completion.ts `resume`).
 *
 * The rows the store may hold for a record are counted by a high-water mark (`stored`), never lowered by an undo: the delete of an undo may fail, and
 * the next one, or the next action's write, still removes every row past the log. A row left behind the log would be read back as part of it.
 *
 * The recorder holds the whole game (the config with its seed, and the log), as the LocalConnection does: it is never handed to the screen. What the
 * screen gets is its `LiveReplay` (live.ts). RPL-4: a bug report the player asks for takes the game so far through `LiveReplay.soFar` (replays
 * design 11), into the report code's closure, never into the screen's props or state.
 */
import {
  checkpointAfter, currentEngine, replayAction, startReplay, type Action, type GameState, type PlayerId, type ReplayCheckpoint, type ReplayFile,
  type ReplayPlayer,
} from '@openmtg/engine';
import type { LocalConnection, LogObserver } from '../connection/LocalConnection';
import type { DbOp } from './db';
import type { ReplayEnv } from './env';
import { asksAgreement, endingOf, gameReplayFile, newReplayId, peopleOf, revealOf, type RecordedGameInfo } from './file';
import {
  RECORD_VERSION, actionOp, headOp, readInProgress, removeOps, truncateOps, type InProgressHead, type InProgressRecord,
} from './inProgress';
import type { LibraryEntry } from './library';
import type { LiveReplay, LiveReplayState } from './live';
import { stillPlayed } from './liveness';

/** The records this page is recording now (never swept as abandoned, whatever the liveness says). */
const recording = new Set<string>();

const iso = (ms: number): string => new Date(ms).toISOString();

/** The facts of a game on `conn`: its seats (people at this screen, computers away from it), its mode and its saver (design 4). */
export function recordedGameInfo(conn: LocalConnection, format: string, id: string, startMs: number, env: ReplayEnv): RecordedGameInfo {
  const seated = new Set(conn.seated());
  const players: ReplayPlayer[] = conn.session.state.players.map((p) => ({ id: p.id, name: p.name, kind: seated.has(p.id) ? 'person' : 'computer' }));
  const people = peopleOf(players);
  return {
    id,
    createdAt: iso(startMs),
    app: { ...env.app },
    // The engine record of a replay saved now (engine replay/format.ts), with this client's build.
    engine: currentEngine(env.build),
    mode: players.some((p) => p.kind === 'computer') ? 'computer' : 'hotseat',
    format,
    players,
    savedBy: people.length === 1 ? people[0]!.id : null,
    config: conn.session.config,
  };
}

export class GameRecorder implements LogObserver {
  readonly id: string;
  /** What the screen may hold of this game's replay (live.ts). */
  readonly live: LiveReplay;
  private readonly head: InProgressHead;
  private readonly actions: Action[] = [];
  private readonly times: number[] = [];
  private checkpoints: ReplayCheckpoint[] = [];
  private readonly agreed: Set<PlayerId>;
  private kept = false;
  private snapshot: LiveReplayState;
  private readonly listeners = new Set<() => void>();
  /** The writes of the in-progress record, one after another. */
  private writes: Promise<void> = Promise.resolve();
  private writeFailed = false;
  /** How many action rows the store may hold (removed with the record): the high-water mark of the rows written, whatever an undo deleted. */
  private stored: number;
  private saving: Promise<LibraryEntry | null> | null = null;
  private readonly unobserve: () => void;
  private readonly release: () => void;

  private constructor(
    private readonly conn: LocalConnection,
    head: InProgressHead,
    private readonly env: ReplayEnv,
    log: { actions: readonly Action[]; times: readonly number[]; checkpoints: readonly ReplayCheckpoint[]; stored: number } | null,
  ) {
    this.id = head.id;
    this.head = head;
    this.agreed = new Set(head.agreed);
    this.stored = log?.stored ?? 0;
    if (log) {
      this.actions.push(...log.actions);
      this.times.push(...log.times);
      this.checkpoints = [...log.checkpoints];
    }
    this.snapshot = { phase: 'recording', error: null, agreed: [...this.agreed], kept: false };
    const people = peopleOf(head.players).map((p) => ({ id: p.id, name: p.name }));
    this.live = {
      people,
      asksAgreement: asksAgreement(head.players),
      state: () => this.snapshot,
      subscribe: (l) => {
        this.listeners.add(l);
        return () => {
          this.listeners.delete(l);
        };
      },
      setAgreed: (p, on) => this.setAgreed(p, on),
      setKept: (k) => this.setKept(k),
      file: () => this.file(),
      soFar: () => this.soFar(),
      left: () => void this.finish(),
    };
    recording.add(this.id);
    this.release = env.liveness.hold(this.id);
    this.unobserve = conn.observeLog(this);
  }

  /** Start recording the game on `conn` (a fresh game; actions it already has are recorded as made at its start). */
  static start(conn: LocalConnection, opts: { format: string; id?: string }, env: ReplayEnv): GameRecorder {
    const startMs = env.now();
    const info = recordedGameInfo(conn, opts.format, opts.id ?? newReplayId(), startMs, env);
    const agreed = revealOf(info.players, []).agreed;
    const head: InProgressHead = { ...info, key: info.id, type: 'head', version: RECORD_VERSION, startMs, agreed: [...agreed] };
    const r = new GameRecorder(conn, head, env, null);
    r.persist([headOp(head)]);
    r.catchUp(0);
    return r;
  }

  /**
   * Continue the record of a restored game (a `LocalConnection` built from `GameSession.fromJSON` of the record's config and log): the record keeps
   * its id, its start and its times; actions the restored game has beyond the record are appended, and a record longer than the game (or one that
   * differs from it) is cut back to what the two have in common.
   */
  static resume(conn: LocalConnection, record: InProgressRecord, env: ReplayEnv): GameRecorder {
    const recorded = record.log.actions;
    const actual = conn.session.actions;
    let common = 0;
    while (common < recorded.length && common < actual.length && JSON.stringify(recorded[common]) === JSON.stringify(actual[common])) common++;
    const log = {
      actions: recorded.slice(0, common),
      times: record.log.times.slice(0, common),
      checkpoints: record.log.checkpoints.filter((c) => c.action < common),
      stored: record.stored,
    };
    const r = new GameRecorder(conn, record.head, env, log);
    if (record.stored > common) r.persist(truncateOps(r.id, record.stored, common));
    r.catchUp(common);
    return r;
  }

  /** Record the actions of the game's log from `from` on that the record does not have (run once from the config for their states). */
  private catchUp(from: number): void {
    const log = this.conn.session.actions;
    if (log.length <= from) return;
    const start = startReplay(this.conn.session.config);
    if (!start.ok) return;
    let state = start.state;
    for (let i = 0; i < log.length; i++) {
      const r = replayAction(state, log[i]!, i);
      if (!r.ok) return;
      if (i >= from) this.record(log[i]!, i, state, r.state);
      state = r.state;
    }
  }

  private changed(next: Partial<LiveReplayState>): void {
    this.snapshot = { ...this.snapshot, ...next };
    for (const l of [...this.listeners]) l();
  }

  /** Queue a write of the in-progress record. A failed write is reported once; the game's replay is still saved from memory when it ends. */
  private persist(ops: DbOp[]): void {
    if (ops.length === 0) return;
    this.writes = this.writes
      .then(() => this.env.library.db.write(ops))
      .catch((e: unknown) => {
        if (!this.writeFailed) console.error('[Replays] the game could not be recorded as it went', e);
        this.writeFailed = true;
      });
  }

  private record(action: Action, index: number, before: GameState, after: GameState): void {
    const t = Math.max(0, this.env.now() - this.head.startMs, this.times[this.times.length - 1] ?? 0);
    const checkpoint = checkpointAfter(index, before.turn.number, after, false);
    this.actions.push(action);
    this.times.push(t);
    if (checkpoint) this.checkpoints.push(checkpoint);
    // With the row, in the same transaction, the rows past it that an undo's failed delete may have left: they would follow it in the log.
    this.persist([actionOp(this.id, index, action, t, checkpoint), ...truncateOps(this.id, this.stored, index + 1)]);
    this.stored = Math.max(this.stored, index + 1);
  }

  /** LogObserver: an action was applied. */
  applied(action: Action, index: number, before: GameState, after: GameState): void {
    if (this.saving) return;
    // The log and the record go together; should they ever part, the record follows the log.
    if (index < this.actions.length) this.undone(index);
    if (index > this.actions.length) {
      this.catchUp(this.actions.length);
      return;
    }
    this.record(action, index, before, after);
    if (after.result) void this.finish();
  }

  /** LogObserver: undo took actions back (design D8: they are not part of the game). */
  undone(length: number): void {
    if (this.saving || length >= this.actions.length) return;
    this.actions.length = length;
    this.times.length = length;
    this.checkpoints = this.checkpoints.filter((c) => c.action < length);
    // `stored` stays: should this delete fail, the next undo or the next action's write deletes these rows again.
    this.persist(truncateOps(this.id, this.stored, length));
  }

  /**
   * Save the game as a library entry (once): when the game ended, or when the player left the game screen (then an unfinished game is abandoned).
   * Settles with the entry, or null (nothing to keep, or it could not be saved: the in-progress record then stays for the next start).
   */
  finish(): Promise<LibraryEntry | null> {
    if (this.saving) return this.saving;
    this.unobserve();
    // The state the record ends with, taken now: an action applied after this (a computer's move while the screen closes) is not in the record.
    // Only a state of exactly the recorded log says how it ended (the record and the log never part, but nothing is assumed).
    const state = this.conn.session.actions.length === this.actions.length ? this.conn.session.state : null;
    const endedAt = this.env.now();
    this.changed({ phase: 'saving' });
    this.saving = this.save(state, endedAt).then(
      (entry) => {
        this.changed({ phase: 'saved' });
        return entry;
      },
      (e: unknown) => {
        console.error('[Replays] the replay could not be saved', e);
        this.changed({ phase: 'failed', error: e instanceof Error ? e.message : String(e) });
        return null;
      },
    );
    return this.saving;
  }

  private async save(state: GameState | null, endedAt: number): Promise<LibraryEntry | null> {
    await this.writes;
    const { library } = this.env;
    if (this.actions.length === 0) {
      await library.db.write(removeOps(this.id, this.stored)).catch(() => {});
      this.done();
      return null;
    }
    const last = this.actions.length - 1;
    if (state && !this.checkpoints.some((c) => c.action === last)) this.checkpoints.push(checkpointAfter(last, state.turn.number, state, true)!);
    const file = gameReplayFile({
      info: this.head,
      log: { actions: this.actions, times: this.times, checkpoints: this.checkpoints },
      ending: state ? endingOf(state) : null,
      ...(state ? { turns: state.turn.number } : {}),
      endedAt: iso(endedAt),
      agreed: this.agreed,
    });
    const entry = await library.add(file, { keep: this.kept, toComplete: true });
    await library.db.write(removeOps(this.id, this.stored)).catch((e: unknown) => console.error('[Replays] the finished record could not be removed', e));
    this.done();
    void this.env.completion?.enqueue(entry.key);
    return entry;
  }

  private done(): void {
    recording.delete(this.id);
    this.release();
  }

  private setAgreed(player: PlayerId, agree: boolean): void {
    if (!this.live.people.some((p) => p.id === player)) return;
    if (agree) this.agreed.add(player);
    else this.agreed.delete(player);
    const reveal = revealOf(this.head.players, this.agreed);
    this.changed({ agreed: reveal.agreed });
    // The current choice is written whole, so the last toggle wins whatever order the writes finish in.
    void this.saving?.then((entry) => entry && this.env.library.update(entry.key, (f) => ({ ...f, reveal: revealOf(this.head.players, this.agreed) })));
  }

  private setKept(keep: boolean): void {
    this.kept = keep;
    this.changed({ kept: keep });
    void this.saving?.then((entry) => entry && this.env.library.setKeep(entry.key, this.kept));
  }

  private async file(): Promise<ReplayFile | null> {
    const entry = this.saving ? await this.saving : null;
    if (!entry) return null;
    const read = await this.env.library.read(entry.key);
    return read.ok ? read.value : null;
  }

  /**
   * RPL-4 (live.ts `soFar`): the game as recorded up to now, for a bug report: the file `finish` would save at this moment. The state is the game's
   * when the record and the log agree (as in `finish`, nothing is assumed): it gives the last action's checkpoint, the turn and how the game ended.
   */
  private soFar(): ReplayFile {
    const state = this.conn.session.actions.length === this.actions.length ? this.conn.session.state : null;
    const last = this.actions.length - 1;
    const checkpoints = [...this.checkpoints];
    if (state && last >= 0 && !checkpoints.some((c) => c.action === last)) checkpoints.push(checkpointAfter(last, state.turn.number, state, true)!);
    return gameReplayFile({
      info: this.head,
      log: { actions: this.actions, times: this.times, checkpoints },
      ending: state ? endingOf(state) : null,
      ...(state ? { turns: state.turn.number } : {}),
      endedAt: iso(this.env.now()),
      agreed: this.agreed,
    });
  }
}

/**
 * At start (design 7.1): every in-progress record whose game screen is gone becomes an `'abandoned'` library entry, and the worker completes it (under
 * the build that recorded it: the recording, and the result if the game had in fact ended). Records with no action are dropped. Then every replay
 * still waiting for its recording is queued for the worker (completion.ts `resume`: the ones just saved, and those of a page that closed or crashed
 * before its worker was done). Returns the ids saved.
 */
export async function finishAbandoned(env: ReplayEnv): Promise<string[]> {
  const db = env.library.db;
  const { records, orphans } = await readInProgress(db);
  if (orphans.length > 0) await db.write(orphans.map((key) => ({ store: 'inProgress' as const, delete: key })));
  const held = await env.liveness.held();
  const now = env.now();
  const saved: string[] = [];
  for (const { head, log, stored } of records) {
    const lastSign = head.startMs + (log.times[log.times.length - 1] ?? 0);
    if (recording.has(head.id) || stillPlayed(head.id, lastSign, now, held)) continue;
    try {
      if (log.actions.length > 0 && !(await env.library.entry(head.id))) {
        await env.library.add(gameReplayFile({ info: head, log, ending: null, endedAt: iso(lastSign), agreed: head.agreed }), { toComplete: true });
        saved.push(head.id);
      }
      await db.write(removeOps(head.id, stored));
    } catch (e) {
      console.error('[Replays] an unfinished game could not be saved', e);
    }
  }
  await env.completion?.resume();
  return saved;
}
