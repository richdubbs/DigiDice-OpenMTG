/**
 * The bridge between the browser and packages/net (docs/design/online.md, "Browser and local server"). The browser cannot open UDP sockets, so its own
 * local server plays: hosting, this server runs the authoritative game (GameHost: UDP port, generated join code, the host's deck checked for the
 * format); joining, it is the guest (GameGuest). The browser talks to the bridge over the localhost socket (socket.ts) with the messages of api.ts:
 *
 * - each browser gets only its own player's view (`viewFor` of the host's state for the host player; the guest's server gets the guest's from the host
 *   and has no other), the events of each change redacted for that player (the event feed), and its legal actions; the guest's manual adjustments
 *   reach the host's browser in words only (CR 400.2: their raw ops name the guest's hidden cards by real id, m4);
 * - actions come back over the same socket and are checked (messages.ts: shape, player, and that they fit the current view and its legal actions)
 *   before they go to the game; the host's engine then decides (CR 733);
 * - after game over (CR 104.1) the link stays up until a side leaves (FIX-NET gap 1): `leave` closes it with a bye for the other side.
 *
 * The browser socket is replaceable: closing it (a reload) does not end the game, and the next socket gets the status, the current view and (M12F) the
 * table's chat so far (`chatHistory`, the last CHAT_HISTORY_LINES lines of this game). Nothing a
 * browser sends can throw out of here: a failure becomes an error reply.
 *
 * M12-5a (m12 design 6, sites S1-S13): a 3-4 player game (`host` with `seats`). The host's status carries one join code per guest seat (`codes`) and the
 * table (`players`: links, drop clocks, players who left); both sides wait in the lobby (`waiting`) until every seat is taken; notices name their player;
 * every player answers every other player's manual adjustments (`manual`); chat lines carry their sender; the host's Leave concedes and keeps serving the
 * game for the others (`spectating`; a second Leave, or stopping the server, ends it for everyone). A two-player game is milestone 9's, message for message,
 * but for one change: the host's own manual adjustments wait for the guest's answer, as in a 3-4 player game (the host's browser gets
 * its proposal with `player` and `waiting`, the guest's browser the proposal to answer with `manual`, both the `manualClosed` with its outcome).
 *
 * RPL-3 (replays design 6, 7.2, 16.3): replays of online games, with 2-4 players. The browser's `replayConsent` (its player's "Show my cards in
 * replays", default off) goes to the host's GameHost (`setReplayConsent`), or from a guest's server to the host (`GameGuest.setReplayConsent`); the
 * status's `replay` says the replay's id, this player's choice (a guest's as the host has it: one made while the link is down waits, `pending`, and is
 * sent on the reconnection), the host's list of who agreed, and whether the game was shared. Hosting, this server
 * writes the game's record as it goes (online/replays.ts: the start, each action, every player's choice, the end), also after the browser left: the
 * record's lines are the host's, not the page's. Joining, a game the host shares (after the end, every player agreed) goes to the browser as
 * `replayGame`, and again to every new socket.
 */
import type { CardSource, GameGuest, GameHost, GuestOptions, HostOptions, LinkOptions, ManualProposal } from '@openmtg/net';
import { cleanText, NetError, newReplayId } from '@openmtg/net';
import type { GameEvent, GameView, LegalAction, PlayerId, ReplayApp } from '@openmtg/engine';
import {
  CHAT_HISTORY_LINES, DEFAULT_GAME_PORT, type ClientMessage, type OnlineChatLine, type OnlineError, type OnlineErrorCode, type OnlineManualProposal, type OnlinePlayerStatus,
  type OnlineReplayStatus, type OnlineStatus, type ServerMessage,
} from './api';
import { checkClientAction, parseClientMessage, parseGameAddress } from './messages';
import type { OnlineReplayStore } from './replays';

/** How the bridge makes games: packages/net over UDP by default; tests pass in-memory ones (net's MemoryTransport). */
export interface OnlineBackends {
  startHost(o: HostOptions): Promise<GameHost>;
  joinGuest(o: GuestOptions): Promise<GameGuest>;
}

export interface BridgeOptions {
  /** The host's card data (the server's card index). Rejects when there is none: hosting then answers 'noCardData'. */
  cards: () => Promise<CardSource>;
  backends: OnlineBackends;
  /** Address the host's UDP socket binds (default 0.0.0.0: every interface, so a guest can reach it through port forwarding). */
  bindAddress?: string;
  /** Link timings (tests). */
  link?: Partial<LinkOptions>;
  /** RPL-3: where the host's game records are written (online/replays.ts); null or absent: none are kept. */
  replays?: OnlineReplayStore | null;
  /** RPL-3: this server's app, which the guests' copies of a shared game record (packages/net HostOptions.replay.app). */
  app?: ReplayApp;
}

/** One browser socket, as the bridge sees it. */
export interface ClientPort {
  send(m: ServerMessage): void;
  close(code: number, reason: string): void;
}

/** What a socket hands the bridge. */
export interface ClientHandle {
  /** A text frame from the browser. */
  message(text: string | Buffer): void;
  /** The socket closed. */
  closed(): void;
}

type Game =
  | { role: 'host'; host: GameHost }
  | { role: 'guest'; guest: GameGuest };

const errorOf = (code: OnlineErrorCode, message: string, more: Omit<OnlineError, 'code' | 'message'> = {}): OnlineError => ({ code, message, ...more });

export class OnlineBridge {
  private client: ClientPort | null = null;
  private status: OnlineStatus = { role: 'none', phase: 'idle', warnings: [] };
  private game: Game | null = null;
  /** The last view message, for a new socket (and the guest's view between reconnections). */
  private lastView: Extract<ServerMessage, { t: 'view' }> | null = null;
  private proposal: OnlineManualProposal | null = null;
  /** M12F: the table's chat of this game (the last CHAT_HISTORY_LINES lines), resent to a new socket so a reloaded page keeps it. */
  private chatLog: OnlineChatLine[] = [];
  /** RPL-3: a guest: the game the host shared (gzip, base64), resent to a new socket. */
  private replayData: string | null = null;
  /** Bumped by every new game and every leave: events of an older game are ignored. */
  private generation = 0;
  private shut = false;

  constructor(private readonly o: BridgeOptions) {}

  /** The current status (tests, diagnostics). */
  get current(): OnlineStatus {
    return this.status;
  }

  /** RPL-3: whether the game of the record `id` is still running here (hosted by this server, not over): its replay is not ready yet. */
  running(id: string): boolean {
    const g = this.game;
    return g?.role === 'host' && g.host.replayId === id && !g.host.isClosed && !g.host.state?.result;
  }

  /** RPL-3: the replay id of the game open here (hosted or joined, until it is left or closed), or null. */
  openReplay(): string | null {
    const s = this.status;
    return s.phase !== 'idle' && s.phase !== 'closed' ? s.replay?.id ?? null : null;
  }

  /** A new browser socket. It replaces the one before (closed with `replacedCode`), and gets the status and the current view at once. */
  attach(port: ClientPort, replacedCode = 4001): ClientHandle {
    const old = this.client;
    this.client = port;
    if (old) {
      try {
        old.close(replacedCode, 'The game was opened in another tab or window.');
      } catch {
        // already closed
      }
    }
    this.resend();
    return {
      message: (text) => {
        if (this.client !== port) return;
        void this.onMessage(text).catch((e: unknown) => this.send({ t: 'notice', kind: 'hostError', text: `The server failed on a message: ${e instanceof Error ? e.message : String(e)}` }));
      },
      closed: () => {
        if (this.client === port) this.client = null;
      },
    };
  }

  /** Server shutdown: leave the game (the other side gets a bye). */
  async close(): Promise<void> {
    this.shut = true;
    await this.leave('the player\'s OpenMTG server stopped');
    this.client = null;
  }

  // ---- browser messages

  private async onMessage(text: string | Buffer): Promise<void> {
    const p = parseClientMessage(text);
    if (!p.ok) {
      if (p.id !== undefined) this.reply(p.id, errorOf('badMessage', `Message rejected: ${p.error}`));
      else this.send({ t: 'notice', kind: 'hostError', text: `Message rejected: ${p.error}` });
      return;
    }
    const m = p.message;
    try {
      await this.run(m);
    } catch (e) {
      this.reply(m.id, errorOf('engineError', `The server failed on this command: ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  private async run(m: ClientMessage): Promise<void> {
    switch (m.t) {
      case 'status':
        this.resend();
        return this.ok(m.id);
      case 'host':
        return this.host(m);
      case 'join':
        return this.join(m);
      case 'act':
        return this.act(m);
      case 'manual': {
        const g = this.game;
        // M12-5a: in a 3-4 player game every player answers every other player's proposal; the host's engine applies it when all agreed.
        // a two-player guest answers the host's proposals the same way.
        if (g?.role === 'guest') {
          if (g.guest.proposal?.id !== m.proposal) return this.reply(m.id, errorOf('manualRejected', 'There is no such proposal (it was answered or withdrawn).'));
          if (!g.guest.vote(m.proposal, m.accept, m.reason)) return this.reply(m.id, errorOf('disconnected', 'Not connected to the host.'));
          return this.ok(m.id);
        }
        if (g?.role !== 'host') return this.reply(m.id, errorOf('notAllowed', 'Only the host answers manual adjustments.'));
        // A two-player host answering the guest's proposal: milestone 9's manualClosed without an outcome (a proposal with `waiting` is the host's own).
        const duel = g.host.seats <= 2 && this.proposal?.id === m.proposal && this.proposal.waiting === undefined;
        const r = g.host.answerManual(m.proposal, m.accept, m.reason);
        if (duel && this.proposal?.id === m.proposal) this.closeProposal();
        return r.ok ? this.ok(m.id) : this.reply(m.id, errorOf(r.error.code ?? 'illegalAction', r.error.message, { rules: r.error.rules }));
      }
      case 'forfeit': {
        const g = this.game;
        if (g?.role !== 'host') return this.reply(m.id, errorOf('notAllowed', 'Only the host can end the game for a guest that left.'));
        const r = g.host.forfeitGuest(m.player);
        return r.ok ? this.ok(m.id) : this.reply(m.id, errorOf(r.error.code ?? 'illegalAction', r.error.message, { rules: r.error.rules }));
      }
      case 'replayConsent': {
        // RPL-3: this player's "Show my cards in replays" (the host keeps every player's last choice; once the game was shared it is final).
        const g = this.game;
        if (!g) return this.reply(m.id, errorOf('noGame', 'There is no game to choose for.'));
        if (g.role === 'host') g.host.setReplayConsent(m.agree);
        else {
          // A guest's choice is the host's only once it was sent: with the link down it waits (`pending`, sent on the reconnection) and the status
          // keeps the choice the host has, which a game ending meanwhile counts.
          const sent = g.guest.setReplayConsent(m.agree);
          const r = this.status.replay;
          if (r && !r.shared) this.patch(this.generation, { replay: sent || m.agree === r.agree ? { ...settled(r), agree: m.agree } : { ...r, pending: m.agree } });
        }
        return this.ok(m.id);
      }
      case 'chat': {
        const g = this.game;
        if (!g) return this.reply(m.id, errorOf('noGame', 'There is no game to chat in.'));
        if (g.role === 'host') g.host.chat(m.text);
        else g.guest.chat(m.text);
        this.remember({ text: cleanText(m.text).slice(0, 500), mine: true }); // as net sends it (game/host.ts, game/guest.ts)
        return this.ok(m.id);
      }
      case 'leave': {
        // M12-5a: the host of a running 3-4 player game concedes and keeps serving it for the others (`spectating`).
        const g = this.game;
        if (g?.role === 'host' && g.host.seats > 2 && this.status.phase === 'playing' && g.host.state && !g.host.state.result) {
          const r = g.host.leave();
          if (r.ok) {
            // M12 gaps: a concession that ended the game (one other player left, CR 104.2a) is game over (`gameOver` set the phase), not spectating
            if (g.host.spectating) this.patch(this.generation, { phase: 'spectating' });
            return this.ok(m.id);
          }
        }
        const reason = g?.role === 'host' && g.host.spectating && !g.host.state?.result ? 'the host stopped running the game (it ends without a result)'
          : g?.role === 'host' ? 'the host left the game' : 'the guest left the game';
        await this.leave(reason, true);
        this.resend();
        return this.ok(m.id);
      }
    }
  }

  private busy(id: number): boolean {
    if (this.shut) {
      this.reply(id, errorOf('closed', 'The server is stopping.'));
      return true;
    }
    if (this.status.phase === 'idle' || this.status.phase === 'closed') return false;
    this.reply(id, errorOf('busy', 'A game is open already: leave it first.'));
    return true;
  }

  private async host(m: Extract<ClientMessage, { t: 'host' }>): Promise<void> {
    if (this.busy(m.id)) return;
    const gen = this.reset({ role: 'host', phase: 'starting', me: 'p1', warnings: [], ...(m.format ? { format: m.format } : {}) });
    let cards: CardSource;
    try {
      cards = await this.o.cards();
    } catch (e) {
      this.setStatus(gen, { role: 'none', phase: 'idle', warnings: [] });
      return this.reply(m.id, errorOf('noCardData', `Hosting needs the local card data: ${e instanceof Error ? e.message : String(e)}`));
    }
    let host: GameHost;
    try {
      host = await this.o.backends.startHost({
        name: m.name, deck: m.deck, cards, ...(m.format ? { format: m.format } : {}), port: m.port ?? DEFAULT_GAME_PORT, address: this.o.bindAddress ?? '0.0.0.0',
        ...(this.o.link ? { link: this.o.link } : {}), ...(m.seats ? { seats: m.seats } : {}), ...(this.o.app ? { replay: { app: this.o.app } } : {}),
      });
    } catch (e) {
      this.setStatus(gen, { role: 'none', phase: 'idle', warnings: [] });
      return this.reply(m.id, failure(e, m.port ?? DEFAULT_GAME_PORT));
    }
    if (gen !== this.generation) {
      await host.close('the host left the game');
      return this.reply(m.id, errorOf('closed', 'The game was left while it was starting.'));
    }
    this.game = { role: 'host', host };
    this.wireHost(host, gen);
    const replay = { id: host.replayId, agree: false, agreed: [], shared: false };
    if (host.seats > 2) {
      this.setStatus(gen, {
        role: 'host', phase: 'waiting', me: host.player, format: host.format, code: host.code, port: host.port, warnings: [...host.warnings], ...this.hostTable(host),
        replay,
      });
    } else {
      this.setStatus(gen, {
        role: 'host', phase: 'waiting', me: host.player, format: host.format, code: host.code, port: host.port, opponentConnected: false, warnings: [...host.warnings], replay,
      });
    }
    this.ok(m.id);
  }

  /** M12-5a: the host's view of a 3-4 player table: seats, one code per guest seat (and whether it is spent), the players with links and drop clocks. */
  private hostTable(h: GameHost): Pick<OnlineStatus, 'seats' | 'codes' | 'players'> {
    const now = Date.now();
    const table = h.players();
    const players = table.map((p): OnlinePlayerStatus => ({
      id: p.id, name: p.name, connected: p.connected, seat: p.seat, taken: p.taken, ...(p.left ? { left: true } : {}),
      ...(p.forfeitInMs !== undefined ? { forfeitAt: now + p.forfeitInMs } : {}),
    }));
    const codes = h.codes.map((c) => ({ seat: c.seat, player: c.player, code: c.code, taken: table.find((p) => p.seat === c.seat)?.taken === true }));
    return { seats: h.seats as 3 | 4, codes, players };
  }

  /** M12-5a: a guest's view of a 3-4 player table. */
  private guestTable(g: GameGuest): Pick<OnlineStatus, 'seats' | 'seat' | 'players'> {
    const players = g.players.map((p): OnlinePlayerStatus => ({
      id: p.id, name: p.name, connected: p.connected, seat: p.seat, taken: true, ...(p.left ? { left: true } : {}), ...(p.forfeitAt !== undefined ? { forfeitAt: p.forfeitAt } : {}),
    }));
    return { seats: g.seats as 3 | 4, ...(g.seat !== null ? { seat: g.seat } : {}), players };
  }

  private async join(m: Extract<ClientMessage, { t: 'join' }>): Promise<void> {
    if (this.busy(m.id)) return;
    const addr = parseGameAddress(m.address);
    if (addr.error !== undefined) return this.reply(m.id, errorOf('badMessage', addr.error));
    const gen = this.reset({ role: 'guest', phase: 'joining', address: m.address, warnings: [] });
    let guest: GameGuest;
    try {
      guest = await this.o.backends.joinGuest({ host: addr.host, port: addr.port, code: m.code, name: m.name, deck: m.deck, ...(this.o.link ? { link: this.o.link } : {}) });
    } catch (e) {
      this.setStatus(gen, { role: 'none', phase: 'idle', warnings: [] });
      return this.reply(m.id, failure(e, addr.port));
    }
    if (gen !== this.generation) {
      await guest.close('the guest left the game');
      return this.reply(m.id, errorOf('closed', 'The game was left while joining.'));
    }
    this.game = { role: 'guest', guest };
    this.wireGuest(guest, gen);
    const over = guest.view?.result;
    // RPL-3: the id this player's page keeps the game's replay under (the same for every page of this game).
    const replay = { id: newReplayId(), agree: false, shared: false };
    if (guest.seats > 2) {
      // M12-5a: a 3-4 player game: the lobby until every seat is taken, then the table.
      this.setStatus(gen, {
        role: 'guest', phase: over ? 'over' : guest.started ? 'playing' : 'waiting', me: guest.player, format: guest.format, address: m.address,
        warnings: [...guest.warnings], ...this.guestTable(guest), ...(over ? { result: over } : {}), replay,
      });
    } else {
      this.setStatus(gen, {
        role: 'guest', phase: over ? 'over' : 'playing', me: guest.player, opponent: guest.opponent.name, opponentConnected: guest.connected, format: guest.format,
        address: m.address, warnings: [...guest.warnings], ...(over ? { result: over } : {}), replay,
      });
    }
    // A view that arrived with the welcome, before the listener was on (the guest's join resolves after the welcome is handled).
    if (guest.view) this.view(gen, guest.view, [], guest.legal, guest.seq);
    if (guest.replayData !== null) this.replayIn(gen, guest.replayData);
    this.ok(m.id);
  }

  private async act(m: Extract<ClientMessage, { t: 'act' }>): Promise<void> {
    const g = this.game;
    if (!g) return this.reply(m.id, errorOf('noGame', 'There is no game.'));
    if (g.role === 'host') {
      const h = g.host;
      if (!h.started) return this.reply(m.id, errorOf('notStarted', h.seats > 2 ? 'The game starts when every seat is taken.' : 'The game starts when the guest joins.'));
      const refused = checkClientAction(m.action, h.player, h.view(), h.legal());
      if (refused) return this.reply(m.id, refused);
      const r = h.act(m.action);
      return r.ok ? this.ok(m.id) : this.reply(m.id, errorOf(r.error.code ?? 'illegalAction', r.error.message, { rules: r.error.rules }));
    }
    const guest = g.guest;
    const refused = checkClientAction(m.action, guest.player, guest.view, guest.legal);
    if (refused) return this.reply(m.id, refused);
    const r = await guest.act(m.action);
    return r.ok ? this.ok(m.id) : this.reply(m.id, errorOf(r.error.code, r.error.message, { rules: r.error.rules }));
  }

  /**
   * Close the game, if any (a bye to the other side), and go back to idle. `concede` (the player chose Leave): a game that is still running is conceded
   * first through the engine's concede action (CR 104.3a: a player may concede at any time, and leaving a game in progress is a concession), so the
   * other side sees that it won and why before the bye arrives, instead of a dropped link it waits on. A server that stops does not concede for its
   * player (`close`); the other side then hears a bye without a result (the host can end the game with Forfeit).
   */
  private async leave(reason: string, concede = false): Promise<void> {
    const g = this.game;
    this.reset({ role: 'none', phase: 'idle', warnings: [] });
    if (g?.role === 'host') {
      if (concede && concedeAsHost(g.host)) reason = `${reason} and conceded (CR 104.3a)`;
      // RPL-3: its record is complete (the concession's line included): kept no longer than its page needs it (online/replays.ts `settle`).
      this.o.replays?.settle(g.host.replayId);
      await g.host.close(reason);
    } else if (g?.role === 'guest') {
      if (concede && (await concedeAsGuest(g.guest))) reason = `${reason} and conceded (CR 104.3a)`;
      await g.guest.close(reason);
    }
  }

  // ---- game events

  /**
   * RPL-3: the host's replay: its record goes to this server's data directory line by line (whatever the browser does: a game the page left keeps
   * its end), from its start with the choices made in the lobby (the store writes nothing before), and the status follows every player's choice and
   * the sharing. Once the game is shared (or closed, `leave`) its choices are final and the store keeps the record no longer than its page needs it.
   */
  private wireHostReplays(h: GameHost, gen: number): void {
    const store = this.o.replays;
    if (store) {
      h.on('recordStart', (start, agreed) => store.begin(start, agreed));
      h.on('recordAction', (line) => store.append(h.replayId, line));
      h.on('recordEnd', (end) => store.end(h.replayId, end));
    }
    h.on('replayConsent', (agreed) => {
      store?.consent(h.replayId, agreed);
      const r = this.status.replay;
      if (gen === this.generation && r) this.patch(gen, { replay: { ...r, agree: agreed.includes(h.player), agreed: [...agreed] } });
    });
    h.on('replayShared', (ok) => {
      store?.settle(h.replayId);
      const r = this.status.replay;
      if (gen === this.generation && r) this.patch(gen, { replay: { ...r, shared: ok, ...(ok ? {} : { tooLarge: true as const }) } });
    });
  }

  /** RPL-3: a guest's replay: the game the host shared, and a choice made while the link was down, which the reconnection sent. */
  private wireGuestReplays(g: GameGuest, gen: number): void {
    g.on('replayGame', (data) => this.replayIn(gen, data));
    g.on('reconnected', () => {
      const r = this.status.replay;
      if (gen === this.generation && r?.pending !== undefined && !r.shared) this.patch(gen, { replay: { ...settled(r), agree: r.pending } });
    });
  }

  /** RPL-3: the host shared the game (so every player agreed, this one too): kept for a new socket, and sent to the browser now. */
  private replayIn(gen: number, data: string): void {
    if (gen !== this.generation || this.replayData !== null) return;
    this.replayData = data;
    const r = this.status.replay;
    if (r) this.patch(gen, { replay: { ...settled(r), agree: true, shared: true } });
    this.send({ t: 'replayGame', data });
  }

  private wireHost(h: GameHost, gen: number): void {
    this.wireHostReplays(h, gen);
    if (h.seats > 2) return this.wireTableHost(h, gen);
    const live = () => gen === this.generation;
    h.on('view', (view, events) => {
      if (live()) this.view(gen, view, events, h.legal(), h.seq);
    });
    h.on('guestJoined', (name) => this.patch(gen, { phase: 'playing', opponent: name, opponentConnected: true }));
    h.on('guestLeft', (reason, final, bye) => {
      if (!live()) return;
      this.patch(gen, { opponentConnected: false });
      const name = this.status.opponent ?? 'The guest';
      const conceded = h.state?.players.find((p) => p.id === h.guestPlayer)?.conceded === true;
      // CL4: a guest that left on purpose (its bye) is not a dropped link: after its concession (CR 104.3a) the host has won and is told why; a bye
      // without one (its server stopped) leaves the host to end the game with Forfeit. Only a real drop waits for the guest to come back.
      if (final || bye) {
        const text = conceded ? `${name} left the game and conceded (CR 104.3a).`
          : final ? `The guest left (${reason}).`
          : `${name} left the game (${reason}). You can end it for them (Forfeit, CR 104.3a) or leave.`;
        this.send({ t: 'notice', kind: 'opponentLeft', text });
      } else {
        this.send({ t: 'notice', kind: 'opponentDropped', text: `The guest's link dropped (${reason}); waiting for them to come back.` });
      }
    });
    h.on('guestResumed', () => {
      if (!live()) return;
      this.patch(gen, { opponentConnected: true });
      this.send({ t: 'notice', kind: 'opponentBack', text: 'The guest is back.' });
    });
    h.on('rejected', (reason) => {
      if (live()) this.send({ t: 'notice', kind: 'refused', text: `Refused a connection: ${reason}` });
    });
    h.on('chat', (text) => {
      if (live()) this.chatIn(text);
    });
    h.on('manualProposal', (p) => {
      if (!live()) return;
      this.proposal = onlineProposal(p);
      this.sendProposal(this.proposal);
    });
    h.on('manualWithdrawn', (id) => {
      if (live() && this.proposal?.id === id) this.closeProposal();
    });
    // the host's own proposal waits for the guest (it has `player` and `waiting`), and its end is told with the outcome. The guest's
    // proposals keep milestone 9's messages (closed by the answer above or by manualWithdrawn).
    h.on('manualPending', (p) => {
      if (!live()) return;
      this.proposal = onlineProposal(p);
      this.sendProposal(this.proposal);
    });
    h.on('manualClosed', (id, outcome, by) => {
      if (!live() || this.proposal?.id !== id || this.proposal.waiting === undefined) return;
      this.proposal = null;
      this.send({ t: 'manualClosed', proposal: id, outcome, ...(by !== undefined ? { by } : {}) });
    });
    h.on('gameOver', (result) => this.patch(gen, { phase: 'over', result }));
  }

  /** M12-5a: the host of a 3-4 player game (m12 design 6). */
  private wireTableHost(h: GameHost, gen: number): void {
    const live = () => gen === this.generation;
    h.on('view', (view, events) => {
      if (live()) this.view(gen, view, events, h.legal(), h.seq);
    });
    h.on('table', (players) => {
      if (!live()) return;
      this.patch(gen, this.hostTable(h));
      // The host left and kept serving the game: once it is over and every guest has gone, nobody needs this server's game any more.
      if (h.spectating && h.state?.result && players.every((p) => p.seat === 1 || !p.connected)) void this.leave('the game is over and every player has left');
    });
    h.on('start', () => this.patch(gen, { phase: 'playing', ...this.hostTable(h) }));
    h.on('notice', (kind, player, text) => {
      if (live()) this.send({ t: 'notice', kind: NOTICE_KIND[kind], text, player });
    });
    h.on('rejected', (reason) => {
      if (live()) this.send({ t: 'notice', kind: 'refused', text: `Refused a connection: ${reason}` });
    });
    h.on('chat', (text, from) => {
      if (live()) this.chatIn(text, from);
    });
    // Every player's proposals: another player's for the host to answer, the host's own with who is still to answer.
    const proposal = (p: ManualProposal) => {
      if (!live()) return;
      this.proposal = onlineProposal(p);
      this.sendProposal(this.proposal);
    };
    h.on('manualProposal', proposal);
    h.on('manualPending', proposal);
    h.on('manualClosed', (id, outcome, by) => {
      if (!live() || this.proposal?.id !== id) return;
      this.proposal = null;
      this.send({ t: 'manualClosed', proposal: id, outcome, ...(by !== undefined ? { by } : {}) });
    });
    h.on('gameOver', (result) => this.patch(gen, { phase: 'over', result, ...this.hostTable(h) }));
  }

  /** M12-5a: a guest of a 3-4 player game (m12 design 6). */
  private wireTableGuest(g: GameGuest, gen: number): void {
    const live = () => gen === this.generation;
    g.on('view', (view, events) => {
      if (!live()) return;
      this.view(gen, view, events, g.legal, g.seq);
      if (view.result && this.status.phase !== 'over') this.patch(gen, { phase: 'over', result: view.result, ...this.guestTable(g) });
    });
    g.on('table', () => this.patch(gen, this.guestTable(g)));
    g.on('start', () => this.patch(gen, { phase: 'playing', ...this.guestTable(g) }));
    g.on('notice', (kind, player, text) => {
      if (live()) this.send({ t: 'notice', kind: NOTICE_KIND[kind], text, player });
    });
    g.on('error', (e) => {
      if (live() && e.ref === undefined) this.send({ t: 'notice', kind: 'hostError', text: `The host: ${e.message}` });
    });
    g.on('chat', (text, from) => {
      if (live()) this.chatIn(text, from);
    });
    g.on('manualProposal', (p) => {
      if (!live()) return;
      this.proposal = { id: p.id, sourceName: p.sourceName, text: p.text, lines: [...p.lines], player: p.player, waiting: [...p.waiting] };
      this.sendProposal(this.proposal);
    });
    g.on('manualClosed', (c) => {
      if (!live()) return;
      if (this.proposal?.id === c.proposal) this.proposal = null;
      this.send({ t: 'manualClosed', proposal: c.proposal, outcome: c.outcome, ...(c.by !== undefined ? { by: c.by } : {}) });
    });
    g.on('disconnected', (reason) => {
      if (!live()) return;
      this.patch(gen, { phase: 'reconnecting' });
      this.send({ t: 'notice', kind: 'opponentDropped', text: `The link to the host dropped (${reason}); reconnecting...`, player: g.opponent.id });
    });
    g.on('reconnected', () => {
      if (!live()) return;
      this.patch(gen, { phase: g.view?.result ? 'over' : g.started ? 'playing' : 'waiting' });
      this.send({ t: 'notice', kind: 'opponentBack', text: 'Reconnected to the host.', player: g.opponent.id });
    });
    g.on('closed', (reason) => {
      if (!live()) return;
      this.game = null;
      this.patch(gen, { phase: 'closed', closedReason: reason });
      this.send({ t: 'notice', kind: 'opponentLeft', text: `The game is closed: ${reason}.`, player: g.opponent.id });
    });
  }

  private wireGuest(g: GameGuest, gen: number): void {
    this.wireGuestReplays(g, gen);
    if (g.seats > 2) return this.wireTableGuest(g, gen);
    const live = () => gen === this.generation;
    g.on('view', (view, events) => {
      if (!live()) return;
      this.view(gen, view, events, g.legal, g.seq);
      if (view.result && this.status.phase !== 'over') this.patch(gen, { phase: 'over', result: view.result });
    });
    g.on('error', (e) => {
      if (live() && e.ref === undefined) this.send({ t: 'notice', kind: 'hostError', text: `The host: ${e.message}` });
    });
    g.on('chat', (text) => {
      if (live()) this.chatIn(text);
    });
    // the host's manual adjustments, for this guest to answer with `manual` (in words, as the guest may know the game, CR 400.2).
    g.on('manualProposal', (p) => {
      if (!live()) return;
      this.proposal = { id: p.id, sourceName: p.sourceName, text: p.text, lines: [...p.lines], player: p.player, waiting: [...p.waiting] };
      this.sendProposal(this.proposal);
    });
    g.on('manualClosed', (c) => {
      if (!live()) return;
      if (this.proposal?.id === c.proposal) this.proposal = null;
      this.send({ t: 'manualClosed', proposal: c.proposal, outcome: c.outcome, ...(c.by !== undefined ? { by: c.by } : {}) });
    });
    g.on('disconnected', (reason) => {
      if (!live()) return;
      this.patch(gen, { phase: 'reconnecting', opponentConnected: false });
      this.send({ t: 'notice', kind: 'opponentDropped', text: `The link to the host dropped (${reason}); reconnecting...` });
    });
    g.on('reconnected', () => {
      if (!live()) return;
      this.patch(gen, { phase: g.view?.result ? 'over' : 'playing', opponentConnected: true });
      this.send({ t: 'notice', kind: 'opponentBack', text: 'Reconnected to the host.' });
    });
    g.on('closed', (reason) => {
      if (!live()) return;
      this.game = null;
      this.patch(gen, { phase: 'closed', opponentConnected: false, closedReason: reason });
      // CL4: a host that left a running game conceded first (CR 104.3a); its view with the result came before the bye.
      const host = g.view?.players.find((p) => p.id === g.opponent.id);
      const text = host?.conceded ? `${g.opponent.name || 'The host'} left the game and conceded (CR 104.3a).` : `The game is closed: ${reason}.`;
      this.send({ t: 'notice', kind: 'opponentLeft', text });
    });
  }

  // ---- sending

  private view(gen: number, view: GameView, events: GameEvent[], legal: LegalAction[], seq: number): void {
    if (gen !== this.generation) return;
    this.lastView = { t: 'view', seq, view, events, legal };
    this.send(this.lastView);
  }

  /** Another player's chat line: to the browser, and into the table's chat history (M12F). */
  private chatIn(text: string, from?: PlayerId): void {
    this.remember({ text, ...(from !== undefined ? { from } : {}) });
    this.send({ t: 'chat', text, ...(from !== undefined ? { from } : {}) });
  }

  private remember(line: OnlineChatLine): void {
    this.chatLog.push(line);
    if (this.chatLog.length > CHAT_HISTORY_LINES) this.chatLog.splice(0, this.chatLog.length - CHAT_HISTORY_LINES);
  }

  private sendProposal(p: OnlineManualProposal): void {
    this.send({ t: 'manualProposal', proposal: { ...p, lines: [...p.lines], ...(p.waiting ? { waiting: [...p.waiting] } : {}) } });
  }

  private closeProposal(): void {
    const p = this.proposal;
    this.proposal = null;
    if (p) this.send({ t: 'manualClosed', proposal: p.id });
  }

  /**
   * The status, the last view (without its events: they were shown already), a waiting proposal and (M12F) the table's chat so far, for a new socket or a
   * `status` request.
   */
  private resend(): void {
    this.send({ t: 'status', status: this.status });
    if (this.lastView) this.send({ ...this.lastView, events: [] });
    if (this.proposal) this.sendProposal(this.proposal);
    this.send({ t: 'chatHistory', lines: this.chatLog.map((l) => ({ ...l })) });
    // RPL-3: the game the host shared, for a page that was not there when it came (a reload).
    if (this.replayData !== null) this.send({ t: 'replayGame', data: this.replayData });
  }

  /** A new game (or none): later events of the old one are ignored. Returns the new generation. */
  private reset(status: OnlineStatus): number {
    this.generation++;
    this.game = null;
    this.lastView = null;
    this.proposal = null;
    this.chatLog = [];
    this.replayData = null;
    this.setStatus(this.generation, status);
    return this.generation;
  }

  private setStatus(gen: number, status: OnlineStatus): void {
    if (gen !== this.generation) return;
    this.status = status;
    this.send({ t: 'status', status });
  }

  private patch(gen: number, change: Partial<OnlineStatus>): void {
    if (gen === this.generation) this.setStatus(gen, { ...this.status, ...change });
  }

  private ok(id: number): void {
    this.send({ t: 'reply', id, ok: true });
  }

  private reply(id: number, error: OnlineError): void {
    this.send({ t: 'reply', id, ok: false, error });
  }

  private send(m: ServerMessage): void {
    const c = this.client;
    if (!c) return;
    try {
      c.send(m);
    } catch {
      // a socket that is closing: the next one gets the status
    }
  }
}

/**
 * A proposal for the browser: words only. `p.ops` name the proposer's hidden cards by their real ids (m4), which another screen must not get (CR 400.2).
 * M12-5a: who proposes it and who is still to answer (3-4 players: the two-player host's own proposal too).
 */
function onlineProposal(p: ManualProposal): OnlineManualProposal {
  return {
    id: p.id, sourceName: p.sourceName, text: p.text, lines: [...p.lines],
    ...(p.waiting ? { player: p.player, waiting: [...p.waiting] } : {}),
  };
}

/** M12-5a: net's notices about a player as the browser's notice kinds (a forfeit is a player leaving). */
const NOTICE_KIND: Record<'joined' | 'left' | 'dropped' | 'back' | 'forfeited', Extract<ServerMessage, { t: 'notice' }>['kind']> = {
  joined: 'opponentJoined', left: 'opponentLeft', dropped: 'opponentDropped', back: 'opponentBack', forfeited: 'opponentLeft',
};

/** How long a leaving guest waits for the host to apply its concession before it says bye anyway (ms). */
export const LEAVE_CONCEDE_MS = 3000;

/** RPL-3: a replay status without a choice waiting to be sent (`pending`). */
function settled(r: OnlineReplayStatus): OnlineReplayStatus {
  const { pending: _pending, ...rest } = r;
  return rest;
}

/** Whether `player` is still in a running game in `view` (CR 104.3a: only a player still in the game can concede). */
function stillPlaying(view: GameView | null, player: string): boolean {
  if (!view || view.result) return false;
  const me = view.players.find((p) => p.id === player);
  return me !== undefined && !me.hasLost && !me.conceded;
}

/** The host player leaves a running game: it concedes first (CR 104.3a), and the guest gets the view with the result before the bye. */
function concedeAsHost(h: GameHost): boolean {
  if (!h.started || !stillPlaying(h.view(), h.player)) return false;
  return h.act({ type: 'concede', player: h.player }).ok;
}

/**
 * The guest player leaves a running game: it concedes first (CR 104.3a) when the link is up, and waits (at most LEAVE_CONCEDE_MS) for the host's view
 * that applies it. A guest whose link is down cannot tell the host; it leaves without conceding (the host can end the game with Forfeit).
 */
async function concedeAsGuest(g: GameGuest): Promise<boolean> {
  if (!g.connected || !stillPlaying(g.view, g.player)) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ ok: false }>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false }), LEAVE_CONCEDE_MS);
    timer.unref?.();
  });
  try {
    const r = await Promise.race([g.act({ type: 'concede', player: g.player }), timeout]);
    return r.ok;
  } finally {
    clearTimeout(timer);
  }
}

/** A failed host or join as a reply: net's errors keep their code and details. */
function failure(e: unknown, port: number): OnlineError {
  if (e instanceof NetError) return errorOf(e.code, e.message, e.details.length ? { details: [...e.details] } : {});
  const code = (e as NodeJS.ErrnoException | null)?.code;
  if (code === 'EADDRINUSE') return errorOf('portInUse', `UDP port ${port} is in use (another game or program); pick another port.`);
  if (code === 'EACCES') return errorOf('portInUse', `UDP port ${port} cannot be opened here (permission denied); pick another port.`);
  return errorOf('engineError', e instanceof Error ? e.message : String(e));
}

