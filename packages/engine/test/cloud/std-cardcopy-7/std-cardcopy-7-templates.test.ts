/**
 * Lane std-cardcopy, round std-cardcopy-7: the template data of parser/templates/zz-cloud/std-cardcopy-7.json ("You may cast up to three of the copies without paying
 * their mana costs.", "You may cast any number of spells with total mana value 6 or less from among the copies without paying their mana costs."), and the parser,
 * lowering and renderer changes of the round: the cast step's `select`, the target restriction "of each card type" (`perCardType`), the cost part's total of mana
 * symbols (`exileFrom.total`), "those exiled cards" of a cost, and a rider's `@require` with `@oneOf`.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-cardcopy-7-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/std-cardcopy-7.json';
import review from '../../m5/golden/cards/cloud-std-cardcopy-7-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 2;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'rid.stdcardcopy7.mayCastUpToNCopies.free': 'Baron Helmut Zemo',
  'rid.stdcardcopy7.mayCastTotalMVFromCopies.free': 'Uldaros Theorix', // std-cardcopy-11: promoted once r4-copy's copy group is stable
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** The examples are spell text (a sorcery). */
const parsedWith = (_t: Template, text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);

describe('std-cardcopy-7 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-cardcopy-7.json, after std-blb, before std-dft) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-cardcopy-7.json');
    expect(files.indexOf('zz-cloud/std-cardcopy-7.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-blb.json'));
    expect(files.indexOf('zz-cloud/std-cardcopy-7.json')).toBeLessThan(files.indexOf('zz-cloud/std-dft.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are rid.stdcardcopy7.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^rid\.stdcardcopy7\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = evidence(t.id);
      if (NARROW[t.id] !== undefined) expect(cards, t.id).toContain(NARROW[t.id]);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-cardcopy-7 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(t, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [
    [/\bup to\b/, 'at least'], [/\bor less\b/, 'or greater'], [/\bwithout paying their mana costs\b/, 'paying their mana costs'], [/\bof the copies\b/, 'of the cards'],
    [/\bany number of spells\b/, 'one spell'], [/\bmana value\b/, 'power'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-cardcopy-7 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/until end of turn" or a swapped key word never gives the example's JSON`, () => {
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

describe('std-cardcopy-7 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any word (CR 122.1): "a blorfty counter" is a counter kind, not nonsense
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const sorcery = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
const creature = (text: string) => parseCard(card('Example Baron', 'Creature — Human', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
const targetOf = (f: ReturnType<typeof sorcery>): Record<string, unknown> => (f.abilities[0] as unknown as { effect: { targets: Record<string, unknown>[] } }).effect.targets[0]!;

describe('std-cardcopy-7 parser and renderer: "up to one target nonland card of each card type from your graveyard" (CR 115.1, 205.2a; parser/holes/object.ts, render/refs.ts)', () => {
  it('reads one target for each card type (`perCardType`) of cards in your graveyard, and renders it back', () => {
    const f = sorcery('Exile up to one target nonland card of each card type from your graveyard.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(targetOf(f)).toMatchObject({ min: 0, max: 1, perCardType: true, filter: { notTypes: ['Land'], zone: 'graveyard', owner: 'you' } });
  });
  it('has no reading for "target" (not "up to one"), another zone, or a plural', () => {
    for (const t of ['Exile one target nonland card of each card type from your graveyard.', 'Exile up to one target nonland card of each card type from a graveyard.', 'Exile up to two target nonland cards of each card type from your graveyard.']) {
      const f = sorcery(t);
      expect(fullyAutomated(f) && JSON.stringify(f.abilities).includes('perCardType'), t).toBe(false);
    }
  });
  it('"those cards" after it is the group the exile moved (one of each type is a set, CR 115.1)', () => {
    const f = sorcery('Exile up to one target nonland card of each card type from your graveyard. Copy those cards. You may cast up to two of the copies without paying their mana costs.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"op":"cast","what":{"ref":"bound","name":"moved"}');
  });
});

describe('std-cardcopy-7 parser and renderer: a cost of cards with a total of mana symbols (CR 118.3, 107.4; parser/holes/cost.ts, render/costs.ts)', () => {
  it('reads "with N or more <color> mana symbols among their mana costs" after "any number of <cards> from your graveyard" (`total`)', () => {
    const f = creature('Exile any number of red cards from your graveyard with six or more red mana symbols among their mana costs: Draw a card.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities[0])).toContain('"kind":"exileFrom","zone":"graveyard","count":"any","filter":{"colors":["R"]},"symbolTotal":{"color":"R","atLeast":6}');
  });
  it('has no reading for a fixed count, another zone, or another noun than mana symbols', () => {
    for (const t of ['Exile two red cards from your graveyard with six or more red mana symbols among their mana costs: Draw a card.', 'Exile any number of red cards from your hand with six or more red mana symbols among their mana costs: Draw a card.', 'Exile any number of red cards from your graveyard with six or more red cards among their mana costs: Draw a card.']) {
      const f = creature(t);
      expect(fullyAutomated(f) && JSON.stringify(f.abilities).includes('"symbolTotal"'), t).toBe(false);
    }
  });
  it('"Copy those exiled cards." of an "any number of" cost reads the cards the cost exiled (`costExiled`, a copy reads copiable values only, CR 707.2)', () => {
    const f = creature('Exile any number of red cards from your graveyard with six or more red mana symbols among their mana costs: Copy those exiled cards. You may cast up to two of the copies without paying their mana costs.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities[0])).toContain('"op":"cast","what":{"ref":"costExiled"}');
  });
  it('an instruction that moves those cards stays manual (CR 400.7: only the copy reads them)', () => {
    expect(fullyAutomated(creature('Exile any number of red cards from your graveyard with six or more red mana symbols among their mana costs: Return those exiled cards to your hand.'))).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-cardcopy-7 design 6.10 (local index): synthetic examples', () => {
  it('no std-cardcopy-7 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

/** The local index entry type the 6.10 check reads (OracleCard with its faces). */
export type IndexCard = OracleCard;
