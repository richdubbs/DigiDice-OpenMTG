/**
 * T17 (FAST3 wave, template family R2-C: token creation with computed counts, choices and Roles; library searches with "reveal that card" and put
 * references): the cards the T17 templates and renderer changes automate, played through applyAction with synthetic cards compiled by the game's default
 * compiler (wordings are invented, design 6.10). Each test is named after the rule it checks.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, charsOfObject, type AbilityDef, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, legal, passBoth, scenario } from '../../m3/scenario';
import { runCombat } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard as never);
}
/** The abilities of a card that are manual or hold a manual step. */
const manualParts = (d: CardDef): AbilityDef[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"'));
const lib = (s: GameState, p: 'p1' | 'p2' = 'p1'): ObjectId[] => s.zones.library[p]!;
const hand = (s: GameState, p: 'p1' | 'p2' = 'p1'): ObjectId[] => s.zones.hand[p]!;
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const tokens = (s: GameState, p: 'p1' | 'p2' = 'p1'): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p);
const options = (s: GameState): ObjectId[] => (s.pending as unknown as { options: ObjectId[] }).options;

/** Cast a p1 card with the given targets and pay automatically; the spell is on the stack. */
function cast(s0: GameState, name: string, targets: TargetChoice[] = []): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  while (s.pending && s.pending.kind !== 'priority') {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}

/** Activate the only non-mana ability of a permanent and pay automatically. */
function activate(s0: GameState, source: ObjectId, targets: TargetChoice[] = []): GameState {
  const a = legal(s0, 'p1', 'activate').find((x) => x.object === source && !x.isMana);
  if (!a) throw new Error(`no ability of ${source} to activate`);
  let s = act(s0, a.action);
  while (s.pending && s.pending.kind !== 'priority') {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;

describe('CR 603.2, 608.2h, 111.2: "whenever ~ deals combat damage to a player, create that many ... tokens" (the amount of the event)', () => {
  const HIVE = card('Test Swarm Mother', 'Creature — Insect', 'Whenever ~ deals combat damage to a player, create that many 1/1 green Insect creature tokens.', '{0}', ['3', '3']);
  it('the card is automated, the count is the event amount', () => {
    expect(manualParts(HIVE)).toEqual([]);
    expect(JSON.stringify(HIVE.faces[0]!.abilities[0])).toContain('"count":{"q":"eventAmount"}');
  });
  it('3 combat damage to a player: three 1/1 Insect tokens', () => {
    let s = scenario([], { p1: { battlefield: [{ name: 'Test Swarm Mother', since: -1 }] }, defs: [HIVE] });
    const mother = find(s, 'Test Swarm Mother', 'battlefield', 'p1');
    s = runCombat(s, { attack: [[mother, 'p2']] });
    const made = tokens(s);
    expect(made).toHaveLength(3);
    const c = charsOfObject(s, s.objects[made[0]!]!);
    expect([c.power, c.toughness, c.subtypes]).toEqual(['1', '1', ['Insect']]);
  });
});

describe('CR 701.16a, 603.2: "investigate that many times"', () => {
  const SLEUTH = card('Test Ink Sleuth', 'Creature — Human', 'Whenever ~ deals combat damage to a player, investigate that many times.', '{0}', ['2', '2']);
  it('2 combat damage: two Clue tokens', () => {
    expect(manualParts(SLEUTH)).toEqual([]);
    let s = scenario([], { p1: { battlefield: [{ name: 'Test Ink Sleuth', since: -1 }] }, defs: [SLEUTH] });
    s = runCombat(s, { attack: [[find(s, 'Test Ink Sleuth', 'battlefield', 'p1'), 'p2']] });
    expect(tokens(s).map((id) => nameOf(s, id))).toEqual(['Clue Token', 'Clue Token']);
  });
});

describe('CR 700.5, 111.2: "create a number of ... tokens equal to your devotion to white"', () => {
  const HERALD = card('Test Dawn Herald', 'Creature — Human Cleric', 'When ~ enters, create a number of 1/1 white Spirit creature tokens equal to your devotion to white.', '{W}{W}', ['2', '2']);
  it('the Herald itself counts ({W}{W}): two tokens', () => {
    expect(manualParts(HERALD)).toEqual([]);
    let s = scenario(['Plains'], { p1: { hand: ['Test Dawn Herald'], battlefield: ['Plains', 'Plains'] }, defs: [HERALD] });
    s = passBoth(cast(s, 'Test Dawn Herald'));
    s = passBoth(s); // the trigger
    expect(tokens(s)).toHaveLength(2);
  });
});

describe('CR 102.3: "create a number of Food tokens equal to the number of opponents you have"', () => {
  const HOST = card('Test Feast Host', 'Creature — Human', 'When ~ enters, create a number of Food tokens equal to the number of opponents you have.', '{0}', ['1', '1']);
  it('two players: one Food', () => {
    expect(manualParts(HOST)).toEqual([]);
    let s = passBoth(passBoth(cast(scenario([], { p1: { hand: ['Test Feast Host'] }, defs: [HOST] }), 'Test Feast Host')));
    expect(tokens(s).map((id) => nameOf(s, id))).toEqual(['Food Token']);
  });
});

describe('CR 111.2, 608.2h: "create a ... token for each Elf you control" (counted as it resolves)', () => {
  const PARADE = card('Test Elf Parade', 'Sorcery', 'Create a 1/1 green Elf Warrior creature token for each Elf you control.');
  it('two Elves: two tokens (the count is fixed once; the new Elf Warriors do not count)', () => {
    expect(manualParts(PARADE)).toEqual([]);
    let s = scenario(['Llanowar Elves'], { p1: { hand: ['Test Elf Parade'], battlefield: ['Llanowar Elves', 'Llanowar Elves'] }, defs: [PARADE] });
    s = passBoth(cast(s, 'Test Elf Parade'));
    expect(tokens(s)).toHaveLength(2);
  });
});

describe('CR 107.3, 608.2h: "create an X/X ... token, where X is the number of lands you control"', () => {
  const GROVE = card('Test Grove Call', 'Sorcery', 'Create an X/X green Treefolk creature token, where X is the number of lands you control.');
  it('three lands: one 3/3 token', () => {
    expect(manualParts(GROVE)).toEqual([]);
    let s = scenario(['Forest'], { p1: { hand: ['Test Grove Call'], battlefield: ['Forest', 'Forest', 'Forest'] }, defs: [GROVE] });
    s = passBoth(cast(s, 'Test Grove Call'));
    const made = tokens(s);
    expect(made).toHaveLength(1);
    const c = charsOfObject(s, s.objects[made[0]!]!);
    expect([c.power, c.toughness]).toEqual(['3', '3']);
  });
  const PACK = card('Test Pack Howl', 'Sorcery', 'Create X 1/1 black Rat creature tokens, where X is the number of Rats you control.');
  const RAT = card('Test Sewer Rat', 'Creature — Rat', 'You gain 0 life.', '{0}', ['1', '1']);
  it('"create X ... tokens, where X is ...": two Rats, two new Rats', () => {
    expect(manualParts(PACK)).toEqual([]);
    let s = scenario([], { p1: { hand: ['Test Pack Howl'], battlefield: ['Test Sewer Rat', 'Test Sewer Rat'] }, defs: [PACK, RAT] });
    s = passBoth(cast(s, 'Test Pack Howl'));
    expect(tokens(s)).toHaveLength(2);
  });
});

describe('CR 608.2d, 111.10: "create your choice of a Clue token, a Food token, or a Treasure token"', () => {
  const PICK = card('Test Pantry Pick', 'Sorcery', 'Create your choice of a Clue token, a Food token, or a Treasure token.');
  it('the controller chooses one of the three as it resolves; exactly that token is created', () => {
    expect(manualParts(PICK)).toEqual([]);
    let s = passBoth(cast(scenario([], { p1: { hand: ['Test Pantry Pick'] }, defs: [PICK] }), 'Test Pantry Pick'));
    expect(s.pending).toMatchObject({ kind: 'chooseOption', player: 'p1' });
    const opts = (s.pending as unknown as { options: { id: string; label: string }[] }).options;
    expect(opts.map((o) => o.label)).toEqual(['Clue', 'Food', 'Treasure']);
    s = answer(s, { kind: 'chooseOption', ids: [opts.find((o) => o.label === 'Food')!.id] });
    expect(tokens(s).map((id) => nameOf(s, id))).toEqual(['Food Token']);
  });
});

describe('CR 111.10m, 303.4f: "create a Royal Role token attached to another target creature you control"', () => {
  const TAILOR = card('Test Court Tailor', 'Creature — Faerie', 'When ~ enters, create a Royal Role token attached to another target creature you control.', '{0}', ['1', '1']);
  it('the Role enters attached to the target: +1/+1 (CR 303.4f: an Aura put onto the battlefield attached to the object the effect names)', () => {
    expect(manualParts(TAILOR)).toEqual([]);
    let s = scenario(['Grizzly Bears'], { p1: { hand: ['Test Court Tailor'], battlefield: ['Grizzly Bears'] }, defs: [TAILOR] });
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p1');
    s = passBoth(cast(s, 'Test Court Tailor'));
    while (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [obj(bears)] });
    s = passBoth(s);
    const role = tokens(s);
    expect(role).toHaveLength(1);
    expect(s.objects[role[0]!]!.attachedTo).toBe(bears);
    const c = charsOfObject(s, s.objects[bears]!);
    expect([c.power, c.toughness]).toEqual(['3', '3']);
  });
});

describe('CR 701.23a, 701.20a: "search your library for a ... card, reveal that card, put it into your hand, then shuffle"', () => {
  const CALL = card('Test Kin Call', 'Sorcery', 'Search your library for a creature card, reveal that card, put it into your hand, then shuffle.');
  it('only creature cards are offered; the found card goes to the hand and the library is shuffled (new ids, CR 701.24a)', () => {
    expect(manualParts(CALL)).toEqual([]);
    let s = passBoth(cast(scenario(['Grizzly Bears', 'Island'], { p1: { hand: ['Test Kin Call'], library: ['Island', 'Grizzly Bears'] }, defs: [CALL] }), 'Test Kin Call'));
    expect(options(s).map((id) => nameOf(s, id))).toEqual(['Grizzly Bears']);
    const before = [...lib(s)];
    s = answer(s, { kind: 'chooseObjects', ids: options(s) });
    expect(hand(s).map((id) => nameOf(s, id))).toEqual(['Grizzly Bears']);
    expect(lib(s).some((id) => before.includes(id))).toBe(false);
  });
  const MATRON = card('Test Hob Matron', 'Creature — Goblin', 'When ~ enters, you may search your library for a Goblin card, reveal that card, put it into your hand, then shuffle.', '{0}', ['1', '1']);
  it('CR 608.2d: "you may": no means no search and no shuffle', () => {
    expect(manualParts(MATRON)).toEqual([]);
    let s = passBoth(passBoth(cast(scenario(['Goblin Wizard'], { p1: { hand: ['Test Hob Matron'], library: ['Goblin Wizard'] }, defs: [MATRON] }), 'Test Hob Matron')));
    expect(s.pending?.kind).toBe('yesNo');
    const before = [...lib(s)];
    s = answer(s, { kind: 'yesNo', yes: false });
    expect(lib(s)).toEqual(before);
  });
});

describe('CR 701.23a, 205.4a: "search your library for up to two basic land cards and/or Desert cards, put them onto the battlefield tapped"', () => {
  const MAP = card('Test Dune Map', 'Sorcery', 'Search your library for up to two basic land cards and/or Desert cards, put them onto the battlefield tapped, then shuffle.');
  const DUNE = card('Test Dune', 'Land — Desert', '{T}: Add {C}.');
  it('a basic land and a nonbasic Desert are both offered, the other nonbasic is not; both enter tapped', () => {
    expect(manualParts(MAP)).toEqual([]);
    const MESA = card('Test Mesa', 'Land', '{T}: Add {C}.');
    let s = passBoth(cast(scenario(['Forest'], { p1: { hand: ['Test Dune Map'], library: ['Forest', 'Test Dune', 'Test Mesa'] }, defs: [MAP, DUNE, MESA] }), 'Test Dune Map'));
    const offered = options(s).map((id) => nameOf(s, id));
    expect(offered).toContain('Test Dune');
    expect(offered).toContain('Forest');
    expect(offered).not.toContain('Test Mesa');
    const pick = [options(s).find((id) => nameOf(s, id) === 'Forest')!, options(s).find((id) => nameOf(s, id) === 'Test Dune')!];
    s = answer(s, { kind: 'chooseObjects', ids: pick });
    const dune = find(s, 'Test Dune', 'battlefield', 'p1');
    const forest = find(s, 'Forest', 'battlefield', 'p1');
    expect([s.objects[dune]!.tapped, s.objects[forest]!.tapped]).toEqual([true, true]);
  });
});

describe('CR 701.23a, 202.3, 107.3: "search your library for a creature card with mana value X or less, put it onto the battlefield"', () => {
  const CHORD = card('Test Pack Chord', 'Sorcery', 'Search your library for a creature card with mana value 1 or less, put it onto the battlefield, then shuffle.');
  it('only creatures with mana value 1 or less are offered', () => {
    expect(manualParts(CHORD)).toEqual([]);
    let s = passBoth(cast(scenario(['Grizzly Bears', 'Llanowar Elves'], { p1: { hand: ['Test Pack Chord'], library: ['Grizzly Bears', 'Llanowar Elves'] }, defs: [CHORD] }), 'Test Pack Chord'));
    expect(options(s).map((id) => nameOf(s, id))).toEqual(['Llanowar Elves']);
    s = answer(s, { kind: 'chooseObjects', ids: options(s) });
    expect(findAll(s, 'Llanowar Elves', 'battlefield', 'p1')).toHaveLength(1);
  });
});

describe('CR 701.23a, 401.4: "search your library for any number of Goblin cards, reveal them, then shuffle and put those cards on top in any order"', () => {
  const RECRUIT = card('Test Hob Recruiter', 'Sorcery', 'Search your library for any number of Goblin cards, reveal them, then shuffle and put those cards on top in any order.');
  const SCOUT = card('Test Hob Scout', 'Creature — Goblin', 'You gain 0 life.', '{1}', ['1', '1']);
  it('the found Goblins are on top, in the order their owner chose, after the shuffle', () => {
    expect(manualParts(RECRUIT)).toEqual([]);
    let s = passBoth(cast(scenario(['Goblin Wizard', 'Island'], { p1: { hand: ['Test Hob Recruiter'], library: ['Island', 'Goblin Wizard', 'Island', 'Test Hob Scout'] }, defs: [RECRUIT, SCOUT] }), 'Test Hob Recruiter'));
    expect(options(s).map((id) => nameOf(s, id)).sort()).toEqual(['Goblin Wizard', 'Test Hob Scout']);
    s = answer(s, { kind: 'chooseObjects', ids: options(s) });
    expect(s.pending).toMatchObject({ kind: 'order', player: 'p1' });
    const items = (s.pending as unknown as { items: { id: string; label: string }[] }).items;
    const pick = (n: string): string => items.find((i) => i.label === n)!.id;
    s = answer(s, { kind: 'order', ids: [pick('Test Hob Scout'), pick('Goblin Wizard')] });
    expect(lib(s).slice(0, 2).map((id) => nameOf(s, id))).toEqual(['Test Hob Scout', 'Goblin Wizard']);
  });
});

describe('CR 701.23a, 110.2: "search your library for any number of Elf creature cards, put them onto the battlefield"', () => {
  const GATHER = card('Test Elf Gathering', 'Sorcery', 'Search your library for any number of Elf creature cards, put them onto the battlefield, then shuffle.');
  it('every chosen Elf creature card enters under your control; none is required (min 0)', () => {
    expect(manualParts(GATHER)).toEqual([]);
    let s = passBoth(cast(scenario(['Llanowar Elves', 'Grizzly Bears'], { p1: { hand: ['Test Elf Gathering'], library: ['Llanowar Elves', 'Grizzly Bears', 'Llanowar Elves'] }, defs: [GATHER] }), 'Test Elf Gathering'));
    expect(options(s).map((id) => nameOf(s, id))).toEqual(['Llanowar Elves', 'Llanowar Elves']);
    expect((s.pending as unknown as { min: number }).min).toBe(0);
    s = answer(s, { kind: 'chooseObjects', ids: options(s) });
    expect(findAll(s, 'Llanowar Elves', 'battlefield', 'p1')).toHaveLength(2);
  });
});

void activate;
