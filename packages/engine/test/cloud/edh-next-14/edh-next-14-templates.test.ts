/**
 * Commander lane edh-next, round edh-next-14 (EDHREC ranks 11,251-12,500, third pass): the template data of parser/templates/zz-cloud/edh-next-14.json ("~ deals N damage to <recipient> for each X",
 * "each player loses half their life, rounded up", "return it to the battlefield under your control with N counters on it", "gains K and can't be blocked by X this turn", "each player may search their
 * library for a card and put it into their hand", "each player who searched their library this way shuffles", "return it to the battlefield face down under your control") and the round's renderer and
 * hole changes, tested at the end of this file and in edh-next-14-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-next-14-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext14 from '../../../src/parser/templates/zz-cloud/edh-next-14.json';
import review14 from '../../m5/golden/cards/edh-next-14-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext14 as Template[];
/** The round's golden entries. */
const review = review14 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 7;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhn14.damage.twoForEach': ['Black Market Tycoon'],
  'eff.edhn14.eachPlayerLoseHalfLife': ['Scourge of the Skyclaves'],
  'eff.edhn14.return.bf.underYourControl.counters': ['Unholy Indenture'],
  'eff.edhn14.grant.cantbeblockedBy': ['Kick in the Door'],
  'eff.edhn14.eachPlayerWhoSearchedTheirLibrary.shuffles': ['Boldwyr Heavyweights', 'Noble Benefactor'],
  'eff.edhn14.eachPlayerMay.search.anyCard.hand': ['Noble Benefactor'],
  'eff.edhn14.return.toBattlefield.faceDown.yourControl': ['Ashcloud Phoenix'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (_t: Template, text: string) =>
  parseCard(
    /^(Enchant(ed)? |When enchanted)/.test(text) ? card('Example Plan', 'Enchantment — Aura', text)
      : /^~ enters|^\{/.test(text) ? card('Example Plan', 'Artifact', text)
        : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
          : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-14 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-14.json, path order: after edh-next-1, before edh-next-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-14.json');
    expect(files.indexOf('zz-cloud/edh-next-14.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-1.json'));
    expect(files.indexOf('zz-cloud/edh-next-14.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhn14.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm|rst)\.edhn14\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
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

describe('edh-next-14 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bmay create\b/, 'creates'], [/\bits controller\b/, 'target player'], [/\bthat player\b/, 'you'], [/\bthat\'s tapped and attacking\b/, "that's tapped"], [/\bonto the battlefield\b/, 'into your hand'],
    [/\bthe rest into your graveyard\b/, 'the rest into your hand'], [/\bloses all abilities\b/, 'loses flying'], [/\blegendary\b/, 'snow'], [/\bfirst strike\b/, 'flying'], [/\bfor each\b/, 'for every two'],
    [/\ban additional card\b/, 'two additional cards'], [/\bdiscards a card\b/, 'discards two cards'], [/\benters tapped\b/, 'enters'], [/\bfrom their hand\b/, 'from their graveyard'], [/\bas long as\b/, 'unless'],
    [/\bless to cast\b/, 'more to cast'], [/\bcan't be blocked\b/, 'can be blocked'], [/\beach player\b/, 'each opponent'], [/\bcost \{1\}\b/, 'cost {2}'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-14 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-14 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // the word in front of "counter(s)" is an open class by design (6.11, the CounterKind hole)
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

describe.skipIf(index === null)('edh-next-14 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-14 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
const equipment = (text: string) => parseCard(card('Example Plan', 'Artifact — Equipment', text), OPTS).faces[0]!;

describe('edh-next-14 parser and renderer changes (one test each)', () => {
  it('parser/holes/qty.ts + render/qty.ts (family life-total-highest-greatest): "the highest life total among players" is the highest among all players, and is said either way; "among your opponents" is another count', () => {
    const a = parseCard(card('Example Plan', 'Creature — Demon', "~'s power and toughness are each equal to 20 minus the highest life total among players.", { power: '0', toughness: '0' } as Partial<OracleCard>), OPTS).faces[0]!;
    const b = parseCard(card('Example Plan', 'Creature — Demon', "~'s power and toughness are each equal to 20 minus the highest life total among all players.", { power: '0', toughness: '0' } as Partial<OracleCard>), OPTS).faces[0]!;
    expect(fullyAutomated(a) && fullyAutomated(b) && jsonKey(a.abilities) === jsonKey(b.abilities)).toBe(true);
    const c = parseCard(card('Example Plan', 'Creature — Demon', "~'s power and toughness are each equal to 20 minus the highest life total among your opponents.", { power: '0', toughness: '0' } as Partial<OracleCard>), OPTS).faces[0]!;
    expect(jsonKey(c.abilities) === jsonKey(a.abilities)).toBe(false);
  });
  it('render/np.ts (family list-of-three-flat): "instant, sorcery, or Wizard spell" and "instant or sorcery or Wizard spell" are one set of spells; a fourth kind or a different order of kinds is another set', () => {
    const t = (x: string) => parseCard(card('Example Plan', 'Creature — Pirate', `Whenever you cast ${x}, draw a card.`, { power: '1', toughness: '1' } as Partial<OracleCard>), OPTS).faces[0]!;
    const a = t('an instant, sorcery, or Wizard spell');
    const b = t('an instant or sorcery or Wizard spell');
    expect(fullyAutomated(a) && fullyAutomated(b) && jsonKey(a.abilities) === jsonKey(b.abilities)).toBe(true);
    expect(fullyAutomated(t('an instant, sorcery, or Goblin spell')) && jsonKey(t('an instant, sorcery, or Goblin spell').abilities) === jsonKey(a.abilities)).toBe(false);
  });
  it('render/np.ts (family same-name-that-has): "with the same name as a card from your graveyard" and "that has the same name as a card in your graveyard" are one description; "in an opponent\'s graveyard" is another description', () => {
    const t = (x: string) => parseCard(card('Example Plan', 'Sorcery', `Counter target spell ${x}.`), OPTS).faces[0]!;
    const a = t('that has the same name as a card in your graveyard');
    const b = t('with the same name as a card from your graveyard');
    expect(fullyAutomated(a) && fullyAutomated(b) && jsonKey(a.abilities) === jsonKey(b.abilities)).toBe(true);
    expect(jsonKey(t('that has the same name as a card in an opponent\'s graveyard').abilities) === jsonKey(a.abilities)).toBe(false);
  });
  it('render/np.ts (family historic-attacking-order): "attacking historic creature" and "historic attacking creature" are one description; "attacking legendary" is another', () => {
    const t = (x: string) => parseCard(card('Example Plan', 'Sorcery', `Target ${x} creature gets +1/+1 until end of turn.`), OPTS).faces[0]!;
    const a = t('attacking historic');
    const b = t('historic attacking');
    expect(fullyAutomated(a) && fullyAutomated(b) && jsonKey(a.abilities) === jsonKey(b.abilities)).toBe(true);
    expect(jsonKey(t('attacking legendary').abilities) === jsonKey(a.abilities)).toBe(false);
  });
  it('render/steps-cards.ts (family who-searched-their-library) and steps-flow.ts (family half-of-own): "who searched their library this way" and "each player loses half their life, rounded up" say the one step either way', () => {
    const a = parseCard(card('Example Plan', 'Sorcery', 'Search your library for a land card and put it onto the battlefield. Then each player who searched their library this way shuffles.'), OPTS).faces[0]!;
    const b = parseCard(card('Example Plan', 'Sorcery', 'Search your library for a land card and put it onto the battlefield. Then each player who searched a library this way shuffles.'), OPTS).faces[0]!;
    expect(fullyAutomated(a) && fullyAutomated(b) && jsonKey(a.abilities) === jsonKey(b.abilities)).toBe(true);
    expect(fullyAutomated(parseCard(card('Example Plan', 'Sorcery', 'Each player loses half their life, rounded up.'), OPTS).faces[0]!)).toBe(true);
    expect(fullyAutomated(parseCard(card('Example Plan', 'Sorcery', 'Each player loses half their life, rounded down.'), OPTS).faces[0]!)).toBe(false);
  });
});
