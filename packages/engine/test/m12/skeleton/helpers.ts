/**
 * M12-1 test helpers: multiplayer game configurations (docs/design/m12-multiplayer.md 4.1). Decks of Forests and bears, as test/helpers.ts#simpleConfig.
 */
import { createGame, type GameConfig, type GameState, type MultiplayerOptions } from '../../../src/index';
import { act, basicLand, simpleConfig, vanilla } from '../../helpers';

export const FREE_FOR_ALL: MultiplayerOptions = { variant: 'freeForAll', attack: 'multiple' };

const NAMES = ['Alice', 'Bob', 'Carol', 'Dan', 'Eve'];

/** A game of `n` players (Alice, Bob, Carol, Dan, ...), with `options.multiplayer` when n > 2 unless `extra.options` says otherwise. */
export function playersConfig(n: number, seed = 'm12-config', extra: Partial<GameConfig> = {}): GameConfig {
  const forest = basicLand('Forest', 'Forest');
  const bear = vanilla('Test Bear', '{1}{G}', ['2', '2']);
  const deck = [...Array(20).fill('Forest'), ...Array(20).fill('Test Bear')];
  return {
    ...simpleConfig(seed),
    players: NAMES.slice(0, n).map((name) => ({ name, deck, stops: { fullControl: true } })),
    defs: [forest, bear],
    options: n > 2 ? { multiplayer: FREE_FOR_ALL } : {},
    ...extra,
  };
}

/** A started `n`-player game: p1 plays first, no mulligans, at the first main phase of turn 1. */
export function mainPhaseGame(n: number, seed = 'm12-game', extra: Partial<GameConfig['options']> = {}): GameState {
  const base = playersConfig(n, seed);
  let s = createGame({ ...base, options: { ...base.options, startingPlayer: 'p1', skipMulligans: true, ...extra } });
  while (s.turn.step !== 'main1') s = act(s, { type: 'pass', player: s.pending!.player });
  return s;
}
