/**
 * Commander lane edh-next, round edh-next-7 (EDHREC ranks 5,001-6,500, third pass): the template data of parser/templates/zz-cloud/edh-next-7.json ("any number of target opponents each discard their
 * hands, then draw N cards", a sentence that begins "You" + instructions, "target opponent sacrifices a creature of their choice, discards N cards, then loses N life", "each opponent sacrifices a
 * creature they control with the greatest power", "return all permanents of the color of your choice to their owners' hands", three counters on three targets) and the round's parser and renderer
 * changes, tested at the end of this file and in edh-next-7-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-next-7-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext7 from '../../../src/parser/templates/zz-cloud/edh-next-7.json';
import review7 from '../../m5/golden/cards/edh-next-7-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext7 as Template[];
/** The round's golden entries. */
const review = review7 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 5;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhn7.discardHands.thenDraw': ['Wheel and Deal'],
  'eff.edhn7.you.return.draw.gain': ['Cruel Ultimatum'],
  'eff.edhn7.player.sac.discard.thenLose': ['Cruel Ultimatum'],
  'eff.edhn7.player.sac.theyControl.greatestPower': ["Szat's Will"],
  'eff.edhn7.return.all.colorOfYourChoice': ['Wash Out'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (_t: Template, text: string) =>
  parseCard(
    /^Enchant(ed)? /.test(text) ? card('Example Plan', 'Enchantment — Aura', text)
      : /^Equipped /.test(text) ? card('Example Plan', 'Artifact — Equipment', text)
        : /^~ enters|^\{/.test(text) ? card('Example Plan', 'Artifact', text)
          : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
            : /^(As long as|Artifact spells|Noncreature spells)/.test(text) ? card('Example Plan', 'Enchantment', text)
              : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-7 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-7.json, path order: after edh-next-3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-7.json');
    expect(files.indexOf('zz-cloud/edh-next-7.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhn7.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm|rst)\.edhn7\./);
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

describe('edh-next-7 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bmay create\b/, 'creates'], [/\bits controller\b/, 'target player'], [/\bthat player\b/, 'you'], [/\bthat\'s tapped and attacking\b/, "that's tapped"], [/\bonto the battlefield\b/, 'into your hand'],
    [/\bthe rest into your graveyard\b/, 'the rest into your hand'], [/\bloses all abilities\b/, 'loses flying'], [/\blegendary\b/, 'snow'], [/\bfirst strike\b/, 'flying'], [/\bfor each\b/, 'for every two'],
    [/\ban additional card\b/, 'two additional cards'], [/\bdiscards a card\b/, 'discards two cards'], [/\benters tapped\b/, 'enters'], [/\bfrom their hand\b/, 'from their graveyard'], [/\bas long as\b/, 'unless'],
    [/\bless to cast\b/, 'more to cast'], [/\bcan't be blocked\b/, 'can be blocked'], [/\beach player\b/, 'each opponent'], [/\bcost \{1\}\b/, 'cost {2}'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-7 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-7 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // the word in front of "counter(s)" is an open class by design (6.11, the CounterKind hole)
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

describe.skipIf(index === null)('edh-next-7 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-7 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

const sorcery = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;

describe('edh-next-7 parser and renderer changes (one test each)', () => {
  it('parser/holes/filter.ts#modAt: "target 1/1 creature" is a creature with power 1 and toughness 1; "X/X" and "star/star" prefixes stay manual', () => {
    const ok = sorcery('Target 1/1 creature gets +2/+1 until end of turn.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"toughness":{"op":"==","value":1}');
    expect(fullyAutomated(sorcery('Target X/X creature gets +2/+1 until end of turn.'))).toBe(false);
    expect(fullyAutomated(sorcery('Target green 1/1 creature gets +2/+1 until end of turn.'))).toBe(true);
    expect(fullyAutomated(sorcery('Target 1/1 green creature gets +2/+1 until end of turn.'))).toBe(false); // the other order of the two adjectives is not rendered: fails closed
  });
  it('render/np.ts (family token-creature-word): a Pest creature token is also a Pest token; two creature types or a card type other than creature keep their words', () => {
    expect(fullyAutomated(sorcery("If you don't control a Pest creature token, draw a card."))).toBe(true);
    expect(fullyAutomated(sorcery("If you don't control a Pest token, draw a card."))).toBe(true);
    expect(fullyAutomated(sorcery("If you don't control a Pest artifact token, draw a card."))).toBe(false);
  });
  it('render/steps-cards.ts (family discard-their-hands): a group of target players discards "their hands"; a single target player does not', () => {
    expect(fullyAutomated(sorcery('Any number of target opponents each discard their hands, then draw two cards.'))).toBe(true);
    expect(fullyAutomated(sorcery('Target opponent discards their hands, then draws two cards.'))).toBe(false);
  });
});
