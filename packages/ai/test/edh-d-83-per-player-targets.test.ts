/**
 * edh-d-83 (CR 115.1, 601.2c): "for each opponent / each player, ... target ... that player controls" without "up to" needs one target of EACH player (rules/targets.ts#targetRange):
 * the bot's own answer (src/targets.ts#chooseFrom) and the play package's fallback answers (play/src/computer.ts#fallbacks) take one object of each player, so the engine accepts them
 * (before the fix the bot took the best candidates, two of one player's, and a trigger it could not cancel stopped the game).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, viewFor, type CardDef, type GameState } from '@openmtg/engine';
import { act, answer, find } from '../../engine/test/m3/scenario';
import { mpScenario } from '../../engine/test/m12/rules/helpers';
import { fallbacks } from '../../play/src/computer';
import { chooseAction } from '../src/index';

const def = (name: string, type: string, text: string, pt?: [string, string]): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as never);
const THIEF = def('Test Grand Larceny', 'Sorcery', 'For each opponent, gain control of target permanent that player controls.');
const DRAGON = def('Test Dragon', 'Creature — Dragon', '', ['6', '6']);
const RAT = def('Test Rat', 'Creature — Rat', '', ['1', '1']);

const start = (): GameState => mpScenario({ defs: [THIEF, DRAGON, RAT], zones: { p1: { hand: ['Test Grand Larceny'] }, p2: { battlefield: ['Test Dragon', 'Test Dragon'] }, p3: { battlefield: ['Test Dragon', 'Test Rat'] }, p4: { battlefield: ['Test Rat'] } } });
const controllers = (s: GameState, ids: string[]): string[] => ids.map((id) => s.objects[id]!.controller).sort();

describe('edh-d-83: the bot answers a per-player target decision with one object of each player', () => {
  it('chooseAction picks one target of each opponent (not Bob\'s two Dragons), and the engine accepts it', () => {
    const s1 = act(start(), { type: 'cast', player: 'p1', card: find(start(), 'Test Grand Larceny', 'hand', 'p1') });
    const d = s1.pending!;
    expect(d.kind).toBe('chooseTargets');
    const a = chooseAction(viewFor(s1, 'p1'), d, 'seed');
    if (a.type !== 'answer' || a.answer.kind !== 'chooseTargets') throw new Error('not a target answer');
    const ids = a.answer.targets.map((t) => t.id);
    expect(controllers(s1, ids)).toEqual(['p2', 'p3', 'p4']);
    expect(() => answer(s1, a.answer)).not.toThrow();
  });
  it('the fallbacks (play/src/computer.ts) include one object of each player, which the engine accepts', () => {
    const s1 = act(start(), { type: 'cast', player: 'p1', card: find(start(), 'Test Grand Larceny', 'hand', 'p1') });
    const d = s1.pending!;
    const ok = fallbacks(d as never, viewFor(s1, 'p1')).filter((x) => x.type === 'answer').some((x) => {
      try { answer(s1, (x as unknown as { answer: never }).answer); return true; } catch { return false; }
    });
    expect(ok).toBe(true);
  });
});
