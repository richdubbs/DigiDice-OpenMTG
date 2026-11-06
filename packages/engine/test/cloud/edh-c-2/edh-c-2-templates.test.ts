/**
 * Commander lane edh-c, round edh-c-2: the template data of parser/templates/zz-cloud/edh-c-2.json (three statics: a leading "as long as" for an anthem that also grants, for a cost reduction, and "all <group> are <color>") with guards G9 and G2
 * (design 6.8); behavior in edh-c-2-scenarios.test.ts. Narrow wordings (design 6.9 deviation): each printed by one card of the EDHREC top 20,000 only. CR cites are from the Comprehensive Rules text of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC2 from '../../../src/parser/templates/zz-cloud/edh-c-2.json';
import reviewC2 from '../../m5/golden/cards/edh-c-2-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC2 as Template[];
const review = reviewC2 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 3;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 20,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'sta.edhv2.aslong.anthem.pumpgrant': ['Raksha Golden Cub'],
  'cm.edhv2.spells.less.you.asLongAsFirst': ['Centaur Omenreader'],
  'sta.edhv2.all.areColor': ['Darkest Hour'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(t.kind === 'static' ? card('Example Plan', 'Enchantment', text) : /^\{/.test(text) ? card('Example Plan', 'Artifact', text) : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-c-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-2.json, path order: edh-c-2 sorts before edh-cast-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-2.json');
    expect(files.indexOf('zz-cloud/edh-c-2.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 10; ids are *.edhv2.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhv2\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the cards that print the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) for (const n of NARROW[t.id]!) expect(cards, t.id).toContain(n);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
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

describe('edh-c-2 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bmay get\b/, 'get'], [/\btwo rad\b/, 'three rad'], [/\bDuring your turn\b/, 'During their turn'], [/\btoughness rather than its power\b/, 'power rather than its toughness'],
    [/\bpays \{X\}\b/, 'pays {1}'], [/\bcounters on that creature\b/, 'cards in your hand'], [/\bplaneswalkers you control\b/, 'planeswalkers'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-c-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-2 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


/** The readings that are not templates: one test each (hole, lowering and renderer changes of the round), played as synthetic cards (design 6.10). */
const READINGS: { name: string; type: string; text: string; extra?: Partial<OracleCard> }[] = [
  // render/mods.ts: a keyword after the noun is said after "on the battlefield" too (family on-the-battlefield)
  { name: 'count with a keyword after on the battlefield', type: 'Creature — Wizard', text: "~'s power is equal to the number of creatures on the battlefield with shadow.", extra: { power: '*', toughness: '2' } },
  // render/evt.ts: "another creature" is "a creature other than ~" as an event subject
  { name: 'creature other than self exiled', type: 'Creature — Pilot', text: 'Whenever a creature other than ~ is exiled from the battlefield, you gain life equal to its power.', extra: { power: '2', toughness: '2' } },
  // render/cond.ts: an opponent's draws in the past tense
  { name: 'trap with the past tense', type: 'Instant — Trap', text: "If an opponent drew four or more cards this turn, you may pay {R} rather than pay this spell's mana cost.\nDraw a card." },
  // parser/holes/p2rd2.ts: the object itself as the source of a damage replacement
  { name: 'self doubles combat damage to a player', type: 'Creature — Beast', text: 'If ~ would deal combat damage to a player, it deals double that damage to that player instead.', extra: { power: '3', toughness: '3' } },
  // parser/holes/token.ts + render/steps-zones.ts: three colors with commas, before or after the noun
  { name: 'three colors after the noun', type: 'Sorcery', text: "Create a 5/5 Beast creature token that's red, green, and white." },
  { name: 'three colors before the noun', type: 'Sorcery', text: 'Create a 5/5 red, green, and white Beast creature token.' },
  { name: 'two colors after the noun', type: 'Sorcery', text: "Create a 2/2 Soldier creature token that's red and white." },
  // parser/holes/qty.ts: "for each <kind> counter on ~"
  { name: 'for each lore counter', type: 'Artifact', text: '{T}: Target creature you control gets +1/+1 until end of turn for each lore counter on ~.' },
  // parser/holes/cond.ts + render/cond.ts: domain against a number
  { name: 'three basic land types', type: 'Sorcery', text: 'Draw a card. Then if there are three or more basic land types among lands you control, scry 1.' },
];
describe('edh-c-2 readings (hole, lowering and renderer changes): synthetic cards are fully automated and pass the render gate', () => {
  for (const r of READINGS) {
    it(r.name, () => {
      const f = parseCard(card('Example Plan', r.type, r.text, r.extra), OPTS).faces[0]!;
      expect(fullyAutomated(f), `${JSON.stringify(f.diagnostics)}`).toBe(true);
      expect(f.gate.every((g) => g.ok), JSON.stringify(f.gate)).toBe(true);
    });
  }
  it('negatives: four colors in the wrong shape, a word that is no color, and a counter word that is no kind still fail closed', () => {
    for (const text of [
      "Create a 5/5 Beast creature token that's red, green, and sparkly.",
      "Create a 5/5 Beast creature token that's red, red, and white.",
      'If ~ would deal combat damage to a player, it deals double that damage to that creature instead.',
      'If there are three or more basic land types among creatures you control, scry 1.',
      'If there are three or more basic land types among lands you control, scry 1 twice.',
    ]) {
      const t = text.startsWith('Create') || text.startsWith('If there') ? 'Sorcery' : 'Creature — Beast';
      expect(fullyAutomated(parseCard(card('Example Plan', t, text, t === 'Creature — Beast' ? ({ power: '3', toughness: '3' } as Partial<OracleCard>) : undefined), OPTS).faces[0]!), text).toBe(false);
    }
  });
});
