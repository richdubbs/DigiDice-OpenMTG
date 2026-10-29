/**
 * GameHost against a misbehaving guest, in process: the host runs on a MemoryTransport and the "guest" is a Connection joined to it by an
 * in-memory wire (memory.ts). No sockets; every message is one a test crafts, a few at a time. Covers the refusal of bad hellos (versions, join-code
 * proof), audit 2026-10-12 C4 (a bad action is refused, the host keeps going), M3 (resume tokens, a failing hello), M4 (setStops), M5 (syncs) and
 * m7 (join attempts).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { legalActions, viewFor } from '@openmtg/engine';
import { autoAction } from '../src/game/autoplay';
import { GameHost, GUEST_MESSAGE_BYTES, GUEST_MESSAGE_DEPTH, type HostOptions } from '../src/game/host';
import type { Connection } from '../src/link/connection';
import { PROTOCOL_VERSION, type ErrorMessage, type ViewMessage } from '../src/protocol/messages';
import { localVersions } from '../src/protocol/versions';
import { helloProof } from '../src/wire/crypto';
import { deck, FAST_LINK, fixtureDb, until } from './helpers';
import { MemoryTransport, wiredPair } from './memory';

const HOST_DECK = deck({ Forest: 20, 'Grizzly Bears': 20 });
const GUEST_DECK = deck({ Mountain: 20, 'Hill Giant': 20 });
const HOST_LINK = { maxReceiveBytes: GUEST_MESSAGE_BYTES, maxReceiveDepth: GUEST_MESSAGE_DEPTH };

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

interface Client {
  conn: Connection;
  inbox: Record<string, unknown>[];
  hello(patch?: Record<string, unknown>): void;
  send(m: Record<string, unknown>): void;
  errors(): ErrorMessage[];
  views(): ViewMessage[];
}

async function setup(o: Partial<HostOptions> = {}): Promise<{ host: GameHost; client: () => Client }> {
  const transport = new MemoryTransport();
  const host = await GameHost.attach({ name: 'Hana', deck: HOST_DECK, cards: fixtureDb(), seed: 'guard-1', ...o }, transport);
  cleanups.push(() => host.close());
  const client = (): Client => {
    // The host's end gets the host's receive limits (GameHost.start sets them on the UDP endpoint).
    const { host: hostEnd, guest } = wiredPair(FAST_LINK, HOST_LINK);
    cleanups.push(() => {
      guest.destroy();
      hostEnd.destroy();
    });
    transport.accept(hostEnd);
    const inbox: Record<string, unknown>[] = [];
    guest.onMessage((m) => inbox.push(m as Record<string, unknown>));
    const send = (m: Record<string, unknown>) => void guest.send({ v: PROTOCOL_VERSION, ...m });
    return {
      conn: guest, inbox, send,
      hello: (patch = {}) => send({ type: 'hello', versions: localVersions(null), name: 'Gus', deck: GUEST_DECK, proof: helloProof(guest.keys, guest.connId), ...patch }),
      errors: () => inbox.filter((m) => m['type'] === 'error') as unknown as ErrorMessage[],
      views: () => inbox.filter((m) => m['type'] === 'view') as unknown as ViewMessage[],
    };
  };
  return { host, client };
}

async function seated(o: Partial<HostOptions> = {}) {
  const s = await setup(o);
  const c = s.client();
  c.hello();
  await until(() => c.inbox.some((m) => m['type'] === 'welcome') && c.views().length > 0, 5000, 'welcome and first view');
  return { ...s, c };
}

describe('hellos', () => {
  it('refuses a guest with another engine version or build, without the join-code proof, or that does not start with hello', async () => {
    const { host, client } = await setup();
    const attempt = async (patch: Record<string, unknown>, first?: Record<string, unknown>) => {
      const c = client();
      if (first) c.send(first);
      else c.hello(patch);
      await until(() => c.errors().length > 0 && c.conn.closed, 3000, 'the refusal');
      return c.errors()[0];
    };
    expect(await attempt({ versions: { ...localVersions(null), engine: '0.0.0-other' } })).toMatchObject({ code: 'version', fatal: true });
    expect(await attempt({ versions: { ...localVersions(null), build: 'f'.repeat(64) } })).toMatchObject({ code: 'version', fatal: true });
    expect(await attempt({ proof: 'f'.repeat(64) })).toMatchObject({ code: 'badCode', fatal: true });
    expect(await attempt({}, { type: 'action', id: 1, seq: 0, action: { type: 'pass', player: 'p2' } })).toMatchObject({ code: 'protocol', fatal: true });
    expect(host.started).toBe(false);
  });

  it('audit M3: a hello that makes the host fail (its card data throws) is refused; the host keeps running', async () => {
    const cards = fixtureDb();
    let fail = false;
    const flaky = {
      resolveNames: async (names: string[]) => {
        if (fail) throw new Error('card index unavailable');
        return cards.resolveNames(names);
      },
      suggest: (n: string, l?: number) => cards.suggest(n, l),
    };
    const { host, client } = await setup({ cards: flaky });
    fail = true;
    const c = client();
    c.hello();
    await until(() => c.errors().length > 0, 3000, 'the refusal');
    expect(c.errors()[0]).toMatchObject({ code: 'engineError', fatal: true });
    expect(c.errors()[0]!.message).toMatch(/card index unavailable/);
    fail = false;
    const ok = client();
    ok.hello();
    await until(() => ok.inbox.some((m) => m['type'] === 'welcome'), 5000, 'welcome');
    expect(host.started).toBe(true);
  });

  it('audit M3: a resume token in another encoding is refused cleanly; a wrong one gets gameFull', async () => {
    const { client } = await seated();
    const multibyte = client();
    multibyte.hello({ resume: 'é'.repeat(32), deck: { main: [], sideboard: [] } });
    await until(() => multibyte.errors().length > 0, 3000, 'the refusal');
    expect(multibyte.errors()[0]).toMatchObject({ code: 'badMessage', fatal: true });
    expect(multibyte.errors()[0]!.message).toMatch(/resume token malformed/);
    const wrong = client();
    wrong.hello({ resume: '0'.repeat(32), deck: { main: [], sideboard: [] } });
    await until(() => wrong.errors().length > 0, 3000, 'the refusal');
    expect(wrong.errors()[0]).toMatchObject({ code: 'gameFull', fatal: true });
  });

  it('a connection that is being refused is refused once: later messages get no new error, rejected event or close', async () => {
    const { host, client } = await setup();
    const rejected: string[] = [];
    host.on('rejected', (r) => rejected.push(r));
    const c = client();
    for (let i = 0; i < 5; i++) c.send({ type: 'nonsense', n: i });
    await until(() => c.conn.closed, 3000, 'the close');
    expect(rejected).toHaveLength(1);
    expect(c.errors()).toHaveLength(1);
  });

  it('GameHost.attach shows a generated join code in groups of four', async () => {
    const { host } = await setup();
    expect(host.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  });

  it('audit m7: join attempts are rate-limited over all connections', async () => {
    const { client } = await setup({ guestLimits: { joins: { rate: 0.001, burst: 1 } }, deck: HOST_DECK });
    const first = client();
    first.hello({ deck: deck({ 'No Such Card': 1 }) }); // refused for its deck, but it used the one join token
    await until(() => first.errors().length > 0, 3000, 'deck refusal');
    expect(first.errors()[0]).toMatchObject({ code: 'deckRejected' });
    const second = client();
    second.hello();
    await until(() => second.errors().length > 0, 3000, 'rate limit');
    expect(second.errors()[0]).toMatchObject({ code: 'rateLimited', fatal: true });
  });
});

describe('a seated guest', () => {
  it('audit C4: an action nested too deep is refused as badMessage; the game goes on', async () => {
    const { host, c } = await seated();
    let deep: unknown = 'x';
    for (let i = 0; i < 20; i++) deep = [deep];
    c.send({ type: 'action', id: 1, seq: 0, action: { type: 'answer', player: 'p2', decisionId: 'd', answer: { kind: 'chooseOption', ids: deep } } });
    await until(() => c.errors().length > 0, 3000, 'the refusal');
    expect(c.errors()[0]).toMatchObject({ code: 'badMessage', fatal: false, ref: 1 });
    expect(c.errors()[0]!.message).toMatch(/too deeply nested/);
    expect(c.conn.closed).toBe(false);
    expect(host.guestConnected).toBe(true);
  });

  it('accepts actions only for the connection\'s own player, and never startGame (moved here from the UDP game tests: no crafted traffic on sockets)', async () => {
    const { host, c } = await seated();
    const seq0 = c.views().at(-1)!.seq;
    c.send({ type: 'action', id: 1, seq: seq0, action: { type: 'concede', player: 'p1' } });
    await until(() => c.errors().some((e) => e.ref === 1), 3000, 'the refusal');
    expect(c.errors().find((e) => e.ref === 1)).toMatchObject({ code: 'notYourPlayer' });
    c.send({ type: 'action', id: 2, seq: seq0, action: { type: 'startGame' } });
    await until(() => c.errors().some((e) => e.ref === 2), 3000, 'the refusal');
    expect(c.errors().find((e) => e.ref === 2)).toMatchObject({ code: 'badMessage', fatal: false });
    expect(host.act({ type: 'concede', player: 'p2' })).toMatchObject({ ok: false, error: { code: 'notYourPlayer' } });
    expect(host.state!.result).toBeNull();
    // A malformed answer is refused by the shape check or the engine; the host keeps running.
    c.send({ type: 'action', id: 3, seq: seq0, action: { type: 'answer', player: 'p2', decisionId: 'nope', answer: { kind: 'chooseObjects', ids: [] } } });
    await until(() => c.errors().some((e) => e.ref === 3), 3000, 'the refusal');
    c.send({ type: 'action', id: 4, seq: seq0, action: { type: 'concede', player: 'p2' } });
    await until(() => c.views().some((v) => v.ref === 4), 3000, 'the concession');
    expect(c.views().find((v) => v.ref === 4)!.view.result!.winner).toBe('p1'); // CR 104.3a
  });

  it('audit M5: a resend of the last applied id is answered with a small ack, not a full view; an action from an older view is stale', async () => {
    const { host, c } = await seated({ guestLimits: { stops: { rate: 1, burst: 20 } } }); // the resends are setStops: room for all of them
    const seq0 = c.views().at(-1)!.seq;
    const stops = { type: 'setStops', player: 'p2', stops: { ownTurn: ['main1'], opponentTurn: [], fullControl: false } };
    c.send({ type: 'action', id: 1, seq: seq0, action: stops });
    await until(() => c.views().some((v) => v.ref === 1), 3000, 'the answer');
    const count = host.state!.actionCount;
    const views = c.views().length;
    for (let i = 0; i < 10; i++) c.send({ type: 'action', id: 1, seq: seq0, action: stops }); // resends, as after a drop
    await until(() => c.inbox.filter((m) => m['type'] === 'ack' && m['ref'] === 1).length === 10, 3000, 'the acks');
    expect(c.views().length).toBe(views); // no view rendered for a resend
    expect(c.inbox.find((m) => m['type'] === 'ack')).toMatchObject({ seq: seq0 + 1, ref: 1 });
    expect(host.state!.actionCount).toBe(count);
    // F28: the view before a stop change is not older (the next test); a seq no view had yet is.
    c.send({ type: 'action', id: 2, seq: seq0 + 2, action: { type: 'pass', player: 'p2' } });
    await until(() => c.errors().some((e) => e.ref === 2), 3000, 'the refusal');
    expect(c.errors().find((e) => e.ref === 2)).toMatchObject({ code: 'stale' });
    expect(host.state!.actionCount).toBe(count);
  });

  it('F28: a stop change of the host does not make the guest\'s action from the view before it stale; one from before real progress still is', async () => {
    const { host, c } = await seated();
    const guestAction = () => autoAction(viewFor(host.state!, 'p2'), legalActions(host.state!, 'p2'), 'p2');
    for (let i = 0; i < 50 && !guestAction(); i++) {
      const a = autoAction(host.view()!, host.legal(), 'p1');
      if (!a) break;
      expect(host.act(a).ok).toBe(true);
    }
    const a = guestAction();
    expect(a).not.toBeNull();
    const seq = host.seq;
    await until(() => c.views().at(-1)?.seq === seq, 3000, 'the guest\'s view');
    const stops = host.state!.players.find((p) => p.id === 'p1')!.stops;
    expect(host.act({ type: 'setStops', player: 'p1', stops: { ...stops, fullControl: !stops.fullControl } }).ok).toBe(true);
    expect(host.seq).toBe(seq + 1);
    c.send({ type: 'action', id: 1, seq, action: a! }); // chosen from the view before the host's stop change
    await until(() => c.views().some((v) => v.ref === 1) || c.errors().some((e) => e.ref === 1), 3000, 'the answer');
    expect(c.errors()).toEqual([]);
    expect(host.seq).toBe(seq + 2);
    c.send({ type: 'action', id: 2, seq, action: { type: 'pass', player: 'p2' } }); // the guest's own action moved the game on since
    await until(() => c.errors().some((e) => e.ref === 2), 3000, 'the refusal');
    expect(c.errors().find((e) => e.ref === 2)).toMatchObject({ code: 'stale' });
  });

  it('audit M5: messages that fail validation count as strikes; a seated guest that keeps sending them is closed', async () => {
    const { host, c } = await seated({ guestLimits: { strikes: { rate: 0.001, burst: 3 } } });
    for (let i = 0; i < 4; i++) c.send({ type: 'action', id: 10 + i, seq: 0, action: { type: 'nope', player: 'p2' } });
    await until(() => c.conn.closed, 3000, 'the close');
    expect(c.errors().filter((e) => e.code === 'badMessage').length).toBeGreaterThanOrEqual(3);
    expect(host.guestConnected).toBe(false);
  });

  it('audit M4: an unchanged setStops is answered with an ack, without a new state or a view; after the game is over none is applied (CR 104.1)', async () => {
    const { host, c } = await seated();
    const seq0 = c.views().at(-1)!.seq;
    const views = c.views().length;
    const stops = host.state!.players.find((p) => p.id === 'p2')!.stops;
    c.send({ type: 'action', id: 1, seq: seq0, action: { type: 'setStops', player: 'p2', stops } });
    await until(() => c.inbox.some((m) => m['type'] === 'ack' && m['ref'] === 1), 3000, 'the answer');
    expect(c.inbox.find((m) => m['type'] === 'ack')).toMatchObject({ seq: seq0 }); // nothing was applied
    expect(c.views().length).toBe(views);
    c.send({ type: 'action', id: 2, seq: seq0, action: { type: 'concede', player: 'p2' } });
    await until(() => host.state?.result != null, 3000, 'the concession');
    const changed = { ...stops, fullControl: !stops.fullControl };
    c.send({ type: 'action', id: 3, seq: seq0 + 1, action: { type: 'setStops', player: 'p2', stops: changed } });
    await until(() => c.errors().some((e) => e.ref === 3), 3000, 'the refusal');
    expect(c.errors().find((e) => e.ref === 3)).toMatchObject({ code: 'illegalAction', message: expect.stringMatching(/game is over/) });
  });

  it('audit M5: a burst of syncs gets one view now and one when the interval ends', async () => {
    const { c } = await seated({ guestLimits: { syncEveryMs: 200 } });
    await new Promise((r) => setTimeout(r, 250));
    const before = c.views().length;
    for (let i = 0; i < 10; i++) c.send({ type: 'sync' });
    await new Promise((r) => setTimeout(r, 500));
    expect(c.views().length - before).toBe(2);
  });
});
