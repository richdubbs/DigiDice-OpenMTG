/**
 * edh-zones-24 (Commander effort, lane edh-zones): the template data of parser/templates/zz-cloud/edh-zones-24.json and the round's other changes: a delayed ability's lead takes the whole
 * "A, then B" chain of its sentence (parser/chart.ts#delayLeadCutShort), the numbers of a delayed ability's earlier instruction ("for each card put into your graveyard this way", parser/lower/quantities.ts
 * #delaySteps), "if any of those cards remain exiled" (render/cond.ts), "That token has / Those tokens have" (render/steps-zones.ts), the last creature card exiled with an object (ObjRef `linked.last`,
 * TypeChange.setFrom), up to N cards from among the milled cards onto the battlefield (render/fold.ts) and the folds of render/fold-edhzones24.ts. Guard G9 and G2 as the earlier rounds run them;
 * examples are synthetic (design 6.10). The behavior is in edh-zones-24-scenarios.test.ts. CR cites checked against the 2026-09-25 text.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhZones24 from '../../../src/parser/templates/zz-cloud/edh-zones-24.json';
import review from '../../m5/golden/cards/edh-zones-24-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EZ24 = edhZones24 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

const IDS = [
  'eff.edhz24.delayEnd.ifRemainExiled',
  'rid.edhz24.token.thoseHave',
  'eff.edhz24.youAndPlayer.eachRevealTop',
  'eff.edhz24.eachLoseLife.otherRevealed',
  'eff.edhz24.eachPutRevealed.hand',
  'sta.edhz24.asLongAs.exiledCreature.hasLastPtTypes',
  'eff.edhz24.milled.upToN.bf',
  'eff.edhz24.bounce.playerChoosesAndReturns',
  'eff.edhz24.shuffle.eachIntoOwnersLibrary',
];
/** The type line an example is printed on. */
const typeOf = (text: string): string => (/^Imprint/.test(text) ? 'Artifact Creature — Shapeshifter' : /^At the beginning/.test(text) ? 'Creature — Human Wizard' : /^Whenever a player/.test(text) ? 'Enchantment' : 'Sorcery');
const face = (text: string, typeLine: string) =>
  parseCard(card('Example Relic', typeLine, text, { ...(typeLine.includes('Creature') ? { power: '2', toughness: '2' } : {}), ...(/\bX\b/.test(text) ? { mana_cost: '{X}' } : {}) }), OPTS).faces[0]!;
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string, name = 'Example Relic', extra: Record<string, unknown> = {}) =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}), ...extra } as OracleCard);
const withX = (text: string): Record<string, unknown> => (/\bX\b/.test(text) ? { mana_cost: '{X}' } : {});
const level = (type: string, text: string, name?: string): string => compiled(type, text, name, withX(text)).automation.level;
const json = (type: string, text: string, name?: string): string => JSON.stringify(compiled(type, text, name, withX(text)).faces);
const strip = (a: string): string => a.replace(/"oracleText":"[^"]*"/g, '').replace(/"text":"[^"]*"/g, '').replace(/"src":\[[^\]]*\]/g, '');
const same = (a: string, b: string): boolean => strip(a) === strip(b);

describe('edh-zones-24 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-zones-24.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-zones-24.json');
    expect(files.indexOf('zz-cloud/edh-zones-24.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-zones-22.json')); // path order
    expect(files.indexOf('zz-cloud/edh-zones-24.json')).toBeLessThan(files.indexOf('zz-cloud/edh-zones-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(EZ24.map((t) => t.id)).toEqual(IDS);
    for (const t of EZ24) {
      expect(t.id, t.id).toMatch(/^(eff|rep|sta|rid)\.edhz24\./);
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
    expect(goldenUsing('eff.edhz24.delayEnd.ifRemainExiled')).toEqual(['Glimpse the Impossible']);
    expect(goldenUsing('rid.edhz24.token.thoseHave')).toEqual(['Glimpse the Impossible']);
    for (const id of ['eff.edhz24.youAndPlayer.eachRevealTop', 'eff.edhz24.eachLoseLife.otherRevealed', 'eff.edhz24.eachPutRevealed.hand']) expect(goldenUsing(id)).toEqual(['Keen Duelist']);
    expect(goldenUsing('sta.edhz24.asLongAs.exiledCreature.hasLastPtTypes')).toEqual(['Duplicant']);
    expect(goldenUsing('eff.edhz24.milled.upToN.bf')).toEqual(['Vorinclex // The Grand Evolution']);
    for (const id of ['eff.edhz24.bounce.playerChoosesAndReturns', 'eff.edhz24.shuffle.eachIntoOwnersLibrary']) expect(goldenUsing(id)).toEqual(['Teferi, Temporal Pilgrim']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EZ24) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'random']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-zones-24 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EZ24) {
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
    [/\bor less\b/, 'or greater'], [/\bmana value\b/, 'power'], [/\bgraveyard\b/, 'hand'], [/\bbottom\b/, 'top'], [/\bthe rest\b/, 'a card'], [/\bone of them\b/, 'two of them'], [/\bat random\b/, 'of your choice'], [/\bplaneswalker\b/, 'creature'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-zones-24 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EZ24) {
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

describe('edh-zones-24 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EZ24) {
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

describe('edh-zones-24 a delayed ability\'s lead takes the whole "A, then B" chain of its sentence (parser/chart.ts#delayLeadCutShort; CR 603.7, 603.7a, 608.2c)', () => {
  const steps = (text: string): string => json('Sorcery', text);
  it('"At the beginning of the next end step, A, then B." is ONE delayed ability with both instructions (it was ambiguous, G5)', () => {
    const text = 'Draw a card. At the beginning of the next end step, draw a card, then discard a card.';
    expect(level('Sorcery', text)).toBe('full');
    const j = steps(text);
    expect(j).toMatch(/"op":"delay".*"do":\[\{"op":"draw".*\},\{"op":"discard"/);
  });
  it('near miss: "and" joins like a comma (still one delayed ability)', () => {
    expect(level('Sorcery', 'Draw a card. At the beginning of the next end step, draw a card and discard a card.')).toBe('full');
    expect(json('Sorcery', 'Draw a card. At the beginning of the next end step, draw a card and discard a card.')).toMatch(/"do":\[\{"op":"draw".*\},\{"op":"discard"/);
  });
});

describe('edh-zones-24 the number of a delayed ability\'s earlier instruction (parser/lower/quantities.ts#delaySteps; CR 603.7, 608.2h)', () => {
  it('"for each card put into your graveyard this way" inside the delayed ability counts the move before it in the same ability', () => {
    expect(level('Sorcery', 'Exile the top three cards of your library. At the beginning of the next end step, put them into your graveyard, then create a 0/1 colorless Eldrazi Spawn creature token for each card put into your graveyard this way.')).toBe('full');
  });
  it('near miss: with no such move in the delayed ability the count has no source (manual)', () => {
    expect(level('Sorcery', 'Exile the top three cards of your library. At the beginning of the next end step, create a 0/1 colorless Eldrazi Spawn creature token for each card put into your graveyard this way.')).not.toBe('full');
  });
});

describe('edh-zones-24 "That token has / Those tokens have" (rid.edhz24.token.thoseHave; CR 111.4, 608.2c)', () => {
  it('gives the abilities to the tokens the sentence before created, also inside a delayed ability', () => {
    expect(level('Sorcery', 'Create two 1/1 colorless Golem artifact creature tokens. Those tokens have "{T}: Add {C}."')).toBe('full');
    expect(level('Sorcery', 'Create a 1/1 colorless Golem artifact creature token. That token has "{T}: Add {C}."')).toBe('full');
  });
  it('near misses: no token before it, a duration and a keyword are not this reading', () => {
    expect(level('Sorcery', 'Draw a card. Those tokens have "{T}: Add {C}."')).not.toBe('full');
    expect(level('Sorcery', 'Create two 1/1 colorless Golem artifact creature tokens. Those tokens have "{T}: Add {C}." until end of turn.')).not.toBe('full');
  });
});

describe('edh-zones-24 the last creature card exiled with an object (ObjRef linked.last, TypeChange.setFrom; CR 607.2a, 613.1d)', () => {
  const dup = (text: string): string => `Imprint — When this creature enters, you may exile target creature an opponent controls.\n${text}`;
  const body = 'As long as a card exiled with this creature is a creature card, this creature has the power, toughness, and creature types of the last creature card exiled with it. It\'s still a Construct.';
  it('is one static ability with the condition and the base power and toughness and creature types of that card', () => {
    expect(level('Artifact Creature — Construct', dup(body))).toBe('full');
    const j = json('Artifact Creature — Construct', dup(body));
    expect(j).toContain('"last":{"types":["Creature"],"isCard":true}');
    expect(j).toContain('"setFrom"');
    expect(j).toContain('"link":"exiled"');
  });
  it('near misses: the first card, a land, and no exiling instruction are not this reading', () => {
    expect(level('Artifact Creature — Construct', dup(body.replace('last', 'first')))).not.toBe('full');
    expect(level('Artifact Creature — Construct', body)).not.toBe('full');
  });
});

describe('edh-zones-24 up to N cards from among the milled cards onto the battlefield (render/fold.ts#millThenPutFromAmong; CR 110.2a, 701.17c)', () => {
  it('is an optional choice among the milled cards, by their milling player, who controls them', () => {
    expect(level('Sorcery', 'Mill eight cards. Put up to three artifact cards from among the milled cards onto the battlefield.')).toBe('full');
  });
  it('near misses: any number, the cards of every player and the hand are not this reading', () => {
    expect(level('Sorcery', 'Mill eight cards. Put any number of artifact cards from among the milled cards onto the battlefield.')).not.toBe('full');
    expect(level('Sorcery', 'Each player mills eight cards. Put up to three artifact cards from among the milled cards onto the battlefield.')).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-zones-24 design 6.10 (local index): synthetic examples', () => {
  it('no edh-zones-24 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EZ24.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
