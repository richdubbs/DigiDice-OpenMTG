/**
 * RPL-3 (replays design 3, 6, 7.3, 16.3): an online guest's replay. A guest never holds the game (no seed, no log: packages/net game/guest.ts), so what it
 * keeps is a recording (design D2): every view it was shown and the events of each change, as the host sent them (already redacted for this player,
 * CR 400.2), captured from its `RemoteConnection` as they arrive. A recording holds exactly what its player was shown, nothing more.
 *
 * Frames (engine replay/format.ts): one per view, by the view's `seq` (the actions the host had applied); a full view at the first frame, at the start of
 * every 5th turn, after RECORDING_MAX_PATCH_RUN patches in a row and after a gap (a reconnection's sync: views were missed), a view patch (`diffJson`)
 * against the previous frame's view otherwise; each view's definitions are kept once. A resent view (a new socket, the same seq) is not a new frame.
 *
 * Kept as it goes in the `inProgress` store (replays/db.ts) under the replay id the guest's server gives the game (`status.replay.id`): a head row and one
 * row per frame, so a closed tab or a crash keeps the game; a reloaded page goes on with the same record. When the game is over (CR 104), or the player
 * leaves the game screen, the recording becomes a library entry (kind 'recording', mode 'onlineGuest'); at start, a record whose page is gone becomes an
 * abandoned one (`finishAbandonedOnline`), unless its game is still open at the page's server (a reload: the player returns to it). A recording kept as
 * abandoned while its game went on (an older page's sweep, a screen left before the server left the game) goes on when the player returns to the game.
 *
 * When every player agreed and the game is over, the host shares the whole game (`replayGame`, design D5). It is checked as any replay file (engine
 * `readReplayFile`: at most REPLAY_GAME_MAX_BYTES of gzip, bounded expansion, the format's shape) and against what this player saw (the same seats, as
 * many actions at least as the last view, the same result), and then replaces the recording in the library: a game replay saved by this player (mode
 * 'onlineGuest') whose fallback is this player's own live recording (at the host's times); under this build the worker makes the fallback again from
 * the game as for every game replay (replays/completion.ts), and it replaces the live one only when this build plays the game as it was recorded. A
 * file that does not pass is refused, never thrown on; the recording stays.
 *
 * RPL-4's seam (replays/live.ts `soFar`): a bug report the player asks for during the game carries this recording so far (what this player was shown),
 * or, once adopted, the shared game (every player agreed).
 *
 * Browser code: engine functions and the client's replay modules only.
 */
import {
  RECORDING_MAX_PATCH_RUN, REPLAY_FORMAT, REPLAY_FORMAT_VERSION, REPLAY_LIMITS, cleanText, currentEngine, diffJson, readReplayFile, recordingFrameView,
  type CardDef, type GameEvent, type GameResult, type GameView, type PlayerId, type RecordingFrame, type RecordingKeyView, type ReplayApp,
  type ReplayEnd, type ReplayEngine, type ReplayFile, type ReplayPlayer,
} from '@openmtg/engine';
import { REPLAY_GAME_MAX_BYTES } from '@openmtg/server/online';
import type { RemoteConnection } from '../connection/RemoteConnection';
import type { DbOp, DbRow, ReplayDb } from '../replays/db';
import type { ReplayEnv } from '../replays/env';
import { KEY_FRAME_TURNS } from '../replays/fallback';
import { defaultTitle, newReplayId } from '../replays/file';
import type { LibraryEntry } from '../replays/library';
import type { LiveReplay, LiveReplayState } from '../replays/live';
import { stillPlayed } from '../replays/liveness';
import type { OnlineLink } from './OnlineLink';

/** How long a recording waits for the server to leave the game when its player leaves the screen (the server's own wait is 3 s, bridge.ts). */
export const LEAVE_WAIT_MS = 4000;

/** The version of these rows' shape. */
export const ONLINE_ROW_VERSION = 1;
/** Row types of the `inProgress` store that are this module's (replays/inProgress.ts leaves rows of a type starting with "online" alone). */
export const ONLINE_HEAD = 'onlineHead';
export const ONLINE_FRAME = 'onlineFrame';

export interface OnlineHeadRow extends DbRow {
  type: typeof ONLINE_HEAD;
  version: number;
  id: string;
  /** Epoch milliseconds of the start: a frame's time is milliseconds since then. */
  startMs: number;
  createdAt: string;
  me: PlayerId;
  format: string;
  app: ReplayApp;
  engine: ReplayEngine;
}

export interface OnlineFrameRow extends DbRow {
  type: typeof ONLINE_FRAME;
  id: string;
  /** The frame's index in the recording. */
  n: number;
  frame: RecordingFrame;
  /** The definitions this frame's view uses that no earlier frame did. */
  defs: Record<string, CardDef>;
}

export const frameKey = (id: string, n: number): string => `${id}~${String(n).padStart(6, '0')}`;

const iso = (ms: number): string => new Date(ms).toISOString();

const keyless = (v: GameView): { key: RecordingKeyView; defs: Record<string, CardDef> } => {
  const { defs, ...key } = v;
  return { key, defs };
};

/** The seats of a view as a replay lists them: every online seat is a person. */
function playersOf(view: Pick<GameView, 'players'>): ReplayPlayer[] {
  return view.players.map((p) => ({ id: p.id, name: cleanText(p.name).trim().slice(0, 64) || p.id, kind: 'person' }));
}

/** How the game ended for this player, from the last view (CR 104; the rule of replays/file.ts `endingOf`, on a view). */
function endingOfView(view: RecordingKeyView, me: PlayerId): { ended: ReplayEnd; result: GameResult | null } {
  if (view.result) {
    const out = view.players.filter((p) => p.hasLost);
    const withOrder = out.filter((p) => p.left !== undefined);
    const last = withOrder.length > 0 ? withOrder.reduce((a, b) => (b.left!.order > a.left!.order ? b : a)) : null;
    const conceded = last ? last.conceded : out.some((p) => p.conceded);
    return { ended: conceded ? 'conceded' : 'finished', result: { winner: view.result.winner, reason: view.result.reason } };
  }
  // Left before the end: conceded (a guest's Leave concedes, CR 104.3a), or simply gone (a lost link, a closed page).
  return { ended: view.players.find((p) => p.id === me)?.conceded ? 'conceded' : 'abandoned', result: null };
}

/** What a recording is made of. */
interface Recorded {
  head: OnlineHeadRow;
  frames: RecordingFrame[];
  defs: Record<string, CardDef>;
  /** The last frame's view. */
  last: RecordingKeyView | null;
  agree: boolean;
  endedAt: number;
  title?: string;
}

/** The recording file (kind 'recording', mode 'onlineGuest') of what was recorded; null without a frame. */
export function onlineRecordingFile(r: Recorded): ReplayFile | null {
  const last = r.last;
  if (!last || r.frames.length === 0) return null;
  const players = playersOf(last);
  const { ended, result } = endingOfView(last, r.head.me);
  return {
    format: REPLAY_FORMAT,
    formatVersion: REPLAY_FORMAT_VERSION,
    kind: 'recording',
    id: r.head.id,
    title: r.title ?? defaultTitle(players, r.head.format),
    createdAt: r.head.createdAt,
    app: { ...r.head.app },
    engine: { ...r.head.engine },
    game: {
      mode: 'onlineGuest',
      format: r.head.format,
      players,
      savedBy: r.head.me,
      ended,
      result,
      turns: last.turn.number,
      actions: r.frames[r.frames.length - 1]!.seq,
      startedAt: r.head.createdAt,
      endedAt: iso(Math.max(r.endedAt, r.head.startMs)),
    },
    reveal: { policy: 'own', agreed: r.agree ? [r.head.me] : [] },
    recording: { viewer: r.head.me, defs: { ...r.defs }, frames: r.frames.map((f) => ({ ...f })) },
  };
}

/** The bytes of base64 text (atob: every browser and Node). Never throws: null for text that is not base64. */
function base64Bytes(text: string): Uint8Array | null {
  let bin: string;
  try {
    bin = atob(text);
  } catch {
    return null;
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export type SharedGameCheck = { ok: true; file: ReplayFile } | { ok: false; reason: string };

/**
 * The game the host shared (`replayGame`), checked before it is kept (never throws): base64 of at most REPLAY_GAME_MAX_BYTES, a replay file the engine
 * reads (bounded expansion, the format's shape), a game replay, and the game this player saw: the same seats, saved by this player, at least as many
 * actions as the last view, the same result when the last view has one.
 */
export async function checkSharedGame(data: unknown, me: PlayerId, seen: RecordingKeyView | null, lastSeq: number): Promise<SharedGameCheck> {
  if (typeof data !== 'string' || data.length === 0 || data.length > 4 * Math.ceil(REPLAY_GAME_MAX_BYTES / 3)) return { ok: false, reason: 'it is not a replay of the size a host sends' };
  const bytes = base64Bytes(data);
  if (!bytes) return { ok: false, reason: 'it is not base64 text' };
  let read: Awaited<ReturnType<typeof readReplayFile>>;
  try {
    read = await readReplayFile(bytes, { ...REPLAY_LIMITS, maxFileBytes: REPLAY_GAME_MAX_BYTES, maxTextBytes: 64 * 1024 * 1024 });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  if (!read.ok) return { ok: false, reason: read.error.message };
  const file = read.value;
  if (file.kind !== 'game' || !file.play) return { ok: false, reason: 'it is not a game replay' };
  if (file.game.savedBy !== me) return { ok: false, reason: 'it was made for another player' };
  if (seen) {
    const ids = (ps: readonly { id: string; name: string }[]) => ps.map((p) => `${p.id}\u0000${cleanText(p.name).trim().slice(0, 64) || p.id}`).sort().join('\u0001');
    if (ids(file.game.players) !== ids(seen.players)) return { ok: false, reason: 'its players are not the ones of this game' };
    if (seen.result && (file.game.result?.winner ?? null) !== seen.result.winner) return { ok: false, reason: 'its result is not the one of this game' };
  }
  if (file.play.actions.length < lastSeq) return { ok: false, reason: 'it holds less of the game than this player saw' };
  return { ok: true, file };
}

/**
 * A guest's recording, retimed to the host's times (frame `seq` s after s actions: the time of action s), as the fallback of the game it now belongs to
 * when this build cannot make the exact one (design 5: the replay takes it over where the game no longer plays the same).
 */
function retimed(frames: readonly RecordingFrame[], times: readonly number[]): RecordingFrame[] {
  let t = 0;
  return frames.map((f) => {
    t = Math.max(t, f.seq <= 0 ? 0 : times[f.seq - 1] ?? t);
    return { ...f, t };
  });
}

/**
 * The shared game (checked, `checkSharedGame`) replaces this player's recording `entry` in the library: a game replay saved by `me` (mode 'onlineGuest'),
 * with the recording, retimed to the host's times, as its fallback. Under this build the worker makes the fallback again from the game and replaces the
 * recording only when it succeeds (design 5: a game this build does not play as recorded keeps the recording; replays/completion.ts, `replace`).
 */
async function keepShared(env: ReplayEnv, id: string, me: PlayerId, file: ReplayFile, entry: LibraryEntry | null, keep: boolean): Promise<{ entry: LibraryEntry; file: ReplayFile }> {
  const { library } = env;
  const exact = file.engine.build !== null && file.engine.build === env.build && env.completion !== null;
  const own = entry ? await library.read(id) : null;
  const recording = own?.ok ? own.value.recording : undefined;
  const next: ReplayFile = {
    ...file,
    id,
    title: entry?.summary.title ?? file.title,
    app: { ...env.app },
    game: { ...file.game, mode: 'onlineGuest', savedBy: me },
    ...(recording ? { recording: { ...recording, frames: retimed(recording.frames, file.play!.times) } } : {}),
  };
  const out = await library.add(next, { keep: entry?.keep ?? keep, toComplete: exact && (recording ? 'replace' : true) });
  if (exact) void env.completion?.enqueue(out.key);
  return { entry: out, file: next };
}

/** The rows of every online record in the store, by replay id: heads and frames in order up to the first missing one (`stored`: every row key). */
export async function readOnlineRecords(db: ReplayDb): Promise<Map<string, { head: OnlineHeadRow | null; frames: OnlineFrameRow[]; keys: string[] }>> {
  const rows = await db.getAll<DbRow & { type?: unknown; id?: unknown; n?: unknown }>('inProgress');
  const out = new Map<string, { head: OnlineHeadRow | null; frames: OnlineFrameRow[]; keys: string[] }>();
  const of = (id: string) => {
    let r = out.get(id);
    if (!r) out.set(id, (r = { head: null, frames: [], keys: [] }));
    return r;
  };
  for (const r of rows) {
    if (typeof r.id !== 'string') continue;
    if (r.type === ONLINE_HEAD && r.key === r.id) {
      const rec = of(r.id);
      rec.head = r as OnlineHeadRow;
      rec.keys.push(r.key);
    } else if (r.type === ONLINE_FRAME && Number.isInteger(r.n)) {
      const rec = of(r.id);
      rec.frames.push(r as OnlineFrameRow);
      rec.keys.push(r.key);
    }
  }
  for (const r of out.values()) {
    r.frames.sort((a, b) => a.n - b.n);
    const upTo = r.frames.findIndex((f, i) => f.n !== i);
    if (upTo >= 0) r.frames = r.frames.slice(0, upTo);
  }
  return out;
}

/** The frames' views, rebuilt and checked as playback would (engine `recordingFrameView`): the frames up to the first that does not fit, and the last view. */
function rebuild(me: PlayerId, rows: readonly OnlineFrameRow[]): { frames: RecordingFrame[]; defs: Record<string, CardDef>; last: RecordingKeyView | null } {
  const frames: RecordingFrame[] = [];
  const defs: Record<string, CardDef> = {};
  let last: RecordingKeyView | null = null;
  for (const row of rows) {
    for (const [k, d] of Object.entries(row.defs ?? {})) if (!Object.hasOwn(defs, k)) defs[k] = d;
    const v = recordingFrameView(last, row.frame, { viewer: me, defs });
    if (!v.ok || (frames.length > 0 && row.frame.seq <= frames[frames.length - 1]!.seq)) break;
    frames.push(row.frame);
    last = v.value;
  }
  return { frames, defs, last };
}

/** One frame waiting for the recorder to be ready (the connection's change, as it came). */
interface Shown {
  seq: number;
  view: GameView;
  events: readonly GameEvent[];
  at: number;
}

/** The guest's recorder (see the file comment). Start it with `OnlineGuestRecorder.start`. */
export class OnlineGuestRecorder {
  readonly id: string;
  readonly live: LiveReplay;
  private head: OnlineHeadRow;
  private frames: RecordingFrame[] = [];
  private defs: Record<string, CardDef> = {};
  private prev: RecordingKeyView | null = null;
  private run = 0;
  private n = 0;
  /** Settles when what an earlier page of this game kept was read (`init`); frames wait in `waiting` until then. */
  private initDone: Promise<void> = Promise.resolve();
  private ready = false;
  private waiting: Shown[] = [];
  private writes: Promise<void> = Promise.resolve();
  private writeFailed = false;
  /** The rows this record has in the store (removed when it is saved). */
  private readonly keys = new Set<string>();
  /** The library entry, once the recording (or the game) is in it. */
  private saving: Promise<LibraryEntry | null> | null = null;
  /** The shared game adopted, or being adopted. */
  private adopting: Promise<void> | null = null;
  /** The shared game as kept, once adopted. */
  private adopted: ReplayFile | null = null;
  private kept = false;
  /** The title of the library's entry this recording goes on from (it may have been renamed), when it does. */
  private title: string | undefined;
  private snapshot: LiveReplayState;
  private readonly listeners = new Set<() => void>();
  private readonly offs: (() => void)[] = [];
  private release: () => void = () => {};
  /** Why the shared game was refused, when it was (diagnostics, tests). */
  refused: string | null = null;

  private constructor(
    private readonly conn: RemoteConnection,
    private readonly link: OnlineLink,
    private readonly env: ReplayEnv,
    id: string,
    me: PlayerId,
  ) {
    this.id = id;
    const now = env.now();
    this.head = {
      key: id, type: ONLINE_HEAD, version: ONLINE_ROW_VERSION, id, startMs: now, createdAt: iso(now), me, format: cleanText(link.status().format ?? '').slice(0, 40),
      app: { ...env.app }, engine: currentEngine(env.build),
    };
    this.snapshot = { phase: 'recording', error: null, agreed: this.agreed(), kept: false };
    const name = conn.view().players.find((p) => p.id === me)?.name ?? me;
    this.live = {
      people: [{ id: me, name }],
      // The choice is the online panel's (OnlineGamePanel): each player ticks it on their own screen, during the game and after it.
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
      soFar: () => this.soFar(),
      left: () => void this.leftScreen(),
    };
  }

  /**
   * RPL-4 (live.ts `soFar`): what a bug report carries of this game now: the shared game once adopted, else the recording so far (the frames shown up
   * to now; before the first is recorded, the view on screen as one key frame). Never more than this player was shown, but for the shared game.
   */
  private soFar(): ReplayFile {
    if (this.adopted) return this.adopted;
    if (this.ready) this.drain();
    let frames = this.frames;
    let defs = this.defs;
    let last = this.prev;
    if (frames.length === 0) {
      const { key, defs: d } = keyless(this.conn.view());
      frames = [{ seq: Math.max(0, this.conn.events().seq), t: 0, key, events: [] }];
      defs = d;
      last = key;
    }
    return onlineRecordingFile({ head: this.head, frames, defs, last, agree: this.agreed().length > 0, endedAt: this.env.now() })!;
  }

  /** Record the guest's game on `conn` (its first view is recorded at once; a record of this game kept by an earlier page goes on). */
  static start(conn: RemoteConnection, link: OnlineLink, env: ReplayEnv): OnlineGuestRecorder {
    const me = link.status().me ?? conn.view().viewer!;
    const id = link.status().replay?.id ?? newReplayId();
    const r = new OnlineGuestRecorder(conn, link, env, id, me);
    r.release = env.liveness.hold(id);
    r.offs.push(conn.subscribe(() => r.shown()));
    r.offs.push(link.subscribe(() => r.linkChanged()));
    r.shown();
    r.initDone = r.init().catch((e: unknown) => {
      console.error('[Replays] the online game could not be recorded', e);
      r.ready = true;
    });
    return r;
  }

  private agreed(): PlayerId[] {
    return this.link.status().replay?.agree ? [this.head.me] : [];
  }

  private changed(next: Partial<LiveReplayState>): void {
    this.snapshot = { ...this.snapshot, ...next };
    for (const l of [...this.listeners]) l();
  }

  private linkChanged(): void {
    const agreed = this.agreed();
    if (agreed.length !== this.snapshot.agreed.length) this.changed({ agreed });
    // The shared game once the record is read (`init` looks again at its end).
    const data = this.link.replayGame();
    if (data !== null && this.ready) void this.adopt(data);
  }

  /** The connection changed: a new view is a frame (a resend of the same seq is not). */
  private shown(): void {
    const batch = this.conn.events();
    const last = this.waiting[this.waiting.length - 1]?.seq ?? this.frames[this.frames.length - 1]?.seq ?? -1;
    if (batch.seq <= last || this.saving) return;
    this.waiting.push({ seq: batch.seq, view: this.conn.view(), events: batch.events, at: this.env.now() });
    if (!this.ready) return;
    this.drain();
    if (this.prev?.result) void this.finish(); // the game is over (CR 104)
  }

  /** Read what an earlier page of this game kept (a reload), then record what came meanwhile. */
  private async init(): Promise<void> {
    const library = this.env.library;
    const entry = await library.entry(this.id);
    const cut = entry ? await this.cutShort(entry) : null;
    if (entry && !cut) {
      // Saved already (the game ended before a reload): nothing more to record; a shared game still replaces it.
      this.waiting = [];
      this.ready = true;
      this.saving = Promise.resolve(entry);
      this.release();
      this.changed({ phase: 'saved' });
      this.linkChanged();
      return;
    }
    const earlier = entry ? null : (await readOnlineRecords(library.db)).get(this.id);
    if (entry && cut) {
      // Kept as abandoned while the game went on (see `cutShort`): the recording goes on from it, its rows written again (a closed tab or a crash keeps
      // what comes next); the library entry stays until the recording is saved over it.
      const rows = this.goOnFrom(cut);
      this.kept = entry.keep;
      this.title = cut.title;
      this.persist(rows.map((put) => ({ store: 'inProgress' as const, put })));
    } else if (earlier?.head && earlier.head.me === this.head.me) {
      this.head = earlier.head;
      const r = rebuild(this.head.me, earlier.frames);
      this.takeFrames(r);
      // The rows of the frames kept go on; any other row of this record (past a frame that does not fit, past a gap) would be read back as part of it.
      const kept = new Set([earlier.head.key, ...earlier.frames.slice(0, r.frames.length).map((f) => f.key)]);
      for (const k of kept) this.keys.add(k);
      const stale = earlier.keys.filter((k) => !kept.has(k));
      if (stale.length > 0) this.persist(stale.map((key) => ({ store: 'inProgress' as const, delete: key })));
    } else {
      this.persist([{ store: 'inProgress', put: this.head }]);
      this.keys.add(this.head.key);
    }
    this.ready = true;
    this.drain();
    if (this.prev?.result) void this.finish();
    this.linkChanged();
  }

  /** The frames recorded so far, as `rebuild` read them back. */
  private takeFrames(r: ReturnType<typeof rebuild>): void {
    this.frames = r.frames;
    this.defs = r.defs;
    this.prev = r.last;
    this.n = r.frames.length;
    this.run = 0;
    for (const f of this.frames) this.run = f.key !== undefined ? 0 : this.run + 1;
  }

  /**
   * The library's recording of this game when it was cut short while the game went on: kept as abandoned (the start-up sweep of an older page took the
   * game for a closed one, or the screen was left before the server left the game) while this page's server still has the game open. Null for
   * anything else: a game that ended, or that this player left, was saved already.
   */
  private async cutShort(entry: LibraryEntry): Promise<ReplayFile | null> {
    const s = this.link.status();
    const open = s.phase !== 'idle' && s.phase !== 'closed' && s.replay?.id === this.id;
    if (!open || entry.summary.kind !== 'recording' || entry.summary.game.ended !== 'abandoned') return null;
    const read = await this.env.library.read(this.id);
    if (!read.ok) return null;
    const file = read.value;
    return file.kind === 'recording' && file.recording?.viewer === this.head.me && file.game.savedBy === this.head.me ? file : null;
  }

  /** Go on from a recording the library kept (`cutShort`): its start and its frames as playback rebuilds them. Returns its rows, to write again. */
  private goOnFrom(file: ReplayFile): (OnlineHeadRow | OnlineFrameRow)[] {
    const startMs = Date.parse(file.game.startedAt);
    this.head = {
      key: this.id, type: ONLINE_HEAD, version: ONLINE_ROW_VERSION, id: this.id, startMs: Number.isFinite(startMs) ? startMs : this.head.startMs,
      createdAt: file.createdAt, me: this.head.me, format: file.game.format, app: { ...file.app }, engine: { ...file.engine },
    };
    const rec = file.recording!;
    // Every definition with the first frame (a row holds those its frame's view needs that no earlier one did: all of them, the first time).
    const rows = rec.frames.map((frame, n): OnlineFrameRow => ({ key: frameKey(this.id, n), type: ONLINE_FRAME, id: this.id, n, frame, defs: n === 0 ? { ...rec.defs } : {} }));
    const r = rebuild(this.head.me, rows);
    this.takeFrames(r);
    const out = [this.head, ...rows.slice(0, r.frames.length)];
    for (const row of out) this.keys.add(row.key);
    return out;
  }

  /**
   * Record the frames that came (never past the game's end). Also once the recording is being saved: `finish` drains what came before it, while `init`
   * was still reading what an earlier page kept (nothing is added to `waiting` after `finish`).
   */
  private drain(): void {
    while (!this.prev?.result && this.waiting.length > 0) this.record(this.waiting.shift()!);
    this.waiting = [];
  }

  private record(s: Shown): void {
    const lastSeq = this.frames[this.frames.length - 1]?.seq ?? -1;
    if (s.seq <= lastSeq) return;
    const { key, defs } = keyless(s.view);
    const fresh: Record<string, CardDef> = {};
    for (const [k, d] of Object.entries(defs)) {
      if (Object.hasOwn(this.defs, k)) continue;
      this.defs[k] = d;
      fresh[k] = d;
    }
    const t = Math.max(0, s.at - this.head.startMs, this.frames[this.frames.length - 1]?.t ?? 0);
    const prev = this.prev;
    const turnStarted = prev !== null && key.turn.number !== prev.turn.number && (key.turn.number - 1) % KEY_FRAME_TURNS === 0;
    const gap = lastSeq >= 0 && s.seq !== lastSeq + 1;
    const events = [...s.events];
    let frame: RecordingFrame;
    if (prev === null || turnStarted || gap || this.run >= RECORDING_MAX_PATCH_RUN) {
      frame = { seq: s.seq, t, key, events };
      this.run = 0;
    } else {
      frame = { seq: s.seq, t, patch: diffJson(prev, key), events };
      this.run++;
    }
    this.frames.push(frame);
    this.prev = key;
    const row: OnlineFrameRow = { key: frameKey(this.id, this.n), type: ONLINE_FRAME, id: this.id, n: this.n, frame, defs: fresh };
    this.n++;
    this.keys.add(row.key);
    this.persist([{ store: 'inProgress', put: row }]);
  }

  /** Queue a write; a failed one is reported once (the recording is still saved from memory when the game ends). */
  private persist(ops: DbOp[]): void {
    this.writes = this.writes
      .then(() => this.env.library.db.write(ops))
      .catch((e: unknown) => {
        if (!this.writeFailed) console.error('[Replays] the online game could not be recorded as it went', e);
        this.writeFailed = true;
      });
  }

  /**
   * The player left the game screen. Leaving goes with leaving the game at the server (GameScreen: a running game is conceded first, CR 104.3a), whose
   * last view (with the concession) may still be on its way: the recording ends once the server has left the game, or after LEAVE_WAIT_MS.
   */
  private async leftScreen(): Promise<void> {
    const open = () => ['playing', 'over', 'reconnecting', 'waiting', 'spectating'].includes(this.link.status().phase) && this.link.linkState() === 'open';
    const end = this.env.now() + LEAVE_WAIT_MS;
    while (!this.saving && open() && this.env.now() < end) await new Promise((r) => setTimeout(r, 25));
    await this.finish();
  }

  /** The recording becomes a library entry (once): the game is over, or the player left the game screen. */
  finish(): Promise<LibraryEntry | null> {
    if (this.saving) return this.saving;
    const endedAt = this.env.now();
    this.changed({ phase: 'saving' });
    // After what an earlier page kept was read, and with every frame that came.
    this.saving = this.initDone.then(() => {
      this.drain();
      return this.save(endedAt);
    }).then(
      (entry) => {
        this.changed({ phase: entry ? 'saved' : 'failed', ...(entry ? {} : { error: 'There was nothing to keep.' }) });
        return entry;
      },
      (e: unknown) => {
        console.error('[Replays] the online replay could not be saved', e);
        this.changed({ phase: 'failed', error: e instanceof Error ? e.message : String(e) });
        return null;
      },
    );
    return this.saving;
  }

  private async save(endedAt: number): Promise<LibraryEntry | null> {
    await this.writes;
    const file = onlineRecordingFile({
      head: this.head, frames: this.frames, defs: this.defs, last: this.prev, agree: this.agreed().length > 0, endedAt, ...(this.title !== undefined ? { title: this.title } : {}),
    });
    const { library } = this.env;
    if (!file) {
      await this.removeRows();
      return null;
    }
    const entry = await library.add(file, { keep: this.kept });
    await this.removeRows();
    return entry;
  }

  /** The record's rows go once its recording is in the library (or there was nothing to keep); the page no longer holds it. */
  private async removeRows(): Promise<void> {
    await this.writes;
    const ops: DbOp[] = [...this.keys].map((key) => ({ store: 'inProgress' as const, delete: key }));
    this.keys.clear();
    if (ops.length > 0) await this.env.library.db.write(ops).catch((e: unknown) => console.error('[Replays] the finished online record could not be removed', e));
    this.release();
    this.release = () => {};
  }

  /**
   * The game the host shared (`replayGame`): checked (`checkSharedGame`), then it replaces the recording in the library once the recording was saved
   * (see the file comment). Once; a file that does not pass is refused and the recording stays.
   */
  private adopt(data: string): Promise<void> {
    if (this.adopting) return this.adopting;
    this.adopting = (async () => {
      const lastSeq = this.frames[this.frames.length - 1]?.seq ?? 0;
      const checked = await checkSharedGame(data, this.head.me, this.prev, lastSeq);
      if (!checked.ok) {
        this.refused = checked.reason;
        console.error(`[Replays] the game the host shared was not kept: ${checked.reason}`);
        return;
      }
      // The game is over (the host shares only then): the recording is saved first, so the game replaces a whole entry.
      const saved = await this.finish();
      const entry = saved ?? (await this.env.library.entry(this.id)) ?? null;
      if (entry?.summary.kind === 'game') return; // adopted already (an earlier page)
      const kept = await keepShared(this.env, this.id, this.head.me, checked.file, entry, this.kept);
      this.adopted = kept.file;
      this.saving = Promise.resolve(kept.entry);
      this.changed({ phase: 'saved', agreed: [this.head.me] });
    })().catch((e: unknown) => {
      this.refused = e instanceof Error ? e.message : String(e);
      console.error('[Replays] the game the host shared could not be kept', e);
    });
    return this.adopting;
  }

  /** Settles when the shared game was kept or refused (tests). */
  whenAdopted(): Promise<void> {
    return this.adopting ?? Promise.resolve();
  }

  private setKept(keep: boolean): void {
    this.kept = keep;
    this.changed({ kept: keep });
    void this.saving?.then((entry) => entry && this.env.library.setKeep(entry.key, this.kept));
  }

  private async file(): Promise<ReplayFile | null> {
    if (!this.saving) return null;
    await this.adopting;
    const entry = await this.saving;
    if (!entry) return null;
    const read = await this.env.library.read(entry.key);
    return read.ok ? read.value : null;
  }

  /** Stop listening (the connection is gone). */
  stop(): void {
    for (const off of this.offs.splice(0)) off();
    this.release();
  }
}

/**
 * At start (design 7.3): every online record whose page is gone (no page holds it, replays/liveness.ts) becomes an abandoned recording in the library,
 * as far as its frames go (a record whose game had ended is saved as finished), but not the record of the game this page's server still has open
 * (`open`: a reloaded page whose player has not returned to the game yet; the recorder goes on with it then). Rows of a record without a head are
 * removed. A record that went on from an abandoned recording (the recorder's `cutShort`) replaces it when it holds more. Returns the ids saved.
 */
export async function finishAbandonedOnline(env: ReplayEnv, o: { open?: string | null } = {}): Promise<string[]> {
  const records = await readOnlineRecords(env.library.db);
  const held = await env.liveness.held();
  const now = env.now();
  const saved: string[] = [];
  for (const [id, r] of records) {
    try {
      if (!r.head) {
        await saveRows(env, id, r);
        continue;
      }
      if (id === o.open) continue;
      const built = rebuild(r.head.me, r.frames);
      const lastSign = r.head.startMs + (built.frames[built.frames.length - 1]?.t ?? 0);
      if (stillPlayed(id, lastSign, now, held)) continue;
      if (await saveRows(env, id, r, built)) saved.push(id);
    } catch (e) {
      console.error('[Replays] an unfinished online game could not be saved', e);
    }
  }
  return saved;
}

/**
 * The rows of a record a page left (`readOnlineRecords`) become its recording in the library, as far as its frames go (ended as its last view says),
 * unless the library has it already (but for a shorter abandoned recording, which gives way); the rows are removed. `built`: its frames rebuilt
 * already. Returns whether it was saved.
 */
async function saveRows(
  env: ReplayEnv,
  id: string,
  r: { head: OnlineHeadRow | null; frames: OnlineFrameRow[]; keys: string[] },
  built?: ReturnType<typeof rebuild>,
): Promise<boolean> {
  // Rows of every frame of the id, also past a gap (`readOnlineRecords` keeps only the frames in order).
  const remove = r.keys.map((key) => ({ store: 'inProgress' as const, delete: key }));
  let saved = false;
  if (r.head) {
    const { frames, defs, last } = built ?? rebuild(r.head.me, r.frames);
    const file = onlineRecordingFile({ head: r.head, frames, defs, last, agree: false, endedAt: r.head.startMs + (frames[frames.length - 1]?.t ?? 0) });
    const kept = await env.library.entry(id);
    const shorter = kept?.summary.kind === 'recording' && kept.summary.game.ended === 'abandoned' && file !== null && file.game.actions > kept.summary.game.actions;
    if (file && (!kept || shorter)) {
      await env.library.add(kept ? { ...file, title: kept.summary.title } : file, { keep: kept?.keep ?? false });
      saved = true;
    }
  }
  await env.library.db.write(remove);
  return saved;
}

/**
 * RPL-3 (design 7.3): the game the host shared while this player's page was not on its game screen (it waits at this player's server,
 * `link.replayGame()`, until the game there is left): kept for the online setup screens (setup.tsx), which see the game the server has open. It replaces
 * this player's recording of that game in the library, checked as the recorder checks it (`checkSharedGame`, against the last view of that recording);
 * rows a closed page left are saved as that recording first. A game another page is recording (its lock held) is left to its recorder. Returns whether
 * the game was kept. Never throws.
 */
export async function keepSharedGame(link: OnlineLink, env: ReplayEnv): Promise<boolean> {
  const s = link.status();
  const data = link.replayGame();
  const id = s.replay?.id;
  const me = s.me;
  if (s.role !== 'guest' || !id || !me || data === null) return false;
  try {
    if ((await env.liveness.held())?.has(id)) return false;
    const rows = (await readOnlineRecords(env.library.db)).get(id);
    if (rows?.head && rows.head.me === me) await saveRows(env, id, rows);
    const entry = await env.library.entry(id);
    if (!entry || entry.summary.kind !== 'recording') return false; // none of this player's, or the game kept already
    const own = await env.library.read(id);
    if (!own.ok || own.value.kind !== 'recording' || own.value.recording?.viewer !== me) return false;
    const rec = own.value.recording;
    const seen = rebuild(me, rec.frames.map((frame, n): OnlineFrameRow => ({ key: frameKey(id, n), type: ONLINE_FRAME, id, n, frame, defs: n === 0 ? rec.defs : {} })));
    const checked = await checkSharedGame(data, me, seen.last, seen.frames[seen.frames.length - 1]?.seq ?? 0);
    if (!checked.ok) {
      console.error(`[Replays] the game the host shared was not kept: ${checked.reason}`);
      return false;
    }
    await keepShared(env, id, me, checked.file, entry, entry.keep);
    return true;
  } catch (e) {
    console.error('[Replays] the game the host shared could not be kept', e);
    return false;
  }
}
