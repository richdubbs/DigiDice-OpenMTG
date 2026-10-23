/**
 * Board fixtures: a real two-player game driven by a tiny scripted player (lands, then creatures, attack with everything, block one-for-one), with the view of
 * the deciding player captured at every step that gives priority. Views come from the engine's `viewFor`, exactly as `GameConnection.view()` returns them.
 * Bob's deck holds "Secret Sphinx" (ten mana, never cast here): a card that must never be readable on Alice's screen.
 */
import {
  GameSession, compileCard, legalActions, viewFor, type Action, type DecisionAnswer, type GameConfig, type GameState, type GameView, type Step,
} from '@openmtg/engine';

export const ALICE = 'p1';
export const BOB = 'p2';
export const SECRET = 'Secret Sphinx';

export function boardConfig(seed = 'board-seed'): GameConfig {
  const forest = compileCard({ name: 'Forest', layout: 'normal', type_line: 'Basic Land — Forest', oracle_text: '' });
  const bear = compileCard({ name: 'Test Bear', layout: 'normal', mana_cost: '{1}{G}', type_line: 'Creature — Bear', power: '2', toughness: '2', oracle_text: '' });
  const sphinx = compileCard({ name: SECRET, layout: 'normal', mana_cost: '{9}{U}', type_line: 'Creature — Sphinx', power: '9', toughness: '9', oracle_text: '' });
  const alice = [...Array<string>(18).fill(forest.id), ...Array<string>(22).fill(bear.id)];
  const bob = [...Array<string>(16).fill(forest.id), ...Array<string>(14).fill(bear.id), ...Array<string>(10).fill(sphinx.id)];
  return {
    seed,
    players: [
      { name: 'Alice', deck: alice, stops: { fullControl: true } },
      { name: 'Bob', deck: bob, stops: { fullControl: true } },
    ],
    defs: [forest, bear, sphinx],
    options: { skipMulligans: true, startingPlayer: ALICE },
  };
}

/** The scripted player's next action, or null when the game is over. */
export function nextAction(s: GameState): Action | null {
  const d = s.pending;
  if (!d) return null;
  const player = d.player;
  const answer = (a: DecisionAnswer): Action => ({ type: 'answer', player, decisionId: d.id, answer: a });
  switch (d.kind) {
    case 'priority': {
      const legal = legalActions(s, player);
      const mainOfMine = s.turn.activePlayer === player && (s.turn.step === 'main1' || s.turn.step === 'main2') && s.zones.stack.length === 0;
      if (mainOfMine) {
        const land = legal.find((a) => a.kind === 'playLand');
        if (land) return land.action;
        const cast = legal.find((a) => a.kind === 'cast');
        if (cast) return cast.action;
      }
      return { type: 'pass', player };
    }
    case 'payCost':
      return answer({ kind: 'payCost', auto: true });
    case 'declareAttackers':
      return answer({ kind: 'declareAttackers', attacks: d.candidates.map((c) => ({ attacker: c.id, defender: c.defenders[0]! })) });
    case 'declareBlockers': {
      const used = new Set<string>();
      const blocks: { blocker: string; attacker: string }[] = [];
      for (const c of d.candidates) {
        const a = c.attackers.find((x) => !used.has(x));
        if (a) {
          used.add(a);
          blocks.push({ blocker: c.id, attacker: a });
        }
      }
      return answer({ kind: 'declareBlockers', blocks });
    }
    case 'mulligan':
      return answer({ kind: 'mulligan', keep: true });
    case 'playFirst':
      return answer({ kind: 'playFirst', player });
    case 'chooseObjects':
      return answer({ kind: 'chooseObjects', ids: d.options.slice(0, d.min) });
    default:
      throw new Error(`fixture driver: unexpected decision ${d.kind}`);
  }
}

export interface Captured {
  step: Step;
  turn: number;
  /** The settled state (for assertions about what is hidden). */
  state: GameState;
  /** The deciding player's view. */
  view: GameView;
}

/**
 * Plays `turns` turns and returns the first priority view of every (turn, step), plus extra views chosen by `keep` (e.g. a spell on the stack).
 */
export function playGame(turns = 6, seed?: string, keep?: (s: GameState) => boolean): { session: GameSession; captured: Captured[]; kept: Captured[] } {
  const session = new GameSession(boardConfig(seed));
  const captured: Captured[] = [];
  const kept: Captured[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const s = session.state;
    if (!s.pending || s.turn.number > turns) break;
    if (s.pending.kind === 'priority') {
      const cap = (): Captured => ({ step: s.turn.step, turn: s.turn.number, state: s, view: viewFor(s, s.pending!.player) });
      const key = `${s.turn.number}:${s.turn.step}`;
      if (!seen.has(key)) {
        seen.add(key);
        captured.push(cap());
      }
      if (keep?.(s)) kept.push(cap());
    }
    const a = nextAction(s);
    if (!a) break;
    const r = session.apply(a);
    if (!r.ok) throw new Error(`fixture driver: ${a.type} rejected: ${r.error.message}`);
  }
  return { session, captured, kept };
}

/** A deep copy of a view to edit for a crafted fixture. */
export function editable(view: GameView): GameView {
  return structuredClone(view);
}
