/**
 * FAST5 T42: returns and searches with relative mana value, distinct names, attached or transformed entry, played through the engine with synthetic cards
 * compiled by the game's default compiler (invented names and wordings, design 6.10). Each group is named after the rules it checks.
 *
 *   CR 202.3, 608.2h    "mana value less than or equal to ~'s power" (last known power), "with lesser mana value" (than the creature the trigger is about)
 *   CR 107.3, 601.2h    "mana value X or less ..., where X is the amount of mana spent to cast ~"; "pay X life" as an additional cost is announced
 *   CR 201.2, 115.1     "target creature cards with different names", "cards with different names" in a search, "all other cards with the same name"
 *   CR 701.23, 608.2d   "reveal it, put it into your hand or graveyard", "put one into your hand and the other into your graveyard"
 *   CR 303.4f, 712.14a  "attached to target creature", "attached to ~", "transformed"
 */
import { describe, expect, it } from 'vitest';
import { act, answer, find, legal, reject, scenario } from '../../m3/scenario';
import { KILL, MOUSE, OGRE, WOLF, WURM, card, cast, ids, inZone, noManual, offered, onBattlefield, pick, resolve, settle } from './support';


describe('CR 202.3, 608.2h: "return another target non-Wurm creature card with mana value less than or equal to ~\'s power from your graveyard to the battlefield"', () => {
  const HUSK = card('Test Husk', 'Creature — Zombie', 'When this creature dies, return another target non-Wurm creature card with mana value less than or equal to this creature\'s power from your graveyard to the battlefield.', { pt: ['2', '2'], cost: '{1}{B}', colors: ['B'] });
  const ALL = [MOUSE, WOLF, OGRE, WURM, KILL, HUSK];
  it('is automated', () => expect(noManual(HUSK)).toEqual([]));
  it('offers the non-Wurm creature cards of mana value 2 or less (its power as it last existed), not itself, not a Wurm, not the Ogre', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Kill'], battlefield: ['Test Husk'], graveyard: ['Test Mouse', 'Test Wolf', 'Test Ogre', 'Test Wurm'] } });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Kill', 'hand', 'p1') }), (t) => (t.pending!.kind === 'chooseTargets' ? pick(find(t, 'Test Husk', 'battlefield', 'p1')) : undefined));
    s = resolve(s); // the destroy resolves, the Husk dies, its trigger asks for a target
    expect(offered(s)).toEqual(['Test Mouse', 'Test Wolf']);
    s = settle(answer(s, pick(find(s, 'Test Wolf', 'graveyard', 'p1'))));
    s = resolve(s);
    expect(onBattlefield(s)).toContain('Test Wolf');
    expect(inZone(s, 'graveyard')).toContain('Test Husk');
  });
  it('counts +1/+1 counters: with a counter on it the Husk has power 3, so the Ogre is offered too', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Kill'], battlefield: [{ name: 'Test Husk', counters: { '+1/+1': 1 } }], graveyard: ['Test Mouse', 'Test Wolf', 'Test Ogre', 'Test Wurm'] } });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Kill', 'hand', 'p1') }), (t) => (t.pending!.kind === 'chooseTargets' ? pick(find(t, 'Test Husk', 'battlefield', 'p1')) : undefined));
    s = resolve(s);
    expect(offered(s)).toEqual(['Test Mouse', 'Test Ogre', 'Test Wolf']);
  });
});

describe('CR 202.3: "return another target creature card with lesser mana value from your graveyard to the battlefield" (lesser than the creature that died)', () => {
  const GATE = card('Test Gate', 'Creature — Bird', 'Whenever this creature or another creature you control dies, return another target creature card with lesser mana value from your graveyard to the battlefield.', { pt: ['1', '1'], cost: '{2}{W}', colors: ['W'] });
  const ALL = [MOUSE, WOLF, OGRE, KILL, GATE];
  it('is automated', () => expect(noManual(GATE)).toEqual([]));
  it('another creature with mana value 3 dies: only the graveyard cards of mana value 1 and 2 are offered', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Kill'], battlefield: ['Test Gate', 'Test Ogre'], graveyard: ['Test Mouse', 'Test Wolf', 'Test Ogre'] } });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Kill', 'hand', 'p1') }), (t) => (t.pending!.kind === 'chooseTargets' ? pick(find(t, 'Test Ogre', 'battlefield', 'p1')) : undefined));
    s = resolve(s);
    expect(offered(s)).toEqual(['Test Mouse', 'Test Wolf']);
    s = settle(answer(s, pick(find(s, 'Test Mouse', 'graveyard', 'p1'))));
    s = resolve(s);
    expect(onBattlefield(s)).toContain('Test Mouse');
  });
  it('a creature of mana value 1 dies: nothing has lesser mana value, so the ability has no legal target and is removed (CR 603.3d)', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Kill'], battlefield: ['Test Gate', 'Test Mouse'], graveyard: ['Test Wolf', 'Test Ogre'] } });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Kill', 'hand', 'p1') }), (t) => (t.pending!.kind === 'chooseTargets' ? pick(find(t, 'Test Mouse', 'battlefield', 'p1')) : undefined));
    s = resolve(s);
    expect(s.pending?.kind).toBe('priority');
    expect(s.zones.stack).toHaveLength(0);
    expect(onBattlefield(s)).not.toContain('Test Wolf');
  });
});

describe('CR 202.3: "return up to one target creature you control with lesser mana value to its owner\'s hand" (lesser than the creature that entered)', () => {
  const FROG = card('Test Frog', 'Creature — Frog', 'Whenever this creature or another creature you control enters, return up to one target creature you control with lesser mana value to its owner\'s hand.', { pt: ['1', '1'], cost: '{0}', colors: ['U'] });
  const ALL = [MOUSE, WOLF, OGRE, FROG];
  it('is automated', () => expect(noManual(FROG)).toEqual([]));
  it('an Ogre (mana value 3) enters: the Frog (0), the Mouse (1) and the Wolf (2) are lesser, the Ogre itself is not', () => {
    const s0 = scenario(['Mountain', 'Plains'], { defs: ALL, p1: { hand: ['Test Ogre'], battlefield: ['Test Frog', 'Test Mouse', 'Test Wolf', 'Mountain', 'Plains', 'Plains'] } });
    let s = cast(s0, 'Test Ogre');
    s = resolve(s); // the Ogre resolves; the Frog's trigger goes on the stack and asks for its target
    expect(offered(s)).toEqual(['Test Frog', 'Test Mouse', 'Test Wolf']);
    s = settle(answer(s, pick(find(s, 'Test Wolf', 'battlefield', 'p1'))));
    s = resolve(s);
    expect(inZone(s, 'hand')).toContain('Test Wolf');
  });
});

describe('CR 107.3a, 601.2b: "As an additional cost to cast this spell, pay X life." and "Return each artifact and creature card with mana value X from your graveyard to the battlefield."', () => {
  const FIX = card('Test Fix', 'Sorcery', 'As an additional cost to cast this spell, pay X life.\nReturn each artifact and creature card with mana value X from your graveyard to the battlefield.', { cost: '{1}{B}', colors: ['B'] });
  const GEAR = card('Test Gear', 'Artifact', '', { cost: '{2}' });
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', { pt: ['2', '2'], cost: '{2}' });
  const ALL = [FIX, GEAR, GOLEM, MOUSE, WOLF, OGRE];
  it('is automated', () => expect(noManual(FIX)).toEqual([]));
  it('X = 2: the artifact, the artifact creature and the creature of mana value 2 return (an artifact creature card counts once), mana value 1 and 3 stay; two life are paid', () => {
    const s0 = scenario(['Swamp', 'Plains'], { defs: ALL, p1: { hand: ['Test Fix'], battlefield: ['Swamp', 'Plains'], graveyard: ['Test Gear', 'Test Golem', 'Test Wolf', 'Test Mouse', 'Test Ogre'] } });
    let s = cast(s0, 'Test Fix', (t) => (t.pending!.kind === 'chooseNumber' ? { kind: 'chooseNumber', n: 2 } : undefined));
    expect(s.pending?.kind).toBe('priority');
    s = resolve(s);
    expect(onBattlefield(s).filter((n) => n.startsWith('Test')).sort()).toEqual(['Test Gear', 'Test Golem', 'Test Wolf']);
    expect(inZone(s, 'graveyard').sort()).toEqual(['Test Fix', 'Test Mouse', 'Test Ogre']);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(18);
  });
  it('X = 0: only mana value 0 cards return (here none), and no life is paid', () => {
    const s0 = scenario(['Swamp', 'Plains'], { defs: ALL, p1: { hand: ['Test Fix'], battlefield: ['Swamp', 'Plains'], graveyard: ['Test Gear', 'Test Mouse'] } });
    let s = cast(s0, 'Test Fix', (t) => (t.pending!.kind === 'chooseNumber' ? { kind: 'chooseNumber', n: 0 } : undefined));
    s = resolve(s);
    expect(onBattlefield(s).filter((n) => n.startsWith('Test'))).toEqual([]);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(20);
  });
});

describe('CR 601.2h, 106.1: "return target noncreature, nonland permanent card with mana value X or less from your graveyard to the battlefield, where X is the amount of mana spent to cast ~"', () => {
  const ANGEL = card('Test Reclaimer', 'Creature — Angel', 'When this creature enters, return target noncreature, nonland permanent card with mana value X or less from your graveyard to the battlefield, where X is the amount of mana spent to cast this creature.', { pt: ['2', '2'], cost: '{1}{W}', colors: ['W'] });
  const RING = card('Test Ring', 'Artifact', '', { cost: '{2}' });
  const CROWN = card('Test Crown', 'Artifact', '', { cost: '{4}' });
  const SHRINE = card('Test Shrine', 'Enchantment', '', { cost: '{1}' });
  const ALL = [ANGEL, RING, CROWN, SHRINE, MOUSE];
  it('is automated', () => expect(noManual(ANGEL)).toEqual([]));
  it('cast for {1}{W} (2 mana spent): the artifact of mana value 2 and the enchantment of mana value 1 are offered, not mana value 4 and not the creature card', () => {
    const s0 = scenario(['Plains'], { defs: ALL, p1: { hand: ['Test Reclaimer'], battlefield: ['Plains', 'Plains'], graveyard: ['Test Ring', 'Test Crown', 'Test Shrine', 'Test Mouse'] } });
    let s = resolve(cast(s0, 'Test Reclaimer')); // the creature resolves, its enters trigger asks for its target
    expect(offered(s)).toEqual(['Test Ring', 'Test Shrine']);
    s = settle(answer(s, pick(find(s, 'Test Ring', 'graveyard', 'p1'))));
    s = resolve(s);
    expect(onBattlefield(s)).toContain('Test Ring');
  });
});

describe('CR 202.3: "Return to the battlefield target nonland permanent card in your graveyard with mana value less than or equal to the number of permanent cards in your graveyard."', () => {
  const BACK = card('Test Back', 'Sorcery', 'Return to the battlefield target nonland permanent card in your graveyard with mana value less than or equal to the number of permanent cards in your graveyard.', { cost: '{0}', colors: ['B'] });
  const RING = card('Test Ring', 'Artifact', '', { cost: '{2}' });
  const CROWN = card('Test Crown', 'Artifact', '', { cost: '{4}' });
  const FOREST = card('Test Grove', 'Land', '');
  const ALL = [BACK, RING, CROWN, FOREST, MOUSE];
  it('is automated', () => expect(noManual(BACK)).toEqual([]));
  it('three permanent cards in the graveyard (the Ring, the Crown, a land): mana value 3 or less; the Ring is offered, the Crown (4) and the land are not', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Back'], graveyard: ['Test Ring', 'Test Crown', 'Test Grove'] } });
    const s = cast(s0, 'Test Back');
    expect(offered(s)).toEqual(['Test Ring']);
  });
  it('four permanent cards: the count grows, and the Crown (mana value 4) is offered with the Ring and the Mouse', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Back'], graveyard: ['Test Ring', 'Test Crown', 'Test Grove', 'Test Mouse'] } });
    const s = cast(s0, 'Test Back');
    expect(offered(s)).toEqual(['Test Crown', 'Test Mouse', 'Test Ring']);
  });
});

// the later groups (names, searches, choices, attachments) are in t42-scenarios-b.test.ts
void legal; void reject;
