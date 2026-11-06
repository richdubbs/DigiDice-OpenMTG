/**
 * Commander lane edh-next, round edh-next-6 (EDHREC ranks 5,001-6,500, second pass): the template data of parser/templates/zz-cloud/edh-next-6.json ("prevent all combat damage that would be dealt to a
 * group this turn", "each player loses life, discards, sacrifices ...", "return to their owners' hands all ...", "each attacking creature doesn't untap during its controller's next untap step",
 * "whenever you cast a spell during combat", "counter target spell unless its controller discards their hand") and the round's parser, renderer and capability changes, tested at the end of this
 * file and in edh-next-6-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-next-6-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext6 from '../../../src/parser/templates/zz-cloud/edh-next-6.json';
import review6 from '../../m5/golden/cards/edh-next-6-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext6 as Template[];
/** The round's golden entries. */
const review = review6 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 7;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhn6.prevent.combat.to.filter.dur': ['Loyal Unicorn'],
  'eff.edhn6.prevent.combat.durFirst.to.filter': ['Pack Leader'],
  'eff.edhn6.eachPlayer.loseLife.discard.sac.thenSac': ['Smallpox'],
  'eff.edhn6.return.toOwnersHands.first': ['Engulf the Shore'],
  'eff.edhn6.each.untap.next.its': ['Tangle'],
  'trg.edhn6.cast.duringCombat': ['Zuko, Firebending Master'],
  'eff.edhn6.counter.unless.discardHand': ['Perplex'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (_t: Template, text: string) =>
  parseCard(
    /^Enchant(ed)? /.test(text) ? card('Example Plan', 'Enchantment — Aura', text)
      : /^Equipped /.test(text) ? card('Example Plan', 'Artifact — Equipment', text)
        : /^~ enters|^\{/.test(text) ? card('Example Plan', 'Artifact', text)
          : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
            : /^(As long as|Artifact spells|Noncreature spells)/.test(text) ? card('Example Plan', 'Enchantment', text)
              : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-6 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-6.json, path order: after edh-next-3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-6.json');
    expect(files.indexOf('zz-cloud/edh-next-6.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhn6.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm|rst)\.edhn6\./);
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

describe('edh-next-6 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-next-6 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-6 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-next-6 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-6 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-next-6 parser, renderer and capability changes (one test each)', () => {
  it('model/cap-walk.ts: "each <group> doesn\'t untap during its controller\'s next untap step" is allowed for an `each` subject (locked to the objects it picks as the effect begins, effects/handlers/lasting.ts#effectsToStore); a live `union` subject and a "your next untap step" duration for a group are still judged as before', () => {
    const ok = sorcery("Each attacking creature doesn't untap during its controller's next untap step.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"throughNextUntap"');
    expect(JSON.stringify(ok.abilities)).toContain('"ref":"each"');
    expect(fullyAutomated(sorcery("Each attacking creature doesn't untap during its controller's next untap step. Draw a card."))).toBe(true);
    expect(fullyAutomated(sorcery("Each attacking creature doesn't untap during each player's next untap step."))).toBe(false);
  });
  it('render/abil.ts#eventCondition: a trigger that holds during all five steps of the combat phase is said "during combat"; a single step or a turn is not', () => {
    expect(fullyAutomated(creature('Whenever you cast a spell during combat, draw a card.'))).toBe(true);
    expect(JSON.stringify(creature('Whenever you cast a spell during combat, draw a card.').abilities)).toContain('"endCombat"');
    const key = (t: string) => JSON.stringify(creature(t).abilities);
    expect(key('Whenever you cast a spell during the declare blockers step, draw a card.')).not.toBe(key('Whenever you cast a spell during combat, draw a card.'));
    // edh-d-44: the general trigger template trg.edhd44.event.duringCombat (any event, the same five-step condition) now reads an opponent's cast during combat too, which is right (CR 506.1, 603.1)
    expect(fullyAutomated(creature('Whenever an opponent casts a spell during combat, draw a card.'))).toBe(true);
  });
  it('render/costs.ts#costVerbs: a hand discarded by another player is "their hand" ("unless its controller discards their hand"); "discards your hand" is not Oracle wording for another player', () => {
    expect(fullyAutomated(sorcery('Counter target spell unless its controller discards their hand.'))).toBe(true);
    expect(fullyAutomated(sorcery('Counter target spell unless its controller discards your hand.'))).toBe(false);
  });
  it('render/steps-zones.ts (family return-group-destination-first): "Return to their owners\' hands all creatures ..." is the move of the group with the destination first; "to your hand" or a library is not', () => {
    expect(fullyAutomated(sorcery("Return to their owners' hands all creatures with toughness less than or equal to the number of Islands you control."))).toBe(true);
    expect(fullyAutomated(sorcery("Return to their owners' hands target creature."))).toBe(false);
    expect(fullyAutomated(sorcery("Return to their owners' libraries all creatures with toughness 2 or less."))).toBe(false);
  });
});
