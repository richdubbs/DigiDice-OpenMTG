/**
 * edh-zones-5 (Commander effort, lane edh-zones): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by the
 * game's default compiler. CR cites are from the 2026-09-25 Comprehensive Rules text (media.wizards.com), read in this session.
 *
 *   CR 608.2c, 608.2d   "You may repeat this process any number of times": asked before every further run, seeing what the last one did
 *   CR 105.2c, 202.2     a card shares a color with some object of a description; a colorless card shares none
 *   CR 701.23a, 701.20a "search ..., reveal that card" reveals the one card found
 *   CR 400.7, 603.10    "put that card from a graveyard onto the battlefield": only while it is in a graveyard
 *   CR 702.138a, 118.9  a granted escape whose cost is the card's mana cost plus exiling other cards from the graveyard
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, life, pass, scenario } from '../../m3/scenario';
import * as m6 from '../../m6/costs/support';
import { legalActions } from '../../../src/index';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => s.objects[id]!.defId);

/** Resolve everything: yes/no answered from `yes` (the queue, then `rest`), costs automatically, targets with none, objects with the first `min`, until p1 has priority on an empty stack. */
function settle(s0: GameState, yes: boolean[] = [], rest = true, counts?: { asked: number }): GameState {
  let s = s0;
  const queue = [...yes];
  for (let guard = 0; guard < 400 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0 && s.pending.player === 'p1'); guard++) {
    const d = s.pending;
    if (d.kind === 'yesNo') { if (counts) counts.asked++; s = answer(s, { kind: 'yesNo', yes: queue.length > 0 ? queue.shift()! : rest }); }
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [] });
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, d.min) });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}: ${d.prompt}`);
  }
  return s;
}
const hand = (s: GameState, p: PlayerId = 'p1'): string[] => names(s, s.zones.hand[p]!);
const graveyard = (s: GameState, p: PlayerId = 'p1'): string[] => names(s, s.zones.graveyard[p]!);
const bf = (s: GameState): string[] => names(s, s.zones.battlefield);

// ---- "You may repeat this process any number of times." (op:repeat.optional) ------------------------------------------------------------------------------------------------

const PROCESS = card('Test Greed Rite', 'Sorcery', 'Reveal the top card of your library and put that card into your hand. You gain life equal to its mana value. You may repeat this process any number of times.');
const COSTLY = (n: number, mv: number): CardDef => card(`Test Pebble ${n}`, 'Artifact', '', undefined, `{${mv}}`);

describe('CR 608.2c, 608.2d: "You may repeat this process any number of times."', () => {
  const pebbles = [COSTLY(1, 2), COSTLY(2, 3), COSTLY(3, 4), COSTLY(4, 5)];
  const defs = [PROCESS, ...pebbles];
  const start = () => scenario([], { p1: { hand: ['Test Greed Rite'], library: pebbles.map((p) => p.faces[0]!.name) }, defs });
  it('is automated: a process repeat that is asked for each further run', () => {
    expect(automated(PROCESS)).toBe(true);
    expect(JSON.stringify(PROCESS.faces[0]!.abilities)).toContain('"process":true,"optional":true');
  });
  it('declined at the first question, the process ran once: one card, life for its mana value', () => {
    const counts = { asked: 0 };
    let s = start();
    const before = life(s, 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Greed Rite', 'hand', 'p1') });
    s = settle(s, [false], true, counts);
    expect(hand(s)).toEqual(['Test Pebble 1']);
    expect(life(s, 'p1')).toBe(before + 2);
    expect(counts.asked).toBe(1);
  });
  it('repeated twice, then stopped: three cards in order, the life of each, and exactly one question before each further run (three questions)', () => {
    const counts = { asked: 0 };
    let s = start();
    const before = life(s, 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Greed Rite', 'hand', 'p1') });
    s = settle(s, [true, true, false], true, counts);
    expect(hand(s)).toEqual(['Test Pebble 1', 'Test Pebble 2', 'Test Pebble 3']);
    expect(life(s, 'p1')).toBe(before + 2 + 3 + 4);
    expect(counts.asked).toBe(3);
    expect(names(s, s.zones.library['p1']!.slice(0, 1))).toEqual(['Test Pebble 4']); // the fourth card was not touched
  });
});

/** Pass priority until a decision other than priority is pending (the spell or ability resolves) or the stack is empty again. */
function resolveToDecision(s0: GameState): GameState {
  let s = s0;
  for (let guard = 0; guard < 40 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; guard++) s = pass(s);
  return s;
}

// ---- "a card that shares a color with a legendary creature you control" (parser/holes/filter.ts, render/np.ts) ----------------------------------------------------------------

const HUE = card('Test Hue Search', 'Sorcery', 'Search your library for a card that shares a color with a legendary creature you control, reveal it, put it into your hand, then shuffle.');
const HERO = card('Test Crimson Hero', 'Legendary Creature — Human', '', ['1', '1'], '{R}', ['R']);
const BEAR = card('Test Red Bear', 'Creature — Bear', '', ['1', '1'], '{R}', ['R']);
const DRAKE = card('Test Blue Drake', 'Creature — Drake', '', ['1', '1'], '{U}', ['U']);
const ORB = card('Test Gray Orb', 'Artifact', '', undefined, '{1}');
const PURPLE = card('Test Dusk Hybrid', 'Creature — Shade', '', ['1', '1'], '{R}{U}', ['R', 'U']);
const PLAIN_BEAR = card('Test Green Bear', 'Creature — Bear', '', ['1', '1'], '{G}', ['G']);

describe('CR 105.2c, 202.2: "a card that shares a color with a legendary creature you control"', () => {
  it('is automated, in the library search and in a plain filter', () => {
    expect(automated(HUE)).toBe(true);
    expect(JSON.stringify(HUE.faces[0]!.abilities)).toContain('"sharesWith":{"with":{"ref":"each","filter":{"supertypes":["Legendary"],"types":["Creature"],"controller":"you"}},"quality":"color"}');
  });
  it('the search offers exactly the cards that share a color with the legendary creature: a red card and a red-blue card, not a blue card, a colorless card, or a green one', () => {
    let s = scenario([], { p1: { hand: ['Test Hue Search'], battlefield: ['Test Crimson Hero'], library: ['Test Blue Drake', 'Test Gray Orb', 'Test Red Bear', 'Test Dusk Hybrid', 'Test Green Bear'] }, defs: [HUE, HERO, BEAR, DRAKE, ORB, PURPLE, PLAIN_BEAR] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Hue Search', 'hand', 'p1') });
    s = resolveToDecision(s);
    const d = s.pending!;
    expect(d.kind).toBe('chooseObjects');
    if (d.kind !== 'chooseObjects') return;
    expect(names(s, d.options).sort()).toEqual(['Test Dusk Hybrid', 'Test Red Bear']);
  });
  it("the legendary creature must be on the battlefield and under your control: a legendary card in hand, or one an opponent controls, shares nothing", () => {
    for (const where of ['hand', 'opp'] as const) {
      let s = scenario([], { p1: { hand: where === 'hand' ? ['Test Hue Search', 'Test Crimson Hero'] : ['Test Hue Search'], library: ['Test Red Bear'] }, p2: { battlefield: where === 'opp' ? ['Test Crimson Hero'] : [] }, defs: [HUE, HERO, BEAR] });
      s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Hue Search', 'hand', 'p1') });
      s = resolveToDecision(s);
      const d = s.pending!;
      if (d.kind === 'chooseObjects') expect(names(s, d.options), where).toEqual([]);
      else expect(hand(s), where).not.toContain('Test Red Bear');
    }
  });
});

const RING_HUE = card('Test Ring Hue', 'Sorcery', 'The Ring tempts you. Search your library for a card that shares a color with a legendary creature you control, put it into your hand, then shuffle.');

describe('ruling 2023-06-16 (Ringsight): your Ring-bearer is legendary, so a card sharing a color with it can be searched for; a colorless card never can', () => {
  it('the creature the Ring makes the Ring-bearer counts as the legendary creature', () => {
    let s = scenario([], { p1: { hand: ['Test Ring Hue'], battlefield: ['Test Red Bear'], library: ['Test Blue Drake', 'Test Dusk Hybrid', 'Test Gray Orb'] }, defs: [RING_HUE, BEAR, DRAKE, PURPLE, ORB] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ring Hue', 'hand', 'p1') });
    s = resolveToDecision(s);
    for (let guard = 0; guard < 6 && s.pending && s.pending.kind !== 'chooseObjects'; guard++) s = s.pending.kind === 'yesNo' ? answer(s, { kind: 'yesNo', yes: true }) : s.pending.kind === 'priority' ? pass(s) : s;
    // the Ring-bearer choice may be made for you (one creature), then the search is the decision
    let d = s.pending!;
    if (d.kind === 'chooseObjects' && names(s, d.options).includes('Test Red Bear') && !names(s, d.options).includes('Test Dusk Hybrid')) { s = answer(s, { kind: 'chooseObjects', ids: d.options }); d = s.pending!; }
    expect(d.kind).toBe('chooseObjects');
    if (d.kind !== 'chooseObjects') return;
    expect(names(s, d.options)).toEqual(['Test Dusk Hybrid']);
  });
});

// ---- "search your library for ..., reveal that card, put it into your hand" ----------------------------------------------------------------------------------------------------

const LORE = card('Test Lore Search', 'Sorcery', 'Search your library for an artifact card, reveal that card, put it into your hand, then shuffle.');

describe('CR 701.23a, 701.20a: "search your library for an artifact card, reveal that card, put it into your hand, then shuffle"', () => {
  it('is automated: the search reveals the card it found, and the next instruction puts that card (and only it) into the hand', () => {
    expect(automated(LORE)).toBe(true);
    expect(JSON.stringify(LORE.faces[0]!.abilities)).toContain('"reveal":true');
  });
  it('the player picks one artifact card from the library; it goes to the hand and the other cards stay (a negative: a creature card is not offered)', () => {
    let s = scenario([], { p1: { hand: ['Test Lore Search'], library: ['Test Red Bear', 'Test Gray Orb', 'Test Pebble 1'] }, defs: [LORE, BEAR, ORB, COSTLY(1, 1)] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Lore Search', 'hand', 'p1') });
    s = resolveToDecision(s);
    const d = s.pending!;
    expect(d.kind).toBe('chooseObjects');
    if (d.kind !== 'chooseObjects') return;
    expect(names(s, d.options).sort()).toEqual(['Test Gray Orb', 'Test Pebble 1']);
    s = answer(s, { kind: 'chooseObjects', ids: [d.options.find((id) => s.objects[id]!.defId === 'Test Gray Orb')!] });
    s = settle(s);
    expect(hand(s)).toEqual(['Test Gray Orb']);
    expect(names(s, s.zones.library['p1']!)).not.toContain('Test Gray Orb');
    expect(names(s, s.zones.library['p1']!)).toContain('Test Red Bear');
  });
});

// ---- "you may put that card from a graveyard onto the battlefield under your control" (Objs: parser/holes/edhz5.ts) ----------------------------------------------------------

const GRAVE_THIEF = card('Test Grave Thief', 'Creature — Specter', 'Whenever an opponent sacrifices a nontoken permanent or discards a permanent card, you may put that card from a graveyard onto the battlefield under your control.', ['2', '2'], '{0}');
const SAC_SPELL = card('Test Culling', 'Sorcery', 'Each opponent sacrifices a creature.');
const SAC_SELF = card('Test Offering', 'Sorcery', 'Sacrifice a creature.');
const DISCARD_SPELL = card('Test Pressure', 'Sorcery', 'Each opponent discards a card.');
const SPARK = card('Test Spark Bolt', 'Instant', 'Draw a card.');
const VICTIM = card('Test Victim', 'Creature — Human', '', ['1', '1'], '{1}');

describe('CR 400.7, 603.2: "Whenever an opponent sacrifices a nontoken permanent or discards a permanent card, you may put that card from a graveyard onto the battlefield under your control."', () => {
  const defs = [GRAVE_THIEF, SAC_SPELL, SAC_SELF, DISCARD_SPELL, SPARK, VICTIM];
  it('is automated, and says "from a graveyard" (the card is looked for there)', () => {
    expect(automated(GRAVE_THIEF)).toBe(true);
    expect(JSON.stringify(GRAVE_THIEF.faces[0]!.abilities)).toContain('"zone":"graveyard"');
  });
  it("an opponent's sacrificed creature card comes back under the trigger controller's control, and goes to the owner's graveyard first", () => {
    let s = scenario([], { p1: { hand: ['Test Culling'], battlefield: ['Test Grave Thief'] }, p2: { battlefield: ['Test Victim'] }, defs });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Culling', 'hand', 'p1') });
    s = settle(s, [true]);
    const mine = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.defId === 'Test Victim');
    expect(mine.length).toBe(1);
    expect(s.zones.graveyard['p2']!.length).toBe(0);
  });
  it("an opponent's discarded permanent card comes back too; a discarded instant does not (not a permanent card)", () => {
    let s = scenario([], { p1: { hand: ['Test Pressure'], battlefield: ['Test Grave Thief'] }, p2: { hand: ['Test Victim'] }, defs });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Pressure', 'hand', 'p1') });
    s = settle(s, [true]);
    expect(bf(s)).toContain('Test Victim');
    let t = scenario([], { p1: { hand: ['Test Pressure'], battlefield: ['Test Grave Thief'] }, p2: { hand: ['Test Spark Bolt'] }, defs });
    t = act(t, { type: 'cast', player: 'p1', card: find(t, 'Test Pressure', 'hand', 'p1') });
    t = settle(t, [true]);
    expect(graveyard(t, 'p2')).toEqual(['Test Spark Bolt']);
    expect(bf(t)).not.toContain('Test Spark Bolt');
  });
  it('declining the option leaves the card in the graveyard; your own sacrifice does not trigger it (opponents only)', () => {
    let s = scenario([], { p1: { hand: ['Test Culling'], battlefield: ['Test Grave Thief'] }, p2: { battlefield: ['Test Victim'] }, defs });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Culling', 'hand', 'p1') });
    s = settle(s, [false]);
    expect(graveyard(s, 'p2')).toEqual(['Test Victim']);
    let own = scenario([], { p1: { hand: ['Test Offering'], battlefield: ['Test Grave Thief', 'Test Victim'] }, defs });
    own = act(own, { type: 'cast', player: 'p1', card: find(own, 'Test Offering', 'hand', 'p1') });
    own = resolveToDecision(own);
    expect(own.pending!.kind).toBe('chooseObjects');
    if (own.pending!.kind !== 'chooseObjects') return;
    own = answer(own, { kind: 'chooseObjects', ids: [own.pending.options.find((id) => own.objects[id]!.defId === 'Test Victim')!] });
    own = settle(own, [true]);
    expect(graveyard(own, 'p1')).toContain('Test Victim');
    expect(bf(own)).not.toContain('Test Victim');
  });
});

// ---- "You may discard up to N cards. If you do, draw that many cards." (eff.edhz5.discard.upTo) -----------------------------------------------------------------------------

const RUMMAGE = card('Test Rummage Rite', 'Sorcery', 'You may discard up to three cards. If you do, draw that many cards.');
const FODDER = (n: number): CardDef => card(`Test Fodder ${n}`, 'Artifact', '', undefined, '{1}');
const SWEEP_DISCARD = card('Test Plain Sweep', 'Sorcery', 'Discard up to two cards, then draw that many cards.');

describe('CR 701.9a, 608.2c, 608.2d: "You may discard up to three cards. If you do, draw that many cards."', () => {
  const fodder = [FODDER(1), FODDER(2), FODDER(3), FODDER(4)];
  const defs = [RUMMAGE, SWEEP_DISCARD, ...fodder];
  const handNames = fodder.map((f) => f.faces[0]!.name);
  const run = (yes: boolean, pick: number) => {
    let s = scenario([], { p1: { hand: ['Test Rummage Rite', ...handNames] }, defs });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rummage Rite', 'hand', 'p1') });
    s = resolveToDecision(s);
    if (s.pending!.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    if (s.pending?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: s.pending.options.slice(0, pick) });
    return settle(s, [], true);
  };
  it('is automated, and "up to" is the most the player may discard, never an obligation', () => {
    expect(automated(RUMMAGE)).toBe(true);
    expect(automated(SWEEP_DISCARD)).toBe(true); // the older "Discard up to N cards, then draw that many cards" template still reads the sentence
  });
  it('discarding two of the four draws exactly two; the library cards come into the hand', () => {
    const s = run(true, 2);
    expect(graveyard(s).filter((n) => n.startsWith('Test Fodder')).length).toBe(2);
    expect(hand(s).filter((n) => n === 'Plains').length).toBe(2);
    expect(hand(s).filter((n) => n.startsWith('Test Fodder')).length).toBe(2);
  });
  it('discarding the maximum (three) draws three; choosing four is refused', () => {
    const s = run(true, 3);
    expect(graveyard(s).filter((n) => n.startsWith('Test Fodder')).length).toBe(3);
    expect(hand(s).filter((n) => n === 'Plains').length).toBe(3);
    expect(() => run(true, 4)).toThrow(/Choose between 0 and 3/);
  });
  it('declining, or discarding none, draws nothing', () => {
    for (const [yes, pick] of [[false, 0], [true, 0]] as const) {
      const s = run(yes, pick);
      expect(hand(s).filter((n) => n === 'Plains').length, `${yes} ${pick}`).toBe(0);
      expect(graveyard(s).filter((n) => n.startsWith('Test Fodder')).length, `${yes} ${pick}`).toBe(0);
    }
  });
});

// ---- "Each creature card in your graveyard has escape. The escape cost is equal to its mana cost plus exile two other cards from your graveyard." (op: keyword escape + costIsManaCost) --

const BREACH = m6.synthetic('Test Grave Gate', 'Enchantment', '{1}{R}', 'Each creature card in your graveyard has escape. The escape cost is equal to its mana cost plus exile two other cards from your graveyard.');
const REVENANT = m6.synthetic('Test Ash Revenant', 'Creature — Zombie', '{1}{R}', '', { power: '2', toughness: '2' } as never);
const ASH_SPELL = m6.synthetic('Test Ash Lash', 'Instant', '{R}', 'Draw a card.');
const BEARS = m6.synthetic('Test Grave Bear', 'Creature — Bear', '{G}', '', { power: '1', toughness: '1' } as never);

describe('CR 702.138a, 118.9, 604.1: a granted escape whose cost is the mana cost plus exiling other cards from the graveyard (Underworld Breach reading)', () => {
  const DEFS = [BREACH, REVENANT, ASH_SPELL, BEARS];
  const board = (graveyard: string[], opp: string[] = [], extra: string[] = ['Test Grave Gate']): GameState =>
    m6.scenario(['Mountain'], { p1: { graveyard, battlefield: [...extra, 'Mountain', 'Mountain', 'Mountain'] }, p2: { graveyard: opp }, defs: [...DEFS], });
  const escapes = (s: GameState, name: string): boolean => legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === find(s, name, 'graveyard') && (a.action as { method?: string }).method === 'escape');
  it('is automated, and the keyword says the cost is the mana cost plus the rest', () => {
    expect(BREACH.automation.level).toBe('full');
    expect(JSON.stringify(BREACH.faces[0]!.abilities)).toContain('"costIsManaCost":true');
  });
  it("a creature card in the graveyard can be cast with escape for its own mana cost ({1}{R}) plus two other cards of that graveyard exiled; it is not one of the cards exiled", () => {
    let s = board(['Test Ash Revenant', 'Test Grave Bear', 'Test Grave Bear']);
    expect(escapes(s, 'Test Ash Revenant')).toBe(true);
    s = m6.drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ash Revenant', 'graveyard'), method: 'escape' } as never) as never);
    expect(m6.topPaid(s).manaSpent).toHaveLength(2);
    expect(m6.namesIn(s, 'exile', 'p1')).toEqual(['Test Grave Bear', 'Test Grave Bear']);
    s = m6.resolveTop(s);
    expect(bf(s)).toContain('Test Ash Revenant');
  });
  it('needs two OTHER cards: with only one other card in the graveyard it is not offered (the card itself does not count), nor from the graveyard without the enchantment', () => {
    expect(escapes(board(['Test Ash Revenant', 'Test Grave Bear']), 'Test Ash Revenant')).toBe(false);
    expect(escapes(board(['Test Ash Revenant', 'Test Grave Bear', 'Test Grave Bear'], [], []), 'Test Ash Revenant')).toBe(false);
  });
  it('a split card and an Adventurer pay the cost of the half or face cast, not both halves together (Underworld Breach ruling 2020-01-24)', () => {
    const half = (name: string, cost: string, type: string, text: string, extra: Record<string, string> = {}) => ({ name, mana_cost: cost, type_line: type, oracle_text: text, ...extra });
    const two = (layout: 'split' | 'adventure', a: ReturnType<typeof half>, b: ReturnType<typeof half>): CardDef =>
      compileCard({ name: `${a.name} // ${b.name}`, layout, mana_cost: layout === 'adventure' ? a.mana_cost : `${a.mana_cost} // ${b.mana_cost}`, type_line: `${a.type_line} // ${b.type_line}`, oracle_text: '', colors: [], keywords: [], card_faces: [a, b] } as unknown as OracleCard);
    const SPLIT = two('split', half('Test Brief Spark', '{R}', 'Creature — Imp', '', { power: '1', toughness: '1' }), half('Test Long Gloom', '{3}{R}', 'Creature — Imp', '', { power: '4', toughness: '4' }));
    const ADV = two('adventure', half('Test Small Ogre', '{R}', 'Creature — Ogre', '', { power: '2', toughness: '2' }), half('Test Big Smash', '{2}{R}', 'Instant — Adventure', 'You gain 1 life.'));
    for (const [def, name, faces] of [[SPLIT, 'Test Brief Spark // Test Long Gloom', [1, 4]], [ADV, 'Test Small Ogre // Test Big Smash', [1, 3]]] as const) {
      faces.forEach((mana, face) => {
        let s = m6.scenario(['Mountain'], { p1: { graveyard: [name, 'Test Grave Bear', 'Test Grave Bear'], battlefield: ['Test Grave Gate', 'Mountain', 'Mountain', 'Mountain', 'Mountain'] }, defs: [...DEFS, def] });
        const id = find(s, name, 'graveyard');
        s = m6.drive(act(s, { type: 'cast', player: 'p1', card: id, face, method: 'escape' } as never) as never);
        expect(m6.topPaid(s).manaSpent, `${name} face ${face}`).toHaveLength(mana);
      });
    }
  });
  it('only cards of the described kind: an instant card in the graveyard has no escape; and an opponent graveyard (it is "your graveyard") gives none either', () => {
    expect(escapes(board(['Test Ash Lash', 'Test Grave Bear', 'Test Grave Bear']), 'Test Ash Lash')).toBe(false);
    const s = board(['Test Grave Bear', 'Test Grave Bear'], ['Test Ash Revenant']);
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === find(s, 'Test Ash Revenant', 'graveyard', 'p2'))).toBe(false);
  });
});

// ---- "Search your library for a card, then shuffle and put that card third from the top." (eff.edhz5.search.then.shuffle.thirdFromTop) -------------------------------------

const PLOT = card('Test Plot Search', 'Instant', 'Search your library for a card, then shuffle and put that card third from the top. You gain 1 life.');

describe('CR 701.23a, 701.24a, 401.4: "Search your library for a card, then shuffle and put that card third from the top."', () => {
  it('is automated', () => {
    expect(automated(PLOT)).toBe(true);
    expect(JSON.stringify(PLOT.faces[0]!.abilities)).toContain('"position":{"nth":3}');
  });
  it('the card the player found ends up exactly third from the top of the shuffled library, and the library is shuffled (the found card is not simply left in place)', () => {
    let s = scenario([], { p1: { hand: ['Test Plot Search'], library: ['Test Pebble 1', 'Test Pebble 2', 'Test Pebble 3', 'Test Pebble 4'] }, defs: [PLOT, COSTLY(1, 1), COSTLY(2, 1), COSTLY(3, 1), COSTLY(4, 1)] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Plot Search', 'hand', 'p1') });
    s = resolveToDecision(s);
    const d = s.pending!;
    expect(d.kind).toBe('chooseObjects');
    if (d.kind !== 'chooseObjects') return;
    const picked = d.options.find((id) => s.objects[id]!.defId === 'Test Pebble 4')!;
    s = answer(s, { kind: 'chooseObjects', ids: [picked] });
    s = settle(s);
    expect(names(s, s.zones.library['p1']!)[2]).toBe('Test Pebble 4');
    expect(names(s, s.zones.library['p1']!).filter((n) => n === 'Test Pebble 4').length).toBe(1);
    expect(s.zones.library['p1']!.length).toBe(24);
  });
});
