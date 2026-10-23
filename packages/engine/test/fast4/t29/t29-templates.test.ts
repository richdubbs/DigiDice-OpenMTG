/**
 * FAST4 T29: the template data of parser/templates/zz-fast4/t29.json (power/toughness and keyword statics of the object itself, equipped and enchanted
 * creatures and lords, the job Equipment's added creature type, and resolved pumps whose X or count is computed once) and the renderer readings the
 * package's shapes needed (design 6.8 G6: render/abil.ts, render/cond.ts, render/mods.ts, render/np.ts, render/qty.ts, render/refs.ts, render/stat.ts). Guard G9 (design 6.8): every example lowers with its template, is fully automated
 * and passes the exact render gate; every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in
 * place of any word of an example never leaves an automated ability (G2). Examples are synthetic wordings (design 6.10).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T29 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t29 from '../../../src/parser/templates/zz-fast4/t29.json';
import { automated, bare, exampleCard, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T29 = t29 as Template[];
const OPTS = defaultParseOptions();
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const face = (type: string, text: string) => parseCard({ name: 'Example Charm', layout: 'normal', type_line: type, oracle_text: text } as never, OPTS).faces[0]!;

describe('T29 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast4/t29.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast4/t29.json');
    expect(files.indexOf('zz-fast4/t29.json')).toBeGreaterThan(files.indexOf('zz-fast4/t26.json'));
    expect(files.indexOf('zz-fast4/t29.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 7 (FAST4)', () => {
    expect(T29.length).toBe(21);
    for (const t of T29) {
      expect(['static', 'effect'], t.id).toContain(t.kind);
      expect(t.id, t.id).toMatch(/^(sta|eff)\.t29\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(7);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T29) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't", 'double']) if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
    }
  });
});

describe('T29 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T29) {
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

describe('T29 lowering (CR 604.3, 608.2h, 611.2c, 611.3a, 613.1d, 613.4c): what the shapes mean', () => {
  const eff0 = (f: ReturnType<typeof face>, i = 0): unknown => (f.abilities[i] as unknown as { effects: unknown[] }).effects;
  const steps0 = (f: ReturnType<typeof face>, i = 0): unknown => (f.abilities[i] as unknown as { effect: { steps: unknown[] } }).effect.steps;
  it('CR 109.4, 611.3a: "~ gets +1/+0 for each other Golem you control" counts the other Golems of its controller (`other`: not the source), live', () => {
    const f = face('Artifact Creature — Golem', '~ gets +1/+0 for each other Golem you control.');
    expect(f.templatesUsed).toContain('sta.t29.self.pump.foreach.other.1.0');
    expect(eff0(f)).toEqual([{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: { q: 'count', of: { ref: 'each', filter: { other: true, subtypes: ['Golem'], controller: 'you' } } } }] }]);
  });
  it('CR 107.1, 613.4c: "for each Elf you control and each Elf card in your graveyard" is a multiple of the sum of the two counts', () => {
    const f = face('Creature — Elf', '~ gets +1/+1 for each Elf you control and each Elf card in your graveyard.');
    const sum = { q: 'math', op: '+', args: [{ q: 'count', of: { ref: 'each', filter: { subtypes: ['Elf'], controller: 'you' } } }, { q: 'count', of: { ref: 'each', filter: { subtypes: ['Elf'], zone: 'graveyard', owner: 'you', isCard: true } } }] };
    expect(eff0(f)).toEqual([{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: { q: 'math', op: '*', args: [1, sum] }, toughness: { q: 'math', op: '*', args: [1, sum] } }] }]);
  });
  it('CR 604.3, 613.4a, 402.1: the cards in all players\' hands are a characteristic-defining count of every hand', () => {
    const f = face('Creature — Human', "~'s power and toughness are each equal to the total number of cards in all players' hands.");
    const n = { q: 'count', of: { ref: 'each', filter: { zone: 'hand' } } };
    expect(eff0(f)).toEqual([{ s: 'continuous', cda: true, affects: { ref: 'self' }, mods: [{ layer: '7a', power: n, toughness: n }] }]);
  });
  it('CR 500.1, 301.5: "during your turn" and "as long as ~ is equipped" are static conditions (an Equipment attached to it)', () => {
    const a = face('Creature — Human', '~ has deathtouch during your turn.');
    expect((a.abilities[0] as unknown as { condition: unknown }).condition).toEqual({ cond: 'turnOf', whose: 'you' });
    const b = face('Creature — Human', 'As long as ~ is equipped, it gets +2/+1.');
    expect((b.abilities[0] as unknown as { condition: unknown }).condition).toEqual({ cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Equipment'], attachedToObject: { ref: 'self' } } } });
    expect(eff0(b)).toEqual([{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: 2, toughness: 1 }] }]);
  });
  it('CR 613.1d, 613.1f, 702.21a: the job Equipment adds a creature type in layer 4, the keywords (ward with its cost) in layer 6, the bonus in 7c', () => {
    const f = face('Artifact — Equipment', 'Equipped creature gets +1/+3, has ward {3}, and is a Cleric in addition to its other types.');
    expect(eff0(f)).toEqual([{ s: 'continuous', affects: { ref: 'attachedTo' }, mods: [
      { layer: 4, subtypes: { add: ['Cleric'] } },
      { layer: 6, add: [{ kind: 'keyword', keyword: 'ward', cost: { mana: [{ kind: 'generic', amount: 3 }] }, text: 'ward {3}' }] },
      { layer: '7c', power: 1, toughness: 3 },
    ] }]);
  });
  it('CR 109.4: two lord groups, "other" only in the second (the source is excluded from that group, not from the first)', () => {
    const f = face('Creature — Druid', 'Elves you control and other Druids you control get +1/+1 and have reach.');
    expect(JSON.stringify(eff0(f))).toContain('"affects":{"ref":"each","filter":{"controller":"you","anyOf":[{"subtypes":["Elf"]},{"other":true,"subtypes":["Druid"]}]}}');
  });
  it('CR 608.2h, 611.2c: a resolved pump\'s X is a quantity of the step (fixed by the effect handler as it resolves), the set is every creature you control', () => {
    const f = face('Sorcery', 'Creatures you control gain reach and get +X/+X until end of turn, where X is the number of Elves you control.');
    const x = { q: 'count', of: { ref: 'each', filter: { subtypes: ['Elf'], controller: 'you' } } };
    expect(steps0(f)).toEqual([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, mods: [{ layer: '7c', power: x, toughness: x }, { layer: 6, add: [{ kind: 'keyword', keyword: 'reach', text: 'reach' }] }] }] }]);
    const g = face('Instant', 'Target creature gets -1/-1 until end of turn for each Swamp you control.');
    expect(JSON.stringify(steps0(g))).toContain('"power":{"q":"math","op":"*","args":[-1,{"q":"count","of":{"ref":"each","filter":{"subtypes":["Swamp"],"controller":"you"}}}]}');
  });
  it('fails closed: no T29 template reads the shapes this package left manual (no model quantity, no filter, a spell\'s own flash)', () => {
    // FAST5X E15: "the greatest mana value among ..." parses now (the model's `agg`), so those shapes left this list (test/fast5x/e15). A spell's own flash
    // functions on the stack (CR 702.8a, 601.3d): since Standard merge wave 5 r3-static's sta.r3static.self.flash.aslong reads it, never a T29 template
    const f = face('Creature — Wurm', '~ has flash as long as you control a Gate.');
    expect(f.templatesUsed.filter((id) => id.startsWith('sta.t29.') || id.startsWith('eff.t29.'))).toEqual([]);
    expect(f.templatesUsed).toContain('sta.r3static.self.flash.aslong');
  });
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bgets\b/, 'gains'], [/\bpower and toughness\b/, 'power'], [/\bpower\b/, 'toughness'], [/\byou control\b/, 'an opponent controls'], [/\battached to it\b/, 'you control'],
    [/\bAura\b/, 'Curse'], [/\bEquipment\b/, 'Fortification'], [/\bwhere X\b/, 'where Y'], [/\bput X\b/, 'put two'], [/\bDouble\b/, 'Triple'], [/\bdouble\b/, 'triple'],
    [/\buntil end of turn\b/, ''],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ').trim()}.`);
  return out;
}

describe('T29 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T29) {
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

describe('T29 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T29) {
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

/** Lines of other templates an example needs as they are: an Aura's enchant line. */
const SHARED_LINES = new Set(['Enchant creature', 'Flying']);

describe.skipIf(index === null)('T29 design 6.10: examples are synthetic', () => {
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
    const verbatim = T29.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples]
      .filter((x) => x.split('\n').some((l) => !SHARED_LINES.has(l.trim()) && lines.has(l.trim())))
      .map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
