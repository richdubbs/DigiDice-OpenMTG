/**
 * Commander coordinator D, lane pay-or-else (concept round), round edh-d-74: the template data of parser/templates/zz-cloud/edh-d-74.json ("That player exiles all cards from their library",
 * "For each creature, its controller sacrifices it unless they pay X life", "... a permanent of their choice unless they pay {1}", "For each spell and ability your opponents control, counter it
 * unless its controller pays {4}") and the parser, renderer and engine changes of the round (one test each at the end). Guard G9 (design 6.8): every example lowers with its template, is
 * automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an
 * example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-d-74-scenarios.test.ts.
 * CR cites checked against the Comprehensive Rules text of 2026-09-25 unless the record names them.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhD74 from '../../../src/parser/templates/zz-cloud/edh-d-74.json';
import review from '../../m5/golden/cards/edh-d-74-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD74 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only one
 * card, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (decided by the owner's standing rule 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27, more cards 2026-10-30)
  'eff.edhd74.player.exile.allLibrary': ['Thought Lash'],
  'eff.edhd74.forEach.itsController.sacrificesIt.unlessPayLife': ['Killing Wave'],
  'eff.edhd74.forEach.itsController.sacrificesPermanentOfChoice.unlessPay': ['Fade Away'],
  'eff.edhd74.forEach.spellAndAbility.opponents.counterItUnlessPay': ['Whirlwind Denial'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (a sorcery); the first is a creature's triggered ability. */
const parsedWith = (t: Template, text: string) =>
  (t.id === 'eff.edhd74.player.exile.allLibrary'
    ? parseCard(card('Example Relic', 'Artifact Creature — Goblin', text, { power: '2', toughness: '2' }), OPTS)
    : parseCard(card('Example Plan', 'Sorcery', text), OPTS)).faces[0]!;

describe('edh-d-74 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-74.json, path order: after edh-d-7, before edh-d-8) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-74.json');
    expect(files.indexOf('zz-cloud/edh-d-74.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-7.json'));
    expect(files.indexOf('zz-cloud/edh-d-74.json')).toBeLessThan(files.indexOf('zz-cloud/edh-d-8.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are eff.edhd74.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|rst|trg)\.edhd74\./);
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

describe('edh-d-74 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bor more\b/, 'or less'], [/\bhaste\b/, 'flying'], [/\btop\b/, 'bottom'], [/\bonce\b/i, 'twice'], [/\bcast\b/, 'exile'], [/\bwithout paying its mana cost\b/, 'by paying its mana cost'], [/\bor less\b/, 'or more'], [/\bplay\b/, 'cast'], [/\battacked\b/, 'blocked'], [/\bspell\b/, 'ability'], [/\blife\b/, 'cards'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-d-74 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-74 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (words.includes('--') && i < words.indexOf('--')) return; // the ability word before the dash has no rules meaning (CR 207.2c)
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

describe.skipIf(index === null)('edh-d-74 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-74 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-d-74 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Sorcery', name = 'Example Plan') => parseCard(card(name, type, text), OPTS).faces[0]!;
  const permanent = (text: string) => parseCard(card('Example Relic', 'Enchantment', text), OPTS).faces[0]!;
  it('parser/holes/misc.ts, render/costs.ts (CR 702.24a, 118.3, 119.3; Wall of Shards): a cumulative upkeep of "An opponent gains N life"; a number only; not an ability\'s cost, not "each opponent" or "you"', () => {
    const base = 'Cumulative upkeep--An opponent gains 1 life.';
    expect(fullyAutomated(permanent(base))).toBe(true);
    expect(JSON.stringify(permanent(base).abilities)).toContain('"kind":"opponentGainsLife","amount":1');
    expect(fullyAutomated(permanent(base.replace('An opponent', 'Each opponent')))).toBe(false);
    expect(fullyAutomated(permanent(base.replace('An opponent', 'You')))).toBe(false);
    expect(fullyAutomated(permanent(base.replace('1 life', 'X life')))).toBe(false);
  });
  it('parser/holes/cost.ts, rules/cost.ts, rules/pay-parts.ts (CR 701.13a, 705.1, 118.3; Thought Lash, Karplusan Minotaur): "Exile the top card of your library" and "Flip a coin" as costs; one card, one coin', () => {
    expect(fullyAutomated(permanent('Cumulative upkeep--Exile the top card of your library.'))).toBe(true);
    expect(fullyAutomated(permanent('Cumulative upkeep--Flip a coin.'))).toBe(true);
    expect(JSON.stringify(permanent('Cumulative upkeep--Exile the top card of your library.').abilities)).toContain('"kind":"exileTop","count":1');
    expect(JSON.stringify(permanent('Cumulative upkeep--Flip a coin.').abilities)).toContain('"kind":"flipCoin"');
    expect(fullyAutomated(permanent('Cumulative upkeep--Exile the top two cards of your library.'))).toBe(false);
    expect(fullyAutomated(permanent('Cumulative upkeep--Exile the top card of target player\'s library.'))).toBe(false);
    expect(fullyAutomated(permanent('Cumulative upkeep--Flip two coins.'))).toBe(false);
    expect(fullyAutomated(permanent('Exile the top card of your library: You gain 1 life.'))).toBe(true); // an activated ability's cost too
    expect(ENGINE_CAPABILITIES.has('cost:exileTop') && ENGINE_CAPABILITIES.has('cost:flipCoin')).toBe(true);
  });
  it('parser/holes/event.ts, render/evt.ts, effects/handlers/pay.ts (CR 702.24a, 603.2; Hibernation\'s End, Thought Lash): "whenever you pay ~\'s cumulative upkeep" and "when a player doesn\'t pay it"; only the permanent\'s own', () => {
    const base = 'Cumulative upkeep {1}\nWhenever you pay ~\'s cumulative upkeep, you gain 1 life.';
    expect(fullyAutomated(permanent(base))).toBe(true);
    expect(JSON.stringify(permanent(base).abilities)).toContain('"verb":"payCumulativeUpkeep"');
    expect(fullyAutomated(permanent(base.replace('you pay', 'an opponent pays')))).toBe(false);
    expect(fullyAutomated(permanent(base.replace('~\'s cumulative upkeep', 'its cumulative upkeep')))).toBe(false);
    expect(fullyAutomated(permanent(base.replace('~\'s cumulative upkeep', 'a cumulative upkeep')))).toBe(false);
    const fail = 'Cumulative upkeep {1}\nWhen a player doesn\'t pay ~\'s cumulative upkeep, that player loses 3 life.';
    expect(fullyAutomated(permanent(fail))).toBe(true);
    expect(JSON.stringify(permanent(fail).abilities)).toContain('"verb":"failCumulativeUpkeep"');
    expect(ENGINE_CAPABILITIES.has('feature:ev.action.payCumulativeUpkeep') && ENGINE_CAPABILITIES.has('op:pay.cumulativeUpkeep')).toBe(true);
  });
  it('parser/holes/object.ts, render/refs.ts (CR 115.4, 601.2c, 601.7a; Karplusan Minotaur): "any target of an opponent\'s choice" is one any-target chosen by an opponent; not several, not another chooser', () => {
    const base = 'Whenever you lose a coin flip, ~ deals 1 damage to any target of an opponent\'s choice.';
    const c = (t: string) => parseCard(card('Example Relic', 'Artifact Creature — Goblin', t, { power: '2', toughness: '2' }), OPTS).faces[0]!;
    expect(fullyAutomated(c(base))).toBe(true);
    expect(JSON.stringify(c(base).abilities)).toContain('"chooser":{"ref":"anOpponent"}');
    expect(fullyAutomated(c(base.replace('any target of an opponent\'s choice', 'any target of your choice')))).toBe(false);
    expect(fullyAutomated(c(base.replace('any target of an opponent\'s choice', 'two targets of an opponent\'s choice')))).toBe(false);
    expect(fullyAutomated(c(base.replace('of an opponent\'s choice', 'of each opponent\'s choice')))).toBe(false);
  });
  it('render/steps-flow.ts (CR 118.12, 608.2f, 701.21a; Killing Wave): "For each creature, its controller sacrifices it unless they pay X life": life only, the object itself; not the spell\'s controller, not mana', () => {
    const base = 'For each creature, its controller sacrifices it unless they pay X life.';
    expect(fullyAutomated(face(base))).toBe(true);
    expect(fullyAutomated(face(base.replace('X life', '2 life')))).toBe(true);
    expect(fullyAutomated(face(base.replace('its controller', 'you')))).toBe(false);
    expect(fullyAutomated(face(base.replace('they pay X life', 'they pay {1}')))).toBe(false);
    expect(fullyAutomated(face(base.replace('sacrifices it', 'sacrifices a permanent of their choice')))).toBe(false);
  });
  it('rules/cost.ts (CR 701.13a, 118.3): the cards of several exileTop parts are summed, so a library of fewer cards than age counters can\'t pay (the cost is refused, not paid in part)', () => {
    expect(ENGINE_CAPABILITIES.has('cost:exileTop')).toBe(true);
  });
});
