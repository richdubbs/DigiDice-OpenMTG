/**
 * edh-zones-22 (Commander lane edh-zones): the round's readings played through the engine with synthetic cards (invented names, design 6.10). CR cites checked against the
 * 2026-09-25 text (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt).
 *
 *   CR 701.8a, 608.2c, 400.7  "Destroy up to two target creatures and/or other planeswalkers. Return each card put into a graveyard this way to the battlefield under your control." (Sorin,
 *                             Lord of Innistrad): only what was destroyed AND is a card in a graveyard; "other" goes with the planeswalkers only
 *   CR 701.21a, 608.2c, 701.20a "Whenever one or more creatures you control deal combat damage to a player, you may sacrifice one of them. If you do, reveal cards ... until you reveal a creature
 *                             card that shares a creature type with the sacrificed creature. Put that card onto the battlefield and the rest on the bottom ..." (Descendants' Fury)
 *   CR 608.2c, 701.20e, 107.3 "Look at the top seven cards. Then you may sacrifice a creature. If you do, you may put a creature card with mana value X or less from among those cards onto the
 *                             battlefield, where X is 1 plus the sacrificed creature's mana value. Put the rest on the bottom ..." (Birthing Ritual)
 *   CR 305.1, 305.2, 601.3, 614.1c "Once during each of your turns, you may play a land from your graveyard or cast a permanent spell with mana value 3 or less from your graveyard. If you do, it
 *                             gains ..." (Serra Paragon): ONE use for both, the rider on the land and on the permanent the spell becomes
 *   CR 508.4, 701.20e "Whenever ~ attacks, look at defending player's hand. You may put a creature card from it onto the battlefield under your control tapped and attacking that player
 *                             or a planeswalker they control. Return that creature to its owner's hand at the beginning of the next end step." (Zara, Renegade Recruiter)
 *   CR 701.20a, 107.3, 603.2  "When you cast this spell, reveal cards from the top of your library until you reveal X creature cards. Put all creature cards revealed this way into your graveyard, then
 *                             put the rest on the bottom ..." (Old Stickfingers)
 *   CR 400.7, 404.1, 603.1    "choose target artifact or creature card in an opponent's graveyard that was put there from their library this turn. Put it onto the battlefield under your control."
 *                             (Captain N'ghathrod)
 *   CR 707.12, 608.2d, 406.1  "mill two cards, then exile a nonland card at random from your graveyard. Copy it. You may cast the copy without paying its mana cost." (Wondrous Crucible)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { put, pass, advanceTo, answer } from '../../m3/scenario';
import { act, card, cast, drive, find, full, lifeOf, obj, resolveAll, scenario } from '../r3-cost/support';
import { getChars } from '../../../src/rules/characteristics';

const nameOf = (s: GameState, id: string): string => getChars(s, id).name;
const zoneNames = (s: GameState, z: 'hand' | 'graveyard' | 'library', p: 'p1' | 'p2'): string[] => s.zones[z][p]!.map((id) => nameOf(s, id));
const bfNames = (s: GameState, p?: 'p1' | 'p2'): string[] => s.zones.battlefield.filter((id) => p === undefined || s.objects[id]!.controller === p).map((id) => nameOf(s, id)).sort();
const exileNames = (s: GameState): string[] => s.zones.exile.map((id) => nameOf(s, id)).sort();
const walker = (name: string, text: string, loyalty = '5'): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Testy', loyalty, colors: [], keywords: [], oracle_text: text } as unknown as OracleCard);

describe('"Destroy up to two target creatures and/or other planeswalkers. Return each card put into a graveyard this way to the battlefield under your control." (CR 701.8a, 608.2c, 400.7; Sorin, Lord of Innistrad)', () => {
  const MAGUS = walker('Test Vampire Magus', '+1: You gain 1 life.\n−3: Destroy up to two target creatures and/or other planeswalkers. Return each card put into a graveyard this way to the battlefield under your control.');
  const BEAR = card('Test Grizzly', 'Creature — Bear', '', '{0}', ['2', '2']);
  const STONE = card('Test Stone Wall', 'Creature — Wall', 'Indestructible', '{0}', ['0', '4']);
  const OTHERWALK = walker('Test Plain Walker', '+1: You gain 1 life.');
  const MAKER = card('Test Token Maker', 'Creature — Elf', '', '{0}', ['1', '1']);
  const defs = [MAGUS, BEAR, STONE, OTHERWALK, MAKER];
  const ultimate = (s: GameState, targets: ObjectId[]): GameState => {
    const source = find(s, 'Test Vampire Magus', 'battlefield', 'p1');
    const a = legalActions(s, 'p1').find((l) => l.kind === 'activate' && l.object === source && l.label.includes('Destroy'))!;
    return resolveAll(drive(act(s, a.action), { targets: [targets.map(obj)] }));
  };
  it('is fully automated', () => expect(full(MAGUS)).toBe(true));
  it('destroys the creature and the other planeswalker and returns both to the battlefield under YOUR control', () => {
    const s0 = scenario([], { defs, p1: { battlefield: [{ name: 'Test Vampire Magus', counters: { loyalty: 5 } }] }, p2: { battlefield: ['Test Grizzly', { name: 'Test Plain Walker', counters: { loyalty: 5 } }] } });
    const s = ultimate(s0, [find(s0, 'Test Grizzly', 'battlefield', 'p2'), find(s0, 'Test Plain Walker', 'battlefield', 'p2')]);
    expect(bfNames(s, 'p1')).toEqual(['Test Grizzly', 'Test Plain Walker', 'Test Vampire Magus']);
    expect(bfNames(s, 'p2')).toEqual([]);
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual([]);
  });
  it('an indestructible creature is not destroyed, so no card of it was put into a graveyard: it stays with its controller', () => {
    const s0 = scenario([], { defs, p1: { battlefield: [{ name: 'Test Vampire Magus', counters: { loyalty: 5 } }] }, p2: { battlefield: ['Test Stone Wall', 'Test Grizzly'] } });
    const s = ultimate(s0, [find(s0, 'Test Stone Wall', 'battlefield', 'p2'), find(s0, 'Test Grizzly', 'battlefield', 'p2')]);
    expect(bfNames(s, 'p2')).toEqual(['Test Stone Wall']);
    expect(bfNames(s, 'p1')).toEqual(['Test Grizzly', 'Test Vampire Magus']);
  });
  it('a token that is destroyed is no card in a graveyard: it is not returned (CR 111.7)', () => {
    const s0 = scenario([], { defs, p1: { battlefield: [{ name: 'Test Vampire Magus', counters: { loyalty: 5 } }] }, p2: { battlefield: ['Test Grizzly'] } });
    const bear = find(s0, 'Test Grizzly', 'battlefield', 'p2');
    s0.objects[bear]!.kind = 'token';
    const s = ultimate(s0, [bear]);
    expect(bfNames(s, 'p1')).toEqual(['Test Vampire Magus']);
    expect(bfNames(s, 'p2')).toEqual([]);
  });
  it('"other": the planeswalker itself is not a legal target, a creature is; a planeswalker of the other player is', () => {
    const s0 = scenario([], { defs, p1: { battlefield: [{ name: 'Test Vampire Magus', counters: { loyalty: 5 } }, 'Test Token Maker'] }, p2: { battlefield: [{ name: 'Test Plain Walker', counters: { loyalty: 5 } }] } });
    const source = find(s0, 'Test Vampire Magus', 'battlefield', 'p1');
    const a = legalActions(s0, 'p1').find((l) => l.kind === 'activate' && l.object === source && l.label.includes('Destroy'))!;
    const s = act(s0, a.action);
    expect(s.pending?.kind).toBe('chooseTargets');
    const options = (s.pending as { objects: string[] }).objects.map((id) => nameOf(s, id));
    expect(options.sort()).toEqual(['Test Plain Walker', 'Test Token Maker']);
  });
});

import { declareAttackers, declareBlockers, toDeclareAttackers } from '../../m4/helpers';
import type { Script } from '../r3-cost/support';

/** Attack with `attackers` (no blocks) and pass priority through combat, answering what comes up with `script`; stops at the end of combat. */
function combat(s0: GameState, attackers: ObjectId[], script: Script = {}): GameState {
  let s = declareAttackers(toDeclareAttackers(s0), attackers.map((a) => [a] as [ObjectId]));
  for (let i = 0; i < 80; i++) {
    const d = s.pending;
    if (!d) throw new Error('no decision');
    if (d.kind === 'declareBlockers') s = declareBlockers(s, []);
    else if (d.kind === 'priority') {
      if (s.turn.step === 'endCombat') return s;
      s = pass(s);
    } else s = drive(s, script);
  }
  throw new Error('combat did not finish');
}
const libTop = (s: GameState, p: 'p1' | 'p2', n: number): string[] => s.zones.library[p]!.slice(0, n).map((id) => nameOf(s, id));
const libBottom = (s: GameState, p: 'p1' | 'p2', n: number): string[] => s.zones.library[p]!.slice(-n).map((id) => nameOf(s, id)).sort();

describe('"Whenever one or more creatures you control deal combat damage to a player, you may sacrifice one of them. If you do, reveal cards from the top of your library until you reveal a creature card that shares a creature type with the sacrificed creature. Put that card onto the battlefield and the rest on the bottom of your library in a random order." (CR 701.21a, 608.2c, 701.20a; Descendants\' Fury)', () => {
  const FURY = card('Test Kin Altar', 'Enchantment', 'Whenever one or more creatures you control deal combat damage to a player, you may sacrifice one of them. If you do, reveal cards from the top of your library until you reveal a creature card that shares a creature type with the sacrificed creature. Put that card onto the battlefield and the rest on the bottom of your library in a random order.');
  const SCOUT = card('Test Elf Scout', 'Creature — Elf Scout', '', '{0}', ['1', '1']);
  const RAIDER = card('Test Goblin Raider', 'Creature — Goblin Warrior', '', '{0}', ['2', '2']);
  const IDLER = card('Test Idle Elf', 'Creature — Elf', '', '{0}', ['1', '1']);
  const WOLF = card('Test Dire Wolf', 'Creature — Wolf', '', '{0}', ['3', '3']);
  const DRUID = card('Test Elf Druid', 'Creature — Elf Druid', '', '{0}', ['0', '1']);
  const CHANGE = card('Test Shape Sprite', 'Creature — Shapeshifter', 'Changeling', '{0}', ['1', '1']);
  const SPELL = card('Test Fizzle', 'Sorcery', 'You gain 1 life.');
  const defs = [FURY, SCOUT, RAIDER, IDLER, WOLF, DRUID, CHANGE, SPELL];
  const setup = (library: string[], opts: { bf?: string[] } = {}): GameState =>
    scenario([], { defs, p1: { battlefield: ['Test Kin Altar', ...(opts.bf ?? ['Test Elf Scout', 'Test Goblin Raider'])], library }, p2: {} });
  it('is fully automated', () => expect(full(FURY)).toBe(true));
  it('sacrifices one creature that dealt combat damage, reveals until a creature card sharing a type, puts it onto the battlefield and the rest on the bottom', () => {
    const s0 = setup(['Test Dire Wolf', 'Test Fizzle', 'Test Elf Druid']);
    const scout = find(s0, 'Test Elf Scout', 'battlefield', 'p1');
    const raider = find(s0, 'Test Goblin Raider', 'battlefield', 'p1');
    const s = combat(s0, [scout, raider], { yes: [true], objects: [[scout]] });
    expect(lifeOf(s, 'p2')).toBe(17); // both dealt their damage
    expect(bfNames(s, 'p1')).toEqual(['Test Elf Druid', 'Test Goblin Raider', 'Test Kin Altar']);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Elf Scout']);
    expect(libBottom(s, 'p1', 2)).toEqual(['Test Dire Wolf', 'Test Fizzle']); // the cards revealed that were not put onto the battlefield
    expect(zoneNames(s, 'library', 'p1').slice(0, 3)).toEqual(['Plains', 'Plains', 'Plains']);
  });
  it('declining the sacrifice does nothing: nothing is revealed, the library is as it was', () => {
    const s0 = setup(['Test Dire Wolf', 'Test Elf Druid']);
    const scout = find(s0, 'Test Elf Scout', 'battlefield', 'p1');
    const s = combat(s0, [scout], { yes: [false] });
    expect(bfNames(s, 'p1')).toEqual(['Test Elf Scout', 'Test Goblin Raider', 'Test Kin Altar']);
    expect(libTop(s, 'p1', 2)).toEqual(['Test Dire Wolf', 'Test Elf Druid']);
  });
  it('only a creature that dealt combat damage can be sacrificed: the creature that did not attack is not offered', () => {
    const s0 = setup(['Test Elf Druid'], { bf: ['Test Elf Scout', 'Test Goblin Raider', 'Test Idle Elf'] });
    const scout = find(s0, 'Test Elf Scout', 'battlefield', 'p1');
    const raider = find(s0, 'Test Goblin Raider', 'battlefield', 'p1');
    const idle = find(s0, 'Test Idle Elf', 'battlefield', 'p1');
    let s = declareAttackers(toDeclareAttackers(s0), [[scout], [raider]]);
    for (let i = 0; i < 20 && s.pending?.kind !== 'yesNo'; i++) s = s.pending?.kind === 'declareBlockers' ? declareBlockers(s, []) : pass(s);
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.pending?.kind).toBe('chooseObjects');
    expect((s.pending as { options: ObjectId[] }).options.sort()).toEqual([scout, raider].sort()); // not the idle Elf
    expect((s.pending as { options: ObjectId[] }).options).not.toContain(idle);
  });
  it('a changeling is every creature type: the first creature card that shares one of the sacrificed creature\'s types is the one put onto the battlefield (CR 702.73a)', () => {
    const s0 = setup(['Test Dire Wolf', 'Test Shape Sprite'], { bf: ['Test Elf Scout'] });
    const scout = find(s0, 'Test Elf Scout', 'battlefield', 'p1');
    const s = combat(s0, [scout], { yes: [true], objects: [[scout]] });
    expect(bfNames(s, 'p1')).toEqual(['Test Kin Altar', 'Test Shape Sprite']);
    expect(libBottom(s, 'p1', 1)).toEqual(['Test Dire Wolf']);
  });
  it('with no creature card in the library sharing a type, every card is revealed and none is put onto the battlefield', () => {
    const s0 = setup(['Test Dire Wolf', 'Test Fizzle'], { bf: ['Test Elf Scout'] });
    s0.zones.library.p1 = s0.zones.library.p1!.slice(0, 2); // only those two cards
    const scout = find(s0, 'Test Elf Scout', 'battlefield', 'p1');
    const s = combat(s0, [scout], { yes: [true], objects: [[scout]] });
    expect(bfNames(s, 'p1')).toEqual(['Test Kin Altar']);
    expect(libBottom(s, 'p1', 2)).toEqual(['Test Dire Wolf', 'Test Fizzle']);
  });
});

describe('"Look at the top seven cards of your library. Then you may sacrifice a creature. If you do, you may put a creature card with mana value X or less from among those cards onto the battlefield, where X is 1 plus the sacrificed creature\'s mana value. Put the rest on the bottom of your library in a random order." (CR 608.2c, 701.20e, 107.3, 401.4; Birthing Ritual)', () => {
  const RITE = card('Test Birth Rite', 'Enchantment', "At the beginning of your end step, if you control a creature, look at the top seven cards of your library. Then you may sacrifice a creature. If you do, you may put a creature card with mana value X or less from among those cards onto the battlefield, where X is 1 plus the sacrificed creature's mana value. Put the rest on the bottom of your library in a random order.");
  const TWO = card('Test Two Drop', 'Creature — Bear', '', '{2}', ['2', '2']);
  const THREE = card('Test Three Drop', 'Creature — Cat', '', '{3}', ['3', '3']);
  const FOUR = card('Test Four Drop', 'Creature — Dog', '', '{4}', ['4', '4']);
  const defs = [RITE, TWO, THREE, FOUR];
  const library = ['Test Four Drop', 'Test Three Drop', 'Test Fizzle', 'Test Three Drop', 'Test Four Drop', 'Test Two Drop', 'Test Fizzle'];
  const SPELL2 = card('Test Fizzle', 'Sorcery', 'You gain 1 life.');
  const at = (bf: string[]): GameState => advanceTo(scenario([], { defs: [...defs, SPELL2], p1: { battlefield: ['Test Birth Rite', ...bf], library }, p2: {} }), 1, 'end');
  it('is fully automated', () => expect(full(RITE)).toBe(true));
  it('sacrificing a mana value 2 creature allows a mana value 3 card but not a mana value 4 card; the rest of the seven go to the bottom', () => {
    const s0 = at(['Test Two Drop']);
    const three = s0.zones.library.p1![1]!;
    const s = resolveAll(s0, { yes: [true], objects: [[three]] });
    expect(bfNames(s, 'p1')).toEqual(['Test Birth Rite', 'Test Three Drop']);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Two Drop']);
    // the six cards that were not put onto the battlefield are at the bottom, behind the 20 Plains
    expect(zoneNames(s, 'library', 'p1').slice(0, 20)).toEqual(Array(20).fill('Plains'));
    expect(zoneNames(s, 'library', 'p1').slice(20).sort()).toEqual(['Test Fizzle', 'Test Fizzle', 'Test Four Drop', 'Test Four Drop', 'Test Three Drop', 'Test Two Drop']);
  });
  it('only a card of mana value 3 or less is offered: the mana value 4 cards are not', () => {
    const s0 = at(['Test Two Drop']);
    let s = s0;
    for (let i = 0; i < 12 && s.pending?.kind !== 'chooseObjects'; i++) s = s.pending?.kind === 'priority' ? pass(s) : s.pending?.kind === 'yesNo' ? answer(s, { kind: 'yesNo', yes: true }) : s;
    expect(s.pending?.kind).toBe('chooseObjects');
    expect((s.pending as { options: ObjectId[] }).options.map((id) => nameOf(s, id)).sort()).toEqual(['Test Three Drop', 'Test Three Drop', 'Test Two Drop']);
  });
  it('declining the sacrifice still puts all seven cards on the bottom (the instruction after the "if you do")', () => {
    const s0 = at(['Test Two Drop']);
    const s = resolveAll(s0, { yes: [false] });
    expect(bfNames(s, 'p1')).toEqual(['Test Birth Rite', 'Test Two Drop']);
    expect(zoneNames(s, 'library', 'p1').slice(0, 20)).toEqual(Array(20).fill('Plains'));
    expect(zoneNames(s, 'library', 'p1').slice(20).length).toBe(7);
  });
  it('sacrificing and then putting no card (declining the choice) still sends the seven to the bottom', () => {
    const s0 = at(['Test Two Drop']);
    const s = resolveAll(s0, { yes: [true], objects: [[]] });
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Two Drop']);
    expect(bfNames(s, 'p1')).toEqual(['Test Birth Rite']);
    expect(zoneNames(s, 'library', 'p1').slice(20).length).toBe(7);
  });
  it('without a creature the intervening if is false: nothing is looked at', () => {
    const s0 = at([]);
    const s = resolveAll(s0, {});
    expect(zoneNames(s, 'library', 'p1').slice(0, 7)).toEqual(library);
  });
});

describe('"Once during each of your turns, you may play a land from your graveyard or cast a permanent spell with mana value 3 or less from your graveyard. If you do, it gains \\"When this permanent is put into a graveyard from the battlefield, exile it and you gain 2 life.\\"" (CR 305.1, 305.2, 601.3, 614.1c, 611.2; Serra Paragon)', () => {
  const PARAGON = card('Test Grave Paragon', 'Creature — Angel', 'Flying\nOnce during each of your turns, you may play a land from your graveyard or cast a permanent spell with mana value 3 or less from your graveyard. If you do, it gains "When this permanent is put into a graveyard from the battlefield, exile it and you gain 2 life."', '{0}', ['3', '3']);
  const BEAR = card('Test Dead Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const OGRE = card('Test Dead Ogre', 'Creature — Ogre', '', '{4}', ['4', '4']);
  const RELIC = card('Test Dead Relic', 'Artifact', '', '{2}');
  const HEX = card('Test Dead Hex', 'Sorcery', 'You gain 1 life.', '{1}');
  const FLASHER = card('Test Dead Flash', 'Creature — Bat', 'Flash', '{1}', ['1', '1']);
  const CAVE = card('Test Dead Cave', 'Land', '');
  const CAVE2 = card('Test Dead Cliffs', 'Land', '');
  const SMITE = card('Test Smite', 'Instant', 'Destroy target permanent.', '{0}');
  const HAND_BEAR = card('Test Hand Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const defs = [PARAGON, BEAR, OGRE, RELIC, HEX, FLASHER, CAVE, CAVE2, SMITE, HAND_BEAR];
  const game = (o: { gy?: string[]; hand?: string[]; bf?: string[] } = {}): GameState =>
    scenario([], { defs, p1: { battlefield: ['Test Grave Paragon', 'Plains', 'Plains', 'Plains', ...(o.bf ?? [])], graveyard: o.gy ?? [], hand: o.hand ?? [] }, p2: { battlefield: [] } });
  const castFromGy = (s: GameState, name: string) => legalActions(s, 'p1').filter((l) => l.kind === 'cast' && l.object === find(s, name, 'graveyard', 'p1'));
  const landFromGy = (s: GameState, name: string) => legalActions(s, 'p1').filter((l) => l.kind === 'playLand' && l.object === find(s, name, 'graveyard', 'p1'));
  const play = (s: GameState, l: { action: Parameters<typeof act>[1] }): GameState => resolveAll(drive(act(s, l.action)));
  const used = (s: GameState): number => Object.entries(s.turnActivations).filter(([k]) => k.includes('|gy:')).reduce((n, [, v]) => n + v, 0);
  const grantedTriggers = (s: GameState, id: ObjectId): number => getChars(s, id).abilities.filter((a) => a.def.kind === 'triggered' && /exile it/.test(a.def.text)).length;
  const smite = (s: GameState, id: ObjectId): GameState => resolveAll(cast(s, 'Test Smite', { targets: [[obj(id)]] }));
  it('is fully automated', () => expect(full(PARAGON)).toBe(true));
  it('plays a land from the graveyard (the land drop); it has the trigger, so when it is put into a graveyard it is exiled and you gain 2 life', () => {
    const s0 = game({ gy: ['Test Dead Cave'], hand: ['Test Smite'] });
    const [a] = landFromGy(s0, 'Test Dead Cave');
    expect(a).toBeDefined();
    let s = play(s0, a!);
    const cave = find(s, 'Test Dead Cave', 'battlefield', 'p1');
    expect(s.players.find((p) => p.id === 'p1')!.landsPlayedThisTurn).toBe(1);
    expect(used(s)).toBe(1);
    expect(grantedTriggers(s, cave)).toBe(1);
    s = smite(s, cave);
    expect(lifeOf(s, 'p1')).toBe(22);
    expect(exileNames(s)).toEqual(['Test Dead Cave']);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Smite']);
  });
  it('casts a permanent spell with mana value 3 or less (paying its cost); the permanent has the trigger', () => {
    const s0 = game({ gy: ['Test Dead Bear'], hand: ['Test Smite'] });
    const [a] = castFromGy(s0, 'Test Dead Bear');
    expect(a).toBeDefined();
    let s = play(s0, a!);
    const bear = find(s, 'Test Dead Bear', 'battlefield', 'p1');
    expect(used(s)).toBe(1);
    expect(grantedTriggers(s, bear)).toBe(1);
    expect(s.objects[bear]!.cast?.from).toBe('graveyard');
    s = smite(s, bear);
    expect(lifeOf(s, 'p1')).toBe(22);
    expect(exileNames(s)).toEqual(['Test Dead Bear']);
  });
  it('an artifact spell works too, and a creature cast from the HAND (or put there some other way) has no such trigger', () => {
    const s0 = game({ gy: ['Test Dead Relic'], hand: ['Test Hand Bear'] });
    const s = play(s0, castFromGy(s0, 'Test Dead Relic')[0]!);
    expect(grantedTriggers(s, find(s, 'Test Dead Relic', 'battlefield', 'p1'))).toBe(1);
    const t = resolveAll(cast(s, 'Test Hand Bear'));
    expect(grantedTriggers(t, find(t, 'Test Hand Bear', 'battlefield', 'p1'))).toBe(0);
  });
  it('mana value 4 is too much, an instant or a sorcery is no permanent spell, and nothing is offered for a land that is not in the graveyard', () => {
    const s0 = game({ gy: ['Test Dead Ogre', 'Test Dead Hex'], hand: ['Test Hand Bear'] });
    expect(castFromGy(s0, 'Test Dead Ogre')).toEqual([]);
    expect(castFromGy(s0, 'Test Dead Hex')).toEqual([]);
    expect(legalActions(s0, 'p1').some((l) => l.kind === 'cast' && l.object === find(s0, 'Test Hand Bear', 'hand', 'p1'))).toBe(true); // a spell from the hand is offered as usual
  });
  it('ONE use a turn for both: after a land from the graveyard, no spell from the graveyard this turn (and the other way round)', () => {
    const s0 = game({ gy: ['Test Dead Cave', 'Test Dead Bear', 'Test Dead Cliffs'] });
    const land = play(s0, landFromGy(s0, 'Test Dead Cave')[0]!);
    expect(castFromGy(land, 'Test Dead Bear')).toEqual([]);
    expect(landFromGy(land, 'Test Dead Cliffs')).toEqual([]);
    const spell = play(s0, castFromGy(s0, 'Test Dead Bear')[0]!);
    expect(landFromGy(spell, 'Test Dead Cave')).toEqual([]);
    expect(castFromGy(spell, 'Test Dead Cliffs')).toEqual([]);
    expect(used(spell)).toBe(1);
  });
  it('the next turn of yours the use is back', () => {
    const s0 = game({ gy: ['Test Dead Cave', 'Test Dead Bear'] });
    let s = play(s0, landFromGy(s0, 'Test Dead Cave')[0]!);
    s = advanceTo(s, 3, 'main1');
    expect(s.turn.activePlayer).toBe('p1');
    expect(castFromGy(s, 'Test Dead Bear').length).toBeGreaterThan(0);
  });
  it('only during your turns: on the opponent\'s turn a flash creature is not castable from the graveyard (CR 611.3a, 500.1)', () => {
    const s0 = game({ gy: ['Test Dead Flash'] });
    expect(castFromGy(s0, 'Test Dead Flash').length).toBeGreaterThan(0); // your own turn: even the flash creature is cast with the permission
    const t = advanceTo(s0, 2, 'upkeep');
    expect(t.turn.activePlayer).toBe('p2');
    expect(castFromGy(pass(t), 'Test Dead Flash')).toEqual([]);
  });
  it('a spell with {X} is judged with the X chosen (CR 202.3e, 601.3e): X may be 0..2 for mana value 3 or less, never 3 or more', () => {
    const XB = card('Test X Bear', 'Creature — Bear', '', '{X}{1}', ['2', '2']);
    const s0 = scenario([], { defs: [PARAGON, XB], p1: { battlefield: ['Test Grave Paragon', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'], graveyard: ['Test X Bear'], hand: [] }, p2: { battlefield: [] } });
    const [a] = castFromGy(s0, 'Test X Bear');
    expect(a).toBeDefined();
    const pending = act(s0, a!.action).pending as { min?: number; max?: number; options?: number[] } | undefined;
    expect(pending?.max ?? Math.max(...(pending?.options ?? [0]))).toBe(2);
  });
  it('another permission for a land from the graveyard is used first, so the land does not cost the Paragon use for a spell (review)', () => {
    const MULD = card('Test Grave Seer', 'Creature — Shade', 'During each of your turns, you may play a land and cast a permanent spell of each permanent type from your graveyard.', '{0}', ['3', '2']);
    for (const order of [['Test Grave Paragon', 'Test Grave Seer'], ['Test Grave Seer', 'Test Grave Paragon']]) {
      const s0 = scenario([], { defs: [PARAGON, MULD, BEAR, CAVE], p1: { battlefield: [...order, 'Plains', 'Plains', 'Plains'], graveyard: ['Test Dead Cave', 'Test Dead Bear'], hand: [] }, p2: { battlefield: [] } });
      const land = landFromGy(s0, 'Test Dead Cave');
      expect(land.length).toBe(1);
      const s = play(s0, land[0]!);
      expect(grantedTriggers(s, find(s, 'Test Dead Cave', 'battlefield', 'p1'))).toBe(0); // the other permission was used
      expect(castFromGy(s, 'Test Dead Bear').length).toBeGreaterThan(0); // and the Paragon use is still there
    }
  });
  it('the land drop is a rule of its own: with your land for the turn played, the land from the graveyard is refused and the use is not spent', () => {
    const s0 = game({ gy: ['Test Dead Cave', 'Test Dead Bear'], hand: ['Plains'] });
    const hand = legalActions(s0, 'p1').find((l) => l.kind === 'playLand' && l.object === find(s0, 'Plains', 'hand', 'p1'))!;
    const s = play(s0, hand);
    expect(landFromGy(s, 'Test Dead Cave')).toEqual([]);
    expect(used(s)).toBe(0);
    expect(castFromGy(s, 'Test Dead Bear').length).toBeGreaterThan(0); // the use is still there for a spell
  });
  it('two Paragons are two permissions, each once a turn (CR 400.7: the use belongs to the object)', () => {
    const s0 = game({ gy: ['Test Dead Cave', 'Test Dead Bear', 'Test Dead Relic'], bf: ['Test Grave Paragon'] });
    const land = play(s0, landFromGy(s0, 'Test Dead Cave')[0]!);
    expect(used(land)).toBe(1);
    const both = play(land, castFromGy(land, 'Test Dead Bear')[0]!);
    expect(used(both)).toBe(2);
    expect(grantedTriggers(both, find(both, 'Test Dead Bear', 'battlefield', 'p1'))).toBe(1);
    expect(castFromGy(both, 'Test Dead Relic')).toEqual([]); // both uses are spent
  });
  it('no Paragon on the battlefield, no permission; the trigger stays on a permanent already given it', () => {
    const s0 = game({ gy: ['Test Dead Bear', 'Test Dead Cave'], hand: ['Test Smite'] });
    const s1 = play(s0, castFromGy(s0, 'Test Dead Bear')[0]!);
    const bear = find(s1, 'Test Dead Bear', 'battlefield', 'p1');
    const s2 = smite(s1, find(s1, 'Test Grave Paragon', 'battlefield', 'p1'));
    expect(bfNames(s2, 'p1')).not.toContain('Test Grave Paragon');
    expect(grantedTriggers(s2, bear)).toBe(1); // it keeps the ability (CR 611.2, the effect of a replacement-like rider)
    expect(landFromGy(s2, 'Test Dead Cave')).toEqual([]);
  });
});

describe('"Whenever ~ attacks, look at defending player\'s hand. You may put a creature card from it onto the battlefield under your control tapped and attacking that player or a planeswalker they control. Return that creature to its owner\'s hand at the beginning of the next end step." (CR 508.4, 701.20e; Zara, Renegade Recruiter)', () => {
  const CAPTAIN = card('Test Raid Captain', 'Creature — Pirate', "Flying\nWhenever ~ attacks, look at defending player's hand. You may put a creature card from it onto the battlefield under your control tapped and attacking that player or a planeswalker they control. Return that creature to its owner's hand at the beginning of the next end step.", '{0}', ['2', '2']);
  const GIANT = card('Test Foe Giant', 'Creature — Giant', '', '{0}', ['5', '5']);
  const SCRAP = card('Test Foe Scrap', 'Artifact', '');
  const WALK = walker('Test Foe Walker', '+1: You gain 1 life.');
  const defs = [CAPTAIN, GIANT, SCRAP, WALK];
  const setup = (p2: { hand?: string[]; battlefield?: (string | { name: string; counters: Record<string, number> })[] }): GameState =>
    scenario([], { defs, p1: { battlefield: ['Test Raid Captain'] }, p2 });
  it('is fully automated', () => expect(full(CAPTAIN)).toBe(true));
  it('puts the creature card from the defending player\'s hand onto the battlefield under your control, tapped and attacking; it deals combat damage; at the end step it goes back to its owner\'s hand', () => {
    const s0 = setup({ hand: ['Test Foe Giant', 'Test Foe Scrap'] });
    const cap = find(s0, 'Test Raid Captain', 'battlefield', 'p1');
    const giant = find(s0, 'Test Foe Giant', 'hand', 'p2');
    let s = declareAttackers(toDeclareAttackers(s0), [[cap]]);
    for (let i = 0; i < 20 && s.pending?.kind !== 'yesNo' && s.pending?.kind !== 'chooseObjects'; i++) s = s.pending?.kind === 'declareBlockers' ? declareBlockers(s, []) : pass(s);
    // the hand is looked at; only the creature card is offered (the artifact is not)
    for (let i = 0; i < 6 && s.pending?.kind === 'yesNo'; i++) s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.pending?.kind).toBe('chooseObjects');
    expect((s.pending as { options: ObjectId[] }).options).toEqual([giant]);
    s = answer(s, { kind: 'chooseObjects', ids: [giant] });
    const newGiant = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Foe Giant')!;
    expect(s.objects[newGiant]!.controller).toBe('p1');
    expect(s.objects[newGiant]!.tapped).toBe(true);
    expect(s.objects[newGiant]!.owner).toBe('p2');
    expect(s.combat?.attackers.some((a) => a.id === newGiant && a.defender === 'p2')).toBe(true);
    // combat goes on: the unblocked creatures deal damage
    for (let i = 0; i < 30 && s.turn.step !== 'endCombat'; i++) s = s.pending?.kind === 'declareBlockers' ? declareBlockers(s, []) : s.pending?.kind === 'priority' ? pass(s) : drive(s);
    expect(lifeOf(s, 'p2')).toBe(13); // 20 - 2 (the captain) - 5 (the giant)
    for (let i = 0; i < 30 && s.turn.step !== 'end'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    expect(zoneNames(s, 'hand', 'p2')).toContain('Test Foe Giant'); // back in its owner's hand
    expect(bfNames(s, 'p1')).toEqual(['Test Raid Captain']);
  });
  it('declining puts nothing onto the battlefield and returns nothing', () => {
    const s0 = setup({ hand: ['Test Foe Giant'] });
    const cap = find(s0, 'Test Raid Captain', 'battlefield', 'p1');
    let s = declareAttackers(toDeclareAttackers(s0), [[cap]]);
    for (let i = 0; i < 20 && s.pending?.kind !== 'yesNo' && s.pending?.kind !== 'chooseObjects'; i++) s = s.pending?.kind === 'declareBlockers' ? declareBlockers(s, []) : pass(s);
    s = drive(s, { yes: [false], objects: [[]] });
    for (let i = 0; i < 30 && s.turn.step !== 'endCombat'; i++) s = s.pending?.kind === 'declareBlockers' ? declareBlockers(s, []) : s.pending?.kind === 'priority' ? pass(s) : drive(s, { yes: [false], objects: [[]] });
    expect(bfNames(s, 'p1')).toEqual(['Test Raid Captain']);
    expect(zoneNames(s, 'hand', 'p2')).toEqual(['Test Foe Giant']);
    expect(lifeOf(s, 'p2')).toBe(18);
  });
  it('"that player or a planeswalker they control": with a planeswalker of theirs, its controller (you) chooses which of the two the creature attacks, and no other defender', () => {
    const s0 = setup({ hand: ['Test Foe Giant'], battlefield: [{ name: 'Test Foe Walker', counters: { loyalty: 4 } }] });
    const cap = find(s0, 'Test Raid Captain', 'battlefield', 'p1');
    const giant = find(s0, 'Test Foe Giant', 'hand', 'p2');
    let s = declareAttackers(toDeclareAttackers(s0), [[cap]]);
    for (let i = 0; i < 20 && s.pending?.kind !== 'yesNo' && s.pending?.kind !== 'chooseObjects'; i++) s = s.pending?.kind === 'declareBlockers' ? declareBlockers(s, []) : pass(s);
    for (let i = 0; i < 6 && s.pending?.kind === 'yesNo'; i++) s = answer(s, { kind: 'yesNo', yes: true });
    s = answer(s, { kind: 'chooseObjects', ids: [giant] });
    // one of two defenders to choose from: the player or the planeswalker
    expect(s.pending?.kind).not.toBe('priority');
    expect(s.pending?.kind).toBe('chooseOption');
    const walker = find(s, 'Test Foe Walker', 'battlefield', 'p2');
    const ids = (s.pending as unknown as { options: { id: string }[] }).options.map((o) => o.id).sort();
    expect(ids).toEqual([walker, 'p2'].sort()); // the player or the planeswalker: not yourself, not a creature
    s = drive(s, { options: [[walker]] });
    const newGiant = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Foe Giant')!;
    expect(s.combat?.attackers.some((a) => a.id === newGiant && a.defender === walker)).toBe(true);
  });
  it('no creature card in their hand: nothing to choose', () => {
    const s0 = setup({ hand: ['Test Foe Scrap'] });
    const cap = find(s0, 'Test Raid Captain', 'battlefield', 'p1');
    const s = combat(s0, [cap], { yes: [true], objects: [[]] });
    expect(bfNames(s, 'p1')).toEqual(['Test Raid Captain']);
    expect(zoneNames(s, 'hand', 'p2')).toEqual(['Test Foe Scrap']);
  });
});

describe('"When you cast this spell, reveal cards from the top of your library until you reveal X creature cards. Put all creature cards revealed this way into your graveyard, then put the rest on the bottom of your library in a random order." (CR 603.2, 107.3, 701.20a, 401.4; Old Stickfingers)', () => {
  const DIGGER = card('Test Grave Digger', 'Creature — Horror', "When you cast this spell, reveal cards from the top of your library until you reveal X creature cards. Put all creature cards revealed this way into your graveyard, then put the rest on the bottom of your library in a random order.\nTest Grave Digger's power and toughness are each equal to the number of creature cards in your graveyard.", '{X}', ['0', '0']);
  const A = card('Test Mill Ant', 'Creature — Insect', '', '{0}', ['1', '1']);
  const B = card('Test Mill Bee', 'Creature — Insect', '', '{0}', ['1', '1']);
  const C = card('Test Mill Crab', 'Creature — Crab', '', '{0}', ['1', '1']);
  const SPELL = card('Test Fizzle', 'Sorcery', 'You gain 1 life.');
  const defs = [DIGGER, A, B, C, SPELL];
  const setup = (): GameState => scenario([], { defs, p1: { hand: ['Test Grave Digger'], battlefield: ['Plains', 'Plains', 'Plains'], library: ['Plains', 'Test Mill Ant', 'Test Fizzle', 'Test Mill Bee', 'Plains', 'Test Mill Crab'] }, p2: {} });
  it('is fully automated', () => expect(full(DIGGER)).toBe(true));
  it('X = 2: reveals down to the second creature card, puts both creature cards into the graveyard and the other revealed cards on the bottom', () => {
    const s = resolveAll(cast(setup(), 'Test Grave Digger', { x: [2] }));
    expect(zoneNames(s, 'graveyard', 'p1').sort()).toEqual(['Test Mill Ant', 'Test Mill Bee']);
    expect(zoneNames(s, 'library', 'p1').slice(0, 2)).toEqual(['Plains', 'Test Mill Crab']); // the part below the second creature card is untouched ...
    expect(zoneNames(s, 'library', 'p1').slice(-3).sort()).toEqual(['Plains', 'Plains', 'Test Fizzle']); // ... and the revealed cards that were not creature cards are at the bottom
    expect(bfNames(s, 'p1').filter((n) => n === 'Test Grave Digger')).toEqual(['Test Grave Digger']);
    const digger = find(s, 'Test Grave Digger', 'battlefield', 'p1');
    expect(getChars(s, digger).power).toBe('2'); // "the number of creature cards in your graveyard" (a string, as printed)
  });
  it('X = 5 with only three creature cards in the library: every card is revealed, the creature cards go to the graveyard', () => {
    const s0 = setup();
    s0.zones.library.p1 = s0.zones.library.p1!.slice(0, 6);
    for (const id of s0.zones.battlefield.filter((x) => s0.objects[x]!.defId === 'Plains')) s0.objects[id]!.tapped = false;
    put(s0, 'p1', 'battlefield', 'Plains');
    put(s0, 'p1', 'battlefield', 'Plains');
    const s = resolveAll(cast(s0, 'Test Grave Digger', { x: [5] }));
    expect(zoneNames(s, 'graveyard', 'p1').sort()).toEqual(['Test Mill Ant', 'Test Mill Bee', 'Test Mill Crab']);
    expect(zoneNames(s, 'library', 'p1').sort()).toEqual(['Plains', 'Plains', 'Test Fizzle']);
  });
  it('X = 0 reveals nothing: the library is as it was', () => {
    const s = resolveAll(cast(setup(), 'Test Grave Digger', { x: [0] }));
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Grave Digger']); // (it is a 0/0 with no creature card in the graveyard: it dies, nothing was revealed)
    expect(zoneNames(s, 'library', 'p1').slice(0, 6)).toEqual(['Plains', 'Test Mill Ant', 'Test Fizzle', 'Test Mill Bee', 'Plains', 'Test Mill Crab']);
  });
});

describe('"At the beginning of your end step, choose target artifact or creature card in an opponent\'s graveyard that was put there from their library this turn. Put it onto the battlefield under your control." (CR 400.7, 404.1, 603.1, 701.17a; Captain N\'ghathrod)', () => {
  const CAPTAIN = card('Test Dread Captain', 'Legendary Creature — Horror Pirate', "At the beginning of your end step, choose target artifact or creature card in an opponent's graveyard that was put there from their library this turn. Put it onto the battlefield under your control.", '{0}', ['3', '3']);
  const MILL = card('Test Mill Hex', 'Sorcery', 'Target player mills three cards.');
  const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.', '{0}');
  const BEAR = card('Test Milled Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const RELIC = card('Test Milled Relic', 'Artifact', '');
  const OLD = card('Test Old Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const RAT = card('Test Doomed Rat', 'Creature — Rat', '', '{0}', ['1', '1']);
  const SPELL = card('Test Fizzle', 'Sorcery', 'You gain 1 life.');
  const defs = [CAPTAIN, MILL, SMITE, BEAR, RELIC, OLD, RAT, SPELL];
  const toEnd = (s: GameState): GameState => advanceTo(s, 1, 'end');
  it('is fully automated', () => expect(full(CAPTAIN)).toBe(true));
  it('offers only the artifact and creature cards of an opponent\'s graveyard that were milled this turn: not a land, not an older card, not one that died, not your own milled card', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Dread Captain'], hand: ['Test Mill Hex', 'Test Mill Hex', 'Test Smite'], library: ['Test Milled Bear', 'Test Fizzle', 'Test Milled Relic'] }, p2: { battlefield: ['Test Doomed Rat'], graveyard: ['Test Old Bear'], library: ['Test Milled Bear', 'Plains', 'Test Milled Relic', 'Test Fizzle'] } });
    const hexes = s0.zones.hand.p1!.filter((id) => nameOf(s0, id) === 'Test Mill Hex');
    let s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: hexes[0]! }), { targets: [[{ kind: 'player', id: 'p2' }]] }));
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: hexes[1]! }), { targets: [[{ kind: 'player', id: 'p1' }]] }));
    s = resolveAll(cast(s, 'Test Smite', { targets: [[obj(find(s, 'Test Doomed Rat', 'battlefield', 'p2'))]] }));
    expect(zoneNames(s, 'graveyard', 'p2').sort()).toEqual(['Test Doomed Rat', 'Test Milled Bear', 'Test Milled Relic', 'Test Old Bear', 'Plains'].sort());
    let t = toEnd(s);
    for (let i = 0; i < 6 && t.pending?.kind !== 'chooseTargets'; i++) t = pass(t);
    expect(t.pending?.kind).toBe('chooseTargets');
    const options = (t.pending as { objects: string[] }).objects.map((id) => `${nameOf(t, id)}`).sort();
    expect(options).toEqual(['Test Milled Bear', 'Test Milled Relic']);
    const bear = (t.pending as { objects: string[] }).objects.find((id) => nameOf(t, id) === 'Test Milled Bear')!;
    t = resolveAll(drive(t, { targets: [[obj(bear)]] }));
    expect(bfNames(t, 'p1')).toEqual(['Test Dread Captain', 'Test Milled Bear']);
    expect(zoneNames(t, 'graveyard', 'p2')).not.toContain('Test Milled Bear');
  });
  it('with nothing milled this turn there is no legal target: the trigger does nothing', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Dread Captain'] }, p2: { graveyard: ['Test Old Bear'] } });
    const s = resolveAll(toEnd(s0));
    expect(bfNames(s, 'p1')).toEqual(['Test Dread Captain']);
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Old Bear']);
  });
});

describe('"At the beginning of your end step, mill two cards, then exile a nonland card at random from your graveyard. Copy it. You may cast the copy without paying its mana cost." (CR 707.12, 608.2d, 406.1; Wondrous Crucible)', () => {
  const CRUCIBLE = card('Test Odd Crucible', 'Artifact', 'At the beginning of your end step, mill two cards, then exile a nonland card at random from your graveyard. Copy it. You may cast the copy without paying its mana cost.', '{0}');
  const GAIN = card('Test Gain Spell', 'Sorcery', 'You gain 3 life.');
  const BEAR = card('Test Mill Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const defs = [CRUCIBLE, GAIN, BEAR];
  const toEnd = (s: GameState): GameState => advanceTo(s, 1, 'end');
  it('is fully automated', () => expect(full(CRUCIBLE)).toBe(true));
  it('exiles a nonland card (never a land) from the graveyard at random, copies it and casts the copy for free: the card stays exiled', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Odd Crucible'], graveyard: ['Plains'], library: ['Plains', 'Test Gain Spell'] }, p2: {} });
    const s = resolveAll(toEnd(s0), { yes: [true] });
    expect(exileNames(s)).toEqual(['Test Gain Spell']); // the only nonland card of the graveyard (a land is never chosen)
    expect(lifeOf(s, 'p1')).toBe(23); // the copy resolved
    expect(zoneNames(s, 'graveyard', 'p1').sort()).toEqual(['Plains', 'Plains']);
  });
  it('declining the cast leaves the exiled card alone and nothing resolves', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Odd Crucible'], library: ['Test Gain Spell', 'Plains'] }, p2: {} });
    const s = resolveAll(toEnd(s0), { yes: [false] });
    expect(exileNames(s)).toEqual(['Test Gain Spell']);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('a permanent card: the copy of a permanent spell becomes a token on the battlefield', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Odd Crucible'], library: ['Test Mill Bear', 'Plains'] }, p2: {} });
    const s = resolveAll(toEnd(s0), { yes: [true] });
    expect(exileNames(s)).toEqual(['Test Mill Bear']);
    const token = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Mill Bear');
    expect(token).toBeDefined();
    expect(s.objects[token!]!.kind).toBe('token');
  });
  it('only lands in the graveyard after the mill: nothing is exiled and nothing is copied', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Odd Crucible'], graveyard: ['Plains'], library: ['Plains', 'Plains'] }, p2: {} });
    const s = resolveAll(toEnd(s0), { yes: [true] });
    expect(exileNames(s)).toEqual([]);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Plains', 'Plains', 'Plains']);
  });
});
