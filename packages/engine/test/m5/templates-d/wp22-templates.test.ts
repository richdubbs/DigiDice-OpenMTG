/**
 * WP22 (templates D, design 15.2): the template files themselves. Every template is well formed (it compiles, cites rules, has examples and at least two
 * counter-examples; ids are unique across the bootstrap and WP22 sets), lives in the file of its topic, and passes guard G9 (design 6.8): every example
 * parses WITH it, is fully automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON. Examples
 * are synthetic (design 6.10): none equals a single Oracle line (name read as ~) of a fixture card or of the local index; every template has two examples
 * (design 6.9 step 3) unless its wording is fixed and does not name the object.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { BOOTSTRAP_TEMPLATES } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { validateAbility } from '../../../src/model/validate';
import { loadFixtureCards } from '../../fixtures';
import { ALL, WP22_FILES, WP22_TEMPLATES, automated, bare, exampleCard, face, fixedWithoutSelf, fixedWording, localIndex, meaning, normalizeLine, normalizedOracleLines, options } from './support';

describe('WP22 template files (design 6.3, 6.9)', () => {
  it('are well formed: they compile, cite rules, have examples and at least two counter-examples (validateTemplates)', () => {
    expect(validateTemplates(WP22_TEMPLATES)).toEqual([]);
  });
  it('have ids unique across the bootstrap (WP17) and WP22 sets', () => {
    expect(validateTemplates(ALL).filter((e) => e.message === 'duplicate template id')).toEqual([]);
  });
  it('cite Comprehensive Rules numbers in the form "CR <rule>"', () => {
    for (const t of WP22_TEMPLATES) for (const c of t.cr) expect(c, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
  });
  it('keep each topic in its file: statics in static.json and ability.json, effect-kind templates only in effect/*.json', () => {
    for (const t of [...WP22_FILES['static.json']!, ...WP22_FILES['ability.json']!]) expect(t.kind, t.id).toBe('static');
    for (const t of WP22_FILES['effect/continuous.json']!) expect(t.kind, t.id).toBe('effect');
    for (const [file, ts] of Object.entries(WP22_FILES)) for (const t of ts) expect(['static', 'effect'], `${file}: ${t.id}`).toContain(t.kind);
  });
  it('the ability-level templates (ability.json) build {kind:"static", condition?, zone?, effects}: CR 113.6, 604.5, 611.3a', () => {
    for (const t of WP22_FILES['ability.json']!) {
      const b = t.build as Record<string, unknown>;
      expect(b['kind'], t.id).toBe('static');
      expect(Array.isArray(b['effects']), t.id).toBe(true);
      expect(b['condition'] !== undefined || b['zone'] !== undefined, t.id).toBe(true);
    }
  });
  it('every `becomes` template puts its layer-4 modification first (mods[0] of effects[0]), the place the "It\'s still a land" rider patches (CR 205.1b)', () => {
    for (const t of WP22_TEMPLATES.filter((x) => x.id.startsWith('eff.cont.becomes'))) {
      const b = t.build as { effects: { mods: { layer: unknown }[] }[] };
      expect(b.effects[0]!.mods[0]!.layer, t.id).toBe(4);
    }
  });
  it('carry no Wizards text in their examples (design 6.10): no example equals a single Oracle line of a fixture card or of the local index, read with the name as ~', () => {
    // WP22 review: line by line, both sides normalized the same way (design 6.2 step 3), so an example written with ~ is caught too. A fixed wording (no
    // hole, no option, no alternative) is exempt: its example IS the committed pattern.
    const oracle = normalizedOracleLines([...Object.values(loadFixtureCards()), ...(localIndex() ?? [])]);
    const verbatim = WP22_TEMPLATES.filter((t) => !fixedWording(t)).flatMap((t) => t.examples.filter((e) => oracle.has(normalizeLine(e.text))).map((e) => `${t.id}: ${e.text}`));
    expect(verbatim).toEqual([]);
  });
  it('have at least two examples each (design 6.9 step 3), except a fixed wording that does not name the object (it has exactly one wording)', () => {
    expect(WP22_TEMPLATES.filter((t) => t.examples.length < (fixedWithoutSelf(t) ? 1 : 2)).map((t) => t.id)).toEqual([]);
    expect(WP22_TEMPLATES.filter(fixedWithoutSelf).map((t) => t.id)).toEqual([
      'sta.permit.lookattop', 'sta.rule.nomaxhand', 'sta.permit.extraland', 'rep.double.tokens', 'rep.double.counters', 'rep.graveyard.exile.opponent', 'rep.graveyard.exile.any',
    ]);
  });
  it('are about sixty: the size the design plans for WP22', () => {
    expect(WP22_TEMPLATES.length).toBeGreaterThanOrEqual(60);
  });
});

describe('WP22 guard G9 (design 6.8): examples and counter-examples', () => {
  const opts = options();
  const run = (t: Template, text: string) => face(exampleCard(t, text), opts);
  for (const t of WP22_TEMPLATES) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated, lints clean and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = run(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = run(t, e.text);
        expect(f.templatesUsed, `${e.text}: ${JSON.stringify(f.diagnostics)}`).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        for (const a of f.abilities) expect(validateAbility(a).filter((x) => x.severity === 'error'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities).filter((a) => (a as { kind: string }).kind !== 'keyword')).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = run(t, c);
        const same = automated(f.abilities) && meaning(f.abilities) === meaning(first.abilities);
        expect(same, c).toBe(false);
      }
    });
  }
});
