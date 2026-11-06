/**
 * Commander lane edh-perms, round edh-perms-7: the template data of parser/templates/zz-cloud/edh-perms-7.json ("Each creature that isn't an A, B, or C gets -1/-1 until end of turn for each
 * creature you control that's an A, B, or C"; "create a tapped token that's a copy of that card, except it's a 4/4 black Zombie"). The hole and renderer changes (copy exceptions "it's a
 * Vehicle artifact with crew 3 and it loses all other card types" and "it has vanishing 3 if that creature doesn't have vanishing", "that isn't an A, B, or C") are tested at the end of
 * this file and in edh-perms-7-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-perms-7-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhPm7 from '../../../src/parser/templates/zz-cloud/edh-perms-7.json';
import review from '../../m5/golden/cards/edh-perms-7-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhPm7 as Template[];
const MECH_COUNT = 2;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'eff.edhpm7.eachGets.shrink.foreach': ['Swarmyard Massacre'],
  'eff.edhpm7.copyToken.tapped.ptColorSubtype': ["Hashaton, Scarab's Fist"],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: an Aura or an Equipment for an attached static, an Enchantment for a trigger, else a spell. */
const parsedWith = (t: Template, text: string) => {
  if (t.id.startsWith('sta.')) return parseCard(card('Example Relic', text.includes('Equipped') ? 'Artifact — Equipment' : 'Enchantment — Aura', text), OPTS).faces[0]!;
  if (/^(At the beginning|Whenever)/.test(text)) return parseCard(card('Example Relic', 'Enchantment', text), OPTS).faces[0]!;
  return parseCard(card('Example Plan', 'Instant', text), OPTS).faces[0]!;
};

describe('edh-perms-7 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-perms-7.json, path order: after edh-perms-5) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-perms-7.json');
    expect(files.indexOf('zz-cloud/edh-perms-7.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-perms-5.json'));
    expect(files.indexOf('zz-cloud/edh-perms-7.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.edhpm7.* (or eff., sta.)', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.edhpm7\./);
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

describe('edh-perms-7 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-perms-7 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-perms-7 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-perms-7 design 6.10 (local index): synthetic examples', () => {
  it('no edh-perms-7 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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




describe('edh-perms-7 parser and renderer changes (one test each)', () => {
  const spell = (text: string, type = 'Instant') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  const permanent = (text: string) => parseCard(card('Example Relic', 'Artifact — Vehicle', text), OPTS).faces[0]!;
  const CLONE = 'You may have this Vehicle enter as a copy of a creature an opponent controls, except';
  it('parser/holes/p2copyperm1.ts + render/copy-except.ts (CR 707.9b, 205.1a): "it\'s a <subtype> <type> [with <abilities>] and it loses all other card types" sets the types and subtypes; without the tail, without a subtype or with a plural it is not read', () => {
    const ok = permanent(`${CLONE} it's a Vehicle artifact with crew 3 and it loses all other card types.`);
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"types":{"set":["Artifact"]}');
    expect(JSON.stringify(ok.abilities)).toContain('"subtypes":{"set":["Vehicle"]}');
    expect(fullyAutomated(permanent(`${CLONE} it's a Vehicle artifact and it loses all other card types.`))).toBe(true);
    expect(fullyAutomated(permanent(`${CLONE} it's a Vehicle artifact with crew 3.`))).toBe(false); // the tail is the reading
    expect(fullyAutomated(permanent(`${CLONE} it's an artifact and it loses all other card types.`))).toBe(true); // edh-next-57: the bare type with "loses all other card types" is read for "it" now (types SET, CR 205.1a) // CR 205.1a: a bare type (no subtype) is another reading
    expect(fullyAutomated(permanent(`${CLONE} it's a Vehicle artifact with crew 3 and it loses all other creature types.`))).toBe(false);
    expect(fullyAutomated(permanent(`${CLONE} they're Vehicle artifacts with crew 3 and they lose all other card types.`))).toBe(false);
    expect(fullyAutomated(permanent(`${CLONE} it's a Vehicle artifact with crew 3 and it loses all other card types and abilities.`))).toBe(false);
  });
  it('parser/holes/p2copyperm1.ts + render/copy-except.ts (CR 707.9f): "it has <keyword> if that creature doesn\'t have <that keyword>" is a conditional exception; another keyword in the condition, "that permanent" for a creature, or a second clause is not read', () => {
    const base = 'You may have this creature enter as a copy of any creature on the battlefield, except';
    const ok = spell(`${base} it has vanishing 3 if that creature doesn't have vanishing.`, 'Creature');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"if":{"notKeyword":"vanishing"}');
    expect(fullyAutomated(spell(`${base} it has vanishing 3 if that creature doesn't have flying.`, 'Creature'))).toBe(false);
    expect(fullyAutomated(spell(`${base} it has vanishing 3 if that creature has vanishing.`, 'Creature'))).toBe(false);
    expect(fullyAutomated(spell(`${base} it has vanishing 3, flying if that creature doesn't have vanishing.`, 'Creature'))).toBe(false);
  });
  it('parser/holes/filter.ts + render/np.ts (CR 205.3m): "that isn\'t a/an A, B, or C" is none of the listed creature types; a card type, an article missing and a token are not read this way (a single type is read since edh-cast-8)', () => {
    const ok = spell('Destroy each creature that isn\'t an Insect, Rat, or Spider.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"notSubtypes":["Insect","Rat","Spider"]');
    expect(fullyAutomated(spell('Destroy each creature that isn\'t a Rat.'))).toBe(true); // one type: read since edh-cast-8 (Heliod, the Radiant Dawn: "that isn't a God"), `notSubtypes: ['Rat']` as the "non-Rat" wording
    expect(fullyAutomated(spell('Destroy each permanent that isn\'t an artifact, enchantment, or land.'))).toBe(false); // card types are not creature types
    expect(fullyAutomated(spell('Destroy each creature that isn\'t a token, Rat, or Spider.'))).toBe(false);
    expect(fullyAutomated(spell('Destroy each creature that isn\'t Insect, Rat, or Spider.'))).toBe(false);
  });
  it('render/np.ts: two or more excluded creature types are said "that isn\'t an A, B, or C"; the older "non-A creature" single type keeps its wording', () => {
    const one = spell('Destroy each non-Rat creature.');
    const list = spell('Destroy each creature that isn\'t a Rat or Spider.');
    expect(fullyAutomated(one)).toBe(true);
    expect(fullyAutomated(list)).toBe(true);
    // the older wording of several excluded types still passes the render gate (review finding)
    expect(fullyAutomated(spell('Destroy target non-Vampire, non-Zombie creature.'))).toBe(true);
    expect(fullyAutomated(spell("Destroy target creature that isn't a Vampire or Zombie."))).toBe(true);
  });
});
