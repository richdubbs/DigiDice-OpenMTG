/**
 * Precon lane keywords-mana, round pc-keywords-mana-3: the template data of parser/templates/zz-cloud/pc-keywords-mana-3.json ("<player> faces a villainous choice --
 * <option>, or <option>", CR 701.55) and the round's parser, engine and renderer changes (the `villainous` flag of the `may` step, "that player" inside the iteration
 * of "each opponent"). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does
 * not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2).
 * Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in pc-keywords-mana-3-scenarios.test.ts. CR
 * cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import pcKeywordsMana3 from '../../../src/parser/templates/zz-cloud/pc-keywords-mana-3.json';
import review from '../../m5/golden/cards/cloud-pc-keywords-mana-3-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = pcKeywordsMana3 as Template[];
const MECH_COUNT = 3;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.pckm3.villainousChoice': ['Great Intelligence\'s Plan'], // the only card of the set that faces one targeted opponent with options this build reads
  'eff.pckm3.villainousChoice.eachOpponentLostLife': ['Davros, Dalek Creator'], // the only card that prints the wording
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (an instant); the others are abilities of a creature (static, activated, triggered; "~ gains" needs a creature). */
const SPELL = new Set<string>(['eff.pckm3.villainousChoice', 'eff.pckm3.villainousChoice.eachOpponent', 'eff.pckm3.villainousChoice.eachOpponentLostLife']);
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Instant', text), OPTS) : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('pc-keywords-mana-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/pc-keywords-mana-3.json, after p2-zone-moves-1.json, before r3-choose.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/pc-keywords-mana-3.json');
    expect(files.indexOf('zz-cloud/pc-keywords-mana-3.json')).toBeGreaterThan(files.indexOf('zz-cloud/p2-zone-moves-1.json'));
    expect(files.indexOf('zz-cloud/pc-keywords-mana-3.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.pckm3.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid)\.pckm3\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) for (const n of NARROW[t.id]!) expect(cards, t.id).toContain(n);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
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

describe('pc-keywords-mana-3 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bremoved this way\b/, 'put this way'], [/\bfor each\b/, 'for every two'], [/\ban additional\b/, 'two additional'], [/\bany number of\b/, 'all'],
    [/\bany type\b/, 'any color'], [/\bany color\b/, 'any type'], [/\bcould produce\b/, 'produced'], [/\bland produced\b/, 'creature produced'],
    [/\byou control\b/, 'an opponent controls'], [/\ban opponent controls\b/, 'you control'], [/\bone mana\b/, 'two mana'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('pc-keywords-mana-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('pc-keywords-mana-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('pc-keywords-mana-3 design 6.10 (local index): synthetic examples', () => {
  it('no pc-keywords-mana-3 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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



/** The parse of one card text under the default compiler's options. */
const parseAbility = (type: string, text: string) => parseCard(card('Example Plan', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : {}), OPTS).faces[0]!;

describe('pc-keywords-mana-3 parser and engine data: a villainous choice is a `may` of two options, made by the player who faces it', () => {
  const ok = 'At the beginning of combat on your turn, each opponent faces a villainous choice -- That player sacrifices a creature, or you draw a card.';
  it('inside a trigger, "that player" is the opponent of the iteration (not the other player the ability mentions)', () => {
    const f = parseAbility('Creature — Human', ok);
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const json = JSON.stringify(bare(f.abilities));
    expect(json).toContain('"villainous":true');
    expect(json).toContain('"op":"sacrificeChoice","who":{"ref":"bound","name":"each"}');
  });
  it('near misses: one option, "each player", an unrelated header word are not a villainous choice', () => {
    for (const m of [ok.replace(', or you draw a card', ''), ok.replace('each opponent', 'each player'), ok.replace('villainous choice', 'tough choice'), ok.replace(' -- ', ' ')]) {
      const f = parseAbility('Creature — Human', m);
      expect(fullyAutomated(f) && JSON.stringify(bare(f.abilities)).includes('"villainous":true'), m).toBe(false);
    }
  });
});
