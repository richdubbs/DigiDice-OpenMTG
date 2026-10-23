/**
 * WP11 review: the replacement funnels (design 8.5) must not depend on which modules a caller happened to import. This file deliberately imports only the core
 * modules a game needs (create, game, zones, the card compiler), never src/index or effects/: "as it enters" replacements (CR 614.1c, 614.12) still apply.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/types/card';
import { compileCard } from '../../../src/cards/compile';
import { parseEntersWithCounters } from '../../../src/cards/enters-with';
import { createGame } from '../../../src/core/create';
import { Game } from '../../../src/core/game';
import { moveObject } from '../../../src/core/zones';
import { clone } from '../../../src/util/clone';

// WP18: the default compiler classifies against the engine's capability set, which the package entry (src/index) installs; this file must not load it,
// so the definition is built face by face with the enters-with recognizer, exactly the static ability milestone 4's compiler made.
const ooze = compileCard({ name: 'Test Ooze', layout: 'normal', mana_cost: '{1}', type_line: 'Creature — Ooze', power: '0', toughness: '0', oracle_text: 'This creature enters with two +1/+1 counters on it.', colors: [] } as unknown as OracleCard,
  (face) => ({ abilities: [parseEntersWithCounters(face.oracleText, face.name)!], unsupported: [] }));

describe('CR 614.1c, 614.12: replacement effects apply whatever modules were loaded', () => {
  it('a creature that "enters with two +1/+1 counters", moved from the library with only the core modules loaded, has them', () => {
    const deck = Array(40).fill('Test Ooze') as string[];
    const s = createGame({ seed: 'funnel', players: [{ name: 'Alice', deck }, { name: 'Bob', deck }], defs: [ooze], options: { startingPlayer: 'p1', skipMulligans: true } });
    const g = new Game(clone(s), []);
    const id = s.zones.library.p1![0]!;
    const newId = moveObject(g, id, 'battlefield', { controller: 'p1' });
    expect(g.s.objects[newId!]!.counters).toEqual({ '+1/+1': 2 });
  });
});
