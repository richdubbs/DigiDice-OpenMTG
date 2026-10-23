/**
 * WP23 template files are well formed (design 6.3, 6.9, 6.10): they compile, cite rules, carry examples and counter-examples, own their ids, and every
 * critical word a template writes as a literal is listed in its `consumes` (guard G3 would refuse the derivation otherwise).
 */
import { describe, expect, it } from 'vitest';
import { validateTemplates } from '../../../src/parser/chart';
import { BOOTSTRAP_TEMPLATES } from '../../../src/parser/parse';
import { CRITICAL_WORDS } from '../../../src/parser/lower/units';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { WP23_FILES, WP23_TEMPLATES } from './support';

/** The id prefix of each file (one family per file keeps ownership visible in the template-id snapshot of G10). */
const PREFIX: Record<string, string[]> = {
  'choice.json': ['ch.'],
  'flow.json': ['fl.'],
  'delayed.json': ['dl.'],
  'reflexive.json': ['rf.'],
  'search.json': ['se.'],
  'copy.json': ['eff.counter', 'eff.create.', 'eff.copy.', 'eff.exchange.'],
  'rider.json': ['rid.'],
  'shield.json': ['sh.'],
};

describe('WP23 templates are well formed (design 6.3, 6.9)', () => {
  it('every template compiles, cites a rule, has examples and at least two counter-examples (validateTemplates)', () => {
    expect(validateTemplates(WP23_TEMPLATES)).toEqual([]);
  });

  it('ids are unique, also against the bootstrap templates, and follow the prefix of their file', () => {
    const ids = [...BOOTSTRAP_TEMPLATES, ...WP23_TEMPLATES].map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [file, list] of Object.entries(WP23_FILES)) {
      for (const t of list) expect(PREFIX[file]!.some((p) => t.id.startsWith(p)), `${file}: ${t.id}`).toBe(true);
    }
  });

  it('every rule citation is a CR number; status and since are set (design 6.9)', () => {
    for (const t of WP23_TEMPLATES) {
      for (const c of t.cr) expect(c, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(1);
    }
  });

  it('guard G3: a critical word written as a literal of the pattern is listed in `consumes`, and `consumes` lists only words of the pattern', () => {
    for (const t of WP23_TEMPLATES) {
      const literal = ` ${t.pattern.replace(/\{[^}]*\}/g, ' ').replace(/[()[\]|^]/g, ' ').toLowerCase().replace(/\s+/g, ' ')} `;
      for (const w of CRITICAL_WORDS) if (literal.includes(` ${w} `)) expect(t.consumes ?? [], `${t.id}: "${w}"`).toContain(w);
      for (const w of t.consumes ?? []) expect(literal, `${t.id}: consumes "${w}"`).toContain(` ${w} `);
    }
  });

  it('rider templates build only {"$patchPrevious": ...} and name the step they modify, except the "instead" fold, which replaces any one step (CR 614.15)', () => {
    for (const t of WP23_TEMPLATES.filter((x) => x.kind === 'rider')) {
      expect(Object.keys(t.build as object), t.id).toEqual(['$patchPrevious']);
      if (t.id !== 'fl.instead') expect(t.attachTo, t.id).toBeTypeOf('string');
    }
  });

  it('design 6.10: examples are synthetic: no example names a real card (the self reference is "~")', () => {
    for (const t of WP23_TEMPLATES) for (const e of [...t.examples.map((x) => x.text), ...t.counterExamples]) expect(e, t.id).not.toMatch(/Magma Spray|Mana Leak|Rhystic|Pact of|Fiend Hunter|Sneak Attack|Memory Lapse|Smothering Tithe/);
  });

  // M6-0 (m6 design 4.3): moved to test/m6/skeleton/absent-m6-1.test.ts, replaced by M6-1 with the full behavior in test/m6/replace/ (guard G8 of the WP23 shield templates)
});
