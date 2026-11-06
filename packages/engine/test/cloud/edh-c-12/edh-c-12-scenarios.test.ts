/**
 * Commander effort, round edh-c-12 (EDHREC ranks 18,126 to 18,750, second pass): the round's readings played through the engine with synthetic cards (invented names), compiled by
 * the game's default compiler. Alice (p1) casts and attacks. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 119.5, 608.2d            "When ~ enters, you may have your life total become the total toughness of creatures you control."
 *   CR 205.1b, 611.2a, 613.1d   "... you may have ~ become a 3/3 Golem artifact creature with haste until end of turn." / "~ becomes an artifact creature and gets +1/+1 until end of turn."
 *   CR 205.1a, 508.1c, 509.1b   "Enchanted creature is a Spirit and can't attack or block."
 *   CR 613.1d-f, 613.4b         "Enchanted creature has base power and toughness 0/4, has defender, loses all other abilities, and is a blue Wall in addition to its other colors and types."
 *   CR 611.3a, 604.1            "Enchanted creature gets +2/+2 as long as it's a Human. Otherwise, it can't attack or block."
 *   CR 509.1a, 509.1b           "Equipped creature gets +0/+3 and can block an additional creature each combat."
 *   CR 701.21a, 701.8a, 701.19c "At the beginning of your upkeep, if there are four or more creatures on the battlefield, sacrifice ~ and destroy all creatures. They can't be regenerated."
 *   CR 614.1c, 122.6, 119.3     "~ enters with X +1/+1 counters on it, where X is the total life lost by your opponents this turn." / "... two +1/+1 counters on it for each other nontoken Human you control."
 *   CR 700.4, 205.3m            "draw a card for each Zubera that died this turn"
 *   CR 608.2c, 109.4, 400.7     "Destroy target land, then ~ deals damage to that land's controller equal to the number of land cards in that player's graveyard."
 *   CR 406.1, 108.3             "Return target exiled card with flashback you own to your hand."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, getChars, type CardDef, type GameState, type ObjectId, type TargetChoice } from '../../../src/index';
import { hasKeyword } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, life, pass, put, scenario } from '../../m3/scenario';
import { declareAttackers, tweak, toDeclareAttackers } from '../../m4/helpers';
import { card, counters, full, inYard, named, pt, resolveAll, settle, type Picks } from '../cmd3/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });
const cast = (s: GameState, name: string, p: Picks = {}, who = 'p1'): GameState => settle(act(s, { type: 'cast', player: who, card: find(s, name, 'hand', who) }), p);
const handSize = (s: GameState, p: string): number => s.zones.hand[p]!.length;
const typesOf = (s: GameState, id: ObjectId): string[] => [...getChars(s, id)!.types];
const reply = (s: GameState, a: Parameters<typeof answer>[1]) => ({ type: 'answer' as const, player: s.pending!.player, decisionId: s.pending!.id, answer: a });

const LIFE = card('Test Tide Keeper', 'Creature — Elephant Cleric', 'When this creature enters, you may have your life total become the total toughness of creatures you control.', ['2', '5']);
const WALL = card('Test Wall', 'Creature — Wall', '', ['0', '3']);
const GOLEM = card('Test Idol', 'Artifact', 'When this artifact enters, you may have this artifact become a 3/3 Golem artifact creature with haste until end of turn.');
const TANK = card('Test Wagon', 'Artifact — Vehicle', 'When this Vehicle enters, this Vehicle becomes an artifact creature and gets +1/+1 until end of turn.', ['3', '3']);
const SPIRIT = card('Test Haze', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature is a Spirit and can\'t attack or block.');
const FREEZE = card('Test Rime', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature has base power and toughness 0/4, has defender, loses all other abilities, and is a blue Wall in addition to its other colors and types.');
const BOND = card('Test Oath', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +2/+2 as long as it\'s a Human. Otherwise, it can\'t attack or block.');
const SHIELD = card('Test Buckler', 'Artifact — Equipment', 'Equipped creature gets +0/+3 and can block an additional creature each combat.\nEquip {3}');
const COLLAPSE = card('Test Cataclysm', 'Enchantment', 'At the beginning of your upkeep, if there are four or more creatures on the battlefield, sacrifice this enchantment and destroy all creatures. They can\'t be regenerated.');
const HORROR = card('Test Gloom', 'Creature — Horror', 'This creature enters with X +1/+1 counters on it, where X is the total life lost by your opponents this turn.', ['1', '1']);
const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 3 damage to target opponent.');
const VANGUARD = card('Test Vanguard', 'Creature — Human Warrior', 'This creature enters with two +1/+1 counters on it for each other nontoken Human you control.', ['1', '1']);
const HUMAN = card('Test Villager', 'Creature — Human', '', ['1', '1']);
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', ['1', '1']);
const ZUB = card('Test Dream Zub', 'Creature — Zubera Spirit', 'When this creature dies, draw a card for each Zubera that died this turn.', ['1', '1']);
const ZUB2 = card('Test Plain Zub', 'Creature — Zubera', '', ['1', '1']);
const WRATH = card('Test Sweep', 'Sorcery', 'Destroy all creatures.');
const TERRAIN = card('Test Quake', 'Sorcery', 'Destroy target land, then Test Quake deals damage to that land\'s controller equal to the number of land cards in that player\'s graveyard.');
const REPEAT = card('Test Recall', 'Sorcery', 'Return target exiled card with flashback you own to your hand.');
const FLASH = card('Test Echo Spell', 'Sorcery', 'Flashback {2}\nYou gain 1 life.');
const PLAIN = card('Test Plain Spell', 'Sorcery', 'You gain 1 life.');
const FLYER = card('Test Flyer', 'Creature — Goblin', 'Flying', ['2', '2']);
const DEFS: CardDef[] = [LIFE, WALL, GOLEM, TANK, SPIRIT, FREEZE, BOND, SHIELD, COLLAPSE, HORROR, ZAP, VANGUARD, HUMAN, GOBLIN, ZUB, ZUB2, WRATH, TERRAIN, REPEAT, FLASH, PLAIN, FLYER];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 119.5, 608.2d: "you may have your life total become the total toughness of creatures you control"', () => {
  const setup = (lifeTotal: number): GameState => scenario([], { life: lifeTotal, p1: { hand: ['Test Tide Keeper'], battlefield: ['Test Wall'] }, defs: DEFS });
  it('below the total: you gain the difference (5 + 3 toughness: 2 becomes 8)', () => {
    const s = resolveAll(cast(setup(2), 'Test Tide Keeper'), { yes: true });
    expect(life(s, 'p1')).toBe(8);
  });
  it('above the total: you lose the difference (20 becomes 8)', () => {
    const s = resolveAll(cast(setup(20), 'Test Tide Keeper'), { yes: true });
    expect(life(s, 'p1')).toBe(8);
  });
  it('negative: declined, the life total stays', () => {
    const s = resolveAll(cast(setup(2), 'Test Tide Keeper'), { yes: false });
    expect(life(s, 'p1')).toBe(2);
  });
});

describe('CR 205.1b, 611.2a, 613.1d: "you may have this artifact become a 3/3 Golem artifact creature with haste until end of turn"', () => {
  const setup = (): GameState => scenario([], { p1: { hand: ['Test Idol'] }, defs: DEFS });
  it('accepted: a 3/3 Golem artifact creature with haste', () => {
    const s = resolveAll(cast(setup(), 'Test Idol'), { yes: true });
    const id = named(s, 'Test Idol')[0]!;
    expect(typesOf(s, id)).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(pt(s, id)).toBe('3/3');
    expect(hasKeyword(getChars(s, id)!, 'haste')).toBe(true);
  });
  it('negative: declined, it stays a plain artifact', () => {
    const s = resolveAll(cast(setup(), 'Test Idol'), { yes: false });
    expect(typesOf(s, named(s, 'Test Idol')[0]!)).not.toContain('Creature');
  });
  it('negative: it is only until end of turn', () => {
    let s = resolveAll(cast(setup(), 'Test Idol'), { yes: true });
    s = advanceTo(s, 3, 'upkeep');
    expect(typesOf(s, named(s, 'Test Idol')[0]!)).not.toContain('Creature');
  });
});

describe('CR 205.1b, 301.7, 613.4c: "this Vehicle becomes an artifact creature and gets +1/+1 until end of turn"', () => {
  it('a 3/3 Vehicle is a 4/4 artifact creature until end of turn, keeping its Vehicle subtype', () => {
    let s = resolveAll(cast(scenario([], { p1: { hand: ['Test Wagon'] }, defs: DEFS }), 'Test Wagon'));
    const id = named(s, 'Test Wagon')[0]!;
    expect(typesOf(s, id)).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(pt(s, id)).toBe('4/4');
    expect([...getChars(s, id)!.subtypes]).toContain('Vehicle');
    s = advanceTo(s, 3, 'upkeep');
    expect(typesOf(s, id)).not.toContain('Creature');
  });
});

/** An Aura named `aura` on the battlefield of p1 attached to p1's creature `target`; p2 has `blockers`. */
function enchanted(aura: string, target: string, p2: string[] = []): { s: GameState; id: ObjectId } {
  const s0 = scenario([], { defs: DEFS, p1: { battlefield: [target, 'Test Wall'] }, p2: { battlefield: p2 } }); // a second creature of p1 that can attack, so the attack decision exists
  const id = find(s0, target, 'battlefield', 'p1');
  const s = tweak(s0, (t) => { t.objects[put(t, 'p1', 'battlefield', aura)]!.attachedTo = id; });
  return { s, id };
}
const attackError = (s0: GameState, id: ObjectId): string | undefined => {
  const s = toDeclareAttackers(s0);
  return applyAction(s, reply(s, { kind: 'declareAttackers', attacks: [{ attacker: id, defender: 'p2' }] })).error?.message;
};
/** The error of declaring `blocker` as blocking `blocks`; "no blockers decision" when the defender has no creature that can block at all (the step is skipped). */
function blockError(s0: GameState, attackers: ObjectId[], blocker: ObjectId, blocks: ObjectId[]): string | undefined {
  let s = declareAttackers(toDeclareAttackers(s0), attackers.map((a) => [a] as [ObjectId]));
  for (let i = 0; i < 30 && s.pending?.kind === 'priority' && s.turn.number === s0.turn.number; i++) s = pass(s);
  if (s.pending?.kind !== 'declareBlockers') return 'no blockers decision';
  return applyAction(s, reply(s, { kind: 'declareBlockers', blocks: blocks.map((attacker) => ({ blocker, attacker })) })).error?.message;
}

describe('CR 205.1a, 508.1c, 509.1b: "Enchanted creature is a Spirit and can\'t attack or block."', () => {
  it('a Goblin enchanted: it is a Spirit only (it loses its other creature types), and cannot attack', () => {
    const { s, id } = enchanted('Test Haze', 'Test Goblin');
    expect([...getChars(s, id)!.subtypes]).toEqual(['Spirit']);
    expect(attackError(s, id)).toBeDefined();
  });
  it('it cannot block either', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Villager'] }, p2: { battlefield: ['Test Goblin'] } });
    const blocker = find(s0, 'Test Goblin', 'battlefield', 'p2');
    const attacker = find(s0, 'Test Villager', 'battlefield', 'p1');
    const withAura = tweak(s0, (t) => { t.objects[put(t, 'p2', 'battlefield', 'Test Haze')]!.attachedTo = blocker; });
    expect(blockError(withAura, [attacker], blocker, [attacker])).toBeDefined();
    expect(blockError(s0, [attacker], blocker, [attacker])).toBeUndefined(); // negative: unenchanted
  });
  it('negative: an unenchanted Goblin attacks freely', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Goblin'] } });
    expect(attackError(s0, find(s0, 'Test Goblin', 'battlefield', 'p1'))).toBeUndefined();
  });
});

describe('CR 613.1d-f, 613.4b: Deep Freeze wording', () => {
  it('a red 2/2 flyer becomes a 0/4 blue-and-red Wall (and Goblin kept) with defender and no flying', () => {
    const { s, id } = enchanted('Test Rime', 'Test Flyer');
    const c = getChars(s, id)!;
    expect(pt(s, id)).toBe('0/4');
    expect(hasKeyword(c, 'defender')).toBe(true);
    expect(hasKeyword(c, 'flying')).toBe(false);
    expect([...c.subtypes].sort()).toEqual(['Goblin', 'Wall']);
    expect([...c.colors]).toContain('U');
  });
  it('negative: the unenchanted creature is untouched', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Flyer'] } });
    const id = find(s0, 'Test Flyer', 'battlefield', 'p1');
    expect(pt(s0, id)).toBe('2/2');
    expect(hasKeyword(getChars(s0, id)!, 'flying')).toBe(true);
  });
});

describe('CR 611.3a, 604.1: "gets +2/+2 as long as it\'s a Human. Otherwise, it can\'t attack or block."', () => {
  it('a Human gets +2/+2 and attacks', () => {
    const { s, id } = enchanted('Test Oath', 'Test Villager');
    expect(pt(s, id)).toBe('3/3');
    expect(attackError(s, id)).toBeUndefined();
  });
  it('a Goblin (negative) gets nothing and cannot attack', () => {
    const { s, id } = enchanted('Test Oath', 'Test Goblin');
    expect(pt(s, id)).toBe('1/1');
    expect(attackError(s, id)).toBeDefined();
  });
});

describe('CR 509.1a, 509.1b: "Equipped creature gets +0/+3 and can block an additional creature each combat."', () => {
  it('the equipped creature gets +0/+3 and blocks two attackers; without the Equipment one blocker blocks one', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Goblin', 'Test Villager'] }, p2: { battlefield: ['Test Wall'] } });
    const blocker = find(s0, 'Test Wall', 'battlefield', 'p2');
    const attackers = ['Test Goblin', 'Test Villager'].map((n) => find(s0, n, 'battlefield', 'p1'));
    const equipped = tweak(s0, (t) => { t.objects[put(t, 'p2', 'battlefield', 'Test Buckler')]!.attachedTo = blocker; });
    expect(pt(equipped, blocker)).toBe('0/6');
    expect(blockError(equipped, attackers, blocker, attackers)).toBeUndefined();
    expect(blockError(s0, attackers, blocker, attackers)).toBeDefined();
  });
});

describe('CR 701.21a, 701.8a, 701.19c: sacrifice this enchantment and destroy all creatures (they can\'t be regenerated)', () => {
  const run = (creatures: number): GameState => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Cataclysm'] }, p2: { battlefield: Array(creatures).fill('Test Goblin') as string[] } });
    return resolveAll(advanceTo(s0, 3, 'upkeep'));
  };
  it('four creatures: the enchantment is sacrificed and every creature dies', () => {
    const s = run(4);
    expect(named(s, 'Test Cataclysm')).toEqual([]);
    expect(named(s, 'Test Goblin')).toEqual([]);
  });
  it('negative: three creatures, the ability does not trigger', () => {
    const s = run(3);
    expect(named(s, 'Test Cataclysm').length).toBe(1);
    expect(named(s, 'Test Goblin').length).toBe(3);
  });
});

describe('CR 614.1c, 122.6, 119.3: "enters with X +1/+1 counters on it, where X is the total life lost by your opponents this turn"', () => {
  it('after 3 damage to an opponent the creature enters with 3 counters', () => {
    let s = scenario([], { p1: { hand: ['Test Zap', 'Test Gloom'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Zap', { targets: [player('p2')] }));
    s = resolveAll(cast(s, 'Test Gloom'));
    expect(counters(s, named(s, 'Test Gloom')[0]!, '+1/+1')).toBe(3);
  });
  it('negative: no life lost, no counters; life lost by you does not count', () => {
    let s = scenario([], { p1: { hand: ['Test Gloom'] }, defs: DEFS });
    s = tweak(s, (t) => { t.players.find((p) => p.id === 'p1')!.life = 17; });
    s = resolveAll(cast(s, 'Test Gloom'));
    expect(counters(s, named(s, 'Test Gloom')[0]!, '+1/+1')).toBe(0);
  });
});

describe('CR 614.1c, 122.6: "enters with two +1/+1 counters on it for each other nontoken Human you control"', () => {
  it('two Humans and a Goblin: four counters', () => {
    const s0 = scenario([], { p1: { hand: ['Test Vanguard'], battlefield: ['Test Villager', 'Test Villager', 'Test Goblin'] }, defs: DEFS });
    const s = resolveAll(cast(s0, 'Test Vanguard'));
    expect(counters(s, named(s, 'Test Vanguard')[0]!, '+1/+1')).toBe(4);
  });
  it('negative: no other Human, no counters (the Vanguard itself is not counted); an opponent\'s Human is not counted', () => {
    const s0 = scenario([], { p1: { hand: ['Test Vanguard'], battlefield: ['Test Goblin'] }, p2: { battlefield: ['Test Villager'] }, defs: DEFS });
    const s = resolveAll(cast(s0, 'Test Vanguard'));
    expect(counters(s, named(s, 'Test Vanguard')[0]!, '+1/+1')).toBe(0);
  });
});

describe('CR 700.4, 205.3m: "draw a card for each Zubera that died this turn"', () => {
  it('two Zubera die together: the first one\'s trigger draws two cards', () => {
    const s0 = scenario([], { p1: { hand: ['Test Sweep'], battlefield: ['Test Dream Zub', 'Test Plain Zub', 'Test Goblin'] }, defs: DEFS });
    const before = handSize(s0, 'p1');
    const s = resolveAll(cast(s0, 'Test Sweep'));
    expect(handSize(s, 'p1')).toBe(before - 1 + 2);
  });
  it('negative: a Goblin dying beside it does not count', () => {
    const s0 = scenario([], { p1: { hand: ['Test Sweep'], battlefield: ['Test Dream Zub', 'Test Goblin', 'Test Goblin'] }, defs: DEFS });
    const before = handSize(s0, 'p1');
    const s = resolveAll(cast(s0, 'Test Sweep'));
    expect(handSize(s, 'p1')).toBe(before - 1 + 1);
  });
});

describe('CR 608.2c, 109.4, 400.7: "Destroy target land, then ~ deals damage to that land\'s controller equal to the number of land cards in that player\'s graveyard."', () => {
  it('the destroyed land is already in the graveyard: 2 lands there plus it = 3 damage to its controller only', () => {
    const s0 = scenario(['Forest'], { p1: { hand: ['Test Quake'] }, p2: { battlefield: ['Forest'], graveyard: ['Forest', 'Forest', 'Test Goblin'] }, defs: DEFS });
    const s = resolveAll(cast(s0, 'Test Quake', { targets: [obj(find(s0, 'Forest', 'battlefield', 'p2'))] }));
    expect(life(s, 'p2')).toBe(17);
    expect(life(s, 'p1')).toBe(20);
  });
  it('negative: targeting your own land, you are the one hurt', () => {
    const s0 = scenario(['Forest'], { p1: { hand: ['Test Quake'], battlefield: ['Forest'], graveyard: ['Forest'] }, defs: DEFS });
    const s = resolveAll(cast(s0, 'Test Quake', { targets: [obj(find(s0, 'Forest', 'battlefield', 'p1'))] }));
    expect(life(s, 'p1')).toBe(18);
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 406.1, 108.3: "Return target exiled card with flashback you own to your hand."', () => {
  const setup = (): GameState => scenario([], { p1: { hand: ['Test Recall'], exile: ['Test Echo Spell', 'Test Plain Spell'] }, p2: { exile: ['Test Echo Spell'] }, defs: DEFS });
  it('the card you own that has flashback returns to your hand', () => {
    const s0 = setup();
    const s = resolveAll(cast(s0, 'Test Recall', { targets: [obj(find(s0, 'Test Echo Spell', 'exile', 'p1'))] }));
    expect(s.zones.hand['p1']!.some((id) => s.objects[id]!.defId === 'Test Echo Spell')).toBe(true);
  });
  it('negative: a card without flashback, or one an opponent owns, is not a legal target', () => {
    const s0 = setup();
    for (const [name, owner] of [['Test Plain Spell', 'p1'], ['Test Echo Spell', 'p2']] as const) {
      const s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Recall', 'hand', 'p1') });
      const bad = applyAction(s, reply(s, { kind: 'chooseTargets', targets: [obj(find(s0, name, 'exile', owner))] }));
      expect(bad.error, `${name} of ${owner}`).toBeDefined();
    }
  });
});
