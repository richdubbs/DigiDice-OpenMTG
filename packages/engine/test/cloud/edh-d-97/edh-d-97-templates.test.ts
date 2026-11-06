/**
 * Commander coordinator D, round edh-d-97 (EDHREC band 5,001-10,000, group graveyard-exile-cast part 2): the template data of parser/templates/zz-cloud/edh-d-97.json (see the file) and the
 * round's parser, lowering, engine and renderer changes, tested at the end of this file and in edh-d-97-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. CR cites checked against the Comprehensive Rules of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhD97 from '../../../src/parser/templates/zz-cloud/edh-d-97.json';
import review from '../../m5/golden/cards/edh-d-97-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD97 as Template[];
const MECH_COUNT = 11;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhd97.cast.obj.dur.colorlessAnyColor': ['Abstruse Appropriation'],
  'eff.edhd97.exile.hand.you': ['Herigast, Erupting Nullkite'],
  'sta.edhd97.spell.cast.has.emerge.manaCost': ['Herigast, Erupting Nullkite'],
  'sta.edhd97.asYouCascade.landTapped': ['Averna, the Chaos Bloom'],
  'eff.edhd97.anyOpponent.mayHaveYouPutIntoGraveyard': ['Sin Prodder'],
  'eff.edhd97.whenIt.putIntoYourGraveyard.thisTurn': ['Saffi Eriksdotter'],
  'rst.edhd97.cantLoseGame': ["Lich's Mastery"],
  'eff.edhd97.forEachLifeLost.exilePermanentOrHandGraveyard': ["Lich's Mastery"],
  'eff.edhd97.creatureCastThisWay.gains': ['Strago and Relm'],
  'sta.edhd97.asLongAsExiledCardHas.equippedHas.sameFor': ['Eater of Virtue'],
  'sta.edhd97.self.castFromExile.ifCastAnother': ['Monk Class'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  text.includes('Equipment') ? card('Example Gear', 'Artifact — Equipment', text) : t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-d-97 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-97.json, path order: after edh-d-9.json, before edh-mana-keywords-1.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-97.json');
    expect(files.indexOf('zz-cloud/edh-d-97.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-9.json'));
    expect(files.indexOf('zz-cloud/edh-d-97.json')).toBeLessThan(files.indexOf('zz-cloud/edh-mana-keywords-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 97; ids are *.edhd97.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rst|ch|rid|cm)\.edhd97\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(97);
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

describe('edh-d-97 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [[/\btwo\b/, 'three'], [/\bhaste\b/, 'flying'], [/\bWalls\b/, 'Wall'], [/\bone\b/, 'two']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-d-97 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

// combined copy: one parse per word of every example, about 32 s alone with every band round's templates in (over the 30 s default)
describe('edh-d-97 guard G2 (design 6.8): a nonsense word never leaves an automated card', { timeout: 300_000 }, () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        // edh-d-97: the words of an ability word or flavor word before an em dash label the line and are no part of the ability (CR 207.2c): an invented word there changes nothing
        const labelEnd = words.findIndex((x) => x === '—');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (labelEnd >= 0 && i <= labelEnd && !words.slice(0, i + 1).some((x) => x.includes('\n'))) return;
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

describe.skipIf(index === null)('edh-d-97 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-97 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-d-97 renderer, lowering and engine changes (one test each)', () => {
  const spell = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  const relic = (text: string) => parseCard(card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('model/lint-nodes.ts (CR 107.3f, 603.3d): a triggered ability that BEGINS with "you may pay {X}" may target with X; a payment after another instruction, or a mandatory one, still may not', () => {
    expect(fullyAutomated(relic('When this creature dies, you may pay {X}. If you do, return another target creature card with mana value X from your graveyard to the battlefield.'))).toBe(true);
    expect(fullyAutomated(relic('When this creature dies, you gain 1 life, then you may pay {X}. If you do, return another target creature card with mana value X from your graveyard to the battlefield.'))).toBe(false);
  });
  it('render/steps-flow.ts (family any-opponent-have-you-put) and render/refs.ts: "any opponent may have you put that card into your graveyard" and "that player", the one who did; "each opponent may" is not this reading', () => {
    expect(fullyAutomated(relic("At the beginning of your end step, reveal the top card of your library. Any opponent may have you put that card into your graveyard. If a player does, this creature deals 1 damage to that player."))).toBe(true);
    expect(fullyAutomated(relic("At the beginning of your end step, reveal the top card of your library. Each opponent may have you put that card into your graveyard. If a player does, this creature deals 1 damage to that player."))).toBe(false);
  });
  it('render/evt.ts (family target-put-into-your-graveyard): a target creature "is put into your graveyard"; "into a graveyard" there is another wording (the dies template)', () => {
    expect(fullyAutomated(relic('{1}, Sacrifice this creature: When target creature is put into your graveyard this turn, draw a card.'))).toBe(true);
    expect(fullyAutomated(relic('{1}, Sacrifice this creature: When target creature is put into an opponent\'s graveyard this turn, draw a card.'))).toBe(false);
  });
  it('render/abil.ts (family exile-cast-another-spell): the card\'s own exile permission "as long as you\'ve cast another spell this turn"; two other spells is not this reading', () => {
    expect(fullyAutomated(relic("You may cast this card from exile as long as you've cast another spell this turn."))).toBe(true);
    expect(fullyAutomated(relic("You may cast this card from exile as long as you've cast two other spells this turn."))).toBe(false);
  });
  it('model/cap-walk.ts#exiledGrantsOnly (CR 611.2b): "for as long as it remains exiled, it has ..." an ability is automated; "it gets +1/+1" for that long still needs feature:remainsExiled.other', () => {
    const level = (text: string) => compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: '{0}', type_line: 'Artifact', oracle_text: text, colors: [], keywords: [] } as unknown as OracleCard).automation.level;
    expect(level('{T}: Exile the top card of your library. For as long as it remains exiled, it has "You may cast this card from exile."')).toBe('full');
    expect(level('{T}: Exile the top card of your library. For as long as it remains exiled, it gets +1/+1.')).not.toBe('full');
  });
  it('render/steps-zones.ts (family exile-your-hand): "exile your hand" is the move of every card in your hand; "exile your library" is not this reading', () => {
    expect(fullyAutomated(spell('Exile your hand, then draw two cards.'))).toBe(true);
    expect(fullyAutomated(spell('Exile your library, then draw two cards.'))).toBe(false);
  });
});
