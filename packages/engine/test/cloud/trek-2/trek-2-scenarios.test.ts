/**
 * trek-2 (lane trek, Star Trek cards): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's
 * default compiler. Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout);
 * "face a dilemma" is a new term whose rule number is not known here (the card's reminder text says what it is).
 *
 *   CR 700.2, 601.2b,   "Whenever you face a dilemma, draw a card." ("You face a dilemma as you choose one or more modes for a spell or ability."): a modal spell cast,
 *   602.2b, 603.3c      a modal ability activated and a modal triggered ability put on the stack each make it trigger once; a spell without modes, an opponent's
 *                       modal spell and modes picked at random do not
 *   CR 601.2i, 707.10   "If this spell is the first spell you've cast this game, ...": the first spell its caster cast this game, also when another spell is cast in
 *                       response; not after a spell of the same player earlier this game (an earlier turn too); an opponent's spells do not count
 *   CR 603.2d, 119.9    "If you gaining life causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.": your
 *                       life-gain triggers twice; an opponent's gain, an opponent's permanent and a trigger of another event once
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, DecisionAnswer, GameState, PlayerId } from '../../../src/index';
import { act, answer, scenario } from '../../m5/helpers';
import { advanceTo } from '../../m5/helpers';
import { activate, drive, handSize, resolveAll } from '../../m5/cr-examples/helpers';
import { castWith, synthetic } from '../../m6/costs/support';

const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const mode = (id: string): DecisionAnswer => ({ kind: 'chooseOption', ids: [id] });
const onField = (s: GameState, name: string): string => s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === name)!;

describe('CR 700.2, 601.2b, 602.2b, 603.3c: "Whenever you face a dilemma, draw a card."', () => {
  const SEER = synthetic('Test Quandary Seer', 'Artifact Creature — Human Scientist', '{0}', 'Whenever you face a dilemma, draw a card.', { power: '2', toughness: '4' });
  const CHARM = synthetic('Test Twin Charm', 'Instant', '{0}', 'Choose one —\n• You gain 2 life.\n• You gain 3 life.');
  const SALVE = synthetic('Test Plain Salve', 'Instant', '{0}', 'You gain 1 life.');
  const ENGINE = synthetic('Test Choice Engine', 'Artifact', '{0}', '{T}: Choose one —\n• You gain 1 life.\n• You lose 1 life.');
  const SENTRY = synthetic('Test Fork Sentry', 'Creature — Human', '{0}', 'When this creature enters, choose one —\n• You gain 1 life.\n• You gain 2 life.', { power: '1', toughness: '1' });
  const ODDS = synthetic('Test Odd Charm', 'Instant', '{0}', 'Choose one at random —\n• You gain 2 life.\n• You gain 3 life.');
  const DEFS = [SEER, CHARM, SALVE, ENGINE, SENTRY, ODDS];

  it('the trigger and the modal cards are automated', () => {
    for (const d of [SEER, CHARM, ENGINE, SENTRY, ODDS]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
  it('CR 601.2b, 700.2: casting a modal spell is one dilemma: one card drawn; the chosen mode still happens', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Quandary Seer'], hand: ['Test Twin Charm'] } });
    const s1 = castWith(s0, 'Test Twin Charm', [mode('1')]);
    const s = resolveAll(s1);
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') - 1 + 1);
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1') + 3);
  });
  it('negative: a spell without modes is no dilemma; without the Seer a modal spell draws nothing', () => {
    let s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Quandary Seer'], hand: ['Test Plain Salve'] } });
    let s = resolveAll(castWith(s0, 'Test Plain Salve'));
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') - 1);
    s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Twin Charm'] } });
    s = resolveAll(castWith(s0, 'Test Twin Charm', [mode('0')]));
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') - 1);
  });
  it('CR 602.2b: activating a modal ability is a dilemma', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Quandary Seer', 'Test Choice Engine'] } });
    const s = resolveAll(activate(s0, onField(s0, 'Test Choice Engine'), [mode('0')]));
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') + 1);
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1') + 1);
  });
  it('CR 603.3c: putting a modal triggered ability on the stack is a dilemma (its modes are chosen then)', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Quandary Seer'], hand: ['Test Fork Sentry'] } });
    let s = castWith(s0, 'Test Fork Sentry');
    s = drive(act(s, { type: 'pass', player: 'p1' }));
    s = drive(act(s, { type: 'pass', player: s.pending!.player }), [mode('1')]);
    s = resolveAll(s);
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') - 1 + 1);
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1') + 2);
  });
  it('negative: an opponent casting a modal spell is their dilemma, not yours', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Quandary Seer'] }, p2: { hand: ['Test Twin Charm'] } });
    s = advanceTo(s, 2, 'main1');
    const before = handSize(s, 'p1');
    s = resolveAll(castWith(s, 'Test Twin Charm', [mode('0')], undefined, 'p2'));
    expect(handSize(s, 'p1')).toBe(before);
    expect(lifeOf(s, 'p2')).toBe(20 + 2);
  });
  it('CR 700.2 (fail closed): modes picked at random are chosen by nobody: no dilemma', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Quandary Seer'], hand: ['Test Odd Charm'] } });
    const s = resolveAll(castWith(s0, 'Test Odd Charm'));
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') - 1);
    expect(lifeOf(s, 'p1')).toBeGreaterThan(lifeOf(s0, 'p1'));
  });
});

describe('CR 601.2i, 707.10: "If this spell is the first spell you\'ve cast this game, you gain 3 life."', () => {
  const OPENER = synthetic('Test Opening Gambit', 'Instant', '{0}', "Draw a card. If this spell is the first spell you've cast this game, you gain 3 life.");
  const SALVE = synthetic('Test Plain Salve', 'Instant', '{0}', 'You gain 1 life.');
  const DEFS = [OPENER, SALVE];

  it('is automated', () => expect(full(OPENER), JSON.stringify(OPENER.automation)).toBe(true));
  it('CR 601.2i: the first spell its caster cast this game: 3 life (and the card)', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Opening Gambit'] } });
    const s = resolveAll(castWith(s0, 'Test Opening Gambit'));
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1') + 3);
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') - 1 + 1);
  });
  it('a spell cast in response, after it, does not change that it was the first: 1 + 3 life', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Opening Gambit', 'Test Plain Salve'] } });
    let s = castWith(s0, 'Test Opening Gambit');
    expect(s.pending?.player).toBe('p1');
    s = castWith(s, 'Test Plain Salve');
    s = resolveAll(s);
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1') + 1 + 3);
  });
  it('negative: after another spell of the same player this turn, no life', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Opening Gambit', 'Test Plain Salve'] } });
    let s = resolveAll(castWith(s0, 'Test Plain Salve'));
    s = resolveAll(castWith(s, 'Test Opening Gambit'));
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1') + 1);
  });
  it('negative: "this game": a spell the same player cast on an earlier turn counts', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Opening Gambit', 'Test Plain Salve'] } });
    s = resolveAll(castWith(s, 'Test Plain Salve'));
    s = advanceTo(s, 3, 'main1');
    const before = lifeOf(s, 'p1');
    s = resolveAll(castWith(s, 'Test Opening Gambit'));
    expect(lifeOf(s, 'p1')).toBe(before);
  });
  it('"you": an opponent\'s spells cast earlier do not count', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Opening Gambit'] }, p2: { hand: ['Test Plain Salve'] } });
    s = advanceTo(s, 2, 'main1');
    s = resolveAll(castWith(s, 'Test Plain Salve', [], undefined, 'p2'));
    s = advanceTo(s, 3, 'main1');
    const before = lifeOf(s, 'p1');
    s = resolveAll(castWith(s, 'Test Opening Gambit'));
    expect(lifeOf(s, 'p1')).toBe(before + 3);
  });
});

describe('CR 603.2d, 119.9: "If you gaining life causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time."', () => {
  const MEDIC = synthetic('Test Field Medic', 'Creature — Human Doctor', '{0}', 'If you gaining life causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.\nWhenever you gain life, put a +1/+1 counter on this creature.', { power: '2', toughness: '2' });
  const NURSE = synthetic('Test Ward Nurse', 'Creature — Human', '{0}', 'Whenever you gain life, put a +1/+1 counter on this creature.', { power: '1', toughness: '1' });
  const LEDGER = synthetic('Test Bright Ledger', 'Enchantment', '{0}', 'Whenever you gain life, draw a card.');
  const RIVAL = synthetic('Test Rival Ledger', 'Enchantment', '{0}', 'Whenever an opponent gains life, draw a card.');
  const WATCH = synthetic('Test Gate Watcher', 'Enchantment', '{0}', 'Whenever another creature you control enters, draw a card.');
  const PUP = synthetic('Test Small Pup', 'Creature — Dog', '{0}', '', { power: '1', toughness: '1' });
  const SALVE = synthetic('Test Warm Salve', 'Instant', '{0}', 'You gain 2 life.');
  const DEFS = [MEDIC, NURSE, LEDGER, RIVAL, WATCH, PUP, SALVE];
  const counters = (s: GameState, name: string): number => s.objects[onField(s, name)]!.counters['+1/+1'] ?? 0;

  it('is automated', () => expect(full(MEDIC), JSON.stringify(MEDIC.automation)).toBe(true));
  it('CR 603.2d: your gain of life makes your "whenever you gain life" abilities trigger twice (its own and another permanent\'s)', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Field Medic', 'Test Bright Ledger'], hand: ['Test Warm Salve'] } });
    const s = resolveAll(castWith(s0, 'Test Warm Salve'));
    expect(counters(s, 'Test Field Medic')).toBe(2);
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') - 1 + 2);
  });
  it('negative: without the Medic the same trigger once', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Ward Nurse'], hand: ['Test Warm Salve'] } });
    const s = resolveAll(castWith(s0, 'Test Warm Salve'));
    expect(counters(s, 'Test Ward Nurse')).toBe(1);
  });
  it('negative: an opponent gaining life is not "you gaining life": your "whenever an opponent gains life" and their own trigger once each', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Field Medic', 'Test Rival Ledger'] }, p2: { battlefield: ['Test Bright Ledger'], hand: ['Test Warm Salve'] } });
    s = advanceTo(s, 2, 'main1');
    const h1 = handSize(s, 'p1');
    const h2 = handSize(s, 'p2');
    s = resolveAll(castWith(s, 'Test Warm Salve', [], undefined, 'p2'));
    expect(handSize(s, 'p1')).toBe(h1 + 1);
    expect(handSize(s, 'p2')).toBe(h2 - 1 + 1);
    expect(counters(s, 'Test Field Medic')).toBe(0);
  });
  it('negative: a trigger caused by another event (a creature entering) once', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Field Medic', 'Test Gate Watcher'], hand: ['Test Small Pup'] } });
    const s = resolveAll(castWith(s0, 'Test Small Pup'));
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') - 1 + 1);
  });
});
