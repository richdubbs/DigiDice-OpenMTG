/**
 * Lane p2-group-actions, round p2-group-actions-1, played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10). CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 119.1, 119.5   "each player's life total becomes the lowest / highest life total among all players"
 *   CR 101.4, 608.2d, 701.21a   "each player chooses two permanents they control, then sacrifices the rest"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { answer, castAuto, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
function resolve(s0: GameState, pick?: (options: string[], min: number) => string[]): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
    const p = s.pending!;
    if (p.kind === 'priority') s = pass(s);
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: pick ? pick(p.options, p.min) : p.options.slice(0, p.min) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}

const LOWEST = card('Test Leveling', 'Sorcery', "Each player's life total becomes the lowest life total among all players.");
const HIGHEST = card('Test Raising', 'Sorcery', "Each player's life total becomes the highest life total among all players.");
const PURGE = card('Test Purge', 'Sorcery', 'Each player chooses two permanents they control, then sacrifices the rest.');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const defs = [LOWEST, HIGHEST, PURGE, BEAR];

describe('CR 119.1, 119.5: "each player\'s life total becomes the lowest / highest life total among all players"', () => {
  it('both are fully automated', () => {
    expect(LOWEST.automation.level).toBe('full');
    expect(HIGHEST.automation.level).toBe('full');
  });
  it('lowest: 20 and 7 become 7 and 7', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Leveling'] } });
    s.players.find((p) => p.id === 'p2')!.life = 7;
    s = resolve(castAuto(s, 'Test Leveling'));
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([7, 7]);
  });
  it('highest: 20 and 7 become 20 and 20 (the negative case of the other aggregate)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Raising'] } });
    s.players.find((p) => p.id === 'p2')!.life = 7;
    s = resolve(castAuto(s, 'Test Raising'));
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([20, 20]);
  });
});

describe('CR 101.4, 608.2d, 701.21a: "each player chooses two permanents they control, then sacrifices the rest"', () => {
  it('is fully automated', () => expect(PURGE.automation.level).toBe('full'));
  it('a player with three Bears keeps two; a player with one Bear keeps it (fewer than two: no choice)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Purge'], battlefield: ['Test Bear', 'Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    s = resolve(castAuto(s, 'Test Purge'));
    const mine = (p: string) => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).length;
    expect(mine('p1')).toBe(2);
    expect(mine('p2')).toBe(1);
  });
});
