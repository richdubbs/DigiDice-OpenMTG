/**
 * FAST5 T44: the template data of parser/templates/zz-fast5/t44.json (optional costs during resolution: "you may sacrifice another creature [or artifact]",
 * "... a token or a land", "... an artifact or discard a card", "you may pay N life", "you may pay {M} and N life", "you may exile N cards from your
 * graveyard", "... a creature card from your graveyard", "you may discard a card or pay {M}"; the "If you do," followers "draw a card and put a counter on ~"
 * and "scry N, then draw a card") and the lowering and renderer readings they needed (parser/lower/conditions.ts#eitherOrPay, render/steps-flow.ts, costs.ts,
 * np.ts). Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate; every counter-example does not
 * parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated
 * ability (G2). Examples are synthetic wordings (design 6.10).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T44 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t44 from '../../../src/parser/templates/zz-fast5/t44.json';
import { automated, bare, exampleCard, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T44 = t44 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2)
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const face = (type: string, text: string) => parseCard({ name: 'Example Charm', layout: 'normal', type_line: type, oracle_text: text } as never, OPTS).faces[0]!;
const abilities = (f: ReturnType<typeof face>) => f.abilities as unknown as Record<string, unknown>[];

describe('T44 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5/t44.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t44.json');
    expect(files.indexOf('zz-fast5/t44.json')).toBeGreaterThan(files.indexOf('zz-fast5/t37.json'));
    expect(files.indexOf('zz-fast5/t44.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5)', () => {
    expect(T44.length).toBe(11);
    for (const t of T44) {
      expect(t.kind, t.id).toBe('effect');
      expect(t.id, t.id).toMatch(/^(rep|eff|sta)\.t44\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T44) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't", 'alone']) {
        if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
      }
    }
  });
});

describe('T44 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T44) {
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

describe('T44 lowering: what the shapes mean', () => {
  const steps = (type: string, text: string): Record<string, unknown>[] => (abilities(face(type, text))[0]!['effect'] as { steps: Record<string, unknown>[] }).steps;
  it('CR 118.12, 701.21a: "you may sacrifice another creature" is an optional payment of a sacrifice that excludes the source (other:true)', () => {
    expect(steps('Creature — Elf', '{T}: You may sacrifice another creature. If you do, draw a card.')).toEqual([
      { op: 'pay', who: { ref: 'you' }, cost: { other: [{ kind: 'sacrifice', filter: { anyOf: [{ types: ['Creature'] }], other: true }, count: 1 }] }, then: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] },
    ]);
  });
  it('CR 118.12: "pay {M} and N life" is one payment of mana and life', () => {
    expect(steps('Instant', 'You may pay {1}{B} and 2 life. If you do, draw a card.')[0]).toMatchObject({ op: 'pay', cost: { mana: [{ kind: 'generic', amount: 1 }, { kind: 'colored', color: 'B' }], other: [{ kind: 'payLife', amount: 2 }] } });
  });
  it('CR 118.12: "sacrifice A or discard a card. If you do, X" puts X after BOTH payments (three outcomes: first, second, neither)', () => {
    const [pay] = steps('Instant', 'You may sacrifice an artifact or discard a card. If you do, draw two cards.');
    const draw = [{ op: 'draw', who: { ref: 'you' }, count: 2 }];
    expect(pay).toEqual({
      op: 'pay', who: { ref: 'you' }, cost: { other: [{ kind: 'sacrifice', filter: { types: ['Artifact'] }, count: 1 }] }, then: draw,
      else: [{ op: 'pay', who: { ref: 'you' }, cost: { other: [{ kind: 'discard', count: 1 }] }, then: draw }],
    });
  });
  it('CR 603.12: "when you do" after a payment of one of two costs waits for either payment (std-rw8: the payment step\'s result is either payment\'s, effects/handlers/pay.ts)', () => {
    const f = face('Instant', 'You may sacrifice an artifact or discard a card. When you do, ~ deals 2 damage to any target.');
    expect(automated(f.abilities)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"op":"reflexive"');
  });
  it('CR 118.12: "if you do not" after a payment of one of two costs stays manual (the sentence is not folded into either payment)', () => {
    const f = face('Instant', "You may sacrifice an artifact or discard a card. If you don't, you lose 2 life.");
    expect(automated(f.abilities)).toBe(false);
  });
  it('CR 608.2c: "If you do, scry N, then draw a card" is one conditional of both instructions (not "scry if you did, then always draw")', () => {
    const s = steps('Instant', 'You may pay {1}. If you do, scry 2, then draw a card.');
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ op: 'pay', then: [{ op: 'scry', count: 2 }, { op: 'draw', count: 1 }] });
  });
  it('CR 608.2c: "If you do, draw a card and put a +1/+1 counter on ~" is one conditional of both instructions', () => {
    const s = steps('Instant', 'You may pay 1 life. If you do, draw a card and put a +1/+1 counter on ~.');
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ op: 'pay', then: [{ op: 'draw', count: 1 }, { op: 'putCounters', on: { ref: 'self' }, kind: '+1/+1', count: 1 }] });
  });
  it('CR 118.12: a reflexive trigger after "you may exile a creature card from your graveyard" waits for that payment', () => {
    const s = steps('Instant', 'You may exile a creature card from your graveyard. When you do, return target instant card from your graveyard to your hand.');
    expect(s[0]).toMatchObject({ op: 'pay', cost: { other: [{ kind: 'exileFrom', zone: 'graveyard', filter: { types: ['Creature'] }, count: 1 }] } });
    expect(s[1]).toMatchObject({ op: 'reflexive' });
  });
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

describe('T44 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T44) {
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

describe('T44 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T44) {
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

describe.skipIf(index === null)('T44 design 6.10: examples are synthetic', () => {
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
    const verbatim = T44.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples]
      .filter((x) => x.split('\n').some((l) => lines.has(l.trim())))
      .map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
