/**
 * RPL-2 (replays design 5, 6, 8): a saved game played back read-only. `createReplayConnection(replay)` returns a `GameConnection` of kind `'replay'`,
 * so the live game screen, board, pacer and animator show it (design D6: no second renderer), plus a controller that plays, pauses, steps, seeks, sets
 * the speed and switches the perspective.
 *
 * What it shows (design 8):
 *  - `view()`: for a game replay, `viewFor(state, perspective)` of the state after that many actions, or `openView(state)` for the open view; for a
 *    recording, the frame's view. `events()`: the batch of the action just stepped into, minus what the perspective was given already when the action
 *    stopped for a decision (`replayedEventsFor`), redacted for the perspective by the engine's shared redaction (`eventsFor`, RPL-0), exactly as
 *    `LocalConnection` does; a recording's frame carries its events as they were shown. A step back, a jump or a perspective switch is shown at once:
 *    a new `seq` with no events, which `PacedConnection` shows without animating. Nothing is animated backwards.
 *  - `legalActions()` is empty, `act()` refuses ("This is a replay"), `canUndo()` is false, `handoff()` is null, nobody is seated (no Concede), and
 *    `status()` carries the replay's notice (design 5).
 *
 * Versioning (design 5): a game replay of this engine build is exact by construction; its digests are still compared, in the background, and a
 * difference there is an engine bug. A game replay of another build is checked before it is shown (the checking worker, replays/viewer/check.ts): when
 * every digest matches it plays, "Checked on this version"; otherwise it plays exactly up to the last matching checkpoint and its recording takes over
 * from there, with the recording's perspective, or it stops there when it has no recording. A game whose card model this engine cannot read, or whose
 * config it refuses, shows its recording only.
 *
 * Whose view (design 6, replays/viewer/policy.ts): the perspectives the reveal policy allows, enforced here (`setPerspective` refuses the others), not
 * only hidden in the viewer. The open view and other seats are never computed for a replay that does not allow them.
 *
 * Pacing (design 8): the game screen wraps this connection in its `PacedConnection` and attaches it (`controller.attachPacer`); the clock starts the
 * next change once the pacer has shown the previous one, plus a dwell per kind of change divided by the speed (replays/viewer/pacing.ts).
 *
 * The states (design 8, "States"): the game is run on this engine a slice at a time in the background (replays/viewer/timeline.ts), which keeps a
 * snapshot at every turn start and every 20th action, so a seek or a step back runs forward at most one turn.
 */
import {
  ABILITY_MODEL_VERSION, ENGINE_VIEW_SCHEMA, eventsFor, openView, replayedEventsFor, startReplay, viewFor, type ActionError, type GameEvent, type GameState,
  type GameView, type LegalAction, type PlayerId, type ReplayFile, type ReplayPlayer, type Step,
} from '@openmtg/engine';
import { ENGINE_BUILD } from '../engine-build';
import { STEP_LABELS } from '../game/labels';
import { defaultChecker, DEFAULT_TIMERS, type CheckOutcome, type CheckProblem, type ReplayChecker, type Timers } from '../replays/viewer/check';
import { animatorBase, dwellMs, isCondensed, nextSpeed, REPLAY_SPEEDS, type ReplaySpeed } from '../replays/viewer/pacing';
import {
  allowedPerspectives, defaultPerspective, perspectiveLabel, perspectiveViewer, recordingPerspective, samePerspective, type ReplayPerspective,
} from '../replays/viewer/policy';
import { registerReplayController } from '../replays/viewer/registry';
import { GameTimeline, RecordingTimeline, type MarkKind, type PositionInfo } from '../replays/viewer/timeline';
import type { ActResult, EventBatch, GameConnection } from './GameConnection';

export type { ReplaySpeed } from '../replays/viewer/pacing';
export { REPLAY_SPEEDS };
export type { ReplayPerspective } from '../replays/viewer/policy';

/**
 * Where the replay stands (design 9, "Status"): being checked, exact (this build), checked on this version (another build, every digest matched), its
 * recording from some turn on, watchable only up to some turn, a recording (an online guest's file), or not watchable on this version at all.
 */
export type ReplayBadge = 'checking' | 'exact' | 'checked' | 'recordingFrom' | 'watchingUpTo' | 'recording' | 'unplayable';

/** A turn tick on the timeline: where the turn starts, and whose turn it is (its seat in seating order colors it). */
export interface ReplayTick {
  position: number;
  turn: number;
  player: PlayerId;
  seat: number;
}

/** A timeline marker: what happened in the change into `position` (spells cast, combat damage, life changes, players leaving). */
export interface ReplayMarker {
  position: number;
  kinds: readonly MarkKind[];
}

/** What the viewer draws (stable between changes, for `useSyncExternalStore`). */
export interface ReplayControllerState {
  /** The position shown: the number of actions applied (0: the game's start), or the frame of a recording. */
  position: number;
  /** The last position (the timeline runs from 0 to it). */
  last: number;
  playing: boolean;
  speed: ReplaySpeed;
  /** Mute the sounds at the condensed speeds above 4x (default on, design 8). */
  muteFast: boolean;
  /** Sounds are muted now (condensed and `muteFast`). */
  muted: boolean;
  /** The perspective shown now. */
  perspective: ReplayPerspective;
  /** The perspectives the policy allows (design 6); empty for a recording, which has only its own. */
  perspectives: readonly ReplayPerspective[];
  /** The perspective cannot be switched here: a recording, or the part of a game replay its recording shows. */
  perspectiveFixed: boolean;
  badge: ReplayBadge;
  /** "Exact", "Checked on this version", "Recording from turn 9", "Watching up to turn 9" ... */
  statusText: string;
  /** The longer explanation (the connection's `status()`), or null. */
  notice: string | null;
  /** How far the check is (0 to 1) while it runs before playback; null otherwise. */
  progress: number | null;
  /** The controls work (not while the replay is being checked, and never for one that cannot be watched). */
  playable: boolean;
  turn: number;
  step: Step;
  activePlayer: PlayerId;
  /** "Turn 7 · Bob · Declare blockers · action 83 of 214". */
  label: string;
  /** The timeline's spoken value: "Turn 7, action 83". */
  valueText: string;
  ticks: readonly ReplayTick[];
  markers: readonly ReplayMarker[];
  /** What the last change did, from its log lines as the perspective sees them ("Bob blocks: ..."), or null. */
  caption: string | null;
  /** How many changes were shown at once (jumps, steps back, perspective switches): the screen draws each without sound (design 8). */
  jumps: number;
  players: readonly ReplayPlayer[];
}

/** The pacing side a replay waits for: the game screen's `PacedConnection`. */
export interface ReplayPacer {
  busy(): boolean;
  /** Show the latest change now (a jump is never animated). */
  flush(): void;
  subscribe(listener: () => void): () => void;
}

export interface ReplayController {
  readonly subscribe: (listener: () => void) => () => void;
  readonly state: () => ReplayControllerState;
  readonly play: () => void;
  readonly pause: () => void;
  readonly toggle: () => void;
  /** One change forward (animated) or back (shown at once). False when there is nothing there. */
  readonly step: (delta: 1 | -1) => boolean;
  /** Show the state after `position` actions (shown at once). */
  readonly seek: (position: number) => boolean;
  /** Show the start of turn `turn` (shown at once). */
  readonly seekTurn: (turn: number) => boolean;
  /** The start of the next turn (the end after the last turn). */
  readonly nextTurn: () => boolean;
  /** The start of this turn, or of the turn before when already at its start. */
  readonly previousTurn: () => boolean;
  readonly setSpeed: (speed: ReplaySpeed) => void;
  /** One speed faster (1) or slower (-1) (the `]` and `[` keys). */
  readonly changeSpeed: (direction: 1 | -1) => void;
  /** Refused, with the reason, for a perspective the reveal policy does not allow (design 6). */
  readonly setPerspective: (perspective: ReplayPerspective) => ActResult;
  readonly setMuteFast: (on: boolean) => void;
  /** The animator's time base now (pacing.ts `animatorBase`), given the player's Animation speed scale (null: off or reduced motion). */
  readonly animatorBase: (settingScale: number | null) => number | null;
  /** The game screen's pacer: the clock waits for it to show each change. Returns the detach function. */
  readonly attachPacer: (pacer: ReplayPacer) => () => void;
  /** Resolves when the check and the background indexing are done. */
  readonly ready: () => Promise<void>;
  /** Stop the clock and every background task. */
  readonly dispose: () => void;
}

export interface ReplayConnection extends GameConnection {
  readonly kind: 'replay';
  readonly controller: ReplayController;
  /** Nobody sits at a replay: nobody can concede there. */
  readonly seated: () => readonly PlayerId[];
  /** The replay's notice (design 5), or null. */
  readonly status: () => string | null;
  readonly events: () => EventBatch;
}

export interface ReplayConnectionOptions {
  /** This client's engine build (default: the one it was built with, engine-build.ts; null on the dev server). */
  engineBuild?: string | null;
  /** How a game replay is checked (default: the checking worker where the browser has workers, else on the page in slices). */
  checker?: ReplayChecker;
  /** The timers of the clock and the background work (default setTimeout). */
  timers?: Timers;
  /** The perspective to open on, when the policy allows it (default: design 6's). */
  perspective?: ReplayPerspective;
  speed?: ReplaySpeed;
  /** The position to open at (default the start). */
  position?: number;
  /** How long one slice of background work may take (ms, default 8). */
  sliceMs?: number;
}

/** A replay this client cannot show at all: no game this engine can run and no recording it can read. */
export class ReplayUnplayable extends Error {
  override readonly name = 'ReplayUnplayable';
}

export const REPLAY_ACT_REFUSED = 'This is a replay: it can only be watched.';

/** How often the background indexing tells the viewer that the timeline grew (ms). */
const BACKGROUND_NOTIFY_MS = 250;

const NO_ACTIONS: readonly LegalAction[] = Object.freeze([]);
const NO_EVENTS: readonly GameEvent[] = Object.freeze([]);
const NO_SEATS: readonly PlayerId[] = Object.freeze([]);

function refused(message: string): ActResult {
  const error: ActionError = { message, rules: [] };
  return { ok: false, error };
}

/** "commit 2a8e88ae, 2026-10-18" (or the version when the build had no commit): the OpenMTG a replay was made with (design 5.3). */
function madeWith(replay: ReplayFile): string {
  const date = replay.createdAt.slice(0, 10);
  return replay.app.commit !== null ? `commit ${replay.app.commit}, ${date}` : `version ${replay.app.version}, ${date}`;
}

const turnText = (turn: number): string => (turn <= 0 ? 'the start' : `turn ${turn}`);

class ReplaySession {
  readonly replay: ReplayFile;
  private readonly timers: Timers;
  private readonly sliceMs: number;
  private readonly game: GameTimeline | null = null;
  private readonly rec: RecordingTimeline | null = null;
  /** Why the game part cannot be run here, when it cannot (another card model, a config this engine refuses). */
  private readonly gameNote: string | null = null;
  /** Why the recording cannot be read here, when it cannot. */
  private readonly recNote: string | null = null;
  private readonly sameBuild: boolean;
  private readonly allowed: readonly ReplayPerspective[];
  private readonly recPerspective: ReplayPerspective | null;
  /** The perspective chosen for the game part. */
  private chosen: ReplayPerspective;

  /** The checker, while it runs. */
  private checker: ReplayChecker | null = null;
  private checking = false;
  private progressPct = 0;
  /** Where the game stops being exact on this engine, when it does (the check, or an action this engine refused). */
  private divergence: { verified: number; turn: number; problem: CheckProblem } | null = null;

  private pos = 0;
  /** The game's state at `pos` while `pos` is in the game part. */
  private gameState: GameState | null = null;
  private shownView: GameView;
  private batch: EventBatch = { seq: 0, events: NO_EVENTS };
  private caption: string | null = null;
  private jumps = 0;

  private playing = false;
  private speed: ReplaySpeed;
  private muteFast = true;
  private timer: unknown = null;
  private bgTimer: unknown = null;
  private bgNotified = 0;
  private pacer: ReplayPacer | null = null;
  private waitingForPacer = false;
  private disposed = false;

  private readonly listeners = new Set<() => void>();
  private readonly controllerListeners = new Set<() => void>();
  private snapshot: ReplayControllerState | null = null;
  private marksCache: { key: string; ticks: ReplayTick[]; markers: ReplayMarker[] } | null = null;
  private readyWaiters: (() => void)[] = [];

  constructor(replay: ReplayFile, opts: ReplayConnectionOptions) {
    this.replay = replay;
    this.timers = opts.timers ?? DEFAULT_TIMERS;
    this.sliceMs = opts.sliceMs ?? 8;
    this.speed = opts.speed ?? 1;
    const build = opts.engineBuild !== undefined ? opts.engineBuild : ENGINE_BUILD;

    // The recording, when this client reads its views (design 5.5: `viewSchema`; there are no adapters for older schemas yet).
    const recording = replay.recording;
    if (recording) {
      if (replay.engine.viewSchema !== ENGINE_VIEW_SCHEMA) {
        this.recNote = replay.engine.viewSchema > ENGINE_VIEW_SCHEMA
          ? 'Its recording was made by a newer OpenMTG; update to watch it.'
          : 'Its recording is in a view format this version of OpenMTG no longer reads.';
      } else {
        const t = new RecordingTimeline(recording);
        if (t.end >= 0) this.rec = t;
        else this.recNote = `Its recording cannot be shown: ${t.problem ?? 'it has no frames'}`;
      }
    }

    // The game, when this engine can run it (design 5.4: the card model it was made with).
    const play = replay.kind === 'game' ? replay.play : undefined;
    if (play) {
      if (replay.engine.model !== ABILITY_MODEL_VERSION) {
        this.gameNote = `This replay's game was made with card model ${replay.engine.model}, and this version of OpenMTG reads model ${ABILITY_MODEL_VERSION}.`;
      } else {
        const start = startReplay(play.config);
        if (start.ok) this.game = new GameTimeline(play, start.state);
        else this.gameNote = `This version of OpenMTG cannot set up this replay's game (${madeWith(replay)}): ${start.rejection.error.message}`;
      }
    }
    if (!this.game && !this.rec) {
      throw new ReplayUnplayable([this.gameNote, this.recNote].filter((x) => x !== null).join(' ') || 'This replay holds nothing this version of OpenMTG can show.');
    }

    this.sameBuild = this.game !== null && replay.engine.build !== null && build !== null && replay.engine.build === build;
    this.recPerspective = this.rec ? recordingPerspective(this.rec.recording.viewer) : null;
    this.allowed = this.game ? allowedPerspectives(replay) : [];
    const wanted = opts.perspective && this.allowed.some((p) => samePerspective(p, opts.perspective!)) ? opts.perspective : null;
    this.chosen = wanted ?? (this.game ? defaultPerspective(replay) : this.recPerspective!);

    // Another build is checked before it is shown; this build is exact by construction and checked in the background (design 5.2, 5.3).
    if (this.game && play) {
      this.checking = true;
      this.checker = opts.checker ?? defaultChecker(this.timers);
      void this.checker.check(play, (p) => this.onProgress(p.done, p.total)).then((o) => this.onChecked(o));
    }
    // The first view: the position asked for when it can be reached, else the start (which always can: the game's new state or a checked frame).
    let at = Math.min(Math.max(0, Math.floor(opts.position ?? 0)), this.last());
    let first = this.compute(at, false);
    if (first === null) first = this.compute((at = 0), false);
    if (first === null) throw new ReplayUnplayable('This replay holds nothing this version of OpenMTG can show.');
    this.pos = at;
    this.gameState = first.state;
    this.shownView = first.view;
    this.scheduleBackground();
  }

  // ---- positions -----------------------------------------------------------------------------------------------------------------

  /** The last position of the game part (-1: none). */
  private gameEnd(): number {
    if (!this.game) return -1;
    const v = this.divergence ? this.divergence.verified : this.game.end;
    return Math.min(v, this.game.end);
  }

  /** The frame of a game position in the recording: one frame per position when the recording has as many, else the last frame not later than its time. */
  private frameForGame(p: number): number {
    const rec = this.rec!;
    const frames = rec.recording.frames;
    const play = this.replay.play;
    if (!play || frames.length === play.actions.length + 1) return p;
    const t = p <= 0 ? 0 : play.times[p - 1] ?? 0;
    let f = 0;
    for (let i = 0; i < frames.length && frames[i]!.t <= t; i++) f = i;
    return f;
  }

  /** The first frame shown after the game part (the whole recording when there is no game part). */
  private recStart(): number {
    const end = this.gameEnd();
    return end < 0 ? 0 : this.frameForGame(end) + 1;
  }

  /** The frame position `p` shows (`p` after the game part). */
  private frameOf(p: number): number {
    return this.recStart() + (p - this.gameEnd() - 1);
  }

  /** How many frames of the recording are shown after the game part. */
  private recFrames(): number {
    return this.rec ? Math.max(0, this.rec.end - this.recStart() + 1) : 0;
  }

  last(): number {
    return Math.max(0, this.gameEnd() + this.recFrames());
  }

  private inGame(p: number): boolean {
    return p <= this.gameEnd();
  }

  /** What is known of position `p`, or null when it is not indexed yet. */
  private infoAt(p: number, extend = false): PositionInfo | null {
    if (p < 0 || p > this.last()) return null;
    if (this.inGame(p)) {
      if (extend && p > this.game!.frontier) this.game!.extend(p);
      return this.game!.info[p] ?? null;
    }
    if (!this.rec) return null;
    const f = this.frameOf(p);
    if (extend && f > this.rec.frontier) this.rec.extend(f);
    return this.rec.info[f] ?? null;
  }

  /** The perspective shown at `p`: the chosen one in the game part, the recording's after it. */
  perspectiveAt(p: number): ReplayPerspective {
    return this.inGame(p) ? this.chosen : this.recPerspective ?? this.chosen;
  }

  private viewOfState(s: GameState, p: ReplayPerspective): GameView {
    return p.kind === 'open' ? openView(s) : viewFor(s, perspectiveViewer(p));
  }

  /**
   * The view at `p`, the state there (game part), and, for a forward step from the position on screen, the events of the change as the perspective may
   * know them (see the file comment). Null when `p` turned out to be past the end: this engine refused an action of the log, or a frame of the recording
   * does not fit (both are found only when reached).
   */
  private compute(p: number, forward: boolean): { view: GameView; state: GameState | null; events: readonly GameEvent[] } | null {
    if (p > this.last()) return null;
    const persp = this.perspectiveAt(p);
    if (this.inGame(p)) {
      const game = this.game!;
      if (forward && this.gameState !== null && this.inGame(p - 1)) {
        const prev = this.gameState;
        const step = game.stepInto(prev, p);
        if (step !== null) {
          game.remember(p, step.state);
          const action = game.actionInto(p)!;
          const viewer = perspectiveViewer(persp);
          const open = persp.kind === 'open';
          const shown = step.events.slice(replayedEventsFor(prev, action, viewer, { open }));
          const events = eventsFor(step.state, shown, viewer, { before: prev, open });
          return { view: this.viewOfState(step.state, persp), state: step.state, events };
        }
      }
      const s = game.stateAt(p);
      if (s !== null) return { view: this.viewOfState(s, persp), state: s, events: NO_EVENTS };
      this.syncLimits();
      if (p > this.last() || this.inGame(p)) return null;
    }
    // Nothing left to show (a game that cannot be watched here at all keeps its first view, under the viewer's cover).
    if (!this.rec) return null;
    const f = this.frameOf(p);
    const v = this.rec.viewAt(f);
    if (v === null) return null;
    // A recording's frame carries its events as its viewer was shown them; at the switch from the game they animate only on the same perspective.
    const continues = forward && (!this.inGame(p - 1) || samePerspective(this.perspectiveAt(p - 1), persp));
    return { view: { ...v, defs: this.rec.recording.defs } as GameView, state: null, events: continues ? this.rec.eventsOf(f) : NO_EVENTS };
  }

  /** What the change into `p` did, from the log lines the perspective sees that are newer than `sinceSeq`. */
  private captionOf(view: GameView, sinceSeq: number | null): string | null {
    if (sinceSeq === null) return null;
    const lines = view.log.filter((e) => e.seq > sinceSeq && e.level === 'action').map((e) => e.text);
    return lines.length === 0 ? null : lines.join(' ');
  }

  /** Show position `p`: a forward step by one is animated (it carries the change's events), anything else is shown at once. */
  goTo(p: number, how: 'step' | 'jump' | 'refresh'): boolean {
    if (this.disposed) return false;
    let at = Math.min(Math.max(0, Math.floor(p)), this.last());
    if (at === this.pos && how !== 'refresh') return false;
    let forward = how === 'step' && at === this.pos + 1;
    const prevView = this.shownView;
    let next = this.compute(at, forward);
    // The replay turned out shorter than it looked (an action this engine refuses, a frame that does not fit): show its new end instead.
    for (let tries = 0; next === null && tries < 3; tries++) {
      this.syncLimits();
      at = this.last();
      forward = false;
      next = this.compute(at, false);
    }
    if (next === null) return false;
    const prevSeq = forward ? (prevView.log.length === 0 ? -1 : prevView.log[prevView.log.length - 1]!.seq) : (this.infoAt(at - 1)?.logSeq ?? null);
    this.pos = at;
    this.gameState = next.state;
    this.shownView = next.view;
    this.caption = at === 0 ? null : this.captionOf(next.view, prevSeq);
    this.batch = { seq: this.batch.seq + 1, events: next.events };
    if (!forward) this.jumps++;
    this.changed(true);
    // A jump is shown at once, even while the pacer is still animating the change before it.
    if (!forward) this.pacer?.flush();
    return true;
  }

  // ---- the check and the background work ------------------------------------------------------------------------------------------

  private onProgress(done: number, total: number): void {
    const pct = total === 0 ? 100 : Math.floor((done / total) * 100);
    if (pct === this.progressPct) return;
    this.progressPct = pct;
    if (!this.sameBuild) this.changed(true);
  }

  private onChecked(o: CheckOutcome): void {
    if (this.disposed) return;
    const before = { end: this.gameEnd(), last: this.last() };
    this.checking = false;
    this.checker = null;
    // Under this build the log is exact by construction: a tail no checkpoint covers is fine, a digest that differs is an engine bug (design 5.2).
    const problem = o.problem && !(this.sameBuild && o.problem.cause === 'unchecked') ? o.problem : null;
    if (problem) this.divergence = { verified: o.verified, turn: o.verifiedTurn, problem };
    this.afterLimitChange(this.sameBuild ? before : null);
    this.notifyReady();
  }

  /**
   * An action this engine refused while running the log (found by the background indexing or a step before the check said so): the game is exact only
   * up to the last checkpoint before it (design 5.3; under this build an engine bug).
   */
  private syncLimits(): void {
    this.marksCache = null;
    this.snapshot = null;
    const r = this.game?.rejection;
    if (!r || this.divergence) return;
    const verified = this.lastCheckpointBefore(r.index);
    this.divergence = { verified, turn: verified < 0 ? 0 : this.game!.info[verified]?.turn ?? 0, problem: { cause: r.cause, at: r.index, message: r.error.message } };
  }

  /** The game part or the recording ended somewhere new: keep the position in range and show it again from where it now comes. */
  private afterLimitChange(before: { end: number; last: number } | null = null): void {
    this.syncLimits();
    if (before && before.end === this.gameEnd() && before.last === this.last()) {
      this.changed(true);
      return;
    }
    if (!this.goTo(Math.min(this.pos, this.last()), 'refresh')) this.changed(true);
    if (this.playing && (!this.playable() || this.pos >= this.last())) this.pause();
  }

  /** The position of the last recorded checkpoint before action `index` (-1: none). */
  private lastCheckpointBefore(index: number): number {
    const cps = this.replay.play?.checkpoints ?? [];
    let v = -1;
    for (const c of cps) if (c.action < index) v = c.action + 1;
    return v;
  }

  private scheduleBackground(): void {
    if (this.disposed || this.bgTimer !== null) return;
    const gameDone = !this.game || this.game.complete;
    const recDone = !this.rec || this.rec.complete;
    if (gameDone && recDone) {
      this.notifyReady();
      return;
    }
    this.bgTimer = this.timers.set(() => {
      this.bgTimer = null;
      if (this.disposed) return;
      const before = { end: this.gameEnd(), last: this.last() };
      const ends = `${this.game?.end}:${this.rec?.end}`;
      if (this.game && !this.game.complete) this.game.extend(Infinity, this.sliceMs);
      else if (this.rec && !this.rec.complete) this.rec.extend(Infinity, this.sliceMs);
      if (`${this.game?.end}:${this.rec?.end}` !== ends) this.afterLimitChange(before);
      else if (this.isReady() || Date.now() - this.bgNotified >= BACKGROUND_NOTIFY_MS) {
        // The timeline's ticks and markers grow as the game is indexed: told a few times a second, not after every slice.
        this.bgNotified = Date.now();
        this.changed(false);
      }
      this.scheduleBackground();
    }, 0);
  }

  private isReady(): boolean {
    return !this.checking && (!this.game || this.game.complete) && (!this.rec || this.rec.complete);
  }

  private notifyReady(): void {
    if (!this.isReady()) return;
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const w of waiters) w();
  }

  ready(): Promise<void> {
    if (this.isReady()) return Promise.resolve();
    return new Promise((resolve) => this.readyWaiters.push(resolve));
  }

  // ---- status ---------------------------------------------------------------------------------------------------------------------

  /** Another build's game is shown only once it is checked (design 5.3). */
  private awaitingCheck(): boolean {
    return this.checking && !this.sameBuild;
  }

  playable(): boolean {
    return !this.awaitingCheck() && this.badge() !== 'unplayable';
  }

  private badge(): ReplayBadge {
    if (!this.game) return this.replay.kind === 'recording' ? 'recording' : 'recordingFrom';
    if (this.awaitingCheck()) return 'checking';
    if (!this.divergence) return this.sameBuild ? 'exact' : 'checked';
    if (this.recFrames() > 0) return 'recordingFrom';
    return this.gameEnd() < 0 ? 'unplayable' : 'watchingUpTo';
  }

  /** The turn where the game part ends (the switch to the recording, or the end of what can be watched). */
  private divergenceTurn(): number {
    const end = this.gameEnd();
    return end < 0 ? 0 : this.game?.info[end]?.turn ?? this.divergence?.turn ?? 0;
  }

  private statusText(badge: ReplayBadge): string {
    switch (badge) {
      case 'checking':
        return `Checking ${this.progressPct}%`;
      case 'exact':
        return 'Exact';
      case 'checked':
        return 'Checked on this version';
      case 'recordingFrom':
        return this.gameEnd() < 0 ? 'Recording' : `Recording from turn ${this.divergenceTurn()}`;
      case 'watchingUpTo':
        return `Watching up to turn ${this.divergenceTurn()}`;
      case 'recording':
        return 'Recording';
      case 'unplayable':
        return 'Cannot be watched here';
    }
  }

  /** The connection's `status()` (design 5). */
  notice(): string | null {
    const badge = this.badge();
    const recEnds = this.rec?.problem ? ` The recording ends early: ${this.rec.problem}` : '';
    const recNote = this.recNote ? ` ${this.recNote}` : '';
    switch (badge) {
      case 'checking':
        return `Checking this replay on this version of OpenMTG (${this.progressPct}%). It was made with another one (${madeWith(this.replay)}).`;
      case 'exact':
      case 'checked':
        return null;
      case 'recording':
        return recEnds === '' ? null : recEnds.trim();
      case 'recordingFrom': {
        if (!this.game) return `${this.gameNote ?? ''} This replay shows its recording.${recEnds}`.trim();
        const from = this.gameEnd() < 0 ? 'From the start' : `From turn ${this.divergenceTurn()}`;
        if (this.sameBuild) {
          return `${from} this replay shows its recording: the game plays differently on the version of OpenMTG it was made on, which is a bug in OpenMTG.${recEnds}`;
        }
        return `${from} this replay shows the recording; this version of OpenMTG plays the game differently than the one it was played on, ${madeWith(this.replay)}.${recEnds}`;
      }
      case 'watchingUpTo':
        return `This version of OpenMTG plays the game differently than the one it was played on, ${madeWith(this.replay)}. You can watch it up to ${turnText(this.divergenceTurn())}.${recNote}`;
      case 'unplayable':
        return `This version of OpenMTG plays the game differently than the one it was played on, ${madeWith(this.replay)}, from its start: it cannot be watched here.${recNote}`;
    }
  }

  // ---- the controller's state -----------------------------------------------------------------------------------------------------

  private marks(): { ticks: ReplayTick[]; markers: ReplayMarker[] } {
    const key = `${this.gameEnd()}:${this.last()}:${this.game?.frontier ?? -1}:${this.rec?.frontier ?? -1}`;
    if (this.marksCache?.key === key) return this.marksCache;
    const ticks: ReplayTick[] = [];
    const markers: ReplayMarker[] = [];
    const seats = this.replay.game.players.map((p) => p.id);
    const last = this.last();
    for (let p = 0; p <= last; p++) {
      const info = this.infoAt(p);
      if (!info) {
        if (this.inGame(p)) {
          p = this.gameEnd(); // skip to the recording part, whose frames may be indexed already
          continue;
        }
        break;
      }
      if (p > 0 && info.change === 'turn' && info.turn > 0) ticks.push({ position: p, turn: info.turn, player: info.active, seat: Math.max(0, seats.indexOf(info.active)) });
      if (p > 0 && info.marks.length > 0) markers.push({ position: p, kinds: info.marks });
    }
    this.marksCache = { key, ticks, markers };
    return this.marksCache;
  }

  state(): ReplayControllerState {
    if (this.snapshot) return this.snapshot;
    const v = this.shownView;
    const badge = this.badge();
    const last = this.last();
    const name = (id: PlayerId) => this.replay.game.players.find((p) => p.id === id)?.name ?? v.players.find((p) => p.id === id)?.name ?? id;
    const turn = v.turn.number;
    const where = turn <= 0 ? 'Start of the game' : `Turn ${turn} · ${name(v.turn.activePlayer)} · ${STEP_LABELS[v.turn.step] ?? v.turn.step}`;
    const { ticks, markers } = this.marks();
    const perspective = this.perspectiveAt(this.pos);
    this.snapshot = Object.freeze({
      position: this.pos,
      last,
      playing: this.playing,
      speed: this.speed,
      muteFast: this.muteFast,
      muted: this.muteFast && isCondensed(this.speed),
      perspective,
      perspectives: this.allowed,
      perspectiveFixed: !this.game || !this.inGame(this.pos),
      badge,
      statusText: this.statusText(badge),
      notice: this.notice(),
      progress: this.awaitingCheck() ? this.progressPct / 100 : null,
      playable: this.playable(),
      turn,
      step: v.turn.step,
      activePlayer: v.turn.activePlayer,
      label: `${where} · action ${this.pos} of ${last}`,
      valueText: turn <= 0 ? `Start of the game, action ${this.pos}` : `Turn ${turn}, action ${this.pos}`,
      ticks,
      markers,
      caption: this.caption,
      jumps: this.jumps,
      players: this.replay.game.players,
    });
    return this.snapshot;
  }

  /** Something changed: the controller's state always, the connection (view, events, status) when `view` says so. */
  private changed(view: boolean): void {
    this.snapshot = null;
    if (view) for (const l of [...this.listeners]) l();
    for (const l of [...this.controllerListeners]) l();
  }

  // ---- the clock ------------------------------------------------------------------------------------------------------------------

  private clearTimer(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    this.waitingForPacer = false;
  }

  /** The pause after the change on screen before the next one (design 8). */
  private dwell(): number {
    const info = this.infoAt(this.pos, true);
    const next = this.infoAt(this.pos + 1, true);
    const gap = info && next ? next.t - info.t : undefined;
    return dwellMs(info?.change ?? 'decision', this.speed, gap);
  }

  /** Wait until the pacer has shown the change on screen, then the dwell, then step. */
  private schedule(): void {
    this.clearTimer();
    if (!this.playing || this.disposed) return;
    if (this.pacer?.busy()) {
      this.waitingForPacer = true;
      return;
    }
    this.timer = this.timers.set(() => {
      this.timer = null;
      this.advance();
    }, this.dwell());
  }

  private advance(): void {
    if (!this.playing) return;
    if (this.pos >= this.last() || !this.goTo(this.pos + 1, 'step') || this.pos >= this.last()) {
      this.pause();
      return;
    }
    this.schedule();
  }

  private readonly onPacer = (): void => {
    if (this.waitingForPacer && this.pacer && !this.pacer.busy()) this.schedule();
  };

  attachPacer(pacer: ReplayPacer): () => void {
    this.pacer = pacer;
    const unsubscribe = pacer.subscribe(this.onPacer);
    return () => {
      unsubscribe();
      if (this.pacer === pacer) this.pacer = null;
      if (this.waitingForPacer) this.schedule();
    };
  }

  play(): void {
    if (this.playing || !this.playable()) return;
    if (this.pos >= this.last()) this.goTo(0, 'jump'); // play again from the start
    this.playing = true;
    this.changed(false);
    this.schedule();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.clearTimer();
    this.changed(false);
  }

  /** A move made by the viewer (a step, a seek): the clock goes on from there when it is playing. */
  private moved(ok: boolean): boolean {
    if (ok && this.playing) {
      if (this.pos >= this.last()) this.pause();
      else this.schedule();
    }
    return ok;
  }

  step(delta: 1 | -1): boolean {
    if (!this.playable()) return false;
    return this.moved(this.goTo(this.pos + delta, delta === 1 ? 'step' : 'jump'));
  }

  seek(position: number): boolean {
    if (!this.playable() || !Number.isFinite(position)) return false;
    return this.moved(this.goTo(position, 'jump'));
  }

  /** The first position of turn `turn`, indexing as far as needed; null when the replay has no such turn. */
  private turnStart(turn: number): number | null {
    const last = this.last();
    for (let p = 0; p <= last; p++) {
      const info = this.infoAt(p, true);
      if (!info) return null;
      if (info.turn === turn) return p;
      if (info.turn > turn) return null;
    }
    return null;
  }

  seekTurn(turn: number): boolean {
    if (!this.playable()) return false;
    const p = this.turnStart(turn);
    return p === null ? false : this.moved(this.goTo(p, 'jump'));
  }

  nextTurn(): boolean {
    if (!this.playable()) return false;
    const p = this.turnStart(this.shownView.turn.number + 1);
    return this.moved(this.goTo(p ?? this.last(), 'jump'));
  }

  previousTurn(): boolean {
    if (!this.playable()) return false;
    const turn = this.shownView.turn.number;
    const start = this.turnStart(turn) ?? 0;
    const p = this.pos > start ? start : turn > 1 ? this.turnStart(turn - 1) ?? 0 : 0;
    return this.moved(this.goTo(p, 'jump'));
  }

  setSpeed(speed: ReplaySpeed): void {
    if (speed === this.speed || !REPLAY_SPEEDS.includes(speed)) return;
    this.speed = speed;
    this.changed(false);
    if (this.playing) this.schedule();
  }

  setPerspective(p: ReplayPerspective): ActResult {
    const players = this.replay.game.players;
    if (!this.game) return refused(`This replay is a recording: it shows only ${perspectiveLabel(this.recPerspective!, players)}'s view.`);
    if (!this.allowed.some((q) => samePerspective(p, q))) {
      const what = p.kind === 'open' ? 'every card' : p.kind === 'public' ? 'the public view' : `${perspectiveLabel(p, players)}'s cards`;
      return refused(`This replay may not show ${what}: hidden cards are shown only in a player's own replay, or when every player agreed (CR 400.2).`);
    }
    if (!this.inGame(this.pos)) {
      return refused(`From ${turnText(this.divergenceTurn())} this replay shows its recording, which has only ${perspectiveLabel(this.recPerspective!, players)}'s view.`);
    }
    if (samePerspective(p, this.chosen)) return { ok: true };
    this.chosen = p;
    this.goTo(this.pos, 'refresh');
    return { ok: true };
  }

  setMuteFast(on: boolean): void {
    if (on === this.muteFast) return;
    this.muteFast = on;
    this.changed(false);
  }

  animatorBase(settingScale: number | null): number | null {
    return animatorBase(this.speed, settingScale);
  }

  changeSpeed(direction: 1 | -1): void {
    this.setSpeed(nextSpeed(this.speed, direction));
  }

  dispose(): void {
    this.disposed = true;
    this.playing = false;
    this.clearTimer();
    if (this.bgTimer !== null) this.timers.clear(this.bgTimer);
    this.bgTimer = null;
    this.checker?.cancel();
    this.checker = null;
  }

  // ---- the connection -------------------------------------------------------------------------------------------------------------

  view(): GameView {
    return this.shownView;
  }

  events(): EventBatch {
    return this.batch;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeController(listener: () => void): () => void {
    this.controllerListeners.add(listener);
    return () => {
      this.controllerListeners.delete(listener);
    };
  }
}

/**
 * A replay as a read-only game connection, with its controller (see the file comment). Throws `ReplayUnplayable` for a replay with nothing this client
 * can show (no game this engine can run, no recording it can read); every other problem (another build that plays the game differently, a damaged
 * frame) is shown by the connection itself.
 */
export function createReplayConnection(replay: ReplayFile, options: ReplayConnectionOptions = {}): ReplayConnection {
  const s = new ReplaySession(replay, options);
  const controller: ReplayController = Object.freeze({
    subscribe: (l: () => void) => s.subscribeController(l),
    state: () => s.state(),
    play: () => s.play(),
    pause: () => s.pause(),
    toggle: () => (s.state().playing ? s.pause() : s.play()),
    step: (d: 1 | -1) => s.step(d),
    seek: (p: number) => s.seek(p),
    seekTurn: (t: number) => s.seekTurn(t),
    nextTurn: () => s.nextTurn(),
    previousTurn: () => s.previousTurn(),
    setSpeed: (x: ReplaySpeed) => s.setSpeed(x),
    changeSpeed: (d: 1 | -1) => s.changeSpeed(d),
    setPerspective: (p: ReplayPerspective) => s.setPerspective(p),
    setMuteFast: (on: boolean) => s.setMuteFast(on),
    animatorBase: (scale: number | null) => s.animatorBase(scale),
    attachPacer: (p: ReplayPacer) => s.attachPacer(p),
    ready: () => s.ready(),
    dispose: () => s.dispose(),
  });
  const connection: ReplayConnection = Object.freeze({
    kind: 'replay' as const,
    controller,
    view: () => s.view(),
    legalActions: () => NO_ACTIONS,
    act: async () => refused(REPLAY_ACT_REFUSED),
    subscribe: (l: () => void) => s.subscribe(l),
    canUndo: () => false,
    undo: () => false,
    handoff: () => null,
    acceptHandoff: () => {},
    seated: () => NO_SEATS,
    status: () => s.notice(),
    events: () => s.events(),
  });
  registerReplayController(connection, controller);
  return connection;
}

/** The controller of a replay connection (or of its sealed form, game/sealed.ts); null for any other connection. */
export { replayControllerOf } from '../replays/viewer/controllerOf';
