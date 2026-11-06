/**
 * Commander coordinator D, round edh-d-8 (EDHREC ranks 11,251-12,500, second pass): the template data of parser/templates/zz-cloud/edh-d-8.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-d-8-scenarios.test.ts.
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
import edhD8 from '../../../src/parser/templates/zz-cloud/edh-d-8.json';
import review from '../../m5/golden/cards/edh-d-8-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD8 as Template[];
const MECH_COUNT = 5;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27, more cards 2026-10-30)
  'rep.edhd8.enters.counters.among': ['Ascendant Acolyte'],
  'sta.edhd8.damage.double.toSelf.anySource': ['Goldnight Castigator'],
  'sta.edhd8.aslong.basept.and.abilities': ['Timber Paladin'],
  'dl.edhd8.nextCleanup.tail': ['Thawing Glaciers'],
}
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-d-8 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-8.json, path order: after edh-combat-7.json, before edh-mana-keywords-1.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-8.json');
    expect(files.indexOf('zz-cloud/edh-d-8.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-4.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhd8.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rst|ch|rid|cm|dl)\.edhd8\./);
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

describe('edh-d-8 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [[/\btwo\b/, 'three'], [/\bhaste\b/, 'flying'], [/\bWalls\b/, 'Wall'], [/\bone\b/, 'two']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-d-8 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-8 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-d-8 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-8 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // design 6.10 deviation (named in the record): the one-card wording of sta.edhd8.damage.double.toSelf.anySource has no hole to vary, so its examples are Oracle's line of Goldnight Castigator
    const FIXED_WORDING = new Set(['sta.edhd8.damage.double.toSelf.anySource']);
    const verbatim = MECH.filter((t) => !FIXED_WORDING.has(t.id)).flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

describe('edh-d-8 renderer, lowering and engine changes (one test each)', () => {
  const creature = (text: string, type = 'Creature — Elf') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const spell = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  it('parser/holes/edhd8.ts, render/cond.ts (CR 303.4a, 301.5): "~ is enchanted by exactly N Auras" and "N or more Auras" count the Auras attached to the object; another noun, "Equipment" or no "exactly" is not that reading', () => {
    expect(fullyAutomated(creature('As long as ~ is enchanted by exactly one Aura, it has first strike.'))).toBe(true);
    expect(fullyAutomated(creature('As long as ~ is enchanted by exactly two Auras, it has first strike.'))).toBe(true);
    expect(fullyAutomated(creature('As long as ~ is enchanted by three or more Auras, it has first strike.'))).toBe(true);
    expect(fullyAutomated(creature('As long as ~ is enchanted by exactly two Equipment, it has first strike.'))).toBe(false);
    expect(fullyAutomated(creature('As long as ~ is enchanted by two Auras, it has first strike.'))).toBe(false);
    expect(fullyAutomated(creature('As long as ~ is enchanted by exactly two blorfty, it has first strike.'))).toBe(false);
  });
  it('parser/holes/edhd8.ts, render/cond.ts (CR 303.4, 109.1): "another Aura is attached to enchanted creature" excludes the Aura itself; "an Aura" and "another Equipment" are not that reading', () => {
    expect(fullyAutomated(creature('As long as another Aura is attached to enchanted creature, it has first strike and lifelink.', 'Enchantment — Aura'))).toBe(true);
    expect(JSON.stringify(creature('As long as another Aura is attached to enchanted creature, it has first strike and lifelink.', 'Enchantment — Aura').abilities)).toContain('"other":true');
    expect(fullyAutomated(creature('As long as another Equipment is attached to enchanted creature, it has first strike and lifelink.', 'Enchantment — Aura'))).toBe(false);
  });
  it('render/mods.ts (CR 613.1f, 613.4b): a static base power and toughness with keywords is said "has base power and toughness 5/5 and vigilance" and "10/10, vigilance, and trample"; a quoted ability or a missing "and" is not', () => {
    expect(fullyAutomated(creature("As long as it's your turn, ~ has base power and toughness 5/5 and vigilance."))).toBe(true);
    expect(fullyAutomated(creature("As long as it's your turn, ~ has base power and toughness 5/5, vigilance, and trample."))).toBe(true);
    expect(fullyAutomated(creature("As long as it's your turn, ~ has base power and toughness 5/5 vigilance."))).toBe(false);
  });
  it('parser/holes/player.ts, render/refs.ts (CR 608.2d): "an opponent chosen at random" is "a random opponent"; "each opponent chosen at random" and "an opponent at random" are not', () => {
    expect(fullyAutomated(spell('~ deals 3 damage to an opponent chosen at random.'))).toBe(true);
    const shape = (text: string): string => JSON.stringify(spell(text).abilities.map((a) => { const { text: _text, src: _src, ...rest } = a as unknown as Record<string, unknown>; return rest; }));
    expect(shape('~ deals 3 damage to an opponent chosen at random.')).toBe(shape('~ deals 3 damage to a random opponent.'));
    expect(fullyAutomated(spell('~ deals 3 damage to each opponent chosen at random.'))).toBe(false);
  });
  it('parser/holes/cond.ts (CR 603.4, 205.3m): "you had another Cleric, Rogue, or Wizard enter the battlefield under your control this turn" is any of the subtypes other than ~; without "another", with "and" or with an invented subtype it is not read', () => {
    expect(fullyAutomated(creature("~ can't be blocked if you had another Cleric, Rogue, or Wizard enter the battlefield under your control this turn."))).toBe(true);
    expect(fullyAutomated(creature("~ can't be blocked if you had another Cleric, Rogue, and Wizard enter the battlefield under your control this turn."))).toBe(false);
    expect(fullyAutomated(creature("~ can't be blocked if you had another Cleric, Rogue, or Blorfty enter the battlefield under your control this turn."))).toBe(false);
  });
  it('render/cond.ts (CR 205.4a, 108.1): "if it\'s a snow card" is a card with the Snow supertype (the card noun, no zone); a bare supertype without "card" and an invented supertype are not', () => {
    const augur = (cond: string) => creature(`{T}: Look at the top card of your library. If it's ${cond}, you may reveal it and put it into your hand.`);
    expect(fullyAutomated(augur('a snow card'))).toBe(true);
    expect(fullyAutomated(augur('a legendary card'))).toBe(true);
    expect(fullyAutomated(augur('a blorfty card'))).toBe(false);
  });
  it('templates (CR 603.7, 514.1): "at the beginning of the next cleanup step" is a delayed trigger of the cleanup step; "your next cleanup step" and "each cleanup step" are not', () => {
    expect(JSON.stringify(spell("Draw a card. Return target creature you control to its owner's hand at the beginning of the next cleanup step.").abilities)).toContain('"step":"cleanup"');
    expect(fullyAutomated(spell('Draw a card at the beginning of each cleanup step.'))).toBe(false);
  });
});
