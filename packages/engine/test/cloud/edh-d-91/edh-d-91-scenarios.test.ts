/**
 * Commander coordinator D, round edh-d-91 (EDHREC ranks 5,001-10,000, group combat): its cards played through the engine with synthetic cards (invented names, design 6.10), compiled by
 * the game's default compiler. Alice (p1) is the active player of turn 1; Bob (p2), Cara (p3) and Dan (p4) are the others. Each test is named after the rule it checks, with its negative
 * case. CR cites are from the Comprehensive Rules text of 2026-09-25; rulings from Scryfall.
 *
 *   CR 704.5a, 104.3b, 611.3a          "As long as ~ is attached to a creature, you don't lose the game for having 0 or less life." (Pact Weapon)
 *   CR 121.1, 701.20a, 608.2c, 614.6   "Whenever equipped creature attacks, draw a card and reveal it. The creature gets +X/+X until end of turn and you lose X life, where X is that card's
 *                                      mana value." (Pact Weapon; ruling 2022-06-10: a replaced draw gives no bonus and no life loss)
 *   CR 608.2d, 506.2, 122.6, 205.1b, 400.7, 611.2a   "Whenever ~ attacks, defending player chooses a nonlegendary creature card in your graveyard. You return that card to the battlefield with an
 *                                      additional +1/+1 counter on it. The creature is a Vampire in addition to its other types." (Drana, the Last Bloodchief)
 *   CR 118.12, 608.2d, 701.21a, 701.23a, 201.2   "When this creature deals combat damage to a player, you may pay {3} and sacrifice it. If you do, choose a land you control. Then search your
 *                                      library for up to two basic land cards which have the same name as the chosen land, put them onto the battlefield tapped, then shuffle." (Canoptek Wraith)
 *   CR 305.1, 305.2, 601.3, 404.1, 400.7   "During each of your turns, you may play a land and cast a spell from among cards in graveyards that were put there from libraries this turn."
 *                                      (Coram, the Undertaker; rulings 2024-06-07)
 *   CR 601.3, 601.2a, 601.2f, 702.41a, 611.2a   "Whenever ~ attacks, exile the top five cards of your library. You may cast an artifact spell from among them this turn. If you do, it has
 *                                      affinity for artifacts." (Chiss-Goria, Forge Tyrant)
 *   CR 205.2a, 608.2c, 701.17a, 508.1   "Whenever one or more Demons you control attack a player, you draw a card and lose 1 life. At the beginning of your end step, create a 5/5 black
 *                                      Demon creature token with flying, then mill two cards. If two cards that share all their card types were milled this way, sacrifice this enchantment."
 *                                      (Demonic Covenant; rulings 2024-09-20)
 *   CR 510.2, 603.2c, 701.20e, 608.2c, 608.2d   "Whenever one or more Dragons you control deal combat damage to a player or battle, look at the top three cards of your library. Put one of them
 *                                      into your hand and the rest on the bottom of your library in any order. You may return one of those Dragons to its owner's hand." (Zurgo and Ojutai;
 *                                      rulings 2023-04-14)
 *   CR 701.20a, 701.20e, 608.2c, 608.2d   "Whenever this creature attacks, look at the top four cards of your library. You may reveal a Cleric card, a Rogue card, a Warrior card, and/or a
 *                                      Wizard card from among them and put those cards into your hand. Put the rest on the bottom of your library in a random order." (Harper Recruiter)
 *   CR 508.1, 603.2c, 608.2c, 608.2h, 202.3   "Whenever one or more Phyrexians you control attack, return target artifact card from your graveyard to the battlefield if its mana value is less
 *                                      than or equal to their total power." (Vulpine Harvester; ruling 2023-04-14)
 *   CR 118.12, 607.2a, 613.1f, 111.1, 400.7   "Whenever another nontoken Vampire you control dies, you may pay {1} and exile it. If you do, create a 1/1 black Bat creature token with flying.
 *                                      It gains "When this token deals combat damage to a player, sacrifice it and return the exiled card to the battlefield tapped."" (Timothar, Baron of
 *                                      Bats; rulings 2021-11-19)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type OracleCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { answer, card, cast, drive, full, lifeOf, resolveAll, scenario } from '../r3-cost/support';
import { act, advanceTo, find, passBoth, put } from '../../m3/scenario';
import { createGame, legalActions } from '../../../src/index';
import { clone } from '../../../src/util/clone';
import { basicLand } from '../../helpers';
import { playersConfig } from '../../m12/skeleton/helpers';

/** A four-player free-for-all game (Alice p1 active, Bob p2, Carol p3, Dan p4) at turn 1's first main phase, with the given objects put into zones. */
function four(defs: CardDef[], zones: Partial<Record<PlayerId, Partial<Record<'battlefield' | 'graveyard' | 'hand' | 'library' | 'exile', string[]>>>>): GameState {
  const base = playersConfig(4, 'edh-d-91', { defs: [basicLand('Forest', 'Forest'), ...defs] });
  const players = base.players.map((p) => ({ ...p, deck: Array(40).fill('Forest') as string[] }));
  let s = createGame({ ...base, players, options: { ...base.options, startingPlayer: 'p1', skipMulligans: true } });
  while (s.turn.step !== 'main1') s = act(s, { type: 'pass', player: s.pending!.player });
  s = clone(s);
  for (const [p, z] of Object.entries(zones)) for (const [zone, names] of Object.entries(z ?? {})) {
    const ids = (names ?? []).map((n) => put(s, p as PlayerId, zone as never, n));
    if (zone === 'library') s.zones.library[p as PlayerId] = [...ids, ...s.zones.library[p as PlayerId]!.filter((id) => !ids.includes(id))]; // the listed cards on top, in order
  }
  return s;
}
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

const pt = (s: GameState, id: ObjectId): string => `${String(getChars(s, id).power)}/${String(getChars(s, id).toughness)}`;
const handOf = (s: GameState, p: PlayerId): string[] => s.zones.hand[p]!.map((id) => s.objects[id]!.defId);

describe('Pact Weapon (CR 704.5a, 104.3b, 121.1, 701.20a, 608.2c, 614.6)', () => {
  const BLADE = card('Test Pact Blade', 'Artifact — Equipment', "As long as ~ is attached to a creature, you don't lose the game for having 0 or less life.\nWhenever equipped creature attacks, draw a card and reveal it. The creature gets +X/+X until end of turn and you lose X life, where X is that card's mana value.\nEquip—Discard a card.", '{4}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{2}{R}', ['3', '3']);
  const MIRROR = card('Test Twin Mirror', 'Enchantment', 'If you would draw a card, draw two cards instead.');
  const LEECH = card('Test Life Leech', 'Sorcery', 'You lose 50 life.');
  const defs = [BLADE, BEAR, OGRE, MIRROR, LEECH];
  const board = (extra: { bf?: string[]; hand?: string[]; attach?: boolean } = {}): GameState => {
    const s = scenario([], { p1: { battlefield: ['Test Pact Blade', 'Test Bear', ...(extra.bf ?? [])], hand: extra.hand ?? [], library: ['Test Ogre', 'Test Bear'] }, defs } as never);
    if (extra.attach !== false) s.objects[find(s, 'Test Pact Blade', 'battlefield', 'p1')]!.attachedTo = find(s, 'Test Bear', 'battlefield', 'p1');
    return s;
  };
  const attack = (s0: GameState): GameState => {
    const s1 = toDeclareAttackers(s0);
    return resolveAll(declareAttackers(s1, [[find(s1, 'Test Bear', 'battlefield', 'p1'), 'p2']]));
  };
  it('has no manual part', () => expect(full(BLADE)).toBe(true));
  it('the equipped creature attacks: you draw the top card (a mana value 3 card), the creature gets +3/+3 and you lose 3 life', () => {
    const s0 = board();
    const life0 = lifeOf(s0, 'p1');
    const s = attack(s0);
    expect(handOf(s, 'p1')).toContain('Test Ogre');
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe('5/5');
    expect(lifeOf(s, 'p1')).toBe(life0 - 3);
  });
  it('a land (mana value 0) drawn this way gives +0/+0 and no life loss', () => {
    const s0 = board();
    const lib = s0.zones.library.p1!;
    const plains = lib.find((id) => s0.objects[id]!.defId === 'Plains')!;
    s0.zones.library.p1 = [plains, ...lib.filter((id) => id !== plains)];
    const life0 = lifeOf(s0, 'p1');
    const s = attack(s0);
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe('2/2');
    expect(lifeOf(s, 'p1')).toBe(life0);
  });
  it('the ruling: a draw replaced (here by two draws) gives no bonus and no life loss, though cards are drawn', () => {
    const s0 = board({ bf: ['Test Twin Mirror'] });
    const life0 = lifeOf(s0, 'p1');
    const s = attack(s0);
    expect(handOf(s, 'p1').filter((n) => n === 'Test Ogre' || n === 'Test Bear').length).toBe(2);
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe('2/2');
    expect(lifeOf(s, 'p1')).toBe(life0);
  });
  it('the negative case: an unequipped creature attacking does not trigger it', () => {
    const s0 = board({ attach: false });
    const life0 = lifeOf(s0, 'p1');
    const s = attack(s0);
    expect(handOf(s, 'p1')).not.toContain('Test Ogre');
    expect(lifeOf(s, 'p1')).toBe(life0);
  });
  it('while attached you stay in the game at 0 or less life (CR 704.5a does not apply to you)', () => {
    const s = resolveAll(scenarioCast(board({ hand: ['Test Life Leech'] })));
    expect(lifeOf(s, 'p1')).toBeLessThanOrEqual(0);
    expect(s.players.find((p) => p.id === 'p1')!.hasLost).toBe(false);
  });
  it('the negative case: unattached, you lose the game at 0 or less life', () => {
    const s = resolveAll(scenarioCast(board({ hand: ['Test Life Leech'], attach: false })));
    expect(s.players.find((p) => p.id === 'p1')!.hasLost || (s.result !== null && s.result.winner !== 'p1')).toBe(true);
  });
});

function scenarioCast(s: GameState): GameState {
  return cast(s, 'Test Life Leech');
}

describe('Drana, the Last Bloodchief (CR 608.2d, 506.2, 122.6, 205.1b, 400.7, 611.2a)', () => {
  const DRANA = card('Test Blood Matron', 'Legendary Creature — Vampire Cleric', "Flying\nWhenever ~ attacks, defending player chooses a nonlegendary creature card in your graveyard. You return that card to the battlefield with an additional +1/+1 counter on it. The creature is a Vampire in addition to its other types.", '{3}{B}{B}', ['4', '4']);
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{2}{R}', ['3', '3']);
  const ELF = card('Test Elf', 'Creature — Elf', '', '{G}', ['1', '1']);
  const LORD = card('Test Legend Lord', 'Legendary Creature — Human', '', '{2}', ['5', '5']);
  const RELIC = card('Test Relic', 'Artifact', '');
  const defs = [DRANA, OGRE, ELF, LORD, RELIC];
  const board = (grave: string[], p3grave: string[] = []) => four(defs, { p1: { battlefield: ['Test Blood Matron'], graveyard: grave }, p3: { graveyard: p3grave } });
  /** Attack `defender` with Drana; stop at the choice and return it with the state. */
  const toChoice = (s0: GameState, defender: PlayerId) => {
    const s1 = toDeclareAttackers(s0);
    let s = declareAttackers(s1, [[find(s1, 'Test Blood Matron', 'battlefield', 'p1'), defender]]);
    for (let i = 0; i < 8 && s.pending?.kind !== 'chooseObjects' && s.zones.stack.length > 0; i++) s = passBoth(s);
    return s;
  };
  it('has no manual part', () => expect(full(DRANA)).toBe(true));
  it('the DEFENDING player (Cara, attacked in a four-player game) chooses among your nonlegendary creature cards only; you return it with a +1/+1 counter and it is also a Vampire', () => {
    const s = toChoice(board(['Test Ogre', 'Test Elf', 'Test Legend Lord', 'Test Relic'], ['Test Ogre']), 'p3');
    expect(s.pending?.kind).toBe('chooseObjects');
    const p = s.pending as Extract<NonNullable<GameState['pending']>, { kind: 'chooseObjects' }>;
    expect(p.player).toBe('p3');
    expect(p.options.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Elf', 'Test Ogre']);
    expect(p.options.every((id) => s.objects[id]!.owner === 'p1')).toBe(true);
    const elf = p.options.find((id) => s.objects[id]!.defId === 'Test Elf')!;
    const s2 = resolveAll(answer(s, { kind: 'chooseObjects', ids: [elf] }));
    const back = find(s2, 'Test Elf', 'battlefield', 'p1');
    expect(s2.objects[back]!.controller).toBe('p1');
    expect(s2.objects[back]!.counters['+1/+1']).toBe(1);
    expect(pt(s2, back)).toBe('2/2');
    expect(getChars(s2, back).subtypes).toEqual(expect.arrayContaining(['Elf', 'Vampire']));
    expect(s2.zones.graveyard.p1!.some((id) => s2.objects[id]!.defId === 'Test Ogre')).toBe(true);
  });
  it('the ruling: the returned creature stays a Vampire after Drana leaves the battlefield', () => {
    const s = toChoice(board(['Test Ogre']), 'p2');
    const s2 = resolveAll(s.pending?.kind === 'chooseObjects' ? answer(s, { kind: 'chooseObjects', ids: [s.pending.options[0]!] }) : s);
    const drana = find(s2, 'Test Blood Matron', 'battlefield', 'p1');
    s2.zones.battlefield = s2.zones.battlefield.filter((id) => id !== drana);
    s2.zones.graveyard.p1!.push(drana);
    s2.objects[drana]!.zone = 'graveyard';
    expect(getChars(s2, find(s2, 'Test Ogre', 'battlefield', 'p1')).subtypes).toContain('Vampire');
  });
  it('the negative case: with only a legendary creature card and a noncreature card in your graveyard nothing returns (no choice is asked)', () => {
    const s = resolveAll(toChoice(board(['Test Legend Lord', 'Test Relic'], ['Test Ogre']), 'p2'));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1').map((id) => s.objects[id]!.defId)).toEqual(['Test Blood Matron']);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Ogre')).toBe(false);
  });
});

describe('Canoptek Wraith (CR 118.12, 608.2d, 701.21a, 701.23a, 201.2)', () => {
  const WRAITH = card('Test Phase Wraith', 'Artifact Creature — Wraith', "This creature can't be blocked.\nWhen this creature deals combat damage to a player, you may pay {3} and sacrifice it. If you do, choose a land you control. Then search your library for up to two basic land cards which have the same name as the chosen land, put them onto the battlefield tapped, then shuffle.", '{6}', ['3', '3']);
  const ISLE = card('Test Isle', 'Basic Land — Island', '{T}: Add {U}.');
  const defs = [WRAITH, ISLE];
  const board = (lands = ['Plains', 'Plains', 'Plains']) => scenario([], { p1: { battlefield: ['Test Phase Wraith', ...lands, 'Test Isle'], library: ['Test Isle', 'Plains', 'Test Isle'] }, defs } as never);
  const names = (s: GameState) => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1').map((id) => s.objects[id]!.defId).sort();
  /** Attack Bob unblocked and go to the trigger's resolution, answering yes or no and picking `land` as the chosen land. */
  const hit = (s0: GameState, yes: boolean, land: string): GameState => {
    const s1 = toDeclareAttackers(s0);
    let s = declareAttackers(s1, [[find(s1, 'Test Phase Wraith', 'battlefield', 'p1'), 'p2']]);
    for (let i = 0; i < 30 && !(s.turn.step === 'combatDamage' && s.zones.stack.length === 0 && s.pending?.kind === 'priority' && i > 0) ; i++) {
      const p = s.pending;
      if (p?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
      else if (p?.kind === 'chooseObjects' && p.options.some((id) => s.objects[id]!.zone === 'battlefield')) s = answer(s, { kind: 'chooseObjects', ids: [p.options.find((id) => s.objects[id]!.defId === land)!] });
      else if (p?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max as number) });
      else if (p?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p?.kind === 'priority') s = passBoth(s);
      else break;
      if (s.turn.step === 'end' || s.turn.step === 'main2') break;
    }
    return s;
  };
  it('has no manual part', () => expect(full(WRAITH)).toBe(true));
  it('paid: the Wraith is sacrificed, you choose an Island and put up to two basic lands NAMED like it (the two Test Isles, not the Plains) onto the battlefield tapped', () => {
    const s = hit(board(), true, 'Test Isle');
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toContain('Test Phase Wraith');
    const isles = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Isle');
    expect(isles.length).toBe(3);
    expect(isles.filter((id) => s.objects[id]!.tapped).length).toBe(2);
    expect(s.zones.library.p1!.filter((id) => s.objects[id]!.defId === 'Test Isle').length).toBe(0);
  });
  it('the negative case: declined, the Wraith stays and no land is found', () => {
    const before = names(board());
    const s = hit(board(), false, 'Test Isle');
    expect(names(s)).toEqual(before);
  });
  it('the negative case: without {3} to pay (one land of mana besides the Isle) nothing is sacrificed and no land is found', () => {
    const s0 = board(['Plains']);
    const before = names(s0);
    const s = hit(s0, true, 'Test Isle');
    expect(names(s)).toEqual(before);
  });
});

describe('Coram, the Undertaker (CR 305.1, 305.2, 601.3, 404.1, 400.7)', () => {
  const CORAM = card('Test Grave Keeper', 'Legendary Creature — Human Warrior', 'Reach\n~ gets +X/+0, where X is the greatest power among creature cards in all graveyards.\nWhenever ~ attacks, each player mills a card.\nDuring each of your turns, you may play a land and cast a spell from among cards in graveyards that were put there from libraries this turn.', '{1}{B}{R}{G}', ['0', '5']);
  const MILL = card('Test Mill All', 'Sorcery', 'Each player mills a card.');
  const ELF = card('Test Elf', 'Creature — Elf', '', '{0}', ['1', '1']);
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{0}', ['3', '3']);
  const TOSS = card('Test Toss', 'Sorcery', 'Discard a card.');
  const defs = [CORAM, MILL, ELF, OGRE, TOSS];
  const board = (z: Parameters<typeof four>[1] = {}) => four(defs, { p1: { battlefield: ['Test Grave Keeper'], hand: ['Test Mill All'], library: ['Test Ogre'] }, p2: { library: ['Forest'] }, p3: { library: ['Test Elf'] }, p4: { library: ['Test Elf'] }, ...z });
  const milled = (s0: GameState) => resolveAll(cast(s0, 'Test Mill All'));
  const lands = (s: GameState) => legalActions(s, 'p1').filter((a) => a.kind === 'playLand').map((a) => a.object!);
  const casts = (s: GameState) => legalActions(s, 'p1').filter((a) => a.kind === 'cast').map((a) => a.object!);
  const inGy = (s: GameState, p: PlayerId, name: string) => s.zones.graveyard[p]!.find((id) => s.objects[id]!.defId === name)!;
  it('has no manual part', () => expect(full(CORAM)).toBe(true));
  it('after the mill you may play the land Bob milled and cast the creature cards Carol and Dan milled (another player\'s graveyard), and your own milled card', () => {
    const s = milled(board());
    expect(lands(s)).toContain(inGy(s, 'p2', 'Forest'));
    expect(casts(s)).toEqual(expect.arrayContaining([inGy(s, 'p3', 'Test Elf'), inGy(s, 'p4', 'Test Elf'), inGy(s, 'p1', 'Test Ogre')]));
  });
  it('the land comes under your control and counts as your land play; one spell this way: after casting Carol\'s Elf, Dan\'s Elf is not offered', () => {
    let s = milled(board());
    s = act(s, { type: 'playLand', player: 'p1', card: inGy(s, 'p2', 'Forest') });
    const forest = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Forest' && s.objects[id]!.owner === 'p2')!;
    expect(s.objects[forest]!.controller).toBe('p1');
    expect(s.players.find((p) => p.id === 'p1')!.landsPlayedThisTurn).toBe(1);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: inGy(s, 'p3', 'Test Elf') })));
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Elf' && s.objects[id]!.controller === 'p1' && s.objects[id]!.owner === 'p3')).toBe(true);
    expect(casts(s)).not.toContain(inGy(s, 'p4', 'Test Elf'));
    expect(casts(s)).not.toContain(inGy(s, 'p1', 'Test Ogre'));
  });
  it('the negative case: a card put into a graveyard from a hand this turn (discarded) is not offered, nor a card that was in a graveyard before this turn', () => {
    const s0 = board({ p1: { battlefield: ['Test Grave Keeper'], hand: ['Test Toss', 'Test Ogre'], graveyard: ['Test Elf'] } });
    const s = resolveAll(cast(s0, 'Test Toss'), { objects: [[find(s0, 'Test Ogre', 'hand', 'p1')]] });
    expect(casts(s)).not.toContain(inGy(s, 'p1', 'Test Ogre'));
    expect(casts(s)).not.toContain(inGy(s, 'p1', 'Test Elf'));
  });
  it('the negative case: without Coram the milled cards of other players are not offered', () => {
    const s0 = board();
    const coram = find(s0, 'Test Grave Keeper', 'battlefield', 'p1');
    s0.zones.battlefield = s0.zones.battlefield.filter((id) => id !== coram);
    delete s0.objects[coram];
    const s = milled(s0);
    expect(lands(s)).not.toContain(inGy(s, 'p2', 'Forest'));
    expect(casts(s)).not.toContain(inGy(s, 'p3', 'Test Elf'));
  });
});

describe('Chiss-Goria, Forge Tyrant (CR 601.3, 601.2a, 601.2f, 702.41a, 611.2a)', () => {
  const TYRANT = card('Test Forge Wyrm', 'Legendary Creature — Dragon', 'Affinity for artifacts (This spell costs {1} less to cast for each artifact you control.)\nFlying, haste\nWhenever ~ attacks, exile the top five cards of your library. You may cast an artifact spell from among them this turn. If you do, it has affinity for artifacts.', '{4}{R}{R}{R}', ['7', '3']);
  const GOLEM = card('Test Iron Golem', 'Artifact Creature — Golem', '', '{4}', ['4', '4']);
  const COG = card('Test Cog', 'Artifact', '', '{3}');
  const BOLT = card('Test Spark', 'Instant', 'Test Spark deals 1 damage to any target.', '{0}');
  const TRINKET = card('Test Trinket', 'Artifact', '');
  const defs = [TYRANT, GOLEM, COG, BOLT, TRINKET];
  const board = (bf = ['Test Forge Wyrm', 'Test Trinket', 'Test Trinket', 'Plains', 'Plains']) => scenario([], { p1: { battlefield: bf, library: ['Test Iron Golem', 'Test Spark', 'Test Cog', 'Plains', 'Plains'] }, defs } as never);
  const attacked = (s0: GameState): GameState => {
    const s1 = toDeclareAttackers(s0);
    const s2 = resolveAll(declareAttackers(s1, [[find(s1, 'Test Forge Wyrm', 'battlefield', 'p1'), 'p2']]));
    return advanceTo(s2, 1, 'main2');
  };
  const castable = (s: GameState) => legalActions(s, 'p1').filter((a) => a.kind === 'cast').map((a) => s.objects[a.object!]!.defId);
  it('has no manual part', () => expect(full(TYRANT)).toBe(true));
  it('the five cards are exiled; with two artifacts and two lands the {4} artifact creature is castable from among them (affinity takes {2} off) and resolves', () => {
    const s = attacked(board());
    expect(s.zones.exile.length).toBe(5);
    expect(castable(s)).toContain('Test Iron Golem');
    const s2 = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Iron Golem', 'exile') })));
    expect(s2.zones.battlefield.some((id) => s2.objects[id]!.defId === 'Test Iron Golem')).toBe(true);
  });
  it('the negative case: without artifacts (no affinity reduction) the {4} spell is not castable with two lands', () => {
    const s = attacked(board(['Test Forge Wyrm', 'Plains', 'Plains']));
    expect(castable(s)).not.toContain('Test Iron Golem');
  });
  it('the negative case: an instant among them is not castable (artifact spells only), and after one artifact spell the other is not', () => {
    const s = attacked(board());
    expect(castable(s)).not.toContain('Test Spark');
    const s2 = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Iron Golem', 'exile') })));
    expect(castable(s2)).not.toContain('Test Cog');
  });
});

describe('Demonic Covenant (CR 205.2a, 608.2c, 701.17a, 508.1)', () => {
  const PACT = card('Test Demon Pact', 'Kindred Enchantment — Demon', "Whenever one or more Demons you control attack a player, you draw a card and lose 1 life.\nAt the beginning of your end step, create a 5/5 black Demon creature token with flying, then mill two cards. If two cards that share all their card types were milled this way, sacrifice this enchantment.", '{4}{B}{B}');
  const IMP = card('Test Imp', 'Creature — Demon', '', '{1}', ['1', '1']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', '{2}', ['2', '2']);
  const defs = [PACT, IMP, BEAR, GOLEM];
  const hand = (s: GameState) => s.zones.hand.p1!.length;
  it('has no manual part', () => expect(full(PACT)).toBe(true));
  it('the ruling: two Demons attacking two different players trigger it twice (two cards, two life); the Bear attacking Dan alone adds nothing', () => {
    const s0 = four(defs, { p1: { battlefield: ['Test Demon Pact', 'Test Imp', 'Test Imp', 'Test Bear'] } });
    const life0 = lifeOf(s0, 'p1');
    const h0 = hand(s0);
    const s1 = toDeclareAttackers(s0);
    const imps = s1.zones.battlefield.filter((id) => s1.objects[id]!.defId === 'Test Imp');
    const s = resolveAll(drive(declareAttackers(s1, [[imps[0]!, 'p2'], [imps[1]!, 'p3'], [find(s1, 'Test Bear', 'battlefield', 'p1'), 'p4']])));
    expect(hand(s) - h0).toBe(2);
    expect(lifeOf(s, 'p1')).toBe(life0 - 2);
  });
  const endStep = (lib: string[]) => {
    const s0 = scenario([], { p1: { battlefield: ['Test Demon Pact'], library: lib }, defs } as never);
    return resolveAll(advanceTo(s0, 1, 'end'));
  };
  const onBf = (s: GameState) => s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Demon Pact');
  it('end step: a 5/5 flying Demon token is created and two cards are milled; two creature cards (same card types) make you sacrifice it', () => {
    const s = endStep(['Test Bear', 'Test Imp']);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length).toBe(1);
    expect(s.zones.graveyard.p1!.filter((id) => ['Test Bear', 'Test Imp'].includes(s.objects[id]!.defId)).length).toBe(2);
    expect(onBf(s)).toBe(false);
  });
  it('the ruling (negative case): an artifact creature and a creature share a card type but not ALL their card types: it stays', () => {
    expect(onBf(endStep(['Test Golem', 'Test Bear']))).toBe(true);
  });
  it('two lands (the same card types, different subtypes do not matter) make you sacrifice it', () => {
    expect(onBf(endStep(['Plains', 'Plains']))).toBe(false);
  });
});

/**
 * Attack with `attacks` (unblocked), then go on until the combat damage step's triggers are done, answering each decision with `pick` (a yes/no, the objects of a choice), or with the default.
 */
function fight(s0: GameState, attacks: [ObjectId, PlayerId][], pick: (s: GameState) => DecisionAnswer | undefined): GameState {
  const s1 = toDeclareAttackers(s0);
  let s = declareAttackers(s1, attacks);
  for (let i = 0; i < 80 && !s.result && s.turn.step !== 'main2' && s.turn.step !== 'end'; i++) {
    const p = s.pending;
    if (!p) break;
    const mine = pick(s);
    if (mine !== undefined) s = answer(s, mine);
    else if (p.kind === 'priority') s = act(s, { type: 'pass', player: p.player });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min as number) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else s = drive(s);
  }
  return s;
}

describe('Zurgo and Ojutai (CR 510.2, 603.2c, 701.20e, 608.2c, 608.2d)', () => {
  const ZO = card('Test Twin Warlord', 'Legendary Creature — Orc Dragon', "Flying, haste\n~ has hexproof as long as it entered this turn.\nWhenever one or more Dragons you control deal combat damage to a player or battle, look at the top three cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order. You may return one of those Dragons to its owner's hand.", '{2}{U}{R}{B}', ['4', '4']);
  const WHELP = card('Test Whelp', 'Creature — Dragon', 'Flying', '{1}', ['2', '2']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{1}', ['3', '3']);
  const defs = [ZO, WHELP, BEAR, OGRE];
  const board = () => four(defs, { p1: { battlefield: ['Test Twin Warlord', 'Test Whelp', 'Test Bear'], library: ['Test Ogre', 'Forest', 'Forest'] } });
  const ids = (s: GameState, n: string) => s.zones.battlefield.filter((id) => s.objects[id]!.defId === n);
  it('has no manual part', () => expect(full(ZO)).toBe(true));
  it('two Dragons and a Bear hit Bob: one trigger; you put one of the top three into your hand (the rest on the bottom), and may return one of the DRAGONS (the Bear is no choice)', () => {
    const s0 = board();
    const seen: string[][] = [];
    const s = fight(s0, [[ids(s0, 'Test Twin Warlord')[0]!, 'p2'], [ids(s0, 'Test Whelp')[0]!, 'p2'], [ids(s0, 'Test Bear')[0]!, 'p2']], (x) => {
      const p = x.pending!;
      if (p.kind === 'yesNo') return { kind: 'yesNo', yes: true };
      if (p.kind !== 'chooseObjects') return undefined;
      seen.push(p.options.map((id) => x.objects[id]!.defId).sort());
      const ogre = p.options.find((id) => x.objects[id]!.defId === 'Test Ogre');
      if (ogre !== undefined) return { kind: 'chooseObjects', ids: [ogre] };
      const whelp = p.options.find((id) => x.objects[id]!.defId === 'Test Whelp');
      return whelp !== undefined ? { kind: 'chooseObjects', ids: [whelp] } : undefined;
    });
    expect(seen).toContainEqual(['Forest', 'Forest', 'Test Ogre']);
    expect(seen).toContainEqual(['Test Twin Warlord', 'Test Whelp']);
    expect(s.zones.hand.p1!.map((id) => s.objects[id]!.defId)).toEqual(expect.arrayContaining(['Test Ogre', 'Test Whelp']));
    expect(ids(s, 'Test Bear').length).toBe(1);
    expect(ids(s, 'Test Twin Warlord').length).toBe(1);
  });
  it('the negative case: declining the option keeps both Dragons on the battlefield', () => {
    const s0 = board();
    const s = fight(s0, [[ids(s0, 'Test Twin Warlord')[0]!, 'p2'], [ids(s0, 'Test Whelp')[0]!, 'p2']], (x) => (x.pending!.kind === 'yesNo' ? { kind: 'yesNo', yes: false } : undefined));
    expect(ids(s, 'Test Whelp').length).toBe(1);
    expect(ids(s, 'Test Twin Warlord').length).toBe(1);
  });
  it('the ruling: Dragons hitting two different players trigger it twice (two cards into your hand)', () => {
    const s0 = board();
    const h0 = s0.zones.hand.p1!.length;
    const s = fight(s0, [[ids(s0, 'Test Twin Warlord')[0]!, 'p2'], [ids(s0, 'Test Whelp')[0]!, 'p3']], (x) => (x.pending!.kind === 'yesNo' ? { kind: 'yesNo', yes: false } : undefined));
    expect(s.zones.hand.p1!.length - h0).toBe(2);
  });
  it('the ruling (review): Dragons hitting two different battles at once trigger it twice, once for each battle', () => {
    const SIEGE = compileCard({ name: 'Test Siege', layout: 'normal', mana_cost: '{1}', type_line: 'Battle — Siege', oracle_text: '', colors: [], keywords: [], defense: '9' } as unknown as OracleCard);
    const SIEGE2 = compileCard({ name: 'Test Siege Two', layout: 'normal', mana_cost: '{1}', type_line: 'Battle — Siege', oracle_text: '', colors: [], keywords: [], defense: '9' } as unknown as OracleCard);
    const s0 = scenario([], { p1: { battlefield: ['Test Twin Warlord', 'Test Whelp'] }, defs: [...defs, SIEGE, SIEGE2] } as never);
    const sieges = ['Test Siege', 'Test Siege Two'].map((n) => {
      const b = put(s0, 'p1', 'battlefield', n);
      s0.objects[b]!.protector = 'p2';
      s0.objects[b]!.counters = { ...s0.objects[b]!.counters, defense: 9 };
      return b;
    });
    const h0 = s0.zones.hand.p1!.length;
    const s = fight(s0, [[ids(s0, 'Test Twin Warlord')[0]!, sieges[0]! as unknown as PlayerId], [ids(s0, 'Test Whelp')[0]!, sieges[1]! as unknown as PlayerId]], (x) => (x.pending!.kind === 'yesNo' ? { kind: 'yesNo', yes: false } : undefined));
    expect(sieges.map((b) => s.objects[b]?.counters['defense'])).toEqual([5, 7]);
    expect(s.zones.hand.p1!.length - h0).toBe(2);
  });
  it('the negative case: only the Bear connecting does not trigger it', () => {
    const s0 = board();
    const h0 = s0.zones.hand.p1!.length;
    const s = fight(s0, [[ids(s0, 'Test Bear')[0]!, 'p2']], () => undefined);
    expect(s.zones.hand.p1!.length).toBe(h0);
  });
});

describe('Harper Recruiter (CR 701.20a, 701.20e, 608.2c, 608.2d)', () => {
  const HARPER = card('Test Harp Scout', 'Creature — Human Bard', 'Flying\nWhenever this creature attacks, look at the top four cards of your library. You may reveal a Cleric card, a Rogue card, a Warrior card, and/or a Wizard card from among them and put those cards into your hand. Put the rest on the bottom of your library in a random order.', '{3}{W}', ['3', '3']);
  const CLERIC = card('Test Cleric', 'Creature — Human Cleric', '', '{1}', ['1', '1']);
  const CLERIC2 = card('Test Cleric Two', 'Creature — Elf Cleric', '', '{1}', ['1', '1']);
  const RW = card('Test Rogue Warrior', 'Creature — Orc Rogue Warrior', '', '{1}', ['1', '1']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const defs = [HARPER, CLERIC, CLERIC2, RW, BEAR];
  const board = () => scenario([], { p1: { battlefield: ['Test Harp Scout'], library: ['Test Cleric', 'Test Cleric Two', 'Test Rogue Warrior', 'Test Bear'] }, defs } as never);
  const handNames = (s: GameState) => s.zones.hand.p1!.map((id) => s.objects[id]!.defId).sort();
  it('has no manual part', () => expect(full(HARPER)).toBe(true));
  it('one card for each type: a Cleric, the Rogue Warrior as the Rogue (it is then no Warrior choice), no Wizard; the second Cleric and the Bear go to the bottom', () => {
    const s0 = board();
    const offered: string[][] = [];
    const s = fight(s0, [[find(s0, 'Test Harp Scout', 'battlefield', 'p1'), 'p2']], (x) => {
      const p = x.pending!;
      if (p.kind !== 'chooseObjects') return undefined;
      const names = p.options.map((id) => x.objects[id]!.defId);
      offered.push([...names].sort());
      const want = offered.length === 1 ? 'Test Cleric' : offered.length === 2 ? 'Test Rogue Warrior' : undefined;
      const id = p.options.find((o) => x.objects[o]!.defId === want);
      return { kind: 'chooseObjects', ids: id !== undefined ? [id] : [] };
    });
    expect(offered[0]).toEqual(['Test Cleric', 'Test Cleric Two']);
    expect(offered[1]).toEqual(['Test Rogue Warrior']);
    expect(offered.slice(2).every((o) => o.length === 0)).toBe(true);
    expect(handNames(s)).toEqual(['Test Cleric', 'Test Rogue Warrior']);
    const lib = s.zones.library.p1!.map((id) => s.objects[id]!.defId);
    expect(lib.slice(-2).sort()).toEqual(['Test Bear', 'Test Cleric Two']);
  });
  it('the negative case: choosing nothing puts all four on the bottom', () => {
    const s0 = board();
    const s = fight(s0, [[find(s0, 'Test Harp Scout', 'battlefield', 'p1'), 'p2']], (x) => (x.pending!.kind === 'chooseObjects' && x.pending!.min === 0 ? { kind: 'chooseObjects', ids: [] } : undefined));
    expect(handNames(s)).toEqual([]);
    expect(s.zones.library.p1!.slice(-4).map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Bear', 'Test Cleric', 'Test Cleric Two', 'Test Rogue Warrior']);
  });
});

describe('Vulpine Harvester (CR 508.1, 603.2c, 608.2c, 608.2h, 202.3)', () => {
  const FOX = card('Test Grave Fox', 'Artifact Creature — Phyrexian Fox', 'Whenever one or more Phyrexians you control attack, return target artifact card from your graveyard to the battlefield if its mana value is less than or equal to their total power.', '{2}{W}', ['3', '2']);
  const MITE = card('Test Mite', 'Artifact Creature — Phyrexian Mite', '', '{1}', ['2', '1']);
  const BRUTE = card('Test Brute', 'Creature — Ogre', '', '{1}', ['5', '5']);
  const RELIC5 = card('Test Relic Five', 'Artifact', '', '{5}');
  const RELIC6 = card('Test Relic Six', 'Artifact', '', '{6}');
  const defs = [FOX, MITE, BRUTE, RELIC5, RELIC6];
  const go = (grave: string, target: string, attackers: string[]) => {
    const s0 = scenario([], { p1: { battlefield: ['Test Grave Fox', 'Test Mite', 'Test Brute'], graveyard: [grave] }, defs } as never);
    const ids = attackers.map((n) => find(s0, n, 'battlefield', 'p1'));
    return fight(s0, ids.map((id) => [id, 'p2'] as [ObjectId, PlayerId]), (x) => {
      const p = x.pending!;
      return p.kind === 'chooseTargets' ? { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(x, target, 'graveyard', 'p1') }] } as DecisionAnswer : undefined;
    });
  };
  const back = (s: GameState, n: string) => s.zones.battlefield.some((id) => s.objects[id]!.defId === n);
  it('has no manual part', () => expect(full(FOX)).toBe(true));
  it('two Phyrexians attack (power 3 + 2 = 5): the mana value 5 artifact returns', () => expect(back(go('Test Relic Five', 'Test Relic Five', ['Test Grave Fox', 'Test Mite']), 'Test Relic Five')).toBe(true));
  it('the ruling: a mana value greater than their total power stays in the graveyard (6 > 5)', () => expect(back(go('Test Relic Six', 'Test Relic Six', ['Test Grave Fox', 'Test Mite']), 'Test Relic Six')).toBe(false));
  it('the negative case: an attacking non-Phyrexian (the 5-power Ogre) adds nothing: 3 + 2 is still less than 6', () => expect(back(go('Test Relic Six', 'Test Relic Six', ['Test Grave Fox', 'Test Mite', 'Test Brute']), 'Test Relic Six')).toBe(false));
  it('the negative case: only the Ogre attacking does not trigger it', () => expect(back(go('Test Relic Five', 'Test Relic Five', ['Test Brute']), 'Test Relic Five')).toBe(false));
});

describe('Timothar, Baron of Bats (CR 118.12, 607.2a, 613.1f, 111.1, 400.7)', () => {
  const TIM = card('Test Bat Baron', 'Legendary Creature — Vampire Noble', 'Ward—Discard a card.\nWhenever another nontoken Vampire you control dies, you may pay {1} and exile it. If you do, create a 1/1 black Bat creature token with flying. It gains "When this token deals combat damage to a player, sacrifice it and return the exiled card to the battlefield tapped."', '{4}{B}{B}', ['4', '4']);
  const VAMP = card('Test Vampire', 'Creature — Vampire', '', '{1}', ['2', '2']);
  const VAMP2 = card('Test Vampire Two', 'Creature — Vampire', '', '{1}', ['3', '3']);
  const SLAY = card('Test Slay', 'Instant', 'Destroy target creature.', '{0}');
  const defs = [TIM, VAMP, VAMP2, SLAY];
  const board = () => scenario([], { p1: { battlefield: ['Test Bat Baron', 'Test Vampire', 'Test Vampire Two', 'Plains', 'Plains'], hand: ['Test Slay', 'Test Slay'] }, defs } as never);
  const slay = (s: GameState, name: string, yes: boolean) => resolveAll(cast(s, 'Test Slay', { targets: [[{ kind: 'object', id: find(s, name, 'battlefield', 'p1') }]] }), { yes: [yes] });
  const bats = (s: GameState) => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
  it('has no manual part', () => expect(full(TIM)).toBe(true));
  it('paid: the Vampire card is exiled and a 1/1 flying Bat is created; the negative case: declined, no Bat and the card stays in the graveyard', () => {
    const s = slay(board(), 'Test Vampire', true);
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toContain('Test Vampire');
    expect(bats(s).length).toBe(1);
    expect(pt(s, bats(s)[0]!)).toBe('1/1');
    const n = slay(board(), 'Test Vampire', false);
    expect(bats(n).length).toBe(0);
    expect(n.zones.graveyard.p1!.map((id) => n.objects[id]!.defId)).toContain('Test Vampire');
  });
  it('the ruling: each Bat returns only ITS card: two Vampires die, two Bats; on the next turn one Bat hits and only its Vampire comes back, tapped, the Bat sacrificed', () => {
    let s = slay(board(), 'Test Vampire', true);
    const batA = bats(s)[0]!;
    s = slay(s, 'Test Vampire Two', true);
    expect(bats(s).length).toBe(2);
    s = advanceTo(s, 3, 'main1');
    s = fight(s, [[batA, 'p2']], (x) => (x.pending!.kind === 'yesNo' ? { kind: 'yesNo', yes: true } : undefined));
    const back = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Vampire');
    expect(back.length).toBe(1);
    expect(s.objects[back[0]!]!.tapped).toBe(true);
    expect(s.objects[back[0]!]!.controller).toBe('p1');
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toContain('Test Vampire Two');
    expect(bats(s).length).toBe(1);
  });
  it('the negative case: Timothar itself dying (not "another" Vampire) does not trigger it', () => {
    const s = slay(board(), 'Test Bat Baron', true);
    expect(bats(s).length).toBe(0);
  });
});
