/**
 * Send-side bounds of the reliable channel (audit 2026-10-12, M5) on the simulated wire with a fake clock (sim.ts, in process): a message keyed
 * `replace` supersedes an unsent one with the same key, and a send queue past `maxSendQueueBytes` (a peer that stops reading) ends the channel.
 */
import { describe, expect, it } from 'vitest';
import { noise, SimNet, simPair } from './sim';

describe('channel send queue (audit M5)', () => {
  it('a newer message with the same replace key drops the unsent older one; one already on the wire is kept', () => {
    const net = new SimNet();
    const { a, b } = simPair(net, {}, { window: 1 });
    a.channel.send({ n: 'first' }, net.now, { replace: 'view' }); // goes out at once (the window has room)
    a.channel.send({ n: 'other' }, net.now);
    a.channel.send({ n: 'view 1' }, net.now, { replace: 'view' });
    a.channel.send({ n: 'view 2' }, net.now, { replace: 'view' });
    net.run([a.channel, b.channel], () => a.channel.idle, 5000);
    expect(b.received).toEqual([{ n: 'first' }, { n: 'other' }, { n: 'view 2' }]);
    expect(a.channel.queued).toBe(0);
  });

  it('a peer that stops acknowledging cannot make the send queue grow without bound', () => {
    const net = new SimNet();
    const { a } = simPair(net, { loss: 1 }, { maxSendQueueBytes: 64 * 1024 });
    for (let i = 0; i < 200 && !a.dead; i++) a.channel.send({ blob: noise(2048, i + 1) }, net.now);
    expect(a.dead).toMatch(/send queue overflow/);
    expect(() => a.channel.send({ more: 1 }, net.now)).toThrow(/closed/);
  });
});
