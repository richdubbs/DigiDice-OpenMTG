/**
 * Performance harness (package P1): plays the M3 soak games and the M4 real games exactly as their tests do, times every `applyAction` and
 * `legalActions` call, and returns latency statistics plus a fingerprint of what was played (tallies, action logs, final states), so a
 * speed-up can be checked to change nothing. Test-side code: it may read the clock.
 */
import { applyAction, createGame, legalActions, type Action, type GameEvent, type GameState } from '../../src/index';
import { Bot } from '../m3/bot';
import { REAL_GAMES, REAL_MAX_ACTIONS, SOAK_ACTIONS, SOAK_CONVERSE_EVERY, SOAK_GAMES, realChoose, realConfig, soakConfig } from './decks';
import { createHash } from 'node:crypto';

export interface Latency { count: number; totalMs: number; medianMs: number; p95Ms: number; maxMs: number }

export function latency(samples: number[]): Latency {
  const xs = [...samples].sort((a, b) => a - b);
  const at = (q: number) => (xs.length === 0 ? 0 : xs[Math.min(xs.length - 1, Math.floor(q * xs.length))]!);
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return { count: xs.length, totalMs: r(xs.reduce((a, b) => a + b, 0)), medianMs: r(at(0.5)), p95Ms: r(at(0.95)), maxMs: r(xs[xs.length - 1] ?? 0) };
}

/** Times `f` with the high-resolution clock. */
function timed<T>(into: number[], f: () => T): T {
  const t0 = performance.now();
  const out = f();
  into.push(performance.now() - t0);
  return out;
}

export interface SoakTally {
  actions: number; listed: number; unlisted: number; casts: number; activations: number;
  attacks: number; attackers: number; blocks: number; combatDamage: number; deaths: number; poison: number; results: number;
}

export interface GameRecord { seed: string; actions: Action[]; final: GameState }

export interface SoakMeasure {
  /** The bot's own actions: what a player's click costs. */
  play: Latency;
  /** Every applyAction call, including the soak's re-application of every listed action at each priority. */
  all: Latency;
  /** `legalActions` at each priority (what the UI asks before each click). */
  legal: Latency;
  tally: SoakTally;
  fingerprint: string;
  games: GameRecord[];
}

const sha = (x: string) => createHash('sha256').update(x).digest('hex').slice(0, 16);

export function fingerprintOf(games: GameRecord[], extra: unknown): string {
  return sha(JSON.stringify(extra) + games.map((g) => sha(JSON.stringify(g.actions)) + sha(JSON.stringify(g.final))).join(''));
}

function tallyEvents(t: SoakTally, events: GameEvent[]): void {
  for (const e of events) {
    if (e.type === 'attackersDeclared' && e.attackers.length > 0) { t.attacks++; t.attackers += e.attackers.length; }
    else if (e.type === 'blockersDeclared') t.blocks += e.blocks.length;
    else if (e.type === 'damageDealt' && e.combat) t.combatDamage++;
    else if (e.type === 'zoneChanged' && e.from === 'battlefield' && e.to === 'graveyard') t.deaths++;
    else if (e.type === 'countersChanged' && e.counter === 'poison') t.poison++;
    else if (e.type === 'gameOver') t.results++;
  }
}

/**
 * The soak loop of `test/m3/soak.test.ts#playGame` with `validateListed` on (every listed action applied, unlisted plays sampled), for games `from` to
 * `from + games - 1` (default: all twenty).
 */
export function measureSoak(games = SOAK_GAMES, onGame?: (i: number) => void, from = 0): SoakMeasure {
  const play: number[] = [];
  const all: number[] = [];
  const legal: number[] = [];
  const t: SoakTally = { actions: 0, listed: 0, unlisted: 0, casts: 0, activations: 0, attacks: 0, attackers: 0, blocks: 0, combatDamage: 0, deaths: 0, poison: 0, results: 0 };
  const records: GameRecord[] = [];
  for (let g = from; g < from + games; g++) {
    const cfg = soakConfig(g);
    const bot = new Bot(`soak-${g}`);
    let s = createGame(cfg);
    const actions: Action[] = [];
    let priorities = 0;
    for (let i = 0; i < SOAK_ACTIONS && !s.result; i++) {
      const d = s.pending!;
      if (d.kind === 'priority') {
        priorities++;
        const listed = timed(legal, () => legalActions(s, d.player));
        for (const la of listed) {
          const r = timed(all, () => applyAction(s, la.action));
          if (r.error) throw new Error(`soak ${g}, action ${i}: listed action "${la.label}" was rejected: ${r.error.message}`);
          t.listed++;
        }
        const keys = new Set(listed.map((la) => JSON.stringify(la.action)));
        for (const card of priorities % SOAK_CONVERSE_EVERY === 1 ? s.zones.hand[d.player]! : []) {
          const faces = s.defs[s.objects[card]!.defId]!.faces.length;
          for (let face = 0; face < faces; face++) {
            for (const type of ['playLand', 'cast'] as const) {
              const action: Action = { type, player: d.player, card, face };
              const listedForm: Action = { type, player: d.player, card, ...(face > 0 ? { face } : {}) };
              if (keys.has(JSON.stringify(listedForm))) continue;
              const r = timed(all, () => applyAction(s, action));
              if (!r.error) throw new Error(`soak ${g}, action ${i}: ${JSON.stringify(action)} is accepted but not listed`);
              t.unlisted++;
            }
          }
        }
      }
      const action = bot.next(s);
      if (action.type === 'cast') t.casts++;
      if (action.type === 'activate') t.activations++;
      const t0 = performance.now();
      const r = applyAction(s, action);
      const ms = performance.now() - t0;
      play.push(ms);
      all.push(ms);
      if (r.error) throw new Error(`soak ${g}, action ${i}: ${JSON.stringify(action)} was rejected: ${r.error.message}`);
      s = r.state;
      actions.push(action);
      tallyEvents(t, r.events);
    }
    t.actions += actions.length;
    records.push({ seed: cfg.seed, actions, final: s });
    onGame?.(g);
  }
  return { play: latency(play), all: latency(all), legal: latency(legal), tally: t, fingerprint: fingerprintOf(records, t), games: records };
}

export interface RealMeasure { play: Latency; legal: Latency; actions: number; winners: string[]; fingerprint: string; games: GameRecord[] }

/** The eight M4 real games (scripted players, real decks), every action timed. */
export function measureReal(games = REAL_GAMES): RealMeasure {
  const play: number[] = [];
  const legal: number[] = [];
  const records: GameRecord[] = [];
  const winners: string[] = [];
  let count = 0;
  for (let g = 0; g < games; g++) {
    const cfg = realConfig(g);
    let s = createGame(cfg);
    const actions: Action[] = [];
    for (let i = 0; i < REAL_MAX_ACTIONS && !s.result; i++) {
      const a = s.pending!.kind === 'priority' ? timed(legal, () => realChoose(s)) : realChoose(s);
      const r = timed(play, () => applyAction(s, a));
      if (r.error) throw new Error(`real ${g}, action ${i} rejected: ${r.error.message}`);
      s = r.state;
      actions.push(a);
    }
    count += actions.length;
    winners.push(String(s.result?.winner ?? 'none'));
    records.push({ seed: cfg.seed, actions, final: s });
  }
  return { play: latency(play), legal: latency(legal), actions: count, winners, fingerprint: fingerprintOf(records, winners), games: records };
}
