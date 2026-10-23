/**
 * Card wave 2, EDHREC lane rx23 (std-rx23): the template data of parser/templates/zz-cloud/std-rx23.json (prevention of the damage a group deals, damage to
 * each opponent / each player counted for that player, "takes N extra turns", "you may play [up to] N additional
 * lands this turn", "nonbasic lands are <land type>") and the parser, renderer and lint changes of the round (a bare "it" in an instruction's own condition about
 * the equipped or enchanted object, "up to" in an additional-land permission).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-rx23-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRx23 from '../../../src/parser/templates/zz-cloud/std-rx23.json';
import review from '../../m5/golden/cards/cloud-std-rx23-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdRx23 as Template[];
const MECH_COUNT = 7;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'eff.stdrx23.damage.eachOpponent.theirCount': 'Treacherous Terrain', // and Typhoon: the two tuning-half printings
  'eff.stdrx23.damage.eachPlayer.twiceTheirCount': 'Price of Progress',
  'eff.stdrx23.extraTurns.n': 'Time Stretch',
  'eff.stdrx23.permit.extraLands.n.thisTurn': 'Summer Bloom',
  'sta.stdrx23.nonbasic.areSubtype': 'Harbinger of the Seas',
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a creature (triggered and activated abilities). */
/** A synthetic card in which an example is an ability of the right kind: an instant for a bare instruction, else a creature (statics, triggers, activations). */
const bareInstruction = (t: Template, text: string): boolean => t.kind === 'effect' && !/^(When|Whenever|At|\{)/.test(text) && !text.includes('\n');
const parsedWith = (t: Template, text: string) => (bareInstruction(t, text)
  ? parseCard(card('Example Lesson', 'Instant', text), OPTS)
  : parseCard(card('Example Shaman', 'Creature — Goblin Shaman', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;
const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Monk', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('std-rx23 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx23.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx23.json');
    expect(files.indexOf('zz-cloud/std-rx23.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-rx23.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdrx23.* or sta.stdrx23.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.stdrx23\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) expect(cards, t.id).toContain(NARROW[t.id]);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
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

describe('std-rx23 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(t, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [[/\bopponent\b/, 'player'], [/\bcan't\b/, 'can'], [/\bnonbasic\b/, 'basic'], [/\bextra\b/, 'additional'], [/\badditional\b/, 'extra'], [/\bby\b/, 'to'], [/\ball\b/, 'the next 2'], [/\btwice\b/, 'half']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx23 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/until end of turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-rx23 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w)) return;
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-rx23 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx23 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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



// ---- parser/lower/anaphora.ts#guardedAttached + render/steps.ts: "put a +1/+1 counter on equipped creature if it's black" ------------------------------------

describe('std-rx23 lowering and renderer (CR 608.2c, 301.5a; family guarded-attached-after-trigger): a bare "it" in an instruction\'s own condition about the attached object', () => {
  it('"put a +1/+1 counter on equipped creature if it\'s black" (and "enchanted creature") is full; the condition names the attached object', () => {
    for (const [type, text] of [
      ['Artifact — Equipment', "At the beginning of your upkeep, put a +1/+1 counter on equipped creature if it's red.\nEquip {2}"],
      ['Enchantment — Aura', "Enchant creature\nAt the beginning of your upkeep, put a +1/+1 counter on enchanted creature if it's green."],
    ] as const) {
      const f = face(type, text);
      expect(fullFace(f), `${text}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
      expect(JSON.stringify(f.abilities)).toContain('"guard":{"cond":"matches","object":{"ref":"attachedTo"}');
    }
  });
  it('the condition said first ("if equipped creature is red, put ... on it") keeps its reading', () => {
    expect(fullFace(face('Artifact — Equipment', 'At the beginning of your upkeep, if equipped creature is red, put a +1/+1 counter on it.\nEquip {2}'))).toBe(true);
  });
  it('a sentence with another candidate for "it" is not read this way (only for no antecedent at all)', () => {
    const f = face('Artifact — Equipment', "When this Equipment enters, put a +1/+1 counter on equipped creature if it's red.\nEquip {2}");
    expect(JSON.stringify(f.abilities)).not.toContain('"guard":{"cond":"matches","object":{"ref":"attachedTo"},"filter":{"colors":["R"]}}');
  });
  it('a target of the instruction is not the attached object', () => {
    expect(fullFace(face('Artifact — Equipment', "At the beginning of your upkeep, put a +1/+1 counter on target creature if it's red.\nEquip {2}"))).toBe(false);
  });
});

// ---- render/stat.ts: "You may play up to N additional lands this turn" -------------------------------------------------------------------------------------

describe('std-rx23 renderer (CR 305.2a; family up-to-additional-lands): "you may play up to N additional lands this turn"', () => {
  it('"up to N" and "N" are the same permission', () => {
    const a = face('Sorcery', 'You may play up to two additional lands this turn.');
    const b = face('Sorcery', 'You may play two additional lands this turn.');
    expect(fullFace(a), JSON.stringify(a.diagnostics)).toBe(true);
    expect(fullFace(b), JSON.stringify(b.diagnostics)).toBe(true);
    expect(jsonKey(a.abilities)).toBe(jsonKey(b.abilities));
  });
  it('a lasting permission keeps its own wording ("up to" is read for this turn only)', () => {
    expect(fullFace(face('Enchantment', 'You may play up to two additional lands on each of your turns.'))).toBe(false);
  });
});

// ---- render/steps-flow.ts#damageEqualToTheirCount: each opponent, twice ------------------------------------------------------------------------------------

describe('std-rx23 renderer (CR 120.3, 608.2h): "deals damage to each opponent equal to the number of ..." and "... twice the number of ..."', () => {
  it('each form renders back and keeps the per-player count', () => {
    for (const text of ['~ deals damage to each opponent equal to the number of creatures that player controls.', '~ deals damage to each player equal to twice the number of artifacts that player controls.']) {
      const f = face('Sorcery', text);
      expect(fullFace(f), `${text}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
      expect(JSON.stringify(f.abilities)).toContain('"controller":{"ref":"iterating"}');
    }
  });
  it('r4-fxb\'s each-player form is unchanged', () => {
    expect(fullFace(face('Sorcery', '~ deals damage to each player equal to the number of creatures that player controls.'))).toBe(true);
  });
  it('"twice" with "each opponent", or "they control" after "each opponent", is not read', () => {
    expect(fullFace(face('Sorcery', '~ deals damage to each opponent equal to twice the number of creatures that player controls.'))).toBe(false);
    expect(fullFace(face('Sorcery', '~ deals damage to each opponent equal to the number of creatures they control.'))).toBe(false);
  });
});

// ---- weak readings: the specific templates keep their sentences (design 6.3 rule 2) ------------------------------------------------------------------------

describe('std-rx23 template priority (design 6.3 rule 2): the specific templates keep their sentences', () => {
  it('"Nonbasic lands are Mountains." keeps sta.m6.nonbasic.mountains or gives the same JSON', () => {
    const f = face('Enchantment', 'Nonbasic lands are Mountains.');
    expect(fullFace(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"subtypes":{"set":["Mountain"]}');
  });
  it('"prevent all combat damage that would be dealt by target creature this turn" keeps eff.t19.rep.preventCombatBy', () => {
    const f = face('Instant', 'Prevent all combat damage that would be dealt by target creature this turn.');
    expect(f.templatesUsed).toContain('eff.t19.rep.preventCombatBy');
  });
});
