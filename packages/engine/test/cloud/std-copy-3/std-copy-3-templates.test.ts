/**
 * Lane std-copy, round std-copy-3: the template data of parser/templates/zz-cloud/std-copy-3.json ("Add {R}. When that mana is spent to cast <spell>, copy that
 * spell and you may choose new targets for the copy.", a rider on the mana: addMana.whenSpent).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-copy-3-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdCopy3 from '../../../src/parser/templates/zz-cloud/std-copy-3.json';
import review from '../../m5/golden/cards/std-copy-3-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdCopy3 as Template[];
const MECH_COUNT = 1;
type Golden = { card: string; verified: string; expect?: string };
const GOLDEN = review as Golden[];
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one or two cards (or three spells, one of them not otherwise full), with their template tests (G9, G2) and played scenarios. Listed in the round's
 * record for the owner.
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'rid.stdcopy3.mana.whenSpent.copy': ["Pyromancer's Goggles"], // and Primal Amulet // Primal Wellspring (other gaps)
}
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** An example is spell text (an instant) unless it is a triggered or activated ability, then an ability of a creature. */
const parsedWith = (text: string) =>
  (/^(Whenever|When |At |\{)/.test(text) ? parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS) : parseCard(card('Example Plan', 'Instant', text), OPTS)).faces[0]!;

const usedBy = (id: string): string[] => GOLDEN.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);

describe('std-copy-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-copy-3.json, path order after std-copy-1 / std-blb, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-copy-3.json');
    expect(files.indexOf('zz-cloud/std-copy-3.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-blb.json'));
    expect(files.indexOf('zz-cloud/std-copy-3.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are rid.stdcopy3.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^rid\.stdcopy3\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the cards that print the wording', () => {
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = usedBy(t.id);
      if (NARROW[t.id] !== undefined) for (const c of NARROW[t.id]!) expect(cards, t.id).toContain(c);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review as Golden[]) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'when', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-copy-3 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
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

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [
    [/\bcan't be copied\b/, "can't be countered"], [/\bThe copy gains\b/, 'The copy has'], [/\bpermanent spell\b/, 'creature spell'], [/\bwin the flip\b/, 'win a flip'],
    [/\blose the flip\b/, 'lose a flip'], [/\bthe copy\b/, 'that spell'], [/\bThis spell\b/, 'Target spell'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-copy-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/until end of turn" or a swapped key word never gives the example's JSON`, () => {
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

describe('std-copy-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-copy-3: parser and lowering changes (one test each)', () => {
  it('CR 605.1a: the words of the trigger the mana carries ("choose new targets for the copy") don\'t make the ability a non-mana ability', () => {
    const f = parsedWith('{T}: Add {U}. When that mana is spent to cast a blue instant spell, copy that spell and you may choose new targets for the copy.');
    expect(fullyAutomated(f)).toBe(true);
    expect(f.abilities[0]).toMatchObject({ kind: 'activated', isMana: true });
  });
  it('CR 605.1a: an ability that adds mana and targets is still no mana ability (the negative case)', () => {
    const f = parsedWith('{T}: Add {U}. Target player draws a card.');
    expect((f.abilities[0] as { isMana?: boolean }).isMana).not.toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-copy-3 design 6.10 (local index): synthetic examples', () => {
  it('no std-copy-3 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
