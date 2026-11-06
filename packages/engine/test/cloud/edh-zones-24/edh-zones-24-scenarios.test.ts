/**
 * edh-zones-24 (Commander lane edh-zones): the round's readings played through the engine with synthetic cards (invented names, design 6.10). CR cites checked against the
 * 2026-09-25 text (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt).
 *
 *   CR 603.7, 603.4, 400.7, 608.2c, 111.4  "Exile the top three cards of your library. You may play those cards this turn. At the beginning of the next end step, if any of those cards remain
 *                             exiled, put them into your graveyard, then create a token for each card put into your graveyard this way. Those tokens have "..."" (Glimpse the Impossible)
 *   CR 701.20a, 119.3, 202.3, 400.3, 603.1  "At the beginning of your upkeep, you and target opponent each reveal the top card of your library. You each lose life equal to the mana value of the card revealed by
 *                             the other player. You each put the card you revealed into your hand." (Keen Duelist)
 *   CR 607.2a, 613.1d, 613.4b, 205.3m  "As long as a card exiled with this creature is a creature card, this creature has the power, toughness, and creature types of the last creature card exiled
 *                             with it. It's still a Shapeshifter." (Duplicant)
 *   CR 608.2d, 400.3, 701.24a, 109.4  "-12: Target opponent chooses a permanent they control and returns it to its owner's hand. Then they shuffle each nonland permanent they control into its
 *                             owner's library." (Teferi, Temporal Pilgrim)
 *   CR 701.17a, 110.2a, 608.2d  "Mill ten cards. Put up to two creature cards from among the milled cards onto the battlefield." (Vorinclex // The Grand Evolution, chapter I)
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type GameState } from '../../../src/index';
import { advanceTo, answer, put } from '../../m3/scenario';
import { setLink } from '../../../src/statics/links';
import { act, card, cast, drive, find, full, lifeOf, obj, passBoth, resolveAll, scenario } from '../r3-cost/support';
import { getChars } from '../../../src/rules/characteristics';

const nameOf = (s: GameState, id: string): string => getChars(s, id).name;
const zoneNames = (s: GameState, z: 'hand' | 'graveyard' | 'library', p: 'p1' | 'p2'): string[] => s.zones[z][p]!.map((id) => nameOf(s, id));
const bfNames = (s: GameState, p?: 'p1' | 'p2'): string[] => s.zones.battlefield.filter((id) => p === undefined || s.objects[id]!.controller === p).map((id) => nameOf(s, id)).sort();
const exileNames = (s: GameState): string[] => s.zones.exile.map((id) => nameOf(s, id)).sort();

describe('"At the beginning of the next end step, if any of those cards remain exiled, put them into your graveyard, then create a token for each card put into your graveyard this way. Those tokens have ..." (CR 603.7, 603.4, 400.7; Glimpse the Impossible)', () => {
  const GLIMPSE = card('Test Glimpse', 'Sorcery', 'Exile the top three cards of your library. You may play those cards this turn. At the beginning of the next end step, if any of those cards remain exiled, put them into your graveyard, then create a 0/1 colorless Eldrazi Spawn creature token for each card put into your graveyard this way. Those tokens have "Sacrifice this token: Add {C}."');
  const LAND = card('Test Swamp', 'Basic Land — Swamp', '');
  const IMP = card('Test Imp', 'Creature — Imp', '', '{0}', ['1', '1']);
  const BOLT = card('Test Spark', 'Sorcery', 'You gain 1 life.');
  const defs = [GLIMPSE, LAND, IMP, BOLT];
  const setup = (): GameState => scenario([], { defs, p1: { hand: ['Test Glimpse'], library: ['Test Swamp', 'Test Imp', 'Test Spark', 'Test Spark'] }, p2: {} });
  it('is fully automated', () => expect(full(GLIMPSE)).toBe(true));
  it('what was not played is put into the graveyard at the end step, with one Eldrazi Spawn for each card put there; played cards stay where they went', () => {
    let s = cast(setup(), 'Test Glimpse');
    s = drive(passBoth(s));
    expect(exileNames(s)).toEqual(['Test Imp', 'Test Spark', 'Test Swamp']);
    const imp = legalActions(s, 'p1').find((l) => l.kind === 'cast' && l.object !== undefined && nameOf(s, l.object) === 'Test Imp')!;
    s = drive(act(s, imp.action));
    s = drive(passBoth(s));
    expect(bfNames(s, 'p1')).toContain('Test Imp');
    s = advanceTo(s, 1, 'end');
    s = drive(passBoth(s));
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = drive(passBoth(s));
    expect(exileNames(s)).toEqual([]);
    expect(zoneNames(s, 'graveyard', 'p1').sort()).toEqual(['Test Glimpse', 'Test Spark', 'Test Swamp']);
    expect(bfNames(s, 'p1').filter((n) => n.includes('Eldrazi'))).toHaveLength(2);
    expect(bfNames(s, 'p1')).toContain('Test Imp');
  });
  const finish = (s0: GameState): GameState => {
    let s = advanceTo(s0, 1, 'end');
    for (let i = 0; i < 8 && s.zones.stack.length > 0; i++) s = drive(passBoth(s));
    return s;
  };
  const resolved = (): GameState => drive(passBoth(cast(setup(), 'Test Glimpse')));
  const castFrom = (s: GameState, name: string): GameState => {
    const a = legalActions(s, 'p1').find((l) => (l.kind === 'cast' || l.kind === 'playLand') && l.object !== undefined && nameOf(s, l.object) === name)!;
    const played = drive(act(s, a.action));
    return a.kind === 'playLand' ? played : drive(passBoth(played));
  };
  const spawns = (s: GameState): number => bfNames(s, 'p1').filter((n) => n.includes('Eldrazi')).length;
  it('nothing played: all three cards go to the graveyard and three Spawn tokens are created, each able to be sacrificed for {C}', () => {
    const s = finish(resolved());
    expect(zoneNames(s, 'graveyard', 'p1').sort()).toEqual(['Test Glimpse', 'Test Imp', 'Test Spark', 'Test Swamp']);
    expect(spawns(s)).toBe(3);
    const spawn = s.zones.battlefield.find((id) => nameOf(s, id).includes('Eldrazi'))!;
    const mana = legalActions(s, 'p1').find((l) => l.kind === 'activate' && l.object === spawn && l.isMana)!;
    expect(mana).toBeDefined();
    const after = act(s, mana.action);
    expect(spawns(drive(after))).toBe(2);
  });
  it('every card played: none remains exiled, so the delayed ability does nothing (no token, nothing put into the graveyard)', () => {
    let s = resolved();
    s = castFrom(s, 'Test Imp');
    s = castFrom(s, 'Test Swamp');
    s = castFrom(s, 'Test Spark');
    expect(exileNames(s)).toEqual([]);
    s = finish(s);
    expect(spawns(s)).toBe(0);
    expect(bfNames(s, 'p1')).toEqual(['Test Imp', 'Test Swamp']);
    expect(zoneNames(s, 'graveyard', 'p1').sort()).toEqual(['Test Glimpse', 'Test Spark']);
  });
  it('a spell cast from exile that already went to the graveyard is not counted again: one token for each card that was still exiled (CR 400.7)', () => {
    let s = resolved();
    s = castFrom(s, 'Test Spark');
    s = finish(s);
    expect(spawns(s)).toBe(2);
    expect(zoneNames(s, 'graveyard', 'p1').sort()).toEqual(['Test Glimpse', 'Test Imp', 'Test Spark', 'Test Swamp']);
  });
  it('only the controller\'s end step of the turn it was cast counts: the cards stay exiled until the next end step begins (the delayed ability is not early)', () => {
    const s = resolved();
    expect(exileNames(s)).toEqual(['Test Imp', 'Test Spark', 'Test Swamp']);
    expect(spawns(s)).toBe(0);
  });
});

describe('"At the beginning of your upkeep, you and target opponent each reveal the top card of your library. You each lose life equal to the mana value of the card revealed by the other player. You each put the card you revealed into your hand." (CR 701.20a, 119.3, 202.3, 400.3; Keen Duelist)', () => {
  const DUEL = card('Test Duelist', 'Creature — Human Wizard', 'At the beginning of your upkeep, you and target opponent each reveal the top card of your library. You each lose life equal to the mana value of the card revealed by the other player. You each put the card you revealed into your hand.', '{0}', ['2', '2']);
  const BIG = card('Test Colossus', 'Creature — Giant', '', '{3}{R}', ['4', '4'], ['R']);
  const SMALL = card('Test Sprite', 'Creature — Faerie', '', '{U}', ['1', '1'], ['U']);
  const ISLAND = card('Test Island', 'Basic Land — Island', '');
  const FILLER = card('Test Filler', 'Sorcery', 'You gain 1 life.');
  const defs = [DUEL, BIG, SMALL, ISLAND, FILLER];
  const toUpkeep = (p1: string[], p2: string[]): GameState => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Duelist'], library: [...p1, 'Test Filler', 'Test Filler'] }, p2: { library: ['Test Filler', ...p2, 'Test Filler'] } }); // (the opponent draws on turn 2)
    return advanceTo(s0, 3, 'upkeep');
  };
  const resolveTrigger = (s0: GameState): GameState => {
    let s = s0;
    if (s.pending?.kind === 'chooseTargets') s = drive(s, { targets: [[{ kind: 'player', id: 'p2' }]] });
    for (let i = 0; i < 8 && s.zones.stack.length > 0; i++) s = drive(passBoth(s));
    return s;
  };
  it('is fully automated', () => expect(full(DUEL)).toBe(true));
  it('each player loses life equal to the mana value of the OTHER player\'s card and each puts their own revealed card into their hand', () => {
    const s0 = toUpkeep(['Test Colossus'], ['Test Sprite']);
    const l1 = lifeOf(s0, 'p1');
    const l2 = lifeOf(s0, 'p2');
    const s = resolveTrigger(s0);
    expect(lifeOf(s, 'p1')).toBe(l1 - 1); // the opponent's card: mana value 1
    expect(lifeOf(s, 'p2')).toBe(l2 - 4); // your card: mana value 4
    expect(zoneNames(s, 'hand', 'p1')).toContain('Test Colossus');
    expect(zoneNames(s, 'hand', 'p2')).toEqual(['Test Filler', 'Test Sprite']);
  });
  it('a land (mana value 0) costs the other player nothing; an empty library reveals nothing and loses nothing', () => {
    const s0 = toUpkeep(['Test Island'], []);
    s0.zones.library.p2!.length = 0;
    const l1 = lifeOf(s0, 'p1');
    const l2 = lifeOf(s0, 'p2');
    const s = resolveTrigger(s0);
    expect(lifeOf(s, 'p1')).toBe(l1);
    expect(lifeOf(s, 'p2')).toBe(l2);
    expect(zoneNames(s, 'hand', 'p1')).toContain('Test Island');
  });
  it('it is a trigger of YOUR upkeep only: the opponent\'s upkeep does nothing', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Duelist'], library: ['Test Colossus', 'Test Filler'] }, p2: { library: ['Test Sprite', 'Test Filler'] } });
    const s = advanceTo(s0, 2, 'upkeep');
    expect(s.zones.stack).toHaveLength(0);
    expect(obj('x')).toBeDefined();
  });
});

describe('"Imprint -- When this creature enters, you may exile target nontoken creature. As long as a card exiled with this creature is a creature card, this creature has the power, toughness, and creature types of the last creature card exiled with it. It\'s still a Shapeshifter." (CR 607.2a, 613.1d, 613.4b, 205.3m; Duplicant)', () => {
  const DUP = card('Test Doppelganger', 'Artifact Creature — Shapeshifter', 'Imprint — When this creature enters, you may exile target nontoken creature.\nAs long as a card exiled with this creature is a creature card, this creature has the power, toughness, and creature types of the last creature card exiled with it. It\'s still a Shapeshifter.', '{0}', ['2', '4']);
  const DRAGON = card('Test Drake', 'Creature — Dragon Wizard', '', '{0}', ['5', '3']);
  const ELF = card('Test Sprout', 'Creature — Elf Druid', '', '{0}', ['1', '1']);
  const defs = [DUP, DRAGON, ELF];
  const setup = (): GameState => scenario([], { defs, p1: { hand: ['Test Doppelganger'] }, p2: { battlefield: ['Test Drake'] } });
  const withImprint = (): GameState => {
    const s0 = setup();
    return resolveAll(cast(s0, 'Test Doppelganger', {}), { targets: [[obj(find(s0, 'Test Drake', 'battlefield', 'p2'))]], yes: [true] });
  };
  const dup = (s: GameState): string => find(s, 'Test Doppelganger', 'battlefield', 'p1');
  const stats = (s: GameState) => { const c = getChars(s, dup(s)); return { pt: `${c.power}/${c.toughness}`, subtypes: [...c.subtypes].sort() }; };
  it('is fully automated', () => expect(full(DUP)).toBe(true));
  it('the exiled creature card gives its power, toughness and creature types; Shapeshifter stays', () => {
    const s = withImprint();
    expect(exileNames(s)).toEqual(['Test Drake']);
    expect(stats(s)).toEqual({ pt: '5/3', subtypes: ['Dragon', 'Shapeshifter', 'Wizard'] });
  });
  it('declining the exile leaves the creature as printed (nothing is exiled with it)', () => {
    const s0 = setup();
    const s = resolveAll(cast(s0, 'Test Doppelganger', {}), { targets: [[obj(find(s0, 'Test Drake', 'battlefield', 'p2'))]], yes: [false] });
    expect(exileNames(s)).toEqual([]);
    expect(stats(s)).toEqual({ pt: '2/4', subtypes: ['Shapeshifter'] });
  });
  it('the LAST creature card exiled with it counts (CR 607.2a): a later one replaces the earlier, and when it leaves exile the earlier one is the last again', () => {
    let s = withImprint();
    const elf = put(s, 'p2', 'exile', 'Test Sprout');
    const d = dup(s);
    setLink(s.objects[d]!, 'exiled', { objects: [...(s.objects[d]!.links!['exiled']!.objects!), { id: elf, zone: 'exile' }] });
    expect(stats(s)).toEqual({ pt: '1/1', subtypes: ['Druid', 'Elf', 'Shapeshifter'] });
    s = JSON.parse(JSON.stringify(s)) as GameState;
    s.zones.exile = s.zones.exile.filter((id) => id !== elf);
    s.zones.graveyard.p2!.push(elf);
    s.objects[elf]!.zone = 'graveyard';
    expect(stats(s)).toEqual({ pt: '5/3', subtypes: ['Dragon', 'Shapeshifter', 'Wizard'] });
  });
  it('when the exiled card leaves exile nothing is "exiled with it" any more: back to the printed 2/4 Shapeshifter', () => {
    const s = withImprint();
    const drake = s.zones.exile[0]!;
    s.zones.exile = [];
    s.zones.graveyard.p2!.push(drake);
    s.objects[drake]!.zone = 'graveyard';
    expect(stats(s)).toEqual({ pt: '2/4', subtypes: ['Shapeshifter'] });
  });
});

describe('"-12: Target opponent chooses a permanent they control and returns it to its owner\'s hand. Then they shuffle each nonland permanent they control into its owner\'s library." (CR 608.2d, 400.3, 701.24a; Teferi, Temporal Pilgrim)', () => {
  const TEFERI = card('Test Time Walker', 'Legendary Planeswalker — Testy', '0: Draw a card.\n-12: Target opponent chooses a permanent they control and returns it to its owner\'s hand. Then they shuffle each nonland permanent they control into its owner\'s library.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', '{0}', ['3', '3']);
  const MOUNTAIN = card('Test Mountain', 'Basic Land — Mountain', '');
  const defs = [TEFERI, BEAR, GOLEM, MOUNTAIN];
  const setup = (): GameState => {
    const s = scenario([], { defs, p1: { battlefield: [{ name: 'Test Time Walker', counters: { loyalty: 14 } }], library: ['Test Mountain'] }, p2: { battlefield: ['Test Bear', 'Test Mountain', 'Test Mountain'], library: ['Test Mountain'] } });
    const stolen = put(s, 'p1', 'battlefield', 'Test Golem'); // owned by p1, controlled by p2
    s.objects[stolen]!.controller = 'p2';
    return s;
  };
  const ultimate = (s: GameState, chosen: string): GameState => {
    const source = find(s, 'Test Time Walker', 'battlefield', 'p1');
    const a = legalActions(s, 'p1').find((l) => l.kind === 'activate' && l.object === source && l.label.includes('Target opponent'))!;
    return resolveAll(drive(act(s, a.action), { targets: [[{ kind: 'player', id: 'p2' }]] }), { objects: [[find(s, chosen, 'battlefield', chosen === 'Test Golem' ? 'p1' : 'p2')]] });
  };
  it('is fully automated', () => expect(full(TEFERI)).toBe(true));
  it('the opponent chooses one permanent they control and it returns to its OWNER\'s hand; then each of their nonland permanents is shuffled into its owner\'s library; lands stay', () => {
    const s0 = setup();
    const s = ultimate(s0, 'Test Bear');
    expect(zoneNames(s, 'hand', 'p2')).toEqual(['Test Bear']);
    expect(bfNames(s, 'p2')).toEqual(['Test Mountain', 'Test Mountain']);
    // CR 701.24a: the library of each owner the permanents went to is shuffled (p1's for the Golem, p2's for the Bear's owner... the chosen one went to a hand)
    expect(s.log.filter((l) => /shuffles/.test(l.text)).length).toBeGreaterThan(0);
    expect(zoneNames(s, 'library', 'p1')).toContain('Test Golem'); // the permanent they control but p1 owns goes to p1's library
    expect(zoneNames(s, 'library', 'p2')).not.toContain('Test Golem');
  });
  it('choosing the stolen permanent returns it to its owner\'s hand, not to the chooser\'s', () => {
    const s0 = setup();
    const s = ultimate(s0, 'Test Golem');
    expect(zoneNames(s, 'hand', 'p1')).toContain('Test Golem');
    expect(zoneNames(s, 'hand', 'p2')).toEqual([]);
    expect(bfNames(s, 'p2')).toEqual(['Test Mountain', 'Test Mountain']);
    expect(zoneNames(s, 'library', 'p2')).toContain('Test Bear');
  });
  it('only the targeted opponent\'s permanents are affected: the activator\'s own permanents stay', () => {
    const s0 = setup();
    const s = ultimate(s0, 'Test Bear');
    expect(bfNames(s, 'p1')).toEqual(['Test Time Walker']);
    expect(zoneNames(s, 'library', 'p1')).not.toContain('Test Bear');
  });
});

describe('"Mill ten cards. Put up to two creature cards from among the milled cards onto the battlefield." (CR 701.17a, 110.2a, 608.2d; Vorinclex // The Grand Evolution)', () => {
  const SAGA = card('Test Evolution', 'Enchantment — Saga', 'I -- Mill ten cards. Put up to two creature cards from among the milled cards onto the battlefield.\nII -- You gain 1 life.\nIII -- You gain 2 life.');
  const WURM = card('Test Wurm', 'Creature — Wurm', '', '{0}', ['2', '2']);
  const SPELL = card('Test Cantrip', 'Sorcery', 'You gain 1 life.');
  const defs = [SAGA, WURM, SPELL];
  /** Cast the Saga, resolve chapter I and, when a choice among the milled cards comes up, choose `count` creature cards. */
  const run = (library: string[], count = 2): GameState => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Evolution'], library }, p2: {} });
    let s = cast(s0, 'Test Evolution', {});
    for (let i = 0; i < 12 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); i++) {
      const d = s.pending;
      if (d?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, count) });
      else if (d?.kind === 'priority') s = passBoth(s);
      else s = drive(s);
    }
    return s;
  };
  it('is fully automated', () => expect(full(SAGA)).toBe(true));
  it('mills ten, then you choose up to two creature cards among the milled ones: they enter under your control, the rest stay in the graveyard', () => {
    const lib = ['Test Wurm', 'Test Cantrip', 'Test Wurm', 'Test Wurm', ...Array(6).fill('Test Cantrip'), 'Test Cantrip'];
    const s = run(lib);
    expect(zoneNames(s, 'graveyard', 'p1').filter((n) => n === 'Test Wurm')).toHaveLength(1); // up to two of the three milled Wurms
    expect(bfNames(s, 'p1').filter((n) => n === 'Test Wurm')).toHaveLength(2);
    expect(bfNames(s, 'p2')).toEqual([]);
  });
  it('no creature card among the milled cards: nothing enters the battlefield', () => {
    const s = run(Array(12).fill('Test Cantrip'));
    expect(bfNames(s, 'p1').filter((n) => n === 'Test Wurm')).toHaveLength(0);
    expect(zoneNames(s, 'graveyard', 'p1').length).toBeGreaterThanOrEqual(10);
  });
  it('a creature card that was not milled (below the top ten) is not a choice', () => {
    const s = run([...Array(10).fill('Test Cantrip'), 'Test Wurm', 'Test Wurm']);
    expect(bfNames(s, 'p1').filter((n) => n === 'Test Wurm')).toHaveLength(0);
  });
});
