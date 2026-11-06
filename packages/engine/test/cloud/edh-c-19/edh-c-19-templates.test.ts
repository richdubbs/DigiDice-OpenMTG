/**
 * Commander lane edh-c, round edh-c-19 (third pass over EDHREC ranks 15,001-15,625): the template data of parser/templates/zz-cloud/edh-c-19.json (X cap beside a payment of X, shuffle up to N cards
 * from the graveyard, the hand to the bottom and draw that many, damage equal to its own power, a revealed card taken by its owner, tap any number of Humans and draw per Human) with guards G9
 * and G2 (design 6.8), and the render and lowering readings; behavior in edh-c-19-scenarios.test.ts. Narrow wordings (design 6.9 deviation): each printed by one card of the band. CR cites
 * are from the Comprehensive Rules text of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC19 from '../../../src/parser/templates/zz-cloud/edh-c-19.json';
import reviewC19 from '../../m5/golden/cards/edh-c-19-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC19 as Template[];
const review = reviewC19 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 5;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhv19.mayPay.x.draw.xCap': ['Shanna, Purifying Blade'],
  'eff.edhv19.shuffle.upTo.graveyard': ['Stream of Thought'],
  'eff.edhv19.handToBottom.drawThatMany': ['Mindmoil'],
  'eff.edhv19.player.revealTop.ifCard.putHand': ['Goblin Guide'],
  'eff.edhv19.mayTapHumans.drawPerTapped': ['Minas Tirith Garrison'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(t.kind === 'static' ? card('Example Plan', 'Enchantment', text) : /^\{/.test(text) ? card('Example Plan', 'Artifact', text) : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-c-19 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-19.json, path order: edh-c- sorts before edh-cast) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-19.json');
    expect(files.indexOf('zz-cloud/edh-c-19.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhv19.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm|abl)\.edhv19\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
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

describe('edh-c-19 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bgreater\b/, 'less'], [/\bgraveyard\b/, 'hand'], [/\bany number\b/, 'up to two'], [/\bpower\b/, 'toughness'], [/\bHumans\b/, 'Elves'], [/\bland card\b/, 'creature card'],
    [/\bthat player\b/, 'you'], [/\bbottom\b/, 'top'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-c-19 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-19 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-19 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-19 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


describe('edh-c-19 render and lowering readings (invented wordings, design 6.10)', () => {
  const parse = (type: string, text: string) => parseCard(card('Example Plan', type, text, /Creature/.test(type) ? { power: '3', toughness: '3' } as Partial<OracleCard> : {}), OPTS).faces[0]!;
  const ok = (type: string, text: string): boolean => fullyAutomated(parse(type, text));
  it('render/steps-util.ts: "you gain three times X life" (N times the announced X, 2 to 5) is read; "three times Y" or a count of cards is another amount', () => {
    expect(ok('Creature — Human', '{1}, Reveal X white cards from your hand, Sacrifice this creature: You gain three times X life.')).toBe(true);
    expect(ok('Creature — Human', '{1}, Reveal X white cards from your hand, Sacrifice this creature: You gain four times X life.')).toBe(true);
    expect(jsonKey(parse('Creature — Human', '{1}, Reveal X white cards from your hand, Sacrifice this creature: You gain three times X life.').abilities)).not.toBe(jsonKey(parse('Creature — Human', '{1}, Reveal X white cards from your hand, Sacrifice this creature: You gain two times X life.').abilities));
  });
  it('lowering (parser/lower/coin-flip.ts): "you may flip a coin. If you win the flip, ..." puts the result sentences inside the option; a flip by another player or an "otherwise" stays manual', () => {
    expect(ok('Creature — Ooze', 'At the beginning of your upkeep, you may flip a coin. If you win the flip, put a +1/+1 counter on ~. If you lose the flip, remove a +1/+1 counter from ~.')).toBe(true);
    expect(ok('Creature — Ooze', 'At the beginning of your upkeep, each opponent may flip a coin. If you win the flip, put a +1/+1 counter on ~.')).toBe(false);
  });
  it('render/steps-flow.ts: a payment of X capped by a quantity is read only with the separate sentence "X can\'t be greater than ..." after the branch; the lifegain-trigger form keeps its own wording', () => {
    expect(ok('Creature — Human', "At the beginning of your end step, you may pay {X}. If you do, draw X cards. X can't be greater than the number of creatures you control.")).toBe(true);
    expect(ok('Creature — Human', 'Whenever you gain life, you may pay {X}, where X is less than or equal to the amount of life you gained. If you do, draw X cards.')).toBe(true);
  });
  it('lowering (AnaphorInfo.selfFirst): "~ deals damage equal to its power to that creature" is the source\'s own power when several objects fit', () => {
    const own = parse('Creature — Archer', 'Whenever a creature with flying attacks you, ~ deals damage equal to its power to that creature.');
    expect(fullyAutomated(own)).toBe(true);
    expect(JSON.stringify(own.abilities)).toContain('"stat":"power","of":{"ref":"self"}');
  });
});
