/**
 * p2-damage-3 (Phase 2 lane p2-damage): the template data of parser/templates/zz-cloud/p2-damage-3.json and the round's other parser and renderer changes:
 *  - parser/holes/filter.ts#controlForms: "that player or that planeswalker's controller controls" (an `anyOf` of the two controllers; render/np.ts says it back);
 *  - parser/holes/cond.ts#zoneHistory: Landfall's "you had a land enter the battlefield under your control this turn" (render/cond.ts#zoneHistoryPhrase, +1 alt site,
 *    family landfall-you-had);
 *  - parser/holes/filter.ts: "that isn't enchanted" / "that aren't enchanted" (enchanted false; render/np.ts);
 *  - eff.p2damage3.damage.toRandomObject with render/fold-p2damage3.ts and parser/lower/mentions.ts#joinedAfter (the random choice is no antecedent of the damage's source);
 *  - render/np.ts: "without flying that player controls" after a player named before (family without-keyword-controller-order);
 *  - render/steps-life.ts#alsoText: "1 damage to each opponent and 1 damage to each creature your opponents control" (the amount said again);
 *  - eff.p2damage3.damageEqual.toEachAndPlayer: "damage equal to <qty> to each <filter> and <player>".
 * Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The behavior is in p2-damage-3-scenarios.test.ts. CR cites from memory, unverified
 * (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2Damage3 from '../../../src/parser/templates/zz-cloud/p2-damage-3.json';
import review from '../../m5/golden/cards/p2-damage-3-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T2 = p2Damage3 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: an enchantment for "this enchantment" and an upkeep trigger, a creature for another permanent's line, else a sorcery. */
const typeOf = (text: string): string => (/this artifact/m.test(text) ? 'Artifact' : /^Whenever|^When|^\{|this creature/m.test(text) ? 'Creature — Ogre' : 'Sorcery');
const face = (text: string, typeLine?: string) => {
  const type = typeLine ?? typeOf(text);
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string) =>
  compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string): string => compiled(type, text).automation.level;
const json = (type: string, text: string): string => JSON.stringify(compiled(type, text).faces.map((f) => f.abilities));

const IDS = ['eff.p2damage3.damage.toRandomObject', 'eff.p2damage3.damageEqual.toEachAndPlayer'];

describe('p2-damage-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-damage-3.json, after zz-cloud/p2-damage-2.json, before zz-cloud/p2-dig-1.json) and its ids are unique', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-damage-3.json');
    expect(files.indexOf('zz-cloud/p2-damage-3.json')).toBeGreaterThan(files.indexOf('zz-cloud/p2-damage-2.json'));
    expect(files.indexOf('zz-cloud/p2-damage-3.json')).toBeLessThan(files.indexOf('zz-cloud/p2-dig-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(T2.map((t) => t.id)).toEqual(IDS);
    for (const t of T2) {
      expect(t.id, t.id).toMatch(/^eff\.p2damage3\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // narrow wordings (one tuning-half card prints each), stable on one hand-verified golden card plus these tests and the scenarios: a 6.9 deviation named in the
    // round record (guide section 5, "Narrow wordings")
    expect(goldenUsing('eff.p2damage3.damage.toRandomObject')).toEqual(['Cinderheart Giant']);
    expect(goldenUsing('eff.p2damage3.damageEqual.toEachAndPlayer').sort()).toEqual(['Magmasaur', 'Time Bomb']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T2) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'whenever', 'twice', 'half', 'different']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('p2-damage-3 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T2) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        expect(fullyAutomated(f), e.text).toBe(true);
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
    [/\bchosen at random\b/, 'of your choice'], [/\bto a creature\b/, 'to each creature'], [/\ban opponent controls\b/, 'you control'], [/\band each player\b/, 'or each player'],
    [/\bto each creature\b/, 'to target creature'], [/\bdamage equal to\b/, 'damage less than'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-damage-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T2) {
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

describe('p2-damage-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of T2) {
    it(`${t.id}: replacing any one word of the template's sentence by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^\{/.test(w)) return; // a mana symbol is not a word
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(understood(face(mutated, typeOf(e.text))), mutated).toBe(false);
        });
      }
    });
  }
});

describe('p2-damage-3 parser holes and renderer (parser/holes/filter.ts, cond.ts; render/np.ts, cond.ts, steps-life.ts)', () => {
  it('"that player or that planeswalker\'s controller controls": both controllers of the one target, said back', () => {
    const text = "This spell deals 3 damage to target player or planeswalker and 1 damage to each creature that player or that planeswalker's controller controls.";
    expect(json('Instant', text)).toContain('"anyOf":[{"controller":{"ref":"target","id":"t0"}},{"controller":{"ref":"controllerOf","object":{"ref":"target","id":"t0"}}}]');
    expect(level('Instant', text)).toBe('full');
  });
  it('Landfall\'s "you had a land enter the battlefield under your control this turn": a land entered under your control this turn', () => {
    const text = 'Target creature gets +2/+2 until end of turn.\nLandfall — If you had a land enter the battlefield under your control this turn, that creature gets +4/+4 until end of turn instead.';
    expect(json('Instant', text)).toContain('{"cond":"happened","event":{"ev":"zoneChange","subject":{"types":["Land"],"controller":"you"},"to":"battlefield"},"scope":"turn"}');
    expect(level('Instant', text)).toBe('full');
  });
  it('"that isn\'t enchanted" / "that aren\'t enchanted": enchanted false', () => {
    expect(json('Sorcery', "Destroy all creatures that aren't enchanted.")).toContain('"enchanted":false');
    expect(level('Sorcery', "Destroy target creature that isn't enchanted.")).toBe('full');
  });
  it('"without flying that player controls" after the defending player; the amount said again after "each opponent"', () => {
    expect(level('Creature — Dragon', 'Whenever this creature attacks, if defending player controls no Walls, it deals 1 damage to each creature without flying that player controls.')).toBe('full');
    expect(level('Creature — Lizard', 'When this creature enters, it deals 1 damage to each opponent and 1 damage to each creature your opponents control.')).toBe('full');
    expect(level('Creature — Lizard', 'When this creature enters, it deals 1 damage to each opponent and 2 damage to each creature your opponents control.')).toBe('full');
  });
  it('the random choice is no antecedent of the damage\'s source ("it" stays the dying creature)', () => {
    expect(json('Creature — Giant', 'When this creature dies, it deals 3 damage to a creature an opponent controls chosen at random.')).toContain('"source":{"ref":"event","role":"subject"}');
  });
});

const index = localIndex();

describe.skipIf(index === null)('p2-damage-3 design 6.10 (local index): synthetic examples', () => {
  it('no p2-damage-3 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = T2.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
