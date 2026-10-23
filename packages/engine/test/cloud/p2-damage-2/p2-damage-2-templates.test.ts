/**
 * p2-damage-2 (Phase 2 lane p2-damage): the template data of parser/templates/zz-cloud/p2-damage-2.json and the round's other parser, engine and renderer changes:
 *  - parser/holes/filter.ts: "attached to <player>" (`attachedToPlayer`, rules/filter.ts, statics/match.ts) and "that didn't attack this turn";
 *  - parser/holes/qty.ts#historyCounts: "the number of cards they've drawn this turn" (a `happenedCount` of the draws of that player); parser/lower/anaphora.ts:
 *    "they've" is a surface form of "they";
 *  - parser/holes/object.ts: "target <permanent> chosen at random" (`TargetSpec.random`, actions/announce-targets.ts#randomTargets, feature:target.random);
 *  - `fight` `pairs` (effects/handlers/lifedamage.ts#fightPairs, op:fight.pairs), parser/lower/ability.ts#joinFightsDifferent, render/fold-p2damage2.ts;
 *  - parser/lower/anaphora.ts#fightSubject and render/steps-life.ts: the creature a target fights is never that target itself;
 *  - render/program.ts#chosenFirst: "Choose target X. <instructions naming it>" with later targets of their own instructions.
 * Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The behavior is in p2-damage-2-scenarios.test.ts. CR cites from memory, unverified
 * (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2Damage2 from '../../../src/parser/templates/zz-cloud/p2-damage-2.json';
import review from '../../m5/golden/cards/p2-damage-2-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T2 = p2Damage2 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: an enchantment for "this enchantment" and an upkeep trigger, a creature for another permanent's line, else a sorcery. */
const typeOf = (text: string): string => (/this enchantment|^At the beginning/m.test(text) ? 'Enchantment' : /^Whenever|^When|^\{|this creature/m.test(text) ? 'Creature — Ogre' : 'Sorcery');
const face = (text: string, typeLine?: string) => {
  const type = typeLine ?? typeOf(text);
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string) =>
  compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string): string => compiled(type, text).automation.level;
const json = (type: string, text: string): string => JSON.stringify(compiled(type, text).faces.map((f) => f.abilities));

const IDS = ['eff.p2damage2.damage.toItsController.unlessSacrificesIt', 'eff.p2damage2.forEach.token.fightsDifferent'];

describe('p2-damage-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-damage-2.json, after zz-cloud/p2-counters-state-1.json, before zz-cloud/p2-player-rules-1.json) and its ids are unique', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-damage-2.json');
    expect(files.indexOf('zz-cloud/p2-damage-2.json')).toBeGreaterThan(files.indexOf('zz-cloud/p2-counters-state-1.json'));
    expect(files.indexOf('zz-cloud/p2-damage-2.json')).toBeLessThan(files.indexOf('zz-cloud/p2-player-rules-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(T2.map((t) => t.id)).toEqual(IDS);
    for (const t of T2) {
      expect(t.id, t.id).toMatch(/^eff\.p2damage2\./);
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
    expect(goldenUsing('eff.p2damage2.damage.toItsController.unlessSacrificesIt')).toEqual(["Enchanter's Bane"]);
    expect(goldenUsing('eff.p2damage2.forEach.token.fightsDifferent')).toEqual(["Ezuri's Predation"]);
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

describe('p2-damage-2 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bto its controller\b/, 'to its owner'], [/\bthat player sacrifices\b/, 'you sacrifice'], [/\bunless that player\b/, 'if that player'], [/\bits mana value\b/, 'its power'],
    [/\ba different one\b/, 'one'], [/\bof those creatures\b/, 'of those artifacts'], [/\bEach of those tokens\b/, 'Each of those creatures'], [/\bcreate a\b/, 'create two'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-damage-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('p2-damage-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe('p2-damage-2 parser holes (parser/holes/filter.ts, qty.ts, object.ts)', () => {
  it('"Curses attached to them": attached to the player named before (attachedToPlayer), "to you" to the controller', () => {
    expect(json('Sorcery', 'This spell deals damage to target player equal to the number of Curses attached to them.')).toContain('"attachedToPlayer":{"ref":"target","id":"t0"}');
    expect(json('Artifact', 'When this artifact enters, destroy all Curses attached to you.')).toContain('"attachedToPlayer":{"ref":"you"}');
    expect(level('Sorcery', 'This spell deals damage to target player equal to the number of Curses attached to them.')).toBe('full');
  });
  it('"that didn\'t attack this turn": attackedThisTurn false; "that attacked this turn" stays true', () => {
    expect(json('Instant', "This spell deals damage to target player equal to the number of creatures that player controls that didn't attack this turn.")).toContain('"attackedThisTurn":false');
    expect(json('Instant', 'This spell deals damage to target player equal to the number of creatures that player controls that attacked this turn.')).toContain('"attackedThisTurn":true');
  });
  it('"cards they\'ve drawn this turn": the draws of that player (a happenedCount), "cards you\'ve drawn this turn" stays your own count', () => {
    expect(json('Sorcery', "Target player draws two cards, then this spell deals damage to that player equal to the number of cards they've drawn this turn."))
      .toContain('"amount":{"q":"happenedCount","event":{"ev":"draw","player":{"ref":"target","id":"t0"}},"scope":"turn"}');
    expect(json('Sorcery', "This spell deals damage to target player equal to the number of cards you've drawn this turn.")).toContain('{"q":"cardsDrawnThisTurn"}');
  });
  it('"chosen at random": one target of a plain phrase, random; a plural target phrase has no such reading', () => {
    expect(json('Creature — Giant', 'When this creature enters, it fights target creature an opponent controls chosen at random.')).toContain('"random":true');
    expect(level('Creature — Giant', 'When this creature enters, it fights target creature an opponent controls chosen at random.')).toBe('full');
    expect(level('Sorcery', 'Destroy two target creatures chosen at random.')).not.toBe('full');
  });
});

describe('p2-damage-2 engine forms (model/cap-walk.ts, model/forms.ts)', () => {
  it('a paired fight is op:fight.pairs and a random target feature:target.random; both are engine capabilities', () => {
    expect(ENGINE_CAPABILITIES.has('op:fight.pairs')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:target.random')).toBe(true);
    expect(json('Sorcery', 'For each creature your opponents control, create a 2/2 black Zombie creature token. Each of those tokens fights a different one of those creatures.')).toContain('"op":"fight","a":{"ref":"bound","name":"fighters"},"b":{"ref":"each","filter":{"types":["Creature"],"controller":"opponent"}},"pairs":true');
  });
});

describe('p2-damage-2 antecedents and renderer (parser/lower/anaphora.ts#fightSubject, render/steps-life.ts, render/program.ts#chosenFirst)', () => {
  it('"Target creature you control fights that creature." after "Choose target creature an opponent controls.": the chosen creature', () => {
    const text = 'Choose target creature an opponent controls. When that creature dies this turn, you gain 3 life. Target creature you control fights that creature.';
    expect(json('Sorcery', text)).toContain('{"op":"fight","a":{"ref":"target","id":"t1"},"b":{"ref":"target","id":"t0"}}');
    expect(level('Sorcery', text)).toBe('full');
  });
  it('"fights it" with only the fighter named before stays unread (a creature fights itself only when Oracle says "itself")', () => {
    expect(level('Sorcery', 'Target creature you control fights it.')).not.toBe('full');
  });
  it('a paired fight is said only through its fold: the two sentences, nothing else', () => {
    expect(level('Sorcery', 'For each creature your opponents control, create a 2/2 black Zombie creature token. Each of those tokens fights a different one of those creatures.')).toBe('full');
    expect(level('Sorcery', 'Create a 2/2 black Zombie creature token. Each of those tokens fights a different one of those creatures.')).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('p2-damage-2 design 6.10 (local index): synthetic examples', () => {
  it('no p2-damage-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
