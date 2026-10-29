/**
 * RPL-3 (replays design 3, 6, 7.3, 16.3): an online guest's recording, made from the views its player was shown (already redacted by the host, CR
 * 400.2). The browser makes it from the views its page gets (packages/client online/recording.ts, which keeps it in IndexedDB); the local server makes
 * it for a page without a library of its own (packages/server online/guestRecording.ts). Both build the frames and the file here.
 *
 * Frames (engine replay/format.ts): one per view, by the view's `seq` (the actions the host had applied); a full view at the first frame, at the start of
 * every KEY_FRAME_TURNS-th turn, after RECORDING_MAX_PATCH_RUN patches in a row and after a gap (a reconnection's sync: views were missed), a view patch
 * (`diffJson`) against the previous frame's view otherwise; each view's definitions are kept once. A resent view (the same seq) is not a new frame.
 *
 * When every player agreed and the game is over, the host shares the whole game (`replayGame`, design D5): `checkSharedGame` checks it as any replay
 * file and against what this player saw, and the recording, retimed to the host's times (`retimed`), becomes its fallback.
 */
import {
  RECORDING_MAX_PATCH_RUN, REPLAY_FORMAT, REPLAY_FORMAT_VERSION, REPLAY_LIMITS, cleanText, diffJson, readReplayFile, recordingFrameView,
  type CardDef, type GameEvent, type GameResult, type GameView, type PlayerId, type RecordingFrame, type RecordingKeyView, type ReplayApp,
  type ReplayEnd, type ReplayEngine, type ReplayFile, type ReplayPlayer,
} from '@openmtg/engine';

/** A full view starts every KEY_FRAME_TURNS-th turn (turns 1, 6, 11, ...), so a seek never patches through more than a few turns. */
export const KEY_FRAME_TURNS = 5;

/** A view its player was shown: the actions applied, the events of the change, and when (epoch milliseconds). */
export interface ShownView {
  seq: number;
  view: GameView;
  events: readonly GameEvent[];
  at: number;
}

/** A recording as it goes: its frames, the definitions they use, the last frame's view and the patches in a row since the last full view. */
export interface RecordingSoFar {
  frames: RecordingFrame[];
  defs: Record<string, CardDef>;
  prev: RecordingKeyView | null;
  run: number;
}

const iso = (ms: number): string => new Date(ms).toISOString();

/** A view without its card definitions (a recording keeps them once, apart from the frames). */
export function keyless(v: GameView): { key: RecordingKeyView; defs: Record<string, CardDef> } {
  const { defs, ...key } = v;
  return { key, defs };
}

/**
 * The frame of a view shown, added to `r`; null for a view no newer than the last frame (a resent one). `startMs`: the recording's start (a frame's time
 * is milliseconds since then, never earlier than the last frame's). Returns the frame and the definitions it brought that no earlier frame used.
 */
export function addFrame(r: RecordingSoFar, s: ShownView, startMs: number): { frame: RecordingFrame; defs: Record<string, CardDef> } | null {
  const lastSeq = r.frames[r.frames.length - 1]?.seq ?? -1;
  if (s.seq <= lastSeq) return null;
  const { key, defs } = keyless(s.view);
  const fresh: Record<string, CardDef> = {};
  for (const [k, d] of Object.entries(defs)) {
    if (Object.hasOwn(r.defs, k)) continue;
    r.defs[k] = d;
    fresh[k] = d;
  }
  const t = Math.max(0, s.at - startMs, r.frames[r.frames.length - 1]?.t ?? 0);
  const prev = r.prev;
  const turnStarted = prev !== null && key.turn.number !== prev.turn.number && (key.turn.number - 1) % KEY_FRAME_TURNS === 0;
  const gap = lastSeq >= 0 && s.seq !== lastSeq + 1;
  const events = [...s.events];
  let frame: RecordingFrame;
  if (prev === null || turnStarted || gap || r.run >= RECORDING_MAX_PATCH_RUN) {
    frame = { seq: s.seq, t, key, events };
    r.run = 0;
  } else {
    frame = { seq: s.seq, t, patch: diffJson(prev, key), events };
    r.run++;
  }
  r.frames.push(frame);
  r.prev = key;
  return { frame, defs: fresh };
}

/**
 * Frames kept as they came (each with the definitions it brought), rebuilt and checked as playback would (engine `recordingFrameView`): the frames up to
 * the first that does not fit, their definitions, the last view and the patches in a row at the end.
 */
export function rebuildFrames(me: PlayerId, rows: readonly { frame: RecordingFrame; defs?: Record<string, CardDef> }[]): RecordingSoFar {
  const frames: RecordingFrame[] = [];
  const defs: Record<string, CardDef> = {};
  let last: RecordingKeyView | null = null;
  let run = 0;
  for (const row of rows) {
    for (const [k, d] of Object.entries(row.defs ?? {})) if (!Object.hasOwn(defs, k)) defs[k] = d;
    const v = recordingFrameView(last, row.frame, { viewer: me, defs });
    if (!v.ok || (frames.length > 0 && row.frame.seq <= frames[frames.length - 1]!.seq)) break;
    frames.push(row.frame);
    last = v.value;
    run = row.frame.key !== undefined ? 0 : run + 1;
  }
  return { frames, defs, prev: last, run };
}

/** The seats of a view as a replay lists them: every online seat is a person. */
export function playersOf(view: Pick<GameView, 'players'>): ReplayPlayer[] {
  return view.players.map((p) => ({ id: p.id, name: cleanText(p.name).trim().slice(0, 64) || p.id, kind: 'person' }));
}

/** How the game ended for this player, from the last view (CR 104; the rule of replays/file.ts `endingOf`, on a view). */
export function endingOfView(view: RecordingKeyView, me: PlayerId): { ended: ReplayEnd; result: GameResult | null } {
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

/** What a recording file is made of. */
export interface RecordedGame {
  id: string;
  /** Epoch milliseconds of the start. */
  startMs: number;
  createdAt: string;
  me: PlayerId;
  format: string;
  app: ReplayApp;
  engine: ReplayEngine;
  frames: readonly RecordingFrame[];
  defs: Record<string, CardDef>;
  /** The last frame's view. */
  last: RecordingKeyView | null;
  agree: boolean;
  endedAt: number;
  title: string;
}

/** The recording file (kind 'recording', mode 'onlineGuest') of what was recorded; null without a frame. */
export function onlineRecordingFile(r: RecordedGame): ReplayFile | null {
  const last = r.last;
  if (!last || r.frames.length === 0) return null;
  const players = playersOf(last);
  const { ended, result } = endingOfView(last, r.me);
  return {
    format: REPLAY_FORMAT,
    formatVersion: REPLAY_FORMAT_VERSION,
    kind: 'recording',
    id: r.id,
    title: r.title,
    createdAt: r.createdAt,
    app: { ...r.app },
    engine: { ...r.engine },
    game: {
      mode: 'onlineGuest',
      format: r.format,
      players,
      savedBy: r.me,
      ended,
      result,
      turns: last.turn.number,
      actions: r.frames[r.frames.length - 1]!.seq,
      startedAt: r.createdAt,
      endedAt: iso(Math.max(r.endedAt, r.startMs)),
    },
    reveal: { policy: 'own', agreed: r.agree ? [r.me] : [] },
    recording: { viewer: r.me, defs: { ...r.defs }, frames: r.frames.map((f) => ({ ...f })) },
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
 * The game the host shared (`replayGame`), checked before it is kept (never throws): base64 of at most `maxBytes` (the protocol's REPLAY_GAME_MAX_BYTES),
 * a replay file the engine reads (bounded expansion, the format's shape), a game replay, and the game this player saw: the same seats, saved by this
 * player, at least as many actions as the last view, the same result when the last view has one.
 */
export async function checkSharedGame(data: unknown, me: PlayerId, seen: RecordingKeyView | null, lastSeq: number, maxBytes: number): Promise<SharedGameCheck> {
  if (typeof data !== 'string' || data.length === 0 || data.length > 4 * Math.ceil(maxBytes / 3)) return { ok: false, reason: 'it is not a replay of the size a host sends' };
  const bytes = base64Bytes(data);
  if (!bytes) return { ok: false, reason: 'it is not base64 text' };
  let read: Awaited<ReturnType<typeof readReplayFile>>;
  try {
    read = await readReplayFile(bytes, { ...REPLAY_LIMITS, maxFileBytes: maxBytes, maxTextBytes: 64 * 1024 * 1024 });
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
export function retimed(frames: readonly RecordingFrame[], times: readonly number[]): RecordingFrame[] {
  let t = 0;
  return frames.map((f) => {
    t = Math.max(t, f.seq <= 0 ? 0 : times[f.seq - 1] ?? t);
    return { ...f, t };
  });
}
