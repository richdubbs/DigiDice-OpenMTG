/**
 * WP23, guard G9 (design 6.8): every example of every WP23 template parses with that template, is fully automated, passes the exact render gate of WP2
 * (guard G6) and the lint (G7); every counter-example does not parse, or parses to a different meaning than every example of the template.
 *
 * The examples are parsed as whole abilities of synthetic cards (parseCard with the bootstrap, WP23 and stand-in templates), so each one goes through the
 * real driver, lowering passes, taint, lint and gate. Templates that `need` a capability this engine build lacks (the shields of shield.json, design 14)
 * are checked the other way round (guard G8): their sentence is manual with `needs-engine`, keeps the manual-shield chip of design 6.7 E1, and with the
 * capability present the chart builds the milestone 6 form.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { validateAbility } from '../../../src/model/validate';
import { normalizeText } from '../../../src/parser/preprocess';
import { automated, exampleCard, face, gated, options, parsedMeaning, unit, WP23_TEMPLATES } from './support';

const opts = options();
const rules = (t: Template): string => t.cr.join(', ');

describe('WP23 guard G9 (design 6.8): examples parse with their template, are automated, lint and pass the gate', () => {
  for (const t of WP23_TEMPLATES.filter((x) => !gated(x))) {
    it(`${t.id} (${rules(t)}): every example parses with it, is fully automated, lints and passes the render gate`, () => {
      for (const e of t.examples) {
        const c = exampleCard(e.text);
        const f = face(c, opts);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        for (const a of f.abilities) expect(validateAbility(a).filter((x) => x.severity === 'error'), e.text).toEqual([]);
        // no word of the example is left manual in the ledger (G4 with the WP23 templates)
        const norm = normalizeText(c.oracle_text ?? '').text;
        expect(f.ledger.filter((l) => l.status === 'manual' && /[a-z0-9]/i.test(norm.slice(l.range[0], l.range[1]))), e.text).toEqual([]);
      }
    });
  }
});

describe('WP23 guard G9 (design 6.8): counter-examples never give the meaning of an example', () => {
  for (const t of WP23_TEMPLATES.filter((x) => !gated(x))) {
    it(`${t.id} (${rules(t)}): each counter-example does not parse automated through it, and never means what an example means`, () => {
      const meanings = new Set(t.examples.map((e) => parsedMeaning(e.text, opts)).filter((m): m is string => m !== null));
      expect(meanings.size, t.id).toBeGreaterThan(0);
      for (const c of t.counterExamples) {
        const m = parsedMeaning(c, opts);
        expect(m === null || !meanings.has(m), `${t.id}: "${c}" gives the meaning of an example`).toBe(true);
        // WP23 review: a counter-example is never an automated ability built with this template ("Copy target creature." through eff.copy.spell)
        expect(m === null || !face(exampleCard(c), opts).templatesUsed.includes(t.id), `${t.id}: "${c}" parses automated with ${t.id}`).toBe(true);
      }
    });
  }
});

describe('WP23 shields (design 6.7 E1, 14; guard G8): recognized, manual with a chip in milestone 5, the milestone 6 form when the capability exists', () => {
  for (const t of WP23_TEMPLATES.filter(gated)) {
    it(`${t.id} (${rules(t)}): the sentence is a manual step with a reminder chip that does not taint its neighbors; the diagnostic names ${t.needs!.join(', ')}`, () => {
      for (const e of t.examples) {
        const f = face(exampleCard(e.text), opts);
        expect(f.abilities).toHaveLength(1);
        const steps = (f.abilities[0] as { effect: { steps: { op: string; reminder?: unknown }[] } }).effect.steps;
        expect(steps[0]!.op, e.text).not.toBe('manual'); // the neighbor stays automated (E1 does not taint)
        expect(steps[steps.length - 1], e.text).toMatchObject({ op: 'manual', reminder: { d: 'endOfTurn' } });
        expect(f.diagnostics.some((d) => d.code === 'needs-engine' && t.needs!.every((n) => d.message.includes(n))), e.text).toBe(true);
        expect(f.gate.every((g) => g.ok), e.text).toBe(true);
      }
    });

    it(`${t.id}: with ${t.needs!.join(', ')} present the chart builds the replacement effect of design 14.2 from the shield sentence alone`, () => {
      const caps = new Set(t.needs);
      for (const e of t.examples) {
        const sentence = e.text.slice(e.text.indexOf('. ') + 2);
        const r = unit(sentence, 'effects', undefined, opts, caps);
        expect(r.status, sentence).toBe('ok');
        if (r.status !== 'ok') continue;
        expect(r.derivation.templatesUsed).toEqual([t.id]);
        const v = (r.derivation.value as Record<string, unknown>[])[0]!;
        expect(v).toMatchObject({ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'replace', replaces: { ev: 'zoneChange', from: 'battlefield', to: 'graveyard' }, body: { b: 'modify', destination: { zone: 'exile' } } }] });
      }
      for (const c of t.counterExamples) {
        const sentence = c.slice(c.indexOf('. ') + 2);
        const r = unit(sentence, 'effects', undefined, opts, caps);
        expect(r.status !== 'ok' || !r.derivation.templatesUsed.includes(t.id), `${t.id}: "${c}"`).toBe(true);
      }
    });
  }
});
