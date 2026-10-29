/**
 * Review 2026-10-26 F1: the game worker's logic (connection/game.worker.ts is only its message pump, so the tests run this in their own thread). It owns
 * the game: a hot-seat `LocalConnection` or a `ComputerGame` (engine and AI), and posts the page what a screen reads of it, exactly as LocalConnection
 * gives it: the shown player's view, legal actions and redacted events (CR 400.2), never a `GameState`. The protocol is gameWorkerProtocol.ts.
 *
 * Measured on the page before this (per computer move, mean/p95): applyAction 10/37 ms, viewFor 1/2.5 ms twice, legalActions 2/5 ms, chooseAction
 * 2/7 ms; a third of the moves took longer than a 60 fps frame. Here they cost the page nothing: it only takes each change (structured clone, or a view
 * patch, core/view-patch.ts, applied to the last view so unchanged parts keep their identity).
 *
 * The computers' pace (F8, game/computer.ts): the page's game screen reports each change it has shown (`shown { seq }`); the worker's pacer is busy
 * while the last change posted has not been shown. `runComputer`'s cap (COMPUTER_MAX_BOARD_WAIT_MS) still applies, so a page that stops reporting never
 * stops the computers for good.
 */
import { GameSession, type GameView, type LegalAction } from '@openmtg/engine';
import { viewDelta } from '@openmtg/play/viewDelta';
import { ComputerGame, type Chooser, type ComputerPacer } from '../game/computer';
import { recordEndOf, recordStepOf, recordStepsOf, type RecordedStep } from '../replays/recordSource';
import type { EventBatch, GameConnection } from './GameConnection';
import { LocalConnection } from './LocalConnection';
import type { ChangeMessage, FromWorker, GameSpec, LogChange, ToWorker } from './gameWorkerProtocol';

/** A view patch of more operations than this is sent as the whole view (a new turn's big changes; cheaper to clone than to patch). */
export { MAX_PATCH_OPS } from '@openmtg/play/viewDelta';

export interface GameHostOptions {
  /** The computers' AI (default packages/ai `chooseAction`); tests running the host in their own thread pass their own. */
  choose?: Chooser;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class GameHost {
  private game: GameConnection | null = null;
  private local: LocalConnection | null = null;
  private computer: ComputerGame | null = null;
  /** The last change posted. */
  private seq = 0;
  /** What the page holds (by identity): only what changed is posted again. */
  private sentView: GameView | null = null;
  private sentLegal: readonly LegalAction[] | null = null;
  private sentEvents: EventBatch | null = null;
  /** Post everything whole with the next change (the first one, and after `sync`). */
  private whole = true;
  /** Log changes since the last change posted, and the last step (its checkpoint is the end's when it has one). */
  private log: LogChange[] = [];
  private lastStep: RecordedStep | null = null;
  private offChanges: (() => void) | null = null;
  private watched = false;
  /** The last change the page's board has shown (`shown`). */
  private shownSeq = -1;
  private readonly pacerListeners = new Set<() => void>();
  private detachPacer: (() => void) | null = null;
  /** The pace the computers wait for: busy while the page has not shown the last change posted. */
  private readonly pacer: ComputerPacer = {
    busy: () => this.shownSeq < this.seq,
    subscribe: (listener) => {
      this.pacerListeners.add(listener);
      return () => {
        this.pacerListeners.delete(listener);
      };
    },
  };

  constructor(
    private readonly send: (message: FromWorker) => void,
    private readonly opts: GameHostOptions = {},
  ) {}

  /** Handle one message from the page. Never throws: a problem is posted as `error`. */
  receive(m: ToWorker): void {
    try {
      this.handle(m);
    } catch (e) {
      console.error('[GameHost] message failed', m.t, e);
      this.send({ t: 'error', message: messageOf(e) });
    }
  }

  private handle(m: ToWorker): void {
    if (m.t === 'start' || m.t === 'restore') {
      if (this.game) throw new Error('The game has already started.');
      this.open(m.game, m.t === 'start' ? m.config : GameSession.fromJSON(m.saved));
      return;
    }
    const game = this.game;
    const local = this.local;
    if (!game || !local) throw new Error('No game is running.');
    switch (m.t) {
      case 'act':
        // LocalConnection.act never rejects; the change it made is posted (by the listener) before this reply.
        void game.act(m.action).then((result) => this.send({ t: 'reply', id: m.id, result }));
        return;
      case 'undo': {
        const ok = game.undo();
        this.send({ t: 'undone', id: m.id, ok, length: local.session.actions.length });
        return;
      }
      case 'acceptHandoff':
        game.acceptHandoff();
        return;
      case 'watch':
        this.watch(m.on);
        return;
      case 'pacer':
        this.detachPacer?.();
        this.detachPacer = null;
        if (m.on && this.computer) this.detachPacer = this.computer.attachPacer(this.pacer);
        return;
      case 'shown':
        if (m.seq <= this.shownSeq) return;
        this.shownSeq = m.seq;
        for (const l of [...this.pacerListeners]) l();
        return;
      case 'sync':
        this.whole = true;
        this.post();
        return;
      case 'save':
        this.send({ t: 'saved', id: m.id, game: local.save() });
        return;
    }
  }

  private open(spec: GameSpec, source: GameSession | GameSession['config']): void {
    if (spec.kind === 'hotseat') {
      this.local = new LocalConnection(source, spec.seats ? { seats: spec.seats } : {});
      this.game = this.local;
    } else {
      this.computer = new ComputerGame(source, spec.humans, spec.computers, {
        delayMs: spec.delayMs,
        seed: spec.seed,
        ...(spec.maxBoardWaitMs !== undefined ? { maxBoardWaitMs: spec.maxBoardWaitMs } : {}),
        ...(this.opts.choose ? { choose: this.opts.choose } : {}),
      });
      this.local = this.computer.local;
      this.game = this.computer;
    }
    const local = this.local;
    // A restored game's log so far, for the recorder (its checkpoints, run once from the config).
    for (const step of recordStepsOf(local.session.config, local.session.actions)) this.applied(step);
    local.observeLog({
      applied: (action, index, before, after) => this.applied(recordStepOf(action, index, before, after)),
      undone: (length) => {
        this.log.push({ kind: 'undone', length });
        if (this.lastStep && this.lastStep.index >= length) this.lastStep = null;
      },
    });
    // Registered before the computers' own listeners (ComputerGame starts them after its first subscriber), so a change is posted (and the pacer is
    // busy) before a computer looks at it.
    this.offChanges = local.subscribe(this.post);
    this.post();
  }

  private applied(step: RecordedStep): void {
    this.log.push({ kind: 'applied', step });
    this.lastStep = step;
  }

  /** The computers play while a screen watches (ComputerGame's rule: from its first subscriber to its last). */
  private watch(on: boolean): void {
    if (on === this.watched || !this.local) return;
    this.watched = on;
    if (!this.computer) return;
    this.offChanges?.();
    this.offChanges = on ? this.computer.subscribe(this.post) : this.local.subscribe(this.post);
  }

  /** Post the change: what the page's screen reads now, with only what changed since the last change. */
  private readonly post = (): void => {
    const game = this.game!;
    const local = this.local!;
    const whole = this.whole;
    this.whole = false;
    const msg: ChangeMessage = {
      t: 'change',
      seq: ++this.seq,
      handoff: game.handoff(),
      canUndo: game.canUndo(),
      status: game.status?.() ?? null,
      seated: game.seated?.() ?? [],
    };
    // The view whole or as a patch of the last one posted (@openmtg/play viewDelta, shared with the local server's table channel).
    const view = game.view();
    const delta = viewDelta(this.sentView, view, { whole });
    if (delta.kind === 'whole') msg.view = view;
    else if (delta.kind === 'patch' && delta.ops.length > 0) msg.patch = delta.ops;
    this.sentView = view;
    const legal = game.legalActions();
    if (whole || legal !== this.sentLegal) msg.legal = this.sentLegal = legal;
    const events = game.events?.() ?? null;
    if (events && (whole || events !== this.sentEvents)) msg.events = this.sentEvents = events;
    if (this.log.length > 0) {
      msg.log = this.log;
      this.log = [];
      const n = local.session.actions.length;
      msg.end = n === 0 ? null : recordEndOf(local.session.state, n, this.lastStep);
    }
    this.send(msg);
  };

  /** Stop the game (the worker is about to close). */
  dispose(): void {
    this.detachPacer?.();
    this.offChanges?.();
    this.offChanges = null;
  }
}
