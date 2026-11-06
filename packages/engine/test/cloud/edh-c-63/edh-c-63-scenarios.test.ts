/**
 * Commander effort (coordinator C), round edh-c-63: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 * Alice (p1) is the active player. CR cites are checked against the Comprehensive Rules text of 2026-09-25.
 *
 *   CR 400.3, 603.6c, 603.10a      "Whenever a permanent is returned to your hand, you may pay {1}. If you do, draw a card" (Azorius Aethermage)
 *   CR 400.3, 603.6c, 701.9a       "Whenever a permanent is returned to a player's hand, that player discards a card" (Warped Devotion)
 *   CR 404.1, 700.4, 119.3         "Whenever a nontoken permanent is put into a player's graveyard from the battlefield, that player loses 1 life" (Liability)
 *   CR 107.14, 122.1, 603.2c       "Whenever you get one or more {E}, this creature gets +2/+2 until end of turn" (Territorial Gorger)
 *   CR 118.12, 119.4, 701.6a       "Counter target spell unless its controller pays {1} and 1 life" (Mundungu)
 *   CR 509.1b, 101.2, 611.2a       "Target creature can't be blocked this turn except by artifact creatures and/or red creatures" (Firefright Mage)
 *   CR 608.2d, 611.2c, 702.1       "~ and up to one other target creature you control both gain your choice of first strike or lifelink" (Ballroom Brawlers)
 *   CR 604.1, 702.3b, 509.1b       "As long as an opponent has eight or more cards in their graveyard, ~ can attack as though it didn't have defender and it can't be blocked" (Expedition Lookout)
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, find, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, tweak, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';
import { advanceTo } from '../../m5/helpers';
import { synthetic } from '../../m6/costs/support';
import { cast, full, pt, resolveAll, settle } from '../cmd3/helpers';

const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const onField = (s: GameState, name: string, player?: string): ObjectId | undefined => s.zones.battlefield.find((id) => nameOf(s, id) === name && (player === undefined || s.objects[id]!.controller === player));
const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const handSize = (s: GameState, p: string): number => (s.zones.hand[p] ?? []).length;
const target = (id: ObjectId) => ({ kind: 'object' as const, id });

const GRUNT = synthetic('Test Grunt', 'Creature — Goblin', '{0}', '', { power: '2', toughness: '2' });
const BOUNCE = synthetic('Test Recall', 'Instant', '{0}', "Return target permanent to its owner's hand.");
const SMITE = synthetic('Test Smite', 'Instant', '{0}', 'Destroy target permanent.');
const TOKENS = synthetic('Test Muster', 'Instant', '{0}', 'Create a 1/1 white Warrior creature token.');

// ---- Azorius Aethermage: "Whenever a permanent is returned to your hand, you may pay {1}. If you do, draw a card." -----------------------------------------------------
const ECHO = synthetic('Test Echo Mage', 'Creature — Human Wizard', '{0}', 'Whenever a permanent is returned to your hand, you may pay {1}. If you do, draw a card.', { power: '1', toughness: '1' });

describe('CR 400.3, 603.6c: "Whenever a permanent is returned to your hand, you may pay {1}. If you do, draw a card"', () => {
  const play = (owner: 'p1' | 'p2', yes: boolean): GameState => {
    const s = scenario(['Forest'], { defs: [ECHO, GRUNT, BOUNCE], p1: { hand: ['Test Recall'], battlefield: ['Test Echo Mage', 'Forest', ...(owner === 'p1' ? ['Test Grunt'] : [])] }, p2: { battlefield: owner === 'p2' ? ['Test Grunt'] : [] } });
    expect(full(ECHO)).toBe(true);
    return resolveAll(cast(s, 'Test Recall', { targets: [target(onField(s, 'Test Grunt')!)], yes }), { yes });
  };
  it('a permanent of yours returned to your hand lets you pay {1} and draw a card', () => {
    const s = play('p1', true);
    expect(handSize(s, 'p1')).toBe(2); // the returned creature and the card drawn
  });
  it('declining the payment draws nothing', () => {
    expect(handSize(play('p1', false), 'p1')).toBe(1);
  });
  it('the negative case: a permanent returned to an opponent\'s hand does not trigger it (the hand is the owner\'s, CR 400.3)', () => {
    const s = play('p2', true);
    expect(handSize(s, 'p1')).toBe(0);
    expect(handSize(s, 'p2')).toBe(1);
  });
});

// ---- Warped Devotion: "Whenever a permanent is returned to a player's hand, that player discards a card." -----------------------------------------------------------
const PALL = synthetic('Test Pall', 'Enchantment', '{0}', "Whenever a permanent is returned to a player's hand, that player discards a card.");

describe('CR 400.3, 603.6c, 701.9a: "Whenever a permanent is returned to a player\'s hand, that player discards a card"', () => {
  it('the owner of a creature returned to its owner\'s hand discards a card (the opponent\'s, not yours)', () => {
    const s0 = scenario(['Forest'], { defs: [PALL, GRUNT, BOUNCE], p1: { hand: ['Test Recall', 'Forest'], battlefield: ['Test Pall'] }, p2: { hand: ['Forest'], battlefield: ['Test Grunt'] } });
    expect(full(PALL)).toBe(true);
    const s = resolveAll(cast(s0, 'Test Recall', { targets: [target(onField(s0, 'Test Grunt')!)] }));
    expect(handSize(s, 'p2')).toBe(1); // the creature and the land, one of them discarded
    expect(handSize(s, 'p1')).toBe(1); // untouched (the Forest; the spell has left the hand)
  });
  it('it can trigger on itself being returned to a hand (ruling 2004-10-04)', () => {
    const s0 = scenario(['Forest'], { defs: [PALL, BOUNCE], p1: { hand: ['Test Recall', 'Forest'], battlefield: ['Test Pall'] } });
    const s = resolveAll(cast(s0, 'Test Recall', { targets: [target(onField(s0, 'Test Pall')!)] }));
    expect(handSize(s, 'p1')).toBe(1); // Forest and Test Pall, one discarded
  });
  it('the negative case: a creature that dies is put into a graveyard, not a hand, and nobody discards', () => {
    const s0 = scenario(['Forest'], { defs: [PALL, GRUNT, SMITE], p1: { hand: ['Test Smite', 'Forest'], battlefield: ['Test Pall'] }, p2: { hand: ['Forest'], battlefield: ['Test Grunt'] } });
    const s = resolveAll(cast(s0, 'Test Smite', { targets: [target(onField(s0, 'Test Grunt')!)] }));
    expect(handSize(s, 'p2')).toBe(1);
    expect(handSize(s, 'p1')).toBe(1);
  });
});

// ---- Liability: "Whenever a nontoken permanent is put into a player's graveyard from the battlefield, that player loses 1 life." ---------------------------------------
const LEDGER = synthetic('Test Ledger', 'Enchantment', '{0}', "Whenever a nontoken permanent is put into a player's graveyard from the battlefield, that player loses 1 life.");

describe('CR 404.1, 700.4, 119.3: "Whenever a nontoken permanent is put into a player\'s graveyard from the battlefield, that player loses 1 life"', () => {
  it('the owner of a nontoken permanent that dies loses 1 life', () => {
    const s0 = scenario([], { defs: [LEDGER, GRUNT, SMITE], p1: { hand: ['Test Smite'], battlefield: ['Test Ledger'] }, p2: { battlefield: ['Test Grunt'] } });
    expect(full(LEDGER)).toBe(true);
    const s = resolveAll(cast(s0, 'Test Smite', { targets: [target(onField(s0, 'Test Grunt')!)] }));
    expect(life(s, 'p2')).toBe(19);
    expect(life(s, 'p1')).toBe(20);
  });
  it('the owner loses the life, not the controller: a permanent p1 controls but p2 owns', () => {
    const s0 = scenario([], { defs: [LEDGER, GRUNT, SMITE], p1: { hand: ['Test Smite'], battlefield: ['Test Ledger'] }, p2: { battlefield: ['Test Grunt'] } });
    const id = onField(s0, 'Test Grunt')!;
    const s1 = tweak(s0, (x) => { x.objects[id]!.controller = 'p1'; });
    const s = resolveAll(cast(s1, 'Test Smite', { targets: [target(id)] }));
    expect(life(s, 'p2')).toBe(19);
    expect(life(s, 'p1')).toBe(20);
  });
  it('the negative case: a token put into a graveyard (it ceases to exist there) does not make its owner lose life', () => {
    const s0 = scenario([], { defs: [LEDGER, SMITE, TOKENS], p1: { hand: ['Test Muster', 'Test Smite'], battlefield: ['Test Ledger'] } });
    const s1 = resolveAll(cast(s0, 'Test Muster'));
    const token = s1.zones.battlefield.find((id) => s1.objects[id]!.kind === 'token')!;
    const s = resolveAll(cast(s1, 'Test Smite', { targets: [target(token)] }));
    expect(life(s, 'p1')).toBe(20);
  });
});

// ---- Territorial Gorger: "Whenever you get one or more {E}, this creature gets +2/+2 until end of turn." --------------------------------------------------------------
const GORGER = synthetic('Test Gorger', 'Creature — Gremlin', '{0}', 'Trample\nWhenever you get one or more {E}, this creature gets +2/+2 until end of turn.', { power: '2', toughness: '2' });
const CHARGE = synthetic('Test Charge', 'Instant', '{0}', 'You get {E}{E}.');
const SPARK = synthetic('Test Spark', 'Instant', '{0}', 'Target opponent gets {E}.');

describe('CR 107.14, 122.1, 603.2c: "Whenever you get one or more {E}, this creature gets +2/+2 until end of turn"', () => {
  it('getting two energy counters at once is one trigger: +2/+2 once, not +4/+4 (ruling 2016-09-20)', () => {
    const s0 = scenario([], { defs: [GORGER, CHARGE], p1: { hand: ['Test Charge'], battlefield: ['Test Gorger'] } });
    expect(full(GORGER)).toBe(true);
    expect(pt(s0, onField(s0, 'Test Gorger')!)).toBe('2/2');
    const s = resolveAll(cast(s0, 'Test Charge'));
    expect(s.players.find((p) => p.id === 'p1')!.counters['energy']).toBe(2);
    expect(pt(s, onField(s, 'Test Gorger')!)).toBe('4/4');
  });
  it('the negative case: an opponent getting energy does not trigger it', () => {
    const s0 = scenario([], { defs: [GORGER, SPARK], p1: { hand: ['Test Spark'], battlefield: ['Test Gorger'] } });
    const s = resolveAll(cast(s0, 'Test Spark', { targets: [{ kind: 'player', id: 'p2' }] }));
    expect(pt(s, onField(s, 'Test Gorger')!)).toBe('2/2');
  });
});

// ---- Mundungu: "{T}: Counter target spell unless its controller pays {1} and 1 life." ---------------------------------------------------------------------------------
const HEX = synthetic('Test Hex Mage', 'Creature — Human Wizard', '{0}', '{T}: Counter target spell unless its controller pays {1} and 1 life.', { power: '1', toughness: '1' });
const IDEA = synthetic('Test Idea', 'Sorcery', '{0}', 'Draw a card.');

describe('CR 118.12, 119.4: "Counter target spell unless its controller pays {1} and 1 life"', () => {
  const play = (lands: number, yes: boolean): GameState => {
    const s0 = scenario(['Forest'], { defs: [HEX, IDEA], p1: { hand: ['Test Idea'], battlefield: ['Test Hex Mage', ...Array.from({ length: lands }, () => 'Forest')] } });
    expect(full(HEX)).toBe(true);
    const s1 = cast(s0, 'Test Idea');
    const spell = s1.zones.stack[s1.zones.stack.length - 1]!;
    const s2 = settle(act(s1, { type: 'activate', player: 'p1', source: find(s1, 'Test Hex Mage', 'battlefield', 'p1'), ability: 'p:0:0' }), { targets: [target(spell)], yes });
    return resolveAll(s2, { yes });
  };
  it('the spell\'s controller pays {1} and 1 life: the spell is not countered (it draws its card) and they lost 1 life', () => {
    const s = play(1, true);
    expect(handSize(s, 'p1')).toBe(1);
    expect(life(s, 'p1')).toBe(19);
  });
  it('the negative case: unable to pay the {1} (no land), the spell is countered, no life is paid', () => {
    const s = play(0, true);
    expect(handSize(s, 'p1')).toBe(0);
    expect(life(s, 'p1')).toBe(20);
  });
  it('the negative case: declining to pay counters the spell and costs no life', () => {
    const s = play(1, false);
    expect(handSize(s, 'p1')).toBe(0);
    expect(life(s, 'p1')).toBe(20);
  });
});

// ---- Firefright Mage: "Target creature can't be blocked this turn except by artifact creatures and/or red creatures." -----------------------------------------------
const MAGE = synthetic('Test Spark Adept', 'Creature — Goblin Spellshaper', '{R}', '{1}{R}, {T}, Discard a card: Target creature can\'t be blocked this turn except by artifact creatures and/or red creatures.', { power: '1', toughness: '1', colors: ['R'] });
const REDLING = synthetic('Test Redling', 'Creature — Goblin', '{R}', '', { power: '1', toughness: '1', colors: ['R'] });
const GOLEM = synthetic('Test Golem', 'Artifact Creature — Golem', '{2}', '', { power: '1', toughness: '1' });

describe('CR 509.1b, 101.2: "Target creature can\'t be blocked this turn except by artifact creatures and/or red creatures"', () => {
  const setup = (): { s: GameState; attacker: ObjectId; plain: ObjectId; red: ObjectId; golem: ObjectId } => {
    const s0 = scenario(['Mountain', 'Forest'], { defs: [MAGE, GRUNT, REDLING, GOLEM], p1: { hand: ['Forest'], battlefield: ['Test Spark Adept', 'Test Grunt', 'Mountain', 'Mountain'] }, p2: { battlefield: ['Test Grunt', 'Test Redling', 'Test Golem'] } });
    expect(full(MAGE)).toBe(true);
    const attacker = onField(s0, 'Test Grunt', 'p1')!;
    const s1 = resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Spark Adept', 'battlefield', 'p1'), ability: 'p:0:0' }), { targets: [target(attacker)] }));
    const s2 = toDeclareBlockers(declareAttackers(toDeclareAttackers(s1), [[attacker]]));
    return { s: s2, attacker, plain: onField(s2, 'Test Grunt', 'p2')!, red: onField(s2, 'Test Redling')!, golem: onField(s2, 'Test Golem')! };
  };
  it('a red creature and an artifact creature may block it', () => {
    const a = setup();
    expect(() => declareBlockers(a.s, [[a.red, a.attacker]])).not.toThrow();
    const b = setup();
    expect(() => declareBlockers(b.s, [[b.golem, b.attacker]])).not.toThrow();
  });
  it('the negative case: a creature that is neither red nor an artifact can\'t block it', () => {
    const a = setup();
    expect(() => declareBlockers(a.s, [[a.plain, a.attacker]])).toThrow(/CR 509/);
  });
});

// ---- Ballroom Brawlers: "~ and up to one other target creature you control both gain your choice of first strike or lifelink until end of turn." ---------------------
const BRAWLER = synthetic('Test Brawler', 'Creature — Human Warrior', '{0}', 'Whenever this creature attacks, this creature and up to one other target creature you control both gain your choice of first strike or lifelink until end of turn.', { power: '2', toughness: '2' });

describe('CR 608.2d, 611.2c, 702.1: "~ and up to one other target creature you control both gain your choice of first strike or lifelink until end of turn"', () => {
  const play = (option: '0' | '1', withTarget: boolean): { s: GameState; brawler: ObjectId; friend: ObjectId; foe: ObjectId } => {
    const s0 = scenario([], { defs: [BRAWLER, GRUNT], p1: { battlefield: ['Test Brawler', 'Test Grunt'] }, p2: { battlefield: ['Test Grunt'] } });
    expect(full(BRAWLER)).toBe(true);
    const brawler = onField(s0, 'Test Brawler')!;
    const friend = onField(s0, 'Test Grunt', 'p1')!;
    const s1 = declareAttackers(toDeclareAttackers(s0), [[brawler]]);
    const s = resolveAll(settle(s1, { targets: withTarget ? [target(friend)] : [], option }), { option });
    return { s, brawler, friend, foe: onField(s0, 'Test Grunt', 'p2')! };
  };
  it('both ~ and the other target gain the one keyword chosen (option 0: first strike)', () => {
    const r = play('0', true);
    expect(hasKeyword(getChars(r.s, r.brawler)!, 'first strike')).toBe(true);
    expect(hasKeyword(getChars(r.s, r.friend)!, 'first strike')).toBe(true);
    expect(hasKeyword(getChars(r.s, r.brawler)!, 'lifelink')).toBe(false);
  });
  it('the other choice (option 1) is lifelink: both gain lifelink and neither gains first strike', () => {
    const r = play('1', true);
    expect(hasKeyword(getChars(r.s, r.brawler)!, 'lifelink')).toBe(true);
    expect(hasKeyword(getChars(r.s, r.friend)!, 'lifelink')).toBe(true);
    expect(hasKeyword(getChars(r.s, r.friend)!, 'first strike')).toBe(false);
  });
  it('the negative case: with no other target chosen (up to one), only ~ gains it; an opposing creature never does', () => {
    const r = play('0', false);
    expect(hasKeyword(getChars(r.s, r.brawler)!, 'first strike')).toBe(true);
    expect(hasKeyword(getChars(r.s, r.friend)!, 'first strike')).toBe(false);
    expect(hasKeyword(getChars(r.s, r.foe)!, 'first strike')).toBe(false);
  });
});

// ---- Expedition Lookout: defender; "As long as an opponent has eight or more cards in their graveyard, ~ can attack as though it didn't have defender and it can't be blocked." -----
const LOOKOUT = synthetic('Test Lookout', 'Creature — Merfolk Rogue', '{1}{U}', 'Defender\nAs long as an opponent has eight or more cards in their graveyard, this creature can attack as though it didn\'t have defender and it can\'t be blocked.', { power: '1', toughness: '2' });

describe('CR 604.1, 702.3b, 509.1b: "As long as an opponent has eight or more cards in their graveyard, ~ can attack as though it didn\'t have defender and it can\'t be blocked"', () => {
  const play = (yard: number): GameState => {
    const s0 = scenario(['Forest'], { defs: [LOOKOUT, GRUNT], p1: { battlefield: ['Test Lookout'] }, p2: { battlefield: ['Test Grunt'], graveyard: Array.from({ length: yard }, () => 'Forest') } });
    expect(full(LOOKOUT)).toBe(true);
    return s0;
  };
  it('with eight cards in an opponent\'s graveyard it can attack, and nothing can block it', () => {
    const s0 = play(8);
    const lookout = onField(s0, 'Test Lookout')!;
    const s = passUntil(declareAttackers(toDeclareAttackers(s0), [[lookout]]), (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'endCombat', 'blockers or the end of combat', 20);
    expect(s.pending?.kind).not.toBe('declareBlockers'); // no creature can be declared as a blocker, so the defending player is not asked
    expect(life(s, 'p2')).toBe(19);
  });
  it('the negative case: with seven cards it still has defender and can\'t attack', () => {
    const s0 = play(7);
    const lookout = onField(s0, 'Test Lookout')!;
    expect(() => declareAttackers(toDeclareAttackers(s0), [[lookout]])).toThrow(/CR 508/);
  });
});
