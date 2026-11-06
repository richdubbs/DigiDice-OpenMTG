/**
 * edh-players-6 (Commander lane edh-players): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names,
 * wordings of the rules text, design 6.10). Each test is named after the rule it checks, with its negative case.
 *
 *   CR 606.3, 602.5b               "You may activate the loyalty abilities of planeswalkers you control twice each turn rather than only once": a second activation; never a third
 *   CR 606.3, 611.2c               "For each planeswalker you control, you may activate one of its loyalty abilities once this turn as though none ... have been activated": only the ones you control as it resolves
 *   CR 606.1, 602.5                "Loyalty abilities can't be activated": a planeswalker's, not another activated ability
 *   CR 603.4, 606.3                "At the beginning of your end step, if you didn't activate a loyalty ability of a planeswalker this turn, you lose 2 life"
 *   CR 504.1, 121.1                "At the beginning of your draw step, draw an additional card"
 *   CR 701.17a, 608.2f             "Each opponent mills cards equal to the number of cards in their hand": each opponent's own hand
 *   CR 119.3, 608.2f               "Each opponent loses 1 life for each creature card in that player's graveyard": each opponent's own graveyard
 *   CR 120.3, 608.2f               "~ deals damage to each opponent equal to the number of tapped creatures that opponent controls": each opponent's own creatures
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard, type PlayerId } from '../../../src/index';
import { act, advanceTo, answer, find, life, pass, put, reject, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers, tweak } from '../../m4/helpers';
import { getChars } from '../../../src/rules/characteristics';
import { mpScenario, lifeOf } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as unknown as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const BASICS = ['Mountain', 'Island', 'Swamp', 'Forest', 'Plains'];
const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;

/** Answer what comes up (automatic payment, yes to "may", the first objects offered) until the next priority decision with an empty stack. */
let xAnswer: number | undefined;
function settleAll(s0: GameState): GameState {
  let s = s0;
  for (let guard = 0; guard < 60; guard++) {
    const p = s.pending;
    if (p?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p?.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (p?.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: xAnswer ?? p.max });
    else if (p?.kind === 'priority' && s.zones.stack.length > 0) s = pass(s);
    else if (p?.kind === 'priority' && s.zones.stack.length === 0) return s;
    else if (!p) return s;
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const activate = (s: GameState, name: string, ability: string, player: PlayerId = 'p1'): GameState =>
  settleAll(act(s, { type: 'activate', player, source: find(s, name, 'battlefield', player), ability }));
/** A planeswalker with enough loyalty for several +1 activations. */
const withWalker = (s: GameState, name: string, player: PlayerId = 'p1'): GameState => tweak(s, (x) => { x.objects[put(x, player, 'battlefield', name)]!.counters['loyalty'] = 5; });

const WALKER = card('Test Walker', 'Legendary Planeswalker — Testa', '+1: You gain 1 life.');
const WALKER2 = card('Test Second Walker', 'Legendary Planeswalker — Testa', '+1: You gain 1 life.');
const LATE_WALKER = card('Test Late Walker', 'Legendary Planeswalker — Testa', '+1: You gain 1 life.');

describe('CR 606.3, 602.5b: "You may activate the loyalty abilities of planeswalkers you control twice each turn rather than only once."', () => {
  const STONE = card('Test Oath Stone', 'Legendary Enchantment', 'You may activate the loyalty abilities of planeswalkers you control twice each turn rather than only once.');
  const defs = [STONE, WALKER, WALKER2];
  it('is understood', () => expect(noManual(STONE)).toBe(true));
  it('a second activation of the same planeswalker is allowed; a third is not', () => {
    let s = withWalker(scenario(BASICS, { p1: { battlefield: ['Test Oath Stone'] }, defs }), 'Test Walker');
    const l0 = life(s, 'p1');
    s = activate(s, 'Test Walker', 'p:0:0');
    s = activate(s, 'Test Walker', 'p:0:0');
    expect(life(s, 'p1')).toBe(l0 + 2);
    const r = reject(s, { type: 'activate', player: 'p1', source: find(s, 'Test Walker', 'battlefield', 'p1'), ability: 'p:0:0' });
    expect(r.rules).toContain('CR 606.3');
    expect(r.message).toMatch(/Only 2 loyalty abilities/);
  });
  it('two such permanents still allow two activations, not three (ruling)', () => {
    const STONE2 = card('Test Oath Stone Two', 'Legendary Enchantment', 'You may activate the loyalty abilities of planeswalkers you control twice each turn rather than only once.');
    let s = withWalker(scenario(BASICS, { p1: { battlefield: ['Test Oath Stone', 'Test Oath Stone Two'] }, defs: [...defs, STONE2] }), 'Test Walker');
    s = activate(s, 'Test Walker', 'p:0:0');
    s = activate(s, 'Test Walker', 'p:0:0');
    expect(reject(s, { type: 'activate', player: 'p1', source: find(s, 'Test Walker', 'battlefield', 'p1'), ability: 'p:0:0' }).message).toMatch(/Only 2 loyalty abilities/);
  });
  it('without the permission the second activation is refused (the rule of one each turn)', () => {
    let s = withWalker(scenario(BASICS, { defs }), 'Test Walker');
    s = activate(s, 'Test Walker', 'p:0:0');
    const r = reject(s, { type: 'activate', player: 'p1', source: find(s, 'Test Walker', 'battlefield', 'p1'), ability: 'p:0:0' });
    expect(r.message).toMatch(/Only one loyalty ability/);
  });
  it('another planeswalker keeps its own count: one activation each, then the second of either', () => {
    let s = withWalker(withWalker(scenario(BASICS, { p1: { battlefield: ['Test Oath Stone'] }, defs }), 'Test Walker'), 'Test Second Walker');
    s = activate(s, 'Test Walker', 'p:0:0');
    s = activate(s, 'Test Second Walker', 'p:0:0');
    s = activate(s, 'Test Second Walker', 'p:0:0');
    expect(reject(s, { type: 'activate', player: 'p1', source: find(s, 'Test Second Walker', 'battlefield', 'p1'), ability: 'p:0:0' }).rules).toContain('CR 606.3');
    s = activate(s, 'Test Walker', 'p:0:0'); // its second one
  });
  it('the count starts again next turn', () => {
    let s = withWalker(scenario(BASICS, { p1: { battlefield: ['Test Oath Stone'] }, defs }), 'Test Walker');
    s = activate(s, 'Test Walker', 'p:0:0');
    s = activate(s, 'Test Walker', 'p:0:0');
    s = advanceTo(s, 3, 'main1');
    s = activate(s, 'Test Walker', 'p:0:0');
    expect(s.turn.number).toBe(3);
  });
  it("an opponent's planeswalker does not get it (\"planeswalkers you control\")", () => {
    let s = withWalker(scenario(BASICS, { p1: { battlefield: ['Test Oath Stone'] }, defs }), 'Test Walker', 'p2');
    s = tweak(s, (x) => { x.turn.activePlayer = 'p2'; x.pending = { kind: 'priority', player: 'p2', prompt: '' } as never; });
    s = activate(s, 'Test Walker', 'p:0:0', 'p2');
    expect(reject(s, { type: 'activate', player: 'p2', source: find(s, 'Test Walker', 'battlefield', 'p2'), ability: 'p:0:0' }).message).toMatch(/Only one loyalty ability/);
  });
});

describe('CR 606.3, 611.2c: "For each planeswalker you control, you may activate one of its loyalty abilities once this turn as though none of its loyalty abilities have been activated this turn."', () => {
  const VEIL = card('Test Chain Charm', 'Legendary Artifact', '{T}: For each planeswalker you control, you may activate one of its loyalty abilities once this turn as though none of its loyalty abilities have been activated this turn.');
  const defs = [VEIL, WALKER, WALKER2, LATE_WALKER];
  const start = (): GameState => withWalker(withWalker(tweak(scenario(BASICS, { p1: { battlefield: ['Test Chain Charm'] }, defs }), (x) => { x.objects[find(x, 'Test Chain Charm', 'battlefield', 'p1')]!.controlledSinceTurn = 0; }), 'Test Walker'), 'Test Second Walker');
  it('is understood', () => expect(noManual(VEIL)).toBe(true));
  it('each planeswalker you controlled may activate one more time: one that already used its activation, and one that did not', () => {
    let s = start();
    const l0 = life(s, 'p1');
    s = activate(s, 'Test Walker', 'p:0:0');
    s = activate(s, 'Test Chain Charm', 'p:0:0');
    s = activate(s, 'Test Walker', 'p:0:0'); // its second
    expect(reject(s, { type: 'activate', player: 'p1', source: find(s, 'Test Walker', 'battlefield', 'p1'), ability: 'p:0:0' }).rules).toContain('CR 606.3'); // not a third
    s = activate(s, 'Test Second Walker', 'p:0:0');
    s = activate(s, 'Test Second Walker', 'p:0:0'); // and the other walker's second
    expect(life(s, 'p1')).toBe(l0 + 4);
  });
  it('a planeswalker that enters after it resolved gets the extra activation too (a rule change, CR 611.2c; Gatherer ruling)', () => {
    let s = start();
    s = activate(s, 'Test Chain Charm', 'p:0:0');
    s = withWalker(s, 'Test Late Walker');
    s = activate(s, 'Test Late Walker', 'p:0:0');
    s = activate(s, 'Test Late Walker', 'p:0:0');
    expect(reject(s, { type: 'activate', player: 'p1', source: find(s, 'Test Late Walker', 'battlefield', 'p1'), ability: 'p:0:0' }).rules).toContain('CR 606.3');
  });
  it('two resolutions give two more', () => {
    let s = start();
    s = tweak(s, (x) => { x.objects[find(x, 'Test Chain Charm', 'battlefield', 'p1')]!.tapped = false; });
    s = activate(s, 'Test Chain Charm', 'p:0:0');
    s = tweak(s, (x) => { x.objects[find(x, 'Test Chain Charm', 'battlefield', 'p1')]!.tapped = false; });
    s = activate(s, 'Test Chain Charm', 'p:0:0');
    for (let i = 0; i < 3; i++) s = activate(s, 'Test Walker', 'p:0:0');
    expect(reject(s, { type: 'activate', player: 'p1', source: find(s, 'Test Walker', 'battlefield', 'p1'), ability: 'p:0:0' }).rules).toContain('CR 606.3');
  });
  it('it lasts the turn only: next turn the usual one activation', () => {
    let s = start();
    s = activate(s, 'Test Chain Charm', 'p:0:0');
    s = advanceTo(s, 3, 'main1');
    s = activate(s, 'Test Walker', 'p:0:0');
    expect(reject(s, { type: 'activate', player: 'p1', source: find(s, 'Test Walker', 'battlefield', 'p1'), ability: 'p:0:0' }).message).toMatch(/Only one loyalty ability/);
  });
});

describe('CR 606.1, 602.5: "Loyalty abilities can\'t be activated."', () => {
  const DAMPER = card('Test Quiet Stone', 'Legendary Artifact', "Loyalty abilities can't be activated.\n{T}: Draw a card.");
  const defs = [DAMPER, WALKER];
  it('is understood', () => expect(noManual(DAMPER)).toBe(true));
  it("a planeswalker's loyalty ability is refused for every player; another activated ability still works", () => {
    let s = withWalker(tweak(scenario(BASICS, { p1: { battlefield: ['Test Quiet Stone'] }, defs }), (x) => { x.objects[find(x, 'Test Quiet Stone', 'battlefield', 'p1')]!.controlledSinceTurn = 0; }), 'Test Walker');
    expect(reject(s, { type: 'activate', player: 'p1', source: find(s, 'Test Walker', 'battlefield', 'p1'), ability: 'p:0:0' }).rules).toContain('CR 602.5');
    const hand = handSize(s, 'p1');
    s = settleAll(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Quiet Stone', 'battlefield', 'p1'), ability: 'p:0:1' }));
    expect(handSize(s, 'p1')).toBe(hand + 1);
  });
});

describe('CR 603.4, 606.3: "At the beginning of your end step, if you didn\'t activate a loyalty ability of a planeswalker this turn, you lose 2 life."', () => {
  const VEIL = card('Test Pining Charm', 'Legendary Artifact', "At the beginning of your end step, if you didn't activate a loyalty ability of a planeswalker this turn, you lose 2 life.");
  const defs = [VEIL, WALKER, WALKER2];
  const start = (): GameState => withWalker(scenario(BASICS, { p1: { battlefield: ['Test Pining Charm'] }, defs }), 'Test Walker');
  it('is understood', () => expect(noManual(VEIL)).toBe(true));
  it('with no loyalty ability activated you lose 2 life at the end step', () => {
    let s = start();
    const l0 = life(s, 'p1');
    s = settleAll(advanceTo(s, 1, 'end'));
    expect(life(s, 'p1')).toBe(l0 - 2);
  });
  it('with one activated you lose nothing', () => {
    let s = start();
    const l0 = life(s, 'p1');
    s = activate(s, 'Test Walker', 'p:0:0');
    s = settleAll(advanceTo(s, 1, 'end'));
    expect(life(s, 'p1')).toBe(l0 + 1);
  });
  it('an activated ability that is not a loyalty ability does not count', () => {
    const IDOL = card('Test Idle Idol', 'Artifact', '{T}: You gain 1 life.');
    let s = withWalker(scenario(BASICS, { p1: { battlefield: ['Test Pining Charm', 'Test Idle Idol'] }, defs: [...defs, IDOL] }), 'Test Walker');
    s = tweak(s, (x) => { x.objects[find(x, 'Test Idle Idol', 'battlefield', 'p1')]!.controlledSinceTurn = 0; });
    const l0 = life(s, 'p1');
    s = activate(s, 'Test Idle Idol', 'p:0:0');
    s = settleAll(advanceTo(s, 1, 'end'));
    expect(life(s, 'p1')).toBe(l0 + 1 - 2);
  });
});

const BEAR = (name: string) => card(name, 'Creature — Bear', '', { pt: ['2', '2'] });
const cast = (s: GameState, name: string, player: PlayerId = 'p1'): GameState => settleAll(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }));
const graveyardSize = (s: GameState, p: PlayerId): number => s.zones.graveyard[p]!.length;

describe('CR 701.17a, 608.2f: "Each opponent mills cards equal to the number of cards in their hand."', () => {
  const TIDE = card('Test Mind Tide', 'Sorcery', 'Each opponent mills cards equal to the number of cards in their hand.');
  const defs = [TIDE];
  it('is understood', () => expect(noManual(TIDE)).toBe(true));
  it('each opponent mills as many cards as are in their own hand; I mill none', () => {
    let s = mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Mind Tide', 'Plains', 'Plains', 'Plains', 'Plains'] }, p2: { hand: ['Plains', 'Plains', 'Plains'] }, p3: { hand: ['Plains'] } } });
    s = cast(s, 'Test Mind Tide');
    expect([graveyardSize(s, 'p1'), graveyardSize(s, 'p2'), graveyardSize(s, 'p3')]).toEqual([1, 3, 1]); // my graveyard: the spell only
  });
  it('an opponent with an empty hand mills nothing', () => {
    let s = mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Mind Tide'] }, p2: { hand: ['Plains', 'Plains'] } } });
    s = cast(s, 'Test Mind Tide');
    expect([graveyardSize(s, 'p2'), graveyardSize(s, 'p3')]).toEqual([2, 0]);
  });
});

describe('CR 119.3, 608.2f: "Each opponent loses 1 life for each creature card in that player\'s graveyard."', () => {
  const RING = card('Test Dirge Ring', 'Sorcery', "Each opponent loses 1 life for each creature card in that player's graveyard.");
  const defs = [RING, BEAR('Test Dirge Bear')];
  it('is understood', () => expect(noManual(RING)).toBe(true));
  it("each opponent loses life for the creature cards in their own graveyard, not mine and not other cards", () => {
    let s = mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Dirge Ring'], graveyard: ['Test Dirge Bear', 'Test Dirge Bear', 'Test Dirge Bear'] }, p2: { graveyard: ['Test Dirge Bear', 'Test Dirge Bear', 'Plains'] }, p3: { graveyard: ['Test Dirge Bear'] } } });
    const [l1, l2, l3] = [lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3')];
    s = cast(s, 'Test Dirge Ring');
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3')]).toEqual([l1, l2 - 2, l3 - 1]);
  });
});

describe('CR 120.3, 608.2f: "~ deals damage to each opponent equal to the number of tapped creatures that opponent controls."', () => {
  const HIT = card('Test Thunder Hit', 'Sorcery', 'Test Thunder Hit deals damage to each opponent equal to the number of tapped creatures that opponent controls.');
  const defs = [HIT, BEAR('Test Hit Bear')];
  it('is understood', () => expect(noManual(HIT)).toBe(true));
  it('each opponent is dealt damage for their own tapped creatures only', () => {
    let s = mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Thunder Hit'], battlefield: [{ name: 'Test Hit Bear', tapped: true }] }, p2: { battlefield: [{ name: 'Test Hit Bear', tapped: true }, { name: 'Test Hit Bear', tapped: true }, 'Test Hit Bear'] }, p3: { battlefield: ['Test Hit Bear'] } } });
    const [l1, l2, l3] = [lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3')];
    s = cast(s, 'Test Thunder Hit');
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3')]).toEqual([l1, l2 - 2, l3]);
  });
});

describe('CR 504.1, 121.1: "At the beginning of your draw step, draw an additional card."', () => {
  const SUN = card('Test Bright Sun', 'Legendary Artifact', 'At the beginning of your draw step, draw an additional card.');
  const defs = [SUN];
  it('is understood', () => expect(noManual(SUN)).toBe(true));
  it('you draw two cards in your draw step; the opponent still draws one in theirs', () => {
    let s = scenario(BASICS, { p1: { battlefield: ['Test Bright Sun'] }, defs });
    const h1 = handSize(s, 'p1');
    const h2 = handSize(s, 'p2');
    s = settleAll(advanceTo(s, 2, 'main1'));
    expect(handSize(s, 'p2')).toBe(h2 + 1);
    s = settleAll(advanceTo(s, 3, 'main1'));
    expect(handSize(s, 'p1')).toBe(h1 + 2);
  });
});

describe('CR 107.3, 118.12, 608.2h: "Whenever you gain life, you may pay {X}, where X is less than or equal to the amount of life you gained. If you do, draw X cards."', () => {
  const WELL = card('Test Dream Well', 'Artifact', 'Whenever you gain life, you may pay {X}, where X is less than or equal to the amount of life you gained. If you do, draw X cards.');
  const HEAL = card('Test Soft Heal', 'Instant', 'You gain 3 life.');
  const defs = [WELL, HEAL];
  const start = (lands: number): GameState => scenario(Array(lands).fill('Island'), { p1: { hand: ['Test Soft Heal'], battlefield: ['Test Dream Well', ...Array<string>(lands).fill('Island')] }, defs });
  /** Cast the heal and answer the well: yes/no to paying, then the chosen X (undefined: the most offered). */
  function heal(s0: GameState, yes: boolean, x?: number): { s: GameState; offeredMax: number | null } {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Soft Heal', 'hand', 'p1') });
    let offeredMax: number | null = null;
    xAnswer = x;
    for (let guard = 0; guard < 30; guard++) {
      const p = s.pending;
      if (p?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
      else if (p?.kind === 'chooseNumber') { offeredMax = p.max; s = answer(s, { kind: 'chooseNumber', n: x ?? p.max }); }
      else if (p?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p?.kind === 'priority' && s.zones.stack.length > 0) s = pass(s);
      else if (p?.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
      else break;
    }
    xAnswer = undefined;
    return { s, offeredMax };
  }
  it('is understood', () => expect(noManual(WELL)).toBe(true));
  it('with plenty of mana X is at most the life gained (3), and that many cards are drawn', () => {
    const s0 = start(5);
    const h = handSize(s0, 'p1');
    const { s, offeredMax } = heal(s0, true);
    expect(offeredMax).toBe(3);
    expect(handSize(s, 'p1')).toBe(h - 1 + 3); // the heal left the hand
  });
  it('with less mana than the life gained X is at most the mana (2 lands: 2)', () => {
    const s0 = start(2);
    const h = handSize(s0, 'p1');
    const { s, offeredMax } = heal(s0, true);
    expect(offeredMax).toBe(2);
    expect(handSize(s, 'p1')).toBe(h - 1 + 2);
  });
  it('a smaller X may be chosen, and the player may decline: nothing is paid or drawn', () => {
    const s0 = start(5);
    const h = handSize(s0, 'p1');
    expect(handSize(heal(s0, true, 1).s, 'p1')).toBe(h - 1 + 1);
    const declined = heal(s0, false).s;
    expect(handSize(declined, 'p1')).toBe(h - 1);
    expect(declined.zones.battlefield.filter((id) => declined.objects[id]!.tapped).length).toBe(0);
  });
});

describe('CR 107.3, 118.12, 608.2h: "When this creature dies, you may pay X life, where X is its power. If you do, draw X cards."', () => {
  const DEALER = card('Test Grim Dealer', 'Creature — Wizard', 'When this creature dies, you may pay X life, where X is its power. If you do, draw X cards.', { pt: ['3', '3'] });
  const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
  const defs = [DEALER, SMITE];
  it('is understood', () => expect(noManual(DEALER)).toBe(true));
  it('pays its power in life and draws that many cards; declining pays and draws nothing', () => {
    for (const yes of [true, false]) {
      let s = scenario([], { p1: { hand: ['Test Smite'], battlefield: ['Test Grim Dealer'] }, defs });
      const [l0, h0] = [life(s, 'p1'), handSize(s, 'p1')];
      s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Smite', 'hand', 'p1') });
      for (let guard = 0; guard < 30 && s.pending; guard++) {
        const p = s.pending;
        if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Test Grim Dealer', 'battlefield', 'p1') }] });
        else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
        else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
        else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
        else if (p.kind === 'priority' && s.zones.stack.length > 0) s = pass(s);
        else break;
      }
      expect(life(s, 'p1'), `yes=${yes}`).toBe(yes ? l0 - 3 : l0);
      expect(handSize(s, 'p1'), `yes=${yes}`).toBe(yes ? h0 - 1 + 3 : h0 - 1);
    }
  });
});

describe('CR 508.1, 611.3a: "~ has indestructible as long as it attacked this turn."', () => {
  const RAIDER = card('Test Raid Hog', 'Creature — Boar', 'Test Raid Hog has indestructible as long as it attacked this turn.', { pt: ['3', '3'] });
  const PLAIN = card('Test Plain Boar', 'Creature — Boar', '', { pt: ['2', '2'] });
  const defs = [RAIDER, PLAIN];
  const indestructible = (s: GameState, name: string): boolean => getChars(s, find(s, name, 'battlefield', 'p1')).keywords.some((k) => k.keyword === 'indestructible');
  const start = (): GameState => tweak(scenario([], { p1: { battlefield: ['Test Raid Hog', 'Test Plain Boar'] }, defs }), (x) => { for (const id of x.zones.battlefield) x.objects[id]!.controlledSinceTurn = 0; });
  it('is understood', () => expect(noManual(RAIDER)).toBe(true));
  it('it is not indestructible before it attacks, is once it attacked (also after combat), and loses it with the turn', () => {
    let s = start();
    expect(indestructible(s, 'Test Raid Hog')).toBe(false);
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Raid Hog', 'battlefield', 'p1')]]);
    expect(indestructible(s, 'Test Raid Hog')).toBe(true);
    s = advanceTo(s, 1, 'main2');
    expect(indestructible(s, 'Test Raid Hog')).toBe(true);
    s = advanceTo(s, 3, 'main1');
    expect(indestructible(s, 'Test Raid Hog')).toBe(false);
  });
  it('another creature attacking does not give it', () => {
    let s = start();
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Plain Boar', 'battlefield', 'p1')]]);
    expect(indestructible(s, 'Test Raid Hog')).toBe(false);
  });
});

/** Cast a spell and answer what comes up: "may" questions from the script (in the order asked), the first objects offered, automatic payment. */
function castWith(s0: GameState, name: string, yes: boolean[], player: PlayerId = 'p1'): { s: GameState; asked: PlayerId[] } {
  let s = act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) });
  const asked: PlayerId[] = [];
  const q = [...yes];
  for (let guard = 0; guard < 60; guard++) {
    const p = s.pending;
    if (p?.kind === 'yesNo') { asked.push(p.player); s = answer(s, { kind: 'yesNo', yes: q.shift() ?? false }); }
    else if (p?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (p?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p?.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p?.kind === 'priority' && s.zones.stack.length > 0) s = pass(s);
    else break;
  }
  return { s, asked };
}
const namesOf = (s: GameState, p: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => s.defs[s.objects[id]!.defId]!.name);

describe('CR 608.2d, 608.2e: "Each opponent may discard a card. If they don\'t, they lose 3 life." (each opponent in turn)', () => {
  const ONYX = card('Test Dread Toll', 'Sorcery', "Each opponent may discard a card. If they don't, they lose 3 life.");
  const defs = [ONYX];
  it('is understood', () => expect(noManual(ONYX)).toBe(true));
  it('an opponent who discards loses nothing; one who declines loses 3; one with no card to discard loses 3 too; I lose nothing', () => {
    const s0 = mpScenario({ players: 4, defs, zones: { p1: { hand: ['Test Dread Toll'] }, p2: { hand: ['Plains', 'Plains'] }, p3: { hand: ['Plains', 'Plains'] }, p4: {} } });
    const [l1, l2, l3, l4] = [lifeOf(s0, 'p1'), lifeOf(s0, 'p2'), lifeOf(s0, 'p3'), lifeOf(s0, 'p4')];
    const { s, asked } = castWith(s0, 'Test Dread Toll', [true, false]);
    expect(asked).toEqual(['p2', 'p3']); // p4 has nothing to discard and is not asked
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([l1, l2, l3 - 3, l4 - 3]);
    expect([handSize(s, 'p2'), handSize(s, 'p3'), handSize(s, 'p4')]).toEqual([1, 2, 0]);
  });
});

describe('CR 608.2d, 608.2e: "Each opponent may sacrifice a nontoken creature of their choice. Each opponent who doesn\'t loses 2 life for each instant and sorcery card in your graveyard."', () => {
  const FAN = card('Test Grim Tithe', 'Sorcery', "Each opponent may sacrifice a nontoken creature of their choice. Each opponent who doesn't loses 2 life for each instant and sorcery card in your graveyard.");
  const BEAR = card('Test Tithe Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const BOLT = card('Test Tithe Bolt', 'Instant', 'You gain 1 life.');
  const defs = [FAN, BEAR, BOLT];
  it('is understood', () => expect(noManual(FAN)).toBe(true));
  it('those who sacrifice lose nothing; the others lose 2 for each instant and sorcery card in MY graveyard (not a creature card, not theirs)', () => {
    const s0 = mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Grim Tithe'], graveyard: ['Test Tithe Bolt', 'Test Tithe Bolt', 'Test Tithe Bear'] }, p2: { battlefield: ['Test Tithe Bear'], graveyard: ['Test Tithe Bolt'] }, p3: { battlefield: ['Test Tithe Bear'] } } });
    const [l2, l3] = [lifeOf(s0, 'p2'), lifeOf(s0, 'p3')];
    const { s } = castWith(s0, 'Test Grim Tithe', [true, false]);
    // the spell itself joins my graveyard only after it resolves: 2 instants counted
    expect(namesOf(s, 'p2')).toEqual([]);
    expect(namesOf(s, 'p3')).toEqual(['Test Tithe Bear']);
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3')]).toEqual([l2, l3 - 4]);
  });
});

describe('CR 608.2d, 608.2e, 205.2a: Braids-style: "You may sacrifice an artifact, creature, ... If you do, each opponent may sacrifice a permanent of their choice that shares a card type with it. For each opponent who doesn\'t, that player loses 2 life and you draw a card."', () => {
  const VOW = card('Test Gale Vow', 'Sorcery', "You may sacrifice an artifact, creature, enchantment, land, or planeswalker. If you do, each opponent may sacrifice a permanent of their choice that shares a card type with it. For each opponent who doesn't, that player loses 2 life and you draw a card.");
  const BEAR = card('Test Vow Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const IDOL = card('Test Vow Idol', 'Artifact', '');
  const defs = [VOW, BEAR, IDOL];
  it('is understood', () => expect(noManual(VOW)).toBe(true));
  it('an opponent may sacrifice a permanent sharing a card type; one who declines, or has none sharing a type, loses 2 and I draw a card for each', () => {
    const s0 = mpScenario({ players: 4, defs, zones: { p1: { hand: ['Test Gale Vow'], battlefield: ['Test Vow Bear'] }, p2: { battlefield: ['Test Vow Bear'] }, p3: { battlefield: ['Test Vow Bear'] }, p4: { battlefield: ['Test Vow Idol'] } } });
    const [l2, l3, l4, h1] = [lifeOf(s0, 'p2'), lifeOf(s0, 'p3'), lifeOf(s0, 'p4'), handSize(s0, 'p1')];
    const { s, asked } = castWith(s0, 'Test Gale Vow', [true, true, false]);
    expect(asked).toEqual(['p1', 'p2', 'p3']); // p4's only permanent is an artifact: nothing shares a type with my creature, so p4 is not asked
    expect(namesOf(s, 'p1')).toEqual([]); // my bear was sacrificed
    expect(namesOf(s, 'p2')).toEqual([]); // p2 sacrificed theirs
    expect(namesOf(s, 'p3')).toEqual(['Test Vow Bear']);
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([l2, l3 - 2, l4 - 2]);
    expect(handSize(s, 'p1')).toBe(h1 - 1 + 2); // the spell left my hand; one card for each of p3 and p4
  });
  it('if I decline to sacrifice (or have nothing to), nobody is asked and nothing happens', () => {
    const s0 = mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Gale Vow'], battlefield: ['Test Vow Bear'] }, p2: { battlefield: ['Test Vow Bear'] } } });
    const [l2, h1] = [lifeOf(s0, 'p2'), handSize(s0, 'p1')];
    const { s, asked } = castWith(s0, 'Test Gale Vow', [false]);
    expect(asked).toEqual(['p1']);
    expect(lifeOf(s, 'p2')).toBe(l2);
    expect(handSize(s, 'p1')).toBe(h1 - 1);
    expect(namesOf(s, 'p1')).toEqual(['Test Vow Bear']);
  });
});

describe('CR 402.2, 514.1: "Each opponent\'s maximum hand size is reduced by two."', () => {
  const CROWN = card('Test Pinch Crown', 'Artifact', "Each opponent's maximum hand size is reduced by two.");
  const defs = [CROWN];
  const nine = Array<string>(9).fill('Plains');
  /** Pass until the cleanup step of the turn, discarding what is asked (the first cards offered). */
  function toEndOfTurn(s0: GameState): GameState {
    let s = s0;
    const turn = s.turn.number;
    for (let guard = 0; guard < 400 && s.turn.number === turn; guard++) {
      const p = s.pending;
      if (p?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
      else if (p?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (p?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (p?.kind === 'priority') s = pass(s);
      else throw new Error(`unexpected decision ${p?.kind}`);
    }
    return s;
  }
  it('is understood', () => expect(noManual(CROWN)).toBe(true));
  it('I keep seven cards at my cleanup step; an opponent keeps five at theirs', () => {
    const mine = toEndOfTurn(mpScenario({ players: 3, defs, zones: { p1: { battlefield: ['Test Pinch Crown'], hand: nine }, p2: { hand: nine } } }));
    expect(handSize(mine, 'p1')).toBe(7);
    let s = mpScenario({ players: 3, defs, zones: { p1: { battlefield: ['Test Pinch Crown'] }, p2: { hand: nine } } });
    s = toEndOfTurn(s); // my turn passes: no discard for me
    s = toEndOfTurn(s); // p2's turn: the nine cards, five kept, one drawn first
    expect(handSize(s, 'p2')).toBe(5);
  });
});
