/**
 * T19 (FAST4 wave, template family T-R: replacement, prevention, redirection and game-end shapes): the template data of
 * parser/templates/zz-fast4/t19.json, and the parser and renderer additions that let the existing stable shield templates read two more referents:
 * "that creature or planeswalker" (holes/object.ts, lower/anaphora.ts#compatible `orHead`, render/refs.ts `orNouns`) and "a creature dealt damage this way"
 * (holes/filter.ts, lower/mentions.ts: a participle-only mention of the damage step, render/np.ts `thisWay`).
 *
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability (G2).
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T19 templates compose with every other file.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { compatible } from '../../../src/parser/lower/anaphora';
import { nounsOf } from '../../../src/render/np';
import { ENGINE_CAPABILITIES } from '../../../src/model';
import t19 from '../../../src/parser/templates/zz-fast4/t19.json';
import { automated, bare, card, exampleCard, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T19 = t19 as Template[];
const OPTS = defaultParseOptions();
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
/** With the engine's capabilities, as the game compiles (the stable shield templates need `feature:shield.modify` and `feature:replace.foreign`). */
const GAME_OPTS = defaultParseOptions({ capabilities: ENGINE_CAPABILITIES });
const spell = (text: string, type = 'Instant') => parseCard(card('Example Bolt', type, text), GAME_OPTS).faces[0]!;

describe('T19 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast4/t19.json, after zz-fast3/ and before zz-m6/ in path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast4/t19.json');
    expect(files.indexOf('zz-fast4/t19.json')).toBeGreaterThan(files.indexOf('zz-fast3/t18.json'));
    expect(files.indexOf('zz-fast4/t19.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 7', () => {
    expect(T19.length).toBeGreaterThan(0);
    for (const t of T19) {
      expect(t.id, t.id).toMatch(/^(eff|rst|rep)\.t19\./);
      expect(['effect', 'static'], t.id).toContain(t.kind);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(7);
    }
  });
  // design 6.9: a template is stable only with its evidence: three verified golden cards (golden/cards/fast4-t19-review.json), each also tried with
  // `npm run cards -- try` and played in t19-scenarios.test.ts through a synthetic card of the same wording
  const STABLE: Record<string, string[]> = {
    'rst.t19.cantLoseGame.oppsCantWin': ['Platinum Angel', 'Herald of Eternal Dawn', 'Cloudsteel Kirin'],
    'eff.t19.rep.preventCombatBy': ['Horn of Deafening', 'Lady Evangela', 'Kor Haven', 'Subdue'],
    'rep.t19.self.anywhere.revealShuffle': ['Darksteel Colossus', 'Blightsteel Colossus', 'Progenitus', 'Legacy Weapon'],
    'eff.t19.rep.redirectNext': ['Warrior en-Kor', 'Nomads en-Kor', 'Lancers en-Kor', 'Spirit en-Kor'],
    'eff.t19.endTurn': ['Ultima', 'Sundial of the Infinite', 'Time Stop'],
  };
  it('design 6.9: a T19 template is stable only with three verified golden cards; the others are experimental (cards that use them are capped at partial)', () => {
    const golden = (JSON.parse(readFileSync(new URL('../../m5/golden/cards/fast4-t19-review.json', import.meta.url), 'utf8')) as { card: string }[]).map((e) => e.card);
    for (const t of T19) {
      const cards = STABLE[t.id];
      expect(t.status, t.id).toBe(cards ? 'stable' : 'experimental');
      for (const c of cards ?? []) expect(golden, `${t.id}: ${c}`).toContain(c);
      if (cards) expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T19) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', "can't", 'would']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('T19 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T19) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
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

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /\b(prevent|damage|lose|graveyard|end)\b/i.test(l));
  const line = lines[at < 0 ? 0 : at]!;
  const sentences = line.split(/(?<=\.)\s+/);
  const body = sentences[0]!.replace(/\.$/, '');
  const rest = sentences.slice(1).join(' ');
  const out = [`${body} unless it is blue.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bcombat damage\b/, 'damage'], [/\bby target\b/, 'to target'], [/\bthis turn\b/, 'this combat'], [/\byou control\b/, 'an opponent controls'],
    [/\bcan't lose\b/, "can't win"], [/\bcan't win\b/, "can't lose"], [/\bowner's library\b/, "owner's graveyard"], [/\breveal ~ and shuffle\b/, 'shuffle'],
    [/\bfrom anywhere\b/, 'from the battlefield'], [/\bthe turn\b/, 'the phase'], [/\btarget\b/, 'each'], [/\binstead\b/, ''],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ').trim()}.`);
  return out.map((m) => {
    const l = rest === '' ? m : `${m} ${rest}`;
    return lines.map((x, i) => (i === (at < 0 ? 0 : at) ? l : x)).join('\n');
  });
}

describe('T19 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T19) {
    it(`${t.id}: an appended "unless/at random/twice" or a swapped key word never gives the example's JSON`, () => {
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

describe('T19 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T19) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || /\n/.test(w)) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('T19: "that creature or planeswalker" (CR 115.1, 608.2c; design 6.4 unique-candidate rule with both heads)', () => {
  it('names a target "creature or planeswalker" and the stable shield template reads it (sh.dies.exile)', () => {
    const f = spell('~ deals 5 damage to target creature or planeswalker. If that creature or planeswalker would die this turn, exile it instead.', 'Sorcery');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(f.templatesUsed).toContain('sh.dies.exile');
    expect(JSON.stringify(f.abilities)).toContain('"subject":{"is":{"ref":"target","id":"t0"}}');
  });
  it('never names a target that is only a creature (both heads must name the antecedent): the sentence stays manual', () => {
    const f = spell('~ deals 5 damage to target creature. If that creature or planeswalker would die this turn, exile it instead.', 'Sorcery');
    expect(fullyAutomated(f)).toBe(false);
  });
  it('never names "any target" (a player is no creature or planeswalker): manual', () => {
    const f = spell('~ deals 5 damage to any target. If that creature or planeswalker would die this turn, exile it instead.', 'Sorcery');
    expect(fullyAutomated(f)).toBe(false);
  });
  it('lower/anaphora.ts#compatible: an `orHead` anaphor needs both heads in the mention', () => {
    const a = { sort: 'object' as const, number: 'singular' as const, head: 'creature', orHead: 'planeswalker', text: 'that creature or planeswalker' };
    const m = (heads: string[]) => ({ sort: 'object' as const, number: 'singular' as const, heads, ref: { ref: 'target', id: 't0' }, origin: 'target' as const, unit: 0 });
    expect(compatible(a, m(['creature', 'planeswalker', 'permanent']))).toBe(true);
    expect(compatible(a, m(['creature', 'permanent']))).toBe(false);
    expect(compatible(a, m(['planeswalker', 'permanent']))).toBe(false);
  });
});

describe('T19: "a creature dealt damage this way" (CR 608.2c, 120.3): the objects the earlier damage step of the ability dealt damage to', () => {
  it('after damage to each creature, the stable shield template reads it (sh.anyDies.exile) and the damage step is named', () => {
    const f = spell('~ deals 2 damage to each creature. If a creature dealt damage this way would die this turn, exile it instead.', 'Sorcery');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(f.templatesUsed).toContain('sh.anyDies.exile');
    const json = JSON.stringify(f.abilities);
    const name = /"amount":2,"as":"(\w+)"/.exec(json)?.[1];
    expect(name, json).toBeDefined();
    expect(json).toContain(`"subject":{"types":["Creature"],"is":{"ref":"bound","name":"${name}"}}`);
  });
  it('without a damage step before it the phrase names nothing: manual, never a guess', () => {
    expect(fullyAutomated(spell('Destroy target creature. If a creature dealt damage this way would die this turn, exile it instead.', 'Sorcery'))).toBe(false);
    expect(fullyAutomated(spell('If a creature dealt damage this way would die this turn, exile it instead.', 'Sorcery'))).toBe(false);
  });
  it('the damage step is an antecedent of nothing else: a pronoun or "that creature" without the participle never names it', () => {
    const dmg = { sort: 'object' as const, number: 'plural' as const, heads: ['*'], verbs: ['dealt damage this way'], participleOnly: true, ref: { ref: 'bound', name: '' }, origin: 'step' as const, unit: 0 };
    expect(compatible({ sort: 'set', number: 'plural', text: 'them' }, dmg)).toBe(false);
    expect(compatible({ sort: 'set', number: 'plural', head: 'creature', text: 'those creatures' }, dmg)).toBe(false);
    expect(compatible({ sort: 'any', number: 'plural', text: 'they' }, dmg)).toBe(false);
    expect(compatible({ sort: 'number', number: 'singular', text: 'that much' }, dmg)).toBe(false);
    expect(compatible({ sort: 'set', number: 'plural', participle: 'dealt damage this way', text: 'dealt damage this way' }, dmg)).toBe(true);
  });
});

describe('T19 renderer: the nouns of a filter with `anyOf` (design 3.3: the other fields hold for every alternative)', () => {
  it('"attacking or blocking creature" is a creature', () => {
    expect(nounsOf({ anyOf: [{ attacking: true }, { blocking: true }], types: ['Creature'] })).toContain('creature');
  });
  it('a bare `anyOf` keeps the nouns of its alternatives', () => {
    expect(nounsOf({ anyOf: [{ types: ['Artifact'] }, { types: ['Enchantment'] }] }).sort()).toEqual(['artifact', 'enchantment', 'permanent']);
  });
  it('"~ deals 3 damage to target attacking or blocking creature. If that creature would die this turn, exile it instead." is automated', () => {
    const f = spell('~ deals 3 damage to target attacking or blocking creature. If that creature would die this turn, exile it instead.');
    expect(fullyAutomated(f), JSON.stringify(f.gate)).toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('T19 design 6.10: examples are synthetic', () => {
  /** Patterns without a hole can be written one way only: their examples necessarily repeat a real line, so only the lines around them are invented. */
  const LITERAL = new Set(T19.filter((t) => !t.pattern.includes('{')).map((t) => t.id));
  it('no example or counter-example of a template with holes is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura)\b/g, '~').trim());
        }
      }
    }
    const verbatim = T19.filter((t) => !LITERAL.has(t.id)).flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
