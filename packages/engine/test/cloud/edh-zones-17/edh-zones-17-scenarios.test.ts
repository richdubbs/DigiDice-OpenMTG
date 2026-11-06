/**
 * edh-zones-17 (Commander lane edh-zones): the round's readings played through the engine with synthetic cards (invented names, design 6.10). CR cites checked against the
 * 2026-09-25 text (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt).
 *
 *   CR 701.17a, 608.2c, 603.4   "Whenever ~ deals combat damage to a player, you may mill that many cards. If you do, you may put a creature card from among them into your hand." (Barrowgoyf)
 *   CR 510.2, 603.4, 120.1      "At the beginning of your second main phase, if a player was dealt combat damage by a Zombie this turn, mill three cards, then you may return a creature
 *                               card from your graveyard to your hand." (Lost Monarch of Ifnir)
 *   CR 701.21a, 121.1, 401.7    "When ~ enters, sacrifice any number of other permanents, then draw that many cards." and "When ~ dies or is put into exile from the battlefield, you may put
 *                               ~ into ~'s owner's library third from the top." (God-Eternal Bontu)
 *   CR 613.1d, 604.1, 605.1a     "As long as there are fewer than eight cards in your graveyard, ~ isn't a creature." and "{T}, Mill a card: Target player adds one mana of any color."
 *                               (The Warring Triad; an ability with a target is not a mana ability)
 *   CR 701.25a, 608.2c, 601.2a  "Surveil 2, then choose an instant or sorcery card in your graveyard. You may cast it this turn. If that spell would be put into your graveyard, exile it
 *                               instead." (Mission Briefing)
 */
import { describe, expect, it } from 'vitest';
import { put, advanceTo, pass, answer, pool } from '../../m3/scenario';
import { legalActions, type GameState } from '../../../src/index';
import { act, card, cast, drive, find, full, lifeOf, obj, resolveAll, scenario } from '../r3-cost/support';
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
const GHOUL = card('Test Ghoul', 'Creature — Zombie', '', '{0}', ['2', '2']);
const OWL = card('Test Owl', 'Creature — Bird', '', '{0}', ['1', '1']);
const FOREST = card('Test Grove', 'Basic Land — Forest', '');

/** Attack with the named creature of p1 at p2, p2 blocking with `blockers` (if any), until a decision comes up or p1 has priority in the second main phase. */
function attack(s0: GameState, attacker: string, blocks: { blocker: string }[] = []): GameState {
  let s = s0;
  for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = pass(s);
  s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s0, attacker, 'battlefield', 'p1'), defender: 'p2' }] });
  for (let i = 0; i < 60 && !(s.turn.step === 'main2' && s.pending?.kind === 'priority'); i++) {
    if (s.pending?.kind === 'declareBlockers') {
      s = answer(s, { kind: 'declareBlockers', blocks: blocks.map((b) => ({ blocker: find(s0, b.blocker, 'battlefield', 'p2'), attacker: find(s0, attacker, 'battlefield', 'p1') })) });
    } else if (s.pending && s.pending.kind !== 'priority') break;
    else s = pass(s);
  }
  return s;
}
/** Both players pass until the stack is empty or a decision (a "may", a choice) comes up for the trigger being resolved. */
function toDecision(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; i++) s = pass(pass(s));
  return s;
}

describe('"Whenever ~ deals combat damage to a player, you may mill that many cards. If you do, you may put a creature card from among them into your hand." (CR 701.17a, 608.2c; Barrowgoyf)', () => {
  const GOYF = card('Test Goyf', 'Creature — Goyf', 'Whenever ~ deals combat damage to a player, you may mill that many cards. If you do, you may put a creature card from among them into your hand.', '{0}', ['3', '3']);
  const defs = [GOYF, BEAR, WOLF, OWL, FOREST];
  it('has no manual part', () => expect(full(GOYF)).toBe(true));
  it('mills as many cards as the damage dealt and takes one creature card from among those milled cards into the hand (a land milled with them is not offered)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Goyf'] }, p2: {}, defs });
    setLibrary(s0, 'p1', ['Test Grove', 'Test Owl', 'Test Wolf', 'Test Bear']);
    let s = attack(s0, 'Test Goyf');
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(s.pending?.kind).toBe('yesNo');
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(gyNames(s, 'p1')).toEqual(['Test Grove', 'Test Owl', 'Test Wolf']);
    expect(offered(s)).toEqual(['Test Owl', 'Test Wolf']);
    const wolf = (s.pending as unknown as { options: string[] }).options.find((id) => nameOf(s, id) === 'Test Wolf')!;
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [wolf] }));
    expect(handNames(s, 'p1')).toEqual(['Test Wolf']);
    expect(gyNames(s, 'p1')).toEqual(['Test Grove', 'Test Owl']);
    expect(libNames(s, 'p1')).toEqual(['Test Bear']);
  });
  it('the negative cases: declining the mill mills nothing and asks nothing more; milling and choosing no creature takes nothing; a creature already in the graveyard is not offered', () => {
    const declined = scenario([], { p1: { battlefield: ['Test Goyf'], graveyard: ['Test Bear'] }, p2: {}, defs });
    setLibrary(declined, 'p1', ['Test Owl', 'Test Wolf', 'Test Bear', 'Test Bear']);
    let s = attack(declined, 'Test Goyf');
    s = answer(s, { kind: 'yesNo', yes: false });
    expect(s.pending?.kind).toBe('priority');
    expect(libNames(s, 'p1')).toEqual(['Test Owl', 'Test Wolf', 'Test Bear', 'Test Bear']);
    expect(handNames(s, 'p1')).toEqual([]);
    const none = scenario([], { p1: { battlefield: ['Test Goyf'], graveyard: ['Test Bear'] }, p2: {}, defs });
    setLibrary(none, 'p1', ['Test Owl', 'Test Wolf', 'Test Grove', 'Test Bear']);
    let t = attack(none, 'Test Goyf');
    t = answer(t, { kind: 'yesNo', yes: true });
    expect(offered(t)).toEqual(['Test Owl', 'Test Wolf']); // the Bear that was already there is not among the milled cards
    t = resolveAll(answer(t, { kind: 'chooseObjects', ids: [] }));
    expect(handNames(t, 'p1')).toEqual([]);
    expect(gyNames(t, 'p1')).toEqual(['Test Bear', 'Test Grove', 'Test Owl', 'Test Wolf']);
  });
  it('a blocked Goyf deals combat damage to the blocker, not to a player: nothing triggers', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Goyf'] }, p2: { battlefield: ['Test Bear'] }, defs });
    setLibrary(s0, 'p1', ['Test Owl', 'Test Wolf', 'Test Bear', 'Test Bear']);
    const s = attack(s0, 'Test Goyf', [{ blocker: 'Test Bear' }]);
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(s.pending?.kind).toBe('priority');
    expect(gyNames(s, 'p1')).toEqual([]);
  });
});

describe('"At the beginning of your second main phase, if a player was dealt combat damage by a Zombie this turn, mill three cards, then you may return a creature card from your graveyard to your hand." (CR 510.2, 603.4; Lost Monarch of Ifnir)', () => {
  const MONARCH = card('Test Monarch', 'Creature — Zombie Noble', 'At the beginning of your second main phase, if a player was dealt combat damage by a Zombie this turn, mill three cards, then you may return a creature card from your graveyard to your hand.', '{0}', ['1', '1']);
  const defs = [MONARCH, GHOUL, BEAR, WOLF, OWL, FOREST];
  it('has no manual part', () => expect(full(MONARCH)).toBe(true));
  it('a Zombie that dealt combat damage to a player: three cards are milled and a creature card comes back', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Monarch', 'Test Ghoul'] }, p2: {}, defs });
    setLibrary(s0, 'p1', ['Test Grove', 'Test Owl', 'Test Wolf', 'Test Bear']);
    let s = attack(s0, 'Test Ghoul');
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(s.turn.step).toBe('main2');
    s = toDecision(s);
    expect(s.pending?.kind).toBe('yesNo');
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(offered(s)).toEqual(['Test Owl', 'Test Wolf']);
    const owl = (s.pending as unknown as { options: string[] }).options.find((id) => nameOf(s, id) === 'Test Owl')!;
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [owl] }));
    expect(handNames(s, 'p1')).toEqual(['Test Owl']);
    expect(gyNames(s, 'p1')).toEqual(['Test Grove', 'Test Wolf']);
    expect(libNames(s, 'p1')).toEqual(['Test Bear']);
  });
  it('the negative cases: a non-Zombie dealing the damage, a Zombie that was blocked, and no attack at all do not trigger it (the intervening "if" fails, CR 603.4)', () => {
    const bear = scenario([], { p1: { battlefield: ['Test Monarch', 'Test Bear'] }, p2: {}, defs });
    setLibrary(bear, 'p1', ['Test Grove', 'Test Owl', 'Test Wolf', 'Test Bear']);
    let s = toDecision(attack(bear, 'Test Bear'));
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(s.zones.stack.length).toBe(0); // nothing triggered
    expect(gyNames(s, 'p1')).toEqual([]);
    expect(s.pending?.kind).toBe('priority');
    const blocked = scenario([], { p1: { battlefield: ['Test Monarch', 'Test Ghoul'] }, p2: { battlefield: ['Test Wolf'] }, defs });
    setLibrary(blocked, 'p1', ['Test Grove', 'Test Owl', 'Test Wolf', 'Test Bear']);
    s = toDecision(attack(blocked, 'Test Ghoul', [{ blocker: 'Test Wolf' }]));
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(s.zones.stack.length).toBe(0);
    expect(gyNames(s, 'p1')).toEqual(['Test Ghoul']); // it died in the fight; nothing was milled
    expect(libNames(s, 'p1').slice(0, 4)).toEqual(['Test Grove', 'Test Owl', 'Test Wolf', 'Test Bear']);
    const idle = scenario([], { p1: { battlefield: ['Test Monarch', 'Test Ghoul'] }, p2: {}, defs });
    setLibrary(idle, 'p1', ['Test Grove', 'Test Owl', 'Test Wolf', 'Test Bear']);
    s = toDecision(advanceTo(idle, 1, 'main2'));
    expect(s.zones.stack.length).toBe(0);
    expect(gyNames(s, 'p1')).toEqual([]);
  });
  it('the history is of the turn: after a turn in which a Zombie connected, the next turn without an attack starts clean', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Monarch', 'Test Ghoul'] }, p2: {}, defs });
    setLibrary(s0, 'p1', ['Test Grove', 'Test Owl', 'Test Wolf', 'Test Bear', 'Test Bear', 'Test Wolf']);
    let s = toDecision(attack(s0, 'Test Ghoul'));
    s = resolveAll(answer(s, { kind: 'yesNo', yes: false }));
    const milled = gyNames(s, 'p1').length;
    expect(milled).toBe(3);
    s = toDecision(advanceTo(s, 3, 'main2')); // p1's next turn: no attack declared, so no Zombie dealt damage that turn
    expect(s.zones.stack.length).toBe(0);
    expect(gyNames(s, 'p1').length).toBe(milled);
  });
});

describe('"When ~ enters, sacrifice any number of other permanents, then draw that many cards." and "When ~ dies or is put into exile from the battlefield, you may put ~ into ~\'s owner\'s library third from the top." (CR 701.21a, 121.1, 401.7; God-Eternal Bontu)', () => {
  const GOD = card('Test God', 'Legendary Creature — Zombie God', "Menace\nWhen ~ enters, sacrifice any number of other permanents, then draw that many cards.\nWhen ~ dies or is put into exile from the battlefield, you may put ~ into ~'s owner's library third from the top.", '{0}', ['5', '4']);
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
  const BAUBLE = card('Test Bauble', 'Artifact', '');
  const defs = [GOD, KILL, BAUBLE, BEAR, OWL, WOLF, FOREST];
  it('has no manual part', () => expect(full(GOD)).toBe(true));
  it('the permanents chosen are sacrificed and as many cards are drawn; the God itself is not among them and a permanent of the opponent is not offered', () => {
    let s = scenario([], { p1: { hand: ['Test God'], battlefield: ['Test Bear', 'Test Bauble', 'Test Grove'] }, p2: { battlefield: ['Test Bear'] }, defs });
    setLibrary(s, 'p1', ['Test Owl', 'Test Wolf', 'Test Bear', 'Test Bear']);
    s = toDecision(cast(s, 'Test God'));
    expect(s.pending?.kind).toBe('chooseObjects');
    const names = offered(s);
    expect(names).toEqual(['Test Bauble', 'Test Bear', 'Test Grove']); // only p1's other permanents
    const pick = (s.pending as unknown as { options: string[] }).options.filter((id) => ['Test Bauble', 'Test Grove'].includes(nameOf(s, id)));
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: pick }));
    expect(bfNames(s, 'p1')).toEqual(['Test Bear', 'Test God']);
    expect(bfNames(s, 'p2')).toEqual(['Test Bear']);
    expect(handNames(s, 'p1').length).toBe(2);
  });
  it('the negative case: sacrificing nothing draws nothing', () => {
    let s = scenario([], { p1: { hand: ['Test God'], battlefield: ['Test Bear'] }, p2: {}, defs });
    const before = s.zones.hand.p1!.length;
    s = toDecision(cast(s, 'Test God'));
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [] }));
    expect(bfNames(s, 'p1')).toEqual(['Test Bear', 'Test God']);
    expect(handNames(s, 'p1').length).toBe(before - 1);
  });
  it('when it dies the controller may put it third from the top of its owner\'s library; declining leaves it in the graveyard', () => {
    const mine = scenario([], { p1: { hand: ['Test Kill'], battlefield: ['Test God'] }, p2: {}, defs });
    setLibrary(mine, 'p1', ['Test Owl', 'Test Wolf', 'Test Bear', 'Test Bear']);
    let t = drive(act(mine, { type: 'cast', player: 'p1', card: find(mine, 'Test Kill', 'hand', 'p1') }), { targets: [[obj(find(mine, 'Test God', 'battlefield', 'p1'))]] });
    t = resolveAll(t, { yes: [true] });
    expect(gyNames(t, 'p1')).toEqual(['Test Kill']);
    expect(libNames(t, 'p1')).toEqual(['Test Owl', 'Test Wolf', 'Test God', 'Test Bear', 'Test Bear']);
    let u = drive(act(mine, { type: 'cast', player: 'p1', card: find(mine, 'Test Kill', 'hand', 'p1') }), { targets: [[obj(find(mine, 'Test God', 'battlefield', 'p1'))]] });
    u = resolveAll(u, { yes: [false] });
    expect(gyNames(u, 'p1')).toEqual(['Test God', 'Test Kill']);
    expect(libNames(u, 'p1')).toEqual(['Test Owl', 'Test Wolf', 'Test Bear', 'Test Bear']);
  });
  it('the same when it is put into exile from the battlefield; a token or another creature dying does not trigger it', () => {
    const PURGE = card('Test Purge', 'Instant', 'Exile target creature.');
    const mine = scenario([], { p1: { hand: ['Test Purge'], battlefield: ['Test God', 'Test Bear'] }, p2: {}, defs: [...defs, PURGE] });
    setLibrary(mine, 'p1', ['Test Owl', 'Test Wolf', 'Test Bear', 'Test Bear']);
    const t = resolveAll(drive(act(mine, { type: 'cast', player: 'p1', card: find(mine, 'Test Purge', 'hand', 'p1') }), { targets: [[obj(find(mine, 'Test God', 'battlefield', 'p1'))]] }), { yes: [true] });
    expect(exileNames(t)).toEqual([]);
    expect(libNames(t, 'p1')).toEqual(['Test Owl', 'Test Wolf', 'Test God', 'Test Bear', 'Test Bear']);
    const other = resolveAll(drive(act(mine, { type: 'cast', player: 'p1', card: find(mine, 'Test Purge', 'hand', 'p1') }), { targets: [[obj(find(mine, 'Test Bear', 'battlefield', 'p1'))]] }), { yes: [true] });
    expect(libNames(other, 'p1')).toEqual(['Test Owl', 'Test Wolf', 'Test Bear', 'Test Bear']);
    expect(bfNames(other, 'p1')).toEqual(['Test God']);
  });
});

describe('"As long as there are fewer than eight cards in your graveyard, ~ isn\'t a creature." and "{T}, Mill a card: Target player adds one mana of any color." (CR 613.1d, 604.1, 605.1a, 106.4; The Warring Triad)', () => {
  const TRIAD = card('Test Triad', 'Legendary Artifact Creature — God', "Flying, trample, haste\nAs long as there are fewer than eight cards in your graveyard, ~ isn't a creature.\n{T}, Mill a card: Target player adds one mana of any color.", '{0}', ['7', '7']);
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
  const defs = [TRIAD, KILL, BEAR, WOLF, OWL];
  const grave = (n: number): string[] => Array.from({ length: n }, () => 'Test Bear');
  const isCreature = (s: GameState, name: string): boolean => getChars(s, find(s, name, 'battlefield', 'p1')).types.includes('Creature');
  it('has no manual part', () => expect(full(TRIAD)).toBe(true));
  it('with seven cards in the graveyard it is not a creature; with eight it is', () => {
    expect(isCreature(scenario([], { p1: { battlefield: ['Test Triad'], graveyard: grave(7) }, p2: {}, defs }), 'Test Triad')).toBe(false);
    expect(isCreature(scenario([], { p1: { battlefield: ['Test Triad'], graveyard: grave(8) }, p2: {}, defs }), 'Test Triad')).toBe(true);
    expect(isCreature(scenario([], { p1: { battlefield: ['Test Triad'] }, p2: {}, defs }), 'Test Triad')).toBe(false);
  });
  it("the count is of your own graveyard: eight cards in an opponent's graveyard do not make it a creature", () => {
    expect(isCreature(scenario([], { p1: { battlefield: ['Test Triad'], graveyard: grave(3) }, p2: { graveyard: grave(8) }, defs }), 'Test Triad')).toBe(false);
  });
  it("the ability has a target, so it uses the stack: the targeted opponent adds the mana (their choice of color) and the Triad's controller gets none; the mill is paid as a cost", () => {
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Triad', since: 1 }] }, p2: {}, defs });
    setLibrary(s0, 'p1', ['Test Owl', 'Test Wolf', 'Test Bear']);
    const la = legalActions(s0, 'p1').filter((a) => a.kind === 'activate' && a.object === find(s0, 'Test Triad', 'battlefield', 'p1'));
    expect(la.length).toBe(1);
    expect(la[0]!.isMana).not.toBe(true);
    let s = drive(act(s0, la[0]!.action), { targets: [[{ kind: 'player', id: 'p2' }]], colors: ['G'] });
    s = resolveAll(s, { colors: ['G'] });
    expect(pool(s, 'p2')).toBe('G');
    expect(pool(s, 'p1')).toBe('');
    expect(gyNames(s, 'p1')).toEqual(['Test Owl']);
  });
  it('you can target yourself: you add the mana', () => {
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Triad', since: 1 }] }, p2: {}, defs });
    setLibrary(s0, 'p1', ['Test Owl', 'Test Wolf', 'Test Bear']);
    const la = legalActions(s0, 'p1').filter((a) => a.kind === 'activate' && a.object === find(s0, 'Test Triad', 'battlefield', 'p1'));
    const s = resolveAll(drive(act(s0, la[0]!.action), { targets: [[{ kind: 'player', id: 'p1' }]], colors: ['U'] }), { colors: ['U'] });
    expect(pool(s, 'p1')).toBe('U');
    expect(pool(s, 'p2')).toBe('');
  });
});

describe('"Surveil 2, then choose an instant or sorcery card in your graveyard. You may cast it this turn. If that spell would be put into your graveyard, exile it instead." (CR 701.25a, 608.2c, 601.2a, 614.1a; Mission Briefing)', () => {
  const BRIEF = card('Test Briefing', 'Instant', 'Surveil 2, then choose an instant or sorcery card in your graveyard. You may cast it this turn. If that spell would be put into your graveyard, exile it instead.');
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 2 damage to any target.');
  const SAGE = card('Test Sage', 'Sorcery', 'You gain 3 life.');
  const defs = [BRIEF, BOLT, SAGE, BEAR, OWL, WOLF];
  /** Answer the surveil (nothing to the graveyard, the rest ordered as offered) and stop at the next choice, the card of the graveyard. */
  const surveilNothing = (s0: GameState): GameState => {
    let s = s0;
    for (let g = 0; g < 6 && s.pending && s.pending.kind !== 'priority'; g++) {
      const p = s.pending as unknown as { kind: string; options?: string[]; items?: { id: string }[] };
      if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items!.map((i) => i.id) });
      else if (p.kind === 'chooseObjects' && (p.options ?? []).every((id) => s.objects[id]!.zone === 'library')) s = answer(s, { kind: 'chooseObjects', ids: [] });
      else break;
    }
    return s;
  };
  /** Cast the Briefing, keep both surveilled cards on top, and stop at the choice. */
  const toChoice = (s0: GameState): GameState => surveilNothing(pass(pass(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Briefing', 'hand', 'p1') })))));
  it('has no manual part', () => expect(full(BRIEF)).toBe(true));
  it("only an instant or sorcery card of your own graveyard is offered (not a creature card, not the opponent's card); the chosen one may be cast this turn and is exiled afterwards", () => {
    const s0 = scenario([], { p1: { hand: ['Test Briefing'], graveyard: ['Test Bolt', 'Test Sage', 'Test Bear'] }, p2: { graveyard: ['Test Bolt'] }, defs });
    setLibrary(s0, 'p1', ['Test Owl', 'Test Wolf', 'Test Bear']);
    let s = toChoice(s0);
    expect(offered(s)).toEqual(['Test Bolt', 'Test Sage']);
    const bolt = (s.pending as unknown as { options: string[] }).options.find((id) => nameOf(s, id) === 'Test Bolt')!;
    s = answer(s, { kind: 'chooseObjects', ids: [bolt] });
    expect(s.pending?.kind).toBe('priority');
    expect(s.zones.stack.length).toBe(0); // the Briefing itself is already in the graveyard
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: bolt }), { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(exileNames(s)).toEqual(['Test Bolt']); // the spell went to exile instead of the graveyard
    expect(gyNames(s, 'p1')).toEqual(['Test Bear', 'Test Briefing', 'Test Sage']);
  });
  it('the negative cases: the card not chosen cannot be cast from the graveyard, and the permission ends with the turn', () => {
    const s0 = scenario([], { p1: { hand: ['Test Briefing'], graveyard: ['Test Bolt', 'Test Sage'] }, p2: {}, defs });
    setLibrary(s0, 'p1', ['Test Owl', 'Test Wolf', 'Test Bear']);
    const s = toChoice(s0);
    const sage = (s.pending as unknown as { options: string[] }).options.find((id) => nameOf(s, id) === 'Test Sage')!;
    const t = answer(s, { kind: 'chooseObjects', ids: [sage] });
    const castable = legalActions(t, 'p1').filter((a) => a.kind === 'cast').map((a) => nameOf(t, (a.action as unknown as { card: string }).card));
    expect(castable).toContain('Test Sage');
    expect(castable).not.toContain('Test Bolt');
    const later = advanceTo(t, 3, 'main1');
    const castableLater = legalActions(later, 'p1').filter((a) => a.kind === 'cast').map((a) => nameOf(later, (a.action as unknown as { card: string }).card));
    expect(castableLater).not.toContain('Test Sage');
  });
  it('with no instant or sorcery card in the graveyard nothing is chosen and nothing can be cast', () => {
    const s0 = scenario([], { p1: { hand: ['Test Briefing'], graveyard: ['Test Bear'] }, p2: {}, defs });
    setLibrary(s0, 'p1', ['Test Owl', 'Test Wolf', 'Test Bear']);
    const s = toChoice(s0);
    expect(s.pending?.kind).toBe('priority');
    expect(legalActions(s, 'p1').filter((a) => a.kind === 'cast').length).toBe(0);
  });
});
