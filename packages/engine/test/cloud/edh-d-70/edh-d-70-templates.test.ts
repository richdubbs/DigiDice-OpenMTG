/**
 * Concept round player-counters edh-d-70 (code edhd70): the template data of parser/templates/zz-cloud/edh-d-70.json, tested here and in edh-d-70-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10). CR cites from memory, unverified (cloud session).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhD70 from '../../../src/parser/templates/zz-cloud/edh-d-70.json';
import review from '../../m5/golden/cards/edh-d-70-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';

const MECH = edhD70 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only
 * one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT, owner instruction 2026-10-21).
 * Each wording is printed on one card: Azula, Ruthless Firebender (two); Synth Eradicator. The group pump (Minthara, Merciless Soul) was experimental while its ward {X} stayed
 * manual; edh-next-146 built that ward and made the group pump stable on Minthara (the one card that prints it; golden entry in this round's review file, recorded by edh-next-146).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhd70.lead.pumpForEach.playerCounters.grant': ['Azula, Ruthless Firebender'],
  'eff.edhd70.playerCounters.forEach.qty': ['Azula, Ruthless Firebender'],
  'ch.edhd70.mayGetEnergy.2': ['Synth Eradicator'],
  'sta.edhd70.group.pump.forEach.playerCounters': ['Minthara, Merciless Soul'], // edh-next-146
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });

/** A synthetic card with the example as its ability: a static ability on an enchantment creature, a trigger on an artifact creature. */
const parsedWith = (t: Template, text: string) => parseCard(
  /^(Whenever|When|At the beginning)/.test(text) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : t.kind === 'static' ? card('Example Shrine', 'Enchantment', text) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-d-70 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-70.json, path order: after edh-d-7.json, before edh-d-8.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-70.json');
    expect(files.indexOf('zz-cloud/edh-d-70.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-7.json'));
    expect(files.indexOf('zz-cloud/edh-d-70.json')).toBeLessThan(files.indexOf('zz-cloud/edh-d-8.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhd70.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|kw)\.edhd70\./);
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

describe('edh-d-70 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [[/graveyard/, 'hand'], [/exiling/, 'discarding'], [/sacrificing/, 'discarding'], [/tapped/, 'untapped'], [/mutate/, 'flashback']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-d-70 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-70 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // a counter kind is any word (CR 122.1b)
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});


/** The parser, lowering and renderer changes of the round: each wording in a synthetic card, with the near misses that must stay out. */
const asCard = (text: string, type = 'Artifact Creature — Construct') => card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : {});
const isFull = (text: string, type?: string): boolean => fullyAutomated(parseCard(asCard(text, type), OPTS).faces[0]!);

describe('edh-d-70: readings of the Qty, trigger and render changes (each with its near misses)', () => {
  it('CR 107.14: "for each {E} you\'ve paid or lost this turn" (cost reduction); the energy symbol and the verbs are exact', () => {
    expect(isFull("This spell costs {1} less to cast for each {E} you've paid or lost this turn.", 'Artifact Creature — Construct')).toBe(true);
    expect(isFull('This spell costs {1} less to cast for each {E} you paid this turn.', 'Artifact Creature — Construct')).toBe(false);
    expect(isFull("This spell costs {1} less to cast for each {E} you've lost this turn.", 'Artifact Creature — Construct')).toBe(false);
    expect(isFull("This spell costs {1} less to cast for each {E} an opponent has paid or lost this turn.", 'Artifact Creature — Construct')).toBe(false);
  });
  it('CR 122.1f: "the number of opponents who have three or more poison counters" and "for each opponent with ..." (corrupted counts)', () => {
    expect(isFull('Draw a card for each opponent with three or more poison counters.', 'Sorcery')).toBe(true);
    expect(isFull('Create a 1/1 white Soldier creature token for each opponent with three or more poison counters.', 'Sorcery')).toBe(true);
    expect(isFull('Return up to X target cards from your graveyard to your hand, where X is the number of opponents who have three or more poison counters.', 'Sorcery')).toBe(true);
    expect(isFull('Draw a card for each opponent with three or more rad counters.', 'Sorcery')).toBe(false);
    expect(isFull('Draw a card for each opponent with fewer than three poison counters.', 'Sorcery')).toBe(false);
    expect(isFull('Draw a card for each player with three or more poison counters.', 'Sorcery')).toBe(false);
    expect(isFull('Draw a card for each opponent with three or more poison counters and a creature.', 'Sorcery')).toBe(false);
  });
  it('CR 508.1b, 506.3: "whenever a player attacks you with one or more creatures" is the opponent-attacks-you declaration; a player attacking without "you" is another trigger', () => {
    expect(isFull('Whenever a player attacks you with one or more creatures, you draw a card.', 'Enchantment')).toBe(true);
    expect(isFull('Whenever a player attacks you with two or more creatures, you draw a card.', 'Enchantment')).toBe(true);
    expect(isFull('Whenever a player attacks you with one or more creatures, that player gets twice that many rad counters.', 'Enchantment')).toBe(true);
    expect(isFull('Whenever a player attacks you with one or more creatures, that player gets three times that many rad counters.', 'Enchantment')).toBe(false);
    expect(isFull('Whenever a player attacks you with one or more creatures, that player gets twice that many rad counters instead.', 'Enchantment')).toBe(false);
  });
  it('CR 603.2c: "Whenever you attack with one or more Gods and whenever a God dies" is two events of different kinds; a different second event is not read', () => {
    expect(isFull('Whenever you attack with one or more Gods and whenever a God dies, you get an experience counter.', 'Legendary Creature — God')).toBe(true);
    expect(isFull('Whenever you attack with one or more Gods and whenever a God dies, you get two experience counters.', 'Legendary Creature — God')).toBe(true);
    expect(isFull('Whenever you attack with one or more Gods and whenever a God dies or wins, you get an experience counter.', 'Legendary Creature — God')).toBe(false);
  });
  it('CR 121.1, 608.2c: "Each opponent draws a card. You draw a card for each card drawn this way." (two sentences); other counts of the drawn cards are not read', () => {
    expect(isFull('At the beginning of your upkeep, each opponent draws a card. You draw a card for each card drawn this way.', 'Enchantment')).toBe(true);
    expect(isFull('At the beginning of your upkeep, each opponent draws two cards. You draw a card for each card drawn this way.', 'Enchantment')).toBe(false);
  });
});
