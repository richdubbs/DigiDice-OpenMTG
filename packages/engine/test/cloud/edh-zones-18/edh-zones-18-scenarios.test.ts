/**
 * Commander lane edh-zones, round edh-zones-18: scenarios with synthetic cards (invented names, design 6.10), compiled by the default compiler.
 * CR cites are from the Comprehensive Rules 2026-09-25 (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt).
 *
 *   CR 701.20a, 605.1a, 608.2c, 119.3, 121.1   "{T}: Each player reveals the top card of their library. For each nonland card revealed this way, add {G} and you gain 1 life.
 *                                                       Then each player draws a card." (Selvala, Explorer Returned): an ordinary activated ability (CR 605.1a: it draws, so it is no mana ability)
 *   CR 701.20a, 701.20e, 401.4, 608.2c, 608.2d           "Each player looks at the top five cards of their library and may reveal a land card and/or an instant or sorcery card from among them. Each player puts the
 *                                                       cards they revealed this way into their hand and the rest on the bottom of their library in a random order." (Explore the Vastlands)
 *   CR 400.11b, 406.3, 701.20a, 613.4b, 611.2a          "+1: Until your next turn, up to one target noncreature artifact becomes an artifact creature with power and toughness each equal to its mana value."
 *                                                       and "-2: You may reveal an artifact card you own from outside the game or choose a face-up artifact card you own in exile. Put that card into your hand."
 *                                                       (Karn, the Great Creator)
 *   CR 701.20a, 401.2, 402.3, 608.2d, 110.2a            "Reveal a card from your hand or the top card of your library. If you reveal a creature card this way, put it onto the
 *                                                       battlefield." (Eladamri, Korvecdal): the card is chosen among your hand and the top of your library
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, battlefieldNames, castAuto, find, life, passBoth, pool, scenario, zoneNames } from '../../m3/scenario';

function card(name: string, type: string, text: string): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [] } as OracleCard);
}

const SCOUT = card('Test Scout', 'Creature — Elf', '{T}: Each player reveals the top card of their library. For each nonland card revealed this way, add {G} and you gain 1 life. Then each player draws a card.');
const BEAR = card('Test Bear', 'Creature — Bear', '');
const RING = card('Test Ring', 'Artifact', '');
const DEFS = [SCOUT, BEAR, RING];

function tapScout(s0: GameState): GameState {
  const source = find(s0, 'Test Scout', 'battlefield');
  const a = legalActions(s0, 'p1').find((l) => l.kind === 'activate' && l.object === source);
  if (!a) throw new Error('the ability is not offered');
  return passBoth(act(s0, a.action)); // not a mana ability (CR 605.1a): it uses the stack, both players pass and it resolves
}

describe('CR 701.20a, 605.1a, 608.2c, 119.3, 121.1: Each player reveals the top card, adds {G} and gains 1 life for each nonland card, then each draws', () => {
  it('one nonland card (yours) and one land (theirs): {G}, 1 life, and each player draws the card they revealed', () => {
    const s = scenario([], { p1: { battlefield: ['Test Scout'], library: ['Test Bear'] }, p2: { library: ['Plains'] }, defs: DEFS });
    const handBefore = [zoneNames(s, 'hand', 'p1').length, zoneNames(s, 'hand', 'p2').length];
    const t = tapScout(s);
    expect(pool(t, 'p1')).toBe('G');
    expect(life(t, 'p1')).toBe(21);
    expect(life(t, 'p2')).toBe(20);
    expect(zoneNames(t, 'hand', 'p1')).toContain('Test Bear');
    expect(zoneNames(t, 'hand', 'p1').length).toBe(handBefore[0]! + 1);
    expect(zoneNames(t, 'hand', 'p2')).toEqual(['Plains']);
  });
  it('an opponent\'s nonland card counts too: two nonland cards make {G}{G} and 2 life, and the life goes to the controller only', () => {
    const s = scenario([], { p1: { battlefield: ['Test Scout'], library: ['Test Bear'] }, p2: { library: ['Test Ring'] }, defs: DEFS });
    const t = tapScout(s);
    expect(pool(t, 'p1')).toBe('GG');
    expect(life(t, 'p1')).toBe(22);
    expect(life(t, 'p2')).toBe(20);
    expect(zoneNames(t, 'hand', 'p2')).toEqual(['Test Ring']);
  });
  it('negative: two lands add no mana and gain no life, and each player still draws', () => {
    const s = scenario([], { p1: { battlefield: ['Test Scout'], library: ['Plains'] }, p2: { library: ['Plains'] }, defs: DEFS });
    const t = tapScout(s);
    expect(pool(t, 'p1')).toBe('');
    expect(life(t, 'p1')).toBe(20);
    expect(zoneNames(t, 'hand', 'p1')).toEqual(['Plains']);
    expect(zoneNames(t, 'hand', 'p2')).toEqual(['Plains']);
  });
  it('it is NOT a mana ability (CR 605.1a: its effect moves cards out of libraries): it goes on the stack and can be responded to', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Scout'], library: ['Test Bear'] }, p2: { library: ['Plains'] }, defs: DEFS });
    const source = find(s0, 'Test Scout', 'battlefield');
    const a = legalActions(s0, 'p1').find((l) => l.kind === 'activate' && l.object === source)!;
    expect((a as { isMana?: boolean }).isMana).not.toBe(true);
    const t = act(s0, a.action);
    expect(t.zones.stack.length).toBe(1);
    expect(pool(t, 'p1')).toBe('');
    expect(t.objects[source]!.tapped).toBe(true);
  });
});

const ELDER = card('Test Elder', 'Creature — Elf', '{T}: Reveal a card from your hand or the top card of your library. If you reveal a creature card this way, put it onto the battlefield.');
const ELDER_DEFS = [ELDER, BEAR, RING];

/** Activate the ability of Test Elder and answer the choice of the card to reveal with `pick` (a name in the offered cards), if one is asked. */
function elder(s0: GameState, pick: string): GameState {
  const source = find(s0, 'Test Elder', 'battlefield');
  const a = legalActions(s0, 'p1').find((l) => l.kind === 'activate' && l.object === source);
  if (!a) throw new Error('the ability is not offered');
  let s = passBoth(act(s0, a.action)); // the ability uses the stack: both players pass and it resolves
  const p = s.pending as { kind: string; options?: string[] } | null;
  if (p?.kind === 'chooseObjects') {
    const id = p.options!.find((o) => s.objects[o]!.defId === pick);
    if (id === undefined) throw new Error(`${pick} is not among the options ${p.options!.map((o) => s.objects[o]!.defId).join(', ')}`);
    s = answer(s, { kind: 'chooseObjects', ids: [id] } as DecisionAnswer);
  }
  return s;
}

describe('CR 701.20a, 608.2c, 110.2a: "Reveal a card from your hand or the top card of your library. If you reveal a creature card this way, put it onto the battlefield."', () => {
  it('the offered cards are the cards in your hand and the top card of your library only (not the rest of the library, not the opponent\'s cards)', () => {
    const s = scenario([], { p1: { battlefield: ['Test Elder'], hand: ['Test Ring'], library: ['Test Bear', 'Test Ring'] }, p2: { hand: ['Test Bear'] }, defs: ELDER_DEFS });
    const source = find(s, 'Test Elder', 'battlefield');
    const a = legalActions(s, 'p1').find((l) => l.kind === 'activate' && l.object === source)!;
    const t = passBoth(act(s, a.action));
    const p = t.pending as { kind: string; options: string[] };
    expect(p.kind).toBe('chooseObjects');
    expect(p.options.map((o) => t.objects[o]!.zone).sort()).toEqual(['hand', 'library']);
    expect(p.options.length).toBe(2);
  });
  it('a creature card revealed from your hand is put onto the battlefield', () => {
    const s = scenario([], { p1: { battlefield: ['Test Elder'], hand: ['Test Bear'], library: ['Test Ring'] }, defs: ELDER_DEFS });
    const t = elder(s, 'Test Bear');
    expect(battlefieldNames(t, 'p1')).toContain('Test Bear');
    expect(zoneNames(t, 'hand', 'p1')).not.toContain('Test Bear');
  });
  it('the top card of your library, a creature card, is put onto the battlefield', () => {
    const s = scenario([], { p1: { battlefield: ['Test Elder'], hand: ['Test Ring'], library: ['Test Bear'] }, defs: ELDER_DEFS });
    const t = elder(s, 'Test Bear');
    expect(battlefieldNames(t, 'p1')).toContain('Test Bear');
    expect(zoneNames(t, 'library', 'p1')).not.toContain('Test Bear');
  });
  it('negative: a card that is not a creature card stays where it was', () => {
    const s = scenario([], { p1: { battlefield: ['Test Elder'], hand: ['Test Ring'], library: ['Test Bear'] }, defs: ELDER_DEFS });
    const t = elder(s, 'Test Ring');
    expect(battlefieldNames(t, 'p1')).not.toContain('Test Ring');
    expect(zoneNames(t, 'hand', 'p1')).toContain('Test Ring');
    expect(zoneNames(t, 'library', 'p1')[0]).toBe('Test Bear'); // the top card stays on top
  });
});

const DIG = card('Test Dig', 'Sorcery', 'Each player looks at the top five cards of their library and may reveal a land card and/or an instant or sorcery card from among them. Each player puts the cards they revealed this way into their hand and the rest on the bottom of their library in a random order. Each player gains 3 life.');
const BOLT = card('Test Bolt', 'Instant', '');
const CHANT = card('Test Chant', 'Sorcery', '');
const DIG_DEFS = [DIG, BEAR, RING, BOLT, CHANT];

type Pending = { kind: string; player: string; options?: string[]; min?: number; max?: number };
/** Resolve Test Dig (cast by p1), answering each player's two choices in order with the names in `picks` (a name or null for none), p1 first. */
function dig(s0: GameState, picks: (string | null)[]): GameState {
  let s = passBoth(castAuto(s0, 'Test Dig'));
  const queue = [...picks];
  for (let guard = 0; guard < 12 && s.pending && (s.pending as Pending).kind === 'chooseObjects'; guard++) {
    const p = s.pending as Pending;
    const want = queue.shift() ?? null;
    const id = want === null ? undefined : p.options!.find((o) => s.objects[o]!.defId === want);
    s = answer(s, { kind: 'chooseObjects', ids: id === undefined ? [] : [id] } as DecisionAnswer);
  }
  return s;
}

describe('CR 701.20a, 701.20e, 401.4, 608.2c: each player looks at the top five, may reveal a land and/or an instant or sorcery, takes those, bottoms the rest', () => {
  const lib1 = ['Plains', 'Test Bolt', 'Test Chant', 'Test Bear', 'Test Ring'];
  const lib2 = ['Test Chant', 'Test Ring', 'Plains', 'Test Bear', 'Test Bolt'];
  const start = () => scenario([], { p1: { hand: ['Test Dig'], library: lib1 }, p2: { library: lib2 }, defs: DIG_DEFS });

  it('one land and one instant: both go to the hand, the other three go to the bottom of the library; each player gains 3 life', () => {
    const t = dig(start(), ['Plains', 'Test Bolt', 'Plains', 'Test Chant']);
    expect(zoneNames(t, 'hand', 'p1').sort()).toEqual(['Plains', 'Test Bolt']);
    expect(zoneNames(t, 'hand', 'p2').sort()).toEqual(['Plains', 'Test Chant']);
    const lib = zoneNames(t, 'library', 'p1');
    expect(lib.length).toBe(23); // 25 cards, two taken
    expect(lib.slice(0, 20).every((n) => n === 'Plains')).toBe(true); // what was below the five cards stays on top
    expect(lib.slice(20).sort()).toEqual(['Test Bear', 'Test Chant', 'Test Ring']); // the rest are the bottom three
    expect(life(t, 'p1')).toBe(23);
    expect(life(t, 'p2')).toBe(23);
  });
  it('each player decides for their own cards: p2 reveals nothing, and all five of p2\'s cards go to the bottom of p2\'s library', () => {
    const t = dig(start(), ['Plains', null, null, null]);
    expect(zoneNames(t, 'hand', 'p1')).toEqual(['Plains']);
    expect(zoneNames(t, 'hand', 'p2')).toEqual([]);
    expect(zoneNames(t, 'library', 'p2').length).toBe(25);
    expect(zoneNames(t, 'library', 'p2').slice(20).sort()).toEqual(['Plains', 'Test Bear', 'Test Bolt', 'Test Chant', 'Test Ring']);
    expect(life(t, 'p2')).toBe(23);
  });
  it('negative: a creature card or an artifact is not a land card and not an instant or sorcery card, so neither is offered', () => {
    const s = passBoth(castAuto(start(), 'Test Dig'));
    const p = s.pending as Pending;
    expect(p.kind).toBe('chooseObjects');
    expect(p.options!.map((o) => s.objects[o]!.defId)).toEqual(['Plains']); // the land choice: the only land of the five
    const s2 = answer(s, { kind: 'chooseObjects', ids: [] } as DecisionAnswer);
    expect((s2.pending as Pending).options!.map((o) => s2.objects[o]!.defId).sort()).toEqual(['Test Bolt', 'Test Chant']);
  });
  it('negative: at most one land card can be revealed', () => {
    const s = passBoth(castAuto(scenario([], { p1: { hand: ['Test Dig'], library: ['Plains', 'Plains', 'Test Bolt', 'Test Bear', 'Test Ring'] }, defs: DIG_DEFS }), 'Test Dig'));
    const p = s.pending as Pending;
    expect(() => answer(s, { kind: 'chooseObjects', ids: p.options!.slice(0, 2) } as DecisionAnswer)).toThrow();
  });
});

const FETCH = card('Test Fetch', 'Sorcery', 'You may reveal an artifact card you own from outside the game or choose a face-up artifact card you own in exile. Put that card into your hand.');
const GROW = card('Test Grow', 'Sorcery', 'Until your next turn, up to one target noncreature artifact becomes an artifact creature with power and toughness each equal to its mana value.');
const GEM = card('Test Gem', 'Artifact', '');
const GEM3 = { ...compileCard({ name: 'Test Gem Three', layout: 'normal', mana_cost: '{3}', type_line: 'Artifact', oracle_text: '', colors: [] } as OracleCard) } as CardDef;
const K_DEFS = [FETCH, GROW, GEM, GEM3, BEAR, RING];

type Opt = { kind: string; player?: string; options?: ({ id: string; label: string } | string)[] };
/** Cast `spell` from p1's hand, resolve it, and answer each decision in turn: yes to a "may", the source `source` for the option, the object named `take` for a choice of cards. */
function fetch(s0: GameState, source: 'outside' | 'exile', take: string): GameState {
  let s = passBoth(castAuto(s0, 'Test Fetch'));
  for (let guard = 0; guard < 8 && s.pending && (s.pending as Opt).kind !== 'priority'; guard++) {
    const p = s.pending as Opt;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true } as DecisionAnswer);
    else if (p.kind === 'chooseOption') {
      const options = p.options as { id: string; label: string }[];
      const pick = options.find((o) => o.label === take) ?? options.find((o) => o.label === source) ?? options[0]!;
      s = answer(s, { kind: 'chooseOption', ids: [pick.id] } as DecisionAnswer);
    } else if (p.kind === 'chooseObjects') {
      const id = (p.options as string[]).find((o) => s.objects[o]!.defId === take);
      s = answer(s, { kind: 'chooseObjects', ids: id === undefined ? [] : [id] } as DecisionAnswer);
    } else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}

describe('CR 400.11b, 406.3, 701.20a: "You may reveal an artifact card you own from outside the game or choose a face-up artifact card you own in exile. Put that card into your hand."', () => {
  const board = (zones: { exile?: string[]; outside?: string[] }): GameState => {
    const s = scenario([], { p1: { hand: ['Test Fetch'], exile: zones.exile ?? [] }, defs: K_DEFS });
    return zones.outside === undefined ? s : { ...s, outside: { p1: zones.outside.map((n) => n) } };
  };
  it('an artifact card you own in exile is put into your hand', () => {
    const t = fetch(board({ exile: ['Test Gem'] }), 'exile', 'Test Gem');
    expect(zoneNames(t, 'hand', 'p1')).toEqual(['Test Gem']);
    expect(t.zones.exile.length).toBe(0);
  });
  it('an artifact card you own outside the game (your sideboard) is revealed and put into your hand', () => {
    const t = fetch(board({ outside: ['Test Gem'] }), 'outside', 'Test Gem');
    expect(zoneNames(t, 'hand', 'p1')).toEqual(['Test Gem']);
  });
  it('negative: a creature card in exile is not an artifact card, so nothing is put into the hand', () => {
    const t = fetch(board({ exile: ['Test Bear'] }), 'exile', 'Test Bear');
    expect(zoneNames(t, 'hand', 'p1')).toEqual([]);
    expect(t.zones.exile.length).toBe(1);
  });
  it('negative: an artifact card with nothing outside the game and nothing in exile does nothing', () => {
    const t = fetch(board({}), 'outside', 'Test Gem');
    expect(zoneNames(t, 'hand', 'p1')).toEqual([]);
  });
});

describe('CR 613.4b, 611.2a, 202.3: "Until your next turn, up to one target noncreature artifact becomes an artifact creature with power and toughness each equal to its mana value."', () => {
  const grow = (target: string): GameState => {
    const s0 = scenario([], { p1: { hand: ['Test Grow'], battlefield: [target] }, defs: K_DEFS });
    const s = castAuto(s0, 'Test Grow', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s0, target, 'battlefield') }] } as DecisionAnswer] });
    return passBoth(s);
  };
  it('an artifact with mana value 3 is a 3/3 artifact creature', () => {
    const t = grow('Test Gem Three');
    const c = getChars(t, find(t, 'Test Gem Three', 'battlefield'));
    expect(c.types).toContain('Creature');
    expect(c.types).toContain('Artifact');
    expect([Number(c.power), Number(c.toughness)]).toEqual([3, 3]);
  });
  it('it lasts until the start of your next turn: through the opponent\'s turn, gone when your turn begins', () => {
    const t = grow('Test Gem Three');
    const during = advanceTo(t, 2, 'upkeep'); // the opponent's turn 2
    expect(getChars(during, find(during, 'Test Gem Three', 'battlefield')).types).toContain('Creature');
    const after = advanceTo(during, 3, 'upkeep'); // your next turn
    expect(getChars(after, find(after, 'Test Gem Three', 'battlefield')).types).not.toContain('Creature');
  });
  it('an artifact with mana value 0 is a 0/0 artifact creature (it dies as a state-based action)', () => {
    const t = grow('Test Gem');
    expect(t.zones.battlefield.some((id) => t.objects[id]!.defId === 'Test Gem')).toBe(false);
  });
});
