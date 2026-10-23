/**
 * Standard round B (std-rB): "If C, also <instruction>" (parser/templates/zz-cloud/std-rb.json, eff.stdrb.if.also) and "each other" after the one earlier
 * target of a spell (parser/lower/targets.ts#otherNotSource), played through the engine with synthetic cards compiled by the game's default compiler (invented
 * names and wordings, design 6.10). Each test is named after the rule it checks (CR cites from memory, unverified: rules/cr/ is not in the cloud checkout).
 *
 *   CR 608.2c          the conditional instruction is done only when its condition holds as the spell resolves, on top of the earlier ones
 *   CR 109.2, 608.2c   "each other creature you control" of a spell is every creature you control except the spell's one target
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { find, findAll, life, scenario } from '../../m5/helpers';
import { cast, resolveAll, target } from '../../m5/cr-examples/helpers';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const plus = (s: GameState, id: string): number => s.objects[id]!.counters['+1/+1'] ?? 0;

const RALLY = card('Test Rally Call', 'Sorcery', 'Put a +1/+1 counter on target creature you control. If you control an Elf, also put a +1/+1 counter on each other creature you control.');
const BOON = card('Test Boon', 'Sorcery', 'Draw a card. If you control an Elf, also gain 2 life.');
const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const DEFS = [RALLY, BOON, ELF, BEAR];
const LIBRARY = ['Plains', 'Plains', 'Plains', 'Plains'];

describe('std-rb cards compile fully', () => {
  it('the synthetic cards of these scenarios are fully automated', () => {
    for (const d of [RALLY, BOON]) expect(full(d), d.name).toBe(true);
  });
});

describe('CR 608.2c, 109.2: "Put a +1/+1 counter on target creature you control. If you control an Elf, also put a +1/+1 counter on each other creature you control."', () => {
  it('with an Elf: the target gets one counter, every other creature p1 controls one more, and p2\'s creature none', () => {
    let s = scenario(LIBRARY, { defs: DEFS, p1: { hand: ['Test Rally Call'], battlefield: ['Test Elf', 'Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    const [b1, b2] = findAll(s, 'Test Bear', 'battlefield', 'p1');
    const elf = find(s, 'Test Elf', 'battlefield', 'p1');
    const theirs = find(s, 'Test Bear', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Rally Call', [target(b1!)]));
    expect(plus(s, b1!)).toBe(1);
    expect(plus(s, b2!)).toBe(1);
    expect(plus(s, elf)).toBe(1);
    expect(plus(s, theirs)).toBe(0);
  });
  it('without an Elf (negative case): only the target gets a counter', () => {
    let s = scenario(LIBRARY, { defs: DEFS, p1: { hand: ['Test Rally Call'], battlefield: ['Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Elf'] } });
    const [b1, b2] = findAll(s, 'Test Bear', 'battlefield', 'p1');
    s = resolveAll(cast(s, 'Test Rally Call', [target(b1!)]));
    expect(plus(s, b1!)).toBe(1);
    expect(plus(s, b2!)).toBe(0);
    expect(plus(s, find(s, 'Test Elf', 'battlefield', 'p2'))).toBe(0);
  });
});

describe('CR 608.2c: "Draw a card. If you control an Elf, also gain 2 life."', () => {
  it('the draw happens either way; the life only with an Elf (an opponent\'s Elf does not count)', () => {
    let s = scenario(LIBRARY, { defs: DEFS, p1: { hand: ['Test Boon'], battlefield: ['Test Elf'] } });
    const l0 = life(s, 'p1');
    const h0 = s.zones.hand.p1!.length;
    s = resolveAll(cast(s, 'Test Boon'));
    expect(life(s, 'p1')).toBe(l0 + 2);
    expect(s.zones.hand.p1!.length).toBe(h0); // Test Boon left the hand, one card was drawn

    let t = scenario(LIBRARY, { defs: DEFS, p1: { hand: ['Test Boon'] }, p2: { battlefield: ['Test Elf'] } });
    const m0 = life(t, 'p1');
    t = resolveAll(cast(t, 'Test Boon'));
    expect(life(t, 'p1')).toBe(m0);
  });
});
