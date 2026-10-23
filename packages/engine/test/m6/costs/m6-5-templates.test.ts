/**
 * M6-5 templates (parser/templates/zz-m6/costs.json; m6 design 3.8, 4.2; CONTRIBUTING "Adding a template"): "Kicker {A} and/or {B}" (CR 702.33b), the choice
 * between two additional costs (CR 601.2b), counters and life "for each time it was kicked" (CR 702.33d-e), "escapes with" and "unless it escaped"
 * (CR 702.138b-c), and "If C, it deals N damage instead" (CR 614.15). Guard G9 (design 6.8): every example parses with its template inside the whole default
 * template set (the game path), is automated, lints and passes the exact render gate; every counter-example and near-miss mutation never gives the meaning of
 * an example through the template. Examples are invented wordings (design 6.10).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import type { OracleCard } from '../../../src/types/card';
import type { FaceParse, Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_FILES } from '../../../src/parser/template-set';
import { validateTemplates } from '../../../src/parser/chart';
import { validateAbility } from '../../../src/model/validate';
import { canonicalJson } from '../../../src/parser/holes/core';
import costs from '../../../src/parser/templates/zz-m6/costs.json';

const M65 = costs as Template[];
const OPTS = defaultParseOptions();
/** Statics and triggers about the object itself are written on a creature; the rest on an instant. */
const onCreature = (t: Template): boolean => /^(rep|eff)\.m6\./.test(t.id) || t.id.startsWith('kw.');
const face = (text: string, creature: boolean): FaceParse => parseCard({
  name: 'Example Thing', layout: 'normal', type_line: creature ? 'Creature — Elf' : 'Instant', mana_cost: '{3}{R}', oracle_text: text, ...(creature ? { power: '2', toughness: '2' } : {}),
} as OracleCard, OPTS).faces[0]!;
const automated = (defs: readonly AbilityDef[]): boolean => {
  const json = JSON.stringify(defs);
  return defs.length > 0 && defs.every((a) => a.kind !== 'manual') && !json.includes('"op":"manual"') && !json.includes('"kind":"manual"');
};
const strip = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(strip);
  if (v === null || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !['src', 'prov', 'text', 'span'].includes(k)).map(([k, x]) => [k, strip(x)]));
};
const meaning = (text: string, creature: boolean): string | null => {
  const f = face(text, creature);
  return automated(f.abilities) && f.gate.every((g) => g.ok) ? canonicalJson(strip(f.abilities)) : null;
};

describe('zz-m6/costs.json is well formed and in the template set (m6 design 4.2)', () => {
  it('is listed by parser/template-set.ts after every zz-fast file and before zz-push/', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    const at = files.indexOf('zz-m6/costs.json');
    expect(at).toBeGreaterThan(Math.max(...files.map((f, i) => (f.startsWith('zz-fast') ? i : -1))));
    expect(at).toBeLessThan(files.findIndex((f) => f.startsWith('zz-push/')));
  });

  it('validates, cites rules, has examples and at least two counter-examples, and has no id of another file', () => {
    expect(validateTemplates(M65)).toEqual([]);
    const others = new Set(TEMPLATE_FILES.filter((f) => f.file !== 'zz-m6/costs.json').flatMap((f) => f.templates.map((t) => t.id)));
    for (const t of M65) {
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(1);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(others.has(t.id), t.id).toBe(false);
      expect(t.id, t.id).toMatch(/\.m6\./);
    }
  });

  /**
   * m5 design 6.9 step 3, CONTRIBUTING "Adding a template" step 2: stable needs 20 reviewed corpus matches or three verified golden cards. Corpus matches on
   * the game path (local index of 34,473 cards, M6-5): kicker.andor 18, choice 6, choice.payMana 27 (all 27 read against their Oracle text), choice.manaFirst
   * 2, enters.counter.kicked 8, enters.counters.kicked 1, gainlife.kicked 2, escapes.counters 9, sacrifice.unless 3, instead.damage 7. The stable ones under
   * 20 have three golden cards each in test/m5/golden/cards/m6-5-review.json (checked below); the rest stay experimental and cap their cards at partial.
   */
  it('design 6.9: the statuses, and three golden cards for every stable template under 20 corpus matches', () => {
    expect(Object.fromEntries(M65.map((t) => [t.id, t.status]))).toEqual({
      'kw.m6.kicker.andor': 'stable',
      'cm.m6.additional.choice': 'stable',
      'cm.m6.additional.choice.payMana': 'stable',
      'cm.m6.additional.choice.manaFirst': 'stable', // Standard round 4 r4-fxb: both index cards that print it are golden (test/m5/golden/cards/cloud-r4-fxb-review.json)
      'rep.m6.enters.counter.kicked': 'stable',
      'rep.m6.enters.counters.kicked': 'stable', // p2-promote-2: 6.9 narrow wording, its one card (Vodalian Mindsinger) golden in m6-5-review.json
      'eff.m6.gainlife.kicked': 'stable', // p2-promote-2: 6.9 narrow wording, Lightkeeper of Emeria golden in m6-5-review.json
      'rep.m6.escapes.counters': 'stable',
      'eff.m6.sacrifice.unless': 'stable', // Cloud std-eoe: three golden cards in test/m5/golden/cards/cloud-std-eoe-review.json (Phlage, Patagia Viper, Chorale of the Void)
      'rid.m6.instead.damage': 'stable',
    });
    const golden = JSON.parse(readFileSync(new URL('../../m5/golden/cards/m6-5-review.json', import.meta.url), 'utf8')) as { card: string; verified: string }[];
    for (const id of ['kw.m6.kicker.andor', 'cm.m6.additional.choice', 'rep.m6.enters.counter.kicked', 'rep.m6.escapes.counters', 'rid.m6.instead.damage']) {
      expect(golden.filter((g) => g.verified.includes(`(${id})`) || g.verified.includes(`${id};`)).length, id).toBeGreaterThanOrEqual(3);
    }
    // Cloud std-eoe: eff.m6.sacrifice.unless has its three golden cards in the std-eoe review file
    const eoe = JSON.parse(readFileSync(new URL('../../m5/golden/cards/cloud-std-eoe-review.json', import.meta.url), 'utf8')) as { card: string; verified: string }[];
    expect(eoe.filter((g) => g.verified.includes('eff.m6.sacrifice.unless')).length, 'eff.m6.sacrifice.unless').toBeGreaterThanOrEqual(3);
  });
});

describe('guard G9 (design 6.8): examples', () => {
  for (const t of M65) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it on the game path, is automated, lints and passes the render gate`, () => {
      for (const e of t.examples) {
        const f = face(e.text, onCreature(t));
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        for (const a of f.abilities) expect(validateAbility(a).filter((x) => x.severity === 'error'), e.text).toEqual([]);
      }
    });
  }

  it('the built JSON of one example of each form', () => {
    expect(strip(face('Kicker {1}{W} and/or {2}{B}', true).abilities)).toEqual([
      { kind: 'keyword', keyword: 'kicker', cost: { mana: [{ kind: 'generic', amount: 1 }, { kind: 'colored', color: 'W' }] } },
      { kind: 'keyword', keyword: 'kicker', cost: { mana: [{ kind: 'generic', amount: 2 }, { kind: 'colored', color: 'B' }] } },
    ]);
    expect(face('Kicker {1}{W} and/or {2}{B}', true).abilities.map((a) => a.text)).toEqual(['Kicker {1}{W}', 'Kicker {2}{B}']);
    expect(strip(face('As an additional cost to cast ~, sacrifice an artifact or pay {4}.', false).abilities)).toEqual([
      { kind: 'static', zone: ['stack'], effects: [
        { s: 'additionalCost', cost: { other: [{ kind: 'sacrifice', count: 1, filter: { types: ['Artifact'] } }] }, choiceGroup: 'cost' },
        { s: 'additionalCost', cost: { mana: [{ kind: 'generic', amount: 4 }] }, choiceGroup: 'cost' },
      ] },
    ]);
    expect(strip(face('~ escapes with two +1/+1 counters on it.', true).abilities)).toEqual([
      { kind: 'static', zone: ['stack', 'battlefield'], condition: { cond: 'wasCast', via: 'escape' }, effects: [
        { s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', counters: [{ kind: '+1/+1', count: 2 }] } },
      ] },
    ]);
    expect(strip(face('When ~ enters, sacrifice it unless it escaped.', true).abilities)).toEqual([
      { kind: 'triggered', trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }] }, effect: { targets: [], steps: [
        { op: 'if', cond: { cond: 'not', of: { cond: 'wasCast', via: 'escape' } }, then: [{ op: 'sacrifice', what: { ref: 'self' } }] },
      ] } },
    ]);
  });
});

describe('guard G9 (design 6.8): counter-examples and near misses never mean what an example means', () => {
  /** Near-miss mutations (design 6.8): a word that changes the meaning of one of these sentences. */
  const mutations = (text: string): string[] => [
    text.replace('and/or', 'or'),
    text.replace(' or ', ' and '),
    text.replace('was kicked', 'was copied'), // cloud std-spm: "~ was cast" is a condition now (CR 601.2i, parser/holes/cond.ts), so the cast-history near miss is "was copied"
    text.replace('kicked', 'cycled'),
    text.replace('escapes', 'enters'),
    text.replace('escaped', 'attacked'),
    text.replace('unless', 'if'),
    text.replace(' instead', ''),
    text.replace('additional cost', 'alternative cost'),
    text.replace(/on it/, 'on target creature'),
  ].filter((m) => m !== text);

  for (const t of M65) {
    it(`${t.id}: each counter-example and near-miss mutation of an example is not automated through it and never means what an example means`, () => {
      const creature = onCreature(t);
      const meanings = new Set(t.examples.map((e) => meaning(e.text, creature)).filter((m): m is string => m !== null));
      expect(meanings.size, t.id).toBe(t.examples.length);
      for (const c of [...t.counterExamples, ...t.examples.flatMap((e) => mutations(e.text))]) {
        const m = meaning(c, creature);
        expect(m === null || !meanings.has(m), `${t.id}: "${c}" gives the meaning of an example`).toBe(true);
        const f = face(c, creature);
        expect(!(automated(f.abilities) && f.templatesUsed.includes(t.id)), `${t.id}: "${c}" parses automated with ${t.id}`).toBe(true);
      }
    });
  }
});
