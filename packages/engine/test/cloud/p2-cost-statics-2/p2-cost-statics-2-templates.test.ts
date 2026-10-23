/**
 * Phase 2 lane p2-cost-statics, round p2-cost-statics-2: the template data of parser/templates/zz-cloud/p2-cost-statics-2.json (cost changes by what a spell or an
 * ability targets, CR 601.2c, 601.2f, 602.2b, 115.9b: "spells your opponents cast that target a <description> cost {M} more", "... one or more <description>",
 * "spells you cast/control that target a <description> cost {M} less", "abilities your opponents activate that target a <description> cost {M} more", and the
 * creature the source enchants, CR 303.4) and the round's engine and renderer changes: statics/costmods.ts#spellTargetsSource reads a filter of the spell's
 * targets (capability feature:costMod.spellTargets.each) and a change by the ability's targets never applies to a mana ability (CR 605.1a).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in p2-cost-statics-2-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2cst2 from '../../../src/parser/templates/zz-cloud/p2-cost-statics-2.json';
import review from '../../m5/golden/cards/p2-cost-statics-2-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = p2cst2 as Template[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one or two cards of the tuning half, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'cm.p2cst2.spells.more.opp.targetFilter': ['Kasmina, Enigmatic Mentor', 'Kopala, Warden of Waves'],
  'cm.p2cst2.spells.more.opp.targetOneOrMore': ['Esior, Wardwing Familiar'],
  'cm.p2cst2.spells.less.you.targetFilter': ['The Destined'],
  'cm.p2cst2.abilities.more.opp.targetFilter': ['Kopala, Warden of Waves'],
  'cm.p2cst2.spells.less.you.targetEnchanted': ['Strong Back'],
  'cm.p2cst2.keywordAbilities.less.you.targetEnchanted': ['Strong Back'],
};
/** Templates kept experimental (none: each has its golden evidence). */
const EXPERIMENTAL: readonly string[] = [];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

const parsedWith = (_t: Template, text: string) => (text.startsWith('Enchant creature') ? parseCard(card('Example Ledger', 'Enchantment — Aura', text), OPTS) : parseCard(card('Example Ledger', 'Creature — Snake', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;
const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Monk', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');
const steps = (f: ReturnType<typeof face>): string => JSON.stringify(f.abilities);

describe('p2-cost-statics-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-cost-statics-2.json, after zz-cloud/p2-copy-perm-1.json, before zz-cloud/p2-counters-state-1.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-cost-statics-2.json');
    expect(files.indexOf('zz-cloud/p2-cost-statics-2.json')).toBeGreaterThan(files.indexOf('zz-cloud/p2-copy-perm-1.json'));
    expect(files.indexOf('zz-cloud/p2-cost-statics-2.json')).toBeLessThan(files.indexOf('zz-cloud/p2-counters-state-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are cm.p2cst2.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^cm\.p2cst2\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.status, t.id).toBe(EXPERIMENTAL.includes(t.id) ? 'experimental' : 'stable');
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one or two cards that print the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    const ids = MECH.filter((x) => x.status === 'stable').map((t) => t.id);
    for (const id of ids) {
      const cards = golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`) || g.verified.includes(`${id})`)).map((g) => g.card);
      if (NARROW[id] !== undefined) for (const c of NARROW[id]!) expect(cards, id).toContain(c);
      else expect(cards.length, id).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'twice', 'no']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('p2-cost-statics-2 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const out = [`${body} unless it is blue.`, `${body} at random.`, `${body} if able.`, `${body} during combat.`];
  const swaps: [RegExp, string][] = [[/\bless\b/, 'more'], [/\bmore\b/, 'less'], [/\byour opponents\b/, 'you'], [/\byou cast\b/, 'your opponents cast'], [/\benchanted\b/, 'equipped'],
    [/\bcast\b/, 'activate'], [/\bone or more\b/, 'two or more'], [/\byou control\b/, 'an opponent controls']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-cost-statics-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/at random/if able/during combat" or a swapped key word never gives the example's JSON`, () => {
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

describe('p2-cost-statics-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~,' || w === '~.' || /^\{/.test(w)) return;
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('p2-cost-statics-2 design 6.10 (local index): synthetic examples', () => {
  it('no p2-cost-statics-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => l.trim() !== 'Enchant creature' && lines.has(l.trim()))) /* an Aura's rules line is no wording of the template */.map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

// ---- the round's engine changes ------------------------------------------------------------------------------------------------------------------------

describe('p2-cost-statics-2 engine capabilities (CR 115.9b, 601.2f)', () => {
  it('a filter of the spell\'s targets in a cost modifier is registered', () => {
    expect(ENGINE_CAPABILITIES.has('feature:costMod.spellTargets.each')).toBe(true);
  });
  it('fails closed: a spell that targets a player of a description is not read', () => {
    const f = face('Creature — Snake', 'Spells your opponents cast that target a player cost {1} more to cast.', ['2', '2']);
    expect(fullFace(f)).toBe(false);
  });
});
