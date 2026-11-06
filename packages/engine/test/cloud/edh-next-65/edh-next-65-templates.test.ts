/**
 * Commander lane copy, second round, edh-next-65: the template data of parser/templates/zz-cloud/edh-next-65.json ("Each X spell you cast has replicate. The replicate cost is equal to its mana cost.",
 * Djinn Illuminatus, Hatchery Sliver, Ian Chesterton; "When you next cast an instant or sorcery spell this turn, copy that spell X times / an additional time", Storm King's Thunder, Howl of the Horde;
 * "Copy the next ... spell you cast this turn when you cast it. If ~ was kicked, copy that spell twice instead.", Sea Gate Stormcaller; "Whenever you activate an ability of an artifact, if it isn't a mana
 * ability, ...", Kurkesh; the enter-as-a-copy riders, Protean Raider, Wall of Stolen Identity, Moritte of the Frost; "Copy target instant or sorcery spell, except that the copy is red", Fork) and the
 * parser, renderer and engine changes of the round (one test each at the end). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every
 * counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are
 * synthetic wordings (design 6.10). The behavior is in edh-next-65-scenarios.test.ts. CR cites from memory unless the record names them (unverified).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext65 from '../../../src/parser/templates/zz-cloud/edh-next-65.json';
import review from '../../m5/golden/cards/edh-next-65-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext65 as Template[];
const MECH_COUNT = 10;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only one
 * or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (decided by the owner's standing rule 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhn65.next.cast.copy.xTimes': ["Storm King's Thunder"],
  'eff.edhn65.next.cast.copy.additional': ['Howl of the Horde'],
  'eff.edhn65.next.spell.copy.filter': ['Sea Gate Stormcaller'],
  'rid.edhn65.instead.nextSpell.copy.twice': ['Sea Gate Stormcaller'],
  'trg.edhn65.you.activate.abilityOf.ifNotMana': ['Kurkesh, Onakke Ancient'],
  'rep.edhn65.enters.copy.except.tapCopied': ['Wall of Stolen Identity'],
  'rep.edhn65.enters.copy.ifCond': ['Protean Raider'],
  'eff.edhn65.copy.spell.exceptColor': ['Fork'],
  'rep.edhn65.enters.copy.legendarySnow.counters': ['Moritte of the Frost'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (a sorcery); the others are abilities of a creature (static, triggered, replacement). */
const SPELL = new Set<string>(['eff.edhn65.next.cast.copy.xTimes', 'eff.edhn65.next.cast.copy.additional', 'eff.edhn65.next.spell.copy.filter', 'rid.edhn65.instead.nextSpell.copy.twice', 'eff.edhn65.copy.spell.exceptColor']);
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id)
    ? parseCard(card('Example Plan', 'Sorcery', text, { mana_cost: '{X}{R}' }), OPTS)
    : parseCard(card('Example Relic', 'Legendary Artifact Creature — Golem Villain', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-next-65 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-65.json, path order: after edh-next-6, before edh-next-7) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-65.json');
    expect(files.indexOf('zz-cloud/edh-next-65.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-6.json'));
    expect(files.indexOf('zz-cloud/edh-next-65.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-7.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are eff.edhn65.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|rst|trg|rep)\.edhn65\./);
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

describe('edh-next-65 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-next-65 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-65 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-next-65 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-65 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-next-65 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Sorcery', name = 'Example Plan') => parseCard(card(name, type, text), OPTS).faces[0]!;
  const creature = (text: string) => parseCard(card('Example Relic', 'Legendary Artifact Creature — Golem Villain', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('keywords/expand.ts, model/cap-walk.ts, render/mods.ts (CR 702.56a, 118.9): replicate with its cost equal to the spell\'s mana cost is read for the keyword replicate only, and only in the pair of sentences', () => {
    const base = 'Each instant and sorcery spell you cast has replicate. The replicate cost is equal to its mana cost.';
    expect(fullyAutomated(creature(base))).toBe(true);
    expect(fullyAutomated(creature(base.replace('replicate', 'storm').replace('replicate', 'storm')))).toBe(false);
    expect(fullyAutomated(creature(base.replace('Each instant and sorcery spell you cast', 'Each instant and sorcery spell your opponents cast')))).toBe(false);
    expect(fullyAutomated(creature('Each instant and sorcery spell you cast has replicate. The replicate cost is equal to its power.'))).toBe(false);
  });
  it('render/steps-zones.ts (CR 707.10; Howl of the Horde): "an additional time" is the wording of an explicit single copy only', () => {
    const base = 'When you next cast an instant or sorcery spell this turn, copy that spell an additional time. You may choose new targets for the copy.';
    expect(fullyAutomated(face(base))).toBe(true);
    expect(JSON.stringify(face(base).abilities)).toContain('"count":1');
    expect(fullyAutomated(face(base.replace('an additional time', 'two additional times')))).toBe(false);
  });
  it('render/steps-lasting.ts, steps-flow.ts, render/self-replacement.ts, parser/lower/riders.ts (CR 603.7b, 614.15, 707.10c; Sea Gate Stormcaller): the kicked-twice-instead pair is read only after the filtered "copy the next ... when you cast it" sentence, and the new targets belong to both copies', () => {
    const base = 'Kicker {4}{U}\nWhen this creature enters, copy the next instant or sorcery spell with mana value 2 or less you cast this turn when you cast it. If this creature was kicked, copy that spell twice instead. You may choose new targets for the copies.';
    const c = (t: string) => parseCard(card('Example Wizard', 'Creature — Human Wizard', t, { power: '2', toughness: '1' }), OPTS).faces[0]!;
    expect(fullyAutomated(c(base))).toBe(true);
    expect(fullyAutomated(c(base.replace('copy that spell twice instead', 'copy that spell three times instead')))).toBe(false);
    expect(fullyAutomated(c(base.replace('If this creature was kicked, copy that spell twice instead. ', '')))).toBe(false); // the plural "copies" needs the second sentence
  });
  it('render/refs.ts, parser/holes/cost.ts (CR 606.3, 701.9a; Chandra\'s Regulator): "that ability" of a loyalty ability of a planeswalker of a subtype, and a discard cost of two descriptions each with its article', () => {
    const t = "Whenever you activate a loyalty ability of a Chandra planeswalker, you may pay {1}. If you do, copy that ability. You may choose new targets for the copy.";
    expect(fullyAutomated(creature(t))).toBe(true);
    expect(fullyAutomated(creature(t.replace('copy that ability', 'copy another ability')))).toBe(false);
    const d = '{1}, {T}, Discard a Mountain card or a red card: Draw a card.';
    expect(fullyAutomated(creature(d))).toBe(true);
    expect(JSON.stringify(creature(d.replace('or a red card', 'or two red cards')).abilities)).toContain('"manual"');
    expect(JSON.stringify(creature(d.replace('Mountain card', 'Mountain')).abilities)).toContain('"manual"');
  });
  it('render/stat.ts, effects/enters-parts/copy.ts (CR 603.12, 611.2b, 400.7; Wall of Stolen Identity): the steps after the choice to copy are the tap and hold of the copied creature, said only of a copy of a creature, with the Wall that entered as the source', () => {
    const wall = "You may have this creature enter as a copy of any creature on the battlefield, except it's a Wall in addition to its other types and has defender. When you do, tap the copied creature and it doesn't untap during its controller's untap step for as long as you control this creature.";
    expect(fullyAutomated(creature(wall))).toBe(true);
    expect(fullyAutomated(creature(wall.replace('any creature', 'any artifact')))).toBe(false);
    expect(fullyAutomated(creature(wall.replace('tap the copied creature and it', 'the copied creature')))).toBe(false);
  });
  it('render/stat.ts (CR 707.9e, 707.9f; Moritte of the Frost): the legendary, snow, counters and changeling exceptions are one wording, never a part of it', () => {
    const m = "You may have this creature enter as a copy of a permanent you control, except it's legendary and snow in addition to its other types and, if it's a creature, it enters with two additional +1/+1 counters on it and has changeling.";
    expect(fullyAutomated(creature(m))).toBe(true);
    expect(fullyAutomated(creature(m.replace(' and has changeling', '')))).toBe(false);
    expect(fullyAutomated(creature(m.replace('legendary and snow', 'legendary')))).toBe(false);
  });
  it('render/copy-except.ts (CR 707.9b, 105.3; Fork): a spell copy is of one color said "except that the copy is red"; two colors, or a type, are not read', () => {
    const f = 'Copy target instant or sorcery spell, except that the copy is red. You may choose new targets for the copy.';
    expect(fullyAutomated(face(f))).toBe(true);
    expect(JSON.stringify(face(f).abilities)).toContain('"set":["R"]');
    expect(JSON.stringify(face(f.replace('red', 'blue')).abilities)).toContain('"set":["U"]');
    expect(fullyAutomated(face(f.replace('red', 'red and blue')))).toBe(false);
  });
});
