/**
 * Standard round 4, slice r4-trig (trigger conditions, both halves): the template data of parser/templates/zz-cloud/r4-trig.json and the Event, Filter, Cond, Qty
 * and Player hole readings of the slice. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every
 * counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves
 * an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * r4-trig-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { CRITICAL_WORDS } from '../../../src/parser/lower/units';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import r4Trig from '../../../src/parser/templates/zz-cloud/r4-trig.json';
import review from '../../m5/golden/cards/cloud-r4-trig-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const R4 = r4Trig as Template[];
const R4_COUNT = 4; // wave 7: trg.r4trig.entersAndAt folded into std-ecl's trg.stdecl.entersAndWhenever ("when ~ enters and ( whenever | at ) ...", the same build)
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: an artifact for "~ ... it" control changes, anything else on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.id.startsWith('eff.r4trig.gainControl')) return card('Example Relic', 'Artifact', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('r4-trig template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/r4-trig.json, after r3-trig.json, before std-blb.json and zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/r4-trig.json');
    expect(files.indexOf('zz-cloud/r4-trig.json')).toBeGreaterThan(files.indexOf('zz-cloud/r3-trig.json'));
    expect(files.indexOf('zz-cloud/r4-trig.json')).toBeLessThan(files.indexOf('zz-cloud/std-blb.json'));
    expect(files.indexOf('zz-cloud/r4-trig.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.r4trig.* or trg.r4trig.*', () => {
    expect(R4.length).toBe(R4_COUNT);
    for (const t of R4) {
      expect(t.id, t.id).toMatch(/^(eff|trg)\.r4trig\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: at least one hand-verified golden card that uses it (the review file pins each card as full)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of R4.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(t.id)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
    for (const g of golden) {
      expect(g.expect, g.card).toBe('full');
      expect(g.verified, g.card).toMatch(/CR \d{3}/);
    }
  });
  it('guard G3: a critical word or phrase a pattern spells out (parser/lower/units.ts#CRITICAL_WORDS) is listed in `consumes`', () => {
    for (const t of R4) {
      const literal = ` ${t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ')} `;
      for (const w of CRITICAL_WORDS) if (literal.includes(` ${w} `)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('r4-trig guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of R4) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
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
    [/\bat least one\b/, 'at least two'], [/\bat least three\b/, 'at least four'], [/\battack,/, 'block,'], [/\buntaps it\b/, 'taps it'],
    [/\btarget opponent\b/, 'each opponent'], [/\benters and\b/, 'dies and'], [/\byour upkeep\b/, 'each upkeep'], [/\bend step\b/, 'upkeep'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('r4-trig guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of R4) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
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

describe('r4-trig guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of R4) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || /^"?\{/.test(w) || /^[+-]?\d+\/[+-]?\d+$/.test(w)) return;
          const end = w.match(/[.,:"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    }, 60_000);
  }
});

const index = localIndex();

describe.skipIf(index === null)('r4-trig design 6.10 (local index): synthetic examples', () => {
  it('no r4-trig line of an example or counter-example, and no test card line of this slice, is a line of a real card (the card\'s own name or "this <type>" read as "~")', () => {
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
    const own = [...R4.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples]), ...SAMPLES.map((x) => x[1])];
    const verbatim = own.filter((x) => x.split('\n').some((l) => lines.has(l.trim()) || lines.has(l.replace(/\bthis (creature|artifact|enchantment|Equipment)\b/g, '~').trim())));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

/** A one-card face for the parser checks below. */
const face = (type: string, text: string) => parseCard(card('Example Brute', type, text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
const json = (type: string, text: string): string => JSON.stringify(face(type, text).abilities);

/** The hole readings of this slice, each [type line, synthetic text, a JSON fragment the reading builds]. */
const SAMPLES: [string, string, string][] = [
  ['Creature — Skrull', 'Whenever another creature you control enters, if it has greater power or toughness than this creature, draw a card.', '"anyOf":[{"power":{"op":">","value":{"q":"stat","stat":"power","of":{"ref":"self"}}}},{"toughness":{"op":">","value":{"q":"stat","stat":"toughness","of":{"ref":"self"}}}}]'],
  ['Enchantment', 'Whenever a creature you control attacks a player alone, you gain 2 life.', '"defender":"any","alone":true'],
  ['Enchantment', "Whenever a creature you control attacks, put a +1/+1 counter on that creature for each card you've discarded this turn.", '"count":{"q":"happenedCount","event":{"ev":"action","verb":"discard","actor":"you"},"scope":"turn"}'],
  ['Creature — Monk', "Whenever this creature blocks, if it's the first combat phase of the turn, you gain 2 life.", '"interveningIf":{"cond":"firstCombat"}'],
  ['Enchantment', 'At the beginning of your end step, if you attacked with a Knight this turn, you gain 2 life.', '"event":{"ev":"attacks","attacker":{"subtypes":["Knight"],"controller":"you"}},"scope":"turn"'],
  ['Artifact', 'When this artifact enters, if it was cast from your graveyard, you gain 2 life.', '"interveningIf":{"cond":"wasCast","from":"graveyard","fromOwner":"you"}'],
  ['Artifact', "Whenever you're dealt damage, you gain 2 life.", '"on":[{"ev":"damage","recipient":{"player":"you"}}]'],
  ['Artifact', 'Whenever an opponent is dealt combat damage, you gain 2 life.', '"on":[{"ev":"damage","recipient":{"player":"opponent"},"combat":true}]'],
  ['Artifact', 'Whenever you solve a Case, scry 1.', '"on":[{"ev":"becomes","what":"solved","object":{"subtypes":["Case"],"controller":"you"}}]'],
  ['Enchantment', 'Whenever an enchanted creature you control attacks, scry 1.', '"attacker":{"enchanted":true,"types":["Creature"],"controller":"you"}'],
  ['Enchantment', 'Whenever a creature you control with toughness greater than its power dies, scry 1.', '"toughnessGreaterThanPower":true'],
  ['Enchantment', 'Whenever an opponent sacrifices another permanent, scry 1.', '"verb":"sacrifice","actor":"opponent","object":{"other":true}'],
  ['Enchantment', 'Whenever you play a land from anywhere other than your hand, scry 1.', '"verb":"playLand","actor":"you","notFrom":"hand"'],
  ['Enchantment', 'Whenever you cast a spell that targets a player, scry 1.', '"spell":{"targets":{"ref":"each","who":"player"}}'],
  ['Enchantment', 'Whenever one or more artifact and/or creature cards leave your graveyard, scry 1.', '"types":["Artifact","Creature"]'],
];

describe('r4-trig hole and lowering readings (no template of their own)', () => {
  it.each(SAMPLES)('%s: "%s" is automated with its reading', (type, text, fragment) => {
    const f = face(type, text);
    expect(fullyAutomated(f), `${text}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain(fragment);
  });
  it('CR 702.100a-b: "greater power or toughness than" is read only with "greater"; "lesser power or toughness" is no reading of this slice', () => {
    expect(fullyAutomated(face('Creature — Skrull', 'Whenever another creature you control enters, if it has lesser power or toughness than this creature, draw a card.'))).toBe(false);
  });
  it('CR 506.5: "attacks a planeswalker alone" is no reading (only a player defender takes "alone" after it)', () => {
    expect(json('Enchantment', 'Whenever a creature you control attacks a planeswalker alone, you gain 2 life.')).not.toContain('"alone":true');
  });
  it('CR 601.2a, 400.3: "it was cast from an opponent\'s graveyard" is no reading; "it was cast from a graveyard" names no owner', () => {
    expect(fullyAutomated(face('Artifact', "When this artifact enters, if it was cast from an opponent's graveyard, you gain 2 life."))).toBe(false);
    expect(json('Artifact', 'When this artifact enters, if it was cast from a graveyard, you gain 2 life.')).not.toContain('fromOwner');
  });
  it('CR 120.2: "you is dealt" never; only "you\'re" / "you are" dealt damage, and a player subject other than you takes "is"', () => {
    expect(fullyAutomated(face('Artifact', 'Whenever you is dealt damage, you gain 2 life.'))).toBe(false);
    expect(fullyAutomated(face('Artifact', 'Whenever you are dealt damage, you gain 2 life.'))).toBe(true);
  });
  it('CR 719.3b-c: only "you" solve a Case', () => {
    expect(fullyAutomated(face('Artifact', 'Whenever an opponent solves a Case, scry 1.'))).toBe(false);
  });
  it('CR 301.5: a bare "equipped creature" is still the host of the source Equipment, never a description', () => {
    expect(json('Artifact — Equipment', 'Whenever equipped creature attacks, scry 1.\nEquip {1}')).toContain('"attachedToSource":true');
  });
  it('CR 305.1: "play a land from anywhere other than your hand" is read only of you', () => {
    expect(fullyAutomated(face('Enchantment', 'Whenever an opponent plays a land from anywhere other than your hand, scry 1.'))).toBe(false);
  });
  it('CR 115.9b: "that targets an opponent or a creature an opponent controls" is one spell filter with two descriptions; two players or two objects are no reading', () => {
    expect(json('Enchantment', 'Whenever you cast a spell that targets an opponent or a creature an opponent controls, scry 1.')).toContain('"anyOf":[{"targets":{"ref":"each","who":"opponent"}},{"targets":{"ref":"each","filter":{"types":["Creature"],"controller":"opponent"}}}]');
    expect(fullyAutomated(face('Enchantment', 'Whenever you cast a spell that targets an opponent or a player, scry 1.'))).toBe(false);
  });
});
