/**
 * FAST5 T62 (trigger clauses and intervening-if conditions): the template data of parser/templates/zz-fast5/t62.json and the parser/renderer support the
 * shapes needed (hole grammars Cond, Event, Qty, Filter; the lowering of "other" and "the difference"; the renderer's alternatives).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present.
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T62 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { instantiate, validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t62 from '../../../src/parser/templates/zz-fast5/t62.json';
import review from '../../m5/golden/cards/fast5-t62-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T62 = t62 as Template[];

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards (test/m5/golden/cards/fast5-t62-review.json), or, for a sentence that fewer real
 * cards print, every one of them (the index check below proves there is no other). `partialCards`: a card of that corpus whose other lines (or the line itself,
 * for another reason) stay manual outside the template, so it is not pinned `expect: "full"`.
 */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp; not?: RegExp; partialCards?: readonly string[] }>> = {
  'trg.t62.entersAndSacrificed': { cards: ['Carrot Cake', 'Heaped Harvest'], line: /^when (~|this \w+) enters and when you sacrifice it, /im },
  'trg.t62.andTurnedFaceUp': { cards: ['Perimeter Enforcer', 'Projektor Inspector'], line: /^whenever [^,\n]*? enters and whenever (?!this creature or)[^,\n]*? is turned face up, /im },
  'trg.t62.andSelfOrAnotherTurnedFaceUp': { cards: ['Cryptid Inspector'], line: /^whenever [^,\n]*? enters and whenever (this creature|~) or another [^,\n]*? is turned face up, /im },
  'trg.t62.while.hasCounter': { cards: ['Bristlebane Battler', 'Reluctant Dounguard'], line: /enters while (this creature|~) has an? [^ ]+ counter on it, /i },
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a T62 example is an ability of the right kind. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'trigger' || /^(When|Whenever|At) /.test(text)) return card('Example Engine', 'Creature — Elf Warrior', text);
  if (text.includes(':')) return card('Example Gem', 'Enchantment', text);
  return card('Example Volley', 'Instant', text);
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('T62 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t62.json, after zz-fast5/t48.json, before zz-fast5x/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t62.json');
    expect(files.indexOf('zz-fast5/t62.json')).toBeGreaterThan(files.indexOf('zz-fast5/t48.json'));
    expect(files.indexOf('zz-fast5/t62.json')).toBeLessThan(files.indexOf('zz-fast5x/e1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(T62.length).toBe(4); // FAST5 batch 7 merge: eff.t62.becomes.creature.with.addtype removed, the same template as FAST5 T47's eff.t47.becomes.subtype.creature.with.inaddition
    for (const t of T62) {
      expect(t.id, t.id).toMatch(/^(eff|trg|rid)\.t62\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T62 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of T62.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(`, ${t.id}`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole && cards.length < 3) expect(cards.slice().sort(), t.id).toEqual(whole.cards.filter((c) => !whole.partialCards?.includes(c)).sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T62) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'when', 'whenever', 'while', 'twice']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('T62 build directive $concat (parser/chart.ts): the arrays and items listed, joined into one array', () => {
  const caps = { a: [1, 2], b: [3], c: { x: 4 } };
  it('joins arrays and single items in order', () => {
    expect(instantiate({ on: { $concat: ['$a', [{ y: 5 }], '$b', '$c'] } }, caps)).toEqual({ on: [1, 2, { y: 5 }, 3, { x: 4 }] });
  });
  it('a hole that is missing makes the whole list missing (the member is dropped), never a shorter list', () => {
    expect(instantiate({ on: { $concat: ['$a', '$missing'] }, keep: 1 }, caps)).toEqual({ keep: 1 });
  });
});

describe('T62 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T62) {
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
        expect(fullyAutomated(f) && f.templatesUsed.includes(t.id), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bwhenever\b/, 'when'], [/\bwhen\b/, 'whenever'], [/\bface up\b/, 'face down'], [/\benters\b/, 'leaves the battlefield'], [/\bsacrifice\b/, 'discard'], [/\byou\b/, 'an opponent'],
    [/\bin addition to its other types\b/, 'until end of turn'], [/\bwhile\b/, 'if'], [/\banother\b/, 'each'], [/\band\b/, 'or'], [/\bcreature\b/, 'land'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('T62 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T62) {
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

describe('T62 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T62) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || /^"?\{/.test(w) || w.includes('\n')) return;
          // a counter kind is any word (stun, oil, ...): the CounterKind hole does not know which words are counters
          if (/^counters?[,.]?$/.test(words[i + 1] ?? '') || /^[+-]\d\/[+-]\d$/.test(w)) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('T62 parser and renderer support (the shapes the templates read are exact, never approximate)', () => {
  const parse = (name: string, type: string, text: string) => parseCard(card(name, type, text), OPTS).faces[0]!;
  const gateOk = (f: ReturnType<typeof parse>): boolean => f.gate.every((g) => g.ok);
  const ok = (type: string, text: string): ReturnType<typeof parse> => {
    const f = parse('Example Engine', type, text);
    expect(fullyAutomated(f) && gateOk(f), `${text}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
    return f;
  };

  it('"an opponent controls more lands than you" compares the lands an opponent controls with yours, as the ability enters and again as it resolves (CR 603.4)', () => {
    const f = ok('Creature — Cat', 'When ~ enters, if an opponent controls more lands than you, draw a card.');
    expect(JSON.stringify(f.abilities)).toContain('"op":">"');
    expect(JSON.stringify(f.abilities)).toContain('"interveningIf"');
    // "fewer" and "no more than" are other comparisons, "an opponent has more lands" other words: manual
    expect(fullyAutomated(parse('Example Engine', 'Creature — Cat', 'When ~ enters, if an opponent controls fewer lands than you, draw a card.'))).toBe(false);
    expect(fullyAutomated(parse('Example Engine', 'Creature — Cat', 'When ~ enters, if you control more lands than an opponent, draw a card.'))).toBe(false);
  });
  it('"outlaw" is the five creature types (CR 700.12) as a noun: "another outlaw", "outlaws you control"', () => {
    const f = ok('Creature — Rogue', 'When ~ enters, if you control another outlaw, draw a card.');
    expect(JSON.stringify(f.abilities)).toContain('"subtypes":["Assassin","Mercenary","Pirate","Rogue","Warlock"]');
    ok('Creature — Rogue', 'Whenever another outlaw you control enters, ~ deals 1 damage to target opponent.');
    ok('Enchantment', 'Whenever an outlaw you control dies, each opponent loses 1 life.');
  });
  it('"the difference" is the number the intervening "if" compares your cards in hand with, minus the cards in hand, and means nothing elsewhere (CR 603.4, 608.2h)', () => {
    const f = ok('Creature — Cat', 'When ~ enters, if you have fewer than four cards in hand, draw cards equal to the difference.');
    expect(JSON.stringify(f.abilities)).toContain('"op":"-"');
    expect(fullyAutomated(parse('Example Engine', 'Creature — Cat', 'When ~ enters, draw cards equal to the difference.'))).toBe(false);
    expect(fullyAutomated(parse('Example Engine', 'Creature — Cat', 'When ~ enters, if you have more than four cards in hand, draw cards equal to the difference.'))).toBe(false);
    expect(fullyAutomated(parse('Example Engine', 'Creature — Cat', 'When ~ enters, if an opponent has fewer than four cards in hand, draw cards equal to the difference.'))).toBe(false);
  });
  it('"other" of a trigger about a described object means other than that object (CR 603.4); about the source itself, other than the source', () => {
    const f = ok('Land', 'Whenever a Forest you control enters, if you control at least five other Forests, draw a card.');
    expect(JSON.stringify(f.abilities)).toContain('"not":{"is":{"ref":"event","role":"subject"}}');
    const own = ok('Land — Forest', 'When ~ enters, if you control at least five other Forests, draw a card.');
    expect(JSON.stringify(own.abilities)).toContain('"other":true');
    // a source that could be one of the Forests: the two readings differ, so the filter stays as it was written before (other than the source)
    const forest = parse('Example Engine', 'Land — Forest', 'Whenever a Forest you control enters, if you control at least five other Forests, draw a card.');
    expect(JSON.stringify(forest.abilities)).not.toContain('"event","role":"subject"}}');
  });
  it('"an enchanted creature" is a creature an Aura is attached to (CR 303.4b)', () => {
    const f = ok('Enchantment', 'At the beginning of your draw step, if you control an enchanted creature, you lose 1 life and you draw an additional card.');
    expect(JSON.stringify(f.abilities)).toContain('"enchanted":true');
  });
  it('"you\'ve cast both a creature spell and a noncreature spell this turn" needs both histories; one of them is not enough', () => {
    const f = ok('Creature — Elf', "At the beginning of combat on your turn, if you've cast both a creature spell and a noncreature spell this turn, draw a card.");
    expect(JSON.stringify(f.abilities)).toContain('"cond":"all"');
    expect(fullyAutomated(parse('Example Engine', 'Creature — Elf', "At the beginning of combat on your turn, if you've cast both a creature spell and a noncreature spell last turn, draw a card."))).toBe(false);
  });
  // FAST5 batch 7 merge: the event is FAST5X E20's `activate` event with `ability: 'exhaust'` (one owner; it also sees exhaust mana abilities, CR 605.1a)
  it('"you activate an exhaust ability" is the event of an exhaust ability activated by you (CR 702.177a); no one else, no other kind of ability', () => {
    const f = ok('Artifact — Vehicle', 'Whenever you activate an exhaust ability, draw a card.');
    expect(JSON.stringify(f.abilities)).toContain('"ability":"exhaust"');
    expect(JSON.stringify(f.abilities)).toContain('"player":"you"');
    expect(JSON.stringify(ok('Artifact — Vehicle', 'Whenever you activate a loyalty ability, draw a card.').abilities)).not.toContain('"ability":"exhaust"');
    ok('Artifact — Vehicle', 'Whenever an opponent activates an exhaust ability, draw a card.');
  });
  it('"one or more opponents are dealt noncombat damage" is a batch of damage to opponents that is not combat damage (CR 120.2b, 603.2c)', () => {
    const f = ok('Creature — Bard', 'Whenever one or more opponents are dealt noncombat damage, creatures you control get +1/+0 until end of turn.');
    expect(JSON.stringify(f.abilities)).toContain('"batch":true');
    expect(JSON.stringify(f.abilities)).toContain('"combat":false');
    // std-rr (CR 603.2c, 510.2): combat damage to one or more opponents is a reading of its own since then, one trigger for the whole batch (never T62's reading)
    const combat = parse('Example Engine', 'Creature — Bard', 'Whenever one or more opponents are dealt combat damage, creatures you control get +1/+0 until end of turn.');
    expect(JSON.stringify(combat.abilities)).not.toContain('"combat":false');
    expect(JSON.stringify(combat.abilities)).toContain('"wholeBatch":true');
    expect(fullyAutomated(parse('Example Engine', 'Creature — Bard', 'Whenever one or more players are dealt noncombat damage, creatures you control get +1/+0 until end of turn.'))).toBe(false);
  });
  it('"it becomes ... in addition to its other types" with a color or a duration is another template\'s business, and a creature with base power and toughness it is not an add-only change', () => {
    ok('Enchantment', 'At the beginning of your end step, if ~ isn\'t a creature, it becomes a 2/2 Cat creature with flying in addition to its other types.');
    expect(fullyAutomated(parse('Example Engine', 'Enchantment', 'At the beginning of your end step, it becomes a 2/2 black Cat creature with flying in addition to its other types.'))).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('T62 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  const SETUP = new Set(['Flying', 'Trample']);
  it('no T62 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = T62.flatMap((t) =>
      [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !SETUP.has(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card's T62 line is read by the named template and passes the exact render gate, never manual on that line
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'trg.t62.entersAndSacrificed': ['Carrot Cake', 'Heaped Harvest'],
    'trg.t62.andTurnedFaceUp': ['Perimeter Enforcer', 'Projektor Inspector'],
    'trg.t62.andSelfOrAnotherTurnedFaceUp': ['Cryptid Inspector'],
    'trg.t62.while.hasCounter': ['Bristlebane Battler', 'Reluctant Dounguard'],
  };
  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? [])
        .filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && x.replaceAll(c.name, '~').split('\n').some((l) => w.line.test(l) && !(w.not?.test(l) ?? false))))
        .map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards].sort());
    }
  }, 120_000);
  const LINE = /enters and when you sacrifice|turned face up|while this|in addition to its other types/i;
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read the line with it, pass the render gate and leave no manual ability for it`, () => {
      for (const name of names) {
        const c = (index ?? []).find((x) => x.name === name);
        expect(c, name).toBeDefined();
        const f = parseCard(c!, OPTS).faces[0]!;
        expect(f.templatesUsed, name).toContain(id);
        const def = compileCard(c!);
        const manual = def.faces[0]!.abilities.filter((a) => a.kind === 'manual' && LINE.test(a.text));
        expect(manual.map((a) => a.text), name).toEqual([]);
      }
    });
  }
});
