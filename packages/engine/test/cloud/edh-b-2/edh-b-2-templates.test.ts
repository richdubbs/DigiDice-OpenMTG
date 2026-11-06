/**
 * Commander effort, coordinator B, round edh-b-2 (EDHREC ranks 7,251 to 8,000; template id code edhb2): the template data of parser/templates/zz-cloud/edh-b-2.json (see the
 * file) and the round's parser, lowering, engine and renderer changes, tested at the end of this file and in edh-b-2-scenarios.test.ts.
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
import edhB2 from '../../../src/parser/templates/zz-cloud/edh-b-2.json';
import review from '../../m5/golden/cards/edh-b-2-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhB2 as Template[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21 and the standing rule of 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full
  'rep.edhb2.players.skip.step.untap': ['Stasis'],
  'rst.edhb2.group.cant.haveKindCountersPut': ['Blightbeetle', 'Darksteel Angel'],
  'sta.edhb2.attached.pump.xPlusOne.whereX': ['Cranial Ram'],
  'sta.edhb2.aslong.self.grant.attackNoDefender': ['Colossus of Akros'],
  'sta.edhb2.self.notLegendary.ifToken': ['Aeve, Progenitor Ooze'],
  'eff.edhb2.prevent.damage.toAndBy.obj': ['Kiora, the Crashing Wave'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  text.startsWith('Enchanted ') ? card('Example Charm', 'Enchantment — Aura', `Enchant creature\n${text}`)
    : t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Instant', text), OPTS).faces[0]!;

describe('edh-b-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-b-2.json, path order: before edh-cast-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-b-2.json');
    expect(files.indexOf('zz-cloud/edh-b-2.json')).toBeGreaterThan(files.indexOf('zz-cloud/cmd5.json'));
    expect(files.indexOf('zz-cloud/edh-b-2.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhb2.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|rst)\.edhb2\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
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

describe('edh-b-2 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-b-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-b-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (words[i + 1]?.startsWith('counters')) return; // the name of a kind of counter is an open class (design 6.11): "blorfty counters" is a kind of counter
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

describe.skipIf(index === null)('edh-b-2 design 6.10 (local index): synthetic examples', () => {
  it('no edh-b-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-b-2 parser, lowering and renderer changes (one test each)', () => {
  const spell = (text: string, type = 'Instant') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  const creature = (text: string, type = 'Creature — Wizard') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/holes/filter.ts (CR 702): "with flying, deathtouch, and/or lifelink" is a keyword list closed by "or" / "and/or" (any of them); a list that is never closed, "and", and a lacked list are not read', () => {
    expect(fullyAutomated(spell('Each creature you control with flying, deathtouch, and/or lifelink gets +1/+0 until end of turn.'))).toBe(true);
    expect(fullyAutomated(spell('Each creature you control with flying, deathtouch, or lifelink gets +1/+0 until end of turn.'))).toBe(true);
    expect(fullyAutomated(spell('Each creature you control with flying, deathtouch gets +1/+0 until end of turn.'))).toBe(false);
    expect(fullyAutomated(spell('Each creature you control with flying, deathtouch, and lifelink gets +1/+0 until end of turn.'))).toBe(false);
  });
  it('render/np.ts (CR 702): two keywords stay "flying or reach"; three or more are a list ("flying, reach, or haste" and "flying, reach, and/or haste")', () => {
    expect(fullyAutomated(spell('Each creature you control with flying or reach gets +1/+0 until end of turn.'))).toBe(true);
    expect(fullyAutomated(spell('Each creature you control with flying, reach, or haste gets +1/+0 until end of turn.'))).toBe(true);
    expect(fullyAutomated(spell('Each creature you control with flying or reach or haste gets +1/+0 until end of turn.'))).toBe(false);
  });
  it("render/np.ts (CR 205.2a, 205.3m): \"each creature you control that's an artifact or Human\" has one article for the list; other orders and a second type are not read", () => {
    expect(fullyAutomated(spell("Each creature you control that's an artifact or Human gains indestructible until end of turn."))).toBe(true);
    expect(fullyAutomated(spell("Each creature you control that's a Human or artifact gains indestructible until end of turn."))).toBe(false);
  });
  it('render/stat.ts (CR 614.10): "Players skip their untap steps." only for the untap, draw and end steps of every player; the one player stays "skip your draw step"', () => {
    expect(fullyAutomated(creature('Players skip their untap steps.', 'Enchantment'))).toBe(true);
    expect(fullyAutomated(creature('Skip your draw step.', 'Enchantment'))).toBe(true);
    expect(fullyAutomated(creature('Players skip their untap steps and draw steps.', 'Enchantment'))).toBe(false);
  });
  it('render/stat.ts (CR 615.1a, 120.2): the pair "prevent all damage that would be dealt to and dealt by" an object, with the duration leading or trailing; combat damage keeps its own wording', () => {
    expect(fullyAutomated(spell('Prevent all damage that would be dealt to and dealt by target creature this turn.'))).toBe(true);
    expect(fullyAutomated(spell('Until your next turn, prevent all damage that would be dealt to and dealt by target creature.'))).toBe(true);
    expect(fullyAutomated(spell('Prevent all combat damage that would be dealt to and dealt by target creature this turn.'))).toBe(true);
    expect(fullyAutomated(spell('Until end of turn, prevent all combat damage that would be dealt to and dealt by target creature.'))).toBe(false);
  });
  it('render/mods.ts, render/abil.ts (CR 205.4a, 613.1d): "~ isn\'t legendary if it\'s a token." and the condition-first order; another supertype is not read', () => {
    expect(fullyAutomated(creature("~ isn't legendary if it's a token.", 'Legendary Creature — Ooze'))).toBe(true);
    expect(fullyAutomated(creature("As long as ~ is a token, it isn't legendary.", 'Legendary Creature — Ooze'))).toBe(false);
    expect(fullyAutomated(creature("~ isn't snow if it's a token.", 'Snow Creature — Ooze'))).toBe(false);
  });
  it('render/stat.ts (CR 609.4, 613.1f): "it has K and can attack as though it didn\'t have defender" is one sentence under one condition; two sentences are two abilities', () => {
    expect(fullyAutomated(creature("Defender\nAs long as ~ is monstrous, it has trample and can attack as though it didn't have defender.", 'Creature — Giant'))).toBe(true);
    expect(fullyAutomated(creature("Defender\nAs long as ~ is monstrous, it has trample and can block as though it didn't have defender.", 'Creature — Giant'))).toBe(false);
  });
  it('render/np.ts (CR 115.9b): a plural group of abilities or spells "that target" an object (not "that targets")', () => {
    const f = creature('Activated abilities of Equipment you control that target ~ cost {1} less to activate.');
    expect(JSON.stringify(f.abilities)).not.toContain('that targets');
  });
  it('parser/holes/cond.ts, render/cond.ts (CR 208.1, 608.2h): "you control the creature with the greatest toughness or tied for the greatest toughness" (the power form was already read); mixing the two is not', () => {
    expect(fullyAutomated(creature('At the beginning of your upkeep, draw a card if you control the creature with the greatest toughness or tied for the greatest toughness.'))).toBe(true);
    expect(fullyAutomated(creature('At the beginning of your upkeep, draw a card if you control the creature with the greatest power or tied for the greatest power.'))).toBe(true);
    expect(fullyAutomated(creature('At the beginning of your upkeep, draw a card if you control the creature with the greatest toughness or tied for the greatest power.'))).toBe(false);
  });
});
