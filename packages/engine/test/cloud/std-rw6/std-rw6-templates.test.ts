/**
 * Card wave 2, slice s6 (std-rw6): the template data of parser/templates/zz-cloud/std-rw6.json ("each opponent may discard a card or sacrifice a <permanent>", "until end
 * of turn, <obj> becomes saddled if it's a Mount and becomes an artifact creature if it's a Vehicle",
 * "<src> deals N damage to each opponent who didn't") and the parser, renderer and engine changes of the round ("target <type> or spell", airbending a spell).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-rw6-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRw6 from '../../../src/parser/templates/zz-cloud/std-rw6.json';
import review from '../../m5/golden/cards/cloud-std-rw6-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdRw6 as Template[];
const MECH_COUNT = 3;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'eff.stdrw6.eachOpponentMay.discardOrSacrifice': 'Zoyowa Lava-Tongue',
  'rid.stdrw6.eachOpponentWhoDidnt.damage': 'Zoyowa Lava-Tongue',
  'eff.stdrw6.eot.saddledIfMount.creatureIfVehicle': 'Alacrian Armory',
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a creature (triggered and activated abilities). */
const parsedWith = (_t: Template, text: string) => parseCard(card('Example Shaman', 'Creature — Goblin Shaman', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Monk', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('std-rw6 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rw6.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rw6.json');
    expect(files.indexOf('zz-cloud/std-rw6.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-rw6.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff|rid.stdrw6.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|rid)\.stdrw6\./);
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

describe('std-rw6 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [[/\bmay\b/, 'must'], [/\bdiscard a card\b/, 'draw a card'], [/\bsacrifice\b/, 'exile'], [/\beach opponent who\b/, 'each player who'], [/\bopponent may\b/, 'player may']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rw6 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('std-rw6 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('std-rw6 design 6.10 (local index): synthetic examples', () => {
  it('no std-rw6 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

// ---- parser/holes/object.ts: "target <type> or spell" -------------------------------------------------------------------------------------------------------

describe('std-rw6 parser (CR 115.1, 608.2b): "target creature or spell", FAST5 T59\'s "target spell or creature" in the other order (parser/holes/object.ts)', () => {
  const targetsOf = (text: string): unknown => JSON.parse(JSON.stringify(face('Instant', text).abilities)) as unknown;
  it('both orders give the same JSON: one target, a spell on the stack or a creature on the battlefield', () => {
    const a = face('Instant', 'Exile target creature or spell.');
    const b = face('Instant', 'Exile target spell or creature.');
    expect(fullFace(a), JSON.stringify(a.diagnostics)).toBe(true);
    expect(fullFace(b), JSON.stringify(b.diagnostics)).toBe(true);
    expect(jsonKey(a.abilities)).toBe(jsonKey(b.abilities));
    expect(JSON.stringify(targetsOf('Exile target artifact or spell.'))).toContain('"anyOf":[{"stackKind":"spell","zone":"stack"},{"types":["Artifact"],"zone":"battlefield"}]');
  });
  it('"up to one other target creature or spell": a count and "other" (not this object), on an enters trigger', () => {
    const f = face('Creature — Human Monk', 'When this creature enters, exile up to one other target creature or spell.', ['2', '2']);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    const json = JSON.stringify(f.abilities);
    expect(json).toContain('"min":0,"max":1');
    expect(json).toContain('"other":true');
  });
  it('a plural, "spells", a post-modifier or an ability is not this reading', () => {
    expect(fullFace(face('Instant', 'Exile two target creatures or spells.'))).toBe(false);
    expect(fullFace(face('Instant', 'Exile target creature or spells.'))).toBe(false);
    expect(fullFace(face('Instant', 'Exile target creature or ability.'))).toBe(false);
    const post = face('Instant', 'Exile target creature or spell an opponent controls.');
    expect(fullFace(post) && JSON.stringify(post.abilities).includes('"anyOf":[{"stackKind":"spell"')).toBe(false);
  });
});

// ---- render/steps-lasting.ts + effects/handlers/airbend.ts: airbending a spell -------------------------------------------------------------------------------

describe('std-rw6 airbend (CR 701.65a): a target spell or permanent is airbent by the engine; an ability or a card in a graveyard stays manual', () => {
  it('"airbend up to one other target creature or spell" and "airbend target artifact or spell" are full', () => {
    expect(fullFace(face('Creature — Human Monk', 'Flash\nWhen this creature enters, airbend up to one other target creature or spell.', ['2', '2']))).toBe(true);
    expect(fullFace(face('Instant', 'Airbend target artifact or spell.'))).toBe(true);
  });
  it('a card in a graveyard, or a spell or ability, is not', () => {
    expect(fullFace(face('Instant', 'Airbend target creature card in a graveyard.'))).toBe(false);
    expect(fullFace(face('Instant', 'Airbend target spell or ability.'))).toBe(false);
  });
});

// ---- render/steps-flow.ts#eachUnlessThey: the choice first, then the damage to each opponent who didn't --------------------------------------------------------

describe('std-rw6 renderer (CR 118.12, 101.4, 608.2c): "Each opponent may A or B. ~ deals N damage to each opponent who didn\'t." is the punisher of std-mkm', () => {
  it('the two sentences are one step: for each opponent, pay a discard, else pay a sacrifice, else the damage from this creature to that opponent', () => {
    const two = face('Creature — Goblin', "When this creature enters, each opponent may discard a card or sacrifice a creature. This creature deals 2 damage to each opponent who didn't.", ['1', '1']);
    expect(fullFace(two), JSON.stringify(two.diagnostics)).toBe(true);
    const steps = (bare(two.abilities) as { effect: { steps: unknown[] } }[])[0]!.effect.steps;
    expect(steps).toEqual([{
      op: 'forEach', over: { ref: 'each', who: 'opponent' }, as: 'each', do: [{
        op: 'pay', who: { ref: 'bound', name: 'each' }, cost: { other: [{ kind: 'discard', count: 1 }] }, else: [{
          op: 'pay', who: { ref: 'bound', name: 'each' }, cost: { other: [{ kind: 'sacrifice', filter: { types: ['Creature'] }, count: 1 }] },
          else: [{ op: 'damage', source: { ref: 'self' }, to: { ref: 'bound', name: 'each' }, amount: 2 }],
        }],
      }],
    }]);
  });
  it('the rider needs the choice right before it: after another instruction, or after a choice of one cost, it is not read', () => {
    expect(fullFace(face('Creature — Goblin', "When this creature enters, each opponent discards a card. This creature deals 2 damage to each opponent who didn't.", ['1', '1']))).toBe(false);
    expect(fullFace(face('Creature — Goblin', "When this creature enters, each opponent may discard a card. This creature deals 2 damage to each opponent who didn't.", ['1', '1']))).toBe(false);
  });
});
