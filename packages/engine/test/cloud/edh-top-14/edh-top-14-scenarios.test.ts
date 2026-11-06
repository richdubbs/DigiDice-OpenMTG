/**
 * Commander lane edh-top, round edh-top-14: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 * Alice (p1) controls the Aura. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 303.4, 701.3a-b, 608.2c  "Then attach this Aura to another one of your opponents chosen at random." (Maddening Hex: never the enchanted player; with no other opponent it stays)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, pass } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [] } as OracleCard);
}
const HEX = card('Test Hex', 'Enchantment — Aura', 'Enchant player\nWhenever enchanted player casts a noncreature spell, roll a d6. ~ deals damage to that player equal to the result. Then attach ~ to another one of your opponents chosen at random.');
const PEBBLE = card('Test Pebble', 'Sorcery', 'You gain 1 life.');
const ZAP = card('Test Zap', 'Instant', 'You gain 1 life.');
const GRIZZLY = card('Test Grizzly', 'Creature — Bear', 'Flash');
const objOf = (s: GameState, name: string): ObjectId => Object.values(s.objects).find((o) => s.defs[o.defId]?.name === name && o.zone === 'battlefield')!.id;
const attachedTo = (s: GameState, id: ObjectId): string | null => (s.objects[id]?.attachedTo as string | undefined) ?? null;

/** p1 casts a spell, p2 (whom the Aura enchants) answers with an instant; everything then resolves. */
function play(players: number, seed: string, spell = 'Test Zap'): GameState {
  let s = mpScenario({ players, seed, defs: [HEX, PEBBLE, ZAP, GRIZZLY], zones: { p1: { battlefield: ['Test Hex'], hand: ['Test Pebble'] }, p2: { hand: [spell] } },
    setup: (st) => { objOf(st, 'Test Hex'); (Object.values(st.objects).find((o) => st.defs[o.defId]?.name === 'Test Hex')!).attachedTo = 'p2'; } });
  s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Pebble', 'hand', 'p1') } as never);
  if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
  s = pass(s); // p1 passes: p2 gets priority with Test Pebble on the stack
  s = act(s, { type: 'cast', player: 'p2', card: find(s, spell, 'hand', 'p2') } as never);
  if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
  for (let i = 0; i < 30 && s.zones.stack.length > 0; i++) s = pass(s);
  return s;
}

describe('CR 303.4, 701.3a-b, 608.2c: "Then attach this Aura to another one of your opponents chosen at random."', () => {
  it('is automated', () => {
    expect(HEX.automation.level).toBe('full');
  });
  it('three players: the damage goes to the enchanted player and the Aura moves to the only other opponent', () => {
    const s = play(3, 'hex-3');
    expect(attachedTo(s, objOf(s, 'Test Hex'))).toBe('p3');
    expect(s.players.find((p) => p.id === 'p2')!.life).toBeLessThanOrEqual(20); // 20 + 1 (the Zap's life) - a d6 (1 to 6): between 15 and 20, never untouched at 21
    expect(s.players.find((p) => p.id === 'p2')!.life).toBeGreaterThanOrEqual(15);
    expect(s.players.find((p) => p.id === 'p3')!.life).toBe(20);
  });
  it('four players: it moves to one of the two other opponents, never stays on the enchanted player (several seeds)', () => {
    const seen = new Set<string | null>();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const s = play(4, seed);
      seen.add(attachedTo(s, objOf(s, 'Test Hex')));
    }
    expect([...seen].every((x) => x === 'p3' || x === 'p4')).toBe(true);
    expect(seen.size).toBeGreaterThan(0);
  });
  it('the Aura on its own controller moves to one of the two other players, never stays (the controller is not excluded, only the enchanted player)', () => {
    let s = mpScenario({ players: 3, seed: 'own', defs: [HEX, PEBBLE, ZAP], zones: { p1: { battlefield: ['Test Hex'], hand: ['Test Pebble'] }, p2: { hand: ['Test Zap'] } },
      setup: (st) => { Object.values(st.objects).find((o) => st.defs[o.defId]?.name === 'Test Hex')!.attachedTo = 'p1'; } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Pebble', 'hand', 'p1') } as never);
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    // p1 enchanted: the trigger is "enchanted player casts": p1 casting the Pebble (a noncreature spell) triggers it; its opponents are p2 and p3
    for (let i = 0; i < 30 && s.zones.stack.length > 0; i++) s = pass(s);
    expect(['p2', 'p3']).toContain(attachedTo(s, objOf(s, 'Test Hex')));
  });
  it('a noncreature spell only: a creature spell by the enchanted player does not trigger it (negative)', () => {
    const s = play(3, 'hex-3', 'Test Grizzly');
    expect(attachedTo(s, objOf(s, 'Test Hex'))).toBe('p2');
  });
});
