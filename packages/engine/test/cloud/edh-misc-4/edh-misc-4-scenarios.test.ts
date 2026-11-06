/**
 * Commander lane edh-misc, round edh-misc-4: the G10 changes the owner's standing rule (2026-10-27, "always do the most sensible thing") allows, each played against
 * the rulings of its cards. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 118.12, 608.2c           "you may pay 2 life and exile it. If you do, ...": the instruction happens only if the payment is made (Kinzu of the Bleak Coven)
 *   CR 608.2c, 608.2d           "If it's a land card, you may put it onto the battlefield tapped. Otherwise, put it into your hand.": "Otherwise" is whether the card was put
 *                               onto the battlefield, so declining puts it into the hand too (rulings of Treasure Chest 2021-07-23, Fecund Greenshell, Aid from the Cowl)
 *   CR 400.3, 110.2, 303.4f     eff.put.bf.owner (Kenrith, the Returned King; Bilbo, Unexpected Adventurer) is played in edh-misc-1-scenarios.test.ts
 *   CR 205.3i, 305.6, 613.1d    "~ is every nonbasic land type": all twelve land types that are not basic (Planar Nexus), so Urza's Tower sees an Urza's Mine and an Urza's Power-Plant
 *   CR 106.4, 106.1, 605.1a     "Double the amount of each type of unspent mana you have.": as much of each type again, none of a type you have none of (Doubling Cube)
 *   CR 701.34a, 608.2c          "Proliferate, then choose any number of permanents you control that had a counter put on them this way. Those permanents phase out." (Ripples of Potential)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { legalActions } from '../../../src/index';
import { act, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** The card is parsed and automated without a manual unit. */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
/** Answer every decision: the optional part by `yes`, objects by the first option, mana automatically; pass priority until the stack is empty. */
function resolveAll(s0: GameState, o: { yes?: boolean; pick?: (options: string[], s: GameState) => string[]; options?: (ids: string[], s: GameState) => string[] } = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 80 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
    const p = s.pending!;
    if (p.kind === 'priority') s = pass(s);
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes !== false });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: (o.options ? o.options(p.options.map((x) => x.id), s) : p.options.slice(0, Math.max(p.min, 1)).map((x) => x.id)) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options, s) : p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const cast = (s0: GameState, name: string, o: Parameters<typeof resolveAll>[1] = {}): GameState => resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), o);
const namesIn = (s: GameState, zone: 'graveyard' | 'hand' | 'exile' | 'battlefield', p: 'p1' | 'p2' = 'p1'): string[] =>
  (zone === 'battlefield' ? s.zones.battlefield.filter((id) => s.objects[id]!.controller === p) : zone === 'exile' ? s.zones.exile : s.zones[zone][p]!).map((id) => getChars(s, id).name);

describe('CR 118.12, 608.2c: "Whenever another nontoken creature you control dies, you may pay 2 life and exile it. If you do, create a token that\'s a copy of that creature, except it\'s 1/1 and has toxic 1." (Kinzu of the Bleak Coven)', () => {
  const BROKER = card('Test Soul Broker', 'Legendary Creature — Vampire', "Whenever another nontoken creature you control dies, you may pay 2 life and exile it. If you do, create a token that's a copy of that creature, except it's 1/1 and has toxic 1.", ['3', '3']);
  const SELFISH = card('Test Selfish', 'Sorcery', 'Sacrifice a creature.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const DEFS = [BROKER, SELFISH, BEAR];
  const play = (yes: boolean): GameState => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Selfish'], battlefield: ['Test Soul Broker', 'Test Bear'] } });
    return cast(s, 'Test Selfish', { yes, pick: (o, st) => [o.find((id) => getChars(st, id).name === 'Test Bear') ?? o[0]!] });
  };
  it('is parsed and automated, the payment carrying the exile (not a payment followed by an unconditional exile)', () => {
    expect(automated(BROKER)).toBe(true);
    const trig = BROKER.faces[0]!.abilities.find((a) => a.kind === 'triggered') as unknown as { effect: { steps: { op: string; then?: { op: string }[] }[] } };
    expect(trig.effect.steps.map((x) => x.op)).toEqual(['pay']);
    expect(trig.effect.steps[0]!.then!.map((x) => x.op)).toEqual(['move', 'copy']);
  });
  it('paying: 2 life, the creature card is exiled and a 1/1 copy with toxic 1 is created', () => {
    const s = play(true);
    expect(s.players[0]!.life).toBe(18);
    expect(namesIn(s, 'exile')).toContain('Test Bear');
    expect(namesIn(s, 'graveyard')).not.toContain('Test Bear');
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token' && getChars(s, id).name === 'Test Bear');
    expect(token).toBeDefined();
    expect(String(getChars(s, token!).power)).toBe('1');
  });
  it('negative: declining the payment costs no life, the creature card stays in the graveyard (it is not exiled) and no token is created', () => {
    const s = play(false);
    expect(s.players[0]!.life).toBe(20);
    expect(namesIn(s, 'exile')).not.toContain('Test Bear');
    expect(namesIn(s, 'graveyard')).toContain('Test Bear');
    expect(s.zones.battlefield.some((id) => s.objects[id]!.kind === 'token')).toBe(false);
  });
  it('a sentence that is not one option is left alone: "you may pay 2 life. Draw a card." draws whether or not you pay', () => {
    const c = card('Test Draw Anyway', 'Creature — Test', 'When this creature enters, you may pay 2 life. Draw a card.', ['1', '1']);
    expect(JSON.stringify(c.faces[0]!.abilities)).not.toContain('"then":[{"op":"draw"');
  });
});

describe('CR 118.12, 608.2c: "you may pay 2 life and draw a card" (a payment of yours with an instruction in its sentence)', () => {
  const SEER = card('Test Life Seer', 'Creature — Test', 'When this creature enters, you may pay 2 life and draw a card.', ['1', '1'], '{0}');
  const DEFS = [SEER];
  const play = (yes: boolean): GameState => cast(scenario([], { defs: DEFS, p1: { hand: ['Test Life Seer'] } }), 'Test Life Seer', { yes });
  it('is parsed and automated', () => expect(automated(SEER)).toBe(true));
  it('paying: 2 life and a card', () => {
    const s = play(true);
    expect(s.players[0]!.life).toBe(18);
    expect(namesIn(s, 'hand')).toHaveLength(1);
  });
  it('negative: declining: no life lost and no card drawn', () => {
    const s = play(false);
    expect(s.players[0]!.life).toBe(20);
    expect(namesIn(s, 'hand')).toHaveLength(0);
  });
  it('the same for a mana payment: "you may pay {1} and draw a card" draws only if paid', () => {
    const c = card('Test Mana Seer', 'Creature — Test', 'When this creature enters, you may pay {1} and draw a card.', ['1', '1']);
    expect(automated(c)).toBe(true);
    const s = scenario([], { defs: [c], p1: { hand: ['Test Mana Seer'] } });
    expect(namesIn(cast(s, 'Test Mana Seer', { yes: false }), 'hand')).toHaveLength(0);
  });
});

describe('CR 608.2c, 608.2d: "Look at the top card of your library. If it\'s a land card, you may put it onto the battlefield tapped. Otherwise, put it into your hand." (declining puts it into the hand too)', () => {
  const SEER = card('Test Land Seer', 'Creature — Test', "When this creature enters, look at the top card of your library. If it's a land card, you may put it onto the battlefield tapped. Otherwise, put it into your hand.", ['1', '1']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const DEFS = [SEER, BEAR];
  const play = (top: string, yes: boolean): GameState => cast(scenario([], { defs: DEFS, p1: { hand: ['Test Land Seer'], library: [top] } }), 'Test Land Seer', { yes });
  it('is parsed and automated', () => expect(automated(SEER)).toBe(true));
  it('a land, accepted: it enters the battlefield tapped and the hand stays empty', () => {
    const s = play('Plains', true);
    const land = s.zones.battlefield.find((id) => s.objects[id]!.owner === 'p1' && getChars(s, id).name === 'Plains');
    expect(land).toBeDefined();
    expect(s.objects[land!]!.tapped).toBe(true);
    expect(namesIn(s, 'hand')).toEqual([]);
  });
  it('a land, declined: it goes into the hand (the ruling: "Otherwise" is whether you put it onto the battlefield)', () => {
    const s = play('Plains', false);
    expect(namesIn(s, 'hand')).toEqual(['Plains']);
    expect(s.zones.battlefield.some((id) => getChars(s, id).name === 'Plains')).toBe(false);
  });
  it('a nonland card: it goes into the hand without any question', () => {
    const s = play('Test Bear', false);
    expect(namesIn(s, 'hand')).toEqual(['Test Bear']);
  });
  it('negative: a land that is put onto the battlefield is not also put into the hand', () => {
    const s = play('Plains', true);
    expect(namesIn(s, 'hand')).not.toContain('Plains');
  });
});

describe('CR 205.3i, 305.6, 613.1d: "~ is every nonbasic land type" (Planar Nexus)', () => {
  const NEXUS = card('Test Nexus', 'Land', 'Test Nexus is every nonbasic land type.');
  const types = (s: GameState, name: string): string[] => getChars(s, s.zones.battlefield.find((id) => getChars(s, id).name === name)!).subtypes;
  it('is parsed and automated', () => expect(automated(NEXUS)).toBe(true));
  it('it has all twelve land types that are not basic, and no basic land type', () => {
    const s = scenario([], { defs: [NEXUS], p1: { battlefield: ['Test Nexus'] } });
    expect([...types(s, 'Test Nexus')].sort()).toEqual(['Cave', 'Desert', 'Gate', 'Lair', 'Locus', 'Mine', 'Planet', 'Power-Plant', 'Sphere', 'Tower', 'Town', "Urza's"]);
  });
  it('it has the types in every zone (a characteristic-defining ability, CR 604.3): in the library it is a Gate-or-Cave card', () => {
    const s = scenario([], { defs: [NEXUS], p1: { library: ['Test Nexus'] } });
    const id = s.zones.library.p1!.find((x) => getChars(s, x).name === 'Test Nexus')!;
    expect(getChars(s, id).subtypes).toContain('Gate');
  });
  it("with Urza's Tower it makes the Tower's three mana (the ruling: it counts as an Urza's Mine and an Urza's Power-Plant)", () => {
    const s = scenario(["Urza's Tower"], { defs: [NEXUS], p1: { battlefield: ['Test Nexus', "Urza's Tower"] } });
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.isMana === true && x.object === find(s, "Urza's Tower", 'battlefield', 'p1'))!;
    expect(act(s, a.action).players[0]!.manaPool.map((u) => u.type).join('')).toBe('CCC');
  });
  it("negative: without it the Tower makes one mana", () => {
    const s = scenario(["Urza's Tower"], { p1: { battlefield: ["Urza's Tower"] } });
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.isMana === true && x.object === find(s, "Urza's Tower", 'battlefield', 'p1'))!;
    expect(act(s, a.action).players[0]!.manaPool.map((u) => u.type).join('')).toBe('C');
  });
});

describe('CR 106.4, 106.1, 605.1a: "Double the amount of each type of unspent mana you have." (Doubling Cube)', () => {
  const CUBE = card('Test Cube', 'Artifact', '{T}: Double the amount of each type of unspent mana you have.');
  const pool = (s: GameState, p = 0): string => s.players[p]!.manaPool.map((u) => u.type).sort().join('');
  const run = (types: string[]): GameState => {
    const s = scenario([], { defs: [CUBE], p1: { battlefield: ['Test Cube'] } });
    s.players[0]!.manaPool.push(...types.map((type) => ({ type }) as never));
    s.players[1]!.manaPool.push({ type: 'R' } as never);
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.object === find(s, 'Test Cube', 'battlefield', 'p1'))!;
    return act(s, a.action);
  };
  it('is parsed and automated, and its ability is a mana ability (no stack)', () => {
    expect(automated(CUBE)).toBe(true);
    const s = scenario([], { defs: [CUBE], p1: { battlefield: ['Test Cube'] } });
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.object === find(s, 'Test Cube', 'battlefield', 'p1'))!;
    expect(a.isMana).toBe(true);
  });
  it('{C}{W}{W}{B} becomes {C}{C}{W}{W}{W}{W}{B}{B}', () => expect(pool(run(['C', 'W', 'W', 'B']))).toBe('BBCCWWWW'));
  it('negative: a type you have none of stays none, and another player\'s mana is not doubled', () => {
    const s = run(['U']);
    expect(pool(s)).toBe('UU');
    expect(pool(s, 1)).toBe('R');
  });
  it('negative: with no mana it adds nothing', () => expect(pool(run([]))).toBe(''));
});

describe('CR 701.34a, 608.2c, 702.26b: "Proliferate, then choose any number of permanents you control that had a counter put on them this way. Those permanents phase out." (Ripples of Potential)', () => {
  const RIPPLES = card('Test Ripples', 'Instant', 'Proliferate, then choose any number of permanents you control that had a counter put on them this way. Those permanents phase out.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const ROCK = card('Test Rock', 'Artifact', '');
  const DEFS = [RIPPLES, BEAR, ROCK];
  const setup = (): GameState => scenario([], { defs: DEFS, p1: { hand: ['Test Ripples'], battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 1 } }, { name: 'Test Rock', counters: { charge: 1 } }, 'Test Rock'] }, p2: { battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 1 } }] } });
  const idOf = (s: GameState, name: string, owner: 'p1' | 'p2', counters = true): string => s.zones.battlefield.find((id) => getChars(s, id).name === name && s.objects[id]!.owner === owner && (!counters || Object.keys(s.objects[id]!.counters).length > 0))!;
  it('is parsed and automated', () => expect(automated(RIPPLES)).toBe(true));
  it('proliferating two of my permanents and an opponent\'s: I may phase out only mine that got a counter (the opponent\'s and the unchosen are not offered)', () => {
    const s0 = setup();
    const bear = idOf(s0, 'Test Bear', 'p1');
    const oppBear = idOf(s0, 'Test Bear', 'p2');
    let offered: string[] = [];
    const s = cast(s0, 'Test Ripples', {
      options: (ids) => ids.filter((id) => id === `object:${bear}` || id === `object:${oppBear}`),
      pick: (o) => { offered = o; return [o[0]!]; },
    });
    expect(offered).toEqual([bear]);
    expect(s.objects[bear]!.counters['+1/+1']).toBe(2);
    expect(s.objects[bear]!.phasedOut).toBe(true);
    expect(s.objects[oppBear]!.counters['+1/+1']).toBe(2);
    expect(s.objects[oppBear]!.phasedOut).toBe(false);
    expect(s.objects[idOf(s0, 'Test Rock', 'p1')]!.counters['charge']).toBe(1); // not chosen to proliferate: no counter, not phased out
    expect(s.objects[idOf(s0, 'Test Rock', 'p1')]!.phasedOut).toBe(false);
  });
  it('with "If you would proliferate, proliferate twice instead" the permanents that got counters through the replacement are still offered', () => {
    const TWICE = card('Test Twice', 'Enchantment', 'If you would proliferate, proliferate twice instead.');
    const s0 = scenario([], { defs: [...DEFS, TWICE], p1: { hand: ['Test Ripples'], battlefield: ['Test Twice', { name: 'Test Bear', counters: { '+1/+1': 1 } }] } });
    const bear = idOf(s0, 'Test Bear', 'p1');
    const s = cast(s0, 'Test Ripples', { options: (ids) => ids.filter((id) => id === `object:${bear}`), pick: (o) => o.slice(0, 1) });
    expect(s.objects[bear]!.counters['+1/+1']).toBeGreaterThan(1);
    expect(s.objects[bear]!.phasedOut).toBe(true);
  });
  it('negative: choosing none of them phases nothing out', () => {
    const s0 = setup();
    const bear = idOf(s0, 'Test Bear', 'p1');
    const s = cast(s0, 'Test Ripples', { options: (ids) => ids.filter((id) => id === `object:${bear}`), pick: () => [] });
    expect(s.objects[bear]!.counters['+1/+1']).toBe(2);
    expect(s.objects[bear]!.phasedOut).toBe(false);
  });
  it('negative: proliferating only the opponent\'s permanent leaves nothing of mine to choose and phases nothing out', () => {
    const s0 = setup();
    const oppBear = idOf(s0, 'Test Bear', 'p2');
    const s = cast(s0, 'Test Ripples', { options: (ids) => ids.filter((id) => id === `object:${oppBear}`) });
    expect(s.objects[oppBear]!.counters['+1/+1']).toBe(2);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.phasedOut)).toBe(false);
  });
});
