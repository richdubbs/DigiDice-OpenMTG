/**
 * Commander lane edh-next, round edh-next-10: the template data of parser/templates/zz-cloud/edh-next-10.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-next-10-scenarios.test.ts.
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
import edhNext10 from '../../../src/parser/templates/zz-cloud/edh-next-10.json';
import review from '../../m5/golden/cards/edh-next-10-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext10 as Template[];
const MECH_COUNT = 9;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 15,000 that print each wording and are full
  'rep.edhn10.damageToSelf.prevent.counterOnSelfPerPrevented': ['Phyrexian Hydra'],
  'rep.edhn10.damageToSelf.instead.countersThatMany': ['Phytohydra'],
  'rep.edhn10.noncombat.toOppCreature.minusCounters': ['Soul-Scar Mage'],
  'eff.edhn10.prevent.byGroup.gainLife': ['Chant of Vitu-Ghazi'],
  'rep.edhn10.damageToYou.prevent.exileGraveyardPerPrevented': ['Immortal Coil'],
  'eff.edhn10.pump.gains.choice2': ["Alchemist's Gift"],
  'eff.edhn10.pump.becomes.colorChoice': ['Wild Mongrel'],
  'sta.edhn10.enchanted.loseAll.isColorSubtype.basePT': ['Ichthyomorphosis'],
  'sta.edhn10.attached.basept.has.loseOther': ['Stasis Field'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || text.startsWith('~') ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-10 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-10.json, path order: after edh-next-1, before edh-next-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-10.json');
    expect(files.indexOf('zz-cloud/edh-next-10.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-1.json'));
    expect(files.indexOf('zz-cloud/edh-next-10.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhn10.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid)\.edhn10\./);
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

describe('edh-next-10 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bElemental\b/, 'Elementals'], [/\bhaste\b/, 'x'], [/\bdouble\b/, 'triple'], [/\bloses\b/, 'gains'], [/\bcounters\b/, 'x'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-10 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-10 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-next-10 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-10 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-next-10 renderer and lowering changes (one test each)', () => {
  const creature = (text: string, type = 'Creature — Wizard') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const spell = (text: string, type = 'Instant') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  it('render/stat.ts (CR 615.5, 122.1): the counter of a prevention is put on the permanent itself ("on ~") or on the creature the damage was dealt to ("on that creature"); on anything else it stays manual', () => {
    expect(fullyAutomated(creature('If damage would be dealt to ~, prevent that damage. Put a -1/-1 counter on ~ for each 1 damage prevented this way.'))).toBe(true);
    expect(fullyAutomated(creature('If damage would be dealt to ~, prevent that damage. Put a -1/-1 counter on target creature for each 1 damage prevented this way.'))).toBe(false);
    expect(fullyAutomated(creature('If damage would be dealt to ~, prevent that damage. Put a -1/-1 counter on ~ for each 2 damage prevented this way.'))).toBe(false);
  });
  it('lower/ability.ts (CR 615.5): the sentence "You gain life equal to the damage prevented this way." is joined to the prevention before it; after any other sentence it stays manual', () => {
    expect(fullyAutomated(spell('Prevent all damage that would be dealt by creatures this turn. You gain life equal to the damage prevented this way.'))).toBe(true);
    expect(fullyAutomated(spell('Draw a card. You gain life equal to the damage prevented this way.'))).toBe(false);
    expect(fullyAutomated(spell('Prevent all damage that would be dealt by creatures this turn. Target player gains life equal to the damage prevented this way.'))).toBe(false);
  });
  it('render/stat.ts (CR 615.5, 406.1): "Exile a card from your graveyard for each 1 damage prevented this way." says its pick; a pick from another graveyard stays manual', () => {
    expect(fullyAutomated(creature('If damage would be dealt to you, prevent that damage. Exile a card from your graveyard for each 1 damage prevented this way.'))).toBe(true);
    expect(fullyAutomated(creature('If damage would be dealt to you, prevent that damage. Exile a card from an opponent\'s graveyard for each 1 damage prevented this way.'))).toBe(false);
  });
  it('render/stat.ts (CR 120.3, 615.1a): "non-Human sources" is said for a source described by what it is not; "non-Human creatures" is a different group and stays as it was', () => {
    expect(fullyAutomated(spell('Prevent all damage that would be dealt this turn by non-Human sources.'))).toBe(true);
    expect(fullyAutomated(spell('Prevent all damage that would be dealt this turn by non-Human.'))).toBe(false);
  });
  it('render/self-replacement.ts (CR 614.15): "If C, instead A, then B." is read when A replaces the one instruction and B is a plain follow-up; B alone, or A that is not the replaced instruction, stays manual', () => {
    expect(fullyAutomated(spell('Counter target creature or planeswalker spell unless its controller pays {2}.\nIf an opponent has eight or more cards in their graveyard, instead counter that spell, then scry 2.'))).toBe(true);
    expect(fullyAutomated(spell('Counter target creature or planeswalker spell unless its controller pays {2}.\nIf an opponent has eight or more cards in their graveyard, instead draw a card, then scry 2.'))).toBe(false);
  });
  it('render/mods.ts (CR 613.1f): "has base power and toughness 0/2, has defender, and loses all other abilities" is the layer-6 removal with the listed ability kept; "loses all abilities" in its place is another change', () => {
    expect(fullyAutomated(parseCard(card('Example Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature has base power and toughness 0/2, has defender, and loses all other abilities.'), OPTS).faces[0]!)).toBe(true);
    expect(fullyAutomated(parseCard(card('Example Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature has base power and toughness 0/2, has defender, and loses all abilities.'), OPTS).faces[0]!)).toBe(false);
  });
});
