/**
 * M11-1: "Add one mana of any color in your commander's color identity" (Command Tower, Arcane Signet; CR 903.4, 903.4f, 702.124c), in the addMana handler
 * and the payment solver. The cards themselves are M11-4's templates; here the ability is the model data M11-0 pinned (test/m11/skeleton/contracts.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, manaSources, type AbilityDef, type GameState } from '../../../src/index';
import { act, answer, castAuto, pool, scenario } from '../../m3/scenario';
import { answerUntilPriority, card, commanderScenario, legend, withAbilities } from './helpers';

const COMMAND_TOWER_ABILITY: AbilityDef = {
  kind: 'activated', text: "{T}: Add one mana of any color in your commander's color identity.", cost: { tap: true }, isMana: true,
  effect: { targets: [], steps: [{ op: 'addMana', who: { ref: 'you' }, dynamic: { kind: 'commanderIdentity', count: 1 } }] },
};
const TOWER = withAbilities(card('Test Tower', '', 'Land'), [COMMAND_TOWER_ABILITY]);
const TITANIA = legend('Test Titania', '{G}', ['2', '2'], ['G']);
const KRAUM = legend('Test Kraum', '{U}{R}', ['4', '4'], ['U', 'R'], 'Partner');
const TYMNA = legend('Test Tymna', '{W}{B}', ['2', '2'], ['W', 'B'], 'Partner');
const COLORLESS = legend('Test Golem', '{5}', ['5', '5'], [], '', 'Legendary Artifact Creature — Golem');
const UNKNOWN = legend('Test Unknown', '{G}', ['1', '1'], null);
const BOB = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);
const WHITE = card('Test White Bear', '{W}', 'Creature — Bear', '', ['2', '2']);
const GENERIC = card('Test Generic Bear', '{1}', 'Creature — Bear', '', ['1', '1']);

function withTower(commanders: typeof TITANIA[]): GameState {
  return commanderScenario({ p1Commanders: commanders, p2Commanders: [BOB], defs: [TOWER, WHITE, GENERIC], p1: { battlefield: ['Test Tower'], hand: ['Test White Bear', 'Test Generic Bear'] } });
}
const tower = (s: GameState): string => s.zones.battlefield.find((id) => s.objects[id]!.defId === TOWER.id)!;
const towerUnits = (s: GameState): string[][] => manaSources(s, 'p1').find((m) => m.objectId === tower(s))?.modes[0]?.units ?? [];
const activateTower = (s: GameState): GameState => {
  const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === tower(s))!;
  return act(s, la.action);
};
const castable = (s: GameState, name: string): boolean => legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.label === `Cast ${name}`);

describe('M11-1: mana of the commander\'s color identity (CR 903.4)', () => {
  it('CR 903.4: the ability adds a color of the identity; the payment solver offers exactly those colors', () => {
    const s = withTower([TITANIA]);
    expect(towerUnits(s)).toEqual([['G']]);
    expect(pool(activateTower(s), 'p1')).toBe('G'); // one color: no choice
    expect(castable(s, 'Test White Bear')).toBe(false); // {W} is outside the identity
    expect(castable(s, 'Test Generic Bear')).toBe(true);
  });

  it('CR 702.124c: with partners, the identity is both commanders\' combined (W, U, B, R): the player chooses among those four', () => {
    const s = withTower([KRAUM, TYMNA]);
    expect(towerUnits(s)).toEqual([['W', 'U', 'B', 'R']]);
    const t = activateTower(s);
    expect(t.pending).toMatchObject({ kind: 'chooseColor', options: ['W', 'U', 'B', 'R'] });
    expect(pool(answer(t, { kind: 'chooseColor', color: 'B' }), 'p1')).toBe('B');
    const paid = answerUntilPriority(castAuto(s, 'Test White Bear'));
    expect(paid.zones.stack.length).toBe(1); // the auto-payer used the Tower for {W}
  });

  it('CR 903.4f: a colorless identity adds nothing (the solver offers nothing)', () => {
    const s = withTower([COLORLESS]);
    expect(towerUnits(s)).toEqual([]);
    expect(castable(s, 'Test Generic Bear')).toBe(false);
  });

  it('CR 903.4f: outside a Commander game nobody has a commander: the ability adds nothing', () => {
    const s = scenario(['Forest'], { defs: [TOWER, GENERIC], p1: { battlefield: ['Test Tower'], hand: ['Test Generic Bear'] } });
    expect(manaSources(s, 'p1').find((m) => s.objects[m.objectId]!.defId === TOWER.id)).toBeUndefined();
    expect(castable(s, 'Test Generic Bear')).toBe(false);
    const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && s.objects[a.object!]!.defId === TOWER.id);
    if (la) expect(pool(answerUntilPriority(act(s, la.action)), 'p1')).toBe('');
  });

  it('CR 903.4a: an identity the game was not given is never guessed: the solver leaves the ability out and activating it asks the player by hand', () => {
    const s = withTower([UNKNOWN]);
    expect(towerUnits(s)).toEqual([]);
    const r = applyAction(s, legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === tower(s))!.action);
    expect(r.error).toBeUndefined();
    expect(r.state.pending?.kind).toBe('manualResolve');
  });
});
