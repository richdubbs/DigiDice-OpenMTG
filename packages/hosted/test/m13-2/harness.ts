/**
 * Test harness for the table actor (in process, fake time only, no sockets). It plays the browsers: each seat keeps the view it was sent and applies
 * patches to it as a browser does (`nextView`), and after every step the harness checks that each connected seat's view is exactly its `viewFor` of the
 * table's state (patch equality), that every patch fitted its base, and runs the hidden-information scan on every byte sent to each seat.
 */
import { expect } from 'vitest';
import { applyAction, canSee, createGame, viewFor, type Action, type CardDef, type GameConfig, type GameState, type GameView, type LegalAction, type PlayerId } from '@openmtg/engine';
import { chooseAction } from '@openmtg/ai';
import { nextView, type HostedServerMessage, type SeatNumber } from '@openmtg/hosted/api';
import type { LogRecord } from '../../src/store/api';
import { TableActor, type TableCommand, type TableOptions, type TableStep } from '../../src/table';
import { DECKS, expand, gameConfig, type DeckList } from '../../../ai/test/decks';
import { compiledDefs } from '../../../engine/test/fixtures';

export const SEC = 1_000;
export const MIN = 60_000;

export type Msg = HostedServerMessage;

export interface Browser {
  seat: SeatNumber;
  player: PlayerId;
  seq: number;
  view: GameView | null;
  legal: LegalAction[];
  /** Every message received, parsed, in order. */
  inbox: Msg[];
  /** Every JSON text received (the hidden-information scan reads these). */
  raw: string[];
  nextId: number;
  /** Card names this seat has been shown (the defs of every view it held), for the hidden-name scan. */
  known: Set<string>;
  /** Every id that was ever another player's hidden hand card (from the full game, events included: drawn, moved out of the hand). */
  everHidden: Set<string>;
  /** Ids this seat has been shown as a visible object (not a library blank, not another player's hand card). */
  seen: Set<string>;
}

export interface HarnessOptions extends Partial<TableOptions> {
  config: GameConfig;
  at?: number;
  /** Run the hidden-information scan on every send (default true). */
  scan?: boolean;
  connected?: SeatNumber[];
}

/** A config from two deck lists (AI test decks or hand-made), players p1 and p2, no mulligans unless asked. */
export function configOf(seed: string, d1: DeckList, d2: DeckList, opts: { mulligans?: boolean } = {}): GameConfig {
  return gameConfig(seed, d1, d2, { mulligans: opts.mulligans ?? true });
}

/** A config from card counts (fixture cards), skipping mulligans: `{ Mountain: 20, 'Lightning Bolt': 20 }`. */
export function fixtureConfig(seed: string, a: Record<string, number>, b: Record<string, number>): GameConfig {
  const list = (d: Record<string, number>): DeckList => Object.entries(d);
  const names = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const defs: CardDef[] = compiledDefs(names);
  return {
    seed,
    players: [
      { name: 'One', deck: expand(list(a)) },
      { name: 'Two', deck: expand(list(b)) },
    ],
    defs,
    options: { skipMulligans: true },
  };
}

export { DECKS };

export class Harness {
  readonly actor: TableActor;
  readonly steps: TableStep[] = [];
  readonly records: LogRecord[] = [];
  readonly browsers = new Map<SeatNumber, Browser>();
  at: number;
  private readonly scan: boolean;
  /** Every send, in order, as `seat:json` (determinism checks). */
  readonly transcript: string[] = [];
  /** Events checked by `checkHandEvents` (a cast or land from another player's hidden hand, a draw of theirs). */
  oldIdChecks = 0;
  /** The game replayed from the records with the raw (unredacted) events, for the hidden-id scan. */
  private replay: GameState;

  /** Adds to each seat's `everHidden` the other players' hidden hand cards of `state` and the cards the raw `events` drew or took out of a hand. */
  private noteHidden(state: GameState, events: readonly import('@openmtg/engine').GameEvent[]): void {
    for (const b of this.browsers.values()) {
      for (const p of state.players) {
        if (p.id === b.player) continue;
        for (const id of state.zones.hand[p.id] ?? []) if (state.objects[id] && !canSee(state, state.objects[id]!, b.player)) b.everHidden.add(id);
      }
      for (const e of events) {
        if (e.type === 'drew' && e.player !== b.player) b.everHidden.add(e.objectId);
        if (e.type === 'zoneChanged' && e.from === 'hand' && e.owner !== b.player) b.everHidden.add(e.oldId);
      }
    }
  }

  constructor(o: HarnessOptions) {
    this.at = o.at ?? 0;
    this.scan = o.scan ?? true;
    const seating = o.seating ?? ([1, 2] as SeatNumber[]);
    const { actor, step } = TableActor.start({ ...o, game: o.game ?? 'g-test', seating, at: this.at, ...(o.connected ? { connected: o.connected } : {}) });
    this.actor = actor;
    actor.state.players.forEach((p, i) => {
      const seat = seating[i]!;
      this.browsers.set(seat, { seat, player: p.id, seq: -1, view: null, legal: [], inbox: [], raw: [], nextId: 1, known: new Set(), everHidden: new Set(), seen: new Set() });
    });
    this.replay = createGame(o.config);
    this.noteHidden(this.replay, []);
    this.take(step);
  }

  get state(): GameState {
    return this.actor.state;
  }

  b(seat: number): Browser {
    return this.browsers.get(seat as SeatNumber)!;
  }

  seatOf(player: PlayerId): SeatNumber {
    return [...this.browsers.values()].find((b) => b.player === player)!.seat;
  }

  cmd(c: TableCommand): TableStep {
    const step = this.actor.handle(c);
    this.take(step);
    return step;
  }

  /** `act` from a seat's browser, with its current seq unless given. Returns the step and the reply to it (if any). */
  act(seat: number, action: Action, o: { at?: number; seq?: number; id?: number } = {}): { step: TableStep; reply: Extract<Msg, { t: 'reply' }> | undefined } {
    const b = this.b(seat);
    const id = o.id ?? b.nextId++;
    if (o.at !== undefined) this.at = o.at;
    const step = this.cmd({ t: 'act', seat: seat as SeatNumber, at: this.at, id, seq: o.seq ?? b.seq, action });
    return { step, reply: replyIn(step, seat, id) };
  }

  /** Messages of one type a seat received in a step. */
  sent<T extends Msg['t']>(step: TableStep, seat: number, t: T): Extract<Msg, { t: T }>[] {
    return step.sends.filter((s) => s.seat === seat && s.t === t).map((s) => JSON.parse(s.json) as Extract<Msg, { t: T }>);
  }

  private take(step: TableStep): void {
    this.steps.push(step);
    for (const r of step.records) {
      const last = this.records[this.records.length - 1];
      expect(r.seq, 'records in seq order').toBe((last?.seq ?? 0) + 1);
      this.records.push(r);
      const out = applyAction(this.replay, r.action);
      this.replay = out.state;
      this.noteHidden(out.state, out.events);
    }
    const touched = new Set<SeatNumber>();
    for (const s of step.sends) {
      this.transcript.push(`${s.seat}:${s.json}`);
      const b = this.browsers.get(s.seat)!;
      const m = JSON.parse(s.json) as Msg;
      expect(m.t).toBe(s.t);
      b.inbox.push(m);
      b.raw.push(s.json);
      if (m.t === 'view') {
        this.oldIdChecks += checkHandEvents(b, b.view, m.view, m.events);
        b.view = m.view;
        b.seq = m.seq;
        b.legal = m.legal;
        touched.add(b.seat);
      } else if (m.t === 'patch') {
        const next = nextView(b.view ? { seq: b.seq, view: b.view } : null, m);
        expect(next, `seat ${b.seat}: the patch ${m.base}->${m.seq} fits the view it holds (${b.seq})`).not.toBeNull();
        // Events never name another player's hidden hand card (M13-2 re-review A).
        this.oldIdChecks += checkHandEvents(b, b.view, next!.view, m.events);
        b.view = next!.view;
        b.seq = next!.seq;
        b.legal = m.legal;
        touched.add(b.seat);
      }
    }
    for (const seat of touched) {
      const b = this.browsers.get(seat)!;
      // Patch equality: what the browser rebuilt is exactly this seat's view of the table's state (design 6.3).
      expect(JSON.stringify(b.view), `seat ${seat}: the rebuilt view is the next view`).toBe(JSON.stringify(viewFor(this.state, b.player)));
      expect(b.seq).toBe(this.actor.seq);
      for (const d of Object.values(b.view!.defs)) b.known.add(d.name);
      for (const [id, o] of Object.entries(b.view!.objects)) if (o.zone !== 'library' && (o.zone !== 'hand' || o.owner === b.player)) b.seen.add(id);
    }
    if (this.scan) for (const s of step.sends) scanHidden(this.state, this.browsers.get(s.seat)!, s.json);
  }
}

/** The reply to a command id in a step's sends to a seat. */
export function replyIn(step: TableStep, seat: number, id: number): Extract<Msg, { t: 'reply' }> | undefined {
  for (const s of step.sends) {
    if (s.seat !== seat || s.t !== 'reply') continue;
    const m = JSON.parse(s.json) as Extract<Msg, { t: 'reply' }>;
    if (m.id === id) return m;
  }
  return undefined;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The hidden-information scan (design 6.4, table level): a payload sent to seat X never carries the real object id of another seat's hidden hand card
 * (views alias them, m4), the name of a hidden card of another seat that X was never shown, the seed, the RNG state or a suspended action.
 */
export function scanHidden(state: GameState, b: Browser, text: string): void {
  expect(text.includes(state.seed), 'the seed never leaves the table').toBe(false);
  expect(text.includes('"suspended"'), 'no suspended action').toBe(false);
  expect(text.includes('"rng"'), 'no RNG state').toBe(false);
  for (const id of b.everHidden) {
    if (!b.seen.has(id)) expect(text.includes(`"${id}"`), `seat ${b.seat} got the real id ${id} of another player's hidden hand card (now or before)`).toBe(false);
  }
  const names = new Set<string>();
  for (const p of state.players) {
    if (p.id === b.player) continue;
    for (const zone of ['hand', 'library'] as const) {
      for (const id of state.zones[zone][p.id] ?? []) {
        const o = state.objects[id];
        if (!o || canSee(state, o, b.player)) continue;
        if (zone === 'hand') expect(text.includes(`"${id}"`), `seat ${b.seat} got the real id of a hidden hand card (${id})`).toBe(false);
        const name = state.defs[o.defId]?.name;
        if (name && !b.known.has(name)) names.add(name);
      }
    }
  }
  if (names.size === 0) return;
  const m = new RegExp(String.raw`\b(?:${[...names].map(escapeRe).join('|')})\b`).exec(text);
  expect(m?.[0], `seat ${b.seat} got the name of a hidden card of another seat it was never shown`).toBeUndefined();
}

/**
 * One AI move from the deciding seat's own browser view (`@openmtg/ai`, chosen from the rebuilt view: a strong patch test). By-hand proposals from the
 * AI are approved by the other seat. Returns false when the game is over.
 */
export function aiMove(h: Harness, tag: string, stepMs = 700): boolean {
  if (h.actor.ended || h.state.result) return false;
  const d = h.state.pending!;
  const seat = h.seatOf(d.player);
  const b = h.b(seat);
  const view = b.view!;
  const action = chooseAction(view, view.pending!, `${tag}-${d.player}`);
  h.at += stepMs;
  const { step, reply } = h.act(seat, action);
  if (!reply) {
    // a by-hand proposal: every other seat approves it
    for (const other of h.browsers.values()) {
      if (other.seat === seat) continue;
      const p = h.sent(step, other.seat, 'proposal')[0];
      if (p) h.cmd({ t: 'vote', seat: other.seat, at: h.at, id: other.nextId++, proposal: p.proposal.id, accept: true });
    }
  } else expect(reply.ok, `the AI's action was refused: ${JSON.stringify(reply)}`).toBe(true);
  return true;
}

/** Plays AI moves until the game ends or `max` moves. */
export function playAi(h: Harness, tag: string, max = 1500, stepMs = 700): number {
  let n = 0;
  while (n < max && aiMove(h, tag, stepMs)) n++;
  return n;
}

/** Plays (lands first, else AI moves) until the deciding seat may cast a spell at priority; returns that cast (a `legal` entry of its browser). */
export function toCast(h: Harness, tag: string): LegalAction {
  const cast = () => {
    const s = h.state.pending;
    if (!s || s.kind !== 'priority') return undefined;
    return h.b(h.seatOf(s.player)).legal.find((l) => l.kind === 'cast');
  };
  for (let i = 0; i < 300 && !cast(); i++) {
    const d = h.state.pending!;
    const b = h.b(h.seatOf(d.player));
    const land = d.kind === 'priority' ? b.legal.find((l) => l.kind === 'playLand') : undefined;
    if (land) h.act(b.seat, land.action);
    else aiMove(h, tag);
  }
  const c = cast();
  if (!c) throw new Error('no cast came up');
  return c;
}

/** Seat 2 casts Fork until it resolves by hand: its manualResolve decision is pending. */
export function forkTable(seed = 'm13-2-fork', o: Partial<HarnessOptions> = {}): Harness {
  const h = new Harness({ config: fixtureConfig(seed, { Forest: 20, 'Abzan Charm': 20 }, { Mountain: 20, Fork: 20 }), game: 'fork', ...o });
  for (let i = 0; i < 400; i++) {
    const d = h.state.pending!;
    if (d.kind === 'manualResolve' && d.player === h.b(2).player) return h;
    const seat = h.seatOf(d.player);
    const b = h.b(seat);
    if (seat === 2 && d.kind === 'priority') {
      const pick = b.legal.find((l) => l.kind === 'playLand') ?? b.legal.find((l) => l.kind === 'cast');
      if (pick) {
        h.act(2, pick.action);
        continue;
      }
    }
    aiMove(h, seed);
  }
  throw new Error('Fork never resolved by hand');
}


const REAL_ID = /^o\d+$/;

/**
 * Events never name another player's hidden hand card, by real id or by alias (M13-2 re-review A: an alias in a `drew` that matches the `oldId` of a
 * later cast shows "they played the card they just drew"). A `drew` of another player names its card only when the seat can see it (a real id that is a
 * visible object of the new view), else ''; a `zoneChanged` out of another player's hand names the card only when the seat's previous view showed it
 * (a real id there), else ''; and no hand alias of either view appears anywhere in the events. Returns how many such events it checked.
 */
export function checkHandEvents(b: Browser, before: GameView | null, after: GameView, events: readonly import('@openmtg/engine').GameEvent[]): number {
  const aliases = new Set<string>();
  for (const v of [before, after]) {
    if (!v) continue;
    for (const [owner, ids] of Object.entries(v.zones.hand)) if (owner !== b.player) for (const id of ids) if (!REAL_ID.test(id)) aliases.add(id);
  }
  const text = JSON.stringify(events);
  for (const a of aliases) expect(text.includes(`"${a}"`), `seat ${b.seat}: an event names the hidden hand card ${a}`).toBe(false);
  let n = 0;
  for (const e of events) {
    if (e.type === 'zoneChanged' && e.from === 'hand' && e.owner !== b.player) {
      n++;
      if (e.oldId !== '') expect(REAL_ID.test(e.oldId) && before !== null && e.oldId in before.objects, `seat ${b.seat}: oldId ${e.oldId} of a hidden hand card`).toBe(true);
    }
    if (e.type === 'drew' && e.player !== b.player) {
      n++;
      if (e.objectId !== '') expect(REAL_ID.test(e.objectId) && e.objectId in after.objects, `seat ${b.seat}: drew names ${e.objectId}`).toBe(true);
    }
  }
  return n;
}
