/**
 * RPL-2 test files: replays built directly from seeded AI-against-AI games (packages/ai/test/harness.ts) through RPL-0's types, as RPL-1's recorder
 * writes them: the game (config, log, a time per action, checkpoints) and the fallback recording of the default perspective, one frame per position (a
 * key view every 5th turn, patches between, views without their definitions).
 */
import {
  applyAction, checkpointsOf, createGame, currentEngine, diffJson, eventsFor, openView, REPLAY_FORMAT, REPLAY_FORMAT_VERSION, replayedEventsFor, viewFor,
  type Action, type CardDef, type GameConfig, type GameEvent, type GameState, type GameView, type PlayerId, type RecordingFrame, type RecordingKeyView,
  type ReplayFile, type ReplayMode, type ReplayRecording,
} from '@openmtg/engine';
import { aiAgent, playGame } from '../../../ai/test/harness';
import { DECKS, gameConfig } from '../../../ai/test/decks';
import type { ReplayChecker, Timers } from '../../src/replays/viewer/check';

export interface PlayedGame {
  config: GameConfig;
  actions: Action[];
  /** `states[0]` is the new game; `states[i + 1]` the state after `actions[i]`. */
  states: GameState[];
  /** `events[i]`: what `actions[i]` returned. */
  events: GameEvent[][];
}

const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export function rerun(config: GameConfig, actions: readonly Action[]): PlayedGame {
  let s = createGame(config);
  const states = [s];
  const events: GameEvent[][] = [];
  for (const a of actions) {
    const r = applyAction(s, a);
    if (r.error) throw new Error(`the log was rejected: ${r.error.message}`);
    s = r.state;
    states.push(s);
    events.push(r.events);
  }
  return { config, actions: [...actions], states, events };
}

const games = new Map<string, PlayedGame>();

/** A seeded AI-against-AI game of any config (both seats are the AI, each reading only its own view). */
export function playedGame(config: GameConfig, seed: string, maxActions = 3000): PlayedGame {
  const played = playGame(config, { p1: aiAgent(`${seed}-p1`), p2: aiAgent(`${seed}-p2`) }, maxActions);
  if (played.rejected.length > 0) throw new Error(`the AI's action was refused: ${played.rejected[0]!.message}`);
  return rerun(config, played.actions);
}

/** A seeded AI-against-AI game on two of the AI's fixture decks (cached per seed within a test file). */
export function aiGame(seed: string, deck1 = 0, deck2 = 1, maxActions = 3000): PlayedGame {
  const key = `${seed}:${deck1}:${deck2}:${maxActions}`;
  const known = games.get(key);
  if (known) return known;
  const g = playedGame(gameConfig(seed, DECKS[deck1]!, DECKS[deck2]!), seed, maxActions);
  games.set(key, g);
  return g;
}

/** The view of a state for a recording's viewer (null: public; 'open': the open view). */
function viewOf(s: GameState, viewer: PlayerId | null | 'open'): GameView {
  return viewer === 'open' ? openView(s) : viewFor(s, viewer);
}

/** What building a file costs most (running the game again for its checkpoints, every view of a recording), kept per game; files get copies. */
const checkpointCache = new WeakMap<PlayedGame, ReturnType<typeof checkpointsOf>['checkpoints']>();
const recordingCache = new WeakMap<PlayedGame, Map<string, string>>();

function checkpointsFor(g: PlayedGame) {
  let c = checkpointCache.get(g);
  if (!c) checkpointCache.set(g, (c = checkpointsOf(g.config, g.actions).checkpoints));
  return roundTrip(c);
}

/** The recording of one viewer, one frame per position, as RPL-1's fallback recording: a key view every 5th turn, patches between. */
export function recordingOf(g: PlayedGame, viewer: PlayerId | null): ReplayRecording {
  let byViewer = recordingCache.get(g);
  if (!byViewer) recordingCache.set(g, (byViewer = new Map()));
  const key = String(viewer);
  let text = byViewer.get(key);
  if (text === undefined) byViewer.set(key, (text = JSON.stringify(makeRecording(g, viewer))));
  return JSON.parse(text) as ReplayRecording;
}

function makeRecording(g: PlayedGame, viewer: PlayerId | null): ReplayRecording {
  const frames: RecordingFrame[] = [];
  const defs: Record<string, CardDef> = {};
  let prev: RecordingKeyView | null = null;
  let keyTurn = -Infinity;
  g.states.forEach((s, i) => {
    const view = viewOf(s, viewer);
    Object.assign(defs, view.defs);
    const raw = i === 0 ? [] : g.events[i - 1]!.slice(replayedEventsFor(g.states[i - 1]!, g.actions[i - 1]!, viewer));
    const events = i === 0 ? [] : eventsFor(s, raw, viewer, { before: g.states[i - 1]! });
    const { defs: _defs, ...key } = view;
    const k = roundTrip(key) as RecordingKeyView;
    if (prev === null || s.turn.number - keyTurn >= 5) {
      frames.push({ seq: i, t: i * 1000, key: k, events: roundTrip(events) });
      keyTurn = s.turn.number;
    } else {
      frames.push({ seq: i, t: i * 1000, patch: diffJson(prev, k), events: roundTrip(events) });
    }
    prev = k;
  });
  return { viewer, defs: roundTrip(defs), frames };
}

export interface ReplayFileOptions {
  mode?: ReplayMode;
  /** The build the replay says it was made on (default: the client's own test build). */
  build?: string | null;
  /** Leave out the fallback recording. */
  noRecording?: boolean;
  /** The recording's viewer (default: the default perspective of the mode: p1 against the computer, public in hot-seat). */
  recordingViewer?: PlayerId | null;
  /** Who agreed to show their cards (default: everyone needed for `'all'` against the computer, nobody in hot-seat). */
  agreed?: PlayerId[];
  /** Milliseconds between actions in `times` (default 1000). */
  gapMs?: number | ((i: number) => number);
}

/** The client's engine build in tests (vitest.config.ts CLIENT_TEST_ENGINE_BUILD). */
export const TEST_BUILD = 'test-engine-build';

/** A game replay file of a played game (design 4), checked by nothing here: tests run it through RPL-0's `checkReplay` where it matters. */
export function replayFileOf(g: PlayedGame, opts: ReplayFileOptions = {}): ReplayFile {
  const mode = opts.mode ?? 'computer';
  const last = g.states[g.states.length - 1]!;
  const computer = mode === 'computer';
  const viewer = opts.recordingViewer !== undefined ? opts.recordingViewer : computer ? 'p1' : null;
  const agreed = opts.agreed ?? (computer ? ['p1'] : []);
  const persons = computer ? ['p1'] : ['p1', 'p2'];
  const checkpoints = checkpointsFor(g);
  const gap = opts.gapMs ?? 1000;
  const times: number[] = [];
  let t = 0;
  for (let i = 0; i < g.actions.length; i++) times.push((t += typeof gap === 'function' ? gap(i) : gap));
  const file: ReplayFile = {
    format: REPLAY_FORMAT,
    formatVersion: REPLAY_FORMAT_VERSION,
    kind: 'game',
    id: 'r-rpl2-test-0001',
    title: 'Alice vs Bob, test decks',
    createdAt: '2026-10-18T12:00:00.000Z',
    app: { version: '0.5.0', commit: '2a8e88ae' },
    engine: currentEngine(opts.build !== undefined ? opts.build : TEST_BUILD),
    game: {
      mode,
      format: 'test',
      players: [
        { id: 'p1', name: last.players[0]!.name, kind: 'person' },
        { id: 'p2', name: last.players[1]!.name, kind: computer ? 'computer' : 'person' },
      ],
      savedBy: computer ? 'p1' : null,
      ended: last.result ? 'finished' : 'abandoned',
      result: last.result,
      turns: last.turn.number,
      actions: g.actions.length,
      startedAt: '2026-10-18T11:30:00.000Z',
      endedAt: '2026-10-18T12:00:00.000Z',
    },
    reveal: { policy: persons.every((p) => agreed.includes(p)) ? 'all' : 'own', agreed },
    play: { config: roundTrip(g.config), actions: roundTrip(g.actions), times, checkpoints },
  };
  if (!opts.noRecording) file.recording = recordingOf(g, viewer);
  return file;
}

/** A recording file (an online guest's) of one seat. */
export function recordingFileOf(g: PlayedGame, viewer: PlayerId): ReplayFile {
  const { play: _play, ...rest } = replayFileOf(g, { mode: 'onlineGuest', recordingViewer: viewer });
  return { ...rest, kind: 'recording', game: { ...rest.game, savedBy: viewer }, reveal: { policy: 'own', agreed: [] } };
}

/** Timers the test runs by hand: `run()` fires what is due (all of it by default), advancing a clock of its own. */
export class ManualTimers implements Timers {
  now = 0;
  private next = 1;
  private readonly queue = new Map<number, { at: number; fn: () => void }>();

  set(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.queue.set(id, { at: this.now + Math.max(0, ms), fn });
    return id;
  }

  clear(handle: unknown): void {
    this.queue.delete(handle as number);
  }

  get pending(): number {
    return this.queue.size;
  }

  /** The delay of the next timer from now (Infinity when none). */
  nextDelay(): number {
    let at = Infinity;
    for (const t of this.queue.values()) at = Math.min(at, t.at);
    return at - this.now;
  }

  /** Fire the earliest timer (advancing the clock to it); false when none is set. */
  fireNext(): boolean {
    let best: [number, { at: number; fn: () => void }] | null = null;
    for (const e of this.queue) if (best === null || e[1].at < best[1].at || (e[1].at === best[1].at && e[0] < best[0])) best = e;
    if (best === null) return false;
    this.queue.delete(best[0]);
    this.now = Math.max(this.now, best[1].at);
    best[1].fn();
    return true;
  }

  /** Fire timers until none is left (or `max` fired). */
  runAll(max = 1_000_000): number {
    let n = 0;
    while (n < max && this.fireNext()) n++;
    return n;
  }
}

/**
 * A check that finds every digest matching at once, for tests about something else: under the same build a replay plays at once anyway, and its
 * background check is tested by itself (replay-connection.test.ts, replay-divergence.test.ts).
 */
export const instantChecker: ReplayChecker = {
  check: (play) => Promise.resolve({ verified: play.actions.length, verifiedTurn: 0, total: play.actions.length, problem: null }),
  cancel() {},
};
