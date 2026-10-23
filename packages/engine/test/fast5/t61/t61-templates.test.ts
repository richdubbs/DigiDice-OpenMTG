/**
 * FAST5 T61: the template data of parser/templates/zz-fast5/t61.json (resolution riders: "Then draw N cards", "if you control that creature, draw N cards", "Then if
 * you control N or more lands, untap that land", "Then you draw X cards and lose X life, where X is ...", "Then draw a card for each card you've discarded this turn",
 * "Reveal those cards, put them into your hand, then shuffle", "Mill N cards, then put all <types> cards from among them into your hand", "If you do, put a +1/+1
 * counter on ~ and draw a card", "If you do, return it to the battlefield under its owner's control at the beginning of the next end step") and the lowering and
 * renderer readings they needed (the object pronouns "her" and "him" of a character, "artifact creature and/or Vehicle", "for each ... other than ~", "..., then you may
 * ... If you do, ..."). Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate; every counter-example does not
 * parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability (G2).
 * Examples are synthetic wordings (design 6.10).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T61 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t61 from '../../../src/parser/templates/zz-fast5/t61.json';
import { automated, bare, exampleCard, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T61 = t61 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2)
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const face = (type: string, text: string) => parseCard({ name: 'Example Charm', layout: 'normal', type_line: type, oracle_text: text } as never, OPTS).faces[0]!;
const abilities = (f: ReturnType<typeof face>) => f.abilities as unknown as Record<string, unknown>[];

describe('T61 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5/t61.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t61.json');
    expect(files.indexOf('zz-fast5/t61.json')).toBeGreaterThan(files.indexOf('zz-fast5/t48.json'));
    expect(files.indexOf('zz-fast5/t61.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5)', () => {
    expect(T61.length).toBe(9);
    for (const t of T61) {
      expect(t.kind, t.id).toBe('effect');
      expect(t.id, t.id).toMatch(/^(rep|eff|sta)\.t61\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T61) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't", 'alone']) {
        if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
      }
    }
  });
});

describe('T61 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T61) {
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

describe('T61 lowering: what the shapes mean', () => {
  const steps = (type: string, text: string): Record<string, unknown>[] => (abilities(face(type, text))[0]!['effect'] as { steps: Record<string, unknown>[] }).steps;
  it('CR 608.2c: "Then draw three cards" is a draw that follows, never one that depends on the step before', () => {
    expect(steps('Instant', 'Surveil 2. Then draw three cards.')).toEqual([{ op: 'surveil', who: { ref: 'you' }, count: 2 }, { op: 'draw', who: { ref: 'you' }, count: 3 }]);
  });
  it('CR 608.2h: "if you control that creature" asks whether the earlier target is still on the battlefield under your control (an exact object, not a description)', () => {
    const [, check] = steps('Instant', 'Tap target creature. If you control that creature, draw two cards.');
    expect(check).toEqual({
      op: 'if',
      cond: { cond: 'exists', of: { ref: 'each', filter: { is: { ref: 'target', id: 't0' }, controller: 'you' } } },
      then: [{ op: 'draw', who: { ref: 'you' }, count: 2 }],
    });
  });
  it('CR 701.23a, 608.2c: "untap that land" after a search for a basic land card untaps the land found', () => {
    const s = steps('Sorcery', 'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. Then if you control five or more lands, untap that land.');
    expect(s[3]).toMatchObject({ op: 'if', then: [{ op: 'untap', what: { ref: 'bound', name: (s[0] as { as: string }).as } }] });
  });
  it('CR 608.2h: "Then you draw X cards and lose X life, where X is the number of counters on ~" reads the count once, as the ability resolves', () => {
    const f = face('Creature — Demon', 'At the beginning of combat on your turn, put a +1/+1 counter on ~. Then you draw X cards and lose X life, where X is the number of counters on ~.');
    expect(automated(f.abilities)).toBe(true);
    expect(JSON.stringify(abilities(f)[0]!['effect'])).toContain('"q":"counters"');
  });
  it("CR 701.9a: \"a card for each card you've discarded this turn\" counts the discard actions of this turn that were yours", () => {
    const s = steps('Creature — Goblin', "Whenever ~ attacks, discard a card. Then draw a card for each card you've discarded this turn.");
    expect(s[1]).toMatchObject({ op: 'draw', count: { q: 'happenedCount', event: { ev: 'action', verb: 'discard', actor: 'you' }, scope: 'turn' } });
  });
  it('CR 701.20a, 701.24a: "Reveal those cards, put them into your hand, then shuffle" reveals, moves and shuffles the cards a search found', () => {
    const s = steps('Enchantment', 'When ~ enters, search your library for up to three basic land cards. Reveal those cards, put them into your hand, then shuffle.');
    const as = (s[0] as { as: string }).as;
    expect(s.slice(1)).toEqual([
      { op: 'reveal', who: { ref: 'you' }, what: { ref: 'bound', name: as } },
      { op: 'move', what: { ref: 'bound', name: as }, to: { zone: 'hand' } },
      { op: 'shuffle', who: { ref: 'you' } },
    ]);
  });
  it('CR 701.17c: "put all instant and sorcery cards from among them" moves every milled card of that description, with no choice', () => {
    const s = steps('Sorcery', 'Mill four cards, then put all instant and sorcery cards from among them into your hand.');
    expect(s).toEqual([
      { op: 'mill', who: { ref: 'you' }, count: 4, as: 'milled' },
      { op: 'move', what: { ref: 'each', filter: { anyOf: [{ types: ['Instant', 'Sorcery'] }], is: { ref: 'bound', name: 'milled' }, zone: 'any' } }, to: { zone: 'hand' } },
    ]);
  });
  it('CR 608.2c: "If you do, put a +1/+1 counter on ~ and draw a card" is one conditional of both instructions (not a counter if you did and a draw always)', () => {
    const s = steps('Creature — Detective', 'Whenever you scry or surveil, you may pay {2}. If you do, put a +1/+1 counter on ~ and draw a card.');
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ op: 'pay', then: [{ op: 'putCounters', on: { ref: 'self' }, kind: '+1/+1', count: 1 }, { op: 'draw', count: 1 }] });
  });
  it('CR 603.7, 608.2c: "If you do, return it ... at the beginning of the next end step" delays the return only when the exile happened', () => {
    const s = steps('Instant', "Exile up to one target creature or land you control. If you do, return it to the battlefield under its owner's control at the beginning of the next end step.");
    expect(JSON.stringify(s)).toContain('"op":"delay"');
    expect(JSON.stringify(s)).toContain('"cond":"did"');
  });
  it('CR 201.5, 608.2c: "her" names the object itself, even when the ability named another object before (a bare "it" would be ambiguous there)', () => {
    const own = steps('Legendary Creature — Human', 'At the beginning of your end step, if ~ is tapped, put a +1/+1 counter on her.');
    expect(own).toEqual([{ op: 'putCounters', on: { ref: 'self' }, kind: '+1/+1', count: 1 }]);
    const both = steps('Legendary Creature — Human', 'When ~ enters, tap target creature. Put a +1/+1 counter on her.');
    expect(both[1]).toMatchObject({ op: 'putCounters', on: { ref: 'self' } });
    // outside the object's own enters trigger (FAST5 T58: there "it" after a target is the target, parser/lower/anaphora.ts#resolveAnaphor; FAST5 T76: the focus rule makes it the
    // target here too, the object the instruction before it tapped, model/focus.ts)
    const attack = face('Legendary Creature — Human', 'Whenever ~ attacks, tap target creature. Put a +1/+1 counter on it.').abilities;
    expect(automated(attack)).toBe(true);
    expect(JSON.stringify(attack)).toContain('"op":"putCounters","on":{"ref":"target"');
  });
  it('CR 205.2a, 205.3: "each artifact creature and/or Vehicle you control" is the artifact creatures and the Vehicles (two descriptions, not one with both)', () => {
    const s = steps('Artifact — Vehicle', '{T}: Put a +1/+1 counter on each artifact creature and/or Vehicle you control.');
    expect(s).toEqual([{ op: 'putCounters', on: { ref: 'each', filter: { anyOf: [{ allTypes: ['Artifact', 'Creature'] }, { subtypes: ['Vehicle'] }], controller: 'you' } }, kind: '+1/+1', count: 1 }]);
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

describe('T61 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T61) {
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

describe('T61 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T61) {
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

describe.skipIf(index === null)('T61 design 6.10: examples are synthetic', () => {
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
    const verbatim = T61.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples]
      .filter((x) => x.split('\n').some((l) => lines.has(l.trim())))
      .map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
