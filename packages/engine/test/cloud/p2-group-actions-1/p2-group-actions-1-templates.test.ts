/**
 * Lane p2-group-actions, round p2-group-actions-1: the template data of parser/templates/zz-cloud/p2-group-actions-1.json ("each player chooses N <things> they
 * control, then sacrifices the rest"), its fold (render/fold-p2ga1.ts), and the Qty reading "the highest / greatest / lowest life total among all players / your
 * opponents" (parser/holes/qty.ts, `q: 'life'` with `agg`; render/qty.ts; capability `feature:q.life.agg`).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word never leaves an automated card (G2). Examples are synthetic (design 6.10),
 * checked against the local index when it is present. Behavior: p2-group-actions-1-scenarios.test.ts. CR cites from memory, unverified.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { adaptTokens, runHole } from '../../../src/parser/holes';
import { tokenize } from '../../../src/parser/tokenize';
import round from '../../../src/parser/templates/zz-cloud/p2-group-actions-1.json';
import review from '../../m5/golden/cards/p2-group-actions-1-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const parse = (text: string) => parseCard(card('Example Spell', 'Sorcery', text), OPTS).faces[0]!;
const golden = review as { card: string; verified: string; expect?: string }[];
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): stable on one hand-verified golden card, because of the cards that may be used
 * (tuning half and Standard) only that one prints the wording; with its template tests (G9, G2) and played scenarios. Listed in the round's record.
 */
const NARROW: Readonly<Record<string, string>> = { 'eff.p2ga1.eachPlayer.chooses.sacrificesRest': "Razia's Purification" };

describe('p2-group-actions-1 template file (design 6.3, 6.9)', () => {
  it('is loaded by the default compiler (after p2-counters-state-1, before p2-player-rules-1), ids unique, the set valid', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files.indexOf('zz-cloud/p2-group-actions-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/p2-counters-state-1.json'));
    expect(files.indexOf('zz-cloud/p2-group-actions-1.json')).toBeLessThan(files.indexOf('zz-cloud/p2-player-rules-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: rules cited, two or more examples and counter-examples, version 8; a stable template has its evidence (here the recorded narrow deviation)', () => {
    expect(MECH.length).toBe(1);
    for (const t of MECH) {
      expect(t.id).toMatch(/^eff\.p2ga1\./);
      for (const cr of t.cr) expect(cr).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length).toBeGreaterThanOrEqual(2);
      expect(t.since).toBe(8);
      if (t.status === 'stable') expect(golden.filter((g) => g.verified.includes(`(${t.id}`)).map((g) => g.card)).toContain(NARROW[t.id]);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
});

describe('p2-group-actions-1 guard G9 (design 6.8)', () => {
  for (const t of MECH) {
    it(`${t.id}: examples parse with it, are automated and pass the gate; counter-examples and near misses do not give the same JSON`, () => {
      const first = parse(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parse(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(fullyAutomated(f), `${e.text}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
      }
      for (const c of t.counterExamples) expect(fullyAutomated(parse(c)) && jsonKey(parse(c).abilities) === jsonKey(first.abilities), c).toBe(false);
      for (const e of t.examples) {
        const orig = parse(e.text);
        const body = e.text.replace(/\.$/, '');
        for (const m of [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, e.text.replace('they control', 'an opponent controls'), e.text.replace('sacrifices the rest', 'exiles the rest'), e.text.replace('Each player', 'Each opponent')]) {
          if (m === e.text) continue;
          const f = parse(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
    it(`${t.id} guard G2: an invented word in place of any word never leaves an automated card`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((_, i) => {
          const end = words[i]!.match(/[.,]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parse(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const ENV = { lexicon: OPTS.lexicon, keywords: OPTS.keywords };
const qty = (text: string) => { const toks = adaptTokens(tokenize(text)); return runHole('Qty', toks, 0, ENV).filter((a) => a.end === toks.length).map((a) => a.value); };

describe('p2-group-actions-1 Qty (parser/holes/qty.ts; CR 119.1): the highest or lowest life total among a set of players', () => {
  it('"the highest / greatest life total among all players" is the max over each player; "the lowest ... among your opponents" the min over each opponent', () => {
    expect(qty('the highest life total among all players')).toEqual([{ q: 'life', of: { ref: 'each', who: 'player' }, agg: 'max' }]);
    expect(qty('the greatest life total among all players')).toEqual([{ q: 'life', of: { ref: 'each', who: 'player' }, agg: 'max' }]);
    expect(qty('the lowest life total among your opponents')).toEqual([{ q: 'life', of: { ref: 'each', who: 'opponent' }, agg: 'min' }]);
  });
  it('fail closed: another set of players, or no set, is no reading', () => {
    expect(qty('the highest life total among creatures')).toEqual([]);
    expect(qty('the highest life total')).toEqual([]);
    expect(qty('the lowest life total among all opponents')).toEqual([]);
  });
  it('a sentence with it is fully automated and renders back', () => {
    expect(fullyAutomated(parse('You gain life equal to the highest life total among your opponents.'))).toBe(true);
    expect(fullyAutomated(parse("Each player's life total becomes the lowest life total among all players."))).toBe(true);
  });
});

const index = localIndex();
describe.skipIf(index === null)('p2-group-actions-1 design 6.10 (local index): synthetic examples', () => {
  it('no example or counter-example is a line of a real card', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) if (typeof text === 'string') for (const l of text.split('\n')) lines.add(l.trim());
    expect(MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples]).filter((x) => lines.has(x))).toEqual([]);
  }, 120_000);
});
