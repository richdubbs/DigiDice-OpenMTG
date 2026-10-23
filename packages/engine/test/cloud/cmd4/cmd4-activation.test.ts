/**
 * Commander batch, slice cmd4: "Activate only during your turn, before attackers are declared." (parser/lower/activation.ts#BEFORE_ATTACKERS), played through the
 * engine with a synthetic card compiled by the game's default compiler (invented name and wording, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 602.5b   the restriction is your turn up to the beginning of combat step
 *   CR 508.1    once your declare attackers step began (attackers are declared as it begins), it can't be activated any more this turn
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { find, findAll, legal, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers, toStep } from '../../m4/helpers';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { ENGINE_CAPABILITIES } from '../../../src/model';
import { card as oracle } from '../../m5/templates/support';

function card(name: string, type: string, text: string, pt: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], power: pt[0], toughness: pt[1] } as OracleCard);
}
const ELDER = card('Test Elder', 'Creature — Human Cleric', '{T}: You gain 2 life. Activate only during your turn, before attackers are declared.', ['1', '1']);
const offered = (s: GameState, p: 'p1' | 'p2'): boolean => legal(s, p, 'activate').some((a) => a.object === find(s, 'Test Elder', 'battlefield', p));
const OPTS = defaultParseOptions({ capabilities: ENGINE_CAPABILITIES });

describe('CR 602.5b, 508.1: "Activate only during your turn, before attackers are declared."', () => {
  it('is understood: the restriction is a condition of steps and history, not one the controller attests (G6)', () => {
    const f = parseCard(oracle('Trial Subject', 'Creature — Human Cleric', '{T}: You gain 2 life. Activate only during your turn, before attackers are declared.', { power: '1', toughness: '1' }), OPTS).faces[0]!;
    expect(JSON.stringify(f.abilities)).not.toContain('"cond":"ask"');
    expect(f.gate.every((g) => g.ok)).toBe(true);
    expect(JSON.stringify(ELDER.faces)).not.toContain('"kind":"manual"');
  });
  it('CR 602.5b: offered in your precombat main phase and in your beginning of combat step', () => {
    const s0 = scenario([], { defs: [ELDER], p1: { battlefield: ['Test Elder'] } });
    expect(offered(s0, 'p1')).toBe(true);
    expect(offered(toStep(s0, 'beginCombat'), 'p1')).toBe(true);
  });
  it('CR 508.1: not once attackers are declared (the declare attackers step), nor in the postcombat main phase', () => {
    const s0 = scenario([], { defs: [ELDER], p1: { battlefield: ['Test Elder', 'Test Elder'] } });
    const [attacker, stay] = findAll(s0, 'Test Elder', 'battlefield', 'p1');
    let s = declareAttackers(toDeclareAttackers(s0), [[attacker!]]);
    expect(s.turn.step).toBe('declareAttackers');
    expect(s.pending?.kind).toBe('priority');
    const canStay = (x: GameState): boolean => legal(x, 'p1', 'activate').some((a) => a.object === stay);
    expect(canStay(s)).toBe(false);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'main2', 'blockers or the postcombat main phase', 20);
    if (s.pending?.kind === 'declareBlockers') s = declareBlockers(s, []);
    s = toStep(s, 'main2');
    expect(canStay(s)).toBe(false);
  });
  it('CR 602.5b: not during an opponent\'s turn', () => {
    const s0 = scenario([], { defs: [ELDER], p2: { battlefield: ['Test Elder'] } });
    expect(offered(s0, 'p2')).toBe(false);
  });
});
