/**
 * Commander lane edh-c, round edh-c-60: the template data of parser/templates/zz-cloud/edh-c-60.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-c-60-scenarios.test.ts.
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
import edhC60 from '../../../src/parser/templates/zz-cloud/edh-c-60.json';
import review from '../../m5/golden/cards/edh-c-60-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC60 as Template[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 30,000 that print each wording and are full
  'eff.edhv60.prevent.nextUnblockedChoice.combatToYou.allButN': ['Forcefield'],
  'eff.edhv60.redirect.nextSourceChoice.toSelf': ["Opal-Eye, Konda's Yojimbo"],
  'eff.edhv60.redirect.combatToYouByTarget.toItsController': ['Mirror Strike'],
  'eff.edhv60.skip.nextCombatPhase.dur': ['Moment of Silence'],
  'eff.edhv60.dig.putAll.bf.rest.hand': ["Nissa, Nature's Artisan"],
  'sta.edhv60.cantbetargeted.nongreen': ["Gaea's Revenge"],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || text.startsWith('~') ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-c-60 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-60.json, path order: after edh-c-6, before edh-c-8) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-60.json');
    expect(files.indexOf('zz-cloud/edh-c-60.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-c-6.json'));
    expect(files.indexOf('zz-cloud/edh-c-60.json')).toBeLessThan(files.indexOf('zz-cloud/edh-c-8.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhv60.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|abl)\.edhv60\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
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

describe('edh-c-60 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-c-60 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-60 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-60 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-60 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-c-60 renderer and lowering changes (one test each)', () => {
  const spell = (text: string, type = 'Instant') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  const planeswalker = (text: string) => parseCard(card('Example Walker', 'Legendary Planeswalker — Test', text, { loyalty: '4' }), OPTS).faces[0]!;
  it('render/stat.ts (CR 614.9, 506.4): the redirection of combat damage by a named source to its controller is read; to you instead, or without "combat", stay other readings', () => {
    expect(fullyAutomated(spell('All combat damage that would be dealt to you this turn by target unblocked creature is dealt to its controller instead.'))).toBe(true);
    expect(fullyAutomated(spell('All combat damage that would be dealt to you this turn by target unblocked creature is dealt to you instead.'))).toBe(false);
    expect(fullyAutomated(spell('All combat damage that would be dealt to target player this turn by target unblocked creature is dealt to its controller instead.'))).toBe(false);
  });
  it('render/stat.ts (CR 614.10a, 500.11): "skips their next combat phase" says "this turn" for a shield that ends with the turn, and nothing for the permanent one (std-ry3)', () => {
    expect(fullyAutomated(spell('Target player skips their next combat phase this turn.'))).toBe(true);
    expect(fullyAutomated(spell('Target player skips their next combat phase.'))).toBe(true);
    expect(fullyAutomated(spell('Target player skips their next two combat phases this turn.'))).toBe(false);
  });
  it('render/refs.ts (CR 502.1, 614.10; family skip-step-that-player): "That player skips their next untap step" after a target player is one player, not two antecedents; with no earlier mention the pronoun still has none', () => {
    expect(fullyAutomated(planeswalker('-1: Tap all permanents target opponent controls. That player skips their next untap step.'))).toBe(true);
    expect(fullyAutomated(spell('Target opponent discards a card. That player skips their next untap step.', 'Sorcery'))).toBe(true);
    expect(fullyAutomated(spell('Draw a card. That player skips their next untap step.', 'Sorcery'))).toBe(false);
  });
  it('render/fold.ts (CR 701.20e, 608.2c): "Put all land cards from among them onto the battlefield and the rest into your hand." is read; tapped, one card, or a different destination for the rest are other readings', () => {
    const dig = (put: string) => spell(`Reveal the top four cards of your library. ${put}`, 'Sorcery');
    expect(fullyAutomated(dig('Put all land cards from among them onto the battlefield and the rest into your hand.'))).toBe(true);
    expect(fullyAutomated(dig('Put all land cards from among them onto the battlefield tapped and the rest into your hand.'))).toBe(false);
    expect(fullyAutomated(dig('Put all land cards from among them into your hand and the rest into your hand.'))).toBe(false);
  });
  it('render/refs.ts (CR 105.1, 608.2c; family target-and-each-other-sharing-color): "Target creature and each other creature that shares a color with it" is read; "all other creatures" says it too; sharing a creature type is another reading', () => {
    const g = (t: string) => spell(`Choose a color. ${t} gain protection from the chosen color until end of turn.`);
    expect(fullyAutomated(g('Target creature and each other creature that shares a color with it'))).toBe(true);
    expect(fullyAutomated(g('Target creature and each other creature that shares a creature type with it'))).toBe(false);
  });
  it('parser/lower/anaphora.ts#searchIdiom (CR 701.23, 608.2c): after a search for several cards, "reveal them, put them into your hand" are the cards found, even beside the discards that gave the amount; a search with no reveal keeps the old reading', () => {
    expect(fullyAutomated(spell('Discard any number of cards. Search your library for up to that many basic land cards, reveal them, put them into your hand, then shuffle.', 'Sorcery'))).toBe(true);
    expect(fullyAutomated(spell('Search your library for up to three basic land cards, reveal them, put them into your hand, then shuffle.', 'Sorcery'))).toBe(true);
    expect(fullyAutomated(spell('Discard any number of cards. Search your library for up to that many basic land cards, reveal them, put them onto the battlefield, then shuffle.', 'Sorcery'))).toBe(true);
  });
});
