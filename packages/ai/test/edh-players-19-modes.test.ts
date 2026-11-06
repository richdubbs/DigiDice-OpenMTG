/**
 * edh-players-19 (CR 700.2, 603.3c): the bot answers a "you may choose two" mode decision (`noneOrAll`) with no mode or exactly two, never one, whatever the modes are worth.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, viewFor, type CardDef, type GameState } from '@openmtg/engine';
import { act } from '../../engine/test/m3/scenario';
import { mpScenario } from '../../engine/test/m12/rules/helpers';
import { chooseAction } from '../src/index';

const TEXT = ['Target player draws a card.', 'Target player loses 1 life.', 'Target player gains 2 life.', 'Target player discards a card.', 'Target player mills a card.', 'Target player gains 1 life.'];

function dragon(modes: string[]): CardDef {
  const text = `At the beginning of combat on your turn, you may choose two. Each mode must target a different player.\n${modes.map((m) => `• ${m}`).join('\n')}`;
  return compileCard({ name: 'Test Dragon', layout: 'normal', mana_cost: '{0}', type_line: 'Creature — Dragon', oracle_text: text, colors: [], keywords: [], power: '4', toughness: '4' } as never);
}
/** Pass priority until the modal trigger asks for its modes. */
function toModes(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 60 && s.pending?.kind !== 'chooseOption'; i++) {
    if (s.pending?.kind !== 'priority') throw new Error(`unexpected ${s.pending?.kind}`);
    s = act(s, { type: 'pass', player: s.pending.player });
  }
  return s;
}

describe('CR 700.2, 603.3c: "you may choose two" is answered with none or exactly two modes', () => {
  it('whatever the three modes are worth, the answer to the real decision is no mode or two, never one', () => {
    let seen = 0;
    for (let a = 0; a < TEXT.length; a++) for (let b = a + 1; b < TEXT.length; b++) for (let c = b + 1; c < TEXT.length; c++) {
      const s = toModes(mpScenario({ defs: [dragon([TEXT[a]!, TEXT[b]!, TEXT[c]!])], zones: { p1: { battlefield: ['Test Dragon'] } } }));
      const d = s.pending;
      if (d?.kind !== 'chooseOption') throw new Error('no mode decision');
      expect(d.noneOrAll).toBe(true);
      const a1 = chooseAction(viewFor(s, d.player), d, 'seed');
      if (a1.type !== 'answer' || a1.answer.kind !== 'chooseOption') throw new Error('not an option answer');
      expect([0, 2], `${a} ${b} ${c}`).toContain(a1.answer.ids.length);
      seen++;
    }
    expect(seen).toBe(20);
  });
});
