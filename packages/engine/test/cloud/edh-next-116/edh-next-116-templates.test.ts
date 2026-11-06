/**
 * Coordinator A, round edh-next-116 (THIRD PASS 4 over top-rank-t4): the template data of parser/templates/zz-cloud/edh-next-116.json and the round's parser, lowering and renderer changes,
 * tested at the end of this file and in edh-next-116-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. CR cites from memory unless noted (unverified in the record).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext116 from '../../../src/parser/templates/zz-cloud/edh-next-116.json';
import review from '../../m5/golden/cards/edh-next-116-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext116 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full
  'eff.edhn116.eachPlayer.keepLandFourTypes': ['Cataclysm'],
  'eff.edhn116.opponents.cantCastOrActivateLoyalty': ['Flamescroll Celebrant // Revel in Silence'],
  'eff.edhn116.counters.two.forEach': ['The Elderspell'],
  'eff.edhn116.exile.thenReturnAllOtherLinked': ['Mirror of Life Trapping'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || text.startsWith('~') ? card('Example Subject', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-116 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-116.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-116.json');
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhn116.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|rst|trg|ch|rid|ab|dl)\.edhn116\./);
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

describe('edh-next-116 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bhaste\b/, 'x'], [/\bblocked\b/, 'x'], [/\buntapped\b/, 'x'], [/\btoughness\b/, 'power'], [/\battack\b/, 'block'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-116 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-116 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-next-116 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-116 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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



// ---- the round's readings without a template of their own (hole, lowering and renderer changes) ----------------------------------------------------------------------------------
const reading = (name: string, type: string, text: string) => parseCard(card(name, type, text), OPTS).faces[0]!;
const rSpell = (text: string) => reading('Example Rite', 'Sorcery', text);
const rPerm = (text: string) => reading('Example Relic', 'Artifact Creature — Construct', text);

describe('CR 608.2c, 608.2h: "for each permanent exiled this way" after "up to N target permanents" (a target with no description of its own)', () => {
  const TEXT = 'Exile up to three target permanents. For each permanent exiled this way, its controller creates a 2/2 white Knight creature token.';
  it('is automated, with the permanents the exile named', () => {
    expect(fullyAutomated(rSpell(TEXT))).toBe(true);
    expect(fullyAutomated(rSpell(TEXT.replace('permanents', 'nonland permanents')))).toBe(true);
  });
  it('negatives: a different noun in "for each ... exiled this way", or a destroy before it, is not the exile of those permanents', () => {
    expect(fullyAutomated(rSpell(TEXT.replace('For each permanent exiled', 'For each creature exiled')))).toBe(false);
    expect(fullyAutomated(rSpell(TEXT.replace('For each permanent exiled', 'For each permanent destroyed')))).toBe(false);
  });
});

describe('CR 205.2a, 205.4a: "target artifact, enchantment, or legendary card" (card types and a supertype in one list)', () => {
  const TEXT = 'Return target artifact, enchantment, or legendary card from your graveyard to your hand.';
  it('is automated', () => { expect(fullyAutomated(rSpell(TEXT))).toBe(true); });
  it('is the three descriptions: an artifact, an enchantment, or a legendary card', () => {
    const j = JSON.stringify(rSpell(TEXT).abilities);
    expect(j).toContain('"anyOf":[{"types":["Artifact"]},{"types":["Enchantment"]},{"supertypes":["Legendary"]}]');
  });
  it('negatives: another supertype, a plural list or a missing "or" stays manual', () => {
    expect(fullyAutomated(rSpell(TEXT.replace('legendary', 'snow')))).toBe(false);
    expect(fullyAutomated(rSpell('Return target artifact, enchantment and legendary card from your graveyard to your hand.'))).toBe(false);
    expect(jsonKey(rSpell(TEXT).abilities)).not.toBe(jsonKey(rSpell('Return target artifact, enchantment, or creature card from your graveyard to your hand.').abilities));
  });
});

describe('CR 208.1, 608.2h: "the greatest power among other Dragons you control and Dragon cards in your graveyard" (two zones, one set)', () => {
  const TEXT = 'Whenever this creature attacks, it gets +X/+X until end of turn, where X is the greatest power among other Dragons you control and Dragon cards in your graveyard.';
  it('is automated and says both zones', () => {
    const f = reading('Example Wyrm', 'Legendary Creature — Dragon', TEXT);
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"zone":["battlefield","graveyard"]');
  });
  it('negative (review): a first group with no controller ("other creatures and creature cards in your graveyard") would reach every graveyard and stays manual', () => {
    expect(JSON.stringify(reading('Example Wyrm', 'Legendary Creature — Dragon', TEXT.replace('other Dragons you control', 'other Dragons').replace('Dragon cards', 'creature cards')).abilities)).not.toContain('"zone":["battlefield","graveyard"]');
  });
  it('negatives: a second description in no graveyard, or one description only, is not this reading', () => {
    expect(JSON.stringify(reading('Example Wyrm', 'Legendary Creature — Dragon', TEXT.replace('in your graveyard', 'in your hand')).abilities)).not.toContain('"zone":["battlefield","graveyard"]');
    expect(JSON.stringify(reading('Example Wyrm', 'Legendary Creature — Dragon', TEXT.replace(' and Dragon cards in your graveyard', '')).abilities)).not.toContain('"zone":["battlefield","graveyard"]');
  });
});

describe('CR 400.7, 506.1: "that wasn\'t put there this combat" (a card put into the graveyard during the current combat)', () => {
  const TEXT = "Whenever this creature deals combat damage to a player, return to your hand target creature card in your graveyard that wasn't put there this combat.";
  it('is automated', () => { expect(fullyAutomated(rPerm(TEXT))).toBe(true); });
  it('is a different filter from "this turn", and the positive wording differs from the negative', () => {
    expect(jsonKey(rPerm(TEXT).abilities)).not.toBe(jsonKey(rPerm(TEXT.replace('this combat', 'this turn')).abilities));
    expect(JSON.stringify(rPerm(TEXT).abilities)).toContain('"putThereThisCombat":false');
    expect(JSON.stringify(rPerm(TEXT.replace("wasn't put", 'was put')).abilities)).toContain('"putThereThisCombat":true');
  });
  it('negative: "this combat" with no graveyard named stays manual', () => {
    expect(fullyAutomated(rPerm("Whenever this creature deals combat damage to a player, destroy target creature that wasn't put there this combat."))).toBe(false);
  });
});

describe('CR 601.2a, 603.4: "if it was cast" of the object the trigger is about', () => {
  const TEXT = 'Whenever a creature enters, if it was cast, you gain 1 life.';
  it('is automated, and differs from "if you cast it"', () => {
    expect(fullyAutomated(rPerm(TEXT))).toBe(true);
    expect(fullyAutomated(rPerm(TEXT.replace('it was cast', 'you cast it')))).toBe(true);
    expect(jsonKey(rPerm(TEXT).abilities)).not.toBe(jsonKey(rPerm(TEXT.replace('it was cast', 'you cast it')).abilities));
  });
  it('negative: "if it was cast from your hand" is its own reading', () => {
    expect(jsonKey(rPerm(TEXT).abilities)).not.toBe(jsonKey(rPerm(TEXT.replace('it was cast', 'you cast it from your hand')).abilities));
  });
});
