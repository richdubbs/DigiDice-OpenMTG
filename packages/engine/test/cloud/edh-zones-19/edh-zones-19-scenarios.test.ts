/**
 * edh-zones-19 (Commander lane edh-zones): the round's readings played through the engine with synthetic cards (invented names, design 6.10). CR cites checked against the
 * 2026-09-25 text (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt).
 *
 *   CR 109.2, 120.2, 603.2   "Whenever a permanent deals damage to you, return it to its owner's hand." (Dissipation Field): a permanent's damage, never a spell's
 *   CR 119.3, 603.2c, 603.2h "Whenever one or more opponents lose life, you may cast target instant or sorcery card from your graveyard. ... Do this only once each turn." (Emet-Selch of
 *                            the Third Seat): one trigger for the opponents' life lost at once; the limit counts the cast, not the trigger
 *   CR 702.49a, 603.2        "Whenever you activate a ninjutsu ability, look at the top three cards of your library. ... This ability triggers only once each turn." (Satoru Umezawa)
 *   CR 202.3, 608.2d, 401.4  "Put any number of nonland permanent cards with total mana value 4 or less from among them onto the battlefield. Put the rest on the bottom of your library in
 *                            a random order." (Ao, the Dawn Sky)
 */
import { describe, expect, it } from 'vitest';
import { put, pass, answer, advanceTo } from '../../m3/scenario';
import { legalActions, type GameState, type ObjectId } from '../../../src/index';
import { runCombat } from '../../m5/helpers';
import { act, card, cast, drive, find, full, lifeOf, obj, resolveAll, scenario } from '../r3-cost/support';
import { getChars } from '../../../src/rules/characteristics';
import { mpScenario, lifeOf as mpLife } from '../../m12/rules/helpers';

const nameOf = (s: GameState, id: string): string => getChars(s, id).name;
const handNames = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.hand[p]!.map((id) => nameOf(s, id)).sort();
const gyNames = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.graveyard[p]!.map((id) => nameOf(s, id)).sort();
const bfNames = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => nameOf(s, id)).sort();
const exileNames = (s: GameState): string[] => s.zones.exile.map((id) => nameOf(s, id)).sort();
const libNames = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.library[p]!.map((id) => nameOf(s, id));
const setLibrary = (s: GameState, p: 'p1' | 'p2', names: string[]): void => {
  for (const id of s.zones.library[p]!) delete s.objects[id];
  s.zones.library[p] = [];
  for (const n of names) put(s, p, 'library', n);
};

describe('"Whenever a permanent deals damage to you, return it to its owner\'s hand." (CR 109.2, 120.2, 603.2; Dissipation Field)', () => {
  const FIELD = card('Test Warding Field', 'Enchantment', "Whenever a permanent deals damage to you, return it to its owner's hand.");
  const PINGER = card('Test Pinger', 'Artifact', '{T}: ~ deals 1 damage to target player.');
  const ZAP = card('Test Zap', 'Instant', '~ deals 2 damage to target player.');
  const defs = [FIELD, PINGER, ZAP];
  it('has no manual part', () => expect(full(FIELD)).toBe(true));
  it('a permanent that dealt damage to you goes back to its owner\'s hand', () => {
    let s = scenario([], { p1: { battlefield: ['Test Warding Field'] }, p2: { battlefield: ['Test Pinger'] }, defs });
    s = pass(s); // p1 passes; p2 has priority
    expect(s.pending?.player).toBe('p2');
    s = drive(act(s, { type: 'activate', player: 'p2', source: find(s, 'Test Pinger', 'battlefield', 'p2'), ability: 'p:0:0' }), { targets: [[{ kind: 'player', id: 'p1' }]] });
    s = resolveAll(s);
    expect(lifeOf(s, 'p1')).toBe(19);
    expect(handNames(s, 'p2')).toContain('Test Pinger');
    expect(bfNames(s, 'p2')).toEqual([]);
  });
  it('the negative cases: a spell\'s damage, and damage to the opponent, return nothing', () => {
    let s = scenario([], { p1: { battlefield: ['Test Warding Field'] }, p2: { hand: ['Test Zap'] }, defs });
    s = pass(s);
    s = cast(s, 'Test Zap', { targets: [[{ kind: 'player', id: 'p1' }]] }, 'p2');
    s = resolveAll(s);
    expect(lifeOf(s, 'p1')).toBe(18);
    expect(s.zones.stack.length).toBe(0);
    expect(gyNames(s, 'p2')).toEqual(['Test Zap']);
    let t = scenario([], { p1: { battlefield: ['Test Pinger', 'Test Warding Field'] }, p2: {}, defs });
    t = resolveAll(drive(act(t, { type: 'activate', player: 'p1', source: find(t, 'Test Pinger', 'battlefield', 'p1'), ability: 'p:0:0' }), { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(lifeOf(t, 'p2')).toBe(19);
    expect(bfNames(t, 'p1')).toEqual(['Test Pinger', 'Test Warding Field']);
  });
});

describe('"Whenever one or more opponents lose life, you may cast target instant or sorcery card from your graveyard. If that spell would be put into your graveyard, exile it instead. Do this only once each turn." (CR 119.3, 603.2c, 603.2h; Emet-Selch of the Third Seat)', () => {
  const EMET = card('Test Echo Seer', 'Creature — Wizard', 'Whenever one or more opponents lose life, you may cast target instant or sorcery card from your graveyard. If that spell would be put into your graveyard, exile it instead. Do this only once each turn.', '{0}', ['2', '2']);
  const DRAIN = card('Test Drain', 'Instant', 'Target opponent loses 1 life.');
  const SIPHON = card('Test Siphon', 'Sorcery', 'Each opponent loses 1 life.');
  const MEND = card('Test Mend', 'Sorcery', 'You gain 1 life.');
  const defs = [EMET, DRAIN, SIPHON, MEND];
  it('has no manual part', () => expect(full(EMET)).toBe(true));
  it('casts the target card from the graveyard when an opponent loses life, and the spell is exiled instead of going to the graveyard', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Echo Seer'], hand: ['Test Drain'], graveyard: ['Test Mend'] }, p2: {}, defs });
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Drain', 'hand', 'p1') }), { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = resolveAll(s, { targets: [[obj(find(s0, 'Test Mend', 'graveyard', 'p1'))]], yes: [true] });
    expect(lifeOf(s, 'p2')).toBe(19);
    expect(lifeOf(s, 'p1')).toBe(21);
    expect(exileNames(s)).toEqual(['Test Mend']);
    expect(gyNames(s, 'p1')).toEqual(['Test Drain']);
  });
  it('only once each turn: the second life loss of the turn does not trigger it again after the first cast', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Echo Seer'], hand: ['Test Drain', 'Test Drain'], graveyard: ['Test Mend', 'Test Mend'] }, p2: {}, defs });
    const [d1, d2] = s0.zones.hand.p1!;
    const [m1] = s0.zones.graveyard.p1!;
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: d1! }), { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = resolveAll(s, { targets: [[obj(m1!)]], yes: [true] });
    expect(lifeOf(s, 'p1')).toBe(21);
    s = drive(act(s, { type: 'cast', player: 'p1', card: d2! }), { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = resolveAll(s);
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(lifeOf(s, 'p1')).toBe(21); // no second cast
    expect(s.zones.stack.length).toBe(0);
    expect(exileNames(s)).toEqual(['Test Mend']);
    expect(gyNames(s, 'p1')).toEqual(['Test Drain', 'Test Drain', 'Test Mend']);
  });
  it('declining the cast does not use the turn\'s one action: the next life loss may cast', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Echo Seer'], hand: ['Test Drain', 'Test Drain'], graveyard: ['Test Mend'] }, p2: {}, defs });
    const [d1, d2] = s0.zones.hand.p1!;
    const mend = find(s0, 'Test Mend', 'graveyard', 'p1');
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: d1! }), { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = resolveAll(s, { targets: [[obj(mend)]], yes: [false] });
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(exileNames(s)).toEqual([]);
    s = drive(act(s, { type: 'cast', player: 'p1', card: d2! }), { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = resolveAll(s, { targets: [[obj(mend)]], yes: [true] });
    expect(lifeOf(s, 'p1')).toBe(21);
    expect(exileNames(s)).toEqual(['Test Mend']);
  });
  it('your own life loss, and an opponent\'s life gain, do not trigger it', () => {
    const LEECH = card('Test Leech', 'Sorcery', 'You lose 1 life.');
    const s0 = scenario([], { p1: { battlefield: ['Test Echo Seer'], hand: ['Test Leech'], graveyard: ['Test Mend'] }, p2: {}, defs: [...defs, LEECH] });
    const s = resolveAll(cast(s0, 'Test Leech'));
    expect(lifeOf(s, 'p1')).toBe(19);
    expect(s.zones.stack.length).toBe(0);
    expect(exileNames(s)).toEqual([]);
  });
  it('several opponents losing life at once is one trigger (the whole batch, CR 603.2c)', () => {
    let s = mpScenario({ players: 3, defs, zones: { p1: { battlefield: ['Test Echo Seer'], hand: ['Test Siphon'], graveyard: ['Test Mend', 'Test Mend'] }, p2: {}, p3: {} } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Siphon', 'hand', 'p1') });
    const mend = find(s, 'Test Mend', 'graveyard', 'p1');
    for (let i = 0; i < 6 && s.zones.stack.length === 1 && s.zones.stack.every((id) => s.objects[id]!.kind !== 'ability'); i++) s = drive(pass(s), { targets: [[obj(mend)]] });
    expect(s.zones.stack.filter((id) => s.objects[id]!.kind === 'ability').length).toBe(1); // one trigger for both opponents
    for (let i = 0; i < 20 && s.zones.stack.length > 0; i++) s = drive(pass(s), { targets: [[obj(mend)]], yes: [true] });
    expect(mpLife(s, 'p2')).toBe(19);
    expect(mpLife(s, 'p3')).toBe(19);
    expect(mpLife(s, 'p1')).toBe(21); // one cast of Test Mend only
  });
});

describe('"Whenever you activate a ninjutsu ability, ... This ability triggers only once each turn." (CR 702.49a, 603.2; Satoru Umezawa)', () => {
  const SCOUT = card('Test Night Scout', 'Creature — Human Ninja', 'Whenever you activate a ninjutsu ability, you gain 1 life. This ability triggers only once each turn.', '{0}', ['1', '1']);
  const GRANTER = card('Test Dojo Spirit', 'Creature — Spirit', 'Each creature card in your hand has ninjutsu {0}.', '{0}', ['1', '1']);
  const NINJA = card('Test Shade Runner', 'Creature — Human Ninja', 'Ninjutsu {0}', '{3}', ['2', '2']);
  const NINJA2 = card('Test Shade Walker', 'Creature — Human Ninja', 'Ninjutsu {0}', '{3}', ['2', '2']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const BEAR2 = card('Test Cub', 'Creature — Bear', '', '{0}', ['2', '2']);
  const PINGER = card('Test Pinger', 'Artifact', '{T}: ~ deals 1 damage to target player.');
  const defs = [SCOUT, GRANTER, NINJA, NINJA2, BEAR, BEAR2, PINGER];
  const ninjutsu = (s0: GameState, ninja: string, returned: ObjectId): GameState => {
    const a = legalActions(s0, 'p1').find((x) => x.kind === 'activate' && x.object === find(s0, ninja, 'hand', 'p1'));
    expect(a).toBeDefined();
    let s = act(s0, a!.action);
    for (let i = 0; i < 10 && s.pending && s.pending.kind !== 'priority'; i++) {
      if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (s.pending.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [returned] });
      else throw new Error(`unexpected ${s.pending.kind}`);
    }
    return s;
  };
  it('has no manual part', () => expect(full(SCOUT)).toBe(true));
  it('activating a printed ninjutsu ability triggers it', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Night Scout', 'Test Bear'], hand: ['Test Shade Runner'] }, p2: {}, defs });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    let s = runCombat(s0, { attack: [[bear]], until: 'declareBlockers' } as never);
    s = ninjutsu(s, 'Test Shade Runner', bear);
    expect(s.zones.stack.length).toBe(2); // the ninjutsu ability and the trigger above it
    s = resolveAll(s);
    expect(lifeOf(s, 'p1')).toBe(21);
    expect(bfNames(s, 'p1')).toContain('Test Shade Runner');
  });
  it('a ninjutsu ability a static ability gave to the creature cards in your hand is a ninjutsu ability too', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Night Scout', 'Test Dojo Spirit', 'Test Bear'], hand: ['Test Cub'] }, p2: {}, defs });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    let s = runCombat(s0, { attack: [[bear]], until: 'declareBlockers' } as never);
    s = ninjutsu(s, 'Test Cub', bear);
    s = resolveAll(s);
    expect(lifeOf(s, 'p1')).toBe(21);
    expect(bfNames(s, 'p1')).toContain('Test Cub');
  });
  it('only once each turn: a second ninjutsu activation the same turn does not trigger it again', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Night Scout', 'Test Bear', 'Test Cub'], hand: ['Test Shade Runner', 'Test Shade Walker'] }, p2: {}, defs });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const cub = find(s0, 'Test Cub', 'battlefield', 'p1');
    let s = runCombat(s0, { attack: [[bear], [cub]], until: 'declareBlockers' } as never);
    s = ninjutsu(s, 'Test Shade Runner', bear);
    s = resolveAll(s);
    expect(lifeOf(s, 'p1')).toBe(21);
    s = ninjutsu(s, 'Test Shade Walker', cub);
    expect(s.zones.stack.length).toBe(1); // only the ninjutsu ability
    s = resolveAll(s);
    expect(lifeOf(s, 'p1')).toBe(21);
    expect(bfNames(s, 'p1')).toContain('Test Shade Walker');
  });
  it('the negative case: another activated ability (no ninjutsu) does not trigger it', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Night Scout', 'Test Pinger'] }, p2: {}, defs });
    const s = resolveAll(drive(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Pinger', 'battlefield', 'p1'), ability: 'p:0:0' }), { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(lifeOf(s, 'p2')).toBe(19);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

describe('"When ~ dies, choose one -- look at the top seven cards ... any number of nonland permanent cards with total mana value 4 or less ... the rest on the bottom; or counters on each permanent you control that\'s a creature or Vehicle." (CR 202.3, 608.2d, 700.2; Ao, the Dawn Sky)', () => {
  const DRAKE = card('Test Dawn Drake', 'Legendary Creature — Dragon Spirit', 'When ~ dies, choose one --\n• Look at the top four cards of your library. Put any number of nonland permanent cards with total mana value 4 or less from among them onto the battlefield. Put the rest on the bottom of your library in a random order.\n• Put two +1/+1 counters on each permanent you control that\'s a creature or Vehicle.', '{0}', ['2', '2']);
  const IMP = card('Test Imp', 'Creature — Imp', '', '{1}', ['1', '1']);
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{3}', ['3', '3']);
  const BRUTE = card('Test Brute', 'Creature — Giant', '', '{5}', ['5', '5']);
  const MOAT = card('Test Moat', 'Land', '');
  const CART = card('Test Cart', 'Artifact — Vehicle', 'Crew 1', '{0}', ['3', '3']);
  const IDOL = card('Test Idol', 'Artifact', '');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{2}', ['2', '2']);
  const KILL = card('Test Smite', 'Instant', 'Destroy target creature.');
  const defs = [DRAKE, IMP, OGRE, BRUTE, MOAT, CART, IDOL, BEAR, KILL];
  it('has no manual part', () => expect(full(DRAKE)).toBe(true));
  const dies = (s0: GameState, script: Parameters<typeof drive>[1]): GameState => {
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Smite', 'hand', 'p1') }), { targets: [[obj(find(s0, 'Test Dawn Drake', 'battlefield', 'p1'))]] });
    for (let i = 0; i < 12 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); i++) s = s.pending && s.pending.kind !== 'priority' ? drive(s, script) : drive(pass(s), script);
    return s;
  };
  it('the first mode: any number of the nonland permanent cards whose mana values add up to 4 or less go onto the battlefield, the rest on the bottom', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Dawn Drake'], hand: ['Test Smite'] }, p2: {}, defs });
    setLibrary(s0, 'p1', ['Test Ogre', 'Test Moat', 'Test Imp', 'Test Brute', 'Test Bear']);
    const [ogre, , imp] = s0.zones.library.p1!;
    const s = dies(s0, { options: [['0']], objects: [[ogre!, imp!]] });
    expect(bfNames(s, 'p1')).toEqual(['Test Imp', 'Test Ogre']);
    expect(libNames(s, 'p1').slice(0, 1)).toEqual(['Test Bear']);
    expect([...libNames(s, 'p1').slice(-2)].sort()).toEqual(['Test Brute', 'Test Moat']);
    expect(libNames(s, 'p1').length).toBe(3);
    expect(gyNames(s, 'p1')).toEqual(['Test Dawn Drake', 'Test Smite']);
  });
  it('the negative case: a set whose mana values add up to more than 4 is refused', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Dawn Drake'], hand: ['Test Smite'] }, p2: {}, defs });
    setLibrary(s0, 'p1', ['Test Ogre', 'Test Moat', 'Test Imp', 'Test Brute', 'Test Bear']);
    const [ogre, , imp, brute] = s0.zones.library.p1!;
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Smite', 'hand', 'p1') }), { targets: [[obj(find(s0, 'Test Dawn Drake', 'battlefield', 'p1'))]] });
    for (let i = 0; i < 12 && !(s.pending?.kind === 'chooseObjects'); i++) s = s.pending && s.pending.kind !== 'priority' ? drive(s, { options: [['0']] }) : pass(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    const pending = s.pending as unknown as { options: string[] };
    expect(pending.options.sort()).toEqual([ogre, imp, brute].sort()); // the land is not offered, the fifth card was not looked at
    expect(() => answer(s, { kind: 'chooseObjects', ids: [ogre!, imp!, brute!] })).toThrow();
    expect(() => answer(s, { kind: 'chooseObjects', ids: [brute!] })).toThrow(); // 5 alone is over the limit
  });
  it('the second mode: two +1/+1 counters on each creature and Vehicle you control, not on other permanents or on an opponent\'s creature', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Dawn Drake', 'Test Cart', 'Test Idol', 'Test Bear'], hand: ['Test Smite'] }, p2: { battlefield: ['Test Imp'] }, defs });
    const s = dies(s0, { options: [['1']] });
    const counters = (n: string, p: 'p1' | 'p2'): number => s.objects[find(s, n, 'battlefield', p)]!.counters['+1/+1'] ?? 0;
    expect(counters('Test Bear', 'p1')).toBe(2);
    expect(counters('Test Cart', 'p1')).toBe(2);
    expect(counters('Test Idol', 'p1')).toBe(0);
    expect(counters('Test Imp', 'p2')).toBe(0);
    expect(gyNames(s, 'p1')).toEqual(['Test Dawn Drake', 'Test Smite']);
  });
});
