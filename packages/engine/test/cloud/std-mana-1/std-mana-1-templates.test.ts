/**
 * Lane std-mana, round std-mana-1: the template data of parser/templates/zz-cloud/std-mana-1.json (riders on mana spent on a spell, "any type that artifact
 * token / permanent produced", "loses all land types and abilities and has ..." with a leading or trailing duration, "if you tap a basic land for mana, it
 * produces three times / twice as much of that mana instead", "<player> adds N mana of the chosen color for each ...").
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-mana-1-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdMana1 from '../../../src/parser/templates/zz-cloud/std-mana-1.json';
import review from '../../m5/golden/cards/cloud-std-mana-1-review.json';
import t43 from '../../m5/golden/cards/fast5-t43-review.json'; // Kinnan, Bonder Prodigy's entry (updated by this round)
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdMana1 as Template[];
const MECH_COUNT = 11;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'rid.stdmana1.spent.gains.eot': 'Carnelian Orb of Dragonkind',
  'eff.stdmana1.mana.producedType.artifactToken': 'Roxanne, Starfall Savant',
  'eff.stdmana1.mana.producedType.permanent': 'Kinnan, Bonder Prodigy',
  'eff.stdmana1.losesLandTypesAbilities.has.leadDur': 'Ultima, Origin of Oblivion',
  'sta.stdmana1.tapForMana.threeTimes': 'Virtue of Strength // Garenbrig Growth',
  'eff.stdmana1.mana.chosen.player.forEach': 'Radiant Lotus',
  'rid.stdmana1.spent.any.gains.eot': 'Generator Servant', // p2-promote-1 (golden also Arena of Glory; the two cards that print it)
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (an instant); the others are abilities of a creature (static, activated, triggered; "~ gains" needs a creature). */
const SPELL = new Set<string>();
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Instant', text), OPTS) : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('std-mana-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-mana-1.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-mana-1.json');
    expect(files.indexOf('zz-cloud/std-mana-1.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-mana-1.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are (eff|sta|rid).stdmana1.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid)\.stdmana1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = [...(review as { card: string; verified: string; expect?: string }[]), ...(t43 as { card: string; verified: string; expect?: string }[]).filter((g) => g.card === 'Kinnan, Bonder Prodigy')];
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

describe('std-mana-1 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bthat mana\b/, 'this mana'], [/\bany of that mana\b/, 'all of that mana'], [/\bspent on\b/, 'spent to activate'], [/\bcan't be countered\b/, "can't be copied"],
    [/\bartifact token\b/, 'creature token'], [/\bany type\b/, 'any color'], [/\bland types\b/, 'creature types'], [/\band abilities\b/, 'and colors'],
    [/\bthree times\b/, 'twice'], [/\btwice\b/, 'three times'], [/\bbasic land\b/, 'nonbasic land'], [/\bone or more\b/, 'two or more'],
    [/\bthe chosen color\b/, 'any color'], [/\bsacrificed this way\b/, 'exiled this way'], [/\byou control\b/, 'an opponent controls'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-mana-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('std-mana-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('std-mana-1 design 6.10 (local index): synthetic examples', () => {
  it('no std-mana-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


describe('std-mana-1 parser and renderer changes (one test each)', () => {
  const full = (text: string, type = 'Enchantment'): boolean => fullyAutomated(parseCard(card('Example Relic', type, text), OPTS).faces[0]!);
  it('render/steps-zones.ts#tokenAbilityWords (CR 111.4): two quoted token abilities print the first without its full stop, as Oracle does', () => {
    expect(full('When ~ enters, create a colorless artifact token named Ember Shard with "When this token enters, you gain 1 life" and "{T}: Add {R}."')).toBe(true);
    expect(full('When ~ enters, create a colorless artifact token named Ember Shard with "When this token enters, you gain 1 life." and "{T}: Add {R}."')).toBe(false);
  });
  it('parser/holes/event.ts (CR 106.12): "you tap a creature for mana" asks for the {T} of the activation; a land keeps the plain reading', () => {
    const json = (t: string): string => JSON.stringify(parseCard(card('Example Relic', 'Enchantment', t), OPTS).faces[0]!.abilities);
    expect(json('Whenever you tap a creature for mana, add an additional {G}.')).toContain('"manaAbility":true,"tapped":true');
    expect(json('Whenever you tap a Forest for mana, add an additional {G}.')).not.toContain('"tapped"');
    expect(full('Whenever you tap a creature for mana, add an additional {G}.')).toBe(true);
  });
  it('parser/holes/event.ts, render/evt.ts (CR 106.12): "you tap a land for {C}" is an activation that produced {C}; a nonland permanent for {C} is read only with the {T} it had (edh-perms-1: `tapped` beside `produced`)', () => {
    expect(JSON.stringify(parseCard(card('Example Relic', 'Enchantment', 'Whenever you tap a land for {C}, add an additional {C}.'), OPTS).faces[0]!.abilities)).toContain('"produced":"C"');
    expect(full('Whenever you tap a land for {G}, you gain 1 life.')).toBe(true);
    // edh-perms-1 (Forsaken Monument): a permanent that is not a land may have mana abilities without {T}, so the reading asks for the {T} the activation had
    const artifact = parseCard(card('Example Relic', 'Enchantment', 'Whenever you tap an artifact for {C}, add an additional {C}.'), OPTS).faces[0]!;
    expect(full('Whenever you tap an artifact for {C}, add an additional {C}.')).toBe(true);
    expect(JSON.stringify(artifact.abilities)).toContain('"tapped":true');
    expect(JSON.stringify(artifact.abilities)).toContain('"produced":"C"');
  });
  it('parser/lower/anaphora.ts#sentenceReferences (CR 611.2b): a leading "for as long as that land ..." does not count as a second reference of the sentence', () => {
    const f = parseCard(card('Example Relic', 'Creature — Golem', 'Whenever ~ attacks, put a rust counter on target land. For as long as that land has a rust counter on it, it loses all land types and abilities and has "{T}: Add {B}."'), OPTS).faces[0]!;
    expect(automated(f.abilities)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"affects":{"ref":"target","id":"t0"}');
  });
});
