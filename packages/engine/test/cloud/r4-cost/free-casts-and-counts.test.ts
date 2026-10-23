/**
 * r4-cost: casts without paying the mana cost during a resolution, and counts of other objects and of opponents (zz-cloud/r4-cost.json), played with synthetic
 * cards (design 6.10).
 *
 *   CR 601.2, 608.2g, 118.9      "you may cast target instant card with mana value 3 or less from your graveyard without paying its mana cost": the target is cast
 *                                from the graveyard for nothing; declining leaves it there
 *   CR 601.2, 608.2g, 202.3      "you may cast a spell from your hand with mana value less than or equal to that damage without paying its mana cost": the amount
 *                                of combat damage dealt is the limit
 *   CR 601.2f, 602.2b, 109.2     "This ability costs {1} less to activate for each other Golem you control": the source itself is not counted
 *   CR 614.1c, 614.12, 119.3     "Other creatures you control enter with an additional +1/+1 counter on them for each opponent who lost life this turn"
 *   CR 121.1, 119.3              "draw a card for each opponent who lost life this turn"
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId, TargetChoice } from '../../../src/index';
import { act, activations, attackWith, card, cast, drive, find, full, named, passBoth, resolveAll, scenario } from './support';

const PT: [string, string] = ['2', '2'];
const WAVER = card('Test Tide Caller', 'Creature — Otter Wizard', 'When this creature enters, you may cast target instant card with mana value 3 or less from your graveyard without paying its mana cost.', '{1}', PT);
const SWORD = card('Test Hero Blade', 'Creature — Human Warrior', 'Whenever this creature deals combat damage to a player, you may cast a spell from your hand with mana value less than or equal to that damage without paying its mana cost.', '{1}', ['3', '3']);
const FORGE = card('Test Golem Forge', 'Artifact Creature — Golem', '{4}, {T}: Draw a card. This ability costs {1} less to activate for each other Golem you control.', '{1}', PT);
const SCORCH = card('Test Scorch Lord', 'Creature — Lizard', 'Other creatures you control enter with an additional +1/+1 counter on them for each opponent who lost life this turn.', '{1}', PT);
const SEER = card('Test Dream Seer', 'Sorcery', 'Scry 1. Then draw a card for each opponent who lost life this turn.', '{0}');
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to any target.', '{2}{R}');
const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to any target.', '{0}');
const BIG = card('Test Big Blast', 'Instant', 'Test Big Blast deals 5 damage to any target.', '{5}');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{3}', ['3', '3']);
const GOLEM = card('Test Iron Golem', 'Artifact Creature — Golem', '', '{2}', PT);
const DEFS = [WAVER, SWORD, FORGE, SCORCH, SEER, BOLT, ZAP, BIG, OGRE, GOLEM];

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const life = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;

describe('r4-cost: free casts during a resolution, counts of other objects and of opponents', () => {
  it('the cards are automated', () => {
    for (const d of [WAVER, SWORD, FORGE, SCORCH, SEER]) expect(full(d), d.name).toBe(true);
  });

  it('CR 608.2g, 118.9: the targeted instant is cast from the graveyard for nothing; declining leaves it there', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Plains'], hand: ['Test Tide Caller'], graveyard: ['Test Bolt'] } });
    const bolt = find(s0, 'Test Bolt', 'graveyard', 'p1');
    // resolveAll restarts the script for each resolution: the trigger's target first, then the cast during its resolution (the Bolt's own target)
    const triggered = drive(passBoth(cast(s0, 'Test Tide Caller')), { targets: [[obj(bolt)]] });
    const yes = resolveAll(triggered, { targets: [[{ kind: 'player', id: 'p2' }]], yes: [true] });
    expect(life(yes, 'p2')).toBe(17); // {2}{R} paid with nothing (no land is left)
    const no = resolveAll(triggered, { yes: [false] });
    expect(life(no, 'p2')).toBe(20);
    expect(no.zones.graveyard.p1!.map((id) => no.objects[id]!.defId)).toContain('Test Bolt');
  });

  it('CR 608.2g, 202.3: after 3 combat damage, a mana value 0 spell is cast for nothing; a mana value 5 one is not among the choices', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Hero Blade'], hand: ['Test Big Blast', 'Test Zap'] } });
    const blade = find(s0, 'Test Hero Blade', 'battlefield', 'p1');
    const zap = find(s0, 'Test Zap', 'hand', 'p1');
    const s = attackWith(s0, [blade], 'p2', { objects: [[zap]], targets: [[{ kind: 'player', id: 'p2' }]] });
    expect(life(s, 'p2')).toBe(16); // 3 combat damage, then the free Zap
    expect(() => attackWith(s0, [blade], 'p2', { objects: [[find(s0, 'Test Big Blast', 'hand', 'p1')]] })).toThrow(); // 5 is more than 3
  });

  it('CR 601.2f, 109.2: "{1} less for each other Golem you control": with two other Golems the {4} ability costs {2}; the Forge itself does not count', () => {
    const two = scenario([], { defs: DEFS, p1: { battlefield: ['Plains', 'Plains', 'Test Golem Forge', 'Test Iron Golem', 'Test Iron Golem'], library: ['Plains'] } });
    expect(activations(two, 'Test Golem Forge')).toHaveLength(1);
    const drawn = resolveAll(drive(act(two, activations(two, 'Test Golem Forge')[0]!.action)));
    expect(drawn.zones.hand.p1!.length).toBe(two.zones.hand.p1!.length + 1);
    const alone = scenario([], { defs: DEFS, p1: { battlefield: ['Plains', 'Plains', 'Plains', 'Test Golem Forge'] } });
    expect(activations(alone, 'Test Golem Forge')).toHaveLength(0); // {4} with three lands: no other Golem
  });

  it('CR 614.1c, 119.3: creatures enter with an additional +1/+1 counter for each opponent who lost life this turn (none before, one after)', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Plains', 'Plains', 'Test Scorch Lord'], hand: ['Test Iron Golem', 'Test Zap'] } });
    const before = resolveAll(cast(s0, 'Test Iron Golem'));
    expect(before.objects[find(before, 'Test Iron Golem', 'battlefield', 'p1')]!.counters?.['+1/+1'] ?? 0).toBe(0);
    const hit = resolveAll(cast(s0, 'Test Zap', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    const after = resolveAll(cast(hit, 'Test Iron Golem'));
    expect(after.objects[find(after, 'Test Iron Golem', 'battlefield', 'p1')]!.counters?.['+1/+1']).toBe(1);
    expect(after.objects[find(after, 'Test Scorch Lord', 'battlefield', 'p1')]!.counters?.['+1/+1'] ?? 0).toBe(0); // "other"
  });

  it('CR 121.1, 119.3: "draw a card for each opponent who lost life this turn": none, then one after the opponent lost life', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Dream Seer', 'Test Zap'], library: ['Plains', 'Plains', 'Plains'] } });
    const none = resolveAll(cast(s0, 'Test Dream Seer'));
    expect(none.zones.hand.p1!.length).toBe(1);
    const hit = resolveAll(cast(s0, 'Test Zap', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    const one = resolveAll(cast(hit, 'Test Dream Seer'));
    expect(one.zones.hand.p1!.length).toBe(1); // the Zap and the Seer left, one card drawn
    expect(named(one, 'Test Ogre')).toHaveLength(0);
  });
});
