/**
 * Replays of the games played over the table channel (the Godot app's local games), in the server's data folder. Every game, hot-seat or against the
 * computer, is recorded as it runs, as the desktop client records its own (client/src/replays/recorder.ts, file.ts): the actions with their times and
 * the rule checkpoints (engine replay/checkpoints.ts), undo taking actions back off the record. The replay is saved once, as an `.openmtg-replay` file
 * (gzipped JSON, engine replay/format.ts), when the game ends or when its table closes first (`abandoned`); a game with no action is not kept.
 *
 * The library: `<data>/library/replays/<id>.openmtg-replay`, and `index.json` with each replay's summary, its Keep mark, size and when it was added, and
 * the retention limit. Retention runs when a replay is added: of the replays not marked Keep, the newest `limit` (10, 50 or 200; default 50) stay, and
 * the one just added is always spared.
 *
 * GET /api/library/replays, POST /api/library/replays/update ({id, title?, keep?}), /delete ({id}), /import ({path}), /retention ({limit}).
 */
import { randomBytes } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  ABILITY_MODEL_VERSION, checkpointAfter, currentEngine, ENGINE_VIEW_SCHEMA, readReplayFile, REPLAY_FORMAT, REPLAY_FORMAT_VERSION, writeGzippedJson, type Action,
  type GameConfig, type GameState, type PlayerId, type ReplayCheckpoint, type ReplayFile, type ReplayMode, type ReplayPlayer,
} from '@openmtg/engine';
import type { LibraryReplay } from '../api';
import { badRequest, type Handler, type ServerContext } from '../context';
import { replayStatus } from '@openmtg/play/replay/status';
import { engineBuild } from '../engineBuild';
import { libraryDir } from './decks';
import { readJsonFile, serialized, writeAtomic } from './files';

export const RETENTION_CHOICES = [10, 50, 200] as const;
export const DEFAULT_RETENTION = 50;
const ID_RE = /^r-[0-9a-f]{20}$/;
const TITLE_MAX = 200;
/** The largest replay file read (engine REPLAY_LIMITS: 8 MB). */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

interface IndexEntry {
  summary: Omit<LibraryReplay, 'keep' | 'size' | 'addedAt' | 'path' | 'status'>;
  keep: boolean;
  size: number;
  addedAt: number;
}

interface Index {
  replays: IndexEntry[];
  retention: number;
}

export function replaysDir(ctx: Pick<ServerContext, 'cacheDir' | 'libraryDir'>): string {
  return path.join(libraryDir(ctx as ServerContext), 'replays');
}

const indexFile = (ctx: Pick<ServerContext, 'cacheDir' | 'libraryDir'>) => path.join(replaysDir(ctx), 'index.json');
const fileOf = (ctx: Pick<ServerContext, 'cacheDir' | 'libraryDir'>, id: string) => path.join(replaysDir(ctx), `${id}.openmtg-replay`);

async function readIndex(ctx: Pick<ServerContext, 'cacheDir' | 'libraryDir'>): Promise<Index> {
  const v = (await readJsonFile(indexFile(ctx))) as Partial<Index> | undefined;
  const replays = Array.isArray(v?.replays) ? v.replays.filter((e) => e && typeof e === 'object' && typeof e.summary?.id === 'string' && ID_RE.test(e.summary.id)) : [];
  const retention = RETENTION_CHOICES.includes(v?.retention as 10) ? (v!.retention as number) : DEFAULT_RETENTION;
  return { replays, retention };
}

const writeIndex = (ctx: Pick<ServerContext, 'cacheDir' | 'libraryDir'>, index: Index) => writeAtomic(indexFile(ctx), `${JSON.stringify(index, null, 1)}\n`);

export function newReplayId(): string {
  return `r-${randomBytes(10).toString('hex')}`;
}

/** "Casual" for casual and no format, else the format's id with its first letter in capitals ("Standard", "Commander"). */
function formatLabel(format: string): string {
  if (format === '' || format === 'casual' || format === 'freeform') return 'Casual';
  return format.charAt(0).toUpperCase() + format.slice(1);
}

/** "Ann vs Bo vs Computer 1, Casual" (client replays/file.ts defaultTitle). */
export function defaultTitle(players: readonly { name: string }[], format: string): string {
  return `${players.map((p) => p.name).join(' vs ')}, ${formatLabel(format)}`.slice(0, TITLE_MAX);
}

function summaryOf(file: ReplayFile): IndexEntry['summary'] {
  return {
    id: file.id, title: file.title, createdAt: file.createdAt, kind: file.kind, game: file.game, reveal: file.reveal, hasRecording: file.recording !== undefined,
    formatVersion: file.formatVersion, engine: { build: file.engine.build, model: file.engine.model, viewSchema: file.engine.viewSchema },
  };
}

/** Add a replay file to the library (replacing one with its id), then apply retention, sparing it. */
export async function addReplay(ctx: Pick<ServerContext, 'cacheDir' | 'libraryDir'>, file: ReplayFile): Promise<IndexEntry> {
  const bytes = await writeGzippedJson(file);
  if (!bytes.ok) throw new Error(bytes.error.message);
  return serialized(indexFile(ctx), async () => {
    await writeAtomic(fileOf(ctx, file.id), bytes.value);
    const index = await readIndex(ctx);
    const old = index.replays.find((e) => e.summary.id === file.id);
    const entry: IndexEntry = { summary: summaryOf(file), keep: old?.keep ?? false, size: bytes.value.length, addedAt: Date.now() };
    const replays = [...index.replays.filter((e) => e.summary.id !== file.id), entry];
    // Retention: the newest `retention` of those not kept stay; the one just added always does.
    const loose = replays.filter((e) => !e.keep && e.summary.id !== file.id).sort((a, b) => b.addedAt - a.addedAt);
    const gone = new Set(loose.slice(Math.max(0, index.retention - 1)).map((e) => e.summary.id));
    for (const id of gone) await rm(fileOf(ctx, id), { force: true });
    await writeIndex(ctx, { retention: index.retention, replays: replays.filter((e) => !gone.has(e.summary.id)) });
    return entry;
  });
}

export interface RecordingInfo {
  config: GameConfig;
  mode: ReplayMode;
  format: string;
  /** The players who sit at the screen (people); the others are computers. */
  seated: readonly PlayerId[];
  version: string;
}

/** Where a game's record stands: played into, being saved, saved, not saved (`error` says why), or nothing to save (no action). */
export type RecordingState = 'recording' | 'saving' | 'saved' | 'failed' | 'empty';

/**
 * One game's record while it is played (one per table): `applied` and `undone` are the play package's LogObserver; `finish` saves it once (the end of
 * the game, or the table closing first). The end screen marks it Keep and, at a screen several people share, records who agreed to show their cards in
 * its replays (CR 400.2); both are written to the library once it is saved, and to the saved replay after.
 */
export class GameRecording {
  readonly id = newReplayId();
  private readonly startMs = Date.now();
  private readonly createdAt = new Date(this.startMs).toISOString();
  private readonly actions: Action[] = [];
  private readonly times: number[] = [];
  private readonly checkpoints: ReplayCheckpoint[] = [];
  private last: { index: number; turnBefore: number; state: GameState } | null = null;
  private saved = false;
  private saving: Promise<void> | null = null;
  private endedAt: string | null = null;
  private keepIt = false;
  private readonly agreedBy = new Set<PlayerId>();
  state: RecordingState = 'recording';
  error: string | null = null;
  /** Called after every change of the state, Keep or the agreements. */
  onChange: (() => void) | null = null;

  constructor(
    private readonly ctx: Pick<ServerContext, 'cacheDir' | 'libraryDir'>,
    private readonly info: RecordingInfo,
  ) {}

  applied(action: Action, index: number, before: GameState, after: GameState): void {
    if (this.saved) return;
    this.truncate(index);
    const t = Math.max(0, Date.now() - this.startMs, this.times[this.times.length - 1] ?? 0);
    this.actions.push(action);
    this.times.push(t);
    const cp = checkpointAfter(index, before.turn.number, after, false);
    if (cp) this.checkpoints.push(cp);
    this.last = { index, turnBefore: before.turn.number, state: after };
    if (after.result) void this.finish();
  }

  undone(length: number): void {
    this.truncate(length);
    this.last = null;
  }

  private truncate(length: number): void {
    this.actions.length = Math.min(this.actions.length, length);
    this.times.length = Math.min(this.times.length, length);
    while (this.checkpoints.length > 0 && this.checkpoints[this.checkpoints.length - 1]!.action >= length) this.checkpoints.pop();
  }

  /** The game file as it stands (null with no action). */
  file(): ReplayFile | null {
    if (this.actions.length === 0) return null;
    const players: ReplayPlayer[] = this.info.config.players.map((p, i) => {
      const id = p.id ?? `p${i + 1}`;
      return { id, name: p.name, kind: this.info.seated.includes(id) ? 'person' : 'computer' };
    });
    const people = players.filter((p) => p.kind === 'person');
    const said = new Set(this.agreedBy);
    const state = this.last?.state ?? null;
    const checkpoints = this.checkpoints.map((c) => ({ ...c }));
    const lastIndex = this.actions.length - 1;
    if (state && this.last!.index === lastIndex && checkpoints[checkpoints.length - 1]?.action !== lastIndex) {
      const cp = checkpointAfter(lastIndex, this.last!.turnBefore, state, true);
      if (cp) checkpoints.push(cp);
    }
    const result = state?.result ?? null;
    const conceded = result !== null && state!.players.some((p) => p.hasLost && p.conceded);
    // One person against the computer agrees by being the only person; people at one screen each tick "show my cards" (client replays/file.ts revealOf).
    if (people.length === 1) said.add(people[0]!.id);
    const agreed = people.filter((p) => said.has(p.id)).map((p) => p.id);
    return {
      format: REPLAY_FORMAT,
      formatVersion: REPLAY_FORMAT_VERSION,
      kind: 'game',
      id: this.id,
      title: defaultTitle(players, this.info.format),
      createdAt: this.createdAt,
      app: { version: this.info.version.slice(0, 40), commit: null },
      engine: currentEngine(engineBuild()),
      game: {
        mode: this.info.mode,
        format: this.info.format.slice(0, 40),
        players,
        savedBy: people.length === 1 ? people[0]!.id : null,
        ended: result ? (conceded ? 'conceded' : 'finished') : 'abandoned',
        result: result ? { winner: result.winner, reason: result.reason } : null,
        turns: state?.turn.number ?? checkpoints[checkpoints.length - 1]?.turn ?? 0,
        actions: this.actions.length,
        startedAt: this.createdAt,
        endedAt: this.endedAt ?? new Date().toISOString(),
      },
      reveal: { policy: people.length > 0 && agreed.length === people.length ? 'all' : 'own', agreed },
      play: { config: this.info.config, actions: [...this.actions], times: [...this.times], checkpoints },
    };
  }

  /** Save the replay to the library once (nothing for a game with no action). */
  finish(): Promise<void> {
    this.saving ??= this.save();
    return this.saving;
  }

  private async save(): Promise<void> {
    this.endedAt = new Date().toISOString();
    const file = this.file();
    this.saved = true;
    if (!file) {
      this.changed('empty');
      return;
    }
    this.changed('saving');
    try {
      await addReplay(this.ctx, file);
      if (this.keepIt) await setReplayKeep(this.ctx, this.id, true);
      this.changed('saved');
    } catch (e) {
      console.error('[openmtg-server] the replay could not be saved', e);
      this.error = e instanceof Error ? e.message : String(e);
      this.changed('failed');
    }
  }

  private changed(state: RecordingState = this.state): void {
    this.state = state;
    this.onChange?.();
  }

  get keep(): boolean {
    return this.keepIt;
  }

  /** The people at the screen who agreed to show their cards in this game's replays. */
  get agreed(): PlayerId[] {
    return [...this.agreedBy];
  }

  /** The people at the screen (the ones who may agree). */
  get people(): PlayerId[] {
    return [...this.info.seated];
  }

  /** Mark the replay Keep, or not (its library entry once it is saved). */
  async setKeep(on: boolean): Promise<void> {
    this.keepIt = on;
    this.changed();
    if (this.state === 'saved') await setReplayKeep(this.ctx, this.id, on);
  }

  /** A person at the screen agrees, or no longer agrees, to show their cards in this game's replays; a saved replay is written again with it. */
  async setAgreed(player: PlayerId, on: boolean): Promise<void> {
    if (!this.info.seated.includes(player)) return;
    if (on) this.agreedBy.add(player);
    else this.agreedBy.delete(player);
    this.changed();
    const file = this.state === 'saved' ? this.file() : null;
    if (file) await setReplayReveal(this.ctx, this.id, file.reveal);
  }
}

/** A library entry as the screen gets it, with its status on this server's engine (an entry from before the engine facts were kept: unknown build). */
function shown(ctx: ServerContext, e: IndexEntry): LibraryReplay {
  const facts = {
    formatVersion: e.summary.formatVersion ?? REPLAY_FORMAT_VERSION,
    kind: e.summary.kind,
    engine: e.summary.engine ?? { build: null, model: ABILITY_MODEL_VERSION, viewSchema: ENGINE_VIEW_SCHEMA },
    hasRecording: e.summary.hasRecording,
  };
  return { ...e.summary, keep: e.keep, size: e.size, addedAt: e.addedAt, path: fileOf(ctx, e.summary.id), status: replayStatus(facts, engineBuild()) };
}

/** A replay of the library by its id, read and checked (engine readReplayFile); throws when there is none or it cannot be read. */
export async function loadReplay(ctx: Pick<ServerContext, 'cacheDir' | 'libraryDir'>, id: string): Promise<ReplayFile> {
  if (!ID_RE.test(id)) throw new Error('There is no replay with this id.');
  let bytes: Buffer;
  try {
    bytes = await readFile(fileOf(ctx, id));
  } catch {
    throw new Error('This replay is no longer in the library.');
  }
  const read = await readReplayFile(new Uint8Array(bytes));
  if (!read.ok) throw new Error(`This replay cannot be watched: ${read.error.message}`);
  return read.value;
}

export const getLibraryReplays: Handler<'GET /api/library/replays'> = async (_req, ctx) => {
  const index = await readIndex(ctx);
  const replays = [...index.replays].sort((a, b) => b.summary.createdAt.localeCompare(a.summary.createdAt)).map((e) => shown(ctx, e));
  return { status: 200, body: { replays, retention: index.retention } };
};

/** Mark a replay of the library Keep (or not); false when there is none with this id. */
export async function setReplayKeep(ctx: Pick<ServerContext, 'cacheDir' | 'libraryDir'>, id: string, keep: boolean): Promise<boolean> {
  return serialized(indexFile(ctx), async () => {
    const index = await readIndex(ctx);
    const entry = index.replays.find((e) => e.summary.id === id);
    if (!entry) return false;
    entry.keep = keep;
    await writeIndex(ctx, index);
    return true;
  });
}

/** Write a replay's reveal record (whose cards it may show) into its file and its library entry; false when there is none with this id. */
export async function setReplayReveal(ctx: Pick<ServerContext, 'cacheDir' | 'libraryDir'>, id: string, reveal: ReplayFile['reveal']): Promise<boolean> {
  return serialized(indexFile(ctx), async () => {
    const index = await readIndex(ctx);
    const entry = index.replays.find((e) => e.summary.id === id);
    if (!entry) return false;
    const read = await readReplayFile(new Uint8Array(await readFile(fileOf(ctx, id))));
    if (!read.ok) throw new Error(read.error.message);
    const out = await writeGzippedJson({ ...read.value, reveal });
    if (!out.ok) throw new Error(out.error.message);
    await writeAtomic(fileOf(ctx, id), out.value);
    entry.summary = { ...entry.summary, reveal };
    entry.size = out.value.length;
    await writeIndex(ctx, index);
    return true;
  });
}

export const postLibraryReplayUpdate: Handler<'POST /api/library/replays/update'> = async (req, ctx) => {
  const b = req.body as Record<string, unknown> | null;
  const id = b?.['id'];
  if (typeof id !== 'string' || !ID_RE.test(id)) return badRequest('Send {"id": "<replay id>", "title"?, "keep"?}.');
  const title = b?.['title'];
  if (title !== undefined && (typeof title !== 'string' || title.length > TITLE_MAX || /[\u0000-\u001f\u007f]/.test(title))) return badRequest(`The title must be text of at most ${TITLE_MAX} characters.`);
  const keep = b?.['keep'];
  if (keep !== undefined && typeof keep !== 'boolean') return badRequest('keep must be true or false.');
  const found = await serialized(indexFile(ctx), async () => {
    const index = await readIndex(ctx);
    const entry = index.replays.find((e) => e.summary.id === id);
    if (!entry) return null;
    if (typeof keep === 'boolean') entry.keep = keep;
    if (typeof title === 'string') {
      // The title lives in the file too: it is what an export carries.
      const bytes = await readFile(fileOf(ctx, id));
      const read = await readReplayFile(new Uint8Array(bytes));
      if (!read.ok) throw new Error(read.error.message);
      const out = await writeGzippedJson({ ...read.value, title });
      if (!out.ok) throw new Error(out.error.message);
      await writeAtomic(fileOf(ctx, id), out.value);
      entry.summary = { ...entry.summary, title };
      entry.size = out.value.length;
    }
    await writeIndex(ctx, index);
    return entry;
  });
  return found ? { status: 200, body: { replay: shown(ctx, found) } } : { status: 404, body: { error: 'There is no replay with this id.' } };
};

export const postLibraryReplayDelete: Handler<'POST /api/library/replays/delete'> = async (req, ctx) => {
  const id = (req.body as Record<string, unknown> | null)?.['id'];
  if (typeof id !== 'string' || !ID_RE.test(id)) return badRequest('Send {"id": "<replay id>"}.');
  const deleted = await serialized(indexFile(ctx), async () => {
    const index = await readIndex(ctx);
    if (!index.replays.some((e) => e.summary.id === id)) return false;
    await writeIndex(ctx, { ...index, replays: index.replays.filter((e) => e.summary.id !== id) });
    await rm(fileOf(ctx, id), { force: true });
    return true;
  });
  return { status: 200, body: { deleted } };
};

export const postLibraryReplayImport: Handler<'POST /api/library/replays/import'> = async (req, ctx) => {
  const b = req.body as Record<string, unknown> | null;
  const file = b?.['path'];
  const data = b?.['data'];
  let bytes: Uint8Array;
  let name: string;
  if (typeof data === 'string') {
    // Its bytes (base64): the desktop app carrying its library over (client desktop/carryOver.ts).
    name = 'The replay';
    bytes = new Uint8Array(Buffer.from(data, 'base64'));
    if (bytes.length > MAX_FILE_BYTES) return badRequest(`${name} is larger than a replay can be (8 MB).`);
  } else {
    if (typeof file !== 'string' || !path.isAbsolute(file)) return badRequest('Send {"path": "<a replay file on this computer>"} or {"data": "<its bytes, base64>"}.');
    name = path.basename(file);
    let size: number;
    try {
      size = (await stat(file)).size;
    } catch {
      return badRequest(`${name} could not be read.`);
    }
    if (size > MAX_FILE_BYTES) return badRequest(`${name} is larger than a replay can be (8 MB).`);
    bytes = new Uint8Array(await readFile(file));
  }
  const read = await readReplayFile(bytes);
  if (!read.ok) return badRequest(`${name} is not an OpenMTG replay: ${read.error.message}`);
  // An import keeps its own id unless one with that id is already here: then it is a copy with a new id.
  const index = await readIndex(ctx);
  const replay = index.replays.some((e) => e.summary.id === read.value.id) || !ID_RE.test(read.value.id) ? { ...read.value, id: newReplayId() } : read.value;
  const entry = await addReplay(ctx, replay);
  // `keep`: it was marked Keep where it came from.
  if (b?.['keep'] === true && (await setReplayKeep(ctx, replay.id, true))) entry.keep = true;
  return { status: 200, body: { replay: shown(ctx, entry) } };
};

export const postLibraryReplayRetention: Handler<'POST /api/library/replays/retention'> = async (req, ctx) => {
  const limit = (req.body as Record<string, unknown> | null)?.['limit'];
  if (!RETENTION_CHOICES.includes(limit as 10)) return badRequest(`limit must be one of ${RETENTION_CHOICES.join(', ')}.`);
  await serialized(indexFile(ctx), async () => {
    const index = await readIndex(ctx);
    await writeIndex(ctx, { ...index, retention: limit as number });
  });
  return { status: 200, body: { retention: limit as number } };
};
