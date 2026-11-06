/**
 * Commander lane edh-c, round edh-c-2: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default compiler.
 * Each test is named after the rule it checks and has its negative case. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 614.1a, 120.3, 510.2    "If ~ would deal combat damage to a player, it deals double that damage to that player instead." (a creature's own damage; a creature blocker is not doubled)
 *   CR 604.1, 611.3a, 613.4c   "As long as ~ is equipped, <group> get +2/+2 and have double strike." (the condition is read as the effect applies)
 *   CR 601.2f, 118.7, 611.3a   "As long as ~ is tapped, creature spells you cast cost {2} less to cast."
 *   CR 613.1e, 105.3           "All creatures are black." (colors set, not added)
 *   CR 110.1, 208.2a           "~'s power is equal to the number of creatures on the battlefield with shadow." (every player's creatures)
 *   CR 603.2, 406.3            "Whenever a creature other than ~ is exiled from the battlefield, you gain life equal to its power."
 *   CR 111.4, 105.1            "Create an 8/8 Beast creature token that's red, green, and white."
 *   CR 122.1, 613.4c           "... gets +1/+1 until end of turn for each lore counter on ~."
 *   CR 305.6, 205.3i           "Then if there are three or more basic land types among lands you control, scry 1."
 *   CR 118.9, 601.2b           "If an opponent drew three or more cards this turn, you may pay {R} rather than pay this spell's mana cost."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { charsOfObject } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, legal, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; colors?: string[]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const chars = (s: GameState, id: ObjectId) => charsOfObject(s, s.objects[id]!);
const power = (s: GameState, id: ObjectId): number => Number(chars(s, id).power);
const toughness = (s: GameState, id: ObjectId): number => Number(chars(s, id).toughness);

type Target = { kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId };
function drive(s0: GameState, targets: Target[][] = []): GameState {
  let s = s0;
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.shift() ?? [] });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function combat(s0: GameState, attacks: { attacker: ObjectId; defender: PlayerId }[], blocks: { blocker: ObjectId; attacker: ObjectId }[] = []): GameState {
  let s = s0;
  for (let i = 0; i < 60 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  s = answer(s, { kind: 'declareAttackers', attacks });
  for (let i = 0; i < 80 && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; i++) {
    if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks });
    else s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  }
  return s;
}

describe('CR 614.1a, 120.3, 510.2: "If ~ would deal combat damage to a player, it deals double that damage to that player instead."', () => {
  const TUSK = card('Test Double Tusk', 'Creature — Beast', 'If ~ would deal combat damage to a player, it deals double that damage to that player instead.', { pt: ['3', '3'] });
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['3', '3'] });
  const WALL = card('Test Stout Wall', 'Creature — Wall', '', { pt: ['0', '20'] });
  const defs = [TUSK, BEAR, WALL];
  it('is automated', () => { expect(full(TUSK)).toBe(true); });
  it('an unblocked creature deals double to the player; an identical creature without the ability deals its power', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Double Tusk', 'Test Plain Bear'] } });
    expect(life(combat(s0, [{ attacker: find(s0, 'Test Double Tusk', 'battlefield', 'p1'), defender: 'p2' }]), 'p2')).toBe(20 - 6);
    expect(life(combat(s0, [{ attacker: find(s0, 'Test Plain Bear', 'battlefield', 'p1'), defender: 'p2' }]), 'p2')).toBe(20 - 3);
  });
  it('negative: damage to a blocking creature is not doubled (the replacement names a player)', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Double Tusk'] }, p2: { battlefield: ['Test Stout Wall'] } });
    const tusk = find(s0, 'Test Double Tusk', 'battlefield', 'p1');
    const wall = find(s0, 'Test Stout Wall', 'battlefield', 'p2');
    const out = combat(s0, [{ attacker: tusk, defender: 'p2' }], [{ blocker: wall, attacker: tusk }]);
    expect(out.objects[wall]!.damage).toBe(3);
    expect(life(out, 'p2')).toBe(20);
  });
  it('negative: another creature of the same controller is not doubled (the object itself only)', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Double Tusk', 'Test Plain Bear'] } });
    const bear = find(s0, 'Test Plain Bear', 'battlefield', 'p1');
    const tusk = find(s0, 'Test Double Tusk', 'battlefield', 'p1');
    expect(life(combat(s0, [{ attacker: bear, defender: 'p2' }, { attacker: tusk, defender: 'p2' }]), 'p2')).toBe(20 - 3 - 6);
  });
});

describe('CR 604.1, 611.3a, 613.4c: "As long as ~ is equipped, Cats you control get +2/+2 and have double strike."', () => {
  const CUB = card('Test Cub Chief', 'Creature — Cat', 'As long as ~ is equipped, Cat creatures you control get +2/+2 and have double strike.', { pt: ['1', '1'] });
  const KITTEN = card('Test Kitten', 'Creature — Cat', '', { pt: ['1', '1'] });
  const DOG = card('Test Hound', 'Creature — Dog', '', { pt: ['1', '1'] });
  const BLADE = card('Test Blade', 'Artifact — Equipment', 'Equipped creature gets +0/+0.\nEquip {0}');
  const defs = [CUB, KITTEN, DOG, BLADE];
  it('is automated', () => { expect(full(CUB)).toBe(true); });
  it('unequipped: no bonus; equipped: every Cat gets it, a non-Cat does not (the group is Cats)', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Cub Chief', 'Test Kitten', 'Test Hound', 'Test Blade'] } });
    const kitten = find(s0, 'Test Kitten', 'battlefield', 'p1');
    const hound = find(s0, 'Test Hound', 'battlefield', 'p1');
    const chief = find(s0, 'Test Cub Chief', 'battlefield', 'p1');
    expect(power(s0, kitten)).toBe(1);
    expect(chars(s0, kitten).keywords.some((k) => k.keyword === 'doubleStrike' || k.keyword === 'double strike')).toBe(false);
    const equip = legal(s0, 'p1', 'activate').find((x) => x.label.toLowerCase().includes('equip'))!;
    let s1 = drive(act(s0, equip.action), [[{ kind: 'object', id: chief }]]);
    for (let i = 0; i < 6 && s1.zones.stack.length > 0; i++) s1 = drive(pass(pass(s1)));
    expect(s1.objects[find(s1, 'Test Blade', 'battlefield', 'p1')]!.attachedTo).toBe(chief);
    expect(power(s1, kitten)).toBe(3);
    expect(toughness(s1, kitten)).toBe(3);
    expect(chars(s1, kitten).keywords.some((k) => /double.?strike/i.test(k.keyword))).toBe(true);
    expect(power(s1, hound)).toBe(1);
  });
});

describe('CR 601.2f, 118.7, 611.3a: "As long as ~ is tapped, creature spells you cast cost {2} less to cast."', () => {
  const OMEN = card('Test Omen Reader', 'Creature — Centaur', 'As long as ~ is tapped, creature spells you cast cost {2} less to cast.', { pt: ['2', '2'] });
  const SPELL = card('Test Pricey Ape', 'Creature — Ape', '', { pt: ['2', '2'], cost: '{2}' });
  const OTHER = card('Test Pricey Rite', 'Sorcery', 'You gain 1 life.', { cost: '{2}' });
  const defs = [OMEN, SPELL, OTHER];
  const castable = (s: GameState, name: string): boolean => legal(s, 'p1', 'cast').some((a) => a.object === find(s, name, 'hand', 'p1'));
  it('is automated', () => { expect(full(OMEN)).toBe(true); });
  it('tapped: a {2} creature spell is cast for nothing; untapped: it is not (no lands); a noncreature spell never is', () => {
    const tapped = scenario([], { defs, p1: { battlefield: [{ name: 'Test Omen Reader', tapped: true }], hand: ['Test Pricey Ape', 'Test Pricey Rite'] } });
    expect(castable(tapped, 'Test Pricey Ape')).toBe(true);
    expect(castable(tapped, 'Test Pricey Rite')).toBe(false);
    const untapped = scenario([], { defs, p1: { battlefield: ['Test Omen Reader'], hand: ['Test Pricey Ape'] } });
    expect(castable(untapped, 'Test Pricey Ape')).toBe(false);
  });
  it("negative: the opponent's creature spells are not cheaper (the reduction is for spells you cast)", () => {
    const s = scenario([], { defs, p1: { battlefield: [{ name: 'Test Omen Reader', tapped: true }] }, p2: { hand: ['Test Pricey Ape'] } });
    expect(legal(s, 'p2', 'cast').some((a) => a.object === find(s, 'Test Pricey Ape', 'hand', 'p2'))).toBe(false);
  });
});

describe('CR 613.1e, 105.3: "All creatures are black." sets the color (the creature is no longer its other colors)', () => {
  const HOUR = card('Test Dark Hour', 'Enchantment', 'All creatures are black.');
  const GREEN = card('Test Green Elf', 'Creature — Elf', '', { pt: ['1', '1'], colors: ['G'] });
  const LAND = card('Test Plain Shrine', 'Artifact', '');
  const defs = [HOUR, GREEN, LAND];
  it('is automated', () => { expect(full(HOUR)).toBe(true); });
  it("a green creature of either player is only black; a noncreature permanent keeps its colors; without the enchantment the creature is green", () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Dark Hour', 'Test Green Elf', 'Test Plain Shrine'] }, p2: { battlefield: ['Test Green Elf'] } });
    for (const id of findAll(s, 'Test Green Elf', 'battlefield')) expect(chars(s, id).colors).toEqual(['B']);
    expect(chars(s, find(s, 'Test Plain Shrine', 'battlefield', 'p1')).colors).toEqual([]);
    const bare = scenario([], { defs, p1: { battlefield: ['Test Green Elf'] } });
    expect(chars(bare, find(bare, 'Test Green Elf', 'battlefield', 'p1')).colors).toEqual(['G']);
  });
});

describe('CR 110.1, 208.2a: "~\'s power is equal to the number of creatures on the battlefield with shadow."', () => {
  const LORD = card('Test Shade Lord', 'Creature — Wizard', "~'s power is equal to the number of creatures on the battlefield with shadow.\nShadow", { pt: ['*', '2'] });
  const SHADE = card('Test Lesser Shade', 'Creature — Spirit', 'Shadow', { pt: ['1', '1'] });
  const PLAIN = card('Test Plain Spirit', 'Creature — Spirit', '', { pt: ['1', '1'] });
  const defs = [LORD, SHADE, PLAIN];
  it('is automated', () => { expect(full(LORD)).toBe(true); });
  it('counts its own shadow and the opponent\'s shadow creatures; a creature without shadow does not count', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Shade Lord', 'Test Plain Spirit'] }, p2: { battlefield: ['Test Lesser Shade', 'Test Lesser Shade'] } });
    expect(power(s, find(s, 'Test Shade Lord', 'battlefield', 'p1'))).toBe(3);
    const alone = scenario([], { defs, p1: { battlefield: ['Test Shade Lord', 'Test Plain Spirit'] } });
    expect(power(alone, find(alone, 'Test Shade Lord', 'battlefield', 'p1'))).toBe(1);
  });
});

describe('CR 111.4, 105.1: "Create an 8/8 Beast creature token that\'s red, green, and white."', () => {
  const SIRE = card('Test Tri Sire', 'Sorcery', "Create an 8/8 Beast creature token that's red, green, and white.");
  it('is automated and makes one token of exactly those three colors', () => {
    expect(full(SIRE)).toBe(true);
    let s = scenario([], { defs: [SIRE], p1: { hand: ['Test Tri Sire'] } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Tri Sire', 'hand', 'p1') } as never);
    s = drive(s);
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)));
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens).toHaveLength(1);
    expect([...chars(s, tokens[0]!).colors].sort()).toEqual(['G', 'R', 'W']);
    expect(power(s, tokens[0]!)).toBe(8);
  });
});

describe('CR 122.1, 613.4c: "... gets +1/+1 until end of turn for each lore counter on ~."', () => {
  const SCROLL = card('Test Lore Scroll', 'Artifact', '{T}: Target creature you control gets +1/+1 until end of turn for each lore counter on ~.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  it('is automated; with three lore counters (and one charge counter that is not counted) the bonus is +3/+3', () => {
    expect(full(SCROLL)).toBe(true);
    let s = scenario([], { defs: [SCROLL, BEAR], p1: { battlefield: [{ name: 'Test Lore Scroll', counters: { lore: 3, charge: 1 } }, 'Test Plain Bear'] } });
    const bear = find(s, 'Test Plain Bear', 'battlefield', 'p1');
    s = drive(act(s, legal(s, 'p1', 'activate')[0]!.action), [[{ kind: 'object', id: bear }]]);
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)));
    expect(power(s, bear)).toBe(5);
    expect(toughness(s, bear)).toBe(5);
  });
  it('negative: with no lore counter the creature gets +0/+0', () => {
    let s = scenario([], { defs: [SCROLL, BEAR], p1: { battlefield: [{ name: 'Test Lore Scroll', counters: { charge: 2 } }, 'Test Plain Bear'] } });
    const bear = find(s, 'Test Plain Bear', 'battlefield', 'p1');
    s = drive(act(s, legal(s, 'p1', 'activate')[0]!.action), [[{ kind: 'object', id: bear }]]);
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)));
    expect(power(s, bear)).toBe(2);
  });
});

describe('CR 603.2, 406.3: "Whenever a creature other than ~ is exiled from the battlefield, you gain life equal to its power."', () => {
  const PILOT = card('Test Star Pilot', 'Creature — Pilot', 'Whenever a creature other than ~ is exiled from the battlefield, you gain life equal to its power.', { pt: ['2', '2'] });
  const EXILER = card('Test Banish', 'Sorcery', 'Exile target creature.');
  const OGRE = card('Test Big Ogre', 'Creature — Ogre', '', { pt: ['4', '4'] });
  const defs = [PILOT, EXILER, OGRE];
  const run = (target: 'Test Big Ogre' | 'Test Star Pilot'): GameState => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Star Pilot'], hand: ['Test Banish'] }, p2: { battlefield: ['Test Big Ogre'] } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Banish', 'hand', 'p1') } as never);
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, target, 'battlefield') }] });
    s = drive(s);
    for (let i = 0; i < 8 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)));
    return s;
  };
  it('is automated; another creature exiled gains life equal to its power', () => {
    expect(full(PILOT)).toBe(true);
    expect(life(run('Test Big Ogre'), 'p1')).toBe(24);
  });
  it('negative: ~ itself exiled does not trigger (no life)', () => {
    expect(life(run('Test Star Pilot'), 'p1')).toBe(20);
  });
});

describe('CR 305.6, 205.3i: "Then if there are three or more basic land types among lands you control, scry 1."', () => {
  const FEST = card('Test Land Path', 'Sorcery', 'Draw a card. Then if there are three or more basic land types among lands you control, scry 1.');
  const lands = (...types: string[]) => types.map((t) => card(`Test ${t} Land`, `Land — ${t}`, ''));
  const play = (types: string[]): GameState => {
    const defs = [FEST, ...lands(...types)];
    let s = scenario([], { defs, p1: { battlefield: types.map((t) => `Test ${t} Land`), hand: ['Test Land Path'], library: ['Test Plains Land', 'Test Plains Land'] } as never });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Land Path', 'hand', 'p1') } as never);
    s = drive(s);
    for (let i = 0; i < 8 && s.zones.stack.length > 0 && s.pending?.kind === 'priority'; i++) s = pass(pass(s));
    return s;
  };
  it('is automated', () => { expect(full(FEST)).toBe(true); });
  it('three types: the scry is asked; two types: it is not', () => {
    expect(play(['Plains', 'Island', 'Swamp']).pending?.kind).not.toBe('priority');
    expect(play(['Plains', 'Island']).pending?.kind).toBe('priority');
  });
});
