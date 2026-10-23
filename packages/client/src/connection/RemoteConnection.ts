/**
 * Online connection (milestone 9, docs/design/online.md; docs/design/m8-client.md "Data flow"): a `GameConnection` over the localhost WebSocket to this
 * player's own OpenMTG server (online/OnlineLink.ts), which plays the game over UDP as the host (the authoritative engine) or the guest. The screen gets
 * exactly what the server sends: this player's `viewFor` only (CR 400.2), the change's events redacted for this player (the same feed as
 * LocalConnection's `events()`, so the board animates online moves too) and this player's legal priority actions (CR 117.1). Actions go to the server,
 * which checks them and lets the host's engine decide (CR 733: an illegal action changes nothing); the reply comes after the view the action caused.
 *
 * No undo online (both players would have to agree; docs/design/online.md "Game setup online") and no hand-off: one player sits at this screen.
 * `status()` says what the screen must show about the link: the other side dropped or left, the guest reconnecting, the game closed, the local server lost.
 *
 * M12-5b (m12 design 6): a 3-4 player game. This player is the status's `me` (the host p1; a guest the player of its seat, p2-p4), never a default seat.
 * The other players' presence (links, drop clocks, who left) is the online panel's (OnlineGamePanel), from the status's `players`; `status()` says only
 * what concerns this side: the link to the host is down, the game is closed, or this host left the game and its server keeps running it (`spectating`).
 */
import type { Action, GameView, LegalAction, PlayerId } from '@openmtg/engine';
import type { OnlineLink, ViewMessage } from '../online/OnlineLink';
import { explainOnlineError } from '../online/errors';
import type { ActResult, EventBatch, GameConnection } from './GameConnection';

const NO_LEGAL: readonly LegalAction[] = Object.freeze([]);

export class RemoteConnection implements GameConnection {
  readonly kind = 'remote' as const;
  private shown: ViewMessage;
  private batch: EventBatch;
  private me: PlayerId;
  private readonly listeners = new Set<() => void>();
  private statusText: string | null = null;

  /** `link` must have a view already (the Host and Join screens open the game once the first view arrived). */
  constructor(readonly link: OnlineLink) {
    const v = link.view();
    if (!v) throw new Error('RemoteConnection: the online game has no view yet.');
    this.shown = v;
    this.batch = { seq: v.seq, events: v.events };
    const viewer = v.view.viewer;
    if (!link.status().me && !viewer) throw new Error('RemoteConnection: the online game does not say which player sits here.');
    this.me = link.status().me ?? viewer!;
    this.statusText = this.describe();
    // Always listening (not only while the screen subscribes), so `view()` is never behind the link; the link lives as long as this connection.
    link.subscribe(this.onLink);
  }

  private readonly onLink = (): void => {
    let changed = false;
    const v = this.link.view();
    // After `leave` the server forgets the game (status idle, no view): the screen keeps the last view it had.
    if (v && v !== this.shown) {
      this.shown = v;
      this.batch = { seq: v.seq, events: v.events };
      changed = true;
    }
    const me = this.link.status().me;
    if (me && me !== this.me) this.me = me;
    const s = this.describe();
    if (s !== this.statusText) {
      this.statusText = s;
      changed = true;
    }
    if (changed) for (const l of [...this.listeners]) l();
  };

  readonly view = (): GameView => this.shown.view;

  readonly legalActions = (): readonly LegalAction[] => (this.shown.view.result ? NO_LEGAL : this.shown.legal);

  /** The events the host sent with the view on screen (packages/net `eventsFor`, already redacted for this player). */
  readonly events = (): EventBatch => this.batch;

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
      const e = explainOnlineError(r.error);
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

  /** What the screen must say about the link right now, or null. */
  private describe(): string | null {
    const problem = this.link.linkProblem();
    if (this.link.linkState() !== 'open' && problem) return problem;
    const s = this.link.status();
    const other = s.opponent ?? 'The other player';
    const multi = s.players !== undefined;
    switch (s.phase) {
      case 'spectating':
        return 'You left the game and conceded. Your OpenMTG server keeps running the game for the others: keep OpenMTG open until it ends. Leave again to stop it (the game then ends for everyone without a result).';
      case 'reconnecting':
        return 'The link to the host dropped; reconnecting… (the game waits)';
      case 'closed':
        return `The game is closed: ${s.closedReason ?? 'the link ended'}. Leave to go back.`;
      case 'idle':
        return 'This game was left. Leave to go back.';
      case 'playing':
      case 'over':
        // A 3-4 player game: each player's presence is in the online panel (OnlineGamePanel), not here.
        if (multi) return null;
        if (s.role === 'host' && s.opponentConnected === false) {
          const left = [...this.link.notices()].reverse().find((n) => n.kind === 'opponentLeft' || n.kind === 'opponentBack' || n.kind === 'opponentDropped');
          if (left?.kind === 'opponentLeft')
            return s.phase === 'over' ? `${other} left.` : `${other} left the game. You can end it for them (Forfeit, CR 104.3a) or leave.`;
          return `${other}'s link dropped; waiting for them to come back.`;
        }
        return null;
      default:
        return null;
    }
  }
}
