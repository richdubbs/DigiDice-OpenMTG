/**
 * Playing against the computer (milestone 10's AI, packages/ai). The computer is a player away from the screen: it acts through its own
 * `GameConnection` seat (LocalConnection.seat), whose view is its player's `viewFor` (CR 400.2: it never sees the human's hand or any library), and it
 * answers each of its decisions with `chooseAction` on that view after a short delay, so the human sees its moves one at a time. The screen keeps the
 * human's view the whole game (no pass cover); the human's connection is the one the game screen renders, exactly as in hot-seat.
 *
 * Pace (review 2026-10-26 F8): the game screen shows each change after the board has animated it (the client's connection/PacedConnection.ts). The
 * computer acts through its own seat, not through that screen, so it first waits until the board has shown every change (`attachPacer`, the screen's
 * `busy()`), then pauses like a person would (`delayMs`); acting on a timer alone let the screen fall behind, skip animations and cut long ones short. A
 * board that stays busy longer than `maxBoardWaitMs` (a stuck or very long animation) never holds the computer up for good: it acts anyway.
 *
 * Godot plan phase 1: moved here from packages/client/src/game/computer.ts, without React or the DOM, so the local server's table channel
 * (packages/server/src/table) runs the same games. The client's game/computer.ts re-exports it and registers each game for its screen's pace.
 */
import { AI_STOPS, chooseAction } from '@openmtg/ai';
import { GameSession, decidingPlayer, type Action, type Decision, type DecisionAnswer, type GameConfig, type GameView, type PlayerId, type TargetChoice } from '@openmtg/engine';
import type { ComputerPacer, PacedComputers } from './computerPacer';
import type { ActResult, GameConnection } from './GameConnection';
import { LocalConnection, type LocalConnectionOptions } from './LocalConnection';
import { stackPace } from './stackPace';

/** The animation speeds of the client's Settings (its `AnimationSpeed`). */
export type ComputerSpeed = 'off' | 'fast' | 'normal' | 'slow';

/** The pause before each computer action at an animation speed (Settings): long enough to see each move, never zero. */
export function computerDelayMs(speed: ComputerSpeed): number {
  return { off: 250, fast: 450, normal: 750, slow: 1200 }[speed];
}

/** The longest the computer waits for the board to finish showing changes before it acts anyway (ms). */
export const COMPUTER_MAX_BOARD_WAIT_MS = 8000;

export type Chooser = (view: GameView, decision: Decision, seed: string) => Action;

export interface ComputerOptions {
  /**
   * Pause before each of the computer's actions (ms), so its moves are visible. With a `pacer` it starts once the board is idle, and is the same on any
   * stack (the board already paces a big pile, board/fx/stackPace.ts). Without one (no board: tests) it is shortened on a stack of more than 5 objects
   * (stack acceleration): the computer passing on a big pile of triggers is then the pause before the next resolution.
   */
  delayMs: number;
  /** The game screen's pace: the computer waits while it is busy (at most `maxBoardWaitMs`). None: it acts on the delay alone. */
  pacer?: ComputerPacer;
  /** The longest wait for a busy board before acting anyway (ms; default COMPUTER_MAX_BOARD_WAIT_MS). */
  maxBoardWaitMs?: number;
  /** Seed for the AI's choices between equally good plays (with the decision id, so a replay plays the same). */
  seed: string;
  /** The AI (default packages/ai `chooseAction`); tests pass their own. */
  choose?: Chooser;
  /**
   * Called with a message when the computer gives up on a decision (its AI failed twice and no fallback answer was accepted), and with
   * null when the game moves on to another decision. The screen shows the message, so the human is never left "waiting" forever.
   */
  onStuck?: (message: string | null) => void;
}

/** The decision the seat's player must make now, or null. */
function dueDecision(view: GameView): Decision | null {
  const d = view.pending;
  return !view.result && d && view.viewer !== null && decidingPlayer(d) === view.viewer ? d : null; // std-control-3: a player this seat controls too (CR 723.5)
}

/**
 * An answer that is always legal when the AI's own answer was rejected: pass priority (CR 117.3d), cancel (CR 733.1), or for the declaration of blockers
 * (never cancellable) the engine's own example that obeys the requirements (CR 509.1c), or no blocks when none is enforced (CR 509.1, 509.1b: blocking
 * nothing breaks no restriction); null when there is none. Exported for tests.
 */
export function fallback(d: Decision): Action | null {
  return fallbacks(d)[0] ?? null;
}

/**
 * Every fallback answer for `d`, most cautious first; the computer tries them in order until the engine accepts one, so a decision its AI can't answer
 * never stops the game (owner 2026-10-21): choose nothing where nothing may be chosen ("up to one target", CR 115.1, 601.2c), else the first legal
 * choices; keep the hand; resolve a manual text with no adjustments (the computer passes the trigger rather than halting). Exported for tests.
 */
export function fallbacks(d: Decision): Action[] {
  if (d.kind === 'priority') return [{ type: 'pass', player: d.player }];
  const out: Action[] = [];
  const answer = (a: DecisionAnswer) => out.push({ type: 'answer', player: d.player, decisionId: d.id, answer: a });
  if (d.cancellable) out.push({ type: 'cancel', player: d.player });
  switch (d.kind) {
    case 'declareBlockers':
      answer({ kind: 'declareBlockers', blocks: d.mustObey !== undefined && d.obeying ? d.obeying : [] });
      if (d.mustObey !== undefined && d.obeying) answer({ kind: 'declareBlockers', blocks: [] });
      break;
    case 'declareAttackers':
      answer({ kind: 'declareAttackers', attacks: [] });
      break;
    case 'chooseTargets': {
      const all: TargetChoice[] = [...d.objects.map((id) => ({ kind: 'object' as const, id })), ...d.players.map((id) => ({ kind: 'player' as const, id }))];
      if (d.min === 0) answer({ kind: 'chooseTargets', targets: [] });
      else if (all.length >= d.min) {
        answer({ kind: 'chooseTargets', targets: all.slice(0, d.min) });
        answer({ kind: 'chooseTargets', targets: all.slice(-d.min) });
      }
      break;
    }
    case 'chooseObjects':
      if (d.min === 0) answer({ kind: 'chooseObjects', ids: [] });
      else if (d.options.length >= d.min) answer({ kind: 'chooseObjects', ids: d.options.slice(0, d.min) });
      break;
    case 'chooseOption': {
      const usable = d.options.filter((o) => o.disabled === undefined).map((o) => o.id);
      if (d.min === 0) answer({ kind: 'chooseOption', ids: [] });
      else if (usable.length >= d.min) answer({ kind: 'chooseOption', ids: usable.slice(0, d.min) });
      else if (d.allowRepeat && usable.length > 0) answer({ kind: 'chooseOption', ids: Array<string>(d.min).fill(usable[0]!) });
      break;
    }
    case 'chooseNumber':
      answer({ kind: 'chooseNumber', n: d.min });
      break;
    case 'chooseColor':
      if (d.options[0]) answer({ kind: 'chooseColor', color: d.options[0] });
      break;
    case 'yesNo':
      answer({ kind: 'yesNo', yes: false });
      answer({ kind: 'yesNo', yes: true });
      break;
    case 'order':
      answer({ kind: 'order', ids: d.items.map((i) => i.id) });
      break;
    case 'chooseReplacement':
      for (const o of d.options) answer({ kind: 'chooseReplacement', id: o.id });
      break;
    case 'manualResolve':
      answer({ kind: 'manualResolve', ops: [] });
      break;
    case 'payCost':
      answer({ kind: 'payCost', auto: true });
      break;
    case 'mulligan':
      answer({ kind: 'mulligan', keep: true });
      break;
    case 'playFirst':
      answer({ kind: 'playFirst', player: d.player });
      break;
    case 'commanderZone':
      answer({ kind: 'commanderZone', command: true });
      answer({ kind: 'commanderZone', command: false });
      break;
    default:
      break;
  }
  return out;
}

/**
 * Let the computer answer every decision of `seat`'s player, one action per `delayMs` (after the board is idle, with a `pacer`). Returns the function
 * that stops it. The computer reads only `seat.view()` (its own player's view) and acts only through `seat.act`.
 */
export function runComputer(seat: GameConnection, opts: ComputerOptions): () => void {
  const choose = opts.choose ?? chooseAction;
  const pacer = opts.pacer;
  const maxWait = opts.maxBoardWaitMs ?? COMPUTER_MAX_BOARD_WAIT_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** While waiting for a busy board: the timer that ends the wait anyway. */
  let waitTimer: ReturnType<typeof setTimeout> | null = null;
  /** The board stayed busy too long: the next action no longer waits for it. */
  let waitedOut = false;
  let stopped = false;
  let acting = false;
  /** Consecutive failed attempts at one decision (the AI is deterministic: a third try would fail the same way). */
  let failed: { id: string; count: number } | null = null;
  /** The decision the computer gave up on; it waits until the game moves on (the human concedes or leaves). */
  let stuckOn: string | null = null;

  /** The board is still showing earlier changes, and the computer has not waited too long for it already. */
  const boardBusy = () => pacer !== undefined && !waitedOut && pacer.busy();

  const quitWaiting = () => {
    if (waitTimer !== null) clearTimeout(waitTimer);
    waitTimer = null;
    waitedOut = false;
  };

  const step = async () => {
    const view = seat.view();
    const d = dueDecision(view);
    if (stopped || !d) return;
    // The board started showing a change during the pause: wait for it again, then pause again.
    if (boardBusy()) {
      schedule();
      return;
    }
    quitWaiting();
    acting = true;
    let ok = false;
    try {
      let action: Action | null;
      try {
        action = choose(view, d, `${opts.seed}:${d.id}`);
      } catch (e) {
        console.error('[Computer] the AI could not choose', d, e);
        action = fallback(d);
      }
      let r: ActResult | null = action ? await seat.act(action) : null;
      if (r && !r.ok) console.error('[Computer] action rejected', action, r.error);
      // The fallbacks in turn until one is accepted (the one the catch above already sent is tried again only if nothing else works).
      for (const fb of r?.ok ? [] : fallbacks(d)) {
        if (stopped || seat.view().pending?.id !== d.id) break;
        r = await seat.act(fb);
        if (r.ok) break;
        console.error('[Computer] fallback rejected', fb, r.error);
      }
      ok = r !== null && r.ok;
    } finally {
      acting = false;
    }
    if (ok) failed = null;
    else {
      failed = failed?.id === d.id ? { id: d.id, count: failed.count + 1 } : { id: d.id, count: 1 };
      if (failed.count >= 2) {
        stuckOn = d.id;
        opts.onStuck?.(`${view.players.find((p) => p.id === d.player)?.name ?? 'The computer'} could not decide: ${d.prompt} You can concede or leave the game.`);
      }
    }
    schedule();
  };

  function schedule() {
    const d = stopped ? null : dueDecision(seat.view());
    if (stuckOn !== null && d?.id !== stuckOn) {
      stuckOn = null;
      opts.onStuck?.(null);
    }
    if (stopped || !d || d.id === stuckOn) {
      quitWaiting();
      return;
    }
    if (timer !== null || acting) return;
    if (boardBusy()) {
      waitTimer ??= setTimeout(() => {
        waitTimer = null;
        console.debug(`[Computer] the board was busy for ${maxWait} ms; acting anyway`);
        waitedOut = true;
        schedule();
      }, maxWait);
      return;
    }
    if (waitTimer !== null) clearTimeout(waitTimer);
    waitTimer = null;
    timer = setTimeout(
      () => {
        timer = null;
        void step();
      },
      pacer ? opts.delayMs : Math.round(opts.delayMs * stackPace(seat.view().zones.stack.length)),
    );
  }

  const unsubscribe = seat.subscribe(schedule);
  const unsubscribePacer = pacer?.subscribe(schedule);
  schedule();
  return () => {
    stopped = true;
    unsubscribe();
    unsubscribePacer?.();
    if (timer !== null) clearTimeout(timer);
    timer = null;
    quitWaiting();
  };
}

const asList = (p: PlayerId | readonly PlayerId[]): readonly PlayerId[] => (typeof p === 'string' ? [p] : p);

/**
 * The config for a game against the computer: each computer player (one, or M12-4b several) gets the AI's stops (AI_STOPS), so auto-pass never skips its
 * instant windows.
 */
export function withComputerStops(config: GameConfig, computers: PlayerId | readonly PlayerId[]): GameConfig {
  const ids = asList(computers);
  return {
    ...config,
    players: config.players.map((p) => (p.id !== undefined && ids.includes(p.id) ? { ...p, stops: { ...AI_STOPS, ownTurn: [...AI_STOPS.ownTurn], opponentTurn: [...AI_STOPS.opponentTurn] } } : p)),
  };
}

/**
 * A game against the computer, as the game screen's connection: the human seats of a LocalConnection. The computer plays while the screen is subscribed
 * (from the first subscriber to the last), so leaving the game, or a rematch replacing it, stops the computer.
 *
 * M12-4b (m12 design 5.3 items 4-5): any mix of people and computers. `humans` are the people at this screen (one: the screen always shows that player;
 * several: hot-seat hand-offs between them, LocalConnection); each of `computers` plays through its own seat (its own player's `viewFor`, CR 400.2), one
 * action at a time with the delay, so three computers act one after another. A computer that left the game simply has nothing more to decide.
 */
export class ComputerGame implements GameConnection, PacedComputers {
  readonly kind = 'local' as const;
  readonly local: LocalConnection;
  readonly humans: readonly PlayerId[];
  readonly computers: readonly PlayerId[];
  private stops: (() => void)[] = [];
  private subscribers = 0;
  /** The game screen's pace (attachPacer), or null with no board. */
  private pacer: ComputerPacer | null = null;
  /** Why each computer stopped playing (it could not decide), by player. */
  private readonly stuck = new Map<PlayerId, string>();
  private readonly listeners = new Set<() => void>();

  /** `source`: a new game's config, or a restored game (GameSession.fromJSON of a saved game, whose config already has the computers' stops). */
  constructor(source: GameConfig | GameSession, humans: PlayerId | readonly PlayerId[], computers: PlayerId | readonly PlayerId[], private readonly opts: ComputerOptions) {
    this.humans = [...asList(humans)];
    this.computers = [...asList(computers)];
    if (this.computers.length === 0) throw new Error('ComputerGame: no computer player');
    if (this.computers.some((c) => this.humans.includes(c))) throw new Error('ComputerGame: a player is both a person and a computer');
    this.local = this.makeLocal(source instanceof GameSession ? source : withComputerStops(source, this.computers), { seats: this.humans });
  }

  /**
   * Makes the human seats' LocalConnection (called once, from the constructor). The client's subclass makes it through its own module path, so its tests
   * can watch the connections a screen makes.
   */
  protected makeLocal(source: GameConfig | GameSession, opts: LocalConnectionOptions): LocalConnection {
    return new LocalConnection(source, opts);
  }

  /**
   * F8: the computers wait while `pacer` (the game screen's PacedConnection) is busy before each action. Returns the function that detaches it. The
   * computers that are playing start again with it (their pending pause starts over).
   */
  attachPacer(pacer: ComputerPacer): () => void {
    this.pacer = pacer;
    this.restart();
    return () => {
      if (this.pacer !== pacer) return;
      this.pacer = null;
      this.restart();
    };
  }

  private start(): void {
    const pacer = this.pacer ?? this.opts.pacer;
    this.stops = this.computers.map((c) =>
      runComputer(this.local.seat(c), { ...this.opts, ...(pacer ? { pacer } : {}), onStuck: (m) => this.onStuck(c, m) }),
    );
  }

  private stop(): void {
    for (const stop of this.stops) stop();
    this.stops = [];
  }

  private restart(): void {
    if (this.subscribers === 0) return;
    this.stop();
    // A computer that had given up tries again from the start (it says so again if it still cannot decide).
    for (const c of [...this.stuck.keys()]) this.onStuck(c, null);
    this.start();
  }

  /** The first (in a one-computer game: the) human and computer player, as before milestone 12. */
  get human(): PlayerId {
    return this.humans[0]!;
  }
  get computer(): PlayerId {
    return this.computers[0]!;
  }

  readonly view = () => this.local.view();
  readonly legalActions = () => this.local.legalActions();
  readonly act = (a: Action) => this.local.act(a);
  readonly canUndo = () => this.local.canUndo();
  readonly undo = () => this.local.undo();
  readonly handoff = () => this.local.handoff();
  readonly acceptHandoff = () => this.local.acceptHandoff();
  readonly seated = () => this.local.seated();
  /** ui/arena: the human seat's event feed (the computer's moves included, redacted for the human, CR 400.2), for the board's animations. */
  readonly events = () => this.local.events();
  /** Why a computer stopped playing (it could not decide), or null while they all play normally. */
  readonly status = (): string | null => [...this.stuck.values()][0] ?? null;

  private onStuck(player: PlayerId, message: string | null): void {
    if (message === null) this.stuck.delete(player);
    else this.stuck.set(player, message);
    this.opts.onStuck?.(message);
    for (const l of [...this.listeners]) l();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    const off = this.local.subscribe(listener);
    this.listeners.add(listener);
    if (this.subscribers++ === 0) this.start();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      off();
      this.listeners.delete(listener);
      if (--this.subscribers === 0) this.stop();
    };
  };
}
