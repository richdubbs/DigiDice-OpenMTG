/**
 * edh-zones-21 (Commander lane edh-zones): the round's readings played through the engine with synthetic cards (invented names, design 6.10). CR cites checked against the
 * 2026-09-25 text (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt).
 *
 *   CR 401.4, 400.3, 608.2d   "For each <group>, its owner puts it on their choice of the top or bottom of their library." (Aetherspouts): every owner decides for each of their own
 *                             cards, then arranges the cards they sent to one end in any order
 *   CR 305.1, 603.2c, 603.6a, 603.2h   "Whenever one or more lands enter under an opponent's control without being played, you may search your library for a Plains card, put it
 *                             onto the battlefield tapped, then shuffle. Do this only once each turn." (Deep Gnome Terramancer)
 */
import { describe, expect, it } from 'vitest';
import { put, advanceTo, pass, answer } from '../../m3/scenario';
import type { GameState, PlayerId } from '../../../src/index';
import { act, card, cast, find, full, obj, passBoth, resolveAll, scenario } from '../r3-cost/support';
import { getChars } from '../../../src/rules/characteristics';

const nameOf = (s: GameState, id: string): string => getChars(s, id).name;
const setLibrary = (s: GameState, p: PlayerId, libNames: string[]): void => {
  for (const id of s.zones.library[p]!) delete s.objects[id];
  s.zones.library[p] = [];
  for (const n of libNames) put(s, p, 'library', n);
};
const libNames = (s: GameState, p: PlayerId): string[] => s.zones.library[p]!.map((id) => nameOf(s, id));
const bfNames = (s: GameState, p: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => nameOf(s, id)).sort();
const GOD = 'Test Spouts';
const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const WOLF = card('Test Wolf', 'Creature — Wolf', '', '{0}', ['2', '2']);
const OWL = card('Test Owl', 'Creature — Bird', '', '{0}', ['1', '1']);
const HAWK = card('Test Hawk', 'Creature — Bird', '', '{0}', ['1', '1']);
const FOREST = card('Test Grove', 'Basic Land — Forest', '');

/** What each player answers, in order: `end` for the top-or-bottom questions, `order` (names, top first) for the arrangement of what one owner sent to one end. */
interface Plan { end: Record<string, 'top' | 'bottom'>; order?: string[][] }
/** Answers every decision of a resolution by the plan; the questions asked are returned too. */
function play(cast0: GameState, plan: Plan): { s: GameState; asked: string[] } {
  let s = passBoth(cast0); // the spell resolves
  const asked: string[] = [];
  const orders = [...(plan.order ?? [])];
  for (let i = 0; i < 40 && s.pending && s.pending.kind !== 'priority'; i++) {
    const p = s.pending;
    if (p.kind === 'chooseOption') {
      // the prompt names the card: "Put <name> on the top or the bottom of your library?"
      const m = /^Put (.+) on the top or the bottom/.exec(p.prompt ?? '')!;
      asked.push(`${p.player}:${m[1]}`);
      s = answer(s, { kind: 'chooseOption', ids: [plan.end[m[1]!] ?? 'top'] });
    } else if (p.kind === 'order') {
      const want = orders.shift();
      asked.push(`${p.player}:order(${p.items.map((x) => x.label).sort().join('+')})`);
      s = answer(s, { kind: 'order', ids: want ? want.map((n) => p.items.find((x) => x.label === n)!.id) : p.items.map((x) => x.id) });
    } else throw new Error(`unexpected decision ${p.kind}`);
  }
  return { s, asked };
}

describe('"For each <group>, its owner puts it on their choice of the top or bottom of their library." (CR 401.4, 400.3; Aetherspouts)', () => {
  const SPOUTS = card(GOD, 'Instant', 'For each creature, its owner puts it on their choice of the top or bottom of their library.', '{0}');
  const defs = [SPOUTS, BEAR, WOLF, OWL, HAWK, FOREST];
  const start = (): GameState => {
    const s = scenario([], { p1: { hand: [GOD], battlefield: ['Test Bear', 'Test Wolf'] }, p2: { battlefield: ['Test Owl', 'Test Hawk'] }, defs });
    setLibrary(s, 'p1', ['Test Grove']);
    setLibrary(s, 'p2', ['Test Grove']);
    return s;
  };
  it('has no manual part', () => expect(full(SPOUTS)).toBe(true));
  it("each owner decides for each of their own cards, the creatures of all players go to their OWNERS' libraries, and nothing else moves", () => {
    const s0 = start();
    const { s, asked } = play(cast(s0, GOD), { end: { 'Test Bear': 'top', 'Test Wolf': 'bottom', 'Test Owl': 'bottom', 'Test Hawk': 'bottom' }, order: [['Test Hawk', 'Test Owl']] });
    expect(asked.filter((a) => a.startsWith('p1:Test'))).toEqual(['p1:Test Bear', 'p1:Test Wolf']);
    expect(asked.filter((a) => a.startsWith('p2:Test'))).toEqual(['p2:Test Owl', 'p2:Test Hawk']);
    expect(bfNames(s, 'p1')).toEqual([]);
    expect(bfNames(s, 'p2')).toEqual([]);
    expect(libNames(s, 'p1')).toEqual(['Test Bear', 'Test Grove', 'Test Wolf']);
    // p2 sent both creatures to the bottom and arranged them: the hawk above the owl (CR 401.4)
    expect(libNames(s, 'p2')).toEqual(['Test Grove', 'Test Hawk', 'Test Owl']);
  });
  it("a creature goes to its OWNER's library and its owner decides, whoever controls it (CR 400.3)", () => {
    const s0 = scenario([], { p1: { hand: [GOD], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Owl'] }, defs });
    setLibrary(s0, 'p1', ['Test Grove']);
    setLibrary(s0, 'p2', ['Test Grove']);
    s0.objects[find(s0, 'Test Owl', 'battlefield', 'p2')]!.controller = 'p1'; // p1 controls p2's Owl
    const { s, asked } = play(cast(s0, GOD), { end: { 'Test Bear': 'top', 'Test Owl': 'bottom' } });
    expect(asked).toEqual(['p1:Test Bear', 'p2:Test Owl']);
    expect(libNames(s, 'p1')).toEqual(['Test Bear', 'Test Grove']);
    expect(libNames(s, 'p2')).toEqual(['Test Grove', 'Test Owl']);
  });
  it('an owner who sends several cards to the same end arranges them in any order (CR 401.4): the order chosen is the order in the library', () => {
    const s0 = start();
    const { s, asked } = play(cast(s0, GOD), { end: { 'Test Bear': 'top', 'Test Wolf': 'top', 'Test Owl': 'top', 'Test Hawk': 'top' }, order: [['Test Wolf', 'Test Bear'], ['Test Owl', 'Test Hawk']] });
    expect(asked.filter((a) => a.includes('order('))).toEqual(['p1:order(Test Bear+Test Wolf)', 'p2:order(Test Hawk+Test Owl)']);
    expect(libNames(s, 'p1')).toEqual(['Test Wolf', 'Test Bear', 'Test Grove']);
    expect(libNames(s, 'p2')).toEqual(['Test Owl', 'Test Hawk', 'Test Grove']);
  });
  it('one card for an owner is not arranged (nothing to order), and a player with no creature is asked nothing', () => {
    const s0 = scenario([], { p1: { hand: [GOD], battlefield: ['Test Bear'] }, p2: {}, defs });
    setLibrary(s0, 'p1', ['Test Grove']);
    const { s, asked } = play(cast(s0, GOD), { end: { 'Test Bear': 'bottom' } });
    expect(asked).toEqual(['p1:Test Bear']);
    expect(libNames(s, 'p1')).toEqual(['Test Grove', 'Test Bear']);
  });
  it('a land is not a creature: it stays', () => {
    const s0 = scenario([], { p1: { hand: [GOD], battlefield: ['Test Bear', 'Test Grove'] }, p2: {}, defs });
    setLibrary(s0, 'p1', []);
    const { s } = play(cast(s0, GOD), { end: {} });
    expect(bfNames(s, 'p1')).toEqual(['Test Grove']);
    expect(libNames(s, 'p1')).toEqual(['Test Bear']);
  });
});

describe('"Whenever one or more lands enter under an opponent\'s control without being played, you may search your library for a Plains card, put it onto the battlefield tapped, then shuffle. Do this only once each turn." (CR 305.1, 603.2h; Deep Gnome Terramancer)', () => {
  const GNOME = card('Test Gnome', 'Creature — Gnome', "Whenever one or more lands enter under an opponent's control without being played, you may search your library for a Plains card, put it onto the battlefield tapped, then shuffle. Do this only once each turn.", '{0}', ['2', '2']);
  const DIG = card('Test Dig', 'Instant', 'Return target land card from your graveyard to the battlefield.', '{0}');
  const defs = [GNOME, DIG, FOREST];
  it('has no manual part', () => expect(full(GNOME)).toBe(true));
  /** p1's turn: p1 passes, p2 casts the instant with priority. */
  const p2Casts = (s0: GameState): GameState => cast(pass(s0), 'Test Dig', { targets: [[obj(find(s0, 'Test Grove', 'graveyard', 'p2'))]] }, 'p2');
  const start = (): GameState => {
    const s = scenario([], { p1: { battlefield: ['Test Gnome'] }, p2: { hand: ['Test Dig', 'Test Dig'], graveyard: ['Test Grove', 'Test Grove'] }, defs });
    setLibrary(s, 'p1', ['Test Grove', 'Plains', 'Plains']);
    return s;
  };
  it("an opponent's land put onto the battlefield by a spell triggers it: a Plains is fetched tapped under its controller", () => {
    const s0 = start();
    let s = resolveAll(p2Casts(s0), { yes: [true], objects: [[s0.zones.library.p1![1]!]] });
    expect(bfNames(s, 'p2')).toEqual(['Test Grove']);
    expect(bfNames(s, 'p1').filter((n) => n === 'Plains')).toEqual(['Plains']);
    const plains = s.zones.battlefield.find((id) => s.objects[id]!.controller === 'p1' && nameOf(s, id) === 'Plains')!;
    expect(s.objects[plains]!.tapped).toBe(true);
    expect(s.pending?.kind).toBe('priority');
  });
  it('"you may": declining fetches nothing', () => {
    const s = resolveAll(p2Casts(start()), { yes: [false] });
    expect(bfNames(s, 'p1')).toEqual(['Test Gnome']);
  });
  it('do this only once each turn (CR 603.2h): the second land of the turn triggers again but fetches nothing', () => {
    const s0 = start();
    let s = resolveAll(p2Casts(s0), { yes: [true], objects: [[s0.zones.library.p1![1]!]] });
    const second = find(s, 'Test Grove', 'graveyard', 'p2');
    s = resolveAll(cast(s.pending!.player === 'p1' ? pass(s) : s, 'Test Dig', { targets: [[obj(second)]] }, 'p2'), { yes: [true], objects: [[s.zones.library.p1![0]!]] });
    expect(bfNames(s, 'p2')).toEqual(['Test Grove', 'Test Grove']);
    expect(bfNames(s, 'p1').filter((n) => n === 'Plains')).toEqual(['Plains']);
  });
  it('the action counts only when taken (CR 603.2h): declining the first time leaves the second land its fetch', () => {
    const s0 = start();
    let s = resolveAll(p2Casts(s0), { yes: [false] });
    expect(bfNames(s, 'p1').filter((n) => n === 'Plains')).toEqual([]);
    const second = find(s, 'Test Grove', 'graveyard', 'p2');
    s = resolveAll(cast(s.pending!.player === 'p1' ? pass(s) : s, 'Test Dig', { targets: [[obj(second)]] }, 'p2'), { yes: [true], objects: [[s.zones.library.p1![1]!]] });
    expect(bfNames(s, 'p1').filter((n) => n === 'Plains')).toEqual(['Plains']);
  });
  it('a nonland permanent is not a land: the reading is for lands only (a spell that resolves was played, CR 701.18b)', () => {
    expect(full(card('Test Wary', 'Creature — Gnome', "Whenever a creature enters under an opponent's control without being played, draw a card.", '{0}', ['1', '1']))).toBe(false);
  });
  it("the negative cases: a land the opponent PLAYS does not trigger it (CR 305.1), and neither does a land that enters under its own controller's control", () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Gnome'] }, p2: { hand: ['Test Grove'] }, defs });
    let s = advanceTo(s0, 2, 'main1');
    s = act(s, { type: 'playLand', player: 'p2', card: find(s, 'Test Grove', 'hand', 'p2') });
    expect(s.zones.stack.length).toBe(0);
    expect(bfNames(s, 'p1')).toEqual(['Test Gnome']);
    const own = scenario([], { p1: { battlefield: ['Test Gnome'], hand: ['Test Dig'], graveyard: ['Test Grove'] }, p2: {}, defs });
    const cast1 = cast(own, 'Test Dig', { targets: [[obj(find(own, 'Test Grove', 'graveyard', 'p1'))]] });
    const after = passBoth(cast1); // the spell resolves; a trigger would now be on the stack
    expect(bfNames(after, 'p1')).toEqual(['Test Gnome', 'Test Grove']);
    expect(after.zones.stack.length).toBe(0);
    expect(after.pending?.kind).toBe('priority');
  });
});
