/**
 * Standard round I (std-ri, slot I of the parallel rounds F-J): the template data of parser/templates/zz-cloud/std-ri.json and the two promotions the round proposed
 * (both stayed experimental until std-finish-1 promoted them, owner approval 2026-10-21: sta.t77.attached.pump.addtype.quoted, golden Ninja's Blades; eff.r4dig.search.differentNames.reveal, demoted by round 4;
 * "~'s power is equal to the number of basic land types among lands you control" is read by sta.cda.power with Standard round 6's domain quantity).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability (G2).
 * Examples are synthetic wordings (design 6.10); with the local index no example is a real line and the hand-verified golden entries are checked against
 * the index's own text.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import ri from '../../../src/parser/templates/zz-cloud/std-ri.json';
import dig from '../../../src/parser/templates/zz-cloud/r4-dig.json';
import t77 from '../../../src/parser/templates/zz-fast5/t77.json';
import digReview from '../../m5/golden/cards/cloud-r4-dig-review.json';
import riReview from '../../m5/golden/cards/cloud-std-ri-review.json';
import t77Review from '../../m5/golden/cards/fast5-t77-review.json';
import { checkGolden, type GoldenEntry } from '../../m5/golden/harness';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RI = ri as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });

/**
 * Design 6.9 evidence for the templates of this file: three hand-verified golden cards, or, for a wording one Standard card prints, that card (the practice
 * of rounds G9 and G2; a deviation from 6.9 that the round's record names). The golden entries are in the review files named in `files`.
 */
const WHOLE_CORPUS: Readonly<Record<string, { golden: readonly string[] }>> = {
  'sta.stri.spendAnyColor.toCast': { golden: ['Case File Auditor'] },
  'eff.stri.eachYouControl.deals.damage.power': { golden: ['Bartz and Boko'] },
  'eff.stri.mill.you.equalTo': { golden: ['Avatar Destiny'] },
  'eff.stri.return.self.hand.andUpToOne.milledThisWay.bf': { golden: ['Avatar Destiny'] },
};

function exampleCard(text: string): OracleCard {
  if (/enchanted creature/i.test(text)) return card('Example Charm', 'Enchantment — Aura', `Enchant creature\n${text}`);
  if (/^(when|whenever|at) /i.test(text) || /^\{/.test(text)) return card('Example Brute', 'Creature — Human Warrior', text, { power: '*', toughness: '2' });
  if (/^(flying|~|you may)/i.test(text)) return card('Example Brute', 'Creature — Human Warrior', text, { power: '*', toughness: '2' });
  return card('Example Volley', 'Instant', text);
}
const parsedWith = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

describe('std-ri template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler in path order (zz-cloud/std-ri.json: after std-re.json, before std-rl.json) and its ids are unique', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-ri.json');
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has two examples and two counter-examples, a status, and is of version 8', () => {
    for (const t of RI) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg|rep)\.stri\./);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: each stable template has its evidence (three golden cards, or the one Standard card that prints the wording)', () => {
    const golden = [...(digReview as { card: string; verified: string }[]), ...(t77Review as { card: string; verified: string }[]), ...(riReview as { card: string; verified: string }[])];
    for (const t of RI.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(t.id)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole.golden].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('the held-back templates are stable since std-finish-1 (owner approval 2026-10-21) and keep their golden evidence: eff.r4dig.search.differentNames.reveal (Fblthp, now in r4-dig\'s own review file) and sta.t77.attached.pump.addtype.quoted (Ninja\'s Blades); docs/CARD_AUTOMATION.md section 5', () => {
    const find = (file: Template[], id: string) => file.find((t) => t.id === id)!;
    expect(find(dig as Template[], 'eff.r4dig.search.differentNames.reveal').status).toBe('stable');
    expect(find(t77 as Template[], 'sta.t77.attached.pump.addtype.quoted').status).toBe('stable');
    const has = (reviewFile: { card: string; verified: string }[], name: string, id: string) => reviewFile.some((g) => g.card === name && g.verified.includes(id));
    expect(has(t77Review as { card: string; verified: string }[], "Ninja's Blades", 'sta.t77.attached.pump.addtype.quoted')).toBe(true);
    expect(has(digReview as { card: string; verified: string }[], 'Fblthp, Knows the Way', 'eff.r4dig.search.differentNames.reveal')).toBe(true);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RI) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('std-ri guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RI) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(fullyAutomated(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

describe('std-ri parser and renderer readings (design 6.4, 6.8 G6)', () => {
  const full = (text: string, type = 'Creature — Human Warrior') => {
    const f = parseCard(card('Example Reading', type, text, type.startsWith('Creature') ? { power: '2', toughness: '2' } : {}), OPTS).faces[0]!;
    return fullyAutomated(f) && f.diagnostics.filter((d) => d.level === 'manual').length === 0 && f.gate.every((g) => g.ok);
  };
  it('CR 603.4, 120.1a: "an opponent was dealt noncombat damage last turn" is the previous turn\'s history of damage to an opponent that is not combat damage', () => {
    expect(full('At the beginning of each upkeep, if an opponent was dealt noncombat damage last turn, you gain 1 life.')).toBe(true);
    const f = parseCard(card('Example Reading', 'Creature — Human Warrior', 'At the beginning of each upkeep, if an opponent was dealt noncombat damage last turn, you gain 1 life.', { power: '2', toughness: '2' }), OPTS).faces[0]!;
    expect(JSON.stringify(f.abilities)).toContain('"scope":"lastTurn"');
    expect(JSON.stringify(f.abilities)).toContain('"combat":false');
  });
  it('the readings next to it are unchanged: "this turn" stays the turn\'s history, and damage of any kind or to any player last turn is still not read', () => {
    expect(full('At the beginning of each upkeep, if an opponent was dealt noncombat damage this turn, you gain 1 life.')).toBe(true);
    expect(full('At the beginning of each upkeep, if an opponent was dealt damage last turn, you gain 1 life.')).toBe(false);
    expect(full('At the beginning of each upkeep, if a player was dealt noncombat damage last turn, you gain 1 life.')).toBe(false);
  });
  it('CR 108.3, 608.2c: "Enchanted creature\'s owner shuffles it into their library." names the enchanted creature, which is the "it"; any other library or player is not read', () => {
    expect(full('Enchant creature\n{5}: Enchanted creature\'s owner shuffles it into their library.', 'Enchantment — Aura')).toBe(true);
    expect(full('Enchant creature\n{5}: Enchanted creature\'s owner shuffles it into your library.', 'Enchantment — Aura')).toBe(false);
  });
  it('design 6.4, CR 109.2, 109.4: a target an opponent controls is no candidate for the "other" of a group "you control": it is other than ~; a target of any other control stays one', () => {
    const bird = 'Creature — Bird';
    expect(full('When this creature enters, each other Bird you control deals damage equal to its power to target creature an opponent controls.', bird)).toBe(true);
    expect(full('When this creature enters, each other Bird you control deals damage equal to its power to target creature you control.', bird)).toBe(false);
    expect(full('When this creature enters, each other Bird you control deals damage equal to its power to target creature.', bird)).toBe(false);
    expect(full('When this creature enters, each other Bird an opponent controls deals damage equal to its power to target creature an opponent controls.', bird)).toBe(false);
  });
  // std-typechange-1 (DECIDED BY DEFAULT, owner instruction 2026-10-21; CR 608.2c): the creature tapped by the instruction joined by a bare "and" is the focus, so "it" is that creature, never the Aura; with "then" the unique-candidate rule still applies
  it('design 6.4: "tap enchanted creature, then remove all counters from it" keeps its two candidates for "it" (the Aura and the enchanted creature): manual', () => {
    expect(full('Enchant creature\nWhen this Aura enters, tap enchanted creature, then remove all counters from it.', 'Enchantment — Aura')).toBe(false);
  });
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/power/, 'toughness'], [/basic land types/, 'land types'], [/you control/, 'an opponent controls'], [/is equal to/, 'is at least'], [/the number of/, 'twice the number of'],
    [/any color/, 'any type'], [/to cast/, 'to activate'], [/You may/, 'Each opponent may'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by)}.`);
  return out;
}

describe('std-ri guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RI) {
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

describe('std-ri guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of RI) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(/[ \n]/);
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

describe.skipIf(index === null)('std-ri (local index): golden entries against the index text; synthetic examples', () => {
  const golden = [
    ...(t77Review as Omit<GoldenEntry, 'source'>[]).filter((g) => g.card === "Ninja's Blades").map((g) => ({ ...g, source: 'fast5-t77-review.json' }) as GoldenEntry),
    ...(riReview as Omit<GoldenEntry, 'source'>[]).map((g) => ({ ...g, source: 'cloud-std-ri-review.json' }) as GoldenEntry),
  ];
  for (const g of golden) {
    it(`${g.card}: no mismatch, no card lint error, every golden ability fully understood`, () => {
      const oracle = (index ?? []).find((c) => c.name === g.card);
      expect(oracle, g.card).toBeDefined();
      const r = checkGolden(g, oracle!, OPTS);
      expect(r.mismatches, g.card).toEqual([]);
      expect(r.cardLint, g.card).toEqual([]);
      expect(r.ratchet, g.card).toBeUndefined();
      expect(r.matched + r.partialAgree, g.card).toBeGreaterThan(0);
    }, 60_000);
  }
  it('no example or counter-example is a line of a real card (the card name or "this <type>" read as "~"; a line with an ability word in front is another line)', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const [name, text] of [[c.name, c.oracle_text], ...(c.card_faces ?? []).map((x) => [x.name ?? c.name, x.oracle_text] as const)] as const) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          const t = l.trim();
          lines.add(t);
          lines.add(t.replaceAll(name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell)\b/gi, '~'));
        }
      }
    }
    const verbatim = RI.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => t.id + ': ' + x));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
