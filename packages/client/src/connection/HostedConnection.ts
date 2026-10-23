/**
 * A game on the DigiDice server as a `GameConnection` (milestone 13, docs/design/m13-hosted-server.md 12): the screen gets exactly what the hosted server
 * sends this seat (hosted/HostedLink.ts): this player's `viewFor` only (CR 400.2), the change's events redacted for this player (the same feed as
 * LocalConnection's `events()`, so the board animates hosted moves too), this player's legal priority actions (CR 117.1) and the clocks. Actions go to
 * the server, which checks every one against the player's legal actions and lets its own engine decide (CR 733: an illegal action changes nothing); the
 * reply comes after the view the action caused.
 *
 * No undo (the game is the server's: nobody takes a move back, as in every online game) and no hand-off: one player sits at this screen. The server
 * holds the full state, never this page: the limitation milestone 9 names ("a dishonest host could inspect it") does not exist here.
 *
 * `status()` says what the screen must show about this side and the server: the link to the server is down (the game waits for this player only when
 * they must decide, and an away time runs), the server closed the game, a server restart is coming, and in a two-player game the other player's link
 * dropped. In a 3-4 player game each player's presence is the panel's (hosted/game/HostedGamePanel.tsx), as milestone 12 does it for online pods.
 */
import type { Action, GameView, LegalAction, PlayerId } from '@openmtg/engine';
import type { ClockView, SeatNumber } from '@openmtg/hosted/api';
import { explainHostedError } from '../hosted/errors';
import type { HostedLink } from '../hosted/HostedLink';
import type { ActResult, EventBatch, GameConnection } from './GameConnection';

const NO_LEGAL: readonly LegalAction[] = Object.freeze([]);

export class HostedConnection implements GameConnection {
  readonly kind = 'remote' as const;
  private shown: NonNullable<ReturnType<HostedLink['view']>>;
  private batch: EventBatch;
  private me: PlayerId;
  private clock: ClockView | null;
  private statusText: string | null = null;
  private readonly listeners = new Set<() => void>();

  /** `link` must have a view already (the hosted screens open the game once the first view arrived). */
  constructor(readonly link: HostedLink) {
    const v = link.view();
    if (!v) throw new Error('HostedConnection: the game has no view yet.');
    const me = link.me() ?? v.view.viewer;
    if (!me) throw new Error('HostedConnection: the game does not say which player sits here.');
    this.shown = v;
    this.me = me;
    this.batch = { seq: v.seq, events: v.events };
    this.clock = link.clocks();
    this.statusText = this.describe();
    // Always listening (not only while the screen subscribes), so `view()` is never behind the link; the link lives as long as this connection.
    link.subscribe(this.onLink);
  }

  private readonly onLink = (): void => {
    let changed = false;
    const v = this.link.view();
    if (v && v !== this.shown) {
      // The events of a change are shown once: a full view of the same `seq` (a new socket) keeps the batch it already had.
      if (v.seq !== this.shown.seq) this.batch = { seq: v.seq, events: v.events };
      this.shown = v;
      changed = true;
    }
    const me = this.link.me();
    if (me && me !== this.me) this.me = me;
    const c = this.link.clocks();
    if (c !== this.clock) {
      this.clock = c;
      changed = true;
    }
    const s = this.describe();
    if (s !== this.statusText) {
      this.statusText = s;
      changed = true;
    }
    if (changed) for (const l of [...this.listeners]) l();
  };

  readonly view = (): GameView => this.shown.view;

  readonly legalActions = (): readonly LegalAction[] => (this.shown.view.result ? NO_LEGAL : this.shown.legal);

  /** The events the server sent with the view on screen (already redacted for this player). */
  readonly events = (): EventBatch => this.batch;

  /** The clocks as last sent (hosted/clocks.ts counts them down). */
  readonly clocks = (): ClockView | null => this.clock;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Never throws: a refused action, a dropped link or a server failure comes back as a rejection with its explanation. */
  readonly act = async (action: Action): Promise<ActResult> => {
    if (action.type === 'startGame') return { ok: false, error: { message: 'The game has already started.', rules: [] } };
    if (action.player !== this.me) return { ok: false, error: { message: 'Only your own player acts on this screen.', rules: [] } };
    try {
      const r = await this.link.act(action);
      if (r.ok) return { ok: true };
      const e = explainHostedError(r.error);
      return { ok: false, error: { message: e.hint ? `${e.message} ${e.hint}` : e.message, rules: r.error.rules ?? [] } };
    } catch (e) {
      return { ok: false, error: { message: `The action could not be sent: ${e instanceof Error ? e.message : String(e)}`, rules: [] } };
    }
  };

  readonly canUndo = (): boolean => false;
  readonly undo = (): boolean => false;
  readonly handoff = (): PlayerId | null => null;
  readonly acceptHandoff = (): void => undefined;
  /** Only this player sits here (CR 104.3a: they may concede for themselves). */
  readonly seated = (): readonly PlayerId[] => [this.me];
  readonly status = (): string | null => this.statusText;

  /** What the screen must say about the link and the server right now, or null. */
  private describe(): string | null {
    const link = this.link;
    const state = link.linkState();
    const over = this.shown.view.result !== null;
    if (state === 'lost') {
      return over
        ? 'Lost the connection to the game server; trying again…'
        : 'Lost the connection to the game server; trying again… The game waits for you only when you must decide, and your away time is running: come back before it runs out, or the game is lost.';
    }
    if (state === 'closed') {
      const problem = link.linkProblem();
      // A link this page closed itself (leaving) has no problem to show.
      return problem ? `${problem} Leave to go back.` : null;
    }
    const result = link.result();
    if (result?.outcome === 'void') return `The game ended without a result: ${result.reason.replace(/[.\s]+$/, '')}. Leave to go back.`;
    if (over) return null;
    const draining = [...link.notices()].reverse().find((n) => n.kind === 'serverDraining' || n.kind === 'degraded' || n.kind === 'limitWarning');
    if (draining) return draining.text;
    const clocks = link.clocks();
    if (clocks?.abandonMs !== undefined) return 'Nobody in the game is connected. The game ends without a result unless someone comes back.';
    // A two-player game: the other player's link (a 3-4 player game's presence is the panel's).
    const table = link.table();
    const seats = table?.seats.length ?? this.shown.view.players.length;
    if (seats === 2) {
      const mine = link.seat();
      const other = ([1, 2] as SeatNumber[]).find((s) => s !== mine);
      const away = other !== undefined ? link.away().get(other) : undefined;
      if (away === 'dropped' && other !== undefined) {
        return `${link.nameOfSeat(other) ?? 'The other player'} lost the connection. The game waits for them only when they must decide; if they stay away too long they lose.`;
      }
    }
    return null;
  }
}
