/**
 * Must-finish round edh-d-95 (Commander coordinator D, EDHREC band 5,001-10,000, group counters): the template data of parser/templates/zz-cloud/edh-d-95.json (see the file) and the
 * round's parser, lowering, engine and renderer changes, tested at the end of this file and in edh-d-95-scenarios.test.ts.
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
import edhD95 from '../../../src/parser/templates/zz-cloud/edh-d-95.json';
import review from '../../m5/golden/cards/edh-d-95-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD95 as Template[];
const MECH_COUNT = 9;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the card of the EDHREC band 5,001-10,000 that prints the wording and is full (each wording is printed on that one card; opened by the owner's orders of 2026-11-04/05)
  'eff.edhd95.eachPlayer.mayPlayOwnExiledCard': ['Rocco, Street Chef'],
  'eff.edhd95.group.connive': ['Change of Plans'],
  'eff.edhd95.mayHave.anyNumberOfThem.phaseOut': ['Change of Plans'],
  'eff.edhd95.thoseAre.subtypes.inAddition': ['Shilgengar, Sire of Famine'],
  'eff.edhd95.counters.put.onChosen.anyCreature': ["Zimone's Hypothesis"],
  'trg.edhd95.atStepAndWhenEvent': ['Tombstone Stairwell'],
  'eff.edhd95.destroy.tokensCreatedWithSelf': ['Tombstone Stairwell'],
  'rid.edhd95.nextSpell.thatSpellCantBeCountered': ['Savage Summoning'],
  'rid.edhd95.nextSpell.thatCreatureEntersWithAdditionalCounter': ['Savage Summoning'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  /^[+\u2212-]\d+:/.test(text) || /loyalty counter/.test(text) ? card('Example Sage', 'Legendary Planeswalker — Example', text, { loyalty: '4' }) :
  /enchanted (creature|land|artifact|permanent|enchantment)/.test(text) ? card(
    'Example Boon', 'Enchantment — Aura', text) :
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-d-95 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-95.json, path order: after edh-d-9, before edh-mana-keywords-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-95.json');
    expect(files.indexOf('zz-cloud/edh-d-95.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-9.json'));
    expect(files.indexOf('zz-cloud/edh-d-95.json')).toBeLessThan(files.indexOf('zz-cloud/edh-mana-keywords-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhd95.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|dl)\.edhd95\./);
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

describe('edh-d-95 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/play the card/, 'cast the card'], [/connive/, 'explore'], [/phase out/, 'phase in'], [/in addition to their other types/, 'until end of turn'], [/on a creature/, 'on a land'],
    [/leaves the battlefield/, 'enters'], [/destroy all tokens/, 'exile all tokens'], [/can't be countered/, "can't be blocked"], [/additional/, 'second'], [/they exiled/, 'you exiled'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-d-95 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-95 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          // (the kind of a counter is any word, CR 122.1: "a blorfty counter" is a counter of that kind, so the word before "counter(s)" is no nonsense word for this guard)
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return;
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    }, 120_000); // like the other rounds' G2 guards: one parse per word of each example
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-d-95 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-95 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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




describe('edh-d-95 parser, renderer and engine changes (one test each)', () => {
  const spell = (text: string, type = 'Sorcery', cost = '{2}') => parseCard(card('Example Plan', type, text, { mana_cost: cost } as never), OPTS).faces[0]!;
  const creature = (text: string, type = 'Creature — Elf') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const json = (f: ReturnType<typeof spell>): string => JSON.stringify(f.abilities);
  it('parser/lower/anaphora.ts#nestedMadeFocus (CR 608.2c): inside "If you do, create a token and put counters on it" the pronoun is the token; another instruction before it keeps the ambiguity', () => {
    const f = creature('When Example Beast enters, you may discard a card. If you do, create a 1/1 colorless Hero creature token and put two +1/+1 counters on it.');
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f)).toContain('"on":{"ref":"bound","name":"token"}');
    expect(json(creature('When Example Beast enters, you may discard a card. If you do, tap target creature and put two +1/+1 counters on it.'))).not.toContain('"name":"token"');
  });
  it('parser/lower/ability.ts#onePayment + effects/run.ts#limitedAction (CR 603.2h): "Do this only once each turn" after one optional payment of yours with its "if you do" branch; another player\'s payment stays unread', () => {
    expect(JSON.stringify(creature('Whenever you cast a noncreature spell, you may pay 2 life. If you do, draw a card. Do this only once each turn.').abilities)).toContain('"limit":{"per":"turn","max":1,"action":true}');
    expect(fullyAutomated(creature('Whenever an opponent casts a noncreature spell, that player may pay 2 life. If they do, they draw a card. Do this only once each turn.'))).toBe(false);
  });
  it('render/steps.ts (CR 109.5; family imperative-or-you): "you put ..." opens a list of the controller\'s instructions; "you" before a target player\'s instruction is no reading', () => {
    expect(fullyAutomated(creature('Whenever a player casts a spell from exile, you put a +1/+1 counter on target creature and create a Food token.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever a player casts a spell from exile, you target player draws a card.'))).toBe(false);
  });
  it('parser/lower/anaphora.ts#sacrificedCondMention (CR 602.2b, 608.2h): in the branch of "If you sacrificed an Angel this way" the pronoun is the sacrificed creature, as Oracle\'s condition names it', () => {
    const f = creature('Sacrifice another creature: Create a Blood token. If you sacrificed an Angel this way, create a number of Blood tokens equal to its toughness instead.', 'Creature — Demon');
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f)).toContain('"count":{"q":"stat","stat":"toughness","of":{"ref":"costSacrificed"}}');
    expect(json(f)).not.toContain('"name":"token"}}');
  });
  it('parser/holes/qty.ts + render/qty.ts (CR 603.2c, 202.3): "the greatest mana value among those cards" of a batch trigger; "among those creatures" of a single trigger is no reading', () => {
    const f = creature('Whenever one or more cards leave your graveyard, you gain life equal to the greatest mana value among those cards.');
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f)).toContain('"agg":"max"');
    expect(fullyAutomated(creature('Whenever a creature card leaves your graveyard, you gain life equal to the greatest mana value among those cards.'))).toBe(false);
  });
  it('rules/filter.ts + parser/lower/links.ts (CR 208.1, 607.2d): "with power of the chosen quality" reads the earlier "choose odd or even"; with no such choice it stays unread', () => {
    expect(json(spell("Choose odd or even. Return each creature with power of the chosen quality to its owner's hand."))).toContain('"quality":"oddEvenPower"');
    expect(fullyAutomated(spell("Return each creature with power of the chosen quality to its owner's hand."))).toBe(false);
  });
  it('parser/lower/anaphora.ts#itBesideParticiple (CR 608.2c): "it" with a later "the exiled card" still follows the token the sentence before made; "that card" is not that idiom', () => {
    const f = creature("At the beginning of your end step, you may exile target creature card from a graveyard. If you do, create a 1/1 white Spirit creature token with flying. Put a +1/+1 counter on it if the exiled card's mana value is 4 or greater.", 'Enchantment');
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f)).toContain('"on":{"ref":"bound","name":"token"}');
  });
  it('parser/parse.ts#linkCreated (CR 607.2a): "tokens created with ~" links the ONE other ability that creates tokens; with two such abilities the reader stays manual', () => {
    const one = parseCard(card('Example Crypt', 'Enchantment', 'At the beginning of your upkeep, create a 1/1 black Rat creature token.\nAt the beginning of each end step and when Example Crypt leaves the battlefield, destroy all tokens created with Example Crypt.'), OPTS).faces[0]!;
    expect(fullyAutomated(one)).toBe(true);
    expect(JSON.stringify(one.abilities[0])).toContain('"link":"created"');
    const two = parseCard(card('Example Crypt', 'Enchantment', 'At the beginning of your upkeep, create a 1/1 black Rat creature token.\n{T}: Create a Treasure token.\nAt the beginning of each end step, destroy all tokens created with Example Crypt.'), OPTS).faces[0]!;
    expect(fullyAutomated(two)).toBe(false);
  });
  it('effects/handlers/next-spell.ts + core/turn-effects.ts (CR 614.1c, 611.2): rider `enters` only after another rider on the same next creature spell; alone it is not read', () => {
    expect(json(spell('The next creature spell you cast this turn can be cast as though it had flash. That creature enters with an additional +1/+1 counter on it.', 'Instant'))).toContain('"rider":"enters"');
    expect(fullyAutomated(spell('The next creature spell you cast this turn enters with an additional +1/+1 counter on it.', 'Instant'))).toBe(false);
  });
  it('review fixes: "the greatest mana value among cards exiled this way" keeps its one older reading (The Kenriths\' Royal Funeral); a cast trigger\'s later "That creature enters ..." stays the cast-spell reading', () => {
    const f = parseCard(card('Example Rite', 'Legendary Enchantment', 'When Example Rite enters, exile up to two target legendary creatures. You draw X cards and you lose X life, where X is the greatest mana value among cards exiled this way.'), OPTS).faces[0]!;
    expect(f.diagnostics.some((d) => /readings/.test(d.message))).toBe(false);
    expect(fullyAutomated(f)).toBe(true);
    expect(fullyAutomated(creature('Whenever you cast a creature spell, you gain 1 life. That creature enters with an additional +1/+1 counter on it.'))).toBe(true);
  });
});
