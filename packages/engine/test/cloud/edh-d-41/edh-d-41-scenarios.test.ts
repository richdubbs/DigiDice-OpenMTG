/**
 * Coordinator D, round edh-d-41 (lane d-leftovers-2, cross-lane: the attach and type-change leftovers): the round's readings and engine behaviour played through the engine with
 * synthetic cards (invented names and wordings, design 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test names the rule it
 * checks, with its negative case. CR cites are from the Comprehensive Rules of 2026-09-25 (media.wizards.com text, fetched 2026-11-03).
 *
 *   CR 205.1a, 613.1d, 613.1f   "Enchanted permanent is a Treasure artifact with "..." and it loses all other abilities." / "... a colorless Clue artifact ... and loses all other abilities." (Minimus Containment, In Too Deep)
 *   CR 603.10a, 303.4b, 301.5   "Whenever another nontoken creature you control dies, if it was enchanted or equipped, return it to its owner's hand." (Koll, the Forgemaster)
 *   CR 608.2h, 205.1b, 613.4b   "Until end of turn, target land you control becomes an X/X Citizen creature with haste in addition to its other types, where X is ..." (Sage of the Maze)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, hasKeyword, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, pass, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

function settle(s0: GameState, opts: { targets?: TargetChoice[][]; answers?: DecisionAnswer[] } = {}): GameState {
  let s = s0;
  const groups = [...(opts.targets ?? [])];
  const queue = [...(opts.answers ?? [])];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: [...p.items.map((i: { id: string }) => i.id)] });
    else if (p.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
const cast = (s0: GameState, name: string, opts: Parameters<typeof settle>[1] = {}, who: PlayerId = 'p1'): GameState => settle(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), opts);
function resolveAll(s0: GameState, opts: Parameters<typeof settle>[1] = {}): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = settle(pass(pass(s)), opts);
  return s;
}
const bf = (s: GameState, name: string): ObjectId => s.zones.battlefield.find((id) => s.objects[id]!.defId === name)!;
const inHand = (s: GameState, name: string, p: PlayerId): boolean => s.zones.hand[p]!.some((id) => s.objects[id]!.defId === name);
const inYard = (s: GameState, name: string, p: PlayerId): boolean => s.zones.graveyard[p]!.some((id) => s.objects[id]!.defId === name);

const BEAR = card('Test Bear', 'Creature — Bear', 'Flying', { pt: ['3', '3'], colors: ['G'] });
const SWORD = card('Test Sword', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip {0}');
const GRAFT = card('Test Graft', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.');

// ---- Minimus Containment, In Too Deep ---------------------------------------------------------------------------------------------------------------------------------
const TREASURE_AURA = card('Test Gilding', 'Enchantment — Aura', 'Enchant nonland permanent\nEnchanted permanent is a Treasure artifact with "{T}, Sacrifice this artifact: Add {G}" and it loses all other abilities.');
const CLUE_AURA = card('Test Ledger', 'Enchantment — Aura', 'Enchant creature or artifact\nEnchanted permanent is a colorless Clue artifact with "{3}, Sacrifice this artifact: Draw two cards" and loses all other abilities.');
describe('CR 205.1a, 613.1d, 613.1f: "Enchanted permanent is a Treasure artifact with \\"...\\" and it loses all other abilities." (Minimus Containment, In Too Deep)', () => {
  it('are automated', () => { expect(noManual(TREASURE_AURA)).toBe(true); expect(noManual(CLUE_AURA)).toBe(true); });
  const setup = (aura: CardDef) => scenario([], { p1: { hand: [aura.name], battlefield: ['Test Sword'] }, p2: { battlefield: ['Test Bear'] }, defs: [TREASURE_AURA, CLUE_AURA, BEAR, SWORD] });
  it('the enchanted creature stops being a creature, is a Treasure artifact, keeps its colors, loses flying, and its Equipment falls off (CR 205.1a, 704.5n)', () => {
    const s0 = tweak(setup(TREASURE_AURA), (st) => { st.objects[bf(st, 'Test Sword')]!.attachedTo = bf(st, 'Test Bear'); });
    const bear = bf(s0, 'Test Bear');
    expect(getChars(s0, bear).types).toContain('Creature');
    const s = resolveAll(cast(s0, 'Test Gilding', { targets: [[obj(bear)]] }));
    const c = getChars(s, bear);
    expect(c.types).toEqual(['Artifact']);
    expect(c.subtypes).toEqual(['Treasure']);
    expect(c.colors).toEqual(['G']); // Minimus Containment ruling 2021-07-23: the enchanted permanent keeps its colors
    expect(hasKeyword(getChars(s, bear), 'flying')).toBe(false);
    expect(s.zones.battlefield).toContain(bf(s, 'Test Sword'));
    expect(s.objects[bf(s, 'Test Sword')]!.attachedTo).toBeUndefined(); // an Equipment can't be attached to a noncreature (CR 704.5n)
  });
  it('the In Too Deep wording also makes it colorless', () => {
    const s0 = setup(CLUE_AURA);
    const bear = bf(s0, 'Test Bear');
    const s = resolveAll(cast(s0, 'Test Ledger', { targets: [[obj(bear)]] }));
    const c = getChars(s, bear);
    expect(c.types).toEqual(['Artifact']);
    expect(c.subtypes).toEqual(['Clue']);
    expect(c.colors).toEqual([]);
  });
  it('the granted ability is the only one: the permanent can be tapped and sacrificed for {G}, and has no other ability', () => {
    const s0 = scenario([], { p1: { hand: ['Test Gilding'], battlefield: [{ name: 'Test Bear', since: -1 }] }, defs: [TREASURE_AURA, BEAR] });
    const bear = bf(s0, 'Test Bear');
    const s1 = resolveAll(cast(s0, 'Test Gilding', { targets: [[obj(bear)]] }));
    const mine = legalActions(s1, 'p1').filter((a) => a.kind === 'activate' && a.object === bear);
    expect(mine.length).toBe(1);
    const s = act(s1, mine[0]!.action);
    expect(s.zones.battlefield).not.toContain(bear); // sacrificed as a cost
    expect(inYard(s, 'Test Bear', 'p1')).toBe(true);
    expect(s.players.find((p) => p.id === 'p1')!.manaPool.filter((u) => u.type === 'G').length).toBe(1);
  });
  it('negative: the Aura leaving the battlefield gives the creature back its types and flying', () => {
    const s0 = setup(TREASURE_AURA);
    const bear = bf(s0, 'Test Bear');
    const s1 = resolveAll(cast(s0, 'Test Gilding', { targets: [[obj(bear)]] }));
    const s = tweak(s1, (st) => { const aura = bf(st, 'Test Gilding'); st.zones.battlefield = st.zones.battlefield.filter((x) => x !== aura); st.zones.graveyard['p1']!.push(aura); st.objects[aura]!.zone = 'graveyard'; delete st.objects[aura]!.attachedTo; });
    expect(getChars(s, bear).types).toEqual(['Creature']);
    expect(hasKeyword(getChars(s, bear), 'flying')).toBe(true);
  });
});

// ---- Koll, the Forgemaster --------------------------------------------------------------------------------------------------------------------------------------------
const FORGER = card('Test Forgemaster', 'Legendary Creature — Dwarf', 'Whenever another nontoken creature you control dies, if it was enchanted or equipped, return it to its owner\'s hand.', { pt: ['2', '2'] });
const DOOM = card('Test Doom', 'Sorcery', 'Destroy target creature.');
describe('CR 603.10a, 303.4b, 301.5: "Whenever another nontoken creature you control dies, if it was enchanted or equipped, return it to its owner\'s hand." (Koll, the Forgemaster)', () => {
  it('is automated', () => { expect(noManual(FORGER)).toBe(true); });
  const setup = (attach: 'aura' | 'sword' | 'none') => {
    const s0 = scenario([], { p1: { hand: ['Test Doom', ...(attach === 'aura' ? ['Test Graft'] : [])], battlefield: ['Test Forgemaster', 'Test Bear', ...(attach === 'sword' ? ['Test Sword'] : [])] }, defs: [FORGER, BEAR, GRAFT, SWORD, DOOM] });
    if (attach === 'aura') return resolveAll(cast(s0, 'Test Graft', { targets: [[obj(bf(s0, 'Test Bear'))]] }));
    return attach === 'sword' ? tweak(s0, (st) => { st.objects[bf(st, 'Test Sword')]!.attachedTo = bf(st, 'Test Bear'); }) : s0;
  };
  const kill = (s0: GameState): GameState => resolveAll(cast(s0, 'Test Doom', { targets: [[obj(bf(s0, 'Test Bear'))]] }));
  it('an enchanted creature that dies returns to its owner\'s hand', () => {
    const s = kill(setup('aura'));
    expect(inHand(s, 'Test Bear', 'p1')).toBe(true);
    expect(inYard(s, 'Test Bear', 'p1')).toBe(false);
  });
  it('an equipped creature that dies returns to its owner\'s hand', () => {
    const s = kill(setup('sword'));
    expect(inHand(s, 'Test Bear', 'p1')).toBe(true);
  });
  it('negative: a creature with nothing attached stays in the graveyard', () => {
    const s = kill(setup('none'));
    expect(inHand(s, 'Test Bear', 'p1')).toBe(false);
    expect(inYard(s, 'Test Bear', 'p1')).toBe(true);
  });
  it('negative: the Forgemaster itself dying is not "another" creature', () => {
    const s0 = scenario([], { p1: { hand: ['Test Doom', 'Test Graft'], battlefield: ['Test Forgemaster'] }, defs: [FORGER, GRAFT, DOOM] });
    const s = resolveAll(cast(s0, 'Test Graft', { targets: [[obj(bf(s0, 'Test Forgemaster'))]] }));
    const t = resolveAll(cast(s, 'Test Doom', { targets: [[obj(bf(s, 'Test Forgemaster'))]] }));
    expect(inYard(t, 'Test Forgemaster', 'p1')).toBe(true);
    expect(inHand(t, 'Test Forgemaster', 'p1')).toBe(false);
  });
  it('negative: an enchanted creature of an opponent is not returned by "you control"', () => {
    const s0 = scenario([], { p1: { hand: ['Test Doom', 'Test Graft'], battlefield: ['Test Forgemaster'] }, p2: { battlefield: ['Test Bear'] }, defs: [FORGER, BEAR, GRAFT, DOOM] });
    const s1 = resolveAll(cast(s0, 'Test Graft', { targets: [[obj(bf(s0, 'Test Bear'))]] }));
    const s = resolveAll(cast(s1, 'Test Doom', { targets: [[obj(bf(s1, 'Test Bear'))]] }));
    expect(inYard(s, 'Test Bear', 'p2')).toBe(true);
    expect(inHand(s, 'Test Bear', 'p2')).toBe(false);
  });
});

// ---- Sage of the Maze -------------------------------------------------------------------------------------------------------------------------------------------------
const SAGE = card('Test Sage', 'Creature — Human Wizard', '{T}: Until end of turn, target land you control becomes an X/X Citizen creature with haste in addition to its other types, where X is twice the number of Gates you control. Activate only as a sorcery.', { pt: ['1', '3'] });
const GATE = card('Test Gate', 'Land — Gate', '{T}: Add {C}.');
const FOREST = card('Test Grove', 'Land — Forest', '{T}: Add {G}.');
describe('CR 608.2h, 205.1b, 613.4b: "Until end of turn, target land you control becomes an X/X Citizen creature with haste in addition to its other types, where X is twice the number of Gates you control." (Sage of the Maze)', () => {
  it('is automated', () => { expect(noManual(SAGE)).toBe(true); });
  const setup = () => scenario([], { p1: { battlefield: [{ name: 'Test Sage', since: -1 }, 'Test Gate', 'Test Gate', 'Test Grove'] }, p2: { battlefield: ['Test Grove'] }, defs: [SAGE, GATE, FOREST] });
  const activate = (s0: GameState, target: ObjectId): GameState => settle(act(s0, { type: 'activate', player: 'p1', source: bf(s0, 'Test Sage'), ability: 'p:0:0' }), { targets: [[obj(target)]] });
  it('the land is a 4/4 Citizen creature with haste and still a Forest until end of turn; X is counted once, as the ability resolves', () => {
    const s0 = setup();
    const forest = s0.zones.battlefield.find((id) => s0.objects[id]!.defId === 'Test Grove' && s0.objects[id]!.controller === 'p1')!;
    let s = resolveAll(activate(s0, forest));
    const c = getChars(s, forest);
    expect(c.types).toEqual(expect.arrayContaining(['Land', 'Creature']));
    expect(c.subtypes).toEqual(expect.arrayContaining(['Forest', 'Citizen']));
    expect([Number(c.power), Number(c.toughness)]).toEqual([4, 4]);
    expect(hasKeyword(getChars(s, forest), 'haste')).toBe(true);
    // a third Gate arrives afterwards: X was counted once (ruling 2024-06-07), the land stays 4/4
    s = tweak(s, (st) => { const id = `g${st.counters.object++}`; st.objects[id] = { ...st.objects[bf(st, 'Test Gate')]!, id, timestamp: st.counters.timestamp++ }; st.zones.battlefield.push(id); });
    expect([Number(getChars(s, forest).power), Number(getChars(s, forest).toughness)]).toEqual([4, 4]);
  });
  it('negative: an opponent\'s land is not a legal target, and a land that is not targeted stays a land', () => {
    const s0 = setup();
    const mine = s0.zones.battlefield.find((id) => s0.objects[id]!.defId === 'Test Grove' && s0.objects[id]!.controller === 'p1')!;
    const theirs = s0.zones.battlefield.find((id) => s0.objects[id]!.defId === 'Test Grove' && s0.objects[id]!.controller === 'p2')!;
    const s = resolveAll(activate(s0, mine));
    expect(getChars(s, theirs).types).toEqual(['Land']);
    expect(getChars(s, bf(s, 'Test Gate')).types).toEqual(['Land']);
  });
  it('negative: the Citizen creature land does not stay a creature past the end of the turn', () => {
    const s0 = setup();
    const forest = s0.zones.battlefield.find((id) => s0.objects[id]!.defId === 'Test Grove' && s0.objects[id]!.controller === 'p1')!;
    let s = resolveAll(activate(s0, forest));
    expect(getChars(s, forest).types).toContain('Creature');
    s = declareAttackers(passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'the declare attackers decision'), []); // the hasty land could attack: it doesn't
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2', 'the next turn');
    expect(getChars(s, forest).types).toEqual(['Land']);
  });
});

// ---- Chimeric Mass, Svogthos ------------------------------------------------------------------------------------------------------------------------------------------
const MASS = card('Test Mass', 'Artifact', 'This artifact enters with X charge counters on it.\n{1}: Until end of turn, this artifact becomes a Construct artifact creature with "This creature\'s power and toughness are each equal to the number of charge counters on it."');
const TOMB = card('Test Tomb', 'Land', '{T}: Add {C}.\n{3}{B}{G}: Until end of turn, this land becomes a black and green Plant Zombie creature with "This creature\'s power and toughness are each equal to the number of creature cards in your graveyard." It\'s still a land.');
const act1 = (s0: GameState, source: ObjectId): GameState => {
  const a = legalActions(s0, 'p1').filter((x) => x.kind === 'activate' && x.object === source && !x.isMana);
  expect(a.length).toBe(1);
  return settle(act(s0, a[0]!.action));
};
describe('CR 205.1a, 604.3a, 613.4b, 611.2a: "Until end of turn, ~ becomes a Construct artifact creature with \\"..power and toughness are each equal to the number of charge counters on it.\\"" (Chimeric Mass)', () => {
  it('is automated', () => { expect(noManual(TOMB)).toBe(true); });
  const setup = (counters: number) => scenario(['Plains'], { p1: { battlefield: [{ name: 'Test Mass', counters: { charge: counters } }, 'Plains'] }, defs: [MASS] });
  it('an artifact creature Construct as big as its charge counters, live while it lasts (granted P/T applies in layer 7b, not as a CDA)', () => {
    const s0 = setup(3);
    const mass = bf(s0, 'Test Mass');
    expect(getChars(s0, mass).types).toEqual(['Artifact']);
    let s = resolveAll(act1(s0, mass));
    const c = getChars(s, mass);
    expect(c.types).toEqual(['Artifact', 'Creature']);
    expect(c.subtypes).toEqual(['Construct']);
    expect([Number(c.power), Number(c.toughness)]).toEqual([3, 3]);
    s = tweak(s, (st) => { st.objects[mass]!.counters['charge'] = 5; });
    expect([Number(getChars(s, mass).power), Number(getChars(s, mass).toughness)]).toEqual([5, 5]);
  });
  it('negative: without the activation it is just an artifact, and it is not a creature after the turn ends', () => {
    const s0 = setup(3);
    const mass = bf(s0, 'Test Mass');
    expect(getChars(s0, mass).types).not.toContain('Creature');
    let s = resolveAll(act1(s0, mass));
    s = declareAttackers(passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'the declare attackers decision'), []);
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2', 'the next turn');
    expect(getChars(s, mass).types).toEqual(['Artifact']);
  });
});
describe('CR 205.1b, 105.2, 604.3a: "Until end of turn, ~ becomes a black and green Plant Zombie creature with \\"..\\" It\'s still a land." (Svogthos, the Restless Tomb)', () => {
  const setup = (yard: number) => {
    const s0 = scenario(['Swamp', 'Forest'], { p1: { battlefield: [{ name: 'Test Tomb', since: -1 }, 'Swamp', 'Swamp', 'Forest', 'Forest', 'Forest'], graveyard: Array(yard).fill('Test Bear') }, defs: [TOMB, BEAR] });
    return s0;
  };
  it('a black and green Plant Zombie creature land as big as the creature cards in the graveyard', () => {
    const s0 = setup(2);
    const tomb = bf(s0, 'Test Tomb');
    const s = resolveAll(act1(s0, tomb));
    const c = getChars(s, tomb);
    expect(c.types).toEqual(expect.arrayContaining(['Land', 'Creature']));
    expect(c.subtypes).toEqual(expect.arrayContaining(['Plant', 'Zombie']));
    expect([...c.colors].sort()).toEqual(['B', 'G']);
    expect([Number(c.power), Number(c.toughness)]).toEqual([2, 2]);
  });
  it('negative: with an empty graveyard it is 0/0 and dies (state-based action), and a land that was not animated stays a land', () => {
    const s0 = setup(0);
    const tomb = bf(s0, 'Test Tomb');
    expect(getChars(s0, tomb).types).toEqual(['Land']);
    const s = resolveAll(act1(s0, tomb));
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Tomb')).toBe(false);
  });
});
