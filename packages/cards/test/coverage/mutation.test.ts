/**
 * WP25: the mutation harness of guards G2 (closed vocabulary: nonsense-word mutation) and G9 (near-miss mutations of every template), design 6.8.
 * The harness is checked both ways: it is green on the merged templates and the fixture set, and it catches a deliberately loose template.
 */
import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_TEMPLATES, type OracleCard } from '@openmtg/engine';
import { fixtureCards } from '../../src/coverage/corpus';
import { createCoverageEngine } from '../../src/coverage/engine';
import { exampleTypeLines, mutableWords, nearMisses, nearMissMutations, nonsenseMutations, sampleBySeed, NONSENSE_WORD } from '../../src/coverage/mutation';
import { fullEngine, synthetic, templateSet, tpl } from './support';

describe('WP25 G9: effect examples are parsed as spell text, and a template with no checked example is reported (design 6.8)', () => {
  const pump = BOOTSTRAP_TEMPLATES.find((t) => t.id === 'eff.pump')!;
  // invented wording (design 6.10) that the `try` guess reads as an Enchantment's static ability, where it does not parse
  const enchanted = { ...pump, id: 'test.wp25.pump-enchanted', examples: [{ text: 'Enchanted creature gets +2/+1 until end of turn.' }, { text: 'Enchanted creature gets -1/-3 until end of turn.' }] };
  it('CR 113.3a: an effect example is tried as an Instant, then a Sorcery, before the guess', () => {
    expect(exampleTypeLines({ kind: 'effect' }, 'Enchanted creature gets +2/+1 until end of turn.')).toEqual(['Instant', 'Sorcery', 'Enchantment']);
    expect(exampleTypeLines({ kind: 'rider' }, 'Destroy target artifact. It can\'t be regenerated.')).toEqual(['Instant', 'Sorcery']);
    expect(exampleTypeLines({ kind: 'trigger' }, 'When ~ enters, draw a card.')).toEqual(['Creature — Spirit']);
  });
  it('CR 301.5, 303.4: a static example about the equipped creature is an Equipment\'s, one about the enchanted creature an Aura\'s', () => {
    expect(exampleTypeLines({ kind: 'static' }, 'Equipped creature gets +1/+1 for each charge counter on ~ and is a Rogue in addition to its other types.')).toEqual(['Artifact — Equipment']);
    expect(exampleTypeLines({ kind: 'static' }, 'Enchanted creature gets +1/+1 and has flying.')).toEqual(['Enchantment — Aura']);
    expect(exampleTypeLines({ kind: 'static' }, 'Creatures you control get +1/+0.')).toEqual(['Enchantment']);
  });
  it('CR 611.2a: "Enchanted creature gets +2/+1 until end of turn." is checked as a spell, so its near misses are tried (the duration dropped among them)', () => {
    const engine = createCoverageEngine({ templates: [...BOOTSTRAP_TEMPLATES.filter((t) => t.id !== 'eff.pump'), enchanted] });
    const r = nearMissMutations([enchanted], engine);
    expect(r.unparsedExamples).toEqual([]);
    expect(r.uncheckedTemplates).toEqual([]);
    expect(r.mutations).toBeGreaterThan(0);
    expect(r.violations).toEqual([]);
  });
  it('a template none of whose examples parses fully is listed as unchecked (the gate fails on it), never silently passed', () => {
    const odd = tpl('test.wp25.unparsable', 'effect', 'frobnicate {o:Objs}', { op: 'destroy', what: '$o' }, { examples: [{ text: 'Glorp the marblefex.' }] });
    const r = nearMissMutations([odd], createCoverageEngine({ templates: BOOTSTRAP_TEMPLATES }));
    expect(r.uncheckedTemplates).toEqual(['test.wp25.unparsable']);
  });
  it('W3 integration (design 6.9): a template whose `needs` the engine lacks is listed as waiting for the engine, not as unchecked', () => {
    const gated = tpl('test.wp25.gated', 'effect', 'frobnicate {o:Objs}', { op: 'destroy', what: '$o' }, { examples: [{ text: 'Glorp the marblefex.' }], needs: ['feature:test.never'] });
    const r = nearMissMutations([gated], createCoverageEngine({ templates: BOOTSTRAP_TEMPLATES }));
    expect(r.gatedTemplates).toEqual(['test.wp25.gated']);
    expect(r.uncheckedTemplates).toEqual([]);
  });
  it('CI: every merged template has at least one checked example', () => {
    expect(nearMissMutations(templateSet().templates, fullEngine()).uncheckedTemplates).toEqual([]);
  }, 480_000); // Standard merge: every template's near misses, about 1,685 templates, take about 110-120 s alone; std-rw9: 2,277 templates take about 240-250 s alone (2026-10-20)
});

describe('WP25 G2: ability-word and flavor-word labels are counted, not judged (CR 207.2c-d)', () => {
  // the card's own name hides every word but the ability word, so the one mutation replaces the label (invented name and wording, design 6.10)
  const card = synthetic('When This Creature Enters Draw Card', 'Creature — Elf', 'Landfall — When this creature enters, draw a card.');
  it('CR 207.2c: a nonsense word that ends up only in the `label` of a full ability is label-only, not a violation and not absorbed', () => {
    expect(mutableWords(card.oracle_text!, [card.name]).map((w) => w.word)).toEqual(['Landfall']);
    const r = nonsenseMutations([card], createCoverageEngine({ templates: BOOTSTRAP_TEMPLATES }));
    expect(r.mutations).toBe(1);
    expect(r).toMatchObject({ labelOnly: 1, absorbed: 0, rejected: 0, violations: [] });
  });
  it('CR 207.2d: a nonsense word in the flavor-word name of a mode ("• Use the Relic — ...", FAST5X E11) is label-only too', () => {
    // the card's own name hides every word of the mode bodies, so each mutation replaces a word of a mode's name (invented name and wording, design 6.10)
    const modal = synthetic('Choose One Target Creature Gets Until End Turn Destroy Artifact', 'Instant', 'Choose one —\n• Use the Relic — Target creature gets +3/+2 until end of turn.\n• Smash the Relic — Destroy target artifact.');
    const r = nonsenseMutations([modal], fullEngine(), { word: 'Zorblaxine' });
    expect(r.violations).toEqual([]);
    expect(r).toMatchObject({ mutations: 2, labelOnly: 2, violations: [] });
  });
  it('CR 207.2c: the same word in the body of the ability is still judged', () => {
    const body = synthetic('Landfall Draw Card', 'Creature — Elf', 'When this creature enters, draw a card.');
    const r = nonsenseMutations([body], createCoverageEngine({ templates: BOOTSTRAP_TEMPLATES }));
    expect(r.labelOnly).toBe(0);
    expect(r.mutations).toBe(r.rejected + r.absorbed + r.violations.length);
  });
});

describe('WP25 G9 near-miss mutations (design 6.8)', () => {
  it('generates the six kinds of design 6.8 where they apply', () => {
    const m = nearMisses('Target creature gets +2/+1 until end of turn.');
    expect(Object.fromEntries(m.map((x) => [x.kind, x.text]))).toEqual({
      'append-unless': 'Target creature gets +2/+1 until end of turn unless target opponent pays {1}.',
      'swap-quantifier': 'Each creature gets +2/+1 until end of turn.',
      'add-instead': 'Target creature gets +2/+1 until end of turn instead.',
      'insert-up-to': 'Up to one target creature gets +2/+1 until end of turn.',
      negate: "Don't target creature gets +2/+1 until end of turn.",
      'drop-duration': 'Target creature gets +2/+1.',
    });
    const draw = nearMisses('Draw three cards.');
    expect(draw.find((x) => x.kind === 'insert-up-to')?.text).toBe('Draw up to three cards.');
    expect(draw.find((x) => x.kind === 'negate')?.text).toBe("Don't draw three cards.");
    expect(nearMisses('{2}, {T}: Add {G}.').find((x) => x.kind === 'insert-up-to')).toBeUndefined();
  });
  it('is green on the bootstrap templates: every example parses, no mutation keeps its JSON', () => {
    const r = nearMissMutations(BOOTSTRAP_TEMPLATES, createCoverageEngine({ templates: BOOTSTRAP_TEMPLATES }));
    expect(r.unparsedExamples).toEqual([]);
    expect(r.mutations).toBeGreaterThan(50);
    expect(r.violations).toEqual([]);
  });
  it('CI: is green on every merged template', () => {
    const r = nearMissMutations(templateSet().templates, fullEngine());
    expect(r.violations).toEqual([]);
  }, 480_000); // Standard merge: as above (about 110-130 s alone with the merged template set); std-rw9: doubled with the template count, as above
  it('a loose template alone is already stopped by the exact render gate (G6): "instead" consumed but not rendered makes the unit manual', () => {
    const loose = tpl('test.wp25.loose', 'effect', 'destroy {o:Objs} [instead]', { op: 'destroy', what: '$o' }, { examples: [{ text: 'Destroy target artifact.' }], consumes: ['instead'] });
    const set = [...BOOTSTRAP_TEMPLATES.filter((t) => t.id !== 'eff.destroy'), loose];
    expect(nearMissMutations([loose], createCoverageEngine({ templates: set })).violations).toEqual([]);
  });
  it('catches a parse that silently ignores a word (simulated: an engine that drops "instead" before parsing)', () => {
    const real = createCoverageEngine({ templates: BOOTSTRAP_TEMPLATES });
    const deaf = { ...real, run: (c: OracleCard) => real.run({ ...c, oracle_text: (c.oracle_text ?? '').replace(/ instead\./, '.') }) };
    const destroy = BOOTSTRAP_TEMPLATES.find((t) => t.id === 'eff.destroy')!;
    const r = nearMissMutations([destroy], deaf);
    expect([...new Set(r.violations.map((v) => v.kind))]).toEqual(['add-instead']);
    expect(r.violations.length).toBe(destroy.examples.length);
  });
});

describe('WP25 G2 nonsense-word mutation (design 6.8)', () => {
  it('never mutates reminder text, the card\'s own names, or the open classes of design 6.11 (named X, X counters)', () => {
    const words = mutableWords('Put a charge counter on target Goblin named Krenko. (This is reminder text.)', ['Krenko, Mob Boss', 'Krenko']).map((w) => w.word);
    expect(words).toEqual(['Put', 'counter', 'target', 'Goblin', 'named']);
  });
  it('samples deterministically by seed', () => {
    const cards = fixtureCards();
    expect(sampleBySeed(cards, 20, 's').map((c) => c.name)).toEqual(sampleBySeed(cards, 20, 's').map((c) => c.name));
    expect(sampleBySeed(cards, 20, 's').map((c) => c.name)).not.toEqual(sampleBySeed(cards, 20, 't').map((c) => c.name));
  });
  it('CI: on the fixture set with every merged template, no mutated sentence leaves a full ability', () => {
    const r = nonsenseMutations(fixtureCards(), fullEngine());
    expect(r.mutations).toBeGreaterThan(200);
    expect(r.violations).toEqual([]);
    expect(r.rejected + r.absorbed + r.labelOnly + r.violations.length).toBe(r.mutations);
  }, 300_000); // 161 s in a loaded run on a 4-CPU cloud machine, 2026-10-21 (the template set grows)
  it('catches a word that a template accepts: a "nonsense" word that is in the vocabulary leaves a full ability', () => {
    // the card's own name hides "Destroy" and "target", so the only mutable word is "artifact"; replacing it by a word the grammar knows is not nonsense
    const card = synthetic('Destroy Target', 'Instant', 'Destroy target artifact.');
    const engine = createCoverageEngine({ templates: BOOTSTRAP_TEMPLATES });
    expect(nonsenseMutations([card], engine).violations).toEqual([]);
    const r = nonsenseMutations([card], engine, { word: 'enchantment' });
    expect(r.violations.map((v) => v.mutated)).toEqual(['Destroy target enchantment.']);
    expect(NONSENSE_WORD).not.toBe('enchantment');
  });
});
