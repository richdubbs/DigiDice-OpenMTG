/**
 * The pace of the game screen (ui/arena, MTG Arena style): a `GameConnection` that shows the inner connection's changes one at a time, each after the board
 * has animated what happened (the change's events). Everything the screen draws (board, prompt, game bar) reads this connection, so they never disagree
 * about the state on screen; actions go straight to the inner connection.
 *
 * A change is shown at once, without animation, when no animator is attached (no board on screen: the hot-seat cover, tests), when animations are off,
 * when the change brought no new events (an undo, a hand-off, a stop toggle), or when too many changes are waiting (the screen catches up instead of
 * falling behind). A change that hands a hot-seat screen to another player is animated on the spectator view (hands hidden) and then shows the cover.
 * A change with new events shown without animation is reported (`unanimated`), so the screen still gives it its sound (docs/design/sound.md).
 *
 * Acting while the board is still catching up is refused unless the decision on screen is still the one the game waits for: a click on a stale prompt must
 * never answer a newer decision the player has not seen (CR 117.3: each priority is the player's own to pass). Conceding always works (CR 104.3a); undo
 * and accepting a hand-off first skip to the latest change.
 */
import type { Action, GameView, LegalAction, PlayerId } from '@openmtg/engine';
import type { ClockView } from '@openmtg/hosted/api';
import type { ActResult, EventBatch, GameConnection } from './GameConnection';

/** What the board does with one change: animate on what is on screen, call `commit` to show the next view, animate on that, then resolve. */
export interface BoardAnimator {
  play(batch: EventBatch, from: GameView, to: GameView, commit: () => Promise<void>): Promise<void>;
  /** Cut everything short and clean up (the screen is skipping ahead); a pending `play` must settle soon after. */
  finish(): void;
}

/** The pacing side the board talks to: attach its animator, and report each view it has drawn. */
export interface BoardPacer {
  attach(animator: BoardAnimator): () => void;
  /** Call from a layout effect after drawing `view`: the animator's `commit()` resolves once the new view is on screen. */
  committed(view: GameView): void;
}

interface Snapshot {
  view: GameView;
  legal: readonly LegalAction[];
  handoff: PlayerId | null;
  canUndo: boolean;
  status: string | null;
  /** The new events that led to this view, or null. */
  batch: EventBatch | null;
}

export interface PacedOptions {
  /** Whether to animate (Settings "Animation speed" is not Off and the player does not prefer reduced motion); read at every change. Default on. */
  enabled?: () => boolean;
  /**
   * The longest one change may take before it is shown anyway (ms); read at every change (it grows with slower animation settings). The function form gets
   * the change (M11-2 stack acceleration: a change that resolves an accelerated pile gets the time to show it, board/fx/stackPace.ts).
   */
  deadlineMs?: number | ((batch: EventBatch, from: GameView, to: GameView) => number);
  /** With this many changes waiting, the screen skips their animations to catch up. */
  maxBacklog?: number;
  /** How long `commit()` waits for the board to report the new view before going on anyway (ms). */
  commitTimeoutMs?: number;
  /**
   * A change with new events was shown without animation (no board on screen, animations off, a catch-up, a flush): the screen gives it its sound instead
   * (docs/design/sound.md). Called once per screen update, with only the newest such change when several were shown at once, and never for a change the
   * animator played (or started to play); `from` is the view before that change.
   */
  unanimated?: (batch: EventBatch, from: GameView, to: GameView) => void;
}

const EMPTY_BATCH: EventBatch = { seq: 0, events: [] };

export const BUSY_MESSAGE = 'The board is still showing the last move. Try again in a moment.';

export class PacedConnection implements GameConnection, BoardPacer {
  readonly kind: GameConnection['kind'];
  readonly seated?: () => readonly PlayerId[];
  /** M13-11: a hosted game's clocks are real time, not part of the paced picture: read from the inner connection as they are. */
  readonly clocks?: () => ClockView | null;
  private shown: Snapshot;
  private readonly queue: Snapshot[] = [];
  private animator: BoardAnimator | null = null;
  /** The change being animated; its token goes stale when the screen skips ahead. */
  private running: { snap: Snapshot; token: number } | null = null;
  private token = 0;
  private lastSeq: number;
  private pendingCommit: { view: GameView; resolve: () => void } | null = null;
  private readonly listeners = new Set<() => void>();
  private unsubscribeInner: (() => void) | null = null;
  private readonly deadline: (batch: EventBatch, from: GameView, to: GameView) => number;
  private readonly maxBacklog: number;
  private readonly commitTimeoutMs: number;

  constructor(
    private readonly inner: GameConnection,
    private readonly opts: PacedOptions = {},
  ) {
    this.kind = inner.kind;
    if (inner.seated) this.seated = () => inner.seated!();
    if (inner.clocks) this.clocks = () => inner.clocks!();
    const d = opts.deadlineMs ?? 6000;
    this.deadline = typeof d === 'function' ? d : () => d;
    this.maxBacklog = opts.maxBacklog ?? 6;
    this.commitTimeoutMs = opts.commitTimeoutMs ?? 400;
    this.shown = this.take(null);
    // What happened before this screen opened is not replayed.
    this.lastSeq = inner.events?.().seq ?? 0;
  }

  private take(batch: EventBatch | null): Snapshot {
    const i = this.inner;
    return { view: i.view(), legal: i.legalActions(), handoff: i.handoff(), canUndo: i.canUndo(), status: i.status?.() ?? null, batch };
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }

  private show(s: Snapshot): void {
    this.shown = s;
    this.emit();
  }

  private readonly onInner = (): void => {
    const batch = this.inner.events?.() ?? null;
    const fresh = batch !== null && batch.seq !== this.lastSeq && batch.events.length > 0 ? batch : null;
    if (batch) this.lastSeq = batch.seq;
    this.queue.push(this.take(fresh));
    this.pump();
  };

  private shouldAnimate(s: Snapshot): boolean {
    return (
      s.batch !== null && this.animator !== null && this.shown.handoff === null && this.queue.length < this.maxBacklog && (this.opts.enabled?.() ?? true)
    );
  }

  /** Tell the screen about a change shown without animation (it gives it its sound); a listener's problem never stops the game. */
  private report(silent: { batch: EventBatch; from: GameView; to: GameView } | null): void {
    if (!silent || !this.opts.unanimated) return;
    try {
      this.opts.unanimated(silent.batch, silent.from, silent.to);
    } catch (e) {
      console.error('[PacedConnection] unanimated listener failed', e);
    }
  }

  private pump(): void {
    if (this.running) return;
    // A catch-up shows several changes at once: only the newest is reported, and none when an animation follows (that animation has the sound).
    let silent: { batch: EventBatch; from: GameView; to: GameView } | null = null;
    while (this.queue.length > 0) {
      const next = this.queue.shift()!;
      if (!this.shouldAnimate(next)) {
        if (next.batch) silent = { batch: next.batch, from: this.shown.view, to: next.view };
        this.show(next);
        continue;
      }
      const token = ++this.token;
      this.running = { snap: next, token };
      this.emit(); // busy() changed
      const from = this.shown.view;
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        if (this.running?.token !== token) return; // the screen skipped ahead meanwhile
        this.running = null;
        if (this.shown !== next) this.show(next);
        else this.emit();
        this.pump();
      };
      const deadline = setTimeout(() => {
        if (this.running?.token === token) this.animator?.finish();
        done();
      }, this.deadline(next.batch!, from, next.view));
      let played: Promise<void>;
      try {
        played = this.animator!.play(next.batch!, from, next.view, () => this.commit(next, token));
      } catch (e) {
        played = Promise.reject(e);
      }
      played.catch((e: unknown) => console.error('[PacedConnection] animation failed', e)).finally(done);
      return;
    }
    this.report(silent);
  }

  private commit(s: Snapshot, token: number): Promise<void> {
    if (this.running?.token !== token || this.shown === s) return Promise.resolve();
    this.pendingCommit?.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(finish, this.commitTimeoutMs);
      function finish() {
        clearTimeout(timer);
        resolve();
      }
      this.pendingCommit = { view: s.view, resolve: finish };
      // A change that hands a hot-seat screen to the next player plays out first on its view (the spectator view, which hides every hand, CR 400.2);
      // the pass cover comes when the animation ends (done() shows the real snapshot).
      this.show(s.handoff === null ? s : { ...s, handoff: null, legal: [], canUndo: false });
    });
  }

  // ---- BoardPacer ----------------------------------------------------------------------------------------------------------------

  readonly attach = (animator: BoardAnimator): (() => void) => {
    this.animator = animator;
    return () => {
      if (this.animator !== animator) return;
      this.flush();
      this.animator = null;
    };
  };

  readonly committed = (view: GameView): void => {
    const p = this.pendingCommit;
    if (p && p.view === view) {
      this.pendingCommit = null;
      p.resolve();
    }
  };

  /** True while a change is being animated or waiting to be shown. */
  readonly busy = (): boolean => this.running !== null || this.queue.length > 0;

  /** True while the screen still shows an older state than the game's (the first half of an animation, or changes waiting): the prompt is stale. */
  readonly stale = (): boolean => this.queue.length > 0 || (this.running !== null && this.shown !== this.running.snap);

  /** Show the latest change now, cutting any animation short. */
  readonly flush = (): void => {
    if (!this.busy()) return;
    const queued = this.queue.length > 0;
    const latest = queued ? this.queue[this.queue.length - 1]! : this.running!.snap;
    // The view just before the newest change (its events are about that one).
    const from = this.queue.length > 1 ? this.queue[this.queue.length - 2]!.view : (this.running?.snap.view ?? this.shown.view);
    this.queue.length = 0;
    this.token++;
    this.running = null;
    this.animator?.finish();
    const p = this.pendingCommit;
    this.pendingCommit = null;
    p?.resolve();
    this.show(latest);
    // The change being animated already made its sounds; a waiting one that is skipped to gets its own.
    if (queued && latest.batch) this.report({ batch: latest.batch, from, to: latest.view });
  };

  // ---- GameConnection ------------------------------------------------------------------------------------------------------------

  readonly view = (): GameView => this.shown.view;
  readonly legalActions = (): readonly LegalAction[] => this.shown.legal;
  readonly handoff = (): PlayerId | null => this.shown.handoff;
  readonly canUndo = (): boolean => this.shown.canUndo && !this.busy();
  readonly status = (): string | null => this.shown.status;
  readonly events = (): EventBatch => this.shown.batch ?? EMPTY_BATCH;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (!this.unsubscribeInner) {
      this.unsubscribeInner = this.inner.subscribe(this.onInner);
      // Changes made while nobody watched are shown as they are now.
      if (!this.busy() && this.inner.view() !== this.shown.view) {
        this.lastSeq = this.inner.events?.().seq ?? this.lastSeq;
        this.shown = this.take(null);
      }
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.unsubscribeInner) {
        this.unsubscribeInner();
        this.unsubscribeInner = null;
        this.flush();
      }
    };
  };

  /** The decision on screen is the one the game waits for now (same id, same player). */
  private onCurrentDecision(): boolean {
    const shown = this.shown.view.pending;
    const real = this.inner.view().pending;
    return shown !== null && real !== null && shown.id === real.id && shown.player === real.player && this.inner.handoff() === this.shown.handoff;
  }

  readonly act = async (action: Action): Promise<ActResult> => {
    if (action.type !== 'concede' && this.stale() && !this.onCurrentDecision()) return { ok: false, error: { message: BUSY_MESSAGE, rules: [] } };
    return this.inner.act(action);
  };

  readonly undo = (): boolean => {
    this.flush();
    return this.inner.undo();
  };

  readonly acceptHandoff = (): void => {
    this.flush();
    this.inner.acceptHandoff();
  };
}
