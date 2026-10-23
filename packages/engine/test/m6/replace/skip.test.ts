/**
 * M6-1: skipping steps, phases and turns (m6 design E10, 3.2; CR 614.10, 614.10a): core/turn.ts proposes each turn, phase and step before it begins
 * (core/turn-skip.ts), so a `skip` replacement, static or a shield, replaces it.
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ReplacementDef } from '../../../src/index';
import { answer, pass, scenario } from '../../m5/helpers';
import { enchantment, shieldRecord } from './support';

/** Pass priority until the given turn's step (or a later one) begins with someone to act. */
function passUntil(s: GameState, done: (s: GameState) => boolean, max = 200): GameState {
  let t = s;
  for (let i = 0; i < max && !done(t); i++) {
    // two identical shields: the affected player chooses which one is applied (CR 616.1); either way the step is skipped
    t = t.pending?.kind === 'chooseReplacement' ? answer(t, { kind: 'chooseReplacement', id: t.pending.options[0]!.id }) : pass(t);
  }
  if (!done(t)) throw new Error(`not reached (turn ${t.turn.number}, ${t.turn.step})`);
  return t;
}
const stepsOfTurn = (s: GameState, turn: number): string[] => {
  const out: string[] = [];
  let n = 0;
  for (const l of s.log) {
    const m = /^Turn (\d+):/.exec(l.text);
    if (m) n = Number(m[1]);
    if (n === turn && /draws a card/.test(l.text)) out.push('draw');
  }
  return out;
};
const handSize = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;

/** Fatigue: "Target player skips their next draw step." (the shield the spell makes for that player, CR 614.10a) */
const fatigue = (player: 'p1' | 'p2', id: string): ReturnType<typeof shieldRecord> =>
  shieldRecord(id, { s: 'replace', replaces: { ev: 'step', step: 'draw', whose: { ref: 'fixed', players: [player] } as never }, body: { b: 'skip' }, shield: { uses: 1 } } as ReplacementDef, { duration: { d: 'permanent' } });

describe('CR 614.10: skip a step', () => {
  it('CR 614.10a: Fatigue: Bob skips his next draw step (turn 2), and draws normally on turn 4', () => {
    const s0 = scenario([]);
    const s1 = structuredClone(s0);
    s1.continuousEffects.push(fatigue('p2', 'e40'));
    const before = handSize(s1, 'p2');
    const t2 = passUntil(s1, (t) => t.turn.number === 2 && t.turn.step === 'main1');
    expect(handSize(t2, 'p2')).toBe(before);
    expect(t2.continuousEffects.find((x) => x.id === 'e40')).toBeUndefined(); // used
    const t4 = passUntil(t2, (t) => t.turn.number === 4 && t.turn.step === 'main1');
    expect(handSize(t4, 'p2')).toBeGreaterThan(before);
  });

  it('CR 614.10a: two "skip your next draw step" effects skip two draw steps (each waits for the first draw step the other did not skip)', () => {
    const s1 = structuredClone(scenario([]));
    s1.continuousEffects.push(fatigue('p2', 'e41'), fatigue('p2', 'e42'));
    const before = handSize(s1, 'p2');
    const t4 = passUntil(s1, (t) => t.turn.number === 4 && t.turn.step === 'main1');
    expect(handSize(t4, 'p2')).toBe(before);
    const t6 = passUntil(t4, (t) => t.turn.number === 6 && t.turn.step === 'main1');
    expect(handSize(t6, 'p2')).toBe(before + 1);
    expect(stepsOfTurn(t6, 2)).toEqual([]);
  });

  it('CR 614.10: a static "skip your draw step" applies to every one of its controller\'s draw steps, never to the opponent\'s', () => {
    const s = scenario([], { p2: { battlefield: ['Test No Draw Step'] }, defs: [enchantment('Test No Draw Step', [{ s: 'replace', replaces: { ev: 'step', step: 'draw', whose: 'you' }, body: { b: 'skip' } }])] });
    const before2 = handSize(s, 'p2');
    const before1 = handSize(s, 'p1');
    const t5 = passUntil(s, (t) => t.turn.number === 5 && t.turn.step === 'main1');
    expect(handSize(t5, 'p2')).toBe(before2);
    expect(handSize(t5, 'p1')).toBe(before1 + 2); // turns 3 and 5
  });
});

describe('CR 614.10: skip a phase, skip a turn', () => {
  it('CR 614.10: "skip your next combat phase": the combat steps of that turn do not begin', () => {
    const s1 = structuredClone(scenario([]));
    s1.continuousEffects.push(shieldRecord('e43', { s: 'replace', replaces: { ev: 'phase', phase: 'combat', whose: { ref: 'fixed', players: ['p1'] } as never }, body: { b: 'skip' }, shield: { uses: 1 } } as ReplacementDef, { duration: { d: 'permanent' } }));
    const t = passUntil(s1, (x) => x.turn.number === 1 && x.turn.step === 'main2');
    expect(t.log.some((l) => /skips the combat phase/.test(l.text))).toBe(true);
    expect(t.log.some((l) => /beginCombat|beginning of combat/i.test(l.text) && l.text.includes('Turn 1'))).toBe(false);
    expect(t.continuousEffects.find((x) => x.id === 'e43')).toBeUndefined();
  });

  it('CR 614.10, 500.7: "skip your next turn": Bob\'s turn 2 does not happen; the next turn is Alice\'s, then Bob\'s', () => {
    const s1 = structuredClone(scenario([]));
    s1.continuousEffects.push(shieldRecord('e44', { s: 'replace', replaces: { ev: 'beginTurn', whose: { ref: 'fixed', players: ['p2'] } as never }, body: { b: 'skip' }, shield: { uses: 1 } } as ReplacementDef, { duration: { d: 'permanent' } }));
    const t2 = passUntil(s1, (x) => x.turn.number === 2 && x.turn.step === 'main1');
    expect(t2.turn.activePlayer).toBe('p1');
    const t3 = passUntil(t2, (x) => x.turn.number === 3 && x.turn.step === 'main1');
    expect(t3.turn.activePlayer).toBe('p2');
  });
});
