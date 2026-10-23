/** Life total changes (CR 119) and poison counters (CR 122.1f, 704.5c). */
import type { PlayerId } from '../types/ids';
import type { Game } from '../core/game';
import type { GameState } from '../types/state';
import { playerRestricted } from './restrictions';
import { cantDo } from './cant';

/** Change a player's life total by `delta` (negative = lose life, CR 119.3) and record it. Prefer gainLife / loseLife / payLife, which honor restrictions. */
export function changeLife(g: Game, player: PlayerId, delta: number, cause: string, rules: string[] = ['CR 119.3']): void {
  if (delta === 0) return;
  const p = g.player(player);
  p.life += delta;
  if (delta > 0) p.turnStats.lifeGained += delta;
  else p.turnStats.lifeLost += -delta;
  g.emit({ type: 'lifeChanged', player, delta, life: p.life, cause });
  g.log(`${p.name} ${delta > 0 ? 'gains' : 'loses'} ${Math.abs(delta)} life (${cause}). Life: ${p.life}.`, { rules, level: 'info' });
}

/** A player gains life (CR 119.3). Gaining 0 life is no event (CR 119.9). Returns the life gained ("can't gain life" gains none, CR 119.7). */
export function gainLife(g: Game, player: PlayerId, amount: number, cause: string): number {
  if (amount <= 0) return 0;
  if (playerRestricted(g.s, player, 'cantGainLife')) {
    g.log(`${g.player(player).name} can't gain life, so ${cause} does nothing.`, { rules: ['CR 119.7'], level: 'info' });
    return 0;
  }
  changeLife(g, player, amount, cause, ['CR 119.3']);
  return amount;
}

/** A player loses life (CR 119.3). Returns the life lost ("can't lose life" loses none, CR 119.8). */
export function loseLife(g: Game, player: PlayerId, amount: number, cause: string): number {
  if (amount <= 0) return 0;
  if (playerRestricted(g.s, player, 'cantLoseLife')) {
    g.log(`${g.player(player).name} can't lose life, so ${cause} does nothing.`, { rules: ['CR 119.8'], level: 'info' });
    return 0;
  }
  changeLife(g, player, -amount, cause, ['CR 119.3']);
  return amount;
}

/**
 * The most life the player can pay right now (CR 119.4): their life total, or none at all if they can't lose life (CR 119.8).
 * Paying 0 life is always possible (CR 119.4b). Cost checks and the mana solver (Phyrexian mana) use this, never `life` directly.
 */
export function lifeBudget(s: GameState, player: PlayerId): number {
  if (playerRestricted(s, player, 'cantLoseLife') || cantDo(s, 'payLife', player)) return 0; // CR 119.8; WP31: "can't pay life" (CR 614.17b)
  return s.players.find((p) => p.id === player)?.life ?? 0;
}

/** Can the player pay this much life (CR 119.4, 119.8)? Paying 0 life is always possible (CR 119.4b). */
export function canPayLife(g: Game, player: PlayerId, amount: number): boolean {
  if (amount <= 0) return true;
  return g.player(player).life >= amount && !playerRestricted(g.s, player, 'cantLoseLife') && cantDo(g.s, 'payLife', player) === null;
}

/**
 * std-library-4 (CR 119.4, 614.1a): the funnel a payment of life goes through once the player can make it: effects/funnels.ts installs the proposal of a `payLife`
 * event (effects/proposal-kinds/pay-life.ts), so a replacement effect may replace the payment ("If you would pay life while ..., exile that many cards ... instead").
 * Without it the life total changes directly.
 */
export type PayLifeFunnel = (g: Game, player: PlayerId, amount: number, cause: string, rules: string[]) => void;
let payLifeFunnel: PayLifeFunnel | null = null;
export function installPayLifeFunnel(f: PayLifeFunnel | null): void {
  payLifeFunnel = f;
}

/**
 * Pay life as a cost or as part of an effect (CR 119.4). Returns false, changing nothing, if the player can't pay. A replacement of the payment does not change
 * whether the player can pay (CR 119.4, 119.8): a payment that is replaced still counts as paid.
 */
export function payLife(g: Game, player: PlayerId, amount: number, cause = 'paid', rules: string[] = ['CR 119.4']): boolean {
  if (!canPayLife(g, player, amount)) return false;
  if (amount <= 0) return true;
  if (payLifeFunnel) payLifeFunnel(g, player, amount, cause, rules);
  else changeLife(g, player, -amount, cause, rules);
  return true;
}

/** A player gets poison counters (CR 122.1f); ten or more makes them lose at the next state-based action check (CR 704.5c). */
export function givePoison(g: Game, player: PlayerId, amount: number, cause: string): void {
  if (amount <= 0) return;
  const p = g.player(player);
  if (cantDo(g.s, 'haveCountersPut', player)) { // WP31: "players can't get counters" (CR 122.1f, 614.17)
    g.log(`${p.name} can't get poison counters (${cause}).`, { rules: ['CR 122.1f', 'CR 614.17'], level: 'info' });
    return;
  }
  p.poison += amount;
  g.emit({ type: 'countersChanged', target: player, counter: 'poison', delta: amount });
  g.log(`${p.name} gets ${amount} poison counter${amount === 1 ? '' : 's'} (${cause}). Poison: ${p.poison}.`, { rules: ['CR 122.1f'], level: 'info' });
}
