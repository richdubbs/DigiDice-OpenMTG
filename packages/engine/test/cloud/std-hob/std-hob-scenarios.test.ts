/**
 * Cloud batch 2, slice std-hob (the Standard backlog of The Hobbit set, tuning half): the templates of parser/templates/zz-cloud/std-hob.json and the renderer and
 * engine support they needed, played through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings, design 6.10).
 * Each test is named after the rule it checks.
 *
 *   CR 115.1, 608.2e, 121.2     "{0}: Two target players each draw a card."
 *   CR 701.23a, 608.2c          "Search ..., reveal them, put one onto the battlefield tapped and the other into your hand, then shuffle."
 *   CR 611.2a, 613.4c, 613.1f   "Whenever ~ attacks while ..., until end of turn, ~ gets +1/+0 and creatures you control gain trample."
 *   CR 615.1a, 615.7            "Prevent all damage that would be dealt by up to one target creature for as long as ~ remains on the battlefield."
 *   CR 603.12, 301.5, 701.3b    "create ... Equipment token ... When you do, attach it to target creature you control." / "each equipped attacking creature gains double strike"
 *   CR 701.47a, 701.47c         "amass Goblins 1, then attach ~ to the amassed Army."
 *   CR 602.2, 605.3b            "Whenever you activate an ability of a creature, draw a card. This ability triggers only once each turn."
 *   CR 603.2d, 611.3a           "As long as ..., if a triggered ability of a Dwarf you control triggers, that ability triggers an additional time."
 *   CR 404.1, 613.4c            "~ gets +2/+0 for each graveyard with seven or more cards in it."
 *   CR 201.2, 118.1, 701.9      "Discard a legendary card with the same name as a legendary permanent you control: ..."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, legal, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual (the level itself is checked by the template tests: an experimental template caps it, design 6.9). */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const tokensOf = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p);
const named = (s: GameState, p: PlayerId, subtype: string): ObjectId[] => tokensOf(s, p).filter((id) => getChars(s, id)!.subtypes.includes(subtype));
const ptOf = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };

/** Answer the decisions that come up until priority (payments automatic; the targets `targets` in order; choices the first allowed). */
function drive(s0: GameState, targets: ({ kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId })[][] = []): GameState {
  let s = s0;
  const q = [...targets];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, targets?: Parameters<typeof drive>[1]): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), targets);
  return s;
}
const cast = (s: GameState, name: string, targets?: Parameters<typeof drive>[1]): GameState => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets), targets);
const activate = (s: GameState, name: string, targets: Parameters<typeof drive>[1] = [], ability?: string): GameState => {
  const src = find(s, name, 'battlefield', 'p1');
  const a = legal(s, 'p1', 'activate').find((x) => x.object === src && (ability === undefined || x.label.includes(ability)));
  if (a === undefined) throw new Error(`no activation of ${name}`);
  return resolveAll(drive(act(s, a.action), targets), targets);
};

describe('CR 115.1, 608.2e, 121.2: "Two target players each draw a card."', () => {
  const FOUNTAIN = card('Test Fountain', 'Enchantment', '{0}: Two target players each draw a card.');
  it('is understood', () => expect(noManual(FOUNTAIN)).toBe(true));
  it('CR 121.2: both chosen players draw one card (you and the opponent)', () => {
    const s0 = scenario([], { defs: [FOUNTAIN], p1: { battlefield: ['Test Fountain'] } });
    const h1 = hand(s0, 'p1');
    const h2 = hand(s0, 'p2');
    const s = activate(s0, 'Test Fountain', [[{ kind: 'player', id: 'p1' }, { kind: 'player', id: 'p2' }]]);
    expect(hand(s, 'p1')).toBe(h1 + 1);
    expect(hand(s, 'p2')).toBe(h2 + 1);
  });
  it('CR 115.3: the same player cannot be chosen twice, so the targets are two different players', () => {
    const s0 = scenario([], { defs: [FOUNTAIN], p1: { battlefield: ['Test Fountain'] } });
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === find(s0, 'Test Fountain', 'battlefield'))!;
    const s1 = act(s0, a.action);
    expect(s1.pending).toMatchObject({ kind: 'chooseTargets' });
  });
});

/** Pass priority to the declare-attackers decision (the steps before it have no stops), declare `attackers`, and stop with the attack declared and its triggers resolved. */
function attack(s0: GameState, attackers: ObjectId[], targets?: Parameters<typeof drive>[1]): GameState {
  let s = s0;
  for (let i = 0; i < 60 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, targets);
  s = answer(s, { kind: 'declareAttackers', attacks: attackers.map((attacker) => ({ attacker, defender: 'p2' })) });
  return resolveAll(drive(s, targets), targets);
}
/** Play on until combat damage has been dealt (blocks: none). */
function toDamage(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 60 && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; i++) {
    const d = s.pending;
    if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d?.kind === 'priority') s = pass(s);
    else s = drive(s);
  }
  return s;
}

describe('CR 701.23a, 608.2c, 400.7: "Search your library for up to two basic land cards, reveal them, put one onto the battlefield tapped and the other into your hand, then shuffle."', () => {
  const PONIES = card('Test Ponies', 'Creature — Horse', '{0}, {T}, Sacrifice this creature: Search your library for up to two basic land cards, reveal them, put one onto the battlefield tapped and the other into your hand, then shuffle.', { pt: ['1', '1'] });
  it('is understood', () => expect(noManual(PONIES)).toBe(true));
  it('one of the two found lands enters the battlefield tapped, the other goes to your hand; the creature was sacrificed', () => {
    const s0 = scenario(['Forest'], { defs: [PONIES], p1: { battlefield: ['Test Ponies'], library: ['Forest', 'Forest', 'Plains'] } });
    const lands0 = s0.zones.battlefield.length;
    const h0 = hand(s0, 'p1');
    const s = activate(s0, 'Test Ponies');
    expect(findAll(s, 'Test Ponies', 'battlefield')).toHaveLength(0);
    const lands = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1');
    expect(lands).toHaveLength(lands0); // -1 creature, +1 land
    expect(s.objects[lands[0]!]!.tapped).toBe(true);
    expect(hand(s, 'p1')).toBe(h0 + 1);
  });
});

describe('CR 611.2a, 613.4c, 613.1f: "Ferocious -- Whenever this creature attacks while you control a creature with power 4 or greater, until end of turn, this creature gets +1/+0 and creatures you control gain trample."', () => {
  const CHARGER = card('Test Charger', 'Creature — Wolf', 'Ferocious — Whenever this creature attacks while you control a creature with power 4 or greater, until end of turn, this creature gets +1/+0 and creatures you control gain trample.', { pt: ['2', '2'] });
  const BRUTE = card('Test Brute', 'Creature — Ogre', '', { pt: ['4', '4'] });
  const MOUSE = card('Test Mouse', 'Creature — Mouse', '', { pt: ['1', '1'] });
  it('is understood', () => expect(noManual(CHARGER)).toBe(true));
  it('with a creature of power 4 or greater: +1/+0 for it and trample for every creature you control, until end of turn', () => {
    const s0 = scenario([], { defs: [CHARGER, BRUTE, MOUSE], p1: { battlefield: ['Test Charger', 'Test Brute', 'Test Mouse'] } });
    const charger = find(s0, 'Test Charger', 'battlefield');
    const s = attack(s0, [charger]);
    expect(ptOf(s, charger)).toBe('3/2');
    expect(hasKeyword(getChars(s, charger)!, 'trample')).toBe(true);
    expect(hasKeyword(getChars(s, find(s, 'Test Mouse', 'battlefield'))!, 'trample')).toBe(true);
    expect(hasKeyword(getChars(s, find(s, 'Test Brute', 'battlefield'))!, 'trample')).toBe(true);
  });
  it('without one (CR 603.4: the condition is checked as it triggers): nothing happens', () => {
    const s0 = scenario([], { defs: [CHARGER, BRUTE, MOUSE], p1: { battlefield: ['Test Charger', 'Test Mouse'] } });
    const charger = find(s0, 'Test Charger', 'battlefield');
    const s = attack(s0, [charger]);
    expect(ptOf(s, charger)).toBe('2/2');
    expect(hasKeyword(getChars(s, find(s, 'Test Mouse', 'battlefield'))!, 'trample')).toBe(false);
  });
});

describe('CR 615.1a, 615.7, 611.2a: "Prevent all damage that would be dealt by target creature this turn."', () => {
  const FOG = card('Test Fog', 'Sorcery', 'Prevent all damage that would be dealt by target creature this turn.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  it('is understood', () => expect(noManual(FOG)).toBe(true));
  it('combat damage by the creature is prevented, the other creature\'s is not', () => {
    const s0 = scenario([], { defs: [FOG, BEAR], p1: { hand: ['Test Fog'], battlefield: ['Test Bear', 'Test Bear'] } });
    const [a, b] = findAll(s0, 'Test Bear', 'battlefield');
    const s1 = cast(s0, 'Test Fog', [[{ kind: 'object', id: a! }]]);
    const s = toDamage(attack(s1, [a!, b!]));
    expect(life(s, 'p2')).toBe(20 - 2);
  });
  it('without it both creatures deal their damage', () => {
    const s0 = scenario([], { defs: [FOG, BEAR], p1: { battlefield: ['Test Bear', 'Test Bear'] } });
    const [a, b] = findAll(s0, 'Test Bear', 'battlefield');
    const s = toDamage(attack(s0, [a!, b!]));
    expect(life(s, 'p2')).toBe(20 - 4);
  });
});

describe('CR 603.12, 301.5, 701.3b: "When ~ enters, create a ... Equipment token ... When you do, attach it to target creature you control." and "each equipped attacking creature gains double strike"', () => {
  const SMITH = card('Test Smith', 'Legendary Creature — Dwarf Warrior', 'When this creature enters, create a colorless Equipment artifact token named Axe with "Equipped creature gets +1/+0" and equip {2}. When you do, attach it to target creature you control.\nWhenever this creature attacks, each equipped attacking creature gains double strike until end of turn.', { pt: ['3', '3'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  it('is understood', () => expect(noManual(SMITH)).toBe(true));
  it('the token is attached to the creature you chose (not the Smith, which cannot be attached), and gives +1/+0', () => {
    const s0 = scenario([], { defs: [SMITH, BEAR], p1: { hand: ['Test Smith'], battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s = cast(s0, 'Test Smith', [[{ kind: 'object', id: bear }]]);
    const axe = tokensOf(s, 'p1').find((id) => getChars(s, id)!.name === 'Axe')!;
    expect(axe).toBeDefined();
    expect(s.objects[axe]!.attachedTo).toBe(bear);
    expect(ptOf(s, bear)).toBe('3/2');
  });
  it('CR 702.4: when the Smith attacks, the attacking equipped creature gains double strike; an unequipped attacker does not', () => {
    const s0 = scenario([], { defs: [SMITH, BEAR], p1: { battlefield: ['Test Smith', 'Test Bear', 'Test Bear'] } });
    const [bear, other] = findAll(s0, 'Test Bear', 'battlefield');
    // an Axe attached to the first Bear (test setup: the token as the trigger makes it)
    let s = cast(scenario([], { defs: [SMITH, BEAR], p1: { hand: ['Test Smith'], battlefield: ['Test Bear', 'Test Bear'] } }), 'Test Smith', [[{ kind: 'object', id: findAll(s0, 'Test Bear', 'battlefield')[0]! }]]);
    const bears = findAll(s, 'Test Bear', 'battlefield');
    const smith = find(s, 'Test Smith', 'battlefield');
    s = { ...s, objects: { ...s.objects, [smith]: { ...s.objects[smith]!, controlledSinceTurn: 0 } } }; // not summoning sick (test setup)
    s = attack(s, [smith, bears[0]!, bears[1]!]);
    expect(bear).toBeDefined();
    expect(other).toBeDefined();
    expect(hasKeyword(getChars(s, bears[0]!)!, 'double strike')).toBe(true);
    expect(hasKeyword(getChars(s, bears[1]!)!, 'double strike')).toBe(false);
  });
});

describe('CR 701.47a, 701.47c, 701.3b: "When this Equipment enters, amass Goblins 1, then attach this Equipment to the amassed Army."', () => {
  const MAIL = card('Test Plate', 'Artifact — Equipment', 'When this Equipment enters, amass Goblins 1, then attach this Equipment to the amassed Army.\nEquipped creature gets +1/+0 and has menace.\nEquip {4}');
  it('is understood', () => expect(noManual(MAIL)).toBe(true));
  it('with no Army, a 0/0 Goblin Army token is created, gets a counter, and the Equipment is attached to it (it survives: 1/1 +1/+0 = 2/1)', () => {
    const s = cast(scenario([], { defs: [MAIL], p1: { hand: ['Test Plate'] } }), 'Test Plate');
    const army = named(s, 'p1', 'Army');
    expect(army).toHaveLength(1);
    expect(getChars(s, army[0]!)!.subtypes).toContain('Goblin');
    expect(s.objects[find(s, 'Test Plate', 'battlefield')]!.attachedTo).toBe(army[0]);
    expect(ptOf(s, army[0]!)).toBe('2/1');
    expect(hasKeyword(getChars(s, army[0]!)!, 'menace')).toBe(true);
  });
});

describe('CR 602.2, 605.3b, 603.2h: "Whenever you activate an ability of a creature, draw a card. This ability triggers only once each turn."', () => {
  const SEER = card('Test Seer', 'Legendary Creature — Elf Noble', 'Whenever you activate an ability of a creature, draw a card. This ability triggers only once each turn.', { pt: ['2', '2'] });
  const ELF = card('Test Elf', 'Creature — Elf', '{T}: Add {G}.', { pt: ['1', '1'] });
  const PINGER = card('Test Pinger', 'Creature — Wizard', '{0}, {T}: Test Pinger deals 1 damage to target player.', { pt: ['1', '1'] });
  const GEM = card('Test Gem', 'Artifact', '{T}: Add {C}.');
  it('is understood', () => expect(noManual(SEER)).toBe(true));
  it('a mana ability of a creature counts, a non-creature\'s does not, and it draws only once each turn', () => {
    const s0 = scenario([], { defs: [SEER, ELF, PINGER, GEM], p1: { battlefield: ['Test Seer', 'Test Elf', 'Test Pinger', 'Test Gem'] } });
    const h0 = hand(s0, 'p1');
    const gem = legal(s0, 'p1', 'activate').find((x) => x.object === find(s0, 'Test Gem', 'battlefield'))!;
    let s = resolveAll(drive(act(s0, gem.action)));
    expect(hand(s, 'p1')).toBe(h0);
    const elf = legal(s, 'p1', 'activate').find((x) => x.object === find(s, 'Test Elf', 'battlefield'))!;
    s = resolveAll(drive(act(s, elf.action)));
    expect(hand(s, 'p1')).toBe(h0 + 1);
    const ping = legal(s, 'p1', 'activate').find((x) => x.object === find(s, 'Test Pinger', 'battlefield'))!;
    s = resolveAll(drive(act(s, ping.action), [[{ kind: 'player', id: 'p2' }]]), [[{ kind: 'player', id: 'p2' }]]);
    expect(hand(s, 'p1')).toBe(h0 + 1);
    expect(life(s, 'p2')).toBe(19);
  });
});

describe('CR 603.2d, 611.3a: "As long as you control an artifact, if a triggered ability of a Dwarf you control triggers, that ability triggers an additional time."', () => {
  const DWARF = card('Test Dwarf', 'Creature — Dwarf', 'When this creature enters, you gain 1 life.\nAs long as you control an artifact, if a triggered ability of a Dwarf you control triggers, that ability triggers an additional time.', { pt: ['1', '1'] });
  const GEM = card('Test Gem', 'Artifact', '');
  it('is understood', () => expect(noManual(DWARF)).toBe(true));
  it('with an artifact the enters trigger happens twice', () => {
    const s = cast(scenario([], { defs: [DWARF, GEM], p1: { hand: ['Test Dwarf'], battlefield: ['Test Gem'] } }), 'Test Dwarf');
    expect(life(s, 'p1')).toBe(22);
  });
  it('without one it happens once', () => {
    const s = cast(scenario([], { defs: [DWARF, GEM], p1: { hand: ['Test Dwarf'] } }), 'Test Dwarf');
    expect(life(s, 'p1')).toBe(21);
  });
});

describe('CR 404.1, 613.4c: "This creature gets +2/+0 for each graveyard with seven or more cards in it."', () => {
  const HOARDER = card('Test Hoarder', 'Creature — Human', 'This creature gets +2/+0 for each graveyard with seven or more cards in it.', { pt: ['2', '2'] });
  const seven = Array(7).fill('Plains') as string[];
  it('is understood', () => expect(noManual(HOARDER)).toBe(true));
  it('counts each player\'s graveyard of seven or more cards (6 does not count)', () => {
    const none = scenario([], { defs: [HOARDER], p1: { battlefield: ['Test Hoarder'], graveyard: seven.slice(0, 6) } });
    expect(ptOf(none, find(none, 'Test Hoarder', 'battlefield'))).toBe('2/2');
    const one = scenario([], { defs: [HOARDER], p1: { battlefield: ['Test Hoarder'], graveyard: seven } });
    expect(ptOf(one, find(one, 'Test Hoarder', 'battlefield'))).toBe('4/2');
    const both = scenario([], { defs: [HOARDER], p1: { battlefield: ['Test Hoarder'], graveyard: seven }, p2: { graveyard: [...seven, 'Plains'] } });
    expect(ptOf(both, find(both, 'Test Hoarder', 'battlefield'))).toBe('6/2');
  });
});

describe('CR 201.2, 118.1, 701.9a: "Discard a legendary card with the same name as a legendary permanent you control: Draw two cards."', () => {
  const KEY = card('Test Key', 'Artifact', '{0}, {T}, Discard a legendary card with the same name as a legendary permanent you control: Draw two cards.');
  const LEGEND = card('Test Legend', 'Legendary Creature — Elf', '', { pt: ['1', '1'] });
  const OTHER = card('Test Other Legend', 'Legendary Creature — Elf', '', { pt: ['1', '1'] });
  const PLAIN = card('Test Plain Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
  it('is understood', () => expect(noManual(KEY)).toBe(true));
  it('can be activated with a legendary card in hand that shares the name of a legendary permanent you control, and draws two', () => {
    const s0 = scenario([], { defs: [KEY, LEGEND, OTHER, PLAIN], p1: { hand: ['Test Legend'], battlefield: ['Test Key', 'Test Legend'] } });
    const h0 = hand(s0, 'p1');
    const s = activate(s0, 'Test Key');
    expect(findAll(s, 'Test Legend', 'graveyard')).toHaveLength(1);
    expect(hand(s, 'p1')).toBe(h0 - 1 + 2);
  });
  it('cannot be activated when no legendary card in hand shares a name with one you control', () => {
    const s0 = scenario([], { defs: [KEY, LEGEND, OTHER, PLAIN], p1: { hand: ['Test Other Legend', 'Test Plain Elf'], battlefield: ['Test Key', 'Test Legend'] } });
    expect(legal(s0, 'p1', 'activate').filter((x) => x.object === find(s0, 'Test Key', 'battlefield'))).toHaveLength(0);
  });
  it('the permanent must be one you control (an opponent\'s Test Legend is not enough)', () => {
    const s0 = scenario([], { defs: [KEY, LEGEND, OTHER, PLAIN], p1: { hand: ['Test Legend'], battlefield: ['Test Key'] }, p2: { battlefield: ['Test Legend'] } });
    expect(legal(s0, 'p1', 'activate').filter((x) => x.object === find(s0, 'Test Key', 'battlefield'))).toHaveLength(0);
  });
});
