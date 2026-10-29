/**
 * RPL-3 (replays design 7.2, 6): the host's records of online games, in this server's data directory, and the replays API its page reads them through.
 *
 * The game runs in this server (packages/net GameHost), which tells the bridge each line of its record (packages/net game/record.ts): the start (the
 * config with the seed and the decks), one line per applied action, every player's choice and the end. They are written as they come, crash-safe like
 * milestone 13's file store: one folder per game, `start.json` and `consent.json` and `end.json` written whole (a temporary file renamed over the old
 * one), `log.jsonl` appended one line per action. A record read back ends at its first line that does not parse or does not follow (a torn last write);
 * one without `end.json` was left unfinished (the host's server stopped, or the host left before a result) and reads as 'abandoned'.
 *
 * The host's page asks for them at the end of the game and at its next start (GET), keeps each as a replay in its own library, and then removes it here
 * (DELETE). A record whose game is still open here (over, but neither closed nor shared) stays until it is (`settle`): the players may still change
 * their choices, and the ones made after the page kept it reach that page at its next start; a record unchanged since goes then. Only this server's
 * own page may ask (the same check as the online token, guard.ts `checkSessionRequest`); the server listens on 127.0.0.1 only. A record holds the whole
 * game (every hand, the seed): it never leaves this machine but to the page that played it, which already had it.
 *
 * The players' choices are written from the start (`consent.json` at `begin`, with the choices made in the lobby), and only for a record begun here.
 * Later changes are written together (`CONSENT_WRITE_MS`; a read writes them first), but one that takes an agreement back is written at once: a crash
 * may lose an agreement, never a refusal.
 *
 * Nothing here throws into the game: a write that fails is logged and the game goes on (its replay may then be incomplete). At most `keep` records are
 * kept (the oldest go first when a new game begins), so records a page never came back for do not pile up.
 *
 * Several servers may write one data folder (`npm run play -- --port 47601` beside another, `npm run dev` beside `npm run play`): each record names the
 * server that writes it (`owner.json`, written first: `RecordOwner`), and a record without an end whose owner is another server still running is that
 * server's game in progress (CR 400.2: its seed and log reveal every hidden card). This server lists it as running and neither serves, removes nor
 * prunes it; once it has its end, or its owner is gone (a server that crashed), it is a finished or abandoned game like any other.
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { checkReplay, type Action, type PlayerId, type ReplayApp, type ReplayCheckpoint, type ReplayFile } from '@openmtg/engine';
import {
  ONLINE_RECORD_VERSION, onlineReplayFile, REPLAY_ID, type OnlineRecordAction, type OnlineRecordData, type OnlineRecordEnd, type OnlineRecordStart,
} from '@openmtg/net';
import type { OnlineReplayList, OnlineReplayListEntry } from './api';

/** How many records the server keeps at most (the oldest go first). */
export const KEEP_RECORDS = 50;
/** How long a change of the players' choices waits to be written together with the next ones (milliseconds). */
export const CONSENT_WRITE_MS = 200;
/** The largest record file read back (bytes): far above a real game (a start of 4 Commander decks is about 1 MB, a log of 5,000 actions 1 MB). */
const MAX_FILE_BYTES = 64 * 1024 * 1024;

const OWNER = 'owner.json';
const START = 'start.json';
const LOG = 'log.jsonl';
const CONSENT = 'consent.json';
const END = 'end.json';
/** A record begun for a page without a library of its own (`begin`'s `library`): this server keeps it in its own library. */
const LIBRARY = 'library.json';

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);

/** The server that writes a record (`owner.json`): its process on its machine, and the launch of its store (a random id per server launch). */
export interface RecordOwner {
  pid: number;
  host: string;
  launch: string;
}

/** Whether a process of this machine lives (signal 0 checks it and sends nothing; EPERM: it lives, as another user's). */
export function processAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export class OnlineReplayStore {
  /** This launch, as its records name it (see the file comment). */
  readonly owner: RecordOwner = { pid: process.pid, host: hostname(), launch: randomBytes(8).toString('hex') };
  /**
   * The records begun here and not removed: only they are written to. `open` while the game is open here (not closed, not shared), `kept` once its page
   * kept it meanwhile, `changed` when a choice changed after that.
   */
  private readonly mine = new Map<string, { open: boolean; kept: boolean; changed: boolean }>();
  /** Each record's choices not written yet, and the ones written last. */
  private readonly unwritten = new Map<string, PlayerId[]>();
  private readonly written = new Map<string, readonly PlayerId[]>();
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly alive: (pid: number) => boolean;

  /** `alive`: whether a process of this machine lives (default `processAlive`; tests pass their own). */
  constructor(
    readonly dir: string,
    private readonly keep = KEEP_RECORDS,
    o: { alive?: (pid: number) => boolean } = {},
  ) {
    this.alive = o.alive ?? processAlive;
  }

  private folder(id: string): string | null {
    return REPLAY_ID.test(id) ? path.join(this.dir, id) : null;
  }

  /** The folder a line of a record is written to: a record begun here, until it is removed. */
  private live(id: string): string | null {
    return this.mine.has(id) ? this.folder(id) : null;
  }

  /** A write of the game's record; a failure is logged, never thrown (the game goes on). */
  private write(what: string, f: () => void): void {
    try {
      f();
    } catch (e) {
      console.error(`[openmtg-server] the online replay record could not be written (${what}):`, e instanceof Error ? e.message : String(e));
    }
  }

  /** A JSON file written whole: a temporary file renamed over the old one (a crash leaves the old one or the new one, never half of one). */
  private static writeWhole(file: string, value: unknown): void {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(value));
    renameSync(tmp, file);
  }

  /**
   * A game began: its folder, its owner (this launch), its start line and the players who agree so far (`agreed`: the choices made in the lobby), after
   * removing the oldest records past `keep`. `library`: the game is kept in this server's library (online/bridge.ts), so a record a server that is
   * gone left is found at the next start (`leftForLibrary`).
   */
  begin(start: OnlineRecordStart, agreed: readonly PlayerId[] = [], library = false): void {
    const dir = this.folder(start.id);
    if (!dir) return;
    this.mine.set(start.id, { open: true, kept: false, changed: false });
    this.write('start', () => {
      mkdirSync(dir, { recursive: true });
      OnlineReplayStore.writeWhole(path.join(dir, OWNER), this.owner);
      if (library) OnlineReplayStore.writeWhole(path.join(dir, LIBRARY), {});
      OnlineReplayStore.writeWhole(path.join(dir, START), start);
      OnlineReplayStore.writeWhole(path.join(dir, CONSENT), { agreed: [...agreed] });
      this.written.set(start.id, [...agreed]);
    });
    this.write('pruning', () => this.prune(start.id));
  }

  /** An applied action. */
  append(id: string, line: OnlineRecordAction): void {
    const dir = this.live(id);
    if (dir) this.write('action', () => appendFileSync(path.join(dir, LOG), `${JSON.stringify(line)}\n`));
  }

  /**
   * Every player's choice now (the last one counts), written with the changes that follow within CONSENT_WRITE_MS, or at once when it takes an agreement
   * back. Nothing for a record not begun here (choices made before the game exists come with `begin`).
   */
  consent(id: string, agreed: readonly PlayerId[]): void {
    const m = this.mine.get(id);
    if (!m) return;
    if (m.kept) m.changed = true;
    this.unwritten.set(id, [...agreed]);
    if ((this.written.get(id) ?? []).some((p) => !agreed.includes(p))) return this.flush(id);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      for (const pending of [...this.unwritten.keys()]) this.flush(pending);
    }, CONSENT_WRITE_MS);
    this.flushTimer.unref?.();
  }

  /** The choices of the record `id` that are not written yet, now. */
  private flush(id: string): void {
    const agreed = this.unwritten.get(id);
    if (!agreed) return;
    this.unwritten.delete(id);
    const dir = this.live(id);
    if (dir) {
      this.write('consent', () => {
        OnlineReplayStore.writeWhole(path.join(dir, CONSENT), { agreed });
        this.written.set(id, agreed);
      });
    }
  }

  /** How the game ended. */
  end(id: string, end: OnlineRecordEnd): void {
    const dir = this.live(id);
    if (dir) this.write('end', () => OnlineReplayStore.writeWhole(path.join(dir, END), end));
  }

  /**
   * The game of the record `id` was closed here, or shared (the choices are final): they are written, and a record its page kept meanwhile goes now,
   * unless a choice changed since (that page reads it again at its next start).
   */
  settle(id: string): void {
    this.flush(id);
    const m = this.mine.get(id);
    if (!m) return;
    m.open = false;
    if (m.kept && !m.changed) this.write('removing', () => this.drop(id));
  }

  /** A record goes: its folder, and what this store knows of it. */
  private drop(id: string): void {
    this.mine.delete(id);
    this.unwritten.delete(id);
    this.written.delete(id);
    const dir = this.folder(id);
    if (dir) rmSync(dir, { recursive: true, force: true });
  }

  /**
   * Whether the record `id` is a game another server still runs (see the file comment): no end yet, and its owner is another launch whose process lives
   * (on another machine nothing can be asked: it counts as running).
   */
  runningElsewhere(id: string): boolean {
    if (!this.folder(id) || this.has(id, END)) return false;
    const o = this.json(id, OWNER);
    if (!isRec(o) || typeof o['launch'] !== 'string' || o['launch'] === this.owner.launch) return false;
    if (o['host'] !== this.owner.host) return true;
    return typeof o['pid'] === 'number' && this.alive(o['pid']);
  }

  /** The records begun for the library (`begin`'s `library`) that no server holds any more: a server that stopped or crashed with the game open left them. */
  leftForLibrary(): string[] {
    return this.ids().filter((id) => this.has(id, LIBRARY) && !this.mine.has(id) && !this.runningElsewhere(id));
  }

  /** The records kept, newest first (`running`: whether a record's game is still running on this server; another server's counts too). */
  list(running: (id: string) => boolean = () => false): OnlineReplayListEntry[] {
    const out: OnlineReplayListEntry[] = [];
    for (const id of this.ids()) {
      const start = this.start(id);
      if (!start) continue;
      const busy = running(id) || this.runningElsewhere(id);
      out.push({ id, startedAt: start.startedAt, players: start.players.map((p) => p.name), over: this.has(id, END), running: busy });
    }
    return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /** A record as read back (see the file comment; its latest choices written first), or null when there is none (or its start cannot be read). */
  read(id: string): OnlineRecordData | null {
    this.flush(id);
    const start = this.start(id);
    if (!start) return null;
    const actions: Action[] = [];
    const times: number[] = [];
    const checkpoints: ReplayCheckpoint[] = [];
    for (const text of (this.text(id, LOG) ?? '').split('\n')) {
      if (text === '') break;
      let line: unknown;
      try {
        line = JSON.parse(text);
      } catch {
        break; // a torn last write
      }
      if (!isRec(line) || line['i'] !== actions.length || !isRec(line['action']) || typeof line['t'] !== 'number') break;
      actions.push(line['action'] as unknown as Action);
      times.push(Math.max(line['t'], times[times.length - 1] ?? 0));
      if (isRec(line['checkpoint'])) checkpoints.push(line['checkpoint'] as unknown as ReplayCheckpoint);
    }
    const consent = this.json(id, CONSENT);
    const agreed = isRec(consent) && Array.isArray(consent['agreed']) ? consent['agreed'].filter((p): p is string => typeof p === 'string') : [];
    const end = this.json(id, END);
    // An end whose game is not all in the log (a write lost before it) is not trusted: the record then reads as unfinished.
    const ended = isRec(end) && isRec(end['result']) && end['actions'] === actions.length;
    return { start, actions, times, checkpoints, agreed, end: ended ? (end as unknown as OnlineRecordEnd) : null };
  }

  /**
   * The record as the host's replay file (kind 'game', mode 'onlineHost', saved by the host's player), checked as any replay file is (engine
   * `checkReplay`); null when there is none, `{ problem }` when it cannot be read as a replay, 'running' while another server runs its game.
   */
  file(id: string, app: ReplayApp): ReplayFile | { problem: string } | 'running' | null {
    if (this.runningElsewhere(id)) return 'running';
    const r = this.read(id);
    if (!r) return null;
    let file: ReplayFile;
    try {
      file = onlineReplayFile(r, { savedBy: r.start.host, mode: 'onlineHost', app });
    } catch (e) {
      return { problem: `The record could not be read: ${e instanceof Error ? e.message : String(e)}` };
    }
    const checked = checkReplay(JSON.parse(JSON.stringify(file)));
    return checked.ok ? checked.value : { problem: checked.error.message };
  }

  /**
   * Remove a record (its page kept it). 'kept': its game is still open here, so it stays until that game is closed or shared (`settle`); 'missing' when
   * there is none, 'running' while another server runs its game.
   */
  remove(id: string): 'removed' | 'kept' | 'missing' | 'running' {
    if (!this.folder(id) || !this.start(id)) return 'missing';
    if (this.runningElsewhere(id)) return 'running';
    const m = this.mine.get(id);
    if (m?.open) {
      this.flush(id);
      m.kept = true;
      m.changed = false;
      return 'kept';
    }
    this.drop(id);
    return 'removed';
  }

  // ---- reading

  private ids(): string[] {
    try {
      return readdirSync(this.dir, { withFileTypes: true }).filter((e) => e.isDirectory() && REPLAY_ID.test(e.name)).map((e) => e.name);
    } catch {
      return [];
    }
  }

  private has(id: string, name: string): boolean {
    try {
      return statSync(path.join(this.dir, id, name)).isFile();
    } catch {
      return false;
    }
  }

  private text(id: string, name: string): string | null {
    const dir = this.folder(id);
    if (!dir) return null;
    try {
      const file = path.join(dir, name);
      if (statSync(file).size > MAX_FILE_BYTES) return null;
      return readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  }

  private json(id: string, name: string): unknown {
    const text = this.text(id, name);
    if (text === null) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }

  /** A record's start, when it is one this server wrote (its version, its own id, players and a config). */
  private start(id: string): OnlineRecordStart | null {
    const s = this.json(id, START);
    if (!isRec(s) || s['version'] !== ONLINE_RECORD_VERSION || s['id'] !== id || !Array.isArray(s['players']) || !isRec(s['config'])) return null;
    if (typeof s['startedAt'] !== 'string' || typeof s['startMs'] !== 'number' || typeof s['host'] !== 'string') return null;
    return s as unknown as OnlineRecordStart;
  }

  /** Remove the oldest records past `keep` (never `current`, nor another server's game in progress). */
  private prune(current: string): void {
    const all = this.ids().filter((id) => id !== current && !this.runningElsewhere(id)).map((id) => ({ id, at: this.start(id)?.startedAt ?? '' }));
    all.sort((a, b) => b.at.localeCompare(a.at));
    for (const old of all.slice(Math.max(0, this.keep - 1))) this.drop(old.id);
  }
}

export type ReplayRequestResult = { status: 200; body: unknown } | { status: 404 | 405 | 409 | 500; body: { error: string } };

/**
 * One request of the replays API (api.ts `ONLINE_REPLAYS_PATH`), once the request was found to be this server's own page's: list, read or remove a
 * record. `running(id)`: whether that game is still running on this server (its replay is read once it is over or left); another server's game in
 * progress is the store's to tell (`runningElsewhere`). `open`: the replay id of the game this server has open (the list says it, OnlineReplayList).
 */
export function replayRequest(
  method: string,
  pathname: string,
  o: { store: OnlineReplayStore | null; running: (id: string) => boolean; open?: string | null; app: ReplayApp; base: string },
): ReplayRequestResult {
  const rest = pathname === o.base ? '' : pathname.startsWith(`${o.base}/`) ? pathname.slice(o.base.length + 1) : null;
  if (rest === null || rest.includes('/')) return { status: 404, body: { error: 'not found' } };
  if (rest === '') {
    if (method !== 'GET') return { status: 405, body: { error: `Method ${method} not allowed` } };
    return { status: 200, body: { replays: o.store?.list(o.running) ?? [], open: o.open ?? null } satisfies OnlineReplayList };
  }
  if (!REPLAY_ID.test(rest)) return { status: 404, body: { error: 'There is no such replay.' } };
  if (!o.store) return { status: 404, body: { error: 'This server keeps no replays.' } };
  if (method === 'GET') {
    if (o.running(rest)) return { status: 409, body: { error: 'That game is still running: its replay is ready when it is over.' } };
    const file = o.store.file(rest, o.app);
    if (file === null) return { status: 404, body: { error: 'There is no such replay.' } };
    if (file === 'running') return { status: 409, body: { error: 'That game is still running on another OpenMTG server: its replay is ready when it is over.' } };
    if ('problem' in file) return { status: 500, body: { error: file.problem } };
    return { status: 200, body: file };
  }
  if (method === 'DELETE') {
    if (o.running(rest)) return { status: 409, body: { error: 'That game is still running.' } };
    const removed = o.store.remove(rest);
    if (removed === 'running') return { status: 409, body: { error: 'That game is still running on another OpenMTG server.' } };
    // 'kept': the record stays until its game is closed or shared (the page has it; later choices reach the page's next start).
    return removed === 'missing' ? { status: 404, body: { error: 'There is no such replay.' } } : { status: 200, body: { ok: true } };
  }
  return { status: 405, body: { error: `Method ${method} not allowed` } };
}
