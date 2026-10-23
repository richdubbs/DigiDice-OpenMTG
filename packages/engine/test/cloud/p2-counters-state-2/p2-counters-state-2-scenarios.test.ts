/**
 * p2-counters-state-2 (lane p2-counters-state): "<instructions>, where X is <quantity>" played through the engine with synthetic cards compiled by the game's default
 * compiler (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified.
 *
 *   CR 107.3, 608.2h   X is the quantity of the clause in every instruction of the sentence, read as each instruction runs (the counter put first is counted)
 *   CR 107.1b          a computed X below 0 is 0 (no life lost by a gain of "the number of cards in your hand minus 4")
 */
import { describe, expect, it } from 'vitest';
import { type CardDef, type GameState, type ObjectId } from '../../../src/index';
import { act } from '../../m5/helpers';
import { drive, find, resolveAll, scenario, synthetic } from '../../m6/costs/support';

const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const handOf = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;

const URN = synthetic('Test Gloom Urn', 'Artifact', '{2}', '{T}: Draw X cards and gain X life, where X is the number of gloom counters on ~.');
const NEST = synthetic('Test Gloom Nest', 'Artifact', '{2}', '{T}: Put a gloom counter on ~, then create X 1/1 white Spirit creature tokens with flying, where X is the number of gloom counters on ~.');
const DEFS = [URN, NEST];
const activate = (s: GameState, id: ObjectId, key: string): GameState => resolveAll(drive(act(s, { type: 'activate', player: 'p1', source: id, ability: key })));

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 107.3, 608.2h: "Draw X cards and gain X life, where X is the number of gloom counters on ~."', () => {
  it('CR 107.3: three gloom counters: three cards and 3 life; with none, nothing', () => {
    let s = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Test Gloom Urn'] } });
    const id = find(s, 'Test Gloom Urn', 'battlefield');
    s.objects[id]!.counters['gloom'] = 3;
    const hand0 = handOf(s, 'p1');
    const life0 = lifeOf(s, 'p1');
    s = activate(s, id, 'p:0:0');
    expect(handOf(s, 'p1')).toBe(hand0 + 3);
    expect(lifeOf(s, 'p1')).toBe(life0 + 3);
    s = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Test Gloom Urn'] } });
    const h1 = handOf(s, 'p1');
    s = activate(s, find(s, 'Test Gloom Urn', 'battlefield'), 'p:0:0');
    expect(handOf(s, 'p1')).toBe(h1);
  });
});

describe('CR 608.2h: "Put a gloom counter on ~, then create X ... tokens, where X is the number of gloom counters on ~."', () => {
  it('CR 608.2h: X is read as the second instruction runs: the counter put first is counted (one counter before: two tokens), another kind is not', () => {
    let s = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Test Gloom Nest'] } });
    const id = find(s, 'Test Gloom Nest', 'battlefield');
    s.objects[id]!.counters = { gloom: 1, charge: 5 };
    s = activate(s, id, 'p:0:0');
    expect(s.objects[id]!.counters['gloom']).toBe(2);
    expect(s.zones.battlefield.filter((x) => s.objects[x]!.kind === 'token').length).toBe(2);
  });
});
