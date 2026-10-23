/**
 * CR 701.34a: proliferate is a multi-select decision over permanents and players that have counters (ids "object:<id>" and "player:<id>"). The bot gives
 * more of a counter to its own side when that counter helps (+1/+1, loyalty, shield, energy, experience) and to the opponent's side when it hurts (-1/-1,
 * poison, stun), and skips everything else.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, viewFor, type CardDef, type ChooseOptionDecision, type GameState } from '@openmtg/engine';
import { chooseAction } from '../src/index';
import { castAuto, passBoth, scenario } from '../../engine/test/m5/helpers';

const spreader: CardDef = compileCard({ name: 'Test Spreader', layout: 'normal', type_line: 'Sorcery', oracle_text: 'Proliferate, then you gain 1 life.', mana_cost: '{1}' } as never);

function asked(): GameState {
  const s0 = scenario(['Forest', 'Grizzly Bears', 'Hill Giant'], {
    defs: [spreader],
    p1: { hand: ['Test Spreader'], battlefield: ['Forest', 'Forest', { name: 'Grizzly Bears', counters: { '+1/+1': 1 } }, { name: 'Hill Giant', counters: { '-1/-1': 1 } }] },
    p2: { battlefield: [{ name: 'Grizzly Bears', counters: { '+1/+1': 1 } }, { name: 'Hill Giant', counters: { '-1/-1': 1 } }] },
  });
  for (const p of s0.players) p.poison = p.id === 'p1' ? 1 : 2;
  const s = passBoth(castAuto(s0, 'Test Spreader'));
  expect(s.pending).toMatchObject({ kind: 'chooseOption', player: 'p1', rules: ['CR 701.34a'] });
  return s;
}

describe('AI, CR 701.34a: proliferate by the polarity of each holder\'s counters', () => {
  it('chooses its own +1/+1 creature, the opponent\'s -1/-1 creature and the opponent\'s poison; never the reverse', () => {
    const s = asked();
    const d = s.pending as ChooseOptionDecision;
    const idOf = (name: string, owner: string): string => `object:${s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === name && s.objects[id]!.controller === owner)!}`;
    const a = chooseAction(viewFor(s, 'p1'), d, 'proliferate-test') as { type: string; answer: { kind: string; ids: string[] } };
    expect(a.answer.kind).toBe('chooseOption');
    expect([...a.answer.ids].sort()).toEqual([idOf('Grizzly Bears', 'p1'), idOf('Hill Giant', 'p2'), 'player:p2'].sort());
  });
});
