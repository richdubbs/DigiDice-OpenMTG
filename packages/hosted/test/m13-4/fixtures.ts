/** Fixed inputs of the storage contract suite (M13-4). */
import type { Action } from '@openmtg/engine';
import type { GameRecord, Placement } from '../../src/ledger/types';
import type { LogRecord, NewGameRow, ReportRow, SeatRow, SessionRow, SnapshotRow, StartRow, StoredConfig } from '../../src/store/api';

export const T0 = new Date('2026-10-15T12:00:00.000Z');
export const DAY = 86_400_000;
export const at = (ms: number): Date => new Date(T0.getTime() + ms);

export function session(id: string, lastSeen = T0, token = `hash-${id}`): SessionRow {
  return { id, tokenHash: token, name: `Name ${id}`, createdAt: new Date(lastSeen.getTime() - 1000), lastSeen };
}

export function seat(n: 1 | 2, sessionId: string | null): SeatRow {
  return {
    seat: n, player: null, session: sessionId, name: sessionId ? `Player ${n}` : null,
    deck: sessionId ? { main: [{ name: 'Forest', count: 20 }, { name: 'Llanowar Elves', count: 4 }], sideboard: [] } : null,
    deckHash: sessionId ? `deck-${n}` : null, inviteHash: null, joinedAt: sessionId ? T0 : null, leftAt: null,
  };
}

export function newGame(id: string, createdAt = T0): NewGameRow {
  return {
    id, format: 'standard', variant: null, seats: 2, source: 'listed', title: `Table ${id}`, passwordHash: null, passwordSalt: null, createdAt,
    seatRows: [seat(1, 's1'), seat(2, null)],
  };
}

/**
 * A config whose key order a jsonb column would change (keys of different lengths out of jsonb's order, integer-like keys): stores must give back
 * the exact JSON text (the checkpoint hash of a replayed state depends on key order).
 */
export function storedConfig(): StoredConfig {
  return {
    zeta: { longer_key: 1, b: [3, 2, 1], a: 'x' },
    players: [{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Bo' }],
    '10': 'ten',
    '2': 'two',
    options: { mulligan: 'london', nested: { yy: true, x: null } },
  } as unknown as StoredConfig;
}

export function startRow(startedAt = T0, node: string | null = null): StartRow {
  return { config: storedConfig(), seed: 'ab'.repeat(16), seating: [2, 1], engineBuild: 'build-1', rulesPack: null, startedAt, node };
}

/** An action whose own key order a jsonb column would change. */
export function action(n: number): Action {
  return { type: 'answer', answer: { kind: 'chooseNumber', value: n }, player: n % 2 ? 'p1' : 'p2', zzLongKey: { b: 1, a: 2 } } as unknown as Action;
}

export function record(game: string, seq: number, extra: Partial<LogRecord> = {}): LogRecord {
  return {
    game, seq, seat: seq % 2 ? 1 : 2, action: action(seq),
    clocks: [
      { seat: 1, bankMs: 900_000 - seq, dropMs: 0, delayMs: 5_000, period: seq, actions: Math.ceil(seq / 2) },
      { seat: 2, bankMs: 900_000, dropMs: 120.5, delayMs: 0, period: seq, actions: Math.floor(seq / 2) },
    ],
    elapsedMs: seq * 1_000, at: at(seq * 1_000).toISOString(), ...extra,
  };
}

export const records = (game: string, from: number, to: number): LogRecord[] => Array.from({ length: to - from + 1 }, (_, i) => record(game, from + i));

export function snapshot(game: string, seq: number): SnapshotRow {
  return { game, seq, engineBuild: 'build-1', hash: `h${seq}`.padEnd(64, '0'), state: new Uint8Array([seq & 255, 1, 2, 3, 0, 255]), createdAt: at(seq) };
}

export function placement(seat: 1 | 2, place: 1 | 2): Placement {
  return {
    seat, player: seat === 1 ? 'p2' : 'p1', session: `s${seat}`, account: null, name: `Player ${seat}`, deckHash: `deck-${seat}`, place,
    loss: place === 1 ? null : 'life', lossRule: place === 1 ? null : 'CR 704.5a', outTurn: place === 1 ? null : 9, outOrder: place === 1 ? null : 1,
    timeUsedMs: 123_456, timeouts: 0, disconnectedMs: 2_500,
  };
}

export function gameRecord(game: string, endedAt: Date, extra: Partial<GameRecord> = {}): GameRecord {
  return {
    game, format: 'standard', variant: null, seats: 2, source: 'listed', ranked: false, outcome: 'win', reason: 'life', turns: 9, actions: 120,
    startedAt: T0.toISOString(), endedAt: endedAt.toISOString(), engineBuild: 'build-1', placements: [placement(2, 2), placement(1, 1)], ...extra,
  };
}

export function report(id: string, createdAt: Date, attachments: ReportRow['attachments'] = []): ReportRow {
  return { id, kind: 'bug', session: 's1', game: 'g1', seat: 1, text: `It broke (${id})`, attachments, createdAt, status: 'new' };
}

/** A game started and running, with `n` records committed. */
export async function running(store: { createGame(g: NewGameRow): Promise<void>; startGame(id: string, s: StartRow): Promise<void>; appendRecords(b: LogRecord[]): Promise<unknown> }, id: string, n = 0, startedAt = T0): Promise<void> {
  await store.createGame(newGame(id, startedAt));
  await store.startGame(id, startRow(startedAt));
  if (n > 0) await store.appendRecords(records(id, 1, n));
}
