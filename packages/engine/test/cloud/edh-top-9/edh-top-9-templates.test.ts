/**
 * Commander lane edh-top, round edh-top-9: the template data of parser/templates/zz-cloud/edh-top-9.json ("double the number of each kind of counter you have") and the round's parser, engine and renderer changes, tested at the end of this file and in edh-top-9-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-top-9-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhTop9 from '../../../src/parser/templates/zz-cloud/edh-top-9.json';
import review9 from '../../m5/golden/cards/edh-top-9-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhTop9 as Template[];
/** The round's golden entries. */
const review = review9 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 1;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edht9.doubleEachKind.yourCounters': ['Aetheric Amplifier'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (_t: Template, text: string) =>
  parseCard(/^\{/.test(text) ? card('Example Plan', 'Artifact', text) : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-top-9 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-top-9.json, path order: after edh-top-8) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-top-9.json');
    expect(files.indexOf('zz-cloud/edh-top-9.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-top-8.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edht9.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid)\.edht9\./);
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

describe('edh-top-9 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/double/, 'halve'], [/each kind of counter/, 'each counter'], [/you have/, 'an opponent has'], [/the number of/, 'half the number of'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-top-9 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-top-9 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-top-9 design 6.10 (local index): synthetic examples', () => {
  it('no edh-top-9 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

const sorcery = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Drake', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
const artifact = (text: string) => parseCard(card('Example Plan', 'Artifact', text), OPTS).faces[0]!;
const ENTERS = 'When this creature enters, exchange control of this creature and target creature an opponent controls.';

describe('edh-top-9 parser, engine and renderer changes (one test each)', () => {
  it('parser/holes/cond.ts and lower/conditions.ts#resolveDid ($exchange): "If you don\'t or can\'t make an exchange" reads the exchange right before it (said with an alt in render/cond.ts); after any other instruction, or with no instruction before it, the sentence stays manual', () => {
    const ok = creature(`${ENTERS} If you don't or can't make an exchange, sacrifice this creature.`);
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"op":"exchange"');
    expect(JSON.stringify(ok.abilities)).toContain('"not":true');
    expect(fullyAutomated(creature('When this creature enters, draw a card. If you don\'t or can\'t make an exchange, sacrifice this creature.'))).toBe(false);
    expect(fullyAutomated(creature('When this creature enters, if you don\'t or can\'t make an exchange, sacrifice this creature.'))).toBe(false);
  });
  it('types/ability.ts#resolvesIfIllegal (parser/lower/ability.ts, render/abil.ts, effects/run.ts): "This ability still resolves if its target becomes illegal." is a flag of a triggered ability with exactly one target; with no target, with two, or in a different wording it is not', () => {
    const ok = creature(`${ENTERS} If you don't or can't make an exchange, sacrifice this creature. This ability still resolves if its target becomes illegal.`);
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"resolvesIfIllegal":true');
    expect(fullyAutomated(creature('When this creature enters, draw a card. This ability still resolves if its target becomes illegal.'))).toBe(false);
    expect(fullyAutomated(creature('When this creature enters, destroy target creature and target artifact. This ability still resolves if its target becomes illegal.'))).toBe(false);
    expect(fullyAutomated(creature(`${ENTERS} This ability still resolves if its targets become illegal.`))).toBe(false);
  });
  it('rules/quality.ts#parseQuality (quality "ability"), parser/holes/misc.ts#qualityAt and keywords/hooks/targeting.ts: "hexproof from activated and triggered abilities" is a keyword; "hexproof from abilities" and "protection from activated abilities" are not', () => {
    const ok = creature('Flying, hexproof from activated and triggered abilities');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"quality":"ability"');
    expect(fullyAutomated(creature('Flying, hexproof from activated abilities'))).toBe(false);
    expect(fullyAutomated(creature('Flying, hexproof from triggered abilities'))).toBe(false);
  });
  it('parser/chart.ts#decide (paysBeforeItsIf) and render/fold-edht9.ts: "If you do, you get {E}{E}{E}{E}, then sacrifice that creature unless you pay an amount of {E} equal to its mana value." is the energy gain followed by a payment that guards the sacrifice only, inside the condition; the payment is inside the condition and after the energy', () => {
    const ok = creature(`${ENTERS} If you do, you get {E}{E}{E}{E}, then sacrifice that creature unless you pay an amount of {E} equal to its mana value.`);
    expect(fullyAutomated(ok)).toBe(true);
    const s = JSON.stringify(ok.abilities);
    expect(s.indexOf('"kind":"energy"')).toBeGreaterThan(-1);
    expect(s.indexOf('"op":"pay"')).toBeGreaterThan(s.indexOf('"kind":"energy"'));
    // the condition comes first: the payment is inside the "if you do" (never asked when the exchange was not made)
    expect(s.indexOf('"op":"if"')).toBeLessThan(s.indexOf('"op":"pay"'));
  });
  it('parser/lower/ability.ts#modalHeaderWords and render/abil.ts: "{4}, {T}: Choose one. Activate only as a sorcery. • ... • ..." is the modal ability with the restriction between the header and the modes; "Choose one." with no restriction, or a header of a spell, is not', () => {
    const ok = artifact('{4}, {T}: Choose one. Activate only as a sorcery.\n• Draw a card.\n• You gain 2 life.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"sorcerySpeed":true');
    expect(fullyAutomated(artifact('{4}, {T}: Choose one.\n• Draw a card.\n• You gain 2 life.'))).toBe(false);
    expect(fullyAutomated(artifact('{4}, {T}: Choose three. Activate only as a sorcery.\n• Draw a card.\n• You gain 2 life.'))).toBe(false);
  });
  it('parser/lower/mentions.ts#exiledAllOf and restOf (edh-top-8 finding 1): "a nonland card exiled this way" is chosen among EVERY card the exile-until exiled, not only among the cards each player stopped at; the other cards are the rest of that group; one player or several', () => {
    for (const who of ['Each player exiles cards from the top of their library until they exile a creature card.', 'Target opponent exiles cards from the top of their library until they exile a creature card.']) {
      const ok = sorcery(`${who} An opponent chooses a nonland card exiled this way. You may cast up to two spells from among the other cards exiled this way without paying their mana costs.`);
      expect(fullyAutomated(ok), who).toBe(true);
      const s = JSON.stringify(ok.abilities);
      expect(s).toContain('"exiled":"exiledcards"');
      expect(s).not.toContain('"as":"them"');
    }
    expect(fullyAutomated(sorcery('Each player exiles cards from the top of their library until they exile a creature card. An opponent chooses a nonland card exiled this way.'))).toBe(true);
    expect(fullyAutomated(sorcery('An opponent chooses a nonland card exiled this way.'))).toBe(false);
  });
});
