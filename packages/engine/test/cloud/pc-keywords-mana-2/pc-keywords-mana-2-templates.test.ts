/**
 * Precon lane keywords-mana, round pc-keywords-mana-2: the template data of parser/templates/zz-cloud/pc-keywords-mana-2.json (a scry trigger carried by mana, "add one
 * mana of any color for each <quantity>", a +1/+1 counter rider on mana spent on a creature spell) and the round's parser, lowering and renderer changes.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in pc-keywords-mana-2-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import pcKeywordsMana2 from '../../../src/parser/templates/zz-cloud/pc-keywords-mana-2.json';
import review from '../../m5/golden/cards/cloud-pc-keywords-mana-2-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = pcKeywordsMana2 as Template[];
const MECH_COUNT = 5;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'rid.pckm2.mana.whenSpent.scry': ['Path of Ancestry'], // the only card that prints the wording
  'eff.pckm2.mana.anyColor.forEach': ['Coalition Relic'], // the only card that prints the wording
  'rid.pckm2.mana.spent.creature.entersWith': ['Biophagus'], // the only card that prints the wording
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (an instant); the others are abilities of a creature (static, activated, triggered; "~ gains" needs a creature). */
const SPELL = new Set<string>();
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Instant', text), OPTS) : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('pc-keywords-mana-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/pc-keywords-mana-2.json, after p2-zone-moves-1.json, before r3-choose.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/pc-keywords-mana-2.json');
    expect(files.indexOf('zz-cloud/pc-keywords-mana-2.json')).toBeGreaterThan(files.indexOf('zz-cloud/p2-zone-moves-1.json'));
    expect(files.indexOf('zz-cloud/pc-keywords-mana-2.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.pckm2.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid)\.pckm2\./);
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

describe('pc-keywords-mana-2 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('pc-keywords-mana-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('pc-keywords-mana-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('pc-keywords-mana-2 design 6.10 (local index): synthetic examples', () => {
  it('no pc-keywords-mana-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('pc-keywords-mana-2 parser change: "shares a creature type with your commander" (holes/filter.ts; CR 903.3d, 205.3m)', () => {
  const ok = 'Whenever you cast a creature spell that shares a creature type with your commander, you gain 1 life.';
  it('reads the commanders you own, wherever they are, as the set the spell is compared with', () => {
    const f = parseAbility('Enchantment', ok);
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const json = JSON.stringify(bare(f.abilities));
    expect(json).toContain('"sharesWith":{"with":{"ref":"each","filter":{"commander":true,"owner":"you","zone":["battlefield","command"');
    expect(json).toContain('"quality":"creatureType"');
  });
  it('near misses: an opponent\'s commander, "a commander", another quality or "without" are not that reading', () => {
    for (const m of [ok.replace('your commander', "an opponent's commander"), ok.replace('your commander', 'a commander'), ok.replace('creature type', 'color'), ok.replace('shares', 'does not share')]) {
      const f = parseAbility('Enchantment', m);
      const json = JSON.stringify(bare(f.abilities));
      expect(fullyAutomated(f) && json.includes('"sharesWith":{"with":{"ref":"each","filter":{"commander":true,"owner":"you"') && json.includes('"quality":"creatureType"') && !json.includes('"not":{"sharesWith"'), m).toBe(false);
    }
  });
});

describe('pc-keywords-mana-2 parser change: a mana production replaced by another ("add two mana of any one color instead"; lower/ability.ts, render/self-replacement.ts; CR 614.15)', () => {
  const ok = '{T}: Add one mana of any color. If you control a creature with power 4 or greater, add two mana of any one color instead.';
  it('is the if/else of two productions in one mana ability', () => {
    const f = parseAbility('Creature — Plant', ok);
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const json = JSON.stringify(bare(f.abilities));
    expect(json).toContain('"isMana":true');
    expect(json).toContain('"dynamic":{"kind":"anyOneColor","count":2}');
  });
  it('near misses: a different player, a restriction on one production, a loss of life are not the fold', () => {
    for (const m of [ok.replace('add two mana of any one color instead', 'each opponent adds two mana of any one color instead'), ok.replace('instead', 'instead. You lose 1 life'), ok.replace('add two mana', 'draw two cards')]) {
      const f = parseAbility('Creature — Plant', m);
      expect(fullyAutomated(f) && JSON.stringify(bare(f.abilities)).includes('"isMana":true') && JSON.stringify(bare(f.abilities)).includes('"dynamic":{"kind":"anyOneColor","count":2}'), m).toBe(false);
    }
  });
});

describe('pc-keywords-mana-2 engine data: the capabilities of the mana riders', () => {
  it('the counter rider on mana spent is advertised', () => {
    expect(ENGINE_CAPABILITIES.has('feature:mana.spentRider.entersWith')).toBe(true);
  });
});
