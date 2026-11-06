/**
 * Commander coordinator D, round edh-d-101 (EDHREC ranks 5,001-10,000, group graveyard-exile-cast): each new reading played through the engine with synthetic
 * cards (invented names, design 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1; Bob (p2) is the opponent. Each test is
 * named after the rule it checks, with its negative case. CR cites checked against the Comprehensive Rules of 2026-09-25 (MagicCompRules 20260925.txt).
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { act, activations, advanceTo, card, cast, drive, full, lifeOf, obj, resolveAll, scenario } from '../r3-cost/support';
import { find, pass } from '../../m3/scenario';

describe('"If a triggered ability of another Shrine you control triggers while you control six or more Shrines, that ability triggers an additional time." (CR 603.2d, 603.2, 611.3a; Sanctum of All)', () => {
  const SANCTUM = card('Test Sanctum', 'Enchantment — Shrine', 'If a triggered ability of another Shrine you control triggers while you control six or more Shrines, that ability triggers an additional time.');
  const NEW = card('Test Bright Shrine', 'Enchantment — Shrine', 'When ~ enters, you gain 1 life.');
  const IDOL = card('Test Idol', 'Enchantment — Shrine', '');
  const NOTSHRINE = card('Test Bright Altar', 'Enchantment', 'When ~ enters, you gain 1 life.');
  const OWN = card('Test Self Sanctum', 'Enchantment — Shrine', 'When ~ enters, you gain 1 life.\nIf a triggered ability of another Shrine you control triggers while you control six or more Shrines, that ability triggers an additional time.');
  const defs = [SANCTUM, NEW, IDOL, NOTSHRINE, OWN];
  const start = (idols: number, hand = 'Test Bright Shrine', sanctum = 'Test Sanctum'): GameState => scenario([], { p1: { hand: [hand], battlefield: [sanctum, ...Array(idols).fill('Test Idol')] }, defs });
  it('has no manual part', () => expect(full(SANCTUM)).toBe(true));
  it('with six Shrines as the ability triggers (the entering one counted), the other Shrine\'s ability triggers twice', () => {
    const s = resolveAll(cast(start(4), 'Test Bright Shrine'));
    expect(lifeOf(s)).toBe(22);
  });
  it('the negative case: with five Shrines as the ability triggers it triggers once', () => {
    const s = resolveAll(cast(start(3), 'Test Bright Shrine'));
    expect(lifeOf(s)).toBe(21);
  });
  it('the negative case: an ability of a permanent that is not a Shrine is not doubled', () => {
    const s = resolveAll(cast(start(5, 'Test Bright Altar'), 'Test Bright Altar'));
    expect(lifeOf(s)).toBe(21);
  });
  it('the negative case: the Sanctum\'s own ability is not doubled ("another Shrine")', () => {
    const s0 = scenario([], { p1: { hand: ['Test Self Sanctum'], battlefield: Array(5).fill('Test Idol') }, defs });
    expect(lifeOf(resolveAll(cast(s0, 'Test Self Sanctum')))).toBe(21);
  });
});

describe('"For each opponent, choose up to one target artifact or enchantment that player controls. For each permanent chosen this way, its controller may exile it. Then if one or more of the chosen permanents are still on the battlefield, you search your library for up to that many land cards, put them onto the battlefield tapped, then shuffle." (CR 115.1, 601.2c, 101.4, 701.23a, 400.7; Disorienting Choice, ruling 2024-09-20)', () => {
  const SPELL = card('Test Puzzling Pick', 'Sorcery', 'For each opponent, choose up to one target artifact or enchantment that player controls. For each permanent chosen this way, its controller may exile it. Then if one or more of the chosen permanents are still on the battlefield, you search your library for up to that many land cards, put them onto the battlefield tapped, then shuffle.');
  const RELIC = card('Test Brass Relic', 'Artifact', '');
  const defs = [SPELL, RELIC];
  const start = (): GameState => scenario([], { p1: { hand: ['Test Puzzling Pick'] }, p2: { battlefield: ['Test Brass Relic'] }, defs });
  const lands = (s: GameState) => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.defId === 'Plains');
  it('has no manual part', () => expect(full(SPELL)).toBe(true));
  it('the opponent exiles the chosen permanent: it leaves, and no land is searched for (none of the chosen permanents is still on the battlefield)', () => {
    const s0 = start();
    const relic = find(s0, 'Test Brass Relic', 'battlefield', 'p2');
    let s1 = cast(s0, 'Test Puzzling Pick', { targets: [[obj(relic)]] });
    for (let k = 0; k < 4 && s1.pending?.kind === 'priority'; k++) s1 = pass(s1);
    expect(s1.pending?.kind).toBe('chooseObjects'); // the controller of the chosen permanent decides, not the caster
    expect(s1.pending?.player).toBe('p2');
    const s = resolveAll(drive(s1, { objects: [[relic]] }));
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Brass Relic')).toBe(false);
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Brass Relic')).toBe(true);
    expect(lands(s).length).toBe(0);
  });
  it('the negative case: the opponent keeps it; you search for up to one land card (one chosen permanent still on the battlefield), put onto the battlefield tapped', () => {
    const s0 = start();
    const relic = find(s0, 'Test Brass Relic', 'battlefield', 'p2');
    const s1 = cast(s0, 'Test Puzzling Pick', { targets: [[obj(relic)]] });
    const plains = s1.zones.library.p1!.filter((id) => s1.objects[id]!.defId === 'Plains').slice(0, 1);
    const s = resolveAll(s1, { objects: [[], plains] });
    expect(s.zones.battlefield.includes(relic)).toBe(true);
    expect(lands(s).length).toBe(1); // up to ONE land card: as many as the chosen permanents still there
    expect(s.objects[lands(s)[0]!]!.tapped).toBe(true);
  });
  it('the search finds at most that many: two land cards for one permanent still there is refused (CR 701.23a)', () => {
    const s0 = start();
    const relic = find(s0, 'Test Brass Relic', 'battlefield', 'p2');
    const s1 = cast(s0, 'Test Puzzling Pick', { targets: [[obj(relic)]] });
    const two = s1.zones.library.p1!.filter((id) => s1.objects[id]!.defId === 'Plains').slice(0, 2);
    expect(() => resolveAll(s1, { objects: [[], two] })).toThrow(/between 0 and 1/);
  });
  it('the negative case: with no permanent chosen, nothing is exiled and no land is searched for', () => {
    const s = resolveAll(cast(start(), 'Test Puzzling Pick', { targets: [[]] }));
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Brass Relic')).toBe(true);
    expect(lands(s).length).toBe(0);
  });
});

describe('"Exile a face-down permanent you control face up: You may play that card this turn." (CR 708.9, 406.3, 400.7, 601.2, 305.1; Primordial Mist, rulings 2018-07-13)', () => {
  const MIST = card('Test Fog Engine', 'Enchantment', 'Exile a face-down permanent you control face up: You may play that card this turn.');
  const BEAR = card('Test Hidden Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const FIELD = card('Test Hidden Field', 'Land', '');
  const defs = [MIST, BEAR, FIELD];
  const start = (hidden: string[], faceUp: string[] = []): GameState => {
    const s = scenario([], { p1: { battlefield: ['Test Fog Engine', ...hidden, ...faceUp] }, defs });
    for (const id of s.zones.battlefield) if (hidden.includes(s.objects[id]!.defId)) Object.assign(s.objects[id]!, { faceDown: true, faceDownInfo: { by: 'manifest', profile: 'plain' } });
    return s;
  };
  const exiled = (s: GameState, name: string) => s.zones.exile.find((id) => s.objects[id]!.defId === name);
  it('has no manual part', () => expect(full(MIST)).toBe(true));
  it('the face-down permanent is exiled face up, and you may cast that card from exile this turn (paying its costs)', () => {
    let s = start(['Test Hidden Bear']);
    expect(activations(s, 'Test Fog Engine')).toHaveLength(1);
    s = resolveAll(drive(act(s, activations(s, 'Test Fog Engine')[0]!.action)));
    const card0 = exiled(s, 'Test Hidden Bear');
    expect(card0).toBeDefined();
    expect(s.objects[card0!]!.faceDown).toBe(false); // revealed and exiled face up (CR 708.9, 406.3)
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: card0! })));
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Hidden Bear' && !s.objects[id]!.faceDown)).toBe(true);
  });
  it('a land exiled this way may be played with the land play of the turn (ruling: an available land play is needed)', () => {
    let s = start(['Test Hidden Field']);
    s = resolveAll(drive(act(s, activations(s, 'Test Fog Engine')[0]!.action)));
    const land = exiled(s, 'Test Hidden Field')!;
    s = act(s, { type: 'playLand', player: 'p1', card: land } as never);
    expect(s.zones.battlefield.includes(land) || s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Hidden Field')).toBe(true);
  });
  it('the negative case: a face-up permanent does not pay the cost (no activation is offered)', () => {
    expect(activations(start([], ['Test Hidden Bear']), 'Test Fog Engine')).toEqual([]);
  });
  it('the negative case: the card not played this turn stays exiled and can no longer be played (CR 611.2a; ruling)', () => {
    let s = start(['Test Hidden Bear']);
    s = resolveAll(drive(act(s, activations(s, 'Test Fog Engine')[0]!.action)));
    const card0 = exiled(s, 'Test Hidden Bear')!;
    s = advanceTo(s, 3, 'main1'); // Alice's next turn, her main phase: the permission of turn 1 has ended
    expect(s.zones.exile.includes(card0)).toBe(true);
    expect(() => act(s, { type: 'cast', player: 'p1', card: card0 })).toThrow();
  });
});

describe('"When ~ enters, exile cards from the top of your library until you exile a nonland card, then put that card into your hand. If the card\'s mana value is 4 or greater, repeat this process. ~ deals 1 damage to you for each card put into your hand this way." (CR 608.2c, 120.3; Demonlord Belzenlok, rulings 2018-04-27)', () => {
  const LORD = card('Test Pit Lord', 'Creature — Demon', "Flying, trample\nWhen ~ enters, exile cards from the top of your library until you exile a nonland card, then put that card into your hand. If the card's mana value is 4 or greater, repeat this process. ~ deals 1 damage to you for each card put into your hand this way.", '{0}', ['6', '6']);
  const BIG = card('Test Big Idea', 'Sorcery', 'Draw a card.', '{3}{U}{U}');
  const BIGGER = card('Test Bigger Idea', 'Sorcery', 'Draw a card.', '{4}{U}');
  const SMALL = card('Test Small Idea', 'Sorcery', 'Draw a card.', '{1}{U}');
  const defs = [LORD, BIG, BIGGER, SMALL];
  const start = (library: string[]): GameState => scenario([], { p1: { hand: ['Test Pit Lord'], library }, defs });
  const hand = (s: GameState) => s.zones.hand.p1!.map((id) => s.objects[id]!.defId);
  it('has no manual part', () => expect(full(LORD)).toBe(true));
  it('a card of mana value 4 or more repeats the process (lands passed over stay exiled); it stops at a card of 3 or less, and deals 1 damage for EACH card put into your hand, at once', () => {
    const s = resolveAll(cast(start(['Test Big Idea', 'Plains', 'Test Bigger Idea', 'Plains', 'Test Small Idea', 'Test Big Idea']), 'Test Pit Lord'));
    expect(hand(s).sort()).toEqual(['Test Big Idea', 'Test Bigger Idea', 'Test Small Idea']);
    expect(s.zones.exile.filter((id) => s.objects[id]!.defId === 'Plains').length).toBe(2);
    expect(s.zones.library.p1![0] !== undefined && s.objects[s.zones.library.p1![0]!]!.defId).toBe('Test Big Idea'); // the process stopped before it
    expect(lifeOf(s)).toBe(17);
  });
  it('the negative case: a first card of mana value 3 or less is the only one (1 damage)', () => {
    const s = resolveAll(cast(start(['Test Small Idea', 'Test Big Idea']), 'Test Pit Lord'));
    expect(hand(s)).toEqual(['Test Small Idea']);
    expect(lifeOf(s)).toBe(19);
  });
  it('the negative case: a repeat that finds no nonland card ends the process (ruling): only the cards put into your hand count', () => {
    const s = resolveAll(cast(start(['Test Big Idea']), 'Test Pit Lord')); // the rest of the library is lands
    expect(hand(s)).toEqual(['Test Big Idea']);
    expect(s.zones.library.p1!.length).toBe(0);
    expect(lifeOf(s)).toBe(19);
  });
});

describe('std-cardcopy-1\'s marker with a sentence after it (CR 608.2c; edh-d-101): the later instruction runs once, after the last run', () => {
  const RITE = card('Test Sorting Rite', 'Sorcery', 'Mill two cards. If two cards that share a card type were milled this way, draw a card and repeat this process. You gain 1 life.');
  it('is automated', () => expect(full(RITE)).toBe(true));
  it('the process runs again for as long as two lands are milled (the library is lands), and the life is gained ONCE, after the last run', () => {
    const LAND2 = card('Test Spare Bolt', 'Instant', 'Draw a card.');
    const s0 = scenario([], { p1: { hand: ['Test Sorting Rite'], library: ['Plains', 'Plains', 'Test Spare Bolt', 'Plains'] }, defs: [RITE, LAND2] });
    const s = resolveAll(cast(s0, 'Test Sorting Rite'));
    expect(lifeOf(s)).toBe(21);
    expect(s.zones.graveyard.p1!.filter((id) => s.objects[id]!.defId === 'Plains').length).toBeGreaterThan(2); // more than one run
  });
});

describe('"Exile two legendary cards from your graveyard: Until end of turn, each legendary card in your graveyard gains "You may play this card from your graveyard."" (CR 611.2c, 113.6, 601.3, 305.1, 400.7; Kethis, the Hidden Hand, rulings 2019-07-12)', () => {
  const HAND = card('Test Veiled Hand', 'Legendary Creature — Elf Advisor', 'Exile two legendary cards from your graveyard: Until end of turn, each legendary card in your graveyard gains "You may play this card from your graveyard."', '{0}', ['3', '2']);
  const HERO = card('Test Old Hero', 'Legendary Creature — Human', '', '{0}', ['2', '2']);
  const RUIN = card('Test Old Ruin', 'Legendary Land', '');
  const RELIC = card('Test Old Relic', 'Legendary Artifact', '');
  const PEON = card('Test Plain Peon', 'Creature — Human', '', '{0}', ['1', '1']);
  const SAGE = card('Test Late Sage', 'Legendary Creature — Human', '', '{0}', ['1', '1']);
  const KILL = card('Test Quick End', 'Instant', 'Destroy target creature.');
  const defs = [HAND, HERO, RUIN, RELIC, PEON, SAGE, KILL];
  const start = (): GameState => scenario([], { p1: { battlefield: ['Test Veiled Hand', { name: 'Test Late Sage' }], graveyard: ['Test Old Relic', 'Test Old Relic', 'Test Old Hero', 'Test Old Ruin', 'Test Plain Peon'], hand: ['Test Quick End'] }, defs });
  const inGy = (s: GameState, name: string) => s.zones.graveyard.p1!.find((id) => s.objects[id]!.defId === name)!;
  const activate = (s0: GameState): GameState => {
    const relics = s0.zones.graveyard.p1!.filter((id) => s0.objects[id]!.defId === 'Test Old Relic');
    return resolveAll(drive(act(s0, activations(s0, 'Test Veiled Hand')[0]!.action), { objects: [relics] }));
  };
  it('has no manual part', () => expect(full(HAND)).toBe(true));
  it('a legendary creature card in your graveyard may then be cast from there, and a legendary land played from there (with the land play of the turn)', () => {
    let s = activate(start());
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: inGy(s, 'Test Old Hero') })));
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Old Hero')).toBe(true);
    s = act(s, { type: 'playLand', player: 'p1', card: inGy(s, 'Test Old Ruin') } as never);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Old Ruin')).toBe(true);
  });
  it('the negative case: a card that is not legendary gains nothing', () => {
    const s = activate(start());
    expect(() => act(s, { type: 'cast', player: 'p1', card: inGy(s, 'Test Plain Peon') })).toThrow();
  });
  it('the negative case: a legendary card put into your graveyard after the ability resolved does not have it (ruling 2019-07-12)', () => {
    let s = activate(start());
    const sage = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Late Sage')!;
    s = resolveAll(cast(s, 'Test Quick End', { targets: [[obj(sage)]] }));
    expect(inGy(s, 'Test Late Sage')).toBeDefined();
    expect(() => act(s, { type: 'cast', player: 'p1', card: inGy(s, 'Test Late Sage') })).toThrow();
  });
  it('the negative case: without the ability, the legendary card in the graveyard cannot be cast', () => {
    const s = start();
    expect(() => act(s, { type: 'cast', player: 'p1', card: inGy(s, 'Test Old Hero') })).toThrow();
  });
  it('the negative case: it lasts until end of turn only', () => {
    const s = advanceTo(activate(start()), 3, 'main1');
    expect(() => act(s, { type: 'cast', player: 'p1', card: inGy(s, 'Test Old Hero') })).toThrow();
  });
});

describe('"Choose one -- • Destroy all creatures. • Destroy all planeswalkers. Then return a creature or planeswalker card with mana value X or less from your graveyard to the battlefield, where X is the amount of {S} spent to cast this spell." (CR 700.2, 608.2c, 107.4h, 106.1; Blood on the Snow, rulings 2021-02-05)', () => {
  const SNOWFALL = card('Test Red Snowfall', 'Sorcery', 'Choose one --\n• Destroy all creatures.\n• Destroy all planeswalkers.\nThen return a creature or planeswalker card with mana value X or less from your graveyard to the battlefield, where X is the amount of {S} spent to cast this spell.', '{2}');
  const ICE = card('Test Ice Field', 'Snow Land', '{T}: Add {C}.');
  const MUD = card('Test Mud Field', 'Land', '{T}: Add {C}.');
  const TWO = card('Test Two Drop', 'Creature — Bear', '', '{2}', ['2', '2']);
  const THREE = card('Test Three Drop', 'Creature — Bear', '', '{3}', ['3', '3']);
  const ZERO = card('Test Zero Drop', 'Artifact Creature — Golem', '', '{0}', ['0', '1']);
  const OGRE = card('Test Field Ogre', 'Creature — Ogre', '', '{4}', ['4', '4']);
  const defs = [SNOWFALL, ICE, MUD, TWO, THREE, ZERO, OGRE];
  const start = (lands: string[]): GameState => scenario([], { p1: { hand: ['Test Red Snowfall'], battlefield: [...lands, 'Test Field Ogre'], graveyard: ['Test Two Drop', 'Test Three Drop', 'Test Zero Drop'] }, defs });
  const onBf = (s: GameState, name: string) => s.zones.battlefield.some((id) => s.objects[id]!.defId === name);
  it('has no manual part', () => expect(full(SNOWFALL)).toBe(true));
  it('two {S} spent: all creatures are destroyed, then a creature card with mana value 2 or less returns (a card of 3 can not be chosen)', () => {
    const s0 = cast(start(['Test Ice Field', 'Test Ice Field']), 'Test Red Snowfall');
    let s = s0;
    for (let k = 0; k < 4 && s.pending?.kind === 'priority'; k++) s = pass(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    const offered = (s.pending as { options: string[] }).options.map((id) => s.objects[id]!.defId).sort();
    expect(offered).toEqual(['Test Two Drop', 'Test Zero Drop']);
    s = resolveAll(drive(s, { objects: [[s.zones.graveyard.p1!.find((id) => s.objects[id]!.defId === 'Test Two Drop')!]] }));
    expect(onBf(s, 'Test Field Ogre')).toBe(false);
    expect(onBf(s, 'Test Two Drop')).toBe(true);
  });
  it('the negative case: with no snow mana spent X is 0: only a card of mana value 0 can return (ruling)', () => {
    const s0 = cast(start(['Test Mud Field', 'Test Mud Field']), 'Test Red Snowfall');
    let s = s0;
    for (let k = 0; k < 4 && s.pending?.kind === 'priority'; k++) s = pass(s);
    s = resolveAll(drive(s)); // the one card that can return is chosen without a question
    expect(onBf(s, 'Test Zero Drop')).toBe(true);
    expect(onBf(s, 'Test Two Drop')).toBe(false);
  });
  it('the last part happens with the planeswalker mode too (ruling): the creatures stay, a card still returns', () => {
    const s0 = start(['Test Ice Field', 'Test Ice Field']);
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Red Snowfall', 'hand', 'p1') });
    if (s.pending?.kind === 'chooseOption') s = drive(s, { options: [[(s.pending as { options: { id: string }[] }).options[1]!.id]] });
    s = drive(s);
    s = resolveAll(s, { objects: [[s.zones.graveyard.p1!.find((id) => s.objects[id]!.defId === 'Test Zero Drop')!]] });
    expect(onBf(s, 'Test Field Ogre')).toBe(true);
    expect(onBf(s, 'Test Zero Drop')).toBe(true);
  });
});

describe('The Creation of Avacyn\'s chapters: "I -- Search your library for a card, exile it face down, then shuffle. II -- Turn the exiled card face up. If it\'s a creature card, you lose life equal to its mana value. III -- You may put the exiled card onto the battlefield if it\'s a creature card. If you don\'t put it onto the battlefield, put it into its owner\'s hand." (CR 714.2b, 607.2a, 406.3, 202.3, 110.2; rulings 2024-06-07)', () => {
  const SAGA = card('Test Making Saga', 'Enchantment — Saga', "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — Search your library for a card, exile it face down, then shuffle.\nII — Turn the exiled card face up. If it's a creature card, you lose life equal to its mana value.\nIII — You may put the exiled card onto the battlefield if it's a creature card. If you don't put it onto the battlefield, put it into its owner's hand.");
  const ANGEL = card('Test Bright Angel', 'Creature — Angel', 'Flying', '{2}{W}{W}', ['4', '4']);
  const TOME = card('Test Old Tome', 'Artifact', '', '{3}');
  const defs = [SAGA, ANGEL, TOME];
  const start = (lib: string): GameState => scenario([], { p1: { hand: ['Test Making Saga'], library: [lib] }, defs });
  const chapterOne = (lib: string): GameState => {
    const s0 = start(lib);
    const s1 = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Making Saga', 'hand', 'p1') });
    const pick = s1.zones.library.p1!.find((id) => s1.objects[id]!.defId === lib)!;
    return resolveAll(drive(s1), { objects: [[pick]] });
  };
  const exiled = (s: GameState, name: string) => s.zones.exile.find((id) => s.objects[id]!.defId === name);
  it('has no manual part', () => expect(full(SAGA)).toBe(true));
  it('I exiles the card face down; II turns it face up and, a creature card, you lose life equal to its mana value; III may put it onto the battlefield', () => {
    let s = chapterOne('Test Bright Angel');
    const card0 = exiled(s, 'Test Bright Angel')!;
    expect(s.objects[card0]!.faceDown).toBe(true);
    s = resolveAll(advanceTo(s, 3, 'main1'));
    expect(s.objects[card0]!.faceDown).toBe(false);
    expect(lifeOf(s)).toBe(16);
    s = resolveAll(advanceTo(s, 5, 'main1'), { yes: [true] });
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Bright Angel' && s.objects[id]!.controller === 'p1')).toBe(true);
  });
  it('the negative case: declining at III puts the card into its owner\'s hand', () => {
    let s = chapterOne('Test Bright Angel');
    s = resolveAll(advanceTo(s, 3, 'main1'));
    s = resolveAll(advanceTo(s, 5, 'main1'), { yes: [false] });
    expect(s.zones.hand.p1!.some((id) => s.objects[id]!.defId === 'Test Bright Angel')).toBe(true);
    expect(exiled(s, 'Test Bright Angel')).toBeUndefined();
  });
  it('the negative case: a card that is not a creature card costs no life at II and goes to the hand at III (no choice)', () => {
    let s = chapterOne('Test Old Tome');
    s = resolveAll(advanceTo(s, 3, 'main1'));
    expect(lifeOf(s)).toBe(20);
    s = resolveAll(advanceTo(s, 5, 'main1'), { yes: [true] });
    expect(s.zones.hand.p1!.some((id) => s.objects[id]!.defId === 'Test Old Tome')).toBe(true);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Old Tome')).toBe(false);
  });
});

describe('"Whenever a source an opponent controls deals damage to this creature, that source\'s controller loses that much life unless they sacrifice that many permanents of their choice." (CR 118.12a, 701.21a, 119.3, 608.2h; Archfiend of Spite, rulings 2019-08-23)', () => {
  const FIEND = card('Test Spite Fiend', 'Creature — Demon', "Flying\nWhenever a source an opponent controls deals damage to this creature, that source's controller loses that much life unless they sacrifice that many permanents of their choice.", '{0}', ['5', '6']);
  const BRAWL = card('Test Brawl Call', 'Sorcery', 'Target creature you control fights target creature you don\'t control.');
  const BRUTE = card('Test Brute', 'Creature — Ogre', '', '{0}', ['3', '3']);
  const ROCK = card('Test Pebble', 'Artifact', '');
  const defs = [FIEND, BRAWL, BRUTE, ROCK];
  const start = (rocks: number): GameState => scenario([], { p1: { hand: ['Test Brawl Call'], battlefield: ['Test Spite Fiend'] }, p2: { battlefield: ['Test Brute', ...Array(rocks).fill('Test Pebble')] }, defs });
  const fight = (s0: GameState): GameState => cast(s0, 'Test Brawl Call', { targets: [[obj(find(s0, 'Test Spite Fiend', 'battlefield', 'p1'))], [obj(find(s0, 'Test Brute', 'battlefield', 'p2'))]] });
  const pebbles = (s: GameState) => s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Pebble');
  it('has no manual part', () => expect(full(FIEND)).toBe(true));
  it('the opponent may sacrifice that many permanents (3, the damage dealt) instead of losing the life', () => {
    let s = fight(start(4));
    for (let k = 0; k < 6 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; k++) s = pass(s);
    expect(s.pending?.player).toBe('p2'); // the source's controller decides
    s = resolveAll(drive(s, { yes: [true], objects: [pebbles(s).slice(0, 3)] }));
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(pebbles(s).length).toBe(1);
  });
  it('the negative case: declining the sacrifice, the opponent loses that much life (3)', () => {
    let s = fight(start(4));
    for (let k = 0; k < 6 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; k++) s = pass(s);
    s = resolveAll(drive(s, { yes: [false] }));
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(pebbles(s).length).toBe(4);
  });
  it('the negative case: a player who controls fewer permanents than that cannot sacrifice and loses the life (ruling)', () => {
    const s = resolveAll(fight(start(2)), { yes: [true] });
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(pebbles(s).length).toBe(2);
  });
});

describe('"{T}: Add {U}. When you spend this mana to cast an instant or sorcery spell with mana value 3 or less, you may exile that spell instead of putting it into its owner\'s graveyard as it resolves." and "{3}{U}{U}, {T}: You may cast any number of spells from among cards exiled with this artifact without paying their mana costs. Activate only as a sorcery." (CR 106.6, 603.2, 614.1a, 607.2a, 608.2g, 118.9; Forger\'s Foundry, rulings 2024-04-12)', () => {
  const FORGE = card('Test Spell Forge', 'Artifact', "{T}: Add {U}. When you spend this mana to cast an instant or sorcery spell with mana value 3 or less, you may exile that spell instead of putting it into its owner's graveyard as it resolves.\n{3}{U}{U}, {T}: You may cast any number of spells from among cards exiled with this artifact without paying their mana costs. Activate only as a sorcery.");
  const ZAP = card('Test Quick Study', 'Instant', 'Draw a card.', '{U}');
  const BIGZAP = card('Test Deep Study', 'Sorcery', 'Draw two cards.', '{3}{U}');
  const ISLE = card('Test Isle', 'Land', '{T}: Add {U}.');
  const defs = [FORGE, ZAP, BIGZAP, ISLE];
  const start = (hand: string[]): GameState => scenario([], { p1: { hand, battlefield: ['Test Spell Forge', ...Array(5).fill({ name: 'Test Isle', tapped: true })] }, defs });
  const tapForge = (s: GameState): GameState => drive(act(s, activations(s, 'Test Spell Forge', true)[0]!.action));
  const exiled = (s: GameState, name: string) => s.zones.exile.find((id) => s.objects[id]!.defId === name);
  const handSize = (s: GameState) => s.zones.hand.p1!.length;
  it('has no manual part', () => expect(full(FORGE)).toBe(true));
  it('a spell of mana value 3 or less cast with the mana may be exiled as it resolves; later the second ability casts it from exile without paying its mana cost', () => {
    let s = tapForge(start(['Test Quick Study']));
    s = resolveAll(cast(s, 'Test Quick Study'), { yes: [true] });
    const card0 = exiled(s, 'Test Quick Study');
    expect(card0).toBeDefined();
    s = advanceTo(s, 3, 'main1');
    const before = handSize(s);
    s = resolveAll(drive(act(s, activations(s, 'Test Spell Forge')[0]!.action), { objects: [[card0!]] }), { objects: [[card0!]] });
    expect(handSize(s)).toBe(before + 1); // the spell was cast and resolved (drew a card)
    expect(exiled(s, 'Test Quick Study')).toBeUndefined();
  });
  it('the negative case: declining, the spell goes to its owner\'s graveyard as usual', () => {
    let s = tapForge(start(['Test Quick Study']));
    s = resolveAll(cast(s, 'Test Quick Study'), { yes: [false] });
    expect(exiled(s, 'Test Quick Study')).toBeUndefined();
    expect(s.zones.graveyard.p1!.some((id) => s.objects[id]!.defId === 'Test Quick Study')).toBe(true);
  });
  it('the negative case: a spell of mana value 4 cast with the mana does not trigger it (it goes to the graveyard)', () => {
    let s = start(['Test Deep Study']);
    for (const id of s.zones.battlefield) if (s.objects[id]!.defId === 'Test Isle') s.objects[id]!.tapped = false;
    s = tapForge(s);
    s = resolveAll(cast(s, 'Test Deep Study'), { yes: [true] });
    expect(exiled(s, 'Test Deep Study')).toBeUndefined();
    expect(s.zones.graveyard.p1!.some((id) => s.objects[id]!.defId === 'Test Deep Study')).toBe(true);
  });
});
