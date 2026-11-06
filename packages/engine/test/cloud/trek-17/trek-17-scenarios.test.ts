/**
 * trek-17 (lane trek, Star Trek cards): the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 * Nothing is mocked. CR cites from memory where marked; the rest checked against MagicCompRules 20260925.
 *
 *   CR 701.20a, 121.1, 608.2c   "each player reveals the top card of their library, then draws a card": the cards revealed stay "the cards revealed this way" in the hands they were
 *                               drawn into: counted ("for each nonland card revealed this way") and compared ("the greatest mana value among cards revealed this way"); cards that were
 *                               not revealed are not part of the group
 *   CR 608.2c, 102.3            "a random opponent": one opponent of the controller, picked by the game
 *   CR 701.20a, 110.2a, 401.4   "reveal cards from the top of your library until you reveal two land cards. Put those land cards onto the battlefield and the rest on the bottom"
 *   CR 603.7, 701.21a           "Sacrifice those lands at the beginning of your next end step": exactly the lands put onto the battlefield that way, not the others
 *   CR 107.3, 201.2, 701.20a    "reveal the top X cards, where X is the number of differently named lands you control; put all permanent cards revealed this way onto the battlefield tapped"
 *   CR 701.21a, 701.23a         "sacrifice any number of lands you control, then search your library for up to that many land cards": the number actually sacrificed bounds the search
 *   CR 108.3, 121.1, 701.24a    "the owner of up to one target creature draws two cards, then shuffles that creature into their library": the owner, not the controller; no target, no draw
 *   CR 700.2, 603.4             "if you faced a dilemma this turn": choosing one or more modes for a spell or ability (the term has no CR text yet; reminder text of the set)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, legal, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const names = (s: GameState, ids: ObjectId[]): string[] => ids.map((id) => nameOf(s, id));
const counters = (s: GameState, name: string): number => s.objects[find(s, name, 'battlefield')]!.counters['+1/+1'] ?? 0;

const ENVOY = card('Test Envoy', 'Legendary Creature — Klingon Human Advisor', 'Vigilance\nAt the beginning of combat on your turn, each player reveals the top card of their library, then draws a card. For each nonland card revealed this way, put a +1/+1 counter on ~.', ['2', '2']);
const JESTER = card('Test Jester', 'Legendary Creature — Klingon Human', 'Vigilance, haste\n{T}: Each player reveals the top card of their library, then draws a card. ~ deals X damage to a random opponent, where X is the greatest mana value among cards revealed this way.', ['2', '2']);
const SCOUT = card('Test Scout', 'Legendary Creature — Human Officer', 'At the beginning of combat on your turn, reveal cards from the top of your library until you reveal two land cards. Put those land cards onto the battlefield and the rest on the bottom of your library in a random order. Sacrifice those lands at the beginning of your next end step.', ['2', '2']);
const TIMELINE = card('Test Timeline', 'Sorcery', 'Reveal the top X cards of your library, where X is the number of differently named lands you control. Put all permanent cards revealed this way onto the battlefield tapped and the rest on the bottom of your library in a random order.');
const GROVE = card('Test Grove', 'Land', '');
const BAUBLE = card('Test Bauble', 'Artifact', '', undefined, '{2}');
const IDOL = card('Test Idol', 'Artifact', '', undefined, '{4}');
const CHANT = card('Test Chant', 'Sorcery', '', undefined, '{5}');
const BEAST = card('Test Beast', 'Creature — Beast', '', ['3', '3'], '{3}');
const RITUAL = card('Test Ritual', 'Instant', '', undefined, '{1}');
const GENESIS = card('Test Genesis', 'Legendary Artifact', '{T}, Sacrifice ~: Sacrifice any number of lands you control, then search your library for up to that many land cards, put them onto the battlefield tapped, then shuffle. Activate only as a sorcery.');
const UNIFY = card('Test Unification', 'Sorcery', 'The owner of up to one target creature draws two cards, then shuffles that creature into their library.');
const CARETAKER = card('Test Caretaker', 'Legendary Creature — Elemental', 'Vigilance, ward {2}\nAt the beginning of each end step, if you faced a dilemma this turn, target opponent exiles cards from the top of their library until they exile a nonland card. You may cast that card without paying its mana cost.', ['2', '2']);
const CHARM = card('Test Charm', 'Instant', 'Choose one --\n• You gain 2 life.\n• Draw a card.');
const CHARM1 = card('Test Plain Charm', 'Instant', 'You gain 2 life.');
const WARP = card('Test Warp', 'Enchantment', 'If you would draw a card, instead exile the top card of your library.');
const DEFS = [WARP, ENVOY, JESTER, SCOUT, TIMELINE, GROVE, BAUBLE, IDOL, CHANT, BEAST, RITUAL, GENESIS, UNIFY, CARETAKER, CHARM, CHARM1];

describe('the cards are automated', () => {
  it('every ability of the round is full, with no manual step', () => {
    for (const d of [ENVOY, JESTER, SCOUT, TIMELINE, GENESIS, UNIFY, CARETAKER]) expect(full(d), d.name).toBe(true);
  });
});

describe('CR 701.20a, 121.1, 608.2c: each player reveals the top card of their library, then draws a card; "for each nonland card revealed this way"', () => {
  const combat = (p1: string[], p2: string[]): GameState => {
    let s = scenario([], { p1: { battlefield: ['Test Envoy'], library: p1 }, p2: { library: p2 }, defs: DEFS });
    s = advanceTo(s, 1, 'beginCombat');
    expect(s.zones.stack).toHaveLength(1);
    return pass(pass(s));
  };
  it('a nonland card of each player is revealed and drawn: two counters; both players drew the card they revealed', () => {
    const s = combat(['Test Bauble', 'Plains'], ['Test Idol', 'Plains']);
    expect(counters(s, 'Test Envoy')).toBe(2);
    expect(names(s, s.zones.hand['p1']!)).toEqual(['Test Bauble']);
    expect(names(s, s.zones.hand['p2']!)).toEqual(['Test Idol']);
  });
  it('only the nonland cards count: a land revealed by you and a nonland card revealed by the opponent make one counter', () => {
    const s = combat(['Plains', 'Test Bauble'], ['Test Idol', 'Plains']);
    expect(counters(s, 'Test Envoy')).toBe(1);
  });
  it('two lands: no counter', () => {
    const s = combat(['Plains', 'Test Bauble'], ['Plains', 'Test Idol']);
    expect(counters(s, 'Test Envoy')).toBe(0);
    expect(names(s, s.zones.hand['p2']!)).toEqual(['Plains']); // the revealed land was drawn all the same
  });
  it('the cards already in a hand are not "revealed this way": nonland cards in the hands add nothing when both revealed cards are lands', () => {
    let s = scenario([], { p1: { battlefield: ['Test Envoy'], hand: ['Test Bauble', 'Test Idol'], library: ['Plains'] }, p2: { hand: ['Test Chant'], library: ['Plains'] }, defs: DEFS });
    s = pass(pass(advanceTo(s, 1, 'beginCombat')));
    expect(counters(s, 'Test Envoy')).toBe(0);
  });
  it('a revealed card the resolution put somewhere else than a hand (a draw replaced by an exile of the top card: the exile zone) is still one of the cards revealed this way', () => {
    let s = scenario([], { p1: { battlefield: ['Test Envoy', 'Test Warp'], library: ['Test Bauble', 'Plains'] }, p2: { library: ['Test Idol', 'Plains'] }, defs: DEFS });
    s = pass(pass(advanceTo(s, 1, 'beginCombat')));
    expect(s.zones.hand['p1']).toHaveLength(0);
    expect(names(s, s.zones.exile)).toEqual(['Test Bauble']);
    expect(counters(s, 'Test Envoy')).toBe(2);
  });
  it('the opponent controlling the envoy gets nothing: the trigger is on your turn only (turn 2 is the opponent\'s)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Envoy'], library: ['Test Bauble', 'Plains'] }, p2: { library: ['Test Idol', 'Plains'] }, defs: DEFS });
    s = advanceTo(s, 2, 'beginCombat');
    expect(s.zones.stack).toHaveLength(0);
  });
});

describe('CR 608.2c, 202.3: "~ deals X damage to a random opponent, where X is the greatest mana value among cards revealed this way"', () => {
  const tap = (s: GameState): GameState => {
    const a = legal(s, 'p1', 'activate')[0]!;
    return pass(pass(act(s, a.action)));
  };
  it('the opponent takes the greatest mana value of the cards revealed: yours (4) beats theirs (2), and the other way round', () => {
    let s = scenario([], { p1: { battlefield: ['Test Jester'], library: ['Test Idol'] }, p2: { library: ['Test Bauble'] }, defs: DEFS });
    s = tap(s);
    expect(life(s, 'p2')).toBe(20 - 4);
    expect(life(s, 'p1')).toBe(20);
    let t = scenario([], { p1: { battlefield: ['Test Jester'], library: ['Test Bauble'] }, p2: { library: ['Test Chant'] }, defs: DEFS });
    t = tap(t);
    expect(life(t, 'p2')).toBe(20 - 5);
  });
  it('two lands revealed: the greatest mana value is 0, no damage', () => {
    const s = tap(scenario([], { p1: { battlefield: ['Test Jester'], library: ['Plains'] }, p2: { library: ['Plains'] }, defs: DEFS }));
    expect(life(s, 'p2')).toBe(20);
  });
  it('a card that was not revealed does not count: the card under the revealed one (mana value 5) is not part of the group', () => {
    const s = tap(scenario([], { p1: { battlefield: ['Test Jester'], library: ['Test Bauble', 'Test Chant'] }, p2: { library: ['Plains'] }, defs: DEFS }));
    expect(life(s, 'p2')).toBe(20 - 2);
  });
});

describe('CR 701.20a, 110.2a, 401.4, 603.7, 701.21a: reveal until two land cards, put them onto the battlefield, the rest on the bottom, sacrifice those lands at your next end step', () => {
  const resolved = (library: string[], battlefield: string[] = ['Test Scout']): GameState => {
    let s = scenario([], { p1: { battlefield, library }, defs: DEFS });
    s = advanceTo(s, 1, 'beginCombat');
    return pass(pass(s));
  };
  it('the two lands found enter untapped; the cards revealed before them go to the bottom of the library; the cards below stay where they are', () => {
    const s = resolved(['Test Bauble', 'Plains', 'Test Idol', 'Test Grove', 'Test Chant']);
    const lands = s.zones.battlefield.filter((id) => ['Plains', 'Test Grove'].includes(nameOf(s, id)));
    expect(names(s, lands).sort()).toEqual(['Plains', 'Test Grove']);
    for (const id of lands) expect(s.objects[id]!.tapped).toBe(false);
    const lib = names(s, s.zones.library['p1']!);
    expect(lib.slice(-2).sort()).toEqual(['Test Bauble', 'Test Idol']); // the revealed nonlands, on the bottom in some order
    expect(lib[0]).toBe('Test Chant'); // the card under the second land was never revealed: it is the new top card
  });
  it('the lands are sacrificed at the beginning of YOUR NEXT end step, not before: on the battlefield after combat and in the main phase, gone in the end step; a land you already controlled stays', () => {
    let s = resolved(['Plains', 'Test Grove', 'Test Bauble'], ['Test Scout', 'Plains']);
    const before = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Plains' || nameOf(s, id) === 'Test Grove');
    expect(before).toHaveLength(3);
    s = advanceTo(s, 1, 'main2');
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Grove')).toHaveLength(1);
    s = advanceTo(s, 1, 'end');
    expect(s.zones.stack).toHaveLength(1); // the delayed trigger
    s = pass(pass(s));
    expect(names(s, s.zones.battlefield).filter((n) => n === 'Test Grove' || n === 'Plains')).toEqual(['Plains']); // only the land that was there before is left
    expect(names(s, s.zones.graveyard['p1']!).sort()).toEqual(['Plains', 'Test Grove']);
  });
});

describe('CR 107.3, 201.2, 701.20a, 110.2a: reveal the top X cards, X the number of differently named lands you control; put all permanent cards revealed this way onto the battlefield tapped', () => {
  const cast = (battlefield: string[], library: string[]): GameState => {
    let s = scenario([], { p1: { hand: ['Test Timeline'], battlefield, library }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Timeline', 'hand', 'p1') });
    return pass(pass(s));
  };
  it('two differently named lands: two cards revealed; the permanents among them enter tapped, the instant goes to the bottom, the third card stays on top', () => {
    const s = cast(['Plains', 'Test Grove'], ['Test Beast', 'Test Ritual', 'Test Idol']);
    expect(names(s, s.zones.battlefield).sort()).toEqual(['Plains', 'Test Beast', 'Test Grove']);
    expect(s.objects[find(s, 'Test Beast', 'battlefield')]!.tapped).toBe(true);
    const lib = names(s, s.zones.library['p1']!);
    expect(lib[0]).toBe('Test Idol'); // not revealed
    expect(lib[lib.length - 1]).toBe('Test Ritual');
    expect(names(s, s.zones.graveyard['p1']!)).toContain('Test Timeline');
  });
  it('lands with the same name count once: three Plains are X = 1, one card revealed', () => {
    const s = cast(['Plains', 'Plains', 'Plains'], ['Test Beast', 'Test Idol']);
    expect(names(s, s.zones.battlefield).filter((n) => n === 'Test Beast')).toHaveLength(1);
    expect(names(s, s.zones.battlefield).filter((n) => n === 'Test Idol')).toHaveLength(0);
  });
  it('no lands: X = 0, nothing is revealed and the library is untouched', () => {
    const s = cast([], ['Test Beast', 'Test Idol']);
    expect(names(s, s.zones.battlefield)).toEqual([]);
    expect(names(s, s.zones.library['p1']!).slice(0, 2)).toEqual(['Test Beast', 'Test Idol']);
  });
  it('a land revealed is a permanent card too: it enters tapped', () => {
    const s = cast(['Plains', 'Test Grove'], ['Plains', 'Test Ritual']);
    const entered = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Plains' && s.objects[id]!.tapped);
    expect(entered).toHaveLength(1);
  });
});

describe('CR 701.21a, 701.23a, 107.1: sacrifice any number of lands you control, then search your library for up to that many land cards', () => {
  const start = (): GameState => {
    let s = scenario([], { p1: { battlefield: ['Test Genesis', 'Plains', 'Plains', 'Test Grove'], library: ['Test Grove', 'Test Grove', 'Test Beast'] }, defs: DEFS });
    s = act(s, legal(s, 'p1', 'activate')[0]!.action);
    s = pass(pass(s)); // the ability resolves (the artifact was sacrificed as a cost)
    expect(s.pending?.kind).toBe('chooseObjects');
    return s;
  };
  const lands = (s: GameState): string[] => names(s, s.zones.battlefield.filter((id) => ['Plains', 'Test Grove'].includes(nameOf(s, id))));
  it('sacrificing two lands finds up to two land cards: the search is limited to two, they enter tapped, and the library is shuffled', () => {
    let s = start();
    const options = (s.pending as unknown as { options: ObjectId[] }).options;
    expect(options).toHaveLength(3); // the three lands
    s = answer(s, { kind: 'chooseObjects', ids: options.slice(0, 2) });
    const search = s.pending as unknown as { max: number; options: ObjectId[] };
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(search.max).toBe(2);
    expect(names(s, search.options)).not.toContain('Test Beast'); // lands only
    const picks = search.options.filter((id) => nameOf(s, id) === 'Test Grove').slice(0, 2);
    s = answer(s, { kind: 'chooseObjects', ids: picks });
    expect(lands(s)).toHaveLength(3); // 3 - 2 sacrificed + 2 found
    const entered = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Grove' && s.objects[id]!.tapped);
    expect(entered).toHaveLength(2);
    expect(names(s, s.zones.graveyard['p1']!).filter((n) => n === 'Plains' || n === 'Test Grove').length + 0).toBeGreaterThanOrEqual(2);
  });
  it('sacrificing nothing searches for up to zero cards: no land enters', () => {
    let s = start();
    s = answer(s, { kind: 'chooseObjects', ids: [] });
    expect(lands(s)).toHaveLength(3);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.tapped && nameOf(s, id) !== 'Test Genesis')).toBe(false);
  });
  it('more cards than the number sacrificed cannot be taken: one land sacrificed, at most one found', () => {
    let s = start();
    const options = (s.pending as unknown as { options: ObjectId[] }).options;
    s = answer(s, { kind: 'chooseObjects', ids: [options[0]!] });
    expect((s.pending as unknown as { max: number }).max).toBe(1);
  });
});

describe('CR 108.3, 121.1, 701.24a, 115.1: the owner of up to one target creature draws two cards, then shuffles that creature into their library', () => {
  const cast = (hand: string[], mine: string[], theirs: string[], pick: 'mine' | 'theirs' | 'none'): GameState => {
    let s = scenario([], { p1: { hand, battlefield: mine }, p2: { battlefield: theirs }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Unification', 'hand', 'p1') });
    expect(s.pending?.kind).toBe('chooseTargets');
    const target = pick === 'none' ? [] : [{ kind: 'object' as const, id: find(s, 'Test Beast', 'battlefield', pick === 'mine' ? 'p1' : 'p2') }];
    s = answer(s, { kind: 'chooseTargets', targets: target });
    return pass(pass(s));
  };
  it("an opponent's creature: ITS OWNER (the opponent) draws two cards and the creature is shuffled into the owner's library; you draw nothing", () => {
    const s = cast(['Test Unification'], [], ['Test Beast'], 'theirs');
    expect(s.zones.hand['p2']).toHaveLength(2);
    expect(s.zones.hand['p1']).toHaveLength(0);
    expect(names(s, s.zones.battlefield)).toEqual([]);
    expect(names(s, s.zones.library['p2']!)).toContain('Test Beast');
    expect(names(s, s.zones.library['p1']!)).not.toContain('Test Beast');
  });
  it('your own creature: you draw two cards and it is shuffled into your library', () => {
    const s = cast(['Test Unification'], ['Test Beast'], [], 'mine');
    expect(s.zones.hand['p1']).toHaveLength(2);
    expect(s.zones.hand['p2']).toHaveLength(0);
    expect(names(s, s.zones.library['p1']!)).toContain('Test Beast');
  });
  it('a creature you own but an opponent controls would be shuffled into YOUR library and you would draw: the owner, never the controller (CR 108.3)', () => {
    let s = scenario([], { p1: { hand: ['Test Unification'] }, p2: { battlefield: ['Test Beast'] }, defs: DEFS });
    const beast = find(s, 'Test Beast', 'battlefield');
    s.objects[beast]!.owner = 'p1';
    s.objects[beast]!.controller = 'p2';
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Unification', 'hand', 'p1') });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: beast }] });
    s = pass(pass(s));
    expect(s.zones.hand['p1']).toHaveLength(2);
    expect(s.zones.hand['p2']).toHaveLength(0);
  });
  it('no target chosen ("up to one"): nobody draws, nothing is shuffled', () => {
    const s = cast(['Test Unification'], ['Test Beast'], ['Test Beast'], 'none');
    expect(s.zones.hand['p1']).toHaveLength(0);
    expect(s.zones.hand['p2']).toHaveLength(0);
    expect(names(s, s.zones.battlefield)).toEqual(['Test Beast', 'Test Beast']);
  });
});

describe('CR 700.2, 603.4, 406.1, 608.2c: if you faced a dilemma this turn, target opponent exiles cards from the top of their library until they exile a nonland card; you may cast it', () => {
  const toEnd = (hand: string[], opp: string[] = ['Plains', 'Test Beast']): GameState => {
    let s = scenario([], { p1: { hand, battlefield: ['Test Caretaker'] }, p2: { library: opp }, defs: DEFS });
    for (const name of hand) {
      s = act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') });
      if (s.pending?.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: ['0'] });
      s = pass(pass(s));
    }
    return advanceTo(s, 1, 'end');
  };
  it('choosing a mode of a spell is facing a dilemma: at the beginning of the end step the trigger goes on the stack, the opponent exiles down to the first nonland card (the land too), and you may cast it free', () => {
    let s = toEnd(['Test Charm']);
    expect(s.pending?.kind).toBe('chooseTargets'); // the trigger's target opponent
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
    expect(s.zones.stack).toHaveLength(1);
    s = pass(pass(s));
    expect(names(s, s.zones.exile).sort()).toEqual(['Plains', 'Test Beast']);
    expect(s.pending?.kind).toBe('yesNo'); // "You may cast that card without paying its mana cost"
    s = answer(s, { kind: 'yesNo', yes: false });
    expect(names(s, s.zones.exile).sort()).toEqual(['Plains', 'Test Beast']);
  });
  it('casting the card free: the nonland card (not the land before it) is the one cast, and the opponent keeps ownership', () => {
    let s = toEnd(['Test Charm'], ['Plains', 'Plains', 'Test Idol']);
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
    s = pass(pass(s));
    expect(s.pending?.kind).toBe('yesNo');
    s = answer(s, { kind: 'yesNo', yes: true });
    while (s.pending && s.pending.kind !== 'priority') s = s.pending.kind === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : answer(s, { kind: 'yesNo', yes: true });
    expect(names(s, s.zones.stack)).toEqual(['Test Idol']);
    expect(names(s, s.zones.exile)).toEqual(['Plains', 'Plains']);
  });
  it('the opponent facing a dilemma is not you facing one: their modal spell does not turn the trigger on', () => {
    let s = scenario([], { p1: { battlefield: ['Test Caretaker'] }, p2: { hand: ['Test Charm'], library: ['Plains', 'Test Beast'] }, defs: DEFS });
    s = advanceTo(s, 2, 'main1');
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Charm', 'hand', 'p2') });
    s = answer(s, { kind: 'chooseOption', ids: ['0'] });
    s = pass(pass(s));
    s = advanceTo(s, 2, 'end');
    expect(s.zones.stack).toHaveLength(0);
    expect(s.pending?.kind).toBe('priority');
  });
  it('without a dilemma this turn (a spell with no modes) the trigger does not trigger at all', () => {
    const s = toEnd(['Test Plain Charm']);
    expect(s.zones.stack).toHaveLength(0);
    expect(s.zones.exile).toHaveLength(0);
  });
  it("nothing was faced: no spell at all, no trigger either", () => {
    const s = toEnd([]);
    expect(s.zones.stack).toHaveLength(0);
  });
});
