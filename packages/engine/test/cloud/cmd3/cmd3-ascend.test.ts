/**
 * CMD3 (commander batch): ascend and the city's blessing (CR 702.131), played through the engine with synthetic cards (wordings invented, design 6.10).
 *
 *   CR 702.131a  ascend on an instant or sorcery: as it resolves, ten or more permanents give you the city's blessing (before the rest of the spell, CR 608.2c)
 *   CR 702.131b  ascend on a permanent: any time you control ten or more permanents, you get the city's blessing (no stack)
 *   CR 702.131c  the city's blessing stays for the rest of the game
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { act, find, scenario } from '../../m3/scenario';
import { card, cast, full, pt, resolveAll } from './helpers';

const STATUE = card('Test Statue', 'Artifact Creature — Golem', "Ascend\nAs long as you have the city's blessing, this creature gets +2/+2.", ['1', '1']);
const BEAR = card('Test Bear', 'Creature — Bear', "As long as you have the city's blessing, this creature gets +1/+1.", ['2', '2']);
const STUDY = card('Test Study', 'Sorcery', "Ascend\nDraw a card. If you have the city's blessing, draw another card.");
const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
const DEFS = [STATUE, BEAR, STUDY, SMITE];

const blessed = (s: GameState, p = 'p1'): boolean => s.designations.citysBlessing?.includes(p) === true;
const lands = (n: number): string[] => Array.from({ length: n }, () => 'Plains');

describe('the cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 702.131b: ascend on a permanent', () => {
  it('the tenth permanent gives the city\'s blessing at once (no trigger); it stays when the permanents are gone (CR 702.131c)', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Statue', 'Test Smite'], battlefield: lands(9) }, defs: DEFS });
    expect(blessed(s)).toBe(false);
    s = resolveAll(cast(s, 'Test Statue'));
    expect(blessed(s)).toBe(true);
    expect(s.zones.stack).toHaveLength(0);
    const statue = find(s, 'Test Statue', 'battlefield');
    expect(pt(s, statue)).toBe('3/3');
    s = resolveAll(cast(s, 'Test Smite', { targets: [{ kind: 'object', id: statue }] }));
    expect(blessed(s)).toBe(true);
  });
  it('nine permanents: no blessing', () => {
    const s = resolveAll(cast(scenario(['Plains'], { p1: { hand: ['Test Statue'], battlefield: lands(8) }, defs: DEFS }), 'Test Statue'));
    expect(blessed(s)).toBe(false);
    expect(pt(s, find(s, 'Test Statue', 'battlefield'))).toBe('1/1');
  });
  it('ten permanents without a permanent with ascend: no blessing', () => {
    const s = resolveAll(cast(scenario(['Plains'], { p1: { hand: ['Test Bear'], battlefield: lands(9) }, defs: DEFS }), 'Test Bear'));
    expect(blessed(s)).toBe(false);
    expect(pt(s, find(s, 'Test Bear', 'battlefield'))).toBe('2/2');
  });
  it("the opponent's permanents don't count", () => {
    const s = resolveAll(cast(scenario(['Plains'], { p1: { hand: ['Test Statue'], battlefield: lands(4) }, p2: { battlefield: lands(6) }, defs: DEFS }), 'Test Statue'));
    expect(blessed(s)).toBe(false);
    expect(blessed(s, 'p2')).toBe(false);
  });
});

describe('CR 702.131a: ascend on a sorcery', () => {
  it('ten permanents as it resolves: the blessing comes first, so the spell draws two cards', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Study'], battlefield: lands(10) }, defs: DEFS });
    const hand = s0.zones.hand['p1']!.length;
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Study', 'hand') }));
    expect(blessed(s)).toBe(true);
    expect(s.zones.hand['p1']!.length).toBe(hand - 1 + 2);
  });
  it('nine permanents: no blessing, one card', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Study'], battlefield: lands(9) }, defs: DEFS });
    const hand = s0.zones.hand['p1']!.length;
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Study', 'hand') }));
    expect(blessed(s)).toBe(false);
    expect(s.zones.hand['p1']!.length).toBe(hand - 1 + 1);
  });
});
