/**
 * Lane trek, round trek-21 (the Star Trek cards revealed since 2026-10-29): the template data of parser/templates/zz-cloud/trek-21.json and what finishes the cards around it:
 *  - "If you would draw a card, you may instead choose land or nonland and reveal cards from the top of your library until you reveal a card of the chosen kind. Put that card into your hand
 *    and put all other cards revealed this way on the bottom of your library in a random order." (rep.trek21.draw.chooseKind.random; Pavel Chekov, First Posting);
 *  - "It enters with X additional {kind} counters on it if it's a creature and X additional {kind} counters on it if it's a Spacecraft, where X is ..." (rid.trek21.entersWith.xCreatureSpacecraft; Chief Montgomery Scott);
 *  - "You may cast an instant or sorcery spell from among them without paying its mana cost." after "Target opponent exiles the top X cards of their library" (eff.trek21.exiledTop.cast.filtered.free; Lieutenant Nyota Uhura);
 *  - "That player may exile it." (eff.trek21.player.mayExile.spell; Brazen Bluff);
 *  - the readings that are not templates: a "When you do" after a delayed trigger joins it (parser/lower/conditions.ts#absorbReflexiveIntoDelay; U.S.S. Farragut) and "that card" the
 *    cost sacrificed (ObjRef costSacrificed with card: true; The Guardian of Forever).
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate (G6); every counter-example does not parse or parses to
 * different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10). The behavior is in trek-21-scenarios.test.ts. CR cites checked against the 2026-09-25 text.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/trek-21.json';
import review from '../../m5/golden/cards/trek-21-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 4;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** The spell ability of a sorcery. */
const parse = (text: string, type = /^(If|As long as) /.test(text) ? 'Enchantment' : 'Sorcery') => parseCard(card('Example Ooze', type, text), OPTS).faces[0]!;
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`) || g.verified.includes(`${id})`)).map((g) => g.card);

describe('trek-21 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/trek-21.json, in path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/trek-21.json');
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.trek21.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|rep|rid)\.trek21\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 DEVIATION (named in the round record, accepted by the owner on 2026-10-24 for single-printing Star Trek wordings): each wording is printed on one card, so the template is stable on one hand-verified golden card plus these tests', () => {
    expect(MECH.filter((x) => x.status === 'stable').map((t) => t.id).sort()).toEqual(MECH.map((t) => t.id).sort());
    expect(evidence('rep.trek21.draw.chooseKind.random')).toEqual(['Pavel Chekov, First Posting']);
    expect(evidence('rid.trek21.entersWith.xCreatureSpacecraft')).toEqual(['Chief Montgomery Scott']);
    expect(evidence('eff.trek21.exiledTop.cast.filtered.free')).toEqual(['Lieutenant Nyota Uhura']);
    expect(evidence('eff.trek21.player.mayExile.spell')).toEqual(['Brazen Bluff']);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'same']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('trek-21 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parse(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parse(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parse(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} this turn.`];
  const swaps: [RegExp, string][] = [
    [/random order/, 'any order'], [/if it's a creature/, "if it's an artifact"], [/exiles the top/, 'exiles the bottom'], [/may exile/, 'may sacrifice'], [/Target opponent/, 'Each opponent'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('trek-21 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/this turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parse(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parse(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('trek-21 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // a counter kind is any word
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          const f = parse(mutated);
          expect(fullyAutomated(f) && !JSON.stringify(f.abilities).includes('"kind":"manual"'), mutated).toBe(false);
        });
      }
    });
  }
});

describe('trek-21 guard G2 on the whole cards: a nonsense word in any place of the cards own text never leaves them full (a counter kind is any word, so the word before "counter" is not mutated)', () => {
  const CARDS: { name: string; type: string; cost: string; text: string; pt?: [string, string] }[] = [
    { name: 'Pavel Chekov, First Posting', type: 'Legendary Creature — Human Pilot', cost: '{2}{W}', pt: ['2', '2'], text: 'If you would draw a card, you may instead choose land or nonland and reveal cards from the top of your library until you reveal a card of the chosen kind. Put that card into your hand and put all other cards revealed this way on the bottom of your library in a random order.' },
    { name: 'Chief Montgomery Scott', type: 'Legendary Creature — Human Artificer', cost: '{3}{U}', pt: ['2', '3'], text: '{6}, {T}: You may put a creature or Spacecraft card from your hand onto the battlefield. It enters with X additional +1/+1 counters on it if it\'s a creature and X additional charge counters on it if it\'s a Spacecraft, where X is the number of differently named lands you control.' },
    { name: 'Lieutenant Nyota Uhura', type: 'Legendary Creature — Human Officer', cost: '{2}{U}', pt: ['2', '2'], text: '{4}, {T}: Target opponent exiles the top X cards of their library, where X is the number of differently named lands you control. You may cast an instant or sorcery spell from among them without paying its mana cost. Then that player puts the rest on the bottom of their library in a random order.' },
    { name: 'Brazen Bluff', type: 'Instant', cost: '{1}{R}', text: 'Choose target noncreature spell an opponent controls. That player may exile it. If they don\'t, you may cast a noncreature spell from your hand without paying its mana cost.' },
    { name: 'The Guardian of Forever', type: 'Legendary Artifact Creature — Construct', cost: '{4}', pt: ['0', '4'], text: 'Defender\n{4}, Sacrifice another nontoken creature: Return that card to the battlefield under its owner\'s control at the beginning of the next end step.' },
    { name: 'U.S.S. Farragut, Bold Explorer', type: 'Legendary Artifact — Spacecraft', cost: '{3}{G}', text: 'Landfall — Whenever a land you control enters, you may put a creature card from your hand onto the battlefield. That creature gains haste. At the beginning of the next end step, put it on the bottom of your library. When you do, draw a card.\nStation\n7+ | Flying' },
  ];
  const level = (c: (typeof CARDS)[number], text: string): { level: string; manualPart: boolean } => {
    const def = compileCard({ name: c.name, layout: 'normal', mana_cost: c.cost, type_line: c.type, oracle_text: text, colors: [], ...(c.pt ? { power: c.pt[0], toughness: c.pt[1] } : {}) } as OracleCard);
    return { level: def.automation.level, manualPart: JSON.stringify(def.faces).includes('"kind":"manual"') || JSON.stringify(def.faces).includes('"op":"manual"') };
  };
  for (const c of CARDS) {
    it(`${c.name}: as printed it is full, with no manual part; replacing any one word by an invented word is never full`, () => {
      expect(level(c, c.text)).toEqual({ level: 'full', manualPart: false });
      const words = c.text.split(' ');
      words.forEach((w, i) => {
        if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // a counter kind is any word
        const lead = w.match(/^["\n]+/)?.[0] ?? '';
        const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
        const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
        const r = level(c, mutated);
        expect(r.level === 'full' && !r.manualPart, mutated).toBe(false);
      });
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('trek-21 design 6.10 (local index): synthetic examples', () => {
  it('no line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
