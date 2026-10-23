/**
 * CLOUD std-fdn (the Standard backlog of Foundations): the template data of parser/templates/zz-cloud/std-fdn.json ("whenever ~ attacks for the first time each turn", "after this phase, there is an additional combat phase", "prevent all combat damage that would be dealt to <object> <duration>", "if a
 * <filter> would be put into a graveyard from anywhere, exile it instead", "whenever a source you control deals noncombat damage to an opponent", "you can spend
 * mana of any type to cast <spells>") and the parser and renderer changes the slice needed (the sacrificed object as an antecedent, "its" in the X of counters
 * put on ~, "the <stat> of <object>", "you control N or more <filter> with different names").
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10); with the local index, no example is a real line, the hand-verified golden entries
 * (test/m5/golden/cards/cloud-std-fdn-review.json) are checked against the index's own text, and the cards that print a rare sentence are all accounted for.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import fdn from '../../../src/parser/templates/zz-cloud/std-fdn.json';
import review from '../../m5/golden/cards/cloud-std-fdn-review.json';
import { checkGolden, type GoldenEntry } from '../../m5/golden/harness';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const FDN = fdn as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });

/**
 * Design 6.9 evidence: three hand-verified golden cards, or, for a sentence few real cards print, every one of them: each a golden card or named here with
 * the reason it is not one yet.
 */
const WHOLE_CORPUS: Readonly<Record<string, { line: RegExp; golden: readonly string[]; notYet: Readonly<Record<string, string>> }>> = {
  'trg.stdfdn.attacks.firstEachTurn': {
    line: /Whenever (this creature|[A-Z][a-z]+(, [^,.]+)?|Scourge of the Throne) attacks for the first time each turn/,
    golden: ['Aurelia, the Warleader', 'Fear of Missing Out'],
    notYet: {
      'Godo, Bandit Warlord': '"Untap it and all Samurai you control" is not read yet',
      'Scourge of the Throne': 'its intervening "if" (you\'re attacking the player with the most life or tied for most life) is not read yet',
    },
  },
  'eff.stdfdn.prevent.combat.to.obj.dur': {
    line: /Prevent all combat damage that would be dealt to (it|target [^.]*|that creature) (this turn|until end of turn)\./,
    golden: ['Fleeting Flight'],
    notYet: { 'Azorius Ploy': 'its first sentence ("Prevent all combat damage target creature would deal this turn") is not read yet' },
  },
  'rep.stdfdn.filter.anywhere.exile': { line: /If an? [^.]* card would be put into a graveyard from anywhere, exile it instead\./, golden: ['Dryad Militant'], notYet: {} },
  'sta.stdfdn.spendAnyType.toCast': { line: /You can spend mana of any type to cast/, golden: ['Vizier of the Menagerie'], notYet: {} },
};

function exampleCard(text: string): OracleCard {
  if (/^(when|whenever|at) /i.test(text) || /^\{/.test(text) || /^(if|you can) /i.test(text)) return card('Example Brute', 'Creature — Human Warrior', text);
  return card('Example Volley', 'Instant', text);
}
const parsedWith = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

describe('std-fdn template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler in path order (zz-cloud/std-fdn.json: after trigger.json, before zz-fast1/) and its ids are unique', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-fdn.json');
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has two examples and two counter-examples, a status, and is of version 8', () => {
    expect(FDN.map((t) => t.id)).toEqual([
      'trg.stdfdn.attacks.firstEachTurn', 'eff.stdfdn.extraPhase.combat', 'eff.stdfdn.prevent.combat.to.obj.dur', 'rep.stdfdn.filter.anywhere.exile',
      'trg.stdfdn.sourceYouControl.noncombatDamage.opponent', 'sta.stdfdn.spendAnyType.toCast',
    ]);
    for (const t of FDN) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg|rep)\.stdfdn\./);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.status, t.id).toBe('stable');
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: each stable template has its evidence (three golden cards, or the whole corpus of a rare sentence)', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of FDN) {
      const cards = golden.filter((g) => g.verified.includes(t.id)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole.golden].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of FDN) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('std-fdn guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of FDN) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(fullyAutomated(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

describe('std-fdn parser and renderer readings (design 6.4, 6.8 G6)', () => {
  const full = (text: string, type = 'Instant') => {
    const f = parseCard(card('Example Reading', type, text), OPTS).faces[0]!;
    return fullyAutomated(f) && f.diagnostics.filter((d) => d.level === 'manual').length === 0;
  };
  it('"that creature" after one player\'s sacrifice of their choice is the sacrificed creature; after "each opponent sacrifices" it stays manual (several)', () => {
    expect(full("Target opponent sacrifices a creature of their choice. You gain life equal to that creature's power.")).toBe(true);
    expect(full("Each opponent sacrifices a creature of their choice. You gain life equal to that creature's power.")).toBe(false);
  });
  it('"its" in "where X is its power" of counters put on the object itself is that object; on another object it still has no antecedent', () => {
    expect(full('{1}{G}: Put X +1/+1 counters on this creature, where X is its power.', 'Creature — Beast')).toBe(true);
    expect(full('Put X +1/+1 counters on target creature, where X is its toughness.')).toBe(true);
  });
  it('"the <stat> of <object>" is the same quantity as "<object>\'s <stat>"', () => {
    expect(full('Whenever another creature you control dies, you gain life equal to the toughness of that creature.', 'Enchantment')).toBe(true);
    expect(full('You gain life equal to the mana value of target permanent.')).toBe(true);
  });
  it('"you control N or more <filter> with different names" is the count of different names; the plain "N or more" condition is unchanged', () => {
    expect(full('If you control three or more Shrines with different names, you win the game.', 'Sorcery')).toBe(true);
    expect(full('Draw a card. If you control three or more artifacts, draw another card.', 'Sorcery')).toBe(true);
  });
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/first time/, 'second time'], [/each turn/, 'each combat'], [/combat phase/, 'main phase'], [/combat damage/, 'noncombat damage'], [/ to it /, ' by it '],
    [/a graveyard/, 'your graveyard'], [/anywhere/, 'the battlefield'], [/noncombat/, 'combat'], [/an opponent/, 'a creature'], [/any type/, 'any color'], [/to cast/, 'to activate'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by)}.`);
  return out;
}

describe('std-fdn guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of FDN) {
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

describe('std-fdn guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of FDN) {
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

const index = localIndex();

describe.skipIf(index === null)('std-fdn (local index): golden entries against the index text; synthetic examples; the whole corpus of the rare sentences', () => {
  const golden = (review as Omit<GoldenEntry, 'source'>[]).map((g) => ({ ...g, source: 'cloud-std-fdn-review.json' }) as GoldenEntry);
  for (const g of golden) {
    it(`${g.card}: no mismatch, no card lint error${g.expect === 'full' ? ', every golden ability fully understood' : ''}`, () => {
      const oracle = (index ?? []).find((c) => c.name === g.card);
      expect(oracle, g.card).toBeDefined();
      const r = checkGolden(g, oracle!, OPTS);
      expect(r.mismatches, g.card).toEqual([]);
      expect(r.cardLint, g.card).toEqual([]);
      expect(r.ratchet, g.card).toBeUndefined();
      expect(r.matched + r.partialAgree, g.card).toBeGreaterThan(0);
    }, 60_000);
  }
  it('no example or counter-example line is a line of a real card', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text === 'string') for (const l of text.split('\n')) lines.add(l.trim());
      }
    }
    const verbatim = FDN.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
  it('every card of the index that prints a rare sentence is a golden card or named with the reason it is not yet', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.golden, ...Object.keys(w.notYet)].sort());
    }
  }, 120_000);
});
