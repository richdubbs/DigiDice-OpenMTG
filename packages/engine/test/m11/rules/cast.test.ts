/**
 * M11-1: casting a commander from the command zone (CR 903.8) and the commander tax, per commander (CR 702.124d).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, commanderCastsOf, commanderTax, legalActions, type GameState } from '../../../src/index';
import {
  act, answerUntilPriority, card, commanderRec, commanderScenario, find, forests, inCommand, legend, logHas, pass, tweak, untappedForests,
} from './helpers';

const TITANIA = legend('Test Titania', '{1}{G}', ['2', '2'], ['G']);
const KRAUM = legend('Test Kraum', '{1}{G}', ['2', '2'], ['U', 'R'], 'Partner');
const TYMNA = legend('Test Tymna', '{G}', ['1', '1'], ['W', 'B'], 'Partner');
const BOB = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);
/** CR 903.9b by a real effect: "Return target creature to its owner's hand." */
const BOUNCE = card('Test Bounce', '{G}', 'Instant', "Return target creature to its owner's hand.");

const castLabels = (s: GameState): string[] => legalActions(s, 'p1').filter((a) => a.kind === 'cast').map((a) => a.label);
const castFromCommand = (s: GameState, name: string): GameState => answerUntilPriority(act(s, { type: 'cast', player: 'p1', card: inCommand(s, name) }));
const resolve = (s: GameState): GameState => answerUntilPriority(pass(pass(s)), [{ kind: 'commanderZone', command: true }]);

describe('M11-1: casting a commander from the command zone (CR 903.8)', () => {
  it('CR 903.8: a player may cast a commander they own from the command zone; the first cast costs no tax and is counted', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], p1: { battlefield: forests(6) } });
    expect(castLabels(s)).toContain('Cast Test Titania from the command zone');
    s = castFromCommand(s, 'Test Titania');
    expect(s.objects[s.zones.stack[0]!]!.defId).toBe(TITANIA.id);
    expect(untappedForests(s, 'p1')).toBe(4); // {1}{G}: no tax on the first cast
    expect(commanderRec(s, 'p1', 'Test Titania').casts).toBe(1); // CR 601.2i: counted as it becomes cast
    expect(commanderCastsOf(s, 'p1')).toBe(1);
    expect(logHas(s, /casts Test Titania from the command zone/, 'CR 903.8')).toBe(true);
    s = pass(pass(s));
    expect(s.objects[s.zones.battlefield.find((id) => s.objects[id]!.defId === TITANIA.id)!]).toBeDefined();
  });

  it('CR 903.8: the second cast from the command zone costs {2} more; the third {4} more', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [BOUNCE], p1: { battlefield: forests(7), hand: ['Test Bounce'] } });
    s = resolve(castFromCommand(s, 'Test Titania')); // 2 Forests
    const titania = s.zones.battlefield.find((id) => s.objects[id]!.defId === TITANIA.id)!;
    s = answerUntilPriority(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bounce', 'hand', 'p1') }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: titania }] }]);
    s = resolve(s); // CR 903.9b: back to the command zone instead of the hand
    expect(inCommand(s, 'Test Titania')).toBeDefined();
    expect(untappedForests(s, 'p1')).toBe(4);
    expect(commanderTax(s, commanderRec(s, 'p1', 'Test Titania').card)).toBe(2);
    s = castFromCommand(s, 'Test Titania');
    expect(untappedForests(s, 'p1')).toBe(0); // {1}{G} + {2}
    expect(logHas(s, /commander tax \{2\}/, 'CR 903.8')).toBe(true);
    expect(commanderRec(s, 'p1', 'Test Titania').casts).toBe(2);
    expect(commanderTax(s, commanderRec(s, 'p1', 'Test Titania').card)).toBe(4);
  });

  it('CR 903.8, 601.2f-h: a commander whose cost with the tax can not be paid is not offered, and the cast is refused', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], p1: { battlefield: forests(3) } });
    s = tweak(s, (t) => { commanderRec(t, 'p1', 'Test Titania').casts = 1; });
    expect(castLabels(s)).not.toContain('Cast Test Titania from the command zone'); // {1}{G}{2} = 4 mana, 3 Forests
    expect(applyAction(s, { type: 'cast', player: 'p1', card: inCommand(s, 'Test Titania') }).error).toBeDefined();
  });

  it('CR 702.124d: each partner has its own tax: Kraum cast once costs {2} more, Tymna\'s first cast none', () => {
    let s = commanderScenario({ p1Commanders: [KRAUM, TYMNA], p2Commanders: [BOB], p1: { battlefield: forests(3) } });
    s = tweak(s, (t) => { commanderRec(t, 'p1', 'Test Kraum').casts = 1; });
    expect(commanderTax(s, commanderRec(s, 'p1', 'Test Kraum').card)).toBe(2);
    expect(commanderTax(s, commanderRec(s, 'p1', 'Test Tymna').card)).toBe(0);
    expect(castLabels(s)).toEqual(['Cast Test Tymna from the command zone']); // Kraum would cost {3}{G}
    s = castFromCommand(s, 'Test Tymna');
    expect(untappedForests(s, 'p1')).toBe(2);
    expect(commanderRec(s, 'p1', 'Test Tymna').casts).toBe(1);
    expect(commanderRec(s, 'p1', 'Test Kraum').casts).toBe(1);
    expect(commanderCastsOf(s, 'p1')).toBe(2); // CR 903.8 "your commander" with partners: both counted (Commander's Insignia)
  });

  it('CR 903.8: only its owner casts a commander from the command zone, with the normal timing permissions (CR 307.1)', () => {
    let s = commanderScenario({ p1Commanders: [KRAUM, TYMNA], p2Commanders: [BOB], p1: { battlefield: forests(4) }, p2: { battlefield: forests(2) } });
    expect(castLabels(s)).not.toContain('Cast Test Bob Commander from the command zone');
    expect(applyAction(s, { type: 'cast', player: 'p1', card: inCommand(s, 'Test Bob Commander') }).error?.rules).toContain('CR 601.3');
    s = castFromCommand(s, 'Test Tymna');
    expect(castLabels(s)).toEqual([]); // a creature spell is on the stack: no sorcery-speed cast (CR 307.1)
    s = pass(s); // Bob has priority
    expect(legalActions(s, 'p2').some((a) => a.kind === 'cast')).toBe(false); // Bob's commander at instant speed: no
  });
});
