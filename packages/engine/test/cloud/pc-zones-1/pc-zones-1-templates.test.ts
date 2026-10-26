/**
 * Precon lane pc-zones, round pc-zones-1 (library and graveyard moves): the template data of parser/templates/zz-cloud/pc-zones-1.json, the hole reading "the rest of the
 * revealed cards" (parser/holes/object.ts#rest), the mention of the cards a reveal until left in the library (parser/lower/mentions.ts#revealedNotPutOf), the renderer
 * readings (render/np.ts "nonland historic permanent", render/steps-util.ts library places, render/fold-pczones1.ts). Guard G9 (design 6.8): every example lowers with its
 * template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a
 * nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index
 * when it is present. The behavior is in pc-zones-1-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/pc-zones-1.json';
import review from '../../m5/golden/cards/pc-zones-1-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 5;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A spell: the sentences of a sorcery. */
const parse = (text: string, type = 'Sorcery', pt?: { power: string; toughness: string }) => parseCard(card('Example Ooze', type, text, { ...(pt ?? {}), ...(/\bX\b/.test(text) ? { mana_cost: '{X}{W}' } : {}) }), OPTS).faces[0]!;
/** Fully automated, and no cost part the model cannot state (a `manual` cost part is no manual step: `automated` does not see it). */
const fully = (f: ReturnType<typeof parse>): boolean => fullyAutomated(f) && !JSON.stringify(f.abilities).includes('"kind":"manual"');
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);

describe('pc-zones-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/pc-zones-1.json, after p2-zone-moves-1, before r3-dig.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/pc-zones-1.json');
    expect(files.indexOf('zz-cloud/pc-zones-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/p2-zone-moves-1.json'));
    expect(files.indexOf('zz-cloud/pc-zones-1.json')).toBeLessThan(files.indexOf('zz-cloud/r3-dig.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.pczones1.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.pczones1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 DEVIATION (named in the round record): each wording is printed on one or two cards of the precon decks, so each template is stable on one hand-verified golden card', () => {
    expect(MECH.filter((x) => x.status === 'stable').map((t) => t.id).sort()).toEqual([
      'eff.pczones1.dig.revealUntil.putAllRevealedHand', 'eff.pczones1.dig.upTo.hand.rest.graveyard', 'eff.pczones1.player.shufflesIntoLibraryThenDraws',
      'eff.pczones1.put.ownersLibrary.beneathTopX', 'eff.pczones1.put.ownersLibrary.fourthFromTop',
    ]);
    expect(evidence('eff.pczones1.put.ownersLibrary.fourthFromTop')).toEqual(['Lost to Legend']);
    expect(evidence('eff.pczones1.put.ownersLibrary.beneathTopX')).toEqual(['Unexpectedly Absent']);
    expect(evidence('eff.pczones1.dig.revealUntil.putAllRevealedHand')).toEqual(['Treasure Hunt']);
    expect(evidence('eff.pczones1.dig.upTo.hand.rest.graveyard')).toEqual(["Kruphix's Insight"]);
    expect(evidence('eff.pczones1.player.shufflesIntoLibraryThenDraws')).toEqual(['Oblation']);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'same']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('pc-zones-1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parse(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parse(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parse(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} this turn.`];
  const swaps: [RegExp, string][] = [
    [/\bfourth from the top\b/, 'fourth from the bottom'], [/\bjust beneath the top\b/, 'just beneath the bottom'], [/\bthe rest into your graveyard\b/, 'the rest into your hand'],
    [/\bthe rest of the revealed cards into your graveyard\b/, 'the rest of the revealed cards into your hand'], [/\binto your hand\b/, 'into your graveyard'], [/\bup to (one|two)\b/, 'exactly $1'],
    [/\bshuffles\b/, 'exiles'], [/\bthen draws\b/, 'then discards'], [/\bThe owner\b/, 'The controller'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('pc-zones-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/this turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parse(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parse(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('pc-zones-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parse(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('pc-zones-1 lowering, holes and renderer: the readings that are no template of their own', () => {
  it('CR 608.2c: "the rest of the revealed cards" is "the rest" after a REVEAL of the top cards; after a look it is no reading of this fold (the gate refuses the wording)', () => {
    const reveal = parse('Reveal the top five cards of your library. Put up to two land cards from among them into your hand and the rest of the revealed cards into your graveyard.');
    expect(fullyAutomated(reveal), JSON.stringify(reveal.gate)).toBe(true);
    const look = parse('Look at the top five cards of your library. Put up to two land cards from among them into your hand and the rest of the revealed cards into your graveyard.');
    expect(fullyAutomated(look)).toBe(false);
  });
  it('CR 700.6: "target nonland historic permanent" (the negation before the word) renders back; "historic nonland" order stays a reading of the older shapes', () => {
    const f = parse("Put target nonland historic permanent into its owner's library fourth from the top.");
    expect(f.gate.every((g) => g.ok), JSON.stringify(f.gate)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"position":{"nth":4}');
  });
  it('CR 401.3, 107.3: "just beneath the top X cards of that library" is the place after X cards: the Nth from the top with N = X + 1; "that library" must be the owner\'s', () => {
    const f = parse("Put target nonland permanent into its owner's library just beneath the top X cards of that library.");
    expect(fullyAutomated(f), JSON.stringify(f.gate)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"position":{"nth":{"q":"math","op":"+","args":[{"q":"X"},1]}}');
    expect(fullyAutomated(parse("Put target nonland permanent into its owner's library just beneath the top X cards of your library."))).toBe(false);
  });
  it('CR 701.20a, 608.2c (Rest, head "rest-not-put"): "all cards revealed this way that weren\'t put onto the battlefield" is every revealed card still in the library, only after a reveal until whose card is put onto the battlefield by one step', () => {
    const body = "Reveal cards from the top of your library until you reveal a nonland permanent card. You may put that card onto the battlefield. Then put all cards revealed this way that weren't put onto the battlefield on the bottom of your library in a random order.";
    const f = parse(body);
    expect(fullyAutomated(f), JSON.stringify(f.gate)).toBe(true);
    // the card it stopped at put into the hand instead of onto the battlefield: not "weren't put onto the battlefield"
    expect(fullyAutomated(parse(body.replace('onto the battlefield. Then', 'into your hand. Then')))).toBe(false);
    // no reveal until before it
    expect(fullyAutomated(parse("Put all cards revealed this way that weren't put onto the battlefield on the bottom of your library in a random order."))).toBe(false);
  });
});


const index = localIndex();

describe.skipIf(index === null)('pc-zones-1 design 6.10 (local index): synthetic examples', () => {
  it('no pc-zones-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
