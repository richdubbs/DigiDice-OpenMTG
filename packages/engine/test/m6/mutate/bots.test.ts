/**
 * M6-9: random bots (test/m3/bot.ts: a uniformly random legal action or answer) play decks of Gemrazer, mutate targets (Llanowar Elves, Grizzly Bears), a
 * Human (Elite Vanguard) and removal (Doom Blade): every listed action is accepted, nothing throws, zones and objects agree after every action, every merged
 * permanent is on the battlefield with a topmost component that matches it (CR 730.2a, 730.2d), and some games really mutate.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, createGame, type GameConfig, type GameState } from '../../../src/index';
import { compiledDefs } from '../../fixtures';
import { Bot } from '../../m3/bot';
import { BEARS, ELVES, GEMRAZER, VANGUARD } from './support';

const DECK: [string, number][] = [[GEMRAZER, 10], [ELVES, 8], [BEARS, 6], [VANGUARD, 4], ['Doom Blade', 4], ['Forest', 14], ['Swamp', 4]];
const deck = (): string[] => DECK.flatMap(([n, c]) => Array(c).fill(n) as string[]);

function check(s: GameState): void {
  for (const [id, o] of Object.entries(s.objects)) {
    if (!o.components) continue;
    if (o.zone !== 'battlefield') throw new Error(`${id} has components outside the battlefield`);
    const top = o.components[0]!;
    if (top.defId !== o.defId || top.kind !== o.kind || top.cardId !== o.cardId) throw new Error(`${id}: the topmost component is not the object (CR 730.2a, 730.2d)`);
  }
  for (const id of s.zones.battlefield) if (!s.objects[id]) throw new Error(`${id} listed on the battlefield but missing`);
  for (const [id, o] of Object.entries(s.objects)) {
    const list = o.zone === 'battlefield' || o.zone === 'stack' || o.zone === 'exile' || o.zone === 'command' ? s.zones[o.zone] : s.zones[o.zone][o.owner]!;
    if (!list.includes(id)) throw new Error(`${id} (${o.defId}) is not listed in its zone ${o.zone}`);
  }
}

describe('M6-9: random games with mutate', () => {
  it('five seeded games of 600 actions: no rejected action, no inconsistent merged permanent, and mutating happens', () => {
    let mutated = 0;
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const cfg: GameConfig = { seed: `mutate-${seed}`, players: [{ name: 'Alice', deck: deck() }, { name: 'Bob', deck: deck() }], defs: compiledDefs(DECK.map(([n]) => n)) };
      const bot = new Bot(`mutate-${seed}`);
      let s = createGame(cfg);
      for (let i = 0; i < 600 && !s.result; i++) {
        const action = bot.next(s);
        const r = applyAction(s, action);
        if (r.error) throw new Error(`game ${seed}, action ${i}: ${JSON.stringify(action)} was rejected: ${r.error.message}`);
        mutated += r.events.filter((e) => e.type === 'mutated').length;
        s = r.state;
        check(s);
      }
    }
    expect(mutated).toBeGreaterThan(0);
  }, 120_000);
});
