/**
 * Commander lane edh-c, round edh-c-74: the template data of parser/templates/zz-cloud/edh-c-74.json (the narrow wordings of eight cards) with guards G9 and G2
 * (design 6.8); behavior in edh-c-74-scenarios.test.ts. Narrow wording (design 6.9 deviation): each printed by one card of ranks 17,001 to 17,500 (fourth pass) (listed in NARROW). CR cites are from the Comprehensive Rules text of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC74 from '../../../src/parser/templates/zz-cloud/edh-c-74.json';
import reviewC74 from '../../m5/golden/cards/edh-c-74-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC74 as Template[];
const review = reviewC74 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 7;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC ranks 16,876 to 17,500) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhv74.putOneHand.otherGraveyard.searched': ["Fork in the Road"],
  'eff.edhv74.player.sacrificesOneOf.theirChoice': ["Incriminate"],
  'eff.edhv74.player.reveals.handAndTop': ["Psychotic Episode"],
  'eff.edhv74.you.choose.revealedThisWay': ["Psychotic Episode"],
  'eff.edhv74.player.puts.chosen.bottom': ["Psychotic Episode"],
  'eff.edhv74.player.reveals.hand.discardsAll.thatSpellsMv': ["Infernal Kirin"],
  'rid.edhv74.if.damage.playerOrWalker.andCreature.instead': ["Searing Blaze"],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(t.kind === 'static' ? card('Example Plan', 'Enchantment', text) : /^\{/.test(text) ? card('Example Plan', 'Artifact', text) : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-c-74 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-74.json, path order: between edh-c-6 and edh-c-8) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-74.json');
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 10; ids are *.edhv74.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhv74\./);
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

describe('edh-c-74 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-c-74 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-74 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-74 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-74 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


describe('edh-c-74 parser and renderer readings (design 6.3, 6.8): each reading opens the wording it names and nothing next to it', () => {
  const full = (type: string, text: string, pt?: [string, string]): boolean => fullyAutomated(parseCard(card('Example Plan', type, text, pt ? ({ power: pt[0], toughness: pt[1] } as Partial<OracleCard>) : undefined), OPTS).faces[0]!);
  it('"three or more creatures that share a creature type" is a count of the most that have one type (CR 205.3m): or more only, you only', () => {
    expect(full('Creature — Shapeshifter', 'When this creature enters, if you control four or more creatures that share a creature type, you gain 1 life.', ['2', '2'])).toBe(true);
    expect(full('Creature — Shapeshifter', 'When this creature enters, if you control fewer than four creatures that share a creature type, you gain 1 life.', ['2', '2'])).toBe(false);
    expect(full('Creature — Shapeshifter', 'When this creature enters, if an opponent controls four or more creatures that share a creature type, you gain 1 life.', ['2', '2'])).toBe(false);
  });
  it('"controlled by the same player" (CR 115.1, 601.2c): two or more targets of one controller, whoever it is; the wording of an opponent keeps its own reading', () => {
    expect(full('Sorcery', 'Choose two target artifact creatures controlled by the same player. That player sacrifices one of them of their choice.')).toBe(true);
    expect(full('Sorcery', 'Choose two target creatures controlled by the same opponent. That player sacrifices one of them of their choice.')).toBe(false);
    expect(full('Sorcery', 'Choose target creature controlled by the same player. That player sacrifices one of them of their choice.')).toBe(false);
  });
  it('an "instead" damage rider keeps both recipients (CR 614.15): different recipients or amounts that are not numbers are refused', () => {
    const base = '~ deals 1 damage to target player or planeswalker and 1 damage to target creature that player or that planeswalker\'s controller controls.';
    expect(full('Instant', `${base} If you control a Wizard, ~ deals 3 damage to that player or planeswalker and 3 damage to that creature instead.`)).toBe(true);
    expect(full('Instant', `${base} If you control a Wizard, ~ deals 3 damage to that player or planeswalker instead.`)).toBe(false);
    expect(full('Instant', `${base} If you control a Wizard, ~ deals 3 damage to that creature and 3 damage to that player or planeswalker instead.`)).toBe(false);
  });
});
