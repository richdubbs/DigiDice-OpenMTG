/**
 * r3-cost: mana instructions with an amount before the symbol ("add that much {R}", "add six {R}"; zz-cloud/std-tmt.json eff.stdtmt.mana.thatMuch, which r3-cost had duplicated; Standard merge wave 4), played
 * through the engine with synthetic cards (design 6.10).
 *
 *   CR 603.2, 120.3, 106.4   "Whenever ~ is dealt damage, add that much {R}": as much red mana as the damage dealt
 *   CR 106.4, 500.4          "Until end of turn, you don't lose this mana as steps and phases end": the mana stays in the pool through the turn's steps
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { act, advanceTo, answer, card, cast, drive, find, full, legal, obj, passBoth, pool, resolveAll, scenario } from './support';

const RAGER = card('Test Pain Rager', 'Creature — Turtle', "Whenever Test Pain Rager is dealt damage, add that much {R}. Until end of turn, you don't lose this mana as steps and phases end.", '{2}{R}', ['3', '5']);
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to any target.', '{R}');
const HOARD = card('Test Hoard', 'Sorcery', 'Add four {B}.', '{0}');
const PACK = card('Test Pack Leader', 'Creature — Raccoon', 'At the beginning of your first main phase, add {R} or {G} for each Raccoon you control.', '{1}{R}{G}', ['2', '2']);
const RACCOON = card('Test Raccoon', 'Creature — Raccoon', '', '{1}', ['1', '1']);
const DEFS = [RAGER, BOLT, HOARD, PACK, RACCOON];

describe('r3-cost: "add that much {R}" and "add four {B}" (CR 106.4)', () => {
  it('the cards are automated', () => {
    for (const d of DEFS) expect(full(d), d.name).toBe(true);
  });
  it('CR 603.2, 120.3: 3 damage to it adds {R}{R}{R}; CR 500.4: the mana stays through the combat steps of the turn', () => {
    let s: GameState = scenario(['Mountain'], { defs: DEFS, p1: { battlefield: ['Test Pain Rager', 'Mountain'], hand: ['Test Bolt'] } });
    const rager = find(s, 'Test Pain Rager', 'battlefield', 'p1');
    s = resolveAll(cast(s, 'Test Bolt', { targets: [[obj(rager)]] }));
    expect(pool(s, 'p1')).toBe('RRR');
    s = advanceTo(s, 1, 'main2');
    expect(pool(s, 'p1')).toBe('RRR');
  });
  it('CR 106.1, 106.4: "add {R} or {G} for each Raccoon you control": two Raccoons, one {R} and one {G} chosen unit by unit', () => {
    // the scenario starts at the beginning of p1's first main phase: the trigger is on the stack
    let s: GameState = scenario([], { defs: DEFS, p1: { battlefield: ['Test Pack Leader', 'Test Raccoon'] } });
    expect(s.zones.stack).toHaveLength(1);
    let chosen = 0;
    for (let guard = 0; guard < 30 && !(s.zones.stack.length === 0 && s.pending?.kind === 'priority'); guard++) {
      if (s.pending?.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: (chosen++ === 0 ? 'R' : 'G') as 'R' });
      else s = passBoth(s);
    }
    expect(pool(s, 'p1')).toBe('GR');
  });
  it('"Add four {B}" adds four black mana', () => {
    const s = resolveAll(cast(scenario([], { defs: DEFS, p1: { hand: ['Test Hoard'] } }), 'Test Hoard'));
    expect(pool(s, 'p1')).toBe('BBBB');
  });
});

const CONDUIT = card('Test Tide Conduit', 'Artifact', '{T}: Add {U}. Spend this mana only to cast a spell from anywhere other than your hand.', '{1}');
const LOOKOUT = card('Test Lookout Portal', 'Artifact', '{T}: Exile the top card of your library. You may play that card this turn.', '{0}');
const SPRITE = card('Test Sprite', 'Creature — Faerie', 'Flying', '{U}', ['1', '1']);

describe('r3-cost: "Spend this mana only to cast a spell from anywhere other than your hand" (CR 106.6, 601.2a)', () => {
  const DEFS2 = [CONDUIT, LOOKOUT, SPRITE];
  it('the cards are automated', () => {
    for (const d of DEFS2) expect(full(d), d.name).toBe(true);
  });
  it('the mana pays for a card cast from exile, not for one cast from the hand', () => {
    let s: GameState = scenario([], { defs: DEFS2, p1: { battlefield: ['Test Tide Conduit', 'Test Lookout Portal'], hand: ['Test Sprite'], library: ['Test Sprite'] } });
    const castable = (st: GameState, zone: 'hand' | 'exile'): boolean => legal(st, 'p1', 'cast').some((a) => st.objects[a.object!]?.zone === zone);
    expect(castable(s, 'hand')).toBe(false);
    const [exile] = legal(s, 'p1', 'activate').filter((a) => /Exile the top/.test(a.label));
    s = resolveAll(drive(act(s, exile!.action)));
    expect(castable(s, 'exile')).toBe(true);
    expect(castable(s, 'hand')).toBe(false);
  });
});

const ROUSER = card('Test Rubble Brawler', 'Creature — Dwarf Sorcerer', '{T}, Exile a card from your graveyard: Add {R}. When you do, Test Rubble Brawler deals 1 damage to each opponent.', '{2}{R}', ['1', '3']);

describe('r3-cost: a mana ability with a reflexive trigger, "Add {R}. When you do, ~ deals 1 damage to each opponent" (CR 605.3b, 603.12)', () => {
  it('is automated', () => {
    expect(full(ROUSER)).toBe(true);
  });
  it('the mana is added at once (CR 605.3b); the reflexive trigger uses the stack and deals 1 damage to the opponent when it resolves', () => {
    let s: GameState = scenario([], { defs: [ROUSER, SPRITE], p1: { battlefield: ['Test Rubble Brawler'], graveyard: ['Test Sprite'] } });
    const [mana] = legal(s, 'p1', 'activate').filter((a) => a.isMana === true);
    expect(mana).toBeDefined();
    s = drive(act(s, mana!.action));
    expect(pool(s, 'p1')).toBe('R');
    expect(s.zones.graveyard.p1!).toHaveLength(0);
    expect(s.zones.stack).toHaveLength(1); // the reflexive trigger (not a mana ability, CR 605.5a-like)
    s = resolveAll(s);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(19);
  });
  it('without a card in the graveyard the cost can\'t be paid: the ability is not offered', () => {
    const s: GameState = scenario([], { defs: [ROUSER], p1: { battlefield: ['Test Rubble Brawler'] } });
    expect(legal(s, 'p1', 'activate').filter((a) => a.isMana === true)).toEqual([]);
  });
});
