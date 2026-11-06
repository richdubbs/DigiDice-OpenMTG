/**
 * Commander lane edh-next, round edh-next-2: the template data of parser/templates/zz-cloud/edh-next-2.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-next-2-scenarios.test.ts.
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
import edhNext2 from '../../../src/parser/templates/zz-cloud/edh-next-2.json';
import review from '../../m5/golden/cards/edh-next-2-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext2 as Template[];
const MECH_COUNT = 8;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 10,000 that print each wording and are full
  'eff.edhn2.becomes.plural.lead': ["Kamahl's Will", 'Sylvan Awakening'],
  'eff.edhn2.may.have.become.with.dur': ['Embodiment of Insight'],
  'eff.edhn2.becomes.creature.allTypes.dur': ['Faceless Haven'],
  'eff.edhn2.becomes.legendary.with.lead': ['Cacophony Unleashed'],
  'eff.edhn2.they.become.permanent': ['Nissa, Vastwood Seer // Nissa, Sage Animist'],
  'rid.edhn2.theyStillLands': ["Kamahl's Will", 'Nissa, Vastwood Seer // Nissa, Sage Animist', 'Sylvan Awakening'],
  'rid.edhn2.stillEnchantment': ['Cacophony Unleashed'],
  'sta.edhn2.gainLife.opponent.loseInstead': ['Plague Drone', 'Tainted Remedy'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  text.startsWith('Enchanted ') ? card('Example Charm', 'Enchantment — Aura', `Enchant creature\n${text}`)
    : /enchanted (opponent|player)/.test(text) ? card('Example Curse', 'Enchantment — Aura Curse', `Enchant ${/enchanted player/.test(text) ? 'player' : 'opponent'}\n${text}`)
    : /^(Untap up to|They become)/.test(text) ? card('Example Plan', 'Instant', text)
    : t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-2.json, path order: after edh-misc-6, before edh-perms-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-2.json');
    expect(files.indexOf('zz-cloud/edh-next-2.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-misc-6.json'));
    expect(files.indexOf('zz-cloud/edh-next-2.json')).toBeLessThan(files.indexOf('zz-cloud/edh-perms-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhn2.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid)\.edhn2\./);
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

describe('edh-next-2 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-next-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-next-2 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-next-2 parser, lowering and renderer changes (one test each)', () => {
  const spell = (text: string, type = 'Instant') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  const creature = (text: string, type = 'Creature — Wizard') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('render/mods.ts (CR 205.1b, 613.1d): the rider of a group, "They\'re still lands.", is said of two or more objects; the singular rider still reads for one', () => {
    expect(fullyAutomated(spell("Until end of turn, up to two target lands you control become 2/2 Elemental creatures with haste. They're still lands."))).toBe(true);
    expect(fullyAutomated(spell("Until end of turn, target land you control becomes a 2/2 Elemental creature with haste. They're still lands."))).toBe(false);
  });
  it('render/mods.ts (CR 608.2d, 613.1f): "you may have target land become a 3/3 Elemental creature with haste until end of turn" has the "have" form with abilities beside the identity', () => {
    expect(fullyAutomated(creature("{0}: You may have target land you control become a 3/3 Elemental creature with haste until end of turn. It's still a land."))).toBe(true);
    expect(fullyAutomated(creature("{0}: You may have target land you control become a 3/3 Elemental creature with haste. It's still a land."))).toBe(false);
  });
  it('render/mods.ts (CR 205.4a, 613.4b): a supertype is said before the size, "a legendary 6/6 Nightmare God creature"', () => {
    expect(fullyAutomated(creature("{0}: Until end of turn, ~ becomes a legendary 6/6 Nightmare God creature with menace. It's still an enchantment.", 'Enchantment'))).toBe(true);
    expect(fullyAutomated(creature("{0}: Until end of turn, ~ becomes a 6/6 legendary Nightmare God creature with menace. It's still an enchantment.", 'Enchantment'))).toBe(false);
  });
  it('render/stat.ts (CR 614.1a, 614.5): "Double all damage that <creatures> would deal" is said with the creatures\' own noun; the "sources" form is unchanged', () => {
    expect(fullyAutomated(creature('Double all damage that creatures you control with counters on them would deal.', 'Enchantment'))).toBe(true);
    expect(fullyAutomated(creature('Double all damage that sources you control would deal.', 'Enchantment'))).toBe(true);
    expect(fullyAutomated(creature('Double all damage that creatures you control with counters on them would be dealt.', 'Enchantment'))).toBe(false);
  });
  it('parser/holes/p2rd2.ts (CR 303.4, 614.1a): the DamageWould recipients "enchanted player" and "the chosen player", alone or with "or a permanent they control"; another player word stays manual', () => {
    const curse = (text: string) => parseCard(card('Example Curse', 'Enchantment — Aura Curse', `Enchant opponent\n${text}`), OPTS).faces[0]!;
    expect(fullyAutomated(curse('If a source would deal damage to enchanted opponent, it deals double that damage to that player instead.'))).toBe(true);
    expect(fullyAutomated(curse('If a source would deal damage to enchanted opponent or a permanent they control, it deals double that damage instead.'))).toBe(true);
    expect(fullyAutomated(curse('If a source would deal damage to enchanted opponent or a creature they control, it deals double that damage instead.'))).toBe(false);
    expect(fullyAutomated(curse('If a source would deal damage to target opponent, it deals double that damage to that player instead.'))).toBe(false);
  });
  it('render/evt.ts (CR 120.1, 614.1a): of a chosen or enchanted player the replacement says "or a permanent they control"', () => {
    const ok = creature('As ~ enters, choose a player.\nIf a source would deal damage to the chosen player or a permanent they control, it deals double that damage instead.');
    expect(fullyAutomated(ok)).toBe(true);
    const bad = creature('As ~ enters, choose a player.\nIf a source would deal damage to the chosen player or a permanent they control, it deals half that damage instead.');
    expect(fullyAutomated(bad)).toBe(false);
  });
});
