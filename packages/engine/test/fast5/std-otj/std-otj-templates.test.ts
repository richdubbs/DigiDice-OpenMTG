/**
 * CLOUD std-otj (Outlaws of Thunder Junction Standard backlog, tuning half): the template data of parser/templates/zz-cloud/std-otj.json ("It gets an additional -1/-1 until
 * end of turn for each Desert you control", "Search your library for a card, then shuffle and put that card on top", "sacrifices / discards half ..., rounded up / down",
 * "Until end of turn, up to one target creature gets +2/+2 for each Treasure you control", "mills a card and loses 1 life", "Destroy target creature if no other creature has
 * greater power", "Put a land card from among the milled cards into your hand") and the parser / renderer readings they needed (parser/holes/qty.ts, player.ts, cond.ts;
 * parser/lower/conditions.ts, riders.ts; render/cond.ts, fold.ts, refs.ts; design 6.8 G6).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to
 * different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability (G2). Examples are synthetic
 * wordings (design 6.10); the real cards each template reads are checked against the local index when it is present, and each stable template has hand-verified golden
 * cards (test/m5/golden/cards/cloud-std-otj-review.json, design 6.9).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so these templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdOtj from '../../../src/parser/templates/zz-cloud/std-otj.json';
import review from '../../m5/golden/cards/cloud-std-otj-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const TEMPLATES = stdOtj as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is a spell's effect. */
const parsedWith = (text: string) => parseCard(card('Example Volley', 'Sorcery', text), OPTS).faces[0]!;

describe('std-otj template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-otj.json, path order: after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-otj.json');
    expect(files.indexOf('zz-cloud/std-otj.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-otj.json')).toBeLessThan(files.indexOf('zz-fast1/t4.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5)', () => {
    expect(TEMPLATES.length).toBe(10);
    for (const t of TEMPLATES) {
      expect(t.id, t.id).toMatch(/^eff\.stdotj\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence, hand-verified golden cards that name it (the two "rounded down" twins are read only by PARTIAL real cards, so their evidence is the try step below and the scenario tests)', () => {
    const golden = review as { card: string; verified: string }[];
    const partialOnly = new Set(['eff.stdotj.sacrifice.half.theirChoice.down', 'eff.stdotj.discard.half.hand.down']);
    for (const t of TEMPLATES.filter((x) => x.status === 'stable' && !partialOnly.has(x.id))) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(1);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of TEMPLATES) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'half']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('std-otj guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of TEMPLATES) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(fullyAutomated(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/rounded up/, 'rounded down'], [/rounded down/, 'rounded up'], [/half the/, 'all the'], [/Until end of turn/, 'Until your next turn'], [/until end of turn/, 'until your next turn'],
    [/ for each /, ' for each other '], [/greater power/, 'lesser power'], [/ destroy /i, ' exile '], [/ mills? /, ' exiles '], [/ lose[s]? /, ' gain '], [/ on top/, ' on the bottom'],
    [/from among the milled cards/, 'from among the exiled cards'], [/ an additional /, ' another '],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('std-otj guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of TEMPLATES) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-otj guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of TEMPLATES) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~,' || /^\{/.test(w)) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-otj design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it('no std-otj line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = TEMPLATES.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card's line is read by the named template and passes the exact render gate
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.stdotj.pump.additional.foreach': ["Desert's Due", 'Tribute to Urborg'],
    'eff.stdotj.search.anycard.top': ['Vampiric Tutor', 'Imperial Seal', 'Cruel Tutor', 'Insatiable Avarice'],
    'eff.stdotj.sacrifice.half.theirChoice.up': ['Rush of Dread'],
    'eff.stdotj.sacrifice.half.theirChoice.down': ['Lord Xander, the Collector'],
    'eff.stdotj.discard.half.hand.up': ['Rush of Dread'],
    'eff.stdotj.discard.half.hand.down': ['Lord Xander, the Collector'],
    'eff.stdotj.pump.foreach.scaled.lead': ['Gold Rush'],
    'eff.stdotj.mill.loselife': ['Tinybones Joins Up'],
    'eff.stdotj.destroy.ifGreatestPower': ['Getaway Glamer'],
    'eff.stdotj.milled.put.hand': ['Patient Naturalist'],
  };
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read a line with it and pass the render gate`, () => {
      for (const name of names) {
        const oracle = (index ?? []).find((c) => c.name === name);
        expect(oracle, name).toBeDefined();
        const parsed = parseCard(oracle!, OPTS);
        expect(parsed.faces.flatMap((f) => f.templatesUsed), name).toContain(id);
        expect(parsed.faces.every((f) => f.gate.every((g) => g.ok)), name).toBe(true);
        expect(compileCard(oracle!).faces.length, name).toBeGreaterThan(0);
      }
    }, 60_000);
  }
});
