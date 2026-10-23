/**
 * M12-4b (docs/design/m12-multiplayer.md 5.3 items 4-5): one person against three computers. Each computer plays its own seat (its own player's view,
 * CR 400.2), one action at a time; the person conceding leaves a game that goes on (CR 104.3a, 800.4a) and the computers play it to the end. The current AI
 * plays a multiplayer game simply (M12-6 improves it).
 */
import { chooseAction } from '@openmtg/ai';
import { HIDDEN_DEF, placements, type Decision, type GameConfig, type GameView } from '@openmtg/engine';
import { describe, expect, it } from 'vitest';
import { ComputerGame, type Chooser } from '../../src/game/computer';
import { stateOfView } from '../../src/board/model';
import { FIXTURE_DEFS } from '../game-fixtures';

const id = (name: string) => FIXTURE_DEFS.find((d) => d.name === name)!.id;
const fill = (n: number, name: string) => Array<string>(n).fill(id(name));
const RED = [...fill(16, 'Mountain'), ...fill(8, 'Test Shock'), ...fill(16, 'Test Raider')];
const GREEN = [...fill(17, 'Forest'), ...fill(23, 'Test Bear')];

function fourPlayers(seed: string, life: number): GameConfig {
  return {
    seed,
    players: [
      { id: 'p1', name: 'Alice', deck: RED },
      { id: 'p2', name: 'Computer', deck: GREEN },
      { id: 'p3', name: 'Computer 3', deck: RED },
      { id: 'p4', name: 'Computer 4', deck: GREEN },
    ],
    defs: FIXTURE_DEFS,
    options: { startingLife: life, startingPlayer: 'p2', multiplayer: { variant: 'freeForAll', attack: 'multiple' } },
  };
}

async function settle(rounds = 3) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
}

/** The AI, checking that each computer decides only for itself and sees nothing hidden of the others (CR 400.2). */
function checkedAi(seen: Map<string, number>): Chooser {
  return (view: GameView, d: Decision, seed: string) => {
    expect(view.viewer).toBe(d.player);
    seen.set(d.player, (seen.get(d.player) ?? 0) + 1);
    for (const p of view.players) {
      if (p.id === view.viewer) continue;
      for (const oid of view.zones.hand[p.id] ?? []) expect(view.objects[oid]!.defId).toBe(HIDDEN_DEF);
    }
    return chooseAction(view, d, seed);
  };
}

describe('one person against three computers (m12 design 5.3 item 5)', () => {
  it('each computer plays its own seat; after the person concedes the game goes on and the computers play it to a result', async () => {
    const seen = new Map<string, number>();
    const game = new ComputerGame(fourPlayers('m12-4b-vs3', 4), 'p1', ['p2', 'p3', 'p4'], { delayMs: 0, seed: 'vs3', choose: checkedAi(seen) });
    expect(game.seated()).toEqual(['p1']);
    expect(game.computers).toEqual(['p2', 'p3', 'p4']);
    const off = game.subscribe(() => {});
    // the computers act until the person must decide (p2 starts)
    for (let i = 0; i < 2000 && game.view().pending?.player !== 'p1' && !game.view().result; i++) await settle(1);
    expect(game.view().pending?.player).toBe('p1');
    expect(seen.get('p2')).toBeGreaterThan(0);
    // the person leaves the game: it goes on for the computers (CR 104.3a, 800.4a)
    expect((await game.act({ type: 'concede', player: 'p1' })).ok).toBe(true);
    expect(game.view().result).toBeNull();
    expect(game.view().viewer).toBe('p1'); // the person keeps watching from their seat
    for (let i = 0; i < 20000 && !game.view().result; i++) await settle(1);
    off();
    const v = game.view();
    expect(v.result).not.toBeNull();
    expect(game.status()).toBeNull(); // no computer got stuck
    for (const c of ['p3', 'p4']) expect(seen.get(c) ?? 0).toBeGreaterThan(0);
    const order = placements(stateOfView(v));
    expect(order.at(-1)).toMatchObject({ player: 'p1', reason: 'conceded' }); // the first to leave is last
  }, 240_000);
});
