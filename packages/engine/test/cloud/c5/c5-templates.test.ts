/**
 * CLOUD C5 (named choices and their references): the template data of parser/templates/zz-cloud/c5.json ("Choose a color.", "Spells you cast of the chosen type
 * cost {1} less to cast", "Your opponents can't cast spells of the chosen color", "~ is the chosen type in addition to its other types", "Each creature you control
 * is the chosen type in addition to its other types") and the parser work they rest on: "the chosen color / type" of one ability read from the face's
 * "As ~ enters, choose ..." (parser/parse.ts#faceChoices, #linkChosen; parser/lower/links.ts#resolveFaceChoices; CR 607.2d), the `Chosen` hole, "that aren't of
 * the chosen type", and cast triggers of a spell of the chosen color or type (parser/holes/event.ts).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10); the real cards each template reads are checked against the local index when it is present.
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the C5 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import c5 from '../../../src/parser/templates/zz-cloud/c5.json';
import review from '../../m5/golden/cards/cloud-c5-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const C5 = c5 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a C5 example is an ability of the right kind (a sentence that starts with "Choose" is a spell's; anything else a permanent's). */
function exampleCard(text: string): OracleCard {
  if (/^choose /i.test(text)) return card('Example Volley', /until end of turn/.test(text) ? 'Instant' : 'Sorcery', text);
  if (/^~ is the chosen type/m.test(text)) return card('Example Mimic', 'Artifact Creature — Shapeshifter', text, { power: '2', toughness: '2' });
  return card('Example Relic', 'Artifact', text);
}
const parsedWith = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

describe('C5 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/c5.json, path order: after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/c5.json');
    expect(files.indexOf('zz-cloud/c5.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/c5.json')).toBeLessThan(files.indexOf('zz-fast1/t4.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(C5.length).toBe(5);
    for (const t of C5) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.c5\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('the hand-verified golden entries (cloud-c5-review.json) are the fixture cards this family made full', () => {
    const golden = review as { card: string; expect: string; verified: string }[];
    expect(golden.map((g) => g.card).sort()).toEqual(['Paradise Plume', 'Umori, the Collector']);
    for (const g of golden) expect(g.verified, g.card).toMatch(/^CLOUD C5 review, by hand against the Oracle text and the rules cited/);
    expect(golden.some((g) => g.verified.includes('(sta.c5.spells.you.chosen.less)'))).toBe(true);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of C5) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', "can't"]) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('C5 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of C5) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(fullyAutomated(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/the chosen type/, 'the chosen name'], [/the chosen color/, 'the chosen number'], [/choose a color/i, 'Choose two colors'], [/choose a creature type/, 'choose a creature'],
    [/ less /, ' more '], [/you cast/, 'your opponents cast'], [/Your opponents/, 'Your teammates'], [/in addition to its other types/, 'in addition to its other colors'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by)}.`);
  return out;
}

describe('C5 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of C5) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('C5 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of C5) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~,' || /^\{/.test(w)) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('CR 607.2d: the face-level link (parser/parse.ts#faceChoices, #linkChosen) on shapes of templates that were already there', () => {
  const READS: readonly [string, string][] = [
    ['As ~ enters, choose a creature type.\nCreatures of the chosen type get +1/+1.', 'type'],
    ['As ~ enters, choose a color.\nCreatures your opponents control of the chosen color get -1/-1.', 'color'],
    ['As ~ enters, choose a creature type.\nWhenever a creature you control of the chosen type dies, draw a card.', 'type'],
    ['As ~ enters, choose a color.\nWhenever a player casts a spell of the chosen color, you gain 1 life.', 'color'],
    ['As ~ enters, choose a creature type.\n{T}: Untap target creature of the chosen type.', 'type'],
    ['As ~ enters, choose a basic land type.\nLands of the chosen type have "{T}: Add {C}{C}."', 'landType'],
  ];
  for (const [text, link] of READS) {
    it(`"${text.split('\n')[1]}" reads the link "${link}" of the face's choice, is automated and passes the render gate`, () => {
      const f = parsedWith(text);
      expect(fullyAutomated(f), `${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
      expect(JSON.stringify(f.abilities[1])).toContain(`"link":"${link}"`);
    });
  }
  it('never a guess: no choice on the face, a choice of another kind, or two choices of the kind leave the reader manual', () => {
    for (const text of [
      'Creatures of the chosen type get +1/+1.',
      'As ~ enters, choose a color.\nCreatures of the chosen type get +1/+1.',
      'As ~ enters, choose a creature type.\nAs ~ enters, choose a creature type.\nCreatures of the chosen type get +1/+1.',
      'As ~ enters, choose a creature type.\nWhenever a player casts a spell of the chosen color, you gain 1 life.',
    ]) expect(fullyAutomated(parsedWith(text)), text).toBe(false);
  });
  it('CR 601.2c: a target of a spell cannot read a choice the same spell makes as it resolves (the target is chosen first)', () => {
    expect(fullyAutomated(parsedWith('Choose a creature type. Return target creature card of the chosen type from your graveyard to your hand.'))).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('C5 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it('no C5 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = C5.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => !x.includes('\n') && lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card's C5 line is read by the named template and passes the exact render gate
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.c5.choose.color': ['Brave the Elements'],
    'sta.c5.spells.you.chosen.less': ['Umori, the Collector'],
    'sta.c5.opponents.cantCast.chosen': ['Iona, Shield of Emeria'],
    'sta.c5.self.chosenType.inaddition': ['Adaptive Automaton', 'Metallic Mimic'],
    'sta.c5.each.chosenType.inaddition': ['Xenograft'],
  };
  const LINE = /chosen (color|type)|^Choose a color\./i;
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read the line with it, pass the render gate and leave no manual ability for it`, () => {
      for (const name of names) {
        const oracle = (index ?? []).find((c) => c.name === name);
        expect(oracle, name).toBeDefined();
        const c = compileCard(oracle!);
        expect(c.faces.every((f) => f.abilities.every((a) => !(a.kind === 'manual' && LINE.test(a.text)))), name).toBe(true);
        const parsed = parseCard(oracle!, OPTS);
        expect(parsed.faces.flatMap((f) => f.templatesUsed), name).toContain(id);
        expect(parsed.faces.every((f) => f.gate.every((g) => g.ok)), name).toBe(true);
      }
    }, 60_000);
  }
});
