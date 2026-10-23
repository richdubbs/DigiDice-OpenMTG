/**
 * Standard round E (std-re, slot E of the parallel rounds): the round adds no template. It changes the renderer (one reading of the reviewed family draw-where-x)
 * and one parser look-ahead, one test each here with its negative case. Every wording is synthetic (design 6.10), checked against the local index when it is
 * present. The behavior is in std-re-scenarios.test.ts.
 *
 *   render/steps-cards.ts, render/steps-util.ts#markX  family draw-where-x: "Draw X cards, where X is the number of cards discarded this way." (a count of what an
 *                                                       earlier instruction moved), and a later amount with the same quantity said again as "X" (CR 107.3, 608.2c, 608.2h)
 *   parser/parse.ts#ENTERS_CHOICE                       "As ~ enters, choose Elemental, Elf, Faerie, Giant, Goblin, Kithkin, Merfolk, or Treefolk." is a creature-type
 *                                                       choice that "the chosen type" of the face's other abilities reads (CR 205.3m, 607.2d)
 *   parser/holes/filter.ts#relClause                    the plural "cards that have an Adventure" (CR 715.1), weak beside r4-cost's fixed cost sentence
 *   zz-cloud/std-re.json, render/fold.ts#castFromLinkedExile  template eff.stdre.cast.fromLinkedExile.owned: "you may cast an Ally spell from among cards you own
 *                                                       exiled with ~" (one paid cast during the resolution of the cards another ability of the object exiled;
 *                                                       CR 608.2g, 601.2, 607.2a, 305.9, 108.3)
 *
 * Two templates are stable on a single golden card each (a 6.9 deviation, named in the round record; each wording is printed on one or two cards of the index):
 * r4-dig's eff.r4dig.milled.putAll.hand, promoted (r4-dig's own test reads the evidence, cloud-r4-dig-review.json: Beluna Grandsquall // Seek Thrills), and this
 * round's eff.stdre.cast.fromLinkedExile.owned (cloud-std-re-review.json: Boiling Rock Rioter). CR cites from memory, unverified (no rules/cr/ in the cloud).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRe from '../../../src/parser/templates/zz-cloud/std-re.json';
import review from '../../m5/golden/cards/cloud-std-re-review.json';
import { renderAbility, renderGate } from '../../../src/index';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2)
const parsed = (c: OracleCard) => parseCard(c, OPTS).faces[0]!;
const json = (c: OracleCard): string => JSON.stringify(parsed(c).abilities);
const full = (c: OracleCard): boolean => fullyAutomated(parsed(c));

const CREATURE = (text: string): OracleCard => card('Test Sage', 'Creature — Dwarf', text, { power: '2', toughness: '2' });
const ENCHANTMENT = (text: string): OracleCard => card('Test Banner', 'Enchantment', text);

/** Every synthetic wording of this file (design 6.10: none is a real Oracle line). */
const WORDINGS: string[] = [];
const w = (text: string): string => { WORDINGS.push(text); return text; };

const MOVED_COUNT = '{"q":"resultCount","step":"discard","which":{"isCard":true}}';

describe('family draw-where-x for a count of what an earlier instruction moved (render/steps-cards.ts; CR 107.3, 608.2c, 608.2h)', () => {
  it('"Draw X cards, where X is the number of cards discarded this way." after "you may discard your hand" draws the discarded count', () => {
    const c = CREATURE(w('When this creature dies, you may discard your hand. Draw X cards, where X is the number of cards discarded this way.'));
    expect(full(c)).toBe(true);
    expect(json(c)).toContain(`{"op":"draw","who":{"ref":"you"},"count":${MOVED_COUNT}}`);
  });
  it('the bare result ("draw that many cards") keeps its own reading, unchanged', () => {
    const c = CREATURE(w('When this creature dies, you may discard your hand. If you do, draw that many cards.'));
    expect(full(c)).toBe(true);
  });
  it('with no earlier instruction that discarded, "the number of cards discarded this way" has no antecedent: not full', () => {
    expect(full(CREATURE(w('When this creature dies, draw X cards, where X is the number of cards discarded this way.')))).toBe(false);
  });
});

describe('family draw-where-x: an amount said once as "X, where X is ..." is "X" again later in the ability (render/steps-util.ts#markX, #saidX; CR 107.3)', () => {
  it('"... Draw X cards, where X is ... You gain X life." gains the same count', () => {
    const c = CREATURE(w('When this creature dies, you may discard your hand. Draw X cards, where X is the number of cards discarded this way. You gain X life.'));
    expect(full(c)).toBe(true);
    expect(json(c)).toContain(`{"op":"gainLife","who":{"ref":"you"},"amount":${MOVED_COUNT}}`);
  });
  it('"X" that no earlier part of the ability defined is not accepted ("you gain X life" with no "where X is")', () => {
    expect(full(CREATURE(w('When this creature dies, you may discard your hand. You gain X life.')))).toBe(false);
  });
});

describe('parser/parse.ts#ENTERS_CHOICE: the eight-type choice is a creature-type choice "the chosen type" reads (CR 205.3m, 607.2d)', () => {
  it('"Creatures you control of the chosen type get +0/+2." links to the choice of the list', () => {
    const c = ENCHANTMENT(w('As this enchantment enters, choose Elemental, Elf, Faerie, Giant, Goblin, Kithkin, Merfolk, or Treefolk.\nCreatures you control of the chosen type get +0/+2.'));
    expect(full(c)).toBe(true);
    expect(json(c)).toContain('"options":["Elemental","Elf","Faerie","Giant","Goblin","Kithkin","Merfolk","Treefolk"]');
    expect(json(c)).toContain('"chosen":{"link":"type","quality":"creatureType"}');
  });
  it('another list of creature types is not this choice: "the chosen type" stays unlinked (not full)', () => {
    expect(full(ENCHANTMENT(w('As this enchantment enters, choose Elf, Goblin, or Merfolk.\nCreatures you control of the chosen type get +0/+2.')))).toBe(false);
  });
});

describe('parser/holes/filter.ts#relClause: the plural "that have an Adventure" (CR 715.1)', () => {
  const SORCERY = (text: string): OracleCard => card('Test Rummage', 'Sorcery', text);
  it('"Then put all cards that have an Adventure from among the milled cards into your hand." puts every milled card with an Adventure, through r4-dig\'s template', () => {
    const c = SORCERY(w('Mill five cards. Then put all cards that have an Adventure from among the milled cards into your hand.'));
    expect(full(c)).toBe(true);
    expect(parsed(c).templatesUsed).toContain('eff.r4dig.milled.putAll.hand');
    expect(json(c)).toContain('"filter":{"anyOf":[{"adventure":true}],"is":{"ref":"bound","name":"them"},"zone":"any"}');
  });
  it('the reading is weak (design 6.3 rule 2): r4-cost\'s fixed "<spells> you cast that have an Adventure cost {1} less to cast" keeps its sentence', () => {
    const c = CREATURE(w('Creature spells you cast that have an Adventure cost {1} less to cast.'));
    expect(full(c)).toBe(true);
    expect(parsed(c).templatesUsed).toContain('eff.cost.spells.withAdventure.less');
  });
  it('the template puts into your hand only: "onto the battlefield" is not this sentence (not full)', () => {
    expect(full(SORCERY(w('Mill five cards. Then put all cards that have an Adventure from among the milled cards onto the battlefield.')))).toBe(false);
  });
});

// ---- the template file zz-cloud/std-re.json ---------------------------------------------------------------------------------------------------------------

const MECH = (stdRe as Template[]).filter((t) => t.id === 'eff.stdre.cast.fromLinkedExile.owned'); // the other std-re templates: std-re-templates.test.ts
const MECH_COUNT = 1;

/** A synthetic card in which an example is an ability of the right kind: a creature with the example's abilities. */
const exampleCard = (text: string): OracleCard => card('Example Brute', 'Creature — Human Ally', text, { power: '3', toughness: '3' });
const parsedWith = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

describe('std-re template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-re.json, after std-r9, before std-sos) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-re.json');
    expect(files.indexOf('zz-cloud/std-re.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-r9.json'));
    expect(files.indexOf('zz-cloud/std-re.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdre.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.stdre\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence, a hand-verified golden card that uses it (the review file pins each card as full)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
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

describe('std-re guard G9 (design 6.8): examples, counter-examples and near misses', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
    it(`${t.id}: an appended "unless/instead/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(e.text);
        const [head, last] = [e.text.slice(0, e.text.lastIndexOf('\n') + 1), e.text.slice(e.text.lastIndexOf('\n') + 1).replace(/\.$/, '')];
        const misses = [' unless it is blue.', ' instead.', ' at random.', ' twice.', ' if able.'].map((x) => `${head}${last}${x}`);
        for (const [re, by] of [[/\byou own\b/, 'your opponents own'], [/\bexiled with\b/, 'put into exile by'], [/\bcast\b/, 'play'], [/\byou may\b/, 'you must']] as const) {
          if (re.test(e.text)) misses.push(e.text.replace(re, by));
        }
        for (const m of misses) {
          const f = parsedWith(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-re guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of the example's sentence by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const cut = e.text.lastIndexOf('\n') + 1;
        const words = e.text.slice(cut).split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || /^\{/.test(w)) return;
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = e.text.slice(0, cut) + [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-re G10 (CR 607.2a): the one formerly automated unit the round changes is the exiling ability the new reader links to', () => {
  const EXILER = '{1}{R}, {T}: Exile target card from a graveyard.';
  const READER = 'Whenever this creature blocks, you may cast an Ally spell from among cards you own exiled with this creature.';
  const ally = (text: string): OracleCard => card('Test Rioter', 'Creature — Human Ally', text, { power: '2', toughness: '2' });
  it('with the reader on the face, the exiling ability is the same JSON plus `link: "exiled"` on its move to exile, and nothing else', () => {
    const alone = parsed(ally(w(EXILER))).abilities[0]!;
    const linked = parsed(ally(`${EXILER}\n${READER}`)).abilities[0]!;
    expect(JSON.stringify(linked)).not.toBe(JSON.stringify(alone));
    expect(JSON.stringify(linked).replace(',"link":"exiled"', '')).toBe(JSON.stringify(alone));
  });
  it('two abilities that exile on the face: the reader links to neither and stays manual (never a guess, CR 607.2a)', () => {
    const f = parsed(ally(w(`${EXILER}\n{1}, {T}: Exile target creature card from your graveyard.\n${READER}`)));
    expect(fullyAutomated(f)).toBe(false);
    expect(JSON.stringify(f.abilities)).not.toContain('"link":"exiled"');
  });
});

describe('std-re renderer (render/fold.ts#castFromLinkedExile; CR 608.2g, 607.2a): the choice and the paid cast say back the Oracle wording, and only it', () => {
  const RCTX = { selfNames: ['Test Card'], selfTypes: ['Creature'] };
  const def = (filter: Record<string, unknown>, free?: true) => ({
    kind: 'triggered', trigger: { on: [{ ev: 'attacks', attacker: { self: true } }] },
    effect: { targets: [], steps: [
      { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter }, min: 0, max: 1, as: 'cast' },
      { op: 'cast', who: { ref: 'you' }, what: { ref: 'bound', name: 'cast' }, ...(free ? { free } : {}) },
    ] },
  }) as never;
  const linked = { anyOf: [{ subtypes: ['Ally'] }], notTypes: ['Land'], is: { ref: 'linked', link: 'exiled' }, zone: 'any', owner: 'you' };
  const oracle = 'Whenever Test Card attacks, you may cast an Ally spell from among cards you own exiled with Test Card.';
  it('the owned form', () => {
    expect(renderAbility(def(linked), RCTX).join(' ')).toBe(oracle);
    expect(renderGate(def(linked), [oracle], RCTX).ok).toBe(true);
  });
  it('a free cast, a group that is not the linked one, or another player as owner is not this wording', () => {
    expect(renderGate(def(linked, true), [oracle], RCTX).ok).toBe(false);
    expect(renderGate(def({ ...linked, is: { ref: 'bound', name: 'them' } }), [oracle], RCTX).ok).toBe(false);
    expect(renderGate(def({ ...linked, owner: 'opponent' }), [oracle], RCTX).ok).toBe(false);
  });
});

describe('design 6.10: the wordings of this file are synthetic', () => {
  it('none is a line of a real card (local index, when present)', () => {
    const idx = localIndex();
    if (idx === null) return;
    const lines = new Set(idx.flatMap((c) => (c.oracle_text ?? '').split('\n').map((l) => l.trim().toLowerCase())));
    for (const t of WORDINGS) for (const line of t.split('\n')) expect(lines.has(line.trim().toLowerCase()), line).toBe(false);
    const named = new Set(idx.flatMap((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].flatMap((text) => typeof text === 'string'
      ? text.split('\n').map((l) => l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim()) : [])));
    for (const t of MECH) for (const x of [...t.examples.map((e) => e.text), ...t.counterExamples]) for (const line of x.split('\n')) expect(named.has(line.trim()), `${t.id}: ${line}`).toBe(false);
  });
});
