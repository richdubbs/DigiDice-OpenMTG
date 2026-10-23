/** Shared test helpers. */
import { applyAction, compileCard, createGame, type CardDef, type GameConfig, type GameState, type Action, type DecisionAnswer } from '../src/index';

/** Minimal synthetic definitions for skeleton tests (real cards come from the fixture file). */
export function basicLand(name: string, subtype: string): CardDef {
  return compileCard({ name, layout: 'normal', type_line: `Basic Land — ${subtype}`, oracle_text: '' });
}

export function vanilla(name: string, cost: string, pt: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: 'Creature — Bear', power: pt[0], toughness: pt[1], oracle_text: '' });
}

export function simpleConfig(seed = 'test-seed', extra: Partial<GameConfig> = {}): GameConfig {
  const forest = basicLand('Forest', 'Forest');
  const bear = vanilla('Test Bear', '{1}{G}', ['2', '2']);
  const deck = [...Array(20).fill('Forest'), ...Array(20).fill('Test Bear')];
  return {
    seed,
    players: [
      { name: 'Alice', deck, stops: { fullControl: true } },
      { name: 'Bob', deck, stops: { fullControl: true } },
    ],
    defs: [forest, bear],
    ...extra,
  };
}

/** Apply an action and fail loudly if it is rejected. */
export function act(state: GameState, action: Action): GameState {
  const r = applyAction(state, action);
  if (r.error) throw new Error(`Action rejected: ${r.error.message}`);
  return r.state;
}

/** Answer the pending decision. */
export function answer(state: GameState, a: DecisionAnswer): GameState {
  const d = state.pending;
  if (!d) throw new Error('No pending decision');
  return act(state, { type: 'answer', player: d.player, decisionId: d.id, answer: a });
}

/** Start a game with p1 playing first and both players keeping 7. */
export function startedGame(config: GameConfig = simpleConfig()): GameState {
  let s = createGame({ ...config, options: { startingPlayer: 'p1', ...config.options } });
  while (s.pending && s.pending.kind === 'mulligan') s = answer(s, { kind: 'mulligan', keep: true });
  return s;
}
