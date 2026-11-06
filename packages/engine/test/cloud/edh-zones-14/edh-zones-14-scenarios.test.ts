/**
 * edh-zones-14 (Commander effort, lane edh-zones): the round's readings played through the engine with synthetic cards (invented names, design 6.10). CR cites checked against
 * the 2026-09-25 text.
 *
 *   CR 701.23a, 614.1a        "If an opponent would search a library, that player searches the top three cards of that library instead." (Aven Mindcensor)
 *   CR 603.4, 701.21a, 400.3  "..., each opponent sacrifices a creature of their choice and you return up to one target creature card from your graveyard to your hand." (Witch of the Moors)
 *   CR 115.1, 608.2c, 725.1   "any number of target players each mill two cards. If you're the monarch, each of those players mills ten cards instead." (Court of Cunning)
 *   CR 406.3, 401.4, 608.2c   "Exile any number of cards from your hand face down. Put that many cards from the top of your library into your hand. Then look at the exiled cards and put
 *                             them on top of your library in any order." (Scroll Rack)
 *   CR 508.1b, 506.3, 603.2c  "Whenever an opponent attacks you and/or one or more planeswalkers you control, exile the top card of that player's library. You may play that card ..." (Cunning Rhetoric)
 *   CR 607.2a, 603.4, 400.3   "..., if there are cards exiled with ~, put them into their owner's graveyard, then ~ deals that much damage to each opponent." (Valakut Exploration)
 *   CR 701.23a, 101.2, 109.5  "Spells and abilities each opponent controls can't cause their controller to search their library." (Ashiok, Dream Render)
 */
import { describe, expect, it } from 'vitest';
import { put, advanceTo, pass, answer } from '../../m3/scenario';
import { legalActions, type GameState } from '../../../src/index';
import { act, card, cast, drive, find, full, lifeOf, named, obj, passBoth, resolveAll, scenario } from '../r3-cost/support';
import { drive as driveL, resolveAll as resolveL } from './support';
import { getChars } from '../../../src/rules/characteristics';

const nameOf = (s: GameState, id: string): string => getChars(s, id).name;
const setLibrary = (s: GameState, p: 'p1' | 'p2', libNames: string[]): void => {
  for (const id of s.zones.library[p]!) delete s.objects[id];
  s.zones.library[p] = [];
  for (const n of libNames) put(s, p, 'library', n);
};
const libNames = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.library[p]!.map((id) => nameOf(s, id));
const handNames = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.hand[p]!.map((id) => nameOf(s, id)).sort();
const gyNames = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.graveyard[p]!.map((id) => nameOf(s, id)).sort();
const bfNames = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => nameOf(s, id)).sort();
const exileNames = (s: GameState): string[] => s.zones.exile.map((id) => nameOf(s, id)).sort();
const offered = (s: GameState): string[] => {
  const pending = s.pending as unknown as { kind: string; options?: string[] };
  expect(pending.kind).toBe('chooseObjects');
  return (pending.options ?? []).map((id) => nameOf(s, id)).sort();
};

const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const WOLF = card('Test Wolf', 'Creature — Wolf', '', '{0}', ['2', '2']);
const OWL = card('Test Owl', 'Creature — Bird', '', '{0}', ['1', '1']);
const CUB = card('Test Cub', 'Creature — Bear', '', '{0}', ['1', '1']);
const FOREST = card('Test Grove', 'Basic Land — Forest', '');

describe('"If an opponent would search a library, that player searches the top three cards of that library instead." (CR 701.23a, 614.1a; Aven Mindcensor)', () => {
  const CENSOR = card('Test Censor', 'Creature — Bird', 'If an opponent would search a library, that player searches the top three cards of that library instead.', '{0}', ['2', '1']);
  const TUTOR = card('Test Tutor', 'Sorcery', 'Search your library for a creature card, put it into your hand, then shuffle.');
  const FETCH = card('Test Fetch', 'Sorcery', "Search target opponent's library for a creature card and exile it face down. Then that player shuffles.");
  const defs = [CENSOR, TUTOR, FETCH, BEAR, WOLF, OWL];
  const cast0 = (s0: GameState, name: string) => resolveL(driveL(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') })));
  it('has no manual part', () => expect(full(CENSOR)).toBe(true));

  it("an opponent's search sees only the top three cards: the creature on the fourth place is not offered", () => {
    const s0 = scenario([], { p1: { hand: ['Test Tutor'] }, p2: { battlefield: ['Test Censor'] }, defs });
    setLibrary(s0, 'p1', ['Test Bear', 'Test Wolf', 'Test Bear', 'Test Owl']);
    expect(offered(cast0(s0, 'Test Tutor'))).toEqual(['Test Bear', 'Test Bear', 'Test Wolf']);
  });
  it('the negative case: without the Censor, or when its own controller searches, the whole library is searched', () => {
    const mine = scenario([], { p1: { hand: ['Test Tutor'], battlefield: ['Test Censor'] }, defs });
    setLibrary(mine, 'p1', ['Test Bear', 'Test Wolf', 'Test Bear', 'Test Owl']);
    expect(offered(cast0(mine, 'Test Tutor'))).toEqual(['Test Bear', 'Test Bear', 'Test Owl', 'Test Wolf']);
    const none = scenario([], { p1: { hand: ['Test Tutor'] }, defs });
    setLibrary(none, 'p1', ['Test Bear', 'Test Wolf', 'Test Bear', 'Test Owl']);
    expect(offered(cast0(none, 'Test Tutor'))).toEqual(['Test Bear', 'Test Bear', 'Test Owl', 'Test Wolf']);
  });
  it('the searcher takes a card from the top three and the rest of the library is untouched', () => {
    const s0 = scenario([], { p1: { hand: ['Test Tutor'] }, p2: { battlefield: ['Test Censor'] }, defs });
    setLibrary(s0, 'p1', ['Test Bear', 'Test Wolf', 'Test Bear', 'Test Owl']);
    const t = cast0(s0, 'Test Tutor');
    const wolf = (t.pending as unknown as { options: string[] }).options.find((id) => nameOf(t, id) === 'Test Wolf')!;
    const s = resolveL(answer(t, { kind: 'chooseObjects', ids: [wolf] }));
    expect(handNames(s, 'p1')).toEqual(['Test Wolf']);
    expect([...libNames(s, 'p1')].sort()).toEqual(['Test Bear', 'Test Bear', 'Test Owl']);
  });
  it("the limit follows the searcher, not the library's owner: an opponent searching the Censor controller's library (or any other) sees three cards too", () => {
    const s0 = scenario([], { p1: { hand: ['Test Fetch'] }, p2: { battlefield: ['Test Censor'] }, defs });
    setLibrary(s0, 'p2', ['Test Bear', 'Test Wolf', 'Test Owl', 'Test Bear']);
    const t = driveL(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Fetch', 'hand', 'p1') }), [], [[{ kind: 'player', id: 'p2' }]]);
    expect(offered(resolveL(t))).toEqual(['Test Bear', 'Test Owl', 'Test Wolf']);
  });
  it('the controller of the Censor searching an opponent\'s library is not limited (the replacement is about an opponent searching)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Fetch'], battlefield: ['Test Censor'] }, defs });
    setLibrary(s0, 'p2', ['Test Bear', 'Test Wolf', 'Test Owl', 'Test Bear']);
    const t = driveL(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Fetch', 'hand', 'p1') }), [], [[{ kind: 'player', id: 'p2' }]]);
    expect(offered(resolveL(t))).toEqual(['Test Bear', 'Test Bear', 'Test Owl', 'Test Wolf']);
  });
  it('two Censors: the smaller limit stays three (a second replacement keeps the least)', () => {
    const TWO = card('Test Censor Two', 'Creature — Bird', 'If an opponent would search a library, that player searches the top five cards of that library instead.', '{0}', ['2', '1']);
    const s0 = scenario([], { p1: { hand: ['Test Tutor'] }, p2: { battlefield: ['Test Censor', 'Test Censor Two'] }, defs: [...defs, TWO] });
    setLibrary(s0, 'p1', ['Test Bear', 'Test Wolf', 'Test Bear', 'Test Owl', 'Test Owl']);
    let t = driveL(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Tutor', 'hand', 'p1') }));
    for (let g = 0; g < 10 && (t.zones.stack.length > 0 || t.pending?.kind === 'chooseReplacement'); g++) {
      const p = t.pending as unknown as { kind: string; options?: { id: string }[] };
      t = p.kind === 'chooseReplacement' ? answer(t, { kind: 'chooseReplacement', id: p.options![0]!.id }) : resolveL(t);
    }
    expect(offered(t)).toEqual(['Test Bear', 'Test Bear', 'Test Wolf']);
  });
});

describe('"..., each opponent sacrifices a creature of their choice and you return up to one target creature card from your graveyard to your hand." (CR 603.4, 701.21a, 608.2b; Witch of the Moors)', () => {
  const WITCH = card('Test Witch', 'Creature — Human', 'At the beginning of your end step, if you gained life this turn, each opponent sacrifices a creature of their choice and you return up to one target creature card from your graveyard to your hand.', '{0}', ['1', '1']);
  const SALVE = card('Test Salve', 'Sorcery', 'You gain 2 life.');
  const defs = [WITCH, SALVE, BEAR, WOLF, CUB];
  it('has no manual part', () => expect(full(WITCH)).toBe(true));
  it('after gaining life: the opponent sacrifices a creature and the target card returns to your hand', () => {
    let s = scenario([], { p1: { hand: ['Test Salve'], battlefield: ['Test Witch'], graveyard: ['Test Bear'] }, p2: { battlefield: ['Test Wolf'] }, defs });
    s = resolveAll(cast(s, 'Test Salve'));
    expect(lifeOf(s, 'p1')).toBe(22);
    s = advanceTo(s, 1, 'end');
    s = resolveAll(drive(s, { targets: [[obj(find(s, 'Test Bear', 'graveyard', 'p1'))]] }), { targets: [[obj(find(s, 'Test Bear', 'graveyard', 'p1'))]] });
    expect(bfNames(s, 'p2')).toEqual([]);
    expect(gyNames(s, 'p2')).toEqual(['Test Wolf']);
    expect(handNames(s, 'p1')).toEqual(['Test Bear']);
  });
  it('the negative case: no life gained this turn means the intervening "if" fails, nothing is sacrificed or returned', () => {
    let s = scenario([], { p1: { battlefield: ['Test Witch'], graveyard: ['Test Bear'] }, p2: { battlefield: ['Test Wolf'] }, defs });
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(bfNames(s, 'p2')).toEqual(['Test Wolf']);
    expect(handNames(s, 'p1')).toEqual([]);
  });
});

describe('"any number of target players each mill two cards. If you\'re the monarch, each of those players mills ten cards instead." (CR 115.1, 608.2c, 725.1; Court of Cunning)', () => {
  const lib = (n: number): string[] => Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 'Test Bear' : 'Test Wolf'));
  const MONARCH = card('Test Court', 'Enchantment', "When this enchantment enters, you become the monarch.\nAt the beginning of your upkeep, any number of target players each mill two cards. If you're the monarch, each of those players mills ten cards instead.");
  const PLAIN = card('Test Court Plain', 'Enchantment', "At the beginning of your upkeep, any number of target players each mill two cards. If you're the monarch, each of those players mills ten cards instead.");
  const defs = [MONARCH, PLAIN, BEAR, WOLF];
  const upkeep = (name: string, withMonarch: boolean): GameState => {
    let s = scenario([], { p1: { hand: [name] }, p2: {}, defs });
    setLibrary(s, 'p2', lib(20));
    setLibrary(s, 'p1', lib(20));
    s = resolveAll(cast(s, name));
    s = advanceTo(s, 3, 'upkeep');
    s = resolveAll(drive(s, { targets: [[{ kind: 'player', id: 'p2' }]] }), { targets: [[{ kind: 'player', id: 'p2' }]] });
    void withMonarch;
    return s;
  };
  it('has no manual part', () => expect(full(MONARCH)).toBe(true));
  it('as the monarch each targeted player mills ten cards, not two plus ten', () => {
    const s = upkeep('Test Court', true);
    const draws = 1; // p2 drew for their own turn 2 before this upkeep
    expect(libNames(s, 'p2').length).toBe(20 - 10 - draws);
    expect(gyNames(s, 'p2').length).toBe(10);
  });
  it('the negative case: without the monarchy the targeted player mills two cards; an untargeted player mills nothing', () => {
    const s = upkeep('Test Court Plain', false);
    expect(gyNames(s, 'p2').length).toBe(2);
    expect(gyNames(s, 'p1').length).toBe(0);
    expect(libNames(s, 'p2').length).toBe(20 - 2 - 1);
  });
});

describe('"Exile any number of cards from your hand face down. Put that many cards from the top of your library into your hand. Then look at the exiled cards and put them on top of your library in any order." (CR 406.3, 401.4, 608.2h; Scroll Rack)', () => {
  const RACK = card('Test Rack', 'Artifact', '{1}, {T}: Exile any number of cards from your hand face down. Put that many cards from the top of your library into your hand. Then look at the exiled cards and put them on top of your library in any order.', '{1}');
  const defs = [RACK, BEAR, WOLF, OWL, CUB];
  const run = (s0: GameState, picks: string[], order?: string[]): GameState => {
    s0.players[0]!.manaPool.push({ type: 'C' } as never);
    const picksSorted = [...picks].sort();
    const rack = find(s0, 'Test Rack', 'battlefield', 'p1');
    const la = legalActions(s0, 'p1').find((a) => a.kind === 'activate' && !a.isMana && a.object === rack);
    expect(la, 'the activation').toBeDefined();
    let s = passBoth(drive(act(s0, la!.action)));
    expect(s.pending?.kind).toBe('chooseObjects');
    s = answer(s, { kind: 'chooseObjects', ids: picks.map((n) => find(s0, n, 'hand', 'p1')) });
    for (let g = 0; g < 8 && s.pending && s.pending.kind !== 'priority'; g++) {
      const p = s.pending as unknown as { kind: string; items?: { id: string; label: string }[] };
      if (p.kind === 'order') {
        const items = p.items as unknown as { id: string; label: string }[];
        expect(items.map((i) => i.label).sort(), 'the cards looked at are named to their owner').toEqual(picksSorted);
        const wanted = order === undefined ? items.map((i) => i.id) : order.map((n) => items.find((i) => i.label === n)!.id);
        s = answer(s, { kind: 'order', ids: wanted });
      } else s = drive(s);
    }
    return s;
  };
  it('has no manual part', () => expect(full(RACK)).toBe(true));
  it('two cards exiled: two cards come from the top of the library, then the exiled two go back on top in the order given', () => {
    const s0 = scenario([], { p1: { hand: ['Test Bear', 'Test Wolf'], battlefield: ['Test Rack'] }, p2: {}, defs });
    setLibrary(s0, 'p1', ['Test Owl', 'Test Cub', 'Test Bear', 'Test Wolf']);
    const s = run(s0, ['Test Bear', 'Test Wolf'], ['Test Wolf', 'Test Bear']);
    expect(handNames(s, 'p1')).toEqual(['Test Cub', 'Test Owl']);
    expect(libNames(s, 'p1').slice(0, 2)).toEqual(['Test Wolf', 'Test Bear']);
    expect(libNames(s, 'p1').length).toBe(4);
    expect(exileNames(s)).toEqual([]);
  });
  it('the negative case: exiling none puts nothing from the library into the hand and changes nothing', () => {
    const s0 = scenario([], { p1: { hand: ['Test Bear'], battlefield: ['Test Rack'] }, p2: {}, defs });
    setLibrary(s0, 'p1', ['Test Owl', 'Test Cub']);
    const s = run(s0, []);
    expect(handNames(s, 'p1')).toEqual(['Test Bear']);
    expect(libNames(s, 'p1')).toEqual(['Test Owl', 'Test Cub']);
  });
});

describe('"Whenever an opponent attacks you and/or one or more planeswalkers you control, exile the top card of that player\'s library. You may play that card ..." (CR 508.1b, 506.3, 603.2c; Cunning Rhetoric)', () => {
  const PERSUADE = card('Test Persuasion', 'Enchantment', "Whenever an opponent attacks you and/or one or more planeswalkers you control, exile the top card of that player's library. You may play that card for as long as it remains exiled, and you may spend mana as though it were mana of any color to cast it.");
  const defs = [PERSUADE, BEAR, WOLF, OWL];
  const attackAt = (s0: GameState, defender: 'p1' | 'p2'): GameState => {
    let s = s0;
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = pass(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s0, 'Test Bear', 'battlefield', 'p1'), defender }] });
    for (let i = 0; i < 40 && !(s.turn.step === 'main2' && s.zones.stack.length === 0); i++) {
      if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (s.zones.stack.length > 0) s = resolveAll(s);
      else s = pass(s);
    }
    return s;
  };
  it('has no manual part', () => expect(full(PERSUADE)).toBe(true));
  it("the attacking opponent's top card is exiled (once for the declaration) and its owner is not asked: the Persuasion's controller may play it", () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Persuasion'] }, defs });
    setLibrary(s0, 'p1', ['Test Owl', 'Test Wolf']);
    setLibrary(s0, 'p2', ['Test Bear', 'Test Bear']);
    const s = attackAt(s0, 'p2');
    expect(exileNames(s)).toEqual(['Test Owl']);
    expect(libNames(s, 'p1')).toEqual(['Test Wolf']);
    expect(libNames(s, 'p2')).toEqual(['Test Bear', 'Test Bear']);
  });
  it('the negative case: an attack on nobody (no attackers) does not trigger it', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Persuasion'] }, defs });
    setLibrary(s0, 'p1', ['Test Owl', 'Test Wolf']);
    let s = s0;
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = pass(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [] });
    for (let i = 0; i < 40 && s.turn.step !== 'main2'; i++) s = s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] }) : pass(s);
    expect(exileNames(s)).toEqual([]);
  });
  it("the Persuasion's controller attacking is not an opponent attacking: it never triggers on their own attack", () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear', 'Test Persuasion'] }, p2: {}, defs });
    setLibrary(s0, 'p2', ['Test Owl', 'Test Wolf']);
    const s = attackAt(s0, 'p2');
    expect(exileNames(s)).toEqual([]);
  });
});

describe('"..., if there are cards exiled with ~, put them into their owner\'s graveyard, then ~ deals that much damage to each opponent." (CR 607.2a, 603.4, 400.3, 608.2h; Valakut Exploration)', () => {
  const PIT = card('Test Pit', 'Enchantment', "Whenever a land you control enters, exile the top card of your library. You may play that card for as long as it remains exiled.\nAt the beginning of your end step, if there are cards exiled with this enchantment, put them into their owner's graveyard, then this enchantment deals that much damage to each opponent.");
  const defs = [PIT, BEAR, WOLF, FOREST];
  it('has no manual part', () => expect(full(PIT)).toBe(true));
  it('a land entering exiles the top card; at the end step it goes to its owner\'s graveyard and each opponent takes 1', () => {
    let s = scenario([], { p1: { hand: ['Test Grove'], battlefield: ['Test Pit'] }, p2: {}, defs });
    setLibrary(s, 'p1', ['Test Wolf', 'Test Bear']);
    s = resolveAll(drive(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Grove', 'hand', 'p1') })));
    expect(exileNames(s)).toEqual(['Test Wolf']);
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(exileNames(s)).toEqual([]);
    expect(gyNames(s, 'p1')).toEqual(['Test Wolf']);
    expect(lifeOf(s, 'p2')).toBe(19);
  });
  it('the negative case: no card exiled means the intervening "if" fails and no damage is dealt; a card played from exile is no longer exiled with it', () => {
    let s = scenario([], { p1: { battlefield: ['Test Pit'] }, p2: {}, defs });
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(lifeOf(s, 'p2')).toBe(20);
    let t = scenario([], { p1: { hand: ['Test Grove'], battlefield: ['Test Pit'] }, p2: {}, defs });
    setLibrary(t, 'p1', ['Test Wolf', 'Test Bear']);
    t = resolveAll(drive(act(t, { type: 'playLand', player: 'p1', card: find(t, 'Test Grove', 'hand', 'p1') })));
    const exiled = find(t, 'Test Wolf', 'exile', 'p1');
    t = resolveAll(drive(act(t, { type: 'cast', player: 'p1', card: exiled })));
    t = resolveAll(advanceTo(t, 1, 'end'));
    expect(lifeOf(t, 'p2')).toBe(20); // the one card was cast, nothing was exiled with the enchantment any more
    expect(gyNames(t, 'p1')).toEqual([]);
  });
});

describe('"Spells and abilities each opponent controls can\'t cause their controller to search their library." (CR 701.23a, 101.2, 109.5; Ashiok, Dream Render)', () => {
  const DREAM = card('Test Dream', 'Creature — Wizard', "Spells and abilities each opponent controls can't cause their controller to search their library.", '{0}', ['1', '3']);
  const TUTOR = card('Test Tutor', 'Instant', 'Search your library for a creature card, put it into your hand, then shuffle.');
  const GIVE = card('Test Seek', 'Instant', "Destroy target land. That land's controller may search their library for a creature card, put it onto the battlefield, then shuffle.");
  const defs = [DREAM, TUTOR, GIVE, BEAR, WOLF, FOREST];
  // p2 casts an instant while p1 has the turn: p1 passes priority first
  const cast0 = (s0: GameState, name: string, who: 'p1' | 'p2', targets: ReturnType<typeof obj>[][] = [], answers: Parameters<typeof driveL>[1] = []) =>
    resolveL(driveL(act(who === 'p2' ? pass(s0) : s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), [], targets), answers);
  it('has no manual part', () => expect(full(DREAM)).toBe(true));
  it("an opponent's own tutor does nothing: no library is searched (the search is not performed)", () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Dream'] }, p2: { hand: ['Test Tutor'] }, defs });
    setLibrary(s0, 'p2', ['Test Bear', 'Test Wolf']);
    const s = cast0(s0, 'Test Tutor', 'p2');
    expect(s.pending?.kind === 'chooseObjects').toBe(false);
    expect(handNames(s, 'p2')).toEqual([]);
  });
  it('the negative cases: the controller of the Dream searches normally, and an opponent\'s spell that makes YOU search is not stopped (it is not their own search)', () => {
    const mine = scenario([], { p1: { battlefield: ['Test Dream'], hand: ['Test Tutor'] }, p2: {}, defs });
    setLibrary(mine, 'p1', ['Test Bear', 'Test Wolf']);
    expect(offered(cast0(mine, 'Test Tutor', 'p1'))).toEqual(['Test Bear', 'Test Wolf']);
    const made = scenario([], { p1: { battlefield: ['Test Dream', 'Test Grove'] }, p2: { hand: ['Test Seek'] }, defs });
    setLibrary(made, 'p1', ['Test Bear', 'Test Wolf']);
    const s = cast0(made, 'Test Seek', 'p2', [[obj(find(made, 'Test Grove', 'battlefield', 'p1'))]], [{ kind: 'yesNo', yes: true }]);
    expect(offered(s)).toEqual(['Test Bear', 'Test Wolf']);
  });
  it('a search by an ability whose source left the battlefield (a sacrificed fetch land) is stopped too: the source is judged as it last existed (CR 113.7a)', () => {
    const FETCH = card('Test Fetchland', 'Land', '{T}, Sacrifice this land: Search your library for a creature card, put it into your hand, then shuffle.');
    const s0 = scenario([], { p1: { battlefield: ['Test Dream'] }, p2: { battlefield: ['Test Fetchland'] }, defs: [...defs, FETCH] });
    setLibrary(s0, 'p2', ['Test Bear', 'Test Wolf']);
    const s1 = pass(s0);
    const la = legalActions(s1, 'p2').find((a) => a.kind === 'activate' && !a.isMana && a.object === find(s1, 'Test Fetchland', 'battlefield', 'p2'));
    expect(la, 'the activation').toBeDefined();
    const s = resolveL(driveL(act(s1, la!.action)));
    expect(s.pending?.kind === 'chooseObjects').toBe(false);
    expect(handNames(s, 'p2')).toEqual([]);
    const free = scenario([], { p2: { battlefield: ['Test Fetchland'] }, defs: [...defs, FETCH] });
    setLibrary(free, 'p2', ['Test Bear', 'Test Wolf']);
    const f1 = pass(free);
    const lb = legalActions(f1, 'p2').find((a) => a.kind === 'activate' && !a.isMana && a.object === find(f1, 'Test Fetchland', 'battlefield', 'p2'));
    expect(offered(resolveL(driveL(act(f1, lb!.action))))).toEqual(['Test Bear', 'Test Wolf']);
  });
  it("searching ANOTHER player's library with an opponent's spell is not stopped (\"their library\" is the searcher's own)", () => {
    const TAKE = card('Test Take', 'Instant', "Search target opponent's library for a creature card and exile it face down. Then that player shuffles.");
    const s0 = scenario([], { p1: { battlefield: ['Test Dream'] }, p2: { hand: ['Test Take'] }, defs: [...defs, TAKE] });
    setLibrary(s0, 'p1', ['Test Bear', 'Test Wolf']);
    expect(offered(cast0(s0, 'Test Take', 'p2', [[{ kind: 'player', id: 'p1' } as never]]))).toEqual(['Test Bear', 'Test Wolf']);
  });
  it('without the Dream the opponent\'s tutor works', () => {
    const s0 = scenario([], { p2: { hand: ['Test Tutor'] }, defs });
    setLibrary(s0, 'p2', ['Test Bear', 'Test Wolf']);
    expect(offered(cast0(s0, 'Test Tutor', 'p2'))).toEqual(['Test Bear', 'Test Wolf']);
  });
});

void named;
