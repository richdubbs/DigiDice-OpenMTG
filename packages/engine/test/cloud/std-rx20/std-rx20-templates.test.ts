/**
 * Card wave 2, Commander lane rx20 (std-rx20): the template data of parser/templates/zz-cloud/std-rx20.json (a bare "search your library for <SearchDesc>", "If <Cond>,
 * ~ enters tapped", "scry X, where X is <Qty>", "<player> adds <mana>") and the parser, renderer and engine changes of the round ("permanent card" before a pattern's
 * "card", "the damage dealt this way", "for each opponent you have").
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-rx20-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRx20 from '../../../src/parser/templates/zz-cloud/std-rx20.json';
import review from '../../m5/golden/cards/cloud-std-rx20-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdRx20 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'rep.stdrx20.enters.tappedIf': 'Cave of the Frost Dragon',
  'eff.stdrx20.player.adds.units': "Eladamri's Vineyard",
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a sorcery for a bare instruction, a creature for a static or triggered ability. */
const parsedWith = (t: Template, text: string) => {
  const spell = t.kind === 'effect' && !/^(when|whenever|at) /i.test(text);
  return parseCard(spell ? card('Example Ritual', 'Sorcery', text) : card('Example Shaman', 'Creature — Goblin Shaman', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
};
const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Monk', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('std-rx20 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx20.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx20.json');
    expect(files.indexOf('zz-cloud/std-rx20.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-rx20.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff|rep.stdrx20.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|rep)\.stdrx20\./);
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

describe('std-rx20 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [[/\byour library\b/, 'your graveyard'], [/\bor less\b/, 'or greater'], [/\bthree or more\b/, 'three or fewer'], [/\btapped\b/, 'untapped'], [/\bScry X\b/, 'Surveil X'], [/\bthat player\b/, 'you'], [/\{R\}\{R\}/, '{R}'], [/\bwhere X\b/, 'where Y']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx20 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('std-rx20 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w)) return;
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-rx20 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx20 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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



// ---- parser/holes/filter.ts: "permanent" right before a pattern's "card" ------------------------------------------------------------------------------------------

describe('std-rx20 Filter (CR 110.4): the head "permanent" right before the word "card" of a pattern is the six permanent types', () => {
  it('"Search your library for a permanent card, ..." is full and searches for a card of a permanent type, never for any card', () => {
    const f = face('Sorcery', 'Search your library for a permanent card, put it onto the battlefield, then shuffle.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"filter":{"types":["Artifact","Battle","Creature","Enchantment","Land","Planeswalker"]}');
  });
  it('a subtype before it keeps its subtype ("a Goblin permanent card")', () => {
    const f = face('Sorcery', 'Search your library for a Goblin permanent card, put it onto the battlefield, then shuffle.');
    expect(JSON.stringify(f.abilities)).toContain('"subtypes":["Goblin"]');
    expect(JSON.stringify(f.abilities)).not.toContain('"filter":{}');
  });
});

// ---- the bare search: "search your library for <SearchDesc>" ----------------------------------------------------------------------------------------------------

describe('std-rx20 template (CR 701.23a, 107.3): eff.stdrx20.search.desc composes with the instructions after it', () => {
  it('"with mana value X or less" of a spell with {X} reads the announced X', () => {
    const f = parseCard(card('Example Recall', 'Sorcery', 'Search your library for an artifact card with mana value X or less, put it onto the battlefield, then shuffle.', { mana_cost: '{X}{U}' }), OPTS).faces[0]!;
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"manaValue":{"op":"<=","value":{"q":"X"}}');
  });
  it('a whole-sentence search template keeps its sentence (the bare reading is weak)', () => {
    const f = face('Sorcery', 'Search your library for a creature card with mana value 3 or less, put it onto the battlefield, then shuffle.');
    expect(f.templatesUsed).not.toContain('eff.stdrx20.search.desc');
  });
});

// ---- the damage dealt this way ----------------------------------------------------------------------------------------------------------------------------------

describe('std-rx20 Qty (CR 120.3, 608.2c): "the damage dealt this way" names the damage instruction right before it (q damageDealt)', () => {
  it('after a damage sentence, and in the same sentence after "and", the quantity names that damage step', () => {
    for (const text of ['~ deals 3 damage to any target. You gain life equal to the damage dealt this way.', '~ deals 4 damage to target creature and you gain life equal to the damage dealt this way.']) {
      const f = face('Sorcery', text);
      expect(fullFace(f), `${text}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
      const steps = (f.abilities[0] as unknown as { effect: { steps: { op: string; as?: string; amount?: { q?: string; step?: string } }[] } }).effect.steps;
      expect(steps[1]!.amount).toEqual({ q: 'damageDealt', step: steps[0]!.as });
    }
  });
  it('the engine capability is advertised', () => expect(ENGINE_CAPABILITIES.has('q:damageDealt')).toBe(true));
  it('with no damage instruction right before it, or after each creature dealing its own damage, the sentence stays manual (fail closed)', () => {
    expect(fullFace(face('Sorcery', 'Draw a card. You gain life equal to the damage dealt this way.'))).toBe(false);
    expect(fullFace(face('Sorcery', 'Each creature you control deals damage equal to its power to target creature. You gain life equal to the damage dealt this way.'))).toBe(false);
  });
});

// ---- for each opponent you have -----------------------------------------------------------------------------------------------------------------------------------

describe('std-rx20 Qty (CR 102.3, 608.2h): "for each opponent you have" counts each opponent (countPlayers, family opponent-you-have)', () => {
  it('a token for each opponent you have is full and counts the opponents', () => {
    const f = face('Sorcery', 'Create a 2/2 green Wolf creature token for each opponent you have.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"count":{"q":"countPlayers","of":{"ref":"each","who":"opponent"}}');
  });
  it('after "draw a card" too; "for each player you have" is no reading', () => {
    const f = face('Sorcery', 'Draw a card for each opponent you have.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('{"q":"countPlayers","of":{"ref":"each","who":"opponent"}}');
    expect(fullFace(face('Sorcery', 'Draw a card for each player you have.'))).toBe(false);
  });
});
