/**
 * Cloud C3 (tap-and-freeze and lord riders): the template data of parser/templates/zz-cloud/c3.json ("tap that creature and it doesn't untap during its
 * controller's next untap step", "tap up to two target creatures and they don't untap during their controllers' next untap steps", "<filter> have <abilities>
 * as long as <condition>", "<filter> get +N/+N and have <abilities> as long as / during your turn", "<filter> get +N/+N during your turn"), and the parser and
 * renderer readings they needed: a landwalk in a list of abilities (parser/holes/misc.ts#landwalkAlts, "Other Merfolk you control have islandwalk"), the creature
 * types whose plural is the singular (render/text.ts, "Treefolk you control have vigilance"), "creatures you control that are Wolves or Werewolves"
 * (render/np.ts) and the tap-and-freeze fold (render/fold.ts#tapThenFreeze).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10); the real cards are checked against the local index when it is present.
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the C3 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { pluralize } from '../../../src/render/text';
import lexicon from '../../../src/parser/lexicon.generated.json';
import c3 from '../../../src/parser/templates/zz-cloud/c3.json';
import review from '../../m5/golden/cards/cloud-c3-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const C3 = c3 as Template[];
/** PR #4's templates, and the follow-up's (cloud batch 3: static and resolved goad, untap restrictions, Aura and Equipment riders). */
const C3_PR4 = 7;
const C3_BATCH3 = 23;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a C3 example is an ability of the right kind (a trigger is a creature's, a static a creature's, an effect on its own a spell's). */
function exampleCard(text: string): OracleCard {
  if (/^(when|whenever|at) /i.test(text)) return card('Example Sentry', 'Creature — Human Soldier', text);
  if (/^tap /i.test(text)) return card('Example Frost', 'Instant', text);
  return card('Example Captain', 'Creature — Human Soldier', text);
}
const parsedWith = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

describe('C3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/c3.json, path order: after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/c3.json');
    expect(files.indexOf('zz-cloud/c3.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/c3.json')).toBeLessThan(files.indexOf('zz-fast1/t4.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(C3.length).toBe(C3_PR4 + C3_BATCH3);
    for (const t of C3) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.c3\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of C3) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      // a consumed critical phrase covers its first word where the pattern says the phrase ("must be blocked if able": "if able", as parser/lower/units.ts#criticalWordProblem reads it)
      const phraseCovers = (w: string): boolean => (t.consumes ?? []).some((c) => c.startsWith(`${w} `) && t.pattern.toLowerCase().includes(c));
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional']) if (words.includes(w) && !phraseCovers(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      if (/as long as/.test(t.pattern)) expect(t.consumes ?? [], t.id).toContain('as long as');
    }
  });
});

describe('C3 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of C3) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(fullyAutomated(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(c);
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
    [/next untap step/, 'untap step'], [/next untap steps/, 'untap steps'], [/its controller's/, 'your'], [/their controllers'/, 'your'], [/^Tap /, 'Untap '], [/, tap /, ', untap '],
    [/ as long as /, ' unless '], [/during your turn/, "during your opponents' turns"], [/ have /, ' lose '], [/ get \+/, ' get -'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('C3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of C3) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('C3 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of C3) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~,' || /^\{/.test(w)) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('C3 parser and renderer readings (CR 702.14a, 205.3m)', () => {
  const lord = (text: string, type = 'Creature — Merfolk Wizard') => parseCard(card('Example Lord', type, text), OPTS).faces[0]!;
  it('CR 702.14a, 702.14c: a landwalk in a list of abilities is the landwalk keyword with the words of its land ("islandwalk", "nonbasic landwalk", "snow forestwalk")', () => {
    const cases: [string, string][] = [
      ['Other Merfolk you control have islandwalk.', 'island'],
      ['Other Zombies you control get +1/+1 and have swampwalk.', 'swamp'],
      ['Creatures you control have nonbasic landwalk.', 'nonbasic'],
      ['Other Elves you control have snow forestwalk and trample.', 'snow forest'],
    ];
    for (const [text, quality] of cases) {
      const f = lord(text);
      expect(fullyAutomated(f), `${text}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
      expect(JSON.stringify(f.abilities), text).toContain(`"keyword":"landwalk","quality":"${quality}"`);
    }
  });
  it('a word ending in "walk" that names no land is no landwalk, and the keyword line "Swampwalk" is still read by its own template', () => {
    for (const text of ['Other Merfolk you control have planeswalk.', 'Other Merfolk you control have creaturewalk.', 'Other Merfolk you control have walk.']) {
      expect(fullyAutomated(lord(text)), text).toBe(false);
    }
    const line = lord('Swampwalk');
    expect(line.templatesUsed).toContain('kw.walk.swamp');
    expect(fullyAutomated(line)).toBe(true);
  });
  it('CR 205.3m: every creature type whose Oracle plural is spelled like the singular is printed that way ("Treefolk you control", "Other Myr you control")', () => {
    const same = (lexicon as { subtypes: { singular: string; plural: string; class: string }[] }).subtypes.filter((s) => s.class === 'creature' && s.singular === s.plural);
    expect(same.length).toBeGreaterThan(20);
    for (const s of same) expect(pluralize(s.singular), s.singular).toBe(s.singular);
    for (const text of ['Treefolk you control have hexproof.', 'Other Myr you control get +1/+1.', 'Other Samurai you control have vigilance.', 'Kor and Allies you control have flying.']) {
      expect(fullyAutomated(lord(text)), text).toBe(true);
    }
  });
  it('CR 205.3m: "creatures you control that are Wolves or Werewolves" is read and printed as the creatures with either subtype', () => {
    const f = lord('Other creatures you control that are Wolves or Werewolves have trample.', 'Creature — Wolf');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(bare(f.abilities))).toContain('"anyOf":[{"subtypes":["Wolf"]},{"subtypes":["Werewolf"]}]');
    expect(fullyAutomated(lord('Other creatures you control that are Wolves and Werewolves have trample.', 'Creature — Wolf'))).toBe(false);
  });
});

/** The golden review (design 6.9): which real cards were checked by hand, and for which reading. */
describe('C3 golden review file (test/m5/golden/cards/cloud-c3-review.json)', () => {
  it('names the reading each entry verifies, and expects the card full (or says what stays manual)', () => {
    const golden = review as { card: string; expect?: string; verified: string }[];
    expect(golden.length).toBeGreaterThanOrEqual(3);
    for (const g of golden) {
      // a card the follow-up leaves partial names the abilities that stay manual (they are not in its entry)
      if (g.expect !== 'full') expect(g.verified, g.card).toMatch(/stays? manual/);
      expect(g.verified, g.card).toMatch(/^Cloud C3 (follow-up \(cloud batch 3\) )?review, by hand/);
      expect(g.verified, g.card).toMatch(/CR \d/);
    }
  });
});

const index = localIndex();

describe.skipIf(index === null)('C3 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it('no C3 example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = C3.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
  it('reports, per template, the real cards that read a line with it (design 6.9 evidence; listed for review, every one passes the render gate)', () => {
    const counts: Record<string, string[]> = Object.fromEntries(C3.map((t) => [t.id, []]));
    for (const c of index ?? []) {
      const text = [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].join('\n');
      if (!/untap step|as long as|during your turn/i.test(text)) continue;
      const parsed = parseCard(c, OPTS);
      for (const f of parsed.faces) {
        for (const id of f.templatesUsed) {
          if (counts[id] === undefined) continue;
          counts[id].push(c.name);
          // the automated abilities pass the exact render gate (a manual ability of the same face is another line's business)
          expect(f.abilities.every((a, i) => a.kind === 'manual' || f.gate[i]?.ok !== false), c.name).toBe(true);
        }
      }
    }
    console.log(Object.entries(counts).map(([id, names]) => `${id}: ${names.length} (${names.slice(0, 8).join(', ')})`).join('\n'));
  }, 300_000);
  it('the golden cards compile full (the lords with the landwalk they grant, the goad and untap riders), or partial where the entry says what stays manual', () => {
    for (const g of review as { card: string; expect?: string }[]) {
      const oracle = (index ?? []).find((c) => c.name === g.card);
      expect(oracle, g.card).toBeDefined();
      expect(compileCard(oracle!).automation.level, g.card).toBe(g.expect === 'full' ? 'full' : 'partial');
    }
  }, 60_000);
});
