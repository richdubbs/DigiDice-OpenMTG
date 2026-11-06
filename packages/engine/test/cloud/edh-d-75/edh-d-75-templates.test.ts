/**
 * Commander lane attack-requirements (concept round), round edh-d-75: the template data of parser/templates/zz-cloud/edh-d-75.json ("It's goaded for the rest of the game", the group attack requirement
 * "Each opponent must attack with at least one creature each combat if able" and its defender form, "must be blocked by exactly one creature if able", tapped and attacking token copies counted
 * by "where X is") with guards G9 and G2 (design 6.8), and the readings of the round (goaded this way, had to attack this combat); behavior in
 * edh-d-75-scenarios.test.ts. Narrow wordings (design 6.9 deviation): each printed by one card of the band. CR cites are from the Comprehensive Rules text of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhD75 from '../../../src/parser/templates/zz-cloud/edh-d-75.json';
import reviewD75 from '../../m5/golden/cards/edh-d-75-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD75 as Template[];
const review = reviewD75 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 5;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhd75.itIs.goaded.restOfGame': ['Jon Irenicus, Shattered One'],
  'sta.edhd75.opponents.attackWithOne': ['Seeker of Slaanesh'],
  'sta.edhd75.opponents.attackYouOrWalkerWithOne': ['Trove of Temptation'],
  'sta.edhd75.mustBeBlocked.exactlyOne': ['Nacatl War-Pride'],
  'eff.edhd75.copyTokens.tappedAttacking.whereX': ['Nacatl War-Pride'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(t.kind === 'static' ? card('Example Plan', /^(Each opponent|Enchanted)/.test(text) ? 'Enchantment' : 'Creature — Cat', text, { power: '3', toughness: '3' } as Partial<OracleCard>) : /^\{/.test(text) ? card('Example Plan', 'Artifact', text) : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-d-75 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-75.json, path order: edh-d-7 sorts before edh-d-75, edh-d-75 before edh-d-8) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-75.json');
    expect(files.indexOf('zz-cloud/edh-d-75.json')).toBeLessThan(files.indexOf('zz-cloud/edh-d-8.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhd75.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm|abl)\.edhd75\./);
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

describe('edh-d-75 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bgreater\b/, 'less'], [/\bgraveyard\b/, 'hand'], [/\bany number\b/, 'up to two'], [/\bpower\b/, 'toughness'], [/\bHumans\b/, 'Elves'], [/\bland card\b/, 'creature card'],
    [/\bthat player\b/, 'you'], [/\bbottom\b/, 'top'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-d-75 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-75 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-d-75 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-75 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // design 6.10 deviation (named in the round's record): the requirement of Trove of Temptation has ONE wording (nothing in it can vary: no number, filter or player is a hole of the template),
    // so its examples are that line; it is a single sentence of the rules text, with no ability word or reminder text to vary
    const ONE_WORDING = new Set(['sta.edhd75.opponents.attackYouOrWalkerWithOne']);
    const verbatim = MECH.filter((t) => !ONE_WORDING.has(t.id)).flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});


describe('edh-d-75 readings (invented wordings, design 6.10)', () => {
  const parse = (type: string, text: string) => parseCard(card('Example Plan', type, text, /Creature/.test(type) ? { power: '3', toughness: '3' } as Partial<OracleCard> : {}), OPTS).faces[0]!;
  const ok = (type: string, text: string): boolean => fullyAutomated(parse(type, text));
  it('parser/holes/edhd75.ts: "for each creature goaded this way" and "the total power of creatures goaded this way" count the ONE goad instruction before them; another noun, or no goad before, stays manual', () => {
    const head = 'When this creature enters, goad each creature your opponents control.';
    expect(ok('Creature — Dragon', `${head} Put a +1/+1 counter on this creature for each creature goaded this way.`)).toBe(true);
    expect(ok('Creature — Dragon', `${head} Put X +1/+1 counters on this creature, where X is the total power of creatures goaded this way.`)).toBe(true);
    expect(ok('Creature — Dragon', `${head} Put a +1/+1 counter on this creature for each Goblin goaded this way.`)).toBe(false);
    expect(ok('Creature — Dragon', 'When this creature enters, tap each creature your opponents control. Put a +1/+1 counter on this creature for each creature goaded this way.')).toBe(false);
    expect(JSON.stringify(parse('Creature — Dragon', `${head} Put a +1/+1 counter on this creature for each creature goaded this way.`).abilities)).toContain('"q":"count"');
  });
  it('parser/holes/cond.ts: "if that creature had to attack this combat" is the hadToAttack filter of the creature that dealt the damage; "was attacking" or "had to block" are other conditions', () => {
    const head = 'Whenever a creature deals combat damage to one of your opponents, if that creature';
    expect(ok('Creature — Dragon', `${head} had to attack this combat, you put a +1/+1 counter on this creature and you draw a card.`)).toBe(true);
    expect(ok('Creature — Dragon', `${head} had to block this combat, you put a +1/+1 counter on this creature and you draw a card.`)).toBe(false);
    expect(JSON.stringify(parse('Creature — Dragon', `${head} had to attack this combat, you put a +1/+1 counter on this creature and you draw a card.`).abilities)).toContain('"hadToAttack":true');
  });
  it('rules/requirements.ts: the group requirement needs a mustIfAble attack with atLeastOne; "each opponent must block" or "two creatures" are not read', () => {
    expect(ok('Creature — Demon', 'Each opponent must attack with at least one creature each combat if able.')).toBe(true);
    expect(ok('Creature — Demon', 'Each opponent must attack with at least two creatures each combat if able.')).toBe(false);
    expect(ok('Creature — Demon', 'Each opponent must block with at least one creature each combat if able.')).toBe(false);
    expect(ok('Creature — Demon', 'Each player must attack with at least one creature each combat if able.')).toBe(false);
  });
});
