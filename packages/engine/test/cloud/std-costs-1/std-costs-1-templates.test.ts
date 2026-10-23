/**
 * std-costs-1 (lane std-costs, additional and X costs): the template data of parser/templates/zz-cloud/std-costs-1.json and the round's other parser, lowering
 * and renderer changes:
 *  - lint (model/lint-nodes.ts#definesX): "you may collect evidence X" defines X (the collector chooses it, effects/handlers/evidence.ts, CR 701.59a, 107.3);
 *  - Cost (parser/holes/cost.ts): "collect evidence X, where X is <Qty>" (CR 701.59a) and "exile one or more other artifacts you control with total mana value X"
 *    (`exileFrom.totalManaValue`, CR 118.3, 107.3a); Qty (parser/holes/qty.ts): "the total mana value of the permanents ~ targets" (`spellTargetTotal`, CR 601.2f);
 *  - lowering: parser/lower/conditions.ts#absorbIntoIf (the sentences acting only on what an if-branch named join it, CR 608.2c), parser/lower/quantities.ts
 *    #fromZoneFits ("exiled from their hand this way" names a move of what an earlier step chose or found in that zone, CR 608.2h), parser/lower/anaphora.ts
 *    #laterOwnEventWindow ("enters or attacks ... Then for each blight counter on it": the object itself, CR 201.5);
 *  - render: render/fold-r4refs.ts ("with that name", family search-same-name-that-name), render/costs.ts and render/qty.ts (the two new quantities, the exact
 *    total), render/stat.ts ("for each permanent sacrificed this way").
 * Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The behavior is in std-costs-1-scenarios.test.ts. CR cites from memory, unverified (rules/cr/
 * is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { exactSubset } from '../../../src/rules/cost-pick';
import stdCosts1 from '../../../src/parser/templates/zz-cloud/std-costs-1.json';
import review from '../../m5/golden/cards/std-costs-1-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T = stdCosts1 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: a creature for a permanent's line (a trigger), else a sorcery. */
const typeOf = (text: string): string => (/^Whenever|^When|^At the beginning/m.test(text) ? 'Creature — Beast' : 'Sorcery');
const face = (text: string, typeLine?: string) => {
  const type = typeLine ?? typeOf(text);
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string) =>
  compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string): string => compiled(type, text).automation.level;
const json = (type: string, text: string): string => {
  const f = face(text, type);
  expect(understood(f), `${text}: ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
  return JSON.stringify(f.abilities);
};

const IDS = ['eff.stdcosts1.search.playerGraveyardHandLibrary.thatName.exile', 'eff.stdcosts1.forEach.counterOn', 'cm.stdcosts1.additional.sacrificeAny.lessForEach'];

describe('std-costs-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-costs-1.json, after zz-cloud/std-blb.json, before zz-cloud/std-dft.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-costs-1.json');
    expect(files.indexOf('zz-cloud/std-costs-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-blb.json'));
    expect(files.indexOf('zz-cloud/std-costs-1.json')).toBeLessThan(files.indexOf('zz-cloud/std-dft.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(T.map((t) => t.id)).toEqual(IDS);
    for (const t of T) {
      expect(t.id, t.id).toMatch(/^(eff|cm)\.stdcosts1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // narrow wordings, stable on one hand-verified golden card (Standard) plus these tests and the scenarios: a 6.9 deviation named in the round record
    expect(goldenUsing('eff.stdcosts1.search.playerGraveyardHandLibrary.thatName.exile')).toEqual(['Deadly Cover-Up']);
    expect(goldenUsing('eff.stdcosts1.forEach.counterOn')).toEqual(['Rottenmouth Viper']);
    expect(goldenUsing('cm.stdcosts1.additional.sacrificeAny.lessForEach')).toEqual(['Rottenmouth Viper']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'when', 'also', 'whenever', 'look', 'choose']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-costs-1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T) {
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
    [/\bwith that name\b/, 'with that power'], [/\bgraveyard, hand,? and library\b/, 'graveyard and library'], [/\band exile them\b/, 'and put them into your hand'],
    [/\bfor each (\S+) counter on it\b/, 'for each $1 counter on each creature'], [/\bless to cast\b/, 'more to cast'], [/\bsacrificed this way\b/, 'exiled this way'],
    [/\byou may sacrifice\b/, 'sacrifice'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-costs-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T) {
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

describe('std-costs-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of T) {
    it(`${t.id}: replacing any one word of the template's sentence by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        // the template's own sentence (the other sentences of an example are other templates' context)
        const sentences = e.text.split(/(?<=\.) /);
        const at = t.kind === 'static' ? -1 : sentences.findIndex((x) => /^(Then )?(search|Search|for each)\b/.test(x));
        const before = at < 0 ? '' : sentences.slice(0, at).join(' ');
        const after = at < 0 ? '' : sentences.slice(at + 1).join(' ');
        const words = (at < 0 ? e.text : sentences[at]!).split(' ');
        words.forEach((w, i) => {
          if (/^\{/.test(w)) return; // a mana symbol is not a word
          if (words[i + 1] === 'counter') return; // a counter's name is any word (CR 122.1)
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [before, [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' '), after].filter((x) => x !== '').join(' ');
          expect(understood(face(mutated, typeOf(e.text))), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-costs-1 collect evidence X (lint, parser/holes/cost.ts, parser/holes/qty.ts; CR 701.59a, 107.3, 601.2f)', () => {
  it('CR 701.59a, 107.3: "you may collect evidence X" defines the X of the rest of the ability (the collector chooses it)', () => {
    const text = 'Whenever this creature attacks, you may collect evidence X. When you do, this creature gets +X/+0 until end of turn.';
    expect(json('Creature — Beast', text)).toContain('"action":"collectEvidence","who":{"ref":"you"},"n":{"q":"X"}');
    expect(level('Creature — Beast', text)).toBe('full');
    // without the collection there is no X: a bare X in an ability of a card without X stays manual
    expect(level('Creature — Beast', 'Whenever this creature attacks, you gain X life.')).not.toBe('full');
  });
  it('CR 601.2c, 601.2f: "collect evidence X, where X is the total mana value of the permanents ~ targets" is an additional cost of the spell only', () => {
    const text = 'As an additional cost to cast this spell, collect evidence X, where X is the total mana value of the permanents this spell targets.\nExile up to two target artifacts.';
    expect(json('Sorcery', text)).toContain('"arg":{"q":"spellTargetTotal","stat":"manaValue"}');
    expect(level('Sorcery', text)).toBe('full');
    expect(level('Sorcery', 'You gain life equal to the total mana value of the permanents this spell targets.\nExile up to two target artifacts.')).not.toBe('full');
    expect(level('Sorcery', 'As an additional cost to cast this spell, collect evidence X, where X is the number of cards in your hand.\nExile up to two target artifacts.')).not.toBe('full');
  });
});

describe('std-costs-1 exact total mana value (parser/holes/cost.ts, rules/cost-pick.ts; CR 118.3, 107.3a)', () => {
  it('"Exile one or more other artifacts you control with total mana value X" is an exileFrom with that total; "or greater" is not read', () => {
    const text = '{1}, {T}, Exile one or more other artifacts you control with total mana value X: Draw X cards.';
    expect(json('Artifact', text)).toContain('"kind":"exileFrom","zone":"battlefield","count":"any","atLeast":1,"filter":{"other":true,"types":["Artifact"],"controller":"you"},"totalManaValue":{"q":"X"}');
    expect(level('Artifact', text)).toBe('full');
    expect(level('Artifact', '{1}, {T}, Exile one or more other artifacts you control with total mana value X or greater: Draw X cards.')).not.toBe('full');
    expect(level('Artifact', '{1}, {T}, Exile one or more artifacts with total mana value X: Draw X cards.')).not.toBe('full');
  });
  it('CR 118.3: exactSubset finds a set of at least the minimum size with exactly the total', () => {
    expect(exactSubset([1, 1, 4], 2, 1)).toBe(true);
    expect(exactSubset([1, 1, 4], 3, 1)).toBe(false);
    expect(exactSubset([1, 1, 4], 6, 1)).toBe(true);
    expect(exactSubset([0, 3], 0, 1)).toBe(true);
    expect(exactSubset([3], 0, 1)).toBe(false);
  });
});

describe('std-costs-1 lowering (parser/lower/conditions.ts, quantities.ts, anaphora.ts)', () => {
  it('CR 608.2c: the sentences acting only on what the branch of an "if" named join it; one that reads nothing of it stays outside', () => {
    const text = "As an additional cost to cast this spell, you may collect evidence 4.\nIf evidence was collected, exile a card from an opponent's graveyard. Then search its owner's graveyard, hand, and library for any number of cards with that name and exile them. Draw a card.";
    const j = JSON.parse(json('Sorcery', text)) as { effect?: { steps: { op: string; then?: { op: string }[] }[] } }[];
    const steps = j.find((a) => a.effect !== undefined)!.effect!.steps;
    expect(steps.map((s) => s.op)).toEqual(['if', 'draw']);
    expect(steps[0]!.then!.map((s) => s.op)).toEqual(['chooseObjects', 'move', 'search', 'move']);
  });
  it('CR 608.2h, 400.3: "each card exiled from their hand this way" names the exile of what the search found, not of the card chosen from a graveyard', () => {
    const text = "Exile a card from an opponent's graveyard. Then search its owner's graveyard, hand, and library for any number of cards with that name and exile them. That player shuffles, then draws a card for each card exiled from their hand this way.";
    const j = json('Sorcery', text);
    expect(j).toContain('"count":{"q":"resultCount","step":"move","which":{"zone":"hand","isCard":true}}');
    expect(j).toMatch(/"what":\{"ref":"bound","name":"search"\},"to":\{"zone":"exile"\},"as":"move"/);
  });
  it('CR 601.2c, 115.1: "for each <kind> counter on it, ... target ..." is one target per counter: never a repeat of the same target', () => {
    expect(level('Creature — Beast', 'When this creature enters, put two +1/+1 counters on it. Then for each +1/+1 counter on it, tap up to one target creature.')).not.toBe('full');
  });
  it('CR 201.5: after "enters or attacks", a bare "it" of a later instruction is the object itself only when nothing before it introduced an object', () => {
    expect(level('Creature — Beast', 'Whenever this creature enters or attacks, put a +1/+1 counter on it. Then for each +1/+1 counter on it, you gain 1 life.')).toBe('full');
    expect(level('Creature — Beast', 'Whenever this creature enters or attacks, draw a card. Then for each +1/+1 counter on it, you gain 1 life.')).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-costs-1 design 6.10 (local index): synthetic examples', () => {
  it('no std-costs-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = T.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
