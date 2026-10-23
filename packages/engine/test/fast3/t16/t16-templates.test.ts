/**
 * FAST3 T16: the template data of parser/templates/zz-fast3/t16.json (combat and targeting restrictions on objects, family R2-B) and the renderer readings
 * the package's shapes needed (design 6.8 G6: render/stat.ts, render/steps-lasting.ts). Guard G9 (design 6.8): every example lowers with its template, is
 * fully automated and passes the exact render gate; every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a
 * nonsense word in place of any word of an example never leaves an automated ability (G2). Examples are synthetic wordings (design 6.10), except the one
 * sentence whose wording the rules fix (below).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T16 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { PROMO2_PROMOTED } from '../../fast5/promo2/evidence';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t16 from '../../../src/parser/templates/zz-fast3/t16.json';
import { automated, bare, exampleCard, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T16 = t16 as Template[];
const OPTS = defaultParseOptions();
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const byId = (id: string): Template => T16.find((t) => t.id === id)!;

describe('T16 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast3/t16.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast3/t16.json');
    expect(files.indexOf('zz-fast3/t16.json')).toBeGreaterThan(files.indexOf('zz-fast3/t14.json'));
    expect(files.indexOf('zz-fast3/t16.json')).toBeLessThan(files.indexOf('zz-push/k1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 5 (FAST3)', () => {
    expect(T16.length).toBe(14);
    for (const t of T16) {
      expect(['static', 'effect'], t.id).toContain(t.kind);
      expect(t.id, t.id).toMatch(/^(eff|rst)\.t16\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(5);
    }
  });
  it('design 6.9: the stable templates are the ones reviewed on the corpus (20+ matches or three golden cards); the rest stay experimental', () => {
    expect(T16.filter((t) => t.status === 'stable').map((t) => t.id).sort()).toEqual([
      'eff.t16.cantattackblock', 'eff.t16.cantbeblocked.except.dur', 'eff.t16.cantberegenerated', 'rst.t16.cantattack.unless.defending.controls',
      'rst.t16.cantattackblock.unless', 'rst.t16.cantbeblocked.greaterpower',
      ...Object.keys(PROMO2_PROMOTED).filter((id) => id.includes('.t16.')), // FAST5 PROMO2 (test/fast5/promo2/evidence.ts)
    ].sort());
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T16) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't"]) if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
    }
  });
});

describe('T16 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T16) {
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

describe('T16 lowering: the JSON of each shape (CR 508.1c, 509.1b, 506.2, 115.1, 701.19c, 611.2a)', () => {
  const effectsOf = (id: string, text: string): unknown => {
    const f = parsedWith(byId(id), text);
    const a = f.abilities[f.abilities.length - 1] as unknown as { effects?: unknown; effect?: unknown; steps?: unknown };
    return JSON.parse(JSON.stringify(a.effects ?? a.steps ?? a.effect ?? a));
  };
  it('"can\'t attack unless defending player controls a Desert": an `onlyIf` attack whose condition reads the defending player (CR 506.2, 508.1c)', () => {
    expect(effectsOf('rst.t16.cantattack.unless.defending.controls', "~ can't attack unless defending player controls a Desert.")).toEqual([
      { s: 'restrict', subject: { ref: 'self' }, mode: 'onlyIf', action: 'attack', when: { cond: 'exists', of: { ref: 'each', filter: { controller: { ref: 'defending' }, anyOf: [{ subtypes: ['Desert'] }] } } } },
    ]);
  });
  it('"can\'t attack or block unless C": one `onlyIf` restriction per action with the same condition', () => {
    const e = effectsOf('rst.t16.cantattackblock.unless', "~ can't attack or block unless you control four or more artifacts.") as { action: string; mode: string; when: unknown }[];
    expect(e.map((x) => [x.mode, x.action])).toEqual([['onlyIf', 'attack'], ['onlyIf', 'block']]);
    expect(e[0]!.when).toEqual({ cond: 'exists', of: { ref: 'each', filter: { types: ['Artifact'], controller: 'you' } }, atLeast: 4 });
    expect(e[1]!.when).toEqual(e[0]!.when);
  });
  it('"can\'t be the target of white spells or abilities from white sources": one color filter on the spell or the source of the ability (CR 115.1, 113.7a)', () => {
    expect(effectsOf('rst.t16.cantbetargeted.white', "Enchanted creature can't be the target of white spells or abilities from white sources.")).toEqual([
      { s: 'restrict', subject: { ref: 'attachedTo' }, mode: 'cant', action: 'beTargeted', other: { colors: ['W'] } },
    ]);
  });
  it('"can\'t be blocked by creatures with greater power": power greater than the source\'s own power (CR 208.1, 509.1b)', () => {
    expect(effectsOf('rst.t16.cantbeblocked.greaterpower', "~ can't be blocked by creatures with greater power.")).toEqual([
      { s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'beBlockedBy', other: { types: ['Creature'], power: { op: '>', value: { q: 'stat', stat: 'power', of: { ref: 'self' } } } } },
    ]);
  });
  it('"White creatures and blue creatures can\'t block" is one restriction per group', () => {
    expect(effectsOf('rst.t16.two.groups.cantblock', "Green creatures and red creatures can't block.")).toEqual([
      { s: 'restrict', subject: { ref: 'each', filter: { colors: ['G'], types: ['Creature'] } }, mode: 'cant', action: 'block' },
      { s: 'restrict', subject: { ref: 'each', filter: { colors: ['R'], types: ['Creature'] } }, mode: 'cant', action: 'block' },
    ]);
  });
  it('the "this turn" forms are lasting effects (CR 611.2a) of a resolved instruction', () => {
    const regen = JSON.stringify(parsedWith(byId('eff.t16.cantberegenerated'), "Target artifact creature can't be regenerated this turn.").abilities);
    expect(regen).toContain('"op":"effect","duration":{"d":"endOfTurn"}');
    expect(regen).toContain('"action":"beRegenerated"');
    const except = JSON.stringify(parsedWith(byId('eff.t16.cantbeblocked.except.dur'), "{2}: ~ can't be blocked this turn except by creatures with reach.").abilities);
    expect(except).toContain('"action":"beBlockedBy","other":{"not":{"types":["Creature"],"keyword":"reach"}}');
    const cat = JSON.stringify(parsedWith(byId('eff.t16.each.cantblock.self'), "{2}{R}: Creatures without flying can't block ~ this turn.").abilities);
    expect(cat).toContain('"subject":{"ref":"each","filter":{"types":["Creature"],"notKeyword":"flying"}},"mode":"cant","action":"block","other":{"self":true}');
  });
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [
    [/\bcan't\b/, 'can'], [/\battack\b/, 'block'], [/\bblock\b/, 'attack'], [/\bdefending player\b/, 'an opponent'], [/\byou control\b/, 'an opponent controls'],
    [/\bpower\b/, 'toughness'], [/\bgreater\b/, 'lesser'], [/\bregenerated\b/, 'destroyed'], [/\bexcept by\b/, 'by'], [/\bthis turn\b/, 'this combat'],
    [/\bwhite sources\b/, 'black sources'], [/\bblue sources\b/, 'red sources'], [/\bblack sources\b/, 'white sources'], [/\bred sources\b/, 'green sources'],
    [/\bgreen sources\b/, 'blue sources'], [/\bspells or abilities\b/, 'spells'], [/\bwithout\b/, 'with'], [/\band\b/, 'or'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('T16 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T16) {
    it(`${t.id}: an appended "unless/instead/at random/twice/until end of turn" or a swapped key word never gives the example's JSON`, () => {
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

describe('T16 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T16) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.pop()!;
        const words = last.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || /^~'s$/.test(w)) return;
          const mutated = [...lines, [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : w.endsWith(':') ? 'blorfty:' : 'blorfty', ...words.slice(i + 1)].join(' ')].join('\n');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

/** Lines of other templates an example needs as they are (a keyword line). */
const SHARED_LINES = new Set(['Flying']);
/**
 * The sentence whose words the rules fix, so no invented wording exists: the evasion "can't be blocked by creatures with greater power" (skulk's reminder
 * wording, CR 702.118a; no number, player or noun in it can change). Design 6.10 accepts it as functional text; every other example is synthetic.
 */
const FIXED_WORDING = new Set(["~ can't be blocked by creatures with greater power."]);

describe.skipIf(index === null)('T16 design 6.10: examples are synthetic', () => {
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
    const verbatim = T16.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples]
      .filter((x) => x.split('\n').some((l) => !SHARED_LINES.has(l.trim()) && !FIXED_WORDING.has(l.trim()) && lines.has(l.trim())))
      .map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
