/**
 * Must-finish round edh-next-124 (group planeswalkers): the template data of parser/templates/zz-cloud/edh-next-124.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-next-124-scenarios.test.ts.
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
import edhNext124 from '../../../src/parser/templates/zz-cloud/edh-next-124.json';
import review from '../../m5/golden/cards/edh-next-124-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext124 as Template[];
const MECH_COUNT = 8;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the one card of the EDHREC top 20,000 that prints each wording (all full in this round)
  'sta.edhn124.has.allLoyaltyOf': ['Nicol Bolas, Dragon-God'],
  'eff.edhn124.exile.handOrPermanent.opponent': ['Nicol Bolas, Dragon-God'],
  'sta.edhn124.untap.opponentsUntapStep.group': ['Teferi, Who Slows the Sunset'],
  'sta.edhn124.draw.opponentsDrawStep': ['Teferi, Who Slows the Sunset'],
  'eff.edhn124.choose.threeTargets': ['Teferi, Who Slows the Sunset'],
  'eff.edhn124.untap.chosen.youControl': ['Teferi, Who Slows the Sunset'],
  'eff.edhn124.tap.chosen.youDontControl': ['Teferi, Who Slows the Sunset'],
  'sta.edhn124.costmod.firstArtifactAbility.less': ['Tezzeret, Betrayer of Flesh'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  /enchanted (creature|land|artifact|permanent|enchantment)/.test(text) ? card(
    'Example Boon', 'Enchantment — Aura', text) :
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-124 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-124.json, path order: after edh-next-12, before edh-next-13) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-124.json');
    expect(files.indexOf('zz-cloud/edh-next-124.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-12.json'));
    expect(files.indexOf('zz-cloud/edh-next-124.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-13.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhn124.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|dl)\.edhn124\./);
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

describe('edh-next-124 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bloses\b/, 'gains'], [/\bpoison\b/, 'x'], [/\bthird\b/, 'fourth'], [/\bland\b/, 'x'], [/\bgain control\b/, 'x'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-124 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-124 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-next-124 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-124 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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




describe('edh-next-124 parser, renderer and engine changes (one test each)', () => {
  const spell = (text: string, type = 'Sorcery') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  const walker = (text: string) => parseCard(card('Example Sage', 'Legendary Planeswalker — Sagey', text, { loyalty: '4' } as never), OPTS).faces[0]!;
  it('parser/lower/mentions.ts#announcedGroup (CR 115.1, 601.2c): targets each announced "up to one" are "the chosen permanents"; a mix of "up to one" and single targets is not', () => {
    expect(fullyAutomated(spell("Choose up to one target artifact and up to one target creature. Tap the chosen permanents you don't control."))).toBe(true);
    expect(fullyAutomated(spell("Choose up to one target artifact and target creature. Tap the chosen permanents you don't control."))).toBe(false);
  });
  it('parser/lower/anaphora.ts#withoutAnyTargetAsCreature (CR 115.4, 608.2c): "that creature" after "any target" in the same sentence is the creature of the sentence before', () => {
    expect(fullyAutomated(spell("Sacrifice a creature. When you do, ~ deals X damage to any target, where X is that creature's power."))).toBe(true);
    // a TARGET creature of the same sentence stays a candidate: two antecedents, unread
    expect(fullyAutomated(spell("Sacrifice a creature. When you do, ~ deals X damage to target creature, where X is that creature's power."))).toBe(false);
  });
  it('parser/lower/quantities.ts#reflexiveWhereX + conditions.ts#foldReflexive (CR 603.12, 107.3): the next sentence reading the trigger\'s X joins it; a sentence with an X of its own does not', () => {
    const f = spell("Sacrifice a creature. When you do, ~ deals X damage to any target, where X is that creature's power. If the sacrificed creature was a Goblin, you gain X life.");
    expect(fullyAutomated(f)).toBe(true);
    const steps = (f.abilities[0] as { effect: { steps: { op: string; do?: unknown[] }[] } }).effect.steps;
    expect(steps.map((x) => x.op)).toEqual(['sacrificeChoice', 'reflexive']);
    expect(steps[1]!.do!.length).toBe(2);
    const own = spell("Sacrifice a creature. When you do, ~ deals X damage to any target, where X is that creature's power. You gain X life, where X is the number of cards in your hand.");
    expect((own.abilities[0] as { effect: { steps: { op: string }[] } }).effect.steps.map((x) => x.op)).toEqual(['sacrificeChoice', 'reflexive', 'gainLife']);
  });
  it('render/mods.ts#activatedOfSentence (CR 606.1, 613.1f): "has all loyalty abilities of"; "all static abilities of" stays unread', () => {
    expect(fullyAutomated(walker('~ has all loyalty abilities of all other planeswalkers you control.\n+1: You gain 1 life.'))).toBe(true);
    expect(fullyAutomated(walker('~ has all static abilities of all other planeswalkers you control.\n+1: You gain 1 life.'))).toBe(false);
  });
});
