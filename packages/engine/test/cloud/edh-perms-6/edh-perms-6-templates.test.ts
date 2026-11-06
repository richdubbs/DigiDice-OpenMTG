/**
 * Commander lane edh-perms, round edh-perms-6: the template data of parser/templates/zz-cloud/edh-perms-6.json ("you may pay {1}{G} if this permanent is attached to a creature you
 * control"; "<player> may tap <object>"; "For as long as that creature has a shadow counter on it, it's a Wraith in addition to its other types"; "As long as ~ has a slumber counter
 * on it, it's a land"; "Creatures you don't control get -1/-1 for each slime counter on them"; "Each nontoken creature you control gets +1/+1 for each other creature you control
 * with the same name as that creature"). The hole, lowering and renderer changes ("if you didn't create a token this way", "enters untapped" of another object, "on them" of a group's
 * per-counter change, the pronoun for the equipped creature a condition tests, a condition said right after a payment) are tested at the end of this file and in
 * edh-perms-6-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-perms-6-scenarios.test.ts. CR cites from
 * memory (no rules/cr in a cloud session).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhPm6 from '../../../src/parser/templates/zz-cloud/edh-perms-6.json';
import review from '../../m5/golden/cards/edh-perms-6-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhPm6 as Template[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'eff.edhpm6.maypay.if': ['Springheart Nantuko'],
  'eff.edhpm6.player.mayTap': ['Charismatic Conqueror'],
  'eff.edhpm6.dur.is.subtypes.inAddition': ['Minas Morgul, Dark Fortress'],
  'sta.edhpm6.self.counter.isLand': ['Arixmethes, Slumbering Isle'],
  'sta.edhpm6.group.minus.perCounterOnThem': ['Toxrill, the Corrosive'],
  'sta.edhpm6.pump.foreach.otherSameName': ['Mirror Box'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a creature for a static of its own, an Artifact for a group static, a Land for an activated ability, an Enchantment for a trigger, else a spell. */
const parsedWith = (t: Template, text: string) => {
  if (t.id === 'sta.edhpm6.self.counter.isLand') return parseCard(card('Example Relic', 'Creature — Kraken', text), OPTS).faces[0]!;
  if (t.id.startsWith('sta.')) return parseCard(card('Example Relic', 'Artifact', text, { mana_cost: '{3}' }), OPTS).faces[0]!;
  if (/^(At the beginning|Whenever)/.test(text)) return parseCard(card('Example Relic', 'Enchantment', text), OPTS).faces[0]!;
  if (/^\{/.test(text)) return parseCard(card('Example Gate', 'Land', text), OPTS).faces[0]!;
  return parseCard(card('Example Plan', 'Instant', text), OPTS).faces[0]!;
};

describe('edh-perms-6 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-perms-6.json, path order: after edh-perms-3, before look3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-perms-6.json');
    expect(files.indexOf('zz-cloud/edh-perms-6.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-perms-3.json'));
    expect(files.indexOf('zz-cloud/edh-perms-6.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.edhpm6.* (or eff., sta.)', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.edhpm6\./);
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
      if (NARROW[t.id] !== undefined) for (const n of NARROW[t.id]!) expect(cards, t.id).toContain(n);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
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

describe('edh-perms-6 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bremoved this way\b/, 'put this way'], [/\bfor each\b/, 'for every two'], [/\ban additional\b/, 'two additional'], [/\bany number of\b/, 'all'],
    [/\bany type\b/, 'any color'], [/\bany color\b/, 'any type'], [/\bcould produce\b/, 'produced'], [/\bland produced\b/, 'creature produced'],
    [/\byou control\b/, 'an opponent controls'], [/\ban opponent controls\b/, 'you control'], [/\bone mana\b/, 'two mana'], [/\bplus that many\b/, 'plus twice that many'], [/\bthat many\b/, 'twice that many'], [/\bone or more\b/, 'two or more'], [/\bnumber of\b/, 'number of twice'], [/\bequal to\b/, 'equal to twice'], [/\bcan't be blocked\b/, 'can be blocked'], [/\bin addition to\b/, 'instead of'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-perms-6 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-perms-6 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-perms-6 design 6.10 (local index): synthetic examples', () => {
  it('no edh-perms-6 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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




describe('edh-perms-6 parser and renderer changes (one test each)', () => {
  const trig = (text: string, type = 'Enchantment') => parseCard(card('Example Relic', type, text), OPTS).faces[0]!;
  it('parser/holes/cond.ts + lower/conditions.ts + model/lint-flow.ts + render/cond.ts + render/steps.ts (CR 111.1, 608.2c, 118.12): "if you didn\'t create a token this way" names the ONE token creation before it, inside a payment too; none, two or a non-token is not read', () => {
    const body = 'Whenever a land you control enters, you may pay {1}{G} if this permanent is attached to a creature you control. If you do, create a token that\'s a copy of that creature.';
    const ok = trig(`${body} If you didn't create a token this way, create a 1/1 green Insect creature token.`, 'Artifact — Equipment');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"not":true');
    expect(fullyAutomated(trig('Whenever a land you control enters, you may draw a card. If you didn\'t create a token this way, you gain 2 life.'))).toBe(false); // no token creation before it
    expect(fullyAutomated(trig('Whenever a land you control enters, create a Treasure token. Create a 1/1 white Soldier creature token. If you didn\'t create a token this way, you gain 2 life.'))).toBe(false); // two of them
    expect(fullyAutomated(trig('Whenever a land you control enters, you may create a Treasure token. If you didn\'t create a token this way, you gain 2 life.'))).toBe(true); // an optional one
    expect(fullyAutomated(trig('Whenever a land you control enters, each opponent creates a Treasure token. If you didn\'t create a token this way, you gain 2 life.'))).toBe(false); // not by you
  });
  it('render/steps.ts + render/steps-flow.ts (CR 118.12): a payment\'s condition is said right after its cost; a mandatory payment, "unless" payments and payments without branches keep their wording', () => {
    const w = trig('Whenever a land you control enters, you may pay {1}{G} if this permanent is attached to a creature you control. If you do, draw a card.', 'Artifact — Equipment');
    expect(fullyAutomated(w)).toBe(true);
    expect(fullyAutomated(trig('Whenever a land you control enters, you may pay {1}{G}. If you do, draw a card.'))).toBe(true);
    expect(fullyAutomated(trig('Whenever a land you control enters, you may pay {1}{G} if you control an Elf.'))).toBe(true); // no branches: the generic trailing condition
    expect(fullyAutomated(trig('Whenever a land you control enters, you may pay {1}{G}. If you do, draw a card if this permanent is attached to a creature you control.', 'Artifact — Equipment'))).toBe(false);
    expect(fullyAutomated(trig('Whenever a land you control enters, each opponent may pay {1} if you control an Elf. If they do, draw a card.'))).toBe(false); // another player\'s payment keeps its own forms
  });
  it('render/evt.ts (CR 603.6a, 110.5b): "enters untapped" of another object is said after the verb; "enters tapped" is unchanged, and the old "untapped creature enters" wording is not read', () => {
    expect(fullyAutomated(trig('Whenever a creature an opponent controls enters untapped, you gain 1 life.'))).toBe(true);
    expect(fullyAutomated(trig('Whenever a creature an opponent controls enters tapped, you gain 1 life.'))).toBe(true);
    expect(fullyAutomated(trig('Whenever an untapped creature an opponent controls enters, you gain 1 life.'))).toBe(false);
  });
  it('render/mods.ts (CR 613.4c, 122.1): a group\'s per-counter change is "on them", a single object\'s "on it"; either way the counters are those of each affected object', () => {
    const group = trig('Creatures your opponents control get -1/-1 for each slime counter on them.', 'Artifact');
    const one = trig('Each creature an opponent controls gets -1/-1 for each slime counter on it.', 'Artifact');
    expect(fullyAutomated(group)).toBe(true);
    expect(jsonKey(group.abilities)).toBe(jsonKey(one.abilities));
    expect(fullyAutomated(trig('Creatures your opponents control get -1/-1 for each slime counter on you.', 'Artifact'))).toBe(false);
  });
  it('render/np.ts + render/equivalence.ts (CR 201.2): "with the same name as that creature" is read for "each other creature you control" of a pump on each creature; without "other" or with a different controller it is another reading', () => {
    const ok = trig('Each nontoken creature you control gets +1/+1 for each other creature you control with the same name as that creature.', 'Artifact');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"other":true');
    expect(fullyAutomated(trig('Each nontoken creature you control gets +1/+1 for each creature you control with the same name as that creature.', 'Artifact'))).toBe(false);
  });
  it('parser/lower/anaphora.ts + render/steps-flow.ts (CR 608.2c, 301.5a): in "If equipped creature is a Vampire, ... on it instead" the pronoun is the equipped creature; an event object, a different test or a target keep their rules', () => {
    const ok = trig('Whenever a creature dies, put a +1/+1 counter on equipped creature. If equipped creature is a Vampire, put two +1/+1 counters on it instead.', 'Artifact — Equipment');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"ref":"attachedTo"');
    expect(JSON.stringify(ok.abilities)).not.toContain('"role":"subject"');
    expect(fullyAutomated(trig('Whenever a creature dies, put a +1/+1 counter on equipped creature. If you control a Vampire, put two +1/+1 counters on it instead.', 'Artifact — Equipment'))).toBe(false); // the test names no object: two candidates
  });
});
