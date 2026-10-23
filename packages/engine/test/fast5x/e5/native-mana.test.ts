/**
 * FAST5X E5: native mana abilities with costs and activation restrictions.
 *
 *   CR 605.3a      a player may activate a mana ability while paying a cost, so the mana cost of a filter ability ("{1}, {T}: Add one mana of any color",
 *                  Signets) is paid with other mana; the automatic payer plans it (rules/convert.ts) and the player may activate it by hand
 *   CR 605.3b      it resolves at once, without the stack
 *   CR 605.3c      once begun, it can't be activated again until it has resolved: no filter ability pays its own cost
 *   CR 118.3       a cost that can't be paid can't be begun: other cost parts ("Pay 1 life", "Tap an untapped creature you control") are paid as any ability's
 *   CR 605.1a      a mana ability is an activated ability, so it keeps its restrictions: 602.5b "Activate only if ..." / "only once each turn", 602.5d "as a sorcery"
 *   CR 106.4       the mana goes to the pool
 *
 * Synthetic cards with the Oracle wording of Standard cards (Prophetic Prism, a Signet, Starting Town, Springleaf Drum, Mox Jasper, Abzan Devotee), compiled by
 * the game's default compiler (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, legal, life, pool, reject, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}

const PRISM = card('Test Prism', 'Artifact', '{1}, {T}: Add one mana of any color.', { cost: '{2}' });
const SIGNET = card('Test Signet', 'Artifact', '{1}, {T}: Add {W}{U}.', { cost: '{2}' });
const TOWN = card('Test Town', 'Land — Town', '{T}: Add {C}.\n{T}, Pay 1 life: Add one mana of any color.');
const DRUM = card('Test Drum', 'Artifact', '{T}, Tap an untapped creature you control: Add one mana of any color.', { cost: '{1}' });
const MOX = card('Test Mox', 'Legendary Artifact', '{T}: Add one mana of any color. Activate only if you control a Dragon.');
const DEVOTEE = card('Test Devotee', 'Creature — Dog Cleric', '{1}: Add {W}, {B}, or {G}. Activate only once each turn.', { cost: '{1}{W}', colors: ['W'], pt: ['1', '3'] });
const SORC_FILTER = card('Test Slow Filter', 'Artifact', '{1}: Add {C}{C}. Activate only as a sorcery.', { cost: '{3}' });
const VERGE = card('Test Verge', 'Land', '{T}: Add {B}.\n{T}: Add {W}. Activate only if you control a Plains or a Swamp.');
const GATHERING = card('Test Gathering', 'Land', '{T}: Add {C}.\n{T}: Add {G} or {W}. Activate only if this land entered this turn or if you control a basic land.');
const GATE = card('Test Gate', 'Land', '{T}: Add {C}.\n{W/U}, {T}: Add {W}{W}, {W}{U}, or {U}{U}.');
const RELIC = card('Test Engine', 'Artifact Creature — Dragon', 'Remove two +1/+1 counters from this creature: Add {R}{R}. Activate only once each turn.', { cost: '{6}', pt: ['4', '4'] });
const UU = card('Test Twin', 'Sorcery', 'Draw a card.', { cost: '{U}{U}', colors: ['U'] });
const WHITE = card('Test White', 'Sorcery', 'Draw a card.', { cost: '{W}', colors: ['W'] });
const GREEN = card('Test Green', 'Sorcery', 'Draw a card.', { cost: '{G}', colors: ['G'] });
const DRAGON = card('Test Dragon', 'Creature — Dragon', '', { cost: '{4}{R}', colors: ['R'], pt: ['4', '4'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { cost: '{1}{G}', colors: ['G'], pt: ['2', '2'] });
const BLUE = card('Test Blue', 'Sorcery', 'Draw a card.', { cost: '{U}', colors: ['U'] });
const UB = card('Test Grixis', 'Sorcery', 'Draw a card.', { cost: '{U}{B}', colors: ['U', 'B'] });
const WU = card('Test Pact', 'Sorcery', 'Draw a card.', { cost: '{W}{U}', colors: ['W', 'U'] });
const TWO = card('Test Two', 'Sorcery', 'Draw a card.', { cost: '{2}' });

const DEFS = [PRISM, SIGNET, TOWN, DRUM, MOX, DEVOTEE, SORC_FILTER, DRAGON, BEAR, BLUE, UB, WU, TWO, VERGE, GATHERING, WHITE, GREEN, GATE, RELIC, UU];

const onStack = (s: GameState, name: string): boolean => s.zones.stack.some((id) => s.defs[s.objects[id]!.defId]!.name === name);
const tapped = (s: GameState, name: string): boolean => s.objects[find(s, name, 'battlefield')]!.tapped;
const castable = (s: GameState, name: string): boolean => legal(s, 'p1', 'cast').some((a) => a.object === find(s, name, 'hand', 'p1'));
const activations = (s: GameState, name: string): string[] => legal(s, 'p1', 'activate').filter((a) => s.objects[a.object!]?.defId === s.objects[find(s, name, 'battlefield')]!.defId).map((a) => a.label);
function cast(s: GameState, name: string): GameState {
  const t = act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') });
  expect(t.pending?.kind).toBe('payCost');
  return t;
}
function activate(s: GameState, name: string, index = 0): GameState {
  const id = find(s, name, 'battlefield');
  const a = legal(s, 'p1', 'activate').filter((x) => x.object === id)[index];
  if (!a) throw new Error(`no activation of ${name}`);
  return act(s, a.action);
}

describe('CR 605.3a, 601.2g-h: the automatic payer activates a filter ability, paying its mana cost with other mana', () => {
  it('Plains + Prism pay {U}: the Plains pays the Prism\'s {1}, the Prism adds {U}; both tapped, nothing floats', () => {
    const s = scenario([], { p1: { hand: ['Test Blue'], battlefield: ['Plains', 'Test Prism'] }, defs: DEFS });
    expect(castable(s, 'Test Blue')).toBe(true);
    const pay = cast(s, 'Test Blue');
    expect((pay.pending as unknown as { autoPayable: boolean }).autoPayable).toBe(true);
    expect((pay.pending as unknown as { onlyWay?: true }).onlyWay).toBeUndefined();
    const t = answer(pay, { kind: 'payCost', auto: true });
    expect(onStack(t, 'Test Blue')).toBe(true);
    expect(tapped(t, 'Plains')).toBe(true);
    expect(tapped(t, 'Test Prism')).toBe(true);
    expect(pool(t, 'p1')).toBe('');
    expect(t.log.some((l) => /Test Prism for \{U\}/.test(l.text))).toBe(true);
  });

  it('the ordinary sources are used first: Island + Plains + Prism pay {U} with the Island alone', () => {
    const s = scenario(['Island'], { p1: { hand: ['Test Blue'], battlefield: ['Plains', 'Island', 'Test Prism'] }, defs: DEFS });
    const t = answer(cast(s, 'Test Blue'), { kind: 'payCost', auto: true });
    expect(onStack(t, 'Test Blue')).toBe(true);
    expect(tapped(t, 'Island')).toBe(true);
    expect(tapped(t, 'Plains')).toBe(false);
    expect(tapped(t, 'Test Prism')).toBe(false);
  });

  it('CR 605.3c, 118.3: a Prism alone can\'t pay for itself: {U} is not castable and the Prism is not offered', () => {
    const s = scenario([], { p1: { hand: ['Test Blue'], battlefield: ['Test Prism'] }, defs: DEFS });
    expect(castable(s, 'Test Blue')).toBe(false);
    expect(activations(s, 'Test Prism')).toEqual([]);
  });

  it('CR 605.3c: "{1}: Add {W}, {B}, or {G}" without {T} can\'t pay its own {1} either: alone it is not offered; with a Plains it pays {B}', () => {
    const s = scenario([], { p1: { hand: ['Test Grixis'], battlefield: ['Test Devotee'] }, defs: DEFS });
    expect(activations(s, 'Test Devotee')).toEqual([]);
    const t = scenario(['Island'], { p1: { hand: ['Test Grixis'], battlefield: ['Test Devotee', 'Plains', 'Island'] }, defs: DEFS });
    expect(castable(t, 'Test Grixis')).toBe(true);
    const u = answer(cast(t, 'Test Grixis'), { kind: 'payCost', auto: true });
    expect(onStack(u, 'Test Grixis')).toBe(true);
    expect(pool(u, 'p1')).toBe('');
  });

  it('two Prisms and two Plains pay {U}{B}: each Prism is paid by a Plains (no Prism pays for the other)', () => {
    const s = scenario([], { p1: { hand: ['Test Grixis'], battlefield: ['Plains', 'Plains', 'Test Prism', 'Test Prism'] }, defs: DEFS });
    expect(castable(s, 'Test Grixis')).toBe(true);
    const t = answer(cast(s, 'Test Grixis'), { kind: 'payCost', auto: true });
    expect(onStack(t, 'Test Grixis')).toBe(true);
    expect(t.zones.battlefield.every((id) => t.objects[id]!.controller !== 'p1' || t.objects[id]!.tapped)).toBe(true);
    expect(pool(t, 'p1')).toBe('');
  });

  it('two Prisms and one Plains can\'t pay {U}{B} (a Prism\'s mana never pays another Prism\'s cost)', () => {
    const s = scenario([], { p1: { hand: ['Test Grixis'], battlefield: ['Plains', 'Test Prism', 'Test Prism'] }, defs: DEFS });
    expect(castable(s, 'Test Grixis')).toBe(false);
  });

  it('a filter land: the Plains pays its {W/U} with {W}, it adds {U}{U} (CR 107.4e: a hybrid symbol is paid with either color)', () => {
    const s = scenario([], { p1: { hand: ['Test Twin'], battlefield: ['Plains', 'Test Gate'] }, defs: DEFS });
    expect(castable(s, 'Test Twin')).toBe(true);
    const t = answer(cast(s, 'Test Twin'), { kind: 'payCost', auto: true });
    expect(onStack(t, 'Test Twin')).toBe(true);
    expect(tapped(t, 'Plains')).toBe(true);
    expect(tapped(t, 'Test Gate')).toBe(true);
    expect(pool(t, 'p1')).toBe('');
  });

  it('a Signet: Plains pays its {1}, it adds {W}{U}, which pays {W}{U}', () => {
    const s = scenario([], { p1: { hand: ['Test Pact'], battlefield: ['Plains', 'Test Signet'] }, defs: DEFS });
    const t = answer(cast(s, 'Test Pact'), { kind: 'payCost', auto: true });
    expect(onStack(t, 'Test Pact')).toBe(true);
    expect(pool(t, 'p1')).toBe('');
  });

  it('a Signet\'s two mana pay a {2} with a Plains: the Plains pays the Signet, the Signet pays the spell', () => {
    const s = scenario([], { p1: { hand: ['Test Two'], battlefield: ['Plains', 'Test Signet'] }, defs: DEFS });
    expect(castable(s, 'Test Two')).toBe(true);
    const t = answer(cast(s, 'Test Two'), { kind: 'payCost', auto: true });
    expect(onStack(t, 'Test Two')).toBe(true);
    expect(pool(t, 'p1')).toBe('');
  });
});

describe('CR 106.6, 605.3a: mana with a spending restriction never pays a filter ability\'s own cost', () => {
  const ONLY_CREATURES = card('Test Restricted Land', 'Land', '{T}: Add one mana of any color. Spend this mana only to cast a creature spell.');
  const CAVERN = card('Test Cavern', 'Land', '{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell.');
  const GWU = card('Test Bant Beast', 'Creature — Beast', '', { cost: '{G}{W}{U}', colors: ['G', 'W', 'U'], pt: ['3', '3'] });
  const defs = [...DEFS, ONLY_CREATURES, CAVERN, GWU];
  const orders = [
    ['Test Restricted Land', 'Forest', 'Test Signet'],
    ['Forest', 'Test Signet', 'Test Restricted Land'],
    ['Test Signet', 'Test Restricted Land', 'Forest'],
  ];
  for (const battlefield of orders) {
    it(`restricted land + Forest + Signet pay {G}{W}{U} for a creature automatically: the Forest pays the Signet (${battlefield.join(', ')})`, () => {
      const s = scenario(['Forest'], { p1: { hand: ['Test Bant Beast'], battlefield }, defs });
      expect(castable(s, 'Test Bant Beast')).toBe(true);
      const pay = cast(s, 'Test Bant Beast');
      expect((pay.pending as unknown as { autoPayable: boolean }).autoPayable).toBe(true);
      const t = answer(pay, { kind: 'payCost', auto: true });
      expect(onStack(t, 'Test Bant Beast')).toBe(true);
      for (const name of battlefield) expect(tapped(t, name)).toBe(true);
      expect(pool(t, 'p1')).toBe('');
    });
  }

  it('a land with a restricted and an unrestricted ability: the Plains pays the Signet, the land\'s restricted mana pays {G} of the creature', () => {
    const s = scenario([], { p1: { hand: ['Test Bant Beast'], battlefield: ['Test Cavern', 'Plains', 'Test Signet'] }, defs });
    const pay = cast(s, 'Test Bant Beast');
    expect((pay.pending as unknown as { autoPayable: boolean }).autoPayable).toBe(true);
    const t = answer(pay, { kind: 'payCost', auto: true });
    expect(onStack(t, 'Test Bant Beast')).toBe(true);
    expect(pool(t, 'p1')).toBe('');
  });
});

describe('CR 605.3a-b, 106.4: a filter ability activated by the player', () => {
  it('at priority: the Prism asks for its {1} (paid by the Plains), then for the color; the mana goes to the pool', () => {
    const s = scenario([], { p1: { battlefield: ['Plains', 'Test Prism'] }, defs: DEFS });
    expect(activations(s, 'Test Prism')).toHaveLength(1);
    let t = activate(s, 'Test Prism');
    while (t.pending?.kind !== 'payCost') {
      expect(t.pending?.kind).toBe('chooseColor');
      t = answer(t, { kind: 'chooseColor', color: 'B' });
    }
    t = answer(t, { kind: 'payCost', auto: true });
    if (t.pending?.kind === 'chooseColor') t = answer(t, { kind: 'chooseColor', color: 'B' });
    expect(pool(t, 'p1')).toBe('B');
    expect(tapped(t, 'Plains')).toBe(true);
    expect(tapped(t, 'Test Prism')).toBe(true);
    expect(t.stage === undefined || t.zones.stack.length === 0).toBe(true); // CR 605.3b: no stack object
  });

  it('during a payment: the player lists the Plains, then the Prism; the Prism\'s {1} is paid from the pool', () => {
    const s = scenario([], { p1: { hand: ['Test Blue'], battlefield: ['Plains', 'Test Prism'] }, defs: DEFS });
    const pay = cast(s, 'Test Blue');
    const srcs = (pay.pending as unknown as { manaSources: { objectId: string; abilityKey: string }[] }).manaSources;
    const prism = srcs.find((m) => m.objectId === find(s, 'Test Prism', 'battlefield'))!;
    const plains = srcs.find((m) => m.objectId === find(s, 'Plains', 'battlefield'))!;
    expect(prism).toBeDefined();
    let t = answer(pay, { kind: 'payCost', auto: false, activations: [{ objectId: plains.objectId, abilityKey: plains.abilityKey }, { objectId: prism.objectId, abilityKey: prism.abilityKey, color: 'U' }] });
    // the Prism's own payment: the {W} in the pool pays its {1}
    expect(t.pending?.kind).toBe('payCost');
    t = answer(t, { kind: 'payCost', auto: true });
    expect(onStack(t, 'Test Blue')).toBe(true);
    expect(pool(t, 'p1')).toBe('');
  });
});

describe('CR 118.3, 602.2b: other cost parts of a mana ability are paid as any ability\'s; the automatic payer leaves them to the player', () => {
  it('"{T}, Pay 1 life: Add one mana of any color": activated by hand, 1 life paid; never used by the automatic payer', () => {
    const s = scenario([], { p1: { hand: ['Test Blue'], battlefield: ['Test Town'] }, defs: DEFS });
    expect(castable(s, 'Test Blue')).toBe(false); // the automatic payer does not pay life for mana
    expect(activations(s, 'Test Town')).toHaveLength(2);
    let t = activate(s, 'Test Town', 1);
    if (t.pending?.kind === 'chooseColor') t = answer(t, { kind: 'chooseColor', color: 'U' });
    expect(pool(t, 'p1')).toBe('U');
    expect(life(t, 'p1')).toBe(19);
    expect(tapped(t, 'Test Town')).toBe(true);
    t = act(t, { type: 'cast', player: 'p1', card: find(t, 'Test Blue', 'hand', 'p1') });
    if (t.pending?.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
    expect(onStack(t, 'Test Blue')).toBe(true);
  });

  it('"{T}, Tap an untapped creature you control": not offered without a creature; with one, both are tapped', () => {
    const none = scenario([], { p1: { battlefield: ['Test Drum'] }, defs: DEFS });
    expect(activations(none, 'Test Drum')).toEqual([]);
    const s = scenario([], { p1: { battlefield: ['Test Drum', 'Test Bear'] }, defs: DEFS });
    expect(activations(s, 'Test Drum')).toHaveLength(1);
    let t = activate(s, 'Test Drum');
    for (let i = 0; i < 3 && t.pending?.kind !== 'priority'; i++) {
      if (t.pending?.kind === 'chooseColor') t = answer(t, { kind: 'chooseColor', color: 'G' });
      else if (t.pending?.kind === 'chooseObjects') t = answer(t, { kind: 'chooseObjects', ids: [find(t, 'Test Bear', 'battlefield')] });
    }
    expect(pool(t, 'p1')).toBe('G');
    expect(tapped(t, 'Test Drum')).toBe(true);
    expect(tapped(t, 'Test Bear')).toBe(true);
  });
});

describe('CR 605.1a, 602.5b, 602.5d: a mana ability keeps its activation restrictions', () => {
  it('"Activate only if you control a Dragon": not offered without one, offered with one', () => {
    const s = scenario([], { p1: { hand: ['Test Blue'], battlefield: ['Test Mox'] }, defs: DEFS });
    expect(activations(s, 'Test Mox')).toEqual([]);
    expect(castable(s, 'Test Blue')).toBe(false);
    const d = scenario([], { p1: { hand: ['Test Blue'], battlefield: ['Test Mox', 'Test Dragon'] }, defs: DEFS });
    expect(activations(d, 'Test Mox')).toHaveLength(1);
    expect(castable(d, 'Test Blue')).toBe(true);
    const t = answer(cast(d, 'Test Blue'), { kind: 'payCost', auto: true });
    expect(onStack(t, 'Test Blue')).toBe(true);
  });

  it('"Activate only once each turn": a second activation the same turn is refused', () => {
    const s = scenario([], { p1: { battlefield: ['Plains', 'Plains', 'Test Devotee'] }, defs: DEFS });
    let t = activate(s, 'Test Devotee');
    for (let i = 0; i < 3 && t.pending?.kind !== 'priority'; i++) {
      if (t.pending?.kind === 'chooseColor') t = answer(t, { kind: 'chooseColor', color: 'B' });
      else if (t.pending?.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
    }
    expect(pool(t, 'p1')).toBe('B');
    expect(activations(t, 'Test Devotee')).toEqual([]);
    const key = legal(s, 'p1', 'activate').find((a) => a.object === find(s, 'Test Devotee', 'battlefield'))!;
    expect(reject(t, key.action).rules).toContain('CR 602.5b');
  });

  it('"Activate only as a sorcery": offered in the main phase with an empty stack, not while a spell is being paid for', () => {
    const s = scenario([], { p1: { hand: ['Test Two'], battlefield: ['Plains', 'Test Slow Filter'] }, defs: DEFS });
    expect(activations(s, 'Test Slow Filter')).toHaveLength(1);
    // {2} with a Plains and the filter: the filter can't help while the spell is on the stack (CR 601.2a, 602.5d)
    expect(castable(s, 'Test Two')).toBe(false);
  });
});

describe('CR 602.5b, 605.1a: "Activate only if" restrictions of mana lands (the Verges, the Gathering Place family)', () => {
  it("a Verge's {W} needs a Plains or a Swamp: without one {W} can't be paid; with a Swamp the Verge pays it", () => {
    const s = scenario([], { p1: { hand: ['Test White'], battlefield: ['Test Verge'] }, defs: DEFS });
    expect(castable(s, 'Test White')).toBe(false);
    expect(activations(s, 'Test Verge')).toHaveLength(1); // only {T}: Add {B}
    const t = scenario(['Swamp'], { p1: { hand: ['Test White'], battlefield: ['Test Verge', { name: 'Swamp', tapped: true }] }, defs: DEFS });
    expect(activations(t, 'Test Verge')).toHaveLength(2);
    const u = answer(cast(t, 'Test White'), { kind: 'payCost', auto: true });
    expect(onStack(u, 'Test White')).toBe(true);
    expect(tapped(u, 'Test Verge')).toBe(true);
  });

  it('"if this land entered this turn or if you control a basic land": an old Gathering Place alone makes only {C}', () => {
    const s = scenario([], { p1: { hand: ['Test Green'], battlefield: ['Test Gathering'] }, defs: DEFS });
    expect(castable(s, 'Test Green')).toBe(false);
    expect(activations(s, 'Test Gathering')).toHaveLength(1);
  });

  it('with a basic land it makes {G}; and the turn it entered it makes {G} without one (CR 400.7: a new object)', () => {
    const basic = scenario([], { p1: { hand: ['Test Green'], battlefield: ['Test Gathering', { name: 'Plains', tapped: true }] }, defs: DEFS });
    expect(castable(basic, 'Test Green')).toBe(true);
    const s = scenario([], { p1: { hand: ['Test Green', 'Test Gathering'] }, defs: DEFS });
    const t = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Gathering', 'hand', 'p1') });
    expect(castable(t, 'Test Green')).toBe(true);
    const u = answer(cast(t, 'Test Green'), { kind: 'payCost', auto: true });
    expect(onStack(u, 'Test Green')).toBe(true);
  });
});

describe('CR 118.3, 602.5b: a mana ability that removes counters, once each turn (Ramos, Dragon Engine)', () => {
  it('with two +1/+1 counters it is offered, removes them, adds {R}{R}; a second activation the same turn is refused', () => {
    const s = scenario([], { p1: { battlefield: [{ name: 'Test Engine', counters: { '+1/+1': 4 } }] }, defs: DEFS });
    expect(activations(s, 'Test Engine')).toHaveLength(1);
    const t = activate(s, 'Test Engine');
    expect(pool(t, 'p1')).toBe('RR');
    expect(t.objects[find(t, 'Test Engine', 'battlefield')]!.counters['+1/+1']).toBe(2);
    expect(activations(t, 'Test Engine')).toEqual([]);
  });

  it('without enough counters it is not offered (CR 118.3)', () => {
    const s = scenario([], { p1: { battlefield: [{ name: 'Test Engine', counters: { '+1/+1': 1 } }] }, defs: DEFS });
    expect(activations(s, 'Test Engine')).toEqual([]);
  });
});
