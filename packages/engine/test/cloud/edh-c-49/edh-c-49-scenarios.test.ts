/**
 * Commander EDHREC ranks 16,501-17,000, round edh-c-49: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default
 * compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com).
 *
 *   CR 601.2f, 118.7, 604.1      "~ costs {1} less to cast if A. It also costs {1} less to cast if B." (two statics of the spell, each with its own condition)
 *   CR 702.16a, 702.16b, 509.1b  "Target creature you control gains protection from creatures your opponents control until end of turn." (the source's type AND its controller)
 *   CR 119.3, 402.1              "that player loses 1 life for each card fewer than three in their hand."
 *   CR 702.154a, 603.2           "Whenever ~ enlists a creature, scry 2."
 *   CR 119.3, 603.2, 608.2h      "Until end of turn, whenever a player gains life, that player loses 2 life for each 1 life they gained."
 *   CR 608.2f, 120.2b, 608.2h    "For each player, ~ deals damage to that player and each creature that player controls equal to the number of creatures they control."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, getChars, type GameState, type ObjectId } from '../../../src/index';
import { canBeTargeted, hasProtectionFrom } from '../../../src/rules/protection';
import { act, advanceTo, find, life, put, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers, tweak } from '../../m4/helpers';
import { card, cast, full, resolveAll, settle } from '../cmd3/helpers';

const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const damageOn = (s: GameState, id: ObjectId): number => s.objects[id]?.damage ?? 0;

describe('CR 601.2f, 604.1: "~ costs {1} less to cast if you control a Spirit. It also costs {1} less to cast if you control an enchantment."', () => {
  const SNARE = card('Test Lure Snare', 'Instant', 'Test Lure Snare costs {1} less to cast if you control a Spirit. It also costs {1} less to cast if you control an enchantment.\nYou gain 1 life.', undefined, '{2}');
  const WISP = card('Test Wisp', 'Creature — Spirit', '', ['1', '1']);
  const RUNE = card('Test Rune', 'Enchantment', '');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const board = (perms: string[]): GameState => scenario([], { defs: [SNARE, WISP, RUNE, BEAR], p1: { hand: ['Test Lure Snare'], battlefield: perms } });
  const lands = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.tapped).length;
  const tapped = (perms: string[], plains: number): number | null => {
    const s = board([...perms, ...(Array(plains).fill('Plains') as string[])]);
    if (applyAction(s, { type: 'cast', player: 'p1', card: find(s, 'Test Lure Snare', 'hand', 'p1') }).error !== undefined) return null;
    return lands(resolveAll(cast(s, 'Test Lure Snare')));
  };
  it('is full', () => expect(full(SNARE)).toBe(true));
  it('both conditions true: it costs {0}', () => expect(tapped(['Test Wisp', 'Test Rune'], 0)).toBe(0));
  it('only the Spirit: it costs {1}; only the enchantment: {1}', () => {
    expect(tapped(['Test Wisp'], 0)).toBeNull();
    expect(tapped(['Test Wisp'], 1)).toBe(1);
    expect(tapped(['Test Rune'], 0)).toBeNull();
    expect(tapped(['Test Rune'], 1)).toBe(1);
  });
  it('negative: neither (a Bear is not a Spirit): the printed {2}', () => {
    expect(tapped(['Test Bear'], 1)).toBeNull();
    expect(tapped(['Test Bear'], 2)).toBe(2);
  });
});

describe('CR 702.16a-b, 509.1b: "Target creature you control gains protection from creatures your opponents control until end of turn. Untap it."', () => {
  const WARD = card('Test Ward Rite', 'Instant', 'Target creature you control gains protection from creatures your opponents control until end of turn. Untap it.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', ['1', '1']);
  const PYRE = card('Test Pyre', 'Instant', 'Test Pyre deals 1 damage to any target.');
  const start = (): GameState => scenario([], { defs: [WARD, BEAR, GOBLIN, PYRE], p1: { hand: ['Test Ward Rite'], battlefield: ['Test Bear', 'Test Goblin'] }, p2: { battlefield: ['Test Goblin'] } });
  const after = (): { s: GameState; bear: ObjectId; mine: ObjectId; theirs: ObjectId } => {
    const s0 = tweak(start(), (t) => { t.objects[find(t, 'Test Bear', 'battlefield', 'p1')]!.tapped = true; });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const mine = find(s0, 'Test Goblin', 'battlefield', 'p1');
    const theirs = find(s0, 'Test Goblin', 'battlefield', 'p2');
    return { s: resolveAll(cast(s0, 'Test Ward Rite', { targets: [{ kind: 'object', id: bear }] })), bear, mine, theirs };
  };
  it('is full', () => expect(full(WARD)).toBe(true));
  it('untaps the creature and gives it protection from a creature an opponent controls, not from your own creature', () => {
    const { s, bear, mine, theirs } = after();
    expect(s.objects[bear]!.tapped).toBe(false);
    const target = getChars(s, bear)!;
    expect(hasProtectionFrom(target, getChars(s, theirs)!)).toBe(true);
    expect(canBeTargeted(target, 'p1', getChars(s, theirs)!, 'p2')).toBe(false); // CR 702.16b
    expect(hasProtectionFrom(target, getChars(s, mine)!)).toBe(false); // negative: a creature you control
    expect(canBeTargeted(target, 'p1', getChars(s, mine)!, 'p1')).toBe(true);
  });
  it('negative: a noncreature source of an opponent (an instant) still targets it', () => {
    const { s, bear } = after();
    const pyre = getChars(tweak(s, () => {}), find(s, 'Test Bear', 'battlefield', 'p1'))!;
    const spellLike = { ...pyre, types: ['Instant'], controller: 'p2' as const } as unknown as typeof pyre;
    expect(canBeTargeted(getChars(s, bear)!, 'p1', spellLike, 'p2')).toBe(true);
  });
  it('negative: after the turn ends the protection is gone', () => {
    const { s, bear, theirs } = after();
    const next = advanceTo(s, 3, 'upkeep');
    expect(hasProtectionFrom(getChars(next, bear)!, getChars(next, theirs)!)).toBe(false);
  });
});

describe('CR 119.3, 402.1: "At the beginning of each opponent\'s upkeep, that player loses 1 life for each card fewer than three in their hand."', () => {
  const RAT = card('Test Gnaw Rat', 'Creature — Rat', 'At the beginning of each opponent\'s upkeep, that player loses 1 life for each card fewer than three in their hand.', ['1', '1']);
  const FILL = card('Test Filler', 'Sorcery', 'You gain 1 life.');
  const at = (hand: number): GameState => {
    const s = scenario([], { defs: [RAT, FILL], p1: { battlefield: ['Test Gnaw Rat'] }, p2: { hand: Array(hand).fill('Test Filler') as string[] } });
    return resolveAll(advanceTo(s, 2, 'upkeep'));
  };
  it('is full', () => expect(full(RAT)).toBe(true));
  it('an empty hand loses 3, one card loses 2, two cards lose 1', () => {
    expect(lifeOf(at(0), 'p2')).toBe(17);
    expect(lifeOf(at(1), 'p2')).toBe(18);
    expect(lifeOf(at(2), 'p2')).toBe(19);
  });
  it('negative: three or more cards lose nothing (the amount is never negative: no life is gained)', () => {
    expect(lifeOf(at(3), 'p2')).toBe(20);
    expect(lifeOf(at(6), 'p2')).toBe(20);
  });
  it('negative: a group ("each player") is not this reading (the count would not be per player)', () => {
    const f = card('Test Gnaw Group', 'Sorcery', 'Each player loses 1 life for each card fewer than three in their hand.');
    expect(full(f)).toBe(false);
  });
  it('negative: it does not happen in the controller\'s own upkeep', () => {
    const s = resolveAll(advanceTo(scenario([], { defs: [RAT], p1: { battlefield: ['Test Gnaw Rat'] } }), 3, 'upkeep'));
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

describe('CR 702.154a, 603.2: "Whenever ~ enlists a creature, scry 2."', () => {
  const GUARD = card('Test Enlist Guard', 'Creature — Human Soldier', 'Enlist\nWhenever Test Enlist Guard enlists a creature, you gain 3 life.', ['2', '2']);
  const PAL = card('Test Enlist Pal', 'Creature — Human', '', ['1', '1']);
  const board = (): GameState => scenario([], { defs: [GUARD, PAL], p1: { battlefield: ['Test Enlist Guard', 'Test Enlist Pal'] } });
  const attack = (s0: GameState, yes: boolean): GameState => {
    const s1 = s0;
    let s = declareAttackers(toDeclareAttackers(s1), [[find(s1, 'Test Enlist Guard', 'battlefield', 'p1')]]);
    for (let i = 0; i < 6 && s.pending && s.pending.kind !== 'priority'; i++) {
      const d = s.pending as { kind: string; options?: ObjectId[] };
      s = d.kind === 'chooseObjects' ? settle(s, { objects: yes ? d.options!.slice(0, 1) : [] }) : settle(s);
    }
    return resolveAll(s);
  };
  it('is full', () => expect(full(GUARD)).toBe(true));
  it('enlisting a creature triggers it once (3 life), and the enlisted creature is tapped', () => {
    const s = attack(board(), true);
    expect(life(s, 'p1')).toBe(23);
    expect(s.objects[find(s, 'Test Enlist Pal', 'battlefield', 'p1')]!.tapped).toBe(true);
  });
  it('negative: declining to enlist triggers nothing', () => {
    const s = attack(board(), false);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 119.3, 603.2, 608.2h: "Until end of turn, whenever a player gains life, that player loses 2 life for each 1 life they gained."', () => {
  const CURE = card('Test Sour Cure', 'Instant', 'Until end of turn, whenever a player gains life, that player loses 2 life for each 1 life they gained.');
  const BALM = card('Test Balm', 'Instant', 'You gain 3 life.');
  const start = (): GameState => scenario([], { defs: [CURE, BALM], p1: { hand: ['Test Sour Cure', 'Test Balm'] }, p2: { hand: [] } });
  it('is full', () => expect(full(CURE)).toBe(true));
  it('gaining 3 life loses 6 life: the player ends 3 below where they began', () => {
    const s = resolveAll(cast(resolveAll(cast(start(), 'Test Sour Cure')), 'Test Balm'));
    expect(lifeOf(s, 'p1')).toBe(17);
    expect(lifeOf(s, 'p2')).toBe(20); // negative: the other player did not gain
  });
  it('negative: a loss of life is not a gain (the wording on another event stays manual)', () => {
    expect(full(card('Test Sour Loss', 'Instant', 'Until end of turn, whenever a player loses life, that player loses 2 life for each 1 life they gained.'))).toBe(false);
  });
  it('negative: without the spell, gaining life only gains it', () => {
    const s = resolveAll(cast(start(), 'Test Balm'));
    expect(lifeOf(s, 'p1')).toBe(23);
  });
  it('negative: it ends with the turn (a life gain on the next turn is just a gain)', () => {
    const s0 = resolveAll(cast(start(), 'Test Sour Cure'));
    const s1 = advanceTo(s0, 3, 'main1');
    const s2 = tweak(s1, (t) => { put(t, 'p1', 'hand', 'Test Balm'); });
    const s3 = resolveAll(cast(s2, 'Test Balm'));
    expect(lifeOf(s3, 'p1')).toBe(lifeOf(s2, 'p1') + 3);
  });
});

describe('CR 608.2f, 120.2b, 608.2h: "For each player, ~ deals damage to that player and each creature that player controls equal to the number of creatures they control."', () => {
  const REBEL = card('Test Riot Call', 'Sorcery', 'For each player, Test Riot Call deals damage to that player and each creature that player controls equal to the number of creatures they control.');
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['4', '4']);
  it('is full', () => expect(full(REBEL)).toBe(true));
  it('each player takes damage equal to their own creature count, as does each of their creatures', () => {
    const s0 = scenario([], { defs: [REBEL, OGRE], p1: { hand: ['Test Riot Call'], battlefield: ['Test Ogre', 'Test Ogre'] }, p2: { battlefield: ['Test Ogre', 'Test Ogre', 'Test Ogre'] } });
    const s = resolveAll(cast(s0, 'Test Riot Call'));
    expect(lifeOf(s, 'p1')).toBe(18);
    expect(lifeOf(s, 'p2')).toBe(17);
    for (const id of s.zones.battlefield.filter((x) => s.objects[x]!.controller === 'p1')) expect(damageOn(s, id)).toBe(2);
    for (const id of s.zones.battlefield.filter((x) => s.objects[x]!.controller === 'p2')) expect(damageOn(s, id)).toBe(3);
  });
  it('negative: a player with no creatures takes nothing', () => {
    const s0 = scenario([], { defs: [REBEL, OGRE], p1: { hand: ['Test Riot Call'] }, p2: { battlefield: ['Test Ogre'] } });
    const s = resolveAll(cast(s0, 'Test Riot Call'));
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(lifeOf(s, 'p2')).toBe(19);
  });
});
