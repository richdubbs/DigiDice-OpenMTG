/**
 * M11-2 test fixtures: a two-player Commander game from the engine (M11-0 contracts: `options.commander`, `PlayerConfig.commanders`), with the views the
 * client gets from `viewFor`. Alice's commander is Test Titania; Bob has two partners, Test Kraum and Test Tymna (CR 702.124).
 */
import {
  GameSession, commanderOptions, compileCard, viewFor, type CardDef, type CommanderVariant, type GameConfig, type GameState, type GameView, type ObjectId,
} from '@openmtg/engine';

const legend = (name: string, cost: string, text = ''): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: cost, type_line: 'Legendary Creature — Elf Warrior', power: '3', toughness: '3', oracle_text: text });

export const FOREST = compileCard({ name: 'Forest', layout: 'normal', type_line: 'Basic Land — Forest', oracle_text: '({T}: Add {G}.)' });
export const BEAR = compileCard({ name: 'Test Bear', layout: 'normal', mana_cost: '{1}{G}', type_line: 'Creature — Bear', power: '2', toughness: '2', oracle_text: '' });
export const TITANIA = legend('Test Titania', '{3}{G}');
export const KRAUM = legend('Test Kraum', '{3}{U}{R}', 'Partner');
export const TYMNA = legend('Test Tymna', '{1}{W}{B}', 'Partner');

export function commanderConfig(variant: CommanderVariant = 'commander', seed = 'm11-client'): GameConfig {
  const deck = [...Array<string>(20).fill(FOREST.id), ...Array<string>(20).fill(BEAR.id)];
  return {
    seed,
    players: [
      { id: 'p1', name: 'Alice', deck, commanders: [TITANIA.id], stops: { fullControl: true } },
      { id: 'p2', name: 'Bob', deck, commanders: [KRAUM.id, TYMNA.id], stops: { fullControl: true } },
    ],
    defs: [FOREST, BEAR, TITANIA, KRAUM, TYMNA],
    options: { skipMulligans: true, startingPlayer: 'p1', commander: commanderOptions(variant) },
  };
}

/** A started Commander game's state (a copy the test may change). */
export function commanderState(variant: CommanderVariant = 'commander'): GameState {
  return structuredClone(new GameSession(commanderConfig(variant)).state);
}

/** The command zone object of a commander by its name. */
export function commanderId(s: GameState | GameView, name: string): ObjectId {
  const id = s.zones.command.find((o) => s.defs[s.objects[o]!.defId]?.name === name);
  if (!id) throw new Error(`no ${name} in the command zone`);
  return id;
}

export function view(s: GameState, viewer: string | null): GameView {
  return viewFor(s, viewer);
}
