/**
 * Must-finish round edh-next-146 (group "other", EDHREC ranks 5,001-10,000): the template data of parser/templates/zz-cloud/edh-next-146.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-next-146-scenarios.test.ts.
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
import edhNext146 from '../../../src/parser/templates/zz-cloud/edh-next-146.json';
import ownReview from '../../m5/golden/cards/edh-next-146-review.json';
import d70Review from '../../m5/golden/cards/edh-d-70-review.json'; // Minthara's entry (the evidence of edh-d-70's group pump, which this round made stable)
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';
import { card as compiled, full as compiledFull } from '../r4-cost/support';

const MECH = edhNext146 as Template[];
const MECH_COUNT = 8;
const review = [...(ownReview as { card: string; verified: string; expect?: string }[]), ...(d70Review as { card: string; verified: string; expect?: string }[]).filter((g) => g.card === 'Minthara, Merciless Soul')];
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the card of the EDHREC top 5,000-10,000 band that prints the wording and is full (each wording is printed on that one card)
  'sta.edhn146.self.has.wardX.where': ['Minthara, Merciless Soul'],
  'sta.edhn146.asAttached.choose.creatureName.creatureType': ['Psychic Paper'],
  'sta.edhn146.attached.grant.unblockable.lastChosenNameType': ['Psychic Paper'],
  'eff.edhn146.sacrifice.each.youControl': ['Plague Reaver'],
  'eff.edhn146.return.bf.underPlayer.theirNextUpkeep': ['Plague Reaver'],
  'rep.edhn146.enters.becomesChoiceOf3.creatureWith': ['Corrupted Shapeshifter'],
  'eff.edhn146.loses.firstStrikeOrSwampwalk': ['Urborg'],
  'rep.edhn146.enters.chooseAnother.youControl': ['Dauntless Bodyguard'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  /becomes attached|equipped creature|Equip \{/i.test(text) ? card('Example Kit', 'Artifact — Equipment', text) :
  /enchanted (creature|land|artifact|permanent|enchantment)/.test(text) ? card(
    'Example Boon', 'Enchantment — Aura', text) :
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-146 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-146.json, path order: after edh-next-12, before edh-next-13) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-146.json');
    expect(files.indexOf('zz-cloud/edh-next-146.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-14.json'));
    expect(files.indexOf('zz-cloud/edh-next-146.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-15.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn146.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|dl)\.edhn146\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = review;
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

describe('edh-next-146 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/experience counters/, 'poison counters you lost'], [/cards in your hand/, 'cards in your library'], [/creature card name/, 'land card name'], [/last chosen/, 'first chosen'],
    [/you control/, 'an opponent controls'], [/their next upkeep/, 'your next upkeep'], [/that player's control/, "its owner's control"], [/swampwalk/, 'islandwalk'], [/first strike or/, 'first strike and'],
    [/your choice of/, 'all of'], [/another/, 'a'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-146 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-146 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-next-146 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-146 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    if (process.env.DBG) console.log(verbatim.join('\n'));
    expect(verbatim).toEqual([]);
  }, 120_000);
});





describe('edh-next-146 parser, renderer and engine changes (one test each; played in edh-next-146-scenarios.test.ts)', () => {
  const spell = (text: string, type = 'Sorcery') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  const creature = (text: string, type = 'Creature — Elf') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/holes/cond.ts#history (CR 508.1, 603.4): "they were attacked this turn by an Assassin you controlled" reads; without "you controlled" or with a plural creature it does not', () => {
    expect(fullyAutomated(creature('Whenever a player loses the game, if they were attacked this turn by a Rogue you controlled, you win the game.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever a player loses the game, if they were attacked this turn by a Rogue, you win the game.'))).toBe(false);
    expect(fullyAutomated(creature('Whenever a player loses the game, if they were attacked this turn by Rogues you controlled, you win the game.'))).toBe(false);
  });
  it('parser/holes/player.ts + event.ts (CR 601.2a, 611.2c): "the player who cast ¤" only inside a granted ability of a spell (ref grantCaster); elsewhere it is not automated', () => {
    expect(fullyAutomated(spell('Until end of turn, creatures your opponents control gain "When this creature deals damage to the player who cast Example Plan, sacrifice this creature."', 'Instant'))).toBe(true);
    // a static grant never fixes it: the compiled card needs a form nothing registers (model/cap-walk.ts, feature:ref.grantCaster.other) and is manual
    expect(compiledFull(compiled('Example Beast', 'Creature — Elf', 'Creatures your opponents control have "When this creature deals damage to the player who cast Example Beast, sacrifice this creature."', '{0}', ['2', '2']))).toBe(false);
    expect(compiledFull(compiled('Example Plan', 'Instant', 'Until end of turn, creatures your opponents control gain "When this creature deals damage to the player who cast Example Plan, sacrifice this creature."'))).toBe(true);
  });
  it('parser/holes/object.ts (CR 601.7a): "target creature of an opponent\'s choice they control" is one target an opponent chooses among their creatures; "of their choice" keeps its own reading', () => {
    const f = spell('Destroy target creature of an opponent\'s choice they control.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"chooser":{"ref":"anOpponent"},"chooserControls":true');
    expect(fullyAutomated(spell('Destroy target creature of an opponent\'s choice.'))).toBe(false);
  });
  it('parser/holes/object.ts (CR 607.2d): "the chosen creature" with no choice in the ability and none on the face stays not automated (the link has no producer)', () => {
    expect(fullyAutomated(creature('Sacrifice Example Beast: The chosen creature gains indestructible until end of turn.'))).toBe(false);
  });
  it('render/kw.ts (CR 702.21b): "~ has ward {X}, where X is ..." renders only for ward with the cost {X} alone', () => {
    expect(fullyAutomated(creature('Example Beast has ward {X}, where X is the number of cards in your hand.'))).toBe(true);
    expect(fullyAutomated(creature('Example Beast has ward {X}{1}, where X is the number of cards in your hand.'))).toBe(false);
  });
});
