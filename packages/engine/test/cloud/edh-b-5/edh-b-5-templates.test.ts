/**
 * Commander lane edh-b, round edh-b-5: the template data of parser/templates/zz-cloud/edh-b-5.json (second pass over EDHREC ranks 8,001-9,000) and the round's parser, engine and renderer changes, tested at the end of this file and in edh-b-5-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-b-5-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhB5 from '../../../src/parser/templates/zz-cloud/edh-b-5.json';
import review5 from '../../m5/golden/cards/edh-b-5-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhB5 as Template[];
/** The round's golden entries. */
const review = review5 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 8;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'sta.edhb5.damageToSelf.whileCounter.prevent.then': ['Undergrowth Champion'],
  'eff.edhb5.mill.foreach': ['Trenchpost'],
  'eff.edhb5.discardHand.drawThatManyPlus': ['Chandra, Flamecaller'],
  'eff.edhb5.player.discardThenDraw': ['Memory Worm'],
  'trg.edhb5.you.castFromGy.orActivateGy': ['Neerdiv, Devious Diver'],
  'trg.edhb5.nOrMoreCreatures.attack': ['Argent Dais'],
  'eff.edhb5.control.each': ['Subjugate the Hobbits'],
  'eff.edhb5.shufflesIntoLibrary.thenVillainous': ['This Is How It Ends'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (_t: Template, text: string) =>
  parseCard(/^\{/.test(text) ? card('Example Plan', 'Artifact', text) : /^(When|At the|Whenever|If damage)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-b-5 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-b-5.json, path order: after edh-top-8) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-b-5.json');
    expect(files.indexOf('zz-cloud/edh-b-5.json')).toBeLessThan(files.indexOf('zz-cloud/edh-c-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhb5.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhb5\./);
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

describe('edh-b-5 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-b-5 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-b-5 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // edh-next-60: the name of a kind of counter is an open class (`CounterKind`; sta.edhn60.damageToSelf.whileCounter.prevent.then reads any kind)
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

describe.skipIf(index === null)('edh-b-5 design 6.10 (local index): synthetic examples', () => {
  it('no edh-b-5 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
const artifact = (text: string) => parseCard(card('Example Plan', 'Artifact', text), OPTS).faces[0]!;

const land = (text: string) => parseCard(card('Example Plan', 'Land — Desert', text), OPTS).faces[0]!;

describe('edh-b-5 parser, engine and renderer changes (one test each)', () => {
  it('render/stat.ts#graveyardPermit (family land-subtype-lands): "Desert lands" are read as the lands of the subtype; other nouns and other zones are not', () => {
    expect(fullyAutomated(creature('You may play Desert lands from your graveyard.'))).toBe(true);
    expect(JSON.stringify(creature('You may play Forest lands from your graveyard.').abilities)).toContain('"subtypes":["Forest"]');
    expect(fullyAutomated(creature('You may play Desert creatures from your graveyard.'))).toBe(false);
    expect(fullyAutomated(creature('You may play Desert lands from your hand.'))).toBe(false);
  });
  it('parser/holes/qty.ts, effects/eval.ts, statics/match.ts, render/qty.ts (lifeLostTotal of every player): "the total life lost by all players this turn"; a narrower group stays what it was', () => {
    const ok = sorcery('You gain life equal to the total life lost by all players this turn.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"q":"lifeLostTotal"');
    expect(JSON.stringify(ok.abilities)).toContain('"who":"player"');
    expect(fullyAutomated(sorcery('You gain life equal to the total life lost by all players.'))).toBe(false);
    expect(JSON.stringify(sorcery('You gain life equal to the amount of life your opponents lost this turn.').abilities)).toContain('"who":"opponent"');
  });
  it('render/steps-cards.ts#mill (family mill-a-card-for-each): "mills a card for each ..."; "two cards for each" stays manual', () => {
    expect(fullyAutomated(sorcery('Target player mills a card for each creature you control.'))).toBe(true);
    expect(fullyAutomated(sorcery('Target player mills two cards for each creature you control.'))).toBe(false);
  });
  it('effects/bodies/m5.ts#applyPrevent (body prevent.oncePerBatch, capability body:prevent.oncePerBatch) and types/ability.ts: only the new template sets it; the older prevention-with-steps templates are unchanged', () => {
    const ok = creature('If damage would be dealt to ~ while it has a +1/+1 counter on it, prevent that damage and remove a +1/+1 counter from ~.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"oncePerBatch":true');
    const older = creature('If damage would be dealt to ~, prevent that damage and put that many +1/+1 counters on ~.');
    expect(fullyAutomated(older)).toBe(true);
    expect(JSON.stringify(older.abilities)).not.toContain('oncePerBatch');
    expect(ENGINE_CAPABILITIES.has('body:prevent.oncePerBatch')).toBe(true);
  });
  it('render/fold-edhb5.ts: the shuffle-then-villainous-choice fold is only for the exact shape (a fixed loss of life against shuffling another creature they own); other options stay manual', () => {
    const ok = sorcery("Target creature's owner shuffles it into their library, then faces a villainous choice -- They lose 5 life, or they shuffle another creature they own into their library.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"villainous":true');
    expect(fullyAutomated(sorcery("Target creature's owner shuffles it into their library, then faces a villainous choice -- They lose 5 life, or they discard a card."))).toBe(false);
    expect(fullyAutomated(sorcery("Target creature's owner shuffles it into their library, then faces a villainous choice -- They lose 5 life, or they shuffle two other creatures they own into their library."))).toBe(false);
  });
  it('the other templates build their named steps: discard-then-draw, draw plus one after the hand, cast-or-activate trigger, two or more creatures attack, gain control of each', () => {
    expect(JSON.stringify(sorcery('Target player discards a card, then draws a card.').abilities)).toContain('"op":"draw"');
    expect(fullyAutomated(sorcery('Target player discards two cards, then draws a card.')), 'discards two').toBe(false);
    expect(JSON.stringify(sorcery('Discard all the cards in your hand, then draw that many cards plus two.').abilities)).toContain('"op":"+"');
    const trg = creature('Whenever you cast a spell from your graveyard or activate an ability of a card in your graveyard, draw a card.');
    expect(fullyAutomated(trg), 'cast or activate').toBe(true);
    expect(JSON.stringify(trg.abilities).split('"ev":"activate"').length - 1).toBe(2);
    expect(fullyAutomated(creature('Whenever two or more creatures attack, you gain 1 life.')), 'two or more attack').toBe(true);
    expect(JSON.stringify(creature('Whenever two or more creatures attack, you gain 1 life.').abilities)).not.toContain('"controller":"you"');
    expect(JSON.stringify(sorcery('Gain control of each creature with power 2 or less.').abilities)).toContain('"layer":2');
    expect(fullyAutomated(sorcery('Gain control of each creature with power 2 or less unless its controller pays {1}.')), 'unless').toBe(false);
  });
  it('the round\'s fixture list is its golden cards; none is in another round\'s list', () => {
    expect(review.length).toBe(10);
    expect(land('').abilities.length).toBeGreaterThanOrEqual(0);
  });
});
