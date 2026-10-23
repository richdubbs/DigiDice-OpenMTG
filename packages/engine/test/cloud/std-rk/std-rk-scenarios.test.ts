/**
 * Round std-rk (slot K, Commander precon cards): the readings of the round played through the engine with synthetic cards compiled by the game's
 * default compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 505.1a, 603.2      "at the beginning of each of your postcombat main phases" triggers in your postcombat main phase only (parser/holes/event.ts)
 *   CR 102.3, 608.2h      "for each opponent who controls fewer lands than you", "the number of opponents who control more lands than you", "the number of
 *                         opponents you have": the opponents of the controller, each judged alone, counted as the ability resolves (parser/holes/qty.ts)
 *   CR 700.6              "the number of historic permanents you control": artifacts, legendary permanents and Sagas, each counted once (render/np.ts)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, battlefieldNames, find, life, pass, scenario, zoneNames } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';

/** Answer what comes up (costs are paid automatically); stop at priority. */
function settle(s0: GameState): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}
const cast = (s0: GameState, name: string, who: PlayerId = 'p1'): GameState => settle(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }));
function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = settle(pass(pass(s)));
  return s;
}
const hand = (s: GameState, p: PlayerId = 'p1'): string[] => zoneNames(s, 'hand', p);
const ptOf = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const PLAIN_LAND = card('Test Field', 'Land', '');

describe('std-rk cards compile fully', () => {
  it('every synthetic card of these scenarios with an ability is fully automated', () => {
    for (const d of [WARDEN, VIGIL, TONIC, OWL, SPHINX, ENVOY, CHRONICLER]) expect(full(d), d.name).toBe(true);
  });
});

// ---- event reading: "each of your postcombat main phases" -------------------------------------------------------------------------------------------------

const WARDEN = card('Test Dusk Warden', 'Creature — Elf', 'At the beginning of each of your postcombat main phases, you gain 2 life.', { pt: ['1', '1'] });

describe('CR 505.1a, 603.2: "At the beginning of each of your postcombat main phases, you gain 2 life."', () => {
  it('triggers in the postcombat main phase of its controller\'s turn: p1 gains 2 life there, nothing in the precombat main phase', () => {
    let s = scenario([], { p1: { battlefield: ['Test Dusk Warden'] }, defs: [WARDEN] });
    expect(s.turn.step).toBe('main1');
    expect(s.zones.stack).toHaveLength(0);
    s = advanceTo(s, 1, 'main2');
    expect(s.zones.stack).toHaveLength(1);
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(22);
  });
  it('CR 505.1a: not in another player\'s postcombat main phase (p2\'s turn 2)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Dusk Warden'] }, defs: [WARDEN] });
    s = resolveAll(advanceTo(s, 1, 'main2'));
    expect(life(s, 'p1')).toBe(22);
    s = advanceTo(s, 2, 'main2');
    expect(s.zones.stack).toHaveLength(0);
    s = advanceTo(s, 2, 'end');
    expect(life(s, 'p1')).toBe(22);
  });
});

const VIGIL = card('Test Dusk Vigil', 'Enchantment', 'At the beginning of each of your postcombat main phases, if you gained 3 or more life this turn, draw a card.');
const TONIC = card('Test Tonic', 'Sorcery', 'You gain 3 life.');

describe('CR 603.4, 505.1a: "At the beginning of each of your postcombat main phases, if you gained 3 or more life this turn, draw a card." (the G10 change of this round)', () => {
  it('the condition is the ability\'s intervening "if" (not a step of its effect): the ability is understood as a whole', () => {
    const a = VIGIL.faces[0]!.abilities[0]! as unknown as { kind: string; interveningIf?: unknown };
    expect(a.kind).toBe('triggered');
    expect(a.interveningIf).toEqual({ cond: 'compare', left: { q: 'lifeGainedThisTurn' }, op: '>=', right: 3 });
  });
  it('after gaining 3 life in the precombat main phase it triggers in the postcombat main phase and draws', () => {
    let s = scenario([], { p1: { hand: ['Test Tonic'], battlefield: ['Test Dusk Vigil'] }, defs: [VIGIL, TONIC] });
    s = resolveAll(cast(s, 'Test Tonic'));
    const before = hand(s).length;
    s = advanceTo(s, 1, 'main2');
    expect(s.zones.stack).toHaveLength(1);
    s = resolveAll(s);
    expect(hand(s).length).toBe(before + 1);
  });
  it('CR 603.4: with no life gained it does not trigger at all', () => {
    let s = scenario([], { p1: { battlefield: ['Test Dusk Vigil'] }, defs: [VIGIL] });
    s = advanceTo(s, 1, 'main2');
    expect(s.zones.stack).toHaveLength(0);
  });
});

// ---- Qty readings: counted opponents ----------------------------------------------------------------------------------------------------------------------

const OWL = card('Test Census Owl', 'Creature — Bird', 'When this creature enters, draw a card for each opponent who controls fewer lands than you.', { pt: ['1', '1'] });
const SPHINX = card('Test Tally Sphinx', 'Creature — Sphinx', 'When this creature enters, put X +1/+1 counters on it, where X is the number of opponents you have.', { pt: ['2', '2'] });
const ENVOY = card('Test Land Envoy', 'Creature — Human', 'When this creature enters, create X 1/1 white Spirit creature tokens with flying, where X is the number of opponents who control more lands than you.', { pt: ['1', '1'] });

describe('CR 102.3, 608.2h: "draw a card for each opponent who controls fewer lands than you"', () => {
  it('the opponent controls fewer lands than p1: one card', () => {
    let s = scenario([], { p1: { hand: ['Test Census Owl'], battlefield: ['Test Field', 'Test Field'] }, p2: { battlefield: ['Test Field'] }, defs: [OWL, PLAIN_LAND] });
    const before = hand(s).length;
    s = resolveAll(cast(s, 'Test Census Owl'));
    expect(hand(s).length).toBe(before - 1 + 1);
  });
  it('a tie is not fewer: the opponent controls as many lands as p1, no card', () => {
    let s = scenario([], { p1: { hand: ['Test Census Owl'], battlefield: ['Test Field'] }, p2: { battlefield: ['Test Field'] }, defs: [OWL, PLAIN_LAND] });
    const before = hand(s).length;
    s = resolveAll(cast(s, 'Test Census Owl'));
    expect(hand(s).length).toBe(before - 1);
  });
  it('lands are counted, not other permanents: p1\'s creatures do not make the opponent\'s land count "fewer"', () => {
    let s = scenario([], { p1: { hand: ['Test Census Owl'], battlefield: ['Test Field', 'Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Field', 'Test Field'] }, defs: [OWL, BEAR, PLAIN_LAND] });
    const before = hand(s).length;
    s = resolveAll(cast(s, 'Test Census Owl'));
    expect(hand(s).length).toBe(before - 1);
  });
});

describe('CR 102.3, 608.2h: "put X +1/+1 counters on it, where X is the number of opponents you have"', () => {
  it('in a two-player game p1 has one opponent: one counter (a 2/2 becomes 3/3)', () => {
    let s = scenario([], { p1: { hand: ['Test Tally Sphinx'] }, defs: [SPHINX] });
    s = resolveAll(cast(s, 'Test Tally Sphinx'));
    expect(ptOf(s, find(s, 'Test Tally Sphinx', 'battlefield', 'p1'))).toBe('3/3');
  });
});

describe('CR 102.3, 608.2h: "where X is the number of opponents who control more lands than you"', () => {
  it('the opponent controls more lands: one Spirit token', () => {
    let s = scenario([], { p1: { hand: ['Test Land Envoy'], battlefield: ['Test Field'] }, p2: { battlefield: ['Test Field', 'Test Field'] }, defs: [ENVOY, PLAIN_LAND] });
    s = resolveAll(cast(s, 'Test Land Envoy'));
    expect(battlefieldNames(s, 'p1').filter((n) => n !== 'Test Land Envoy' && n !== 'Test Field')).toHaveLength(1);
  });
  it('as many lands is not more: no token; lands p1 controls are never the opponent\'s', () => {
    let s = scenario([], { p1: { hand: ['Test Land Envoy'], battlefield: ['Test Field', 'Test Field'] }, p2: { battlefield: ['Test Field', 'Test Field'] }, defs: [ENVOY, PLAIN_LAND] });
    s = resolveAll(cast(s, 'Test Land Envoy'));
    expect(battlefieldNames(s, 'p1').filter((n) => n !== 'Test Land Envoy' && n !== 'Test Field')).toHaveLength(0);
  });
});

// ---- renderer: "historic permanents" ----------------------------------------------------------------------------------------------------------------------

const CHRONICLER = card('Test Chronicler', 'Creature — Human Wizard', 'When this creature enters, draw cards equal to the number of historic permanents you control.', { pt: ['1', '1'] });
const ROCK = card('Test Rock', 'Artifact', '');
const LEGEND = card('Test Legend', 'Legendary Creature — Human', '', { pt: ['2', '2'] });
const RELIC_LEGEND = card('Test Crowned Relic', 'Legendary Artifact', '');

describe('CR 700.6: "draw cards equal to the number of historic permanents you control"', () => {
  it('an artifact, a legendary creature and a legendary artifact count once each; a Bear, a land and the opponent\'s artifact do not', () => {
    let s = scenario([], {
      p1: { hand: ['Test Chronicler'], battlefield: ['Test Rock', 'Test Legend', 'Test Crowned Relic', 'Test Bear', 'Test Field'] },
      p2: { battlefield: ['Test Rock'] },
      defs: [CHRONICLER, ROCK, LEGEND, RELIC_LEGEND, BEAR, PLAIN_LAND],
    });
    const before = hand(s).length;
    s = resolveAll(cast(s, 'Test Chronicler'));
    expect(hand(s).length).toBe(before - 1 + 3);
  });
  it('with no historic permanent, no card (the Chronicler itself is neither an artifact nor legendary)', () => {
    let s = scenario([], { p1: { hand: ['Test Chronicler'], battlefield: ['Test Bear'] }, defs: [CHRONICLER, BEAR] });
    const before = hand(s).length;
    s = resolveAll(cast(s, 'Test Chronicler'));
    expect(hand(s).length).toBe(before - 1);
  });
});
