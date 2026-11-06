/**
 * Commander lane edh-c, round edh-c-15 (second pass over EDHREC ranks 15,001-15,625): the template data of parser/templates/zz-cloud/edh-c-15.json (dig readings, pump for each of its colors,
 * each of those creatures doesn't untap, gain control of those creatures) with guards G9 and G2 (design 6.8), the hole change of token epithets and the render readings; behavior in
 * edh-c-15-scenarios.test.ts. Narrow wordings (design 6.9 deviation): each printed by one card of the band. CR cites are from the Comprehensive Rules text of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC15 from '../../../src/parser/templates/zz-cloud/edh-c-15.json';
import reviewC15 from '../../m5/golden/cards/edh-c-15-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC15 as Template[];
const review = reviewC15 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhv15.dig.mayPut.bf.powerAtLeast': ['Mayael the Anima'],
  'eff.edhv15.dig.putOne.graveyard': ['Jace, the Living Guildpact'],
  'eff.edhv15.dig.revealAny.putThem.hand': ['You Meet in a Tavern'],
  'eff.edhv15.pump.dur.forEach.itsColors': ['Might of the Nephilim'],
  'eff.edhv15.untap.next.eachOfThose': ['Juvenile Mist Dragon'],
  'eff.edhv15.gainControl.thoseCreatures': ['Rags // Riches'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(t.kind === 'static' ? card('Example Plan', 'Enchantment', text) : /^\{/.test(text) ? card('Example Plan', 'Artifact', text) : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-c-15 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-15.json, path order: edh-c- sorts before edh-cast) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-15.json');
    expect(files.indexOf('zz-cloud/edh-c-15.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhv15.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm|abl)\.edhv15\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the cards that print the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) for (const n of NARROW[t.id]!) expect(cards, t.id).toContain(n);
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

describe('edh-c-15 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [
    [/\bgreater\b/, 'less'], [/\bgraveyard\b/, 'hand'], [/\bany number\b/, 'up to two'], [/\bits colors\b/, 'your colors'], [/\bits controller's\b/, 'your'],
    [/\bthose creatures\b/, 'those artifacts'], [/\bdoesn't untap\b/, 'untaps'], [/\bgets\b/, 'loses'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-c-15 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-15 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

const index = localIndex();

describe.skipIf(index === null)('edh-c-15 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-15 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


describe('edh-c-15 hole and render readings (invented wordings, design 6.10)', () => {
  const parse = (type: string, text: string) => parseCard(card('Example Plan', type, text, /Creature/.test(type) ? { power: '3', toughness: '3' } as Partial<OracleCard> : {}), OPTS).faces[0]!;
  const ok = (type: string, text: string): boolean => fullyAutomated(parse(type, text));
  it('parser/holes/token.ts#epithet: a named token whose epithet follows the name with no comma ("Name the Epithet, a legendary ...") is read; a lower-case epithet or no article after the comma is not', () => {
    expect(ok('Creature — Goblin', 'When ~ dies, create Brass Digger the Returned, a legendary 5/5 colorless Goblin Golem artifact creature token.')).toBe(true);
    expect(ok('Creature — Goblin', 'When ~ dies, create Brass Digger the returned, a legendary 5/5 colorless Goblin Golem artifact creature token.')).toBe(false);
    expect(ok('Creature — Goblin', 'When ~ dies, create Brass Digger the Returned, legendary 5/5 colorless Goblin Golem artifact creature token.')).toBe(false);
  });
  it('render/evt.ts: "an Aura you control is put into your graveyard from the battlefield" is the Aura you own and control; an opponent\'s Aura is not read so', () => {
    expect(ok('Creature — Human', 'Whenever an Aura you control is put into your graveyard from the battlefield, draw a card.')).toBe(true);
    expect(ok('Creature — Human', 'Whenever an Aura an opponent controls is put into your graveyard from the battlefield, draw a card.')).toBe(false);
  });
  it('render/evt.ts: "one or more creature cards are put into graveyards from anywhere" (batch, any graveyard) is read; "your graveyard" is another event (other JSON)', () => {
    expect(ok('Creature — Human', 'Whenever one or more creature cards are put into graveyards from anywhere, draw a card.')).toBe(true);
    expect(jsonKey(parse('Creature — Human', 'Whenever one or more creature cards are put into your graveyard from anywhere, draw a card.').abilities)).not.toBe(jsonKey(parse('Creature — Human', 'Whenever one or more creature cards are put into graveyards from anywhere, draw a card.').abilities));
  });
  it('render/steps-flow.ts: "If they don\'t, they return ..." after another player\'s optional payment is read; naming the permanents of another player there is another meaning', () => {
    expect(ok('Artifact', "At the beginning of each player's upkeep, that player may pay 2 life. If they don't, they return a permanent they control to its owner's hand.")).toBe(true);
    expect(jsonKey(parse('Artifact', "At the beginning of each player's upkeep, that player may pay 2 life. If they don't, they return a permanent you control to its owner's hand.").abilities)).not.toBe(jsonKey(parse('Artifact', "At the beginning of each player's upkeep, that player may pay 2 life. If they don't, they return a permanent they control to its owner's hand.").abilities));
  });
  it('render/steps-zones.ts: "tap it" after "is dealt damage this way" is read; "untap it" is not', () => {
    expect(ok('Creature — Archer', '{2}, {T}: ~ deals 1 damage to target creature. If a colorless creature is dealt damage this way, tap it.')).toBe(true);
    expect(ok('Creature — Archer', '{2}, {T}: ~ deals 1 damage to target creature. If a colorless creature is dealt damage this way, untap it.')).toBe(false);
  });
  it('priority 1 of eff.edhv15.dig.revealAny.putThem.hand keeps "put them into your hand" from being read as the whole group (guard G5)', () => {
    const f = parse('Sorcery', 'Look at the top five cards of your library. You may reveal any number of creature cards from among them and put them into your hand. Put the rest on the bottom of your library in a random order.');
    expect(f.diagnostics.filter((d) => d.level === 'manual')).toEqual([]);
    expect(f.templatesUsed).toContain('eff.edhv15.dig.revealAny.putThem.hand');
  });
});
