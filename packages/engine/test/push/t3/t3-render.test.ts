/**
 * T3 (push wave): the three renderer additions the T3 templates need for the exact render gate (design 6.8, G6). Each case states what the renderer prints
 * for a JSON and which wording it must NOT accept, so the gate can never excuse a different meaning. Wordings are synthetic (design 6.10).
 *
 *   CR 106.1, 106.4   one mana unit of three or more options is a list ("{R}, {W}, or {B}"); two units of the same two options are the filter lands'
 *                     "{W}{W}, {W}{B}, or {B}{B}" (a mana pool has no order, so {W}{B} and {B}{W} are the same mana)
 *   CR 603.7a, 503.1  a delayed upkeep trigger with no player fires at the next upkeep (triggers/delayed.ts#fires); "the next turn's upkeep" is the one of
 *                     the turn after this one (`turn: 'next'`, w8-followups: the two differ with an additional upkeep step, CR 500.9, 500.10)
 *   CR 509.1b         "can block only <filter>" is an onlyIf block restriction whose `other` is the attacker
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, EffectStep, ManaType } from '../../../src/index';
import { accepts, display, draw, rejects, self, spell, statics } from '../../m5/render/build';

const manaAbility = (units: ManaType[][]): AbilityDef => ({
  kind: 'activated', text: '', cost: { tap: true }, isMana: true, effect: { targets: [], steps: [{ op: 'addMana', who: { ref: 'you' }, units }] },
} as unknown as AbilityDef);
const delay = (step: 'upkeep' | 'end', extra: Record<string, unknown> = {}): EffectStep =>
  ({ op: 'delay', when: { at: 'step', step, next: true, ...extra }, do: [draw(2)] } as EffectStep);

describe('CR 106.1: mana units', () => {
  it('CR 106.1: one unit of three colors reads "{R}, {W}, or {B}", never "{R} or {W} or {B}" or as three mana', () => {
    const a = manaAbility([['R', 'W', 'B']]);
    accepts(a, '{T}: Add {R}, {W}, or {B}.');
    rejects(a, '{T}: Add {R} or {W} or {B}.');
    rejects(a, '{T}: Add {R}{W}{B}.');
    rejects(a, '{T}: Add {R}, {W}, and {B}.');
  });
  it('CR 106.1: one unit of two colors still reads "{G} or {U}"', () => {
    accepts(manaAbility([['G', 'U']]), '{T}: Add {G} or {U}.');
    rejects(manaAbility([['G', 'U']]), '{T}: Add {G}, or {U}.');
  });
  it('CR 106.4: two units of "{W} or {B}" read "{W}{W}, {W}{B}, or {B}{B}" (the same pool whichever order is chosen)', () => {
    const a = manaAbility([['W', 'B'], ['W', 'B']]);
    accepts(a, '{T}: Add {W}{W}, {W}{B}, or {B}{B}.');
    rejects(a, '{T}: Add {W}{W} or {B}{B}.');
    rejects(a, '{T}: Add {W}{B}.');
  });
  it('CR 106.4: two different two-option units are never printed as a filter land', () => {
    rejects(manaAbility([['W', 'B'], ['B', 'W']]), '{T}: Add {W}{W}, {W}{B}, or {B}{B}.');
    rejects(manaAbility([['W', 'B'], ['W', 'U']]), '{T}: Add {W}{W}, {W}{B}, or {B}{B}.');
  });
  it('CR 106.1: units of one option each read as the symbols in a row', () => {
    accepts(manaAbility([['W'], ['U'], ['B'], ['R'], ['G']]), '{T}: Add {W}{U}{B}{R}{G}.');
    accepts(manaAbility([['C'], ['W']]), '{T}: Add {C}{W}.');
  });
});

describe('CR 603.7a, 503.1: "at the beginning of the next turn\'s upkeep"', () => {
  it('CR 603.7a, 500.9 (w8-followups): a delayed upkeep trigger of the next turn prints "the next turn\'s upkeep", one with no turn "the next upkeep"', () => {
    const a = spell([draw(1), delay('upkeep', { turn: 'next' })]);
    accepts(a, "Draw a card. Draw two cards at the beginning of the next turn's upkeep.");
    rejects(a, 'Draw a card. Draw two cards at the beginning of the next upkeep.');
    expect(display(a)).toMatch(/next turn/);
    const b = spell([draw(1), delay('upkeep')]);
    accepts(b, 'Draw a card. Draw two cards at the beginning of the next upkeep.');
    rejects(b, "Draw a card. Draw two cards at the beginning of the next turn's upkeep.");
  });
  it('CR 603.7a: "your next upkeep" and "the next turn\'s end step" are other JSON', () => {
    rejects(spell([draw(1), delay('upkeep', { whose: 'you' })]), "Draw a card. Draw two cards at the beginning of the next turn's upkeep.");
    rejects(spell([draw(1), delay('end')]), "Draw a card. Draw two cards at the beginning of the next turn's upkeep.");
    rejects(spell([draw(1), delay('upkeep')]), "Draw a card. Draw two cards at the beginning of your next upkeep.");
  });
});

describe('CR 509.1b: "can block only ..."', () => {
  const only = (other: Record<string, unknown>, subject: unknown = self): AbilityDef =>
    statics([{ s: 'restrict', subject, mode: 'onlyIf', action: 'block', other } as never]);
  it('CR 509.1b: an onlyIf block restriction with a filter reads "~ can block only creatures with flying"', () => {
    accepts(only({ types: ['Creature'], keyword: 'flying' }), '~ can block only creatures with flying.');
    rejects(only({ types: ['Creature'], keyword: 'flying' }), "~ can't block creatures with flying.");
    rejects(only({ types: ['Creature'], keyword: 'flying' }), '~ can block only creatures with reach.');
  });
  it('CR 509.1b: a plural subject reads "Creatures with flying can block only creatures with flying"', () => {
    accepts(only({ types: ['Creature'], keyword: 'flying' }, { ref: 'each', filter: { types: ['Creature'], keyword: 'flying' } }), 'Creatures with flying can block only creatures with flying.');
  });
  it('CR 509.1b: an onlyIf block with a condition and a filter still has no words (refused, never approximated)', () => {
    // FAST3 T12 (INTERFACE CHANGE): a "can't block" restriction with a filter now has its exact words ("~ can't block creatures with power 3 or greater";
    // render/stat.ts), and only those: the attacker's filter is printed in full
    const cantBlock = statics([{ s: 'restrict', subject: self, mode: 'cant', action: 'block', other: { types: ['Creature'], keyword: 'flying' } } as never]);
    accepts(cantBlock, "~ can't block creatures with flying.");
    rejects(cantBlock, "~ can't block creatures with reach.");
    rejects(cantBlock, "~ can't block.");
    const both = statics([{ s: 'restrict', subject: self, mode: 'onlyIf', action: 'block', other: { types: ['Creature'] }, when: { cond: 'turnOf', whose: 'you' } } as never]);
    expect(display(both)).toMatch(/cannot render|no renderer/i);
  });
});
