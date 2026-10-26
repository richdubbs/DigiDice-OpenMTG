/**
 * Precon lane keywords-mana, round pc-keywords-mana-1: the template data of parser/templates/zz-cloud/pc-keywords-mana-1.json ("choose a color. add one mana of that
 * color for each <kind> counter on <object>") and the round's parser, lowering and renderer changes (a mixed list of card types and subtypes in a spending
 * restriction, "for each counter on ~", the land type "Urza's", "you control A and B", overload and the Junk token as data).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in pc-keywords-mana-1-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import pcKeywordsMana1 from '../../../src/parser/templates/zz-cloud/pc-keywords-mana-1.json';
import review from '../../m5/golden/cards/cloud-pc-keywords-mana-1-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = pcKeywordsMana1 as Template[];
const MECH_COUNT = 1;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.pckm1.mana.chooseColor.forEachCounter': ['Astral Cornucopia'], // the only card that prints the wording
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (an instant); the others are abilities of a creature (static, activated, triggered; "~ gains" needs a creature). */
const SPELL = new Set<string>();
// the examples are an artifact creature's abilities (the 2/2 Golem of `parsedWith`), a mana ability or an enters trigger
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Instant', text), OPTS) : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('pc-keywords-mana-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/pc-keywords-mana-1.json, after p2-zone-moves-1.json, before r3-choose.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/pc-keywords-mana-1.json');
    expect(files.indexOf('zz-cloud/pc-keywords-mana-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/p2-zone-moves-1.json'));
    expect(files.indexOf('zz-cloud/pc-keywords-mana-1.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.pckm1.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid)\.pckm1\./);
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

describe('pc-keywords-mana-1 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('pc-keywords-mana-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('pc-keywords-mana-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('pc-keywords-mana-1 design 6.10 (local index): synthetic examples', () => {
  it('no pc-keywords-mana-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
const same = (a: string, b: string): boolean => a === b;

describe('pc-keywords-mana-1 parser change: a list of card types and subtypes in a spending restriction (holes/spend.ts; CR 106.6, 205.2a)', () => {
  const ok = '{T}: Add {C}. Spend this mana only to cast sorcery, Elf, and Giant spells.';
  it('reads "sorcery, Elf, and Giant spells" as one any-of of the types and the subtypes', () => {
    const f = parseAbility('Land', ok);
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(bare(f.abilities))).toContain('"restriction":{"spells":{"anyOf":[{"types":["Sorcery"]},{"subtypes":["Elf","Giant"]}]}}');
  });
  it('near misses: cards instead of spells, one article, a list of two, or a count are not read as that restriction', () => {
    for (const m of [ok.replace('spells', 'cards'), ok.replace('cast sorcery', 'cast a sorcery'), ok.replace('sorcery, Elf, and Giant', 'sorcery and Elf').replace('anyOf', 'x'), ok.replace('spells.', 'spells this turn.')]) {
      const f = parseAbility('Land', m);
      expect(fullyAutomated(f) && JSON.stringify(bare(f.abilities)).includes('"anyOf":[{"types":["Sorcery"]},{"subtypes":["Elf","Giant"]}]'), m).toBe(false);
      expect(JSON.stringify(bare(f.abilities)).includes('"subtypes":["Elf","Giant"]'), m).toBe(false);
    }
  });
});

describe('pc-keywords-mana-1 parser change: "for each counter on ~" with no kind (holes/qty.ts; CR 122.1)', () => {
  it('counts the counters of every kind on the object', () => {
    const f = parseAbility('Artifact Creature — Golem', '{T}: Add {U} for each counter on ~.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(bare(f.abilities))).toContain('"q":"counters","on":{"ref":"self"},"kind":"any"');
  });
  it('near misses: no object, a counter in a zone, another player\'s counters are not that count', () => {
    for (const m of ['{T}: Add {U} for each counter.', '{T}: Add {U} for each counter in your graveyard.', '{T}: Add {U} for each counter on ~ this turn.']) {
      const f = parseAbility('Artifact Creature — Golem', m);
      expect(fullyAutomated(f) && JSON.stringify(bare(f.abilities)).includes('"kind":"any"'), m).toBe(false);
    }
  });
});

describe('pc-keywords-mana-1 parser change: the land type "Urza\'s" and "you control A and B" (holes/vocab.ts, holes/cond.ts, render/cond.ts; CR 205.3i, 608.2c)', () => {
  const ok = "{T}: Add {C}. If you control an Urza's Power-Plant and an Urza's Tower, add {C}{C} instead.";
  it("reads \"an Urza's Tower\" as a land with both subtypes, and the pair as two existences", () => {
    const f = parseAbility("Land — Urza's Mine", ok);
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const json = JSON.stringify(bare(f.abilities));
    expect(json).toContain('"cond":"all"');
    expect(json).toContain('"allSubtypes":["Urza\'s","Power-Plant"]');
    expect(json).toContain('"allSubtypes":["Urza\'s","Tower"]');
  });
  it('near misses: "or" is not "and", an opponent\'s lands are not yours, "don\'t control" is not read as the pair: none gives the pair of existences', () => {
    for (const m of [ok.replace('Power-Plant and an', 'Power-Plant or an'), ok.replace('If you control', 'If an opponent controls'), ok.replace('If you control', "If you don't control")]) {
      const f = parseAbility("Land — Urza's Mine", m);
      expect(JSON.stringify(bare(f.abilities)).includes('"cond":"all"'), m).toBe(false);
    }
    const o = parseAbility('Creature — Human', 'When ~ enters, if an opponent controls an artifact and an enchantment, you gain 1 life.');
    expect(JSON.stringify(bare(o.abilities)).includes('"cond":"all"')).toBe(false);
  });
  it('a fixed-wording conjunction elsewhere is untouched: "a Plains and a Swamp" is the same pair', () => {
    const f = parseAbility('Land', '{T}: Add {C}. If you control a Plains and a Swamp, add {C}{C} instead.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
  });
});

describe('pc-keywords-mana-1 engine data: overload and the Junk token', () => {
  it('overload is an implemented keyword with an alternative cost, and its capability is advertised', () => {
    expect(ENGINE_CAPABILITIES.has('keyword:overload')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:token.junk')).toBe(true);
  });
  it('a card with overload parses full: the spell is as printed and the keyword line is an automated keyword ability', () => {
    const f = parseAbility('Instant', 'Tap target creature you don\'t control.\nOverload {3}{U}');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(same(JSON.stringify(f.abilities.map((a) => a.kind)), JSON.stringify(['spell', 'keyword']))).toBe(true);
  });
});
