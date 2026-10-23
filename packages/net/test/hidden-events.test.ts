/**
 * NETFIX1 (found by the hosted table, M13-2): the events a seat is sent name another player's hidden hand cards only as that seat's views show them
 * (CR 400.2). `viewFor` shows another player's hidden hand cards under per-viewer aliases (audit m4: an object id tells when the card was drawn, and the
 * same id later links the draw to the card played), so an event that carries the real id of such a card (a `drew` event's `objectId`, a `zoneChanged`
 * event's `oldId` out of a hidden hand) gives back what the view hides.
 *
 * A seeded game played through GameHost and GameGuest over the in-process link (no sockets): both sides play lands, cast every spell they can (loot,
 * discard from a revealed hand, search a library and shuffle) and answer the rest automatically. Every event either seat receives (the guest through the
 * link, the host's own UI through the host's `view` event) is scanned for the real id of a card that was ever in the other player's hand unseen by that
 * seat; such an id may appear only if the seat's view before or after the change shows it (a card revealed to it, CR 701.20b).
 *
 * NETFIX2 (review of NETFIX1): naming such a card by its alias leaked too. A `drew` event that names the drawn card by its alias in the new view tells
 * which card of the hand is the new one (the view itself hides that), and the alias stays the same until the hand changes, so a card leaving the hand
 * under the alias the draw gave it is "the card just drawn"; blank-versus-alias told a fresh card from a held one too. So no event names a card of another
 * player's hand that the seat cannot see, by any id: the correlation check (`named`) takes every id that ever named such a card (its real id, and every
 * alias any view of the seat showed for a hidden card of that hand) and finds none of them in any event, except a card the seat's view shows face up
 * (revealed to it). A second game loots, cycles and casts discard spells on both sides.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { canSee, HIDDEN_DEF, type Action, type GameEvent, type GameState, type GameView, type PlayerId } from '@openmtg/engine';
import { autoAction, type LegalList } from '../src/game/autoplay';
import { GameGuest } from '../src/game/guest';
import { GameHost, GUEST_MESSAGE_BYTES, GUEST_MESSAGE_DEPTH } from '../src/game/host';
import { UNSEEN_ID } from '../src/game/redact';
import { MemoryTransport } from '../src/link/memory';
import { deck, FAST_LINK, fixtureDb, until } from './helpers';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

/** Loot, discard from a revealed hand, search a library (reveal, shuffle), draw on entering; both players play the same list. */
const LIST = { Swamp: 9, Mountain: 9, Forest: 6, 'Faithless Looting': 4, Pilfer: 3, "Marshals' Pathcruiser": 6, 'Elvish Visionary': 3 };
/** NETFIX2: discards every way: loot, cycle and landcycle (a discard cost, CR 702.29a), discard from a revealed hand (Pilfer), exile from one. */
const DISCARD_LIST = { Swamp: 10, Mountain: 9, Island: 3, 'Faithless Looting': 4, Pilfer: 4, 'Intimidation Tactics': 4, 'Giant Koi': 4, 'Elvish Visionary': 2 };
const TURNS = 12;

/** A land, else a cycling ability, else any spell, else the automatic player; a choice of cards takes one when it may (a search that finds something). */
function choose(view: GameView, legal: LegalList, me: PlayerId): Action | null {
  const d = view.pending;
  if (!d || d.player !== me || view.result) return null;
  if (d.kind === 'priority') {
    const casts = legal.filter((l) => l.kind === 'cast');
    const named = (l: (typeof casts)[number]) => view.defs[view.objects[l.object ?? '']?.defId ?? '']?.name ?? '';
    const cycle = legal.find((l) => l.kind === 'activate' && /cycling/i.test(l.label));
    const pick = legal.find((l) => l.kind === 'playLand') ?? cycle ?? casts.find((l) => named(l) === "Marshals' Pathcruiser") ?? casts[0];
    if (pick) return pick.action;
  }
  // one mulligan each (CR 103.5): the engine re-runs the mulligan stage from its start on each answer, and the earlier hands' draws must not be sent again
  if (d.kind === 'mulligan') return { type: 'answer', player: me, decisionId: d.id, answer: { kind: 'mulligan', keep: d.mulligans >= 1 } };
  if (d.kind === 'chooseObjects' && d.max > 0 && d.options.length > 0) {
    return { type: 'answer', player: me, decisionId: d.id, answer: { kind: 'chooseObjects', ids: d.options.slice(0, Math.max(d.min, 1)) } };
  }
  return autoAction(view, legal, me);
}

/** Every string in a value (events are plain JSON). */
function strings(x: unknown, out: string[] = []): string[] {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) for (const v of x) strings(v, out);
  else if (x && typeof x === 'object') for (const v of Object.values(x)) strings(v, out);
  return out;
}

/** The ids of cards `other` held in hand unseen by `viewer` in any of `states` (in the hand, or last known as having left it). */
function hiddenHandIds(states: Iterable<GameState>, viewer: PlayerId, other: PlayerId): Set<string> {
  const out = new Set<string>();
  for (const s of states) {
    for (const id of s.zones.hand[other] ?? []) if (s.objects[id] && !canSee(s, s.objects[id]!, viewer)) out.add(id);
    for (const [id, l] of Object.entries(s.lki)) if (l.leftZone === 'hand' && l.object.owner === other && !l.object.revealedTo?.includes(viewer)) out.add(id);
  }
  return out;
}

/** The ids of cards of `other`'s hand that `viewer` was ever shown (revealed to it, CR 701.20b): in the hand, or last known as having left it. */
function revealedHandIds(states: Iterable<GameState>, viewer: PlayerId, other: PlayerId): Set<string> {
  const out = new Set<string>();
  for (const s of states) {
    for (const id of s.zones.hand[other] ?? []) if (s.objects[id] && canSee(s, s.objects[id]!, viewer)) out.add(id);
    for (const [id, l] of Object.entries(s.lki)) if (l.leftZone === 'hand' && l.object.owner === other && l.object.revealedTo?.includes(viewer)) out.add(id);
  }
  return out;
}

/** Every string of a value with where it is (keys too: an object's id is its key in `objects`). */
function stringsAt(x: unknown, path: string, out: [string, string][]): void {
  if (typeof x === 'string') out.push([path, x]);
  else if (Array.isArray(x)) x.forEach((v, i) => stringsAt(v, `${path}[${i}]`, out));
  else if (x && typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) {
      out.push([`${path} key`, k]);
      stringsAt(v, `${path}.${k}`, out);
    }
  }
}

interface Received {
  seq: number;
  view: GameView;
  events: GameEvent[];
}

/** The leaks in what a seat received: real hidden hand ids in events that neither the view before nor the view after the change shows. */
function leaks(received: readonly Received[], hidden: ReadonlySet<string>): string[] {
  const out: string[] = [];
  received.forEach((r, i) => {
    const shown = new Set([...Object.keys(r.view.objects), ...Object.keys(received[i - 1]?.view.objects ?? {})]);
    for (const e of r.events) {
      for (const s of strings(e)) if (hidden.has(s) && !shown.has(s)) out.push(`seq ${r.seq}: ${e.type} names ${s}: ${JSON.stringify(e).slice(0, 160)}`);
    }
  });
  return out;
}

/**
 * NETFIX2 correlation check: every id that ever named a card of `other`'s hand hidden from the seat (`hidden`: the real ids; and every alias the seat's
 * views showed for a hidden card of that hand) must appear in no event, unless the seat's view before or after that change shows the card face up by that
 * id (revealed to the seat, CR 701.20b).
 */
function named(received: readonly Received[], hidden: ReadonlySet<string>, other: PlayerId): string[] {
  const names = new Set(hidden);
  for (const r of received) for (const id of r.view.zones.hand[other] ?? []) if (r.view.objects[id]?.defId === HIDDEN_DEF) names.add(id);
  const faceUp = (v: GameView | undefined) => Object.values(v?.objects ?? {}).filter((o) => o.defId !== HIDDEN_DEF).map((o) => o.id);
  const out: string[] = [];
  received.forEach((r, i) => {
    const shown = new Set([...faceUp(r.view), ...faceUp(received[i - 1]?.view)]);
    for (const e of r.events) {
      for (const s of strings(e)) if (names.has(s) && !shown.has(s)) out.push(`seq ${r.seq}: ${e.type} names ${s}: ${JSON.stringify(e).slice(0, 160)}`);
    }
  });
  return out;
}

/**
 * NETFIX2 re-review: the views too. Every string of every view the seat received (stack objects and their `sourceId`, last known information, event
 * contexts of triggers, history...) is scanned for the real id of a card of `other`'s hand that was hidden from the seat and never revealed to it.
 */
function inViews(received: readonly Received[], states: readonly GameState[], viewer: PlayerId, other: PlayerId): string[] {
  const revealed = revealedHandIds(states, viewer, other);
  const hidden = new Set([...hiddenHandIds(states, viewer, other)].filter((id) => !revealed.has(id)));
  const out: string[] = [];
  for (const r of received) {
    const found: [string, string][] = [];
    stringsAt(r.view, 'view', found);
    for (const [path, s] of found) if (hidden.has(s)) out.push(`seq ${r.seq} ${path} = ${s}`);
  }
  return out;
}

interface Played {
  hostGot: Received[];
  guestGot: Received[];
  states: GameState[];
}

/** A seeded game of `list` against itself, played through GameHost and GameGuest over the in-process link for about `TURNS` turns. */
async function playOnline(list: Record<string, number>, seed: string): Promise<Played> {
  const transport = new MemoryTransport({ maxReceiveBytes: GUEST_MESSAGE_BYTES, maxReceiveDepth: GUEST_MESSAGE_DEPTH });
  const host = await GameHost.attach({ name: 'Hana', deck: deck(list), cards: fixtureDb(), seed }, transport);
  cleanups.push(() => host.close('test over', 200));
  const states = new Map<number, GameState>();
  const hostGot: Received[] = [];
  host.on('view', (view, events) => {
    states.set(host.seq, host.state!);
    hostGot.push({ seq: host.seq, view, events });
  });
  const guest = await GameGuest.join({
    host: 'memory', port: 0, code: host.code, name: 'Gus', deck: deck(list), link: FAST_LINK, connector: (o) => transport.connect(o.link),
  });
  cleanups.push(() => guest.close());
  const guestGot: Received[] = [];
  guest.on('view', (view, events) => guestGot.push({ seq: guest.seq, view, events }));
  await until(() => guest.view !== null, 5000, 'the first view');

  const stepHost = () => {
    const v = host.view();
    if (!v || v.result || v.pending?.player !== 'p1' || (host.state?.turn.number ?? 0) > TURNS) return;
    const a = choose(v, host.legal(), 'p1');
    if (a) host.act(a);
  };
  host.on('view', () => setImmediate(stepHost));
  setImmediate(stepHost);
  for (let i = 0; i < 20000; i++) {
    const s = host.state!;
    if (s.result || s.turn.number > TURNS) break;
    const v = guest.view!;
    if (v.pending?.player !== 'p2' || guest.seq !== host.seq) {
      await new Promise((r) => setTimeout(r, 1));
      continue;
    }
    const a = choose(v, guest.legal, 'p2');
    if (a) await guest.act(a);
  }
  await until(() => guest.seq === host.seq, 3000, 'the guest to catch up');
  return { hostGot, guestGot, states: [...states.values()] };
}

/** The kinds of events a seat received (`from>to` for a move). */
const kinds = (got: Received[]) => new Set(got.flatMap((r) => r.events.map((e) => (e.type === 'zoneChanged' ? `${e.from}>${e.to}` : e.type))));

describe('NETFIX1: events name hidden hand cards only by the seat\'s own aliases (CR 400.2, audit m4)', () => {
  it('a seeded online game: no event either seat receives carries the real id of a card hidden in the other hand', async () => {
    const { hostGot, guestGot, states: all } = await playOnline(LIST, 'netfix1-hidden-events');
    expect(all.at(-1)!.turn.number).toBeGreaterThan(TURNS - 2); // the game got somewhere

    // The scan is not vacuous: the game drew, looted, discarded from hands and searched a library, on both sides.
    const seen = new Set([...kinds(guestGot), ...kinds(hostGot)]);
    for (const t of ['drew', 'hand>graveyard', 'hand>stack', 'library>hand', 'shuffled']) expect([...seen], [...seen].join(' ')).toContain(t);
    const p1Hidden = hiddenHandIds(all, 'p2', 'p1');
    const p2Hidden = hiddenHandIds(all, 'p1', 'p2');
    expect(p1Hidden.size).toBeGreaterThan(10);
    expect(p2Hidden.size).toBeGreaterThan(10);
    // Pilfer revealed a hand (CR 701.20b): those cards were shown by their ids, then hidden again
    const revealed = (viewer: PlayerId, other: PlayerId) => all.some((s) => (s.zones.hand[other] ?? []).some((id) => s.objects[id]?.revealedTo?.includes(viewer)));
    expect(revealed('p2', 'p1') || revealed('p1', 'p2')).toBe(true);
    // both mulliganed (CR 103.5); the answer's re-run of the mulligan stage repeats the draws of the hands before it, which no seat is sent twice (engine
    // `replayedEvents`: a draw animated again was the same bug as a trigger animated again after the cleanup's discard)
    for (const p of ['p1', 'p2']) expect(guestGot.some((r) => r.events.some((e) => e.type === 'mulligan' && e.player === p))).toBe(true);
    const replayed = (got: Received[], other: PlayerId) => got.some((r) => r.events.filter((e) => e.type === 'drew' && e.player === other).length > 7);
    expect(replayed(guestGot, 'p1') || replayed(hostGot, 'p2')).toBe(false);

    expect(leaks(guestGot, p1Hidden)).toEqual([]);
    expect(leaks(hostGot, p2Hidden)).toEqual([]);
    // NETFIX2: nor by an alias; and no view names them either
    expect(named(guestGot, p1Hidden, 'p1')).toEqual([]);
    expect(named(hostGot, p2Hidden, 'p2')).toEqual([]);
    expect(inViews(guestGot, all, 'p2', 'p1')).toEqual([]);
    expect(inViews(hostGot, all, 'p1', 'p2')).toEqual([]);

    // NETFIX2: another player's draw, and a card leaving their hand that the seat could not see, name no card at all (UNSEEN_ID every time); the board
    // animates them to and from that player's hand (packages/client fx). A card revealed to the seat keeps its id.
    for (const [got, other] of [[guestGot, 'p1'], [hostGot, 'p2']] as const) {
      let draws = 0;
      let departures = 0;
      got.forEach((r, i) => {
        for (const e of r.events) {
          if (e.type === 'drew' && e.player === other && !e.commandZone) {
            expect(e.objectId).toBe(UNSEEN_ID);
            draws++;
          }
          if (e.type === 'zoneChanged' && e.from === 'hand' && e.owner === other && i > 0) {
            const was = got[i - 1]!.view.objects[e.oldId];
            if (was && was.defId !== HIDDEN_DEF) continue; // revealed to the seat: shown by its id
            expect(e.oldId).toBe(UNSEEN_ID);
            departures++;
          }
        }
      });
      expect(draws).toBeGreaterThan(3);
      expect(departures).toBeGreaterThan(3);
    }
  }, 120000);

  // rv3-b and rv3-c: the re-review's seeds (a landcycling ability on the stack named the card's hand id as its `sourceId`, in the view and its LKI)
  it.each(['netfix2-discards', 'rv3-b', 'rv3-c'])('NETFIX2: a game of looting, cycling and discard spells (%s): no event and no view names a card hidden in the other hand, by any id', async (seed) => {
    const { hostGot, guestGot, states: all } = await playOnline(DISCARD_LIST, seed);
    expect(all.at(-1)!.turn.number).toBeGreaterThan(TURNS - 2);
    // Not vacuous: each seat saw the other discard several times, and cards were cycled.
    const discarded = (got: Received[], other: PlayerId) =>
      got.filter((r) => r.events.some((e) => e.type === 'zoneChanged' && e.from === 'hand' && e.to === 'graveyard' && e.owner === other)).length;
    expect(discarded(guestGot, 'p1') + discarded(hostGot, 'p2')).toBeGreaterThan(2);
    const cycled = all.at(-1)!.history.filter((e) => e.ev === 'action' && e.facts['verb'] === 'cycle').length;
    expect(cycled).toBeGreaterThan(0);
    const p1Hidden = hiddenHandIds(all, 'p2', 'p1');
    const p2Hidden = hiddenHandIds(all, 'p1', 'p2');
    expect(leaks(guestGot, p1Hidden)).toEqual([]);
    expect(leaks(hostGot, p2Hidden)).toEqual([]);
    expect(named(guestGot, p1Hidden, 'p1')).toEqual([]);
    expect(named(hostGot, p2Hidden, 'p2')).toEqual([]);
    expect(inViews(guestGot, all, 'p2', 'p1')).toEqual([]);
    expect(inViews(hostGot, all, 'p1', 'p2')).toEqual([]);
  }, 120000);
});
