/**
 * Godot plan phase 1 test helpers for the table channel (src/table): small games, and a fake client that talks to a `TableService` channel through a
 * fake socket pair (every message crosses as JSON text, as on the wire) and keeps the view the way a client does (engine `nextView`).
 */
import { compileCard, nextView, type GameConfig, type GameView, type LegalAction, type PlayerId } from '@openmtg/engine';
import type { TableServerMessage } from '../../src/table/api';
import type { TableChannel, TableService } from '../../src/table/socket';

export const TOKEN = 'ab'.repeat(32);

const land = (name: string, type: string) => compileCard({ name, layout: 'normal', type_line: `Basic Land — ${type}`, oracle_text: '' });
const creature = (name: string, cost: string, pt: string) =>
  compileCard({ name, layout: 'normal', mana_cost: cost, type_line: 'Creature — Beast', power: pt, toughness: pt, oracle_text: '' });

/** Two players, Forest and bears: a quick game. `fullControl`: both players stop at every step (no auto-pass; many hand-offs in hot-seat). */
export function bearsConfig(seed: string, options: GameConfig['options'] = {}, fullControl = true): GameConfig {
  const forest = land('Forest', 'Forest');
  const bear = creature('Test Bear', '{1}{G}', '2');
  const deck = [...Array<string>(20).fill(forest.id), ...Array<string>(20).fill(bear.id)];
  return {
    seed,
    players: [
      { id: 'p1', name: 'Alice', deck, ...(fullControl ? { stops: { fullControl: true } } : {}) },
      { id: 'p2', name: 'Bob', deck, ...(fullControl ? { stops: { fullControl: true } } : {}) },
    ],
    defs: [forest, bear],
    options: { startingLife: 6, ...options },
  };
}

/** The names of the two players' secret cards (never castable in a short game: nine mana), for the hidden-hand checks. */
export const SECRET = { p1: 'Alder Secret Wurm', p2: 'Brine Secret Kraken' } as const;

/** Two players whose hands hold cards only they may know (SECRET): the hidden-hand test's game. */
export function secretsConfig(seed: string): GameConfig {
  const forest = land('Forest', 'Forest');
  const mountain = land('Mountain', 'Mountain');
  const a = creature(SECRET.p1, '{7}{G}{G}', '9');
  const b = creature(SECRET.p2, '{7}{R}{R}', '9');
  return {
    seed,
    players: [
      { id: 'p1', name: 'Alice', deck: [...Array<string>(24).fill(forest.id), ...Array<string>(16).fill(a.id)] },
      { id: 'p2', name: 'Bob', deck: [...Array<string>(24).fill(mountain.id), ...Array<string>(16).fill(b.id)] },
    ],
    defs: [forest, mountain, a, b],
    options: { startingLife: 20, skipMulligans: true },
  };
}

type Snapshot = Extract<TableServerMessage, { t: 'view' | 'patch' }>;

/** A client of the table channel over a fake socket pair. */
export class FakeClient {
  readonly messages: TableServerMessage[] = [];
  closedWith: { code: number; reason: string } | null = null;
  readonly channel: TableChannel;
  table: string | null = null;
  held: { seq: number; view: GameView } | null = null;
  legal: readonly LegalAction[] = [];
  handoff: PlayerId | null = null;
  canUndo = false;
  status: string | null = null;
  /** Patches that did not fit the view held (should stay 0). */
  misfits = 0;
  private nextId = 1;
  private readonly waiters: { from: number; test: (m: TableServerMessage) => boolean; resolve: (m: TableServerMessage) => void }[] = [];
  /** Called with each message after it was taken (the hidden-information checks). */
  onMessage: ((m: TableServerMessage, text: string) => void) | null = null;
  /** Send `shown` for every view taken, as a table without animations does (off: the test sends it). */
  autoShown = false;

  constructor(service: TableService, trusted = true) {
    this.channel = service.connect(
      {
        send: (m) => this.receive(JSON.stringify(m)),
        close: (code, reason) => {
          this.closedWith = { code, reason };
        },
      },
      trusted,
    );
  }

  send(m: object): void {
    this.channel.message(JSON.stringify(m));
  }

  get view(): GameView {
    if (!this.held) throw new Error('no view yet');
    return this.held.view;
  }

  get seq(): number {
    return this.held?.seq ?? 0;
  }

  private receive(text: string): void {
    const m = JSON.parse(text) as TableServerMessage;
    this.messages.push(m);
    if (m.t === 'table') this.table = m.table;
    if (m.t === 'view') this.take(m, { seq: m.seq, view: m.view });
    if (m.t === 'patch') {
      const next = nextView(this.held, m);
      if (next) this.take(m, next);
      else this.misfits++;
    }
    this.onMessage?.(m, text);
    if (this.autoShown && (m.t === 'view' || m.t === 'patch') && this.held?.seq === m.seq) this.send({ t: 'shown', table: this.table, seq: m.seq });
    for (const w of [...this.waiters]) {
      if (this.messages.length - 1 >= w.from && w.test(m)) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve(m);
      }
    }
  }

  private take(m: Snapshot, next: { seq: number; view: GameView }): void {
    this.held = next;
    this.legal = m.legal;
    this.handoff = m.handoff;
    this.canUndo = m.canUndo;
    this.status = m.status;
  }

  /** Messages before this index were read by `next` already (a client reads its messages in order). */
  private cursor = 0;

  /** The next unread message (or the first from index `from`) that passes `test`; the messages before it count as read. */
  next<T extends TableServerMessage['t']>(t: T, test: (m: Extract<TableServerMessage, { t: T }>) => boolean = () => true, from = this.cursor, timeoutMs = 5000): Promise<Extract<TableServerMessage, { t: T }>> {
    type M = Extract<TableServerMessage, { t: T }>;
    const found = (m: TableServerMessage): M => {
      this.cursor = Math.max(this.cursor, this.messages.indexOf(m) + 1);
      return m as M;
    };
    const seen = this.messages.slice(from).find((m) => m.t === t && test(m as M));
    if (seen) return Promise.resolve(found(seen));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no "${t}" message within ${timeoutMs} ms`)), timeoutMs);
      this.waiters.push({
        from,
        test: (m) => m.t === t && test(m as M),
        resolve: (m) => {
          clearTimeout(timer);
          resolve(found(m));
        },
      });
    });
  }

  /** hello, then wait for welcome. */
  async hello(token?: string): Promise<void> {
    const from = this.messages.length;
    this.send({ t: 'hello', protocol: 1, ...(token !== undefined ? { token } : {}) });
    await this.next('welcome', () => true, from);
  }

  /** `act` with the seq of the view held (or `seq`); resolves with the reply. */
  async act(action: unknown, seq = this.seq): Promise<Extract<TableServerMessage, { t: 'reply' }>> {
    const id = this.nextId++;
    const from = this.messages.length;
    this.send({ t: 'act', table: this.table, id, seq, action });
    return this.next('reply', (m) => m.id === id, from);
  }

  newId(): number {
    return this.nextId++;
  }
}

/** Wait `ms` of real time. */
export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
