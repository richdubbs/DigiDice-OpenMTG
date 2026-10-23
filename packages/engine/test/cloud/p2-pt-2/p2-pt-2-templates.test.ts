/**
 * p2-pt-2 (Phase 2 lane p2-pt: power/toughness statics and pumps): the template data of parser/templates/zz-cloud/p2-pt-2.json ("each <filter> gets <pt> and has
 * <abilities>", "all <group> get <pt> for each other <filter>" and "each <filter> gets <pt> for each other <filter>" counted for each object modified, "<attached>
 * gets <pt> for each Equipment/Aura attached to it", "each <filter> gets <pt> for each Equipment attached to it / <kind> counter on it", "<dur>, <obj> gains <a> and
 * gets <pt> for each <qty>", "<dur>, <objs> get <pt> for each <filter> and gain <a>"), and the round's parser and renderer changes (five kinds after "that's a", a
 * one-option `anyOf` read as its fields, "other" for the object modified, the grant said before a counted change).
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
import p2pt2 from '../../../src/parser/templates/zz-cloud/p2-pt-2.json';
import ownReview from '../../m5/golden/cards/p2-pt-2-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = p2pt2 as Template[];
const MECH_COUNT = 9;
const review = ownReview as { card: string; verified: string; expect?: string }[];
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only (tuning half), with their template tests (G9, G2) and played scenarios. Listed in the round's record (DECIDED BY DEFAULT, owner
 * instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, string>> = {
  'sta.p2pt2.all.pump.foreach.otherThanSubject': 'Sliver Legion',
  'sta.p2pt2.each.pump.foreach.otherThanSubject': "Heroes' Podium",
  'sta.p2pt2.attached.pump.foreach.equipment.attached': 'Golem-Skin Gauntlets',
  'sta.p2pt2.enchanted.pump.foreach.aura.attached.has': "Auramancer's Guise",
  'sta.p2pt2.each.pump.foreach.counter.onIt': 'Clamavus',
  'eff.p2pt2.dur.gains.and.gets.foreach.qty': 'Fists of Flame',
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a creature's activated or triggered ability, an artifact's static, an instant's effect. */
const parsedWith = (t: Template, text: string) => {
  if (/^Enchanted creature/.test(text)) return parseCard(card('Example Charm', 'Enchantment — Aura', `Enchant creature\n${text}`), OPTS).faces[0]!;
  if (/^Equipped creature/.test(text)) return parseCard(card('Example Gear', 'Artifact — Equipment', /\nEquip/.test(text) ? text : `${text}\nEquip {1}`), OPTS).faces[0]!;
  if (t.kind === 'static') return parseCard(card('Example Banner', 'Artifact', text), OPTS).faces[0]!;
  return parseCard(card('Example Rage', 'Instant', text), OPTS).faces[0]!;
};

describe('p2-pt-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it("is loaded by the default compiler (zz-cloud/p2-pt-2.json, after zz-cloud/look3.json, before zz-cloud/r3-*) and its ids are unique in the whole set", () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-pt-2.json');
    expect(files.indexOf('zz-cloud/p2-pt-2.json')).toBeGreaterThan(files.indexOf('zz-cloud/look3.json'));
    expect(files.indexOf('zz-cloud/p2-pt-2.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are (eff|sta).p2pt2.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.p2pt2\./);
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

describe('p2-pt-2 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bhas\b/, 'loses'], [/\bgains\b/, 'loses'], [/\bgain\b/, 'lose'], [/\bother\b/, 'nonland'], [/\bEquipment attached\b/, 'Aura attached'], [/\bAura attached\b/, 'Equipment attached'],
    [/\bon it\b/, 'on ~'], [/\battached to it\b/, 'attached to ~'], [/\byou control\b/, 'an opponent controls'], [/\+1\/\+1/, '+1/+0'], [/\+1\/\+0/, '+0/+1'], [/\+2\/\+0/, '+2/+2'],
    [/\bUntil end of turn\b/, 'Until your next turn'], [/\bthis turn\b/, 'this game'], [/\bor a Bat\b/, 'and a Bat'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-pt-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('p2-pt-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('p2-pt-2 design 6.10 (local index): synthetic examples', () => {
  it('no p2-pt-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('p2-pt-2 parser (CR 205.3m): "that\'s a" with up to five kinds after one article', () => {
  it('"each other creature you control that\'s a Fox, Otter, Rabbit, Mouse, or Bird" is the five subtypes', () => {
    const f = parseCard(card('Example Banner', 'Artifact', "Each other creature you control that's a Fox, Otter, Rabbit, Mouse, or Bird gets +1/+0 and has first strike."), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(true);
    for (const s of ['Fox', 'Otter', 'Rabbit', 'Mouse', 'Bird']) expect(json(f.abilities)).toContain(`{"subtypes":["${s}"]}`);
  });
  it('six kinds are not read (the list stops at five)', () => {
    const f = parseCard(card('Example Banner', 'Artifact', "Each other creature you control that's a Fox, Otter, Rabbit, Mouse, Bird, or Bat gets +1/+0 and has first strike."), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(false);
  });
});

describe('p2-pt-2 lowering and renderer (CR 109.4, 613.4c): "other" in a count read for each object modified', () => {
  it('"each legendary creature you control gets +1/+1 for each other legendary creature you control" excludes the object modified, not ~', () => {
    const f = parseCard(card('Example Banner', 'Artifact', 'Each legendary creature you control gets +1/+1 for each other legendary creature you control.'), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f.abilities)).toContain('"not":{"is":{"ref":"subject"}}');
    expect(json(f.abilities)).not.toContain('"other":true');
  });
  it('the existing reading of "<group> get +1/+1 for each other <filter>" (other than ~, sta.r3static.anthem.foreach) is unchanged', () => {
    const f = parseCard(card('Example Banner', 'Artifact', 'Elves you control get +1/+1 for each other Elf you control.'), OPTS).faces[0]!;
    expect(json(f.abilities)).not.toContain('"ref":"subject"');
  });
});

describe('p2-pt-2 renderer (CR 611.2a, 613.1f, 613.4c; family grant-then-pump-for-each): the grant said before a counted change', () => {
  it('"Until end of turn, target creature gains trample and gets +1/+0 for each card you\'ve drawn this turn" passes the gate', () => {
    const f = parseCard(card('Example Rage', 'Instant', "Until end of turn, target creature gains trample and gets +1/+0 for each card you've drawn this turn."), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(true);
  });
  it('a static ability keeps its own order only (no grant-first reading there)', () => {
    const f = parseCard(card('Example Charm', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature has trample and gets +1/+0 for each Forest you control.'), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(false);
  });
});
