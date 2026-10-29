/**
 * RPL-2 (replays design 8, "States"; 9, the timeline): the positions of a replay and what is known of each. A position is a moment the screen can show:
 * for a game, the state after that many actions of the log (position 0 is the new game); for a recording, a frame.
 *
 * `GameTimeline` runs the log on this engine, a slice at a time, and keeps a snapshot at every turn start and every 20th action, so a seek or a step back
 * runs forward from the nearest snapshot: at most one turn, and never more than 19 actions (tens of ms). It also notes, for each position, the turn, the
 * step and the active player (the label, the timeline's turn ticks), what kind of change led there (the clock's pause), its time, and the timeline's
 * markers: spells cast, combat damage, life changes and players leaving. The markers come from the events as the public view is shown them (CR 400.2:
 * all four are public; a cast still being made, which the other players do not see yet, is not marked until it is settled, CR 733.1).
 *
 * `RecordingTimeline` decodes a recording's frames, each through the shape check the board needs (`recordingFrameView`): a frame that does not fit ends
 * the recording at the frame before it (design 4).
 */
import {
  eventsFor, recordingFrameView, replayAction, replayedEventsFor, type Action, type GameEvent, type GameState, type PlayerId, type RecordingKeyView,
  type RecordingViewContext, type ReplayPlay, type ReplayRecording, type ReplayRejection, type Step,
} from '@openmtg/engine';
import type { ChangeKind } from './pacing';

/** A timeline marker (design 9). */
export type MarkKind = 'spell' | 'combat' | 'life' | 'left';

export interface PositionInfo {
  turn: number;
  step: Step;
  active: PlayerId;
  /** The `seq` of the newest log line at this position (-1: no line yet), for the caption of the next change. */
  logSeq: number;
  /** What led to this position (the new game: `'turn'`). */
  change: ChangeKind;
  /** Milliseconds since the start (the action's or the frame's time). */
  t: number;
  marks: readonly MarkKind[];
}

/** Every `SNAPSHOT_EVERY` positions a snapshot is kept, besides one at every turn start. */
export const SNAPSHOT_EVERY = 20;
/** The most states kept besides the snapshots (the last ones a seek or a step went through), so stepping back one at a time stays cheap. */
const RECENT_MAX = 48;

const NO_MARKS: readonly MarkKind[] = Object.freeze([]);

/** The markers of a change's events. */
export function marksOf(events: readonly GameEvent[]): readonly MarkKind[] {
  const out = new Set<MarkKind>();
  for (const e of events) {
    if (e.type === 'spellCast') out.add('spell');
    else if (e.type === 'damageDealt' && e.combat) out.add('combat');
    else if (e.type === 'lifeChanged') out.add('life');
    else if (e.type === 'playerLost' || e.type === 'playerLeft') out.add('left');
  }
  return out.size === 0 ? NO_MARKS : Object.freeze([...out]);
}

const STEP_ONLY = new Set<GameEvent['type']>(['stepBegan', 'stepEnded', 'priorityGiven']);

function newestSeq(log: readonly { seq: number }[]): number {
  return log.length === 0 ? -1 : log[log.length - 1]!.seq;
}

function changeOf(prev: PositionInfo | null, turn: number, pass: boolean): ChangeKind {
  if (prev === null || turn !== prev.turn) return 'turn';
  return pass ? 'pass' : 'decision';
}

/** Ascending positions with a known value; `atOrBefore(p)` is the greatest one not after `p`. */
class Positions<T> {
  private readonly at: number[] = [];
  private readonly values = new Map<number, T>();

  put(p: number, v: T): void {
    if (!this.values.has(p)) {
      let i = this.at.length;
      while (i > 0 && this.at[i - 1]! > p) i--;
      this.at.splice(i, 0, p);
    }
    this.values.set(p, v);
  }

  get(p: number): T | undefined {
    return this.values.get(p);
  }

  atOrBefore(p: number): number {
    let lo = 0;
    let hi = this.at.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.at[mid]! <= p) {
        best = this.at[mid]!;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return best;
  }
}

/** A small cache of the most recently used values, by position. */
class Recent<T> {
  private readonly map = new Map<number, T>();

  constructor(private readonly max: number) {}

  get(p: number): T | undefined {
    const v = this.map.get(p);
    if (v !== undefined) {
      this.map.delete(p);
      this.map.set(p, v);
    }
    return v;
  }

  put(p: number, v: T): void {
    this.map.delete(p);
    this.map.set(p, v);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }

  /** The greatest cached position in (`after`, `p`]. */
  nearest(after: number, p: number): number {
    let best = -1;
    for (const k of this.map.keys()) if (k > after && k <= p && k > best) best = k;
    return best;
  }
}

/** A forward step: the state after the action and the events the engine returned for it. */
export interface GameStep {
  state: GameState;
  events: GameEvent[];
}

export class GameTimeline {
  /** What is known of each position indexed so far (`info[p]`, from 0 to `frontier`). */
  readonly info: PositionInfo[] = [];
  /** The last position this engine can play the log to: the log's length, less where it refuses an action. */
  end: number;
  /** The action this engine refused, if it did. */
  rejection: ReplayRejection | null = null;
  private readonly snaps = new Positions<GameState>();
  private readonly recent = new Recent<GameState>(RECENT_MAX);
  private frontierState: GameState;

  constructor(
    private readonly play: ReplayPlay,
    start: GameState,
  ) {
    this.end = play.actions.length;
    this.frontierState = start;
    this.info.push({ turn: start.turn.number, step: start.turn.step, active: start.turn.activePlayer, logSeq: newestSeq(start.log), change: 'turn', t: 0, marks: NO_MARKS });
    this.snaps.put(0, start);
  }

  get frontier(): number {
    return this.info.length - 1;
  }

  get complete(): boolean {
    return this.frontier >= this.end;
  }

  /** The action that leads into position `p` (the log's action `p - 1`). */
  actionInto(p: number): Action | undefined {
    return this.play.actions[p - 1];
  }

  /**
   * The step into position `p` from `prev`, the state at `p - 1`: the next state and the action's events, or null when this engine refuses the action
   * (the game then ends at `p - 1` on this engine).
   */
  stepInto(prev: GameState, p: number): GameStep | null {
    const action = this.play.actions[p - 1];
    if (action === undefined) return null;
    const r = replayAction(prev, action, p - 1);
    if (!r.ok) {
      this.end = Math.min(this.end, p - 1);
      this.rejection ??= r.rejection;
      return null;
    }
    return { state: r.state, events: r.events };
  }

  /** Index forward up to position `to` (default: the end), for at most `budgetMs` of work. True once the whole log is indexed. */
  extend(to = Infinity, budgetMs = Infinity): boolean {
    const until = budgetMs === Infinity ? Infinity : Date.now() + budgetMs;
    while (this.frontier < Math.min(to, this.end)) {
      const p = this.frontier + 1;
      const prev = this.frontierState;
      const step = this.stepInto(prev, p);
      if (step === null) break;
      const action = this.play.actions[p - 1]!;
      const before = this.info[p - 1]!;
      const s = step.state;
      // The markers from what the public view is shown of the change (see the file comment).
      const shown = step.events.slice(replayedEventsFor(prev, action, null));
      const marks = marksOf(eventsFor(s, shown, null, { before: prev }));
      this.info.push({
        turn: s.turn.number, step: s.turn.step, active: s.turn.activePlayer, logSeq: newestSeq(s.log), change: changeOf(before, s.turn.number, action.type === 'pass'),
        t: this.play.times[p - 1] ?? before.t, marks,
      });
      if (s.turn.number !== before.turn || p % SNAPSHOT_EVERY === 0) this.snaps.put(p, s);
      this.frontierState = s;
      if (Date.now() >= until) break;
    }
    return this.complete;
  }

  /** The state at position `p` (0 to `end`), from the nearest snapshot or recent state; null when the engine cannot reach it. */
  stateAt(p: number): GameState | null {
    if (p < 0) return null;
    if (p > this.frontier) this.extend(p);
    if (p > this.frontier) return null;
    if (p === this.frontier) return this.frontierState;
    const hit = this.recent.get(p) ?? this.snaps.get(p);
    if (hit) return hit;
    let from = this.snaps.atOrBefore(p);
    const near = this.recent.nearest(from, p);
    let s = near >= 0 ? this.recent.get(near)! : this.snaps.get(from)!;
    if (near >= 0) from = near;
    for (let q = from + 1; q <= p; q++) {
      const step = this.stepInto(s, q);
      if (step === null) return null; // cannot happen for an indexed position: the engine is deterministic
      s = step.state;
      this.recent.put(q, s);
    }
    return s;
  }

  /** Remember a state the connection reached by a forward step (the next step back or seek starts from it). */
  remember(p: number, s: GameState): void {
    this.recent.put(p, s);
  }
}

export class RecordingTimeline {
  /** What is known of each frame decoded so far (`info[f]`, from 0 to `frontier`). */
  readonly info: PositionInfo[] = [];
  /** The last frame the board can draw: the last frame, less where a frame does not fit (design 4). */
  end: number;
  /** Why the recording ends early, if it does. */
  problem: string | null = null;
  private readonly snaps = new Positions<RecordingKeyView>();
  private readonly recent = new Recent<RecordingKeyView>(RECENT_MAX);
  private frontierView: RecordingKeyView | null = null;
  private readonly ctx: RecordingViewContext;

  constructor(readonly recording: ReplayRecording) {
    this.end = recording.frames.length - 1;
    this.ctx = { viewer: recording.viewer, defs: recording.defs };
    this.extend(0);
  }

  get frontier(): number {
    return this.info.length - 1;
  }

  get complete(): boolean {
    return this.frontier >= this.end;
  }

  /** Decode forward up to frame `to` (default: the end), for at most `budgetMs` of work. True once every frame is decoded. */
  extend(to = Infinity, budgetMs = Infinity): boolean {
    const until = budgetMs === Infinity ? Infinity : Date.now() + budgetMs;
    while (this.frontier < Math.min(to, this.end)) {
      const f = this.frontier + 1;
      const frame = this.recording.frames[f]!;
      const r = recordingFrameView(this.frontierView, frame, this.ctx);
      if (!r.ok) {
        this.end = f - 1;
        this.problem = r.error.message;
        break;
      }
      const v = r.value;
      const before = this.info[f - 1] ?? null;
      const pass = frame.events.every((e) => STEP_ONLY.has(e.type));
      this.info.push({
        turn: v.turn.number, step: v.turn.step, active: v.turn.activePlayer, logSeq: newestSeq(v.log), change: changeOf(before, v.turn.number, pass),
        t: frame.t, marks: marksOf(frame.events),
      });
      if (frame.key !== undefined || f % SNAPSHOT_EVERY === 0) this.snaps.put(f, v);
      this.frontierView = v;
      if (Date.now() >= until) break;
    }
    return this.complete;
  }

  /** The view of frame `f` (0 to `end`), checked as the board reads it; null when the recording does not reach it. */
  viewAt(f: number): RecordingKeyView | null {
    if (f < 0) return null;
    if (f > this.frontier) this.extend(f);
    if (f > this.frontier) return null;
    if (f === this.frontier) return this.frontierView;
    const hit = this.recent.get(f) ?? this.snaps.get(f);
    if (hit) return hit;
    let from = this.snaps.atOrBefore(f);
    const near = this.recent.nearest(from, f);
    let v = near >= 0 ? this.recent.get(near)! : this.snaps.get(from)!;
    if (near >= 0) from = near;
    for (let q = from + 1; q <= f; q++) {
      const r = recordingFrameView(v, this.recording.frames[q]!, this.ctx);
      if (!r.ok) return null; // cannot happen for a decoded frame: the same patch on the same view
      v = r.value;
      this.recent.put(q, v);
    }
    return v;
  }

  /** The events of frame `f`, as the recording's viewer was shown them. */
  eventsOf(f: number): readonly GameEvent[] {
    return this.recording.frames[f]?.events ?? [];
  }
}
