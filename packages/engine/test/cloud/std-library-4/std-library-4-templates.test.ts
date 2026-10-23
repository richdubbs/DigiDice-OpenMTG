/**
 * Lane std-library, round std-library-4: the template data of parser/templates/zz-cloud/std-library-4.json ("If you would pay life while your library has at least that
 * many cards in it, exile that many cards from the top of your library instead.") and the round's parser and lint changes: "that many" in a replacement's condition
 * and `instead` steps (lower/static-anaphora.ts#resolveReplacedAmount), the Cond "a card was put into exile this turn" (holes/cond.ts), the amount of a payLife pattern
 * (model/lint-roles.ts), and the promotion of eff.r4dig.player.exileTop.whereX (its evidence in cloud-r4-dig-review.json).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-library-4-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdLibrary4 from '../../../src/parser/templates/zz-cloud/std-library-4.json';
import review from '../../m5/golden/cards/cloud-r4-dig-review.json'; // the round's golden card is the promotion evidence of eff.r4dig.player.exileTop.whereX
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdLibrary4 as Template[];
const MECH_COUNT = 1;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'rep.stdlibrary4.payLife.while.libraryAtLeast.exileTop': 'Ashiok, Wicked Manipulator', // the one card of the index that replaces paying life
};
/** Templates kept experimental (none: each has its golden evidence). */
const EXPERIMENTAL: readonly string[] = [];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: an enchantment (a static ability). */
const parsedWith = (_t: Template, text: string) => parseCard(card('Example Ledger', 'Enchantment', text), OPTS).faces[0]!;
const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Monk', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('std-library-4 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-library-4.json, after zz-cloud/std-lci.json, before zz-cloud/std-misc.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-library-4.json');
    expect(files.indexOf('zz-cloud/std-library-4.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-lci.json'));
    expect(files.indexOf('zz-cloud/std-library-4.json')).toBeLessThan(files.indexOf('zz-cloud/std-misc.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are rep.stdlibrary4.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^rep\.stdlibrary4\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.status, t.id).toBe(EXPERIMENTAL.includes(t.id) ? 'experimental' : 'stable');
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) expect(cards, t.id).toContain(NARROW[t.id]);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
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

describe('std-library-4 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
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

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} during combat.`];
  const swaps: [RegExp, string][] = [[/\bpay life\b/, 'lose life'], [/\bat least\b/, 'at most'], [/\byour library has\b/, 'your graveyard has'], [/\bexile\b/, 'mill'], [/\bfrom the top of your library\b/, 'from the bottom of your library'], [/^If you\b/, 'If an opponent']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-library-4 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/during combat" or a swapped key word never gives the example's JSON`, () => {
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

describe('std-library-4 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w)) return;
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-library-4 design 6.10 (local index): synthetic examples', () => {
  it('no std-library-4 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

// ---- the round's parser, lowering and lint changes ----------------------------------------------------------------------------------------------------------

const steps = (f: ReturnType<typeof face>): string => JSON.stringify(f.abilities);

describe('std-library-4 lowering (CR 614.1a): "that many" in a replacement of an event with an amount is that amount, in its condition and its instead steps', () => {
  it('the payment of life: both "that many" are {q:eventAmount}; no marker is left', () => {
    const f = face('Enchantment', 'If you would pay life while your library has at least that many cards in it, exile that many cards from the top of your library instead.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(steps(f)).toContain('"right":{"q":"eventAmount"}');
    expect(steps(f)).toContain('"count":{"q":"eventAmount"}');
    expect(steps(f)).not.toContain('$anaphor');
  });
  it('a "that many" with no replaced amount stays unresolved (fail closed)', () => {
    expect(fullFace(face('Enchantment', 'At the beginning of your upkeep, exile that many cards from the top of your library.'))).toBe(false);
  });
});

describe('std-library-4 Cond (CR 603.4, 406.1): "a card was put into exile this turn" is this turn\'s history of a card moving to exile', () => {
  it('as an intervening if: full, happened zoneChange of a card to exile this turn', () => {
    const f = face('Enchantment', 'At the beginning of your end step, if a card was put into exile this turn, draw a card.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(steps(f)).toContain('"interveningIf":{"cond":"happened","event":{"ev":"zoneChange","subject":{"isCard":true},"to":"exile"},"scope":"turn"}');
  });
  it('"a card was put into a graveyard this turn" is not this reading, and the present tense is not read', () => {
    expect(steps(face('Enchantment', 'At the beginning of your end step, if a card was put into a graveyard this turn, draw a card.'))).not.toContain('"to":"exile"');
    expect(fullFace(face('Enchantment', 'At the beginning of your end step, if a card is put into exile this turn, draw a card.'))).toBe(false);
  });
});

describe('std-library-4 engine capabilities (CR 119.4, 614.1a)', () => {
  it('the payLife replacement form is registered; the trigger form "whenever you pay life" is not (fail closed)', () => {
    expect(ENGINE_CAPABILITIES.has('feature:replace.on.action.payLife')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:ev.action.payLife')).toBe(false);
  });
});

describe('std-library-4 promotion (design 6.9): eff.r4dig.player.exileTop.whereX is stable, its evidence Ashiok, Wicked Manipulator in cloud-r4-dig-review.json', () => {
  it('stable, and the golden card names it', () => {
    const t = TEMPLATE_SET.find((x) => x.id === 'eff.r4dig.player.exileTop.whereX')!;
    expect(t.status).toBe('stable');
    const g = (review as { card: string; verified: string }[]).find((x) => x.card === 'Ashiok, Wicked Manipulator')!;
    expect(g.verified).toContain('(eff.r4dig.player.exileTop.whereX');
  });
});
