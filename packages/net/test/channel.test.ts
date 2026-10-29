/** The reliability layer on a simulated wire with a fake clock (docs/design/online.md, "Transport": acks, retransmission, order, fragmentation). */
import { describe, expect, it } from 'vitest';
import { Channel, DEFAULT_LINK_OPTIONS, INITIAL_CWND, MIN_CWND, type LinkOptions } from '../src/link/channel';
import { Flag, FRAGMENT_BYTES, encodePayload } from '../src/wire/frame';
import { noise, SimNet, simPair } from './sim';

const messages = (n: number) => Array.from({ length: n }, (_, i) => ({ i, text: 'x'.repeat((i * 37) % 3000) }));

describe('reliable channel', () => {
  it('delivers messages once and in order on a clean wire', () => {
    const net = new SimNet();
    const { a, b } = simPair(net, {});
    const sent = messages(50);
    for (const m of sent) a.channel.send(m, net.now);
    net.run([a.channel, b.channel], () => b.received.length === sent.length && a.channel.idle, 5000);
    expect(b.received).toEqual(sent);
    expect(a.channel.stats.retransmissions).toBe(0);
    expect(a.dead).toBeNull();
  });

  it('survives loss, duplication and reordering in both directions', () => {
    const net = new SimNet();
    const { a, b } = simPair(net, { loss: 0.2, duplicate: 0.1, delay: 0.3, maxDelayMs: 80, seed: 42 });
    const fromA = messages(150);
    const fromB = messages(80).map((m) => ({ ...m, from: 'b' }));
    for (const m of fromA) a.channel.send(m, net.now);
    for (const m of fromB) b.channel.send(m, net.now);
    net.run([a.channel, b.channel], () => b.received.length === fromA.length && a.received.length === fromB.length && a.channel.idle && b.channel.idle, 60000);
    expect(b.received).toEqual(fromA);
    expect(a.received).toEqual(fromB);
    expect(a.faults.stats.dropped).toBeGreaterThan(0);
    expect(a.faults.stats.duplicated).toBeGreaterThan(0);
    expect(a.faults.stats.delayed).toBeGreaterThan(0);
    expect(a.channel.stats.retransmissions).toBeGreaterThan(0);
    expect(b.channel.stats.duplicates).toBeGreaterThan(0);
    expect(a.dead ?? b.dead).toBeNull();
  });

  it('fragments and reassembles a 500 KB message under 10% loss', () => {
    const net = new SimNet();
    const { a, b } = simPair(net, { loss: 0.1, delay: 0.1, maxDelayMs: 40, seed: 3 });
    const big = { type: 'view', payload: noise(500 * 1024) };
    a.channel.send(big, net.now);
    a.channel.send({ after: true }, net.now);
    net.run([a.channel, b.channel], () => b.received.length === 2, 120000);
    expect(b.received[0]).toEqual(big);
    expect(b.received[1]).toEqual({ after: true });
    // zlib cannot shrink base64-like noise much: hundreds of datagrams
    expect(a.channel.stats.fragmentsSent).toBeGreaterThan((400 * 1024) / FRAGMENT_BYTES);
  });

  it('compresses large repetitive messages (views) before fragmenting them', () => {
    const net = new SimNet();
    const { a, b } = simPair(net, {});
    const view = { objects: Array.from({ length: 2000 }, (_, i) => ({ id: `o${i}`, defId: '__hidden__', zone: 'library', tapped: false })) };
    a.channel.send(view, net.now);
    net.run([a.channel, b.channel], () => b.received.length === 1, 5000);
    expect(b.received[0]).toEqual(view);
    expect(a.channel.stats.fragmentsSent).toBeLessThan(JSON.stringify(view).length / FRAGMENT_BYTES / 5);
  });

  it('declares the peer gone when nothing is heard for idleTimeout, and keeps an idle link alive with pings', () => {
    const net = new SimNet();
    const { a, b } = simPair(net, {}, { idleTimeout: 1000, pingInterval: 200 });
    net.run([a.channel, b.channel], () => false, 5000);
    expect(a.dead ?? b.dead).toBeNull(); // pings kept it alive
    a.faults.config.blackhole = true;
    b.faults.config.blackhole = true;
    const t = net.run([a.channel, b.channel], () => a.dead !== null && b.dead !== null, 5000);
    expect(a.dead).toMatch(/timeout/);
    expect(t).toBeLessThanOrEqual(1100);
  });

  it('tells the other side when closed (bye)', () => {
    const net = new SimNet();
    const { a, b } = simPair(net, {});
    a.channel.close(net.now);
    net.run([a.channel, b.channel], () => b.dead !== null, 1000);
    expect(b.dead).toBe('closed by the other side');
    expect(a.dead).toBeNull(); // close() does not call the dead hook
  });

  it('treats a malformed payload or a fragment out of place as a protocol error', () => {
    const net = new SimNet();
    const { b } = simPair(net, {});
    b.channel.receive(Buffer.from([1, 2]), net.now);
    expect(b.dead).toMatch(/protocol error/);
    const net2 = new SimNet();
    const p2 = simPair(net2, {});
    p2.b.channel.receive(encodePayload({ flags: Flag.Frame, cum: 0, sack: Buffer.alloc(0), frame: { seq: 0, msgId: 1, index: 1, count: 2, data: Buffer.from('x') } }), 0);
    expect(p2.b.dead).toMatch(/fragment out of place/);
  });
  it('retransmits about what was lost: selective acks cover the whole window above the cumulative ack', () => {
    for (const [loss, seed] of [[0.01, 11], [0.05, 12]] as const) {
      const net = new SimNet();
      const { a, b } = simPair(net, { loss, seed }, {}, 40);
      a.channel.send({ text: noise(1_000_000) }, net.now);
      net.run([a.channel, b.channel], () => b.received.length === 1 && a.channel.idle, 600_000);
      expect(b.received).toHaveLength(1);
      const lost = a.faults.stats.dropped;
      expect(lost).toBeGreaterThan(0);
      expect(a.channel.stats.retransmissions).toBeLessThanOrEqual(3 * lost + 5);
      expect(b.channel.stats.duplicates).toBeLessThanOrEqual(2 * lost + 5);
    }
  });

  it('refuses a message larger than the receiver accepts, compressed or not (no inflating bombs)', () => {
    const net = new SimNet();
    const { a, b } = simPair(net, {}, { maxReceiveBytes: 64 * 1024 });
    a.channel.send({ text: 'x'.repeat(200 * 1024) }, net.now); // deflates to a few hundred bytes, inflates past the limit
    net.run([a.channel, b.channel], () => b.dead !== null, 5000);
    expect(b.dead).toMatch(/too large/);
    const net2 = new SimNet();
    const p = simPair(net2, {}, { maxReceiveBytes: 64 * 1024 });
    p.a.channel.send({ text: noise(100 * 1024) }, net2.now); // incompressible: refused by its fragment count
    net2.run([p.a.channel, p.b.channel], () => p.b.dead !== null, 5000);
    expect(p.b.dead).toMatch(/too large/);
    expect(p.b.received).toEqual([]);
  });
});

/**
 * F29: a bottleneck with a small router queue (tail drop): each direction forwards one datagram per `serviceMs` and holds at most `queue` waiting;
 * everything that arrives while the queue is full is dropped. Bursty loss: nothing is lost while the sender stays under the path's capacity.
 */
function bottleneckPair(net: SimNet, o: { serviceMs: number; queue: number; latencyMs: number }, options: Partial<LinkOptions> = {}) {
  const opts: LinkOptions = { ...DEFAULT_LINK_OPTIONS, tickMs: 5, ...options };
  const end = () => ({ received: [] as unknown[], dead: null as string | null, dropped: 0, channel: null as unknown as Channel });
  const a = end();
  const b = end();
  const router = (to: () => ReturnType<typeof end>, from: ReturnType<typeof end>) => {
    let busyUntil = 0;
    return (p: Buffer) => {
      const waiting = Math.max(0, busyUntil - net.now) / o.serviceMs;
      if (waiting >= o.queue) {
        from.dropped++;
        return;
      }
      busyUntil = Math.max(net.now, busyUntil) + o.serviceMs;
      net.schedule(() => to().channel.receive(p, net.now), busyUntil - net.now + o.latencyMs);
    };
  };
  const toB = router(() => b, a);
  const toA = router(() => a, b);
  a.channel = new Channel({ transmit: toB, message: (m) => a.received.push(m), dead: (r) => (a.dead = r) }, opts, net.now);
  b.channel = new Channel({ transmit: toA, message: (m) => b.received.push(m), dead: (r) => (b.dead = r) }, opts, net.now);
  return { a, b };
}

describe('congestion control (F29)', () => {
  it('a bottleneck with a small router queue: the link adapts its window and survives (a fixed window of 128 resent at once timed out)', () => {
    const net = new SimNet();
    // 200 datagrams a second, 6 queued at most, 40 ms each way: about 16 fragments fit the path, 128 never do.
    const { a, b } = bottleneckPair(net, { serviceMs: 5, queue: 6, latencyMs: 40 });
    const big = { payload: noise(400 * 1024) };
    a.channel.send(big, net.now);
    a.channel.send({ after: true }, net.now);
    net.run([a.channel, b.channel], () => (b.received.length === 2 && a.channel.idle) || a.dead !== null || b.dead !== null, 120_000);
    expect(a.dead ?? b.dead).toBeNull();
    expect(b.received).toEqual([big, { after: true }]);
    expect(a.dropped).toBeGreaterThan(0); // the queue did overflow: the window had to come down
    expect(a.channel.congestionWindow).toBeLessThan(DEFAULT_LINK_OPTIONS.window);
    // Retransmissions stay near what the queue dropped (no storm of whole windows resent every tick).
    expect(a.channel.stats.retransmissions).toBeLessThanOrEqual(2 * a.dropped + 10);
  });

  it('the window starts small, grows while the path takes it and stays within its bounds', () => {
    const net = new SimNet();
    const { a, b } = simPair(net, {}, {}, 40);
    expect(a.channel.congestionWindow).toBe(INITIAL_CWND);
    a.channel.send({ text: noise(1_000_000) }, net.now);
    net.run([a.channel, b.channel], () => b.received.length === 1 && a.channel.idle, 600_000);
    expect(a.channel.congestionWindow).toBeGreaterThan(INITIAL_CWND);
    expect(a.channel.congestionWindow).toBeLessThanOrEqual(DEFAULT_LINK_OPTIONS.window);
    expect(a.channel.stats.retransmissions).toBe(0);
    const net2 = new SimNet();
    const p = simPair(net2, { blackhole: true }, { idleTimeout: 60_000 });
    p.a.channel.send({ text: noise(100 * 1024) }, net2.now);
    net2.run([p.a.channel, p.b.channel], () => false, 20_000);
    expect(p.a.channel.congestionWindow).toBe(MIN_CWND);
  });
});
