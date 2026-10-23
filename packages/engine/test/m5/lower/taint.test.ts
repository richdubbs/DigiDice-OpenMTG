/**
 * WP17: taint (design 6.7). The rules T1 (forward poisoning), T2 (contagion) and E1 (manual shields) on lowered programs, and the worked cases of the
 * design's table as golden tests: Mutavault, Magma Spray, Memory Lapse, Elspeth Tirel -5, Frost Breath. The committed cards are synthetic analogues (invented
 * names and numbers, design 6.10) parsed with test-only templates standing in for the template packages; the real cards are checked from the local Oracle
 * index when it exists (skipped otherwise).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import { contagionOf, shieldShape, taintSeq } from '../../../src/parser/taint';
import { sequenceUnits } from '../../../src/parser/lower/sequencing';
import { parseCard } from '../../../src/parser/parse';
import { EXAMPLES } from '../model/examples';
import { EXTRA, bare, card, face, localIndex, options, tpl, unit } from './support';

const effectOf = (a: AbilityDef | undefined): { targets: unknown[]; steps: Record<string, unknown>[] } => (a as unknown as { effect: { targets: unknown[]; steps: Record<string, unknown>[] } }).effect;
const without = (id: string) => options(EXTRA.filter((t) => t.id !== id));

describe('WP17 design 6.7 rules on lowered programs', () => {
  it('E1: the two shield shapes', () => {
    expect(shieldShape('If that creature would die this turn, exile it instead.')).toBe('replacement effect (needs milestone 6)');
    expect(shieldShape('Prevent the next 3 damage that would be dealt to any target this turn.')).toBe('prevention effect (needs milestone 6)');
    expect(shieldShape('If that creature would die, exile it instead.')).toBeNull(); // no "this turn": not a one-shot shield
    expect(shieldShape('Exile it instead.')).toBeNull();
  });
  it('T2: a manual sentence with a modifier word, or with an unresolved pronoun, is contagious; a plain one is not', () => {
    expect(contagionOf(unit(0, 'Do it twice.', [], { manual: { code: 'no-template', reason: 'x' } }))).toMatch(/"twice"/);
    expect(contagionOf(unit(0, 'Shuffle a card.', [], { manual: { code: 'no-template', reason: 'x', unresolved: true } }))).toMatch(/no unique antecedent/);
    expect(contagionOf(unit(0, 'Shuffle a card.', [], { manual: { code: 'no-template', reason: 'x' } }))).toBeNull();
    expect(contagionOf(unit(0, 'If it would die this turn, exile it instead.', [], { manual: { code: 'no-template', reason: 'x' } }))).toBeNull();
  });
  it('T2: the whole program becomes ONE manual step with the whole text, earlier automated steps included', () => {
    const seq = sequenceUnits([
      unit(0, 'Draw a card.', [{ op: 'draw', who: { ref: 'you' }, count: 1 }]),
      unit(1, 'Then do that again.', [], { manual: { code: 'no-template', reason: 'no template' } }),
    ]);
    const t = taintSeq(seq);
    expect(t.contagious).toBe(true);
    expect(t.steps).toEqual([{ op: 'manual', text: 'Draw a card. Then do that again.', reason: expect.stringMatching(/contagion: "again"/) }]);
    expect(t.manualUnits).toEqual([0, 1]);
  });
  it('T1: a step that reads a name produced by a manual sentence is manual too', () => {
    const seq = sequenceUnits([
      unit(0, 'You may sacrifice a creature.', [], { manual: { code: 'lint', reason: 'x' }, lostNames: ['did'] }),
      unit(1, 'If you do, draw a card.', [{ op: 'if', cond: { cond: 'did', step: 'did' }, then: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] }]),
      unit(2, 'Draw a card.', [{ op: 'draw', who: { ref: 'you' }, count: 1 }]),
    ]);
    const t = taintSeq(seq);
    expect(t.steps.map((s) => s.op)).toEqual(['manual', 'manual', 'draw']);
    expect(t.manualUnits).toEqual([0, 1]);
    expect(t.diagnostics.some((d) => d.code === 'poisoned')).toBe(true);
  });
  it('a manual sentence that is neither contagious nor a shield stays a manual step in place; its neighbors stay automated', () => {
    const t = taintSeq(sequenceUnits([unit(0, 'Draw a card.', [{ op: 'draw', who: { ref: 'you' }, count: 1 }]), unit(1, 'Shuffle a card.', [], { manual: { code: 'no-template', reason: 'no template' } })]));
    expect(t.steps.map((s) => s.op)).toEqual(['draw', 'manual']);
    expect(t.contagious).toBe(false);
  });
});

describe('WP17 worked cases of design 6.7 (synthetic analogues)', () => {
  const den = card('Shapeshift Den', 'Land', "{2}: This land becomes a 3/3 creature with all creature types until end of turn. It's still a land.");
  it('Mutavault, rider present: "It\'s still a land" makes the type change an addition (CR 205.1b), automated', () => {
    const f = face(den);
    expect(f.abilities[0]).toMatchObject({ kind: 'activated', cost: { mana: [{ kind: 'generic', amount: 2 }] } });
    expect(effectOf(f.abilities[0]).steps).toEqual([{
      op: 'effect', duration: { d: 'endOfTurn' },
      effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 4, types: { add: ['Creature'] }, subtypes: { all: true } }, { layer: '7b', power: 3, toughness: 3 }] }],
    }]);
    expect(f.gate.every((g) => g.ok)).toBe(true);
  });
  it('Mutavault, rider absent: sentence 2 is manual and contains "still": T2 makes the whole effect manual, never a non-land creature', () => {
    const f = face(den, without('test.rid.still'));
    const eff = effectOf(f.abilities[0]);
    expect(f.abilities[0]!.kind).toBe('activated'); // the cost is still paid
    expect(eff.steps).toEqual([{ op: 'manual', text: "~ becomes a 3/3 creature with all creature types until end of turn. It's still a land.", reason: expect.stringMatching(/contagion: "still"/) }]);
  });
  it('Magma Spray: the damage is automated; the E1 shield is a manual step with a chip until end of turn and taints nothing', () => {
    const f = face(card('Cinder Spray', 'Instant', 'Cinder Spray deals 1 damage to target creature. If that creature would die this turn, exile it instead.'));
    expect(effectOf(f.abilities[0])).toEqual({
      targets: [{ id: 't0', kind: 'object', min: 1, max: 1, text: 'target creature', filter: { types: ['Creature'] } }],
      steps: [
        { op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 1 },
        { op: 'manual', text: 'If that creature would die this turn, exile it instead.', reason: 'replacement effect (needs milestone 6)', reminder: { d: 'endOfTurn' } },
      ],
    });
  });
  const lapse = card('Recall Lapse', 'Instant', "Counter target spell. If that spell is countered this way, put it on the bottom of its owner's library instead of into that player's graveyard.");
  it('Memory Lapse, rider present: the second sentence folds into counter.to (CR 608.2c)', () => {
    const f = face(lapse);
    expect(effectOf(f.abilities[0])).toEqual({
      targets: [{ id: 't0', kind: 'spell', min: 1, max: 1, text: 'target spell' }],
      steps: [{ op: 'counter', what: { ref: 'target', id: 't0' }, to: { zone: 'library', position: 'bottom' } }],
    });
    expect(f.gate[0]!.ok).toBe(true);
  });
  it('Memory Lapse, rider absent: "instead" / "this way": the whole effect is manual, the counter target is still announced', () => {
    const f = face(lapse, without('test.rid.countered'));
    const eff = effectOf(f.abilities[0]);
    expect(eff.targets).toEqual([{ id: 't0', kind: 'spell', min: 1, max: 1, text: 'target spell' }]);
    expect(eff.steps).toEqual([{ op: 'manual', text: lapse.oracle_text, reason: expect.stringMatching(/contagion: "(this way|instead)"/) }]);
  });
  it('Elspeth Tirel -5: "except" must be consumed by a template (G3); a template that ignores it leaves the sentence manual', () => {
    const pw = card('Elspeth Test', 'Legendary Planeswalker — Elspeth', '−4: Destroy all other permanents except for lands.');
    const ignoring = tpl('effect', 'destroy all other permanents except for lands', { op: 'destroy', what: { ref: 'each', filter: { other: true } } }, { id: 'test.ignores' });
    const f = face(pw, options([ignoring]));
    expect(f.diagnostics.find((d) => d.code === 'critical-word')?.message).toMatch(/"all" is not interpreted|"except" is not interpreted/);
    expect(f.abilities[0]).toMatchObject({ kind: 'activated', cost: { loyalty: -4 } });
    expect(effectOf(f.abilities[0]).steps.map((s) => s.op)).toEqual(['manual']);
    const consuming = { ...ignoring, id: 'test.consumes', consumes: ['all', 'other', 'except'], build: { op: 'destroy', what: { ref: 'each', filter: { other: true, notTypes: ['Land'] } } } };
    expect(face(pw, options([consuming])).diagnostics.some((d) => d.code === 'critical-word')).toBe(false);
  });
  it('Frost Breath: no E1 shape and no modifier word: the tap stays automated, the second sentence is a manual step ("those creatures" is bound)', () => {
    const f = face(card('Rime Breath', 'Instant', "Tap up to three target creatures. Those creatures don't untap during their controller's next untap step."));
    expect(effectOf(f.abilities[0])).toEqual({
      targets: [{ id: 't0', kind: 'object', min: 0, max: 3, text: 'up to three target creatures', filter: { types: ['Creature'] } }],
      steps: [
        { op: 'tap', what: { ref: 'target', id: 't0' } },
        { op: 'manual', text: "Those creatures don't untap during their controller's next untap step.", reason: expect.any(String) },
      ],
    });
    expect(f.gate[0]!.ok).toBe(true);
  });
});

describe.skipIf(localIndex() === null)('WP17 worked cases of design 6.7 on the real cards (local Oracle index)', () => {
  const byName = new Map((localIndex() ?? []).map((c) => [c.name, c]));
  const real = (n: string) => byName.get(n)!;
  const opts = options([
    ...EXTRA,
    tpl('effect', '{o:Obj} becomes a 2/2 creature with all creature types {d:Dur}', {
      op: 'effect', duration: '$d', effects: [{ s: 'continuous', affects: '$o', mods: [{ layer: 4, types: { set: ['Creature'] }, subtypes: { all: true } }, { layer: '7b', power: 2, toughness: 2 }] }],
    }, { id: 'test.becomes22', consumes: ['all'] }),
    tpl('rider', "if that spell is countered this way , put it on top of its owner 's library instead of into that player 's graveyard", { $patchPrevious: { to: { zone: 'library', position: 'top' } } }, { id: 'test.rid.top', attachTo: 'counter', consumes: ['if', 'this way', 'instead'] }),
  ]);
  it('Mutavault and Memory Lapse give the JSON of design section 13 with the rider templates', () => {
    const muta = parseCard(real('Mutavault'), opts).faces[0]!;
    expect(effectOf(muta.abilities[1]).steps[0]).toMatchObject({ op: 'effect', effects: [{ mods: [{ layer: 4, types: { add: ['Creature'] }, subtypes: { all: true } }, { layer: '7b', power: 2, toughness: 2 }] }] });
    const lapse = parseCard(real('Memory Lapse'), opts).faces[0]!;
    expect(effectOf(lapse.abilities[0]).steps).toEqual([{ op: 'counter', what: { ref: 'target', id: 't0' }, to: { zone: 'library', position: 'top' } }]);
  });
  it('design 6.7 E1 (Magma Spray): exactly the JSON of design section 13 with the bootstrap templates', () => {
    const f = parseCard(real('Magma Spray'), options()).faces[0]!;
    expect(bare(f.abilities)).toEqual(EXAMPLES.find((e) => e.name === 'Magma Spray')!.faces[0]!.abilities);
  });
  it('Frost Breath keeps the tap automated with a tap template', () => {
    const f = parseCard(real('Frost Breath'), opts).faces[0]!;
    expect(effectOf(f.abilities[0]).steps.map((s) => s.op)).toEqual(['tap', 'manual']);
  });
  it('Elspeth Tirel -5 is never automated by the bootstrap templates', () => {
    const f = parseCard(real('Elspeth Tirel'), options()).faces[0]!;
    const minus = f.abilities.find((a) => a.text.includes('except for lands'))!;
    expect(minus.kind === 'manual' || effectOf(minus).steps.every((s) => s.op === 'manual')).toBe(true);
  });
});
