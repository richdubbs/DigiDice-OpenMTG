/**
 * Host and guest over the in-process link (src/link/memory.ts: no sockets). Covers FXH review finding 1 (a guest's manual ops that name the host's hand
 * cards by their m4 aliases are described to the host unaliased) and FIX-NET gap 1 (after game over the link stays up until a side closes, and a
 * lost link then ends the guest's game instead of reconnecting).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Action } from '@openmtg/engine';
import { autoAction } from '../src/game/autoplay';
import { GameGuest, type GuestOptions } from '../src/game/guest';
import { GameHost, GUEST_MESSAGE_BYTES, GUEST_MESSAGE_DEPTH, type HostOptions, type ManualProposal } from '../src/game/host';
import { MemoryTransport } from '../src/link/memory';
import { deck, FAST_LINK, fixtureDb, until } from './helpers';

const MARKER = 'Abzan Charm';
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function pair(host: Partial<HostOptions> = {}, guest: Partial<GuestOptions> = {}, link = FAST_LINK) {
  const transport = new MemoryTransport({ maxReceiveBytes: GUEST_MESSAGE_BYTES, maxReceiveDepth: GUEST_MESSAGE_DEPTH });
  const h = await GameHost.attach({ name: 'Hana', deck: deck({ Forest: 20, 'Grizzly Bears': 20 }), cards: fixtureDb(), seed: 'memory-1', ...host }, transport);
  cleanups.push(() => h.close('test over', 200));
  const g = await GameGuest.join({
    host: 'memory', port: 0, code: h.code, name: 'Gus', deck: deck({ Mountain: 20, 'Hill Giant': 20 }), link, connector: (o) => transport.connect(o.link), ...guest,
  });
  cleanups.push(() => g.close());
  await until(() => g.view !== null, 5000, 'the first view');
  return { host: h, guest: g, transport };
}

describe('the guest\'s manual adjustments, described to the host (FXH review finding 1, m4 aliases)', () => {
  it('names the host\'s own hand card the guest chose by its alias, and the guest\'s hidden card as hidden, never "an object that is gone" (CR 400.2)', async () => {
    const { host, guest } = await pair(
      { deck: deck({ Forest: 20, [MARKER]: 20 }), gameOptions: { skipMulligans: true } as never },
      { deck: deck({ Mountain: 20, Fork: 20 }) },
    );
    const proposals: ManualProposal[] = [];
    host.on('manualProposal', (p) => proposals.push(p));
    const stepHost = () => {
      const v = host.view();
      if (!v || v.result || v.pending?.player !== 'p1') return;
      const a = autoAction(v, host.legal(), 'p1');
      if (a) host.act(a);
    };
    host.on('view', () => setImmediate(stepHost));
    setImmediate(stepHost);
    // The guest plays Mountains and casts Fork (fully manual in the fixtures) until Fork resolves by hand.
    for (let i = 0; i < 2000 && guest.view!.pending?.kind !== 'manualResolve'; i++) {
      const v = guest.view!;
      if (v.result) break;
      if (v.pending?.player !== 'p2' || guest.seq !== host.seq) {
        await new Promise((r) => setTimeout(r, 2));
        continue;
      }
      let a: Action | null = autoAction(v, guest.legal, 'p2');
      if (v.pending.kind === 'priority') a = (guest.legal.find((l) => l.kind === 'playLand') ?? guest.legal.find((l) => l.kind === 'cast'))?.action ?? a;
      if (a) await guest.act(a);
    }
    const v = guest.view!;
    const d = v.pending!;
    expect(d.kind).toBe('manualResolve');
    // The guest sees the host's hand under aliases (m4): the ids it names are not the host's object ids.
    const alias = v.zones.hand['p1']![0]!;
    expect(host.state!.objects[alias]).toBeUndefined();
    const own = v.zones.hand['p2']![0]!;
    const answer = guest.act({
      type: 'answer', player: 'p2', decisionId: d.id,
      answer: { kind: 'manualResolve', ops: [{ op: 'move', object: alias, to: 'exile' }, { op: 'move', object: own, to: 'graveyard' }] },
    });
    await until(() => proposals.length === 1, 3000, 'the proposal at the host');
    const lines = proposals[0]!.lines;
    expect(lines.join('\n')).not.toMatch(/gone/);
    expect(lines[0]).toBe(`Move ${MARKER} (Hana's hand) to exile.`);
    expect(lines[1]).toBe('Move a hidden card (Gus\'s hand) to graveyard.'); // the host may not learn which card of the guest's hand it is
    // Accepted, the same card moves: applyAction makes the same translation.
    expect(host.answerManual(proposals[0]!.id, true)).toEqual({ ok: true });
    expect(await answer).toEqual({ ok: true });
    const exiled = host.state!.zones.exile.map((id) => host.state!.objects[id]!.defId);
    expect(exiled).toContain(MARKER);
  }, 30000);
});

describe('after game over (FIX-NET gap 1)', () => {
  it('keeps the link up past the idle timeout; the host closing then ends the guest\'s game with the host\'s bye', async () => {
    const { host, guest } = await pair({}, {}, { ...FAST_LINK, idleTimeout: 300, pingInterval: 50 });
    const left: boolean[] = [];
    host.on('guestLeft', (_r, final) => left.push(final));
    const events: string[] = [];
    guest.on('disconnected', (r) => events.push(`disconnected: ${r}`));
    guest.on('closed', (r) => events.push(`closed: ${r}`));
    expect((await guest.act({ type: 'concede', player: 'p2' })).ok).toBe(true);
    await until(() => guest.view?.result != null, 3000, 'the final view');
    await new Promise((r) => setTimeout(r, 900)); // three idle timeouts: pings keep the link up
    expect(guest.connected).toBe(true);
    expect(events).toEqual([]);
    await host.close('the host left the table');
    await until(() => events.length > 0, 3000, 'the guest to notice');
    expect(events).toEqual(['closed: host left: the host left the table']);
    expect(left).toEqual([]);
  });

  it('a link lost after game over ends the guest\'s game at once, without reconnecting', async () => {
    const { guest, transport } = await pair({}, { reconnect: { attempts: 5, delayMs: 50 } }, { ...FAST_LINK, idleTimeout: 300, pingInterval: 50 });
    const events: string[] = [];
    guest.on('disconnected', (r) => events.push(`disconnected: ${r}`));
    guest.on('closed', (r) => events.push(`closed: ${r}`));
    expect((await guest.act({ type: 'concede', player: 'p2' })).ok).toBe(true);
    await until(() => guest.view?.result != null, 3000, 'the final view');
    // The host's side vanishes without a word (a crash): the guest hears nothing until its idle timeout.
    transport.cut('crashed');
    await until(() => events.length > 0, 3000, 'the guest to notice');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatch(/^closed: the link closed after the game ended \(timeout/);
  });

  it('a link lost while the game runs still reconnects (the seat is kept for a resume)', async () => {
    const { host, guest, transport } = await pair({}, { reconnect: { attempts: 20, delayMs: 50 } }, { ...FAST_LINK, idleTimeout: 300, pingInterval: 50 });
    const events: string[] = [];
    guest.on('disconnected', () => events.push('disconnected'));
    guest.on('reconnected', () => events.push('reconnected'));
    transport.cut('crashed');
    await until(() => events.includes('reconnected'), 5000, 'the reconnection');
    expect(events).toEqual(['disconnected', 'reconnected']);
    expect(host.guestConnected).toBe(true);
  });
});
