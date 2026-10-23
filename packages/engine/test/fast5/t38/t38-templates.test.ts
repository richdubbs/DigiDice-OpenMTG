/**
 * FAST5 T38 (cost reductions, mana produced of a type, Attractions): the template data of parser/templates/zz-fast5/t38.json.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present; the real cards each template reads are checked
 * there too (the try step of CONTRIBUTING "Adding a template").
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T38 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t38 from '../../../src/parser/templates/zz-fast5/t38.json';
import review from '../../m5/golden/cards/fast5-t38-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T38 = t38 as Template[];

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards (test/m5/golden/cards/fast5-t38-review.json), or, for a sentence that only
 * two real cards print, both of them (every corpus match reviewed; the index check below proves there is no third).
 */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp }>> = {
  'rep.t38.enters.copy.subtypes': { cards: ['Glasspool Mimic // Glasspool Shore', 'Visage Bandit'], line: /enter as a copy of a creature you control, except it's a Shapeshifter Rogue in addition to its other types/i },
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a T38 example is an ability of the right kind (a spell for an effect, else a creature). */
function exampleCard(t: Template, text: string): OracleCard {
  // an effect on its own line is a spell; a triggered or activated ability, and the statics, are a creature's
  if (t.id.startsWith('eff.') && !/^(when|whenever|at) /i.test(text) && !/\}: /.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text);
}
/** `fullyAutomated`, and no cost part the model could not state (`automated` looks at steps and abilities only, so a nonsense word in a cost would pass). */
const fullyAutomatedWithCost = (f: ReturnType<typeof parsedWith>): boolean => fullyAutomated(f) && !JSON.stringify(f.abilities).includes('"kind":"manual"');
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('T38 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t38.json, path order: after zz-fast4/, before zz-m6/ and zz-push/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t38.json');
    expect(files.indexOf('zz-fast5/t38.json')).toBeGreaterThan(files.indexOf('zz-fast4/t34.json'));
    expect(files.indexOf('zz-fast5/t38.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 7', () => {
    expect(T38.length).toBe(6); // the bargain reduction is read by FAST5X E1's cm.fast5x.self.less.bargained (one reading, merge of FAST5 batch 3)
    for (const t of T38) {
      expect(t.id, t.id).toMatch(/^(cm|eff|rep)\.t38\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(7);
    }
  });
  it('design 6.9: a stable T38 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of T38.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole.cards].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T38) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
  it("the ability's cost change is lifted into the activated ability (`costChange`), never left as a step, and only after an effect sentence (CR 601.2f, 602.2b)", () => {
    const f = parseCard(card('Example Brute', 'Creature — Elf Warrior', '{4}, {T}: Draw a card. This ability costs {1} less to activate for each legendary creature you control. Activate only as a sorcery.'), OPTS).faces[0]!;
    const a = f.abilities.find((x) => x.kind === 'activated');
    expect(f.templatesUsed).toContain('cm.t38.ability.less.foreach');
    expect(a && a.kind === 'activated' ? [a.costChange?.kind, a.sorcerySpeed, a.effect.steps.map((x) => x.op)] : null).toEqual(['reduce', true, ['draw']]);
    // as a line of its own it is not an ability (the lowering takes it only inside an activated ability)
    const alone = parseCard(card('Example Brute', 'Creature — Elf Warrior', 'This ability costs {1} less to activate for each legendary creature you control.'), OPTS).faces[0]!;
    expect(alone.abilities.every((x) => x.kind !== 'activated')).toBe(true);
    expect(automated(alone.abilities) && fullyAutomated(alone)).toBe(false);
  });
});

describe('T38 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T38) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(fullyAutomatedWithCost(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
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
  const lines = text.split('\n');
  // the T38 sentence is in the first line of every example; the lines after it only make the card complete
  const body = lines[0]!.replace(/\.$/, '');
  const tail = lines.slice(1).map((l) => `\n${l}`).join('');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/less/, 'more'], [/more/, 'less'], [/for each/, 'for every'], [/party/, 'graveyard'], [/to activate/, 'to cast'], [/produced/, 'tapped'],
    [/one mana/, 'two mana'], [/land/, 'creature'], [/this turn/, 'next turn'], [/additional/, 'extra'], [/in addition to its other types/, 'instead'],
    [/bargained/, 'kicked'], [/an Attraction/, 'two Attractions'], [/legendary/, 'nonlegendary'], [/you control/, 'an opponent controls'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out.map((m) => `${m}${tail}`);
}

describe('T38 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T38) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
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

describe('T38 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T38) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || /^"?\{/.test(w) || w.includes('\n')) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomatedWithCost(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('T38 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  // the one sentence with no word to vary: "Cast ~ only during combat before blockers are declared." is a rules phrase fixed by its pattern (CR 601.3)
  const FIXED_WORDING = new Set<string>();
  // the lines that only complete an example card ("Flying") are not the T38 sentence
  const SETUP = new Set(['Flying']);
  it('no T38 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = T38.filter((t) => !FIXED_WORDING.has(t.id)).flatMap((t) =>
      [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').slice(0, 1).some((l) => !SETUP.has(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card's T38 line is read by the named template and passes the exact render gate, never manual on that line
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.t38.openAttraction': ['Discourtesy Clerk', 'Seasoned Buttoneer', 'Rad Rascal', 'Coming Attraction', 'Soul Swindler'],
    'eff.t38.mana.producedType.player': ['Mana Flare', 'Dictate of Karametra', 'Zhur-Taa Ancient'],
    'cm.t38.self.less.party': ['Deadly Alliance', 'Journey to Oblivion', 'Shatterskull Minotaur', 'Coveted Prize', 'Thwart the Grave', 'Zagras, Thief of Heartbeats'],
    'cm.fast5x.self.less.bargained': ['Hamlet Glutton', "Johann's Stopgap", 'Ice Out'], // FAST5X E1 reads this line (T38's duplicate was dropped at the merge)
    'cm.t38.ability.less.foreach': ['Mirror of Galadriel', 'Sanctum of Tranquil Light', 'The Lonely Mountain', 'Waterbending Scroll', 'Qiqirn Merchant'],
    'rep.t38.enters.copy.subtypes': ['Glasspool Mimic // Glasspool Shore', 'Visage Bandit'],
    'eff.t38.permit.extraLand.thisTurn': ['Scale the Heights', "Azusa's Many Journeys // Likeness of the Seeker", 'Beorn, Reluctant Host // Till and Tend'],
  };
  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards].sort());
    }
  }, 120_000);
  const LINE = /open an attraction|one mana of any type that|in your party|if it's bargained|less to activate|enter as a copy of a creature you control, except it's a|play an additional land this turn/i;
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read the line with it, pass the render gate and leave no manual ability for it`, () => {
      for (const name of names) {
        const c = (index ?? []).find((x) => x.name === name);
        expect(c, name).toBeDefined();
        const used = parseCard(c!, OPTS).faces.flatMap((f) => f.templatesUsed); // every face: the template may read the adventure or the back face
        expect(used, name).toContain(id);
        const def = compileCard(c!);
        const manual = def.faces[0]!.abilities.filter((a) => a.kind === 'manual' && LINE.test(a.text));
        expect(manual.map((a) => a.text), name).toEqual([]);
      }
    });
  }
});
