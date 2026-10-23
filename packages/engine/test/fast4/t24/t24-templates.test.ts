/**
 * FAST4 T24: the template data of parser/templates/zz-fast4/t24.json (statics for spell keyword grants, attack and block permissions, restrictions and
 * conditional power and toughness) and the renderer readings the package's shapes needed (design 6.8 G6: render/refs.ts "spells you cast", render/cond.ts
 * "~ has a counter on it" and "you gained life this turn", render/costs.ts "reveal ... in your hand", render/np.ts "for each instant and sorcery card").
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate; every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability (G2).
 * Examples are synthetic wordings (design 6.10), except where the shape has no other wording (listed in VERBATIM_OK).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T24 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t24 from '../../../src/parser/templates/zz-fast4/t24.json';
import { automated, bare, exampleCard, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T24 = t24 as Template[];
const OPTS = defaultParseOptions();
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const face = (type: string, text: string) => parseCard({ name: 'Example Charm', layout: 'normal', type_line: type, oracle_text: text } as never, OPTS).faces[0]!;
const ab = (f: ReturnType<typeof face>, i = 0): unknown => bare(f.abilities)[i];

describe('T24 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast4/t24.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast4/t24.json');
    expect(files.indexOf('zz-fast4/t24.json')).toBeGreaterThan(files.indexOf('zz-fast4/t22.json'));
    expect(files.indexOf('zz-fast4/t24.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 7 (FAST4)', () => {
    expect(T24.length).toBe(15);
    for (const t of T24) {
      expect(['static', 'ability'], t.id).toContain(t.kind);
      expect(t.id, t.id).toMatch(/^(sta|kw)\.t24\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(7);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T24) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen']) if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
    }
  });
});

describe('T24 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T24) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
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

describe('T24 lowering: what the shapes mean', () => {
  it('CR 601.2a, 707.10: "Goblin spells you cast" are the Goblin spells on the stack its controller controls that are not copies (a copy is never cast)', () => {
    const f = face('Creature — Goblin', 'Goblin spells you cast have convoke.');
    expect(ab(f)).toMatchObject({
      kind: 'static',
      effects: [{
        s: 'continuous',
        affects: { ref: 'each', filter: { anyOf: [{ subtypes: ['Goblin'], stackKind: 'spell', zone: 'stack' }], controller: 'you', not: { stackKind: 'copy', zone: 'stack' }, zone: 'stack' } },
        mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'convoke', text: 'convoke' }] }],
      }],
    });
  });
  it('only the keywords whose grant reaches the spell while it is cast are read: improvise, demonstrate, flash, affinity and delve stay manual', () => {
    for (const text of ['Noncreature spells you cast have improvise.', 'Artifact spells you cast have demonstrate.', 'Creature spells you cast have flash.', 'Spells you cast have delve.', 'Spells you cast have affinity for artifacts.']) {
      const f = face('Creature — Human', text);
      expect(f.templatesUsed.filter((id) => id.startsWith('sta.t24.')), text).toEqual([]);
    }
  });
  it('CR 601.2i: "each player can\'t cast more than one spell each turn" is a cast restriction with the limit 1 on every player', () => {
    expect(ab(face('Creature — Archon', "Each player can't cast more than one spell each turn."))).toMatchObject({ kind: 'static', effects: [{ s: 'restrict', subject: { ref: 'each', who: 'player' }, mode: 'cant', action: 'cast', max: 1 }] });
  });
  it('CR 509.1a: "~ can block any number of creatures" is the rule modification extraBlockers with no limit', () => {
    expect(ab(face('Creature — Human', '~ can block any number of creatures.'))).toMatchObject({ kind: 'static', effects: [{ s: 'rule', rule: 'extraBlockers', value: 'none', of: { self: true } }] });
  });
  it('CR 122.1: "as long as ~ has a counter on it" counts counters of any kind on the object itself', () => {
    const f = face('Creature — Wall', "Defender\nAs long as ~ has a counter on it, it can attack as though it didn't have defender.");
    expect(ab(f, 1)).toMatchObject({
      kind: 'static', condition: { cond: 'compare', left: { q: 'counters', on: { ref: 'self' }, kind: 'any' }, op: '>=', right: 1 },
      effects: [{ s: 'permit', who: { ref: 'you' }, action: 'attackAsThoughNoDefender' }],
    });
  });
  it('CR 119.3: "as long as you gained life this turn" is one or more life gained by the controller this turn', () => {
    const f = face('Creature — Elf', 'Clerics you control get +1/+1 and have lifelink as long as you gained life this turn.');
    expect(JSON.stringify(ab(f))).toContain('"condition":{"cond":"compare","left":{"q":"lifeGainedThisTurn"},"op":">=","right":1}');
  });
  it('CR 613.4b: base power and toughness during your turn is layer 7b under the condition "it\'s your turn"', () => {
    expect(ab(face('Creature — Elk', 'During your turn, ~ has base power and toughness 4/1.'))).toMatchObject({
      kind: 'static', condition: { cond: 'turnOf', whose: 'you' }, effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7b', power: 4, toughness: 1 }] }],
    });
  });
  it('CR 702.37a, 701.20a: a morph cost of revealing a colored card from your hand', () => {
    expect(ab(face('Creature — Bird', 'Morph--Reveal a red card in your hand.'))).toMatchObject({
      kind: 'keyword', keyword: 'morph', cost: { other: [{ kind: 'reveal', zone: 'hand', count: 1, filter: { colors: ['R'] } }] },
    });
  });
  it('CR 205.2, 608.2c: "for each instant and sorcery card in your graveyard" counts each card that is an instant or a sorcery once (render family for-each-type-list)', () => {
    const f = face('Creature — Human', '~ gets +1/+0 for each instant and sorcery card in your graveyard.');
    expect(f.gate.every((g) => g.ok), JSON.stringify(f.gate)).toBe(true);
    expect(fullyAutomated(f)).toBe(true);
    const json = JSON.stringify(ab(f));
    expect(json).toContain('"power":{"q":"count","of":{"ref":"each","filter":{');
    expect(json).toContain('"types":["Instant","Sorcery"]');
    expect(json).toContain('"zone":"graveyard"');
  });
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const lines = text.split('\n');
  const body = lines.pop()!.replace(/\.$/, '');
  const pre = lines.length > 0 ? `${lines.join('\n')}\n` : '';
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\byou cast\b/, 'you control'], [/\bconvoke\b/, 'improvise'], [/\bstorm\b/, 'ripple'], [/\bcascade\b/, 'demonstrate'], [/\bconspire\b/, 'casualty'],
    [/\bany number of\b/, 'two'], [/\bone spell\b/, 'two spells'], [/\bas long as\b/, 'if'], [/\battack\b/, 'block'], [/\bdefender\b/, 'flying'],
    [/\bbase power and toughness\b/, 'base power'], [/\bbase toughness\b/, 'base power'], [/\bcan't be blocked\b/, "can't block"], [/\bcan't be countered\b/, 'can be countered'],
    [/\bgained life\b/, 'lost life'], [/\byour turn\b/, "each opponent's turn"], [/\bin your hand\b/, 'in your graveyard'], [/\bReveal\b/, 'Discard'],
    [/\byour opponents control\b/, 'you control'], [/\bDuring\b/, 'Until'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ').trim()}.`);
  return out.map((m) => `${pre}${m}`);
}

describe('T24 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T24) {
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

describe('T24 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T24) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.pop()!;
        const words = last.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || /^\{/.test(w) || /^~'s$/.test(w)) return;
          const mutated = [...lines, [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : w.endsWith(':') ? 'blorfty:' : 'blorfty', ...words.slice(i + 1)].join(' ')].join('\n');
          const f = parsedWith(t, mutated);
          const last2 = f.abilities[f.abilities.length - 1]!;
          expect(fullyAutomated(f) && last2.kind !== 'manual', mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

/** Lines of other templates an example needs as they are (a keyword line). */
const SHARED_LINES = new Set(['Defender', 'Flying']);
/**
 * Design 6.10 exceptions: shapes with no other wording. "~ can block any number of creatures" and "as long as ~ has a counter on it, it can attack as though it
 * didn't have defender" have no hole; every one of the five colors of "Morph--Reveal a <color> card in your hand" is printed; "Each player can't cast more than one
 * spell each turn" is the only player word with a real counterpart that also reads "each player".
 */
const VERBATIM_OK = new Set(['sta.t24.blocks.anynumber', 'sta.t24.aslong.counter.attack.nodefender', 'kw.t24.morph.reveal', 'sta.t24.player.cast.max1']);

describe.skipIf(index === null)('T24 design 6.10: examples are synthetic', () => {
  it('no example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~"), except the shapes with no other wording', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|Equipment|Vehicle)\b/gi, '~').replace('Morph—', 'Morph--').trim());
        }
      }
    }
    const verbatim = T24.filter((t) => !VERBATIM_OK.has(t.id)).flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples]
      .filter((x) => x.split('\n').some((l) => !SHARED_LINES.has(l.trim()) && lines.has(l.trim())))
      .map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
