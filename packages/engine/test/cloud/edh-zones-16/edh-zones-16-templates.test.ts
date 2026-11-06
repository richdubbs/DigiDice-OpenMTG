/**
 * edh-zones-16 (Commander effort, lane edh-zones): the template data of parser/templates/zz-cloud/edh-zones-16.json and the round's other changes: the chosen kind of a card ("choose
 * land or nonland", "a card of the chosen kind": ChoiceKind/ObjectFilter.chosen `landOrNonland`), the ability-level reading of a replacement of a draw with the sentence after it
 * (parser/lower/ability.ts, lower/static-anaphora.ts#resolveInsteadReveal), the Player hole `ObjPlayer`, "X can't be greater than ..." on a spell (front/spellforms.ts, a static
 * additionalCost with `xMax`), "the number of players in the game", the join of the search and put sentences of Winds of Abandon (lower/ability.ts#joinControllersSearchPut) and the
 * renderer's wordings (render/stat.ts, steps-cards.ts, fold.ts, fold-edhzones16.ts, qty.ts). Guard G9 and G2 as the earlier rounds run them; examples are synthetic (design 6.10).
 * The behavior is in edh-zones-16-scenarios.test.ts. CR cites checked against the 2026-09-25 text.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhZones16 from '../../../src/parser/templates/zz-cloud/edh-zones-16.json';
import review from '../../m5/golden/cards/edh-zones-16-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EZ16 = edhZones16 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: an Aura for an "Enchant" line, a creature for a permanent's line (a trigger, "this creature"), else a sorcery. */
const typeOf = (text: string): string => (/^(Flying\n)?If you would draw/m.test(text) ? 'Enchantment' : /^Enchant /m.test(text) ? 'Enchantment — Aura' : /^Whenever|^When|^At the beginning|this creature|^\{/mi.test(text) ? 'Creature — Beast' : 'Sorcery');
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

const IDS = EZ16.map((t) => t.id);
/** The two templates that read the X of the spell's own mana cost: their examples need a card with {X} in its cost (below, with `compiledX`). */
const XT: ReadonlySet<string> = new Set(['sta.edhz16.xMax.spell', 'eff.edhz16.revealUntil.x.spellX']);
const compiledX = (text: string) => compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: '{X}{G}', type_line: 'Sorcery', oracle_text: text, colors: ['G'] } as OracleCard);

describe('edh-zones-16 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-zones-16.json, after zz-cloud/edh-zones-1.json, before zz-cloud/edh-zones-2.json: path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-zones-16.json');
    expect(files.indexOf('zz-cloud/edh-zones-16.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-zones-1.json')); // path order
    expect(files.indexOf('zz-cloud/edh-zones-16.json')).toBeLessThan(files.indexOf('zz-cloud/edh-zones-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(IDS.length).toBe(7);
    for (const t of EZ16) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep)\.edhz16\./);
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
    // narrow wordings (one or two cards of the index print them as a whole line), stable on one hand-verified golden card plus these tests and the scenarios: a 6.9 deviation named in the round record
    expect(goldenUsing('eff.edhz16.choose.landOrNonland')).toEqual(['Abundant Harvest']);
    expect(goldenUsing('rep.edhz16.draw.mayInstead.chooseKind.revealUntil')).toEqual(['Abundance']);
    expect(goldenUsing('eff.edhz16.objPlayer.revealUntil')).toEqual(['Wild Magic Surge']);
    expect(goldenUsing('eff.edhz16.player.putThat.battlefield.rest.bottomRandom')).toEqual(['Wild Magic Surge']);
    expect(goldenUsing('sta.edhz16.xMax.spell')).toEqual(['Open the Way']);
    expect(goldenUsing('eff.edhz16.revealUntil.x.spellX')).toEqual(['Open the Way']);
    expect(goldenUsing('eff.edhz16.forEach.controllerSearchesBasic.thenPutTapped')).toEqual(['Winds of Abandon']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EZ16) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'any number']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
      if (words.includes('up') && words[words.indexOf('up') + 1] === 'to') expect(t.consumes ?? [], `${t.id}: up to`).toContain('up to');
    }
  });
});

describe('edh-zones-16 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EZ16.filter((x) => !XT.has(x.id))) {
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
    [/\bgraveyard\b/, 'exile'], [/\bany number\b/, 'up to two'], [/\bon the bottom\b/, 'on top'], [/\bonto the battlefield\b/, 'into your hand'], [/\bhand\b/, 'graveyard'],
    [/\bunder your control\b/, 'under their control'], [/\bone of\b/, 'two of'], [/\brevealed cards\b/, 'revealed card'], [/\bexile\b/, 'destroy'], [/\bexactly\b/, 'up to'],
    [/\bdifferent names\b/, 'the same name'], [/\bnonland\b/, 'land'], [/\bcard type\b/, 'color'], [/\btapped and attacking\b/, 'tapped'], [/\bshuffles\b/, 'draws'], [/\bthe bottom\b/, 'the top'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-zones-16 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EZ16.filter((x) => !XT.has(x.id))) {
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

describe('edh-zones-16 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EZ16.filter((x) => !XT.has(x.id))) {
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
    });
  }
});


const index = localIndex();

describe.skipIf(index === null)('edh-zones-16 design 6.10 (local index): synthetic examples', () => {
  it('no edh-zones-16 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EZ16.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});


describe('edh-zones-16 the chosen kind, the X cap and the players of a count (CR 205.2a, 607.2d, 107.3, 601.2b, 102.1)', () => {
  const harvest = (kind: string, rest = 'Put that card into your hand and the rest on the bottom of your library in a random order.'): string => `Choose land or nonland. Reveal cards from the top of your library until you reveal ${kind}. ${rest}`;
  it('"a card of the chosen kind" is the filter field chosen with the quality landOrNonland and the link of the earlier choice', () => {
    expect(level('Sorcery', harvest('a card of the chosen kind'))).toBe('full');
    expect(json('Sorcery', harvest('a card of the chosen kind'))).toContain('"quality":"landOrNonland"');
    expect(json('Sorcery', harvest('a card of the chosen kind'))).toContain('"what":"landOrNonland"');
  });
  it('near misses: no earlier choice, a choice of another kind, or a different kind word is not this reading', () => {
    expect(level('Sorcery', 'Reveal cards from the top of your library until you reveal a card of the chosen kind. Put that card into your hand and the rest on the bottom of your library in a random order.')).not.toBe('full');
    expect(level('Sorcery', 'Choose a color. Reveal cards from the top of your library until you reveal a card of the chosen kind. Put that card into your hand and the rest on the bottom of your library in a random order.')).not.toBe('full');
    expect(level('Sorcery', harvest('a card of the chosen sort'))).not.toBe('full');
  });
  it('"X can\'t be greater than ..." is a static additional cost with no cost and the largest X; it is not a spell effect', () => {
    const text = "X can't be greater than the number of players in the game.\nCreate X 1/1 white Spirit creature tokens.";
    expect(compiledX(text).automation.level).toBe('full');
    const abilities = (JSON.parse(JSON.stringify(compiledX(text).faces)) as { abilities: { kind: string; zone?: string[]; effects?: { s: string; cost: object; xMax?: unknown }[] }[] }[])[0]!.abilities;
    expect(abilities[0]).toMatchObject({ kind: 'static', zone: ['stack'], effects: [{ s: 'additionalCost', cost: {}, xMax: { q: 'countPlayers', of: { ref: 'each', who: 'player' } } }] });
    expect(abilities[1]!.kind).toBe('spell');
    expect(compiledX("Y can't be greater than the number of players in the game.\nCreate Y 1/1 white Spirit creature tokens.").automation.level).not.toBe('full');
  });
  it('"the number of players in the game" is every player: the same JSON as "the number of players"', () => {
    const t = (q: string): string => `You gain life equal to the number of ${q}.`;
    expect(level('Sorcery', t('players in the game'))).toBe('full');
    expect(json('Sorcery', t('players in the game'))).toContain('"q":"countPlayers"');
    expect(json('Sorcery', t('players in the game'))).toContain('"of":{"ref":"each","who":"player"}');
    expect(level('Sorcery', t('players in the graveyard'))).not.toBe('full');
    expect(json('Sorcery', t('opponents you have'))).not.toContain('"who":"player"');
  });
});

describe('edh-zones-16 the player hole ObjPlayer (parser/holes/player.ts) names one player an object names, never a group', () => {
  const surge = (who: string): string => `Destroy target creature. ${who} reveals cards from the top of their library until they reveal a creature card. They put that card onto the battlefield and the rest on the bottom of their library in a random order.`;
  it('"its controller" and "that creature\'s owner" are read; "each opponent" and "target opponent" are not', () => {
    expect(level('Sorcery', surge('Its controller'))).toBe('full');
    expect(level('Sorcery', surge('Its controller').replace('Destroy', 'Exile').replace('Its controller', 'Its owner'))).toBe('full');
    expect(level('Sorcery', surge('Each opponent'))).not.toBe('full');
    // edh-next-40: "Target opponent" (a target announced beside the destroyed creature, a player named by the ability) is now read (render/steps-cards.ts#revealUntil); a group still is not
    expect(level('Sorcery', surge('Target opponent'))).toBe('full');
  });
  it('"They put that card" after another player\'s reveal puts it under THAT player\'s control; after a reveal of your own it is not read', () => {
    expect(json('Sorcery', surge('Its controller'))).toContain('"to":{"zone":"battlefield","controller":{"ref":"controllerOf","object":{"ref":"target","id":"t0"}}}');
    expect(level('Sorcery', 'Reveal cards from the top of your library until you reveal a creature card. They put that card onto the battlefield and the rest on the bottom of their library in a random order.')).not.toBe('full');
  });
});

describe('edh-zones-16 "Destroy target permanent ... that card": the destroyed permanent is no antecedent of "that card" once a reveal stopped at one (parser/lower/anaphora.ts)', () => {
  it('the card the reveal stopped at is "that card"', () => {
    expect(level('Sorcery', 'Destroy target creature. Its controller reveals cards from the top of their library until they reveal a creature card. They put that card onto the battlefield and the rest on the bottom of their library in a random order.')).toBe('full');
  });
});

describe('edh-zones-16 the join of the search and the put sentences of a for-each-this-way search (lower/ability.ts#joinControllersSearchPut; CR 701.23a, 608.2f)', () => {
  const winds = (second: string): string => `Exile target creature you don't control. For each creature exiled this way, its controller searches their library for a basic land card. ${second}`;
  it('"Those players put those cards onto the battlefield tapped, then shuffle." is read with it: one program of three steps after the exile', () => {
    expect(level('Sorcery', winds('Those players put those cards onto the battlefield tapped, then shuffle.'))).toBe('full');
    const steps = (JSON.parse(json('Sorcery', winds('Those players put those cards onto the battlefield tapped, then shuffle.'))) as { abilities: { effect: { steps: { op: string }[] } }[] }[])[0]!.abilities[0]!.effect.steps;
    expect(steps.map((x) => x.op)).toEqual(['move', 'forEach', 'move', 'forEach']);
  });
  it('near misses: another second sentence is not joined', () => {
    expect(level('Sorcery', winds('Those players put those cards onto the battlefield, then shuffle.'))).not.toBe('full');
    expect(level('Sorcery', winds('Those players put those cards into their hand, then shuffle.'))).not.toBe('full');
  });
});


describe('edh-zones-16 the two templates that read the X of the spell (guard G9 and G2 with a card that has {X} in its cost)', () => {
  for (const id of XT) {
    const t = EZ16.find((x) => x.id === id)!;
    it(`${id}: every example is automated with it, passes the render gate; a counter-example or a swapped word does not give the same JSON; an invented word leaves the card not understood`, () => {
      const first = compiledX(t.examples[0]!.text);
      for (const e of t.examples) {
        const c = compiledX(e.text);
        expect(c.automation.level, e.text).toBe('full');
        expect(JSON.stringify(c.faces).includes('"op":"manual"'), e.text).toBe(false);
      }
      for (const x of t.counterExamples) expect(compiledX(x).automation.level === 'full' && JSON.stringify(compiledX(x).faces) === JSON.stringify(first.faces), x).toBe(false);
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^\{/.test(w)) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(compiledX(mutated).automation.level, mutated).not.toBe('full');
        });
      }
    });
  }
  it('"X" in the reveal is the X of the cast: the same JSON as the "where X is" template with the count q:X, and the largest X is the cap\'s', () => {
    const c = compiledX("X can't be greater than the number of players in the game.\nReveal cards from the top of your library until you reveal X land cards. Put those land cards onto the battlefield tapped and the rest on the bottom of your library in a random order.");
    expect(c.automation.level).toBe('full');
    expect(JSON.stringify(c.faces)).toContain('"count":{"q":"X"}');
    expect(JSON.stringify(c.faces)).toContain('"xMax":{"q":"countPlayers"');
  });
  it('near misses: the cap with another comparison, or the X of a spell with no {X} in its cost, is not understood', () => {
    expect(compiledX("X can't be less than the number of players in the game.\nReveal cards from the top of your library until you reveal X land cards.").automation.level).not.toBe('full');
    expect(level('Sorcery', 'Reveal cards from the top of your library until you reveal X land cards. Put those land cards into your hand and the rest on the bottom of your library in a random order.')).not.toBe('full');
  });
});
