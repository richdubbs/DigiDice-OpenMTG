/**
 * M11-1: abilities of a card that function in the command zone (`feature:zone.command`; CR 113.6, eminence: the ability word has no rules meaning, CR 207.2c):
 * triggered abilities trigger there (Edgar Markov), static abilities apply from there (The Ur-Dragon's cost reduction), activated abilities are activated
 * from there (commander ninjutsu, CR 702.49d, once M11-4's keyword data says so). The abilities here are hand-built model data (M11-4 writes the templates).
 */
import { describe, expect, it } from 'vitest';
import { getChars, legalActions, type AbilityDef, type GameState } from '../../../src/index';
import { act, answerUntilPriority, card, commanderOnBattlefield, withAbilities, commanderScenario, forests, functioningIn, inCommand, legend, lifeOf, pass, untappedForests } from './helpers';

/** Eminence (Edgar Markov's shape): "Whenever you cast a Dragon spell, you gain 1 life", functioning in the command zone and on the battlefield. */
const EDGAR = functioningIn(legend('Test Edgar', '{3}{G}', ['4', '4'], ['G'], 'Whenever you cast a Dragon spell, you gain 1 life.'), ['battlefield', 'command']);
/** The Ur-Dragon's eminence shape: "Dragon spells you cast cost {1} less to cast", in the command zone and on the battlefield. */
const UR = functioningIn(legend('Test Ur', '{4}{G}', ['5', '5'], ['G'], 'Dragon spells you cast cost {1} less to cast.', 'Legendary Creature — Dragon Avatar'), ['battlefield', 'command']);
/** An activated ability that functions in the command zone (commander ninjutsu's zone, CR 702.49d). */
const PRAYER = functioningIn(legend('Test Prayer', '{G}', ['1', '1'], ['G'], '{1}: You gain 1 life.'), ['command']);
const BATTLE_ONLY = legend('Test Battle Only', '{G}', ['1', '1'], ['G'], 'Whenever you cast a Dragon spell, you gain 1 life.');
const DRAGON = card('Test Dragon', '{1}{G}', 'Creature — Dragon', '', ['2', '2']);
const BOB = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);

const castDragon = (s: GameState): GameState => answerUntilPriority(act(s, { type: 'cast', player: 'p1', card: s.zones.hand['p1']!.find((id) => s.objects[id]!.defId === DRAGON.id)! }));

describe('M11-1: abilities that function in the command zone (CR 113.6)', () => {
  it('CR 113.6 (eminence): a triggered ability of a commander in the command zone triggers there; one that functions only on the battlefield does not', () => {
    let s = commanderScenario({ p1Commanders: [EDGAR], p2Commanders: [BOB], defs: [DRAGON], p1: { battlefield: forests(2), hand: ['Test Dragon'] } });
    s = castDragon(s);
    expect(s.zones.stack.length).toBe(2); // the Dragon and the trigger above it
    s = answerUntilPriority(pass(pass(s)));
    expect(lifeOf(s, 'p1')).toBe(41);
    let t = commanderScenario({ p1Commanders: [BATTLE_ONLY], p2Commanders: [BOB], defs: [DRAGON], p1: { battlefield: forests(2), hand: ['Test Dragon'] } });
    t = castDragon(t);
    expect(t.zones.stack.length).toBe(1);
  });

  it('CR 113.6 (eminence): it triggers from the battlefield too', () => {
    let s = commanderScenario({ p1Commanders: [EDGAR], p2Commanders: [BOB], defs: [DRAGON], p1: { battlefield: [...forests(2), 'Test Edgar'], hand: ['Test Dragon'] } });
    s = commanderOnBattlefield(s, 'Test Edgar');
    s = castDragon(s);
    expect(s.zones.stack.length).toBe(2);
  });

  it('CR 113.6, 601.2f (eminence): a static cost reduction of a commander in the command zone applies to its owner\'s spells', () => {
    let s = commanderScenario({ p1Commanders: [UR], p2Commanders: [BOB], defs: [DRAGON], p1: { battlefield: forests(2), hand: ['Test Dragon'] } });
    s = castDragon(s);
    expect(untappedForests(s, 'p1')).toBe(1); // {1}{G} - {1}
  });

  it('CR 113.6, 702.49d: an activated ability that functions in the command zone is listed and activated there by its owner only', () => {
    let s = commanderScenario({ p1Commanders: [PRAYER], p2Commanders: [BOB], p1: { battlefield: forests(1) } });
    const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === inCommand(s, 'Test Prayer'));
    expect(la).toBeDefined();
    s = answerUntilPriority(act(s, la!.action));
    s = answerUntilPriority(pass(pass(s)));
    expect(lifeOf(s, 'p1')).toBe(41);
    expect(legalActions(pass(s), 'p2').some((a) => a.kind === 'activate' && a.object === inCommand(s, 'Test Prayer'))).toBe(false);
  });
});

/** Lieutenant (Stormsurge Kraken's shape; CR 903.3d: "controlling a commander" is a commander permanent on the battlefield that you control). */
const LIEUTENANT: AbilityDef = {
  kind: 'static', text: 'As long as you control your commander, ~ gets +2/+2.',
  condition: { cond: 'exists', of: { ref: 'each', filter: { commander: true, owner: 'you', controller: 'you' } } },
  effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: 2, toughness: 2 }] }],
};
const KRAKEN = withAbilities(card('Test Kraken', '{G}', 'Creature — Kraken', '', ['1', '1']), [LIEUTENANT]);

describe('M11-1: "your commander" and "controlling a commander" (CR 903.3d, the `commander` filter field)', () => {
  it('CR 903.3d: lieutenant applies only while its controller controls their commander on the battlefield', () => {
    let s = commanderScenario({ p1Commanders: [EDGAR], p2Commanders: [BOB], defs: [KRAKEN], p1: { battlefield: ['Test Kraken', 'Test Edgar'] } });
    const kraken = s.zones.battlefield.find((id) => s.objects[id]!.defId === KRAKEN.id)!;
    expect(getChars(s, kraken).power).toBe('1'); // the Edgar on the battlefield is not the commander card yet; the commander is in the command zone
    s = commanderOnBattlefield(s, 'Test Edgar');
    expect(getChars(s, kraken).power).toBe('3');
  });
});
