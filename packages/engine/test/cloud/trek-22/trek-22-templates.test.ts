/**
 * Lane trek-22 (the last Star Trek cards, coordinator D): the template data of parser/templates/zz-cloud/trek-22.json and what finishes the cards around it:
 *  - "can't be the target of abilities from artifact sources your opponents control" (sta.trek22.obj.cantBeTargeted.abilitiesFromArtifactSourcesByOpponents; Species 8472);
 *  - "return each creature card you own exiled with it to the battlefield" (eff.trek22.linked.returnEachCreature.youOwn.battlefield; S.S. Botany Bay);
 *  - "You may have the chosen creatures fight each other" and "Whenever a creature that fought this way dies this turn, ..." (eff.trek22.mayHave.chosenFightEachOther,
 *    eff.trek22.whenever.fought.dies.thisTurn; T'Pring, Never Parted);
 *  - "{Obj} and {Obj} phase out" (eff.trek22.phaseOut.objAndObj; U.S.S. Defiant, Mirror Migrant);
 *  - the readings that are not templates: the short name "Lieutenant Sulu" (parser/front/selfref.ts), "the life lost this way" after a per-player loss (parser/lower/conditions.ts#eachLosesOwnAmount;
 *    Gul Dukat) and "it" after "enters or attacks" (model/lint-roles.ts#entersOrAttacks; Janice Rand), covered by the whole-card guards below and by trek-22-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON;
 * near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10). The behavior
 * is in trek-22-scenarios.test.ts. CR cites checked against the 2026-09-25 text (fetched in the round) unless the record lists them as unverified.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/trek-22.json';
import review from '../../m5/golden/cards/trek-22-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 5;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** The spell ability of a sorcery. */
const parse = (text: string, type = 'Legendary Creature — Example') => parseCard(card('Example Ooze', type, text), OPTS).faces[0]!;
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`) || g.verified.includes(`${id})`)).map((g) => g.card);

describe('trek-22 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/trek-22.json, in path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/trek-22.json');
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are eff.trek22.* or sta.trek22.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.trek22\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
    }
  });
  it('design 6.9 DEVIATION (named in the round record, accepted by the owner on 2026-10-24 for single-printing Star Trek wordings): each wording is printed on one card, so the template is stable on one hand-verified golden card plus these tests', () => {
    expect(MECH.filter((x) => x.status === 'stable').map((t) => t.id).sort()).toEqual(MECH.map((t) => t.id).sort());
    expect(evidence('sta.trek22.obj.cantBeTargeted.abilitiesFromArtifactSourcesByOpponents')).toEqual(['Species 8472']);
    expect(evidence('eff.trek22.linked.returnEachCreature.youOwn.battlefield')).toEqual(['S.S. Botany Bay']);
    expect(evidence('eff.trek22.mayHave.chosenFightEachOther')).toEqual(["T'Pring, Never Parted"]);
    expect(evidence('eff.trek22.whenever.fought.dies.thisTurn')).toEqual(["T'Pring, Never Parted"]);
    expect(evidence('eff.trek22.phaseOut.objAndObj')).toEqual(['U.S.S. Defiant, Mirror Migrant']);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'same']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('trek-22 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parse(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parse(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parse(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} this turn.`];
  const swaps: [RegExp, string][] = [
    [/artifact sources/, 'creature sources'], [/your opponents control/, 'you control'], [/abilities from/, 'spells from'], [/exiled with it/, 'exiled with target creature'], [/creature card you own/, 'creature card an opponent owns'],
    [/chosen creatures/, 'chosen permanents'], [/fought this way/, 'blocked this way'], [/dies this turn/, 'dies'], [/Whenever a creature that/, 'Whenever a land that'], [/phase out/, 'phase in'], [/it and up to one target/, 'it and up to two target'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('trek-22 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/this turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parse(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parse(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('trek-22 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // a counter kind is any word
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          const f = parse(mutated);
          expect(fullyAutomated(f) && !JSON.stringify(f.abilities).includes('"kind":"manual"'), mutated).toBe(false);
        });
      }
    });
  }
});

describe('trek-22 guard G2 on the whole cards: a nonsense word in any place of the cards own text never leaves them full (a counter kind is any word, so the word before "counter" is not mutated)', () => {
  const CARDS: { name: string; type: string; cost: string; text: string; pt?: [string, string] }[] = [
    { name: "Lieutenant Hikaru Sulu", type: "Legendary Creature — Human Pilot", cost: "{2}{G}", text: "Whenever Lieutenant Sulu becomes tapped, he explores.\n{2}{U}: Target creature can't be blocked this turn.", pt: ["3", "3"] },
    { name: "S.S. Botany Bay", type: "Legendary Artifact — Spacecraft", cost: "{3}", text: "{T}: Each opponent exiles a card from their graveyard. You may exile a card from your graveyard.\nStation\n8+ | Flying\nWhenever S.S. Botany Bay deals combat damage to a player, return each creature card you own exiled with it to the battlefield.", pt: ["3", "5"] },
    { name: "Species 8472", type: "Creature — Insect Beast", cost: "{4}{G}{G}", text: "When this creature enters, you gain life equal to the number of differently named lands you control.\nThis creature can't be blocked by artifact creatures.\nThis creature can't be the target of abilities from artifact sources your opponents control.", pt: ["7", "5"] },
    { name: "U.S.S. Defiant, Mirror Migrant", type: "Legendary Artifact — Spacecraft", cost: "{2}", text: "Flash\nWhen U.S.S. Defiant enters, it and up to one target creature you control phase out.\nStation\n8+ | Flying", pt: ["5", "5"] },
    { name: "Gul Dukat, Colonial Prefect", type: "Legendary Creature — Cardassian Rogue", cost: "{4}{B}{B}{B}", text: "Menace\nAt the beginning of each end step, each opponent loses life equal to the life that player lost this turn. You gain life equal to the life lost this way.", pt: ["6", "6"] },
    { name: "Janice Rand, Essential Aide", type: "Legendary Creature — Human Advisor", cost: "{3}{G}", text: "Whenever a commander you control enters or attacks, put a +1/+1 counter on it, then reveal cards from the top of your library until you reveal a land card. Put that card onto the battlefield tapped and the rest on the bottom of your library in a random order.", pt: ["3", "3"] },
    { name: "T'Pring, Never Parted", type: "Legendary Creature — Vulcan Citizen", cost: "{3}{G}{U}", text: "When T'Pring enters, choose another target creature you control and target creature an opponent controls. You may have the chosen creatures fight each other. Whenever a creature that fought this way dies this turn, you draw a card.", pt: ["3", "3"] },
  ];
  const level = (c: (typeof CARDS)[number], text: string): { level: string; manualPart: boolean } => {
    const def = compileCard({ name: c.name, layout: 'normal', mana_cost: c.cost, type_line: c.type, oracle_text: text, colors: [], ...(c.pt ? { power: c.pt[0], toughness: c.pt[1] } : {}) } as OracleCard);
    return { level: def.automation.level, manualPart: JSON.stringify(def.faces).includes('"kind":"manual"') || JSON.stringify(def.faces).includes('"op":"manual"') };
  };
  for (const c of CARDS) {
    it(`${c.name}: as printed it is full, with no manual part; replacing any one word by an invented word is never full`, () => {
      expect(level(c, c.text)).toEqual({ level: 'full', manualPart: false });
      const words = c.text.split(' ');
      words.forEach((w, i) => {
        if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // a counter kind is any word
        const lead = w.match(/^["\n]+/)?.[0] ?? '';
        const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
        const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
        const r = level(c, mutated);
        expect(r.level === 'full' && !r.manualPart, mutated).toBe(false);
      });
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('trek-22 design 6.10 (local index): synthetic examples', () => {
  it('no line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
