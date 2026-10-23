/**
 * std-sos (docs/CARD_WORK.md, cloud batch 2): the template data of parser/templates/zz-cloud/std-sos.json (searches for N cards, a cost reduction per counter, "then you may put
 * ... onto the battlefield", a color pair with a computed base power and toughness, a token copy that is a creature in addition, entering with a computed number of
 * counters and tapped for a small X) and the readings its shapes needed. Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes
 * the exact render gate; every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word
 * of an example never leaves an automated ability (G2). Examples are synthetic wordings (design 6.10).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so these templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import stdsos from '../../../src/parser/templates/zz-cloud/std-sos.json';
import { automated, bare, exampleCard, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const STDSOS = stdsos as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2)
/** A wording that reads X is on a card with X in its mana cost (CR 107.3: X is announced by the spell, 'guard bad-var'). */
const parsedWith = (t: Template, text: string) => parseCard({ ...exampleCard(t, text), ...(/(^|[^A-Za-z])X([^A-Za-z]|$)/.test(text) ? { mana_cost: '{X}{R}' } : {}) }, OPTS).faces[0]!;
const face = (type: string, text: string) => parseCard({ name: 'Example Charm', layout: 'normal', type_line: type, oracle_text: text } as never, OPTS).faces[0]!;
const abilities = (f: ReturnType<typeof face>) => f.abilities as unknown as Record<string, unknown>[];

describe('STDSOS template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-cloud/std-sos.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-sos.json');
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(STDSOS.length).toBeGreaterThanOrEqual(9);
    for (const t of STDSOS) {
      expect(['static', 'effect'], t.id).toContain(t.kind);
      expect(t.id, t.id).toMatch(/^(rep|eff|sta|cm)\.stdsos\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of STDSOS) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't", 'alone']) {
        if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
      }
    }
  });
});

describe('STDSOS guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of STDSOS) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bat least\b/, 'at most'], [/\bwas spent\b/, 'was paid'], [/\bweren't\b/, 'were'], [/\bcan't\b/, 'can'], [/\balone\b/, 'together'],
    [/\bfor each\b/, 'for every'], [/\bMonstrosity\b/, 'Adapt'], [/\bassign\b/, 'deal'], [/\bcast\b/, 'play'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ').trim()}.`);
  return out;
}

describe('STDSOS guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of STDSOS) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('STDSOS guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of STDSOS) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.pop()!;
        const words = last.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || /^~'s$/.test(w)) return;
          // CR 122.1: any word can name a kind of counter (parser/holes/misc.ts#counterKind), so the word before "counter" is not a nonsense position
          if (/^counters?$/.test(words[i + 1] ?? '')) return;
          const mutated = [...lines, [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : w.endsWith(':') ? 'blorfty:' : 'blorfty', ...words.slice(i + 1)].join(' ')].join('\n');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('STDSOS design 6.10: examples are synthetic', () => {
  it('no example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|Equipment|Vehicle)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = STDSOS.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples]
      .filter((x) => x.split('\n').some((l) => lines.has(l.trim())))
      .map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

describe('STDSOS lowering: what the shapes mean', () => {
  it('CR 113.6m: a trigger that returns ~ from the graveyard functions there (zone graveyard) and is automated', () => {
    const f = face('Creature — Spirit', 'Whenever you gain life, you may pay {1}. If you do, return ~ from your graveyard to your hand.');
    expect(abilities(f)[0]).toMatchObject({ kind: 'triggered', zone: ['graveyard'] });
    expect(automated(f.abilities)).toBe(true);
  });
  it('CR 201.2, 113.6: "return target card named ~ from your graveyard" names OTHER cards of that name, so the trigger functions on the battlefield', () => {
    const f = face('Creature — Rat', 'Whenever ~ becomes blocked, you may return target card named Example Charm from your graveyard to your hand.');
    expect(abilities(f)[0]!['zone']).toBeUndefined();
  });
  // p2-c-cast-zone-1 (CR 113.6m, 603.4, 400.7): "if ~ is in your graveyard" is now read where the card is (parser/holes/cond.ts: matches self in your graveyard), in an
  // ability that functions only in the graveyard; a card that left it is a new object, so the condition fails as the ability resolves (played in test/cloud/p2-c-cast-zone-1)
  it('CR 113.6m: an intervening "if ~ is in your graveyard" reads the card in your graveyard, where the ability functions', () => {
    const f = face('Creature — Spirit', 'At the beginning of your upkeep, if ~ is in your graveyard, you may return it to your hand.');
    expect(automated(f.abilities)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"interveningIf":{"cond":"matches","object":{"ref":"self"},"filter":{"zone":"graveyard","owner":"you"}}');
  });
  it('CR 122.6, 603.4: "if you put a counter on ~ this turn" is a history of the turn by you, on the object itself', () => {
    const f = face('Creature — Elf', 'At the beginning of your end step, if you put a counter on this creature this turn, you gain 1 life.');
    expect(abilities(f)[0]).toMatchObject({ kind: 'triggered', interveningIf: { cond: 'happened', scope: 'turn', event: { ev: 'counters', change: 'put', by: 'you', on: { self: true } } } });
    expect(automated(f.abilities)).toBe(true);
  });
  it('CR 201.2, 107.3: "the number of differently named lands you control" is a quantity anywhere a number goes', () => {
    const f = face('Instant', 'Target player gains life equal to the number of differently named lands you control.');
    expect(automated(f.abilities)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"q":"distinct","what":"names"');
  });
  it('CR 205.1b, 613.1d: "It\'s still a land" after a conditional becoming modifies the type change inside the condition', () => {
    const f = face('Land', '{5}: If this land isn\'t a creature, it becomes a 2/4 Wizard creature. It\'s still a land.');
    expect(automated(f.abilities)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"types":{"add":["Creature"]}');
  });
});
