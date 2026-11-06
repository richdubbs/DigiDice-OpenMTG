/**
 * Commander coordinator D, round edh-d-36 (lane counter-modes): the template data of parser/templates/zz-cloud/edh-d-36.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-d-36-scenarios.test.ts.
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
import edhD36 from '../../../src/parser/templates/zz-cloud/edh-d-36.json';
import review from '../../m5/golden/cards/edh-d-36-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD36 as Template[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27, more cards 2026-10-30)
  'rid.edhd36.countered.topOrBottom': ['Hinder'],
  'rid.edhd36.countered.ifKind.battlefieldYours': ['Desertion'],
  'eff.edhd36.cast.fromGraveyard.mvAtMostThatSpell.free': ['Counterpoint'],
  'eff.edhd36.counter.unless.twiceX': ['Thassa\'s Intervention'],
  'eff.edhd36.player.tapAll.theyControl.loseMana': ['Power Sink'],
  'eff.edhd36.look.putOneBack.restGraveyard': ['Dimir Charm'],
}
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text, text.includes('{X}') ? { mana_cost: '{X}{U}{U}' } : {}), OPTS).faces[0]!;

describe('edh-d-36 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-36.json, path order: after edh-d-3.json, before edh-d-4.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-36.json');
    expect(files.indexOf('zz-cloud/edh-d-36.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhd36.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rst|ch|rid|cm)\.edhd36\./);
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

describe('edh-d-36 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-d-36 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-36 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-d-36 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-36 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-d-36 renderer, lowering and engine changes (one test each)', () => {
  const spell = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  const creature = (text: string, type = 'Creature — Wizard') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('effects/handlers/zones-remove.ts#counter (CR 701.6a, 401.4): a countered spell put "on your choice of the top or bottom of its owner\'s library" is read with that wording only; another chooser or a fixed end keeps its own template', () => {
    expect(fullyAutomated(spell('Counter target spell. If that spell is countered this way, put that card on your choice of the top or bottom of its owner\'s library instead of into that player\'s graveyard.'))).toBe(true);
    expect(fullyAutomated(spell('Counter target spell. If that spell is countered this way, put that card on its owner\'s choice of the top or bottom of its owner\'s library instead of into that player\'s graveyard.'))).toBe(false);
    expect(fullyAutomated(spell('Counter target spell. If that spell is countered this way, put that card on your choice of the top or blorfty of its owner\'s library instead of into that player\'s graveyard.'))).toBe(false);
  });
  it('effects/handlers/zones-remove.ts#counter, model/cap-walk.ts (CR 701.6a, 110.2): "put that card onto the battlefield under your control" is understood for a countered spell of a kind (no later sentence names the card); under its owner\'s control is another reading', () => {
    expect(fullyAutomated(spell('Counter target spell. If an artifact or creature spell is countered this way, put that card onto the battlefield under your control instead of into its owner\'s graveyard.'))).toBe(true);
    expect(fullyAutomated(spell('Counter target spell. If an artifact or creature spell is countered this way, put that card onto the battlefield under its owner\'s control instead of into its owner\'s graveyard.'))).toBe(false);
  });
  it('parser/lower/ability.ts (CR 202.3, 608.2h): "with equal or lesser mana value" and "less than or equal to that spell\'s mana value" name the spell the same ability countered; in a cast trigger they still name the spell that was cast', () => {
    expect(fullyAutomated(spell('Counter target spell. You may cast a spell with equal or lesser mana value from your hand without paying its mana cost.'))).toBe(true);
    expect(fullyAutomated(spell('Draw a card. You may cast a spell with equal or lesser mana value from your hand without paying its mana cost.'))).toBe(false);
    expect(fullyAutomated(creature('Whenever you cast a spell, you may cast a spell with equal or lesser mana value from your hand without paying its mana cost.'))).toBe(true);
  });
  it('render/costs.ts (CR 107.3, 118.12): a payment of {X}{X} is said "twice {X}"; another pair of symbols keeps its own words', () => {
    expect(fullyAutomated(spell('Counter target spell unless its controller pays twice {X}.'))).toBe(false); // (no {X} in this synthetic card\'s mana cost: the lint refuses a payment of X, CR 107.3f)
    expect(fullyAutomated(parseCard(card('Example Tax', 'Instant', 'Counter target spell unless its controller pays twice {X}.', { mana_cost: '{X}{U}{U}' }), OPTS).faces[0]!)).toBe(true);
    expect(fullyAutomated(parseCard(card('Example Tax', 'Instant', 'Counter target spell unless its controller pays {X}{X}.', { mana_cost: '{X}{U}{U}' }), OPTS).faces[0]!)).toBe(true);
  });
  it('render/np.ts, parser/holes/filter.ts (CR 605.1a): "lands with mana abilities" is a group of lands with a mana ability, said before the controller; "without mana abilities" keeps its reading', () => {
    expect(fullyAutomated(spell('Tap all lands with mana abilities target player controls.'))).toBe(false);
    expect(fullyAutomated(spell('Tap all lands with mana abilities you control.'))).toBe(true);
    expect(fullyAutomated(spell('Destroy all artifacts without mana abilities.'))).toBe(true);
  });
  it('render/steps-zones.ts#tapClause, render/steps.ts, render/steps-util.ts#byPlayer (CR 701.26a, 109.4): "Target opponent taps all creatures they control and loses all unspent mana" and, after \"If that player doesn\'t,\", the payer\'s \"they tap ... and lose ...\"; not the controller of another set', () => {
    expect(fullyAutomated(spell('Target opponent taps all creatures they control and loses all unspent mana.'))).toBe(true);
    expect(fullyAutomated(spell('Target opponent taps all creatures you control and loses all unspent mana.'))).toBe(false);
  });
  it('parser/lower/anaphora.ts#unlessIdiom (CR 118.12a): "you may counter target spell unless its controller pays {1}" names the spell for "its" (the payer decides first; the existing wrap.mayunless reading)', () => {
    expect(fullyAutomated(creature('When this creature enters, you may counter target spell unless its controller pays {1}.'))).toBe(true);
    expect(fullyAutomated(creature('When this creature enters, you may counter target spell unless its controller pays {1} or blorfty.'))).toBe(false);
  });
  it('rules/filter.ts, rules/targets.ts, actions/activate.ts, parser/holes/filter.ts (CR 606.2, 113.7a): "target loyalty ability of a planeswalker" and "an ability from a noncreature source" are target descriptions; an ability of a creature and a loyalty ability of another kind of permanent are other readings', () => {
    expect(fullyAutomated(spell('Counter target loyalty ability of a planeswalker.'))).toBe(true);
    expect(fullyAutomated(spell('Counter target loyalty ability of a creature.'))).toBe(false);
    expect(fullyAutomated(spell('Counter target activated or triggered ability from a noncreature source.'))).toBe(true);
    expect(fullyAutomated(spell('Counter target activated or triggered ability from a blorfty source.'))).toBe(false);
  });
  it('parser/lower/ability.ts, render/fold-edhd36.ts (CR 701.20a, 401.4, 404.1): the two sentences "Look at the top N cards of target player\'s library. Put one back and the rest into that player\'s graveyard." are one dig; with another follow-up sentence they are not', () => {
    expect(fullyAutomated(spell('Look at the top three cards of target player\'s library. Put one back and the rest into that player\'s graveyard.'))).toBe(true);
    expect(fullyAutomated(spell('Look at the top three cards of target player\'s library. Put one back and the rest into your graveyard.'))).toBe(false);
    expect(fullyAutomated(spell('Look at the top three cards of target player\'s library. Put one back and the rest into that player\'s hand.'))).toBe(false);
  });
});
