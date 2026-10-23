/**
 * std-rx19 (wave 2, Commander precon lane rx19): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in
 * the cloud checkout).
 *
 *   CR 115.1, 109.5        "Whenever a creature you control becomes the target of a spell or ability an opponent controls, ~ deals 3 damage to that player":
 *                          the opponent who controls the targeting spell; a spell of yours targeting it triggers nothing
 *   CR 601.2i, 500.1       "Whenever you cast your first spell during each opponent's turn": once per opponent's turn, never on your own turn
 *   CR 506.2, 508.1b       "it deals 2 damage to the player or planeswalker it's attacking": the attacked planeswalker only, or the attacked player
 *   CR 603.6a, 614.1c      "When this land enters untapped": not when an "enters tapped unless" replacement made it enter tapped
 *   CR 305.2, 305.2a       "Each player may play an additional land on each of their turns": the opponent too
 *   CR 603.2, 603.2c       "Whenever you lose life for the first time each turn": once each turn
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId, PlayerId, TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, life, pass, put, scenario } from '../../m3/scenario';
import { card, full } from '../cmd3/helpers';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';

interface Run { targets?: TargetChoice[][]; yes?: boolean }
/** Let the game go on until the stack is empty, answering targets (in order; else the first legal one), payments and "you may" choices. */
function run(s0: GameState, o: Run = {}): GameState {
  let s = s0;
  const targets = [...(o.targets ?? [])];
  for (let guard = 0; s.pending && guard < 60; guard++) {
    const d = s.pending;
    if (d.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); }
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') {
      const first: TargetChoice[] = d.objects.length > 0 ? [{ kind: 'object', id: d.objects[0]! }] : [{ kind: 'player', id: d.players[0]! }];
      s = answer(s, { kind: 'chooseTargets', targets: targets.shift() ?? first.slice(0, Math.max(d.min, 1)) });
    } else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else break;
  }
  return s;
}
const castBy = (s: GameState, player: PlayerId, name: string, o: Run = {}): GameState => run(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), o);
const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
/** Give `p` priority in the current step (the active player passes once when it is not theirs). */
const priorityTo = (s: GameState, p: PlayerId): GameState => (s.pending?.kind === 'priority' && s.pending.player !== p ? pass(s) : s);

describe('CR 115.1, 109.5: "becomes the target of a spell or ability an opponent controls, ~ deals 3 damage to that player"', () => {
  const REGENT = card('Test Regent', 'Creature — Dragon', 'Whenever a creature you control becomes the target of a spell or ability an opponent controls, this creature deals 3 damage to that player.', ['4', '4']);
  const NUDGE = card('Test Nudge', 'Instant', 'Target creature gets +1/+1 until end of turn.');
  const DEFS = [REGENT, NUDGE];
  it('is understood', () => expect(full(REGENT)).toBe(true));
  it("an opponent's spell targeting it: that opponent is dealt 3 damage", () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Regent'] }, p2: { hand: ['Test Nudge'] } });
    s = priorityTo(s, 'p2');
    const regent = find(s, 'Test Regent', 'battlefield', 'p1');
    const l1 = life(s, 'p1');
    const l2 = life(s, 'p2');
    s = castBy(s, 'p2', 'Test Nudge', { targets: [[{ kind: 'object', id: regent }]] });
    expect(life(s, 'p2')).toBe(l2 - 3);
    expect(life(s, 'p1')).toBe(l1);
  });
  it('its controller targeting it with their own spell triggers nothing', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Regent'], hand: ['Test Nudge'] } });
    const regent = find(s, 'Test Regent', 'battlefield', 'p1');
    const l1 = life(s, 'p1');
    const l2 = life(s, 'p2');
    s = castBy(s, 'p1', 'Test Nudge', { targets: [[{ kind: 'object', id: regent }]] });
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([l1, l2]);
  });
});

describe("CR 601.2i, 500.1: \"Whenever you cast your first spell during each opponent's turn, draw a card\"", () => {
  const TRICKSTER = card('Test Trickster', 'Creature — Faerie', "Whenever you cast your first spell during each opponent's turn, draw a card.", ['1', '1']);
  const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.');
  const DEFS = [TRICKSTER, SPARK];
  it('is understood', () => expect(full(TRICKSTER)).toBe(true));
  it("two spells during the opponent's turn: one card drawn", () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Trickster'], hand: ['Test Spark', 'Test Spark'] } });
    s = advanceTo(s, 2, 'main1');
    expect(s.turn.activePlayer).toBe('p2');
    s = priorityTo(s, 'p1');
    const h0 = handSize(s, 'p1');
    s = castBy(s, 'p1', 'Test Spark');
    expect(handSize(s, 'p1')).toBe(h0 - 1 + 1);
    s = priorityTo(s, 'p1');
    s = castBy(s, 'p1', 'Test Spark');
    expect(handSize(s, 'p1')).toBe(h0 - 2 + 1);
  });
  it('a spell during your own turn: nothing', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Trickster'], hand: ['Test Spark'] } });
    const h0 = handSize(s, 'p1');
    s = castBy(s, 'p1', 'Test Spark');
    expect(handSize(s, 'p1')).toBe(h0 - 1);
  });
});

describe("CR 506.2, 508.1b: \"Whenever ~ attacks, it deals 2 damage to the player or planeswalker it's attacking\"", () => {
  const RAIDER = card('Test Raider', 'Creature — Pirate', "Whenever this creature attacks, it deals 2 damage to the player or planeswalker it's attacking.", ['1', '1']);
  const WALKER = card('Test Walker', 'Legendary Planeswalker — Testwalker', '+1: You gain 1 life.');
  const DEFS = [RAIDER, WALKER];
  const attack = (s0: GameState, raider: ObjectId, defender: PlayerId | ObjectId): GameState =>
    run(passUntil(declareAttackers(toDeclareAttackers(s0), [[raider, defender]]), (x) => x.pending?.kind !== 'priority' || x.zones.stack.length > 0, 'the attack trigger'));
  it('is understood', () => expect(full(RAIDER)).toBe(true));
  it('attacking the player: that player is dealt 2 damage', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Raider'] } });
    const l2 = life(s0, 'p2');
    const s = attack(s0, find(s0, 'Test Raider', 'battlefield', 'p1'), 'p2');
    expect(life(s, 'p2')).toBe(l2 - 2);
  });
  it("attacking a planeswalker: the planeswalker is dealt 2 damage, its controller's life does not change", () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Raider'] } });
    const walker = put(s0, 'p2', 'battlefield', { name: 'Test Walker', counters: { loyalty: 5 } });
    const l2 = life(s0, 'p2');
    const s = attack(s0, find(s0, 'Test Raider', 'battlefield', 'p1'), walker);
    expect(s.objects[walker]!.counters['loyalty']).toBe(3);
    expect(life(s, 'p2')).toBe(l2);
  });
});

describe('CR 603.6a, 614.1c: "When this land enters untapped, you gain 3 life"', () => {
  const GROVE = card('Test Grove', 'Land', 'This land enters tapped unless you control a Forest.\nWhen this land enters untapped, you gain 3 life.\n{T}: Add {G}.');
  const DEFS = [GROVE];
  it('is understood', () => expect(full(GROVE)).toBe(true));
  it('entering untapped (you control a Forest): 3 life', () => {
    let s = scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Grove'], battlefield: ['Forest'] } });
    const l1 = life(s, 'p1');
    s = run(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Grove', 'hand', 'p1') }));
    expect(s.objects[find(s, 'Test Grove', 'battlefield', 'p1')]!.tapped).toBe(false);
    expect(life(s, 'p1')).toBe(l1 + 3);
  });
  it('entering tapped (no Forest): nothing', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Grove'] } });
    const l1 = life(s, 'p1');
    s = run(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Grove', 'hand', 'p1') }));
    expect(s.objects[find(s, 'Test Grove', 'battlefield', 'p1')]!.tapped).toBe(true);
    expect(life(s, 'p1')).toBe(l1);
  });
});

describe('CR 305.2, 305.2a: "Each player may play an additional land on each of their turns"', () => {
  const RITES = card('Test Rites', 'Enchantment', 'Each player may play an additional land on each of their turns.');
  const DEFS = [RITES];
  it('is understood', () => expect(full(RITES)).toBe(true));
  it('the opponent may play two lands on their turn, but not three', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Rites'] }, p2: { hand: ['Plains', 'Plains', 'Plains'] } });
    s = advanceTo(s, 2, 'main1');
    s = act(s, { type: 'playLand', player: 'p2', card: find(s, 'Plains', 'hand', 'p2') });
    s = act(s, { type: 'playLand', player: 'p2', card: find(s, 'Plains', 'hand', 'p2') });
    expect(findAll(s, 'Plains', 'battlefield', 'p2')).toHaveLength(2);
    expect(() => act(s, { type: 'playLand', player: 'p2', card: find(s, 'Plains', 'hand', 'p2') })).toThrow();
  });
  it('without it, one land a turn', () => {
    let s = scenario([], { p2: { hand: ['Plains', 'Plains'] } });
    s = advanceTo(s, 2, 'main1');
    s = act(s, { type: 'playLand', player: 'p2', card: find(s, 'Plains', 'hand', 'p2') });
    expect(() => act(s, { type: 'playLand', player: 'p2', card: find(s, 'Plains', 'hand', 'p2') })).toThrow();
  });
});

describe('CR 603.2, 603.2c: "Whenever you lose life for the first time each turn, draw a card"', () => {
  const SCRIBE = card('Test Scribe', 'Creature — Human', 'Whenever you lose life for the first time each turn, draw a card.', ['1', '1']);
  const SAP = card('Test Sap', 'Instant', 'You lose 1 life.');
  const DEFS = [SCRIBE, SAP];
  it('is understood', () => expect(full(SCRIBE)).toBe(true));
  it('losing life twice in a turn draws one card', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Scribe'], hand: ['Test Sap', 'Test Sap'] } });
    const h0 = handSize(s, 'p1');
    s = castBy(s, 'p1', 'Test Sap');
    s = castBy(s, 'p1', 'Test Sap');
    expect(handSize(s, 'p1')).toBe(h0 - 2 + 1);
  });
});
