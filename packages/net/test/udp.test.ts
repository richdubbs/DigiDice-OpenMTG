/**
 * The encrypted UDP link on 127.0.0.1, with normal traffic only: handshake, wrong join code, 500 KB messages over a simulated lossy path, a dead
 * peer. Forged, tampered, replayed and flooding datagrams are tested in process, without sockets (handshake.test.ts, connection.test.ts).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { NetError } from '../src/errors';
import type { Connection } from '../src/link/connection';
import { connect, HostEndpoint } from '../src/link/endpoint';
import { FaultInjector } from '../src/link/faults';
import { generateJoinCode } from '../src/wire/codes';
import { noise } from './sim';

const fast = { tickMs: 5, rtoInitial: 60, rtoMin: 20, rtoMax: 500, pingInterval: 200, idleTimeout: 3000 };
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function hostOn(code: string, faults?: FaultInjector): Promise<{ host: HostEndpoint; conns: Connection[]; received: unknown[] }> {
  const host = await HostEndpoint.listen({ code, port: 0, address: '127.0.0.1', link: fast, ...(faults ? { faults } : {}) });
  cleanups.push(() => host.close());
  const conns: Connection[] = [];
  const received: unknown[] = [];
  host.onConnection((c) => {
    conns.push(c);
    c.onMessage((m) => {
      received.push(m);
      c.send({ echo: m });
    });
  });
  return { host, conns, received };
}

async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('UDP link', () => {
  it('handshakes with the join code and exchanges encrypted messages both ways', async () => {
    const code = generateJoinCode();
    const { host, received } = await hostOn(code);
    const conn = await connect({ host: '127.0.0.1', port: host.port, code: code.toLowerCase(), link: fast });
    cleanups.push(() => conn.close());
    const echoes: unknown[] = [];
    conn.onMessage((m) => echoes.push(m));
    conn.send({ hi: 1 });
    conn.send({ hi: 2 });
    await until(() => echoes.length === 2);
    expect(received).toEqual([{ hi: 1 }, { hi: 2 }]);
    expect(echoes).toEqual([{ echo: { hi: 1 } }, { echo: { hi: 2 } }]);
    expect(host.stats.handshakes).toBe(1);
  });

  it('rejects a wrong join code: the guest cannot authenticate the host, the host never gets a connection', async () => {
    const { host, conns } = await hostOn(generateJoinCode());
    const err = await connect({ host: '127.0.0.1', port: host.port, code: generateJoinCode(), link: fast, handshakeTimeout: 4000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetError);
    expect((err as NetError).code).toBe('badCode');
    expect(conns).toHaveLength(0);
  });

  it('rejects a malformed join code before sending anything', async () => {
    await expect(connect({ host: '127.0.0.1', port: 9, code: 'nope' })).rejects.toMatchObject({ code: 'badCode' });
  });

  it('reports a timeout when nobody answers', async () => {
    await expect(connect({ host: '127.0.0.1', port: 9, code: generateJoinCode(), handshakeTimeout: 300 })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('moves a 500 KB message over a lossy, duplicating, reordering path', async () => {
    const code = generateJoinCode();
    const faults = { loss: 0.05, duplicate: 0.05, delay: 0.1, maxDelayMs: 30 };
    const { host, received } = await hostOn(code, new FaultInjector({ ...faults, seed: 11 }));
    const guestFaults = new FaultInjector({ ...faults, seed: 12 });
    const conn = await connect({ host: '127.0.0.1', port: host.port, code, link: fast, faults: guestFaults, handshakeTimeout: 5000 });
    cleanups.push(() => conn.close());
    const big = { blob: noise(500 * 1024, 99) };
    const echoes: unknown[] = [];
    conn.onMessage((m) => echoes.push(m));
    conn.send(big);
    conn.send({ tail: true });
    await until(() => echoes.length === 2, 30000);
    expect(received[0]).toEqual(big);
    expect(echoes[0]).toEqual({ echo: big });
    expect(echoes[1]).toEqual({ echo: { tail: true } });
    expect(guestFaults.stats.dropped).toBeGreaterThan(0);
    expect(conn.stats.retransmissions).toBeGreaterThan(0);
  }, 40000);

  it('notices a dead peer (no bye) by timeout, and a closed peer at once', async () => {
    const code = generateJoinCode();
    const { host, conns } = await hostOn(code);
    const a = await connect({ host: '127.0.0.1', port: host.port, code, link: { ...fast, idleTimeout: 400 } });
    a.send({ x: 1 });
    await until(() => conns.length === 1);
    const reasons: string[] = [];
    conns[0]!.onClose((r) => reasons.push(r));
    a.destroy();
    await until(() => reasons.length === 1, 5000);
    expect(reasons[0]).toMatch(/timeout/);

    const b = await connect({ host: '127.0.0.1', port: host.port, code, link: fast });
    b.send({ x: 2 });
    await until(() => conns.length === 2);
    const closed: string[] = [];
    conns[1]!.onClose((r) => closed.push(r));
    b.close();
    await until(() => closed.length === 1, 1000);
    expect(closed[0]).toBe('closed by the other side');
  });

  it('joins by host name: tries every address of the name (localhost is ::1 and 127.0.0.1)', async () => {
    const code = generateJoinCode();
    const { host, received } = await hostOn(code); // bound to 127.0.0.1 only
    const conn = await connect({ host: 'localhost', port: host.port, code, link: fast, handshakeTimeout: 4000 });
    cleanups.push(() => conn.close());
    conn.send({ n: 1 });
    await until(() => received.length === 1);
  });

  it('reports a host name that does not resolve as a NetError', async () => {
    await expect(connect({ host: 'nosuchhost.invalid', port: 47620, code: generateJoinCode(), handshakeTimeout: 2000 })).rejects.toMatchObject({ code: 'hostNotFound' });
  }, 20000);
});
