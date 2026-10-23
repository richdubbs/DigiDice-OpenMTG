/**
 * Standard round 9 (families of Standard cards): the template data of parser/templates/zz-cloud/std-r9b.json and the parser, lowering and renderer support of
 * the round (the player a search of "its controller's graveyard, hand, and library" names as an antecedent of "that player"; "for each card exiled from their
 * hand this way"; a Vehicle creature in a noun phrase; "the chosen creature type"). Guard G9 (design 6.8): every example lowers with its template, is
 * automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a
 * nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the
 * local index when it is present. The behavior is in std-r9b-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdR9 from '../../../src/parser/templates/zz-cloud/std-r9b.json';
import review from '../../m5/golden/cards/cloud-std-r9b-review.json';
import fxbPromoted from '../../m5/golden/cards/cloud-r5-fxb-promoted.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const R9 = stdR9 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const golden = review as Golden;
const goldenUsing = (id: string, file: Golden = golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** A synthetic card in which an example is an ability of the right kind: a sorcery for a spell's instructions, an artifact for the others. */
const exampleCard = (text: string): OracleCard => (/^(Exile|Destroy) target/.test(text) ? card('Example Rite', 'Sorcery', text) : card('Example Relic', 'Artifact', text));
const parsedWith = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

describe('std-r9b template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-r9b.json, after zz-cloud/std-otj.json, before zz-cloud/std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-r9b.json');
    expect(files.indexOf('zz-cloud/std-r9b.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-otj.json'));
    expect(files.indexOf('zz-cloud/std-r9b.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, is stable with a hand-verified golden card, and is of version 8', () => {
    expect(R9.map((t) => t.id)).toEqual([
      'eff.stdr9b.search.playerGraveyardHandLibrary.sameName.exile',
      'eff.stdr9b.player.shuffles.thenDraws.foreach',
      'eff.stdr9b.linked.putAll.hands',
      'sta.stdr9b.group.chosenType.inaddition',
    ]);
    for (const t of R9) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.stdr9b\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.status, t.id).toBe('stable');
      expect(t.since, t.id).toBe(8);
      expect(goldenUsing(t.id, [...golden, ...(fxbPromoted as Golden)]).length, t.id).toBeGreaterThanOrEqual(1);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('design 6.9 (narrow wordings, a deviation named in the round record): the evidence of each template is the golden cards that print it, Standard-legal or of the tuning half', () => {
    expect(goldenUsing('eff.stdr9b.search.playerGraveyardHandLibrary.sameName.exile')).toEqual(['The End']);
    expect(goldenUsing('eff.stdr9b.player.shuffles.thenDraws.foreach')).toEqual(['The End']);
    // the two cards already had golden entries (r5-fxb pinned their sacrifice as manual): those entries were updated, not doubled (docs/CARD_AUTOMATION.md section 6)
    expect(goldenUsing('eff.stdr9b.linked.putAll.hands', fxbPromoted as Golden)).toEqual(['Connecting the Dots', 'Bomat Courier']);
    expect(goldenUsing('sta.stdr9b.group.chosenType.inaddition')).toEqual(['Lifecraft Engine']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of R9) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'same']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-r9b guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of R9) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
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

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const out = [`${text.replace(/\.$/, '')} unless it is blue.`, `${text.replace(/\.$/, '')} this turn.`];
  const swaps: [RegExp, string][] = [
    [/\bany number of cards\b/, 'up to two cards'], [/\bsame name\b/, 'same color'], [/\bexile them\b/, 'put them into your hand'],
    [/\bdraws a card\b/, 'draws two cards'], [/\bfrom their hand\b/, 'from their graveyard'],
    [/\btheir owners' hands\b/, "their owners' graveyards"], [/\bexiled with ~\b/, 'exiled this turn'],
    [/\bthe chosen\b/, 'a chosen'], [/\bin addition to their other types\b/, 'until end of turn'], [/\byou control are\b/, 'your opponents control are'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-r9b guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of R9) {
    it(`${t.id}: an appended condition or duration, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(e.text);
        for (const m of nearMisses(e.text)) {
          const f = parsedWith(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-r9b guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of R9) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w.includes('\n')) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-r9b parser, lowering and renderer support', () => {
  const spell = (text: string) => parseCard(card('Example Rite', 'Sorcery', text), OPTS).faces[0]!;
  const SEARCH = "Search its controller's graveyard, hand, and library for any number of cards with the same name as that creature and exile them.";
  it('CR 608.2c, 608.2h: the player whose zones a search of "its controller\'s" graveyard, hand and library searches is "that player" afterwards; with no such search it is not', () => {
    const f = spell(`Exile target creature. ${SEARCH} Then that player shuffles.`);
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('{"op":"shuffle","who":{"ref":"controllerOf","object":{"ref":"target","id":"t0"}}}');
    expect(fullyAutomated(spell('Exile target creature. Then that player shuffles.'))).toBe(false);
  });
  it('CR 608.2h, 400.3: "for each card exiled from their hand this way" counts the cards the search exiled that were in a hand, never the exiled target permanent', () => {
    const f = spell(`Exile target creature. ${SEARCH} That player shuffles, then draws a card for each card exiled from their hand this way.`);
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"count":{"q":"resultCount","step":"move","which":{"zone":"hand","isCard":true}}');
    // two instructions that may have exiled cards from a hand: the count names neither (design 6.4)
    expect(fullyAutomated(spell('Exile target creature card in a graveyard. Exile a card from your hand. You draw a card for each card exiled from their hand this way.'))).toBe(false);
  });
  it('CR 701.23b: "all cards with the same name" (every card of that name in the public graveyard must be found) is not read as "any number of cards"', () => {
    expect(fullyAutomated(spell(`Exile target creature. ${SEARCH.replace('any number of cards', 'all cards')} Then that player shuffles.`))).toBe(false);
  });
  it('CR 301.7, 205.3g: "Vehicle creatures you control" is a noun phrase the renderer says (a crewed Vehicle is an artifact creature); "Vehicle lands" stays refused', () => {
    const relic = (text: string) => parseCard(card('Example Relic', 'Artifact', text), OPTS).faces[0]!;
    expect(fullyAutomated(relic('Vehicle creatures you control get +1/+1.'))).toBe(true);
    expect(fullyAutomated(relic('Vehicle lands you control get +1/+1.'))).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-r9b design 6.10 (local index): synthetic examples', () => {
  it('no std-r9b line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Vehicle|spell|card|Saga)\b/gi, '~').trim());
        }
      }
    }
    // the line that sets up an example (the choice a static ability reads) is a real card's line by necessity; the lines of the template's own sentences are not
    const SETUP = new Set(['As ~ enters, choose a creature type.', 'As ~ enters, choose a color.']);
    const verbatim = R9.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !SETUP.has(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
