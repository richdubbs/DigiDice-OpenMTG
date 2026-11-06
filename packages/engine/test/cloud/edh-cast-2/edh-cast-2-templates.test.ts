/**
 * Commander lane edh-cast, round edh-cast-2: the template data of parser/templates/zz-cloud/edh-cast-2.json ("You can't cast additional spells this turn", "if you casting or
 * copying an instant or sorcery spell causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time", "put ~ into its owner's
 * library fifth / seventh from the top") and the parser, renderer and engine changes of the round (one test each at the end). Guard G9 (design 6.8): every example lowers
 * with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ;
 * a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when
 * it is present. The behavior is in edh-cast-2-scenarios.test.ts. CR cites checked against the Comprehensive Rules 2026-09-25 (media.wizards.com), see the record.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhCast2 from '../../../src/parser/templates/zz-cloud/edh-cast-2.json';
import review from '../../m5/golden/cards/edh-cast-2-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhCast2 as Template[];
const MECH_COUNT = 3;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'eff.edhc2.player.cant.cast.additional': ['Conduit of Worlds'],
  'sta.edhc2.triggerMod.cast.orCopy': ['Veyran, Voice of Duality'],
  'eff.edhc2.put.ownersLibrary.seventhFromTop': ['Approach of the Second Sun'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (an instant); the others are abilities of a creature (static, activated, triggered; "~ gains" needs a creature). */
const SPELL = new Set<string>(['eff.edhc2.player.cant.cast.additional', 'eff.edhc2.put.ownersLibrary.seventhFromTop']);
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Sorcery', text), OPTS) : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-cast-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-cast-2.json, path order: after cmd5, before look3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-cast-2.json');
    expect(files.indexOf('zz-cloud/edh-cast-2.json')).toBeGreaterThan(files.indexOf('zz-cloud/cmd5.json'));
    expect(files.indexOf('zz-cloud/edh-cast-2.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.edhc2.* (or sta., cm.)', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm)\.edhc2\./);
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

describe('edh-cast-2 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bseventh\b/, 'sixth'], [/\bcasting or copying\b/, 'casting'], [/\bcasting or copying\b/, 'copying'], [/\byou controls?\b/, 'an opponent controls'],
    [/\bthis turn\b/, 'until your next turn'], [/\bits owner's\b/, 'your'], [/\bcan't\b/, 'can'], [/\bfrom the top\b/, 'from the bottom'], [/\binstant\b/, 'creature'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-cast-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-cast-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-cast-2 design 6.10 (local index): synthetic examples', () => {
  it('no edh-cast-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-cast-2 parser and renderer changes (one test each)', () => {
  const face = (text: string, type = 'Instant', name = 'Example Plan') => parseCard(card(name, type, text), OPTS).faces[0]!;
  it('parser/holes/object.ts and render/refs.ts (CR 115.1, 109.4): "target spell or nonland permanent an opponent controls" / "you don\'t control" keep the controller for both halves; a lone controller word on only one half is not read', () => {
    const opp = face("Return target spell or nonland permanent an opponent controls to its owner's hand.");
    expect(fullyAutomated(opp)).toBe(true);
    expect(JSON.stringify(opp.abilities)).toContain('"filter":{"zone":["stack","battlefield"],"notTypes":["Land"],"controller":"opponent"}');
    const notMine = face("Return target spell or nonland permanent you don't control to its owner's hand.");
    expect(fullyAutomated(notMine)).toBe(true);
    expect(JSON.stringify(notMine.abilities)).toContain('"not":{"controller":"you"}');
    expect(fullyAutomated(face("Return target spell or nonland permanent you control to its owner's hand."))).toBe(false);
    expect(fullyAutomated(face("Return target spell or land an opponent controls to its owner's hand."))).toBe(false);
    expect(fullyAutomated(face("Return target spell or nonland permanent to its owner's hand."))).toBe(true); // (unchanged: FAST5 T66's reading)
  });
  it('render/stat.ts (CR 601.3; family cant-cast-additional-spells): a ban on casting is also said "additional spells"; a described spell keeps its own wording', () => {
    expect(fullyAutomated(face("You can't cast additional spells this turn."))).toBe(true);
    expect(fullyAutomated(face("Each opponent can't cast additional spells until end of turn."))).toBe(true);
    expect(fullyAutomated(face("You can't cast additional creature spells this turn."))).toBe(false);
    expect(fullyAutomated(face("You can't cast spells this turn."))).toBe(true);
  });
  it('triggers/collect.ts, model/cap-walk.ts (CR 603.2d): the cause "you casting or copying a spell" is a capability of its own (feature:triggerMod.cast); another player casting, or an extra field, is not', () => {
    expect(ENGINE_CAPABILITIES.has('feature:triggerMod.cast')).toBe(true);
    const doubler = face('If you casting or copying an instant or sorcery spell causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.', 'Artifact Creature — Golem');
    expect(fullyAutomated(doubler)).toBe(true);
    expect(JSON.stringify(doubler.abilities)).toContain('"orCopy":true');
    expect(fullyAutomated(face('If your opponents casting or copying an instant or sorcery spell causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.', 'Artifact Creature — Golem'))).toBe(false);
  });
  it('parser/parse.ts (CR 201.2): the card\'s own name after "named" is one name, so "another spell named ~ this game" parses (scope game); another name is read as that name; a different count does not', () => {
    const own = parseCard(card('Test Approach', 'Sorcery', "If you've cast another spell named Test Approach this game, you win the game."), OPTS).faces[0]!;
    expect(fullyAutomated(own)).toBe(true);
    const json = JSON.stringify(own.abilities);
    expect(json).toContain('"name":"Test Approach"');
    expect(json).toContain('"scope":"game"');
    const other = parseCard(card('Test Approach', 'Sorcery', "If you've cast another spell named Test Other this game, you win the game."), OPTS).faces[0]!;
    expect(JSON.stringify(other.abilities)).toContain('"name":"Test Other"'); // (any capitalized name is a name; only the card's own name needed the option)
    expect(fullyAutomated(parseCard(card('Test Approach', 'Sorcery', "If you've cast two other spells named Test Approach this game, you win the game."), OPTS).faces[0]!)).toBe(false);
  });
  it('render/steps-util.ts (CR 401.7): a library position counted from the top through tenth is said with its word (the seventh template reads "seventh", the rendering says it back)', () => {
    const f = face("Put target creature into its owner's library seventh from the top.");
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"position":{"nth":7}');
  });
  it('parser/holes/edhc2.ts and render/fold.ts (CR 608.2c, 400.7): "the nonland cards exiled this way" names the nonland cards of the earlier exile; a card type word names that type; other words keep the sentence manual', () => {
    const exile = 'each player exiles cards from the top of their library until they exile a nonland card.';
    const f = face(`When ~ enters, ${exile} You may cast any number of spells from among the nonland cards exiled this way without paying their mana costs.`, 'Creature — Golem', 'Example Relic');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"notTypes":["Land"]');
    expect(fullyAutomated(face(`When ~ enters, ${exile} You may cast any number of spells from among the red cards exiled this way without paying their mana costs.`, 'Creature — Golem', 'Example Relic'))).toBe(false);
  });
});
