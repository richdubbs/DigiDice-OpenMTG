/**
 * std-rx25 (wave 2, EDH lane rx25): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (wordings
 * invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud
 * checkout).
 *
 *   CR 601.2h, 106.1            "If at least three black mana was spent to cast this spell, ...": with {B}{B}{B} paid it happens; with one black mana it does not
 *   CR 702.29a, 603.2           "Whenever you cycle another card": a cycled card triggers it; a card discarded to an effect does not; an opponent's cycling does not
 *   CR 118.12a, 107.3a, 608.2h  "Counter target spell unless its controller pays {X}, where X is ...": X read as the payment is made; "~'s power" of a source
 *                               sacrificed to pay the cost is its last known power
 *   CR 608.2h, 121.1, 119.3     "Target player draws X cards and loses X life, where X is the number of cards in their graveyard": "their" is the target player
 *   CR 701.12c, 115.3           "Two target players exchange life totals"; "you may have two target players exchange life totals", declined: nothing changes
 *   CR 603.2, 700.4             "Whenever this creature or another artifact creature dies": another artifact creature and the creature itself trigger it; a
 *                               creature that is not an artifact does not
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState, ObjectId, TargetChoice } from '../../../src/index';
import { act, find, legal, life, pass, scenario } from '../../m3/scenario';
import { card, full, inYard, resolveAll, settle, tokens, type Picks } from '../cmd3/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });
const cast = (s: GameState, name: string, p: Picks = {}, who = 'p1'): GameState => settle(act(s, { type: 'cast', player: who, card: find(s, name, 'hand', who) }), p);
function activate(s: GameState, id: ObjectId, p: Picks = {}, who = 'p1'): GameState {
  const la = legal(s, who, 'activate').find((a) => a.object === id && !a.isMana);
  if (!la) throw new Error(`no ability to activate on ${s.objects[id]?.defId}`);
  return settle(act(s, la.action), p);
}
const hand = (s: GameState, p: string): number => (s.zones.hand[p] ?? []).length;
const onStackOrBattlefield = (s: GameState, defId: string): boolean => [...s.zones.stack, ...s.zones.battlefield].some((id) => s.objects[id]?.defId === defId);

const HARVEST = card('Test Harvest', 'Sorcery', 'Draw a card. If at least three black mana was spent to cast this spell, create a Food token.', undefined, '{2}{B}');
const FOX = card('Test Fox', 'Creature — Fox', 'Whenever you cycle another card, you gain 2 life.', ['2', '2']);
const CYCLER = card('Test Cycler', 'Creature — Bird', 'Cycling {0}', ['1', '1']);
const RUMMAGE = card('Test Rummage', 'Sorcery', 'Discard a card, then draw a card.');
const REBUFF = card('Test Rebuff', 'Instant', 'Counter target spell unless its controller pays {X}, where X is the number of cards in your hand.');
const WARDEN = card('Test Warden', 'Creature — Spirit', "Sacrifice this creature: Counter target spell unless its controller pays {X}, where X is this creature's power.", ['2', '2']);
const PACT = card('Test Pact', 'Sorcery', 'Target player draws X cards and loses X life, where X is the number of cards in their graveyard.');
const CONDUIT = card('Test Conduit', 'Artifact', '{T}: Two target players exchange life totals.');
const SCALES = card('Test Scales', 'Artifact', '{T}: You may have two target players exchange life totals.');
const SCORPION = card('Test Scorpion', 'Artifact Creature — Scorpion', 'Whenever this creature or another artifact creature dies, you gain 1 life.', ['1', '1']);
const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', ['2', '2']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.');
const DEFS: CardDef[] = [HARVEST, FOX, CYCLER, RUMMAGE, REBUFF, WARDEN, PACT, CONDUIT, SCALES, SCORPION, GOLEM, BEAR, DOOM];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 601.2h, 106.1: "If at least three black mana was spent to cast this spell, create a Food token" (adamant)', () => {
  it('paid with three black mana: you draw a card and create a Food', () => {
    let s = scenario(['Swamp'], { p1: { hand: ['Test Harvest'], battlefield: ['Swamp', 'Swamp', 'Swamp'] }, defs: DEFS });
    const before = hand(s, 'p1');
    s = resolveAll(cast(s, 'Test Harvest'));
    expect(hand(s, 'p1')).toBe(before); // the spell left the hand, a card was drawn
    expect(tokens(s, 'p1').filter((id) => /Food/i.test(s.objects[id]!.defId))).toHaveLength(1);
  });
  it('paid with one black mana and two white: you draw a card and create no Food', () => {
    let s = scenario(['Swamp'], { p1: { hand: ['Test Harvest'], battlefield: ['Swamp', 'Plains', 'Plains'] }, defs: DEFS });
    const before = hand(s, 'p1');
    s = resolveAll(cast(s, 'Test Harvest'));
    expect(hand(s, 'p1')).toBe(before);
    expect(tokens(s, 'p1')).toEqual([]);
  });
});

describe('CR 702.29a, 603.2: "Whenever you cycle another card, you gain 2 life"', () => {
  it('cycling a card from your hand triggers it; discarding a card to an effect does not', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Cycler', 'Test Rummage', 'Test Bear'], battlefield: ['Test Fox'] }, defs: DEFS });
    s = resolveAll(activate(s, find(s, 'Test Cycler', 'hand')));
    expect(life(s, 'p1')).toBe(22);
    s = resolveAll(cast(s, 'Test Rummage'), { objects: [find(s, 'Test Bear', 'hand')] });
    expect(inYard(s, 'Test Bear')).toBe(true);
    expect(life(s, 'p1')).toBe(22);
  });
  it("an opponent's cycling does not trigger it", () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Fox'] }, p2: { hand: ['Test Cycler'] }, defs: DEFS });
    s = pass(s); // p2 gets priority in p1's main phase; cycling is an activated ability at instant speed
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p2' });
    s = resolveAll(activate(s, find(s, 'Test Cycler', 'hand', 'p2'), {}, 'p2'));
    expect(inYard(s, 'Test Cycler', 'p2')).toBe(true);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 118.12a, 107.3a, 608.2h: "Counter target spell unless its controller pays {X}, where X is ..."', () => {
  it('X is the number of cards in your hand as the payment is asked: two cards and no mana, the spell is countered', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Bear', 'Test Rebuff', 'Test Doom', 'Test Rummage'] }, defs: DEFS });
    s = cast(s, 'Test Bear');
    const bearSpell = s.zones.stack[0]!;
    s = resolveAll(cast(s, 'Test Rebuff', { targets: [obj(bearSpell)] }), { yes: true });
    expect(onStackOrBattlefield(s, 'Test Bear')).toBe(false);
    expect(inYard(s, 'Test Bear')).toBe(true);
  });
  it('with an empty hand X is 0: paying nothing, the spell resolves', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Bear', 'Test Rebuff'] }, defs: DEFS });
    s = cast(s, 'Test Bear');
    const bearSpell = s.zones.stack[0]!;
    s = resolveAll(cast(s, 'Test Rebuff', { targets: [obj(bearSpell)] }), { yes: true });
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Bear')).toBe(true);
  });
  it("\"this creature's power\" of a creature sacrificed to pay the cost is its last known power: 2, so one land cannot pay and the spell is countered", () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Bear'], battlefield: ['Test Warden', 'Plains'] }, defs: DEFS });
    s = cast(s, 'Test Bear');
    const bearSpell = s.zones.stack[0]!;
    s = resolveAll(activate(s, find(s, 'Test Warden', 'battlefield'), { targets: [obj(bearSpell)] }), { yes: true });
    expect(inYard(s, 'Test Warden')).toBe(true);
    expect(inYard(s, 'Test Bear')).toBe(true);
  });
  it('with two lands the controller pays {2} and the spell resolves', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Bear'], battlefield: ['Test Warden', 'Plains', 'Plains'] }, defs: DEFS });
    s = cast(s, 'Test Bear');
    const bearSpell = s.zones.stack[0]!;
    s = resolveAll(activate(s, find(s, 'Test Warden', 'battlefield'), { targets: [obj(bearSpell)] }), { yes: true });
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Bear')).toBe(true);
  });
});

describe('CR 608.2h, 121.1, 119.3: "Target player draws X cards and loses X life, where X is the number of cards in their graveyard"', () => {
  it("X counts the target player's graveyard (two cards): the opponent draws two and loses 2 life; you do neither", () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Pact'], graveyard: ['Test Bear', 'Test Bear', 'Test Bear'] }, p2: { graveyard: ['Test Bear', 'Test Bear'] }, defs: DEFS });
    const [h1, h2] = [hand(s, 'p1'), hand(s, 'p2')];
    s = resolveAll(cast(s, 'Test Pact', { targets: [player('p2')] }));
    expect(hand(s, 'p2')).toBe(h2 + 2);
    expect(life(s, 'p2')).toBe(18);
    expect(hand(s, 'p1')).toBe(h1 - 1);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 701.12c, 115.3: "Two target players exchange life totals"', () => {
  it('after the opponent lost 2 life, the two life totals are exchanged: you 18, the opponent 20', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Pact'], battlefield: ['Test Conduit'] }, p2: { graveyard: ['Test Bear', 'Test Bear'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Pact', { targets: [player('p2')] }));
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([20, 18]);
    s = resolveAll(activate(s, find(s, 'Test Conduit', 'battlefield'), { targets: [player('p1'), player('p2')] }));
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([18, 20]);
  });
  it('"you may have two target players exchange life totals", declined: nothing changes; accepted: they are exchanged', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Pact'], battlefield: ['Test Scales'] }, p2: { graveyard: ['Test Bear', 'Test Bear'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Pact', { targets: [player('p2')] }));
    const scales = find(s, 'Test Scales', 'battlefield');
    const declined = resolveAll(activate(s, scales, { targets: [player('p1'), player('p2')] }), { targets: [player('p1'), player('p2')], yes: false });
    expect([life(declined, 'p1'), life(declined, 'p2')]).toEqual([20, 18]);
    const accepted = resolveAll(activate(s, scales, { targets: [player('p1'), player('p2')] }), { targets: [player('p1'), player('p2')], yes: true });
    expect([life(accepted, 'p1'), life(accepted, 'p2')]).toEqual([18, 20]);
  });
});

describe('CR 603.2, 700.4: "Whenever this creature or another artifact creature dies, you gain 1 life"', () => {
  it('another artifact creature dying triggers it; a creature that is not an artifact does not; the creature itself does', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Doom', 'Test Doom', 'Test Doom'], battlefield: ['Test Scorpion', 'Test Golem'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Doom', { targets: [obj(find(s, 'Test Golem', 'battlefield'))] }));
    expect(life(s, 'p1')).toBe(21);
    s = resolveAll(cast(s, 'Test Doom', { targets: [obj(find(s, 'Test Bear', 'battlefield', 'p2'))] }));
    expect(life(s, 'p1')).toBe(21);
    s = resolveAll(cast(s, 'Test Doom', { targets: [obj(find(s, 'Test Scorpion', 'battlefield'))] }));
    expect(life(s, 'p1')).toBe(22);
  });
});
