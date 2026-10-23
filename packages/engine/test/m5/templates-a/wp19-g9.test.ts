/**
 * WP19, guard G9 (design 6.8): every example of every WP19 template parses with that template, is fully automated, passes the exact render gate of WP2
 * (guard G6) and the lint (G7); every counter-example does not parse, or parses to a different meaning than every example of the template.
 *
 * The examples are parsed as whole abilities of synthetic cards (parseCard with the bootstrap and WP19 templates): triggers and keyword lines on a creature,
 * effect templates on an instant, cost templates as the cost of an activated ability ("<cost>: Draw a card."), so each one goes through the real driver,
 * lowering passes, taint, lint and gate.
 */
import { describe, expect, it } from 'vitest';
import type { CostPart } from '../../../src/types/ability';
import type { Template } from '../../../src/parser/types';
import { canonicalJson } from '../../../src/parser/holes';
import { validateAbility } from '../../../src/model/validate';
import { BOOTSTRAP_TEMPLATES } from '../../../src/parser/parse';
import { normalizeText } from '../../../src/parser/preprocess';
import { automated, exampleCard, face, loweredOf, meaning, options, parsedMeaning, unit, WP19_TEMPLATES } from './support';

const opts = options();
const rules = (t: Template): string => t.cr.join(', ');

describe('WP19 guard G9 (design 6.8): "every template\'s examples must lower to the stated JSON"', () => {
  it('every WP19 template states the JSON of at least one example (TemplateExample.expect)', () => {
    expect(WP19_TEMPLATES.filter((t) => !t.examples.some((e) => e.expect !== undefined)).map((t) => t.id)).toEqual([]);
  });
  for (const t of WP19_TEMPLATES) {
    for (const e of t.examples.filter((x) => x.expect !== undefined)) {
      it(`${t.id} (${rules(t)}): "${e.text}" lowers to its stated ${t.kind === 'trigger' ? 'trigger' : t.kind === 'cost' ? 'cost' : t.kind === 'effect' ? 'effect program' : 'abilities'}`, () => {
        expect(loweredOf(t, e.text, opts)).toEqual(e.expect);
      });
    }
  }
});

/** The cost part a cost template builds for its example (cost templates are tried part by part by the activation driver, lower/activation.ts). */
function costPartsOf(text: string): CostPart[] {
  const f = face(exampleCard({ kind: 'cost' } as Template, text), opts);
  const a = f.abilities[0] as { cost?: { other?: CostPart[] } } | undefined;
  return a?.cost?.other ?? [];
}

describe('WP19 guard G9 (design 6.8): examples parse with their template, are automated and pass the gate', () => {
  for (const t of WP19_TEMPLATES) {
    if (t.kind === 'cost') {
      it(`${t.id} (${rules(t)}): every example pays its part through the template; the activated ability is automated and passes the gate`, () => {
        for (const e of t.examples) {
          const f = face(exampleCard(t, e.text), opts);
          expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)}`).toBe(true);
          expect(f.gate.every((g) => g.ok), e.text).toBe(true);
          expect(costPartsOf(e.text).map((p) => canonicalJson(p)), e.text).toContain(canonicalJson(t.build));
          // a bare part is one unit of the cost goal and is derived by this template (no other template or hole reading)
          if (!e.text.includes(':') && !e.text.includes(',')) {
            const r = unit(e.text, 'cost');
            expect(r.status === 'ok' && r.derivation.templatesUsed.includes(t.id), e.text).toBe(true);
          }
        }
      });
      continue;
    }
    it(`${t.id} (${rules(t)}): every example parses with it, is fully automated, lints and passes the render gate`, () => {
      for (const e of t.examples) {
        const f = face(exampleCard(t, e.text), opts);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        for (const a of f.abilities) expect(validateAbility(a).filter((x) => x.severity === 'error'), e.text).toEqual([]);
        // no word of the example is left manual in the ledger (the separators of a keyword list are, a WP17 driver detail: see the report)
        const norm = normalizeText(exampleCard(t, e.text).oracle_text ?? '').text;
        expect(f.ledger.filter((l) => l.status === 'manual' && /[a-z0-9]/i.test(norm.slice(l.range[0], l.range[1]))), e.text).toEqual([]);
      }
    });
  }
});

describe('WP19 guard G9 (design 6.8): counter-examples never give the meaning of an example', () => {
  for (const t of WP19_TEMPLATES) {
    it(`${t.id} (${rules(t)}): each counter-example does not parse automated, or means something else than every example`, () => {
      const meanings = new Set(t.examples.map((e) => parsedMeaning(t, e.text, opts)).filter((m): m is string => m !== null));
      expect(meanings.size, t.id).toBeGreaterThan(0);
      for (const c of t.counterExamples) {
        const m = parsedMeaning(t, c, opts);
        expect(m === null || !meanings.has(m), `${t.id}: "${c}" gives the meaning of an example`).toBe(true);
      }
    });
  }
});

describe('WP19 does not loosen the bootstrap templates (guard G9 with the larger template set)', () => {
  it('the bootstrap counter-examples still do not give the meaning of their first example when the WP19 templates are present', () => {
    for (const t of BOOTSTRAP_TEMPLATES) {
      if (t.kind === 'cost') {
        const first = unit(t.examples[0]!.text, 'cost');
        for (const c of t.counterExamples) {
          const r = unit(c, 'cost');
          expect(r.status !== 'ok' || first.status !== 'ok' || canonicalJson(r.derivation.value) !== canonicalJson(first.derivation.value), `${t.id}: ${c}`).toBe(true);
        }
        continue;
      }
      const first = face(exampleCard(t, t.examples[0]!.text), opts);
      const firstMeaning = meaning(first.abilities);
      for (const c of t.counterExamples) {
        const f = face(exampleCard(t, c), opts);
        expect(automated(f.abilities) && f.gate.every((g) => g.ok) && meaning(f.abilities) === firstMeaning, `${t.id}: ${c}`).toBe(false);
      }
    }
  });
});
