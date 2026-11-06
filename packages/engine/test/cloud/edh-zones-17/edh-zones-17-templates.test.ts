/**
 * edh-zones-17 (Commander effort, lane edh-zones): the template data of parser/templates/zz-cloud/edh-zones-17.json and the round's other changes: "a player was dealt combat damage by
 * a <kind> this turn" (parser/holes/cost-conds.ts, render/cond.ts#damageHistoryPhrase), "you may mill that many cards. If you do, you may put a creature card from among them into
 * your hand" (render/fold.ts#millThenPutFromAmong), "there are fewer than eight cards in your graveyard" (render/cond.ts), "sacrifice any number of other permanents, then draw that many
 * cards" (render/fold.ts#sacrificeAnyThenDraw). Guard G9 and G2 as the earlier rounds run them; examples are synthetic (design 6.10). The behavior is in
 * edh-zones-17-scenarios.test.ts. CR cites checked against the 2026-09-25 text.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhZones17 from '../../../src/parser/templates/zz-cloud/edh-zones-17.json';
import review from '../../m5/golden/cards/edh-zones-17-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EZ17 = edhZones17 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on. */
const TYPE: Record<string, string> = {
  'eff.edhz17.player.adds.anyColor': 'Artifact',
  'eff.edhz17.put.self.ownersLibrary.nthFromTop': 'Creature — Zombie God',
  'eff.edhz17.choose.cardInYourGraveyard': 'Sorcery',
};
const typeOf = (_text: string, id?: string): string => (id !== undefined ? TYPE[id] ?? 'Sorcery' : 'Sorcery');
const face = (text: string, typeLine: string) =>
  parseCard(card('Example Relic', typeLine, text, typeLine.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string, name = 'Example Relic') =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string, name?: string): string => compiled(type, text, name).automation.level;
const json = (type: string, text: string, name?: string): string => JSON.stringify(compiled(type, text, name).faces);
const strip = (a: string): string => a.replace(/"oracleText":"[^"]*"/g, '').replace(/"text":"[^"]*"/g, '').replace(/"src":\[[^\]]*\]/g, '');
const same = (a: string, b: string): boolean => strip(a) === strip(b);

const IDS = ['eff.edhz17.player.adds.anyColor', 'eff.edhz17.put.self.ownersLibrary.nthFromTop', 'eff.edhz17.choose.cardInYourGraveyard'];

describe('edh-zones-17 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-zones-17.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-zones-17.json');
    expect(files.indexOf('zz-cloud/edh-zones-17.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-zones-14.json')); // path order
    expect(files.indexOf('zz-cloud/edh-zones-17.json')).toBeLessThan(files.indexOf('zz-cloud/edh-zones-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(EZ17.map((t) => t.id)).toEqual(IDS);
    for (const t of EZ17) {
      expect(t.id, t.id).toMatch(/^(eff|rep|sta)\.edhz17\./);
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
    // narrow wordings (one or two cards of the index print them), stable on one hand-verified golden card plus these tests and the scenarios: a 6.9 deviation named in the round record
    expect(goldenUsing('eff.edhz17.player.adds.anyColor')).toEqual(['The Warring Triad']);
    expect(goldenUsing('eff.edhz17.put.self.ownersLibrary.nthFromTop')).toEqual(['God-Eternal Bontu']);
    expect(goldenUsing('eff.edhz17.choose.cardInYourGraveyard')).toEqual(['Mission Briefing']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EZ17) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'all']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-zones-17 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EZ17) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text, typeOf(t.examples[0]!.text, t.id));
      for (const e of t.examples) {
        const f = face(e.text, typeOf(e.text, t.id));
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        expect(fullyAutomated(f), e.text).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = face(c, typeOf(t.examples[0]!.text, t.id));
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
    [/\bgraveyard\b/, 'library'], [/\bgraveyard\b/, 'hand'], [/\bto your hand\b/, 'to your graveyard'], [/\bon top\b/, 'on the bottom'], [/\bany number\b/, 'one'], [/\bface down\b/, 'face up'],
    [/\bthe top\b/, 'the bottom'], [/\bopponent\b/, 'player'], [/\bsearch\b/, 'draw'], [/\bfrom your hand\b/, 'from your graveyard'], [/\bbottom\b/, 'top'], [/\bowner\b/, 'controller'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-zones-17 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EZ17) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(e.text, typeOf(e.text, t.id));
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(m, typeOf(e.text, t.id));
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('edh-zones-17 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EZ17) {
    it(`${t.id}: replacing any one word of the template's sentence by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^\{/.test(w)) return; // a mana symbol is not a word
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any name (CR 122.1)
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(understood(face(mutated, typeOf(e.text, t.id))), mutated).toBe(false);
        });
      }
    }, 240_000); // one parse per word of every example
  }
});


describe('edh-zones-17 "a player was dealt combat damage by a <kind> this turn" (parser/holes/cost-conds.ts, render/cond.ts#damageHistoryPhrase; CR 510.2, 120.1, 603.4)', () => {
  const t = (cond: string): string => `At the beginning of your second main phase, if ${cond}, draw a card.`;
  it('is a combat damage event to any player whose source matched the description as it dealt the damage', () => {
    expect(level('Creature — Zombie', t('a player was dealt combat damage by a Zombie this turn'))).toBe('full');
    const j = json('Creature — Zombie', t('a player was dealt combat damage by a Zombie this turn'));
    expect(j).toContain('"recipient":{"player":"any"}');
    expect(j).toContain('"source":{"subtypes":["Zombie"]}');
    expect(j).toContain('"combat":true');
  });
  it('an opponent alone (the earlier reading) stays another JSON', () => {
    expect(same(json('Creature — Zombie', t('a player was dealt combat damage by a Zombie this turn')), json('Creature — Zombie', t('an opponent was dealt combat damage by a Zombie this turn')))).toBe(false);
    expect(level('Creature — Zombie', t('an opponent was dealt combat damage by a Zombie this turn'))).toBe('full');
  });
  it('near misses: no source, noncombat damage, a described controller or zone, and two sources are not this reading', () => {
    expect(level('Creature — Zombie', t('a player was dealt combat damage this turn'))).not.toBe('full');
    expect(level('Creature — Zombie', t('a player was dealt noncombat damage by a Zombie this turn'))).not.toBe('full');
    expect(level('Creature — Zombie', t('a player was dealt combat damage by a Zombie card in a graveyard this turn'))).not.toBe('full');
    expect(level('Creature — Zombie', t('each player was dealt combat damage by a Zombie this turn'))).not.toBe('full');
  });
});

describe('edh-zones-17 "you may mill that many cards. If you do, you may put a creature card from among them into your hand" (render/fold.ts#millThenPutFromAmong; CR 701.17a, 608.2c, 400.3)', () => {
  const t = (second: string, first = 'you may mill that many cards'): string => `Whenever ~ deals combat damage to a player, ${first}. If you do, ${second}.`;
  const put = 'you may put a creature card from among them into your hand';
  it('is the optional mill, then an `if` on whether it was done, holding the choice and the move of the milled cards', () => {
    expect(level('Creature — Goat', t(put))).toBe('full');
    const j = json('Creature — Goat', t(put));
    expect(j).toContain('"op":"may"');
    expect(j).toContain('"op":"if"');
    expect(j).toContain('"op":"chooseObjects"');
    expect(same(j, json('Creature — Goat', t('you may put a creature card from among those cards into your hand')))).toBe(true);
  });
  it('near misses: a pick that is not optional, a pick for another zone and an unconditional mill are other readings (or manual)', () => {
    expect(level('Creature — Goat', t('put a creature card from among them into your hand'))).not.toBe('full');
    expect(level('Creature — Goat', t('you may put a creature card from among them into your graveyard'))).not.toBe('full');
    expect(level('Creature — Goat', t('you may put a creature card from among them onto the battlefield'))).not.toBe('full');
    expect(level('Creature — Goat', t('you may put two creature cards from among them into your hand'))).not.toBe('full');
    expect(same(json('Creature — Goat', t(put)), json('Creature — Goat', `Whenever ~ deals combat damage to a player, mill that many cards. You may put a creature card from among them into your hand.`))).toBe(false);
  });
});

describe('edh-zones-17 "there are fewer than eight cards in your graveyard" (render/cond.ts; CR 404.1, 604.1)', () => {
  const t = (cond: string): string => `As long as ${cond}, ~ isn't a creature.`;
  it('is the count of the cards in your graveyard below the number', () => {
    expect(level('Artifact Creature — God', t('there are fewer than eight cards in your graveyard'))).toBe('full');
    expect(json('Artifact Creature — God', t('there are fewer than eight cards in your graveyard'))).toContain('"op":"<","right":8');
  });
  it('near misses: another number, another graveyard, "or fewer" and "or more" are other conditions', () => {
    expect(same(json('Artifact Creature — God', t('there are fewer than eight cards in your graveyard')), json('Artifact Creature — God', t('there are fewer than seven cards in your graveyard')))).toBe(false);
    expect(same(json('Artifact Creature — God', t('there are fewer than eight cards in your graveyard')), json('Artifact Creature — God', t('there are eight or fewer cards in your graveyard')))).toBe(false);
    expect(level('Artifact Creature — God', t("there are fewer than eight cards in an opponent's graveyard"))).not.toBe('full');
  });
});

describe('edh-zones-17 "sacrifice any number of other permanents, then draw that many cards" (render/fold.ts#sacrificeAnyThenDraw; CR 701.21a, 121.1)', () => {
  const t = (what: string): string => `When ~ enters, sacrifice any number of ${what}, then draw that many cards.`;
  it('is a choice among permanents you control, said with or without "you control" (what you sacrifice is always yours)', () => {
    expect(level('Creature — Goat', t('other permanents'))).toBe('full');
    expect(level('Creature — Goat', t('other permanents you control'))).toBe('full');
    expect(json('Creature — Goat', t('other permanents'))).toContain('"controller":"you"');
  });
  it('near misses: permanents an opponent controls and the draw of one card are other readings (or manual)', () => {
    expect(level('Creature — Goat', t('other permanents an opponent controls'))).not.toBe('full');
    expect(same(json('Creature — Goat', t('other permanents')), json('Creature — Goat', t('permanents')))).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-zones-17 design 6.10 (local index): synthetic examples', () => {
  it('no edh-zones-17 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EZ17.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
