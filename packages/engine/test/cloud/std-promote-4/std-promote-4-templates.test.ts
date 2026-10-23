/**
 * std-promote-4 (lane std-promote): the discourse focus across an instruction that only puts counters on you (model/focus.ts#keepsFocus; design 6.4, coordinator
 * A's decision Q5 of 2026-10-21), read by the parser (parser/lower/anaphora.ts#focusAt) and the renderer (render/steps.ts#clausesOf) alike. Synthetic wordings
 * (design 6.10). CR cites from memory, unverified.
 *
 *   CR 608.2c, 122.1: "Whenever ~ attacks, tap target creature ... and create a ... token. You get {E}{E}. You lose life equal to its power.": "its" is the token,
 *   as without the middle sentence
 *   near misses: counters on a target player, on each opponent, or a counters instruction with a condition end the focus as before (the pronoun stays manual)
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { keepsFocus } from '../../../src/model/focus';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { automated, card } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
// a creature with a target and a token: "its" has three compatible candidates (~, the target, the token), so only the focus decides (design 6.4)
const brute = (text: string): OracleCard => card('Example Brute', 'Creature — Human Warrior', text, { power: '3', toughness: '3' });
const parsed = (c: OracleCard) => parseCard(c, OPTS).faces[0]!;
const ok = (text: string): boolean => { const f = parsed(brute(text)); return automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual'); };

const LEAD = 'Whenever this creature attacks, tap target creature an opponent controls and create a 2/2 red Goblin creature token. ';
const TAIL = ' You lose life equal to its power.';
const KEPT = `${LEAD}You get {E}{E}.${TAIL}`;
const NEAR = [
  `${LEAD}Target player gets {E}{E}.${TAIL}`,
  `${LEAD}Each opponent gets a poison counter.${TAIL}`,
  `${LEAD}If you control an artifact, you get {E}{E}.${TAIL}`,
];

describe('design 6.10: the wordings of this file are synthetic', () => {
  it('no wording is a line of a real card (local index, when present)', () => {
    const index = localIndex();
    if (index === null) return;
    const lines = new Set(index.flatMap((c) => (c.oracle_text ?? '').split('\n')));
    for (const w of [KEPT, ...NEAR]) expect(lines.has(w), w).toBe(false);
  });
});

describe('design 6.4, CR 608.2c, 122.1: an instruction that only puts counters on you keeps the focus (model/focus.ts#keepsFocus)', () => {
  it('keepsFocus: counters on you only; not on a target player, each opponent, an object, nor with a condition', () => {
    expect(keepsFocus({ op: 'putCounters', on: { ref: 'you' }, kind: 'energy', count: 2 })).toBe(true);
    expect(keepsFocus({ op: 'putCounters', on: { ref: 'target', id: 't0' }, kind: 'energy', count: 2 })).toBe(false);
    expect(keepsFocus({ op: 'putCounters', on: { ref: 'each', who: 'opponent' }, kind: 'poison', count: 1 })).toBe(false);
    expect(keepsFocus({ op: 'putCounters', on: { ref: 'self' }, kind: '+1/+1', count: 1 })).toBe(false);
    expect(keepsFocus({ op: 'putCounters', on: { ref: 'you' }, kind: 'energy', count: 2, guard: { cond: 'true' } })).toBe(false);
    expect(keepsFocus({ op: 'gainLife', who: { ref: 'you' }, amount: 2 })).toBe(false);
  });
  it('"... You get {E}{E}. You lose life equal to its power.": "its" is the token, read and rendered back (gate)', () => {
    expect(ok(KEPT), JSON.stringify(parsed(brute(KEPT)).diagnostics)).toBe(true);
    const json = JSON.stringify(parsed(brute(KEPT)).abilities);
    const made = /"op":"createToken"[^}]*?"as":"([^"]+)"/.exec(json) ?? /"as":"([^"]+)"[^{}]*"op":"createToken"/.exec(json);
    expect(json).toMatch(/"op":"loseLife".*"of":\{"ref":"bound","name":"[^"]+"\}/);
    if (made !== null) expect(json).toContain(`"of":{"ref":"bound","name":"${made[1]}"}`);
  });
  for (const w of NEAR) {
    it(`near miss stays manual: "${w}"`, () => {
      expect(ok(w)).toBe(false);
    });
  }
});
