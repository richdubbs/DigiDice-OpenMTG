/**
 * std-promote-3 (lane std-promote): the round's parser and renderer changes, no new template file. Each is checked on synthetic wordings (design 6.10: none is a
 * real Oracle line, checked against the local index when it is present), with near misses that must not give the same JSON or must stay manual. CR cites from
 * memory, unverified.
 *
 *   lower/ability.ts#exertWhenYouDo (CR 701.43a, 603.12, 603.12a): "You may exert ~ as it attacks. When you do, <instructions with a target>. [more sentences]": the
 *     instructions are a program of their own whose targets move into the reflexive step (std-ry8's one-unit template keeps the untargeted wordings)
 *   holes/cost.ts (CR 107.14, 118.3, 608.2h): "pay an amount of {E} equal to <quantity>" (payEnergy with a quantity), after "pay" and in the "pay ..." reading
 *   render/costs.ts + equivalence family pay-energy-equal-to: its wording, with "Pay <quantity> {E}" a reading of the same JSON
 *   chart.ts#unlessAroundDelayLead (CR 603.7a, 608.2c): an "unless" tail never wraps a delayed-trigger lead of its sentence ("At the beginning of the next end
 *     step, sacrifice it unless you pay {1}" is one delayed ability that offers the payment then)
 *   render/state.ts#collectSpecs: the reflexive step of a static rule's `then` has its own targets
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, OracleCard } from '../../../src/index';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { automated, card } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const creature = (text: string): OracleCard => card('Example Brute', 'Creature — Human Warrior', text, { power: '3', toughness: '3' });
const sorcery = (text: string): OracleCard => card('Example Volley', 'Sorcery', text);
const parsed = (c: OracleCard) => parseCard(c, OPTS).faces[0]!;
const ok = (c: OracleCard): boolean => { const f = parsed(c); return automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual'); };
const json = (defs: readonly AbilityDef[]): string => JSON.stringify(defs.map(({ text: _t, src: _s, prov: _p, ...rest }) => rest));

const EXERT = 'You may exert this creature as it attacks. When you do, put a +1/+1 counter on target creature you control.';
const EXERT_TWO = 'You may exert this creature as it attacks. When you do, tap target creature an opponent controls. You gain 2 life.';
const EXERT_UNTARGETED = 'You may exert this creature as it attacks. When you do, draw a card.';
const ENERGY = 'Draw a card. Sacrifice a creature unless you pay an amount of {E} equal to the number of cards in your hand.';
const DELAY_UNLESS = 'Draw a card. At the beginning of the next end step, sacrifice a creature unless you pay {1}.';
const SYNTHETIC = [EXERT, EXERT_TWO, EXERT_UNTARGETED, ENERGY, DELAY_UNLESS];

describe('design 6.10: the wordings of this file are synthetic', () => {
  it('no wording is a line of a real card (local index, when present)', () => {
    const index = localIndex();
    if (index === null) return;
    const lines = new Set(index.flatMap((c) => (c.oracle_text ?? '').split('\n')));
    for (const w of SYNTHETIC) for (const sentence of w.split(/(?<=\.) /)) if (sentence.length > 40) expect(lines.has(sentence), sentence).toBe(false);
  });
});

describe('CR 701.43a, 603.12a: "You may exert ~ as it attacks. When you do, <instructions with a target>" (lower/ability.ts#exertWhenYouDo)', () => {
  it('the target belongs to the reflexive step, not to the static ability; it is automated and passes the render gate', () => {
    const f = parsed(creature(EXERT));
    expect(ok(creature(EXERT)), JSON.stringify(f.diagnostics)).toBe(true);
    const a = f.abilities[0] as unknown as { kind: string; effects: { rule: string; then: { as: string; do: { op: string; when: unknown; targets: { id: string; text: string }[] }[] } }[] };
    expect(a.kind).toBe('static');
    expect(a.effects[0]!.rule).toBe('mayExertAsAttacks');
    const r = a.effects[0]!.then.do[0]!;
    expect(r.op).toBe('reflexive');
    expect(r.when).toEqual({ did: a.effects[0]!.then.as });
    expect(r.targets.map((t) => t.text)).toEqual(['target creature you control']);
    expect(f.templatesUsed).toEqual(expect.arrayContaining(['sta.stdry8.exert.asAttacks', 'eff.counters.put']));
  });
  it('every later sentence of the ability is an instruction of the reflexive trigger (CR 603.12: it is created with all of them)', () => {
    const f = parsed(creature(EXERT_TWO));
    expect(ok(creature(EXERT_TWO)), JSON.stringify(f.diagnostics)).toBe(true);
    const steps = JSON.stringify((f.abilities[0] as unknown as { effects: { then: { do: { do: unknown[] }[] } }[] }).effects[0]!.then.do[0]!.do);
    expect(steps).toContain('"op":"tap"');
    expect(steps).toContain('"op":"gainLife"');
  });
  it('an untargeted "When you do" is still std-ry8\'s one-unit template (unchanged)', () => {
    const f = parsed(creature(EXERT_UNTARGETED));
    expect(f.templatesUsed).toContain('sta.stdry8.exert.asAttacks.whenYouDo');
    expect(ok(creature(EXERT_UNTARGETED))).toBe(true);
  });
  it('near misses stay manual: "When you don\'t", a blocking exert, an instruction that is not understood', () => {
    for (const w of [
      'You may exert this creature as it attacks. When you don\'t, put a +1/+1 counter on target creature you control.',
      'You may exert this creature as it blocks. When you do, put a +1/+1 counter on target creature you control.',
      'You may exert this creature as it attacks. When you do, frobnicate target creature you control.',
    ]) expect(ok(creature(w)), w).toBe(false);
  });
});

describe('CR 107.14, 118.3, 608.2h: "pay an amount of {E} equal to <quantity>" (holes/cost.ts, render/costs.ts)', () => {
  it('reads as one energy payment of the quantity, and renders back', () => {
    const f = parsed(sorcery(ENERGY));
    expect(ok(sorcery(ENERGY)), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"kind":"payEnergy","amount":{"q":"zoneSize","zone":"hand"');
  });
  it('a bare number is not "an amount equal to" (refused), and "pay life equal to" stays a life payment', () => {
    expect(ok(sorcery('Draw a card. Sacrifice a creature unless you pay an amount of {E} equal to 3.'))).toBe(false);
    expect(json(parsed(sorcery(ENERGY)).abilities)).not.toBe(json(parsed(sorcery(ENERGY.replace('an amount of {E}', 'life'))).abilities));
  });
});

describe('CR 603.7a, 608.2c: an "unless" tail never wraps the delayed-trigger lead of its sentence (chart.ts#unlessAroundDelayLead)', () => {
  it('"At the beginning of the next end step, sacrifice a creature unless you pay {1}" is one delayed ability that offers the payment then', () => {
    const f = parsed(sorcery(DELAY_UNLESS));
    expect(ok(sorcery(DELAY_UNLESS)), JSON.stringify(f.diagnostics)).toBe(true);
    const steps = (f.abilities[0] as unknown as { effect: { steps: { op: string; do?: { op: string }[] }[] } }).effect.steps;
    expect(steps.map((s) => s.op)).toEqual(['draw', 'delay']);
    expect(steps[1]!.do!.map((s) => s.op)).toEqual(['pay']);
  });
  it('an "unless" with no delayed lead in its sentence keeps its reading (pay now, else sacrifice)', () => {
    const w = 'Draw a card. Sacrifice a creature unless you pay {1}.';
    expect(ok(sorcery(w))).toBe(true);
    expect(JSON.stringify(parsed(sorcery(w)).abilities)).not.toContain('"op":"delay"');
  });
});
