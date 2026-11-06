/**
 * Commander EDHREC ranks 29,501-30,000, round edh-c-43: the template data of parser/templates/zz-cloud/edh-c-43.json (conditional pump with "attacks each combat if able" or "can attack as though it didn't have defender", "is <color> and has <abilities>", an Aura pump with an otherwise pump, "costs {N} less to cast if you control A or B", an Aura pump with haste and "attacks each combat if able") and the round's parser, engine and renderer changes, tested at the end of this file and in edh-c-43-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-c-43-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC43 from '../../../src/parser/templates/zz-cloud/edh-c-43.json';
import review43 from '../../m5/golden/cards/edh-c-43-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC43 as Template[];
/** The round's golden entries. */
const review = review43 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 7;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'sta.edhv43.aslong.pump.mustAttack': ['Otarian Juggernaut'],
  'sta.edhv43.aslong.pump.attackNoDefender': ['Spire Serpent'],
  'sta.edhv43.aslong.color.grant': ['Repentant Vampire'],
  'sta.edhv43.attached.pump.aslongIs.otherwise.pump': ['Nyx Infusion', 'Clutch of Undeath'],
  'sta.edhv43.attached.pump.aslongIs.color.otherwise.pump': ["Serra's Boon"],
  'cm.edhv43.self.less.ifControlEither': ['Frostpyre Arcanist'],
  'sta.edhv43.pumpgrant.mustAttack': ['Infectious Bloodlust'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: an Aura for "Enchanted creature ...", else a creature (a static line, with the Oracle's own "~" for the object itself). */
const parsedWith = (t: Template, text: string) =>
  parseCard(
    /^Enchanted creature/.test(text) ? card('Example Plan', 'Enchantment — Aura', `Enchant creature\n${text}`)
    : card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>),
    OPTS,
  ).faces[0]!;

describe('edh-c-43 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-43.json, path order: after edh-c-4, before edh-c-5) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-43.json');
    expect(files.indexOf('zz-cloud/edh-c-43.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-c-4.json'));
    expect(files.indexOf('zz-cloud/edh-c-43.json')).toBeLessThan(files.indexOf('zz-cloud/edh-c-5.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhv43.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhv43\./);
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

describe('edh-c-43 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-c-43 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-43 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-43 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-43 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Drake', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
const instant = (text: string) => parseCard(card('Example Plan', 'Instant', text), OPTS).faces[0]!;

describe('edh-c-43 parser, engine and renderer changes (one test each)', () => {
  it('parser/holes/qty.ts (CR 701.20a, 608.2c): "the number of cards revealed this way" counts the cards an earlier reveal step of the same ability revealed; with no reveal before it, or another verb, it is not read', () => {
    const ok = instant('Reveal any number of black cards in your hand. Target creature gets -X/-X until end of turn, where X is the number of cards revealed this way.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"q":"resultCount"');
    for (const bad of [
      'Target creature gets -X/-X until end of turn, where X is the number of cards revealed this way.',
      'Discard any number of black cards from your hand. Target creature gets -X/-X until end of turn, where X is the number of cards revealed this way.',
      'Reveal any number of black cards in your hand. Target creature gets -X/-X until end of turn, where X is the number of cards discarded this way.',
    ]) expect(fullyAutomated(instant(bad)) && JSON.stringify(instant(bad).abilities).includes('"q":"resultCount"'), bad).toBe(false);
  });
  it('render/cond.ts (CR 506.4, 508.1, 509.1): "as long as it isn\'t attacking or blocking" is the negation of attacking or blocking (either role); "attacking and blocking", "isn\'t attacking" and "isn\'t blocking" are other readings', () => {
    const ok = creature('This creature gets +2/+0 as long as it isn\'t attacking or blocking.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"anyOf":[{"attacking":true},{"blocking":true}]');
    for (const bad of ['This creature gets +2/+0 as long as it isn\'t attacking.', 'This creature gets +2/+0 as long as it isn\'t blocking.', 'This creature gets +2/+0 as long as it isn\'t attacking and blocking.']) {
      const f = creature(bad);
      expect(fullyAutomated(f) && JSON.stringify(f.abilities).includes('"anyOf":[{"attacking":true},{"blocking":true}]'), bad).toBe(false);
    }
  });
  it('render/np.ts (CR 105.2, 205.2; family two-groups-and): "Green creatures and white creatures have protection from Gorgons." is the creatures that are green or white; "and" between a group and another type, or other words, is not this reading', () => {
    const ok = creature('Green creatures and white creatures have protection from Gorgons.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"anyOf":[{"colors":["G"],"types":["Creature"]},{"colors":["W"],"types":["Creature"]}]');
    for (const bad of ['Green creatures and white lands have protection from Gorgons.', 'Green creatures and white creatures you control have protection from Gorgons.', 'Green creatures and blorfty creatures have protection from Gorgons.']) {
      const f = creature(bad);
      expect(fullyAutomated(f) && JSON.stringify(f.abilities).includes('"colors":["G"],"types":["Creature"]},{"colors":["W"],"types":["Creature"]}'), bad).toBe(false);
    }
  });
  it('render/stat.ts (CR 609.4, 702.3b, 613.4c): "~ gets +2/+2 and can attack as though it didn\'t have defender" is one sentence of a pump and the permission of the object itself', () => {
    expect(fullyAutomated(creature("Defender\nAs long as you control two or more artifacts, this creature gets +2/+2 and can attack as though it didn't have defender."))).toBe(true);
    expect(fullyAutomated(creature("Defender\nAs long as you control two or more artifacts, this creature gets +2/+2 and can block as though it didn't have defender."))).toBe(false);
  });
});
