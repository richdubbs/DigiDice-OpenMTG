/**
 * edh-zones-1 (Commander effort, lane edh-zones): the round's readings played through the engine with synthetic cards (invented names, design 6.10). CR cites from memory,
 * unverified.
 *
 *   CR 701.24a, 701.20a, 110.2a, 608.2c   "The owner of target permanent shuffles it into their library, then reveals the top card of their library. If it's a permanent card,
 *                                          they put it onto the battlefield.": the owner (not the caster) shuffles and reveals; a permanent card comes onto the battlefield under
 *                                          the owner's control; any other card stays on top; a token that is the target ceases to exist and its owner still reveals
 *   CR 205.3i, 701.23a                     "a land card with a basic land type": a land with Plains, Island, Swamp, Mountain or Forest among its land types, nothing else
 *   CR 608.2c, 109.5, 701.26b              "... and you untap all lands you control": the controller untaps their lands, the opponent's stay tapped
 *   CR 202.3, 406.1, 101.4                 "Each opponent exiles cards from the top of their library until that player has exiled cards with total mana value N or greater"
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { put } from '../../m3/scenario';
import { act, answer, card, cast, drive, full, obj, passBoth, resolveAll, scenario } from '../r5-cost/support';

const WARP = card('Test Warp Spell', 'Instant', "The owner of target permanent shuffles it into their library, then reveals the top card of their library. If it's a permanent card, they put it onto the battlefield.");
const MAKER = card('Test Token Maker', 'Sorcery', 'Create a 1/1 white Soldier creature token.');
const RELIC = card('Test Relic', 'Artifact', '', '{2}');
const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
const SPELL = card('Test Spell', 'Instant', '', '{1}');
const FETCH = card('Test Fetcher', 'Instant', 'Destroy target artifact an opponent controls. That player may search their library for a land card with a basic land type, put it onto the battlefield, then shuffle.');
const WASTE = card('Test Wasteland', 'Land', '');
const GATE = card('Test Gate', 'Land — Gate', '');
const DUAL = card('Test Dual', 'Land — Mountain Forest', '');
const UNTAPPER = card('Test Drain Spell', 'Sorcery', 'Target opponent discards a card and you untap all lands you control.');
const HOWL = card('Test Howl', 'Sorcery', 'Each opponent exiles cards from the top of their library until that player has exiled cards with total mana value 5 or greater.');
const TWO = card('Test Two', 'Artifact', '', '{2}');
const DEFS = [WARP, MAKER, RELIC, BEAR, SPELL, FETCH, WASTE, GATE, DUAL, UNTAPPER, HOWL, TWO];

const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => nameOf(s, id)).sort();
const bfNames = (s: GameState, p: 'p1' | 'p2'): string[] => names(s, s.zones.battlefield.filter((id) => s.objects[id]!.controller === p));
/** Replace a player's whole library (the scenario's filler Plains included) with the named cards, top first. */
function setLibrary(s: GameState, p: 'p1' | 'p2', libNames: string[]): void {
  for (const id of s.zones.library[p]!) delete s.objects[id];
  s.zones.library[p] = [];
  for (const n of libNames) put(s, p, 'library', n);
}

describe('the synthetic cards are automated', () => {
  it('play fully', () => { for (const d of [WARP, FETCH, UNTAPPER, HOWL]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true); });
});

describe('Chaos Warp reading (CR 701.24a, 701.20a, 110.2a): the owner shuffles and reveals, a permanent card comes onto the battlefield under their control', () => {
  it("an opponent's artifact: it goes to the opponent's library, THEY reveal their top card, a permanent card enters under THEIR control", () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Warp Spell'], library: ['Test Spell'] }, p2: { battlefield: ['Test Relic'] } });
    setLibrary(s, 'p1', ['Test Spell']);
    setLibrary(s, 'p2', ['Test Bear', 'Test Bear', 'Test Bear']); // every card a permanent card whatever the shuffle does
    const relic = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Relic')!;
    s = cast(s, 'Test Warp Spell', { targets: [[obj(relic)]] });
    s = resolveAll(s);
    expect(s.objects[relic]).toBeUndefined(); // the Relic left the battlefield (a new object in the library, CR 400.7)
    const onBf = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2');
    expect(onBf).toHaveLength(1); // exactly one card entered: the revealed top card
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1')).toHaveLength(0);
    expect(s.zones.library.p1).toHaveLength(1); // the caster's library was not touched
    expect(s.zones.library.p2!.length + onBf.length).toBe(4); // the three Bears and the Relic, one of them now on the battlefield
  });
  it("a card that is not a permanent card stays on top of the owner's library (the negative case): nothing enters", () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Warp Spell'] }, p2: { battlefield: ['Test Bear'] } });
    setLibrary(s, 'p2', ['Test Spell', 'Test Spell']);
    const bear = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Bear')!;
    s = cast(s, 'Test Warp Spell', { targets: [[obj(bear)]] });
    s = resolveAll(s);
    // the Bear is a permanent card in the shuffled library: if it ended on top it comes back; otherwise the top card is an instant and nothing enters
    const entered = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2');
    for (const id of entered) expect(nameOf(s, id)).toBe('Test Bear');
    expect(entered.length + s.zones.library.p2!.length).toBe(3);
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Spell')).toBe(false);
  });
  it("a permanent you own but an opponent controls: it goes to YOUR library, YOU shuffle and reveal, and a permanent card enters under YOUR control (the owner, not the controller)", () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Warp Spell'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Bear', 'Test Bear', 'Test Bear']);
    setLibrary(s, 'p2', ['Test Spell', 'Test Spell']);
    const relic = put(s, 'p1', 'battlefield', 'Test Relic');
    s.objects[relic]!.controller = 'p2';
    s = cast(s, 'Test Warp Spell', { targets: [[obj(relic)]] });
    s = resolveAll(s);
    expect(s.objects[relic]).toBeUndefined();
    expect(bfNames(s, 'p2')).toEqual([]); // nothing entered under the controller
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1')).toHaveLength(1); // the Relic or a Bear, whichever the shuffle put on top
    expect(s.zones.library.p1).toHaveLength(3); // four permanent cards in the library, one of them now on the battlefield
    expect(s.zones.library.p2).toHaveLength(2); // the opponent's library was never touched
  });
  it("your own token: it ceases to exist, YOU (its owner) reveal your top card; the opponent's library is never touched", () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Token Maker', 'Test Warp Spell'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Spell', 'Test Spell']);
    setLibrary(s, 'p2', ['Test Bear', 'Test Bear']);
    s = cast(s, 'Test Token Maker');
    s = resolveAll(s);
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(token).toBeDefined();
    s = cast(s, 'Test Warp Spell', { targets: [[obj(token)]] });
    s = resolveAll(s);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.id === token)).toBe(false);
    expect(s.zones.library.p1).toHaveLength(2); // the token did not go to the library (CR 111.7); the instants stay
    expect(bfNames(s, 'p2')).toEqual([]); // the opponent's Bears were not revealed: the owner is p1
    expect(s.zones.library.p2).toHaveLength(2);
  });
});

describe('"a land card with a basic land type" (CR 205.3i, 701.23a; Boseiju, Who Endures)', () => {
  it('the opponent may search for a Forest or a dual with a basic land type; a nonbasic land without one and a Gate are not found', () => {
    let s = scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Fetcher'] }, p2: { battlefield: ['Test Relic'] } });
    setLibrary(s, 'p2', ['Test Wasteland', 'Test Gate', 'Test Dual', 'Forest', 'Test Spell']);
    const relic = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Relic')!;
    s = act(s, { type: 'cast', player: 'p1', card: s.zones.hand.p1![0]! });
    s = drive(s, { targets: [[obj(relic)]] });
    s = passBoth(s);
    // resolution: destroy the Relic, then the controller (p2) is asked whether to search
    for (let i = 0; i < 8 && s.pending !== null && s.pending.kind === 'yesNo'; i++) s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.pending?.kind).toBe('chooseObjects');
    const p = s.pending as { kind: 'chooseObjects'; player: string; options: string[] };
    expect(p.player).toBe('p2');
    expect(names(s, p.options)).toEqual(['Forest', 'Test Dual']);
    s = answer(s, { kind: 'chooseObjects', ids: [p.options.find((id) => nameOf(s, id) === 'Test Dual')!] });
    s = drive(s);
    expect(bfNames(s, 'p2')).toEqual(['Test Dual']); // under the opponent's control, not the caster's
    expect(bfNames(s, 'p1')).toEqual([]);
  });
});

describe('"... and you untap all lands you control" (CR 608.2c, 701.26b)', () => {
  it("the opponent discards, YOUR lands untap and the opponent's stay tapped", () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Drain Spell'], battlefield: [{ name: 'Plains', tapped: true }, { name: 'Plains', tapped: true }] }, p2: { hand: ['Test Spell'], battlefield: [{ name: 'Plains', tapped: true }] } });
    s = cast(s, 'Test Drain Spell', { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = resolveAll(s);
    expect(s.zones.hand.p2).toHaveLength(0);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1').every((id) => !s.objects[id]!.tapped)).toBe(true);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2').every((id) => s.objects[id]!.tapped)).toBe(true);
  });
});

describe('"until that player has exiled cards with total mana value N or greater" (CR 202.3, 406.1, 101.4; port of p2-exile-play-2)', () => {
  it('exiles from the top until the exiled cards total 5: 2 + 2 + 2 = 6 stops after the third card; the caster library is untouched', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Howl'] }, p2: {} });
    setLibrary(s, 'p2', ['Test Two', 'Test Two', 'Test Two', 'Test Two', 'Test Two']);
    setLibrary(s, 'p1', ['Test Two', 'Test Two']);
    s = cast(s, 'Test Howl');
    s = resolveAll(s);
    expect(s.zones.exile.filter((id) => s.objects[id]!.owner === 'p2')).toHaveLength(3);
    expect(s.zones.library.p2).toHaveLength(2);
    expect(s.zones.library.p1).toHaveLength(2);
  });
  it('a library that never reaches the total: every card is exiled and the effect ends (nothing further happens)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Howl'] }, p2: {} });
    setLibrary(s, 'p2', ['Test Two', 'Test Two']); // total 4 < 5
    s = cast(s, 'Test Howl');
    s = resolveAll(s);
    expect(s.zones.exile.filter((id) => s.objects[id]!.owner === 'p2')).toHaveLength(2);
    expect(s.zones.library.p2).toHaveLength(0);
  });
});
