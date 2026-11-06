/**
 * Commander lane edh-combat, round edh-combat-2: the template data of parser/templates/zz-cloud/edh-combat-2.json ("All <lands> are <Islands> in addition to their other types",
 * "If X is N or more, also <effects>", "Each creature you control has K if it's white, ... and K if it's green") and the round's reader and renderer changes ("a creature
 * you control that's enchanted or equipped", "a player attacks one or more of your opponents", "it's blocking or blocked by a Goblin or Orc", landwalk words in "without
 * flying or islandwalk", "~ has first strike as long as it's equipped").
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to
 * different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic
 * wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-combat-2-scenarios.test.ts. CR cites from memory, unverified
 * (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhCb2 from '../../../src/parser/templates/zz-cloud/edh-combat-2.json';
import review from '../../m5/golden/cards/edh-combat-2-review.json';
import t11 from '../../m5/golden/cards/fast3-t11-review.json'; // Scion of Draco already had a golden entry there (FAST3 T11): updated, not repeated
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhCb2 as Template[];
const MECH_COUNT = 3;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'sta.edhcb2.all.are.pluralSubtype.addition': ['Stormtide Leviathan'],
  'eff.edhcb2.ifx.ormore.also': ['Finale of Glory'],
  'sta.edhcb2.eachCreature.has.perColor': ['Scion of Draco'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (a sorcery); the others are abilities of a creature. */
const SPELL = new Set<string>(['eff.edhcb2.ifx.ormore.also']);
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Sorcery', text, { mana_cost: '{X}{W}' }), OPTS) : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-combat-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-combat-2.json, path order: after edh-cast-1, before edh-mana-keywords-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-combat-2.json');
    expect(files.indexOf('zz-cloud/edh-combat-2.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-cast-1.json'));
    expect(files.indexOf('zz-cloud/edh-combat-2.json')).toBeLessThan(files.indexOf('zz-cloud/edh-mana-keywords-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are sta./eff.edhcb2.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep)\.edhcb2\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = [...(review as { card: string; verified: string; expect?: string }[]), ...(t11 as { card: string; verified: string; expect?: string }[]).filter((g) => g.card === 'Scion of Draco')];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) for (const n of NARROW[t.id]!) expect(cards, t.id).toContain(n);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'also']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-combat-2 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bin addition to\b/, 'instead of'], [/\bor more\b/, 'or less'], [/\bif it's white\b/, "if it's black"], [/\bAll\b/, 'Each'], [/\bis (\d+) or\b/, 'is $1 and'],
    [/\bhas\b/, 'loses'], [/\bYou control\b/, 'An opponent controls'], [/\byou control\b/, 'an opponent controls'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-combat-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-combat-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
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

describe.skipIf(index === null)('edh-combat-2 design 6.10 (local index): synthetic examples', () => {
  it('no edh-combat-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-combat-2 parser and renderer changes (one test each)', () => {
  const face = (text: string, type = 'Creature — Golem', name = 'Example Relic') => parseCard(card(name, type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/holes/filter.ts + render/np.ts (CR 303.4b, 301.5): "a creature you control that\'s enchanted or equipped" / "that are enchanted or equipped" is an Aura or an Equipment attached; each half alone, "and", and an opponent\'s creature are other things', () => {
    const trig = face("Whenever a creature you control that's enchanted or equipped attacks, that creature gains double strike until end of turn.");
    expect(fullyAutomated(trig)).toBe(true);
    expect(JSON.stringify(trig.abilities)).toContain('"anyOf":[{"enchanted":true},{"equipped":true}]');
    const stat = face('Creatures you control that are enchanted or equipped have double strike.');
    expect(fullyAutomated(stat)).toBe(true);
    for (const other of ["Whenever a creature you control that's enchanted attacks, that creature gains double strike until end of turn.", "Whenever a creature you control that's enchanted and equipped attacks, that creature gains double strike until end of turn.", "Whenever a creature an opponent controls that's enchanted or equipped attacks, that creature gains double strike until end of turn."]) {
      const f = face(other);
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(trig.abilities), other).toBe(false);
    }
  });
  it('parser/holes/event.ts + render/evt.ts (CR 506.2, 508.1a, 603.2c): "a player attacks one or more of your opponents" is the batch event of "one or more of your opponents are attacked"; "attacks an opponent" (one for each opponent) and "attacks you" are not', () => {
    const a = face('Whenever a player attacks one or more of your opponents, that attacking player creates a Treasure token.');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"wholeBatch":true');
    const b = face('Whenever one or more of your opponents are attacked, that attacking player creates a Treasure token.');
    expect(fullyAutomated(b)).toBe(true);
    expect(jsonKey(a.abilities)).toBe(jsonKey(b.abilities));
    for (const other of ['Whenever a player attacks an opponent, that attacking player creates a Treasure token.', 'Whenever a player attacks you, that attacking player creates a Treasure token.', 'Whenever a player attacks one or more of their opponents, that attacking player creates a Treasure token.']) {
      const f = face(other);
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(a.abilities), other).toBe(false);
    }
  });
  it('parser/holes/cond.ts + lower/static-anaphora.ts + render/cond.ts (CR 509.1g-h, 506.4): "as long as it\'s blocking or blocked by a Goblin or Orc" reads the creature in either role; "blocked by" alone, a plural description and a negation are not read', () => {
    const f = face("Equipped creature has first strike as long as it's blocking or blocked by a Goblin or Orc.", 'Artifact — Equipment');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"blockingOrBlockedBy":{"ref":"each","filter":');
    for (const other of ["Equipped creature has first strike as long as it's blocked by a Goblin or Orc.", "Equipped creature has first strike as long as it's blocking or blocked by Goblins.", "Equipped creature has first strike as long as it's not blocking or blocked by a Goblin or Orc."]) {
      expect(fullyAutomated(face(other, 'Artifact — Equipment')), other).toBe(false);
    }
  });
  it('parser/holes/filter.ts + statics/match.ts + model/cap-walk.ts (CR 702.14a): "without flying or islandwalk" names a landwalk by its land word; a made-up walk is not read', () => {
    const f = face("Creatures without flying or islandwalk can't attack.", 'Enchantment');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"notKeyword":["flying","islandwalk"]');
    expect(fullyAutomated(face("Creatures without flying or tablewalk can't attack.", 'Enchantment'))).toBe(false);
  });
  it('lower/static-anaphora.ts (CR 301.5, 611.3a): "~ has first strike as long as it\'s equipped" resolves the "it" to the object itself; with two objects named it stays manual', () => {
    const f = face("~ has first strike as long as it's equipped.");
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).not.toContain('$anaphor');
    expect(fullyAutomated(face("Equipped creature has first strike as long as target creature is equipped.", 'Artifact — Equipment'))).toBe(false);
  });
});
