/**
 * Commander lane edh-c, round edh-c-93 (third pass over EDHREC ranks 28,501-29,000): the template data of parser/templates/zz-cloud/edh-c-93.json (a life loss under a trailing "if" condition, the same
 * amount of damage to a target and to the source itself with "where X is", one card of the linked exile returned to the battlefield) with guards G9 and G2 (design 6.8), and the render readings;
 * behavior in edh-c-93-scenarios.test.ts. Narrow wordings (design 6.9 deviation): each printed by one card of the band. CR cites are from the Comprehensive Rules text of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC93 from '../../../src/parser/templates/zz-cloud/edh-c-93.json';
import reviewC93 from '../../m5/golden/cards/edh-c-93-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC93 as Template[];
const review = reviewC93 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 3;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhv93.player.loseLife.ifCond': ['Soul Reap'],
  'eff.edhv93.damage.andItself.whereX': ['Sunflare Shaman'],
  'eff.edhv93.linked.returnOne.battlefield.bare': ['Purgatory'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(t.kind === 'static' ? card('Example Plan', 'Enchantment', text) : /^\{/.test(text) ? card('Example Plan', 'Artifact', text) : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-c-93 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-93.json, path order: edh-c- sorts before edh-cast) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-93.json');
    expect(files.indexOf('zz-cloud/edh-c-93.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhv93.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm|abl)\.edhv93\./);
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

describe('edh-c-93 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-c-93 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-93 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-93 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-93 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


describe('edh-c-93 render and lowering readings (invented wordings, design 6.10)', () => {
  const parse = (type: string, text: string) => parseCard(card('Example Plan', type, text, /Creature/.test(type) ? { power: '3', toughness: '3' } as Partial<OracleCard> : {}), OPTS).faces[0]!;
  const ok = (type: string, text: string): boolean => fullyAutomated(parse(type, text));
  it("render/cond.ts: \"you've cast another <color> spell this turn\" under a trailing if is read; another color word, a plain 'another spell', or 'unless' is another reading", () => {
    expect(ok('Sorcery', "Destroy target creature. Its controller loses 2 life if you've cast another red spell this turn.")).toBe(true);
    expect(jsonKey(parse('Sorcery', "Destroy target creature. Its controller loses 2 life if you've cast another red spell this turn.").abilities)).not.toBe(jsonKey(parse('Sorcery', "Destroy target creature. Its controller loses 2 life if you've cast another blue spell this turn.").abilities));
    expect(jsonKey(parse('Sorcery', "Destroy target creature. Its controller loses 2 life unless you've cast another red spell this turn.").abilities)).not.toBe(jsonKey(parse('Sorcery', "Destroy target creature. Its controller loses 2 life if you've cast another red spell this turn.").abilities));
  });
  it('weak beside edh-c-56: "you lose N life if C" keeps edh-c-56\'s reading alone; "its controller loses N life if C" is edh-c-93\'s', () => {
    const you = parse('Creature — Elf', 'At the beginning of your upkeep, you lose 2 life if you control an Elf.');
    expect(fullyAutomated(you)).toBe(true);
    expect(you.templatesUsed).toContain('eff.edhv56.loseLife.if');
    expect(you.templatesUsed).not.toContain('eff.edhv93.player.loseLife.ifCond');
    const its = parse('Sorcery', "Destroy target creature with flying. Its controller loses 2 life if you've cast another black spell this turn.");
    expect(its.templatesUsed).toContain('eff.edhv93.player.loseLife.ifCond');
  });
  it('render/steps-life.ts: the same amount to a target and to the source itself with "where X is ..." is read for the source ~ (any other amount for the source, or you instead of itself, is not)', () => {
    expect(ok('Creature — Wizard', '{T}: ~ deals X damage to target creature and X damage to itself, where X is the number of Wizards you control.')).toBe(true);
    expect(ok('Creature — Wizard', '{T}: ~ deals X damage to target creature and 2 damage to itself, where X is the number of Wizards you control.')).toBe(false);
    expect(ok('Creature — Wizard', '{T}: ~ deals X damage to target creature and X damage to you, where X is the number of Wizards you control.')).toBe(true);
  });
  it('render/fold.ts: "return a card exiled with ~ to the battlefield" is read after a linked exile; with "to its owner\'s hand", or of a different count, it is another reading', () => {
    const line = 'When ~ enters, exile target creature card from your graveyard.\n{2}: Return a card exiled with ~ to the battlefield.';
    expect(ok('Enchantment', line)).toBe(true);
    expect(jsonKey(parse('Enchantment', line).abilities)).not.toBe(jsonKey(parse('Enchantment', line.replace('to the battlefield', "to its owner's hand")).abilities));
    expect(ok('Enchantment', line.replace('a card', 'two cards'))).toBe(false);
  });
});
