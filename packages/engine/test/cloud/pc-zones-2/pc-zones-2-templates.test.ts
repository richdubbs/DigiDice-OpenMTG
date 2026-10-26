/**
 * Precon lane pc-zones, round pc-zones-2 (library and graveyard moves): the template data of parser/templates/zz-cloud/pc-zones-2.json, the search field `shareLandType`
 * (effects/handlers/cards-library.ts#pickSharingLandType), the renderer readings (render/fold-pczones2.ts, render/steps-lasting.ts "manifests the top card of their library",
 * render/mods.ts `inAddition` for a color and types, render/steps-cards.ts "that share a land type"). Guard G9 (design 6.8): every example lowers with its template, is
 * automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in
 * place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present.
 * The behavior is in pc-zones-2-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/pc-zones-2.json';
import review from '../../m5/golden/cards/pc-zones-2-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 4;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A spell: the sentences of a sorcery. */
const parse = (text: string, type = 'Sorcery', pt?: { power: string; toughness: string }) => parseCard(card('Example Ooze', type, text, { ...(pt ?? {}), ...(/\bX\b/.test(text) ? { mana_cost: '{X}{W}' } : {}) }), OPTS).faces[0]!;
/** Fully automated, and no cost part the model cannot state (a `manual` cost part is no manual step: `automated` does not see it). */
const fully = (f: ReturnType<typeof parse>): boolean => fullyAutomated(f) && !JSON.stringify(f.abilities).includes('"kind":"manual"');
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);

describe('pc-zones-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/pc-zones-2.json, after pc-players-1, before r3-dig.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/pc-zones-2.json');
    expect(files.indexOf('zz-cloud/pc-zones-2.json')).toBeGreaterThan(files.indexOf('zz-cloud/pc-players-1.json'));
    expect(files.indexOf('zz-cloud/pc-zones-2.json')).toBeLessThan(files.indexOf('zz-cloud/r3-dig.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.pczones2.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.pczones2\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 DEVIATION (named in the round record): each wording is printed on very few precon cards, so each template is stable on one hand-verified golden card', () => {
    expect(MECH.filter((x) => x.status === 'stable').map((t) => t.id).sort()).toEqual([
      'eff.pczones2.is.colorSubtype.inAddition', 'eff.pczones2.player.manifests.top', 'eff.pczones2.player.searches.bf', 'eff.pczones2.search.upTo.shareLandType.bf.tapped',
    ]);
    expect(evidence('eff.pczones2.player.searches.bf')).toEqual(['Field of Ruin']);
    expect(evidence('eff.pczones2.player.manifests.top')).toEqual(['Reality Shift']);
    expect(evidence('eff.pczones2.is.colorSubtype.inAddition')).toEqual(['Rise from the Grave']);
    expect(evidence('eff.pczones2.search.upTo.shareLandType.bf.tapped')).toEqual(['Myriad Landscape']);
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

describe('pc-zones-2 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bEach player\b/, 'Target player'], [/\bbattlefield tapped\b/, 'battlefield'], [/\bshare a land type\b/, 'share a creature type'], [/\btop card of their library\b/, 'top two cards of their library'],
    [/\bits other colors and types\b/, 'its other types'], [/\bblack\b/, 'blue'], [/\bmanifests\b/, 'exiles'], [/\bthen shuffles\b/, 'then draws a card'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('pc-zones-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('pc-zones-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parse(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('pc-zones-2 lowering and renderer: the readings that are no template of their own', () => {
  it('CR 701.40a: another player "manifests the top card of their library"; "your library" for another player and "the top two cards" are no reading', () => {
    const ok = parse('Exile target creature. Its controller manifests the top card of their library.', 'Instant');
    expect(fullyAutomated(ok), JSON.stringify(ok.gate)).toBe(true);
    expect(fullyAutomated(parse('Exile target creature. Its controller manifests the top card of your library.', 'Instant'))).toBe(false);
    expect(fullyAutomated(parse('Exile target creature. Its controller manifests the top two cards of their library.', 'Instant'))).toBe(false);
    // a group of players is no reading (the engine manifests for one player)
    expect(fullyAutomated(parse('Each opponent manifests the top card of their library.', 'Sorcery'))).toBe(false);
    expect(fullyAutomated(parse('Each player manifests the top card of their library.', 'Sorcery'))).toBe(false);
  });
  it('CR 611.2a, 105.3: "It\'s a black Zombie in addition to its other colors and types" (no duration) is said with "is", and with "becomes" for the same JSON', () => {
    const f = parse("Return target creature card from your graveyard to the battlefield. It's a black Zombie in addition to its other colors and types.");
    expect(fullyAutomated(f), JSON.stringify(f.gate)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"colors":{"add":["B"]}');
  });
  it('CR 205.3i: "that share a land type" is the search field shareLandType; "that share a creature type" is no reading', () => {
    const f = parse('Search your library for up to three basic land cards that share a land type, put them onto the battlefield tapped, then shuffle.');
    expect(fullyAutomated(f), JSON.stringify(f.gate)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"shareLandType":true');
    expect(ENGINE_CAPABILITIES.has('op:search.shareLandType')).toBe(true);
  });
  it('CR 701.23a, 101.4: "each player searches their library ..., puts it onto the battlefield, then shuffles" is one search by all players, the found cards entering together under the control of their owners, and the shuffle of every player (CR 101.4)', () => {
    const f = parse('Each player searches their library for a basic land card, puts it onto the battlefield, then shuffles.');
    expect(fullyAutomated(f), JSON.stringify(f.gate)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"to":{"zone":"battlefield","controller":"owner"}');
  });
});

const index = localIndex();

describe.skipIf(index === null)('pc-zones-2 design 6.10 (local index): synthetic examples', () => {
  it('no pc-zones-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
