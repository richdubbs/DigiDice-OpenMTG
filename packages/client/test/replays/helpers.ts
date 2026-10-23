/** RPL-1 test helpers: small games played by the AI on a LocalConnection, a clock, and a replay environment over memory. */
import { chooseAction } from '@openmtg/ai';
import { compileCard, type Action, type CardDef, type GameConfig } from '@openmtg/engine';
import type { LocalConnection } from '../../src/connection/LocalConnection';
import type { Completer } from '../../src/replays/completion';
import { MemoryReplayDb, type DbOp } from '../../src/replays/db';
import { replayEnv, type ReplayEnv } from '../../src/replays/env';
import { completeGame } from '../../src/replays/fallback';
import type { Liveness } from '../../src/replays/liveness';

export const DEFS: CardDef[] = [
  compileCard({ name: 'Mountain', layout: 'normal', type_line: 'Basic Land — Mountain', oracle_text: '({T}: Add {R}.)' }),
  compileCard({ name: 'Forest', layout: 'normal', type_line: 'Basic Land — Forest', oracle_text: '({T}: Add {G}.)' }),
  compileCard({ name: 'Test Shock', layout: 'normal', mana_cost: '{R}', type_line: 'Instant', oracle_text: 'Test Shock deals 2 damage to any target.' }),
  compileCard({ name: 'Test Raider', layout: 'normal', mana_cost: '{1}{R}', type_line: 'Creature — Goblin', power: '2', toughness: '2', oracle_text: '' }),
  compileCard({ name: 'Test Bear', layout: 'normal', mana_cost: '{1}{G}', type_line: 'Creature — Bear', power: '2', toughness: '2', oracle_text: '' }),
];

const id = (name: string) => DEFS.find((d) => d.name === name)!.id;
const fill = (n: number, name: string) => Array<string>(n).fill(id(name));

/** Alice (red: lands, burn, creatures) against Bob (green creatures), at a low life so a game ends in a few turns. */
export function duel(seed: string, startingLife = 6): GameConfig {
  return {
    seed,
    players: [
      { id: 'p1', name: 'Alice', deck: [...fill(16, 'Mountain'), ...fill(12, 'Test Shock'), ...fill(12, 'Test Raider')] },
      { id: 'p2', name: 'Bob', deck: [...fill(17, 'Forest'), ...fill(23, 'Test Bear')] },
    ],
    defs: DEFS,
    options: { startingLife },
  };
}

/** A clock that moves only when told. */
export function testClock(start = Date.UTC(2026, 9, 21, 12, 0, 0)) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/** Liveness that says which records some page holds (default none: every record not recorded by this page is abandoned). */
export function heldBy(ids: Iterable<string> = []): Liveness {
  const held = new Set(ids);
  return { hold: () => () => {}, held: async () => held };
}

/** Runs `completeGame` in this thread, as the worker would. */
export const inlineCompleter: Completer = async (file, build) => completeGame(structuredClone(file), build);

/** A worker cut short by its page closing (a tab closed or reloaded while it ran): it never answers. */
export const pageClosedCompleter: Completer = () => new Promise(() => {});

/** Replays in memory whose writes can be made to fail (a disk error): the next `failing` writes, and every write `fails` matches. */
export class FlakyReplayDb extends MemoryReplayDb {
  /** Fail this many writes from now. */
  failing = 0;
  /** Fail every write this matches. */
  fails: ((ops: readonly DbOp[]) => boolean) | null = null;

  override async write(ops: readonly DbOp[]): Promise<void> {
    if (this.failing > 0) {
      this.failing--;
      throw new Error('disk error');
    }
    if (this.fails?.(ops)) throw new Error('disk error');
    return super.write(ops);
  }
}

export function testEnv(
  opts: { now?: () => number; completer?: Completer | null; liveness?: Liveness; limit?: number; db?: MemoryReplayDb; build?: string | null } = {},
): ReplayEnv & { db: MemoryReplayDb } {
  const db = opts.db ?? new MemoryReplayDb();
  const env = replayEnv(db, {
    now: opts.now ?? testClock().now,
    completer: opts.completer === undefined ? null : opts.completer,
    liveness: opts.liveness ?? heldBy(),
    library: { limit: () => opts.limit ?? 50, persist: () => {} },
    ...(opts.build !== undefined ? { build: opts.build } : {}),
  });
  return { ...env, db };
}

/**
 * Let the AI make one move for whoever must act (in hot-seat after their hand-off). False when the game is over. `tick`: called before each action
 * (a clock moving on).
 */
export async function aiMove(conn: LocalConnection, tick?: () => void): Promise<boolean> {
  if (conn.handoff()) conn.acceptHandoff();
  const view = conn.view();
  const who = view.pending?.player;
  if (!who || view.result) return false;
  const seat = view.viewer === who ? conn : conn.seat(who);
  // The decision as its own player sees it (another player's view names only who decides).
  const seen = seat.view();
  const d = seen.pending!;
  let action: Action = chooseAction(seen, d, `rpl1:${d.id}`);
  tick?.();
  let r = await seat.act(action);
  if (!r.ok) {
    action = d.kind === 'priority' ? { type: 'pass', player: d.player } : { type: 'cancel', player: d.player };
    r = await seat.act(action);
    if (!r.ok) throw new Error(`no move for ${d.player} at ${d.kind}: ${r.error.message}`);
  }
  return true;
}

/** AI moves until `until` holds or the game is over (at most `max` moves). */
export async function playUntil(conn: LocalConnection, until: () => boolean, max = 3000, tick?: () => void): Promise<void> {
  for (let i = 0; i < max && !until(); i++) if (!(await aiMove(conn, tick))) return;
}

/** Let queued promises (the recorder's writes, the library's queue) run. */
export async function settle(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
}
