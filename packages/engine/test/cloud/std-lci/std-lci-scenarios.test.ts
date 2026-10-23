/**
 * Cloud std-lci (Standard backlog of The Lost Caverns of Ixalan): the shapes of parser/templates/zz-cloud/std-lci.json and the engine and lowering changes they
 * needed, played through the engine with synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10), plus the real Ojer
 * Pakpatiq and Brass's Tunnel-Grinder when the local index is present.
 *
 *   CR 701.44a-b       explore, once per instruction; each complete explore is reported ("whenever a creature you control explores a land card")
 *   CR 610.3           "exile a nonland card from it until ~ leaves the battlefield": the card returns when the source leaves
 *   CR 603.4, 608.2h   "for each creature that left the battlefield under your control this turn" counts the turn's zone changes
 *   CR 602.5b          "Activate only if an artifact entered the battlefield under your control this turn" / "if it has no time counters on it"
 *   CR 119.1, 506.3    "the player with the most life or tied for most life" (the defending player), "while you have the most life or are tied"
 *   CR 608.2c, 400.7   "for each card exiled this way", "if you exiled a land card this way", "you may play those cards this turn"
 *   CR 701.20e         digs: any number of a kind onto the battlefield and the rest on the bottom; a creature card and/or a land card
 *   CR 106.3           "whenever you cast a ... spell using mana produced by ~"
 *   CR 605.3b, 122.1   a mana ability that also removes or puts a counter on itself, or adds one of two amounts ("instead"), resolves at once
 *   CR 701.9a          "whenever an opponent discards a land card"
 *   CR 712.14a, 122.6  "return it to the battlefield tapped and transformed under its owner's control with three time counters on it"
 *   CR 701.27a         "remove those counters and transform it"
 *   CR 701.57a, 108.3  "the owner of target ... shuffles it into their library. Then that player discovers X"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, findAll, scenario } from '../../m5/helpers';
import { cast, drive, resolveAll, target } from '../../m5/cr-examples/helpers';
import { declareAttackers, toDeclareAttackers, tweak } from '../../m4/helpers';
import { goldenCard } from '../../m5/golden/harness';
import { pass } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const names = (s: GameState, ids: readonly ObjectId[]): (string | undefined)[] => ids.map((id) => s.defs[s.objects[id]!.defId]?.name);
const pool = (s: GameState): string[] => s.players[0]!.manaPool.map((m) => m.type);
function tapFor(s: GameState, id: ObjectId): GameState {
  const a = legalActions(s, 'p1').find((y) => y.kind === 'activate' && y.isMana && y.object === id);
  if (!a) throw new Error(`no mana ability of ${id}`);
  return act(s, a.action);
}

const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '1']);
const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');

describe('CR 701.44a-b: exploring twice, and the explore triggers', () => {
  const DIVER = card('Test Diver', 'Creature — Merfolk', 'Whenever a creature you control explores a nonland card, put a +1/+1 counter on ~.\nWhenever a creature you control explores a land card, you gain 2 life.', ['1', '1']);
  const SCOUT = card('Test Scout', 'Creature — Merfolk', 'When ~ enters, it explores, then it explores again.', ['1', '1']);
  it('are automated', () => {
    expect(full(DIVER)).toBe(true);
    expect(full(SCOUT)).toBe(true);
  });
  it('a nonland card then a land card: one counter and 2 life (each explore is reported with what it revealed)', () => {
    let s = scenario([], { p1: { hand: ['Test Scout'], battlefield: ['Test Diver'], library: ['Test Ogre', 'Plains', 'Test Ogre'] }, defs: [DIVER, SCOUT, OGRE] });
    const diver = find(s, 'Test Diver', 'battlefield');
    s = resolveAll(cast(s, 'Test Scout'), [{ kind: 'yesNo', yes: true }, { kind: 'yesNo', yes: false }]);
    expect(s.objects[diver]!.counters['+1/+1']).toBe(1);
    expect(s.players[0]!.life).toBe(22);
    const scout = find(s, 'Test Scout', 'battlefield');
    expect(s.objects[scout]!.counters['+1/+1']).toBe(1); // the nonland card explored first; the land went to the hand
    expect(findAll(s, 'Plains', 'hand', 'p1')).toHaveLength(1);
  });
});

describe('CR 610.3: "look at target opponent\'s hand. You may exile a nonland card from it until ~ leaves the battlefield"', () => {
  const BAT = card('Test Bat', 'Creature — Bat', "When ~ enters, look at target opponent's hand. You may exile a nonland card from it until ~ leaves the battlefield.", ['1', '1']);
  it('the exiled card returns to its owner\'s hand when the source leaves', () => {
    expect(full(BAT)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Bat', 'Test Kill'] }, p2: { hand: ['Test Ogre', 'Plains'] }, defs: [BAT, OGRE, KILL] });
    s = resolveAll(cast(s, 'Test Bat'), [target('p2')]);
    s = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Ogre', 'hand', 'p2')] });
    expect(findAll(s, 'Test Ogre', 'exile')).toHaveLength(1);
    s = resolveAll(cast(s, 'Test Kill', [target(find(s, 'Test Bat', 'battlefield'))]));
    expect(findAll(s, 'Test Ogre', 'hand', 'p2')).toHaveLength(1);
  });
});

describe('CR 603.4, 608.2h: what left the battlefield under your control this turn', () => {
  const FLANK = card('Test Flanker', 'Creature — Cat Warrior', 'Flash\nWhen ~ enters, put a +1/+1 counter on ~ for each creature that left the battlefield under your control this turn.', ['2', '1']);
  const BOUNCE = card('Test Bounce', 'Instant', "Return target creature to its owner's hand.");
  it('counts your creatures that died or were bounced this turn, not an opponent\'s', () => {
    expect(full(FLANK)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Flanker', 'Test Kill', 'Test Bounce', 'Test Kill'], battlefield: ['Test Ogre', 'Test Ogre'] }, p2: { battlefield: ['Test Ogre'] }, defs: [FLANK, OGRE, KILL, BOUNCE] });
    const [o1, o2] = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1');
    const theirs = s.zones.battlefield.find((id) => s.objects[id]!.controller === 'p2')!;
    s = resolveAll(cast(s, 'Test Kill', [target(o1!)]));
    s = resolveAll(cast(s, 'Test Bounce', [target(o2!)]));
    s = resolveAll(cast(s, 'Test Kill', [target(theirs)]));
    s = resolveAll(cast(s, 'Test Flanker'));
    expect(s.objects[find(s, 'Test Flanker', 'battlefield')]!.counters['+1/+1']).toBe(2);
  });
});

describe('CR 602.5b: activation restrictions read as the ability is announced', () => {
  it('"Activate only if an artifact entered the battlefield under your control this turn"', () => {
    const FORGE = card('Test Forge', 'Artifact', '{T}: Draw a card. Activate only if an artifact entered the battlefield under your control this turn.');
    const TRINKET = card('Test Trinket', 'Artifact', '');
    expect(full(FORGE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Trinket'], battlefield: ['Test Forge'] }, defs: [FORGE, TRINKET] });
    const forge = find(s, 'Test Forge', 'battlefield');
    const offered = (st: GameState) => legalActions(st, 'p1').some((a) => a.kind === 'activate' && a.object === forge && !a.isMana);
    expect(offered(s)).toBe(false);
    s = resolveAll(cast(s, 'Test Trinket'));
    expect(offered(s)).toBe(true);
  });
  it('"Activate only if it has no time counters on it": "it" is the object itself', () => {
    const DIAL = card('Test Dial', 'Artifact', '{2}, {T}: Put a +1/+1 counter on ~. Activate only if it has no time counters on it and only as a sorcery.');
    expect(full(DIAL)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Dial', 'Plains', 'Plains'] }, defs: [DIAL] });
    const dial = find(s, 'Test Dial', 'battlefield');
    const offered = (st: GameState) => legalActions(st, 'p1').some((a) => a.kind === 'activate' && a.object === dial && !a.isMana);
    expect(offered(s)).toBe(true);
    s = tweak(s, (t) => { t.objects[dial]!.counters['time'] = 1; });
    expect(offered(s)).toBe(false);
  });
});

describe('CR 119.1, 506.3: the player with the most life', () => {
  const PREACHER = card('Test Preacher', 'Creature — Vampire Cleric', 'Whenever ~ attacks the player with the most life or tied for most life, you gain 3 life.\nWhenever ~ attacks while you have the most life or are tied for most life, draw a card.', ['2', '4']);
  const run = (p1Life: number, p2Life: number) => {
    let s = scenario([], { p1: { battlefield: ['Test Preacher'], library: ['Plains', 'Plains'] }, p2: {}, defs: [PREACHER] });
    s = tweak(s, (t) => { t.players[0]!.life = p1Life; t.players[1]!.life = p2Life; });
    const pr = find(s, 'Test Preacher', 'battlefield');
    s = declareAttackers(toDeclareAttackers(s), [[pr, 'p2']]);
    s = resolveAll(drive(s));
    return { life: s.players[0]!.life, hand: s.zones.hand['p1']!.length };
  };
  it('tied: both trigger; ahead: only the draw; behind: only the life', () => {
    expect(full(PREACHER)).toBe(true);
    expect(run(20, 20)).toEqual({ life: 23, hand: 1 });
    expect(run(20, 15)).toEqual({ life: 20, hand: 1 });
    expect(run(15, 20)).toEqual({ life: 18, hand: 0 });
  });
});

describe('CR 608.2c, 400.7: what an instruction exiled "this way"', () => {
  it('"Exile up to two target cards from your graveyard. Add {R} for each card exiled this way. You may play those cards this turn."', () => {
    const DIG = card('Test Dig', 'Instant', 'Exile up to two target cards from your graveyard. Add {R} for each card exiled this way. You may play those cards this turn.');
    const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to any target.', undefined, '{R}');
    expect(full(DIG)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Dig'], graveyard: ['Test Bolt', 'Test Ogre', 'Plains'] }, defs: [DIG, BOLT, OGRE] });
    s = resolveAll(cast(s, 'Test Dig', [target(find(s, 'Test Bolt', 'graveyard'), find(s, 'Test Ogre', 'graveyard'))]));
    expect(pool(s)).toEqual(['R', 'R']);
    const castable = legalActions(s, 'p1').filter((a) => a.kind === 'cast').map((a) => (a as { object?: ObjectId }).object);
    expect(castable).toContain(find(s, 'Test Bolt', 'exile'));
    expect(castable).toContain(find(s, 'Test Ogre', 'exile'));
  });
  it('"If you exiled a land card this way, ... If you exiled a nonland card this way, ..."', () => {
    const HOARD = card('Test Hoard', 'Creature — Dinosaur', 'When ~ enters, exile the top two cards of your library. You may play them this turn. If you exiled a land card this way, create a 3/1 red Dinosaur creature token. If you exiled a nonland card this way, create a Treasure token.', ['2', '2']);
    expect(full(HOARD)).toBe(true);
    const run = (lib: string[]) => {
      const s = resolveAll(cast(scenario([], { p1: { hand: ['Test Hoard'], library: lib }, defs: [HOARD, OGRE] }), 'Test Hoard'));
      return names(s, s.zones.battlefield).filter((n) => n !== 'Test Hoard').sort();
    };
    expect(run(['Plains', 'Test Ogre', 'Plains'])).toEqual(['Dinosaur Token', 'Treasure Token']);
    expect(run(['Plains', 'Plains', 'Test Ogre'])).toEqual(['Dinosaur Token']);
    expect(run(['Test Ogre', 'Test Ogre', 'Plains'])).toEqual(['Treasure Token']);
  });
});

describe('CR 701.20e: choosing among the cards revealed', () => {
  const DINO = card('Test Dino', 'Creature — Dinosaur', '', ['3', '3']);
  it('"Put any number of Dinosaur creature cards from among them onto the battlefield and the rest on the bottom of your library in a random order"', () => {
    const DIG = card('Test Dig One', 'Sorcery', 'Reveal the top four cards of your library. Put any number of Dinosaur creature cards from among them onto the battlefield and the rest on the bottom of your library in a random order.');
    expect(full(DIG)).toBe(true);
    let s = resolveAll(cast(scenario([], { p1: { hand: ['Test Dig One'], library: ['Test Dino', 'Test Ogre', 'Test Dino', 'Plains', 'Plains'] }, defs: [DIG, DINO, OGRE] }), 'Test Dig One'));
    expect(s.pending?.kind).toBe('chooseObjects');
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: findAll(s, 'Test Dino', 'library') }));
    expect(names(s, s.zones.battlefield)).toEqual(['Test Dino', 'Test Dino']);
    expect(names(s, s.zones.library['p1']!)[0]).toBe('Plains'); // the fifth card stays on top; the other two revealed cards went to the bottom
  });
  it('"You may put a creature card and/or a land card from among them onto the battlefield": one of each kind, then the rest on the bottom', () => {
    const DIG = card('Test Dig Two', 'Sorcery', 'Reveal the top four cards of your library. You may put a creature card and/or a land card from among them onto the battlefield. Put the rest on the bottom in a random order.');
    expect(full(DIG)).toBe(true);
    let s = resolveAll(cast(scenario([], { p1: { hand: ['Test Dig Two'], library: ['Test Ogre', 'Plains', 'Test Ogre', 'Plains', 'Test Dino'] }, defs: [DIG, DINO, OGRE] }), 'Test Dig Two'));
    s = answer(s, { kind: 'chooseObjects', ids: [findAll(s, 'Test Ogre', 'library')[0]!] });
    expect((s.pending as { options?: ObjectId[] } | undefined)?.options?.every((id) => s.defs[s.objects[id]!.defId]?.name === 'Plains')).toBe(true);
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [findAll(s, 'Plains', 'library')[0]!] }));
    expect(names(s, s.zones.battlefield).sort()).toEqual(['Plains', 'Test Ogre']);
    expect(names(s, s.zones.library['p1']!)[0]).toBe('Test Dino');
  });
});

describe('CR 106.3: "whenever you cast an artifact or creature spell using mana produced by ~"', () => {
  it('only mana from the object itself counts', () => {
    const WELL = card('Test Well', 'Artifact', '{T}: Add {W}.\nWhenever you cast an artifact or creature spell using mana produced by ~, you gain 3 life.');
    const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}');
    expect(full(WELL)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Bear', 'Test Bear'], battlefield: ['Test Well', 'Plains'] }, defs: [WELL, BEAR] });
    s = resolveAll(cast(tapFor(s, find(s, 'Plains', 'battlefield')), 'Test Bear'));
    expect(s.players[0]!.life).toBe(20);
    s = resolveAll(cast(tapFor(s, find(s, 'Test Well', 'battlefield')), 'Test Bear'));
    expect(s.players[0]!.life).toBe(23);
  });
  it('"permanent spell": an instant is none', () => {
    const ALTAR = card('Test Altar', 'Enchantment', 'Whenever you cast a permanent spell, you gain 1 life.');
    const SPARK = card('Test Spark', 'Instant', 'Draw a card.');
    expect(full(ALTAR)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Spark', 'Test Ogre'], battlefield: ['Test Altar'], library: ['Plains'] }, defs: [ALTAR, SPARK, OGRE] });
    s = resolveAll(cast(s, 'Test Spark'));
    expect(s.players[0]!.life).toBe(20);
    s = resolveAll(cast(s, 'Test Ogre'));
    expect(s.players[0]!.life).toBe(21);
  });
});

describe('CR 605.3b: mana abilities that do one more thing resolve at once', () => {
  it('"Add {U}. Remove a time counter from ~."; "Add one mana of any color. Put an unlock counter on ~."', () => {
    const DIAL = card('Test Dial', 'Artifact', '{T}: Add {U}. Remove a time counter from ~.');
    const BOX = card('Test Box', 'Artifact', '{T}: Add one mana of any color. Put an unlock counter on ~.');
    expect(full(DIAL)).toBe(true);
    expect(full(BOX)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Dial', 'Test Box'] }, defs: [DIAL, BOX] });
    const dial = find(s, 'Test Dial', 'battlefield');
    s = tweak(s, (t) => { t.objects[dial]!.counters['time'] = 2; });
    s = tapFor(s, dial);
    expect(pool(s)).toEqual(['U']);
    expect(s.objects[dial]!.counters['time']).toBe(1);
    const box = find(s, 'Test Box', 'battlefield');
    s = tapFor(s, box);
    expect(s.pending?.kind).toBe('chooseColor');
    s = answer(s, { kind: 'chooseColor', color: 'R' } as never);
    expect(pool(s)).toEqual(['U', 'R']);
    expect(s.objects[box]!.counters['unlock']).toBe(1);
  });
  it('"Add {G}. If you control a creature with power 4 or greater, add {G}{G} instead."', () => {
    const CROWD = card('Test Crowd', 'Creature — Human', '{T}: Add {G}. If you control a creature with power 4 or greater, add {G}{G} instead.', ['1', '1']);
    const BIG = card('Test Big', 'Creature — Beast', '', ['4', '4']);
    expect(full(CROWD)).toBe(true);
    const small = scenario([], { p1: { battlefield: ['Test Crowd'] }, defs: [CROWD, BIG] });
    expect(pool(tapFor(small, find(small, 'Test Crowd', 'battlefield')))).toEqual(['G']);
    const big = scenario([], { p1: { battlefield: ['Test Crowd', 'Test Big'] }, defs: [CROWD, BIG] });
    expect(pool(tapFor(big, find(big, 'Test Crowd', 'battlefield')))).toEqual(['G', 'G']);
  });
  it('"If you have one or fewer cards in hand, add {G}." (no "instead"): the mana only when the condition holds; the cost is paid either way', () => {
    const ROCK = card('Test Rock', 'Artifact', '{T}: If you have one or fewer cards in hand, add {G}.');
    expect(full(ROCK)).toBe(true);
    const one = scenario([], { p1: { hand: ['Test Ogre'], battlefield: ['Test Rock'] }, defs: [ROCK, OGRE] });
    expect(pool(tapFor(one, find(one, 'Test Rock', 'battlefield')))).toEqual(['G']);
    let two = scenario([], { p1: { hand: ['Test Ogre', 'Test Ogre'], battlefield: ['Test Rock'] }, defs: [ROCK, OGRE] });
    const rock = find(two, 'Test Rock', 'battlefield');
    two = tapFor(two, rock);
    expect(pool(two)).toEqual([]);
    expect(two.objects[rock]!.tapped).toBe(true);
  });
});

describe('CR 701.9a: "Whenever an opponent discards a land card"', () => {
  const FROG = card('Test Frog', 'Creature — Frog', 'Whenever an opponent discards a land card, draw a card.', ['1', '1']);
  const MIND = card('Test Mind', 'Sorcery', 'Each opponent discards a card.');
  const SELF = card('Test Self', 'Sorcery', 'Discard a card.');
  it('is automated', () => expect(full(FROG)).toBe(true));
  it('an opponent\'s land card triggers it; an opponent\'s nonland card and your own land card do not', () => {
    const land = resolveAll(cast(scenario([], { p1: { hand: ['Test Mind'], battlefield: ['Test Frog'], library: ['Test Ogre'] }, p2: { hand: ['Plains'] }, defs: [FROG, MIND, OGRE] }), 'Test Mind'), []);
    expect(findAll(land, 'Plains', 'graveyard', 'p2')).toHaveLength(1);
    expect(findAll(land, 'Test Ogre', 'hand', 'p1')).toHaveLength(1);
    const spell = resolveAll(cast(scenario([], { p1: { hand: ['Test Mind'], battlefield: ['Test Frog'], library: ['Test Ogre'] }, p2: { hand: ['Test Kill'] }, defs: [FROG, MIND, OGRE, KILL] }), 'Test Mind'), []);
    expect(findAll(spell, 'Test Kill', 'graveyard', 'p2')).toHaveLength(1);
    expect(findAll(spell, 'Test Ogre', 'hand', 'p1')).toHaveLength(0);
    const mine = resolveAll(cast(scenario([], { p1: { hand: ['Test Self', 'Plains'], battlefield: ['Test Frog'], library: ['Test Ogre'] }, defs: [FROG, SELF, OGRE] }), 'Test Self'), []);
    expect(findAll(mine, 'Plains', 'graveyard', 'p1')).toHaveLength(1);
    expect(findAll(mine, 'Test Ogre', 'hand', 'p1')).toHaveLength(0);
  });
});

describe('CR 701.57a, 108.3: "The owner of target ... shuffles it into their library. Then that player discovers X, where X is its mana value."', () => {
  it('the owner discovers with the mana value of the card they shuffled away', () => {
    const JUST = card('Test Justice', 'Instant', 'The owner of target artifact or creature with mana value 1 or greater shuffles it into their library. Then that player discovers X, where X is its mana value.');
    const TROLL = card('Test Troll', 'Creature — Troll', '', ['3', '3'], '{2}{G}');
    expect(full(JUST)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Justice'] }, p2: { battlefield: ['Test Troll'], library: ['Plains', 'Plains'] }, defs: [JUST, TROLL] });
    s = resolveAll(cast(s, 'Test Justice', [target(find(s, 'Test Troll', 'battlefield', 'p2'))]));
    // the only nonland card of p2's library is the Troll itself (mana value 3 <= 3): p2 discovers it and is offered the free cast (CR 701.57a)
    expect(s.pending?.player).toBe('p2');
    expect(s.pending?.kind).toBe('yesNo');
    expect(findAll(s, 'Test Troll', 'exile')).toHaveLength(1);
  });
});

describe('CR 106.6: "Spend this mana only to cast a creature spell, and that spell can\'t be countered"', () => {
  it('the creature spell cast with that mana can\'t be countered; one cast with other mana can', () => {
    const CAVE = card('Test Cavern', 'Land', '{T}: Add {G}. Spend this mana only to cast a creature spell, and that spell can\'t be countered.');
    const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{G}');
    const DENY = card('Test Deny', 'Instant', 'Counter target spell.');
    expect(full(CAVE)).toBe(true);
    const run = (source: string) => {
      let s = scenario(['Forest'], { p1: { hand: ['Test Bear'], battlefield: ['Test Cavern', 'Forest'] }, p2: { hand: ['Test Deny'] }, defs: [CAVE, BEAR, DENY] });
      s = cast(tapFor(s, find(s, source, 'battlefield')), 'Test Bear');
      s = pass(s); // p2 gets priority with the Bear on the stack
      s = resolveAll(cast(s, 'Test Deny', [target(s.zones.stack[0]!)], 'p2'));
      return findAll(s, 'Test Bear', 'battlefield').length;
    };
    expect(run('Test Cavern')).toBe(1);
    expect(run('Forest')).toBe(0);
  });
});

describe('the shapes of the first std-lci templates', () => {
  it('"You may mill two cards. Then return up to two creature cards from your graveyard to your hand."', () => {
    const CHANCE = card('Test Chance', 'Instant', 'You may mill two cards. Then return up to two creature cards from your graveyard to your hand.');
    expect(full(CHANCE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Chance'], graveyard: ['Test Ogre', 'Plains'], library: ['Test Ogre', 'Plains'] }, defs: [CHANCE, OGRE] });
    s = resolveAll(cast(s, 'Test Chance'), [{ kind: 'yesNo', yes: true }]);
    expect(s.pending?.kind).toBe('chooseObjects');
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: findAll(s, 'Test Ogre', 'graveyard', 'p1') }));
    expect(findAll(s, 'Test Ogre', 'hand', 'p1')).toHaveLength(2);
    expect(findAll(s, 'Plains', 'graveyard', 'p1')).toHaveLength(2);
  });
  it('"When ~ enters, put any number of creature cards from your hand onto the battlefield."', () => {
    const TYRANT = card('Test Tyrant', 'Creature — Dinosaur', 'When ~ enters, put any number of creature cards from your hand onto the battlefield.', ['6', '6']);
    expect(full(TYRANT)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Tyrant', 'Test Ogre', 'Test Ogre', 'Plains'] }, defs: [TYRANT, OGRE] });
    s = resolveAll(cast(s, 'Test Tyrant'));
    expect((s.pending as { options?: ObjectId[] } | undefined)?.options).toHaveLength(2); // the creature cards only
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [findAll(s, 'Test Ogre', 'hand', 'p1')[0]!] }));
    expect(findAll(s, 'Test Ogre', 'battlefield')).toHaveLength(1);
    expect(findAll(s, 'Test Ogre', 'hand', 'p1')).toHaveLength(1);
  });
  it('"you may search your library for a basic land card or Cave card, reveal it, then shuffle and put that card on top"', () => {
    const GNOME = card('Test Gnome', 'Artifact Creature — Gnome', 'When ~ enters, you may search your library for a basic land card or Cave card, reveal it, then shuffle and put that card on top.', ['1', '2']);
    const CAVE = card('Test Cave', 'Land — Cave', '');
    expect(full(GNOME)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Gnome'], library: ['Test Ogre', 'Test Ogre', 'Test Cave', 'Test Ogre'] }, defs: [GNOME, CAVE, OGRE] });
    s = resolveAll(cast(s, 'Test Gnome'), [{ kind: 'yesNo', yes: true }]);
    expect(s.pending?.kind).toBe('chooseObjects');
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Cave', 'library', 'p1')] }));
    expect(names(s, s.zones.library['p1']!)[0]).toBe('Test Cave');
  });
});

describe.skipIf(goldenCard('Ojer Pakpatiq, Deepest Epoch // Temple of Cyclical Time') === undefined)('the real gods and temples (local index)', () => {
  it('Ojer Pakpatiq dies and returns tapped and transformed with three time counters (CR 712.14a, 122.6)', () => {
    const OJER = compileCard(goldenCard('Ojer Pakpatiq, Deepest Epoch // Temple of Cyclical Time')!);
    expect(full(OJER)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Ojer Pakpatiq, Deepest Epoch // Temple of Cyclical Time'], hand: ['Test Kill'] }, defs: [OJER, KILL] });
    s = resolveAll(cast(s, 'Test Kill', [target(find(s, 'Ojer Pakpatiq, Deepest Epoch // Temple of Cyclical Time', 'battlefield'))]));
    const temple = s.zones.battlefield.find((id) => s.objects[id]!.defId === OJER.id || s.defs[s.objects[id]!.defId]?.name === OJER.name);
    expect(temple).toBeDefined();
    expect(s.objects[temple!]!.tapped).toBe(true);
    expect(s.objects[temple!]!.face).toBe(1);
    expect(s.objects[temple!]!.counters['time']).toBe(3);
    // the temple's mana ability removes a time counter as it adds {U}
    s = tweak(s, (t) => { t.objects[temple!]!.tapped = false; });
    s = tapFor(s, temple!);
    expect(pool(s)).toEqual(['U']);
    expect(s.objects[temple!]!.counters['time']).toBe(2);
  });
  it('Brass\'s Tunnel-Grinder: the third bore counter transforms it, and the counters are removed (CR 122.1, 701.27a)', () => {
    const BRASS = compileCard(goldenCard("Brass's Tunnel-Grinder // Tecutlan, the Searing Rift")!);
    expect(full(BRASS)).toBe(true);
    const steps = JSON.stringify(BRASS.faces[0]!.abilities);
    expect(steps).toContain('"op":"removeCounters"');
    expect(steps).toContain('"op":"changeFace"');
  });
});
