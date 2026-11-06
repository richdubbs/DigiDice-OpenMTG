/**
 * Commander lane edh-perms, round edh-perms-14: the template data of parser/templates/zz-cloud/edh-perms-14.json ("Other creatures you control enter with an additional +1/+1 counter on them for each
 * mana from a Treasure spent to cast them"; "Each creature you control enters with an additional +1/+1 counter on it for each mana from an artifact source spent to cast it"; "Players can't get
 * counters"; "Counters can't be put on artifacts, creatures, enchantments, or lands"; "create a token that's a copy of ..., except it's 1/1 and it's a Nightmare in addition to its other types").
 * The hole, lowering and renderer changes (the copy exception "with <abilities>", the guarded counter said instruction first, "that spell" named only after the pronoun, an attach never to a spell,
 * "Auras attached to permanents you control", the entering permanent as the subject of its counters' quantities) are tested at the end of this file and in edh-perms-14-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-perms-14-scenarios.test.ts. CR cites checked against the 2026-09-25 text (media.wizards.com).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhPm14 from '../../../src/parser/templates/zz-cloud/edh-perms-14.json';
import review from '../../m5/golden/cards/edh-perms-14-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhPm14 as Template[];
const MECH_COUNT = 5;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'rep.edhpm14.enter.additionalCounter.forManaFrom.plural': ['Kalain, Reclusive Painter'],
  'rep.edhpm14.enter.additionalCounter.forManaFromSource': ['Coin of Mastery'],
  'rst.edhpm14.players.cant.getCounters': ['Solemnity'],
  'rst.edhpm14.counters.cant.bePutOn': ['Solemnity'],
  'eff.edhpm14.copy.token.basePT.andSubtype': ['Nightmare Shepherd'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: an enchantment for a static, a creature for a trigger, a spell otherwise. */
const parsedWith = (t: Template, text: string) => {
  if (t.kind === 'static') return parseCard(card('Example Relic', 'Enchantment', text), OPTS).faces[0]!;
  if (/^(Whenever this creature|When ~ enters)/.test(text)) return parseCard(card('Example Soldier', 'Creature — Soldier', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  return parseCard(card('Example Plan', 'Instant', text), OPTS).faces[0]!;
};

describe('edh-perms-14 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-perms-14.json, path order: after edh-perms-12, before edh-perms-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-perms-14.json');
    expect(files.indexOf('zz-cloud/edh-perms-14.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-perms-12.json'));
    expect(files.indexOf('zz-cloud/edh-perms-14.json')).toBeLessThan(files.indexOf('zz-cloud/edh-perms-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are eff.edhpm14.* (or rep., sta.)', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|rst)\.edhpm14\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
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

describe('edh-perms-14 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-perms-14 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-perms-14 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-perms-14 design 6.10 (local index): synthetic examples', () => {
  it('no edh-perms-14 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.replace(/\s*\([^)]*\)/g, '').trim());
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

describe('edh-perms-14 parser, lowering and renderer changes (one test each)', () => {
  const one = (text: string, type = 'Creature — Spirit') => parseCard(card('Example Relic', type, text, { power: '1', toughness: '1' }), OPTS).faces[0]!;
  it('effects/eval.ts + effects/bodies/m5.ts + model/lint-nodes.ts (CR 601.2h, 106.3, 614.12): the mana spent for an entering permanent is read for the permanent a replacement applies to ({ref:"subject"} in the counters of an enters body); in any other place the subject stays refused', () => {
    const ok = one('Other Elves you control enter with an additional +1/+1 counter on them for each mana from a Clue spent to cast them.', 'Enchantment');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"q":"spellManaSpent","of":{"ref":"subject"},"from":{"subtypes":["Clue"]}');
    // outside an entering replacement the object being modified is not a spell: no reading
    expect(fullyAutomated(one('Other Elves you control get +1/+1 for each mana from a Clue spent to cast them.', 'Enchantment'))).toBe(false);
    // a card type is a source too, a mana ability's "color of mana" is not a source
    expect(fullyAutomated(one('Each Elf you control enters with an additional +1/+1 counter on it for each mana from a land source spent to cast it.', 'Enchantment'))).toBe(true);
    expect(fullyAutomated(one('Each Elf you control enters with an additional +1/+1 counter on it for each white mana spent to cast it.', 'Enchantment'))).toBe(false);
  });
  it('parser/holes/p2copyperm1.ts + render (CR 707.9b, 613.1f): a copy exception "it\'s a 4/4 Dragon creature with flying in addition to its other types" gives the type, the base power and toughness and the keyword; "with" needs the types and "in addition" after it', () => {
    const ok = one("Create a token that's a copy of target permanent, except it's a 4/4 Dragon creature with flying in addition to its other types.", 'Sorcery');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"layer":6,"add":[{"kind":"keyword","keyword":"flying"');
    expect(fullyAutomated(one("Create a token that's a copy of target permanent, except it's a 4/4 Dragon creature with flying.", 'Sorcery'))).toBe(false); // the types would be set, not added
    expect(fullyAutomated(one("Create a token that's a copy of target permanent, except it's a 4/4 with flying in addition to its other types.", 'Sorcery'))).toBe(false); // no type for the abilities
    expect(fullyAutomated(one("Create two tokens that are copies of target permanent, except they're 4/4 Dragons with flying in addition to their other types.", 'Sorcery'))).toBe(false); // (not read for several tokens)
  });
  it('render/steps.ts (CR 122.1, 608.2c): a guarded counter put on a target is also said instruction first, "put a +1/+1 counter on target creature if it\'s legendary"; the condition names "it"', () => {
    const ok = one("Put a +1/+1 counter on target creature you control if it's legendary. Then it fights target creature an opponent controls.", 'Instant');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"guard":{"cond":"matches","object":{"ref":"target","id":"t0"},"filter":{"supertypes":["Legendary"]}}');
    expect(fullyAutomated(one("Put a +1/+1 counter on target creature you control if it's legendary and then it fights target creature an opponent controls.", 'Instant'))).toBe(false);
  });
  it('parser/lower/anaphora.ts (design 6.4): "that spell" named only after the pronoun is no antecedent of "it"; the token the sentence before made is; and a spell on the stack is never what an attachment is attached to', () => {
    const ok = one("Whenever you cast an instant or sorcery spell, create a 0/0 green and blue Fractal creature token. Put X +1/+1 counters on it, where X is that spell's mana value.", 'Creature — Fractal');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"kind":"+1/+1","count":{"q":"stat","stat":"manaValue","of":{"ref":"event","role":"spell"}}');
    // the spell named BEFORE the pronoun is still a candidate: two candidates, manual
    expect(fullyAutomated(one("Whenever you cast an instant or sorcery spell, create a 0/0 green and blue Fractal creature token. Put X +1/+1 counters on that spell's controller's it.", 'Creature — Fractal'))).toBe(false);
    const cutter = one('Whenever you cast your second spell each turn, create a 1/1 white Monk creature token with prowess. You may attach this Equipment to it.', 'Artifact — Equipment');
    expect(fullyAutomated(cutter)).toBe(true);
    expect(JSON.stringify(cutter.abilities)).toContain('"op":"attach","what":{"ref":"self"},"to":{"ref":"bound"');
    // with no token made, "it" would be the spell: an Equipment is not attached to a spell
    expect(fullyAutomated(one('Whenever you cast your second spell each turn, you may attach this Equipment to it.', 'Artifact — Equipment'))).toBe(false);
  });
  it('parser/holes/filter.ts + render/np.ts (CR 303.4, 301.5): "Auras attached to permanents you control" is any Aura attached to one permanent of that description; a description with no controller is not read', () => {
    const ok = one('Auras attached to permanents you control have umbra armor.', 'Creature — Wizard');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"attachedToObject":{"ref":"each","filter":{"controller":"you"}}');
    expect(fullyAutomated(one('Auras attached to permanents have umbra armor.', 'Creature — Wizard'))).toBe(false);
    expect(fullyAutomated(one('Auras attached to creatures you control have umbra armor.', 'Creature — Wizard'))).toBe(true);
    expect(fullyAutomated(one('Auras attached to nonland permanents you control have umbra armor.', 'Creature — Wizard'))).toBe(false);
  });
  it('render/stat.ts (CR 122.1, 122.6, 614.17): the ban on counters is said "players can\'t get counters" for every player and "counters can\'t be put on <permanents>" for a description; other players are not read this way', () => {
    expect(fullyAutomated(one("Players can't get counters.", 'Enchantment'))).toBe(true);
    expect(fullyAutomated(one("Counters can't be put on creatures you control.", 'Enchantment'))).toBe(true);
    expect(fullyAutomated(one("Opponents can't get counters.", 'Enchantment'))).toBe(false);
    expect(fullyAutomated(one("Players can't get poison counters.", 'Enchantment'))).toBe(false);
  });
});
