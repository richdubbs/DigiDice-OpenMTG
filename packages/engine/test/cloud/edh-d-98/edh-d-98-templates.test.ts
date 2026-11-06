/**
 * Must-finish round edh-d-98 (coordinator D, EDHREC ranks 5,001-10,000, group graveyard-exile-cast): the template data of parser/templates/zz-cloud/edh-d-98.json (see the file) and the
 * round's parser, lowering, engine and renderer changes, tested at the end of this file and in edh-d-98-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. CR cites checked against the Comprehensive Rules of 2026-09-25 (MagicCompRules 20260925.txt).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhD98 from '../../../src/parser/templates/zz-cloud/edh-d-98.json';
import review from '../../m5/golden/cards/edh-d-98-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD98 as Template[];
const MECH_COUNT = 7;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the card of the EDHREC top 10,000 that prints the wording and is full (each wording is printed on that one card)
  'eff.edhd98.player.adds.anyOneColor': ['Bigger on the Inside'],
  'eff.edhd98.nextSpell.they.cascade': ['Bigger on the Inside'],
  'eff.edhd98.linked.returnAll.hand.loseThatMuch': ['Asmodeus the Archfiend'],
  'eff.edhd98.eachPlayer.chooses.destroyAllOther': ['Fall of the First Civilization'],
  'eff.edhd98.shuffleIt.ifCond.battlefieldInstead': ['Yidaro, Wandering Monster'],
  'sta.edhd98.firstDraw.lookTwo.oneGraveyard.otherTop.thenDraw': ['Scion of Halaster'],
  'eff.edhd98.revealUntil.creatures.putAll.bf.shuffleRest.oneSentence': ['Synthetic Destiny'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  /^[+\u2212-]\d+:/.test(text) || /loyalty counter/.test(text) ? card('Example Sage', 'Legendary Planeswalker — Example', text, { loyalty: '4' }) :
  /enchanted (creature|land|artifact|permanent|enchantment)/.test(text) ? card(
    'Example Boon', 'Enchantment — Aura', text) :
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-d-98 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-98.json, path order: after edh-d-9, before edh-mana-keywords-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-98.json');
    expect(files.indexOf('zz-cloud/edh-d-98.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-9.json'));
    expect(files.indexOf('zz-cloud/edh-d-98.json')).toBeLessThan(files.indexOf('zz-cloud/edh-mana-keywords-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhd98.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|dl)\.edhd98\./);
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

describe('edh-d-98 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bany one color\b/, 'any color'], [/\bcascade\b/, 'storm'], [/\bthis turn\b/, 'this game'], [/\blose that much life\b/, 'gain that much life'], [/\bto their owner's hand\b/, "to their owner's graveyard"],
    [/\bDestroy all other\b/, 'Exile all other'], [/\bonto the battlefield from your graveyard instead\b/, 'into your hand from your graveyard instead'], [/\binto your graveyard and the other\b/, 'into your hand and the other'],
    [/\bthe first time\b/, 'each time'], [/\bthen shuffle the rest\b/, 'then put the rest'], [/\bthree\b/, 'four'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-d-98 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-98 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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
    }, 120_000); // like the other rounds' G2 guards: one parse per word of each example
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-d-98 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-98 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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





describe('edh-d-98 parser, renderer and engine changes (one test each)', () => {
  const face = (name: string, type: string, text: string, cost?: string) => parseCard({ ...card(name, type, text), ...(cost !== undefined ? { mana_cost: cost } : {}) } as OracleCard, OPTS).faces[0]!;
  it('parser/lower/ability.ts#xMinLast (CR 107.3, 601.2b): "X can\'t be 0." as the last sentence of a spell sets xMin; anywhere else it is no instruction', () => {
    const f = face('Example Plan', 'Sorcery', "Draw X cards. X can't be 0.", '{X}{U}');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"xMin":1');
    expect(fullyAutomated(face('Example Plan', 'Sorcery', "X can't be 0. Draw X cards.", '{X}{U}'))).toBe(false);
    expect(fullyAutomated(face('Example Plan', 'Sorcery', "Draw two cards. X can't be 0.", '{U}'))).toBe(false); // no X to announce: the lint refuses (bad-var) or nothing reads it
  });
  it('lower/anaphora.ts#movedSourceExcluded (CR 400.7): a damage step after a move of its target to the battlefield names the permanent it became; to another zone it stays manual', () => {
    const f = face('Example Plan', 'Sorcery', 'Put target creature card from a graveyard onto the battlefield under your control. That creature deals damage equal to its power to each other creature.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).not.toContain('"source":{"ref":"target"');
  });
  it('holes/cond.ts (CR 607.2a): "if it shares a card type with the exiled card" reads the linked exile; with no exiling ability on the face it is not automated', () => {
    expect(fullyAutomated(face('Example Warden', 'Creature — Vampire', 'When this creature enters, exile a card from a graveyard.\nWhenever a player casts a spell, if it shares a card type with the exiled card, this creature deals 2 damage to that player.'))).toBe(true);
    expect(fullyAutomated(face('Example Warden', 'Creature — Vampire', 'Whenever a player casts a spell, if it shares a card type with the exiled card, this creature deals 2 damage to that player.'))).toBe(false);
  });
  it('lower/ability.ts#playOrCastEach + model/lint-nodes.ts#perPatternRole (CR 603.4): "it" of "plays a land or casts a spell" per pattern; with another pair of events it stays manual', () => {
    const t = (ev: string) => face('Example Warden', 'Creature — Vampire', `When this creature enters, exile a card from a graveyard.\nWhenever ${ev}, if it shares a card type with the exiled card, this creature deals 2 damage to that player.`);
    expect(fullyAutomated(t('a player plays a land or casts a spell'))).toBe(true);
    expect(fullyAutomated(t('a player casts a spell or activates an ability'))).toBe(false);
  });
  it('holes/cond.ts#history (CR 702.29a): "you\'ve cycled a card named N four or more times this game" is the game history of your cycle actions; "this turn" is not read so', () => {
    const f = face('Example Wanderer', 'Creature — Turtle', "Cycling {2}\nWhen you cycle this card, shuffle it into your library from your graveyard. If you've cycled a card named Example Wanderer four or more times this game, put it onto the battlefield from your graveyard instead.");
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"verb":"cycle"');
    expect(fullyAutomated(face('Example Wanderer', 'Creature — Turtle', "Cycling {2}\nWhen you cycle this card, shuffle it into your library from your graveyard. If you've cycled a card named Example Wanderer four or more times this turn, put it onto the battlefield from your graveyard instead."))).toBe(false);
  });
  it('lower/ability.ts#selfGraveyardTriggerRestriction (CR 603.2, 113.6k, 113.6m): the restriction of the battlefield or the graveyard with a permanent; another restriction stays manual', () => {
    const t = (r: string) => face('Example Giant', 'Creature — Giant', `At the beginning of your upkeep, this creature deals 2 damage to each opponent. This ability triggers only if ${r}.`);
    expect(fullyAutomated(t('this creature is on the battlefield or if this creature is in your graveyard and you control a Giant'))).toBe(true);
    expect(fullyAutomated(t('this creature is in your graveyard and you control a Giant'))).toBe(false);
  });
  it('model/cap-walk.ts (CR 614.1a): "the first time you would draw" is a replacement pattern only (feature:replace.draw.firstEachTurn); the engine lists it', () => {
    expect(ENGINE_CAPABILITIES.has('feature:replace.draw.firstEachTurn')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:spell.xMin')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:ev.draw.firstEachTurn.unsupported')).toBe(false);
  });
  it('parser/lower/normalize.ts#delayCaptures (CR 603.7c): a delayed trigger that counts what an instruction of its ability did captures that step', () => {
    const f = face('Example Plan', 'Instant', 'Exile all creatures you control. At the beginning of the next end step, reveal cards from the top of your library until you reveal that many creature cards, put all creature cards revealed this way onto the battlefield, then shuffle the rest of the revealed cards into your library.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toMatch(/"capture":\["[^"]+"\]/);
  });
});
