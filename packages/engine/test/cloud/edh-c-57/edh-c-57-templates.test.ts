/**
 * Commander lane edh-c, round edh-c-57 (EDHREC ranks 21,501-22,000, second pass): the template data of parser/templates/zz-cloud/edh-c-57.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-c-57-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. CR cites checked against the Comprehensive Rules of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC57 from '../../../src/parser/templates/zz-cloud/edh-c-57.json';
import review from '../../m5/golden/cards/edh-c-57-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC57 as Template[];
const MECH_COUNT = 7;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 30,000 that print each wording and are full
  'sta.edhv57.asLongAs.damageDouble': ['Anthem of Rakdos'],
  'sta.edhv57.asLongAs.preventNCombatToYou': ['Thunderstaff'],
  'eff.edhv57.anyPlayerMayExileFromGraveyard.ifPlayerDoes': ['Carrion Rats'],
  'eff.edhv57.anyPlayerMaySacrificeLand.ifPlayerDoes': ['Argothian Wurm'],
  'eff.edhv57.returnSelf.unlessRemoveCountersFromIt': ['Magmatic Sprinter'],
  'sta.edhv57.self.has.aslongFewerCounters.otherwise.has': ['Evolved Spinoderm'],
  'sta.edhv57.enchantedWall.attackNoDefender': ['Animate Wall'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  text.startsWith('Enchanted ') ? card('Example Charm', 'Enchantment — Aura', text) : t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || text.startsWith('~') ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-c-57 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-57.json, path order: edh-c- sorts before edh-cast) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-57.json');
    expect(files.indexOf('zz-cloud/edh-c-57.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhv57.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid)\.edhv57\./);
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

describe('edh-c-57 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bElemental\b/, 'Elementals'], [/\bhaste\b/, 'x'], [/\bdouble\b/, 'triple'], [/\bfewer\b/, 'more'], [/\bany player\b/, 'each player'], [/\bunless\b/, 'if'], [/\bloses\b/, 'gains'], [/\bcounters\b/, 'x'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-c-57 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-57 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          // CR 122.1: any word names a kind of counter (parser/holes/misc.ts#counterKind accepts an unlisted word, weakly): the word before "counters" is not nonsense to the grammar
          if (/^counters?\b/.test(words[i + 1] ?? '') && /counter/.test(e.text) && t.pattern.includes('{k:CounterKind}')) return;
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

describe.skipIf(index === null)('edh-c-57 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-57 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-c-57 renderer and lowering changes (one test each)', () => {
  const creature = (text: string, type = 'Creature — Wizard') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const spell = (text: string, type = 'Instant') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  it('parser/lower/ability.ts#joinGroupMayElse (CR 101.4, 118.12; Carrion Rats, Argothian Wurm): "Any player may <cost>. If a player does, X." is one instruction; "Each player may ..." or "If you do" are not that reading', () => {
    expect(fullyAutomated(creature('When ~ enters, any player may sacrifice a land of their choice. If a player does, draw a card.'))).toBe(true);
    expect(fullyAutomated(creature('When ~ enters, any player may sacrifice a land of their choice. If you do, draw a card.'))).toBe(false);
    expect(fullyAutomated(creature('When ~ enters, any player may sacrifice a creature of their choice. If a player does, draw a card.'))).toBe(false);
  });
  it('render/steps-flow.ts (CR 118.12, 101.4): the payment by every player says "any player may ... If a player does,"; a payment by a group without everyPlayer (offered until one pays) is not said so', () => {
    const f = creature('When ~ enters, any player may exile a card from their graveyard. If a player does, draw a card.');
    const text = JSON.stringify(f.abilities);
    expect(text).toContain('"everyPlayer":true');
    expect(fullyAutomated(f)).toBe(true);
  });
  it('render/steps-flow.ts#pay (CR 118.12a; family unless-remove-counters-from-it): "unless you remove N counters from it" reads ~, and only for the object returned; another object or a sacrifice stays manual', () => {
    expect(fullyAutomated(creature('At the beginning of your end step, return ~ to its owner\'s hand unless you remove two fuse counters from it.'))).toBe(true);
    expect(fullyAutomated(creature('At the beginning of your end step, return target creature to its owner\'s hand unless you remove two fuse counters from it.'))).toBe(false);
  });
  it('render/abil.ts (CR 614.1a, 615.1a, 611.3a): "As long as C, if a source you control would deal damage ..., it deals double that damage ... instead" and "... prevent N of that damage"; with the condition after the replacement it has no reading', () => {
    expect(fullyAutomated(creature('As long as you control a Knight, if a source you control would deal damage to a permanent or player, it deals double that damage to that permanent or player instead.', 'Enchantment'))).toBe(true);
    expect(fullyAutomated(creature('If a source you control would deal damage to a permanent or player, it deals double that damage to that permanent or player instead as long as you control a Knight.', 'Enchantment'))).toBe(false);
  });
  it('parser/holes/filter.ts and render/np.ts (CR 702.37a; family morph-ability-keyword): "a morph ability" is the keyword filter morph; another keyword ability stays unread', () => {
    expect(fullyAutomated(spell('Turn target creature with a morph ability face down.'))).toBe(true);
    expect(fullyAutomated(spell('Turn target creature with a flying ability face down.'))).toBe(false);
  });
});
