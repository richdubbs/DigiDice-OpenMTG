/**
 * p2-pt-3 (Phase 2 lane p2-pt: power/toughness statics and pumps): the template data of parser/templates/zz-cloud/p2-pt-3.json ("<group> get <pt> for each <filter>
 * and have <abilities>", "all <filter> get <pt> as long as <cond>", "<attached> gets <pt> for each <qty>" and "... for each of its colors", "each <filter> gets <pt>
 * for each of its colors", "<group> get an additional <pt> as long as <cond>"), and the round's parser and renderer changes (tokens in a "that are" list, cards
 * your opponents own counted one by one, a group's "an additional" conditional pump).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in p2-pt-2-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2pt3 from '../../../src/parser/templates/zz-cloud/p2-pt-3.json';
import ownReview from '../../m5/golden/cards/p2-pt-3-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = p2pt3 as Template[];
const MECH_COUNT = 6;
const review = ownReview as { card: string; verified: string; expect?: string }[];
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only (tuning half), with their template tests (G9, G2) and played scenarios. Listed in the round's record (DECIDED BY DEFAULT, owner
 * instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, string>> = {
  'sta.p2pt3.group.pump.foreach.have': 'Hold the Gates',
  'sta.p2pt3.all.anthem.aslong': 'Nut Collector',
  'sta.p2pt3.attached.pump.foreach.qty': 'Blazing Sunsteel',
  'sta.p2pt3.attached.pump.foreach.itsColors': 'Civic Saber',
  'sta.p2pt3.each.pump.foreach.itsColors': 'Knight of New Alara',
  'sta.p2pt3.group.additional.aslong': 'Divine Sacrament',
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a creature's activated or triggered ability, an artifact's static, an instant's effect. */
const parsedWith = (t: Template, text: string) => {
  if (/^~ /.test(text)) return parseCard(card('Example Lurker', 'Creature — Horror', text, { power: '1', toughness: '1' }), OPTS).faces[0]!;
  if (/^Enchanted creature/.test(text)) return parseCard(card('Example Charm', 'Enchantment — Aura', `Enchant creature\n${text}`), OPTS).faces[0]!;
  if (/^Equipped creature/.test(text)) return parseCard(card('Example Gear', 'Artifact — Equipment', /\nEquip/.test(text) ? text : `${text}\nEquip {1}`), OPTS).faces[0]!;
  if (t.kind === 'static') return parseCard(card('Example Banner', 'Artifact', text), OPTS).faces[0]!;
  return parseCard(card('Example Rage', 'Instant', text), OPTS).faces[0]!;
};

describe('p2-pt-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it("is loaded by the default compiler (zz-cloud/p2-pt-3.json, after zz-cloud/look3.json, before zz-cloud/r3-*) and its ids are unique in the whole set", () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-pt-3.json');
    expect(files.indexOf('zz-cloud/p2-pt-3.json')).toBeGreaterThan(files.indexOf('zz-cloud/look3.json'));
    expect(files.indexOf('zz-cloud/p2-pt-3.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are (eff|sta).p2pt3.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.p2pt3\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = review.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) expect(cards, t.id).toContain(NARROW[t.id]);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review) expect(g.expect, g.card).toBe('full');
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

describe('p2-pt-3 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\bhave\b/, 'lose'], [/\bother\b/, 'nonland'], [/\bits colors\b/, "~'s colors"], [/\bopponent you have\b/, 'opponent you control'], [/\bas long as\b/, 'unless'],
    [/\byou control\b/, 'an opponent controls'], [/\+1\/\+1/, '+1/+0'], [/\+1\/\+0/, '+0/+1'], [/\+2\/\+0/, '+2/+2'], [/\+0\/\+1/, '+1/+1'], [/\ban additional\b/, 'a second'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-pt-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
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

describe('p2-pt-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
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

describe.skipIf(index === null)('p2-pt-3 design 6.10 (local index): synthetic examples', () => {
  it('no p2-pt-3 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

const json = (v: unknown): string => JSON.stringify(v);

describe('p2-pt-3 parser (CR 111.1): tokens in a "that are" list of kinds', () => {
  it('"creatures you control that are Zombies and/or tokens" is either kind', () => {
    const f = parseCard(card('Example Banner', 'Enchantment', 'Creatures you control that are Spirits and/or tokens get +1/+0 and have menace.'), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f.abilities)).toContain('{"token":true}');
  });
});

describe('p2-pt-3 renderer (CR 102.3, 404.1, 406.1, 613.4c; family opponents-own-for-each): cards your opponents own, counted one by one', () => {
  it('"for each card your opponents own in exile" and "for each creature card in your opponents\' graveyards" pass the gate', () => {
    for (const text of ['~ gets +1/+0 for each card your opponents own in exile.', "~ gets +0/+1 for each artifact card in your opponents' graveyards."]) {
      const f = parseCard(card('Example Lurker', 'Creature — Horror', text, { power: '1', toughness: '1' }), OPTS).faces[0]!;
      expect(fullyAutomated(f), text).toBe(true);
      expect(json(f.abilities), text).toContain('"owner":"opponent"');
    }
  });
});

describe('p2-pt-3 renderer (CR 613.4c, 611.3a; family additional-pump-static-group): a group\'s conditional pump said with "an additional"', () => {
  it('"Green creatures get an additional +1/+1 as long as you control a Forest" passes the gate; "a second +1/+1" does not', () => {
    const ok = parseCard(card('Example Banner', 'Enchantment', 'Green creatures get an additional +1/+1 as long as you control a Forest.'), OPTS).faces[0]!;
    expect(fullyAutomated(ok)).toBe(true);
    const no = parseCard(card('Example Banner', 'Enchantment', 'Green creatures get a second +1/+1 as long as you control a Forest.'), OPTS).faces[0]!;
    expect(fullyAutomated(no)).toBe(false);
  });
});
