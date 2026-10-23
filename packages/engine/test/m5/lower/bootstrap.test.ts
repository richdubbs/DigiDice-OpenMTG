/**
 * WP17: the bootstrap templates (parser/templates/bootstrap.json: the twelve seed templates of design 6.3 plus the minimum for six cards) and the bootstrap
 * cards. Lightning Bolt, Giant Growth, Doom Blade, Llanowar Elves, Serra Angel and Glorious Anthem (fixture cards) must produce EXACTLY the JSON of design
 * section 13 (read from the design document itself, test/m5/model/examples.ts), and the render gate of WP2 (guard G6) must accept them. Every template's
 * examples parse with it and pass the gate; every counter-example does not parse or parses to different JSON (guard G9).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import type { Template } from '../../../src/parser/types';
import { BOOTSTRAP_TEMPLATES, defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { parseUnit, validateTemplates } from '../../../src/parser/chart';
import { adaptTokens, canonicalJson } from '../../../src/parser/holes';
import { tokenize } from '../../../src/parser/tokenize';
import { renderGate, renderGateKeywordLine } from '../../../src/render/gate';
import { validateAbility } from '../../../src/model/validate';
import { getCard } from '../../fixtures';
import { EXAMPLES } from '../model/examples';
import { bare, card } from './support';

const BOOTSTRAP_CARDS = ['Lightning Bolt', 'Giant Growth', 'Doom Blade', 'Llanowar Elves', 'Serra Angel', 'Glorious Anthem'];
/** The rules each bootstrap card pins (test names, design 15.1.4). */
const RULES: Record<string, string> = {
  'Lightning Bolt': 'CR 115.4, 120.3: "any target" and damage',
  'Giant Growth': 'CR 611.2a, 613.4c: a pump until end of turn',
  'Doom Blade': 'CR 115.1, 701.8a: a target with a negated color and destroy',
  'Llanowar Elves': 'CR 605.1a: a mana ability',
  'Serra Angel': 'CR 702.9, 702.20: a keyword line',
  'Glorious Anthem': 'CR 604.1, 613.4c: a static anthem',
};
const SEED_IDS = ['eff.damage', 'eff.destroy', 'rid.noregen', 'eff.draw', 'eff.token', 'eff.pump', 'wrap.payelse', 'wrap.mayunless', 'trg.enters', 'trg.dies', 'cost.sac', 'sta.anthem'];

describe('WP17 bootstrap templates (design 6.3, 6.9)', () => {
  it('are well formed: they compile, cite rules, have examples and at least two counter-examples, unique ids', () => {
    expect(validateTemplates(BOOTSTRAP_TEMPLATES)).toEqual([]);
  });
  it('contain the twelve seed templates of design 6.3', () => {
    const ids = BOOTSTRAP_TEMPLATES.map((t) => t.id);
    for (const id of SEED_IDS) expect(ids, id).toContain(id);
  });
  it('carry no Wizards text in their examples (design 6.10): no example equals the Oracle text of a fixture card', () => {
    const oracle = new Set(BOOTSTRAP_CARDS.map((n) => getCard(n).oracle_text));
    for (const t of BOOTSTRAP_TEMPLATES) for (const e of t.examples) expect(oracle.has(e.text), `${t.id}: ${e.text}`).toBe(false);
  });
  it('wrap.mayunless nests the "may" inside the pay step: the payer decides first (CR 118.12a, design D3)', () => {
    const t = BOOTSTRAP_TEMPLATES.find((x) => x.id === 'wrap.mayunless')!;
    expect(t.build).toMatchObject({ op: 'pay', else: [{ op: 'may' }] });
  });
});

describe('WP17 the bootstrap cards produce exactly the JSON of design section 13', () => {
  const opts = defaultParseOptions({ templates: [...BOOTSTRAP_TEMPLATES] }); // W3b: the default is the whole template set
  for (const name of BOOTSTRAP_CARDS) {
    it(`${RULES[name]} (${name})`, () => {
      const res = parseCard(getCard(name), opts);
      const example = EXAMPLES.find((e) => e.name === name)!;
      expect(res.faces).toHaveLength(1);
      expect(bare(res.faces[0]!.abilities)).toEqual(example.faces[0]!.abilities);
      expect(res.faces[0]!.diagnostics.filter((d) => d.level === 'manual')).toEqual([]);
    });
  }
  it('the render gate of WP2 (guard G6) accepts every one of them, run again here on the output', () => {
    for (const name of BOOTSTRAP_CARDS) {
      const c = getCard(name);
      const f = parseCard(c, opts).faces[0]!;
      expect(f.gate.every((g) => g.ok), name).toBe(true);
      const lines = (c.oracle_text ?? '').split('\n');
      f.abilities.forEach((a, i) => {
        const g = a.kind === 'keyword' ? renderGateKeywordLine([a], [lines[i]!], { selfNames: [name] }) : renderGate(a, a.text.split('\n'), { selfNames: [name] });
        expect(g.ok, `${name} #${i}: ${g.rendered} / ${g.expected}`).toBe(true);
        expect(validateAbility(a).filter((x) => x.severity === 'error'), name).toEqual([]);
      });
    }
  });
  it('they are fully parsed: the ledger is all consumed, every template used is a bootstrap template', () => {
    for (const name of BOOTSTRAP_CARDS) {
      const f = parseCard(getCard(name), opts).faces[0]!;
      expect(f.ledger.every((e) => e.status === 'consumed' || e.status === 'reminder' || e.status === 'structure'), name).toBe(true);
      expect(f.templatesUsed.every((id) => BOOTSTRAP_TEMPLATES.some((t) => t.id === id)), name).toBe(true);
    }
  });
});

/** A synthetic card in which a template example is an ability of the right kind. */
function exampleCard(t: Template, text: string) {
  if (t.kind === 'trigger' || t.kind === 'ability') return card('Example Wisp', 'Creature — Spirit', text);
  if (t.kind === 'static') return card('Example Banner', 'Enchantment', text);
  if (text.includes(':')) return card('Example Totem', 'Artifact Creature — Golem', text);
  return card('Example Bolt', 'Instant', text);
}

const automated = (defs: readonly AbilityDef[]): boolean => defs.length > 0 && defs.every((a) => a.kind !== 'manual') && !JSON.stringify(defs).includes('"op":"manual"');

describe('WP17 guard G9 on the bootstrap templates: examples and counter-examples', () => {
  const opts = defaultParseOptions({ templates: [...BOOTSTRAP_TEMPLATES] }); // W3b: the default is the whole template set
  for (const t of BOOTSTRAP_TEMPLATES) {
    if (t.kind === 'cost') {
      it(`guard G9 (design 6.8), ${t.id} (${t.cr.join(", ")}): examples parse as a cost, counter-examples do not give the same cost`, () => {
        const parse = (s: string) => parseUnit({ tokens: adaptTokens(tokenize(s)), templates: BOOTSTRAP_TEMPLATES, env: { lexicon: opts.lexicon, keywords: opts.keywords }, goal: 'cost' });
        const first = parse(t.examples[0]!.text);
        expect(first.status).toBe('ok');
        for (const e of t.examples) { const r = parse(e.text); expect(r.status === 'ok' && r.derivation.templatesUsed.includes(t.id), e.text).toBe(true); }
        for (const c of t.counterExamples) { const r = parse(c); expect(r.status !== 'ok' || canonicalJson(r.derivation.value) !== canonicalJson(first.status === 'ok' ? first.derivation.value : null), c).toBe(true); }
      });
      continue;
    }
    it(`guard G9 (design 6.8), ${t.id} (${t.cr.join(", ")}): every example parses with it, is fully automated and passes the gate; counter-examples do not give the same JSON`, () => {
      const first = parseCard(exampleCard(t, t.examples[0]!.text), opts).faces[0]!;
      for (const e of t.examples) {
        const f = parseCard(exampleCard(t, e.text), opts).faces[0]!;
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), e.text).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities)).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parseCard(exampleCard(t, c), opts).faces[0]!;
        const same = automated(f.abilities) && canonicalJson(bare(f.abilities).map((a) => ({ ...(a as object), text: '' }))) === canonicalJson(bare(first.abilities).map((a) => ({ ...(a as object), text: '' })));
        expect(same, c).toBe(false);
      }
    });
  }
});
