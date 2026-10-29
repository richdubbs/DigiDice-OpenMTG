/**
 * Commander lane edh-cast, round edh-cast-1: the template data of parser/templates/zz-cloud/edh-cast-1.json (cast or play from the top of your library for life, "play
 * historic lands and cast historic spells from the top", "each spell you cast that's red or green costs {1} less", "spells you cast with power N or greater cost less",
 * "each creature you control with power N gets +1/+1 and gains trample", "spells you cast with mana value N or greater have cascade", "creature spells you cast this turn
 * can't be countered", "copy target spell, then return it to its owner's hand", "you may copy the exiled card. If you do, you may cast the copy", "change a target of
 * target spell or ability to ~"). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example
 * does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2).
 * Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-cast-1-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhCast1 from '../../../src/parser/templates/zz-cloud/edh-cast-1.json';
import review from '../../m5/golden/cards/edh-cast-1-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhCast1 as Template[];
const MECH_COUNT = 11;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'sta.edhc1.top.lands.cast.lifeCost': ["Bolas's Citadel"],
  'sta.edhc1.top.play.cast.two': ['Crystal Skull, Isu Spyglass'],
  'sta.edhc1.spells.each.thatColors.less': ['Goblin Anarchomancer'],
  'cm.edhc1.spells.less.you.power': ['Goreclaw, Terror of Qal Sisma'],
  'eff.edhc1.pumpgrant.eachSingular': ['Goreclaw, Terror of Qal Sisma'],
  'sta.edhc1.spells.cast.mv.cascade': ['Imoti, Celebrant of Bounty'],
  'eff.edhc1.spells.cast.thisTurn.cantBeCountered': ['Domri, Anarch of Bolas'],
  'eff.edhc1.copy.spell.thenReturn': ["Narset's Reversal"],
  'eff.edhc1.mayCopyExiled.castFree': ['Isochron Scepter'],
  'eff.edhc1.changeTarget.a.toSelf': ['Spellskite'],
  'eff.edhc1.changeTarget.the.toSelf': ['Hydroelectric Specimen // Hydroelectric Laboratory'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (an instant); the others are abilities of a creature (static, activated, triggered; "~ gains" needs a creature). */
const SPELL = new Set<string>(['eff.edhc1.pumpgrant.eachSingular', 'eff.edhc1.spells.cast.thisTurn.cantBeCountered', 'eff.edhc1.copy.spell.thenReturn']);
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Sorcery', text), OPTS) : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-cast-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-cast-1.json, path order: after cmd5, before look3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-cast-1.json');
    expect(files.indexOf('zz-cloud/edh-cast-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/cmd5.json'));
    expect(files.indexOf('zz-cloud/edh-cast-1.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.edhc1.* (or sta., cm.)', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm)\.edhc1\./);
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

describe('edh-cast-1 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bred or green\b/, 'red and green'], [/\bwhite or blue\b/, 'white and blue'], [/\b(\d+) or greater\b/, '$1 or less'], [/\bfrom the top of your library\b/, 'from your graveyard'],
    [/\bgreater\b/, 'less'], [/\byou cast\b/, 'your opponents cast'], [/\bless to cast\b/, 'more to cast'], [/\bcascade\b/, 'storm'], [/\bthis turn\b/, 'until your next turn'],
    [/\bits owner's hand\b/, 'your hand'], [/\bthe exiled card\b/, 'an exiled card'], [/\bwithout paying its mana cost\b/, 'by paying its mana cost'], [/\ba target\b/, 'the target'],
    [/\bto ~\b/, 'to target creature'], [/\bgets\b/, 'gains'], [/\bpay life\b/, 'lose life'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-cast-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-cast-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-cast-1 design 6.10 (local index): synthetic examples', () => {
  it('no edh-cast-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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



describe('edh-cast-1 parser and renderer changes (one test each)', () => {
  const face = (text: string, type = 'Artifact Creature — Golem') => parseCard(card('Example Relic', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/templates/zz-fast3/t15.json and zz-cloud/r4-cost.json (design 6.3 rule 3, G5): the "X and Y spells" pair readings have priority -1, so the single filter reading ("Aura and Equipment", "Instant and sorcery") keeps the sentence', () => {
    for (const id of ['prm.t15.flash.two', 'eff.cost.spells.and.less.forEachCounterOnSelf']) expect(TEMPLATE_SET.find((t) => t.id === id)!.priority, id).toBe(-1);
    const flash = face('You may cast Aura and Equipment spells as though they had flash.');
    expect(fullyAutomated(flash)).toBe(true);
    expect(JSON.stringify(flash.abilities)).toContain('"subtypes":["Aura","Equipment"]');
    const cost = face('Instant and sorcery spells you cast cost {1} less to cast for each oil counter on ~.');
    expect(fullyAutomated(cost)).toBe(true);
    expect(JSON.stringify(cost.abilities)).toContain('"types":["Instant","Sorcery"]');
  });
  it('parser/holes/filter.ts (CR 115.9b): "a spell or ability that targets you or a creature you control" is two options of what it targets; "that targets you" alone is still read as before', () => {
    const both = face('{U}, Sacrifice ~: Counter target spell or ability that targets you or a creature you control.');
    expect(fullyAutomated(both)).toBe(true);
    expect(JSON.stringify(both.abilities)).toContain('"anyOf":[{"targets":{"ref":"you"}},{"targets":{"ref":"each","filter":{"types":["Creature"],"controller":"you"}}}]');
    expect(fullyAutomated(face('{U}, Sacrifice ~: Counter target spell or ability that targets you.'))).toBe(true);
    expect(fullyAutomated(face('{U}, Sacrifice ~: Counter target spell or ability that targets you and a creature you control.'))).toBe(false);
  });
  it('render/refs.ts (CR 115.9b): "target spell or ability that targets a creature you control" prints its relative clause', () => {
    expect(fullyAutomated(face('{U}, Sacrifice ~: Counter target spell or ability that targets a creature you control.'))).toBe(true);
  });
  it('parser/lower/riders.ts "@alsoStep" (CR 608.2c, 707.10c): "You may choose new targets for the copy" reaches the copy before a later move; with the copy last it is unchanged', () => {
    const t = TEMPLATE_SET.find((x) => x.id === 'rid.copy.newTargets')!;
    expect(JSON.stringify(t.build)).toContain('"@alsoStep":-2');
    const f = parseCard(card('Example Plan', 'Instant', "Copy target instant or sorcery spell, then return it to its owner's hand. You may choose new targets for the copy."), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"newTargets":"may"');
    expect(fullyAutomated(parseCard(card('Example Plan', 'Instant', 'Copy target instant spell. You may choose new targets for the copy.'), OPTS).faces[0]!)).toBe(true);
    expect(fullyAutomated(parseCard(card('Example Plan', 'Instant', 'Draw a card. You may choose new targets for the copy.'), OPTS).faces[0]!)).toBe(false);
  });
  it('parser/lower/ability.ts#joinCopyExiledCast and normalize.ts (CR 707.12): a copy of the card the object exiled (linked) is cast; a copy of another zone\'s card stays manual', () => {
    const rod = (second: string) => face(`When ~ enters, you may exile an instant card from your hand.\n{3}, {T}: ${second}`);
    expect(fullyAutomated(rod('You may copy the exiled card. If you do, you may cast the copy without paying its mana cost.'))).toBe(true);
    expect(fullyAutomated(rod('You may copy the exiled card. If you do, you may cast the copy.'))).toBe(false);
  });
  it('model/capabilities.ts: op:changeTarget.to is registered; the walker names it only for a step with `to`', () => {
    expect(ENGINE_CAPABILITIES.has('op:changeTarget.to')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('op:changeTarget')).toBe(true);
  });
  it('the first-spell variants stay as they were: "the next creature spell you cast this turn can\'t be countered" is not read by the "spells you cast this turn" template', () => {
    expect(fullyAutomated(parseCard(card('Example Plan', 'Sorcery', "Creature spells you cast can't be countered."), OPTS).faces[0]!)).toBe(false);
  });
});
