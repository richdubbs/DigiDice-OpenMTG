/**
 * Real fixture decks for the AI tests (60 cards each, cards from packages/engine/test/fixtures, nearly all fully automated) and the game configuration
 * helper. Test data only: never shipped.
 */
import { compiledDefs } from '../../engine/test/fixtures';
import type { CardDef, GameConfig, StopSettings } from '@openmtg/engine';
import { AI_STOPS } from '../src/index';

export type DeckList = readonly (readonly [string, number])[];

/** Red-green creatures, burn and pump. */
export const RG_STOMPY: DeckList = [
  ['Mountain', 11], ['Forest', 11], ['Llanowar Elves', 4], ['Grizzly Bears', 4], ['Raging Goblin', 2], ['Hill Giant', 4], ['Prodigal Pyromancer', 2],
  ['Flametongue Kavu', 3], ['Craw Wurm', 2], ['Colossal Dreadmaw', 1], ['Lightning Bolt', 4], ['Shock', 3], ['Giant Growth', 4], ['Rancor', 2],
  ['Lava Axe', 1], ['Bonesplitter', 2],
];

/** White-black creatures, removal and Auras. */
export const WB_REMOVAL: DeckList = [
  ['Plains', 12], ['Swamp', 12], ['Typhoid Rats', 4], ['Soul Warden', 2], ["Ajani's Pridemate", 3], ['White Knight', 3], ['Black Knight', 3],
  ['Vampire Nighthawk', 3], ['Serra Angel', 3], ['Doom Blade', 3], ['Murder', 2], ['Swords to Plowshares', 3], ['Pacifism', 3], ['Raise the Alarm', 2],
  ['Holy Strength', 2],
];

/** Blue-green creatures, counterspells and a planeswalker. */
export const UG_TEMPO: DeckList = [
  ['Island', 11], ['Forest', 12], ['Llanowar Elves', 3], ['Elvish Visionary', 4], ['Grizzly Bears', 4], ['Giant Spider', 3], ['Air Elemental', 3],
  ['Craw Wurm', 2], ['Colossal Dreadmaw', 1], ['Counterspell', 4], ['Mana Leak', 3], ['Essence Scatter', 3], ['Giant Growth', 3], ['Think Twice', 2],
  ['Garruk Wildspeaker', 2],
];

export const DECKS: readonly DeckList[] = [RG_STOMPY, WB_REMOVAL, UG_TEMPO];

export const expand = (d: DeckList): string[] => d.flatMap(([n, c]) => Array<string>(c).fill(n));

const DEF_CACHE = new Map<string, CardDef>();
function defsFor(...decks: DeckList[]): CardDef[] {
  const names = [...new Set(decks.flatMap((d) => d.map(([n]) => n)))];
  const missing = names.filter((n) => !DEF_CACHE.has(n));
  for (const d of compiledDefs(missing)) DEF_CACHE.set(d.id, d);
  return names.map((n) => DEF_CACHE.get(n)!);
}

/** Stops for both players: the AI's own (removal before combat, tricks after blocks, end-of-turn instants). */
export const TEST_STOPS: Partial<StopSettings> = AI_STOPS;

export function gameConfig(seed: string, deck1: DeckList, deck2: DeckList, opts: { mulligans?: boolean } = {}): GameConfig {
  return {
    seed,
    players: [
      { name: 'One', deck: expand(deck1), stops: TEST_STOPS },
      { name: 'Two', deck: expand(deck2), stops: TEST_STOPS },
    ],
    defs: defsFor(deck1, deck2),
    options: opts.mulligans === false ? { skipMulligans: true } : {},
  };
}
