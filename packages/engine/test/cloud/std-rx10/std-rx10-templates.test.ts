/**
 * Standard round rx10 (std-rx10, wave 2 slice s17): the template data of parser/templates/zz-cloud/std-rx10.json ("choose target A and target B", "those creatures
 * fight each other", "you may cast ~ as though it had flash if you <cost> as an additional cost to cast it") and the parser and renderer changes of the round
 * (the description "the creature you control" of an announced target, the group of two announced targets, the Cond "<object> entered this turn", the pronoun in
 * the branch of an "if" that tests a target). Guard G9 (design 6.8): every example lowers with its template, is automated and passes
 * the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of
 * any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present.
 * The behavior is in std-rx10-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRx10 from '../../../src/parser/templates/zz-cloud/std-rx10.json';
import review from '../../m5/golden/cards/cloud-std-rx10-review.json';
import { capabilitiesOfDef } from '../../../src/model/cap-walk';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdRx10 as Template[];
const MECH_COUNT = 3;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered or static ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('std-rx10 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx10.json, after std-rp.json, before std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx10.json');
    expect(files.indexOf('zz-cloud/std-rx10.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rp.json'));
    expect(files.indexOf('zz-cloud/std-rx10.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    expect(files.indexOf('zz-cloud/std-rx10.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdrx10.* or sta.stdrx10.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.stdrx10\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence, hand-verified golden cards (Standard, or the tuning half) that use it (the review file pins each card as full)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
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

describe('std-rx10 guard G9 (design 6.8): examples and counter-examples', () => {
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

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\buntil end of turn\b/, 'until your next turn'], [/\bor more\b/, 'or fewer'], [/\beach\b/, 'all'], [/\bget\b/, 'gain'], [/\bgain\b/, 'lose'], [/\bhas\b/, 'loses'],
    [/\bDuring your turn\b/, 'During your end step'], [/\bflash\b/, 'haste'], [/\bits owner's control\b/, 'your control'], [/\binto your hand\b/, 'onto the battlefield'],
    [/\bmilled this way\b/, 'discarded this way'], [/\bloses all abilities\b/, 'loses flying'], [/\bmana cost\b/, 'power'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx10 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
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

describe('std-rx10 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        const labelEnd = words.indexOf('--'); // a flavor word before "--" has no rules meaning (CR 207.2d): any words may stand there
        words.forEach((w, i) => {
          if (i <= labelEnd) return;
          if (w === '~' || w === '~,' || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // the word in front of "counter(s)" is an open class by design (6.11, the CounterKind hole), as wp22-mutation.test.ts
          const end = w.match(/[.,]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-rx10 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx10 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});


// ---- the parser and renderer changes of the round, one test each ----------------------------------------------------------------------------------------------

const sorcery = (text: string) => parseCard(card('Example Volley', 'Sorcery', text), OPTS).faces[0]!;
const steps = (f: ReturnType<typeof sorcery>): unknown => ((bare(f.abilities) as Record<string, unknown>[]).find((a) => a['kind'] === 'spell')!['effect'] as Record<string, unknown>)['steps'];
const T0 = { ref: 'target', id: 't0' };
const T1 = { ref: 'target', id: 't1' };

describe('std-rx10 antecedents (CR 115.1, 608.2c; design 6.4): "the creature you control" after "Choose target creature you control and target creature ..."', () => {
  it('names the announced target described with the same controller ("you control", "you don\'t control", "an opponent controls")', () => {
    const a = sorcery("Choose target creature you control and target creature an opponent controls. Put a +1/+1 counter on the creature you control. Then those creatures fight each other.");
    expect(fullyAutomated(a), JSON.stringify(a.diagnostics)).toBe(true);
    expect(steps(a)).toEqual([{ op: 'putCounters', on: T0, kind: '+1/+1', count: 1 }, { op: 'fight', a: T0, b: T1 }]);
    const b = sorcery("Choose target creature you control and target creature you don't control. Put a +1/+1 counter on the creature you don't control. Then those creatures fight each other.");
    expect(steps(b)).toEqual([{ op: 'putCounters', on: T1, kind: '+1/+1', count: 1 }, { op: 'fight', a: T0, b: T1 }]);
  });
  it('without a sentence that announced targets, or with a controller no target was described by, it is not read', () => {
    expect(fullyAutomated(sorcery('Destroy target artifact. Put a +1/+1 counter on the creature you control.'))).toBe(false);
    expect(fullyAutomated(sorcery("Choose target creature you control and target creature you don't control. Put a +1/+1 counter on the creature an opponent controls. Then those creatures fight each other."))).toBe(false);
  });
});

describe('std-rx10 lowering (CR 701.14a, 608.2c): "those creatures fight each other" is the group of two targets announced together', () => {
  it('the two single targets of one announcement fight, the first with the second', () => {
    const f = sorcery("Choose target creature you control and target creature you don't control. Then those creatures fight each other.");
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(steps(f)).toEqual([{ op: 'fight', a: T0, b: T1 }]);
  });
  it('a group of another kind (one target phrase of two targets, a group no announcement made) stays manual', () => {
    expect(fullyAutomated(sorcery('Choose two target creatures. Then those creatures fight each other.'))).toBe(false);
    expect(fullyAutomated(sorcery('Tap two target creatures. Then those creatures fight each other.'))).toBe(false);
  });
});

describe('std-rx10 Cond (CR 400.7, 608.2c): "<object> entered this turn" of an object other than ~', () => {
  it('reads matches enteredThisTurn of that object, and "it" in the branch is that object (the std-r8 rule)', () => {
    const f = sorcery("Choose target creature you control and target creature you don't control. If the creature you control entered this turn, put a +1/+1 counter on it. Then those creatures fight each other.");
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(steps(f)).toEqual([{ op: 'if', cond: { cond: 'matches', object: T0, filter: { enteredThisTurn: true } }, then: [{ op: 'putCounters', on: T0, kind: '+1/+1', count: 1 }] }, { op: 'fight', a: T0, b: T1 }]);
  });
  it('"entered the battlefield this turn" is the same condition; "attacked this turn" is not this reading', () => {
    const a = sorcery("Choose target creature you control and target creature you don't control. If the creature you control entered this turn, put a +1/+1 counter on it. Then those creatures fight each other.");
    const b = sorcery("Choose target creature you control and target creature you don't control. If the creature you control entered the battlefield this turn, put a +1/+1 counter on it. Then those creatures fight each other.");
    const c = sorcery("Choose target creature you control and target creature you don't control. If the creature you control attacked this turn, put a +1/+1 counter on it. Then those creatures fight each other.");
    expect(jsonKey(a.abilities)).toBe(jsonKey(b.abilities));
    expect(fullyAutomated(c) && jsonKey(c.abilities) === jsonKey(a.abilities)).toBe(false);
  });
});

describe('std-rx10 static (CR 601.3b, 118.8): "as though it had flash if you <cost> as an additional cost to cast it"', () => {
  it('is a flash permission of the card in hand with that additional cost, and the capability is installed (statics/hooks.ts#castFlashAddCosts)', () => {
    const f = parseCard(card('Example Volley', 'Sorcery', 'You may cast this spell as though it had flash if you behold a Dragon as an additional cost to cast it.\nDraw a card.'), OPTS).faces[0]!;
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const s = (bare(f.abilities) as Record<string, unknown>[]).find((a) => a['kind'] === 'static')!;
    expect(s).toMatchObject({ zone: ['hand'], effects: [{ s: 'permit', action: 'haveFlash', of: { self: true }, addCost: { other: [{ kind: 'behold', filter: { subtypes: ['Dragon'] }, count: 1 }] } }] });
    expect(ENGINE_CAPABILITIES.has('feature:permit.haveFlash.addCost')).toBe(true);
    expect(capabilitiesOfDef(f.abilities[0] as never)).toContain('feature:permit.haveFlash.addCost');
  });
});

describe('std-rx10 Filter (CR 208.1): "with total power and toughness N or less"', () => {
  it('is the sum of the object\'s own power and toughness compared with the number', () => {
    const f = sorcery('Destroy target creature with total power and toughness 4 or less.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(bare(f.abilities))).toContain('"totalPowerToughness":{"op":"<=","value":4}');
    const g = sorcery('Destroy target creature with total power and toughness 4 or greater.');
    expect(JSON.stringify(bare(g.abilities))).toContain('"totalPowerToughness":{"op":">=","value":4}');
  });
  it('"without total power and toughness ..." and "total power" alone are not this reading', () => {
    expect(JSON.stringify(bare(sorcery('Destroy target creature without total power and toughness 4 or less.').abilities))).not.toContain('totalPowerToughness');
    expect(JSON.stringify(bare(sorcery('Destroy target creature with total power 4 or less.').abilities))).not.toContain('totalPowerToughness');
  });
});
