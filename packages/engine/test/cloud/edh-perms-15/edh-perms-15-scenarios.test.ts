/**
 * Commander lane edh-perms, round edh-perms-15: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default
 * compiler. Alice (p1) is the active player. CR cites checked against the Comprehensive Rules of 2026-09-25 (see the round's record).
 *
 *   CR 122.1, 608.2d  "Choose a counter on target permanent or player. Give that permanent or player another counter of that kind."
 *   CR 122.1, 608.2c  "Put a +1/+1 counter on it if it's a creature and a loyalty counter on it if it's a planeswalker."
 *   CR 702.122a       "~ crews Vehicles as though its power were N greater" (crew costs only, never a saddle cost)
 *   CR 608.2h  "Draw cards equal to the sacrificed creature's toughness, then discard cards equal to its power."
 *   CR 603.2, 701.21a "sacrifice it and create that many Treasure tokens": the amount of the damage, not a count of the sacrifice
 *   CR 701.36a, 111.1 "Populate. The token created this way gains haste."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, mpScenario, resolveStack } from '../../m12/rules/helpers';
import { act as act3, answer as answer3, find as find3, legal, pass, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; loyalty?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}), ...(opts.loyalty ? { loyalty: opts.loyalty } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';

const SPINNER = card('Test Spinner', 'Sorcery', 'Choose a counter on target permanent. Put an additional counter of that kind on that permanent.');
const MODULE = card('Test Module', 'Sorcery', 'Choose a counter on target permanent or player. Give that permanent or player another counter of that kind.');
const SORTER = card('Test Sorter', 'Sorcery', "Choose target permanent. Put a +1/+1 counter on it if it's a creature and a loyalty counter on it if it's a planeswalker.");
const GIANT = card('Test Giant', 'Creature — Giant', '', { pt: ['3', '3'] });
const WALKER = card('Test Walker', 'Planeswalker — Test', '', { loyalty: '3' });
const ROD = card('Test Rod', 'Artifact', '');
const DEFS = [SPINNER, MODULE, SORTER, GIANT, WALKER, ROD];

type Z = Partial<Record<'hand' | 'battlefield' | 'graveyard', string[]>>;
const game = (spell: string, zones: Partial<Record<PlayerId, Z>>, setup?: (s: GameState) => void, defs: CardDef[] = DEFS): GameState =>
  mpScenario({ players: 3, defs, zones: { ...zones, p1: { ...(zones.p1 ?? {}), hand: [spell, ...(zones.p1?.hand ?? [])] } }, ...(setup ? { setup } : {}) });

/** Alice casts `name` at `target`; `pick` is the label of the counter kind she chooses when asked. Returns the state and whether a kind was asked. */
function cast(s0: GameState, name: string, target: TargetChoice | undefined, pick?: string): { s: GameState; asked: boolean } {
  let t = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  let asked = false;
  for (let i = 0; i < 100 && (t.zones.stack.length > 0 || (t.pending && t.pending.kind !== 'priority')); i++) {
    if (t.pending?.kind === 'priority') { t = act(t, { type: 'pass', player: t.pending.player }); continue; }
    const p = t.pending!;
    if (p.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: target === undefined ? [] : [target] });
    else if (p.kind === 'chooseOption') {
      asked = true;
      const o = p.options.find((x) => x.label === pick);
      if (!o) throw new Error(`no option ${pick} among ${p.options.map((x) => x.label).join(', ')}`);
      t = answer(t, { kind: 'chooseOption', ids: [o.id] });
    } else throw new Error(`unexpected decision ${p.kind}: ${p.prompt}`);
  }
  return { s: resolveStack(t), asked };
}
const obj = (id: string): TargetChoice => ({ kind: 'object', id });

describe('design 6.9: the round\'s test cards compile fully', () => {
  it('every spell is fully automated', () => { for (const d of [SPINNER, MODULE, SORTER]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true); });
});

describe('CR 122.1, 608.2d: "Choose a counter on target permanent. Put an additional counter of that kind on that permanent."', () => {
  it('with two kinds on it the caster chooses one, and only that kind gets another counter', () => {
    const s0 = game('Test Spinner', { p2: { battlefield: ['Test Giant'] } }, (s) => { const g = Object.values(s.objects).find((o) => s.defs[o.defId]?.name === 'Test Giant')!; g.counters = { '+1/+1': 1, charge: 2 }; });
    const giant = find(s0, 'Test Giant', 'battlefield', 'p2');
    const { s, asked } = cast(s0, 'Test Spinner', obj(giant), 'charge');
    expect(asked).toBe(true);
    expect(s.objects[giant]!.counters).toEqual({ '+1/+1': 1, charge: 3 });
  });
  it('choosing the other kind gives that one instead', () => {
    const s0 = game('Test Spinner', { p2: { battlefield: ['Test Giant'] } }, (s) => { const g = Object.values(s.objects).find((o) => s.defs[o.defId]?.name === 'Test Giant')!; g.counters = { '+1/+1': 1, charge: 2 }; });
    const giant = find(s0, 'Test Giant', 'battlefield', 'p2');
    const { s } = cast(s0, 'Test Spinner', obj(giant), '+1/+1');
    expect(s.objects[giant]!.counters).toEqual({ '+1/+1': 2, charge: 2 });
  });
  it('one kind only: nothing to choose, no question, one more counter of it', () => {
    const s0 = game('Test Spinner', { p2: { battlefield: ['Test Giant'] } }, (s) => { const g = Object.values(s.objects).find((o) => s.defs[o.defId]?.name === 'Test Giant')!; g.counters = { charge: 1 }; });
    const giant = find(s0, 'Test Giant', 'battlefield', 'p2');
    const { s, asked } = cast(s0, 'Test Spinner', obj(giant));
    expect(asked).toBe(false);
    expect(s.objects[giant]!.counters).toEqual({ charge: 2 });
  });
  it('a permanent with no counters: no counter can be chosen, so none is put (and nothing is left to settle by hand)', () => {
    const s0 = game('Test Spinner', { p2: { battlefield: ['Test Giant'] } });
    const giant = find(s0, 'Test Giant', 'battlefield', 'p2');
    const { s, asked } = cast(s0, 'Test Spinner', obj(giant));
    expect(asked).toBe(false);
    expect(Object.values(s.objects[giant]!.counters).reduce((a, b) => a + b, 0)).toBe(0);
    expect(s.pending?.kind === 'priority' || s.pending === undefined || s.pending === null).toBe(true);
  });
  it('a group as the holder is not automated (only one holder is read)', () => {
    expect(full(card('Test Wheel', 'Artifact', '{0}: Choose a counter on each creature you control. Put an additional counter of that kind on each creature you control.'))).toBe(false);
  });
  it('a permanent source resolving twice: the kind chosen the first time is not read when the second finds no counters', () => {
    const WHEEL = card('Test Wheel', 'Artifact', '{0}: Choose a counter on target permanent. Put an additional counter of that kind on that permanent.');
    const s0 = scenario([], { p1: { battlefield: ['Test Wheel', 'Test Giant', { name: 'Test Rod', counters: {} }] }, defs: [...DEFS, WHEEL] });
    const wheel = find3(s0, 'Test Wheel', 'battlefield');
    const giant = find3(s0, 'Test Giant', 'battlefield');
    const rod = find3(s0, 'Test Rod', 'battlefield');
    s0.objects[giant]!.counters = { charge: 1 };
    const run = (s: GameState, target: ObjectId): GameState => {
      let t = act3(s, activations(s, wheel)[0]!.action);
      for (let g = 0; (t.zones.stack.length > 0 || (t.pending && t.pending.kind !== 'priority')) && g < 20; g++) {
        if (t.pending?.kind === 'priority') t = pass(t);
        else if (t.pending?.kind === 'chooseTargets') t = answer3(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: target }] });
        else if (t.pending?.kind === 'payCost') t = answer3(t, { kind: 'payCost', auto: true });
        else throw new Error(`unexpected ${t.pending?.kind}`);
      }
      return t;
    };
    const s1 = run(s0, giant);
    expect(s1.objects[giant]!.counters).toEqual({ charge: 2 });
    const s2 = run(s1, rod);
    expect(s2.objects[rod]!.counters).toEqual({});
  });
});

describe('CR 122.1, 115.1: "Choose a counter on target permanent or player. Give that permanent or player another counter of that kind."', () => {
  it('a player target: the kinds of counter that player has (energy here) are chosen from, and the player gets another', () => {
    const s0 = game('Test Module', {}, (s) => { s.players.find((p) => p.id === 'p2')!.counters = { energy: 2 }; });
    const { s } = cast(s0, 'Test Module', { kind: 'player', id: 'p2' } as TargetChoice);
    expect(s.players.find((p) => p.id === 'p2')!.counters.energy).toBe(3);
  });
  it('a permanent target works the same', () => {
    const s0 = game('Test Module', { p3: { battlefield: ['Test Rod'] } }, (s) => { const g = Object.values(s.objects).find((o) => s.defs[o.defId]?.name === 'Test Rod')!; g.counters = { time: 4 }; });
    const rod = find(s0, 'Test Rod', 'battlefield', 'p3');
    const { s } = cast(s0, 'Test Module', obj(rod));
    expect(s.objects[rod]!.counters).toEqual({ time: 5 });
  });
  it('a player with no counters gets none', () => {
    const s0 = game('Test Module', {});
    const { s } = cast(s0, 'Test Module', { kind: 'player', id: 'p2' } as TargetChoice);
    expect(s.players.find((p) => p.id === 'p2')!.counters).toEqual({});
  });
});

describe('CR 122.1, 608.2c: "Put a +1/+1 counter on it if it\'s a creature and a loyalty counter on it if it\'s a planeswalker."', () => {
  it('a creature gets the +1/+1 counter and no loyalty counter', () => {
    const s0 = game('Test Sorter', { p2: { battlefield: ['Test Giant'] } });
    const giant = find(s0, 'Test Giant', 'battlefield', 'p2');
    const { s } = cast(s0, 'Test Sorter', obj(giant));
    expect(s.objects[giant]!.counters['+1/+1']).toBe(1);
    expect(s.objects[giant]!.counters['loyalty'] ?? 0).toBe(0);
  });
  it('a planeswalker gets the loyalty counter and no +1/+1 counter', () => {
    const s0 = game('Test Sorter', { p2: { battlefield: ['Test Walker'] } }, (st) => { const g = Object.values(st.objects).find((o) => st.defs[o.defId]?.name === 'Test Walker')!; g.counters = { loyalty: 3 }; });
    const w = find(s0, 'Test Walker', 'battlefield', 'p2');
    const { s } = cast(s0, 'Test Sorter', obj(w));
    expect(s.objects[w]!.counters['loyalty']).toBe(4);
    expect(s.objects[w]!.counters['+1/+1'] ?? 0).toBe(0);
  });
  it('an artifact that is neither gets nothing', () => {
    const s0 = game('Test Sorter', { p2: { battlefield: ['Test Rod'] } });
    const rod = find(s0, 'Test Rod', 'battlefield', 'p2');
    const { s } = cast(s0, 'Test Sorter', obj(rod));
    expect(s.objects[rod]!.counters).toEqual({});
  });
});

// ---- crew only (m3 scenario) ---------------------------------------------------------------------------------------------------------------------------
const PILOT = card('Test Pilot', 'Creature — Human Pilot', 'Test Pilot crews Vehicles as though its power were 2 greater.', { pt: ['1', '1'] });
const MOUSE = card('Test Mouse', 'Creature — Mouse', '', { pt: ['1', '1'] });
const CART = card('Test Cart', 'Artifact — Vehicle', 'Crew 3', { pt: ['4', '4'] });
const JAGUAR = card('Test Jaguar', 'Creature — Cat Mount', 'Saddle 3', { pt: ['2', '2'] });
const CREW_DEFS = [PILOT, MOUSE, CART, JAGUAR];

function settle(s0: GameState, picks: ObjectId[]): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    const k = s.pending.kind;
    if (k === 'chooseObjects') s = answer3(s, { kind: 'chooseObjects', ids: picks });
    else if (k === 'payCost') s = answer3(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}
const activations = (s: GameState, id: ObjectId) => legal(s, 'p1', 'activate').filter((a) => a.object === id && !a.isMana);

describe('CR 702.122a: "~ crews Vehicles as though its power were 2 greater."', () => {
  it('is fully automated', () => expect(full(PILOT)).toBe(true));
  it('a 1/1 Pilot crews a Crew 3 Vehicle alone (it counts 3)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Pilot', 'Test Cart'] }, defs: CREW_DEFS });
    const cart = find3(s0, 'Test Cart', 'battlefield');
    const pilot = find3(s0, 'Test Pilot', 'battlefield');
    expect(activations(s0, cart).length).toBe(1);
    let s = settle(act3(s0, activations(s0, cart)[0]!.action), [pilot]);
    for (let g = 0; s.zones.stack.length > 0 && g < 10; g++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s, []);
    expect(getChars(s, cart)!.types).toContain('Creature');
  });
  it('a plain 1/1 does not crew 3 (unchanged)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Mouse', 'Test Cart'] }, defs: CREW_DEFS });
    expect(activations(s0, find3(s0, 'Test Cart', 'battlefield'))).toEqual([]);
  });
  it('the bonus is for crew only: the Pilot alone does not saddle a Saddle 3 Mount (it counts 1 there)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Pilot', 'Test Jaguar'] }, defs: CREW_DEFS });
    expect(activations(s0, find3(s0, 'Test Jaguar', 'battlefield'))).toEqual([]);
  });
});

// ---- sacrificed creature's statistics, damage amount, populate (m3 scenario) -----------------------------------------------------------------------
const SAGE = card('Test Sage', 'Creature — Dwarf', "{T}, Sacrifice another creature: Draw cards equal to the sacrificed creature's toughness, then discard cards equal to its power.", { pt: ['1', '1'] });
const BRUTE = card('Test Brute', 'Creature — Ogre', '', { pt: ['2', '4'] });
const BARGE = card('Test Barge', 'Artifact Creature — Vehicle', 'Whenever ~ deals combat damage to a player, sacrifice it and create that many Treasure tokens.', { pt: ['3', '3'] });
const MIRROR = card('Test Mirror', 'Sorcery', 'Populate. The token created this way gains haste. Sacrifice it at the beginning of the next end step.');
const SPRITE = card('Test Sprite', 'Creature — Spirit', 'Flying', { pt: ['1', '1'] });
const MORE_DEFS = [SAGE, BRUTE, BARGE, MIRROR, SPRITE];

describe('CR 608.2h: "Draw cards equal to the sacrificed creature\'s toughness, then discard cards equal to its power."', () => {
  it('is fully automated', () => expect(full(SAGE)).toBe(true));
  it('a 2/4 sacrificed: draw four, then discard two (hand grows by two); the sacrificed creature is gone', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Sage', 'Test Brute'] }, defs: MORE_DEFS });
    const sage = find3(s0, 'Test Sage', 'battlefield');
    const brute = find3(s0, 'Test Brute', 'battlefield');
    const hand0 = s0.zones.hand['p1']!.length;
    let s = settle(act3(s0, activations(s0, sage)[0]!.action), [brute]);
    for (let g = 0; (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')) && g < 20; g++) {
      if (s.pending?.kind === 'priority') s = pass(s);
      else if (s.pending?.kind === 'chooseObjects') s = answer3(s, { kind: 'chooseObjects', ids: s.pending.options.slice(0, s.pending.min) });
      else s = settle(s, [brute]);
    }
    expect(s.zones.battlefield).not.toContain(brute);
    expect(s.zones.graveyard['p1']!.map((id) => s.defs[s.objects[id]!.defId]!.name)).toContain('Test Brute');
    expect(s.zones.hand['p1']!.length).toBe(hand0 + 4 - 2);
  });
});

describe('CR 603.2, 608.2h: "Whenever ~ deals combat damage to a player, sacrifice it and create that many Treasure tokens."', () => {
  it('is fully automated', () => expect(full(BARGE)).toBe(true));
  it('three damage: it is sacrificed and three Treasure tokens are created (the damage, not the one sacrifice)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Barge'] }, defs: MORE_DEFS });
    const barge = find3(s0, 'Test Barge', 'battlefield');
    let s = passUntil(declareAttackers(toDeclareAttackers(s0), [[barge]]), (x) => x.turn.step === 'endCombat' || x.turn.step === 'main2', 'end of combat');
    for (let g = 0; s.zones.stack.length > 0 && g < 10; g++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s, []);
    const treasures = s.zones.battlefield.filter((id) => getChars(s, id)!.subtypes.includes('Treasure'));
    expect(treasures.length).toBe(3);
    expect(s.zones.battlefield).not.toContain(barge);
    expect(s.zones.graveyard['p1']!.map((id) => s.defs[s.objects[id]!.defId]!.name)).toContain('Test Barge');
  });
});

describe('CR 701.36a, 111.1: "Populate. The token created this way gains haste. Sacrifice it at the beginning of the next end step."', () => {
  it('is fully automated', () => expect(full(MIRROR)).toBe(true));
  it('a token is copied and only the copy gains haste', () => {
    const s0 = scenario([], { p1: { hand: ['Test Mirror'], battlefield: ['Test Sprite'] }, defs: MORE_DEFS });
    const sprite = find3(s0, 'Test Sprite', 'battlefield');
    s0.objects[sprite]!.kind = 'token';
    const tokensBefore = s0.zones.battlefield.filter((id) => s0.objects[id]!.kind === 'token').length;
    let s = act3(s0, legal(s0, 'p1', 'cast').find((a) => a.object === find3(s0, 'Test Mirror', 'hand'))!.action);
    for (let g = 0; (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')) && g < 20; g++) {
      if (s.pending?.kind === 'priority') s = pass(s);
      else if (s.pending?.kind === 'payCost') s = answer3(s, { kind: 'payCost', auto: true });
      else if (s.pending?.kind === 'chooseObjects') s = answer3(s, { kind: 'chooseObjects', ids: s.pending.options.slice(0, s.pending.min) });
      else throw new Error(`unexpected ${s.pending?.kind}`);
    }
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens.length).toBe(tokensBefore + 1);
    const copy = tokens.find((id) => id !== sprite)!;
    const hasHaste = (id: ObjectId): boolean => JSON.stringify(getChars(s, id)!.abilities).toLowerCase().includes('haste');
    expect(hasHaste(copy)).toBe(true);
    expect(hasHaste(sprite)).toBe(false);
  });
  it('no creature token to copy: nothing is created and nothing is sacrificed', () => {
    const s0 = scenario([], { p1: { hand: ['Test Mirror'], battlefield: ['Test Sprite'] }, defs: MORE_DEFS }); // the Sprite is a card, not a token
    let s = act3(s0, legal(s0, 'p1', 'cast').find((a) => a.object === find3(s0, 'Test Mirror', 'hand'))!.action);
    for (let g = 0; (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')) && g < 20; g++) {
      if (s.pending?.kind === 'priority') s = pass(s);
      else if (s.pending?.kind === 'payCost') s = answer3(s, { kind: 'payCost', auto: true });
      else s = answer3(s, { kind: 'chooseObjects', ids: [] });
    }
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length).toBe(0);
    expect(s.zones.battlefield).toContain(find3(s0, 'Test Sprite', 'battlefield'));
  });
});
