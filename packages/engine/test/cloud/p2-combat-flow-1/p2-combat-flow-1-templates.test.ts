/**
 * p2-combat-flow-1 (Phase 2 lane p2-combat-flow): the template data of parser/templates/zz-cloud/p2-combat-flow-1.json (combat damage by toughness, "Exile ~ and
 * <obj>", casting only in parts of combat, "All <creatures> block each combat if able"), and a test of the round's parser and renderer changes ("blocking it",
 * "blocked by ~", "blocking or blocked by ~", "that's attacking you", "the player or planeswalker that creature is attacking", the Arcades sentence).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in p2-combat-flow-1-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2CombatFlow1 from '../../../src/parser/templates/zz-cloud/p2-combat-flow-1.json';
import ownReview from '../../m5/golden/cards/p2-combat-flow-1-review.json';
import t5Review from '../../m5/golden/cards/t5-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = p2CombatFlow1 as Template[];
const MECH_COUNT = 10;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'sta.p2cf1.rule.toughnessDamage.each': "Huatli, the Sun's Heart",
  'sta.p2cf1.rule.toughnessDamage.each.noDefender': 'Arcades, the Strategist',
  'eff.p2cf1.toughnessDamage.thisTurn': 'Plagon, Lord of the Beach',
  'eff.p2cf1.exile.selfAndObj': 'Hunting Kavu',
  'rst.p2cf1.cast.self.combatYourTurn': 'Savage Beating',
  'rst.p2cf1.cast.self.combatOpponentTurn': 'Wake the Dead',
  'rst.p2cf1.all.must.block': 'Grand Melee',
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (an instant); the others are abilities of a creature (static, activated, triggered; "~ gains" needs a creature). */
const SPELL = new Set<string>(['rst.p2cf1.cast.self.declareBlockers', 'rst.p2cf1.cast.self.afterBlockers', 'rst.p2cf1.cast.self.combatYourTurn', 'rst.p2cf1.cast.self.combatOpponentTurn', 'rst.p2cf1.cast.self.beforeBlockers']);
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Subject', 'Instant', text), OPTS) : parseCard(card('Example Warden', 'Creature — Human Soldier', text), OPTS)).faces[0]!;

describe('p2-combat-flow-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-combat-flow-1.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-combat-flow-1.json');
    expect(files.indexOf('zz-cloud/p2-combat-flow-1.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/p2-combat-flow-1.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.p2cf1.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(sta|eff|rst)\.p2cf1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    // Grand Melee's entry is FAST1 T5's, updated in place (docs/CARD_AUTOMATION.md section 6)
    const golden = [...(ownReview as { card: string; verified: string; expect?: string }[]), ...(t5Review as { card: string; verified: string; expect?: string }[]).filter((g) => g.card === 'Grand Melee')];
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

describe('p2-combat-flow-1 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [
    [/\btoughness rather than its power\b/, 'power rather than its toughness'], [/\byour turn\b/, "an opponent's turn"], [/\ban opponent's turn\b/, 'your turn'],
    [/\bblock each\b/, 'attack each'], [/\bExile\b/, 'Destroy'], [/\bdeclare blockers\b/, 'declare attackers'], [/\bafter blockers\b/, 'before blockers'],
    [/\bthis turn\b/, 'this combat'], [/\bdefender\b/, 'flying'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
};

describe('p2-combat-flow-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('p2-combat-flow-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any word (CR 122.1): "a blorfty counter" is a counter kind, not nonsense
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('p2-combat-flow-1 design 6.10 (local index): synthetic examples', () => {
  it('no p2-combat-flow-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('p2-combat-flow-1: the parser and renderer changes of the round (CR 506.2-3, 508.1b, 509.1g-h, 510.1a)', () => {
  const face = (text: string, type = 'Creature — Human Soldier') => parseCard(card('Example Warden', type, text), OPTS).faces[0]!;
  const json = (text: string, type?: string) => JSON.stringify(bare(face(text, type).abilities));
  it('"each creature blocking it" is a blocker of the trigger\'s attacker (`blockingObject`, holes/filter.ts)', () => {
    const f = face('Whenever ~ becomes blocked, each creature blocking it gets -2/-0 until end of turn.');
    expect(fullyAutomated(f)).toBe(true);
    expect(json('Whenever ~ becomes blocked, each creature blocking it gets -2/-0 until end of turn.')).toContain('"blockingObject":{"ref":"event","role":"attacker"}');
  });
  it('"blocked by ~" and "blocking or blocked by ~" (also "blocking or being blocked by ~") are the new filter fields; a target is not a host', () => {
    expect(json('{2}: Destroy all creatures blocked by ~.')).toContain('"blockedByObject":{"ref":"self"}');
    expect(json('{2}: Destroy all creatures blocking or blocked by ~.')).toContain('"blockingOrBlockedBy":{"ref":"self"}');
    expect(fullyAutomated(face('{2}: Destroy all creatures blocking or being blocked by ~.'))).toBe(true);
    expect(fullyAutomated(face('{2}: Destroy all creatures blocked by target creature.'))).toBe(false);
  });
  it('"that\'s attacking you" and "attacking you" are attacking the player you (`attacking.defender` you); "attacking a planeswalker you control" is not read so', () => {
    expect(json("{2}: Destroy target creature without flying that's attacking you.")).toContain('"attacking":{"defender":"you"}');
    expect(json('Creatures attacking you get -1/-0.', 'Artifact')).toContain('"attacking":{"defender":"you"}');
    expect(fullyAutomated(face('{2}: Destroy target creature attacking a planeswalker you control.'))).toBe(false);
  });
  it('"the player or planeswalker that creature is attacking" is the defender of the trigger\'s attack; outside an attack trigger it stays manual', () => {
    expect(json('Whenever a creature you control attacks, ~ deals 1 damage to the player or planeswalker that creature is attacking.')).toContain('"to":{"ref":"event","role":"defender"}');
    expect(fullyAutomated(face('Whenever a creature you control dies, ~ deals 1 damage to the player or planeswalker that creature is attacking.'))).toBe(false);
  });
  it('the toughness-damage rule and the permission to attack as though without defender of one group are one sentence (render/stat.ts); of a group you don\'t control, manual', () => {
    expect(fullyAutomated(face("Each creature you control with defender assigns combat damage equal to its toughness rather than its power and can attack as though it didn't have defender."))).toBe(true);
    expect(fullyAutomated(face("Each creature with defender assigns combat damage equal to its toughness rather than its power and can attack as though it didn't have defender."))).toBe(false);
  });
});
