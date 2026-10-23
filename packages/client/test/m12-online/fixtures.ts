/**
 * M12-5b: fakes for the 3-4 player online client tests: a table's status as the local server sends it (M12-5a's OnlineStatus fields) and real views of a
 * 3-4 player game (M12-2's rules scenario: Alice, Bob, Carol, Dan; Alice active in her first main phase). Normal traffic only: the fake socket of
 * online-fakes.ts plays the local server; no sockets, no network.
 */
import { legalActions, viewFor, type GameEvent, type GameState, type PlayerId } from '@openmtg/engine';
import type { OnlinePlayerStatus, OnlineSeatCode, OnlineStatus, ServerMessage } from '@openmtg/server/online';
import { mpScenario } from '../../../engine/test/m12/rules/helpers';

export const NAMES: Record<string, string> = { p1: 'Alice', p2: 'Bob', p3: 'Carol', p4: 'Dan' };
export const CODES = ['K7Q2-M9XD-4TPA-HW3N', 'R4VC-8NJE-2LMQ-T6YB', 'W9HD-3KXP-7GFZ-Q2NC'];

export type Player = Partial<OnlinePlayerStatus> & { id: PlayerId };

/** The table of `seats` seats (seat n plays p<n>), every seat taken and connected unless `players` says otherwise. */
export function table(seats: 3 | 4, players: Player[] = [], taken: number = seats): OnlinePlayerStatus[] {
  return Array.from({ length: seats }, (_, i) => {
    const id = `p${i + 1}` as PlayerId;
    const base: OnlinePlayerStatus = i < taken ? { id, name: NAMES[id]!, connected: true, seat: i + 1, taken: true } : { id, name: '', connected: false, seat: i + 1, taken: false };
    return { ...base, ...players.find((p) => p.id === id) };
  });
}

/** The host's codes of a table with `taken` seats taken (the host's own included). */
export function codes(seats: 3 | 4, taken: number): OnlineSeatCode[] {
  return Array.from({ length: seats - 1 }, (_, i) => ({ seat: i + 2, player: `p${i + 2}` as PlayerId, code: CODES[i]!, taken: i + 2 <= taken }));
}

export function tableStatus(o: Omit<Partial<OnlineStatus>, 'role' | 'me' | 'seats'> & { role: 'host' | 'guest'; me: PlayerId; seats?: 3 | 4 }): OnlineStatus {
  const seats = o.seats ?? 3;
  return {
    phase: 'playing',
    format: 'casual',
    warnings: [],
    seats,
    players: table(seats),
    ...(o.role === 'host' ? { code: CODES[0], port: 47620, codes: codes(seats, seats) } : { seat: Number(o.me.slice(1)), address: '203.0.113.7:47620' }),
    ...o,
  };
}

export const statusMsg = (s: OnlineStatus): ServerMessage => ({ t: 'status', status: s });

/** Views of a 3-4 player game for `view` messages; `set` moves the game on (the next view's seq is one higher). */
export function tableViews(players: 3 | 4 = 3) {
  let state: GameState = mpScenario({ players });
  let seq = 1;
  return {
    get state() {
      return state;
    },
    set(s: GameState) {
      state = s;
      seq++;
    },
    msg(me: PlayerId, events: GameEvent[] = []): Extract<ServerMessage, { t: 'view' }> {
      return { t: 'view', seq, view: viewFor(state, me), events, legal: legalActions(state, me) };
    },
  };
}
