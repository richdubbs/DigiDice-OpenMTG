/**
 * Commander coordinator D, round edh-d-16 (EDHREC ranks 12,501-13,750, fifth pass): the template data of parser/templates/zz-cloud/edh-d-16.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-d-16-scenarios.test.ts.
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
import edhD16 from '../../../src/parser/templates/zz-cloud/edh-d-16.json';
import review from '../../m5/golden/cards/edh-d-16-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD16 as Template[];
const MECH_COUNT = 7;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 15,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27, more cards 2026-10-30)
  'eff.edhd16.dig.putAny.hand.restBottom': ['Torsten, Founder of Benalia'],
  'eff.edhd16.dig.mayPut.mvAtMost.bf.tappedAttacking': ['Jet, Rebel Leader'],
  'eff.edhd16.put.self.fromYourGraveyard.thirdFromTop': ['Bookwurm'],
  'rid.edhd16.copy.newTargets.thatCopy': ['Mischievous Quanar'],
  'eff.edhd16.cast.fromAGraveyard.mvAtMostQty.free': ['Spectral Arcanist'],
  'eff.edhd16.exile.filterCardMvAtMost.fromGraveyard.atRandom': ['Storm of Memories'],
  'cm.edhd16.alternative.fromGraveyard.mana': ['Raffine\'s Guidance'],
}
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-d-16 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-16.json, path order: after edh-d-11.json, before edh-mana-keywords-1.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-16.json');
    expect(files.indexOf('zz-cloud/edh-d-16.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-11.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 16; ids are *.edhd16.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rst|ch|rid|cm)\.edhd16\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(16);
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

describe('edh-d-16 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-d-16 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-16 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-d-16 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-16 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-d-16 renderer, lowering and engine changes (one test each)', () => {
  const spell = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  const creature = (text: string, type = 'Creature — Wizard') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('render/fold.ts#putAnyFromGroupAndRest (CR 701.20a, 608.2c-d, 401.4): "Put any number of <cards> from among them into your hand and the rest on the bottom of your library in a random order" is one sentence (no "may"); the rest elsewhere, in any order or onto the battlefield is another reading', () => {
    expect(fullyAutomated(spell('Reveal the top six cards of your library. Put any number of artifact and/or land cards from among them into your hand and the rest on the bottom of your library in a random order.'))).toBe(true);
    expect(fullyAutomated(spell('Reveal the top six cards of your library. Put any number of artifact and/or land cards from among them into your hand and the rest on the bottom of your library in any order.'))).toBe(false);
    expect(fullyAutomated(spell('Reveal the top six cards of your library. Put any number of artifact and/or land cards from among them into your hand and the rest on top of your library in a random order.'))).toBe(false);
  });
  it('render/fold.ts#castFromOwnZone (CR 608.2g, 601.2, 118.9, 202.3): a free cast from a graveyard of any player with a counted limit on the mana value says the limit before the zone; "your graveyard", a plain number limit or a cast that is not free is another reading', () => {
    expect(fullyAutomated(spell('You may cast an instant or sorcery spell with mana value less than or equal to the number of creatures you control from a graveyard without paying its mana cost. If that spell would be put into a graveyard, exile it instead.'))).toBe(true);
    expect(fullyAutomated(spell('You may cast an instant or sorcery spell with mana value less than or equal to the number of creatures you control from a graveyard. If that spell would be put into a graveyard, exile it instead.'))).toBe(false);
    expect(fullyAutomated(spell('You may cast an instant or sorcery spell with mana value less than or equal to the number of creatures you control from a blorfty without paying its mana cost.'))).toBe(false);
  });
  it('render/fold.ts#exileRandomFromGraveyard (CR 608.2d, 406.3, 202.3): "Exile an instant or sorcery card with mana value 3 or less from your graveyard at random" says the limit after the card; a limit of "or more" or another zone is no reading', () => {
    expect(fullyAutomated(spell('Exile an instant or sorcery card with mana value 3 or less from your graveyard at random. You may cast it without paying its mana cost.'))).toBe(true);
    expect(fullyAutomated(spell('Exile an instant or sorcery card with mana value 3 or more from your graveyard at random. You may cast it without paying its mana cost.'))).toBe(false);
    expect(fullyAutomated(spell('Exile an instant or sorcery card with mana value 3 or less from your blorfty at random. You may cast it without paying its mana cost.'))).toBe(false);
  });
  it('render/stat.ts#alternativeCost (CR 118.9, 601.2b): an alternative cost to cast from your graveyard says "rather than paying its mana cost" as well as "rather than pay ~\'s mana cost"; another zone keeps its own reading', () => {
    expect(fullyAutomated(parseCard(card('Example Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.\nYou may cast ~ from your graveyard by paying {2}{W} rather than paying its mana cost.', { mana_cost: '{W}' }), OPTS).faces[0]!)).toBe(true);
    expect(fullyAutomated(parseCard(card('Example Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.\nYou may cast ~ from your blorfty by paying {2}{W} rather than paying its mana cost.', { mana_cost: '{W}' }), OPTS).faces[0]!)).toBe(false);
  });
  it('render/steps-zones.ts#copyNewTargets (CR 707.10c, 115.7): "You may choose new targets for that copy." after a copy of a spell gives the same JSON as "... for the copy."; a copy of a permanent gets no such rider', () => {
    const a = spell('Copy target instant spell. You may choose new targets for the copy.');
    const b = spell('Copy target instant spell. You may choose new targets for that copy.');
    expect(fullyAutomated(b)).toBe(true);
    expect(jsonKey(b.abilities)).toBe(jsonKey(a.abilities));
    expect(fullyAutomated(creature('When this creature enters, draw a card. You may choose new targets for that copy.'))).toBe(false);
  });
});
