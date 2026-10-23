/**
 * Standard round 10 (std-r10): "the next spell you cast this turn can't be countered" (parser/templates/zz-cloud/std-r10.json, op nextSpell,
 * effects/handlers/next-spell.ts), played through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings,
 * design 6.10). Each test is named after the rule it checks (CR cites from memory, unverified: rules/cr/ is not in the cloud checkout).
 *
 *   CR 601.2i, 101.2   the rider applies to the next matching spell its controller casts, as that spell becomes cast: it can't be countered
 *   CR 611.2           the rider waits past a spell its filter doesn't describe, applies to one spell only, and ends with the turn
 *   CR 101.2           another player's spell is not "the next spell you cast"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, find, findAll, scenario } from '../../m5/helpers';
import { cast, resolveAll, target } from '../../m5/cr-examples/helpers';
import { pass } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';

const WARD = card('Test Ward-Word', 'Sorcery', 'Draw a card. The next creature spell you cast this turn can\'t be countered.');
const RELIC = card('Test Hush Relic', 'Artifact', '{T}: The next spell you cast this turn can\'t be countered.');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const LYNX = card('Test Lynx', 'Creature — Cat', 'Flash', ['2', '1']);
const SPARK = card('Test Spark', 'Sorcery', 'You gain 1 life.');
const DENY = card('Test Deny', 'Instant', 'Counter target spell.');
const DEFS = [WARD, RELIC, BEAR, LYNX, SPARK, DENY];
const LIBRARY = ['Plains', 'Plains', 'Plains', 'Plains'];

/** p1 casts `name`; p2, with priority while it is on the stack, casts Test Deny on it; everything resolves. */
function castIntoDeny(s0: GameState, name: string): GameState {
  let s = cast(s0, name);
  s = pass(s);
  return resolveAll(cast(s, 'Test Deny', [target(s.zones.stack[0]!)], 'p2'));
}
function activateRelic(s0: GameState): GameState {
  const relic = find(s0, 'Test Hush Relic', 'battlefield');
  const a = legalActions(s0, 'p1').find((x) => x.kind === 'activate' && x.object === relic)!;
  return resolveAll(act(s0, a.action));
}

describe('std-r10 cards compile fully', () => {
  it('the synthetic cards of these scenarios are fully automated', () => {
    for (const d of [WARD, RELIC, DENY]) expect(full(d), d.name).toBe(true);
  });
});

describe('CR 601.2i, 101.2: "The next creature spell you cast this turn can\'t be countered."', () => {
  it('the next creature spell p1 casts resolves although it is countered; without the rider the same counter works', () => {
    let s = scenario(LIBRARY, { p1: { hand: ['Test Ward-Word', 'Test Bear'] }, p2: { hand: ['Test Deny'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Ward-Word'));
    expect(s.turn.nextSpell).toHaveLength(1);
    s = castIntoDeny(s, 'Test Bear');
    expect(findAll(s, 'Test Bear', 'battlefield')).toHaveLength(1);
    expect(s.turn.nextSpell).toBeUndefined();

    let t = scenario(LIBRARY, { p1: { hand: ['Test Bear'] }, p2: { hand: ['Test Deny'] }, defs: DEFS });
    t = castIntoDeny(t, 'Test Bear');
    expect(findAll(t, 'Test Bear', 'battlefield')).toHaveLength(0);
    expect(findAll(t, 'Test Bear', 'graveyard', 'p1')).toHaveLength(1);
  });
  it('CR 611.2: a noncreature spell cast first is not protected and leaves the rider waiting for the creature spell', () => {
    let s = scenario(LIBRARY, { p1: { hand: ['Test Ward-Word', 'Test Spark', 'Test Bear'] }, p2: { hand: ['Test Deny', 'Test Deny'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Ward-Word'));
    s = castIntoDeny(s, 'Test Spark');
    expect(findAll(s, 'Test Spark', 'graveyard', 'p1')).toHaveLength(1);
    expect(s.players[0]!.life).toBe(20); // countered: no life gained
    expect(s.turn.nextSpell).toHaveLength(1);
    s = castIntoDeny(s, 'Test Bear');
    expect(findAll(s, 'Test Bear', 'battlefield')).toHaveLength(1);
  });
  it('CR 611.2: the rider applies to one spell only: the second creature spell can be countered', () => {
    let s = scenario(LIBRARY, { p1: { hand: ['Test Ward-Word', 'Test Bear', 'Test Lynx'] }, p2: { hand: ['Test Deny', 'Test Deny'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Ward-Word'));
    s = castIntoDeny(s, 'Test Bear');
    s = castIntoDeny(s, 'Test Lynx');
    expect(findAll(s, 'Test Bear', 'battlefield')).toHaveLength(1);
    expect(findAll(s, 'Test Lynx', 'battlefield')).toHaveLength(0);
  });
});

describe('CR 101.2: "you" is the rider\'s controller', () => {
  it('a creature spell an opponent casts while the rider waits can be countered, and the rider still waits for p1', () => {
    let s = scenario(LIBRARY, { p1: { hand: ['Test Ward-Word', 'Test Spark', 'Test Deny'] }, p2: { hand: ['Test Lynx'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Ward-Word'));
    s = pass(cast(s, 'Test Spark')); // p2 gets priority with a spell on the stack
    s = pass(cast(s, 'Test Lynx', [], 'p2')); // the Lynx (flash) on top; p1 gets priority
    s = resolveAll(cast(s, 'Test Deny', [target(s.zones.stack[s.zones.stack.length - 1]!)]));
    expect(findAll(s, 'Test Lynx', 'graveyard', 'p2')).toHaveLength(1);
    expect(findAll(s, 'Test Lynx', 'battlefield')).toHaveLength(0);
    expect(s.turn.nextSpell).toHaveLength(1); // still waiting for p1's next creature spell
  });
});

describe('CR 601.2i: "{T}: The next spell you cast this turn can\'t be countered." (any spell)', () => {
  it('the next spell of any kind is protected', () => {
    let s = scenario(LIBRARY, { p1: { hand: ['Test Spark'], battlefield: ['Test Hush Relic'] }, p2: { hand: ['Test Deny'] }, defs: DEFS });
    s = activateRelic(s);
    s = castIntoDeny(s, 'Test Spark');
    expect(s.players[0]!.life).toBe(21);
  });
  it('CR 611.2: the rider ends with the turn (cleared as the next turn begins)', () => {
    let s = scenario(LIBRARY, { p1: { battlefield: ['Test Hush Relic'] }, defs: DEFS });
    s = activateRelic(s);
    expect(s.turn.nextSpell).toHaveLength(1);
    const turn = s.turn.number;
    for (let i = 0; i < 200 && s.turn.number === turn; i++) s = pass(s);
    expect(s.turn.number).toBe(turn + 1);
    expect(s.turn.nextSpell).toBeUndefined();
  });
});
