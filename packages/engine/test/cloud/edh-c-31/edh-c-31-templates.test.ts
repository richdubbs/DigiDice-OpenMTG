/**
 * Commander EDHREC ranks 23,501-24,000, round edh-c-31 (first pass): the template data of parser/templates/zz-cloud/edh-c-31.json ("~ can block creatures with shadow as though they didn't have shadow", "~ deals N damage to X and the damage can't be prevented", "target creature gets +2/+2 and gains horsemanship" with no duration) and the round's parser, engine and renderer changes, tested at the end of this file and in edh-c-31-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-c-31-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC31 from '../../../src/parser/templates/zz-cloud/edh-c-31.json';
import review31 from '../../m5/golden/cards/edh-c-31-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC31 as Template[];
/** The round's golden entries. */
const review = review31 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 3;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'sta.edhv31.blockAsThough.selfAttackers': ['Aetherflame Wall'],
  'eff.edhv31.damage.andUnpreventable': ['Arrow Storm'],
  'eff.edhv31.pumpGrant.noDuration': ['Riding the Dilu Horse'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static line on an Aura, an Equipment or a creature, a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(
    /^\{/.test(text) ? card('Example Plan', 'Artifact', text)
    : /^(When|At the|Whenever|~ can)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : card('Example Plan', 'Sorcery', text),
    OPTS,
  ).faces[0]!;

describe('edh-c-31 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-31.json, path order: after edh-c-3, before edh-c-4) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-31.json');
    expect(files.indexOf('zz-cloud/edh-c-31.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-c-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhv31.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhv31\./);
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

describe('edh-c-31 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-c-31 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-31 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-31 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-31 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
const aura = (text: string) => parseCard(card('Example Plan', 'Enchantment — Aura', text), OPTS).faces[0]!;

describe('edh-c-31 parser, engine and renderer changes (one test each)', () => {
  it('rules/quality.ts, parser/holes/misc.ts, cards/keywords.ts and render/kw.ts (CR 702.16a, 205.3, 205.4): "protection from legendary creatures" and "protection from non-Spirit creatures" are conjunction qualities; a bare "creatures", a color or another word is not read as them', () => {
    const leg = creature('Protection from legendary creatures');
    expect(fullyAutomated(leg)).toBe(true);
    expect(JSON.stringify(leg.abilities)).toContain('type:Creature&supertype:Legendary');
    const nonSpirit = creature('Protection from non-Spirit creatures');
    expect(fullyAutomated(nonSpirit)).toBe(true);
    expect(JSON.stringify(nonSpirit.abilities)).toContain('type:Creature&!subtype:spirits');
    for (const bad of ['Protection from non-Zorblaxine creatures', 'Protection from non-Spirit', 'Protection from legendary', 'Protection from nonlegendary creatures']) {
      const f = creature(bad);
      expect(fullyAutomated(f) && /type:Creature&/.test(JSON.stringify(f.abilities)), bad).toBe(false);
    }
  });
  it('render/mods.ts and render/quote.ts (CR 702.24a): a granted cumulative upkeep with a mana cost is quoted with its period inside; a granted flying is not quoted', () => {
    expect(fullyAutomated(aura('Enchant creature\nEnchanted creature has "Cumulative upkeep {1}."'))).toBe(true);
    expect(fullyAutomated(aura('Enchant creature\nEnchanted creature has cumulative upkeep {1}.'))).toBe(false);
    expect(fullyAutomated(aura('Enchant creature\nEnchanted creature has flying.'))).toBe(true);
  });
  it('render/np.ts (family attacking-nonblack-order): "nonblack attacking creature" and "attacking nonblack creature" are one reading; "nonblack blocking creature" is another', () => {
    expect(fullyAutomated(sorcery('Destroy target nonblack attacking creature.'))).toBe(true);
    expect(fullyAutomated(sorcery('Destroy target attacking nonblack creature.'))).toBe(true);
    const blocking = sorcery('Destroy target nonblack blocking creature.');
    expect(JSON.stringify(blocking.abilities)).not.toContain('"attacking":true');
  });
  it('parser/holes/p2iv2.ts and render/p2iv2.ts (CR 303.4, 301.5): "as long as this creature is enchanted or equipped" is an Aura or an Equipment attached to it; "enchanted and equipped" is not this reading', () => {
    expect(fullyAutomated(creature("As long as this creature is enchanted or equipped, it can attack as though it didn't have defender."))).toBe(true);
    const both = creature("As long as this creature is enchanted and equipped, it can attack as though it didn't have defender.");
    expect(fullyAutomated(both) && JSON.stringify(both.abilities).includes('"anyOf"')).toBe(false);
  });
  it('statics/hooks.ts#permitsAttacker (CR 609.4, 702.28b): the permission needs `of` (the blocker) together with the attackers it concerns; the keyword it names is the one it waives', () => {
    const ok = creature("This creature can block creatures with shadow as though they didn't have shadow.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"of":{"self":true}');
    expect(fullyAutomated(creature("This creature can block creatures with shadow as though they didn't have flying."))).toBe(false);
  });
  it('render/self-replacement.ts (CR 614.15, 615.12): an "instead" damage that adds "can\'t be prevented" replaces the damage before it; an unknown rider is still refused', () => {
    expect(fullyAutomated(sorcery("This spell deals 4 damage to any target. If you attacked this turn, instead this spell deals 5 damage to that permanent or player and the damage can't be prevented."))).toBe(true);
    expect(fullyAutomated(sorcery("This spell deals 4 damage to any target. If you attacked this turn, instead this spell deals 5 damage to that permanent or player and the damage can't be redirected."))).toBe(false);
  });
  it('rules/combat-rules.ts and core/combat.ts (CR 702.22c-k): banding is an implemented keyword, so a card with it is automated', () => {
    expect(fullyAutomated(creature('Banding'))).toBe(true);
    expect(fullyAutomated(creature('Banding with other'))).toBe(false);
  });
});
