/**
 * Commander lane edh-next, round edh-next-4: the template data of parser/templates/zz-cloud/edh-next-4.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-next-4-scenarios.test.ts.
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
import edhNext4 from '../../../src/parser/templates/zz-cloud/edh-next-4.json';
import review from '../../m5/golden/cards/edh-next-4-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext4 as Template[];
const MECH_COUNT = 15;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 15,000 that print each wording and are full
  'eff.edhn4.lead.becomes.pt.subtype.artifactCreature': ['Frostwalk Bastion'],
  'eff.edhn4.lead.become.pl.creatures.stillLands': ['Rude Awakening'],
  'eff.edhn4.becomes.subtype.basePT.dur': ['Omnibian'],
  'eff.edhn4.becomes.subtype.basePT.and.abilities.dur': ['Eccentric Apprentice'],
  'eff.edhn4.switch.theirPT.dur': ['Inversion Behemoth', 'Invert // Invent'],
  'eff.edhn4.prevent.combat.thatGroupWould.dur': ['Haze Frog'],
  'eff.edhn4.prevent.combat.byCreaturesOtherThan.dur': ['Terrifying Presence'],
  'eff.edhn4.player.mill.draw.lose': ['Atrocious Experiment'],
  'eff.edhn4.player.draw.lose.then.mill': ['Funeral Rites'],
  'eff.edhn4.player.draw.lose.get.poison': ['Caress of Phyrexia'],
  'eff.edhn4.player.lose.mill.whereX': ['Lich Lord of Unx'],
  'sta.edhn4.cantDraw': ['Maralen of the Mornsong'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  /paired with/.test(text) ? card('Example Bonder', 'Creature — Human Knight', `Soulbond\n${text}`, { power: '2', toughness: '2' })
    : t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-4 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-4.json, path order: after edh-next-2, before edh-perms-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-4.json');
    expect(files.indexOf('zz-cloud/edh-next-4.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-2.json'));
    expect(files.indexOf('zz-cloud/edh-next-4.json')).toBeLessThan(files.indexOf('zz-cloud/edh-perms-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhn4.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid)\.edhn4\./);
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

describe('edh-next-4 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bWizard\b/, 'Wizards'], [/\bflying\b/, 'x'], [/\bdouble\b/, 'triple'], [/\bloses\b/, 'gains'], [/\bmills\b/, 'discards'], [/\bdraws\b/, 'discards'], [/\bcreatures\b/, 'lands'], [/\bswitch\b/, 'tap'], [/\bprevent\b/, 'double'], [/\bcan't\b/, 'may'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-4 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-4 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-next-4 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-4 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-next-4 parser, lowering, renderer and engine changes (one test each)', () => {
  const spell = (text: string, type = 'Instant') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  const creature = (text: string, type = 'Creature — Wizard') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('render/mods.ts (CR 205.1b, 613.1d): a group that keeps its types says so inside the sentence, "become 2/2 creatures that are still lands"; the two-sentence rider still reads', () => {
    expect(fullyAutomated(spell('Until end of turn, lands you control become 2/2 creatures that are still lands.', 'Sorcery'))).toBe(true);
    expect(fullyAutomated(spell("Lands you control become 2/2 creatures until end of turn. They're still lands.", 'Sorcery'))).toBe(true);
    expect(fullyAutomated(spell('Until end of turn, lands you control become 2/2 creatures that are still artifacts.', 'Sorcery'))).toBe(false);
  });
  it('render/mods.ts (CR 611.2a, 613.1f, 613.4b): "becomes a Bird with base power and toughness 1/1 and flying until end of turn" has the duration behind the abilities; a quoted ability keeps its old reading', () => {
    expect(fullyAutomated(creature('{T}: Target creature becomes a Bird with base power and toughness 1/1 and flying until end of turn.'))).toBe(true);
    expect(fullyAutomated(creature('{T}: Target creature becomes a Bird with base power and toughness 1/1 until end of turn and flying.'))).toBe(false);
  });
  it('render/mods.ts (CR 613.4d, 611.2a): "switch the power and toughness of <objects>" is said with the objects after "of", and with "each of" before a number of targets; the possessive reading stays', () => {
    expect(fullyAutomated(spell('Switch the power and toughness of each of up to two target creatures until end of turn.'))).toBe(true);
    expect(fullyAutomated(spell('Switch the power and toughness of up to two target creatures until end of turn.'))).toBe(true);
    expect(fullyAutomated(spell("Switch target creature's power and toughness until end of turn."))).toBe(true);
    expect(fullyAutomated(spell('Switch the power and toughness of each of target creature until end of turn.'))).toBe(false);
  });
  it('render/stat.ts (CR 615.1a, 120.2): "Prevent all combat damage that <creatures> would deal" has the sources as the subject; a group named once as a target is named again by its own copy of the state', () => {
    expect(fullyAutomated(creature('When this creature enters, prevent all combat damage that other creatures would deal this turn.'))).toBe(true);
    expect(fullyAutomated(spell('Prevent all combat damage that creatures you control would deal this turn.'))).toBe(true);
    expect(fullyAutomated(spell('Prevent all combat damage that creatures you control would be dealt this turn.'))).toBe(false);
    expect(fullyAutomated(spell('Prevent all damage that creatures you control would deal to target player this turn.'))).toBe(false);
    expect(fullyAutomated(spell('Prevent all combat damage that would be dealt by creatures other than target creature this turn.'))).toBe(true);
  });
});
