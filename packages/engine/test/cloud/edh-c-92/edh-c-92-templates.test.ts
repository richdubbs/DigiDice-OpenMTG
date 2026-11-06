/**
 * Commander effort (coordinator C), round edh-c-92: the template data of parser/templates/zz-cloud/edh-c-92.json (the readings listed in the file) with guards G9 and G2
 * (design 6.8); behavior in edh-c-92-scenarios.test.ts. Narrow wordings (design 6.9 deviation): each printed by one card of EDHREC ranks 19,001-19,500 and the cards beside them only. CR cites are from the Comprehensive Rules text of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC92 from '../../../src/parser/templates/zz-cloud/edh-c-92.json';
import reviewC92 from '../../m5/golden/cards/edh-c-92-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC92 as Template[];
const review = reviewC92 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 8;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'sta.edhv92.attached.has.cantBeBlockedExcept': ['Cloak of Invisibility'],
  'sta.edhv92.attached.basePower.hasQuoted': ['Withercrown'],
  'eff.edhv92.eachOpponent.may.returnGraveyard.bf': ['Enslaved Horror'],
  'sta.edhv92.you.protection.chosenCardName': ['Runed Halo'],
  'kw.edhv92.goblinOffering': ['Patron of the Akki'],
  'kw.edhv92.foxOffering': ['Patron of the Kitsune'],
  'kw.edhv92.moonfolkOffering': ['Patron of the Moon'],
  'kw.edhv92.snakeOffering': ['Patron of the Orochi'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(t.kind === 'ability' ? card('Example Plan', 'Legendary Creature — Spirit', text, { power: '3', toughness: '3' } as Partial<OracleCard>) : t.kind === 'static' ? card('Example Plan', 'Enchantment', text) : /^\{/.test(text) ? card('Example Plan', 'Artifact', text) : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-c-92 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-92.json, path order: edh-c-9.json, then edh-c-92.json, before edh-cast-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-92.json');
    expect(files.indexOf('zz-cloud/edh-c-92.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-c-9.json'));
    expect(files.indexOf('zz-cloud/edh-c-92.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhv92.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|rst|kw)\.edhv92\./);
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

describe('edh-c-92 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-c-92 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-92 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-92 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-92 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // design 6.10 deviation (record): the wording "You have protection from the chosen card name." is printed by one card only and has no alternation to hide a synthetic example behind: its own line, and the common line "As ~ enters, choose a nonland card name.", are the only possible ones
    const OWN_LINES = new Set(['You have protection from the chosen card name.', 'As ~ enters, choose a nonland card name.']);
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !OWN_LINES.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});


describe('edh-c-92 parser, lowering and renderer changes', () => {
  const face = (name: string, type: string, text: string) => parseCard(card(name, type, text, type.includes('Creature') ? ({ power: '2', toughness: '2' } as Partial<OracleCard>) : undefined), OPTS).faces[0]!;
  it('parse.ts#namedComboPieces (CR 201.2, 602.2b): the card\'s own name with a comma after "named" is one name, so the cost is not split at the comma (Baru, Fist of Krosa)', () => {
    const f = face('Example Baru, Fist of Tests', 'Legendary Creature — Druid', 'Grandeur — Discard another card named Example Baru, Fist of Tests: Create an X/X green Wurm creature token, where X is the number of lands you control.');
    expect(fullyAutomated(f)).toBe(true);
    expect(f.gate.every((g) => g.ok)).toBe(true);
  });
  it('negative: a comma name that is not the card\'s own keeps the old reading (fail closed: the cost stays partial)', () => {
    const level = (name: string, other: string): string => compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Creature — Druid', oracle_text: `Grandeur — Discard another card named ${other}: Create an X/X green Wurm creature token, where X is the number of lands you control.`, colors: [], power: '2', toughness: '2' } as OracleCard).automation.level;
    expect(level('Example Baru, Fist of Tests', 'Example Baru, Fist of Tests')).toBe('full');
    expect(level('Example Baru, Fist of Tests', 'Example Other, Hero of Tests')).not.toBe('full');
  });
  it('negative (G10, found by the whole-index run): a comma-name card that also creates a token named with a comma keeps the old reading and stays full (Ozox, the Clattering King)', () => {
    const text = 'This creature can\'t block.\nWhen this creature dies, create Jumblebones, a legendary 2/1 black Skeleton creature token with "Jumblebones can\'t block" and "When Jumblebones leaves the battlefield, return target card named Ozox, the Clattering King from your graveyard to your hand."';
    expect(compileCard({ name: 'Ozox, the Clattering King', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Creature — Skeleton', oracle_text: text, colors: [], power: '3', toughness: '3' } as OracleCard).automation.level).toBe('full');
  });
  it('kw.ts + keywords/data/offering.json + front/lexicon-index.ts (CR 702.48a): the creature-type offerings render as printed and expand to a sacrifice of that type', () => {
    for (const q of ['Goblin', 'Fox', 'Moonfolk', 'Snake']) {
      const f = face(`Example ${q} Patron`, 'Legendary Creature — Spirit', `${q} offering\nFlying`);
      expect(fullyAutomated(f), q).toBe(true);
      expect(JSON.stringify(f.abilities)).toContain(`"quality":"${q}"`);
    }
  });
  it('negative: another creature type, a plain "offering", and an offering with a cost stay manual', () => {
    for (const bad of ['Elf offering\nFlying', 'Offering\nFlying', 'Fox offering {1}\nFlying', 'Rat offering\nFlying']) {
      expect(fullyAutomated(face('Example Patron', 'Legendary Creature — Spirit', bad)), bad).toBe(false);
    }
  });
  it('fold-edhv92.ts (CR 101.4, 608.2d): "each other player" and "each opponent" say the same; the standalone sentence renders either way', () => {
    for (const w of ['Each opponent', 'Each other player']) {
      const f = face('Example Plan', 'Sorcery', `${w} may return a creature card from their graveyard to the battlefield.`);
      expect(fullyAutomated(f), w).toBe(true);
    }
  });
  it('stat.ts (CR 613.1f, 509.1b): a plain grant and a ban on blockers that are not X say "has K and can\'t be blocked except by X"', () => {
    const f = face('Example Cloak', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature has flying and can\'t be blocked except by Walls.');
    expect(fullyAutomated(f)).toBe(true);
  });
});
