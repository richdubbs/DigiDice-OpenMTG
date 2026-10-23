/**
 * PUSH1 T1: the templates of parser/templates/zz-push/t1.json (keyword actions CR 701.16, 701.34, 701.36, 701.39, 701.44, 701.47, 701.50, 701.53, 701.57;
 * typecycling CR 702.29e). Guard G9 (design 6.8): every example lowers with its template, is fully automated, passes the exact render gate (G6) and states
 * its JSON where it says so; every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word never
 * leaves an automated ability (G2); examples are synthetic wordings (design 6.10). Parsed on the game path (every committed template, ENGINE_CAPABILITIES).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { parseCard } from '../../../src/parser/parse';
import type { Template } from '../../../src/parser/types';
import { behavior, goldenCard, goldenOptions, loadGolden, maskedBehavior, partial, partialAgreesWith, understood, type GoldenEntry } from '../golden/harness';
import { automated, fullyAutomated, jsonKey, localIndex, parsedWith, plain, T1_TEMPLATES } from './support';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

/** The T1 golden cards (hand-verified, design 6.9). */
const GOLDEN = loadGolden().filter((e) => e.source === 'push-t1-review.json');
/** An entry whose `verified` note names the template id: "(eff.action.populate)", "(kw.typecycling.swamp, kw.typecycling.mountain)". */
/** p2-promote-2 (6.9 deviation, narrow wordings printed on one or two cards): stable on the card that prints it (push-t1-review.json), played in test/cloud/p2-promote-2. */
const NARROW: Readonly<Record<string, string>> = { 'kw.typecycling.wizard': 'Step Through' };
const cites = (id: string) => (e: GoldenEntry): boolean => (e.verified ?? '').includes(`${id})`) || (e.verified ?? '').includes(`${id},`);
/** What the template's output always contains: its action step, or the typecycling keyword. */
const signature = (t: Template): string => (t.id.startsWith('eff.action.') ? `"action":"${t.id.split('.')[2]}"` : '"keyword":"typecycling"');

describe('PUSH1 T1: zz-push/t1.json is well formed and loaded last (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('the game\'s template set has it in the zz-push/ group that ends the set, and the whole set validates', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-push/t1.json');
    expect(files.slice(files.findIndex((f) => f.startsWith('zz-push/'))).every((f) => f.startsWith('zz-push/'))).toBe(true);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('every T1 id is unique in the whole set, namespaced by kind, and cites rules of the form "CR n"', () => {
    const ids = TEMPLATE_SET.map((t) => t.id);
    for (const t of T1_TEMPLATES) {
      expect(ids.filter((i) => i === t.id), t.id).toHaveLength(1);
      expect(t.id, t.id).toMatch(t.kind === 'effect' ? /^eff\.action\./ : /^kw\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
    }
  });
  it('design 6.9: at least two examples and two counter-examples each; every template states the capability its output needs', () => {
    for (const t of T1_TEMPLATES) {
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.needs?.length ?? 0, t.id).toBeGreaterThan(0);
      expect(t.examples.some((e) => e.expect !== undefined), `${t.id}: one example states its JSON`).toBe(true);
    }
  });
  it('design 6.9: a stable T1 template has three hand-verified golden cards (golden/cards/push-t1-review.json); the others stay experimental', () => {
    for (const t of T1_TEMPLATES) {
      const cards = GOLDEN.filter(cites(t.id));
      if (t.status === 'stable' && NARROW[t.id] !== undefined) expect(cards.map((c) => c.card), t.id).toContain(NARROW[t.id]);
      else if (t.status === 'stable') expect(cards.length, `${t.id}: ${cards.map((c) => c.card).join(', ')}`).toBeGreaterThanOrEqual(3);
    }
    // fewer than three cards in the whole corpus: experimental (cards capped at partial)
    expect(T1_TEMPLATES.filter((t) => t.status === 'experimental').map((t) => t.id).sort()).toEqual(['kw.typecycling.sliver']);
  });
  it.skipIf(localIndex() === null)('design 6.9, G10: each golden card of a T1 template parses WITH that template, and the golden abilities it produces are fully understood', () => {
    const opts = goldenOptions();
    let checked = 0;
    for (const t of T1_TEMPLATES) {
      for (const e of GOLDEN.filter(cites(t.id))) {
        const card = goldenCard(e.card);
        expect(card, `${e.card} is in the local index`).toBeDefined();
        const parsed = parseCard(card!, opts);
        expect(parsed.faces.flatMap((f) => f.templatesUsed), `${t.id}: ${e.card}`).toContain(t.id);
        // a ratchet per ability (`expect: "full"` covers the whole card, and some of these cards keep another ability, or another sentence, pending): the
        // golden ability is fully understood, or it is a partial one whose AUTOMATED part holds the template's output and agrees with the golden JSON
        const mine = e.faces.flatMap((f, fi) => f.abilities.filter((a) => JSON.stringify(a).includes(signature(t))).map((a) => ({ fi, a })));
        expect(mine.length, `${t.id}: ${e.card} has a golden ability with ${signature(t)}`).toBeGreaterThan(0);
        for (const { fi, a } of mine) {
          const defs = parsed.faces[fi]!.abilities;
          const full = defs.filter(understood).map(behavior).includes(behavior(a));
          const automatedPart = defs.filter(partial).map(maskedBehavior).some((m) => JSON.stringify(m).includes(signature(t)) && partialAgreesWith(m, a));
          expect(full || automatedPart, `${t.id}: ${e.card}: the ability with ${signature(t)} is automated and agrees with its golden JSON`).toBe(true);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(T1_TEMPLATES.filter((t) => t.status === 'stable' && NARROW[t.id] === undefined).length * 3 + Object.keys(NARROW).length);
  });
  it('a word of the critical list that a pattern spells out is listed in `consumes` (guard G3)', () => {
    for (const t of T1_TEMPLATES) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'twice']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('PUSH1 T1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T1_TEMPLATES) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(plain(f.abilities), e.text).toEqual(e.expect);
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
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `Don't ${body.charAt(0).toLowerCase()}${body.slice(1)}.`, `${body} this way.`];
  const swaps: [RegExp, string][] = [[/\btarget\b/, 'each'], [/\btarget\b/, 'up to one target'], [/\byou control\b/, 'an opponent controls'], [/\bthen\b/, 'then you may']];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by)}.`);
  return out;
}

describe('PUSH1 T1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T1_TEMPLATES) {
    it(`${t.id}: an appended "unless/instead/at random/twice/this way", a negation, a swapped determiner or controller never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          const f = parsedWith(t, m);
          expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('PUSH1 T1 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T1_TEMPLATES) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w)) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

/** Parenthesised reminder text removed (a keyword-action line is then often the bare action and its number), spaces collapsed. */
const withoutReminders = (text: string): string => text.replace(/\s*\([^()]*\)/g, '').replace(/[ \t]+/g, ' ').trim();

/** Every line of the Oracle texts of the local index, with the card's own name also written "~", each also without its reminder text. */
function oracleLines(): Set<string> {
  const lines = new Set<string>();
  for (const c of localIndex() ?? []) {
    for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
      if (typeof text !== 'string') continue;
      for (const whole of [text, withoutReminders(text)]) {
        lines.add(whole.trim());
        for (const l of whole.split('\n')) for (const v of [l, withoutReminders(l)]) { lines.add(v.trim()); lines.add(v.replaceAll(c.name, '~').trim()); }
      }
    }
  }
  return lines;
}

/** A sentence line of `text` that is a line of some card ("~" read as the name or "this <type>"). Bare keyword lines are rules terms, not card text. */
const verbatim = (lines: Set<string>, text: string): boolean =>
  text.split('\n').map((l) => l.trim()).filter((l) => l.endsWith('.')).some((l) => ['~', 'this creature', 'this artifact', 'this enchantment'].some((w) => lines.has(l.replaceAll('~', w))));

describe('PUSH1 T1 test data hygiene (design 6.10)', () => {
  it.skipIf(localIndex() === null)('no example and no sentence written in a test of this folder is the Oracle text, or a line of it, of any card in the local index', () => {
    const lines = oracleLines();
    // self-check: a keyword-action line is matched without its reminder text (a whole card's rules text, kept out of the source by building it here)
    expect(verbatim(lines, ['Bolster', '3.'].join(' ')), 'reminder text is ignored').toBe(true);
    for (const t of T1_TEMPLATES) for (const e of t.examples) expect(verbatim(lines, e.text), `${t.id}: ${e.text}`).toBe(false);
    const found: string[] = [];
    for (const f of readdirSync(TEST_DIR).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(join(TEST_DIR, f), 'utf8');
      for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) {
        const s = (m[1] ?? m[2] ?? '').replace(/\\(.)/g, '$1');
        if (/\s/.test(s) && /[.]$/.test(s) && /^[A-Z{~]/.test(s) && verbatim(lines, s)) found.push(`${f}: ${s}`);
      }
    }
    expect(found).toEqual([]);
  });
});
