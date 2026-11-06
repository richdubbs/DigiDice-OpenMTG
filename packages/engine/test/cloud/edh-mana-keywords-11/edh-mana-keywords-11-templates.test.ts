/**
 * Commander lane edh-mana-keywords, round edh-mana-keywords-11: the template data of parser/templates/zz-cloud/edh-mana-keywords-11.json (a mana restriction to costs that contain {X}
 * (Elementalist's Palette); a counter that exiles the spell with time counters and gives it suspend (Delay); a random card exiled from a hand (Rona, Tolarian Obliterator)), and the
 * parser, renderer and engine changes of the round (one test each at the end). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact
 * render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never
 * leaves an automated card (G2). Examples are synthetic wordings (design 6.10). The behavior is in edh-mana-keywords-11-scenarios.test.ts. CR cites checked against the Comprehensive
 * Rules 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhMk11 from '../../../src/parser/templates/zz-cloud/edh-mana-keywords-11.json';
import review from '../../m5/golden/cards/edh-mana-keywords-11-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhMk11 as Template[];
const MECH_COUNT = 3;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one card, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT, owner instruction
 * 2026-10-21; the standing rule of 2026-10-27). Elementalist's Palette and Delay are held-out cards opened by the owner (commander request 2026-10-27); Rona is of the held-out half too.
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'rid.edhmk11.mana.costHasX': ["Elementalist's Palette"],
  'eff.edhmk11.counter.exileWithCounters.gainsSuspend': ['Delay'],
  'eff.edhmk11.exile.cardFromHand.atRandom': ['Rona, Herald of Invasion // Rona, Tolarian Obliterator'],
};
const NOT_PINNED: readonly string[] = [];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (a sorcery); the others are abilities of a creature (static, activated, triggered). */
const SPELL = new Set<string>(['eff.edhmk11.counter.exileWithCounters.gainsSuspend']);
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Instant', text), OPTS) : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-mana-keywords-11 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-mana-keywords-11.json, path order: after edh-mana-keywords-10, before edh-mana-keywords-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-mana-keywords-11.json');
    expect(files.indexOf('zz-cloud/edh-mana-keywords-11.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-mana-keywords-10.json'));
    expect(files.indexOf('zz-cloud/edh-mana-keywords-11.json')).toBeLessThan(files.indexOf('zz-cloud/edh-mana-keywords-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 11; ids are trg./rid./eff./sta./kw.edhmk11.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|trg)\.edhmk11\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(11);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) for (const n of NARROW[t.id]!) expect(cards, t.id).toContain(n);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review as { card: string; expect?: string }[]) {
      if (NOT_PINNED.includes(g.card)) expect(g.expect, g.card).toBeUndefined();
      else expect(g.expect, g.card).toBe('full');
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-mana-keywords-11 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
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

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [
    [/at random/, 'face down'], [/contain/, 'contained in'], [/three time/, 'three charge'], [/exile it with/, 'put it into its owner\'s hand with'], [/countered/, 'exiled'],
    [/gains suspend/, 'gains flying'], [/a card from their hand/, 'a card from their graveyard'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-mana-keywords-11 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/until end of turn" or a swapped key word never gives the example's JSON`, () => {
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

describe('edh-mana-keywords-11 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any word (CR 122.1): "a blorfty counter" is a counter kind, not nonsense
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-mana-keywords-11 design 6.10 (local index): synthetic examples', () => {
  it('no edh-mana-keywords-11 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

describe('edh-mana-keywords-11 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Artifact') => parseCard(card('Example Relic', type, text), OPTS).faces[0]!;
  it('model/cap-walk.ts, effects/handlers/zones-remove.ts (CR 701.6a, 122.1; Delay): a countered spell goes to exile with counters; counters on a destination other than exile are not registered, so the ability stays manual', () => {
    const ok = "Counter target spell. If the spell is countered this way, exile it with two time counters on it instead of putting it into its owner's graveyard. If it doesn't have suspend, it gains suspend.";
    expect(fullyAutomated(face(ok, 'Instant'))).toBe(true);
    expect(JSON.stringify(face(ok, 'Instant').abilities)).toMatch(/"to":\{[^}]*"zone":"exile"[^}]*"counters":\[\{"kind":"time","count":2\}\]|"to":\{"counters":\[\{"count":2,"kind":"time"\}\],"zone":"exile"\}|"to":\{"zone":"exile","counters":\[\{"kind":"time","count":2\}\]\}/);
    expect(fullyAutomated(face(ok.replace('exile it with two time counters on it', 'put it into its owner\'s hand with two time counters on it'), 'Instant'))).toBe(false);
    expect(fullyAutomated(face(ok.replace('Counter target spell', 'Counter target activated ability'), 'Instant'))).toBe(false);
  });
  it('rules/sources.ts#spendAllows, render/steps-cards.ts (CR 106.6, 107.3; Elementalist\'s Palette): "costs that contain {X}" is the only wording of the restriction; it is not read beside another restriction', () => {
    const base = '{T}: Add {R}{R}.';
    expect(fullyAutomated(face(`${base} Spend this mana only on costs that contain {X}.`))).toBe(true);
    expect(JSON.stringify(face(`${base} Spend this mana only on costs that contain {X}.`).abilities)).toContain('"restriction":{"costHasX":true}');
    expect(fullyAutomated(face(`${base} Spend this mana only on costs that contain {X} or to cast a creature spell.`))).toBe(false);
    expect(fullyAutomated(face(`${base} Spend this mana only to cast a creature spell. Spend this mana only on costs that contain {X}.`))).toBe(false);
  });
});
