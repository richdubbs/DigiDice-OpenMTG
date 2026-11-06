/**
 * Commander coordinator D, round edh-d-52 (lane lands): the template data of parser/templates/zz-cloud/edh-d-52.json (see the file) and the round's parser, renderer and engine
 * changes, tested at the end of this file and in edh-d-52-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. CR cites are from memory (no rules/cr in a cloud session) and listed as
 * unverified in the round's record.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhD52 from '../../../src/parser/templates/zz-cloud/edh-d-52.json';
import review from '../../m5/golden/cards/edh-d-52-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD52 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27, more cards 2026-10-30)
  'eff.edhd52.forEach.playerCreatesN.tokens': ['Mogg Infestation'],
  'eff.edhd52.pump.andFights': ["Ent's Fury"],
  'rid.edhd52.fight.pumpBeforeIfCond': ['Savage Punch'],
  'sta.edhd52.group.areSnow': ['Rimefeather Owl'],
}
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a triggered ability on an enchantment, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'trigger' || /^(When|Whenever|At the beginning)/.test(text) || t.kind === 'static' ? card('Example Relic', 'Enchantment', text) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-d-52 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-52.json, path order: after edh-d-5.json, before edh-d-6.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-52.json');
    expect(files.indexOf('zz-cloud/edh-d-52.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-5.json'));
    expect(files.indexOf('zz-cloud/edh-d-52.json')).toBeLessThan(files.indexOf('zz-cloud/edh-d-6.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhd52.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rst|ch|rid|cm)\.edhd52\./);
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

describe('edh-d-52 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [[/\btwo\b/, 'three'], [/\bhaste\b/, 'flying'], [/\bnonbasic\b/, 'basic'], [/\bbattlefield\b/, 'graveyard'], [/\bnontoken\b/, 'token'], [/\btapped\b/, 'untapped']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-d-52 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-52 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-d-52 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-52 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


describe('edh-d-52 parser, renderer and engine changes (one test each)', () => {
  const spell = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  const perm = (text: string) => parseCard(card('Example Relic', 'Enchantment', text), OPTS).faces[0]!;
  const creature = (text: string) => parseCard(card('Example Wisp', 'Creature — Spirit', text), OPTS).faces[0]!;
  it('render/steps-life.ts (CR 122.1; family player-loses-all-counters): "target player loses all rad counters" says a removal of every counter of a kind from a player; a creature or a count is no such wording', () => {
    expect(fullyAutomated(spell('Target player loses all rad counters.'))).toBe(true);
    expect(fullyAutomated(spell('Target player loses all poison counters.'))).toBe(true);
    expect(fullyAutomated(spell('Target creature loses all +1/+1 counters.'))).toBe(false);
    expect(fullyAutomated(spell('Target player loses two rad counters.'))).toBe(false);
  });
  it('parser/holes/qty.ts, render/steps-zones.ts (CR 701.8a, 700.4, 608.2h): "For each creature that died this way" counts what the destroy of the same sentence sent to a graveyard, and only after a destroy', () => {
    expect(fullyAutomated(spell('Destroy all creatures target player controls. For each creature that died this way, that player creates two 1/1 red Goblin creature tokens.'))).toBe(true);
    expect(fullyAutomated(spell('Exile all creatures target player controls. For each creature that died this way, that player creates two 1/1 red Goblin creature tokens.'))).toBe(false);
    expect(fullyAutomated(spell('For each creature that died this way, that player creates two 1/1 red Goblin creature tokens.'))).toBe(false);
    expect(fullyAutomated(spell('Destroy all lands target player controls. For each creature that died this way, that player creates two 1/1 red Goblin creature tokens.'))).toBe(false);
  });
  it('parser/holes/cond.ts, render/cond.ts (CR 109.5, 603.4): "if that player is you" tests the player an earlier instruction named; "if that player is an opponent" stays as before', () => {
    expect(fullyAutomated(creature('Whenever ~ dies, target player gets two rad counters. If that player is you, create a Treasure token.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever ~ dies, target player gets two rad counters. If that player is your opponent, create a Treasure token.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever ~ dies, target player gets two rad counters. If that player is me, create a Treasure token.'))).toBe(false);
    expect(fullyAutomated(creature('Whenever ~ dies, if that player is you, create a Treasure token.'))).toBe(false);
  });
  it('render/steps-cards.ts (CR 121.2, 608.2h): "If you do, discard that many cards" after a may-draw of cards equal to a power is the cards that draw drew', () => {
    expect(fullyAutomated(creature('Whenever ~ attacks, you may draw cards equal to its power. If you do, discard that many cards.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever ~ attacks, you may draw cards equal to its power. If you do, discard two cards.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever ~ attacks, you may draw cards equal to its power. If you do, discard twice that many cards.'))).toBe(false);
  });
});
