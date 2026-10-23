/**
 * M6-5a templates (parser/templates/zz-push/k1.json; m6 design 3.8, 4.2; CONTRIBUTING "Adding a template"): "You may [cost] rather than pay this spell's
 * mana cost", with an optional "If [condition]," (CR 118.9, 601.2b). Guard G9 (design 6.8): every example parses with its template inside the whole default
 * template set (the game path), is automated, lints and passes the exact render gate; every counter-example and near-miss mutation never gives the meaning of
 * an example through the template. Examples are invented wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import type { OracleCard } from '../../../src/types/card';
import type { FaceParse, Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_FILES } from '../../../src/parser/template-set';
import { validateTemplates } from '../../../src/parser/chart';
import { validateAbility } from '../../../src/model/validate';
import { canonicalJson } from '../../../src/parser/holes/core';
import k1 from '../../../src/parser/templates/zz-push/k1.json';
import promo1Review from '../../m5/golden/cards/fast5-promo1-review.json';
import p2cst1Review from '../../m5/golden/cards/p2-cost-statics-1-review.json';
import { synthetic } from './support';

const K1 = k1 as Template[];
const OPTS = defaultParseOptions();
const face = (text: string): FaceParse => parseCard({ name: 'Example Bolt', layout: 'normal', type_line: 'Instant', mana_cost: '{3}{U}', oracle_text: text } as OracleCard, OPTS).faces[0]!;
const automated = (defs: readonly AbilityDef[]): boolean => {
  const json = JSON.stringify(defs);
  return defs.length > 0 && defs.every((a) => a.kind !== 'manual') && !json.includes('"op":"manual"') && !json.includes('"kind":"manual"');
};
const strip = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(strip);
  if (v === null || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !['src', 'prov', 'text', 'span'].includes(k)).map(([k, x]) => [k, strip(x)]));
};
/** The meaning of a parse that is automated and passes the gate, or null. */
const meaning = (text: string): string | null => {
  const f = face(text);
  return automated(f.abilities) && f.gate.every((g) => g.ok) ? canonicalJson(strip(f.abilities)) : null;
};

describe('zz-push/k1.json is well formed and loads last (m6 design 4.2)', () => {
  it('is in the zz-push/ group, which ends the default template set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    const first = files.findIndex((f) => f.startsWith('zz-push/'));
    expect(files).toContain('zz-push/k1.json');
    expect(files.slice(first).every((f) => f.startsWith('zz-push/'))).toBe(true);
  });
  it('validates, cites rules, has at least two examples and two counter-examples and consumes its critical words', () => {
    expect(validateTemplates(K1)).toEqual([]);
    for (const t of K1) {
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.consumes, t.id).toEqual(expect.arrayContaining(['may', 'rather than', ...(t.pattern.startsWith('if ') ? ['if'] : [])]));
      expect(t.id, t.id).toMatch(/^cm\.alternative/);
    }
  });
  /**
   * m5 design 6.9 step 3, CONTRIBUTING "Adding a template" step 2: promotion to stable needs 20 reviewed corpus matches or three verified golden cards.
   * cm.alternative has 20 or more matches (46, reviewed). FAST5 PROMO1 reviewed every index match of the other forms and promoted the three that have three
   * hand-verified golden cards (test/m5/golden/cards/fast5-promo1-review.json): if (15 matches; Force of Negation, Snuff Out, Force of Vigor), mana
   * (10; the Bringers of the Dawn) and mana.and (8; Sephara, Fieldmist Borderpost, Stalwart Valkyrie). mana.if had one match and stayed experimental until
   * p2-cost-statics-1 promoted it on six hand-verified golden cards of the tuning half (test/m5/golden/cards/p2-cost-statics-1-review.json: the traps whose
   * conditions that round taught the Cond hole, Ricochet Trap and Admiral's Order).
   */
  it('CR 118.9 (design 6.9): the statuses; every stable form under 20 corpus matches has three golden cards', () => {
    expect(Object.fromEntries(K1.map((t) => [t.id, t.status]))).toEqual({
      'cm.alternative': 'stable',
      'cm.alternative.if': 'stable',
      'cm.alternative.mana': 'stable',
      'cm.alternative.mana.and': 'stable',
      'cm.alternative.mana.if': 'stable',
    });
    for (const id of ['cm.alternative.if', 'cm.alternative.mana', 'cm.alternative.mana.and']) {
      expect((promo1Review as { verified: string }[]).filter((g) => g.verified.includes(`(${id})`)).length, id).toBeGreaterThanOrEqual(3);
    }
    expect((p2cst1Review as { verified: string }[]).filter((g) => g.verified.includes('(cm.alternative.mana.if;') || g.verified.includes('(cm.alternative.mana.if)')).length).toBeGreaterThanOrEqual(3);
  });
});

describe('design 6.9: the K1 forms on the game path (CR 118.9)', () => {
  const card = (text: string) => synthetic('Example Bolt', 'Instant', '{3}{U}', `${text}\nExample Bolt deals 3 damage to any target.`);
  it('CR 118.9: the form "If ..., you may pay {mana} rather than ..." is stable since p2-cost-statics-1: its card is full', () => {
    expect(card('If you control a Forest, you may pay {G} rather than pay this spell\'s mana cost.').automation.level).toBe('full');
  });
  it('CR 118.9: a card whose alternative cost uses a stable form is full', () => {
    for (const text of [
      'You may pay 3 life and discard a card rather than pay this spell\'s mana cost.',
      'If it\'s not your turn, you may pay 3 life rather than pay this spell\'s mana cost.',
      'You may pay {1}{U} rather than pay this spell\'s mana cost.',
      'You may pay {1} and sacrifice a creature rather than pay this spell\'s mana cost.',
    ]) expect(card(text).automation.level, text).toBe('full');
  });
});

describe('guard G9 (design 6.8): examples', () => {
  for (const t of K1) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it on the game path, is automated, lints and passes the render gate`, () => {
      for (const e of t.examples) {
        const f = face(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        for (const a of f.abilities) expect(validateAbility(a).filter((x) => x.severity === 'error'), e.text).toEqual([]);
        const st = f.abilities[0] as { kind: string; effects: { s: string; name: string }[] };
        expect(st).toMatchObject({ kind: 'static', effects: [{ s: 'alternativeCost', name: 'alternative' }] });
      }
    });
  }

  it('CR 118.9: the built JSON of one example of each form', () => {
    expect(strip(face('You may pay {3}{G}{G} rather than pay ~\'s mana cost.').abilities)).toEqual([
      { kind: 'static', zone: ['stack'], effects: [{ s: 'alternativeCost', cost: { mana: [{ kind: 'generic', amount: 3 }, { kind: 'colored', color: 'G' }, { kind: 'colored', color: 'G' }] }, name: 'alternative' }] },
    ]);
    expect(strip(face('If it\'s not your turn, you may pay 3 life rather than pay ~\'s mana cost.').abilities)).toEqual([
      { kind: 'static', zone: ['stack'], effects: [{ s: 'alternativeCost', cost: { other: [{ kind: 'payLife', amount: 3 }] }, name: 'alternative', when: { cond: 'not', of: { cond: 'turnOf', whose: 'you' } } }] },
    ]);
    expect(strip(face('You may pay {1} and sacrifice a creature rather than pay ~\'s mana cost.').abilities)).toEqual([
      { kind: 'static', zone: ['stack'], effects: [{ s: 'alternativeCost', cost: { mana: [{ kind: 'generic', amount: 1 }], other: [{ kind: 'sacrifice', count: 1, filter: { types: ['Creature'] } }] }, name: 'alternative' }] },
    ]);
  });
});

describe('guard G9 (design 6.8): counter-examples and near misses never mean what an example means', () => {
  /** Near-miss mutations (design 6.8): a word that changes the meaning of a cost sentence. */
  const mutations = (text: string): string[] => [
    text.replace('rather than pay', 'in addition to paying'),
    text.replace('you may', 'each opponent may'),
    text.replace(/^You may/, 'You must'),
    text.replace('mana cost.', 'mana cost unless an opponent controls an Island.'),
    text.replace('~\'s mana cost', 'its mana cost'),
    text.replace(/\.$/, ' at random.'),
  ].filter((m) => m !== text);

  for (const t of K1) {
    it(`${t.id}: each counter-example and near-miss mutation of an example is not automated through it and never means what an example means`, () => {
      const meanings = new Set(t.examples.map((e) => meaning(e.text)).filter((m): m is string => m !== null));
      expect(meanings.size, t.id).toBe(t.examples.length);
      for (const c of [...t.counterExamples, ...t.examples.flatMap((e) => mutations(e.text))]) {
        const m = meaning(c);
        expect(m === null || !meanings.has(m), `${t.id}: "${c}" gives the meaning of an example`).toBe(true);
        const f = face(c);
        expect(!(automated(f.abilities) && f.templatesUsed.includes(t.id)), `${t.id}: "${c}" parses automated with ${t.id}`).toBe(true);
      }
    });
  }
});
