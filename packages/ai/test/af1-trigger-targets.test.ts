/**
 * AF1 review (CR 603.3d, 115.3): a triggered ability whose targets each look legal alone but admit no legal SET ("tap two target creatures. Untap another
 * target creature." with exactly two creatures) is removed from the stack. The AI is never offered a decision every answer to which is rejected, and an
 * AI-vs-AI game goes on (before the fix the same answer was rejected forever and the game could not advance).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, viewFor, type Action, type CardDef, type GameState, type OracleCard } from '@openmtg/engine';
import { castAuto, scenario } from '../../engine/test/m3/scenario';
import { chooseAction } from '../src/index';

const PAIR: CardDef = compileCard({
  name: 'Test Pair Tapper', layout: 'normal', mana_cost: '{0}', type_line: 'Creature — Golem', colors: [], power: '1', toughness: '1',
  oracle_text: 'When this creature enters, tap two target creatures. Untap another target creature.',
} as OracleCard);

const ai = (s: GameState): Action => {
  const v = viewFor(s, s.pending!.player);
  return chooseAction(v, v.pending!, 'af1');
};

describe('CR 603.3d: no legal set of targets for a trigger never traps the AI (AF1 review)', () => {
  it('AI vs AI: the trigger is removed, no answer is rejected, and the game reaches the next turn', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: [PAIR.name] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [PAIR] });
    let s = castAuto(s0, PAIR.name);
    const rejected: string[] = [];
    for (let i = 0; i < 200 && s.pending && !s.result && s.turn.number < 2; i++) {
      const r = applyAction(s, ai(s));
      if (r.error) { rejected.push(r.error.message); if (rejected.length > 5) break; continue; }
      s = r.state;
    }
    expect(rejected).toEqual([]);
    expect(s.log.some((l) => /Test Pair Tapper's triggered ability is removed from the stack/.test(l.text) && l.rules?.includes('CR 603.3d'))).toBe(true);
    expect(s.turn.number).toBeGreaterThanOrEqual(2);
  });
});
