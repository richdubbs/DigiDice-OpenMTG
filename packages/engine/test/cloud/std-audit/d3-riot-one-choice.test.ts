/**
 * Merge wave 8, audit D3 (docs/audits/2026-10-18-STD.md): riot is one replacement effect with ONE choice as the permanent enters (CR 702.136a, 614.12a,
 * 614.5). The choice was asked inside `Array.find`'s callback (effects/bodies/m5.ts#applyEnters), so choosing "haste" asked the riot question again, and a
 * different second answer ("+1/+1 counter") gave the creature neither. Real cards (Oracle text from the card index).
 *
 *   CR 702.136a   riot: "You may have this permanent enter with an additional +1/+1 counter on it. If you don't, it gains haste."
 *   CR 614.12a    the choice of a replacement effect that modifies how a permanent enters is made before it enters (once)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, pass, scenario } from '../../m3/scenario';

function oracle(name: string, mana_cost: string, type_line: string, oracle_text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost, type_line, oracle_text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const ZHUR_TAA = oracle('Zhur-Taa Goblin', '{R}{G}', 'Creature — Goblin Berserker', 'Riot (This creature enters with your choice of a +1/+1 counter or haste.)', ['2', '2']);
const SPELLBREAKER = oracle('Gruul Spellbreaker', '{1}{R}{G}', 'Creature — Ogre Warrior',
  'Riot (This creature enters with your choice of a +1/+1 counter or haste.)\nTrample\nDuring your turn, you and this creature have hexproof.', ['3', '3']);
const DEFS = [ZHUR_TAA, SPELLBREAKER];

const kws = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword: string }).keyword));
const plusOnes = (s: GameState, id: ObjectId): number => s.objects[id]?.counters['+1/+1'] ?? 0;

/** Cast `name` with auto payment, pass until the riot choice comes, and return that state. */
function toRiotChoice(name: string, extra: string[] = []): GameState {
  const s0 = scenario(['Mountain', 'Forest', 'Spider-Punk', 'Giant Spider'], { p1: { hand: [name], battlefield: ['Mountain', 'Mountain', 'Forest', 'Forest', ...extra] }, defs: DEFS });
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand') });
  while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
  for (let guard = 0; s.pending?.kind === 'priority' && guard < 10; guard++) s = pass(s);
  expect(s.pending?.kind).toBe('chooseOption');
  return s;
}

/** Answer the riot choice with `id`, then report how many riot questions were asked in all and the permanent as it is once the stack is empty. */
function chooseOnce(s0: GameState, name: string, id: string, secondAnswer: string): { asked: number; s: GameState; obj: ObjectId } {
  let s = answer(s0, { kind: 'chooseOption', ids: [id] });
  let asked = 1;
  for (let guard = 0; guard < 20; guard++) {
    if (s.pending?.kind === 'chooseOption') { asked++; s = answer(s, { kind: 'chooseOption', ids: [secondAnswer] }); continue; } // a second riot question is the bug
    if (s.pending?.kind === 'priority' && s.zones.stack.length > 0) { s = pass(s); continue; }
    break;
  }
  const obj = s.zones.battlefield.find((x) => s.objects[x]!.defId === name)!;
  return { asked, s, obj };
}

describe('audit D3: riot asks its one question once (CR 702.136a, 614.12a)', () => {
  it('Zhur-Taa Goblin, "haste" (the second option): one question, haste, no counter, whatever a second question would be answered', () => {
    const r = chooseOnce(toRiotChoice('Zhur-Taa Goblin'), 'Zhur-Taa Goblin', '1', '0');
    expect(r.asked).toBe(1);
    expect(kws(r.s, r.obj)).toContain('haste');
    expect(plusOnes(r.s, r.obj)).toBe(0);
  });
  it('Gruul Spellbreaker, "a +1/+1 counter" (the first option): one question, the counter, no haste', () => {
    const r = chooseOnce(toRiotChoice('Gruul Spellbreaker'), 'Gruul Spellbreaker', '0', '1');
    expect(r.asked).toBe(1);
    expect(plusOnes(r.s, r.obj)).toBe(1);
    expect(kws(r.s, r.obj)).not.toContain('haste');
  });
  it('Spider-Punk granting riot to Giant Spider ("Other Spiders you control have riot"): haste is asked once and given', () => {
    const r = chooseOnce(toRiotChoice('Giant Spider', ['Spider-Punk', 'Forest']), 'Giant Spider', '1', '0');
    expect(r.asked).toBe(1);
    expect(kws(r.s, r.obj)).toContain('haste');
    expect(plusOnes(r.s, r.obj)).toBe(0);
  });
});
