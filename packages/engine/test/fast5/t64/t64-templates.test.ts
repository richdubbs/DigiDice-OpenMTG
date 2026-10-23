/**
 * FAST5 T64 (copy effects: clones, become-a-copy, token copies): the template data of parser/templates/zz-fast5/t64.json.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present; the real cards each template reads are checked
 * there too (the try step of CONTRIBUTING "Adding a template").
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T64 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t64 from '../../../src/parser/templates/zz-fast5/t64.json';
import review from '../../m5/golden/cards/fast5-t64-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T64 = t64 as Template[];

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards (test/m5/golden/cards/fast5-t64-review.json), or, for a sentence that only
 * a few real cards print, every one of them (every corpus match reviewed; the index check below proves there is no other).
 */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp }>> = {
  'eff.t64.copy.token.subtypeCreature': { cards: ['Mirror Room // Fractured Realm'], line: /create a token that's a copy of [^,.]+, except it's an? [A-Za-z ]+ in addition to its other creature types/i },
  'eff.t64.each.becomeCopy': { cards: ['Mirrorform'], line: /^Each (?:(?!other)[^,.])+ becomes a copy of (?:(?!until)[^,.])+\.$/im },
  'eff.t64.becomeCopy.second.untilEot.notLegendary': { cards: ['Shuri, Wakandan Inventor'], line: /becomes a copy of a second target [^,.]+ until end of turn, except it isn't legendary/i },
  'rep.t64.enters.copy.keepName': { cards: ['Chameleon, Master of Disguise'], line: /enter as a copy of an? [^,.]+, except (?:his|her|its|their) name is (?!.* and it )[^.]+\.$/im },
  'rep.t64.enters.copy.subtypeAbility.a': { cards: ['Mockingbird'], line: /enter as a copy of any [^,.]+, except it's an? [A-Za-z ]+ in addition to its other types and it has (?!")[a-z ]+\./i },
  'rep.t64.enters.copy.tapped.graveyard.subtype': { cards: ['Echoing Deeps'], line: /enter tapped as a copy of any [^,.]+ in a graveyard, except it's an? [A-Za-z ]+ in addition to its other types/i },
  // three more cards print the bare sentence ("create a token that's a copy of your commander, except it's not legendary"); their clauses around it are not read yet, so the line is the one in context
  'eff.t64.copy.token.notLegendary.not': { cards: ['Ran and Shaw'], line: /enter, if you cast [^,]+ and there are [^,]+, create a token that's a copy of [^,.]+, except it's not legendary\./i },
  'eff.t64.copy.tokens.notLegendary': { cards: ['The Notary Hobbits'], line: /tokens that are copies of [^,.]+, except the tokens aren't legendary/i },
  'eff.t64.forEach.copyTokens.thatPermanent': { cards: ['Doppelgang'], line: /for each of [^,.]+, create [^,.]+ tokens that are copies of that permanent/i },
  'eff.t64.forEach.copyTapped': { cards: ['Kambal, Profiteering Mayor'], line: /for each of [^,.]+, create a tapped token that's a copy of it/i },
  'eff.t64.becomeCopy.battlefieldOrGraveyard.legendary': { cards: ['Taskmaster, Mercenary Mimic'], line: /becomes a copy of up to one target creature on the battlefield or creature card in a graveyard/i },
  'eff.t64.becomeCopy.artifactEnchantmentLand.villain': { cards: ['Absorbing Man'], line: /becomes a copy of up to one target artifact, non-Aura enchantment, or land/i },
  'eff.t64.may.becomeCopy.creatureCardExiledWithIt': { cards: ['Lazav, Wearer of Faces'], line: /you may have [^,.]+ become a copy of a creature card exiled with/i },
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a T64 example is an ability of the right kind (a spell for an effect, else a creature). */
function exampleCard(t: Template, text: string): OracleCard {
  // an effect on its own line is a spell; a triggered or activated ability, and the statics, are a creature's
  if (t.id.startsWith('eff.') && !/^(when|whenever|at) /i.test(text) && !/\}: /.test(text)) return card('Example Volley', 'Sorcery', text, /\bX\b/.test(text) ? { mana_cost: '{X}{G}' } : {});
  return card('Example Brute', 'Creature — Elf Warrior', text);
}
/** `fullyAutomated`, and no cost part the model could not state (`automated` looks at steps and abilities only, so a nonsense word in a cost would pass). */
const fullyAutomatedWithCost = (f: ReturnType<typeof parsedWith>): boolean => fullyAutomated(f) && !JSON.stringify(f.abilities).includes('"kind":"manual"');
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('T64 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t64.json, path order: after zz-fast5/t50.json, before zz-fast5x/ and zz-m6/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t64.json');
    expect(files.indexOf('zz-fast5/t64.json')).toBeGreaterThan(files.indexOf('zz-fast5/t50.json'));
    expect(files.indexOf('zz-fast5/t64.json')).toBeLessThan(files.indexOf('zz-fast5x/e1.json'));
    expect(files.indexOf('zz-fast5/t64.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(T64.length).toBe(13);
    for (const t of T64) {
      expect(t.id, t.id).toMatch(/^(eff|rep)\.t64\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T64 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of T64.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole.cards].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T64) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
  it('a template whose output needs the copy-choice capability says so (`needs`), and the engine has it (a copy effect that picks one object, effects/copy.ts)', () => {
    const lazav = T64.find((t) => t.id === 'eff.t64.may.becomeCopy.creatureCardExiledWithIt')!;
    expect(lazav.needs).toEqual(['feature:copy.choose']);
    expect(ENGINE_CAPABILITIES.has('feature:copy.choose')).toBe(true);
  });
  it('the literal target phrase of a template (`$target` in its build) is the phrase the pattern spells, word for word', () => {
    for (const t of T64) {
      const found: { text: string }[] = [];
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v !== null && typeof v === 'object') {
          const o = v as Record<string, unknown>;
          if (o['$target'] !== undefined) found.push(o['$target'] as { text: string });
          Object.values(o).forEach(walk);
        }
      };
      walk(t.build);
      for (const f of found) expect(t.pattern.toLowerCase().replace(/ ,/g, ',')).toContain(f.text.toLowerCase());
    }
  });
});

describe('T64 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T64) {
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
  // the T64 sentence is the last line of an example (the Lazav example has the ability that exiles the card before it, CR 607.2a); the lines before it only make the card complete
  const lines = text.split('\n');
  const head = lines.slice(0, -1).map((l) => `${l}\n`).join('');
  const body = lines[lines.length - 1]!.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`].map((m) => `${head}${m}`);
  const swaps: [RegExp, string][] = [
    [/until your next turn/, 'until end of turn'], [/until end of turn/, 'until your next turn'], [/legendary/, 'nonlegendary'], [/second/, 'third'], [/two/, 'three'], [/in addition to/, 'instead of'],
    [/tapped/, 'untapped'], [/each/, 'every'], [/you control/, 'an opponent controls'], [/creature/, 'artifact'], [/becomes/, 'becomes not'], [/copy/, 'copies'], [/enter tapped/, 'enter'], [/may/, 'must'],
    [/exiled with/, 'exiled by'], [/graveyard/, 'hand'], [/tokens/, 'creatures'], [/that permanent/, 'that player'], [/up to one/, 'two'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${head}${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('T64 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T64) {
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

describe('T64 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T64) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || /^\{/.test(w) || /^"?\{/.test(w) || w.includes('\n')) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomatedWithCost(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('T64: what the parser-side support reads (parser/front/selfref.ts, holes/cond.ts, chart.ts)', () => {
  it('CR 201.5, design 6.4: the plural pronouns of a plural-named legendary permanent are read as itself, and only then', () => {
    const own = (name: string, typeLine: string, text: string): OracleCard => card(name, typeLine, text);
    // plural name, plural verb, no player: "they" and "them" are the permanent (a trigger with an intervening "if", CR 603.4)
    const ok = parseCard(own('Fox and Hound', 'Legendary Creature — Fox Dog', 'When Fox and Hound enter, if they\'re not a token, create two tokens that are copies of them, except the tokens aren\'t legendary.'), OPTS).faces[0]!;
    expect(ok.templatesUsed).toContain('eff.t64.copy.tokens.notLegendary');
    expect(fullyAutomatedWithCost(ok)).toBe(true);
    // a singular verb: the name is one character, "they" stays unread
    const singular = parseCard(own('Fox and Hound', 'Legendary Creature — Fox Dog', 'When Fox and Hound enters, if they\'re not a token, create two tokens that are copies of them, except the tokens aren\'t legendary.'), OPTS).faces[0]!;
    expect(fullyAutomatedWithCost(singular)).toBe(false);
    // a player in the text: "they" may be that player (Oracle's singular they)
    const player = parseCard(own('Fox and Hound', 'Legendary Creature — Fox Dog', 'When Fox and Hound enter, each opponent discards a card. If they\'re not a token, create two tokens that are copies of them, except the tokens aren\'t legendary.'), OPTS).faces[0]!;
    expect(fullyAutomatedWithCost(player)).toBe(false);
    // not legendary: no pronoun is read
    const plain = parseCard(own('Fox and Hound', 'Creature — Fox Dog', 'When Fox and Hound enter, if they\'re not a token, create two tokens that are copies of them, except the tokens aren\'t legendary.'), OPTS).faces[0]!;
    expect(fullyAutomatedWithCost(plain)).toBe(false);
  });
  it('CR 601.2a, 603.4: "if you cast ~" is the object itself cast by its controller (`wasCast` by "you"), and only that', () => {
    const f = parseCard(card('Example Brute', 'Creature — Elf Warrior', 'When ~ enters, if you cast ~, draw a card.'), OPTS).faces[0]!;
    const a = f.abilities[0] as unknown as { interveningIf?: unknown };
    expect(a.interveningIf).toEqual({ cond: 'wasCast', by: 'you' });
    expect(fullyAutomatedWithCost(f)).toBe(true);
  });
  it('a literal target phrase in a build must be spelled as the Obj hole writes it (chart.ts: `$target` is {kind, min, max, text, filter?})', () => {
    const broken: Template = { ...T64.find((t) => t.id === 'eff.t64.becomeCopy.battlefieldOrGraveyard.legendary')!, id: 'eff.t64.test.broken', build: { op: 'effect', what: { ref: 'target', id: '', $target: { kind: 'object' } } } };
    expect(validateTemplates([broken]).map((e) => e.message).join()).toMatch(/\$target must be/);
  });
});

const index = localIndex();

describe.skipIf(index === null)('T64 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  const FIXED_WORDING = new Set<string>();
  // the lines that only complete an example card are not the T64 sentence
  const SETUP = new Set<string>(['Whenever ~ attacks, exile target card from a graveyard.']);
  it("no T64 line of an example or counter-example is a line of a real card (with the card's own name or \"this <type>\" read as \"~\")", () => {
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
    const verbatim = T64.filter((t) => !FIXED_WORDING.has(t.id)).flatMap((t) =>
      [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !SETUP.has(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card's T64 line is read by the named template and passes the exact render gate, never manual on that line
  const REAL: Readonly<Record<string, readonly string[]>> = {};
  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards].sort());
    }
  }, 120_000);
  const LINE = /become[s]? a copy of|a copy of [^,.]+, except|enter(?:s)? (?:tapped )?as a copy of|tokens that are copies of/i;
  const ALL: Readonly<Record<string, readonly string[]>> = Object.fromEntries(Object.entries(WHOLE_CORPUS).map(([id, w]) => [id, w.cards])) as Record<string, readonly string[]>;
  for (const [id, names] of Object.entries({ ...ALL, ...REAL })) {
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
