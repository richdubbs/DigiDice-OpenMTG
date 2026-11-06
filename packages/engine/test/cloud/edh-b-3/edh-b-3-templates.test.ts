/**
 * Commander lane edh-b, round edh-b-3: the template data of parser/templates/zz-cloud/edh-b-3.json (up-to-N searches with a mana value, the five-color search, "up to X cards", "can block any number of creatures", "draw, lose life, then", exile of all hands and graveyards, "gain control of each") and the round's parser and renderer changes.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-b-3-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhB3 from '../../../src/parser/templates/zz-cloud/edh-b-3.json';
import reviewB3 from '../../m5/golden/cards/edh-b-3-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhB3 as Template[];
/** The round's golden entries. */
const review = reviewB3 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 8;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhb3.search.upTo.cardsDesc.reveal': ['Ranger of Eos'],
  'eff.edhb3.search.upTo.reveal.shuffleTopAnyOrder': ['Congregation at Dawn'],
  'eff.edhb3.search.oneOfEach5': ['Conflux'],
  'eff.edhb3.search.upTo.anyCards': ['Diabolic Revelation'],
  'sta.edhb3.attached.blocks.anynumber': ['Entangler'],
  'eff.edhb3.you.draw.loseLife.thenEffects': ['Pointed Discussion'],
  'eff.edhb3.exile.allCards.allHandsAndGraveyards': ['Worldfire'],
  'eff.edhb3.search.may.basicLandOrSubtype.reveal.hand': ['District Guide'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (_t: Template, text: string) =>
  /^Enchant\b/.test(text) ? parseCard(card('Example Charm', 'Enchantment — Aura', text), OPTS).faces[0]!
  : /^Equip\b/.test(text) ? parseCard(card('Example Gear', 'Artifact — Equipment', text), OPTS).faces[0]!
  : parseCard(/^\{/.test(text) ? card('Example Plan', 'Artifact', text) : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-b-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-b-3.json, path order: after cmd2, before edh-cast-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-b-3.json');
    expect(files.indexOf('zz-cloud/edh-b-3.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhb3.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhb3\./);
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

describe('edh-b-3 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/half/, 'a third of'], [/rounded up/, 'rounded down'], [/round up/, 'round down'], [/your/, 'their'], [/first/, 'second'], [/an opponent/, 'you'], [/less/, 'more'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-b-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-b-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
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

describe.skipIf(index === null)('edh-b-3 design 6.10 (local index): synthetic examples', () => {
  it('no edh-b-3 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // design 6.9 deviation: the one-sentence wording "Enchanted creature can block any number of creatures." is printed by Entangler (a card of this round) and by no other
    // template-readable form, so its example line IS Oracle's line (the other lines of its examples are invented); recorded in the round's record
    const SAME_SENTENCE = new Set(['Enchanted creature can block any number of creatures.', 'Equipped creature can block any number of creatures.', 'Enchanted creature can block an additional creature each combat.']);
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !(t.id === 'sta.edhb3.attached.blocks.anynumber' && SAME_SENTENCE.has(l.trim())))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

const sorcery = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Drake', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;

describe('edh-b-3 parser and renderer changes (one test each)', () => {
  it('parser/holes/filter.ts (pre-modifier comma chain): "non-Angel, non-Demon, non-Devil, non-Dragon creature" and three negations read; two still read; a chain with a positive word in it ("non-Angel, Demon creature") or a missing comma does not', () => {
    for (const text of ['Destroy target non-Angel, non-Demon, non-Devil, non-Dragon creature.', 'Destroy target non-Vampire, non-Werewolf, non-Zombie creature.', 'Destroy target non-Angel, non-Demon creature.']) {
      expect(fullyAutomated(sorcery(text)), text).toBe(true);
    }
    const four = JSON.stringify(sorcery('Destroy target non-Angel, non-Demon, non-Devil, non-Dragon creature.').abilities);
    expect(four).toContain('"notSubtypes":["Angel","Demon","Devil","Dragon"]');
    for (const bad of ['Destroy target non-Angel, Demon, non-Devil creature.', 'Destroy target non-Angel non-Demon non-Devil creature.', 'Destroy target non-Angel, non-Demon, non-Devil, creature.']) {
      expect(fullyAutomated(sorcery(bad)) && JSON.stringify(sorcery(bad).abilities) === four, bad).toBe(false);
    }
  });
  it('eff.edhb3.search.may.basicLandOrSubtype.reveal.hand (priority 2, beside eff.t31.search.may.orFilter.reveal.hand): "you may search your library for a basic land card or Gate card, reveal it, put it into your hand, then shuffle" is no longer a guard G5 ambiguity, and the spell form still reads', () => {
    expect(fullyAutomated(creature('When this creature enters, you may search your library for a basic land card or Gate card, reveal it, put it into your hand, then shuffle.'))).toBe(true);
    expect(fullyAutomated(sorcery('Search your library for a basic land card or Gate card, reveal it, put it into your hand, then shuffle.'))).toBe(true);
    expect(fullyAutomated(sorcery('Search your library for a basic land card or Gate card, reveal it, put it onto the battlefield, then shuffle.'))).toBe(true);
    expect(fullyAutomated(creature('When this creature enters, you may search your library for a basic land card or Gate card, reveal it, put it into your hand, then shuffle it.'))).toBe(false);
  });
  it('render/quote.ts and render/np.ts: a quoted ability granted by an Aura reads "equipped creature" (an Equipment is the grantee), and "all cards from all hands and graveyards" renders in Oracle\'s word order', () => {
    const rune = parseCard(card('Example Rune', 'Enchantment — Aura Rune', 'Enchant permanent\nAs long as enchanted permanent is an Equipment, it has "Equipped creature gets +1/+1 and has trample."'), OPTS).faces[0]!;
    expect(fullyAutomated(rune)).toBe(true);
    expect(fullyAutomated(sorcery('Exile all cards from all hands and graveyards.'))).toBe(true);
    expect(fullyAutomated(sorcery('Exile all cards from all graveyards and hands.'))).toBe(false);
  });
});
