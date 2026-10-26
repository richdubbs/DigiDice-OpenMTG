/**
 * Lane pc-tokens, round pc-tokens-1 (Commander precon decks: tokens), played through the engine with synthetic cards compiled by the game's default compiler (invented
 * names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 701.44a, 608.2f            "Each Elf you control explores.": every Elf of the controller, each exploring on its own (a land to the hand, a nonland card a +1/+1 counter)
 *   CR 701.21a, 608.2c, 608.2h    "Each other player sacrifices a creature of their choice. You create a Zombie token for each creature sacrificed this way."
 *   CR 608.2c, 608.2h, 400.7      "... for each nontoken creature you controlled that was destroyed this way": your nontoken creatures only, as they last existed
 *   CR 122.1f, 102.3              "... for each poison counter your opponents have"
 *   CR 608.2d, 101.4, 608.2c      "Each opponent may create a Food token. For each opponent who does, you create a Food token."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, legal, pass, scenario } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
const namesIn = (s: GameState, zone: 'hand' | 'graveyard' | 'library', who: PlayerId): string[] => s.zones[zone][who]!.map((id) => s.objects[id]!.defId);
const count = (s: GameState, name: string, who: PlayerId): number => findAll(s, name, 'battlefield', who).length;
const tokens = (s: GameState, who: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === who);

/** Answer every decision: yes/no by `yes` (per player when a function), objects by `pick`, mana automatically. */
function drive(s0: GameState, o: { yes?: boolean | ((who: PlayerId) => boolean); pick?: (options: ObjectId[], who: PlayerId) => ObjectId[] } = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: typeof o.yes === 'function' ? o.yes(p.player) : o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options, p.player) : p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const cast = (s0: GameState, name: string, o: Parameters<typeof drive>[1] = {}, who: PlayerId = 'p1'): GameState =>
  resolveAll(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), o);

const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const GROVE = card('Test Grove', 'Land — Forest', '');
const RELIC = card('Test Relic', 'Artifact', '');
const WALL = card('Test Wall', 'Creature — Wall', 'Indestructible', { pt: ['0', '4'] });

// ---- CR 701.44a, 608.2f: each Elf you control explores -----------------------------------------------------------------------------------------------------

describe('CR 701.44a, 608.2f: "Each Elf you control explores."', () => {
  const SONG = card('Test Song', 'Sorcery', 'Each Elf you control explores.');
  const defs = [SONG, ELF, BEAR, GROVE, RELIC];
  it('is fully automated', () => expect(full(SONG)).toBe(true));
  it('two Elves explore one after the other: a land on top goes to the hand, then a nonland card puts a +1/+1 counter on the second Elf; the Bear and the opponent\'s Elf do nothing', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Song'], library: ['Test Grove', 'Test Relic', 'Test Bear'], battlefield: ['Test Elf', 'Test Elf', 'Test Bear'] }, p2: { battlefield: ['Test Elf'], library: ['Test Grove'] } });
    const elves = findAll(s, 'Test Elf', 'battlefield', 'p1');
    const theirs = find(s, 'Test Elf', 'battlefield', 'p2');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Song', { yes: false });
    expect(namesIn(s, 'hand', 'p1')).toEqual(['Test Grove']); // the land of the first explore
    const counters = elves.map((id) => s.objects[id]!.counters['+1/+1'] ?? 0).sort();
    expect(counters).toEqual([0, 1]); // exactly one Elf got the counter (the nonland card revealed by the other explore)
    expect(s.objects[bear]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(s.objects[theirs]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(namesIn(s, 'library', 'p2')[0]).toBe('Test Grove'); // the opponent's library untouched
    expect(chars(s, elves.find((id) => (s.objects[id]!.counters['+1/+1'] ?? 0) === 1)!).power).toBe('2');
  });
  it('no Elf: nothing is revealed (the library keeps its order)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Song'], library: ['Test Grove', 'Test Relic'], battlefield: ['Test Bear'] } });
    s = cast(s, 'Test Song');
    expect(namesIn(s, 'hand', 'p1')).toEqual([]);
    expect(namesIn(s, 'library', 'p1').slice(0, 2)).toEqual(['Test Grove', 'Test Relic']);
  });
});

// ---- CR 701.21a, 608.2c: Syphon Flesh --------------------------------------------------------------------------------------------------------------------

describe('CR 701.21a, 608.2c, 608.2h: "Each other player sacrifices a creature of their choice. You create a 2/2 black Zombie creature token for each creature sacrificed this way."', () => {
  const FLESH = card('Test Flesh', 'Sorcery', 'Each other player sacrifices a creature of their choice. You create a 2/2 black Zombie creature token for each creature sacrificed this way.');
  const defs = [FLESH, BEAR, ELF];
  it('is fully automated', () => expect(full(FLESH)).toBe(true));
  it('the opponent sacrifices one creature of their choice and you get one Zombie; your own creatures stay', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Flesh'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Elf', 'Test Bear'] } });
    s = cast(s, 'Test Flesh', { pick: (options) => [options[options.length - 1]!] });
    expect(count(s, 'Test Bear', 'p1')).toBe(1);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2').length).toBe(1);
    expect(tokens(s, 'p1').length).toBe(1);
    expect(chars(s, tokens(s, 'p1')[0]!).power).toBe('2');
  });
  it('an opponent with no creature sacrifices none, so you get no Zombie', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Flesh'], battlefield: ['Test Bear'] }, p2: {} });
    s = cast(s, 'Test Flesh');
    expect(tokens(s, 'p1').length).toBe(0);
    expect(count(s, 'Test Bear', 'p1')).toBe(1);
  });
});

// ---- CR 608.2c, 608.2h, 400.7: Ceaseless Conflict ----------------------------------------------------------------------------------------------------------

describe('CR 608.2c, 608.2h, 400.7: "Destroy all creatures. Then create a 3/2 red and white Spirit creature token for each nontoken creature you controlled that was destroyed this way."', () => {
  const CONFLICT = card('Test Conflict', 'Sorcery', 'Destroy all creatures. Then create a 3/2 red and white Spirit creature token for each nontoken creature you controlled that was destroyed this way.');
  const MAKER = card('Test Maker', 'Sorcery', 'Create a 1/1 white Soldier creature token.');
  const defs = [CONFLICT, MAKER, BEAR, ELF, WALL];
  it('is fully automated', () => expect(full(CONFLICT)).toBe(true));
  it('counts your nontoken creatures that died: two of yours and two of the opponent\'s are destroyed, two Spirits come (the Spirits made after are not counted)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Conflict'], battlefield: ['Test Bear', 'Test Elf'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] } });
    s = cast(s, 'Test Conflict');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind !== 'token').length).toBe(0);
    expect(tokens(s, 'p1').length).toBe(2); // two Spirits
    expect(tokens(s, 'p2').length).toBe(0);
  });
  it('an indestructible creature of yours is not destroyed and not counted', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Conflict'], battlefield: ['Test Wall', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    s = cast(s, 'Test Conflict');
    expect(count(s, 'Test Wall', 'p1')).toBe(1);
    expect(tokens(s, 'p1').length).toBe(1); // only the Bear
  });
  it('only your own: with just an opponent\'s creature destroyed, no Spirit', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Conflict'] }, p2: { battlefield: ['Test Bear'] } });
    s = cast(s, 'Test Conflict');
    expect(tokens(s, 'p1').length).toBe(0);
  });
  it('your tokens destroyed with the rest are not counted (nontoken only)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Maker', 'Test Conflict'], battlefield: ['Test Bear'] } });
    s = cast(s, 'Test Maker');
    expect(tokens(s, 'p1').length).toBe(1);
    s = cast(s, 'Test Conflict');
    expect(tokens(s, 'p1').length).toBe(1); // the old Soldier is gone; one Spirit for the Bear
    expect(chars(s, tokens(s, 'p1')[0]!).power).toBe('3');
  });
});

// ---- CR 122.1f, 102.3: Phyrexian Swarmlord -----------------------------------------------------------------------------------------------------------------

describe('CR 122.1f, 102.3, 608.2h: "Create a 1/1 green Insect creature token for each poison counter your opponents have."', () => {
  const SWARM = card('Test Swarm', 'Sorcery', 'Create a 1/1 green Insect creature token for each poison counter your opponents have.');
  const defs = [SWARM];
  it('is fully automated', () => expect(full(SWARM)).toBe(true));
  it('three poison counters on the opponent make three Insects; none, none', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Swarm'] } });
    s.players.find((p) => p.id === 'p2')!.poison = 3;
    s = cast(s, 'Test Swarm');
    expect(tokens(s, 'p1').length).toBe(3);
    let z = scenario([], { defs, p1: { hand: ['Test Swarm'] } });
    z = cast(z, 'Test Swarm');
    expect(tokens(z, 'p1').length).toBe(0);
  });
  it('your own poison counters do not count', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Swarm'] } });
    s.players.find((p) => p.id === 'p1')!.poison = 4;
    s = cast(s, 'Test Swarm');
    expect(tokens(s, 'p1').length).toBe(0);
  });
  it('as a static: "This creature gets +1/+1 for each poison counter your opponents have." follows the opponent\'s poison counters as they change', () => {
    const FIEND = card('Test Fiend', 'Creature — Phyrexian', 'This creature gets +1/+1 for each poison counter your opponents have.', { pt: ['1', '1'] });
    expect(full(FIEND)).toBe(true);
    const s = scenario([], { defs: [FIEND], p1: { battlefield: ['Test Fiend'] } });
    const id = find(s, 'Test Fiend', 'battlefield', 'p1');
    expect(chars(s, id).power).toBe('1');
    s.players.find((p) => p.id === 'p2')!.poison = 3;
    expect(chars(s, id).power).toBe('4');
    expect(chars(s, id).toughness).toBe('4');
    s.players.find((p) => p.id === 'p1')!.poison = 5; // your own do not count
    expect(chars(s, id).power).toBe('4');
  });
  it('as a static in a four-player game (Commander): the poison counters of ALL opponents are added (review fix: the static reader named exactly one player)', () => {
    const FIEND = card('Test Fiend', 'Creature — Phyrexian', 'This creature gets +1/+1 for each poison counter your opponents have.', { pt: ['1', '1'] });
    const s = mpScenario({ defs: [FIEND], zones: { p1: { battlefield: ['Test Fiend'] } } });
    const id = find(s, 'Test Fiend', 'battlefield', 'p1');
    expect(chars(s, id).power).toBe('1');
    s.players.find((p) => p.id === 'p2')!.poison = 2;
    expect(chars(s, id).power).toBe('3');
    s.players.find((p) => p.id === 'p3')!.poison = 3;
    expect(chars(s, id).power).toBe('6');
    s.players.find((p) => p.id === 'p1')!.poison = 9; // yours do not count
    expect(chars(s, id).power).toBe('6');
  });
});

// ---- CR 608.2d, 101.4, 608.2c: the tempting offers ---------------------------------------------------------------------------------------------------------

describe('CR 608.2d, 101.4, 608.2c: "Each opponent may create a Food token. For each opponent who does, you create a Food token."', () => {
  const OFFER = card('Test Offer', 'Sorcery', 'Each opponent may create a Food token. For each opponent who does, you create a Food token.');
  const BIG = card('Test Big Offer', 'Sorcery', 'Create two 1/1 white Soldier creature tokens. Each opponent may create two 1/1 white Soldier creature tokens. For each opponent who does, create two 1/1 white Soldier creature tokens.');
  const defs = [OFFER, BIG];
  const food = (s: GameState, who: PlayerId): number => tokens(s, who).filter((id) => chars(s, id).subtypes.includes('Food')).length;
  it('are fully automated', () => { expect(full(OFFER)).toBe(true); expect(full(BIG)).toBe(true); });
  it('the opponent accepts: they get a Food and so do you (you gave them none beforehand)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Offer'] } });
    s = cast(s, 'Test Offer', { yes: true });
    expect(food(s, 'p2')).toBe(1);
    expect(food(s, 'p1')).toBe(1);
  });
  it('the opponent declines: nobody gets a Food', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Offer'] } });
    s = cast(s, 'Test Offer', { yes: false });
    expect(food(s, 'p2')).toBe(0);
    expect(food(s, 'p1')).toBe(0);
  });
  it('the amounts: you make two, the accepting opponent two, and two more for you', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Big Offer'] } });
    s = cast(s, 'Test Big Offer', { yes: true });
    expect(tokens(s, 'p1').length).toBe(4);
    expect(tokens(s, 'p2').length).toBe(2);
    let z = scenario([], { defs, p1: { hand: ['Test Big Offer'] } });
    z = cast(z, 'Test Big Offer', { yes: false });
    expect(tokens(z, 'p1').length).toBe(2);
    expect(tokens(z, 'p2').length).toBe(0);
  });
  it('the question goes to the opponent, not to you', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Offer'] } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Offer', 'hand', 'p1') });
    const asked: PlayerId[] = [];
    for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
      if (s.pending?.kind === 'yesNo') asked.push(s.pending.player);
      s = s.pending?.kind === 'priority' ? pass(s) : drive(s, { yes: true });
    }
    expect(asked).toEqual(['p2']);
    void legal;
  });
});

describe('CR 608.2d, 121.1, 111.1: "Each opponent may draw a card and create a 1/1 white Rabbit creature token. For each opponent who does, you draw a card and you create a 1/1 white Rabbit creature token."', () => {
  const BUN = card('Test Bunnies', 'Sorcery', 'Draw a card and create a 1/1 white Rabbit creature token. Then each opponent may draw a card and create a 1/1 white Rabbit creature token. For each opponent who does, you draw a card and you create a 1/1 white Rabbit creature token.');
  const defs = [BUN];
  it('is fully automated', () => expect(full(BUN)).toBe(true));
  it('the opponent accepts: they draw and get a Rabbit (one answer for both), and you draw and get a second Rabbit', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Bunnies'] } });
    const handBefore = [s.zones.hand['p1']!.length - 1, s.zones.hand['p2']!.length];
    s = cast(s, 'Test Bunnies', { yes: true });
    expect(s.zones.hand['p1']!.length).toBe(handBefore[0]! + 2); // two draws
    expect(s.zones.hand['p2']!.length).toBe(handBefore[1]! + 1);
    expect(tokens(s, 'p1').length).toBe(2);
    expect(tokens(s, 'p2').length).toBe(1);
  });
  it('the opponent declines: only your first draw and Rabbit', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Bunnies'] } });
    const handBefore = [s.zones.hand['p1']!.length - 1, s.zones.hand['p2']!.length];
    s = cast(s, 'Test Bunnies', { yes: false });
    expect(s.zones.hand['p1']!.length).toBe(handBefore[0]! + 1);
    expect(s.zones.hand['p2']!.length).toBe(handBefore[1]!);
    expect(tokens(s, 'p1').length).toBe(1);
    expect(tokens(s, 'p2').length).toBe(0);
  });
});
