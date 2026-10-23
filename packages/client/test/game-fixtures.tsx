/** Fixture decks and a tiny app shell for the game-flow tests (work package C7). */
import { useState } from 'react';
import { compileCard, type CardDef, type GameConfig } from '@openmtg/engine';
import { NavProvider, useNav } from '../src/app/nav';
import { GameScreen, type GameScreenProps } from '../src/game/GameScreen';
import { SettingsStore } from '../src/settings/settings';

export const FIXTURE_DEFS: CardDef[] = [
  compileCard({ name: 'Mountain', layout: 'normal', type_line: 'Basic Land — Mountain', oracle_text: '({T}: Add {R}.)' }),
  compileCard({ name: 'Forest', layout: 'normal', type_line: 'Basic Land — Forest', oracle_text: '({T}: Add {G}.)' }),
  compileCard({ name: 'Test Shock', layout: 'normal', mana_cost: '{R}', type_line: 'Instant', oracle_text: 'Test Shock deals 2 damage to any target.' }),
  compileCard({ name: 'Test Raider', layout: 'normal', mana_cost: '{1}{R}', type_line: 'Creature — Goblin', power: '2', toughness: '2', oracle_text: '' }),
  compileCard({ name: 'Test Bear', layout: 'normal', mana_cost: '{1}{G}', type_line: 'Creature — Bear', power: '2', toughness: '2', oracle_text: '' }),
];

export const CARD_NAMES = FIXTURE_DEFS.map((d) => d.name);

const fill = (n: number, name: string) => Array<string>(n).fill(name);

/** Alice: red (lands, burn with a target, creatures); Bob: green creatures. Default stops (the engine passes for a player without a stop). */
export function hotSeatConfig(seed: string, startingLife = 6): GameConfig {
  const id = (name: string) => FIXTURE_DEFS.find((d) => d.name === name)!.id;
  return {
    seed,
    players: [
      { id: 'p1', name: 'Alice', deck: [...fill(16, id('Mountain')), ...fill(12, id('Test Shock')), ...fill(12, id('Test Raider'))] },
      { id: 'p2', name: 'Bob', deck: [...fill(17, id('Forest')), ...fill(23, id('Test Bear'))] },
    ],
    defs: FIXTURE_DEFS,
    options: { startingLife },
  };
}

/** An in-memory Storage (localStorage stand-in). `failing` makes every call throw, like a browser that blocks storage. */
export function memoryStorage(initial: Record<string, string> = {}, failing = false): Storage {
  const data = new Map(Object.entries(initial));
  const guard = () => {
    if (failing) throw new Error('storage blocked');
  };
  return {
    get length() {
      guard();
      return data.size;
    },
    clear: () => (guard(), data.clear()),
    getItem: (k) => (guard(), data.get(k) ?? null),
    key: (i) => (guard(), [...data.keys()][i] ?? null),
    removeItem: (k) => (guard(), void data.delete(k)),
    setItem: (k, v) => (guard(), void data.set(k, String(v))),
  };
}

export function testSettings(): SettingsStore {
  return new SettingsStore(memoryStorage());
}

/** The game route with test props (no cover delay, settings in memory); any other route shows its name. */
export function GameShell({ props }: { props?: Partial<GameScreenProps> }) {
  const nav = useNav();
  const { route } = nav;
  const [settings] = useState(testSettings);
  if (route.screen === 'game')
    return <GameScreen connection={route.connection} {...(route.rematch ? { rematch: route.rematch } : {})} coverDelayMs={0} settings={settings} {...props} />;
  return (
    <>
      <p data-testid="route">{route.screen}</p>
      <button type="button" onClick={nav.back}>
        Test back
      </button>
    </>
  );
}

/** The game route for `connection`; `rematch` is what the New game screen would put on the route (localRematch in game/services.ts). */
export function renderGameApp(connection: GameScreenProps['connection'], props?: Partial<GameScreenProps>, rematch?: () => GameScreenProps['connection']) {
  return (
    <NavProvider initial={{ screen: 'game', connection, ...(rematch ? { rematch } : {}) }}>
      <GameShell {...(props ? { props } : {})} />
    </NavProvider>
  );
}
