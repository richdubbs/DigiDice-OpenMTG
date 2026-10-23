/**
 * Cloud C3 (tap-and-freeze and lord riders), played through the engine with synthetic cards compiled by the game's default compiler (wordings are invented,
 * design 6.10).
 *
 *   CR 701.26a, 502.3     tapping, and the untap step: a permanent that "doesn't untap during its controller's next untap step" stays tapped through that one step
 *   CR 611.2a, 611.2c     the restriction is a resolved effect: it lasts through the next untap step of each object's controller, then ends
 *   CR 604.1, 611.3a      a static ability's condition ("as long as", "during your turn") is checked continuously
 *   CR 613.1f, 613.4c     abilities are granted in layer 6, +N/+N in layer 7c
 *   CR 702.14a, 702.14c   landwalk: a creature with islandwalk can't be blocked as long as the defending player controls an Island
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, pass, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
// Std merge line E: the C3 templates are experimental until their promotion is reviewed (design 6.9), and an experimental template caps the CARD at
// partial; "automated" here is every ability read in full (each ability's level, autoRatio 1, no manual node), the card level aside
const full = (d: CardDef): boolean => d.automation.autoRatio === 1 && (d.automation.faces ?? []).every((f) => f.abilities.every((a) => a.level === 'full')) && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

function settle(s0: GameState, targets: TargetChoice[] = [], answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** Cast the named spell from p1's hand at the given targets and let it resolve. */
function castAt(s0: GameState, name: string, ...targets: ObjectId[]): GameState {
  const s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), targets.map(obj));
  return settle(pass(pass(s)));
}
const chars = (s: GameState, id: ObjectId) => getChars(s, id)!;
const has = (s: GameState, id: ObjectId, kw: string): boolean => chars(s, id).keywords.some((k) => k.keyword === kw);
const tapped = (s: GameState, id: ObjectId): boolean => s.objects[id]!.tapped === true;

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const OX = card('Test Ox', 'Creature — Ox', '', ['1', '3']);

describe('CR 701.26a, 502.3, 611.2c: "Tap up to two target creatures and they don\'t untap during their controllers\' next untap steps."', () => {
  const FROST = card('Test Frost', 'Sorcery', "Tap up to two target creatures and they don't untap during their controllers' next untap steps.");
  it('is automated', () => expect(full(FROST)).toBe(true));
  it('both creatures are tapped, stay tapped through their controller\'s next untap step, and untap in the one after', () => {
    const s0 = scenario([], { p1: { hand: ['Test Frost'] }, p2: { battlefield: ['Test Bear', 'Test Ox'] }, defs: [FROST, BEAR, OX] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const ox = find(s0, 'Test Ox', 'battlefield', 'p2');
    let s = castAt(s0, 'Test Frost', bear, ox);
    expect(tapped(s, bear) && tapped(s, ox)).toBe(true);
    const turn = s.turn.number;
    s = advanceTo(s, turn + 1, 'upkeep'); // p2's turn: its untap step skipped them (CR 502.3)
    expect(tapped(s, bear) && tapped(s, ox)).toBe(true);
    s = advanceTo(s, turn + 3, 'upkeep'); // p2's next turn: the effect has ended, they untap as usual
    expect(tapped(s, bear) || tapped(s, ox)).toBe(false);
  });
});

describe('CR 701.26a, 502.3, 603.2: "Whenever this creature blocks a creature, tap that creature and it doesn\'t untap during its controller\'s next untap step."', () => {
  const SENTRY = card('Test Sentry', 'Creature — Spirit', "Whenever this creature blocks a creature, tap that creature and it doesn't untap during its controller's next untap step.", ['1', '4']);
  it('is automated', () => expect(full(SENTRY)).toBe(true));
  it('the attacker it blocks does not untap during its controller\'s next untap step, and untaps in the one after', () => {
    let s = scenario([], { p1: { battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Sentry'] }, defs: [SENTRY, BEAR] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const sentry = find(s, 'Test Sentry', 'battlefield', 'p2');
    for (let guard = 0; s.pending?.kind !== 'declareAttackers'; guard++) {
      if (guard > 20) throw new Error('no declare attackers');
      s = pass(s);
    }
    const turn = s.turn.number;
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }] });
    for (let guard = 0; s.pending?.kind !== 'declareBlockers'; guard++) {
      if (guard > 20) throw new Error('no declare blockers');
      s = pass(s);
    }
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: sentry, attacker: bear }] });
    s = settle(s);
    for (let guard = 0; s.zones.stack.length > 0 && guard < 10; guard++) s = settle(pass(s));
    expect(tapped(s, bear)).toBe(true);
    s = advanceTo(s, turn + 2, 'upkeep'); // p1's next turn: the Bear stays tapped
    expect(tapped(s, bear)).toBe(true);
    s = advanceTo(s, turn + 4, 'upkeep');
    expect(tapped(s, bear)).toBe(false);
  });
});

describe('CR 604.1, 611.3a, 613.1f: "Other Humans you control have first strike as long as you control three or more Humans."', () => {
  const CAPTAIN = card('Test Captain', 'Creature — Human Soldier', 'Other Humans you control have first strike as long as you control three or more Humans.', ['2', '2']);
  const SQUIRE = card('Test Squire', 'Creature — Human', '', ['1', '1']);
  it('is automated', () => expect(full(CAPTAIN)).toBe(true));
  it('with two Humans nothing has first strike; with three the other Humans do and the Captain does not', () => {
    const two = scenario([], { p1: { battlefield: ['Test Captain', 'Test Squire'] }, defs: [CAPTAIN, SQUIRE] });
    expect(has(two, find(two, 'Test Squire', 'battlefield', 'p1'), 'first strike')).toBe(false);
    const three = scenario([], { p1: { battlefield: ['Test Captain', 'Test Squire', 'Test Squire'] }, p2: { battlefield: ['Test Squire'] }, defs: [CAPTAIN, SQUIRE] });
    const mine = three.zones.battlefield.filter((id) => three.objects[id]!.controller === 'p1' && three.objects[id]!.defId === 'Test Squire');
    expect(mine.length).toBe(2);
    for (const id of mine) expect(has(three, id, 'first strike')).toBe(true);
    expect(has(three, find(three, 'Test Captain', 'battlefield', 'p1'), 'first strike')).toBe(false);
    expect(has(three, find(three, 'Test Squire', 'battlefield', 'p2'), 'first strike')).toBe(false); // an opponent's Human is not "you control"
  });
});

describe('CR 604.1, 500.1, 613.1f, 613.4c: "Creatures you control get +1/+0 and have first strike during your turn."', () => {
  const BANNER = card('Test Banner', 'Enchantment', 'Creatures you control get +1/+0 and have first strike during your turn.');
  it('is automated', () => expect(full(BANNER)).toBe(true));
  it('during its controller\'s turn the creatures are 3/2 with first strike; during the opponent\'s turn they are 2/2 without it', () => {
    let s = scenario([], { p1: { battlefield: ['Test Banner', 'Test Bear'] }, defs: [BANNER, BEAR] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(s.turn.activePlayer).toBe('p1');
    expect([Number(chars(s, bear).power), has(s, bear, 'first strike')]).toEqual([3, true]);
    s = advanceTo(s, s.turn.number + 1, 'upkeep');
    expect(s.turn.activePlayer).toBe('p2');
    expect([Number(chars(s, bear).power), has(s, bear, 'first strike')]).toEqual([2, false]);
  });
});

describe('CR 702.14a, 702.14c, 613.1f: "Other Merfolk you control have islandwalk."', () => {
  const TIDE = card('Test Tidecaller', 'Creature — Merfolk Wizard', 'Other Merfolk you control have islandwalk.', ['1', '1']);
  const SCOUT = card('Test Scout', 'Creature — Merfolk Scout', '', ['2', '1']);
  const ISLAND = card('Test Island', 'Basic Land — Island', '');
  it('is automated', () => expect(full(TIDE)).toBe(true));
  it('the other Merfolk has islandwalk and can\'t be blocked by a player who controls an Island; the lord itself can be', () => {
    let s = scenario([], { p1: { battlefield: ['Test Tidecaller', 'Test Scout'] }, p2: { battlefield: ['Test Bear', 'Test Island'] }, defs: [TIDE, SCOUT, BEAR, ISLAND] });
    const scout = find(s, 'Test Scout', 'battlefield', 'p1');
    const lord = find(s, 'Test Tidecaller', 'battlefield', 'p1');
    expect(has(s, scout, 'landwalk')).toBe(true);
    expect(has(s, lord, 'landwalk')).toBe(false);
    for (let guard = 0; s.pending?.kind !== 'declareAttackers'; guard++) {
      if (guard > 20) throw new Error('no declare attackers');
      s = pass(s);
    }
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: scout, defender: 'p2' }, { attacker: lord, defender: 'p2' }] });
    for (let guard = 0; s.pending?.kind !== 'declareBlockers'; guard++) {
      if (guard > 20) throw new Error('no declare blockers');
      s = pass(s);
    }
    const d = s.pending!;
    const blocker = find(s, 'Test Bear', 'battlefield', 'p2');
    const tryBlock = (attacker: ObjectId) => applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'declareBlockers', blocks: [{ blocker, attacker }] } }).error;
    expect(tryBlock(scout)).toBeDefined();
    expect(tryBlock(lord)).toBeUndefined();
  });
});
