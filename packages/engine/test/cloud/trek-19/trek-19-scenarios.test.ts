/**
 * trek-19 (lane trek, Star Trek cards): the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 * Nothing is mocked. Each test is named after the rule it checks, with its negative case. CR cites are from the Comprehensive Rules of 2026-09-25
 * (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt) where the round checked them; the Star Trek mechanics of the cards (station) have no rule text
 * yet and are not used here.
 *
 *   CR 205.3m, 613.4c, 611.3a  "Other Officers, Pilots, and Spacecraft creatures you control get +2/+2": the creatures with any of the types, not the source, not an opponent's
 *   CR 205.1a, 613.4c, 509.1b  "Enchanted creature gets -4/-0, can't block, and is a Frog": the creature types are replaced by the one, the card types stay; it can't block
 *   CR 201.5a, 113.1c, 613.1f  "If Test Cadet is a Rogue, he becomes a Ferengi Scout ... and gains "Whenever Test Cadet becomes tapped, surveil 2."": the card's own name in the quote is the card itself
 *   CR 603.2, 602.2, 605.3b    "Whenever an opponent casts a spell with the chosen name or activates an ability of a source with the chosen name, that player loses 3 life": a spell, an ability,
 *                              a mana ability; not your own, not another name
 *   CR 106.6, 903.3            "Add one mana of a chosen color for each charge counter. Spend this mana only to cast your commander."
 *   CR 608.2c, 122.1           "Then discard a card unless ~ has three or more quest counters on it"
 *   CR 608.2f, 101.4           "For each opponent, you create a 2/1 token" (three opponents: three tokens)
 */
import { describe, expect, it } from 'vitest';
import type { DecisionAnswer, GameState, ObjectId } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, legal, life, pass, scenario } from '../../m3/scenario';
import { attackWith, card, counters, full, pt, settle } from '../cmd3/helpers';
import { activate } from '../../m5/cr-examples/helpers';
import { commanderScenario, inCommand, legend } from '../../m11/rules/helpers';
import { drive as mpDrive, mpScenario, passUntil as mpPassUntil, resolveStack as mpResolve } from '../../m12/rules/helpers';
import { card as cardM11 } from '../../m11/rules/helpers';
import { getChars } from '../../../src/rules/characteristics';

/** Answer a name choice with `name`, everything else with the defaults, until the stack is empty. */
function drain(s0: GameState, extra: { name?: string; color?: string } = {}): GameState {
  let s = s0;
  for (let i = 0; i < 80; i++) {
    const d = s.pending;
    if (d?.kind === 'chooseName') s = answer(s, { kind: 'chooseName', name: extra.name! } as DecisionAnswer);
    else if (d?.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: extra.color! } as DecisionAnswer);
    else if (d && d.kind !== 'priority') s = settle(s);
    else if (s.zones.stack.length > 0) s = pass(s);
    else break;
  }
  return s;
}
const subtypesOf = (s: GameState, id: ObjectId): string[] => [...getChars(s, id)!.subtypes];

// ---- Kirk, Man of Action ----------------------------------------------------------------------------------------------------------------------------------
const CAPTAIN = card('Test Captain', 'Legendary Creature — Human Officer', 'Other Officers, Pilots, and Spacecraft creatures you control get +2/+2.', ['2', '2']);
const PILOT = card('Test Pilot', 'Creature — Human Pilot', '', ['1', '1']);
const OFFICER = card('Test Officer', 'Creature — Vulcan Officer', '', ['1', '2']);
const SHIP = card('Test Ship', 'Artifact — Spacecraft', 'Flying', ['3', '3']);
const COOK = card('Test Cook', 'Creature — Human Cook', '', ['1', '1']);

describe('CR 205.3m, 613.4c, 611.3a: "Other Officers, Pilots, and Spacecraft creatures you control get +2/+2."', () => {
  it('is automated with no manual part', () => {
    expect(full(CAPTAIN), JSON.stringify(CAPTAIN.automation)).toBe(true);
  });
  it('a Pilot and an Officer of yours get +2/+2, a Cook does not, the source (an Officer itself) does not, and an opponent\'s Pilot does not', () => {
    const s = scenario([], { defs: [CAPTAIN, PILOT, OFFICER, COOK, SHIP], p1: { battlefield: ['Test Captain', 'Test Pilot', 'Test Officer', 'Test Cook'] }, p2: { battlefield: ['Test Pilot'] } });
    expect(pt(s, find(s, 'Test Pilot', 'battlefield', 'p1'))).toBe('3/3');
    expect(pt(s, find(s, 'Test Officer', 'battlefield', 'p1'))).toBe('3/4');
    expect(pt(s, find(s, 'Test Cook', 'battlefield', 'p1'))).toBe('1/1');
    expect(pt(s, find(s, 'Test Captain', 'battlefield', 'p1'))).toBe('2/2');
    expect(pt(s, find(s, 'Test Pilot', 'battlefield', 'p2'))).toBe('1/1');
  });
  it('the type Spacecraft counts only for a creature: a Spacecraft artifact that is not a creature is untouched (it needs the type creature, and its own 3/3 stays)', () => {
    const s = scenario([], { defs: [CAPTAIN, SHIP], p1: { battlefield: ['Test Captain', 'Test Ship'] } });
    expect(pt(s, find(s, 'Test Ship', 'battlefield', 'p1'))).toBe('3/3');
  });
});

// ---- De-evolve ----------------------------------------------------------------------------------------------------------------------------------------------
const DEVOLVE = card('Test Devolve', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets -4/-0, can\'t block, and is a Frog.');
const GOLEM = card('Test Golem', 'Artifact Creature — Golem Warrior', '', ['5', '4']);
const BRUTE = card('Test Brute', 'Creature — Ogre', '', ['3', '3']);

describe('CR 205.1a, 613.4c, 509.1b: "Enchanted creature gets -4/-0, can\'t block, and is a Frog."', () => {
  it('is automated with no manual part', () => {
    expect(full(DEVOLVE), JSON.stringify(DEVOLVE.automation)).toBe(true);
  });
  it('the enchanted artifact creature is a Frog only (its creature types are replaced, its card types stay) with power 5-4=1, and the other creature is untouched', () => {
    let s = scenario([], { defs: [DEVOLVE, GOLEM, BRUTE], p1: { hand: ['Test Devolve'], battlefield: ['Test Golem', 'Test Brute'] } });
    s = cast(s, 'Test Devolve', find(s, 'Test Golem', 'battlefield', 'p1'));
    const golem = find(s, 'Test Golem', 'battlefield', 'p1');
    expect(pt(s, golem)).toBe('1/4');
    expect(subtypesOf(s, golem)).toEqual(['Frog']);
    expect([...getChars(s, golem)!.types].sort()).toEqual(['Artifact', 'Creature']);
    expect(pt(s, find(s, 'Test Brute', 'battlefield', 'p1'))).toBe('3/3');
    expect(subtypesOf(s, find(s, 'Test Brute', 'battlefield', 'p1'))).toEqual(['Ogre']);
  });
});

describe('CR 509.1b: "Enchanted creature ... can\'t block" played in combat', () => {
  it('the enchanted creature of the defending player is not offered as a blocker, its neighbour is; without the Aura it is', () => {
    const blockers = (withAura: boolean): string[] => {
      let s = scenario([], { defs: [DEVOLVE, GOLEM, BRUTE], p1: { hand: ['Test Devolve'], battlefield: ['Test Brute'] }, p2: { battlefield: ['Test Golem', 'Test Brute'] } });
      if (withAura) s = cast(s, 'Test Devolve', find(s, 'Test Golem', 'battlefield', 'p2'));
      s = attackWith(s, [find(s, 'Test Brute', 'battlefield', 'p1')]);
      for (let i = 0; i < 12 && s.pending?.kind !== 'declareBlockers'; i++) s = s.pending && s.pending.kind !== 'priority' ? settle(s) : pass(s);
      expect(s.pending?.kind).toBe('declareBlockers');
      const options = JSON.stringify(s.pending);
      return ['Test Golem', 'Test Brute'].filter((n) => options.includes(find(s, n, 'battlefield', 'p2')));
    };
    expect(blockers(false)).toEqual(['Test Golem', 'Test Brute']);
    expect(blockers(true)).toEqual(['Test Brute']);
  });
});

/** Cast an Aura on a creature (the target) and resolve it. */
function cast(s0: GameState, name: string, target: ObjectId): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  for (let i = 0; i < 20 && s.pending && s.pending.kind !== 'priority'; i++) {
    const d = s.pending;
    s = d.kind === 'chooseTargets' ? answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: target }] }) : settle(s);
  }
  for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = settle(pass(s));
  return s;
}

// ---- Nog, Ambitious Cadet ---------------------------------------------------------------------------------------------------------------------------------
const CADET = card('Test Cadet, Bold', 'Legendary Creature — Ferengi Rogue', '{1}: If Test Cadet is a Rogue, he becomes a Ferengi Scout with base power and toughness 3/4 and gains "Whenever Test Cadet becomes tapped, surveil 2."', ['1', '1']);
const SCOUT = card('Test Scout, Bold', 'Legendary Creature — Ferengi Scout', '{1}: If Test Scout is a Rogue, he becomes a Ferengi Scout with base power and toughness 3/4 and gains "Whenever Test Scout becomes tapped, surveil 2."', ['1', '1']);

describe('CR 201.5a, 113.1c, 608.2c: "{1}: If Test Cadet is a Rogue, he becomes a Ferengi Scout with base power and toughness 3/4 and gains "Whenever Test Cadet becomes tapped, surveil 2.""', () => {
  it('is automated with no manual part', () => {
    expect(full(CADET), JSON.stringify(CADET.automation)).toBe(true);
  });
  it('the Rogue becomes a 3/4 Ferengi Scout (the types are replaced) and, once it attacks (becomes tapped), its own trigger surveils 2; before the change it does not', () => {
    let s = scenario([], { defs: [CADET], p1: { battlefield: ['Test Cadet, Bold', 'Plains', 'Plains'] } });
    const cadet = find(s, 'Test Cadet, Bold', 'battlefield', 'p1');
    expect(getChars(s, cadet)!.abilities.some((a) => a.origin === 'granted')).toBe(false);
    s = settle(activate(s, cadet));
    for (let i = 0; i < 4 && s.zones.stack.length > 0; i++) s = settle(pass(s));
    expect(pt(s, cadet)).toBe('3/4');
    expect(subtypesOf(s, cadet)).toEqual(['Ferengi', 'Scout']);
    expect(getChars(s, cadet)!.abilities.filter((a) => a.origin === 'granted').length).toBe(1);
    const top = s.zones.library.p1!.slice(0, 2).map((id) => s.objects[id]!.defId);
    s = attackWith(s, [cadet]);
    for (let i = 0; i < 12 && !(s.pending?.kind === 'chooseObjects' || s.pending?.kind === 'order' || s.pending?.kind === 'chooseOption' || s.pending?.kind === 'yesNo'); i++) s = s.pending && s.pending.kind !== 'priority' ? settle(s) : pass(s);
    expect(s.pending, JSON.stringify(s.log.slice(-4))).toBeTruthy();
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1', max: 2, prompt: expect.stringContaining('Surveil 2') });
    expect((s.pending as unknown as { options: ObjectId[] }).options.map((id) => s.objects[id]!.defId)).toEqual(top);
  });
  it('a Cadet that is not a Rogue is left as it is: {1} does nothing (no change of types, no granted ability, power and toughness stay 1/1)', () => {
    let s = scenario([], { defs: [SCOUT], p1: { battlefield: ['Test Scout, Bold', 'Plains'] } });
    const scout = find(s, 'Test Scout, Bold', 'battlefield', 'p1');
    s = settle(activate(s, scout));
    for (let i = 0; i < 4 && s.zones.stack.length > 0; i++) s = settle(pass(s));
    expect(pt(s, scout)).toBe('1/1');
    expect(getChars(s, scout)!.abilities.some((a) => a.origin === 'granted')).toBe(false);
  });
});

// ---- Kai Winn, Faithless Leader ---------------------------------------------------------------------------------------------------------------------------
const BISHOP = card('Test Bishop', 'Legendary Creature — Bajoran Cleric', 'As Test Bishop enters, choose a nonland card name.\nWhenever an opponent casts a spell with the chosen name or activates an ability of a source with the chosen name, that player loses 3 life.', ['2', '2']);
const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.');
const GADGET = card('Test Gadget', 'Artifact', '{0}: You gain 1 life.');
const ROCK = card('Test Rock', 'Artifact', '{T}: Add {C}.');
const TRINKET = card('Test Trinket', 'Artifact', '{0}: You gain 1 life.');
const NAMED_DEFS = [BISHOP, SPARK, GADGET, ROCK, TRINKET];

describe('CR 603.2, 602.2, 605.3b, 607.2d: "Whenever an opponent casts a spell with the chosen name or activates an ability of a source with the chosen name, that player loses 3 life."', () => {
  /** Test Bishop enters in turn 1 naming `name`; then it is Bob's turn 2 with these cards. */
  const onBobsTurn = (name: string): GameState => {
    let s = scenario([], { defs: NAMED_DEFS, p1: { hand: ['Test Bishop', 'Test Spark'], battlefield: ['Test Gadget'] }, p2: { hand: ['Test Spark'], battlefield: ['Test Gadget', 'Test Rock', 'Test Trinket'] } });
    s = drain(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bishop', 'hand', 'p1') }), { name });
    return advanceTo(s, 2, 'main1');
  };
  it('is automated with no manual part', () => {
    expect(full(BISHOP), JSON.stringify(BISHOP.automation)).toBe(true);
  });
  it('an opponent casts a spell with the chosen name: that player (not the Bishop\'s controller) loses 3 life', () => {
    let s = onBobsTurn('Test Spark');
    const before = [life(s, 'p1'), life(s, 'p2')];
    s = drain(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Spark', 'hand', 'p2') }));
    expect([life(s, 'p1') - before[0]!, life(s, 'p2') - before[1]!]).toEqual([0, -3 + 1]);
  });
  it('an opponent activates a non-mana ability of a source with the chosen name: 3 life lost; another source\'s ability does nothing', () => {
    let s = onBobsTurn('Test Gadget');
    const bob = life(s, 'p2');
    s = drain(act(s, { type: 'activate', player: 'p2', source: find(s, 'Test Gadget', 'battlefield', 'p2'), ability: 'p:0:0' }));
    expect(life(s, 'p2') - bob).toBe(-3 + 1);
    s = drain(act(s, { type: 'activate', player: 'p2', source: find(s, 'Test Trinket', 'battlefield', 'p2'), ability: 'p:0:0' }));
    expect(life(s, 'p2') - bob).toBe(-3 + 2);
  });
  it('an opponent activates a MANA ability of a source with the chosen name: 3 life lost too (a mana ability is an activated ability)', () => {
    let s = onBobsTurn('Test Rock');
    const bob = life(s, 'p2');
    s = drain(act(s, { type: 'activate', player: 'p2', source: find(s, 'Test Rock', 'battlefield', 'p2'), ability: 'p:0:0' }));
    expect(life(s, 'p2') - bob).toBe(-3);
  });
  it('another name chosen: casting Test Spark and activating the Gadget cost nothing', () => {
    let s = onBobsTurn('Test Rock');
    const bob = life(s, 'p2');
    s = drain(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Spark', 'hand', 'p2') }));
    s = drain(act(s, { type: 'activate', player: 'p2', source: find(s, 'Test Gadget', 'battlefield', 'p2'), ability: 'p:0:0' }));
    expect(life(s, 'p2') - bob).toBe(2);
  });
  it('the Bishop\'s own controller casting a spell with the chosen name loses nothing', () => {
    let s = scenario([], { defs: NAMED_DEFS, p1: { hand: ['Test Bishop', 'Test Spark'] } });
    s = drain(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bishop', 'hand', 'p1') }), { name: 'Test Spark' });
    const mine = life(s, 'p1');
    s = drain(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Spark', 'hand', 'p1') }));
    expect(life(s, 'p1') - mine).toBe(1);
  });
});

// ---- Queen's Diamond --------------------------------------------------------------------------------------------------------------------------------------
const DIAMOND = card('Test Diamond', 'Artifact', '{T}: Choose a color. Add one mana of that color for each charge counter on Test Diamond. Spend this mana only to cast your commander.');
const WARDEN = legend('Test Warden', '{G}{G}', ['2', '2'], ['G'], '', 'Legendary Creature — Elf Warrior');
const OTHER_LEGEND = legend('Test Other Legend', '{G}', ['1', '1'], ['G'], '', 'Legendary Creature — Elf Scout');
const SPARKLE = cardM11('Test Sparkle', '{G}', 'Instant', 'You gain 2 life.');

describe('CR 106.6, 903.3, 601.2h: "{T}: Choose a color. Add one mana of that color for each charge counter on ~. Spend this mana only to cast your commander."', () => {
  const board = (counters: number): GameState => commanderScenario({
    p1Commanders: [WARDEN], p2Commanders: [OTHER_LEGEND], defs: [DIAMOND, SPARKLE], cards: ['Forest'],
    p1: { hand: ['Test Sparkle'], battlefield: [{ name: 'Test Diamond', counters: { charge: counters } }] },
  });
  const castable = (s: GameState, id: ObjectId): boolean => legal(s, 'p1', 'cast').some((a) => (a as { object?: string }).object === id);
  const tapped = (s0: GameState): GameState => drain(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Diamond', 'battlefield', 'p1'), ability: 'p:0:0' }), { color: 'G' });
  const poolOf = (s: GameState): string => s.players.find((p) => p.id === 'p1')!.manaPool.map((u) => u.type).join('');
  it('is automated with no manual part', () => {
    expect(full(DIAMOND), JSON.stringify(DIAMOND.automation)).toBe(true);
  });
  it('with three charge counters the chosen color is added three times, and the mana pays for the commander (the command zone cast) but not for another spell', () => {
    let s = tapped(board(3));
    expect(poolOf(s)).toBe('GGG');
    expect(castable(s, inCommand(s, 'Test Warden'))).toBe(true);
    expect(castable(s, find(s, 'Test Sparkle', 'hand', 'p1'))).toBe(false);
    s = drain(act(s, { type: 'cast', player: 'p1', card: inCommand(s, 'Test Warden') }));
    expect(find(s, 'Test Warden', 'battlefield', 'p1')).toBeTruthy();
    expect(poolOf(s)).toBe('G'); // {G}{G} spent, the third mana stays and is still restricted
    expect(castable(s, find(s, 'Test Sparkle', 'hand', 'p1'))).toBe(false);
  });
  it('without counters no mana is added; with two counters two are, and they still pay for no other spell', () => {
    const s = tapped(board(0));
    expect(poolOf(s)).toBe('');
    const t = tapped(board(2));
    expect(poolOf(t)).toBe('GG');
    expect(castable(t, find(t, 'Test Sparkle', 'hand', 'p1'))).toBe(false);
  });
});

// ---- Anthropological Mission --------------------------------------------------------------------------------------------------------------------------------
const MISSION = card('Test Mission', 'Enchantment', 'Whenever you cast a noncreature spell, put a quest counter on this enchantment. Draw a card. Then discard a card unless this enchantment has three or more quest counters on it.');
const TRICK = card('Test Trick', 'Instant', 'You gain 1 life.');
const SCOUTING = card('Test Scouting Cat', 'Creature — Cat', '', ['1', '1']);

describe('CR 608.2c, 122.1: "Whenever you cast a noncreature spell, put a quest counter on this enchantment. Draw a card. Then discard a card unless this enchantment has three or more quest counters on it."', () => {
  /** Resolve everything, discarding a Plains whenever a discard is asked. */
  const play = (s0: GameState): GameState => {
    let s = s0;
    for (let i = 0; i < 40; i++) {
      const d = s.pending;
      if (d?.kind === 'chooseObjects') {
        const options = (d as unknown as { options: ObjectId[] }).options;
        s = answer(s, { kind: 'chooseObjects', ids: [options.find((id) => s.objects[id]!.defId === 'Plains') ?? options[0]!] });
      } else if (d && d.kind !== 'priority') s = settle(s);
      else if (s.zones.stack.length > 0) s = pass(s);
      else break;
    }
    return s;
  };
  const handSize = (s: GameState): number => s.zones.hand.p1!.length;
  it('is automated with no manual part', () => {
    expect(full(MISSION), JSON.stringify(MISSION.automation)).toBe(true);
  });
  it('the first and second noncreature spells draw then discard (the hand loses one card per spell); the third has three counters and keeps the card', () => {
    let s = scenario([], { defs: [MISSION, TRICK], p1: { hand: ['Test Trick', 'Test Trick', 'Test Trick', 'Plains', 'Plains', 'Plains'], battlefield: ['Test Mission'] } });
    const mission = find(s, 'Test Mission', 'battlefield', 'p1');
    const sizes: number[] = [];
    for (let k = 1; k <= 3; k++) {
      s = play(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Trick', 'hand', 'p1') }));
      expect(counters(s, mission, 'quest')).toBe(k);
      sizes.push(handSize(s));
    }
    expect(sizes).toEqual([5, 4, 4]); // 6 cards: cast (-1), draw (+1), discard (-1) twice; the third time cast (-1), draw (+1) and nothing is discarded
  });
  it('a creature spell is no noncreature spell: no counter, no draw', () => {
    let s = scenario([], { defs: [MISSION, SCOUTING], p1: { hand: ['Test Scouting Cat', 'Plains'], battlefield: ['Test Mission'] } });
    s = play(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Scouting Cat', 'hand', 'p1') }));
    expect(counters(s, find(s, 'Test Mission', 'battlefield', 'p1'), 'quest')).toBe(0);
    expect(handSize(s)).toBe(1);
  });
});

// ---- Sins of the Father and the sorcery with the same "for each opponent" token ---------------------------------------------------------------------------------
const SAGA = card('Test Reckoning', 'Enchantment — Saga', 'I — Each opponent sacrifices a nontoken creature of their choice.\nII — For each opponent, you create a 2/1 red Klingon Warrior creature token with haste.\nIII — Exile target player\'s graveyard. Each opponent loses life equal to the number of creature cards exiled this way.');
const HORDE = card('Test Horde', 'Sorcery', 'For each opponent, you create a 2/1 black Villain creature token with menace.');
const GRUNT = card('Test Grunt', 'Creature — Human Soldier', '', ['1', '1']);
const PRIEST = card('Test Priest', 'Creature — Human Cleric', '', ['1', '1']);
const FOUR = (o: Parameters<typeof mpScenario>[0] = {}): GameState => mpScenario({ defs: [SAGA, HORDE, GRUNT, PRIEST], ...o });
const tokensOf = (s: GameState, p: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p);
const creaturesOf = (s: GameState, p: string): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && getChars(s, id)!.types.includes('Creature')).map((id) => s.objects[id]!.defId);
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;

describe('CR 608.2f, 101.4, 111.2: "For each opponent, you create a 2/1 ... creature token" (three opponents: three tokens, all yours)', () => {
  it('both cards are automated with no manual part', () => {
    expect(full(SAGA), JSON.stringify(SAGA.automation)).toBe(true);
    expect(full(HORDE), JSON.stringify(HORDE.automation)).toBe(true);
  });
  it('the sorcery makes one token per opponent for its controller: three in a four-player game, none for the opponents, and it makes one in a two-player game', () => {
    let s = FOUR({ zones: { p1: { hand: ['Test Horde'] } } });
    s = mpResolve(mpDrive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Horde', 'hand', 'p1') })));
    expect(tokensOf(s, 'p1').length).toBe(3);
    for (const p of ['p2', 'p3', 'p4']) expect(tokensOf(s, p).length).toBe(0);
    let t = scenario([], { defs: [HORDE], p1: { hand: ['Test Horde'] } });
    t = drain(act(t, { type: 'cast', player: 'p1', card: find(t, 'Test Horde', 'hand', 'p1') }));
    expect(tokensOf(t, 'p1').length).toBe(1);
  });
  it('chapter I: each opponent sacrifices a nontoken creature of their choice (a token and a second creature stay); the saga\'s controller sacrifices nothing', () => {
    let s = FOUR({ zones: {
      p1: { hand: ['Test Reckoning'], battlefield: ['Test Priest'] },
      p2: { battlefield: ['Test Grunt', 'Test Priest'] }, p3: { battlefield: ['Test Grunt'] }, p4: { battlefield: ['Test Priest'] },
    } });
    s = mpResolve(mpDrive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Reckoning', 'hand', 'p1') })));
    for (let i = 0; i < 12 && s.pending && s.pending.kind !== 'priority'; i++) {
      const d = s.pending as unknown as { player: string; options: ObjectId[]; kind: string };
      s = d.kind === 'chooseObjects' ? answer(s, { kind: 'chooseObjects', ids: [d.options[0]!] }) : mpDrive(s);
      if (s.zones.stack.length > 0 && s.pending?.kind === 'priority') s = mpResolve(s);
    }
    expect(creaturesOf(s, 'p1')).toEqual(['Test Priest']);
    expect(creaturesOf(s, 'p2').length).toBe(1);
    expect(creaturesOf(s, 'p3')).toEqual([]);
    expect(creaturesOf(s, 'p4')).toEqual([]);
  });
});

describe('CR 714.2, 608.2f: the later chapters of the same saga', () => {
  /** Pass priority until Alice's next precombat main phase has begun (the lore counter is added and the chapter ability put on the stack or waiting for its target). */
  const toNextLore = (s0: GameState): GameState => {
    let s = s0;
    for (let i = 0; i < 400; i++) {
      if (s.turn.number > 1 && s.turn.activePlayer === 'p1' && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority'))) return s;
      if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
      else if (s.pending) s = mpDrive(s);
      else break;
    }
    return s;
  };
  it('chapter II: three opponents, three 2/1 haste Klingon Warrior tokens for the saga\'s controller', () => {
    let s = FOUR({ zones: { p1: { battlefield: [{ name: 'Test Reckoning', counters: { lore: 1 } }] } } });
    s = mpResolve(toNextLore(s));
    const mine = tokensOf(s, 'p1');
    expect(mine.length).toBe(3);
    for (const id of mine) { expect(pt(s, id)).toBe('2/1'); expect(subtypesOf(s, id)).toEqual(['Klingon', 'Warrior']); expect(getChars(s, id)!.keywords.map((k) => (k as { keyword?: string }).keyword ?? k)).toContain('haste'); }
    for (const p of ['p2', 'p3', 'p4']) expect(tokensOf(s, p).length).toBe(0);
  });
  it('chapter III: the targeted graveyard is exiled and each opponent loses life equal to the creature cards exiled (2 here, not the lands or the card of another graveyard)', () => {
    let s = FOUR({ zones: {
      p1: { battlefield: [{ name: 'Test Reckoning', counters: { lore: 2 } }] },
      p2: { graveyard: ['Test Grunt', 'Test Priest', 'Plains'] }, p3: { graveyard: ['Test Grunt'] },
    } });
    s = toNextLore(s);
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', player: 'p1' });
    const before = ['p2', 'p3', 'p4'].map((p) => lifeOf(s, p));
    s = mpResolve(mpDrive(s, [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }]));
    expect(s.zones.graveyard.p2!.length).toBe(0);
    expect(s.zones.graveyard.p3!.length).toBe(1);
    expect(['p2', 'p3', 'p4'].map((p) => lifeOf(s, p) - before[['p2', 'p3', 'p4'].indexOf(p)]!)).toEqual([-2, -2, -2]);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});
void [findAll, mpPassUntil, TRINKET];
