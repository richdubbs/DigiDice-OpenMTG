/**
 * Commander coordinator D, round edh-d-16 (EDHREC ranks 12,501-13,750, fifth pass): the round's readings played through the engine with synthetic cards (invented names, design
 * 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites
 * from the Comprehensive Rules of 2026-09-25.
 *
 *   CR 701.20a, 608.2d, 401.4   "Reveal the top four cards ... Put any number of creature and/or land cards from among them into your hand and the rest on the bottom ..." (Torsten, Founder of Benalia)
 *   CR 701.20e, 508.4, 202.3    "Whenever ~ attacks, look at the top three cards ... You may put a creature card with mana value 3 or less from among them onto the battlefield tapped and attacking." (Jet, Rebel Leader)
 *   CR 401.7, 400.3             "{2}{G}: Put ~ from your graveyard into your library third from the top." (Bookwurm)
 *   CR 608.2g, 601.2, 118.9     "... you may cast an instant or sorcery spell with mana value less than or equal to the number of Spirits you control from a graveyard without paying its mana cost. If that spell would be put into a graveyard, exile it instead." (Spectral Arcanist)
 *   CR 608.2d, 406.3, 118.9     "Exile an instant or sorcery card with mana value 3 or less from your graveyard at random. You may cast it without paying its mana cost. If that spell would be put into a graveyard, exile it instead." (Storm of Memories)
 *   CR 118.9, 601.2b, 404.1     "You may cast ~ from your graveyard by paying {2}{W} rather than paying its mana cost." (Raffine's Guidance)
 */
import { describe, expect, it } from 'vitest';
import { getChars, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act, advanceTo, answer, card, cast, drive, find, full, legal, passBoth, resolveAll, scenario } from '../r3-cost/support';

const nameOf = (s: GameState, id: string): string => getChars(s, id).name;
const names = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: PlayerId): string[] => s.zones[zone][p]!.map((id) => nameOf(s, id));
const exiled = (s: GameState): string[] => s.zones.exile.map((id) => nameOf(s, id));
const idIn = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: PlayerId, name: string): ObjectId => s.zones[zone][p]!.find((id) => nameOf(s, id) === name)!;
const idOn = (s: GameState, name: string, p?: PlayerId): ObjectId => s.zones.battlefield.find((id) => nameOf(s, id) === name && (p === undefined || s.objects[id]!.controller === p))!;
/** The options of the pending choice of objects, by name (the decision must be a choice of objects). */
const offered = (s: GameState): string[] => {
  const p = s.pending as unknown as { kind: string; options: ObjectId[] };
  expect(p.kind).toBe('chooseObjects');
  return p.options.map((id) => nameOf(s, id)).sort();
};

const FOREST = card('Test Forest', 'Land', '');
const MOUNTAIN = card('Test Mountain', 'Land', '');
const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const BIGBEAR = card('Test Big Bear', 'Creature — Bear', '', '{5}', ['5', '5']);
const RELIC = card('Test Relic', 'Artifact', '');
const GROVE = card('Forest', 'Basic Land — Forest', '');
const PLAINS = card('Plains', 'Basic Land — Plains', '');

describe('"Put any number of creature and/or land cards from among them into your hand and the rest on the bottom of your library in a random order." (CR 701.20a, 608.2d, 401.4; Torsten, Founder of Benalia)', () => {
  const REVEAL = card('Test Surveyor', 'Sorcery', 'Reveal the top four cards of your library. Put any number of creature and/or land cards from among them into your hand and the rest on the bottom of your library in a random order.');
  const defs = [REVEAL, FOREST, MOUNTAIN, BEAR, RELIC];
  const start = () => scenario([], { p1: { hand: ['Test Surveyor'], library: ['Test Forest', 'Test Relic', 'Test Bear', 'Test Mountain', 'Test Relic'] }, p2: {}, defs });
  it('has no manual part', () => expect(full(REVEAL)).toBe(true));
  it('only creature and land cards among the top four are offered; the chosen ones go to the hand, everything else to the bottom, the fifth card is never touched', () => {
    let s = cast(start(), 'Test Surveyor');
    s = passBoth(s);
    expect(offered(s)).toEqual(['Test Bear', 'Test Forest', 'Test Mountain']);
    s = drive(s, { objects: [[idIn(s, 'library', 'p1', 'Test Bear'), idIn(s, 'library', 'p1', 'Test Mountain')]] });
    expect(names(s, 'hand', 'p1').sort()).toEqual(['Test Bear', 'Test Mountain']);
    const lib = names(s, 'library', 'p1');
    expect(lib[0]).toBe('Test Relic'); // the fifth card is on top now: it was not revealed
    expect(lib.slice(-2).sort()).toEqual(['Test Forest', 'Test Relic']); // the unchosen land and the artifact went to the bottom
  });
  it('the negative case: "any number" includes none (every revealed card goes to the bottom, nothing to the hand)', () => {
    let s = cast(start(), 'Test Surveyor');
    s = passBoth(s);
    s = drive(s, { objects: [[]] });
    expect(names(s, 'hand', 'p1')).toEqual([]);
    expect(names(s, 'library', 'p1').slice(-4).sort()).toEqual(['Test Bear', 'Test Forest', 'Test Mountain', 'Test Relic']);
  });
});

/** Declare the given attacks on turn 1 (p1) and let combat run with no blocks; every choice of objects is answered with `pick`. Stops in main 2. */
function attack(s0: GameState, attacks: { attacker: ObjectId; defender: string }[], pick: (s: GameState) => ObjectId[] = () => []): GameState {
  let s = s0;
  for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
  s = answer(s, { kind: 'declareAttackers', attacks });
  for (let i = 0; i < 60 && !(s.turn.step === 'main2' && s.zones.stack.length === 0); i++) {
    const p = s.pending;
    if (p?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (p?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: pick(s) });
    else if (p?.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else if (p?.kind === 'priority') s = act(s, { type: 'pass', player: p.player });
    else throw new Error(`unexpected decision ${p?.kind}`);
  }
  return s;
}

describe('"Whenever ~ attacks, look at the top three cards ... You may put a creature card with mana value 3 or less from among them onto the battlefield tapped and attacking." (CR 701.20e, 508.4, 202.3; Jet, Rebel Leader)', () => {
  const LEADER = card('Test Leader', 'Creature — Human', 'Whenever this creature attacks, look at the top three cards of your library. You may put a creature card with mana value 3 or less from among them onto the battlefield tapped and attacking. Put the rest on the bottom of your library in a random order.', '{0}', ['2', '2']);
  const defs = [LEADER, BEAR, BIGBEAR, RELIC];
  const start = (lib: string[]) => scenario([], { p1: { battlefield: ['Test Leader'], library: lib }, p2: {}, defs });
  it('has no manual part', () => expect(full(LEADER)).toBe(true));
  it('only a creature card of mana value 3 or less is offered (not the 5-drop, not the artifact); the chosen one enters tapped and attacking (it deals combat damage), the rest go to the bottom', () => {
    const s0 = start(['Test Big Bear', 'Test Bear', 'Test Relic', 'Test Relic']);
    let seen: string[] = [];
    const s = attack(s0, [{ attacker: idOn(s0, 'Test Leader'), defender: 'p2' }], (st) => { seen = offered(st); return [idIn(st, 'library', 'p1', 'Test Bear')]; });
    expect(seen).toEqual(['Test Bear']);
    const bear = idOn(s, 'Test Bear', 'p1');
    expect(bear).toBeDefined();
    expect(s.objects[bear]!.tapped).toBe(true);
    expect(s.players.find((x) => x.id === 'p2')!.life).toBe(16); // the Leader (2) and the Bear (2) both dealt combat damage
    expect(names(s, 'library', 'p1')[0]).toBe('Test Relic'); // the fourth card was not looked at
    expect(names(s, 'library', 'p1').slice(-2).sort()).toEqual(['Test Big Bear', 'Test Relic']);
  });
  it('the negative case: "may" - taking none is allowed (the creature stays in the library), and with no attack nothing is looked at', () => {
    const s0 = start(['Test Bear', 'Test Relic', 'Test Relic']);
    const s = attack(s0, [{ attacker: idOn(s0, 'Test Leader'), defender: 'p2' }], () => []);
    expect(idOn(s, 'Test Bear', 'p1')).toBeUndefined();
    expect(s.players.find((x) => x.id === 'p2')!.life).toBe(18);
    const none = attack(start(['Test Bear']), [], () => { throw new Error('nothing should be looked at'); });
    expect(idOn(none, 'Test Bear', 'p1')).toBeUndefined();
  });
});

describe('"{2}{G}: Put ~ from your graveyard into your library third from the top." (CR 401.7, 400.3; Bookwurm)', () => {
  const WURM = card('Test Wurm', 'Creature — Wurm', '{2}{G}: Put Test Wurm from your graveyard into your library third from the top.', '{5}', ['5', '5']);
  const board = (zone: 'graveyard' | 'battlefield' | 'hand', lands = 3): GameState =>
    scenario([], { defs: [WURM, RELIC, GROVE], p1: { [zone]: ['Test Wurm'], battlefield: Array(lands).fill('Forest') as string[], library: ['Test Relic', 'Test Relic', 'Test Relic', 'Test Relic'] }, p2: {} });
  const activations = (s: GameState) => legal(s, 'p1', 'activate').filter((a) => (a as { object?: ObjectId }).object === s.zones.graveyard['p1']!.find((id) => nameOf(s, id) === 'Test Wurm') && !(a as { isMana?: boolean }).isMana);
  it('has no manual part', () => expect(full(WURM)).toBe(true));
  it('from the graveyard it goes into the library with two cards above it (third from the top)', () => {
    const s0 = board('graveyard');
    const a = activations(s0)[0] as unknown as { action: Parameters<typeof act>[1] };
    const s = resolveAll(drive(act(s0, a.action)));
    expect(names(s, 'library', 'p1').slice(0, 4)).toEqual(['Test Relic', 'Test Relic', 'Test Wurm', 'Test Relic']);
    expect(names(s, 'graveyard', 'p1')).toEqual([]);
  });
  it('the negative case: it cannot be activated from the battlefield or the hand, nor with two lands', () => {
    expect(activations(board('battlefield')).length).toBe(0);
    expect(activations(board('hand')).length).toBe(0);
    expect(activations(board('graveyard', 2)).length).toBe(0);
  });
});

describe('"You may cast an instant or sorcery spell with mana value less than or equal to the number of Spirits you control from a graveyard without paying its mana cost. If that spell would be put into a graveyard, exile it instead." (CR 608.2g, 601.2, 118.9, 614.1a; Spectral Arcanist)', () => {
  const SPIRIT = card('Test Spirit', 'Creature — Spirit', '', '{0}', ['1', '1']);
  const ARCANIST = card('Test Arcanist', 'Sorcery', 'You may cast an instant or sorcery spell with mana value less than or equal to the number of Spirits you control from a graveyard without paying its mana cost. If that spell would be put into a graveyard, exile it instead.');
  const SIP = card('Test Sip', 'Instant', 'Draw a card.', '{1}');
  const GULP = card('Test Gulp', 'Sorcery', 'Draw a card.', '{2}');
  const FEAST = card('Test Feast', 'Sorcery', 'Draw a card.', '{3}');
  const defs = [SPIRIT, ARCANIST, SIP, GULP, FEAST, BEAR, RELIC];
  const start = (spirits: number) => scenario([], {
    p1: { hand: ['Test Arcanist'], battlefield: Array(spirits).fill('Test Spirit') as string[], graveyard: ['Test Sip', 'Test Feast', 'Test Bear'], library: ['Test Relic', 'Test Relic', 'Test Relic'] },
    p2: { graveyard: ['Test Gulp'] }, defs });
  it('has no manual part', () => expect(full(ARCANIST)).toBe(true));
  it('with two Spirits, an instant or sorcery card of mana value 2 or less from any graveyard is offered (yours or an opponent\'s), not the mana value 3 one nor a creature; cast free from the opponent\'s graveyard it is exiled instead of going to a graveyard', () => {
    let s = cast(start(2), 'Test Arcanist');
    s = passBoth(s);
    expect(offered(s)).toEqual(['Test Gulp', 'Test Sip']);
    s = drive(s, { objects: [[(s.pending as unknown as { options: ObjectId[] }).options.find((id) => nameOf(s, id) === 'Test Gulp')!]] });
    s = resolveAll(s);
    expect(names(s, 'hand', 'p1')).toEqual(['Test Relic']); // the spell drew a card
    expect(names(s, 'graveyard', 'p2')).toEqual([]);
    expect(exiled(s)).toEqual(['Test Gulp']);
    expect(names(s, 'graveyard', 'p1').sort()).toEqual(['Test Arcanist', 'Test Bear', 'Test Feast', 'Test Sip']);
  });
  it('the negative case: with one Spirit only the mana value 1 card is offered, and with none nothing is (no card of mana value 0 is there)', () => {
    let s = cast(start(1), 'Test Arcanist');
    s = passBoth(s);
    expect(offered(s)).toEqual(['Test Sip']);
    const none = passBoth(cast(start(0), 'Test Arcanist'));
    expect(none.pending?.kind === 'chooseObjects' ? (none.pending as unknown as { options: ObjectId[] }).options : []).toEqual([]);
  });
});

describe('"Exile an instant or sorcery card with mana value 3 or less from your graveyard at random. You may cast it without paying its mana cost. If that spell would be put into a graveyard, exile it instead." (CR 608.2d, 406.3, 118.9, 614.1a; Storm of Memories)', () => {
  const MEMORY = card('Test Memory', 'Sorcery', 'Exile an instant or sorcery card with mana value 3 or less from your graveyard at random. You may cast it without paying its mana cost. If that spell would be put into a graveyard, exile it instead.');
  const SIP = card('Test Sip', 'Instant', 'Draw a card.', '{1}');
  const FEAST = card('Test Feast', 'Sorcery', 'Draw a card.', '{4}');
  const defs = [MEMORY, SIP, FEAST, BEAR, RELIC];
  const start = () => scenario([], { p1: { hand: ['Test Memory'], graveyard: ['Test Sip', 'Test Feast', 'Test Bear'], library: ['Test Relic', 'Test Relic'] }, p2: {}, defs });
  it('has no manual part', () => expect(full(MEMORY)).toBe(true));
  it('only the instant of mana value 1 can be exiled (the mana value 4 sorcery and the creature never); cast free it resolves and is exiled afterwards, not put into the graveyard', () => {
    let s = cast(start(), 'Test Memory');
    s = passBoth(s);
    s = drive(s, { yes: [true] });
    s = resolveAll(s);
    expect(names(s, 'hand', 'p1')).toEqual(['Test Relic']);
    expect(exiled(s)).toEqual(['Test Sip']);
    expect(names(s, 'graveyard', 'p1').sort()).toEqual(['Test Bear', 'Test Feast', 'Test Memory']);
  });
  it('the negative case: declining the free cast leaves the exiled card in exile and draws nothing', () => {
    let s = cast(start(), 'Test Memory');
    s = passBoth(s);
    s = drive(s, { yes: [false] });
    s = resolveAll(s);
    expect(names(s, 'hand', 'p1')).toEqual([]);
    expect(exiled(s)).toEqual(['Test Sip']);
  });
});

describe('"You may cast ~ from your graveyard by paying {2}{W} rather than paying its mana cost." (CR 118.9, 601.2b, 404.1; Raffine\'s Guidance)', () => {
  const GUIDE = card('Test Guidance', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.\nYou may cast Test Guidance from your graveyard by paying {2}{W} rather than paying its mana cost.', '{W}');
  const defs = [GUIDE, BEAR, PLAINS];
  const board = (zone: 'graveyard' | 'hand' | 'exile', lands: number): GameState => scenario([], { p1: { [zone]: ['Test Guidance'], battlefield: ['Test Bear', ...(Array(lands).fill('Plains') as string[])] }, p2: {}, defs });
  const castable = (s: GameState): number => legal(s, 'p1', 'cast').filter((a) => (a as { object?: ObjectId }).object === find(s, 'Test Guidance', (s.zones.graveyard['p1']!.some((id) => nameOf(s, id) === 'Test Guidance') ? 'graveyard' : 'hand'), 'p1')).length;
  it('has no manual part', () => expect(full(GUIDE)).toBe(true));
  it('from the graveyard it can be cast with three lands (the alternative cost {2}{W}), not with two', () => {
    expect(castable(board('graveyard', 3))).toBeGreaterThan(0);
    expect(castable(board('graveyard', 2))).toBe(0);
  });
  it('the negative case: the permission is for the graveyard only (from exile it cannot be cast), and from the hand the normal cost {W} still works', () => {
    const away = board('exile', 4);
    expect(legal(away, 'p1', 'cast').length).toBe(0);
    expect(castable(board('hand', 1))).toBeGreaterThan(0);
  });
});
