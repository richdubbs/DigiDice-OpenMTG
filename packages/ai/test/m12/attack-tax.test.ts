/**
 * M12 gaps (STATUS "Wave M12" gap 1) on r5-static's attack taxes: with several opponents a tax ("Creatures can't attack you unless their controller pays
 * {2} for each creature they control that's attacking you") protects its controller only (CR 508.1h, 802.2): the decision says which defenders cost
 * (`taxedDefenders`), only those attacks cost, and the AI still attacks the opponents without one.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, viewFor, type Action, type CardDef, type GameState, type OracleCard } from '@openmtg/engine';
import { findAll, mpScenario, pass } from '../../../engine/test/m12/rules/helpers';
import { chooseAction } from '../../src/index';

const card = (name: string, type: string, text: string, pt?: [string, string]): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as unknown as OracleCard);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const PRISON = card('Test Prison', 'Enchantment', "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.");

function atAttacks(): GameState {
  let s = mpScenario({ players: 3, defs: [BEAR, PRISON], cards: ['Plains'], zones: { p1: { battlefield: ['Test Bear', 'Test Bear', 'Plains', 'Plains', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Prison'] } } });
  for (const id of findAll(s, 'Test Bear', 'battlefield', 'p1')) s.objects[id]!.controlledSinceTurn = -1;
  for (let i = 0; i < 60 && s.pending?.kind !== 'declareAttackers'; i++) s = pass(s);
  return s;
}
const declare = (s: GameState, attacks: { attacker: string; defender: string }[]) =>
  applyAction(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks } as never });

describe('M12 gaps: attack taxes with several opponents (CR 508.1h, 802.2)', () => {
  it('the decision names the taxed defender; attacks on the other opponent are free; one on the Prison\'s controller costs {2}', () => {
    const s = atAttacks();
    const bears = findAll(s, 'Test Bear', 'battlefield', 'p1');
    expect(s.pending).toMatchObject({ kind: 'declareAttackers', candidates: bears.map((id) => ({ id, defenders: ['p2', 'p3'], taxed: true, taxedDefenders: ['p2'] })) });
    expect(declare(s, bears.map((b) => ({ attacker: b, defender: 'p3' }))).state.pending?.kind).not.toBe('yesNo');
    const mixed = declare(s, [{ attacker: bears[0]!, defender: 'p2' }, { attacker: bears[1]!, defender: 'p3' }]).state.pending;
    expect(mixed).toMatchObject({ kind: 'yesNo', player: 'p1' });
    expect(mixed!.kind === 'yesNo' && mixed!.prompt).toContain('{2}');
  });

  it('the AI drops only the taxed attacks: it still attacks the opponent without a tax', () => {
    const s = atAttacks();
    const a = chooseAction(viewFor(s, 'p1'), s.pending!, 'm12-gaps-tax') as Extract<Action, { type: 'answer' }>;
    const attacks = (a.answer as { attacks: { attacker: string; defender: string }[] }).attacks;
    expect(attacks.length).toBeGreaterThan(0);
    expect(attacks.every((x) => x.defender === 'p3')).toBe(true);
  });
});
