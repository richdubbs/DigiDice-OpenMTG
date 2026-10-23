/**
 * FAST5X E12: the template data of parser/templates/zz-fast5x/e12.json (suspect, CR 701.60; collect evidence, CR 701.59) and the parser and renderer additions
 * the mechanics needed: "suspected" in the filter hole and the past tense of the condition hole ("if the sacrificed creature was suspected", CR 608.2h),
 * "evidence was collected" in the condition hole (CR 701.59c, 607.2i), "whenever you collect evidence" in the event hole (CR 603.2), and the matching render
 * (render/np.ts, render/cond.ts, render/evt.ts, render/steps-lasting.ts). Guard G9 (design 6.8): every example lowers with its template, is fully automated
 * and passes the exact render gate; every counter-example does not parse or parses to different JSON; a nonsense word in place of any word of an example
 * never leaves an automated ability (G2). Examples are synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import e12 from '../../../src/parser/templates/zz-fast5x/e12.json';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { automated, bare, fullyAutomated, jsonKey } from '../../m5/templates/support';

const E12 = e12 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const card = (type: string, text: string) => ({ name: 'Example Sleuth', layout: 'normal', type_line: type, oracle_text: text, power: '2', toughness: '2' }) as never;
const typeFor = (text: string): string => (/^(Draw|Put|Suspect|Counter)/.test(text) ? 'Instant' : /^When this Aura/.test(text) ? 'Enchantment — Aura' : 'Creature — Human Detective');
const face = (text: string, type = typeFor(text)) => parseCard(card(type, text), OPTS).faces[0]!;
const steps = (f: ReturnType<typeof face>, i = 0): unknown => (f.abilities[i] as unknown as { effect: { steps: unknown[] } }).effect.steps;
const ok = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('E12 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5x/e12.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5x/e12.json');
    expect(files.indexOf('zz-fast5x/e12.json')).toBeGreaterThan(files.indexOf('zz-fast5x/e1.json'));
    expect(files.indexOf('zz-fast5x/e12.json')).toBeLessThan(files.indexOf('zz-fast5x/e2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5X)', () => {
    expect(E12.length).toBeGreaterThanOrEqual(7);
    for (const t of E12) {
      expect(t.id, t.id).toMatch(/^(trg|sta|eff|cm)\.e12\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.status, t.id).toBe('stable');
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of E12) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'first', 'rather', 'though', 'additional']) {
        if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
      }
    }
  });
});

describe('E12 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of E12) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = face(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

describe('E12 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of E12) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const at = lines.length - 1;
        const words = lines[at]!.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || /^\{/.test(w)) return;
          if (/^counters?$/.test(words[i + 1] ?? '')) return; // CR 122.1: any word can name a kind of counter
          const bad = w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : w.endsWith(':') ? 'blorfty:' : 'blorfty';
          const mutated = [...lines.slice(0, at), [...words.slice(0, i), bad, ...words.slice(i + 1)].join(' ')].join('\n');
          expect(fullyAutomated(face(mutated, typeFor(e.text))), mutated).toBe(false);
        });
      }
    });
  }
});

describe('E12 lowering: what the shapes mean', () => {
  it('CR 701.60b, 608.2h: "suspected" is a status of the object in filters and conditions (present and past tense)', () => {
    const f = face('{2}{B}: If ~ is suspected, put a +1/+1 counter on it. Otherwise, suspect it.');
    expect(JSON.stringify(steps(f))).toContain('{"cond":"matches","object":{"ref":"self"},"filter":{"suspected":true}}');
    expect(JSON.stringify(steps(f))).toContain('{"op":"action","action":"suspect","who":{"ref":"you"},"subject":{"ref":"self"}}');
    const g = face('{2}{B}, Sacrifice another creature: Draw a card. If the sacrificed creature was suspected, draw two cards instead.');
    expect(JSON.stringify(steps(g))).toContain('"filter":{"suspected":true}');
    const h = face('{3}, Sacrifice a suspected creature: Target creature gets -2/-2 until end of turn.');
    expect(JSON.stringify(h.abilities[0])).toContain('"filter":{"suspected":true,"types":["Creature"]}');
    const k = face('Whenever ~ attacks, if it\'s not suspected, you may suspect it.');
    for (const x of [f, g, h, k]) expect(ok(x), JSON.stringify(x.diagnostics)).toBe(true);
  });
  it('CR 701.59c, 607.2i: "if evidence was collected" reads the linked additional cost named collectEvidence (the generic optional cost has no name)', () => {
    const f = face('As an additional cost to cast this spell, you may collect evidence 6.\nWhen this creature enters, if evidence was collected, you gain 3 life.');
    expect((f.abilities[0] as unknown as { effects: unknown[] }).effects[0]).toMatchObject({ s: 'additionalCost', name: 'collectEvidence', optional: true });
    expect((f.abilities[1] as unknown as { interveningIf: unknown }).interveningIf).toEqual({ cond: 'wasCast', kicked: 'collectEvidence' });
    expect(ok(f)).toBe(true);
  });
  it('CR 603.2: "whenever you collect evidence" is the collectEvidence action of the controller', () => {
    const f = face('Whenever you collect evidence, draw a card.');
    expect((f.abilities[0] as unknown as { trigger: unknown }).trigger).toEqual({ on: [{ ev: 'action', verb: 'collectEvidence', actor: 'you' }] });
    expect(ok(f)).toBe(true);
  });
  // r4-cost reads an alternative cost of collect evidence (eff.cost.permit.alt.collectEvidence, test/cloud/r4-cost/mana-and-permits.test.ts)
  // std-costs-1 (CR 701.59a, 107.3): the collector now chooses X as they collect (effects/handlers/evidence.ts#choosesEvidenceX); test/cloud/std-costs-1 plays it
  it('"collect evidence X" (Incinerator of the Guilty: X is chosen as it is collected) is automated since std-costs-1', () => {
    for (const text of ['Whenever ~ deals combat damage to a player, you may collect evidence X. When you do, ~ deals X damage to each creature that player controls.']) {
      expect(fullyAutomated(face(text)), text).toBe(true);
    }
  });
});
