/**
 * Commander coordinator B, round edh-b-7: the template data of parser/templates/zz-cloud/edh-b-7.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-b-7-scenarios.test.ts.
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
import edhB7 from '../../../src/parser/templates/zz-cloud/edh-b-7.json';
import review from '../../m5/golden/cards/edh-b-7-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhB7 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full
  'eff.edhb7.eachPlayer.loseThirdLife.roundUp': ['Dire Fleet Ravager'],
  'eff.edhb7.player.loseLife.perCardInTheirGraveyard': ['Guiltfeeder'],
  'sta.edhb7.attackTax.you.whereX': ['Collective Restraint'],
  'eff.edhb7.you.untap.upToChosen': ['Time Spiral'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' })
    : /^(Look|Reveal|Mill)/.test(text) ? card('Example Plan', 'Sorcery', text)
    : text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-b-7 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-b-7.json, path order: after edh-b-1, before edh-cast-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-b-7.json');
    expect(files.indexOf('zz-cloud/edh-b-7.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-b-1.json'));
    expect(files.indexOf('zz-cloud/edh-b-7.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhb7.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid)\.edhb7\./);
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

describe('edh-b-7 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bGoblin\b/, 'Goblins'], [/\bhaste\b/, 'x'], [/\bflying\b/, 'x'], [/\bloses\b/, 'gains'], [/\bcounter\b/, 'x'], [/\bthree\b/, 'x'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-b-7 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-b-7 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w) || /^counters?\b/.test(words[i + 1] ?? '')) return; // a counter kind is an open class (design 6.11)
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

describe.skipIf(index === null)('edh-b-7 design 6.10 (local index): synthetic examples', () => {
  it('no edh-b-7 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // a pattern with no slot ("~ is all colors. This ability doesn't affect its color identity.") is one fixed sentence: its examples can only be that sentence, so they are exempt (as cloud c2)
    const withSlots = MECH.filter((t) => /\{[a-z0-9]+:/.test(t.pattern) || !t.pattern.startsWith('~ is all colors'));
    const verbatim = withSlots.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

describe('edh-b-7 parser, lowering and renderer changes (one test each)', () => {
  const spell = (text: string, type = 'Instant') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  const creature = (text: string, type = 'Creature — Wizard') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/holes/qty.ts (CR 205.2a, 608.2c): "for each card type among those cards" reads only after a trigger that names cards; with nothing named it stays manual', () => {
    expect(fullyAutomated(creature('Whenever one or more cards are put into your graveyard from your library, each opponent loses 1 life for each card type among those cards.'))).toBe(true);
    expect(fullyAutomated(spell('Each opponent loses 1 life for each card type among those cards.'))).toBe(false);
  });
  it('parser/holes/qty.ts + render/stat.ts + render/qty.ts (CR 701.21a, 601.2f): "for each permanent sacrificed this turn" counts every player\'s sacrifices; the plural "creatures" needs its own description', () => {
    expect(fullyAutomated(creature('This spell costs {1} less to cast for each permanent sacrificed this turn.'))).toBe(true);
    expect(fullyAutomated(creature('This spell costs {1} less to cast for each permanent sacrificed this game.'))).toBe(false);
  });
  it('render/steps-zones.ts (CR 111.1, 107.3): "create three tapped X/X green Treefolk creature tokens, where X is ..." is automated; "create three X/X tokens that are tapped" is the same creation', () => {
    expect(fullyAutomated(spell('Create three tapped X/X green Treefolk creature tokens, where X is the number of lands you control.', 'Sorcery'))).toBe(true);
    expect(fullyAutomated(spell('Create three tapped X/X green Treefolk creature tokens, where Y is the number of lands you control.', 'Sorcery'))).toBe(false);
  });
  it('render/steps-flow.ts (CR 119.3, 107.1a): "each player loses a third of their life, rounded up" next to "each opponent loses half their life, rounded up"', () => {
    expect(fullyAutomated(creature('When ~ enters, each opponent loses half their life, rounded up.'))).toBe(true);
    expect(fullyAutomated(creature('When ~ enters, each opponent loses a third of their life, rounded up.'))).toBe(false);
  });
  it('parser/front/selfref.ts (CR 201.5c): the short name of a legendary creature that is also a keyword is the card inside a line, not at the start of a keyword line', () => {
    const named = parseCard(card('Flash, Test Hero', 'Legendary Creature — Human', 'Whenever Flash deals combat damage to a player, you gain 1 life.\nFlash', { power: '2', toughness: '2' }), OPTS).faces[0]!;
    expect(fullyAutomated(named)).toBe(true);
    const plain = parseCard(card('Example Beast', 'Creature — Human', 'Whenever Flash deals combat damage to a player, you gain 1 life.', { power: '2', toughness: '2' }), OPTS).faces[0]!;
    expect(fullyAutomated(plain)).toBe(false);
  });
});
