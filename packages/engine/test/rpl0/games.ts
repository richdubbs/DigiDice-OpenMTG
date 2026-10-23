/**
 * RPL-0 test games: seeded AI-against-AI games on the AI's fixture decks (packages/ai/test/harness.ts), and random-bot games with face-down cards
 * (the M6-3 decks) and with looting and discard spells (the NETFIX2 deck of packages/net), each with every state along the way.
 */
import { applyAction, createGame, type Action, type GameConfig, type GameEvent, type GameState } from '../../src/index';
import { compiledDefs } from '../fixtures';
import { Bot } from '../m3/bot';
import { synthetic } from '../m6/face-down/support';
import { aiAgent, playGame } from '../../../ai/test/harness';
import { DECKS, gameConfig } from '../../../ai/test/decks';

export interface PlayedGame {
  config: GameConfig;
  actions: Action[];
  /** `states[0]` is the new game; `states[i + 1]` the state after `actions[i]`. */
  states: GameState[];
  /** `events[i]`: what `actions[i]` returned. */
  events: GameEvent[][];
}

/** Apply a log from the start, keeping every state and every action's events. */
export function rerun(config: GameConfig, actions: readonly Action[]): PlayedGame {
  let s = createGame(config);
  const states = [s];
  const events: GameEvent[][] = [];
  for (const a of actions) {
    const r = applyAction(s, a);
    if (r.error) throw new Error(`the log was rejected: ${r.error.message}`);
    s = r.state;
    states.push(s);
    events.push(r.events);
  }
  return { config, actions: [...actions], states, events };
}

/** A seeded AI-against-AI game on two of the AI's fixture decks. */
export function aiGame(seed: string, deck1 = 0, deck2 = 1, maxActions = 3000): PlayedGame {
  const config = gameConfig(seed, DECKS[deck1]!, DECKS[deck2]!);
  const played = playGame(config, { p1: aiAgent(`${seed}-p1`), p2: aiAgent(`${seed}-p2`) }, maxActions);
  if (played.rejected.length > 0) throw new Error(`the AI's action was refused: ${played.rejected[0]!.message}`);
  return rerun(config, played.actions);
}

const SYNTH = [
  synthetic('Test Shroud Tailor', 'Creature — Human Rogue', '{1}{U}', 'When this creature enters, cloak the top card of your library.', { power: '1', toughness: '1' }),
  synthetic('Test Mask Weaver', 'Creature — Human Wizard', '{1}{U}', '{1}: Turn target face-down creature face up.', { power: '1', toughness: '2' }),
  synthetic('Test Veil Caster', 'Creature — Human Wizard', '{1}{U}', '{2}: Turn target creature face down.', { power: '1', toughness: '2' }),
  synthetic('Test Mist Seer', 'Creature — Human Wizard', '{2}{U}', 'When this creature enters, manifest the top card of your library.', { power: '1', toughness: '1' }),
];
const FACE_DOWN_A = ['Exalted Angel', 'Den Protector', 'Hooded Hydra', 'Grinning Demon', 'Whisperwood Elemental', 'Test Shroud Tailor', 'Test Veil Caster', 'Lightning Bolt'];
const FACE_DOWN_B = ['Willbender', 'Alley Assailant', 'Branchsnap Lorian', 'Clone', 'Test Mask Weaver', 'Test Mist Seer', 'Counterspell', 'Shock'];
const LANDS = ['Plains', 'Forest', 'Island', 'Swamp', 'Mountain'];
/** packages/net test/hidden-events.test.ts DISCARD_LIST: looting, a discard spell that reveals a hand, cycling. */
const DISCARDS: Record<string, number> = { Swamp: 10, Mountain: 9, Island: 3, 'Faithless Looting': 4, Pilfer: 4, 'Intimidation Tactics': 4, 'Giant Koi': 4, 'Elvish Visionary': 2 };

function deckOf(cards: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < 2; i++) out.push(...cards);
  while (out.length < 40) out.push(LANDS[out.length % LANDS.length]!);
  return out;
}

/** The M6-3 face-down decks (morph, megamorph, disguise, manifest, cloak, Clone). */
export function faceDownConfig(seed: string): GameConfig {
  return {
    seed,
    players: [
      { name: 'Alice', deck: deckOf(FACE_DOWN_A), stops: { fullControl: true } },
      { name: 'Bob', deck: deckOf(FACE_DOWN_B), stops: { fullControl: true } },
    ],
    defs: [...compiledDefs([...new Set([...FACE_DOWN_A, ...FACE_DOWN_B, ...LANDS])].filter((n) => !n.startsWith('Test '))), ...SYNTH],
    options: { skipMulligans: true },
  };
}

/** Both players loot, cycle and cast discard spells (packages/net's NETFIX2 deck), with mulligans. */
export function discardConfig(seed: string): GameConfig {
  const deck = Object.entries(DISCARDS).flatMap(([n, c]) => Array<string>(c).fill(n));
  return {
    seed,
    players: [
      { name: 'Alice', deck, stops: { fullControl: true } },
      { name: 'Bob', deck, stops: { fullControl: true } },
    ],
    defs: compiledDefs(Object.keys(DISCARDS)),
  };
}

/** A game of the seeded random bot of the soak tests. */
export function botGame(config: GameConfig, budget: number): PlayedGame {
  const bot = new Bot(config.seed);
  let s = createGame(config);
  const actions: Action[] = [];
  for (let i = 0; i < budget && !s.result && s.pending; i++) {
    const a = bot.next(s);
    const r = applyAction(s, a);
    if (r.error) continue;
    s = r.state;
    actions.push(a);
  }
  return rerun(config, actions);
}
