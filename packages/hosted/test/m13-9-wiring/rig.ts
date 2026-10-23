/**
 * Test rig for matchmaking wired into the gateway (M13-13 part B; in process, a fake clock, no sockets): the gateway of M13-6's harness with a
 * `MatchmakingService` as its `MatchService`, capacity admission (the real `CapacityAdmission` on fake signals, behind `MatchAdmission` as main.ts wires
 * it), a memory store and a fake runtime that, like the real one, moves the game to 'running' in the store and delivers its first messages inside `start`.
 * Time moves only when a test says so (`step`); the gateway's and the service's timers are driven by hand.
 */
import { CapacityAdmission } from '../../src/admission/queue';
import type { Admission, CapacitySignals, SignalSource } from '../../src/admission/api';
import { MatchAdmission, MatchmakingService, type MatchTiming } from '../../src/match/service';
import type { GatewayOptions } from '../../src/gateway/gateway';
import { MemoryMetrics } from '../../src/obs';
import type { StartGameRequest, StartGameResult } from '../../src/runtime/api';
import type { GameStore } from '../../src/store/api';
import { MemoryStore } from '../../src/store';
import type { SeatSend } from '../../src/table/types';
import { FakeRuntime, freshPeer, guest, makeGateway, settle, testConfig, TEST_DECK, type Browser, type TestGateway } from '../m13-6/harness';
import type { InProcessClient } from '../../src/gateway/in-process';

export class FakeSignals implements SignalSource {
  s: CapacitySignals = { runningUnits: 0, cpu: 0, p95ActionMs: null, workerHeap: 0, outbound: 0 };
  read(): CapacitySignals {
    return { ...this.s };
  }
}

/** The runtime of the real server in the one way matchmaking cares about: `start` writes the game's start to the store and delivers inside the call. */
export class MatchRuntime extends FakeRuntime {
  /** The messages delivered inside `start`, as the real runtime delivers the first step. */
  readonly delivered: { game: string; sends: SeatSend[] }[] = [];
  /** A start waits for this before it writes anything (a runtime that takes its time). */
  hold: Promise<void> | null = null;

  constructor(private readonly store: GameStore, private readonly deliver: (game: string, sends: SeatSend[]) => void, private readonly startedAt: () => number) {
    super();
  }

  override async start(req: StartGameRequest): Promise<StartGameResult> {
    if (this.hold) await this.hold;
    const r = await super.start(req);
    if (!r.ok) return r;
    await this.store.startGame(req.game, {
      config: { players: req.seats.map((s, i) => ({ id: `p${i + 1}`, name: s.name, deck: [] })), defs: [] } as never, seed: 'seed', seating: req.seats.map((s) => s.seat),
      engineBuild: 'build-test', rulesPack: null, startedAt: new Date(this.startedAt()), node: null,
    });
    const players = req.seats.map((s, i) => ({ id: `p${i + 1}`, name: s.name, seat: s.seat }));
    const sends: SeatSend[] = req.seats
      .filter((s) => (req.connected ?? req.seats.map((x) => x.seat)).includes(s.seat))
      .map((s) => ({ seat: s.seat, t: 'start', json: JSON.stringify({ t: 'start', table: req.game, players }) }));
    this.delivered.push({ game: req.game, sends });
    this.deliver(req.game, sends);
    return r;
  }
}

export interface MatchRig extends TestGateway {
  service: MatchmakingService;
  routed: MatchAdmission;
  signals: FakeSignals;
  matchRuntime: MatchRuntime;
  /** `CapacityAdmission` behind the router. */
  capacity: CapacityAdmission;
  /** Moves the clock by `ms`, runs the service's and the gateway's tick, lets the asynchronous work finish; keeps every browser connection alive. */
  step(ms?: number): Promise<void>;
  /** Connections kept alive by `step`. */
  connections: Set<Browser<InProcessClient>>;
  /** A guest from its own address key, connected and kept alive. */
  player(name: string, o?: { peer?: string }): Promise<Browser<InProcessClient>>;
}

export interface MatchRigOptions {
  /** Capacity units (default 100: nothing waits). */
  capacityUnits?: number;
  /** Replaces capacity admission (a scripted one). */
  admission?: Admission;
  timing?: Partial<MatchTiming>;
  env?: Record<string, string>;
  gateway?: Partial<GatewayOptions>;
}

export async function makeMatchRig(o: MatchRigOptions = {}): Promise<MatchRig> {
  let t: TestGateway | null = null;
  const signals = new FakeSignals();
  const metrics = new MemoryMetrics();
  const store = new MemoryStore();
  let routed: MatchAdmission | null = null;
  let service: MatchmakingService | null = null;
  const capacity = new CapacityAdmission({
    signals, limits: { capacityUnits: o.capacityUnits ?? 100 }, timing: { paceEveryMs: 0 }, metrics,
    onEvents: (e) => routed?.dispatch(e, (others) => t?.gateway.tables.admissionEvents(others)),
  });
  routed = new MatchAdmission(o.admission ?? capacity);
  const clockNow = (): number => t!.clock.now();
  const runtime = new MatchRuntime(store, (game, sends) => {
    if (!service!.intercept(game, sends)) t!.gateway.events.deliver(game, sends);
  }, clockNow);
  const env = { PODS_ENABLED: '0', ...o.env };
  service = new MatchmakingService({
    config: testConfig(env), store, runtime, admission: routed, ledgerSecret: 'a'.repeat(64), now: clockNow, metrics,
    tables: {
      busyIn: (s) => t!.gateway.tables.busyIn(s),
      adopt: (g) => t!.gateway.tables.adopt(g),
      connected: (s) => t!.gateway.tables.connected(s),
      disconnected: (s) => t!.gateway.tables.disconnected(s),
    },
    deliver: (g, s) => t!.gateway.events.deliver(g, s),
    foreign: (e) => t!.gateway.tables.admissionEvents(e),
    timing: o.timing ?? {},
  });
  routed.owner = service;
  const made = makeGateway({ env, store, admission: routed, runtime, metrics, hooks: { match: service }, ...o.gateway });
  t = made;
  const connections = new Set<Browser<InProcessClient>>();
  const rig: MatchRig = {
    ...made,
    metrics,
    service,
    routed,
    signals,
    matchRuntime: runtime,
    capacity,
    connections,
    async step(ms = 1_000) {
      made.clock.advance(ms);
      for (const b of connections) if (!b.client.closed) b.client.pong();
      service!.tick(made.clock.now());
      made.gateway.tick(made.clock.now());
      await settle();
    },
    async player(name, po = {}) {
      const b = await guest(made, name, { peer: po.peer ?? freshPeer() });
      connections.add(b);
      return b;
    },
  };
  return rig;
}

/** The queue command's decks: any deck the fake runtime accepts. */
export const DECK = TEST_DECK;

/** `queue` for a browser: the reply. */
export function enqueue(b: Browser, o: Record<string, unknown> = {}): ReturnType<Browser['cmd']> {
  return b.cmd({ t: 'queue', format: 'casual', size: 2, deck: DECK, ...o });
}

/** Confirms the browser's latest ready check. */
export async function confirm(b: Browser): Promise<ReturnType<Browser['cmd']>> {
  await b.client.until(() => b.last('readyCheck') !== undefined);
  return b.cmd({ t: 'ready', start: b.last('readyCheck')!.start });
}

/** How many different ready checks the browser has been shown (each confirmation sends the check again, with the same id). */
export function rounds(b: Browser): number {
  return new Set(b.of('readyCheck').map((m) => m.start)).size;
}

/** The player's connection drops (the transport reports it; the service notices at its next tick). */
export async function drop(b: Browser<InProcessClient>): Promise<void> {
  b.client.close();
  await settle();
}
