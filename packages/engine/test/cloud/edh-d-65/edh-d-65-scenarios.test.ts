/**
 * Commander lane d-rank-r34 (second pass), round edh-d-65: the round's engine concepts played through the engine with synthetic cards (invented names and
 * wordings, design 6.10), compiled by the game's default compiler. CR cites checked against the 2026-09-25 text where marked; others unverified.
 *
 *   CR 113.6, 605.1a, 602.2   "{1}, Exile this card from your graveyard: Add one mana of any color.": a mana ability that works in its owner's graveyard only
 */
import { describe, expect, it } from 'vitest';
import { act, answer, find, scenario } from '../../m3/scenario';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';

function card(name: string, type: string, text: string, opts: { cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '', type_line: type, oracle_text: text, colors: [], keywords: [] } as unknown as OracleCard);
}
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const poolOf = (s: GameState, p = 0): string => s.players[p]!.manaPool.map((u) => u.type).sort().join('');
const manaActions = (s: GameState, source: ObjectId, player = 'p1') => legalActions(s, player).filter((l) => l.kind === 'activate' && l.isMana === true && l.object === source);

describe('CR 113.6, 605.1a, 602.2: "{1}, Exile this card from your graveyard: Add one mana of any color." (a mana ability that works in the graveyard)', () => {
  const JACK = card('Test Gravelamp', 'Artifact', '{1}, Exile this card from your graveyard: Add one mana of any color.', { cost: '{1}' });
  const run = (s0: GameState, id: ObjectId, color: string): GameState => {
    let s = act(s0, manaActions(s0, id)[0]!.action);
    for (let guard = 0; guard < 10 && s.pending && s.pending.kind !== 'priority'; guard++) {
      const d = s.pending as unknown as { kind: string };
      if (d.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: color as never });
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true } as never);
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    return s;
  };
  it('is automated; in your graveyard it is offered, the {1} is paid and exiling the card adds one mana of the chosen color', () => {
    expect(automated(JACK)).toBe(true);
    const s0 = scenario([], { p1: { graveyard: ['Test Gravelamp'] }, defs: [JACK] });
    s0.players[0]!.manaPool.push({ type: 'C' } as never);
    const id = find(s0, 'Test Gravelamp', 'graveyard', 'p1');
    expect(manaActions(s0, id).length).toBe(1);
    const s = run(s0, id, 'G');
    expect(poolOf(s)).toBe('G');
    expect(() => find(s, 'Test Gravelamp', 'graveyard', 'p1')).toThrow();
    expect(find(s, 'Test Gravelamp', 'exile', 'p1')).toBeDefined();
  });
  it('not in the hand, not on the battlefield, and not in the opponent\'s graveyard', () => {
    const s1 = scenario([], { p1: { hand: ['Test Gravelamp'] }, defs: [JACK] });
    expect(manaActions(s1, find(s1, 'Test Gravelamp', 'hand', 'p1')).length).toBe(0);
    const s2 = scenario([], { p1: { battlefield: ['Test Gravelamp'] }, defs: [JACK] });
    expect(manaActions(s2, find(s2, 'Test Gravelamp', 'battlefield', 'p1')).length).toBe(0);
    const s3 = scenario([], { p2: { graveyard: ['Test Gravelamp'] }, defs: [JACK] });
    expect(manaActions(s3, find(s3, 'Test Gravelamp', 'graveyard', 'p2'), 'p1').length).toBe(0);
  });
});
