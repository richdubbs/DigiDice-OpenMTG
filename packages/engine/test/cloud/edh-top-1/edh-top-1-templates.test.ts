/**
 * Commander round edh-top-1 (the most played cards left in any lane), the template data of parser/templates/zz-cloud/edh-top-1.json ("If ~ is in your opening hand and
 * you're not the starting player, you may begin the game with it on the battlefield with a luck counter on it. If you do, exile a card from your hand." (Gemstone Caverns),
 * "As long as <condition>, you may play lands and cast <spells> from the top of your library" (The Reality Chip), "exile the top card of your library face down and look at
 * it" and "when <it> leaves the battlefield, <effects>" as a delayed trigger of the same resolution (Ugin, the Ineffable)). Guard G9 (design 6.8): every example lowers with
 * its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a
 * nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when
 * it is present. The behavior is in edh-top-1-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/edh-top-1.json';
import review from '../../m5/golden/cards/edh-top-1-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
/** An ability that works on the battlefield needs a permanent: a creature for a static, triggered or activated line, a sorcery for a spell. */
const typeFor = (text: string): string => (/^(\{|at the |if |whenever |as long as )/i.test(text) ? 'Creature' : 'Sorcery');
const parse = (text: string, type = typeFor(text)) => parseCard(card('Example Advisor', type, text, type.includes('Creature') ? { power: '1', toughness: '1' } : {}), OPTS).faces[0]!;
type Golden = { card: string; verified: string; expect?: string }[];
const golden = review as Golden;
const using = (file: Golden, id: string): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card).sort();

describe('edh-top-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-top-1.json, after edh-replace, before edh-zones-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-top-1.json');
    expect(files.indexOf('zz-cloud/edh-top-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-replace-1.json'));
    expect(files.indexOf('zz-cloud/edh-top-1.json')).toBeLessThan(files.indexOf('zz-cloud/edh-zones-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are (abl|sta|eff).edht1.*', () => {
    expect(MECH.map((t) => t.id)).toEqual(['abl.edht1.pregame.begin.notStarting.counter', 'sta.edht1.top.lands.cast.cond', 'eff.edht1.exileTop.faceDown.look', 'eff.edht1.delay.whenLeaves']);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(abl|sta|eff)\.edht1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 deviation (guide section 5, "Narrow wordings"): the four templates are stable on the one card of the EDHREC top 5,000 that prints each, golden (Gemstone Caverns, The Reality Chip, Ugin, the Ineffable)', () => {
    for (const t of MECH) expect(t.status, t.id).toBe('stable');
    expect(using(golden, 'abl.edht1.pregame.begin.notStarting.counter')).toEqual(['Gemstone Caverns']);
    expect(using(golden, 'sta.edht1.top.lands.cast.cond')).toEqual(['The Reality Chip']);
    expect(using(golden, 'eff.edht1.exileTop.faceDown.look')).toEqual(['Ugin, the Ineffable']);
    expect(using(golden, 'eff.edht1.delay.whenLeaves')).toEqual(['Ugin, the Ineffable']);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'not', 'when']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-top-1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parse(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parse(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parse(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\bopening hand\b/, 'graveyard'], [/\bnot the starting player\b/, 'the starting player'], [/\bluck counter\b/, 'charge counter'], [/\bexile a card from your hand\b/, 'exile two cards from your hand'],
    [/\bfrom the top of your library\b/, 'from your graveyard'], [/\bplay lands and cast\b/, 'play lands or cast'], [/\bface down\b/, 'face up'], [/\bleaves the battlefield\b/, 'dies'],
    [/\blook at it\b/, 'reveal it'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}
describe('edh-top-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parse(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parse(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('edh-top-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parse(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('edh-top-1 readings: the new wordings pass the gate, their near misses do not', () => {
  it('"as long as <cond>, you may play lands and cast spells from the top of your library": needs both halves and the top of the library', () => {
    expect(fullyAutomated(parse('As long as you control a Forest, you may play lands and cast spells from the top of your library.', 'Creature'))).toBe(true);
    expect(fullyAutomated(parse('As long as you control a Forest, you may play lands from the top of your library.', 'Creature'))).toBe(true); // the older reading, unchanged
    expect(fullyAutomated(parse('As long as you control a Forest, you may play lands and cast spells from your library.', 'Creature'))).toBe(false);
  });
  it('"when <it> leaves the battlefield" after an instruction is a delayed trigger of that resolution; "when ~ leaves the battlefield" on its own stays a triggered ability', () => {
    expect(fullyAutomated(parse('Create a 1/1 white Soldier creature token. When that token leaves the battlefield, you gain 2 life.'))).toBe(true);
    const own = parseCard(card('Example Advisor', 'Creature', 'When Example Advisor leaves the battlefield, you gain 2 life.', { power: '1', toughness: '1' }), OPTS).faces[0]!;
    expect(own.abilities.map((a) => a.kind)).toEqual(['triggered']);
  });
  it('"begin the game with ~ on the battlefield": the older Leyline wordings keep their templates (no counter, no condition on the starting player)', () => {
    const leyline = parse('If this card is in your opening hand, you may begin the game with it on the battlefield.', 'Enchantment');
    expect(fullyAutomated(leyline)).toBe(true);
    expect(leyline.templatesUsed.includes('abl.pregame.begin')).toBe(true);
    expect(leyline.templatesUsed.some((t) => t.startsWith('abl.edht1'))).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-top-1 design 6.10 (local index): synthetic examples', () => {
  it('no edh-top-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
