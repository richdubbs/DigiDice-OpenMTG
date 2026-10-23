/**
 * FAST5 T76 (pronoun antecedents after counters, tokens and blinks): the template data of parser/templates/zz-fast5/t76.json ("It gains haste." / "That token gains
 * haste." with no duration, "They gain menace and haste until end of turn.", "Sacrifice them at the beginning of the next end step.", "If it's a creature, it also has
 * base power and toughness 2/2 until your next turn.") and the focus rule they rest on (model/focus.ts: the token the sentence before created, or the one object it worked
 * on, is what a bare pronoun means; parser/lower/anaphora.ts#focusAt, render/steps.ts#clausesOf, render/refs.ts#candidateCheck).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10); the real cards each template reads are checked against the local index when it is present.
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T76 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t76 from '../../../src/parser/templates/zz-fast5/t76.json';
import review from '../../m5/golden/cards/fast5-t76-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T76 = t76 as Template[];

/** Design 6.9 evidence for a stable template: three hand-verified golden cards, or, for a sentence only one real card prints, that card. */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp }>> = {
  'eff.t76.if.also.basept': { cards: ['Azure Beastbinder'], line: /if it's an? [a-z]+, it also has base power and toughness \d+\/\d+ until your next turn/i },
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a T76 example is an ability of the right kind (a trigger is a creature's, an effect on its own a spell's). */
function exampleCard(text: string): OracleCard {
  if (/^(when|whenever|at) /i.test(text)) return card('Example Brute', 'Creature — Elf Warrior', text);
  return card('Example Volley', 'Sorcery', text);
}
const parsedWith = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

describe('T76 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t76.json, path order: after zz-fast4/, before zz-m6/ and zz-push/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t76.json');
    expect(files.indexOf('zz-fast5/t76.json')).toBeGreaterThan(files.indexOf('zz-fast4/t34.json'));
    expect(files.indexOf('zz-fast5/t76.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5)', () => {
    expect(T76.length).toBe(4);
    for (const t of T76) {
      expect(t.id, t.id).toMatch(/^eff\.t76\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T76 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of T76.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole.cards].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T76) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('T76 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T76) {
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
    [/gains/, 'loses'], [/gain\b/, 'lose'], [/Sacrifice/, 'Exile'], [/It gains/, 'Target creature gains'], [/They gain/, 'Each creature gains'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('T76 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T76) {
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

describe('T76 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T76) {
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

describe('T76 the focus rule (model/focus.ts): what it decides and what it leaves to the unique-candidate rule (design 6.4)', () => {
  const faceOf = (text: string, type: string) => parseCard(card('Focus Probe', type, text), OPTS).faces[0]!;
  const json = (text: string, type = 'Creature — Elf Warrior'): string => JSON.stringify(faceOf(text, type).abilities);
  const understood = (text: string, type = 'Creature — Elf Warrior'): boolean => fullyAutomated(faceOf(text, type));

  it('a bare pronoun after a token creation is the token, not the trigger\'s source ("Put three +1/+1 counters on it" lands on the bound token)', () => {
    const j = json('When ~ enters, create a 0/0 green Fractal creature token. Put three +1/+1 counters on it.');
    expect(j).toMatch(/"op":"createToken"[^]*"as":"(\w+)"[^]*"op":"putCounters","on":\{"ref":"bound","name":"\1"\}/);
    expect(j).not.toContain('"on":{"ref":"self"}');
  });
  it('a bare pronoun after counters on ~ is ~ itself, not the spell that triggered it ("It gains flying" affects self)', () => {
    const j = json('Whenever you cast a noncreature spell, put a +1/+1 counter on ~. It gains flying until end of turn.');
    expect(j).toContain('"affects":{"ref":"self"}');
    expect(j).not.toContain('"role":"spell"');
  });
  it('the focus is kept by the instructions that act only on it ("It gains haste. Sacrifice it ..." both name the token)', () => {
    const j = json("Create a token that's a copy of target creature you control. It gains haste until end of turn. Sacrifice it at the beginning of the next end step.", 'Sorcery');
    expect(j).toMatch(/"affects":\{"ref":"bound","name":"(\w+)"\}/);
    expect(j).toMatch(/"op":"sacrifice","what":\{"ref":"bound"/);
    expect(j).not.toMatch(/"op":"sacrifice","what":\{"ref":"target"/);
  });
  it('a sentence with a target of its own does not use it ("... Target creature gets +1/+1 and it gains trample" stays ambiguous: manual)', () => {
    expect(understood('Create a 1/1 white Soldier creature token. Target creature you control gets +1/+1 and it gains trample until end of turn.', 'Sorcery')).toBe(false);
  });
  it('"that creature" keeps the unique-candidate rule: two creature targets stay ambiguous (design 6.4, D12)', () => {
    expect(understood('Target creature gets +1/+1 until end of turn. Target creature gets -1/-1 until end of turn. Destroy that creature.', 'Sorcery')).toBe(false);
  });
  it('a sentence the parser does not understand ends the focus (the pronoun stays manual, and so is the sentence)', () => {
    expect(understood('Create a 1/1 white Soldier creature token. Frobnicate the zorp. It gains haste until end of turn.', 'Sorcery')).toBe(false);
  });
  it('an instruction that works on nothing nameable ends the focus (draw): the pronoun stays ambiguous', () => {
    expect(understood('Whenever you cast a noncreature spell, put a +1/+1 counter on target creature you control. Draw a card. It gains flying until end of turn.')).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('T76 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it('no T76 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = T76.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards].sort());
    }
  }, 120_000);

  // the try step on real cards: each card's T76 line is read by the named template and the card has no manual ability left on that line
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.t76.gain.perm': ["Saheeli, the Sun's Brilliance", 'Chrome Dome', 'Sneak Attack'],
    'eff.t76.they.gain': ['Mardu Monument', 'Salt Road Skirmish', 'Sandstorm Salvager'],
    'eff.t76.sacrifice.them': ['Salt Road Skirmish', 'Push // Pull'],
    'eff.t76.if.also.basept': ['Azure Beastbinder'],
  };
  const LINE = /(gains? [a-z, ]+\.|sacrifice them|also has base power and toughness)/i;
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read the line with it, pass the render gate and leave no manual ability for it`, () => {
      for (const name of names) {
        const oracle = (index ?? []).find((c) => c.name === name);
        expect(oracle, name).toBeDefined();
        const c = compileCard(oracle!);
        const lineOk = c.faces.every((f) => f.abilities.every((a) => !(a.kind === 'manual' && LINE.test(a.text))));
        expect(lineOk, name).toBe(true);
        const parsed = parseCard(oracle!, OPTS);
        expect(parsed.faces.flatMap((f) => f.templatesUsed), name).toContain(id);
        expect(parsed.faces.every((f) => f.gate.every((g) => g.ok)), name).toBe(true);
      }
    }, 60_000);
  }
});

describe('T76 the shapes of the family in their context (synthetic wordings): each is understood, and its pronoun is bound to the intended object', () => {
  const faceOf = (text: string, type: string) => parseCard(card('Shape Probe', type, text), OPTS).faces[0]!;
  const CREATURE = 'Creature — Elf Warrior';
  const cases: [string, string, string, RegExp][] = [
    ['it can\'t be blocked this turn', CREATURE, 'Whenever you cast your second spell each turn, put a +1/+1 counter on ~. It can\'t be blocked this turn.', /"affects":\{"ref":"self"\}|"subject":\{"ref":"self"\}/],
    ['then if it has N or more counters on it, draw a card', 'Enchantment', 'Whenever a creature you control deals combat damage to a player, put a quest counter on ~. Then if it has four or more quest counters on it, draw a card.', /"op":"draw"/],
    ['it becomes unprepared', 'Enchantment — Aura', 'Enchant creature\nWhen this Aura enters, tap enchanted creature. It becomes unprepared.', /"designation":"unprepared"[^]*|"what":\{"ref":"attachedTo"\}/],
    ['that token gains <keyword>', 'Artifact', '{5}: Create a token that\'s a copy of another target artifact you control. That token gains haste. Sacrifice it at the beginning of the next end step.', /"affects":\{"ref":"bound"/],
    ['it gains <keyword>, <keyword>, and <keyword> until end of turn', 'Sorcery', 'Create a 1/1 white Soldier creature token. It gains flying, first strike, and vigilance until end of turn.', /"affects":\{"ref":"bound"/],
    ['they gain <keyword> and <keyword> until end of turn', 'Sorcery', 'Create two 1/1 red Warrior creature tokens. They gain menace and haste until end of turn.', /"affects":\{"ref":"bound"/],
    ['untap those <types>', 'Sorcery', 'Put a +1/+1 counter on each creature you control. Untap those creatures.', /"op":"untap","what":\{"ref":"bound"/],
    ['if you controlled it, return it to the battlefield tapped', CREATURE, 'When ~ enters, exile another target nonland permanent. If you controlled it, return it to the battlefield tapped. Otherwise, its controller creates a 2/2 white and blue Detective creature token.', /"op":"move"/],
  ];
  for (const [name, type, text, expected] of cases) {
    it(`${name}: "${text.replace(/\n/g, ' / ').slice(0, 90)}"`, () => {
      const f = faceOf(text, type);
      expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
      expect(f.gate.every((g) => g.ok)).toBe(true);
      expect(JSON.stringify(f.abilities)).toMatch(expected);
    });
  }
});
