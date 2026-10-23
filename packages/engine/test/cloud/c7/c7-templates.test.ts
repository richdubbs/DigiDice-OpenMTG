/**
 * Cloud batch 3, C7 ("this way" results of an earlier instruction): the template data of parser/templates/zz-cloud/c7.json and the parser, lowering and renderer
 * readings of parser/holes/moved-words.ts, parser/holes/moved.ts, lower/quantities.ts#movedCounts, lower/conditions.ts#onlyEarlier and render/moved.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2).
 * Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in c7-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import c7 from '../../../src/parser/templates/zz-cloud/c7.json';
import review from '../../m5/golden/cards/cloud-c7-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const C7 = c7 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, an activated or triggered ability on a creature. */
function exampleCard(text: string): OracleCard {
  if (!text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsed = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;
const steps = (text: string): string => JSON.stringify(parsed(text).abilities.map((a) => ('effect' in a ? a.effect : a)));

describe('C7 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/c7.json, after trigger.json, before zz-cloud/std-hob.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/c7.json');
    expect(files.indexOf('zz-cloud/c7.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/c7.json')).toBeLessThan(files.indexOf('zz-cloud/std-hob.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.c7.*', () => {
    expect(C7.length).toBe(4); // C7 review: the "gain 2 / 3 life for each" duplicates of FAST2 T8's templates were removed (same pattern and JSON)
    for (const t of C7) {
      expect(t.id, t.id).toMatch(/^eff\.c7\./);
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
    for (const t of C7.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(t.id)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of C7) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('C7 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of C7) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsed(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsed(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsed(c);
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
    [/\bthis way\b/, 'this turn'], [/\bfor each\b/, 'for any'], [/\bdestroyed\b/, 'exiled'], [/\bsacrificed\b/, 'destroyed'], [/\bdiscarded\b/, 'exiled'],
    [/\bexiled this way\b/, 'dealt damage this way'], [/\bany number of\b/, 'two'], [/\bYou gain\b/, 'You lose'], [/\bgain 2\b/, 'gain 1'], [/\blose[s]? 2\b/, 'loses 1'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('C7 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of C7) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsed(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsed(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('C7 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of C7) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?\{/.test(w)) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsed(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('C7 readings (parser/holes/moved-words.ts, moved.ts; lower/quantities.ts, conditions.ts)', () => {
  it('CR 608.2c, 608.2h: "for each <np> <participle> this way" is the result count of the one earlier instruction of that kind, with the description as `which`', () => {
    const j = steps('Destroy all artifacts. You draw a card for each artifact destroyed this way.');
    expect(j).toContain('"op":"destroy"');
    expect(j).toMatch(/"count":\{"q":"resultCount","step":"[a-z0-9]+","which":\{"types":\["Artifact"\]\}\}/);
  });
  it('"the number of <nps> <participle> this way" reads the same', () => {
    expect(steps('Exile all artifacts. Target player loses X life, where X is the number of artifacts exiled this way.')).toContain('"q":"resultCount"');
    // wave-2 merge: "<cards> exiled this way" (a card noun) is std-lci's reading, the cards the exile's binding holds counted in exile: the same cards (CR 608.2c, 400.7)
    expect(steps('Exile all creature cards from target player\'s graveyard. Target creature gets -X/-X until end of turn, where X is the number of cards exiled this way.')).toContain('"filter":{"zone":"exile","is":{"ref":"bound","name":"them"},"isCard":true}');
  });
  it('CR 400.3: "put into your graveyard this way" and "returned to your hand this way" are the cards you own', () => {
    const j = steps('Mill three cards. You gain 2 life for each creature card put into your graveyard this way.');
    expect(j).toContain('"owner":"you"');
    expect(j).toContain('"q":"resultCount","step":"mill"');
  });
  it('CR 701.17a: a mill puts cards into a graveyard; it is the instruction of "put into a graveyard this way"', () => {
    expect(fullyAutomated(parsed('Mill three cards. You gain 2 life for each creature card put into your graveyard this way.'))).toBe(true);
  });
  it('a sacrifice and a discard are named by their own participle only (a destroy is not a sacrifice)', () => {
    expect(fullyAutomated(parsed('Destroy all creatures. You gain 2 life for each creature sacrificed this way.'))).toBe(false);
    expect(fullyAutomated(parsed('Each player sacrifices a creature. You gain 2 life for each creature destroyed this way.'))).toBe(false);
  });
  it('CR 608.2c: a condition on what was moved reads the instruction right before, or the one earlier instruction of its kind; the active and passive words agree', () => {
    const a = steps('Exile target card from a graveyard. If a creature card was exiled this way, you gain 3 life.');
    const b = steps('Exile target card from a graveyard. If you exiled a creature card this way, you gain 3 life.');
    const c = steps('Exile target card from a graveyard. If at least one creature card is exiled this way, you gain 3 life.');
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a).toContain('"cond":{"cond":"did","step":');
    expect(a).toContain('"which":{"types":["Creature"],"isCard":true},"to":"exile"');
  });
  it('CR 608.2c: "If you don\'t put a card onto the battlefield this way" is the negated condition on the move of the option', () => {
    const j = steps('{T}: You may put a creature card from your hand onto the battlefield. If you don\'t put a card onto the battlefield this way, draw a card.');
    expect(j).toContain('"not":true');
    expect(j).toContain('"to":"battlefield"');
  });
  it('a template that names the instruction itself outranks the general reading of the same words (FAST4 T26: "the number of cards discarded this way")', () => {
    const f = parsed('Discard your hand, then draw cards equal to the number of cards discarded this way.');
    expect(f.templatesUsed).toContain('eff.t26.discardHand.drawDiscardedThisWay');
    expect(f.diagnostics.filter((d) => d.level === 'manual')).toEqual([]);
  });
});

const index = localIndex();

describe.skipIf(index === null)('C7 design 6.10 (local index): synthetic examples', () => {
  it('no C7 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = C7.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
