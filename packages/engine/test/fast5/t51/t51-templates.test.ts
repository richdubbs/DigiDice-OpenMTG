/**
 * FAST5 T51: the template data of parser/templates/zz-fast5/t51.json ("put a +1/+1 counter on ~ and it can't be blocked this turn", "creatures you control get
 * +1/+0 until end of turn for each color of mana spent to cast that spell", "~ enters with a number of +1/+1 counters on it equal to the amount of mana spent to cast
 * it") and the hole-grammar, lowering and renderer readings the package's shapes needed (design 6.8 G6: parser/holes/cond.ts "N or more mana was spent to cast that
 * spell" / "{R}{R} was spent to cast it" / "it wasn't cast or no mana was spent to cast it", parser/holes/qty.ts "the amount of mana spent to cast ~ / that spell",
 * parser/lower/anaphora.ts the `$spell` marker, render/cond.ts, render/qty.ts, render/steps-life.ts "~ deal"). Guard G9 (design 6.8): every example lowers with its
 * template, is fully automated and passes the exact render gate; every counter-example does not parse or parses to different JSON; near-miss mutations fail or
 * differ; a nonsense word in place of any word of an example never leaves an automated ability (G2). Examples are synthetic wordings (design 6.10).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T51 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t51 from '../../../src/parser/templates/zz-fast5/t51.json';
import { automated, bare, exampleCard, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T51 = t51 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2)
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const face = (type: string, text: string) => parseCard({ name: 'Example Charm', layout: 'normal', type_line: type, oracle_text: text } as never, OPTS).faces[0]!;
const abilities = (f: ReturnType<typeof face>) => f.abilities as unknown as Record<string, unknown>[];
const steps = (a: Record<string, unknown> | undefined) => (a!['effect'] as { steps: unknown[] }).steps;

describe('T51 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5/t51.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t51.json');
    expect(files.indexOf('zz-fast5/t51.json')).toBeGreaterThan(files.indexOf('zz-fast5/t41.json'));
    expect(files.indexOf('zz-fast5/t51.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5)', () => {
    expect(T51.length).toBe(2);
    for (const t of T51) {
      expect(['static', 'effect'], t.id).toContain(t.kind);
      expect(t.id, t.id).toMatch(/^(rep|eff|sta)\.t51\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T51) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't", 'alone']) {
        if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
      }
    }
  });
});

describe('T51 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T51) {
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

/** The shapes of the hole grammars (Cond / Qty), as whole abilities: invented wordings (design 6.10). */
const SHAPES: { type: string; text: string }[] = [
  { type: 'Creature — Elf', text: 'Whenever you cast a noncreature spell, if at least four mana was spent to cast it, put a +1/+1 counter on ~.' },
  { type: 'Creature — Elf', text: 'Whenever you cast an instant or sorcery spell, if six or more mana was spent to cast that spell, draw a card.' },
  { type: 'Creature — Elf', text: 'Whenever you cast a noncreature spell, if at least four mana was spent to cast it, create a Treasure token.' },
  { type: 'Artifact — Vehicle', text: 'Whenever you cast a noncreature spell, if at least four mana was spent to cast it, ~ becomes an artifact creature until end of turn.' },
  { type: 'Creature — Elf', text: 'Whenever you cast an instant or sorcery spell, ~ gets +1/+1 until end of turn. If five or more mana was spent to cast that spell, ~ gets +2/+2 until end of turn instead.' },
  { type: 'Creature — Elf', text: 'Whenever you cast an instant or sorcery spell, ~ deals 1 damage to each opponent. If five or more mana was spent to cast that spell, ~ deals 3 damage to each opponent instead.' },
  { type: 'Creature — Elf', text: 'Whenever you cast an instant or sorcery spell, target player mills three cards. If five or more mana was spent to cast that spell, that player mills ten cards instead.' },
  { type: 'Creature — Elf', text: 'Whenever you cast an instant or sorcery spell, put a +1/+1 counter on ~. If five or more mana was spent to cast that spell, add an amount of {R} equal to ~\'s power.' },
  { type: 'Creature — Elf', text: 'Whenever you cast an instant or sorcery spell, ~ gets +1/+1 until end of turn. If five or more mana was spent to cast that spell, create a token that\'s a copy of ~.' },
  { type: 'Creature — Elf', text: 'Whenever a player casts a spell, if the amount of mana spent to cast it was less than its mana value, ~ deal 3 damage to that player.' },
  { type: 'Creature — Elemental', text: 'When ~ enters, if {R}{R} was spent to cast it, ~ deals 3 damage to any target.' },
  { type: 'Creature — Elemental', text: 'When ~ enters, if {G}{G} was spent to cast it, draw two cards, then discard a card.' },
  { type: 'Creature — Elemental', text: 'When ~ enters, if {W}{W} was spent to cast it, create two 1/1 green and white Kithkin creature tokens.' },
  { type: 'Creature — Elemental', text: 'When ~ enters, if {U}{U} was spent to cast it, return up to one other target nonland permanent to its owner\'s hand.' },
  { type: 'Creature — Elemental', text: 'When ~ enters, if {B}{B} was spent to cast it, target opponent reveals their hand.' },
  { type: 'Creature — Elemental', text: 'When ~ enters, if {R}{R} was spent to cast it, creatures you control get +1/+1 and gain haste until end of turn.' },
  { type: 'Sorcery', text: '~ deals damage to target creature equal to the amount of mana spent to cast ~.' },
  { type: 'Creature — Centaur', text: '~ enters with two +1/+1 counters on it if it wasn\'t cast or no mana was spent to cast it.' },
];

describe('T51 hole-grammar shapes: automated, exact render gate', () => {
  for (const s of SHAPES) {
    it(s.text, () => {
      const f = face(s.type, s.text);
      expect(automated(f.abilities), `${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
      expect(f.gate.every((g) => g.ok), JSON.stringify(f.gate)).toBe(true);
      expect(f.diagnostics.filter((d) => d.level === 'manual')).toEqual([]);
    });
  }
});

describe('T51 lowering: what the shapes mean', () => {
  it('CR 601.2h, 603.4: "if at least four mana was spent to cast it" is the intervening "if" `spellManaSpent >= 4` (the spell of the cast, no marker left)', () => {
    const f = face('Creature — Elf', 'Whenever you cast a noncreature spell, if at least four mana was spent to cast it, put a +1/+1 counter on ~.');
    expect(abilities(f)[0]).toMatchObject({ kind: 'triggered', interveningIf: { cond: 'compare', left: { q: 'spellManaSpent', of: { ref: 'event', role: 'spell' } }, op: '>=', right: 4 } });
    expect(JSON.stringify(abilities(f)[0])).not.toContain('$');
  });
  it('CR 601.2h, 614.15: "If five or more mana was spent to cast that spell, X instead" replaces the first instruction under the condition', () => {
    const f = face('Creature — Elf', 'Whenever you cast an instant or sorcery spell, put a +1/+1 counter on ~. If five or more mana was spent to cast that spell, put two +1/+1 counters on ~ instead.');
    expect(steps(abilities(f)[0])).toEqual([{
      op: 'if', cond: { cond: 'compare', left: { q: 'spellManaSpent', of: { ref: 'event', role: 'spell' } }, op: '>=', right: 5 },
      then: [{ op: 'putCounters', on: { ref: 'self' }, kind: '+1/+1', count: 2 }],
      else: [{ op: 'putCounters', on: { ref: 'self' }, kind: '+1/+1', count: 1 }],
    }]);
  });
  it('CR 601.2h: "{R}{R} was spent to cast it" is at least two red mana of this object\'s cast (wasCast.spent)', () => {
    const f = face('Creature — Elemental', 'When ~ enters, if {R}{R} was spent to cast it, draw a card.');
    expect(abilities(f)[0]).toMatchObject({ kind: 'triggered', interveningIf: { cond: 'wasCast', spent: { color: 'R', atLeast: 2 } } });
  });
  it('CR 601.2f, 601.2h: "the amount of mana spent to cast it was less than its mana value" compares with the mana value of the spell of the cast', () => {
    const f = face('Creature — Turtle', 'Whenever a player casts a spell, if the amount of mana spent to cast it was less than its mana value, ~ deal 3 damage to that player.');
    expect(abilities(f)[0]).toMatchObject({
      kind: 'triggered',
      interveningIf: { cond: 'compare', left: { q: 'spellManaSpent', of: { ref: 'event', role: 'spell' } }, op: '<', right: { q: 'stat', stat: 'manaValue', of: { ref: 'event', role: 'spell' } } },
    });
    expect(steps(abilities(f)[0])).toEqual([{ op: 'damage', source: { ref: 'self' }, to: { ref: 'event', role: 'player' }, amount: 3 }]);
  });
  it('CR 601.2h: "it wasn\'t cast or no mana was spent to cast it" is no mana spent on the object (an object that was not cast spent none)', () => {
    const f = face('Creature — Centaur', "~ enters with two +1/+1 counters on it if it wasn't cast or no mana was spent to cast it.");
    expect(abilities(f)[0]).toMatchObject({ kind: 'static', condition: { cond: 'compare', left: { q: 'manaSpent' }, op: '==', right: 0 } });
    expect(JSON.stringify(abilities(f)[0])).not.toContain('$');
  });
  it('CR 601.2h: "the amount of mana spent to cast ~" is the `manaSpent` quantity; "for each color of mana spent to cast that spell" multiplies by `spellColorsSpent`', () => {
    const note = face('Sorcery', '~ deals damage to target creature equal to the amount of mana spent to cast ~.');
    expect(steps(abilities(note)[0])).toMatchObject([{ op: 'damage', amount: { q: 'manaSpent' } }]);
    const pump = face('Creature — Avatar', 'Whenever you cast an instant or sorcery spell, creatures you control get +1/+0 until end of turn for each color of mana spent to cast that spell.');
    expect(JSON.stringify(steps(abilities(pump)[0]))).toContain('"q":"spellColorsSpent"');
    expect(JSON.stringify(abilities(pump)[0])).not.toContain('$');
  });
  it('CR 201.5: a creature calls itself "this spell", never "that spell": the object a previous sentence names as ~ is no antecedent of "that spell"', () => {
    const f = face('Creature — Elf', 'Whenever you cast an instant or sorcery spell, ~ gets +1/+1 until end of turn. If five or more mana was spent to cast that spell, ~ gets +2/+2 until end of turn instead.');
    expect(automated(f.abilities)).toBe(true);
  });
  it('CR 603.3a: "Whenever you cast ..." names its controller "you": the target of the first sentence is the only "that player"', () => {
    const f = face('Creature — Djinn', 'Whenever you cast an instant or sorcery spell, target player mills three cards. If five or more mana was spent to cast that spell, that player mills ten cards instead.');
    expect(automated(f.abilities)).toBe(true);
    expect(JSON.stringify(steps(abilities(f)[0]))).toContain('"ref":"target"');
    expect(JSON.stringify(steps(abilities(f)[0]))).not.toContain('"role":"player"');
  });
});

describe('T51 fail closed: the spell of a cast, or nothing', () => {
  // the compiler's capability check counts too (CR 608.2b: `spellManaSpent` of an object other than the cast event's spell or ~ is a capability no engine registers)
const manual = (type: string, text: string): boolean => compileCard({ name: 'Example Charm', layout: 'normal', type_line: type, oracle_text: text } as never).automation.level !== 'full';
  it('CR 601.2h, 608.2h: "that spell" that is the target of the ability is not the triggering spell: since Standard round 4 r4-fxb it is read as the target\'s own mana spent (spellManaSpent of the target, played in test/cloud/r4-fxb), never the source\'s', () => {
    for (const text of ['Counter target spell. If the amount of mana spent to cast that spell was less than its mana value, you draw a card.', 'Counter target spell. If five or more mana was spent to cast that spell, you draw a card.']) {
      expect(manual('Instant', text), text).toBe(false);
      const json = JSON.stringify(parseCard({ name: 'Example Charm', layout: 'normal', type_line: 'Instant', oracle_text: text } as never, OPTS).faces[0]!.abilities);
      expect(json, text).toContain('"q":"spellManaSpent","of":{"ref":"target"');
    }
  });
  it('CR 601.2h: "mana was spent to cast that spell" in a trigger that is not a cast (a creature entering) is manual', () => {
    expect(manual('Enchantment', 'Whenever a creature enters, if five or more mana was spent to cast that spell, draw a card.')).toBe(true);
  });
  it('CR 601.2h: a bare number is not "at least": "four mana was spent" does not parse', () => {
    expect(manual('Creature — Elf', 'Whenever you cast a noncreature spell, if four mana was spent to cast it, put a +1/+1 counter on ~.')).toBe(true);
  });
  it('CR 601.2h: "{R}{R}" is red mana only: a different color or a generic symbol is not a color spent', () => {
    expect(manual('Creature — Elemental', 'When ~ enters, if {2}{2} was spent to cast it, draw a card.')).toBe(true);
  });
  it('CR 707.10: "the amount of mana spent to cast it" of another object in a static is manual', () => {
    expect(manual('Creature — Elf', 'Target creature enters with a number of +1/+1 counters on it equal to the amount of mana spent to cast it.')).toBe(true);
  });
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bat least\b/, 'at most'], [/\bwas spent\b/, 'was paid'], [/\bcan't\b/, 'can'], [/\bfor each\b/, 'for every'], [/\bcast\b/, 'play'], [/\bequal to\b/, 'less than'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ').trim()}.`);
  return out;
}

describe('T51 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T51) {
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
  it('the hole-grammar shapes: a swapped key word never gives the same JSON', () => {
    for (const s of SHAPES) {
      const orig = face(s.type, s.text);
      for (const m of nearMisses(s.text)) {
        if (m === s.text) continue;
        const f = face(s.type, m);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
      }
    }
  });
});

describe('T51 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  const nonsense = (type: string, text: string, check: (mutated: string) => boolean): void => {
    const lines = text.split('\n');
    const last = lines.pop()!;
    const words = last.split(' ');
    words.forEach((w, i) => {
      if (w === '~' || w === '~.' || /^\{/.test(w) || /^~'s$/.test(w)) return;
      // CR 122.1: any word can name a kind of counter (parser/holes/misc.ts#counterKind), so the word before "counter" is not a nonsense position
      if (/^counters?$/.test(words[i + 1] ?? '')) return;
      const mutated = [...lines, [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : w.endsWith(':') ? 'blorfty:' : 'blorfty', ...words.slice(i + 1)].join(' ')].join('\n');
      expect(check(mutated), mutated).toBe(false);
    });
  };
  for (const t of T51) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) nonsense('', e.text, (m) => fullyAutomated(parsedWith(t, m)));
    });
  }
  it('the hole-grammar shapes', () => {
    // a word that the sentence can lose without changing what it says (a number word read by a quantity hole as another number is still a number)
    for (const s of SHAPES) nonsense(s.type, s.text, (m) => fullyAutomated(face(s.type, m)));
  });
});

const index = localIndex();

describe.skipIf(index === null)('T51 design 6.10: examples are synthetic', () => {
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
    const verbatim = T51.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples]
      .filter((x) => x.split('\n').some((l) => lines.has(l.trim())))
      .map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
