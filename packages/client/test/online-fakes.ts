/**
 * Fakes for the online client tests (milestone 9): a fake WebSocket the test drives as the local server would (open, push messages, drop), a fake
 * session fetch, and real views of a small game for the `view` messages. No sockets, no network.
 */
import { GameSession, legalActions, viewFor, type GameEvent, type PlayerId } from '@openmtg/engine';
import { ONLINE_PROTOCOL, type OnlineStatus, type ServerMessage } from '@openmtg/server/online';
import { OnlineLink, type OnlineLinkOptions, type SocketLike } from '../src/online/OnlineLink';
import { smallConfig } from './helpers';

export const TOKEN = 'ab'.repeat(32);

export class FakeSocket implements SocketLike {
  readyState = 0;
  readonly sent: Record<string, unknown>[] = [];
  closedWith: { code?: number; reason?: string } | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  constructor(readonly url: string) {}

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('not open');
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closedWith = { ...(code !== undefined ? { code } : {}), ...(reason !== undefined ? { reason } : {}) };
  }

  // ---- the server's side

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  push(m: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(m) });
  }

  raw(data: unknown): void {
    this.onmessage?.({ data });
  }

  drop(code = 1006, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  /** The last command sent of type `t`. */
  last(t: string): Record<string, unknown> & { id: number } {
    const m = [...this.sent].reverse().find((x) => x['t'] === t);
    if (!m) throw new Error(`no ${t} command was sent (sent: ${this.sent.map((x) => String(x['t'])).join(', ')})`);
    return m as Record<string, unknown> & { id: number };
  }

  reply(t: string, error?: { code: string; message: string; rules?: string[]; details?: string[] }): void {
    const id = this.last(t).id;
    this.push((error ? { t: 'reply', id, ok: false, error } : { t: 'reply', id, ok: true }) as ServerMessage);
  }
}

export const IDLE: OnlineStatus = { role: 'none', phase: 'idle', warnings: [] };

export function sessionFetch(body: unknown = { token: TOKEN, protocol: ONLINE_PROTOCOL }, status = 200) {
  const calls: string[] = [];
  const f = async (url: string) => {
    calls.push(url);
    return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
  };
  return { f, calls };
}

/**
 * A link whose sockets are fakes. With `auto` (default) each socket opens at once and the "server" sends `initial` (idle by default), as the real server
 * does on every new socket.
 */
export function fakeLink(o: { initial?: ServerMessage[]; auto?: boolean; opts?: OnlineLinkOptions; session?: ReturnType<typeof sessionFetch> } = {}) {
  const sockets: FakeSocket[] = [];
  const session = o.session ?? sessionFetch();
  const link = new OnlineLink({
    fetch: session.f,
    socket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      if (o.auto !== false)
        queueMicrotask(() => {
          s.open();
          for (const m of o.initial ?? [{ t: 'status', status: IDLE }]) s.push(m);
        });
      return s;
    },
    retryMs: 5,
    ...o.opts,
  });
  return { link, sockets, session, socket: () => sockets[sockets.length - 1]! };
}

/** A small real game for `view` messages: the session and a view message for `me` at its current state. */
export function gameViews(seed = 'online-views') {
  const session = new GameSession(smallConfig(seed));
  const ids = session.state.players.map((p) => p.id);
  let seq = 0;
  const msg = (me: PlayerId, events: GameEvent[] = []): Extract<ServerMessage, { t: 'view' }> => ({
    t: 'view',
    seq,
    view: viewFor(session.state, me),
    events,
    legal: legalActions(session.state, me),
  });
  return {
    session,
    ids,
    msg,
    /** Apply the pending player's first legal answer (or a pass) and bump the sequence; returns the events. */
    step() {
      const d = session.state.pending!;
      const action =
        d.kind === 'priority'
          ? { type: 'pass' as const, player: d.player }
          : d.kind === 'playFirst'
            ? { type: 'answer' as const, player: d.player, decisionId: d.id, answer: { kind: 'playFirst' as const, player: d.player } }
            : d.kind === 'mulligan'
              ? { type: 'answer' as const, player: d.player, decisionId: d.id, answer: { kind: 'mulligan' as const, keep: true } }
              : null;
      if (!action) throw new Error(`gameViews.step: no answer for ${d.kind}`);
      const r = session.apply(action);
      if (!r.ok) throw new Error(r.error.message);
      seq++;
      return r.events;
    },
  };
}

export const flush = () => new Promise((r) => setTimeout(r, 0));
