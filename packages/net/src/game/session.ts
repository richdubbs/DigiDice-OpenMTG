/**
 * The host's game for online play: the current state and the action log, without the engine GameSession's history of every intermediate state.
 * Undo is off online (docs/design/online.md), and the history cost about 40 KB per action, which a guest flooding cheap actions turned into
 * 15-20 MB of heap per second (audit 2026-10-12, M4). The log alone rebuilds the game (`replay`, the engine's re-execution model).
 *
 * Also the session tokens a guest uses to take its seat back (audit M3: compared as bytes of equal length, never as strings).
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { applyAction, createGame, type Action, type ActionError, type GameConfig, type GameEvent, type GameState } from '@openmtg/engine';
import { SESSION_TOKEN } from '../protocol/messages';

export class OnlineSession {
  readonly config: GameConfig;
  private current: GameState;
  private readonly log: Action[] = [];

  constructor(config: GameConfig) {
    this.config = config;
    this.current = createGame(config);
  }

  get state(): GameState {
    return this.current;
  }

  get actions(): readonly Action[] {
    return this.log;
  }

  apply(action: Action): { ok: true; events: GameEvent[] } | { ok: false; error: ActionError } {
    const r = applyAction(this.current, action);
    if (r.error) return { ok: false, error: r.error };
    this.current = r.state;
    this.log.push(action);
    return { ok: true, events: r.events };
  }
}

/** A new session token: 16 random bytes as lowercase hex (protocol SESSION_TOKEN). */
export function newSessionToken(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Does `given` (from the network) equal the seat's token? Both must have the token format; the compare is constant-time over equal-length byte
 * buffers. Before (audit M3), UTF-16 lengths were compared and then timingSafeEqual ran on UTF-8 buffers: 32 times 'é' passed the length check, threw
 * ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH and took the host process down.
 */
export function sameSessionToken(given: unknown, token: string): boolean {
  if (typeof given !== 'string' || !SESSION_TOKEN.test(given) || !SESSION_TOKEN.test(token)) return false;
  const a = Buffer.from(given, 'hex');
  const b = Buffer.from(token, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
