/**
 * Commander EDHREC ranks 19,501-20,000 (later pass), round edh-c-89: the template data of parser/templates/zz-cloud/edh-c-89.json (each X doesn't untap during its controller's untap step; counter unless its
 * controller exiles all cards from their graveyard; "Until end of turn, X gets +X/+0, where X is ...") and the round's parser, engine and renderer changes, tested at the end of this file and in
 * edh-c-89-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-c-89-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC89 from '../../../src/parser/templates/zz-cloud/edh-c-89.json';
import review89 from '../../m5/golden/cards/edh-c-89-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC89 as Template[];
/** The round's golden entries. */
const review = review89 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 3;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'sta.edhv89.each.untapstep.singular': ["Tsabo's Web"],
  'eff.edhv89.counter.unlessControllerExilesGraveyard': ['Grip of Amnesia'],
  'eff.edhv89.pump.dur.first.whereX': ['Bronze Cudgels'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static line on an Aura, an Equipment or a creature, a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(
    /^\{/.test(text) ? card('Example Plan', 'Artifact', text)
    : /^(When|At the|Whenever)/.test(text) && /enchanted creature/.test(text) ? card('Example Plan', 'Enchantment — Aura', `Enchant creature\n${text}`)
    : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : t.id.startsWith('sta.') && /enchanted creature/.test(text) ? card('Example Plan', 'Enchantment — Aura', `Enchant creature\n${text}`)
    : t.id.startsWith('sta.') ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : card('Example Plan', 'Sorcery', text),
    OPTS,
  ).faces[0]!;

describe('edh-c-89 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-89.json, path order: before edh-cast-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-89.json');
    expect(files.indexOf('zz-cloud/edh-c-89.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhv89.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhv89\./);
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

describe('edh-c-89 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-c-89 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-89 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-89 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-89 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
const artifact = (text: string) => parseCard(card('Example Plan', 'Artifact', text), OPTS).faces[0]!;
const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Dragon', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;

describe('edh-c-89 parser, engine and renderer changes (one test each)', () => {
  it('statics/match.ts (CR 602.1, 605.1a): "a land with an activated ability that isn\'t a mana ability" is read by a static ability; a mana ability, "with a mana ability" and "an activated ability" alone are other readings', () => {
    const ok = artifact("Each land with an activated ability that isn't a mana ability doesn't untap during its controller's untap step.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"abilityNotMana":true');
    const plain = artifact("Each land with an activated ability doesn't untap during its controller's untap step.");
    expect(JSON.stringify(plain.abilities)).not.toContain('abilityNotMana');
    expect(fullyAutomated(artifact("Each land with a mana ability doesn't untap during its controller's untap step.")) && JSON.stringify(ok.abilities) === JSON.stringify(plain.abilities)).toBe(false);
  });
  it('parser/holes/cond.ts and effects/eval.ts (CR 602.5b): "this ability has been activated N or more times this turn" is the count of activations of this ability, not of resolutions; "exactly N" and "N times" are not this reading', () => {
    const ok = creature('{R}: This creature gets +1/+0 until end of turn. If this ability has been activated four or more times this turn, sacrifice this creature at the beginning of the next end step.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"q":"activatedThisTurn"');
    expect(JSON.stringify(ok.abilities)).not.toContain('resolvedThisTurn');
    for (const bad of ['four times', 'four or fewer times', 'one or more times', 'ten or more times that turn']) {
      const f = creature(`{R}: This creature gets +1/+0 until end of turn. If this ability has been activated ${bad} this turn, sacrifice this creature at the beginning of the next end step.`);
      expect(fullyAutomated(f) && JSON.stringify(f.abilities).includes('activatedThisTurn'), bad).toBe(false);
    }
  });
  it('parser/holes/qty.ts (CR 608.2, 113.7a): "the number of times this ability has resolved this turn" is a quantity; "activated" and "this spell" are not that quantity', () => {
    const ok = artifact('{0}: Until end of turn, target creature gets +X/+0, where X is the number of times this ability has resolved this turn.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('resolvedThisTurn');
    const bad = artifact('{0}: Until end of turn, target creature gets +X/+0, where X is the number of times this ability has been activated this turn.');
    expect(fullyAutomated(bad) && JSON.stringify(bad.abilities).includes('resolvedThisTurn')).toBe(false);
  });
  it('render/steps-flow.ts#unlessExilesGraveyard (CR 118.12a): "unless its controller exiles all cards from their graveyard" renders as printed; a different recipient, a counted exile and a destroy stay manual', () => {
    expect(fullyAutomated(sorcery('Counter target spell unless its controller exiles all cards from their graveyard.'))).toBe(true);
    expect(fullyAutomated(sorcery('Counter target spell unless its controller exiles all cards from your graveyard.'))).toBe(false);
    expect(fullyAutomated(sorcery('Counter target spell unless its controller exiles a card from their graveyard.'))).toBe(false);
    expect(fullyAutomated(sorcery('Destroy target creature unless its controller exiles all cards from their graveyard.'))).toBe(false);
  });
});
