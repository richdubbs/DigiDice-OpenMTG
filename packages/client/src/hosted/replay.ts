/**
 * The replay of a game on the DigiDice server (hosted design 12; replays design 3, 6, D2): a recording of what this player was shown, change by change,
 * as the server sent it (this seat's `viewFor` and its redacted events: CR 400.2), kept in the replay library as a `'recording'` of mode `'hosted'`.
 * The server holds the whole game and never sends it: a hosted replay can show this player's own seat only (replays/viewer/policy.ts), and the game
 * itself goes into a bug report only on the server (the owner's `inbox export`).
 *
 * Frames as an online guest's (online/recording.ts): one per view, by the view's `seq`; a full view at the first frame, at the start of every 5th turn,
 * after RECORDING_MAX_PATCH_RUN patches in a row and after a gap (a reconnection's full view: changes were missed); a view patch (`diffJson`) against the
 * previous frame's view otherwise; each view's definitions kept once. A resent view (a new socket, the same seq) is not a new frame.
 *
 * Held in memory while the game runs and saved to the library once, when the game is over (CR 104) or the player leaves the game screen (then as
 * conceded or abandoned, as the last view says). A page that reloads in the middle of a game records from the view it gets back: the earlier part of
 * that game is not in its replay. Recording never stops a game: a failure is logged and the game is played unrecorded.
 *
 * Registered under the game's connection (replays/live.ts), so the end screen offers Watch replay and Keep replay, and a bug report made during the
 * game carries this recording so far (`soFar`).
 */
import {
  RECORDING_MAX_PATCH_RUN, REPLAY_FORMAT, REPLAY_FORMAT_VERSION, cleanText, currentEngine, diffJson, type CardDef, type GameResult, type GameView,
  type PlayerId, type RecordingFrame, type RecordingKeyView, type ReplayEnd, type ReplayFile, type ReplayPlayer,
} from '@openmtg/engine';
import type { GameConnection } from '../connection/GameConnection';
import type { HostedConnection } from '../connection/HostedConnection';
import { pageReplays, type ReplayEnv } from '../replays/env';
import { KEY_FRAME_TURNS } from '../replays/fallback';
import { defaultTitle, newReplayId } from '../replays/file';
import type { LibraryEntry } from '../replays/library';
import { registerLiveReplay, type LiveReplay, type LiveReplayState } from '../replays/live';
import type { HostedLink } from './HostedLink';

const iso = (ms: number): string => new Date(ms).toISOString();

function keyless(v: GameView): { key: RecordingKeyView; defs: Record<string, CardDef> } {
  const { defs, ...key } = v;
  return { key, defs };
}

/** The seats of a view as a replay lists them: every seat at a hosted table is a person. */
function playersOf(view: Pick<GameView, 'players'>): ReplayPlayer[] {
  return view.players.map((p) => ({ id: p.id, name: cleanText(p.name).trim().slice(0, 64) || p.id, kind: 'person' }));
}

/** How the game ended for this player, from the last view (CR 104; a hosted Leave concedes, CR 104.3a). */
export function hostedEnding(view: RecordingKeyView, me: PlayerId): { ended: ReplayEnd; result: GameResult | null } {
  if (view.result) {
    const out = view.players.filter((p) => p.hasLost);
    const withOrder = out.filter((p) => p.left !== undefined);
    const last = withOrder.length > 0 ? withOrder.reduce((a, b) => (b.left!.order > a.left!.order ? b : a)) : null;
    const conceded = last ? last.conceded : out.some((p) => p.conceded);
    return { ended: conceded ? 'conceded' : 'finished', result: { winner: view.result.winner, reason: view.result.reason } };
  }
  return { ended: view.players.find((p) => p.id === me)?.conceded ? 'conceded' : 'abandoned', result: null };
}

export interface HostedRecording {
  id: string;
  me: PlayerId;
  format: string;
  startMs: number;
  endedAt: number;
  frames: readonly RecordingFrame[];
  defs: Record<string, CardDef>;
  last: RecordingKeyView | null;
  app: ReplayFile['app'];
  engine: ReplayFile['engine'];
}

/** The recording file (kind 'recording', mode 'hosted'), or null without a frame. */
export function hostedRecordingFile(r: HostedRecording): ReplayFile | null {
  const last = r.last;
  if (!last || r.frames.length === 0) return null;
  const players = playersOf(last);
  const { ended, result } = hostedEnding(last, r.me);
  return {
    format: REPLAY_FORMAT,
    formatVersion: REPLAY_FORMAT_VERSION,
    kind: 'recording',
    id: r.id,
    title: defaultTitle(players, r.format),
    createdAt: iso(r.startMs),
    app: { ...r.app },
    engine: { ...r.engine },
    game: {
      mode: 'hosted',
      format: r.format,
      players,
      savedBy: r.me,
      ended,
      result,
      turns: last.turn.number,
      actions: r.frames[r.frames.length - 1]!.seq,
      startedAt: iso(r.startMs),
      endedAt: iso(Math.max(r.endedAt, r.startMs)),
    },
    // What this player saw is theirs alone; the server never sends the others' cards, so there is nothing to agree to show.
    reveal: { policy: 'own', agreed: [] },
    recording: { viewer: r.me, defs: { ...r.defs }, frames: r.frames.map((f) => ({ ...f })) },
  };
}

/** Records the hosted game on `conn` (see the file comment). */
export class HostedRecorder {
  readonly id = newReplayId();
  readonly live: LiveReplay;
  private readonly me: PlayerId;
  private readonly format: string;
  private readonly startMs: number;
  private readonly engine: ReplayFile['engine'];
  private frames: RecordingFrame[] = [];
  private defs: Record<string, CardDef> = {};
  private prev: RecordingKeyView | null = null;
  private run = 0;
  private saving: Promise<LibraryEntry | null> | null = null;
  private kept = false;
  private snapshot: LiveReplayState = { phase: 'recording', error: null, agreed: [], kept: false };
  private readonly listeners = new Set<() => void>();
  private readonly off: () => void;

  constructor(
    private readonly conn: HostedConnection,
    link: HostedLink,
    private readonly env: ReplayEnv,
  ) {
    const view = conn.view();
    this.me = link.me() ?? view.viewer!;
    this.format = cleanText(link.table()?.format ?? '').slice(0, 40);
    this.startMs = env.now();
    this.engine = currentEngine(env.build);
    const name = view.players.find((p) => p.id === this.me)?.name ?? this.me;
    this.live = {
      people: [{ id: this.me, name }],
      asksAgreement: false,
      state: () => this.snapshot,
      subscribe: (l) => {
        this.listeners.add(l);
        return () => {
          this.listeners.delete(l);
        };
      },
      setAgreed: () => {},
      setKept: (k) => this.setKept(k),
      file: () => this.file(),
      soFar: () => this.soFar(),
      left: () => void this.finish(),
    };
    this.off = conn.subscribe(() => this.shown());
    this.shown();
  }

  private changed(next: Partial<LiveReplayState>): void {
    this.snapshot = { ...this.snapshot, ...next };
    for (const l of [...this.listeners]) l();
  }

  /** The connection changed: a new view is a frame (a resend of the same seq is not); the end of the game saves the recording. */
  private shown(): void {
    if (this.saving) return;
    const batch = this.conn.events();
    const lastSeq = this.frames[this.frames.length - 1]?.seq ?? -1;
    if (batch.seq <= lastSeq) return;
    const { key, defs } = keyless(this.conn.view());
    for (const [k, d] of Object.entries(defs)) if (!Object.hasOwn(this.defs, k)) this.defs[k] = d;
    const t = Math.max(0, this.env.now() - this.startMs, this.frames[this.frames.length - 1]?.t ?? 0);
    const prev = this.prev;
    const turnStarted = prev !== null && key.turn.number !== prev.turn.number && (key.turn.number - 1) % KEY_FRAME_TURNS === 0;
    const gap = lastSeq >= 0 && batch.seq !== lastSeq + 1;
    const events = [...batch.events];
    if (prev === null || turnStarted || gap || this.run >= RECORDING_MAX_PATCH_RUN) {
      this.frames.push({ seq: batch.seq, t, key, events });
      this.run = 0;
    } else {
      this.frames.push({ seq: batch.seq, t, patch: diffJson(prev, key), events });
      this.run++;
    }
    this.prev = key;
    if (key.result) void this.finish(); // the game is over (CR 104)
  }

  private recording(endedAt: number): HostedRecording {
    return {
      id: this.id, me: this.me, format: this.format, startMs: this.startMs, endedAt, frames: this.frames, defs: this.defs, last: this.prev, app: this.env.app,
      engine: this.engine,
    };
  }

  /** What a bug report carries now: the recording so far (before the first frame, the view on screen as one key frame). */
  private soFar(): ReplayFile {
    if (this.frames.length > 0) return hostedRecordingFile(this.recording(this.env.now()))!;
    const { key, defs } = keyless(this.conn.view());
    const frames: RecordingFrame[] = [{ seq: Math.max(0, this.conn.events().seq), t: 0, key, events: [] }];
    return hostedRecordingFile({ ...this.recording(this.env.now()), frames, defs, last: key })!;
  }

  /** The recording becomes a library entry, once: the game is over, or the player left the game screen. */
  finish(): Promise<LibraryEntry | null> {
    if (this.saving) return this.saving;
    this.off();
    this.changed({ phase: 'saving' });
    const file = hostedRecordingFile(this.recording(this.env.now()));
    this.saving = (file ? this.env.library.add(file, { keep: this.kept }) : Promise.resolve(null)).then(
      (entry) => {
        this.changed({ phase: entry ? 'saved' : 'failed', ...(entry ? {} : { error: 'There was nothing to keep.' }) });
        return entry;
      },
      (e: unknown) => {
        console.error('[Replays] the hosted game\'s replay could not be saved', e);
        this.changed({ phase: 'failed', error: e instanceof Error ? e.message : String(e) });
        return null;
      },
    );
    return this.saving;
  }

  private setKept(keep: boolean): void {
    this.kept = keep;
    this.changed({ kept: keep });
    void this.saving?.then((entry) => entry && this.env.library.setKeep(entry.key, keep));
  }

  private async file(): Promise<ReplayFile | null> {
    if (!this.saving) return null;
    const entry = await this.saving;
    if (!entry) return null;
    const read = await this.env.library.read(entry.key);
    return read.ok ? read.value : null;
  }
}

/** Keep the replay of the hosted game on `conn` (registered under `conn` and `sealed`, the form the game route holds). Never throws: null when it cannot. */
export function recordHostedGame(conn: HostedConnection, link: HostedLink, sealed: GameConnection, env?: ReplayEnv): HostedRecorder | null {
  try {
    const r = new HostedRecorder(conn, link, env ?? pageReplays());
    registerLiveReplay([conn, sealed], r.live);
    return r;
  } catch (e) {
    console.error('[Replays] the hosted game could not be recorded', e);
    return null;
  }
}
