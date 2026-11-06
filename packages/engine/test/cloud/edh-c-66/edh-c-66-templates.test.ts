/**
 * Commander lane edh-c, round edh-c-66: the template data of parser/templates/zz-cloud/edh-c-66.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-c-66-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. CR cites checked against the Comprehensive Rules of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC66 from '../../../src/parser/templates/zz-cloud/edh-c-66.json';
import review from '../../m5/golden/cards/edh-c-66-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC66 as Template[];
const MECH_COUNT = 5;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 30,000 that print each wording and are full
  'eff.edhv66.search.playerLibrary.upTo.exile': ['Denying Wind'],
  'eff.edhv66.search.playerLibrary.upToX.whereX.exile': ['Nightmare Incursion'],
  'eff.edhv66.put.bf.andShuffleRest': ['Riptide Shapeshifter'],
  'eff.edhv66.also.damage.ifCond': ["Kami's Flare"],
  'sta.edhv66.permit.revealHand.players': ['Revelation'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || text.startsWith('~') ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-c-66 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-66.json, path order: edh-c-66 sorts after edh-c-6, before edh-c-8) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-66.json');
    expect(files.indexOf('zz-cloud/edh-c-66.json')).toBeLessThan(files.indexOf('zz-cloud/edh-c-8.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhv66.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid)\.edhv66\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
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

describe('edh-c-66 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bElemental\b/, 'Elementals'], [/\bhaste\b/, 'x'], [/\bdouble\b/, 'triple'], [/\bloses\b/, 'gains'], [/\bcounters\b/, 'x'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-c-66 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-66 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-66 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-66 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-c-66 renderer, lowering and engine changes (one test each)', () => {
  const creature = (text: string, type = 'Creature — Wizard') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const spell = (text: string, type = 'Instant') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  it('render/fold-edhc66.ts (CR 701.23a, 107.3, 608.2h): "up to X cards, where X is <quantity>, and exile them" says the clause before the "and"; an unrestricted search of your own library or a stated card kind stays with its own wording', () => {
    expect(fullyAutomated(spell("Search target player's library for up to X cards, where X is the number of creatures you control, and exile them. Then that player shuffles.", 'Sorcery'))).toBe(true);
    expect(fullyAutomated(spell("Search target player's library for up to X cards, where X is the number of creatures you control, and exile it. Then that player shuffles.", 'Sorcery'))).toBe(false);
    expect(fullyAutomated(spell("Search target player's library for up to X creature cards, where X is the number of creatures you control, and exile them. Then that player shuffles.", 'Sorcery'))).toBe(false);
  });
  it('render/fold-edhc66.ts (CR 701.20a, 701.24a): "put that card onto the battlefield and put all other cards revealed this way into your graveyard" only when the other revealed cards are the ones not put; tapped or a hand destination stays manual', () => {
    const head = 'Reveal cards from the top of your library until you reveal a land card.';
    expect(fullyAutomated(spell(`${head} Put that card onto the battlefield and put all other cards revealed this way into your graveyard.`, 'Sorcery'))).toBe(true);
    expect(fullyAutomated(spell(`${head} Put that card onto the battlefield tapped and put all other cards revealed this way into your graveyard.`, 'Sorcery'))).toBe(false);
    expect(fullyAutomated(spell(`${head} Put that card onto the battlefield and put all other cards revealed this way into your hand.`, 'Sorcery'))).toBe(false);
  });
  it('render/steps-flow.ts (CR 608.2c; Katara): "draw a card, then discard a card unless <condition>" is one sentence with ", then"; the same words with "if" or a payment stay different', () => {
    expect(fullyAutomated(creature('When ~ enters, draw a card, then discard a card unless you control a Wizard.'))).toBe(true);
    expect(fullyAutomated(creature('When ~ enters, draw a card, then discard a card if you control a Wizard.'))).toBe(false);
    expect(fullyAutomated(creature('When ~ enters, draw a card and discard a card unless you control a Wizard.'))).toBe(false);
  });
  it('parser/holes/filter.ts and render/np.ts (CR 202.3, 601.2i; Celestial Kirin): "with that spell\'s mana value" is the spell the cast trigger names; in a trigger with no spell the sentence stays manual', () => {
    expect(fullyAutomated(creature("Whenever you cast a Spirit spell, destroy all permanents with that spell's mana value."))).toBe(true);
    expect(fullyAutomated(creature("Whenever ~ enters, destroy all permanents with that spell's mana value."))).toBe(false);
    expect(fullyAutomated(creature("Whenever you cast a Spirit spell, destroy all permanents with that creature's mana value."))).toBe(false);
  });
  it('render/steps-flow.ts (CR 120.3, 608.2c; Kami\'s Flare): the condition after "also deals N damage to X"; "unless" or a missing "also" is a different sentence', () => {
    expect(fullyAutomated(spell("~ deals 3 damage to target creature. ~ also deals 2 damage to that creature's controller if you control a modified creature."))).toBe(true);
    expect(fullyAutomated(spell("~ deals 3 damage to target creature. ~ also deals 2 damage to that creature's controller unless you control a modified creature."))).toBe(false);
  });
  it('parser/lower/anaphora.ts and render/refs.ts (CR 603.4, 303.4; Volition Reins): in an Aura\'s trigger whose intervening if is about the enchanted permanent, "it" is that permanent; a different condition keeps "it" ambiguous', () => {
    const untapped = (text: string): string => JSON.stringify(spell(text, 'Enchantment — Aura').abilities.flatMap((a) => JSON.stringify(a).match(/"op":"untap","what":\{[^}]*\}/g) ?? []));
    expect(fullyAutomated(spell('Enchant permanent\nWhen ~ enters, if enchanted permanent is tapped, untap it.\nYou control enchanted permanent.', 'Enchantment — Aura'))).toBe(true);
    expect(untapped('Enchant permanent\nWhen ~ enters, if enchanted permanent is tapped, untap it.\nYou control enchanted permanent.')).toContain('attachedTo');
    expect(untapped('Enchant permanent\nWhen ~ enters, if you control a Wizard, untap it.\nYou control enchanted permanent.')).not.toContain('attachedTo');
  });
  it('statics/rule-sources.ts (CR 402.2, 607.2d; Cursed Rack): a linked player reference is read as the players the link holds (scenarios: the chosen opponent only)', () => {
    expect(fullyAutomated(parseCard(card('Example Rack', 'Artifact', "As ~ enters, choose an opponent.\nThe chosen player's maximum hand size is four."), OPTS).faces[0]!)).toBe(true);
  });
});
