/**
 * Standard round F (slot F of the parallel rounds F-J, the Standard cards of its list that were not full): the template data of
 * parser/templates/zz-cloud/std-rf.json and the parser, lowering and renderer support it needed. Guard G9 (design 6.8): every example lowers with its template, is
 * automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense
 * word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when
 * it is present. The behavior is in std-rf-scenarios.test.ts.
 *
 *   parser/segment.ts#keywordItems          "Enchant creature, land, or planeswalker" is one keyword line, not a list of keywords (CR 702.5a, 205.2a)
 *   parser/lower/scope.ts#roleObject, render/refs.ts#roleIn
 *                                           the object of "Whenever you discard a card" is a card: "that card" (CR 701.9a, 400.7)
 *   statics/match.ts, render/refs.ts#spellsYouCast
 *                                           the zone a spell was cast from in a static ability's filter (CR 601.2a)
 *   render/mods.ts#continuous               "is a colorless land with "..." and loses all other card types and abilities" (CR 205.1a, 613.1d)
 *   render/mods.ts#activatedOfSentence      "has all activated abilities of the exiled card" (CR 607.2a, 613.1f)
 *   render/np.ts                            "a permanent you own that your opponents control" (CR 108.3, 109.4)
 *   render/abil.ts#eventAndAtStep           "Whenever ~ transforms into ~ and at the beginning of your first main phase" (CR 603.2, 503.1)
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRf from '../../../src/parser/templates/zz-cloud/std-rf.json';
import review from '../../m5/golden/cards/cloud-std-rf-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RF = stdRf as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: an Aura for a line of "Enchant ...", an artifact for a card that exiles, else a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (/^Enchant /.test(text)) return card('Example Charm', 'Enchantment — Aura', text);
  if (t.id.startsWith('sta.stdrf.has.allActivatedOf')) return card('Example Relic', 'Artifact', text);
  return card('Example Brute', 'Creature — Dragon', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const face = (type: string, text: string) => parseCard(card('Example Brute', type, text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
const auraFace = (text: string) => parseCard(card('Example Charm', 'Enchantment — Aura', text), OPTS).faces[0]!;

describe('std-rf template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rf.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rf.json');
    expect(files.indexOf('zz-cloud/std-rf.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-rf.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are sta.stdrf.* or trg.stdrf.*', () => {
    expect(RF.length).toBe(4);
    for (const t of RF) {
      expect(t.id, t.id).toMatch(/^(sta|trg)\.stdrf\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: at least one hand-verified golden card that uses it (a narrow wording: one card each, named in the round record)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of RF.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RF) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'tapped', 'attacking']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-rf guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RF) {
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

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\bwhenever\b/, 'whenever an opponent'], [/\bfrom your hand\b/, 'from your graveyard'], [/\bInstant\b/, 'Creature'], [/\bcolorless\b/, 'black'], [/\bland\b/, 'artifact'],
    [/\bexiled\b/, 'chosen'], [/\bYou\b/, 'Target opponent'], [/\ball\b/, 'each'], [/\bhave\b/, 'lose'], [/\bactivated\b/, 'triggered'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rf guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RF) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
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

describe('std-rf guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RF) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^"?\{/.test(w) || w.includes('\n')) return;
          const end = w.match(/[.,:"]+$/)?.[0] ?? '';
          const start = w.startsWith('"') ? '"' : '';
          const mutated = [...words.slice(0, i), `${start}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-rf parser, lowering and renderer support', () => {
  const abilityJson = (f: ReturnType<typeof face>): string => JSON.stringify(f.abilities);
  it('CR 702.5a, 205.2a: "Enchant creature, land, or planeswalker" is ONE keyword whose object is the three kinds; a list of keywords is still a list', () => {
    const f = auraFace('Enchant creature, land, or planeswalker');
    expect(fullyAutomated(f)).toBe(true);
    expect(f.abilities.length).toBe(1);
    expect(abilityJson(f)).toContain('"keyword":"enchant"');
    expect(abilityJson(f)).toContain('"filter":{"types":["Creature","Land","Planeswalker"]}');
    // two kinds with "or" (unchanged) and the same three kinds in another order
    expect(abilityJson(auraFace('Enchant creature, planeswalker, or land'))).toContain('"filter":{"types":["Creature","Planeswalker","Land"]}');
    expect(abilityJson(auraFace('Enchant creature or land'))).toContain('"filter":{"types":["Creature","Land"]}');
    // a keyword list keeps its meaning: "Flying, trample" is two keywords
    expect(face('Creature — Dragon', 'Flying, trample').abilities.length).toBe(2);
    // a list that is no kind of object is no Enchant (not a keyword line)
    expect(fullyAutomated(auraFace('Enchant creature, blorfty, or land'))).toBe(false);
  });
  it('CR 701.9a, 400.7: the object of "Whenever you discard a card" is a card: "that card", never "that creature" or "that permanent"', () => {
    const ok = face('Creature — Dragon', 'Whenever you discard a card, you may exile that card.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(abilityJson(ok)).toContain('"what":{"ref":"event","role":"subject"}');
    expect(fullyAutomated(face('Creature — Dragon', 'Whenever you discard a card, you may exile that creature.'))).toBe(false);
    expect(fullyAutomated(face('Creature — Dragon', 'Whenever you discard a card, you may exile that permanent.'))).toBe(false);
    // "it" is unchanged
    expect(jsonKey(face('Creature — Dragon', 'Whenever you discard a card, you may exile it.').abilities)).toBe(jsonKey(ok.abilities));
  });
  it('CR 601.2a, 707.10: the zone a spell was cast from is a field a static ability reads (`castFrom` of the filter); "from your hand" is that zone', () => {
    const f = face('Creature — Dragon', 'Instant spells you cast from your hand have cascade.');
    expect(fullyAutomated(f)).toBe(true);
    expect(abilityJson(f)).toContain('"castFrom":"hand"');
    expect(fullyAutomated(face('Creature — Dragon', 'Instant spells you cast from your graveyard have cascade.'))).toBe(false);
    expect(abilityJson(face('Creature — Dragon', 'Instant spells you cast have cascade.'))).not.toContain('castFrom');
  });
  it('CR 108.3, 109.4: "for each permanent you own that your opponents control" counts the permanents you own and an opponent controls', () => {
    const f = face('Creature — Dragon', 'At the beginning of your upkeep, you gain 1 life for each permanent you own that your opponents control.');
    expect(fullyAutomated(f)).toBe(true);
    expect(abilityJson(f)).toContain('"filter":{"owner":"you","controller":"opponent"}');
    expect(fullyAutomated(face('Creature — Dragon', 'At the beginning of your upkeep, you gain 1 life for each permanent you control that your opponents own.'))).toBe(false);
  });
  it('CR 607.2a: "the exiled card" of a static ability needs exactly one exiling ability on the card (an unlinked reader stays manual)', () => {
    const linked = parseCard(card('Example Relic', 'Artifact', 'When ~ enters, exile target artifact you control.\n~ has all activated abilities of the exiled card.'), OPTS).faces[0]!;
    expect(fullyAutomated(linked)).toBe(true);
    expect(JSON.stringify(linked.abilities[0])).toContain('"link":"exiled"');
    const alone = parseCard(card('Example Relic', 'Artifact', '~ has all activated abilities of the exiled card.'), OPTS).faces[0]!;
    expect(fullyAutomated(alone)).toBe(false);
    const two = parseCard(card('Example Relic', 'Artifact', 'When ~ enters, exile target artifact you control.\n{T}: Exile target land you control.\n~ has all activated abilities of the exiled card.'), OPTS).faces[0]!;
    expect(fullyAutomated(two)).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-rf design 6.10 (local index): synthetic examples', () => {
  it('no std-rf line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Vehicle)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = RF.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
