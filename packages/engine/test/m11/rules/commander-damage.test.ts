/**
 * M11-1: commander damage (CR 903.10a, 704.6c, 702.124d): combat damage dealt by each commander to each player is tallied by the commander's card, and a
 * player dealt 21 or more by the same commander loses. Not in Brawl (CR 903.12h) nor Duel Commander (its format rules, test/m11/rules/variants.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, commanderDamageTo, legalActions, type GameEvent, type GameState } from '../../../src/index';
import { act, answerUntilPriority, commanderOnBattlefield, commanderScenario, legend, lifeOf, logHas, pass, runCombat, tweak } from './helpers';

const TITANIA = legend('Test Titania', '{G}', ['5', '5'], ['G']);
const KRAUM = legend('Test Kraum', '{G}', ['4', '4'], ['U', 'R'], 'Partner');
const TYMNA = legend('Test Tymna', '{G}', ['2', '2'], ['W', 'B'], 'Partner');
const PINGER = legend('Test Pinger', '{G}', ['1', '1'], ['R'], '{T}: Test Pinger deals 3 damage to any target.');
const BOB = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);

const cardOf = (s: GameState, name: string): string => s.players.flatMap((p) => p.commanders ?? []).find((c) => s.defs[c.defId]!.name === name)!.card;
const idOn = (s: GameState, name: string): string => s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === name)!;

function attackWith(variant: 'commander' | 'brawl' | 'duel', names: string[], commanders = [TITANIA]): GameState {
  let s = commanderScenario({ variant, p1Commanders: commanders, p2Commanders: [BOB], p1: { battlefield: names } });
  for (const n of names) s = commanderOnBattlefield(s, n);
  return s;
}

describe('M11-1: commander damage (CR 903.10a, 704.6c)', () => {
  it('CR 903.10a: combat damage a commander deals to a player is tallied by the commander card, with a commanderDamage event right after the damage', () => {
    const s0 = attackWith('commander', ['Test Titania']);
    // drive the combat by hand to see the events of the damage step
    let s = runCombat(s0, { attack: [[idOn(s0, 'Test Titania')]], until: 'combatDamage' });
    expect(commanderDamageTo(s, 'p2', cardOf(s, 'Test Titania'))).toBe(5);
    expect(lifeOf(s, 'p2')).toBe(35);
    expect(logHas(s, /has dealt 5 combat damage to Bob as a commander/, 'CR 903.10a')).toBe(true);
    // the event: replay the last pass that dealt the damage
    s = runCombat(s0, { attack: [[idOn(s0, 'Test Titania')]], until: 'declareBlockers' });
    let events: GameEvent[] = [];
    for (let i = 0; i < 6 && s.turn.step !== 'combatDamage'; i++) {
      const r = applyAction(s, { type: 'pass', player: s.pending!.player });
      events = r.events;
      s = answerUntilPriority(r.state);
    }
    const dealt = events.findIndex((e) => e.type === 'damageDealt' && e.target === 'p2');
    expect(dealt).toBeGreaterThanOrEqual(0);
    expect(events[dealt + 1]).toMatchObject({ type: 'commanderDamage', player: 'p2', commander: cardOf(s, 'Test Titania'), amount: 5, total: 5 });
  });

  it('CR 704.6c: a player dealt 21 or more combat damage by the same commander over the game loses (life 40 does not matter)', () => {
    let s = attackWith('commander', ['Test Titania']);
    s = tweak(s, (t) => { t.players.find((p) => p.id === 'p2')!.commanderDamage = { [cardOf(t, 'Test Titania')]: 16 }; });
    s = runCombat(s, { attack: [[idOn(s, 'Test Titania')]] });
    expect(lifeOf(s, 'p2')).toBe(35);
    expect(s.result?.winner).toBe('p1');
    expect(logHas(s, /Bob loses the game: has been dealt 21 combat damage by the commander Test Titania/, 'CR 704.6c')).toBe(true);
  });

  it('CR 702.124d: each partner\'s damage is counted separately: 19 from Kraum and 2 more from Tymna is no loss', () => {
    let s = attackWith('commander', ['Test Tymna'], [KRAUM, TYMNA]);
    s = tweak(s, (t) => { t.players.find((p) => p.id === 'p2')!.commanderDamage = { [cardOf(t, 'Test Kraum')]: 19 }; });
    s = runCombat(s, { attack: [[idOn(s, 'Test Tymna')]] });
    expect(s.result).toBeFalsy();
    expect(commanderDamageTo(s, 'p2', cardOf(s, 'Test Tymna'))).toBe(2);
    expect(commanderDamageTo(s, 'p2', cardOf(s, 'Test Kraum'))).toBe(19);
  });

  it('CR 903.10a: noncombat damage from a commander does not count', () => {
    let s = attackWith('commander', ['Test Pinger'], [PINGER]);
    const pinger = idOn(s, 'Test Pinger');
    const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === pinger)!;
    s = answerUntilPriority(act(s, la.action), [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }]);
    s = answerUntilPriority(pass(pass(s)));
    expect(lifeOf(s, 'p2')).toBe(37);
    expect(s.players.find((p) => p.id === 'p2')!.commanderDamage).toBeUndefined();
  });

  it('CR 903.12h: Brawl does not use the rule: no tally, no loss', () => {
    let s = attackWith('brawl', ['Test Titania']);
    s = runCombat(s, { attack: [[idOn(s, 'Test Titania')]] });
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(s.players.find((p) => p.id === 'p2')!.commanderDamage).toBeUndefined();
  });
});
