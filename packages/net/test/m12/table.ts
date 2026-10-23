/**
 * M12-5a test helpers: an online table of 3 or 4 players in process (net's MemoryTransport: no sockets: no hostile network testing, normal
 * traffic only). The host and each guest play with the simple automatic player (autoplay.ts); every message a guest receives is kept for the scans of
 * hidden information (CR 400.2).
 */
import { HIDDEN_DEF, type Action, type GameView, type PlayerId } from '@openmtg/engine';
import { autoAction } from '../../src/game/autoplay';
import { GameGuest, type GuestOptions } from '../../src/game/guest';
import { GameHost, GUEST_MESSAGE_BYTES, GUEST_MESSAGE_DEPTH, type HostOptions } from '../../src/game/host';
import { MemoryTransport } from '../../src/link/memory';
import type { DeckSubmission } from '../../src/protocol/messages';
import { deck, FAST_LINK, fixtureDb, until } from '../helpers';

/** Each seat's deck and its marker: a card of a color its lands cannot make, so it is never cast and its name is never public (the bots keep it). */
export const SEATS: { name: string; deck: DeckSubmission; marker: string }[] = [
  { name: 'Hana', deck: deck({ Forest: 16, 'Grizzly Bears': 21, 'Abzan Charm': 3 }), marker: 'Abzan Charm' },
  { name: 'Gus', deck: deck({ Mountain: 16, 'Raging Goblin': 12, 'Hill Giant': 9, 'Chief of the Scale': 3 }), marker: 'Chief of the Scale' },
  { name: 'Bianca', deck: deck({ Plains: 16, 'Elite Vanguard': 21, 'Cuboid Colony': 3 }), marker: 'Cuboid Colony' },
  { name: 'Dana', deck: deck({ Forest: 16, 'Runeclaw Bear': 21, 'Bard Class': 3 }), marker: 'Bard Class' },
];

/** Link timings: a dropped link is noticed within a few hundred milliseconds. */
export const TABLE_LINK = { ...FAST_LINK, pingInterval: 50, idleTimeout: 400 };

export interface Seat {
  player: PlayerId;
  name: string;
  marker: string;
  guest: GameGuest;
  /** Every message this guest received, as it arrived (before parsing). */
  inbox: unknown[];
}

export interface Table {
  host: GameHost;
  transport: MemoryTransport;
  guests: Seat[];
  /** The host UI's views (what the host's page gets). */
  hostViews: GameView[];
  close(): Promise<void>;
}

/**
 * Host a table of `seats` and join every guest seat, in `order` (seat numbers 2..seats; default the reverse: any order works). `decks`: another deck for
 * a seat (by seat number).
 */
export async function openTable(
  seats: 3 | 4,
  o: { host?: Partial<HostOptions>; guest?: Partial<GuestOptions>; order?: number[]; seed?: string; decks?: Record<number, DeckSubmission> } = {},
): Promise<Table> {
  const transport = new MemoryTransport({ maxReceiveBytes: GUEST_MESSAGE_BYTES, maxReceiveDepth: GUEST_MESSAGE_DEPTH });
  const host = await GameHost.attach({ name: SEATS[0]!.name, deck: o.decks?.[1] ?? SEATS[0]!.deck, cards: fixtureDb(), seats, seed: o.seed ?? `m12-table-${seats}`, ...o.host }, transport);
  const hostViews: GameView[] = [];
  host.on('view', (v) => hostViews.push(v));
  const guests: Seat[] = [];
  const order = o.order ?? Array.from({ length: seats - 1 }, (_, i) => seats - i);
  for (const seat of order) guests.push(await joinSeat(host, transport, seat, { ...o.guest, ...(o.decks?.[seat] ? { deck: o.decks[seat] } : {}) }));
  guests.sort((a, b) => a.player.localeCompare(b.player));
  return {
    host, transport, guests, hostViews,
    close: async () => {
      for (const g of guests) await g.guest.close();
      await host.close('test over', 200);
    },
  };
}

/** One guest joins its seat with its seat's code. */
export async function joinSeat(host: GameHost, transport: MemoryTransport, seat: number, extra: Partial<GuestOptions> = {}): Promise<Seat> {
  const s = SEATS[seat - 1]!;
  const inbox: unknown[] = [];
  const code = host.codes.find((c) => c.seat === seat)!.code;
  const guest = await GameGuest.join({
    host: 'memory', port: 0, code, name: s.name, deck: s.deck, link: TABLE_LINK, connector: (g) => transport.connect(g.link, g.code), inspect: (m) => inbox.push(m),
    ...extra,
  });
  return { player: `p${seat}`, name: s.name, marker: s.marker, guest, inbox };
}

/** The bots' action: autoAction, but a card choice (discard to hand size, CR 514.1) keeps the marker cards. */
export function botAction(v: GameView, legal: Parameters<typeof autoAction>[1], me: PlayerId): Action | null {
  let a = autoAction(v, legal, me);
  if (a?.type === 'answer' && a.answer.kind === 'chooseObjects' && v.pending?.kind === 'chooseObjects') {
    const d = v.pending;
    const marker = (id: string) => Number(SEATS.some((s) => s.marker === v.defs[v.objects[id]?.defId ?? '']?.name));
    a = { ...a, answer: { kind: 'chooseObjects', ids: [...d.options].sort((x, y) => marker(x) - marker(y)).slice(0, d.min) } };
  }
  return a;
}

/**
 * Run the bots: the host's on every host view, each guest's on every view it gets (a refused action is retried only once a newer view arrived).
 * `skip`: players whose bot is off (they are driven by the test). Returns a stop function and the problems seen.
 */
export function runBots(t: Table, skip: PlayerId[] = []): { stop(): void; problems: string[] } {
  const problems: string[] = [];
  let stopped = false;
  const offs: (() => void)[] = [];
  const stepHost = () => {
    if (stopped || skip.includes('p1') || t.host.isClosed) return;
    const v = t.host.view();
    if (!v || v.result || v.pending?.player !== 'p1') return;
    const a = botAction(v, t.host.legal(), 'p1');
    if (!a) return;
    const r = t.host.act(a);
    if (!r.ok) problems.push(`host: ${r.error.message}`);
  };
  offs.push(t.host.on('view', () => setImmediate(stepHost)));
  setImmediate(stepHost);
  for (const s of t.guests) {
    if (skip.includes(s.player)) continue;
    let busy = false;
    const step = async () => {
      if (busy || stopped) return;
      busy = true;
      try {
        for (let n = 0; n < 10000 && !stopped; n++) {
          const g = s.guest;
          const v = g.view;
          if (!v || v.result || !g.connected || v.pending?.player !== s.player) return;
          const a = botAction(v, g.legal, s.player);
          if (!a) return;
          const seq = g.seq;
          const r = await g.act(a);
          if (r.ok) continue;
          // Another player's action (a concession, CR 104.3a: any time) moved the game on meanwhile: choose again from the newer view.
          if (g.seq !== seq) continue;
          if (r.error.code !== 'stale' && r.error.code !== 'disconnected') problems.push(`${s.player}: ${r.error.message}`);
          return;
        }
      } finally {
        busy = false;
      }
    };
    offs.push(s.guest.on('view', () => setImmediate(() => void step())));
    offs.push(s.guest.on('reconnected', () => setImmediate(() => void step())));
    setImmediate(() => void step());
  }
  return {
    problems,
    stop: () => {
      stopped = true;
      for (const off of offs) off();
    },
  };
}

/**
 * CR 400.2: a scan of everything a guest received. No other player's marker name appears anywhere in any message (views, events, logs, proposals,
 * notices), and in every view the other players' hand and library cards not revealed to this guest are blank cards. Returns the hidden cards seen.
 */
export function scanInbox(s: Seat, markersOfOthers: string[]): { views: number; hidden: number } {
  let views = 0;
  let hidden = 0;
  for (const raw of s.inbox) {
    const text = JSON.stringify(raw);
    for (const m of markersOfOthers) if (text.includes(m)) throw new Error(`${s.player} received ${m}, another player's hidden card, in: ${text.slice(0, 300)}`);
    const m = raw as { type?: string; view?: GameView; events?: { type: string; player?: string; objectId?: string }[] };
    if (m.type !== 'view' || !m.view) continue;
    views++;
    if (m.view.viewer !== s.player) throw new Error(`${s.player} received the view of ${m.view.viewer}`);
    // NETFIX2 per viewer: another player's draw names no card (UNSEEN_ID), so nothing links it to a card played later.
    for (const e of m.events ?? []) if (e.type === 'drew' && e.player !== s.player && e.objectId !== '') throw new Error(`${s.player} learned the id ${e.objectId} of a card ${e.player} drew`);
    for (const o of Object.values(m.view.objects)) {
      if (o.owner === s.player || (o.zone !== 'hand' && o.zone !== 'library') || o.revealedTo?.includes(s.player)) continue;
      if (o.defId !== HIDDEN_DEF) throw new Error(`${s.player} sees ${o.defId} in ${o.owner}'s ${o.zone}`);
      hidden++;
    }
  }
  return { views, hidden };
}

/** Wait until the game has a result at the host and every connected guest has the final view. */
export async function untilOver(t: Table, ms = 120000): Promise<void> {
  await until(() => t.host.state?.result != null, ms, 'the end of the game');
  await until(() => t.guests.every((g) => !g.guest.connected || g.guest.view?.result != null), 5000, 'the final views');
}

export { until };
