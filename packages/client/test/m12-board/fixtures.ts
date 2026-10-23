/**
 * M12-4a fixtures: real 3-4 player states from the engine (GameSession with `options.multiplayer`, M12-1), with permanents put onto the battlefield and
 * players marked as having left, and the views `viewFor` gives each player (CR 400.2).
 */
import { GameSession, compileCard, viewFor, type CardDef, type GameConfig, type GameState, type GameView, type PlayerId } from '@openmtg/engine';

export const DEFS: CardDef[] = [
  compileCard({ name: 'Forest', layout: 'normal', type_line: 'Basic Land — Forest', oracle_text: '' }),
  compileCard({ name: 'Test Bear', layout: 'normal', mana_cost: '{1}{G}', type_line: 'Creature — Bear', power: '2', toughness: '2', oracle_text: '' }),
  compileCard({ name: 'Secret Sphinx', layout: 'normal', mana_cost: '{9}{U}', type_line: 'Creature — Sphinx', power: '9', toughness: '9', oracle_text: '' }),
];
const id = (name: string) => DEFS.find((d) => d.name === name)!.id;
const fill = (n: number, name: string) => Array<string>(n).fill(id(name));

export const NAMES = ['Alice', 'Bianca', 'Carol', 'Dmitri'];

export function config(players: number, seed = 'm12-board'): GameConfig {
  return {
    seed,
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i + 1}`, name: NAMES[i]!, deck: [...fill(10, 'Forest'), ...fill(10, 'Test Bear'), ...fill(20, 'Secret Sphinx')] })),
    defs: DEFS,
    options: { skipMulligans: true, startingPlayer: 'p1', ...(players > 2 ? { multiplayer: { variant: 'freeForAll' as const, attack: 'multiple' as const } } : {}) },
  };
}

/** A settled state: each player has `perms` permanents from the top of their library (Forests and Bears first). */
export function tableState(players: number, perms = 3): GameState {
  const session = new GameSession(config(players));
  const s = structuredClone(session.state) as GameState;
  for (const p of s.players) {
    const lib = s.zones.library[p.id] ?? [];
    // Forests and Bears are the first 20 cards of each deck before the shuffle; pick the first `perms` that are not the Sphinx.
    const picks = lib.filter((oid) => s.objects[oid]!.defId !== id('Secret Sphinx')).slice(0, perms);
    for (const oid of picks) {
      lib.splice(lib.indexOf(oid), 1);
      const o = s.objects[oid]!;
      o.zone = 'battlefield';
      o.controller = p.id;
      s.zones.battlefield.push(oid);
    }
  }
  return s;
}

/** `player` left the game (CR 104.5, 800.4a) in elimination `order`, their objects gone (as M12-2's leave procedure leaves the state). */
export function withLeft(s: GameState, player: PlayerId, order: number, reason: string): GameState {
  const t = structuredClone(s);
  const p = t.players.find((x) => x.id === player)!;
  p.hasLost = true;
  p.lostReason = reason;
  p.left = { turn: t.turn.number, order, reason };
  t.zones.battlefield = t.zones.battlefield.filter((oid) => t.objects[oid]!.owner !== player);
  return t;
}

export function viewOf(s: GameState, player: PlayerId): GameView {
  return viewFor(s, player);
}
