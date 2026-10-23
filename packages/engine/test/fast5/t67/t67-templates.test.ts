/**
 * FAST5 T67 (counted token creation, emblems, "Choose a creature type." riders): the template data of parser/templates/zz-fast5/t67.json, the in-ability
 * link pass (parser/lower/links.ts) and the count window of the anaphora pass (parser/lower/anaphora.ts#countWindow). Guard G9 (design 6.8): every example
 * lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON;
 * near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic
 * wordings (design 6.10), checked against the local index when it is present. The behavior is in t67-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { lowerLinks } from '../../../src/parser/lower/links';
import type { Draft, Unit } from '../../../src/parser/lower/types';
import t67 from '../../../src/parser/templates/zz-fast5/t67.json';
import review from '../../m5/golden/cards/fast5-t67-review.json';
import r3fxReview from '../../m5/golden/cards/cloud-r3-fx-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T67 = t67 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a T67 example is an ability of the right kind: a spell on a sorcery, a triggered or activated ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text);
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('T67 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t67.json, after zz-fast5/t66.json, before zz-fast5x/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t67.json');
    expect(files.indexOf('zz-fast5/t67.json')).toBe(files.indexOf('zz-fast5/t66.json') + 1);
    expect(files.indexOf('zz-fast5/t67.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast5x/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(T67.length).toBe(7);
    for (const t of T67) {
      expect(t.id, t.id).toMatch(/^eff\.t67\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T67 template has its evidence: at least one hand-verified golden card that uses it, three where the corpus has three', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    // Standard round 3 r3-fx promoted eff.t67.token.forEach.counterOnSelf on Twitching Doll, the one card of the corpus that prints it (its review file)
    const evidence = [...golden, ...(r3fxReview as { card: string; verified: string; expect?: string }[])];
    for (const t of T67.filter((x) => x.status === 'stable')) {
      const cards = evidence.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T67) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

/** Templates of another package with the same pattern and build (one reading, whichever matches first). */
const TWIN_TEMPLATES: Record<string, readonly string[]> = { 'eff.t67.emblem': ['eff.e27.emblem.you'] };

describe('T67 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T67) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        // FAST5 batch 2 merge: FAST5X E27's eff.e27.emblem.you has the same pattern and build as eff.t67.emblem (CR 114.1-114.4) and is matched first.
        const twins = TWIN_TEMPLATES[t.id] ?? [];
        expect(f.templatesUsed.some((id) => id === t.id || twins.includes(id)), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(t, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '').replace(/\."$/, '"');
  const plain = text.endsWith('"') ? [] : [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const out = [...plain];
  const swaps: [RegExp, string][] = [
    [/\bfor each\b/, 'for any'], [/\bcreate a\b/, 'create two'], [/\bcreate an\b/, 'create two'], [/\btapped\b/, 'untapped'], [/\bthat type\b/, 'that color'],
    [/\bcreature type\b/, 'card type'], [/\buntil end of turn\b/, 'until your next turn'], [/\bYou get\b/, 'Target opponent gets'], [/\bor more\b/, 'or fewer'],
    [/\bcounter on\b/, 'charge counter on'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('T67 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T67) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('T67 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of T67) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^"?\{/.test(w) || w.includes('\n')) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const start = w.startsWith('"') ? '"' : '';
          const mutated = [...words.slice(0, i), `${start}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('T67 lowering: the link pass (CR 608.2c-d) and the count window (CR 608.2h, 201.5)', () => {
  const unit = (index: number, steps: Record<string, unknown>[], manual = false): Unit =>
    ({ index, range: [0, 0], text: '', tokens: [], steps, templates: [], experimental: [], flags: [], ...(manual ? { manual: { code: 'no-template', reason: 'x' } } : {}) }) as Unit;
  const choose = (what: string, link: string) => ({ op: 'chooseValue', who: { ref: 'you' }, what, as: link, link });
  const use = (quality: string) => ({ op: 'draw', who: { ref: 'you' }, count: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], chosen: { link: '$link', quality } } } } });
  const draft = (units: Unit[]): Draft => ({ units, targets: [], selfHeads: [], mentions: [], names: [], diagnostics: [] });
  const linkOf = (d: Draft, i: number): unknown => (d.units[i]!.steps[0] as { count: { of: { filter: { chosen: unknown } } } }).count.of.filter.chosen;

  it('"that type" takes the kind and the link of the one earlier choice; "the chosen type" a creature type only', () => {
    const d = lowerLinks(draft([unit(0, [choose('creatureType', 'c1')]), unit(1, [use('$type')]), unit(2, [use('creatureType')])]));
    expect(linkOf(d, 1)).toEqual({ link: 'c1', quality: 'creatureType' });
    expect(linkOf(d, 2)).toEqual({ link: 'c1', quality: 'creatureType' });
    const card = lowerLinks(draft([unit(0, [choose('cardType', 'k1')]), unit(1, [use('$type')]), unit(2, [use('creatureType')])]));
    expect(linkOf(card, 1)).toEqual({ link: 'k1', quality: 'cardType' });
    expect(linkOf(card, 2)).toEqual({ link: '$link', quality: 'creatureType' }); // a card type is not "the chosen type" (a creature type)
  });
  it('design 6.4: no earlier choice, a later one, a choice of a manual sentence or two candidates: nothing is replaced (the sentence becomes manual)', () => {
    expect(linkOf(lowerLinks(draft([unit(0, [use('$type')]), unit(1, [choose('creatureType', 'c1')])])), 0)).toEqual({ link: '$link', quality: '$type' });
    expect(linkOf(lowerLinks(draft([unit(0, [choose('creatureType', 'c1')], true), unit(1, [use('$type')])])), 1)).toEqual({ link: '$link', quality: '$type' });
    const two = lowerLinks(draft([unit(0, [choose('creatureType', 'c1')]), unit(1, [choose('landType', 'l1')]), unit(2, [use('$type')])]));
    expect(linkOf(two, 2)).toEqual({ link: '$link', quality: '$type' });
  });
  it('is pure: the input draft is not changed', () => {
    const d = draft([unit(0, [choose('creatureType', 'c1')]), unit(1, [use('$type')])]);
    const before = JSON.stringify(d);
    lowerLinks(d);
    expect(JSON.stringify(d)).toBe(before);
  });
  it('"its power" in the count of the first token creation of an own-event disjunction is the object itself; elsewhere it stays unbound', () => {
    const face = (text: string) => parseCard(card('Example Hulk', 'Artifact Creature — Construct', text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
    const ok = face('Whenever ~ enters or attacks, create a number of 1/1 colorless Gnome artifact creature tokens equal to its power.');
    expect(fullyAutomated(ok) || ok.templatesUsed.length > 0).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"of":{"ref":"self"}');
    // a second instruction: the tokens of the first may be what "it" means (design 6.4), so it is not resolved to ~
    const later = face('Whenever ~ enters or attacks, draw a card. Then create a number of 1/1 colorless Gnome artifact creature tokens equal to its power.');
    expect(fullyAutomated(later)).toBe(false);
    // the cost object of an activated ability is never this fallback (model/cost-antecedent.ts keeps its own rule)
    const cost = face('{2}, Sacrifice another artifact: Create a number of 1/1 colorless Gnome artifact creature tokens equal to its power.');
    expect(fullyAutomated(cost)).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('T67 design 6.10 (local index): synthetic examples', () => {
  it('no T67 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = T67.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
