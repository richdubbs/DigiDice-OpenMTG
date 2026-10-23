/**
 * WP20, template package B (parser/templates/effect/{damage,life,cards,mana}.json): the templates of the ops of WP12 and WP13 (damage, fight, life, draw,
 * discard, mill, scry, surveil, reveal, look, shuffle, piles, addMana and its spending restrictions).
 *
 * Guard G9 (design 6.8): every example parses WITH its template, is fully automated and passes the exact render gate (G6); every counter-example does not
 * parse or parses to a different meaning. Well-formedness: the files compile with the bootstrap set, ids are unique and namespaced by file, every template
 * cites rules, examples are synthetic (design 6.10), riders name the op they patch, and adding the package changes no bootstrap template.
 */
import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_TEMPLATES } from '../../../src/parser/parse';
import { compileTemplates, validateTemplates } from '../../../src/parser/chart';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { validateAbility } from '../../../src/model/validate';
import { loadFixtureCards } from '../../fixtures';
import { EXAMPLES } from '../model/examples';
import type { OracleCard } from '../../../src/types/card';
import { FILES, NEIGHBORS, WP20, automated, bare, localIndex, meaning, options, parseExample } from './support';

/** The ops each file may build (design 15.2: WP20 covers the ops of WP12 and WP13, without counters, which are WP21's). */
const OPS: Record<keyof typeof FILES, string[]> = {
  damage: ['damage', 'fight'],
  life: ['gainLife', 'loseLife', 'setLife'],
  cards: ['draw', 'discard', 'mill', 'scry', 'surveil', 'reveal', 'look', 'shuffle', 'piles', 'move'],
  mana: ['addMana'],
};

const opsOf = (v: unknown, out: Set<string> = new Set()): Set<string> => {
  if (Array.isArray(v)) v.forEach((x) => opsOf(x, out));
  else if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) { if (k === 'op' && typeof x === 'string') out.add(x); opsOf(x, out); }
  }
  return out;
};

describe('WP20 template files are well formed (design 6.3, 6.9)', () => {
  it('they compile together with the bootstrap templates: no pattern, build or hole error, ids unique, rules cited, two counter-examples each', () => {
    expect(validateTemplates([...BOOTSTRAP_TEMPLATES, ...WP20])).toEqual([]);
    expect(compileTemplates([...BOOTSTRAP_TEMPLATES, ...WP20]).errors).toEqual([]);
  });

  it('about forty templates or more, each in the file of its op family, with an id namespaced eff.* (effects) or rid.* (riders)', () => {
    expect(WP20.length).toBeGreaterThanOrEqual(40);
    for (const [file, list] of Object.entries(FILES) as [keyof typeof FILES, typeof WP20][]) {
      for (const t of list) {
        expect(t.kind === 'effect' || t.kind === 'rider', `${file}: ${t.id} kind`).toBe(true);
        expect(t.id.startsWith(t.kind === 'rider' ? 'rid.' : 'eff.'), t.id).toBe(true);
        const ops = [...opsOf(t.build)];
        if (t.kind === 'rider') expect(OPS[file], `${t.id} attachTo`).toContain(t.attachTo);
        else expect(ops.length, t.id).toBeGreaterThan(0);
        for (const op of ops) expect(OPS[file], `${file}: ${t.id} builds ${op}`).toContain(op);
      }
    }
  });

  it('every op a template builds is a capability of this engine (an op handler and a renderer exist, design 5.2)', () => {
    for (const t of WP20) for (const op of opsOf(t.build)) expect(ENGINE_CAPABILITIES.has(`op:${op}`), `${t.id}: op:${op}`).toBe(true);
  });

  it('every template cites rules in the "CR n" form, and riders patch only the op they name', () => {
    for (const t of WP20) {
      for (const r of t.cr) expect(r, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      if (t.kind === 'rider') {
        expect(Object.keys(t.build as object), t.id).toEqual(['$patchPrevious']);
        expect(t.attachTo, t.id).toBeDefined();
      }
    }
  });

  it('no WP20 id collides with a bootstrap template id, and no WP20 template duplicates the pattern of a bootstrap template', () => {
    const boot = new Set(BOOTSTRAP_TEMPLATES.map((t) => t.id));
    const bootPatterns = new Set(BOOTSTRAP_TEMPLATES.map((t) => t.pattern.toLowerCase()));
    for (const t of WP20) {
      expect(boot.has(t.id), t.id).toBe(false);
      expect(bootPatterns.has(t.pattern.toLowerCase()), t.id).toBe(false);
    }
  });

  it('design 6.10: examples and counter-examples are synthetic: none is the whole Oracle text of a card (fixture, or the local index when present), and no example is a line of a fixture card or a section 13 example', () => {
    const lines = new Set<string>();
    const whole = new Set<string>();
    const tilde = (c: OracleCard, text: string): string =>
      c.name.split(' // ').reduce((l, n) => l.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '~'), text);
    const addCard = (c: OracleCard, lineLevel: boolean): void => {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((f) => f.oracle_text)]) {
        if (!text) continue;
        whole.add(text);
        whole.add(tilde(c, text));
        if (lineLevel) for (const line of text.split('\n')) { lines.add(line); lines.add(tilde(c, line)); }
      }
    };
    for (const c of Object.values(loadFixtureCards())) addCard(c, true);
    for (const c of localIndex() ?? []) addCard(c, false); // a single generic line ("{T}: Add {C}{C}.") is a minimal wording, a whole card is not
    for (const ex of EXAMPLES) for (const f of ex.faces) for (const a of f.abilities) lines.add(a.text);
    const verbatim = WP20.flatMap((t) => [
      ...t.examples.map((e) => e.text).filter((x) => whole.has(x) || lines.has(x)),
      ...t.counterExamples.filter((x) => whole.has(x)),
    ].map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  });

  it('design 6.9: the status is "stable" or "experimental" and every template declares its version', () => {
    for (const t of WP20) {
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(1);
    }
  });
});

describe('WP20 guard G9 (design 6.8): examples and counter-examples', () => {
  const opts = options(NEIGHBORS);
  for (const t of WP20) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated, lints clean and passes the render gate; counter-examples do not mean the same`, () => {
      const first = parseExample(t.examples[0]!.text, opts);
      for (const e of t.examples) {
        const f = parseExample(e.text, opts);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(bare(f.abilities))}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${f.gate.map((g) => `${g.rendered} / ${g.expected}`).join(' ; ')}`).toBe(true);
        for (const a of f.abilities) expect(validateAbility(a).filter((x) => x.severity === 'error'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities)).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parseExample(c, opts);
        expect(automated(f.abilities) && meaning(f.abilities) === meaning(first.abilities), c).toBe(false);
      }
    });
  }
});
