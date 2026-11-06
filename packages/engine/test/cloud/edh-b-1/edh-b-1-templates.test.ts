/**
 * Commander coordinator B, round edh-b-1: the template data of parser/templates/zz-cloud/edh-b-1.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-b-1-scenarios.test.ts.
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
import edhB1 from '../../../src/parser/templates/zz-cloud/edh-b-1.json';
import review from '../../m5/golden/cards/edh-b-1-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhB1 as Template[];
const MECH_COUNT = 15;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full
  'eff.edhb1.dig.mayReveal.listed.hand': ['Acclaimed Contender'],
  'eff.edhb1.dig.mayReveal.threeAndOr.hand': ['Kaalia, Zenith Seeker'],
  'eff.edhb1.dig.put.hand.restBottomRandom': ['Adéwalé, Breaker of Chains'],
  'eff.edhb1.milled.may.put.hand.adjective': ['Ballad of the Black Flag'],
  'eff.edhb1.becomes.colors.artifactCreature.dur': ['Selesnya Keyrune'],
  'eff.edhb1.becomes.colors.artifactCreature.cantBeBlocked': ['Dimir Keyrune'],
  'sta.edhb1.have.basePT.are.subtypes.otherCreatureTypes': ['Graaz, Unstoppable Juggernaut'],
  'sta.edhb1.have.basePT.have.are.subtypes.inaddition': ["Sigarda's Summons"],
  'sta.edhb1.self.isAlso.subtypes': ['Burakos, Party Leader'],
  'sta.edhb1.self.allColors.identity': ['Fallaji Wayfarer'],
  'sta.edhb1.players.cantSearch.libraries': ['Stranglehold'],
  'eff.edhb1.timeTravel.times': ['The Tenth Doctor'],
  'eff.edhb1.loseAll.basePT.dur': ['Warkite Marauder'],
  'eff.edhb1.becomes.pt.subtype.artifactCreature.gains.noDuration': ['Vronos, Masked Inquisitor'],
  'eff.edhb1.dur.group.gain.and.get.foreach.counterOnSelf': ['Haldir, Lórien Lieutenant'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' })
    : /^(Look|Reveal|Mill)/.test(text) ? card('Example Plan', 'Sorcery', text)
    : text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-b-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-b-1.json, path order: after cmd5, before edh-cast-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-b-1.json');
    expect(files.indexOf('zz-cloud/edh-b-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/cmd5.json'));
    expect(files.indexOf('zz-cloud/edh-b-1.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhb1.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid)\.edhb1\./);
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

describe('edh-b-1 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bGoblin\b/, 'Goblins'], [/\bhaste\b/, 'x'], [/\bflying\b/, 'x'], [/\bloses\b/, 'gains'], [/\bcounter\b/, 'x'], [/\bthree\b/, 'x'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-b-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-b-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w) || /^counters?\b/.test(words[i + 1] ?? '')) return; // a counter kind is an open class (design 6.11)
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

describe.skipIf(index === null)('edh-b-1 design 6.10 (local index): synthetic examples', () => {
  it('no edh-b-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // a pattern with no slot ("~ is all colors. This ability doesn't affect its color identity.") is one fixed sentence: its examples can only be that sentence, so they are exempt (as cloud c2)
    const withSlots = MECH.filter((t) => /\{[a-z0-9]+:/.test(t.pattern) || !t.pattern.startsWith('~ is all colors'));
    const verbatim = withSlots.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

describe('edh-b-1 parser, lowering and renderer changes (one test each)', () => {
  const spell = (text: string, type = 'Instant') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  const creature = (text: string, type = 'Creature — Wizard') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/holes/edhb1.ts#listedCard (CR 205.4a, 205.2a): a legendary item ends a list of card types or subtypes; a non-card word after "legendary" stays manual', () => {
    const dig = (list: string) => creature(`When ~ enters, look at the top five cards of your library. You may reveal ${list} card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.`);
    expect(fullyAutomated(dig('a Goblin, Wizard, or legendary artifact'))).toBe(true);
    expect(fullyAutomated(dig('an Elf or legendary land'))).toBe(true);
    expect(fullyAutomated(dig('a Goblin, Wizard, or legendary blorfty'))).toBe(false);
  });
  it('render/np.ts (CR 205.4a): the list with a legendary last item is said "a Knight, Aura, or legendary artifact card", never as two descriptions joined by "or"', () => {
    const f = creature('When ~ enters, look at the top five cards of your library. You may reveal a Goblin, Wizard, or legendary artifact card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.');
    expect(f.gate.every((g) => g.ok)).toBe(true);
  });
  it('parser/holes/edhb1.ts#subtypeList + render/mods.ts (CR 205.3m, 205.1b): "~ is also a A, B, and C" adds each subtype; a list of card types or one article too many is manual', () => {
    expect(fullyAutomated(creature('~ is also a Cleric, Rogue, and Wizard.'))).toBe(true);
    expect(fullyAutomated(creature('~ is also a Cleric, a Rogue, and a Wizard.'))).toBe(false);
    expect(fullyAutomated(creature('~ is also an artifact and creature.'))).toBe(false);
  });
  it('render/mods.ts (CR 105.2b, 903.4a): "~ is all colors. This ability doesn\'t affect its color identity." reads only with its second sentence; the sentence alone is not a rule', () => {
    expect(fullyAutomated(creature("~ is all colors. This ability doesn't affect its color identity."))).toBe(true);
    expect(fullyAutomated(creature("~ is all colors. This ability affects its color identity."))).toBe(false);
  });
  it('render/stat.ts (CR 205.1b, 509.1b): one object that becomes an artifact creature of two colors until end of turn "and can\'t be blocked this turn" is said as one clause', () => {
    const f = creature('{0}: ~ becomes a 2/2 red and white Cat artifact creature until end of turn and can\'t be blocked this turn.', 'Artifact');
    expect(f.gate.every((g) => g.ok) && fullyAutomated(f)).toBe(true);
  });
  it('render/steps-flow.ts (CR 701.56a): one time travel done twice or more is "time travel N times"; once is "time travel"', () => {
    expect(fullyAutomated(creature('{0}: Time travel three times.', 'Artifact'))).toBe(true);
    expect(fullyAutomated(creature('{0}: Time travel once times.', 'Artifact'))).toBe(false);
  });
  it('parser/lower/mentions.ts (CR 608.2c): "the rest" after three choices among the cards looked at is the cards none of the three took', () => {
    const f = creature('When ~ enters, look at the top six cards of your library. You may reveal a Goblin card, an Elf card, and/or a Wizard card from among them and put them into your hand. Put the rest on the bottom of your library in a random order.');
    expect(fullyAutomated(f)).toBe(true);
  });
  it('parser/front/labels.ts (CR 207.2c): a title that ends in "!" may have "it" between capitalized words ("Bring it Down!"); rules text with "it" stays text', () => {
    expect(fullyAutomated(creature('Bring it Down! -- Whenever this creature attacks, creatures you control gain deathtouch until end of turn.'))).toBe(true);
    expect(fullyAutomated(creature('Destroy it -- Whenever this creature attacks, creatures you control gain deathtouch until end of turn.'))).toBe(false);
  });
});
