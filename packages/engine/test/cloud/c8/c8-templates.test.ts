/**
 * Cloud batch 3, C8 (references to what a cost moved): the template data of parser/templates/zz-cloud/c8.json and the lowering and renderer support of "the discarded
 * card", "the exiled card" and "if the sacrificed creature was legendary". Guard G9 (design 6.8): every example lowers with its template, is automated and passes the
 * exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of
 * an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is
 * in c8-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import c8 from '../../../src/parser/templates/zz-cloud/c8.json';
import review from '../../m5/golden/cards/cloud-c8-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const C8 = c8 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered, activated or static ability on an artifact. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Idol', 'Artifact', text);
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('C8 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/c8.json, after trigger.json, before zz-cloud/std-hob.json and zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/c8.json');
    expect(files.indexOf('zz-cloud/c8.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/c8.json')).toBeLessThan(files.indexOf('zz-cloud/std-hob.json'));
    expect(files.indexOf('zz-cloud/c8.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.c8.*', () => {
    expect(C8.length).toBe(3);
    for (const t of C8) {
      expect(t.id, t.id).toMatch(/^eff\.c8\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: at least one hand-verified golden card that uses it (the review file pins each card as full)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of C8.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of C8) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('C8 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of C8) {
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

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\buntil end of turn\b/, 'until your next turn'], [/\bmana value\b/, 'power'], [/\bdiscarded\b/, 'exiled'], [/\bX\/X\b/, 'X/1'], [/\bartifact creature\b/, 'creature'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

// C8 review: eff.c8.drain.x.whereX ({p:Player}, priority 1) also matches T26's literal "each opponent" form with the same JSON; T26 keeps its sentences
// (eff.t26.drain.whereX has priority 2, so the T26 G9 test still finds its template), C8 reads every other subject
describe('C8 review: the drain of any player and T26\'s "each opponent" drain (design 6.3 rule 2)', () => {
  const drain = C8.find((t) => t.id === 'eff.c8.drain.x.whereX')!;
  it('"each opponent loses X life and you gain X life, where X is ..." is read by eff.t26.drain.whereX; "target player ..." by eff.c8.drain.x.whereX', () => {
    const each = parsedWith(drain, 'At the beginning of your upkeep, each opponent loses X life and you gain X life, where X is the number of Elves you control.');
    expect(fullyAutomated(each)).toBe(true);
    expect(each.templatesUsed).toContain('eff.t26.drain.whereX');
    expect(each.templatesUsed).not.toContain('eff.c8.drain.x.whereX');
    const target = parsedWith(drain, '{2}, {T}: Target player loses X life and you gain X life, where X is the number of Elves you control.');
    expect(fullyAutomated(target)).toBe(true);
    expect(target.templatesUsed).toContain('eff.c8.drain.x.whereX');
  });
});

describe('C8 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of C8) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
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

describe('C8 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of C8) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^"?\{/.test(w) || w.includes('\n')) return;
          const end = w.match(/[.,:"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('C8 lowering: what a cost moved is a mention only its participle names (design 6.4; CR 400.7j, 601.2b, 602.2b, 608.2h)', () => {
  const face = (type: string, text: string) => parseCard(card('Example Idol', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : {}), OPTS).faces[0]!;
  it('"the discarded card" of an activation cost, of a spell\'s additional cost and of a payment the effect asks for is {ref:costDiscarded}', () => {
    const act = face('Artifact', "{1}, Discard a card: You gain life equal to the discarded card's mana value.");
    expect(fullyAutomated(act)).toBe(true);
    expect(JSON.stringify(act.abilities)).toContain('"of":{"ref":"costDiscarded"}');
    const spell = face('Sorcery', "As an additional cost to cast this spell, discard a card.\nYou gain life equal to the discarded card's mana value.");
    expect(fullyAutomated(spell)).toBe(true);
    expect(JSON.stringify(spell.abilities)).toContain('"of":{"ref":"costDiscarded"}');
    const paid = face('Creature — Wolf', "Whenever ~ attacks, you may pay {1}{R} and discard a card. If you do, you gain life equal to the discarded card's mana value.");
    expect(automated(paid.abilities)).toBe(true);
    expect(JSON.stringify(paid.abilities)).toContain('"then":[{"op":"gainLife","who":{"ref":"you"},"amount":{"q":"stat","stat":"manaValue","of":{"ref":"costDiscarded"}}}]');
  });
  it('a bare "it" never names what a cost discarded; "Discard ~" names no other card; a cost with two discard parts names neither', () => {
    expect(fullyAutomated(face('Artifact', '{1}, Discard a card: Return it to your hand.'))).toBe(false);
    expect(fullyAutomated(face('Artifact', "{1}, Discard ~: You gain life equal to the discarded card's mana value."))).toBe(false);
    expect(fullyAutomated(face('Artifact', "{1}, Discard a card, Discard a land card: You gain life equal to the discarded card's mana value."))).toBe(false);
  });
  it('a resolution discard ("you may discard a card. If you do, ...") is not a cost: its "the discarded card" is left to the results of instructions', () => {
    const f = face('Creature — Wolf', "When ~ enters, you may discard a card. If you do, you gain life equal to the discarded card's mana value.");
    expect(JSON.stringify(f.abilities)).not.toContain('costDiscarded');
  });
  it('"the exiled card" of an additional cost that exiles one card is {ref:costExiled}; of a cost that exiles any number of cards it is not', () => {
    const one = face('Instant', "As an additional cost to cast this spell, exile a creature card from your graveyard.\n~ deals damage equal to the exiled card's power to any target.");
    expect(fullyAutomated(one)).toBe(true);
    expect(JSON.stringify(one.abilities)).toContain('"of":{"ref":"costExiled"}');
    const many = face('Instant', "As an additional cost to cast this spell, exile any number of cards from your graveyard.\n~ deals damage equal to the exiled card's power to any target.");
    expect(fullyAutomated(many)).toBe(false);
  });
  it('CR 205.4a, 105.2: "if the sacrificed creature was legendary / red" reads a supertype or a color of the creature as it last existed', () => {
    const f = face('Creature — Human', '{T}, Sacrifice another creature: Draw a card. If the sacrificed creature was legendary, draw two cards instead.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('{"cond":"matches","object":{"ref":"costSacrificed"},"filter":{"supertypes":["Legendary"]}}');
    const g = face('Creature — Human', '{T}, Sacrifice another creature: Draw a card. If the sacrificed creature was red, you gain 2 life.');
    expect(JSON.stringify(g.abilities)).toContain('"filter":{"colors":["R"]}');
  });
});

const index = localIndex();

describe.skipIf(index === null)('C8 design 6.10 (local index): synthetic examples', () => {
  it('no C8 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = C8.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
