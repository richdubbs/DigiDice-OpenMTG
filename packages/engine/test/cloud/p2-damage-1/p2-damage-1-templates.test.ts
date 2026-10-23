/**
 * p2-damage-1 (Phase 2 lane p2-damage): the template data of parser/templates/zz-cloud/p2-damage-1.json and the round's other parser, engine and renderer changes:
 *  - effects/handlers/lifedamage.ts#damagePerSource: the recipients of "each <object> deals N damage to its controller" are read with that source as the subject;
 *  - parser/lower/anaphora.ts#compatible and render/refs.ts#candidateCheck: "that creature" never names an event role the clause leaves unnamed (Repercussion's source);
 *  - render/steps-flow.ts#damageEqualToTheirCount: "they control", "... that player controls with flying", "half that player's life total, rounded down"
 *    (family each-player-they-control);
 *  - render/refs.ts#eachSubjectWordings: "a creature dealt damage this way" (one of the objects an earlier step dealt damage to).
 * Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The behavior is in p2-damage-1-scenarios.test.ts. CR cites from memory, unverified
 * (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2Damage1 from '../../../src/parser/templates/zz-cloud/p2-damage-1.json';
import review from '../../m5/golden/cards/p2-damage-1-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T1 = p2Damage1 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: a creature for a permanent's line (a trigger, an activated ability, "this creature"), else a sorcery. */
const typeOf = (text: string): string => (/^Whenever|^When|^\{|this creature/m.test(text) ? 'Creature — Ogre' : 'Sorcery');
const face = (text: string, typeLine?: string) => {
  const type = typeLine ?? typeOf(text);
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string) =>
  compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string): string => compiled(type, text).automation.level;
const json = (type: string, text: string): string => JSON.stringify(compiled(type, text).faces.map((f) => f.abilities));

const IDS = [
  'eff.p2damage1.each.deals.toItsController', 'eff.p2damage1.damage.eachPlayer.theyControl', 'eff.p2damage1.damage.eachPlayer.twiceCountWithFlying',
  'eff.p2damage1.damage.eachPlayer.halfLifeRoundedDown', 'eff.p2damage1.dealtThisWay.cantBeRegenerated.eot',
];

describe('p2-damage-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-damage-1.json, after zz-cloud/look3.json, before zz-cloud/r3-choose.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-damage-1.json');
    expect(files.indexOf('zz-cloud/p2-damage-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/look3.json'));
    expect(files.indexOf('zz-cloud/p2-damage-1.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(T1.map((t) => t.id)).toEqual(IDS);
    for (const t of T1) {
      expect(t.id, t.id).toMatch(/^eff\.p2damage1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // three hand-verified golden cards of the tuning half (design 6.9 met)
    expect(goldenUsing('eff.p2damage1.dealtThisWay.cantBeRegenerated.eot').sort()).toEqual(['Flamebreak', 'Incinerate', 'Jaya Ballard, Task Mage']);
    // narrow wordings (one tuning-half card prints each), stable on one hand-verified golden card plus these tests and the scenarios: a 6.9 deviation named in the
    // round record (guide section 5, "Narrow wordings")
    expect(goldenUsing('eff.p2damage1.each.deals.toItsController')).toEqual(['Rakdos Charm']);
    expect(goldenUsing('eff.p2damage1.damage.eachPlayer.theyControl')).toEqual(['Acidic Soil']);
    expect(goldenUsing('eff.p2damage1.damage.eachPlayer.twiceCountWithFlying')).toEqual(['Wing Storm']);
    expect(goldenUsing('eff.p2damage1.damage.eachPlayer.halfLifeRoundedDown')).toEqual(['Heartless Hidetsugu']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T1) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'whenever', 'and', 'twice', 'half']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('p2-damage-1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T1) {
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
    [/\bto its controller\b/, 'to its owner'], [/\beach player equal\b/, 'each opponent equal'], [/\bthey control\b/, 'you control'],
    [/\btwice the number\b/, 'the number'], [/\bwith flying\b/, 'with reach'], [/\brounded down\b/, 'rounded up'], [/\bhalf that player's\b/, 'half your'],
    [/\bthis turn\.$/, 'until your next turn.'], [/\bdealt damage this way\b/, 'dealt damage this turn'], [/\bcan't be regenerated\b/, "can't be countered"],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-damage-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T1) {
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

describe('p2-damage-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of T1) {
    it(`${t.id}: replacing any one word of the template's sentence by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.length - 1;
        const [cost, rest] = /^(\{[^:]*: )(.*)$/.exec(lines[last]!)?.slice(1) ?? ['', lines[last]!];
        const words = rest!.split(' ');
        words.forEach((w, i) => {
          if (/^\{/.test(w)) return; // a mana symbol is not a word
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...lines.slice(0, last), `${cost}${[...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ')}`].join('\n');
          expect(understood(face(mutated, typeOf(e.text))), mutated).toBe(false);
        });
      }
    });
  }
});

describe('p2-damage-1 engine (effects/handlers/lifedamage.ts#damagePerSource)', () => {
  it('"each creature deals 1 damage to its controller": one damage step, each source with its own recipient (`subject`)', () => {
    expect(json('Sorcery', 'Each creature deals 1 damage to its controller.')).toContain('"to":{"ref":"controllerOf","object":{"ref":"subject"}},"amount":1,"perSource":true');
  });
});

describe('p2-damage-1 antecedents (parser/lower/anaphora.ts#compatible, render/refs.ts#candidateCheck)', () => {
  it('"that creature" of "Whenever a creature is dealt damage" is the creature dealt damage, never the unnamed source', () => {
    const j = json('Enchantment', "Whenever a creature is dealt damage, this enchantment deals that much damage to that creature's controller.");
    expect(j).toContain('"to":{"ref":"controllerOf","object":{"ref":"event","role":"object"}}');
    expect(level('Enchantment', "Whenever a creature is dealt damage, this enchantment deals that much damage to that creature's controller.")).toBe('full');
  });
  it('a pronoun still needs a named antecedent; the unnamed source is still "that source"-less (no reading invented)', () => {
    expect(level('Enchantment', 'Whenever a creature is dealt damage, this enchantment deals that much damage to that source.')).not.toBe('full');
  });
});

describe('p2-damage-1 renderer support (G6: the render gate is exact)', () => {
  it('render/refs.ts: "a creature dealt damage this way" only for what an earlier step dealt damage to', () => {
    expect(level('Instant', "This spell deals 2 damage to any target. A creature dealt damage this way can't be regenerated this turn.")).toBe('full');
    expect(level('Instant', "This spell deals 2 damage to any target. A creature can't be regenerated this turn.")).not.toBe('full');
  });
  it('render/steps-flow.ts: "half that player\'s life total, rounded down" of each player only', () => {
    expect(level('Sorcery', "This spell deals damage to each player equal to half that player's life total, rounded down.")).toBe('full');
    // half YOUR life total is another quantity (read once, the same for every player): not this reading
    expect(json('Sorcery', "This spell deals damage to each player equal to half your life total, rounded down.")).not.toContain('{"q":"life","of":{"ref":"iterating"}}');
  });
});

const index = localIndex();

describe.skipIf(index === null)('p2-damage-1 design 6.10 (local index): synthetic examples', () => {
  it('no p2-damage-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|spell|card|Saga|permanent)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = T1.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
