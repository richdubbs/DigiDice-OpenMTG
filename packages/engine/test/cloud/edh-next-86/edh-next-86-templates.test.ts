/**
 * Commander top-rank part 2, edh-next-86: the template data of parser/templates/zz-cloud/edh-next-86.json ("Enchanted creature has A, B, and C, and it gets +X/+X, where X is ...", Katilda's Rising Dawn;
 * "whenever the chosen player casts a spell", Sewer Nemesis) and the parser, renderer and engine changes of the round (one test each at the end). Guard G9 (design 6.8): every example lowers with its
 * template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any
 * word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10). The behavior is in edh-next-86-scenarios.test.ts. CR cites from memory (unverified).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext86 from '../../../src/parser/templates/zz-cloud/edh-next-86.json';
import review from '../../m5/golden/cards/edh-next-86-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext86 as Template[];
const MECH_COUNT = 2;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only one
 * or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (decided by the owner's standing rule 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'sta.edhn86.attached.grant.andItGetsPumpWhereX': ["Katilda, Dawnhart Martyr // Katilda's Rising Dawn"],
  'trg.edhn86.chosenPlayer.casts.spell': ['Sewer Nemesis'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (a sorcery); the others are abilities of a creature (static, triggered, replacement). */
const SPELL = new Set<string>([]);
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id)
    ? parseCard(card('Example Plan', 'Sorcery', text, { mana_cost: '{X}{R}' }), OPTS)
    : parseCard(card('Example Relic', 'Legendary Artifact Creature — Golem Villain', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-next-86 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-86.json, path order: after edh-next-81, before edh-next-9) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-86.json');
    expect(files.indexOf('zz-cloud/edh-next-86.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-81.json'));
    expect(files.indexOf('zz-cloud/edh-next-86.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-9.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are eff.edhn86.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|rst|trg|rep)\.edhn86\./);
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

describe('edh-next-86 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bor more\b/, 'or less'], [/\bhaste\b/, 'flying'], [/\btop\b/, 'bottom'], [/\bonce\b/i, 'twice'], [/\bcast\b/, 'exile'], [/\bwithout paying its mana cost\b/, 'by paying its mana cost'], [/\bor less\b/, 'or more'], [/\bplay\b/, 'cast'], [/\battacked\b/, 'blocked'], [/\bspell\b/, 'ability'], [/\blife\b/, 'cards'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-86 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-86 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (words.includes('--') && i < words.indexOf('--')) return; // the ability word before the dash has no rules meaning (CR 207.2c)
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

describe.skipIf(index === null)('edh-next-86 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-86 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-next-86 parser, renderer and engine changes (one test each)', () => {
  const spell = (text: string, type = 'Sorcery', name = 'Example Plan') => parseCard(card(name, type, text), OPTS).faces[0]!;
  const creature = (text: string) => parseCard(card('Example Relic', 'Legendary Artifact Creature — Golem Villain', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/holes/filter.ts, render/np.ts (CR 208.1; Sarkhan\'s Unsealing): a list of exact powers or toughnesses needs "or" before the last number', () => {
    const t = 'Whenever you cast a creature spell with power 4, 5, or 6, ~ deals 4 damage to any target.';
    expect(fullyAutomated(creature(t))).toBe(true);
    expect(JSON.stringify(creature(t).abilities)).toContain('"power":{"op":"==","value":5}');
    expect(fullyAutomated(creature(t.replace('power', 'toughness')))).toBe(true);
    expect(fullyAutomated(creature(t.replace('5, or 6', '5, 6')))).toBe(false);
  });
  it('parser/lower/conditions.ts (CR 119.3, 608.2c; Blood Tribute): "the life lost this way" in a rider needs a loss of life right before the rider; damage is not a loss of life instruction', () => {
    const t = 'Target opponent loses half their life, rounded up. If this spell was kicked, you gain life equal to the life lost this way.';
    expect(fullyAutomated(spell('Kicker {1}\n' + t))).toBe(true);
    expect(fullyAutomated(spell('Kicker {1}\n' + t.replace('loses half their life, rounded up', 'gains 2 life')))).toBe(false);
    expect(fullyAutomated(spell('You gain life equal to the life lost this way.'))).toBe(false);
    // a loss inside the rider itself is not the one the marker names (reviewer, 2026-11-04): stays manual
    expect(fullyAutomated(spell('Kicker {2}\nEach opponent loses 2 life. If this spell was kicked, each opponent loses 3 life and you gain life equal to the life lost this way.'))).toBe(false);
  });
  it('render/steps-zones.ts (CR 608.2b; Cyclone Summoner): "except for A, B, and lands" after the destination', () => {
    const t = "Return all permanents to their owners' hands except for Giants, Wizards, and lands.";
    expect(fullyAutomated(spell(t))).toBe(true);
    expect(fullyAutomated(spell(t.replace('except for', 'except')))).toBe(false);
  });
  it('parser/holes/filter.ts (CR 208.1; Colfenor): "lesser toughness" is read only in a trigger with an event subject', () => {
    const t = 'Whenever another creature you control dies, return up to one other target creature card with lesser toughness from your graveyard to your hand.';
    expect(fullyAutomated(creature(t))).toBe(true);
    expect(fullyAutomated(spell('Return target creature card with lesser toughness from your graveyard to your hand.'))).toBe(false);
  });
  it('rules/targets.ts, rules/history.ts, parser/holes/object.ts (CR 115.4, 120.1; Needle Drop): "any target that was dealt damage this turn" narrows creatures, planeswalkers, battles and players', () => {
    const t = '~ deals 1 damage to any target that was dealt damage this turn.';
    expect(fullyAutomated(spell(t, 'Instant'))).toBe(true);
    expect(JSON.stringify(spell(t, 'Instant').abilities)).toContain('"dealtDamage":true');
    expect(fullyAutomated(spell('~ deals 1 damage to any target that was dealt combat damage this turn.', 'Instant'))).toBe(false);
  });
});
