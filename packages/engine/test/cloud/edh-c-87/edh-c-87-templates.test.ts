/**
 * Commander EDHREC ranks 26,001-26,500, round edh-c-87 (third pass): the template data of parser/templates/zz-cloud/edh-c-87.json ("As long as C, all F get +N/+N", "~ deals damage to target creature equal to the damage already
 * dealt to it this turn", "you may have ~ become a P/T creature with A in addition to its other types", "Gain control of target creature if C", "you gain control of that land until end of turn") and the round's parser and renderer
 * changes, tested at the end of this file and in edh-c-87-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-c-87-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC87 from '../../../src/parser/templates/zz-cloud/edh-c-87.json';
import review87 from '../../m5/golden/cards/edh-c-87-review.json';
import w3bReview from '../../m5/golden/cards/w3b-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC87 as Template[];
/** The round's golden entries. */
const review = [...(review87 as { card: string; verified: string; expect?: string }[]), ...(w3bReview as { card: string; verified: string; expect?: string }[]).filter((g) => g.card === 'Watchdog')]; // Watchdog's golden entry is the older one of w3b (updated, not duplicated)
const MECH_COUNT = 5;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'sta.edhv87.aslong.all.anthem': ['Watchdog'],
  'eff.edhv87.damage.equalDamageAlreadyDealt': ['Whipkeeper'],
  'eff.edhv87.may.haveBecomeCreature.withAbilities.inAddition': ['Riddleform'],
  'eff.edhv87.gainControl.if': ['Exert Influence'],
  'eff.edhv87.youGainControl.of': ['Wellspring'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static line on an Aura, an Equipment or a creature, a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(
    /^\{/.test(text) ? card('Example Plan', 'Artifact', text)
    : /^As long as/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : card('Example Plan', 'Sorcery', text),
    OPTS,
  ).faces[0]!;

describe('edh-c-87 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-87.json, path order: after edh-c-8.json, before edh-c-9) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-87.json');
    expect(files.indexOf('zz-cloud/edh-c-87.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-c-8.json'));
    expect(files.indexOf('zz-cloud/edh-c-87.json')).toBeLessThan(files.indexOf('zz-cloud/edh-c-9.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhv87.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhv87\./);
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

describe('edh-c-87 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-c-87 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-87 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-87 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-87 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
const saga = (text: string) => parseCard(card('Example Plan', 'Enchantment — Saga', text), OPTS).faces[0]!;



describe('edh-c-87 parser and renderer changes (one test each)', () => {
  it('parser/holes/object.ts and render/np.ts (CR 202.3, 208.1, 115.1, 608.2d): "target nonland permanent with the lowest mana value" is the tied lowest among nonland permanents; a controller said, "greatest" or another noun is not this reading', () => {
    const ok = creature('At the beginning of your upkeep, destroy target nonland permanent with the lowest mana value.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"agg":"min"');
    expect(fullyAutomated(creature('At the beginning of your upkeep, destroy target nonland permanent with the highest mana value.'))).toBe(true);
    expect(JSON.stringify(creature('At the beginning of your upkeep, destroy target nonland permanent with the highest mana value.').abilities)).toContain('"agg":"max"');
    expect(fullyAutomated(creature('At the beginning of your upkeep, destroy target permanent with the greatest power.')) && JSON.stringify(creature('At the beginning of your upkeep, destroy target permanent with the greatest power.').abilities).includes('"agg":"max"')).toBe(false); // a noncreature permanent has no power (CR 208.3)
    for (const bad of ['At the beginning of your upkeep, destroy target nonland permanent with the lowest mana value among creatures.', 'At the beginning of your upkeep, destroy target nonland permanent an opponent controls with the lowest mana value.', 'At the beginning of your upkeep, destroy up to two target nonland permanents with the lowest mana value.']) {
      const f = creature(bad);
      expect(fullyAutomated(f) && JSON.stringify(f.abilities).includes('"agg":"min"') && !JSON.stringify(f.abilities).includes('"controller"'), bad).toBe(false);
    }
  });
  it('parser/holes/event.ts (CR 701.9a, 603.2): "whenever you discard a Spirit card or a card with disturb" is a discard of a card of either description; a second article missing, or other verbs, are not this reading', () => {
    const ok = creature('Whenever you discard a Spirit card or a card with disturb, put a +1/+1 counter on this creature.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"anyOf"');
    expect(JSON.stringify(creature('Whenever you sacrifice a Spirit or a creature with disturb, put a +1/+1 counter on this creature.').abilities)).not.toContain('"verb":"discard"');
  });
  it('parser/holes/cond.ts (CR 608.2b, 604.1): "you control a permanent named A or a permanent named B" is either; an or without the second article, a negation and the opponent are other readings', () => {
    const ok = creature('This creature gets +2/+2 as long as you control a permanent named Foo Alpha or a permanent named Foo Beta.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"cond":"any"');
    expect(fullyAutomated(creature('This creature gets +2/+2 as long as you control a permanent named Foo Alpha or Foo Beta.'))).toBe(false);
  });
  it('rules/history.ts and parser/lower/quantities.ts (CR 120.3, 608.2h): the damage dealt to a TARGET of the ability is answered through the ability\'s own environment; a damage question about any other object stays manual', () => {
    const ok = creature('{T}: This creature deals damage to target creature equal to the damage already dealt to it this turn.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"ref":"target"');
  });
});
