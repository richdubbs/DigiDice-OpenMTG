/**
 * edh-zones-14 (Commander effort, lane edh-zones): the template data of parser/templates/zz-cloud/edh-zones-14.json and the round's other changes: "you return ... to your hand"
 * after another player's clause, the Player hole reading "each of those players" (render/steps-util.ts), "exile any number of cards from your hand face down" and "look at
 * the exiled cards and put them on top of your library in any order" (render/fold.ts#chooseThenMove), "an opponent attacks you and/or one or more planeswalkers you control"
 * (parser/holes/event.ts#opponentAttacksYou, parser/lower/scope.ts, render/refs.ts), "there are cards exiled with ~" (parser/holes/cond.ts), "put them into their owner's
 * graveyard ... that much damage" (render/steps-zones.ts, render/steps-life.ts), and the promotion of eff.pcep1.play.obj.dur.anyColor. Guard G9 and G2 as the earlier rounds run
 * them; examples are synthetic (design 6.10). The behavior is in edh-zones-14-scenarios.test.ts. CR cites checked against the 2026-09-25 text.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhZones14 from '../../../src/parser/templates/zz-cloud/edh-zones-14.json';
import review from '../../m5/golden/cards/edh-zones-14-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EZ14 = edhZones14 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on. */
const TYPE: Record<string, string> = {
  'rep.edhz14.opponent.search.topN': 'Creature — Bird',
  'eff.edhz14.you.return.hand': 'Sorcery',
  'eff.edhz14.exile.anyNumber.fromHand.faceDown': 'Artifact',
  'eff.edhz14.lookAt.putTop.anyOrder': 'Sorcery',
  'sta.edhz14.cantCauseSearch.theirController': 'Creature — Bird',
};
const typeOf = (text: string, id?: string): string => (id !== undefined ? (text.startsWith('{') || id === 'eff.edhz14.exile.anyNumber.fromHand.faceDown' && text.startsWith('{') ? 'Artifact' : id === 'eff.edhz14.exile.anyNumber.fromHand.faceDown' ? 'Sorcery' : TYPE[id]!) : 'Sorcery');
const face = (text: string, typeLine: string) =>
  parseCard(card('Example Relic', typeLine, text, typeLine.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string, name = 'Example Relic') =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string, name?: string): string => compiled(type, text, name).automation.level;
const json = (type: string, text: string, name?: string): string => JSON.stringify(compiled(type, text, name).faces);
const strip = (a: string): string => a.replace(/"oracleText":"[^"]*"/g, '').replace(/"text":"[^"]*"/g, '').replace(/"src":\[[^\]]*\]/g, '');
const same = (a: string, b: string): boolean => strip(a) === strip(b);

const IDS = [
  'rep.edhz14.opponent.search.topN', 'eff.edhz14.you.return.hand', 'eff.edhz14.exile.anyNumber.fromHand.faceDown', 'eff.edhz14.lookAt.putTop.anyOrder',
  'sta.edhz14.cantCauseSearch.theirController',
];

describe('edh-zones-14 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-zones-14.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-zones-14.json');
    expect(files.indexOf('zz-cloud/edh-zones-14.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-zones-12.json')); // path order
    expect(files.indexOf('zz-cloud/edh-zones-14.json')).toBeLessThan(files.indexOf('zz-cloud/edh-zones-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(EZ14.map((t) => t.id)).toEqual(IDS);
    for (const t of EZ14) {
      expect(t.id, t.id).toMatch(/^(eff|rep|sta)\.edhz14\./);
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
    expect(goldenUsing('rep.edhz14.opponent.search.topN')).toEqual(['Aven Mindcensor']);
    expect(goldenUsing('eff.edhz14.you.return.hand')).toEqual(['Witch of the Moors']);
    expect(goldenUsing('eff.edhz14.exile.anyNumber.fromHand.faceDown')).toEqual(['Scroll Rack']);
    expect(goldenUsing('eff.edhz14.lookAt.putTop.anyOrder')).toEqual(['Scroll Rack']);
    expect(goldenUsing('sta.edhz14.cantCauseSearch.theirController')).toEqual(['Ashiok, Dream Render']);
    // eff.pcep1.play.obj.dur.anyColor (zz-cloud/pc-exile-play-1.json) was experimental for lack of a tuning-half card; Cunning Rhetoric (EDHREC top 5,000, opened by the owner's request of 2026-10-27) is its evidence
    expect(goldenUsing('eff.pcep1.play.obj.dur.anyColor')).toEqual(['Cunning Rhetoric']);
    expect(TEMPLATE_SET.find((t) => t.id === 'eff.pcep1.play.obj.dur.anyColor')!.status).toBe('stable');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EZ14) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'all']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-zones-14 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EZ14) {
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

describe('edh-zones-14 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EZ14) {
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

describe('edh-zones-14 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EZ14) {
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

describe('edh-zones-14 the Player hole reading "each of those players" (parser/holes/player.ts, render/steps-util.ts#byPlayer; CR 115.1, 608.2c)', () => {
  const t = (second: string): string => `At the beginning of your upkeep, any number of target players each mill two cards. If you're the monarch, ${second} mills ten cards instead.`;
  it('reads as the group of targets named before: the same JSON as "those players each mill"', () => {
    expect(level('Enchantment', t('each of those players'))).toBe('full');
    expect(same(json('Enchantment', t('each of those players')), json('Enchantment', t('those players').replace('mills', 'each mill')))).toBe(true);
  });
  it('near misses: no group named before, a plural verb after "each of", and "each of those opponents" are not this reading', () => {
    expect(level('Enchantment', "At the beginning of your upkeep, target player mills two cards. If you're the monarch, each of those players mills ten cards instead.")).not.toBe('full');
    expect(level('Enchantment', t('each of those players').replace('mills', 'mill'))).not.toBe('full');
    expect(level('Enchantment', t('each of those opponents'))).not.toBe('full');
  });
});

describe('edh-zones-14 "Whenever an opponent attacks you and/or one or more planeswalkers you control" (parser/holes/event.ts#opponentAttacksYou, parser/lower/scope.ts, render/refs.ts; CR 508.1b, 506.3, 603.2c)', () => {
  const t = (trigger: string, effect: string): string => `${trigger}, ${effect}`;
  const T = 'Whenever an opponent attacks you and/or one or more planeswalkers you control';
  it('is one batch trigger of the attacking opponent: "that player" is that opponent (never the player attacked)', () => {
    expect(level('Enchantment', t(T, 'draw a card.'))).toBe('full');
    expect(level('Enchantment', t(T, "exile the top card of that player's library."))).toBe('full');
    const j = json('Enchantment', t(T, "exile the top card of that player's library."));
    expect(j).toContain('"orPlaneswalker":true');
    expect(j).toContain('"defender":"you"');
    expect(j).toContain('"role":"player"');
  });
  it('near misses: only you, a player (not an opponent), or planeswalkers alone are other readings (another JSON or manual)', () => {
    expect(same(json('Enchantment', t('Whenever an opponent attacks you', 'draw a card.')), json('Enchantment', t(T, 'draw a card.')))).toBe(false);
    expect(level('Enchantment', t('Whenever a player attacks you and/or one or more planeswalkers you control', 'draw a card.'))).not.toBe('full');
    // edh-next-115 (Mila, Crafty Companion): "attacks one or more planeswalkers you control" alone IS a reading now (wholeBatch over the planeswalker attack), another JSON than "you and/or planeswalkers"
    expect(same(json('Enchantment', t('Whenever an opponent attacks one or more planeswalkers you control', 'draw a card.')), json('Enchantment', t(T, 'draw a card.')))).toBe(false);
  });
  it('"that player" after "an opponent attacks you" without the planeswalkers is still ambiguous no more: the player attacked is you, so it is the attacker', () => {
    expect(level('Enchantment', t('Whenever an opponent attacks you', "exile the top card of that player's library."))).toBe('full');
  });
});

describe('edh-zones-14 the card is full once eff.pcep1.play.obj.dur.anyColor is stable (zz-cloud/pc-exile-play-1.json; CR 406.1, 611.2a, 609.4)', () => {
  const body = "exile the top card of that player's library. You may play that card for as long as it remains exiled, and you may spend mana as though it were mana of any color to cast it.";
  it('a card using it is full', () => {
    expect(level('Enchantment', `Whenever an opponent attacks you and/or one or more planeswalkers you control, ${body}`)).toBe('full');
  });
  it('near misses: without "for as long as it remains exiled", or for another color rule, it is another reading', () => {
    expect(level('Enchantment', `Whenever an opponent attacks you and/or one or more planeswalkers you control, ${body.replace('as though it were mana of any color', 'as though it were a Plains')}`)).not.toBe('full');
  });
});

describe('edh-zones-14 "there are cards exiled with ~" and "that much damage" (parser/holes/cond.ts, render/cond.ts, render/steps-life.ts; CR 607.2a, 603.4, 608.2h)', () => {
  const prod = 'Whenever ~ becomes tapped, exile the top card of your library face down.';
  const end = (cond: string, tail: string): string => `${prod}\nAt the beginning of your end step, if ${cond}, put them into their owner's graveyard${tail}`;
  it('the condition and the damage are one JSON: a count of the linked exile, then a move and damage by the number moved', () => {
    expect(level('Artifact', end('there are cards exiled with ~', ", then ~ deals that much damage to each opponent."))).toBe('full');
    expect(same(json('Artifact', end('there are cards exiled with ~', '.')), json('Artifact', end('a card is exiled with ~', '.')))).toBe(true);
  });
  it('near misses: no cards and another condition are other readings (a different recipient of the damage is another JSON)', () => {
    expect(same(json('Artifact', end('there are cards exiled with ~', ', then ~ deals that much damage to each creature.')), json('Artifact', end('there are cards exiled with ~', ', then ~ deals that much damage to each opponent.')))).toBe(false);
    expect(level('Artifact', end('no cards are exiled with ~', ", then ~ deals that much damage to each opponent."))).not.toBe('full');
    // "them" is the linked exile only right after an intervening "if" that counts it: after another condition it is an unbound reference
    expect(level('Artifact', `${prod}\nAt the beginning of your end step, if you control a creature, put them into their owner's graveyard.`)).not.toBe('full');
  });
});

describe('edh-zones-14 "they may pay {2}. If they don\'t, ..." after a cast trigger (render/steps-flow.ts, the one opponent who cast the spell; CR 601.2, 608.2d)', () => {
  const t = (they: string, dont: string): string => `Whenever an opponent casts an instant or sorcery spell, ${they} may pay {2}. If ${dont}, you gain 2 life.`;
  it('is the same JSON as "that player may pay {2}. If that player doesn\'t, ..."', () => {
    expect(level('Creature — Wizard', t('they', "they don't"))).toBe('full');
    expect(same(json('Creature — Wizard', t('they', "they don't")), json('Creature — Wizard', t('that player', "that player doesn't")))).toBe(true);
  });
  it('near misses: "you may pay", "an opponent may pay" and "If they do" are other readings', () => {
    expect(level('Creature — Wizard', t('you', "you don't"))).toBe('full');
    expect(same(json('Creature — Wizard', t('you', "you don't")), json('Creature — Wizard', t('they', "they don't")))).toBe(false);
    expect(level('Creature — Wizard', t('they', 'they do'))).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-zones-14 design 6.10 (local index): synthetic examples', () => {
  it('no edh-zones-14 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EZ14.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
