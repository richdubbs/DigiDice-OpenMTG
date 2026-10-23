/**
 * std-combat-3 (lane std-combat): the battlefield as it was immediately before a permanent left it, read by a quantity in a leaves-the-battlefield trigger's pattern
 * (CR 603.10a), played through the engine with synthetic cards compiled by the game's default compiler (wordings invented, design 6.10). Each test is named after the
 * rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 603.10a, 603.6c  "Whenever a creature an opponent controls with the greatest power among creatures that player controls dies, ...": the creature compared with
 *                       the creatures that player controlled just before it died, those that died with it and the effects they gave included; a tie is the greatest
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState, ObjectId } from '../../../src/index';
import { act, find, life, scenario } from '../../m3/scenario';
import { card, full, resolveAll } from '../cmd3/helpers';

const STALKER = card('Test Big Game Stalker', 'Creature — Human Warrior', 'Whenever a creature an opponent controls with the greatest power among creatures that player controls dies, you gain 2 life.', ['3', '3']);
const BRUTE = card('Test Hill Brute', 'Creature — Giant', '', ['4', '4']);
const IMP = card('Test Small Imp', 'Creature — Imp', '', ['2', '2']);
const TWIN = card('Test Even Twin', 'Creature — Elf', '', ['3', '3']);
const LORD = card('Test Banner Lord', 'Creature — Goblin', 'Other creatures you control get +2/+0.', ['2', '2']);
const RUNT = card('Test Little Runt', 'Creature — Goblin', '', ['1', '1']);
const SLAY = card('Test Quick Slaying', 'Instant', 'Destroy target creature.');
const WRATH = card('Test Great Wrath', 'Sorcery', 'Destroy all creatures.');
const DEFS: CardDef[] = [STALKER, BRUTE, IMP, TWIN, LORD, RUNT, SLAY, WRATH];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

const on = (s: GameState, name: string, player = 'p2'): ObjectId => s.zones.battlefield.find((id) => s.objects[id]!.defId === name && s.objects[id]!.controller === player)!;
const slay = (s: GameState, target: ObjectId): GameState => resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Quick Slaying', 'hand', 'p1') }), { targets: [{ kind: 'object', id: target }] });
const wrath = (s: GameState): GameState => resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Great Wrath', 'hand', 'p1') }));
const setup = (theirs: string[], mine: string[] = ['Test Big Game Stalker']): GameState =>
  scenario(['Plains'], { p1: { battlefield: mine, hand: ['Test Quick Slaying', 'Test Great Wrath'] }, p2: { battlefield: theirs }, defs: DEFS });

describe('CR 603.10a: "Whenever a creature an opponent controls with the greatest power among creatures that player controls dies"', () => {
  it('CR 603.10a: the greatest creature of the opponent dies: it triggers', () => {
    let s = setup(['Test Hill Brute', 'Test Small Imp']);
    s = slay(s, on(s, 'Test Hill Brute'));
    expect(life(s, 'p1')).toBe(22);
  });

  it('CR 603.10a: a smaller creature dies while a greater one stays: no trigger', () => {
    let s = setup(['Test Hill Brute', 'Test Small Imp']);
    s = slay(s, on(s, 'Test Small Imp'));
    expect(life(s, 'p1')).toBe(20);
  });

  it('CR 603.10a: creatures that die together are compared as they were together: only the greatest of them triggers (one, not two)', () => {
    let s = setup(['Test Hill Brute', 'Test Small Imp']);
    s = wrath(s);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2')).toHaveLength(0);
    expect(life(s, 'p1')).toBe(22);
  });

  it('CR 603.10a: a tie is the greatest: both creatures of equal greatest power that die together trigger', () => {
    let s = setup(['Test Even Twin', 'Test Even Twin', 'Test Small Imp']);
    s = wrath(s);
    expect(life(s, 'p1')).toBe(24);
  });

  it('CR 603.10a, 613.4c: the power each had then, with the effect of a lord that died with them (the 1/1 was 3/1, greater than the 2/2 lord)', () => {
    let s = setup(['Test Banner Lord', 'Test Little Runt']);
    s = wrath(s);
    expect(life(s, 'p1')).toBe(22);
  });

  it('CR 109.4: a creature of its own controller is no creature an opponent controls: no trigger', () => {
    let s = setup([], ['Test Big Game Stalker', 'Test Hill Brute']);
    s = slay(s, on(s, 'Test Hill Brute', 'p1'));
    expect(life(s, 'p1')).toBe(20);
  });
});
