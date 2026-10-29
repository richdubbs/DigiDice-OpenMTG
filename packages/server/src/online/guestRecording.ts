/**
 * RPL-3 for a page without a library of its own (the Godot app asks for it with `library` on join): an online guest's replay, made by its server. A
 * guest never holds the game (no seed, no log: packages/net game/guest.ts), so what it keeps is a recording: every view its player was shown and the
 * events of each change, as the host sent them (already redacted for this player, CR 400.2), built as the browser builds it (packages/play
 * replay/recording.ts).
 *
 * Written as it goes, one JSON line per row in `<id>.jsonl` (http.ts: `replays/online-guest` next to the card cache): the head, each frame with the
 * definitions it brought, each change of this player's choice. A server that stops or crashes with a game open keeps it that way: at its next start,
 * the file of a server that is gone becomes a replay in the library (`finishLeftRecordings`: abandoned, or finished when its last view has the result).
 * The recording goes to the library when the game is over (again when the player changes their choice after that), and when the game is left or
 * closed; its file goes then.
 *
 * When every player agreed, the host shares the whole game (`replayGame`): checked (`checkSharedGame`), it replaces the recording in the library as a
 * game replay saved by this player (mode 'onlineGuest'), with the recording, retimed to the host's times, as its fallback. A game that does not pass is
 * refused (logged) and the recording stays.
 *
 * Nothing here throws into the game: a write that fails is logged and the game goes on.
 */
import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import {
  cleanText, currentEngine, type CardDef, type GameEvent, type GameView, type PlayerId, type RecordingFrame, type ReplayApp, type ReplayEngine,
  type ReplayFile,
} from '@openmtg/engine';
import { addFrame, checkSharedGame, onlineRecordingFile, playersOf, rebuildFrames, retimed, type RecordingSoFar } from '@openmtg/play/replay/recording';
import { engineBuild } from '../engineBuild';
import { defaultTitle } from '../library/replays';
import { REPLAY_GAME_MAX_BYTES } from './api';
import { processAlive } from './replays';

/** Where the replays of online games go when the page has no library of its own (http.ts: the server's replay library). */
export interface OnlineLibrary {
  /** Keep a replay file in the library, replacing one with its id (its Keep mark stays). */
  add(file: ReplayFile): Promise<void>;
}

/** The version of the rows' shape. */
const ROW_VERSION = 1;
/** The largest recording file read back (bytes): far above a real game. */
const MAX_FILE_BYTES = 256 * 1024 * 1024;

interface HeadRow {
  t: 'head';
  v: number;
  id: string;
  me: PlayerId;
  format: string;
  /** Epoch milliseconds of the start: a frame's time is milliseconds since then. */
  startMs: number;
  createdAt: string;
  app: ReplayApp;
  engine: ReplayEngine;
  /** The server that writes the file. */
  owner: { pid: number; host: string };
}
interface FrameRow {
  t: 'frame';
  frame: RecordingFrame;
  /** The definitions this frame's view uses that no earlier frame did. */
  defs: Record<string, CardDef>;
}
interface AgreeRow {
  t: 'agree';
  agree: boolean;
}
type Row = HeadRow | FrameRow | AgreeRow;

const log = (what: string, e: unknown) => console.error(`[online] ${what}: ${e instanceof Error ? e.message : String(e)}`);

export interface GuestRecordingOptions {
  /** The folder of the recordings' files; null: kept in memory only. */
  dir: string | null;
  /** The replay's id (the status's `replay.id`). */
  id: string;
  me: PlayerId;
  format: string;
  app: ReplayApp;
  library: OnlineLibrary;
  /** The recording is in the library (each time it is saved there). */
  saved?: () => void;
  now?: () => number;
}

export class GuestRecording {
  private readonly so: RecordingSoFar = { frames: [], defs: {}, prev: null, run: 0 };
  private readonly head: HeadRow;
  private readonly file: string | null;
  private agree = false;
  /** When the game ended (its result, or the player left it). */
  private endedAt: number | null = null;
  /** The game the host shared is in the library: the recording is final. */
  private shared = false;
  private closed = false;
  private writeFailed = false;
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly o: GuestRecordingOptions) {
    const now = this.now();
    this.head = {
      t: 'head', v: ROW_VERSION, id: o.id, me: o.me, format: cleanText(o.format).slice(0, 40), startMs: now, createdAt: new Date(now).toISOString(),
      app: { ...o.app }, engine: currentEngine(engineBuild()), owner: { pid: process.pid, host: hostname() },
    };
    this.file = o.dir ? path.join(o.dir, `${o.id}.jsonl`) : null;
    if (this.file) {
      try {
        mkdirSync(path.dirname(this.file), { recursive: true });
      } catch (e) {
        log('the guest\'s recording folder could not be made', e);
      }
    }
    this.write(this.head);
  }

  private now(): number {
    return this.o.now?.() ?? Date.now();
  }

  private write(row: Row): void {
    if (!this.file || this.writeFailed || this.closed) return;
    try {
      appendFileSync(this.file, `${JSON.stringify(row)}\n`);
    } catch (e) {
      this.writeFailed = true;
      log('the guest\'s recording could not be written as it went (it is still saved when the game ends)', e);
    }
  }

  /** A view this player was shown (`seq`: the actions the host had applied). The recording ends with the result, and is saved then. */
  shown(seq: number, view: GameView, events: readonly GameEvent[]): void {
    if (this.shared || this.closed || this.so.prev?.result) return;
    const added = addFrame(this.so, { seq, view, events, at: this.now() }, this.head.startMs);
    if (!added) return;
    this.write({ t: 'frame', frame: added.frame, defs: added.defs });
    if (view.result) {
      this.endedAt = this.now();
      void this.save();
    }
  }

  /** This player's "Show my cards in replays", as the host has it: a game that is over is saved again with it. */
  setAgree(on: boolean): void {
    if (this.shared || this.closed || on === this.agree) return;
    this.agree = on;
    this.write({ t: 'agree', agree: on });
    if (this.endedAt !== null) void this.save();
  }

  /** The recording so far as a replay file (a bug report's game: what this player was shown), or null before the first view. */
  soFar(): ReplayFile | null {
    return this.recordingFile(this.now());
  }

  private recordingFile(endedAt: number): ReplayFile | null {
    const last = this.so.prev;
    if (!last) return null;
    const h = this.head;
    return onlineRecordingFile({
      id: h.id, startMs: h.startMs, createdAt: h.createdAt, me: h.me, format: h.format, app: h.app, engine: h.engine, frames: this.so.frames,
      defs: this.so.defs, last, agree: this.agree, endedAt, title: defaultTitle(playersOf(last), h.format),
    });
  }

  /** One library write at a time, in order; a failure is logged. */
  private queue(f: () => Promise<void>): Promise<void> {
    this.saving = this.saving.then(f).then(() => this.o.saved?.(), (e: unknown) => log('the game\'s replay could not be kept', e));
    return this.saving;
  }

  private save(): Promise<void> {
    const file = this.shared ? null : this.recordingFile(this.endedAt ?? this.now());
    return file ? this.queue(() => this.o.library.add(file)) : this.saving;
  }

  /** The host shared the whole game (every player agreed): checked, it replaces the recording in the library. */
  async sharedGame(data: string): Promise<void> {
    if (this.shared) return;
    const lastSeq = this.so.frames[this.so.frames.length - 1]?.seq ?? 0;
    const checked = await checkSharedGame(data, this.o.me, this.so.prev, lastSeq, REPLAY_GAME_MAX_BYTES);
    if (!checked.ok) return log('the game the host shared was not kept', checked.reason);
    if (this.shared) return;
    const game = checked.file;
    const own = this.recordingFile(this.endedAt ?? this.now());
    const file: ReplayFile = {
      ...game,
      id: this.o.id,
      title: own?.title ?? game.title,
      app: { ...this.o.app },
      game: { ...game.game, mode: 'onlineGuest', savedBy: this.o.me },
      ...(own?.recording ? { recording: { ...own.recording, frames: retimed(own.recording.frames, game.play!.times) } } : {}),
    };
    this.shared = true;
    await this.queue(() => this.o.library.add(file));
    this.removeFile();
  }

  /** The game was left or closed: the recording goes to the library as it stands, and its file goes. */
  async close(): Promise<void> {
    if (this.closed) return this.saving;
    this.endedAt ??= this.now();
    const saved = this.save();
    this.closed = true;
    await saved;
    this.removeFile();
  }

  private removeFile(): void {
    if (!this.file) return;
    try {
      rmSync(this.file, { force: true });
    } catch (e) {
      log('the guest\'s recording file could not be removed', e);
    }
  }
}

/** The rows of a recording file, up to the first line that does not parse (a torn last write); null without a head first. */
function readRows(text: string): { head: HeadRow; frames: FrameRow[]; agree: boolean } | null {
  const lines = text.split('\n');
  let head: HeadRow | null = null;
  const frames: FrameRow[] = [];
  let agree = false;
  for (const line of lines) {
    if (line.trim() === '') continue;
    let row: Row;
    try {
      row = JSON.parse(line) as Row;
    } catch {
      break;
    }
    if (head === null) {
      if (row?.t !== 'head' || row.v !== ROW_VERSION || typeof row.id !== 'string' || typeof row.me !== 'string') return null;
      head = row;
    } else if (row?.t === 'frame' && row.frame && typeof row.frame.seq === 'number') {
      frames.push(row);
    } else if (row?.t === 'agree') {
      agree = row.agree === true;
    } else {
      break;
    }
  }
  return head ? { head, frames, agree } : null;
}

/**
 * At a server's start: the recordings a server that is gone left in `dir` (it stopped or crashed with a game open) become replays in the library, and
 * their files go. The file of a server that still runs (another server on this data folder) stays. Never throws. Returns how many were kept.
 */
export async function finishLeftRecordings(dir: string, library: OnlineLibrary, alive: (pid: number) => boolean = processAlive): Promise<number> {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.jsonl'));
  } catch {
    return 0;
  }
  let kept = 0;
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      const rows = statSync(file).size <= MAX_FILE_BYTES ? readRows(readFileSync(file, 'utf8')) : null;
      if (rows) {
        const { head } = rows;
        const otherServer = head.owner?.host !== hostname() || (head.owner.pid !== process.pid && alive(head.owner.pid));
        if (otherServer) continue;
        const r = rebuildFrames(head.me, rows.frames);
        const replay = r.prev
          ? onlineRecordingFile({
            id: head.id, startMs: head.startMs, createdAt: head.createdAt, me: head.me, format: head.format, app: head.app, engine: head.engine,
            frames: r.frames, defs: r.defs, last: r.prev, agree: rows.agree, endedAt: head.startMs + (r.frames[r.frames.length - 1]?.t ?? 0),
            title: defaultTitle(playersOf(r.prev), head.format),
          })
          : null;
        if (replay) {
          await library.add(replay);
          kept++;
        }
      }
      rmSync(file, { force: true });
    } catch (e) {
      log(`the recording ${name} left by an earlier server could not be kept`, e);
    }
  }
  return kept;
}
