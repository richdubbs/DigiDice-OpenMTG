/**
 * Classification (design 10.3-10.4): the table of 10.3 with fake capability sets, the caps of 10.4, monotonicity, manual spans and autoRatio.
 */
import { describe, expect, it } from 'vitest';
import { capabilitiesOf, classifyAbility, classifyCard, manualNodes, type ClassifyInput, type FaceLines } from '../../../src/model';
import type { AbilityDef } from '../../../src/types/ability';
import type { AutomationLevel } from '../../../src/types/automation';
import { EXAMPLES } from './examples';

type J = Record<string, unknown>;
const ab = (x: J): AbilityDef => x as unknown as AbilityDef;
const NO_LINES: FaceLines = { lines: [], sentences: [] };
const ALL = new Set(EXAMPLES.flatMap((e) => e.faces.flatMap((f) => f.abilities.flatMap((a) => capabilitiesOf(a)))));
const example = (name: string): AbilityDef[] => EXAMPLES.find((e) => e.name === name)!.faces.flatMap((f) => f.abilities);
const card = (abilities: AbilityDef[], extra: Partial<ClassifyInput> = {}): ClassifyInput => ({ faces: [{ abilities, lines: NO_LINES }], source: 'templates', ...extra });
const level = (abilities: AbilityDef[], caps: ReadonlySet<string> = ALL, extra: Partial<ClassifyInput> = {}): AutomationLevel => classifyCard(card(abilities, extra), caps).level;
const manualStep = (text: string): J => ({ op: 'manual', text, reason: 'no template' });
const draw: J = { op: 'draw', who: { ref: 'you' }, count: 1 };

describe('the table of design 10.3', () => {
  it('Serra Angel: two keywords the engine has -> full', () => {
    expect(level(example('Serra Angel'))).toBe('full');
  });
  it('Lightning Bolt, Cryptic Command, Jace, the Mind Sculptor: every node understood and available -> full', () => {
    for (const n of ['Lightning Bolt', 'Cryptic Command', 'Jace, the Mind Sculptor']) expect(level(example(n)), n).toBe('full');
  });
  it('a vanilla creature and a basic land have no abilities -> full (a basic land\'s mana ability is rule-generated, CR 305.6)', () => {
    const r = classifyCard(card([]), ALL);
    expect(r.level).toBe('full');
    expect(r.faces).toEqual([{ abilities: [] }]);
    expect(r.autoRatio).toBe(1);
  });
  it('Mutavault without the rider template: the mana ability is automated, the second ability is one manual step -> partial', () => {
    const mana = example('Llanowar Elves')[0]!;
    const becomes = ab({ kind: 'activated', text: '{1}: becomes a creature. It\'s still a land.', cost: { mana: [{ kind: 'generic', amount: 1 }] }, effect: { targets: [], steps: [manualStep('{1}: becomes a creature. It\'s still a land.')] } });
    const r = classifyCard(card([mana, becomes]), ALL);
    expect(r.level).toBe('partial');
    expect(r.faces![0]!.abilities.map((a) => a.level)).toEqual(['full', 'manual']);
  });
  it('Magma Spray (M5): damage automated, the shield is a manual step with a chip -> partial', () => {
    const a = ab({ kind: 'spell', text: 'x', effect: { targets: [{ id: 't0', kind: 'object', min: 1, max: 1, text: 'target creature' }], steps: [{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 2 }, { op: 'manual', text: 'If that creature would die this turn, exile it instead.', reason: 'manual shield', reminder: { d: 'endOfTurn' } }] } });
    expect(level([a])).toBe('partial');
    expect(manualNodes(a)).toEqual([{ path: '/effect/steps/1', text: 'If that creature would die this turn, exile it instead.', reason: 'manual shield', impact: 'step' }]);
  });
  it('Chaos Orb: the cost is understood but the effect is manual -> manual', () => {
    const orb = ab({ kind: 'manual', text: '{1}, {T}: Flip Chaos Orb.', reason: 'physical action', shape: 'activated', cost: { tap: true, mana: [{ kind: 'generic', amount: 1 }] } });
    expect(level([orb])).toBe('manual');
  });
  it('Mindslaver: cost and target understood, effect manual -> manual (costs and targets alone are not automation)', () => {
    const m = ab({ kind: 'activated', text: '{4}, {T}, Sacrifice ~: You control target player during that player\'s next turn.', cost: { tap: true, mana: [{ kind: 'generic', amount: 4 }], other: [{ kind: 'sacrifice', filter: { self: true }, count: 1, self: true }] }, effect: { targets: [{ id: 't0', kind: 'player', min: 1, max: 1, text: 'target player' }], steps: [manualStep('You control target player during that player\'s next turn.')] } });
    expect(level([m])).toBe('manual');
  });
  it('a creature with flying and an unparsed activated ability: the keyword is automated -> partial', () => {
    const flying = ab({ kind: 'keyword', text: 'Flying', keyword: 'flying' });
    const unparsed = ab({ kind: 'manual', text: '{T}: Do something odd.', reason: 'no template', shape: 'activated', cost: { tap: true } });
    expect(level([flying, unparsed])).toBe('partial');
  });
  it('a card whose only keyword is `planned` (the engine lacks it) -> manual, with requiresEngine', () => {
    const morph = ab({ kind: 'keyword', text: 'Morph {3}{U}', keyword: 'morph' });
    const r = classifyCard(card([morph]), new Set());
    expect(r.level).toBe('manual');
    expect(r.requiresEngine).toEqual(['keyword:morph']);
    expect(r.faces![0]!.abilities[0]!.manual).toEqual([{ path: '', text: 'Morph {3}{U}', reason: 'needs-engine: keyword:morph', impact: 'static' }]);
  });
  it('Doubling Season and Leyline of the Void in M5: feature:replace.foreign is missing, so the static is manual with that requirement', () => {
    const m5 = new Set([...ALL].filter((c) => c !== 'feature:replace.foreign'));
    for (const n of ['Doubling Season', 'Leyline of the Void']) {
      const r = classifyCard(card(example(n)), m5);
      expect(r.level, n).not.toBe('full');
      expect(r.requiresEngine, n).toContain('feature:replace.foreign');
      expect(classifyCard(card(example(n)), ALL).level, n).toBe('full'); // once the engine has what the example uses (milestone 6)
    }
  });
  it('a card with automated and manual abilities: partial; every ability manual: manual; every ability full: full', () => {
    const full = ab({ kind: 'keyword', text: 'Flying', keyword: 'flying' });
    const man = ab({ kind: 'manual', text: 'x', reason: 'r', shape: 'static' });
    expect(level([full, man])).toBe('partial');
    expect(level([man, man])).toBe('manual');
    expect(level([full, full])).toBe('full');
  });
  it('a spell whose steps are all manual is manual even with a target; a triggered ability with an automated event and a manual effect is partial', () => {
    const target = { id: 't0', kind: 'object', min: 1, max: 1, text: 'target creature' };
    expect(level([ab({ kind: 'spell', text: 'x', effect: { targets: [target], steps: [manualStep('x')] } })])).toBe('manual');
    expect(level([ab({ kind: 'triggered', text: 'x', trigger: { on: [{ ev: 'draw' }] }, effect: { targets: [], steps: [manualStep('x')] } })])).toBe('partial');
  });
  it('a manual step inside only a wrapper does not count as automated content; a pay step does', () => {
    const wrapper = ab({ kind: 'spell', text: 'x', effect: { targets: [], steps: [{ op: 'may', who: { ref: 'you' }, do: [manualStep('x')] }] } });
    expect(level([wrapper])).toBe('manual');
    const pay = ab({ kind: 'spell', text: 'x', effect: { targets: [], steps: [{ op: 'pay', who: { ref: 'you' }, cost: { mana: [{ kind: 'generic', amount: 1 }] }, then: [manualStep('x')] }] } });
    expect(level([pay])).toBe('partial');
  });
  it('classifyAbility: degrades first, so an unavailable node is counted as manual and the ability never overstates its level', () => {
    const bolt = example('Lightning Bolt')[0]!;
    expect(classifyAbility(bolt, ALL)).toEqual({ level: 'full', manual: [] });
    const lacking = new Set([...ALL].filter((c) => c !== 'target:anyTarget'));
    expect(classifyAbility(bolt, lacking)).toEqual({ level: 'manual', manual: [{ path: '', text: '~ deals 3 damage to any target.', reason: 'needs-engine: target:anyTarget', impact: 'ability' }] });
  });
});

describe('manualNodes: spans in document order with their impact (design 10.1, 10.5)', () => {
  it('step, condition, quantity, cost, restriction, and the shapes of a manual ability', () => {
    const a = ab({
      kind: 'activated', text: 'x', cost: { other: [{ kind: 'manual', text: 'Exert' }] }, onlyIf: { cond: 'ask', text: 'Only on your turn?' },
      effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: { q: 'ask', text: 'How many?' }, guard: { cond: 'ask', text: 'Do you?' } }, manualStep('Do it.')] },
    });
    // document order is the order of the keys of the JSON: cost, onlyIf, effect; inside the draw step count comes before guard
    expect(manualNodes(a).map((s) => [s.impact, s.path])).toEqual([
      ['cost', '/cost/other/0'], ['restriction', '/onlyIf'], ['quantity', '/effect/steps/0/count'], ['condition', '/effect/steps/0/guard'], ['step', '/effect/steps/1'],
    ]);
  });
  it('a manual ability: its shape decides the impact', () => {
    const shapes: [string, string][] = [['spell', 'ability'], ['activated', 'ability'], ['triggered', 'trigger'], ['static', 'static'], ['unknown', 'ability']];
    for (const [shape, impact] of shapes) {
      expect(manualNodes(ab({ kind: 'manual', text: 't', reason: 'r', shape })), shape).toEqual([{ path: '', text: 't', reason: 'r', impact }]);
    }
    expect(manualNodes(ab({ kind: 'manual', text: 't', reason: 'r', shape: 'activated', mana: true }))[0]!.impact).toBe('mana');
  });
});

describe('the caps of design 10.4', () => {
  const bolt = example('Lightning Bolt');
  it('forceManual: every ability is manual with reason forceManual, whatever the sources said', () => {
    const r = classifyCard(card(bolt, { forceManual: true }), ALL);
    expect(r.level).toBe('manual');
    expect(r.faces![0]!.abilities[0]).toEqual({ level: 'manual', manual: [{ path: '', text: '~ deals 3 damage to any target.', reason: 'forceManual', impact: 'ability' }] });
    expect(r.autoRatio).toBe(0);
  });
  it('an experimental template caps at partial; a card that is not full is not changed', () => {
    expect(level(bolt, ALL, { experimentalTemplates: ['damage-any-target'] })).toBe('partial');
    const man = ab({ kind: 'manual', text: 'x', reason: 'r', shape: 'static' });
    expect(level([man], ALL, { experimentalTemplates: ['t'] })).toBe('manual');
  });
  it('LLM data caps at partial unless reviewed; reviewed data may be full; the review state is carried', () => {
    expect(level(bolt, ALL, { source: 'llm-cache', review: 'autoverified' })).toBe('partial');
    expect(level(bolt, ALL, { source: 'llm-cache', review: 'unreviewed' })).toBe('partial');
    expect(level(bolt, ALL, { source: 'llm-cache' })).toBe('partial');
    expect(level(bolt, ALL, { source: 'llm-cache', review: 'reviewed' })).toBe('full');
    expect(classifyCard(card(bolt, { source: 'pack', review: 'reviewed', textHash: 'abc' }), ALL)).toMatchObject({ level: 'full', review: 'reviewed', textHash: 'abc', source: 'pack' });
    expect(level(bolt, ALL, { source: 'templates' })).toBe('full');
  });
});

describe('the ledger: faces, unsupported text, autoRatio', () => {
  it('one entry per ability of every face, in order', () => {
    const r = classifyCard({ faces: [{ abilities: example('Serra Angel'), lines: NO_LINES }, { abilities: example('Lightning Bolt'), lines: NO_LINES }], source: 'templates' }, ALL);
    expect(r.faces!.map((f) => f.abilities.length)).toEqual([2, 1]);
  });
  it('unsupported lists the manual text; autoRatio is the share of characters outside manual spans', () => {
    const auto = ab({ kind: 'keyword', text: 'Flying', keyword: 'flying' });
    const man = ab({ kind: 'manual', text: 'Hexproof from rolled dice', reason: 'no template', shape: 'static' });
    const r = classifyCard(card([auto, man]), ALL);
    expect(r.unsupported).toEqual(['Hexproof from rolled dice']);
    expect(r.autoRatio).toBeCloseTo(6 / (6 + 25), 3);
    expect(classifyCard(card([auto]), ALL).autoRatio).toBe(1);
    const part = ab({ kind: 'spell', text: 'Draw a card. Scry 2.', effect: { targets: [], steps: [draw, { op: 'manual', text: 'Scry 2.', reason: 'r' }] } });
    expect(classifyCard(card([part]), ALL).autoRatio).toBeCloseTo(1 - 7 / 20, 3);
  });
  it('requiresEngine unions what the abilities lack, sorted', () => {
    const r = classifyCard(card([ab({ kind: 'keyword', text: 'Morph', keyword: 'morph' }), example('Lightning Bolt')[0]!]), new Set(['op:damage', 'ref:self', 'ref:target']));
    expect(r.requiresEngine).toEqual(['keyword:morph', 'target:anyTarget']);
    expect(classifyCard(card([]), ALL).requiresEngine).toBeUndefined();
  });
});

describe('monotonicity: adding a capability can only move a card up', () => {
  const rank: Record<AutomationLevel, number> = { manual: 0, partial: 1, full: 2 };
  const rng = (seed: number) => () => ((seed ^= seed << 13), (seed ^= seed >>> 17), (seed ^= seed << 5), (seed >>> 0) / 4294967296);
  it('over the worked examples and nested random subsets', () => {
    const next = rng(88172645);
    for (let round = 0; round < 10; round++) {
      const small = new Set([...ALL].filter(() => next() < 0.6));
      const big = new Set([...small, ...[...ALL].filter(() => next() < 0.5)]);
      for (const ex of EXAMPLES) {
        const c = card(ex.faces.flatMap((f) => f.abilities));
        expect(rank[classifyCard(c, small).level], `${ex.name} round ${round}`).toBeLessThanOrEqual(rank[classifyCard(c, big).level]);
      }
    }
  });
  it('a card is full only if it uses nothing the engine lacks (and has no manual node)', () => {
    for (const ex of EXAMPLES) {
      const abilities = ex.faces.flatMap((f) => f.abilities);
      const r = classifyCard(card(abilities), new Set());
      const needs = abilities.some((a) => capabilitiesOf(a).length > 0);
      if (needs) expect(r.level, ex.name).not.toBe('full');
    }
  });
});
