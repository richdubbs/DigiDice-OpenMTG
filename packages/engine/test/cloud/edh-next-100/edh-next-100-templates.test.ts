/**
 * Concept round emblem-cleave, edh-next-100: the template data of parser/templates/zz-cloud/edh-next-100.json ("becomes a legendary 4/4 red Dragon creature with ...", Sarkhan the Dragonspeaker;
 * "you may cast red spells from among them", Chandra, Dressed to Kill; the emblem static "as long as ..., you can't lose the game ...", Gideon of the Trials) and the parser, renderer and engine changes of the round (one test each at the end). Guard G9 (design 6.8): every example lowers with its
 * template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any
 * word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10). The behavior is in edh-next-100-scenarios.test.ts. CR cites from memory (unverified).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext100 from '../../../src/parser/templates/zz-cloud/edh-next-100.json';
import review from '../../m5/golden/cards/edh-next-100-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext100 as Template[];
const MECH_COUNT = 2;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only one
 * or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (decided by the owner's standing rule 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhn100.becomes.legendary.color.with.lead': ['Sarkhan, the Dragonspeaker'],
  'eff.edhn100.cast.colorSpellsFromGroup.dur': ['Chandra, Dressed to Kill'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (a sorcery); the others are abilities of a creature (static, triggered, replacement). */
const SPELL = new Set<string>(['eff.edhn100.becomes.legendary.color.with.lead', 'eff.edhn100.cast.colorSpellsFromGroup.dur']);
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id)
    ? parseCard(card('Example Plan', 'Sorcery', text, { mana_cost: '{X}{R}' }), OPTS)
    : parseCard(card('Example Relic', 'Legendary Artifact Creature — Golem Villain', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-next-100 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-100.json, path order: after edh-next-10, before edh-next-11) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-100.json');
    expect(files.indexOf('zz-cloud/edh-next-100.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-10.json'));
    expect(files.indexOf('zz-cloud/edh-next-100.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-11.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are eff.edhn100.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|rst|trg|rep)\.edhn100\./);
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

describe('edh-next-100 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bor more\b/, 'or less'], [/\bhaste\b/, 'flying'], [/\btop\b/, 'bottom'], [/\bonce\b/i, 'twice'], [/\bcast\b/, 'exile'], [/\bwithout paying its mana cost\b/, 'by paying its mana cost'], [/\bor less\b/, 'or more'], [/\bplay\b/, 'cast'], [/\battacked\b/, 'blocked'], [/\bspell\b/, 'ability'], [/\blife\b/, 'cards'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-100 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-100 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (words.includes('--') && i < words.indexOf('--')) return; // the ability word before the dash has no rules meaning (CR 207.2c)
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

describe.skipIf(index === null)('edh-next-100 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-100 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-next-100 parser, renderer and engine changes (one test each)', () => {
  const spell = (text: string, type = 'Sorcery', name = 'Example Plan') => parseCard(card(name, type, text), OPTS).faces[0]!;
  const walker = (text: string) => parseCard(card('Example Walker', 'Legendary Planeswalker — Testa', text, { loyalty: '5' }), OPTS).faces[0]!;
  it('render/steps-lasting.ts (CR 114.2; Saheeli, Tamiyo the Moon Sage, Sarkhan): a list of quoted emblem abilities has the full stop on the last one only', () => {
    const t = '-4: You get an emblem with "Artifact creatures you control get +1/+1" and "Artifact spells you cast cost {1} less to cast."';
    expect(fullyAutomated(walker(t))).toBe(true);
    expect(fullyAutomated(walker(t.replace('+1/+1"', '+1/+1."')))).toBe(false); // a full stop inside the first quote is not Oracle's wording
    expect(fullyAutomated(walker('-4: You get an emblem with "Artifact creatures you control get +1/+1" "Artifact spells you cast cost {1} less to cast."'))).toBe(false);
  });
  it('render/steps-lasting.ts (CR 114.2): an emblem inside a quoted granted ability is quoted with single quotes', () => {
    const t = 'Enchant planeswalker\nEnchanted planeswalker has "[-12]: You get an emblem with \'You have no maximum hand size.\'"';
    expect(fullyAutomated(parseCard(card('Example Talent', 'Enchantment — Aura', t), OPTS).faces[0]!)).toBe(true);
    expect(fullyAutomated(parseCard(card('Example Talent', 'Enchantment — Aura', t.replace(/'/g, '"')), OPTS).faces[0]!)).toBe(false);
  });
  it('core/legal.ts, model/capabilities.ts (CR 114.4, 113.6p, 602.2; Ob Nixilis of the Black Oath): the activated ability of an emblem is understood (it is played in edh-next-100-scenarios.test.ts)', () => {
    const t = '-8: You get an emblem with "{1}{B}, Sacrifice a creature: You gain X life and draw X cards, where X is the sacrificed creature\'s power."';
    expect(fullyAutomated(walker(t))).toBe(true);
    expect(fullyAutomated(walker(t.replace('Sacrifice a creature', 'Sacrifice a creature, then sacrifice a land')))).toBe(false);
  });
  it('render/cond.ts (CR 108.1, 105.2; Tamiyo, Inquisitive Student): "if it\'s a green card" is the card noun with a color, a token is no card', () => {
    const t = 'Return target instant or sorcery card from your graveyard to your hand. If it\'s a green card, add one mana of any color.';
    expect(fullyAutomated(spell(t))).toBe(true);
    expect(JSON.stringify(spell(t).abilities)).toContain('"isCard":true');
    expect(fullyAutomated(spell(t.replace('green card', 'green token')))).toBe(false);
  });
  it('parser/holes/filter.ts, render/np.ts (CR 601.2a, 707.10; Wash Away): "a spell that wasn\'t cast from its owner\'s hand" is not cast from a hand (a copy was never cast)', () => {
    const t = "Counter target spell that wasn't cast from its owner's hand.";
    expect(fullyAutomated(spell(t, 'Instant'))).toBe(true);
    expect(JSON.stringify(spell(t, 'Instant').abilities)).toContain('"not":{"castFrom":"hand"}');
    expect(fullyAutomated(spell(t.replace('its owner', 'your'), 'Instant'))).toBe(false);
  });
  it('parser/cleave.ts, render/cleave.ts (CR 702.148a-b; Wash Away, Dig Up, Path of Peril): both readings of a cleave spell are parsed; a spell with a bracketed line one reading cannot parse stays manual', () => {
    const t = 'Cleave {4}{W}{B}\nDestroy all creatures [with mana value 2 or less].';
    expect(fullyAutomated(spell(t))).toBe(true);
    expect(JSON.stringify(spell(t).abilities)).toContain('"cleave":{');
    expect(fullyAutomated(spell('Cleave {4}{W}{B}\nDestroy all creatures [with a blorfty].'))).toBe(false);
    expect(fullyAutomated(spell('Destroy all creatures [with mana value 2 or less].'))).toBe(false); // no cleave line: brackets mean nothing
  });
});
