/**
 * p2-attack-block-1 (lane p2-attack-block): attack and block restrictions played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the
 * cloud checkout).
 *
 *   CR 506.5             "can't be blocked as long as it's attacking alone": only while it is the only attacking creature
 *   CR 609.4, 702.14c    "Creatures with swampwalk can be blocked as though they didn't have swampwalk": waives that landwalk only
 *   CR 509.1b, 208.1     "Creatures with power less than ~'s power can't block creatures you control"
 *   CR 508.1c, 402.1     "Creatures with power greater than the number of cards in your hand can't attack"
 *   CR 702.9b, 702.17b   "without flying or reach": a creature with neither
 *   CR 611.2a, 602.5     "Until your next turn, target creature can't attack or block, and its activated abilities can't be activated"
 *   CR 611.2c, 509.1b    "Green creatures and white creatures can't block this turn"
 *   CR 613.1f, 509.1b    "Fish you control have haste and can't be blocked by Humans"
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState, ObjectId } from '../../../src/index';
import { gameOf, hookpoints } from '../../../src/rules/hookpoints';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, advanceTo, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';
import { card, full, resolveAll } from '../cmd3/helpers';

const PROWLER = card('Test Lone Prowler', 'Creature — Illusion', "This creature can't be blocked as long as it's attacking alone.", ['2', '2']);
const SNEAK_AURA = card('Test Sneak Charm', 'Enchantment — Aura', "Enchant creature\nAs long as enchanted creature is attacking alone, it can't be blocked.");
const BOG_WALKER = card('Test Bog Walker', 'Creature — Zombie', 'Swampwalk', ['2', '2']);
const REEF_WALKER = card('Test Reef Walker', 'Creature — Merfolk', 'Islandwalk', ['2', '2']);
const MIRE = card('Test Sucking Mire', 'Enchantment', "Creatures with swampwalk can be blocked as though they didn't have swampwalk.");
const CAPTAIN = card('Test Hill Captain', 'Creature — Human Warrior', "Creatures with power less than this creature's power can't block creatures you control.", ['3', '3']);
const BRIDGE = card('Test Narrow Bridge', 'Artifact', "Creatures with power greater than the number of cards in your hand can't attack.");
const SKY_WARDEN = card('Test Sky Warden', 'Creature — Human Knight', "Creatures your opponents control without flying or reach can't block creatures with power 2 or less.", ['2', '2']);
const STALL = card('Test Stalling Idol', 'Artifact', "{T}: Until your next turn, target creature can't attack or block, and its activated abilities can't be activated.");
const PANIC = card('Test Hue Panic', 'Sorcery', "Green creatures and white creatures can't block this turn.");
const SHOAL = card('Test Shoal Captain', 'Creature — Fish', "Fish you control have haste and can't be blocked by Humans.", ['1', '1']);
const DEFS: CardDef[] = [PROWLER, SNEAK_AURA, BOG_WALKER, REEF_WALKER, MIRE, CAPTAIN, BRIDGE, SKY_WARDEN, STALL, PANIC, SHOAL];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

const on = (s: GameState, name: string, player: string): ObjectId => s.zones.battlefield.find((id) => s.objects[id]!.defId === name && s.objects[id]!.controller === player)!;
const all = (s: GameState, name: string, player: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name && s.objects[id]!.controller === player);
const canBlock = (s: GameState, blocker: ObjectId, attacker: ObjectId): boolean => hookpoints.canBlock(gameOf(s), blocker, attacker) === null;
const canAttack = (s: GameState, attacker: ObjectId): boolean => hookpoints.canAttack(gameOf(s), attacker, 'p2') === null;
const toCombat = (s0: GameState): GameState => toDeclareAttackers(advanceTo(s0, 3, 'main1'));

describe('CR 506.5: "This creature can\'t be blocked as long as it\'s attacking alone."', () => {
  const start = (): GameState => toCombat(scenario(['Grizzly Bears'], { defs: DEFS, p1: { battlefield: ['Test Lone Prowler', 'Grizzly Bears'] }, p2: { battlefield: ['Grizzly Bears'] } }));
  it('attacking alone: it can\'t be blocked', () => {
    let s = start();
    s = declareAttackers(s, [[on(s, 'Test Lone Prowler', 'p1')]]);
    expect(canBlock(s, on(s, 'Grizzly Bears', 'p2'), on(s, 'Test Lone Prowler', 'p1'))).toBe(false);
  });
  it('attacking with another creature: it can be blocked', () => {
    let s = start();
    s = declareAttackers(s, [[on(s, 'Test Lone Prowler', 'p1')], [on(s, 'Grizzly Bears', 'p1')]]);
    expect(canBlock(s, on(s, 'Grizzly Bears', 'p2'), on(s, 'Test Lone Prowler', 'p1'))).toBe(true);
  });
});

describe('CR 609.4, 702.14c: "Creatures with swampwalk can be blocked as though they didn\'t have swampwalk."', () => {
  const start = (mire: boolean): GameState => toCombat(scenario(['Grizzly Bears', 'Swamp', 'Island'], {
    defs: DEFS, p1: { battlefield: ['Test Bog Walker', 'Test Reef Walker'] }, p2: { battlefield: ['Grizzly Bears', 'Swamp', 'Island', ...(mire ? ['Test Sucking Mire'] : [])] },
  }));
  it('without the enchantment: swampwalk makes the creature unblockable while the defending player controls a Swamp', () => {
    let s = start(false);
    s = declareAttackers(s, [[on(s, 'Test Bog Walker', 'p1')]]);
    expect(canBlock(s, on(s, 'Grizzly Bears', 'p2'), on(s, 'Test Bog Walker', 'p1'))).toBe(false);
  });
  it('with it (any player\'s): the swampwalker can be blocked; an islandwalker still can\'t (only the named landwalk is waived)', () => {
    let s = start(true);
    s = declareAttackers(s, [[on(s, 'Test Bog Walker', 'p1')], [on(s, 'Test Reef Walker', 'p1')]]);
    expect(canBlock(s, on(s, 'Grizzly Bears', 'p2'), on(s, 'Test Bog Walker', 'p1'))).toBe(true);
    expect(canBlock(s, on(s, 'Grizzly Bears', 'p2'), on(s, 'Test Reef Walker', 'p1'))).toBe(false);
  });
});

describe('CR 509.1b, 208.1: "Creatures with power less than this creature\'s power can\'t block creatures you control."', () => {
  it('a 2/2 can\'t block the controller\'s creatures, a 3/3 can; the comparison follows the source\'s power', () => {
    let s = toCombat(scenario(['Grizzly Bears', 'Hill Giant'], { defs: DEFS, p1: { battlefield: ['Test Hill Captain', 'Grizzly Bears'] }, p2: { battlefield: ['Grizzly Bears', 'Hill Giant'] } }));
    s = declareAttackers(s, [[on(s, 'Grizzly Bears', 'p1')]]);
    const bear = on(s, 'Grizzly Bears', 'p1');
    expect(canBlock(s, on(s, 'Grizzly Bears', 'p2'), bear)).toBe(false);
    expect(canBlock(s, on(s, 'Hill Giant', 'p2'), bear)).toBe(true);
  });
});

describe('CR 508.1c, 402.1: "Creatures with power greater than the number of cards in your hand can\'t attack."', () => {
  it('the controller of the artifact with an empty hand: a 2/2 can\'t attack; with two cards in hand it can', () => {
    const empty = advanceTo(scenario(['Grizzly Bears'], { defs: DEFS, p1: { battlefield: ['Test Narrow Bridge', 'Grizzly Bears'] } }), 3, 'main1');
    const s0 = { ...empty, zones: { ...empty.zones, hand: { ...empty.zones.hand, p1: [] } } } as GameState;
    expect(canAttack(s0, on(s0, 'Grizzly Bears', 'p1'))).toBe(false);
    const two = { ...empty, zones: { ...empty.zones, hand: { ...empty.zones.hand, p1: (empty.zones.library.p1 ?? []).slice(0, 2) } } } as GameState;
    expect(canAttack(two, on(two, 'Grizzly Bears', 'p1'))).toBe(true);
  });
});

describe('CR 702.9b, 702.17b, 509.1b: "Creatures your opponents control without flying or reach can\'t block creatures with power 2 or less."', () => {
  it('a creature without flying or reach can\'t block a 2/2; one with reach (Giant Spider) can; a 3-power attacker can be blocked', () => {
    let s = toCombat(scenario(['Grizzly Bears', 'Giant Spider', 'Hill Giant'], { defs: DEFS, p1: { battlefield: ['Test Sky Warden', 'Grizzly Bears', 'Hill Giant'] }, p2: { battlefield: ['Grizzly Bears', 'Giant Spider'] } }));
    s = declareAttackers(s, [[on(s, 'Grizzly Bears', 'p1')], [on(s, 'Hill Giant', 'p1')]]);
    expect(canBlock(s, on(s, 'Grizzly Bears', 'p2'), on(s, 'Grizzly Bears', 'p1'))).toBe(false);
    expect(canBlock(s, on(s, 'Giant Spider', 'p2'), on(s, 'Grizzly Bears', 'p1'))).toBe(true);
    expect(canBlock(s, on(s, 'Grizzly Bears', 'p2'), on(s, 'Hill Giant', 'p1'))).toBe(true);
  });
});

describe('CR 611.2a, 602.5: "{T}: Until your next turn, target creature can\'t attack or block, and its activated abilities can\'t be activated."', () => {
  it('the target can\'t attack or block until its controller\'s opponent\'s next turn; the other creature can', () => {
    let s = advanceTo(scenario(['Grizzly Bears'], { defs: DEFS, p1: { battlefield: ['Test Stalling Idol', 'Grizzly Bears'] }, p2: { battlefield: ['Grizzly Bears', 'Grizzly Bears'] } }), 3, 'main1');
    const [held, free] = all(s, 'Grizzly Bears', 'p2');
    s = resolveAll(act(s, { type: 'activate', player: 'p1', source: on(s, 'Test Stalling Idol', 'p1'), ability: 'p:0:0' }), { targets: [{ kind: 'object', id: held! }] });
    expect(hookpoints.canAttack(gameOf(s), held!, 'p1')).not.toBeNull();
    expect(canBlock(s, held!, on(s, 'Grizzly Bears', 'p1'))).toBe(false);
    expect(hookpoints.canAttack(gameOf(s), free!, 'p1')).toBeNull();
  });
});

describe('CR 611.2c, 509.1b: "Green creatures and white creatures can\'t block this turn."', () => {
  it('green and white creatures can\'t block; a creature of another color can', () => {
    let s = advanceTo(scenario(['Grizzly Bears', 'Elite Vanguard', 'Hill Giant'], { defs: DEFS, p1: { hand: ['Test Hue Panic'], battlefield: ['Hill Giant'] }, p2: { battlefield: ['Grizzly Bears', 'Elite Vanguard', 'Hill Giant'] } }), 3, 'main1');
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: s.zones.hand.p1!.find((id) => s.objects[id]!.defId === 'Test Hue Panic')! }));
    s = toDeclareAttackers(s);
    s = declareAttackers(s, [[on(s, 'Hill Giant', 'p1')]]);
    const giant = on(s, 'Hill Giant', 'p1');
    expect(canBlock(s, on(s, 'Grizzly Bears', 'p2'), giant)).toBe(false);
    expect(canBlock(s, on(s, 'Elite Vanguard', 'p2'), giant)).toBe(false);
    expect(canBlock(s, on(s, 'Hill Giant', 'p2'), giant)).toBe(true);
  });
});

describe('CR 613.1f, 509.1b: "Fish you control have haste and can\'t be blocked by Humans."', () => {
  it('the Fish has haste and Humans can\'t block it; a non-Human can', () => {
    let s = toCombat(scenario(['Elite Vanguard', 'Grizzly Bears'], { defs: DEFS, p1: { battlefield: ['Test Shoal Captain'] }, p2: { battlefield: ['Elite Vanguard', 'Grizzly Bears'] } }));
    const fish = on(s, 'Test Shoal Captain', 'p1');
    expect(hasKeyword(getChars(s, fish)!, 'haste')).toBe(true);
    s = declareAttackers(s, [[fish]]);
    expect(canBlock(s, on(s, 'Elite Vanguard', 'p2'), fish)).toBe(false); // a Human Soldier
    expect(canBlock(s, on(s, 'Grizzly Bears', 'p2'), fish)).toBe(true);
  });
});
