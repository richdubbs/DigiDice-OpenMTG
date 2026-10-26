/**
 * Precon lane pc-zones, round pc-zones-1 (library and graveyard moves), played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the
 * cloud checkout).
 *
 *   CR 401.3, 400.3        "Put target nonland historic permanent into its owner's library fourth from the top.": the fourth card from the top of its OWNER's library; a land and a
 *                          plain creature are no targets
 *   CR 401.3, 107.3        "Put target nonland permanent into its owner's library just beneath the top X cards of that library.": X cards stay above it (X = 0 puts it on top)
 *   CR 701.20a-b, 401.1    "Reveal cards from the top of your library until you reveal a nonland card, then put all cards revealed this way into your hand.": the card it stopped
 *                          at and every card above it, none below; a library of lands only reveals it all
 *   CR 701.20e, 608.2c-d   "Put up to three enchantment cards from among them into your hand and the rest of the revealed cards into your graveyard.": at most three, the rest all
 *   CR 701.24a, 400.3, 121.1 "The owner of target nonland permanent shuffles it into their library, then draws two cards.": the OWNER (not the caster) shuffles and draws
 *   CR 701.20a, 608.2c     "... You may put that card onto the battlefield. Then put all cards revealed this way that weren't put onto the battlefield on the bottom of your library
 *                          in a random order.": a card not put stays among the cards that go to the bottom
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, pass, reject, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const zoneOf = (s: GameState, id: ObjectId): string => s.objects[id]?.zone ?? 'gone';
const namesIn = (s: GameState, zone: 'hand' | 'graveyard' | 'library', who: PlayerId): string[] => s.zones[zone][who]!.map((id) => s.objects[id]!.defId);

/** Answer every decision: yes/no by `yes`, objects by `pick`, targets in order from `targets`, X by `x`, mana automatically. */
function drive(s0: GameState, o: { yes?: boolean; x?: number; pick?: (options: ObjectId[]) => ObjectId[]; targets?: ObjectId[][] } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: o.x ?? p.min });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options) : p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (tq.shift() ?? []).map((id) => ({ kind: 'object' as const, id })) });
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

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const FOREST = card('Test Grove', 'Land — Forest', '');
const RELIC = card('Test Relic', 'Artifact', '');
const AURA = card('Test Boon', 'Enchantment', '');
const LEGEND = card('Test Legend', 'Legendary Creature — Elf', '', { pt: ['1', '1'] });

// ---- CR 401.3: "fourth from the top" ------------------------------------------------------------------------------------------------------------------------

describe('CR 401.3, 400.3: "Put target nonland historic permanent into its owner\'s library fourth from the top."', () => {
  const FATE = card('Test Fate', 'Sorcery', "Put target nonland historic permanent into its owner's library fourth from the top.");
  const defs = [FATE, BEAR, FOREST, RELIC, LEGEND];
  it('is fully automated', () => expect(full(FATE)).toBe(true));
  it('an opponent\'s artifact goes to the fourth place from the top of ITS OWNER\'S library: three cards stay above it', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Fate'] }, p2: { battlefield: [{ name: 'Test Relic', since: 1 }], library: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] } });
    const relic = find(s, 'Test Relic', 'battlefield', 'p2');
    s = cast(s, 'Test Fate', { targets: [[relic]] });
    expect(zoneOf(s, relic)).toBe('gone'); // a new object in the library (CR 400.7)
    expect(namesIn(s, 'library', 'p2').slice(0, 5)).toEqual(['Test Bear', 'Test Bear', 'Test Bear', 'Test Relic', 'Test Bear']);
    expect(namesIn(s, 'library', 'p1')).not.toContain('Test Relic');
  });
  it('a legendary creature is historic: the same place; your own permanent goes to your library', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Fate'], battlefield: [{ name: 'Test Legend', since: 1 }], library: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] } });
    const legend = find(s, 'Test Legend', 'battlefield', 'p1');
    s = cast(s, 'Test Fate', { targets: [[legend]] });
    expect(namesIn(s, 'library', 'p1').slice(0, 4)).toEqual(['Test Bear', 'Test Bear', 'Test Bear', 'Test Legend']);
  });
  it('a plain creature and a land are not historic / not nonland: neither can be targeted', () => {
    const s = scenario([], { defs, p1: { hand: ['Test Fate'] }, p2: { battlefield: [{ name: 'Test Bear', since: 1 }, { name: 'Test Grove', since: 1 }] } });
    // no legal target exists: the cast is refused (CR 601.2c, 115.1)
    expect(reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Fate', 'hand', 'p1') }).message).toMatch(/no legal/);
  });
});

// ---- CR 401.3, 107.3: "just beneath the top X cards" ---------------------------------------------------------------------------------------------------------

describe('CR 401.3, 107.3: "Put target nonland permanent into its owner\'s library just beneath the top X cards of that library."', () => {
  const ABSENT = card('Test Absent', 'Instant', "Put target nonland permanent into its owner's library just beneath the top X cards of that library.", { cost: '{X}' });
  const defs = [ABSENT, BEAR, FOREST, RELIC];
  it('is fully automated', () => expect(full(ABSENT)).toBe(true));
  it('X = 2: two cards stay above it', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Absent'], battlefield: [{ name: 'Plains', since: 1 }, { name: 'Plains', since: 1 }] }, p2: { battlefield: [{ name: 'Test Relic', since: 1 }], library: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] } });
    const relic = find(s, 'Test Relic', 'battlefield', 'p2');
    s = cast(s, 'Test Absent', { x: 2, targets: [[relic]] });
    expect(namesIn(s, 'library', 'p2').slice(0, 4)).toEqual(['Test Bear', 'Test Bear', 'Test Relic', 'Test Bear']);
  });
  it('X = 0: it goes on top (nothing stays above it)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Absent'] }, p2: { battlefield: [{ name: 'Test Relic', since: 1 }], library: ['Test Bear', 'Test Bear'] } });
    const relic = find(s, 'Test Relic', 'battlefield', 'p2');
    s = cast(s, 'Test Absent', { x: 0, targets: [[relic]] });
    expect(namesIn(s, 'library', 'p2').slice(0, 2)).toEqual(['Test Relic', 'Test Bear']);
  });
  it('X = 5: five cards stay above it (the Plains the scenario adds below the scripted cards are below it)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Absent'], battlefield: [{ name: 'Plains', since: 1 }, { name: 'Plains', since: 1 }, { name: 'Plains', since: 1 }, { name: 'Plains', since: 1 }, { name: 'Plains', since: 1 }] }, p2: { battlefield: [{ name: 'Test Relic', since: 1 }], library: ['Test Bear', 'Test Bear'] } });
    const relic = find(s, 'Test Relic', 'battlefield', 'p2');
    s = cast(s, 'Test Absent', { x: 5, targets: [[relic]] });
    const lib = namesIn(s, 'library', 'p2');
    expect(lib.indexOf('Test Relic')).toBe(5);
    expect(lib.slice(0, 5).every((n) => n !== 'Test Relic')).toBe(true);
  });
});

// ---- CR 701.20a-b: reveal until, put all revealed into the hand ----------------------------------------------------------------------------------------------

describe('CR 701.20a-b, 401.1: "Reveal cards from the top of your library until you reveal a nonland card, then put all cards revealed this way into your hand."', () => {
  const HUNT = card('Test Hunt', 'Sorcery', 'Reveal cards from the top of your library until you reveal a nonland card, then put all cards revealed this way into your hand.');
  const defs = [HUNT, BEAR, FOREST, RELIC];
  it('is fully automated', () => expect(full(HUNT)).toBe(true));
  it('two lands then a creature: all three (the hit included) go to the hand; the card below stays in the library', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Hunt'], library: ['Test Grove', 'Test Grove', 'Test Bear', 'Test Relic', 'Test Relic'] } });
    s = cast(s, 'Test Hunt');
    expect(namesIn(s, 'hand', 'p1').sort()).toEqual(['Test Bear', 'Test Grove', 'Test Grove']);
    expect(namesIn(s, 'library', 'p1').slice(0, 2)).toEqual(['Test Relic', 'Test Relic']);
  });
  it('the first card is a nonland: only that card', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Hunt'], library: ['Test Relic', 'Test Grove', 'Test Bear'] } });
    s = cast(s, 'Test Hunt');
    expect(namesIn(s, 'hand', 'p1')).toEqual(['Test Relic']);
  });
  it('no nonland in the library (the scenario adds twenty Plains below the scripted cards): every card is revealed and put into the hand', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Hunt'], library: ['Test Grove', 'Test Grove', 'Test Grove'] } });
    s = cast(s, 'Test Hunt');
    expect(namesIn(s, 'hand', 'p1').length).toBe(23);
    expect(namesIn(s, 'library', 'p1')).toEqual([]);
  });
});

// ---- CR 701.20e: up to N from among the revealed cards, the rest into the graveyard --------------------------------------------------------------------------

describe('CR 701.20e, 608.2c-d: "Put up to two enchantment cards from among them into your hand and the rest of the revealed cards into your graveyard."', () => {
  const INSIGHT = card('Test Insight', 'Sorcery', 'Reveal the top five cards of your library. Put up to two enchantment cards from among them into your hand and the rest of the revealed cards into your graveyard.');
  const defs = [INSIGHT, BEAR, FOREST, AURA];
  it('is fully automated', () => expect(full(INSIGHT)).toBe(true));
  it('three enchantments among five: two chosen go to the hand, the third and the others to the graveyard; the sixth card stays', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Insight'], library: ['Test Boon', 'Test Bear', 'Test Boon', 'Test Grove', 'Test Boon', 'Test Bear'] } });
    const sixth = s.zones.library['p1']![5]!;
    s = cast(s, 'Test Insight', { pick: (options) => options.slice(0, 2) });
    expect(namesIn(s, 'hand', 'p1')).toEqual(['Test Boon', 'Test Boon']);
    expect(namesIn(s, 'graveyard', 'p1').sort()).toEqual(['Test Bear', 'Test Boon', 'Test Grove', 'Test Insight']);
    expect(zoneOf(s, sixth)).toBe('library');
  });
  it('no enchantment: nothing to the hand, all five revealed cards go to the graveyard', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Insight'], library: ['Test Bear', 'Test Bear', 'Test Grove', 'Test Grove', 'Test Bear', 'Test Boon'] } });
    s = cast(s, 'Test Insight');
    expect(namesIn(s, 'hand', 'p1')).toEqual([]);
    expect(namesIn(s, 'graveyard', 'p1').length).toBe(6); // five cards and the spell
    expect(namesIn(s, 'library', 'p1').slice(0, 2)).toEqual(['Test Boon', 'Plains']);
  });
});

// ---- CR 701.24a, 400.3, 121.1: the owner shuffles and draws -------------------------------------------------------------------------------------------------

describe('CR 701.24a, 400.3, 121.1: "The owner of target nonland permanent shuffles it into their library, then draws two cards."', () => {
  const OBL = card('Test Oblation', 'Instant', 'The owner of target nonland permanent shuffles it into their library, then draws two cards.');
  const defs = [OBL, BEAR, RELIC];
  it('is fully automated', () => expect(full(OBL)).toBe(true));
  it('an opponent\'s permanent: ITS OWNER (the opponent) gets it in their library and draws two cards; the caster draws nothing', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Oblation'] }, p2: { battlefield: [{ name: 'Test Relic', since: 1 }], library: ['Test Bear', 'Test Bear', 'Test Bear'] } });
    const relic = find(s, 'Test Relic', 'battlefield', 'p2');
    const handBefore = namesIn(s, 'hand', 'p1').length - 1; // the spell leaves the hand
    const p2Hand = namesIn(s, 'hand', 'p2').length;
    s = cast(s, 'Test Oblation', { targets: [[relic]] });
    expect(zoneOf(s, relic)).toBe('gone'); // a new object in the library (CR 400.7)
    expect(namesIn(s, 'library', 'p2')).toContain('Test Relic');
    expect(namesIn(s, 'library', 'p1')).not.toContain('Test Relic');
    expect(namesIn(s, 'hand', 'p2').length).toBe(p2Hand + 2);
    expect(namesIn(s, 'hand', 'p1').length).toBe(handBefore);
  });
  it('a permanent you own but an opponent controls would be shuffled into YOUR library and YOU draw (the owner, not the controller)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Oblation'], library: ['Test Bear', 'Test Bear', 'Test Bear'] }, p2: { battlefield: [{ name: 'Test Relic', since: 1 }] } });
    const relic = find(s, 'Test Relic', 'battlefield', 'p2');
    s.objects[relic]!.owner = 'p1'; // an object p1 owns, p2 controls
    const hand = namesIn(s, 'hand', 'p1').length - 1;
    s = cast(s, 'Test Oblation', { targets: [[relic]] });
    expect(namesIn(s, 'library', 'p1')).toContain('Test Relic');
    expect(namesIn(s, 'library', 'p2')).not.toContain('Test Relic');
    expect(namesIn(s, 'hand', 'p1').length).toBe(hand + 2);
  });
});

// ---- Genesis Storm's body: the card not put stays among the cards that go to the bottom ------------------------------------------------------------------------

describe('CR 701.20a, 608.2c: "Reveal cards ... until you reveal a nonland permanent card. You may put that card onto the battlefield. Then put all cards revealed this way that weren\'t put onto the battlefield on the bottom of your library in a random order."', () => {
  const STORM = card('Test Storm', 'Sorcery', "Reveal cards from the top of your library until you reveal a nonland permanent card. You may put that card onto the battlefield. Then put all cards revealed this way that weren't put onto the battlefield on the bottom of your library in a random order.");
  const defs = [STORM, BEAR, FOREST, RELIC];
  it('is fully automated', () => expect(full(STORM)).toBe(true));
  it('put: the permanent enters, the lands above it go to the bottom, nothing else changes', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Storm'], library: ['Test Grove', 'Test Grove', 'Test Bear', 'Plains', 'Plains'] } });
    s = cast(s, 'Test Storm', { yes: true });
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Bear' && s.objects[id]!.controller === 'p1')).toBe(true);
    const lib = namesIn(s, 'library', 'p1');
    expect(lib.slice(0, 22).every((n) => n === 'Plains')).toBe(true);
    expect(lib.slice(22).sort()).toEqual(['Test Grove', 'Test Grove']);
  });
  it('not put (the player declines): the permanent card goes to the bottom with the others', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Storm'], library: ['Test Grove', 'Test Grove', 'Test Bear', 'Plains', 'Plains'] } });
    s = cast(s, 'Test Storm', { yes: false });
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Bear')).toBe(false);
    const lib = namesIn(s, 'library', 'p1');
    expect(lib.slice(0, 22).every((n) => n === 'Plains')).toBe(true);
    expect(lib.slice(22).sort()).toEqual(['Test Bear', 'Test Grove', 'Test Grove']);
  });
});
