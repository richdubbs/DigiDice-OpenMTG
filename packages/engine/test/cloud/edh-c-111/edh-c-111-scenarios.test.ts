/**
 * Commander effort (coordinator C), round edh-c-111: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's
 * default compiler. Alice (p1) is the active player. CR cites are checked against the Comprehensive Rules text of 2026-09-25.
 *
 *   CR 107.3a, 118.3, 608.2h     "{T}, Remove all charge counters from ~: It deals that much damage to target creature" (the counters removed, not the counters left)
 *   CR 120.2b, 608.2b, 701.14    "Each of those creatures deals damage equal to its toughness to the other": not a fight, by toughness, neither deals damage with an illegal target
 *   CR 118.3, 701.9a, 201.2      "Discard two nonland cards with the same name: Draw four cards"
 */
import { describe, expect, it } from 'vitest';
import { applyAction, type GameState, type ObjectId } from '../../../src/index';
import { activate, target } from '../../m5/cr-examples/helpers';
import { find, resolveAll as resolveStack, scenario as scenario6, synthetic } from '../../m6/costs/support';
import { act, activations, answer, card, cast, drive, full, named, obj, resolveAll, scenario } from '../r3-cost/support';

const damage = (s: GameState, id: ObjectId): number => s.objects[id]?.damage ?? 0;
const zone = (s: GameState, id: ObjectId): string | undefined => s.objects[id]?.zone;
const handNames = (s: GameState, p = 'p1'): string[] => (s.zones.hand[p] ?? []).map((id) => s.objects[id]!.defId);

// ---- "Remove all charge counters from ~: It deals that much damage" -------------------------------------------------------------------------------------------
const AMULET = synthetic('Test Charge Amulet', 'Artifact', '{0}', '{T}, Remove all charge counters from this artifact: It deals that much damage to target creature.');
const BEAR = synthetic('Test Bear', 'Creature — Bear', '{0}', '', { power: '2', toughness: '2' });
const OGRE = synthetic('Test Ogre', 'Creature — Ogre', '{0}', '', { power: '5', toughness: '5' });

describe('CR 107.3a, 118.3, 608.2h: "Remove all charge counters from this artifact: It deals that much damage to target creature."', () => {
  const board = (counters: Record<string, number>): { s: GameState; amulet: ObjectId; bear: ObjectId; ogre: ObjectId } => {
    const s = scenario6([], { defs: [AMULET, BEAR, OGRE], p1: { battlefield: ['Test Charge Amulet'] }, p2: { battlefield: ['Test Bear', 'Test Ogre'] } });
    const amulet = find(s, 'Test Charge Amulet', 'battlefield');
    s.objects[amulet]!.counters = { ...counters };
    return { s, amulet, bear: find(s, 'Test Bear', 'battlefield', 'p2'), ogre: find(s, 'Test Ogre', 'battlefield', 'p2') };
  };
  it('is automated', () => expect(full(AMULET)).toBe(true));
  it('three charge counters: all are removed as the cost and the Bear is dealt 3 damage (it dies, the Ogre is untouched)', () => {
    const { s: s0, amulet, bear, ogre } = board({ charge: 3 });
    const s = resolveStack(activate(s0, amulet, [target(bear)]));
    expect(s.objects[amulet]!.counters['charge'] ?? 0).toBe(0);
    expect(zone(s, bear)).not.toBe('battlefield'); // 3 damage on a 2/2 (CR 704.5g)
    expect(damage(s, ogre)).toBe(0);
  });
  it('the amount is the number of counters removed: two counters deal 2 to a 5/5 Ogre, no more', () => {
    const { s: s0, amulet, ogre } = board({ charge: 2 });
    const s = resolveStack(activate(s0, amulet, [target(ogre)]));
    expect(damage(s, ogre)).toBe(2);
    expect(s.objects[amulet]!.counters['charge'] ?? 0).toBe(0);
  });
  it('negative: counters of another kind stay and add nothing; with no charge counter the ability deals no damage', () => {
    const { s: s0, amulet, ogre } = board({ time: 4 });
    const s = resolveStack(activate(s0, amulet, [target(ogre)]));
    expect(damage(s, ogre)).toBe(0);
    expect(s.objects[amulet]!.counters['time'] ?? 0).toBe(4);
  });
});

// ---- "Each of those creatures deals damage equal to its toughness to the other" -------------------------------------------------------------------------------
const CONTEST = card('Test Toughness Contest', 'Instant', "Choose target creature you control and target creature an opponent controls. Each of those creatures deals damage equal to its toughness to the other.");
const WALL = card('Test Wall', 'Creature — Wall', '', '{0}', ['1', '4']);
const BRUTE = card('Test Brute', 'Creature — Ogre', '', '{0}', ['3', '3']);
const SNAP = card('Test Snap', 'Instant', "Return target creature to its owner's hand.");
const FIGHT_WATCHER = card('Test Fight Watcher', 'Enchantment', 'Whenever a creature fights, you gain 5 life.');
const CONTEST_DEFS = [CONTEST, WALL, BRUTE, SNAP, FIGHT_WATCHER];

describe('CR 120.2b, 608.2b, 701.14: "Choose target creature you control and target creature an opponent controls. Each of those creatures deals damage equal to its toughness to the other."', () => {
  it('is automated', () => expect(full(CONTEST)).toBe(true));
  it('a 1/4 Wall deals 4 (its toughness, not its power 1) to the 3/3 Brute, which dies; the Brute deals 3 (its toughness) to the Wall, which survives with 3 damage', () => {
    let s = scenario([], { defs: CONTEST_DEFS, p1: { hand: ['Test Toughness Contest'], battlefield: ['Test Wall'] }, p2: { battlefield: ['Test Brute'] } });
    const wall = named(s, 'Test Wall')[0]!;
    const brute = named(s, 'Test Brute')[0]!;
    s = resolveAll(cast(s, 'Test Toughness Contest', { targets: [[obj(wall)], [obj(brute)]] }));
    expect(zone(s, brute)).not.toBe('battlefield');
    expect(zone(s, wall)).toBe('battlefield');
    expect(damage(s, wall)).toBe(3);
  });
  it('it is no fight: a "whenever a creature fights" ability does not trigger', () => {
    let s = scenario([], { defs: CONTEST_DEFS, p1: { hand: ['Test Toughness Contest'], battlefield: ['Test Wall', 'Test Fight Watcher'] }, p2: { battlefield: ['Test Brute'] } });
    const life0 = s.players.find((p) => p.id === 'p1')!.life;
    const wall = named(s, 'Test Wall')[0]!;
    const brute = named(s, 'Test Brute')[0]!;
    s = resolveAll(cast(s, 'Test Toughness Contest', { targets: [[obj(wall)], [obj(brute)]] }));
    expect(zone(s, brute)).not.toBe('battlefield'); // dealt 4 by the Wall (toughness 4)
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(life0);
  });
  it('CR 608.2b: the opponent\'s creature left before resolution: neither creature deals damage (ruling 2014-11-24)', () => {
    let s = scenario([], { defs: CONTEST_DEFS, p1: { hand: ['Test Toughness Contest'], battlefield: ['Test Wall'] }, p2: { battlefield: ['Test Brute'], hand: ['Test Snap'] } });
    const wall = named(s, 'Test Wall')[0]!;
    const brute = named(s, 'Test Brute')[0]!;
    s = cast(s, 'Test Toughness Contest', { targets: [[obj(wall)], [obj(brute)]] });
    s = drive(act(s, { type: 'pass', player: 'p1' }));
    s = cast(s, 'Test Snap', { targets: [[obj(brute)]] }, 'p2');
    s = resolveAll(s);
    expect(zone(s, brute)).not.toBe('battlefield');
    expect(zone(s, wall)).toBe('battlefield');
    expect(damage(s, wall)).toBe(0);
  });
});

// ---- "Discard two nonland cards with the same name: Draw four cards" ----------------------------------------------------------------------------------------
const SPHINX = card('Test Chime Sphinx', 'Creature — Sphinx', 'Discard two nonland cards with the same name: Draw four cards.', '{0}', ['3', '3']);
const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.');
const FLASH = card('Test Flash', 'Instant', 'You gain 2 life.');
const SPHINX_DEFS = [SPHINX, SPARK, FLASH];
const sphinxBoard = (hand: string[]): GameState =>
  scenario(['Forest'], { defs: SPHINX_DEFS, p1: { battlefield: ['Test Chime Sphinx'], hand, library: ['Test Spark', 'Test Spark', 'Test Flash', 'Test Flash', 'Test Spark'] } });

describe('CR 118.3, 701.9a, 201.2: "Discard two nonland cards with the same name: Draw four cards."', () => {
  it('is automated', () => expect(full(SPHINX)).toBe(true));
  it('two Sparks and a Flash in hand: the ability is offered; discarding the two Sparks draws four cards', () => {
    let s = sphinxBoard(['Test Spark', 'Test Spark', 'Test Flash']);
    expect(activations(s, 'Test Chime Sphinx')).toHaveLength(1);
    s = act(s, activations(s, 'Test Chime Sphinx')[0]!.action);
    expect(s.pending?.kind).toBe('priority'); // the only two cards that can pay it are chosen without a question
    s = resolveAll(s);
    expect((s.zones.graveyard['p1'] ?? []).map((id) => s.objects[id]!.defId)).toEqual(['Test Spark', 'Test Spark']);
    expect(handNames(s).length).toBe(1 + 4); // the Flash and four drawn cards
  });
  it('a choice of two cards with different names is refused', () => {
    let s = sphinxBoard(['Test Spark', 'Test Spark', 'Test Flash', 'Test Flash']);
    s = act(s, activations(s, 'Test Chime Sphinx')[0]!.action);
    expect(s.pending?.kind).toBe('chooseObjects');
    const hand = s.zones.hand['p1'] ?? [];
    const spark = hand.find((id) => s.objects[id]!.defId === 'Test Spark')!;
    const flash = hand.find((id) => s.objects[id]!.defId === 'Test Flash')!;
    expect(applyAction(s, { type: 'answer', player: 'p1', answer: { kind: 'chooseObjects', ids: [spark, flash] } } as never).error).toBeDefined();
  });
  it('negative: two different nonland cards and a pair of lands with one name do not pay it (no activation is offered)', () => {
    expect(activations(sphinxBoard(['Test Spark', 'Test Flash']), 'Test Chime Sphinx')).toEqual([]);
    expect(activations(sphinxBoard(['Forest', 'Forest', 'Test Flash']), 'Test Chime Sphinx')).toEqual([]);
  });
});
