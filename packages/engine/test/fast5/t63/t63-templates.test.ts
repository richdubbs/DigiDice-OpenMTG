/**
 * FAST5 T63 (casting permissions, free casts and cost / entry statics): the template data of parser/templates/zz-fast5/t63.json.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability (G2).
 * Examples are synthetic wordings (design 6.10), checked against the local index when it is present; the real cards each template reads are checked there too
 * (the try step of CONTRIBUTING "Adding a template").
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T63 templates compose with every other file. The shapes
 * "you've sacrificed an artifact this turn" and "it's your first, second, or third turn of the game" are atoms of the Cond hole (parser/holes/cond.ts), read by
 * templates of other files (cm.self.less.if, the unblockable and enters-tapped statics); their tests are at the end.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t63 from '../../../src/parser/templates/zz-fast5/t63.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T63 = t63 as Template[];

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards, or, for a sentence that only a few real cards print, every one of them (the index
 * check below proves there are no others). Each of these sentences is printed by one or two cards of the whole corpus.
 */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp }>> = {
  'eff.t63.cast.noncreature.fromHand.free': { cards: ['Yue, the Moon Spirit'], line: /you may cast a noncreature spell from your hand without paying its mana cost/i },
  'sta.t63.first.spell.less.flash': { cards: ['Radagast of Rhosgobel'], line: /costs \{\d\} less to cast and can be cast as though it had flash/i },
  'cm.t63.first.spell.yourTurns.less': { cards: ['Momo, Friendly Flier'], line: /spell[a-z -]* with [a-z]+ you cast during each of your turns costs \{\d\} less to cast/i },
  'cm.t63.ability.less.attackedWith': { cards: ['Thaumaton Torpedo'], line: /costs \{\d\} less to activate if you attacked with/i },
  'cm.t63.ability.less.control': { cards: ['Esquire of the King', 'Starport Security'], line: /costs \{\d\} less to activate if you control/i },
  'rep.t63.enters.tapped.notYourTurn': { cards: ['Eddymurk Crab'], line: /enters tapped if it's not your turn/i },
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a T63 example is an ability of the right kind (a spell for an effect, else a creature). */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.id.startsWith('eff.') && !/^(when|whenever|at) /i.test(text) && !/\}: /.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text);
}
/** `fullyAutomated`, and no cost part the model could not state. */
const fullyAutomatedWithCost = (f: ReturnType<typeof parsedWith>): boolean => fullyAutomated(f) && !JSON.stringify(f.abilities).includes('"kind":"manual"');
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('T63 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t63.json, path order: after zz-fast5/t50.json, before zz-fast5x/ and zz-m6/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t63.json');
    expect(files.indexOf('zz-fast5/t63.json')).toBeGreaterThan(files.indexOf('zz-fast5/t50.json'));
    expect(files.indexOf('zz-fast5/t63.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(T63.length).toBe(7);
    for (const t of T63) {
      expect(t.id, t.id).toMatch(/^(cm|eff|rep|sta)\.t63\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T63 template has its evidence: every card of the corpus that prints its sentence is named here (verified in the scenario tests and by hand)', () => {
    // the one template that reads a family of sentences ("you may cast <a card> this turn") is checked against the cards that use it in the index test below
    for (const t of T63.filter((x) => x.status === 'stable' && x.id !== 'eff.t63.cast.target.thisTurn')) expect(WHOLE_CORPUS[t.id], t.id).toBeDefined();
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T63) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'not']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
  it("the ability's cost change is lifted into the activated ability (`costChange`) as a count applied at most once, never left as a step (CR 601.2f, 602.2b)", () => {
    const f = parseCard(card('Example Brute', 'Creature — Elf Warrior', '{4}, {T}: Draw a card. This ability costs {2} less to activate if you control a Goblin. Activate only as a sorcery.'), OPTS).faces[0]!;
    const a = f.abilities.find((x) => x.kind === 'activated');
    expect(f.templatesUsed).toContain('cm.t63.ability.less.control');
    expect(a && a.kind === 'activated' ? [a.costChange?.kind, a.sorcerySpeed, a.effect.steps.map((x) => x.op)] : null).toEqual(['reduce', true, ['draw']]);
    // as a line of its own it is not an ability (the lowering takes it only inside an activated ability)
    const alone = parseCard(card('Example Brute', 'Creature — Elf Warrior', 'This ability costs {2} less to activate if you control a Goblin.'), OPTS).faces[0]!;
    expect(alone.abilities.every((x) => x.kind !== 'activated')).toBe(true);
    expect(automated(alone.abilities) && fullyAutomated(alone)).toBe(false);
  });
});

describe('T63 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T63) {
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
  // the T63 sentence is in the first line of every example; the lines after it only make the card complete
  const body = lines[0]!.replace(/\.$/, '');
  const tail = lines.slice(1).map((l) => `\n${l}`).join('');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/less/, 'more'], [/more/, 'less'], [/to activate/, 'to cast'], [/this turn/, 'next turn'], [/graveyard/, 'library'], [/from your hand/, 'from your graveyard'],
    [/noncreature/, 'creature'], [/each turn/, 'each combat'], [/flash/, 'haste'], [/during each of your turns/, 'during each opponent\'s turn'], [/you control/, 'an opponent controls'],
    [/you attacked/, 'an opponent attacked'], [/your turn/, 'an opponent\'s turn'], [/the first/, 'the second'], [/cast/, 'play'], [/you cast/, 'an opponent casts'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out.map((m) => `${m}${tail}`);
}

describe('T63 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T63) {
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

describe('T63 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T63) {
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

describe('T63 the Cond atoms read by the templates of other files (parser/holes/cond.ts; CR 701.21a, 500.1)', () => {
  const read = (type: string, text: string) => parseCard(card('Example Brute', type, text), OPTS).faces[0]!;
  it('"~ costs {3} less to cast if you\'ve sacrificed an artifact this turn" (cm.self.less.if): the sacrificed permanent must match the description', () => {
    const f = read('Sorcery', "~ costs {3} less to cast if you've sacrificed an artifact this turn.\n~ deals 2 damage to target creature.");
    expect(f.templatesUsed).toContain('cm.self.less.if');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"object":{"types":["Artifact"]}');
    // "a permanent" has its own reading (no description), and a count or another player is not this shape
    const any = read('Sorcery', "~ costs {3} less to cast if you've sacrificed a permanent this turn.\n~ deals 2 damage to target creature.");
    expect(fullyAutomated(any)).toBe(true);
    expect(JSON.stringify(any.abilities)).not.toContain('"object":{');
    for (const text of ["~ costs {3} less to cast if you've sacrificed two artifacts this turn.", "~ costs {3} less to cast if an opponent has sacrificed an artifact this turn."]) {
      expect(fullyAutomated(read('Sorcery', `${text}\n~ deals 2 damage to target creature.`)), text).toBe(false);
    }
  });
  it('"~ can\'t be blocked as long as you\'ve sacrificed an artifact this turn" (the unblockable static of zz-fast4/t33.json)', () => {
    const f = read('Creature — Rogue', "~ can't be blocked as long as you've sacrificed an artifact this turn.\nFlying");
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"action":"beBlocked"');
  });
  it('"~ enters tapped unless it\'s your first, second, or third turn of the game" (effect/replace.json): your turn, and at most your third turn begun', () => {
    for (const [words, n] of [['first or second', 2], ['first, second, or third', 3], ['first, second, third, or fourth', 4]] as const) {
      const f = read('Land', `~ enters tapped unless it's your ${words} turn of the game.\n{T}: Add {C}.`);
      expect(fullyAutomated(f), words).toBe(true);
      expect(JSON.stringify(f.abilities), words).toContain(`"op":"<=","right":${n}`);
    }
    for (const text of ["~ enters tapped unless it's your first, second, or fifth turn of the game.", "~ enters tapped unless it's the first, second, or third turn of the game.", "~ enters tapped unless it's your first, second, or third turn."]) {
      expect(fullyAutomated(read('Land', `${text}\n{T}: Add {C}.`)), text).toBe(false);
    }
  });
});

const index = localIndex();

describe.skipIf(index === null)('T63 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it('no T63 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\b(this (creature|land|artifact|enchantment|Aura|spell))\b/gi, '~').trim());
        }
      }
    }
    // the sentence with no word to vary: "~ enters tapped if it's not your turn." is a rules phrase fixed by its pattern (CR 614.1c)
    const FIXED_WORDING = new Set(['rep.t63.enters.tapped.notYourTurn']);
    // the lines that only complete an example card are not the T63 sentence
    const SETUP = new Set(['Flying', '{T}: Add {C}.']);
    const verbatim = T63.filter((t) => !FIXED_WORDING.has(t.id)).flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').slice(0, 1).some((l) => !SETUP.has(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards].sort());
    }
  }, 120_000);

  // the try step on real cards: each card's T63 line is read by the named template and passes the exact render gate, never manual on that line
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.t63.cast.noncreature.fromHand.free': ['Yue, the Moon Spirit'],
    'eff.t63.cast.target.thisTurn': ['Zul Ashur, Lich Lord', 'Norika Yamazaki, the Poet', 'Heiko Yamazaki, the General'],
    'sta.t63.first.spell.less.flash': ['Radagast of Rhosgobel'],
    'cm.t63.first.spell.yourTurns.less': ['Momo, Friendly Flier'],
    'cm.t63.ability.less.attackedWith': ['Thaumaton Torpedo'],
    'cm.t63.ability.less.control': ['Esquire of the King', 'Starport Security'],
    'rep.t63.enters.tapped.notYourTurn': ['Eddymurk Crab'],
  };
  const LINE = /cast a noncreature spell from your hand|you may cast target|can be cast as though it had flash|during each of your turns costs|less to activate if you (attacked with|control)|enters tapped if it's not your turn/i;
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
  it('the real cards whose line is read by the Cond atoms (Suspicious Detonation, Count Nefaria, Furtive Courier, Starting Town) are automated for that line', () => {
    for (const [name, re] of [['Suspicious Detonation', /sacrificed an artifact/], ['Count Nefaria', /sacrificed a permanent/], ['Furtive Courier', /sacrificed an artifact/], ['Starting Town', /first, second, or third turn/]] as const) {
      const c = (index ?? []).find((x) => x.name === name);
      expect(c, name).toBeDefined();
      const manual = compileCard(c!).faces[0]!.abilities.filter((a) => a.kind === 'manual' && re.test(a.text));
      expect(manual.map((a) => a.text), name).toEqual([]);
    }
  });
});
