/**
 * edh-zones-12 (Commander effort, lane edh-zones): the template data of parser/templates/zz-cloud/edh-zones-12.json and the round's other changes: "card that's an instant or sorcery"
 * (parser/holes/filter.ts#thatsCardTypes, render/np.ts), the loop "For each card exiled this way, copy it, and you may cast the copy ..." (render/steps-flow.ts focus, steps-zones.ts
 * cast, parser/lower/normalize.ts lint), "a historic card from among them", the anaphor "if it's a land card" (a token is no card: AnaphorInfo.cardNoun), "put a card exiled with ~
 * into its owner's graveyard", "return each other card exiled with ~ ..." and several readers of the link (parser/parse.ts#linkExiled, lower/targets.ts#couldBeSource), "copy each card
 * exiled with ~" and "cast any number of the copies without paying" (render/fold-edhzones12.ts). Guard G9 and G2 as the earlier rounds run them; examples are synthetic (design 6.10).
 * The behavior is in edh-zones-12-scenarios.test.ts. CR cites from memory, unverified.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhZones12 from '../../../src/parser/templates/zz-cloud/edh-zones-12.json';
import review from '../../m5/golden/cards/edh-zones-12-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EZ12 = edhZones12 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: a creature for a permanent's line (a trigger, "this creature"), else a sorcery. */
const typeOf = (text: string): string => (/^Whenever|^When|^At the beginning|this creature|^\{/m.test(text) ? 'Creature — Beast' : /^Counter target/.test(text) ? 'Instant' : 'Sorcery');
const face = (text: string, typeLine?: string) => {
  const type = typeLine ?? typeOf(text);
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string, name = 'Example Relic') =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string, name?: string): string => compiled(type, text, name).automation.level;
const json = (type: string, text: string, name?: string): string => JSON.stringify(compiled(type, text, name).faces);
const strip = (a: string): string => a.replace(/"oracleText":"[^"]*"/g, '').replace(/"text":"[^"]*"/g, '').replace(/"src":\[[^\]]*\]/g, '');
const same = (a: string, b: string): boolean => strip(a) === strip(b);

const IDS = [
  'eff.edhz12.forEach.thisWay.copyMayCastFree', 'eff.edhz12.dig.reveal.hand.adjCard', 'eff.edhz12.linked.putOne.ownersGraveyard', 'eff.edhz12.linked.returnOthers.graveyard',
  'eff.edhz12.linked.copyToken', 'eff.edhz12.exile.filterCard.atRandom.fromGraveyard', 'eff.edhz12.copy.eachLinked', 'rid.edhz12.mayCastAnyNumberOfCopies.free',
];

describe('edh-zones-12 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-zones-12.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-zones-12.json');
    expect(files.indexOf('zz-cloud/edh-zones-12.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-zones-1.json')); // path order
    expect(files.indexOf('zz-cloud/edh-zones-12.json')).toBeLessThan(files.indexOf('zz-cloud/edh-zones-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(EZ12.map((t) => t.id)).toEqual(IDS);
    for (const t of EZ12) {
      expect(t.id, t.id).toMatch(/^(eff|rid)\.edhz12\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) {
      expect(g.expect, g.card).toBe('full');
      expect(g.verified, g.card).toMatch(/CR \d{3}/);
    }
    // narrow wordings (one or two cards of the index print them), stable on one or two hand-verified golden cards plus these tests and the scenarios: a 6.9 deviation named in the round record
    expect(goldenUsing('eff.edhz12.forEach.thisWay.copyMayCastFree')).toEqual(["Mizzix's Mastery"]);
    expect(goldenUsing('eff.edhz12.dig.reveal.hand.adjCard')).toEqual(['Weatherlight']);
    expect(goldenUsing('eff.edhz12.linked.putOne.ownersGraveyard')).toEqual(['Currency Converter']);
    expect(goldenUsing('eff.edhz12.linked.returnOthers.graveyard')).toEqual(['Mimic Vat']);
    expect(goldenUsing('eff.edhz12.linked.copyToken')).toEqual(['Mimic Vat']);
    expect(goldenUsing('eff.edhz12.exile.filterCard.atRandom.fromGraveyard')).toEqual(['Arcane Bombardment']);
    expect(goldenUsing('eff.edhz12.copy.eachLinked')).toEqual(['Arcane Bombardment']);
    expect(goldenUsing('rid.edhz12.mayCastAnyNumberOfCopies.free')).toEqual(['Arcane Bombardment']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EZ12) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'all']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-zones-12 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EZ12) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        expect(fullyAutomated(f), e.text).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = face(c, typeOf(t.examples[0]!.text));
        expect(understood(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bgraveyard\b/, 'library'], [/\bonto the battlefield\b/, 'into their hand'], [/\bto their owner's hand\b/, 'to your hand'], [/\bunless they\b/, 'if they'], [/\bat random\b/, 'at the top'],
    [/\bfrom their graveyard\b/, 'from their hand'], [/\bto your hand\b/, 'to your graveyard'], [/\ball\b/, 'a'], [/\bon top\b/, 'on the bottom'], [/\band\/or\b/, 'or'], [/\bany number\b/, 'one'], [/\bat random\b/, 'at the top'], [/\bgraveyard\b/, 'hand'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-zones-12 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EZ12) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(m, typeOf(e.text));
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('edh-zones-12 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EZ12) {
    it(`${t.id}: replacing any one word of the template's sentence by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^\{/.test(w)) return; // a mana symbol is not a word
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any name (CR 122.1)
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(understood(face(mutated, typeOf(e.text))), mutated).toBe(false);
        });
      }
    }, 120_000); // one parse per word of every example: over the default 5 s on the combined copy
  }
});




describe('edh-zones-12 "card that\'s an instant or sorcery" (parser/holes/filter.ts#thatsCardTypes, render/np.ts; CR 205.2a, 108.1)', () => {
  const s = (what: string): string => `Exile target ${what} from your graveyard. Copy it. You may cast the copy without paying its mana cost.`;
  it('reads as the card with either type: the same JSON as "instant or sorcery card"', () => {
    expect(level('Sorcery', s("card that's an instant or sorcery"))).toBe('full');
    expect(same(json('Sorcery', s("card that's an instant or sorcery")), json('Sorcery', s('instant or sorcery card')))).toBe(true);
    expect(same(json('Sorcery', s("card that's an artifact, creature, or land")), json('Sorcery', s('artifact, creature, or land card')))).toBe(true);
  });
  it('near misses: "and", one type alone, a subtype, a third word and a creature card with a second type are not this reading', () => {
    for (const w of ["card that's an instant and sorcery", "card that's an instant", "card that's a Goblin or Elf", "card that's an instant or blorfty", "creature card that's an instant or sorcery"]) expect(level('Sorcery', s(w)), w).not.toBe('full');
  });
});

describe('edh-zones-12 the loop "For each card exiled this way, copy it, and you may cast the copy without paying its mana cost." (render/steps-flow.ts, parser/lower/normalize.ts; CR 608.2c, 707.12)', () => {
  const t = (loop: string): string => `Exile target instant card from your graveyard. ${loop}`;
  const LOOP = 'For each card exiled this way, copy it, and you may cast the copy without paying its mana cost.';
  it('is full after an exile of cards, and one JSON: a loop over the exiled cards casting a copy of each', () => {
    expect(level('Sorcery', t(LOOP))).toBe('full');
    const j = json('Sorcery', t(LOOP));
    expect(j).toContain('"op":"forEach"');
    expect(j).toContain('"copyIn":"exile"');
  });
  it('near misses: no earlier exile, the cast of the card itself, a cost and "cast it" are not this reading', () => {
    expect(level('Sorcery', LOOP), 'no earlier exile').not.toBe('full');
    expect(level('Sorcery', t('For each card exiled this way, copy it, and you may cast it without paying its mana cost.'))).not.toBe('full');
    expect(level('Sorcery', t('For each card exiled this way, copy it, and you may cast the copy.'))).not.toBe('full');
    expect(level('Sorcery', t('For each card exiled this way, copy it.'))).not.toBe('full');
    expect(level('Sorcery', 'Destroy target creature. For each creature destroyed this way, copy it, and you may cast the copy without paying its mana cost.')).not.toBe('full');
  });
});

describe('edh-zones-12 "if it\'s a land card" never names a token (AnaphorInfo.cardNoun, parser/lower/anaphora.ts; render/cond.ts nonland card; CR 108.2b)', () => {
  const body = (c1: string, c2: string): string => `{T}: Put a card exiled with ~ into its owner's graveyard. If it's a ${c1}, create a Treasure token. If it's a ${c2}, create a 2/2 black Rogue creature token.`;
  const withExile = (b: string): string => `When ~ enters, exile the top three cards of your library.\n${b}`;
  it('the second condition is about the card, not about the Treasure token the first one made', () => {
    expect(level('Artifact', withExile(body('land card', 'nonland card')))).toBe('full');
  });
  it('near misses: a token as the antecedent (a created token that is no card) and a creature-only second test keep it manual or different', () => {
    expect(level('Artifact', `{T}: Create a Treasure token. If it's a nonland card, create a 2/2 black Rogue creature token.`)).not.toBe('full'); // "it" can only be the token: a token is no card
    expect(level('Artifact', withExile(body('land card', 'nonland creature card')))).not.toBe('full');
  });
});

describe('edh-zones-12 readers of the link that exile for themselves (parser/parse.ts#linkExiled, lower/targets.ts#couldBeSource; CR 607.2a)', () => {
  const VAT = "Whenever a creature you control dies, you may exile that card. If you do, return each other card exiled with ~ to its owner's graveyard.\n{3}, {T}: Create a token that's a copy of a card exiled with ~. It gains haste. Exile it at the beginning of the next end step.";
  it('both abilities are full: the trigger and the activated ability link the one exile of the object', () => {
    expect(level('Artifact', VAT)).toBe('full');
  });
  it('near misses: a second ability that exiles something else, a reader of "the exiled card", or a different "other" keep the old behavior (manual)', () => {
    expect(level('Artifact', `${VAT}\n{1}: Exile target creature.`)).not.toBe('full');
    expect(level('Artifact', VAT.replace('return each other card exiled with ~ to its owner\'s graveyard', 'return each other card exiled with ~ to its owner\'s hand'))).toBeDefined();
    expect(level('Artifact', "{T}: Return each other card exiled with ~ to its owner's graveyard.")).not.toBe('full'); // no earlier sentence names the card "other" is other than
  });
});

describe('edh-zones-12 "You may reveal a historic card from among them and put it into your hand." (eff.edhz12.dig.reveal.hand.adjCard; CR 700.6)', () => {
  const t = (w: string): string => `Look at the top five cards of your library. You may reveal ${w} from among them and put it into your hand. Put the rest on the bottom of your library in a random order.`;
  it('a bare adjective (historic, legendary) is a description of the card; a creature card is the same JSON as before', () => {
    for (const w of ['a historic card', 'a legendary card']) expect(level('Sorcery', t(w)), w).toBe('full');
    expect(level('Sorcery', t('a creature card'))).toBe('full');
  });
  it('near misses: two cards and a mandatory reveal are not this reading; "put it onto the battlefield" is another reading (another JSON)', () => {
    expect(level('Sorcery', t('two historic cards')), 'two').not.toBe('full');
    expect(level('Sorcery', t('a historic card').replace('You may reveal', 'You must reveal'))).not.toBe('full');
    expect(same(json('Sorcery', t('a historic card')), json('Sorcery', t('a historic card').replace('into your hand', 'onto the battlefield')))).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-zones-12 design 6.10 (local index): synthetic examples', () => {
  it('no edh-zones-12 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|spell|card|Saga)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = EZ12.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
