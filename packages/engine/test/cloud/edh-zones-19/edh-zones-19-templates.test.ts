/**
 * edh-zones-19 (Commander effort, lane edh-zones): the template data of parser/templates/zz-cloud/edh-zones-19.json and the round's other changes: "a permanent deals damage to you"
 * (parser/holes/event.ts, `sourcePermanent`), "one or more opponents lose life" (parser/holes/event.ts#opponentsLoseLife), "Do this only once each turn" after one optional cast
 * (parser/lower/ability.ts#onceCastAt), "you activate a ninjutsu ability" (`activate.ability`), a legendary card's two-letter short name (parser/front/selfref.ts), "each permanent you
 * control that's a creature or Vehicle" (parser/holes/filter.ts#thatsTypeOrSubtype, render/np.ts), and "put any number of <cards> with total mana value N or less from among them"
 * (render/fold.ts#putAnyFromGroup). Guard G9 and G2 as the earlier rounds run them; examples are synthetic (design 6.10). The behavior is in edh-zones-19-scenarios.test.ts.
 * CR cites checked against the 2026-09-25 text.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhZones19 from '../../../src/parser/templates/zz-cloud/edh-zones-19.json';
import review from '../../m5/golden/cards/edh-zones-19-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EZ19 = edhZones19 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on. */
const typeOf = (text: string): string => (/^When this creature/.test(text) ? 'Creature — Dragon' : 'Sorcery');
const face = (text: string, typeLine: string) =>
  parseCard(card('Example Relic', typeLine, text, typeLine.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string, name = 'Example Relic', extra: Record<string, unknown> = {}) =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}), ...extra } as OracleCard);
const level = (type: string, text: string, name?: string): string => compiled(type, text, name).automation.level;
const json = (type: string, text: string, name?: string): string => JSON.stringify(compiled(type, text, name).faces);
const strip = (a: string): string => a.replace(/"oracleText":"[^"]*"/g, '').replace(/"text":"[^"]*"/g, '').replace(/"src":\[[^\]]*\]/g, '');
const same = (a: string, b: string): boolean => strip(a) === strip(b);

const IDS = ['eff.edhz19.dig.anyNumber.bf.totalMv'];

describe('edh-zones-19 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-zones-19.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-zones-19.json');
    expect(files.indexOf('zz-cloud/edh-zones-19.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-zones-15.json')); // path order
    expect(files.indexOf('zz-cloud/edh-zones-19.json')).toBeLessThan(files.indexOf('zz-cloud/edh-zones-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(EZ19.map((t) => t.id)).toEqual(IDS);
    for (const t of EZ19) {
      expect(t.id, t.id).toMatch(/^(eff|rep|sta)\.edhz19\./);
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
    // a narrow wording (one card of the index prints it), stable on one hand-verified golden card plus these tests and the scenarios: a 6.9 deviation named in the round record
    expect(goldenUsing('eff.edhz19.dig.anyNumber.bf.totalMv')).toEqual(['Ao, the Dawn Sky']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EZ19) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'all']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-zones-19 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EZ19) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text, typeOf(t.examples[0]!.text));
      for (const e of t.examples) {
        const f = face(e.text, typeOf(e.text));
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
    [/\bany number\b/, 'one'], [/\bor less\b/, 'or greater'], [/\bmana value\b/, 'power'], [/\bartifact\b/, 'land'], [/\bonto the battlefield\b/, 'into your hand'], [/\bbottom\b/, 'top'], [/\bthe rest\b/, 'a card'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-zones-19 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EZ19) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(e.text, typeOf(e.text));
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(m, typeOf(e.text));
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('edh-zones-19 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EZ19) {
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
    }, 600_000); // one parse per word of every example
  }
});

describe('edh-zones-19 "a permanent deals damage to you" (parser/holes/event.ts, triggers/match.ts; CR 109.2, 120.2)', () => {
  const t = (src: string): string => `Whenever ${src} deals damage to you, draw a card.`;
  it('is a damage event from a source that was a permanent (`sourcePermanent`), with the description of the permanent beside it', () => {
    expect(level('Enchantment', t('a permanent'))).toBe('full');
    expect(json('Enchantment', t('a permanent'))).toContain('"sourcePermanent":true');
    expect(level('Enchantment', t('a permanent you control'))).toBe('full');
    expect(json('Enchantment', t('a permanent you control'))).toContain('"sourcePermanent":true');
  });
  it('"a source" (every damage, a spell\'s too) and "a creature" are other JSON', () => {
    expect(same(json('Enchantment', t('a permanent')), json('Enchantment', t('a source')))).toBe(false);
    expect(same(json('Enchantment', t('a permanent')), json('Enchantment', t('a creature')))).toBe(false);
    expect(json('Enchantment', t('a creature'))).not.toContain('sourcePermanent');
  });
  it('near misses: several permanents (one or more) and the permanent itself are not this reading', () => {
    expect(json('Enchantment', 'Whenever one or more permanents deal damage to you, draw a card.')).not.toContain('sourcePermanent');
    expect(json('Artifact', 'Whenever ~ deals damage to you, draw a card.')).not.toContain('sourcePermanent');
  });
});

describe('edh-zones-19 "one or more opponents lose life" (parser/holes/event.ts#opponentsLoseLife; CR 119.3, 603.2c)', () => {
  const t = (who: string, what = 'lose life'): string => `Whenever one or more ${who} ${what}, you gain 1 life.`;
  it('is one trigger for the whole batch of the opponents\' life lost at once, and gained for "gain life"', () => {
    for (const w of ['opponents', 'of your opponents']) {
      expect(level('Creature — Elf', t(w))).toBe('full');
      const j = json('Creature — Elf', t(w));
      expect(j).toContain('"ev":"life","change":"loss","player":"opponent"');
      expect(j).toContain('"wholeBatch":true');
    }
    expect(json('Creature — Elf', t('opponents', 'gain life'))).toContain('"change":"gain"');
  });
  it('near misses: an amount, any player and one opponent are other readings or manual', () => {
    expect(level('Creature — Elf', t('opponents', 'lose 2 or more life'))).not.toBe('full');
    expect(level('Creature — Elf', t('players'))).not.toBe('full');
    expect(same(json('Creature — Elf', t('opponents')), json('Creature — Elf', 'Whenever an opponent loses life, you gain 1 life.'))).toBe(false);
  });
});

describe('edh-zones-19 "Do this only once each turn" after one optional cast (parser/lower/ability.ts#onceCastAt; CR 603.2h)', () => {
  const t = (rest = ''): string => `Whenever you gain life, you may cast target instant or sorcery card from your graveyard. If that spell would be put into your graveyard, exile it instead.${rest}`;
  it('limits the action, not the triggering: `limit.action` on the optional cast', () => {
    expect(level('Creature — Elf', t(' Do this only once each turn.'))).toBe('full');
    expect(json('Creature — Elf', t(' Do this only once each turn.'))).toContain('"limit":{"per":"turn","max":1,"action":true}');
    expect(json('Creature — Elf', t(' This ability triggers only once each turn.'))).not.toContain('"action":true');
  });
  it('near misses: twice and a must-cast are not this reading', () => {
    expect(level('Creature — Elf', t(' Do this only twice each turn.'))).not.toBe('full');
    expect(level('Creature — Elf', 'Whenever you gain life, cast target instant or sorcery card from your graveyard. Do this only once each turn.')).not.toBe('full');
  });
});

describe('edh-zones-19 "you activate a ninjutsu ability" (`activate.ability`; CR 702.49a)', () => {
  const t = (who: string): string => `Whenever ${who} activate${who === 'you' ? '' : 's'} a ninjutsu ability, you gain 1 life.`;
  it('is the activation of a ninjutsu ability of that player', () => {
    expect(level('Creature — Ninja', t('you'))).toBe('full');
    expect(json('Creature — Ninja', t('you'))).toContain('"ev":"activate","player":"you","ability":"ninjutsu"');
    expect(json('Creature — Ninja', t('an opponent'))).toContain('"player":"opponent"');
  });
  it('near misses: another keyword or a plain ability is another JSON', () => {
    expect(same(json('Creature — Ninja', t('you')), json('Creature — Ninja', 'Whenever you activate an exhaust ability, you gain 1 life.'))).toBe(false);
    expect(same(json('Creature — Ninja', t('you')), json('Creature — Ninja', 'Whenever you activate an ability, you gain 1 life.'))).toBe(false);
  });
});

describe('edh-zones-19 a legendary card\'s two-letter short name (parser/front/selfref.ts; CR 201.5c)', () => {
  const dragon = (name: string, text: string) => compiled('Legendary Creature — Dragon Spirit', text, name);
  it('"Ao" and "MJ" are the card where the text names the card by them', () => {
    expect(dragon('Ao, the Test Sky', 'When Ao dies, draw a card.').automation.level).toBe('full');
    expect(dragon('MJ, Test Star', 'Whenever MJ attacks, draw a card.').automation.level).toBe('full');
  });
  it('near misses: a word ("Me"), a letter ("X") and a non-legendary card keep their meaning', () => {
    expect(dragon('Me, the Test Rogue', 'When Me dies, draw a card.').automation.level).not.toBe('full');
    expect(compiled('Creature — Dragon', 'When Ao dies, draw a card.', 'Ao, the Test Sky').automation.level).not.toBe('full');
  });
});

describe('edh-zones-19 "each permanent you control that\'s a creature or Vehicle" (parser/holes/filter.ts#thatsTypeOrSubtype, render/np.ts; CR 205.2a, 205.3)', () => {
  const t = (kinds: string): string => `Put a +1/+1 counter on each permanent you control that's ${kinds}.`;
  it('is the permanents you control that are a card type or a subtype (`anyOf`), the second kind with no article', () => {
    expect(level('Sorcery', t('a creature or Vehicle'))).toBe('full');
    expect(level('Sorcery', t('a creature or a Vehicle'))).toBe('full');
    const j = json('Sorcery', t('a creature or Vehicle'));
    expect(j).toContain('"anyOf":[{"types":["Creature"]},{"subtypes":["Vehicle"]}]');
    expect(jsonKey(face(t('a creature or Vehicle'), 'Sorcery').abilities)).toBe(jsonKey(face('Put a +1/+1 counter on each creature or Vehicle you control.', 'Sorcery').abilities)); // the same filter, key order aside
  });
  it('near misses: "and", two card types alone and two subtypes in another order are other readings or the existing ones', () => {
    expect(level('Sorcery', t('a creature and Vehicle'))).not.toBe('full');
    expect(level('Sorcery', t('a Vehicle or creature'))).not.toBe('full');
    expect(level('Sorcery', t('a creature or planeswalker or Vehicle'))).not.toBe('full');
  });
});

describe('edh-zones-19 "put any number of <cards> with total mana value N or less from among them" (render/fold.ts#putAnyFromGroup; CR 202.3, 608.2d)', () => {
  const t = (what: string): string => `Look at the top five cards of your library. Put any number of ${what} from among them onto the battlefield. Put the rest on the bottom of your library in a random order.`;
  it('is a choice of any number of the cards whose mana values add up to at most N, and the rest on the bottom', () => {
    expect(level('Sorcery', t('creature cards with total mana value 4 or less'))).toBe('full');
    const j = json('Sorcery', t('creature cards with total mana value 4 or less'));
    expect(j).toContain('"groupLimit":{"stat":"manaValue","cmp":{"op":"<=","value":4}}');
  });
  it('near misses: another statistic, "or greater" and a different zone are other readings or manual', () => {
    expect(level('Sorcery', t('creature cards with total power 4 or less'))).not.toBe('full');
    expect(level('Sorcery', t('creature cards with total mana value 4 or greater'))).not.toBe('full');
    expect(same(json('Sorcery', t('creature cards with total mana value 4 or less')), json('Sorcery', t('creature cards with total mana value 5 or less')))).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-zones-19 design 6.10 (local index): synthetic examples', () => {
  it('no edh-zones-19 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EZ19.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
