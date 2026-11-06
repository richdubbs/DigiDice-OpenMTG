/**
 * Round edh-d-22 (Commander coordinator D, lane mana): the template data of parser/templates/zz-cloud/edh-d-22.json (two mana of one color and two of another (Open the Omenpaths); a mana rider
 * that puts a counter on the creature spell the mana is spent on (Animal Attendant, Guildmages' Forum); "Choose a player. That player adds one mana of any color they choose." (Spectral Searchlight);
 * mana of a type the sacrificed land could produce (Squandered Resources)), and the parser, renderer and engine changes of the round (one test each at the end). Guard G9 (design 6.8):
 * every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or
 * differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10). The behavior is in
 * edh-d-22-scenarios.test.ts. CR cites are from memory (no rules/cr in a cloud session) and listed as unverified in the record.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhD22 from '../../../src/parser/templates/zz-cloud/edh-d-22.json';
import review from '../../m5/golden/cards/edh-d-22-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD22 as Template[];
const MECH_COUNT = 5;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only
 * one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT, owner instruction 2026-10-21; the
 * standing rule of 2026-10-27). Open the Omenpaths, Animal Attendant, Guildmages' Forum, Spectral Searchlight and Squandered Resources are cards of the EDHREC top 20,000 of the lane list.
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhd22.mana.oneAndOtherColor': ['Open the Omenpaths'],
  'rid.edhd22.mana.spentEntersWith': ['Animal Attendant', "Guildmages' Forum"],
  'eff.edhd22.mana.choosePlayerAnyColor': ['Spectral Searchlight'],
  'eff.edhd22.mana.choosePlayerAdds': ['Valleymaker'],
  'eff.edhd22.mana.couldProduce.sacrificed': ['Squandered Resources'],
};
const NOT_PINNED: readonly string[] = [];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text; the others are abilities of a permanent. */
const SPELL = new Set<string>(['eff.edhd22.mana.oneAndOtherColor']);
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string, type?: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Instant', text), OPTS) : parseCard(card('Example Relic', type ?? 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-d-22 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-22.json, path order: after edh-d-2, before edh-d-3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-22.json');
    expect(files.indexOf('zz-cloud/edh-d-22.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-2.json'));
    expect(files.indexOf('zz-cloud/edh-d-22.json')).toBeLessThan(files.indexOf('zz-cloud/edh-d-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples (or one example and three counter-examples), a status, and is of version 10; ids are eff./rid.edhd22.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|trg)\.edhd22\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(1);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(10);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the cards that print the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`) || g.verified.includes(`${t.id})`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) for (const n of NARROW[t.id]!) expect(cards, t.id).toContain(n);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review as { card: string; expect?: string }[]) {
      if (NOT_PINNED.includes(g.card)) expect(g.expect, g.card).toBeUndefined();
      else expect(g.expect, g.card).toBe('full');
    }
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

describe('edh-d-22 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/any one color/, 'any one type'], [/any other color/, 'any color'], [/sacrificed land/, 'sacrificed creature'], [/they choose/, 'you choose'], [/that mana/, 'any mana'],
    [/enters with an additional/, 'enters with'], [/choose a player/, 'choose an opponent'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-d-22 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-22 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-d-22 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-22 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-d-22 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Artifact') => parseCard(card('Example Relic', type, text), OPTS).faces[0]!;
  it('parser/holes/spend.ts, render/steps-cards.ts (CR 106.6): a first clause that is an "or" of spell descriptions is set off by a comma; a list of names stays as it was (no comma)', () => {
    const base = '{T}: Add {C}. Spend this mana only to';
    expect(fullyAutomated(face(`${base} cast an Elf spell or a spell that has flashback, or to activate an ability of a Goblin source.`))).toBe(true);
    expect(fullyAutomated(face(`${base} cast an Elf spell or to activate an ability of a Goblin source.`))).toBe(true);
    expect(fullyAutomated(face(`${base} cast an Elf or Goblin spell or to activate an ability of a Goblin source.`))).toBe(true);
    expect(fullyAutomated(face(`${base} cast an Elf spell, or to activate an ability of a Goblin source.`))).toBe(false);
    expect(fullyAutomated(face(`${base} cast an Elf spell or a spell that has flashback or to activate an ability of a Goblin source.`))).toBe(false);
  });
  it('parser/holes/spend.ts, render/steps-cards.ts, rules/sources.ts (CR 106.6, 107.3, 113.1, 118.9): spells with no abilities, spells without {X} in their mana cost, and the cost of a disturb', () => {
    const base = '{T}: Add {C}. Spend this mana only to';
    expect(fullyAutomated(face(`${base} cast creature spells with no abilities.`))).toBe(true);
    expect(fullyAutomated(face(`${base} cast a spell that's one or more colors without {X} in its mana cost.`))).toBe(true);
    expect(JSON.stringify(face(`${base} cast a spell that's one or more colors without {X} in its mana cost.`).abilities)).toContain('"manaCostHasX":false');
    expect(fullyAutomated(face(`${base} pay a disturb cost.`))).toBe(true);
    expect(JSON.stringify(face(`${base} pay a disturb cost or cast a creature spell.`).abilities)).toContain('"viaAlt":"disturb"');
    expect(fullyAutomated(face(`${base} pay a flashback cost.`))).toBe(false);
    expect(fullyAutomated(face(`${base} cast creature spells with some abilities.`))).toBe(false);
  });
  it('parser/holes/filter.ts, render/np.ts (CR 113.1): "creatures with abilities" is the any-of of the three ability kinds, the opposite of "no abilities"', () => {
    const t = face("Creatures you control can't be blocked by creatures with abilities.", 'Enchantment');
    expect(fullyAutomated(t)).toBe(true);
    expect(JSON.stringify(t.abilities)).toContain('"hasAbility":"activated"');
    expect(fullyAutomated(face("Creatures you control can't be blocked by creatures with some abilities.", 'Enchantment'))).toBe(false);
  });
  it('parser/lower/ability.ts, model/cap-walk.ts, model/lint-nodes.ts (CR 605.3b, 603.7, 613.1b): a mana ability may also set a delayed change of control of its source to an opponent; another delayed effect beside the mana stays manual', () => {
    const ok = '{T}: Add one mana of any color. An opponent gains control of this land at the beginning of the next end step.';
    expect(fullyAutomated(face(ok, 'Land'))).toBe(true);
    expect(fullyAutomated(face(ok.replace('An opponent gains control of this land', 'An opponent gains control of target land'), 'Land'))).toBe(false);
    expect(fullyAutomated(face(ok.replace('An opponent gains control', 'You gain control'), 'Land'))).toBe(false);
    expect(fullyAutomated(face('{T}: Add one mana of any color. Destroy this land at the beginning of the next end step.', 'Land'))).toBe(false);
  });
});
