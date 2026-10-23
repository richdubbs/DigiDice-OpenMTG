/**
 * Test helpers for the bug inbox (M13-13; in process, fake time only): a started hosted game with a real engine log (two AI players, committed records
 * with the table's own checkpoint hashes) written to a store the way the runtime writes it, and report rows.
 */
import { applyAction, createGame, type Action, type GameConfig } from '@openmtg/engine';
import type { LogRecord, ReportRow, SeatRow } from '../../src/store/api';
import type { GameStore } from '../../src/store/api';
import { checkpointOf } from '../../src/table/limits';
import { aiAgent, playGame } from '../../../ai/test/harness';
import { DECKS, gameConfig } from '../../../ai/test/decks';

export const T0 = new Date('2026-10-20T12:00:00.000Z');

export const SESSION_A = 'S0000000000000000000000AAA';
export const SESSION_B = 'S0000000000000000000000BBB';

export function seatRow(n: 1 | 2, session: string | null, name: string | null): SeatRow {
  return {
    seat: n, player: null, session, name, deck: session ? { main: [{ name: 'Forest', count: 20 }], sideboard: [] } : null, deckHash: session ? `deck-hash-${n}` : null,
    inviteHash: null, joinedAt: session ? T0 : null, leftAt: null,
  };
}

/**
 * The AI game of a seed, played once per process (every test shares it; a shorter game is a prefix of it), with the table's checkpoint hash after every
 * 100th action. The game ends by itself after about 200 actions.
 */
const PLAYED = new Map<string, { config: GameConfig; actions: Action[]; hashes: Map<number, string> }>();
function played(seed: string, moves: number): { config: GameConfig; actions: Action[]; hashes: Map<number, string> } {
  let p = PLAYED.get(seed);
  if (!p) {
    const config = gameConfig(seed, DECKS[0]!, DECKS[1]!);
    const { actions } = playGame(config, { p1: aiAgent(`${seed}-1`), p2: aiAgent(`${seed}-2`) }, 400);
    const hashes = new Map<number, string>();
    let state = createGame(config);
    actions.forEach((action, i) => {
      state = applyAction(state, action).state;
      if ((i + 1) % 100 === 0) hashes.set(i + 1, checkpointOf(state).hash);
    });
    PLAYED.set(seed, (p = { config, actions, hashes }));
  }
  return { config: p.config, actions: p.actions.slice(0, moves), hashes: p.hashes };
}

/** Plays the shared game now (a test file's `beforeAll` calls it, so no test pays for it). */
export function warmGame(seed = 'm13-13-seed'): void {
  played(seed, 1);
}

export interface StoredGame {
  id: string;
  config: GameConfig;
  actions: Action[];
  records: LogRecord[];
}

/**
 * A game of two AI players (p1 plays at seat 1, p2 at seat 2), `moves` actions long, as a running hosted game of `store`: its rows, its start (config
 * without the seed, the seed, the engine build) and its committed records, one per second, a checkpoint hash on every 100th as the table writes them.
 */
export async function storeGame(
  store: GameStore,
  o: {
    id?: string; seed?: string; moves?: number; build?: string; startedAt?: Date; sessions?: [string, string]; source?: 'listed' | 'matched';
    /** The record with this `seq` gets a checkpoint hash that is not the state's (a build that plays the game differently). */
    wrongCheckAt?: number;
    /** The record with this `seq` holds an action the engine refuses. */
    illegalAt?: number;
  } = {},
): Promise<StoredGame> {
  const id = o.id ?? 'G0000000000000000000000001';
  const seed = o.seed ?? 'm13-13-seed';
  const startedAt = o.startedAt ?? T0;
  const [sa, sb] = o.sessions ?? [SESSION_A, SESSION_B];
  const { config, actions, hashes } = played(seed, o.moves ?? 150);
  await store.createGame({
    id, format: 'standard', variant: null, seats: 2, source: o.source ?? 'listed', title: `Table ${id}`, passwordHash: null, passwordSalt: null, createdAt: startedAt,
    seatRows: [seatRow(1, sa, 'Alice'), seatRow(2, sb, 'Bob')],
  });
  const { seed: _seed, ...stored } = config;
  await store.startGame(id, { config: stored, seed, seating: [1, 2], engineBuild: o.build ?? 'build-test', rulesPack: null, startedAt, node: null });
  const records: LogRecord[] = actions.map((action, i) => {
    const seq = i + 1;
    const stored: Action = seq === o.illegalAt ? ({ type: 'cast', player: 'p1', card: 'no-such-object' } as unknown as Action) : action;
    return {
      game: id, seq, seat: (action as { player?: string }).player === 'p2' ? 2 : 1, action: stored,
      clocks: [
        { seat: 1, bankMs: 900_000 - seq * 10, dropMs: 0, delayMs: 5_000, period: 1 },
        { seat: 2, bankMs: 900_000, dropMs: 0, delayMs: 5_000, period: 1 },
      ],
      elapsedMs: seq * 1_000, at: new Date(startedAt.getTime() + seq * 1_000).toISOString(), ...(seq % 100 === 0 || seq === o.wrongCheckAt ? { check: seq === o.wrongCheckAt ? '0'.repeat(64) : hashes.get(seq)! } : {}),
    };
  });
  const r = await store.appendRecords(records);
  if (r.failed.length > 0) throw new Error(`the test game was not stored: ${JSON.stringify(r.failed)}`);
  return { id, config, actions: [...actions], records };
}

let n = 0;
/** A report row (ids are ULID-shaped, with the time of `createdAt` in front as the intake makes them). */
export function reportRow(o: Partial<ReportRow> & { createdAt?: Date } = {}): ReportRow {
  const createdAt = o.createdAt ?? T0;
  return {
    id: `${ulidPrefix(createdAt)}${String(++n).padStart(16, '0')}`, kind: 'bug', session: SESSION_A, game: null, seat: null, text: 'It broke', attachments: [], status: 'new', ...o, createdAt,
  };
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulidPrefix(d: Date): string {
  let t = d.getTime();
  let s = '';
  for (let i = 0; i < 10; i++) {
    s = CROCKFORD[t % 32]! + s;
    t = Math.floor(t / 32);
  }
  return s;
}

/** The client's attachments of a typical bug report (design 4.8: the client details, the settings, the view). */
export function clientAttachments(): { kind: 'client' | 'settings' | 'view'; json: string }[] {
  return [
    {
      kind: 'client',
      json: JSON.stringify({
        app: { version: '1.2.3', commit: 'abc1234' },
        browser: { userAgent: 'Mozilla/5.0 (test)', language: 'en-US', screen: 'window 1280x720, screen 1920x1080, 2x' },
        errors: [{ message: 'TypeError: x is undefined', stack: 'at f (a.js:1:1)', time: '2026-10-20T12:02:00.000Z' }],
        card: 'Llanowar Elves',
      }),
    },
    { kind: 'settings', json: JSON.stringify({ animationSpeed: 'fast', reducedMotion: false, tableLayout: 'wide', ownTurnStops: 'upkeep draw' }) },
    { kind: 'view', json: JSON.stringify({ viewer: 'p1', turn: { number: 3 } }) },
  ];
}
