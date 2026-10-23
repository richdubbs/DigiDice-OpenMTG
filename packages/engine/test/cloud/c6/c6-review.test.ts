/**
 * CLOUD C6 rules review: the players `cantAs` names are bound on every path that reaches a later step, as `as` is (design 3.1 rule 6). The lint
 * (model/lint-flow.ts) counts a guarded step's `cantAs` as bound for the steps after it, so the run must bind it too when the step does not run
 * (effects/run.ts#recordSkipped) or returns early (no count to fall short of): nobody "couldn't" do an instruction that was not given (CR 101.3, 608.2c).
 * Before the fix the next step threw an EngineBug ("never bound"). 3-player Free-for-All, Alice (p1) active (CR 101.4).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, lifeOf, mpScenario, resolveStack } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [] } as OracleCard);
}
type Step = Record<string, unknown>;
const stepsOf = (d: CardDef): Step[] => (d.faces[0]!.abilities[0] as unknown as { effect: { steps: Step[] } }).effect.steps;

/** "Each opponent discards a card. Each opponent who can't loses 3 life.", the discard given a guard that is false (no Wizard on the battlefield). */
const GUARDED = card('Test Guarded Drain', 'Sorcery', "Each opponent discards a card. Each opponent who can't loses 3 life.");
stepsOf(GUARDED)[0]!['guard'] = { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Wizard'] } } };
/** "Each opponent sacrifices a creature of their choice. Each opponent who can't loses 3 life.", the sacrifice of zero creatures (nothing to fall short of). */
const NONE = card('Test Empty Break', 'Sorcery', "Each opponent sacrifices a creature of their choice. Each opponent who can't loses 3 life.");
stepsOf(NONE)[0]!['count'] = 0;
/** The same with a discard of zero cards. */
const NODISCARD = card('Test Empty Drain', 'Sorcery', "Each opponent discards a card. Each opponent who can't loses 3 life.");
stepsOf(NODISCARD)[0]!['count'] = 0;

const DEFS = [GUARDED, NONE, NODISCARD];
const game = (spell: string): GameState => mpScenario({ players: 3, defs: DEFS, zones: { p1: { hand: [spell] } } });

function cast(s0: GameState, name: string): GameState {
  let t = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  for (let i = 0; i < 200 && (t.zones.stack.length > 0 || (t.pending && t.pending.kind !== 'priority')); i++) {
    if (t.pending?.kind === 'priority') { t = act(t, { type: 'pass', player: t.pending.player }); continue; }
    if (t.pending?.kind === 'payCost') { t = answer(t, { kind: 'payCost', auto: true }); continue; }
    throw new Error(`unexpected decision ${t.pending?.kind}`);
  }
  return resolveStack(t);
}
const lives = (s: GameState): number[] => (['p1', 'p2', 'p3'] as PlayerId[]).map((p) => lifeOf(s, p));

describe('C6 review: `cantAs` is bound when its step does not run or has nothing to ask (CR 101.3, 608.2c; design 3.1 rule 6)', () => {
  it('the cards keep the shape under test (a cantAs step, then a step on the bound players)', () => {
    for (const d of DEFS) {
      const [a, b] = stepsOf(d);
      expect(typeof a!['cantAs'], d.name).toBe('string');
      expect(b!['who'], d.name).toEqual({ ref: 'bound', name: a!['cantAs'] });
    }
  });
  it('a guarded discard whose guard is false: nobody discarded, so nobody "couldn\'t", and nobody loses life (opponents have empty hands)', () => {
    const s0 = game('Test Guarded Drain');
    const s = cast(s0, 'Test Guarded Drain');
    expect(lives(s)).toEqual(lives(s0));
  });
  it('a sacrifice of zero permanents and a discard of zero cards: nobody falls short', () => {
    for (const name of ['Test Empty Break', 'Test Empty Drain']) {
      const s0 = game(name);
      const s = cast(s0, name);
      expect(lives(s), name).toEqual(lives(s0));
    }
  });
});
