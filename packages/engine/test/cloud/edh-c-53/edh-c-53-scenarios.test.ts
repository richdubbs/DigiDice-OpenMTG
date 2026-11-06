/**
 * Commander effort (coordinator C), round edh-c-53 (EDHREC ranks 24,001 to 24,500, second pass): the round's readings played through the engine with synthetic cards (invented names),
 * compiled by the game's default compiler. Alice (p1) is the active player. CR cites are checked against the Comprehensive Rules text of 2026-09-25.
 *
 *   CR 601.2f, 118.7, 611.2       "The next spell you cast this turn costs {1} less to cast" (op nextSpell, rider reduce)
 *   CR 400.7, 601.2i              "draw a card if you've cast another blue spell this turn" in an enters trigger: the permanent's own spell is not "another"
 *   CR 122.1, 601.2f              "costs {1} less to cast for each permanent you control with oil counters on it"
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { advanceTo, legal, pass, scenario } from '../../m3/scenario';
import { synthetic, castWith, resolveAll as resolveWith, target, yes, no } from '../../m6/costs/support';
import { cast, full, pt, resolveAll } from '../cmd3/helpers';

const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const handSize = (s: GameState, p: string): number => (s.zones.hand[p] ?? []).length;
const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const castable = (s: GameState, player: 'p1' | 'p2'): string[] => legal(s, player, 'cast').map((a) => nameOf(s, (a as { object: ObjectId }).object));

// ---- Hardened Berserker: "the next spell you cast this turn costs {1} less to cast" ------------------------------------------------------------------------------
const HASTEN = synthetic('Test Hasten', 'Instant', '{0}', 'The next spell you cast this turn costs {1} less to cast.');
const HASTEN_CREATURE = synthetic('Test Hasten Creature', 'Instant', '{0}', 'The next creature spell you cast this turn costs {1} less to cast.');
const QUICK = synthetic('Test Quick', 'Instant', '{1}', 'You gain 1 life.');
const QUICK2 = synthetic('Test Quick Two', 'Instant', '{1}', 'You gain 2 life.');
const BEAR = synthetic('Test Bear', 'Creature — Bear', '{1}', '', { power: '2', toughness: '2' });

describe('CR 601.2f, 118.7, 611.2: "The next spell you cast this turn costs {1} less to cast."', () => {
  const hasten = (): GameState => {
    const s = scenario([], { defs: [HASTEN, QUICK, QUICK2], p1: { hand: ['Test Hasten', 'Test Quick', 'Test Quick Two'] }, p2: { hand: [] } });
    return resolveAll(cast(s, 'Test Hasten'));
  };
  it('is automated; before it resolves no mana means the {1} instant cannot be cast, after it the instant costs {0}', () => {
    expect(full(HASTEN)).toBe(true);
    const s0 = scenario([], { defs: [HASTEN, QUICK], p1: { hand: ['Test Hasten', 'Test Quick'] } });
    expect(castable(s0, 'p1')).not.toContain('Test Quick');
    expect(castable(hasten(), 'p1')).toContain('Test Quick');
  });
  it('the reduction is used up by the next spell: after one {1} instant is cast, the second still costs {1}', () => {
    const s = resolveAll(cast(hasten(), 'Test Quick'));
    expect(castable(s, 'p1')).not.toContain('Test Quick Two');
  });
  it('the negative case: the reduction is for its player only, an opponent\'s {1} spell is not cheaper', () => {
    const s0 = scenario([], { defs: [HASTEN, QUICK], p1: { hand: ['Test Hasten'] }, p2: { hand: ['Test Quick'] } });
    const s = resolveAll(cast(s0, 'Test Hasten'));
    expect(castable(pass(s), 'p2')).not.toContain('Test Quick');
  });
  it('a filtered rider ("the next creature spell") waits for a creature spell: the noncreature {1} instant stays at {1}', () => {
    expect(full(HASTEN_CREATURE)).toBe(true);
    const s0 = scenario([], { defs: [HASTEN_CREATURE, QUICK, BEAR], p1: { hand: ['Test Hasten Creature', 'Test Quick', 'Test Bear'] } });
    const s = resolveAll(cast(s0, 'Test Hasten Creature'));
    expect(castable(s, 'p1')).not.toContain('Test Quick');
  });
  it('the reduction ends with the turn: it is gone when the next turn begins', () => {
    const s = hasten();
    expect(s.turn.nextSpell?.length ?? 0).toBe(1);
    const t = advanceTo(s, 2, 'upkeep');
    expect(t.turn.nextSpell).toBeUndefined();
  });
});

// ---- Dream Thief: "When this creature enters, draw a card if you've cast another blue spell this turn" -------------------------------------------------------------
const THIEF = synthetic('Test Thief', 'Creature — Faerie', '{0}', "Flying\nWhen this creature enters, draw a card if you've cast another blue spell this turn.", { power: '1', toughness: '1', colors: ['U'] });
const BLUE_SPELL = synthetic('Test Blue Charm', 'Instant', '{0}', 'You gain 1 life.', { colors: ['U'] });
const RED_SPELL = synthetic('Test Red Charm', 'Instant', '{0}', 'You gain 1 life.', { colors: ['R'] });

describe('CR 400.7, 601.2i, 603.2: "When this creature enters, draw a card if you\'ve cast another blue spell this turn"', () => {
  const play = (before: string[]): GameState => {
    let s = scenario([], { defs: [THIEF, BLUE_SPELL, RED_SPELL], p1: { hand: [...before, 'Test Thief'] } });
    for (const n of before) s = resolveAll(cast(s, n));
    return resolveAll(cast(s, 'Test Thief'));
  };
  it('is automated; with a blue spell cast before it the enters trigger draws a card', () => {
    expect(full(THIEF)).toBe(true);
    expect(handSize(play(['Test Blue Charm']), 'p1')).toBe(1);
  });
  it('the negative case: the blue creature spell itself is not "another", so it alone draws nothing', () => {
    expect(handSize(play([]), 'p1')).toBe(0);
  });
  it('the negative case: a spell that is not blue does not count', () => {
    expect(handSize(play(['Test Red Charm']), 'p1')).toBe(0);
  });
  it('the same card cast a second time in the turn: its first cast was another object and another blue spell, so the second enters trigger draws', () => {
    const BOUNCE = synthetic('Test Bounce', 'Instant', '{0}', "Return target creature to its owner's hand.");
    const s0 = scenario([], { defs: [THIEF, BOUNCE], p1: { hand: ['Test Thief', 'Test Bounce'] } });
    let s = resolveAll(cast(s0, 'Test Thief'));
    expect(handSize(s, 'p1')).toBe(1);
    s = resolveAll(cast(s, 'Test Bounce', { targets: [{ kind: 'object', id: onField(s, 'Test Thief')! }] }));
    expect(handSize(s, 'p1')).toBe(1);
    s = resolveAll(cast(s, 'Test Thief'));
    expect(handSize(s, 'p1')).toBe(1);
  });
});

// ---- Hardened Berserker: the colored part of a cost stays, an opponent's spell is not reduced ---------------------------------------------------------------------
const RED_ONLY = synthetic('Test Red Bolt', 'Instant', '{R}', 'You gain 1 life.', { colors: ['R'] });

describe('CR 601.2f, 118.7: "The next spell you cast this turn costs {1} less" reduces generic mana only', () => {
  it('a spell that costs only {R} is not cheaper: it still cannot be cast without red mana (Scryfall ruling 2015-02-25)', () => {
    const s0 = scenario([], { defs: [HASTEN, RED_ONLY], p1: { hand: ['Test Hasten', 'Test Red Bolt'] } });
    const s = resolveAll(cast(s0, 'Test Hasten'));
    expect(castable(s, 'p1')).not.toContain('Test Red Bolt');
  });
  it('with one Mountain a {1}{R} spell becomes castable once the reduction is waiting, and not before', () => {
    const SPARK = synthetic('Test Spark Two', 'Instant', '{1}{R}', 'You gain 1 life.', { colors: ['R'] });
    const s0 = scenario(['Mountain'], { defs: [HASTEN, SPARK], p1: { hand: ['Test Hasten', 'Test Spark Two'], battlefield: ['Mountain'] } });
    expect(castable(s0, 'p1')).not.toContain('Test Spark Two');
    expect(castable(resolveAll(cast(s0, 'Test Hasten')), 'p1')).toContain('Test Spark Two');
  });
});

const OX = synthetic('Test Ox', 'Creature — Ox', '{0}', '', { power: '2', toughness: '2' });
const onField = (s: GameState, name: string, player?: string): ObjectId | undefined => s.zones.battlefield.find((id) => nameOf(s, id) === name && (player === undefined || s.objects[id]!.controller === player));

// ---- Cinderslash Ravager: "costs {1} less to cast for each permanent you control with oil counters on it" ---------------------------------------------------------------
const OILBEAST = synthetic('Test Oil Beast', 'Creature — Beast', '{3}{R}', 'This spell costs {1} less to cast for each permanent you control with oil counters on it.', { power: '3', toughness: '3', colors: ['R'] });
const RIG = synthetic('Test Oil Rig', 'Artifact', '{0}', '');

describe('CR 122.1, 601.2f: "This spell costs {1} less to cast for each permanent you control with oil counters on it"', () => {
  const oilTest = (rig: { name: string; counters?: Record<string, number> } | undefined, owner: 'p1' | 'p2' = 'p1'): string[] => {
    const s = scenario(['Mountain'], { defs: [OILBEAST, RIG], p1: { hand: ['Test Oil Beast'], battlefield: ['Mountain', 'Mountain', 'Mountain', ...(rig && owner === 'p1' ? [rig] : [])] }, ...(rig && owner === 'p2' ? { p2: { battlefield: [rig] } } : {}) });
    return castable(s, 'p1');
  };
  it('is automated; with three lands the {3}{R} creature is castable only with an oil permanent of yours', () => {
    expect(full(OILBEAST)).toBe(true);
    expect(oilTest(undefined)).not.toContain('Test Oil Beast');
    expect(oilTest({ name: 'Test Oil Rig', counters: { oil: 1 } })).toContain('Test Oil Beast');
  });
  it('the negative cases: a permanent with another kind of counter, one with no counter and an opponent\'s oil permanent each reduce nothing', () => {
    expect(oilTest({ name: 'Test Oil Rig', counters: { charge: 3 } })).not.toContain('Test Oil Beast');
    expect(oilTest({ name: 'Test Oil Rig' })).not.toContain('Test Oil Beast');
    expect(oilTest({ name: 'Test Oil Rig', counters: { oil: 2 } }, 'p2')).not.toContain('Test Oil Beast');
  });
});

// ---- Sigil Blessing: "target creature you control gets +3/+3 and other creatures you control get +1/+1" ---------------------------------------------------------------
const BLESSING = synthetic('Test Blessing', 'Instant', '{0}', 'Until end of turn, target creature you control gets +3/+3 and other creatures you control get +1/+1.');
const SQUIRE = synthetic('Test Squire', 'Creature — Human', '{0}', '', { power: '1', toughness: '1' });

describe('CR 611.2c, 608.2c, 115.3: "Until end of turn, target creature you control gets +3/+3 and other creatures you control get +1/+1"', () => {
  const play = (): GameState => {
    const s = scenario([], { defs: [BLESSING, SQUIRE, OX], p1: { hand: ['Test Blessing', 'Test Squire'], battlefield: ['Test Ox', 'Test Ox'] }, p2: { battlefield: ['Test Ox'] } });
    const ids = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Ox' && s.objects[id]!.controller === 'p1');
    return resolveAll(cast(s, 'Test Blessing', { targets: [{ kind: 'object', id: ids[0]! }] }));
  };
  it('is automated; the target gets +3/+3, the other creature you control +1/+1 and the opponent\'s creature nothing', () => {
    expect(full(BLESSING)).toBe(true);
    const s = play();
    const mine = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Ox' && s.objects[id]!.controller === 'p1');
    expect([pt(s, mine[0]!), pt(s, mine[1]!)]).toEqual(['5/5', '3/3']);
    expect(pt(s, onField(s, 'Test Ox', 'p2')!)).toBe('2/2');
  });
  it('the negative case: the target is not also given the +1/+1 of the group ("other"), and a creature that arrives later gets nothing (CR 611.2c)', () => {
    const s = play();
    const mine = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Ox' && s.objects[id]!.controller === 'p1');
    expect(pt(s, mine[0]!)).toBe('5/5');
    const t = resolveAll(cast(s, 'Test Squire'));
    expect(pt(t, onField(t, 'Test Squire')!)).toBe('1/1');
  });
});

// ---- Cone of Flame: 1, 2 and 3 damage to three different targets ------------------------------------------------------------------------------------------------------
const CONE = synthetic('Test Cone', 'Sorcery', '{0}', '~ deals 1 damage to any target, 2 damage to another target, and 3 damage to a third target.');
const STEER = synthetic('Test Steer', 'Creature — Ox', '{0}', '', { power: '1', toughness: '4' });

describe('CR 115.3, 115.4, 120.1: "~ deals 1 damage to any target, 2 damage to another target, and 3 damage to a third target"', () => {
  const setup = (): { s0: GameState; ox: ObjectId } => {
    const s0 = scenario([], { defs: [CONE, STEER], p1: { hand: ['Test Cone'], battlefield: ['Test Steer'] } });
    return { s0, ox: onField(s0, 'Test Steer')! };
  };
  it('is automated; three different targets are dealt 1, 2 and 3 damage', () => {
    expect(full(CONE)).toBe(true);
    const { s0, ox } = setup();
    const s = resolveWith(castWith(s0, 'Test Cone', [target('p2'), target(ox), target('p1')]));
    expect(life(s, 'p2')).toBe(19);
    expect(s.objects[ox]!.damage).toBe(2);
    expect(life(s, 'p1')).toBe(17);
  });
  it('the negative case: the second and third targets must differ from the earlier ones (CR 115.3): the same player is not offered again', () => {
    const { s0 } = setup();
    const t = castWith(s0, 'Test Cone', [target('p2')]);
    expect(t.pending?.kind).toBe('chooseTargets');
    const offered = t.pending as unknown as { players: string[]; objects: ObjectId[] };
    expect(offered.players).not.toContain('p2');
    expect(offered.players).toContain('p1');
  });
});

// ---- Clip Wings: each opponent sacrifices a creature with flying ------------------------------------------------------------------------------------------------------
const CLIP = synthetic('Test Clip', 'Instant', '{0}', 'Each opponent sacrifices a creature of their choice with flying.');
const BIRD = synthetic('Test Bird', 'Creature — Bird', '{0}', 'Flying', { power: '1', toughness: '1' });

describe('CR 701.21a, 702.9a: "Each opponent sacrifices a creature of their choice with flying"', () => {
  it('is automated; the opponent sacrifices their creature with flying and keeps the one without', () => {
    expect(full(CLIP)).toBe(true);
    const s0 = scenario([], { defs: [CLIP, BIRD, OX], p1: { hand: ['Test Clip'], battlefield: ['Test Bird'] }, p2: { battlefield: ['Test Bird', 'Test Ox'] } });
    const s = resolveAll(cast(s0, 'Test Clip'));
    expect(onField(s, 'Test Bird', 'p2')).toBeUndefined();
    expect(onField(s, 'Test Ox', 'p2')).toBeDefined();
    expect(onField(s, 'Test Bird', 'p1')).toBeDefined();
  });
  it('the negative case: an opponent with no creature with flying sacrifices nothing (Scryfall ruling 2016-04-08)', () => {
    const s0 = scenario([], { defs: [CLIP, OX], p1: { hand: ['Test Clip'] }, p2: { battlefield: ['Test Ox'] } });
    const s = resolveAll(cast(s0, 'Test Clip'));
    expect(onField(s, 'Test Ox', 'p2')).toBeDefined();
  });
});

// ---- Draugr Thought-Thief: look at the top card of target player's library, you may put it into their graveyard ----------------------------------------------------------
const THIEF2 = synthetic('Test Mind Thief', 'Creature — Zombie', '{0}', "When this creature enters, look at the top card of target player's library. You may put that card into their graveyard.", { power: '1', toughness: '1' });

describe('CR 400.3, 404.1: "look at the top card of target player\'s library. You may put that card into their graveyard"', () => {
  const play = (answerYes: boolean): { s: GameState; lib: number; yard: number } => {
    const s0 = scenario([], { defs: [THIEF2], p1: { hand: ['Test Mind Thief'] } });
    const lib = s0.zones.library['p2']!.length;
    const yard = (s0.zones.graveyard['p2'] ?? []).length;
    return { s: resolveWith(castWith(s0, 'Test Mind Thief'), [target('p2'), answerYes ? yes : no]), lib, yard };
  };
  it('is automated; accepted, the top card of that player\'s library goes to their own graveyard', () => {
    expect(full(THIEF2)).toBe(true);
    const { s, lib, yard } = play(true);
    expect(s.zones.library['p2']!.length).toBe(lib - 1);
    expect((s.zones.graveyard['p2'] ?? []).length).toBe(yard + 1);
    expect((s.zones.graveyard['p1'] ?? []).length).toBe(0);
  });
  it('the negative case: declined, the library and graveyard stay as they were', () => {
    const { s, lib, yard } = play(false);
    expect(s.zones.library['p2']!.length).toBe(lib);
    expect((s.zones.graveyard['p2'] ?? []).length).toBe(yard);
  });
});
