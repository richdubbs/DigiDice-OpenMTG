/**
 * std-typechange-1 (lane std-typechange: type and ability changes): the template data of parser/templates/zz-cloud/std-typechange-1.json (an Aura's "loses all
 * abilities and is a ... artifact creature with base power and toughness N/N in addition to its other types", "as long as <condition>, <object> can't be turned
 * face up", "loses all abilities and is a <subtype> with base power and toughness N/N and "<ability>" named <name>", and "Creatures you control are the chosen type
 * in addition to their other types. The same is true for creature spells you control and creature cards you own that aren't on the battlefield."), and the
 * parser and renderer changes of the round (the Cond reading "is face down / face up", the within-sentence focus after a tap, the renderer readings).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-typechange-1-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdTc1 from '../../../src/parser/templates/zz-cloud/std-typechange-1.json';
import review from '../../m5/golden/cards/std-typechange-1-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdTc1 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'sta.stdtc1.loseall.isTypes.basept.inAddition': 'Unable to Scream',
  'sta.stdtc1.aslong.cantTurnFaceUp': 'Unable to Scream',
  'sta.stdtc1.loseall.isSubtype.basept.has.named': 'Honest Work',
  'sta.stdtc1.chosenType.inaddition.sameIsTrue.spellsAndCards': 'Leyline of Transformation',
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/**
 * Templates whose examples are abilities of an enchantment that chooses a creature type as it enters (that line, printed on real cards, is added here so the
 * examples stay synthetic, design 6.10); the others are an Aura's abilities (its "Enchant creature" line is added the same way).
 */
const ENCHANTMENT = new Set(['sta.stdtc1.chosenType.inaddition.sameIsTrue.spellsAndCards']);
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (ENCHANTMENT.has(t.id) ? parseCard(card('Example Bloom', 'Enchantment', `As this enchantment enters, choose a creature type.\n${text}`), OPTS)
    : parseCard(card('Example Shackle', 'Enchantment — Aura', `Enchant creature\n${text}`), OPTS)).faces[0]!;

describe('std-typechange-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-typechange-1.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-typechange-1.json');
    expect(files.indexOf('zz-cloud/std-typechange-1.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-typechange-1.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are sta.stdtc1.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^sta\.stdtc1\./);
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

describe('std-typechange-1 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bmay\b/, 'must'], [/\bremains tapped\b/, 'remains untapped'], [/\bcharge counter\b/, 'charge counters'], [/\bfirst\b/, 'second'], [/\bless\b/, 'more'],
    [/\bhexproof\b/, 'shroud'], [/\bdon't trigger\b/, 'trigger'], [/\bpower\b/, 'toughness'], [/\battack as though\b/, 'block as though'],
    [/\bactivated abilities of all\b/, 'triggered abilities of all'], [/\bany color\b/, 'any type'], [/\byou control\b/, 'an opponent controls'],
    [/\bany number of\b/, 'all'], [/\bin addition to\b/, 'instead of'], [/\blose control\b/, 'gain control'],
    [/\bface down\b/, 'face up'], [/\bturned face up\b/, 'turned face down'], [/\bloses all abilities\b/, 'loses flying'], [/\bartifact creature\b/, 'enchantment creature'],
    [/\bcreature spells you control\b/, 'creature spells you own'], [/\bcreature cards you own\b/, 'creature cards you control'], [/\baren't on the battlefield\b/, 'are on the battlefield'],
    [/\bnamed\b/, 'called'], [/\bis tapped\b/, 'is untapped'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-typechange-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('std-typechange-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('std-typechange-1 design 6.10 (local index): synthetic examples', () => {
  it('no std-typechange-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

const json = (v: unknown): string => JSON.stringify(v);
const aura = (text: string) => parseCard(card('Example Shackle', 'Enchantment — Aura', `Enchant creature\n${text}`), OPTS).faces[0]!;

describe('std-typechange-1 parser change: the Cond reading "<object> is face down / face up" (CR 708.2, 708.3)', () => {
  it('"As long as enchanted creature is face down, ..." is the face-down status of the enchanted creature, now', () => {
    const f = aura("As long as enchanted creature is face down, it doesn't untap during its controller's untap step.");
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f.abilities)).toContain('"condition":{"cond":"matches","object":{"ref":"attachedTo"},"filter":{"faceDown":true}}');
  });
  it('"... is face up, ..." is the other status', () => {
    const f = aura("As long as enchanted creature is face up, it doesn't untap during its controller's untap step.");
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f.abilities)).toContain('"filter":{"faceDown":false}');
  });
  it('a negated "isn\'t face down" is not read as "is face down"', () => {
    const f = aura("As long as enchanted creature isn't face down, it doesn't untap during its controller's untap step.");
    expect(json(f.abilities)).not.toContain('"filter":{"faceDown":true}');
  });
});

describe('std-typechange-1 lowering change (CR 608.2c): the pronoun of an instruction joined by "and" to a tap or untap of the enchanted creature', () => {
  it('"When ~ enters, untap enchanted creature and put a +1/+1 counter on it" puts the counter on the enchanted creature', () => {
    const f = aura('When this Aura enters, untap enchanted creature and put a +1/+1 counter on it.');
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f.abilities)).toContain('{"op":"putCounters","on":{"ref":"attachedTo"}');
  });
  it('with "then" between the instructions the focus does not decide (two candidates, manual)', () => {
    const f = aura('When this Aura enters, untap enchanted creature, then put a +1/+1 counter on it.');
    expect(json(f.abilities)).not.toContain('{"op":"putCounters","on":{"ref":"attachedTo"}');
    expect(json(f.abilities)).not.toContain('{"op":"putCounters","on":{"ref":"self"}');
  });
  it('a target instruction is not a tap of the attached object: "tap target creature and put a stun counter on it" binds the target as before', () => {
    const f = aura('When this Aura enters, tap target creature and put a stun counter on it.');
    expect(json(f.abilities)).not.toContain('"on":{"ref":"attachedTo"}');
  });
});

describe('std-typechange-1 renderer changes (render/mods.ts; families loseall-base-add, loseall-identity-with-named)', () => {
  it('the "same is true" sentence is said only for exactly creatures you control, creature spells you control and creature cards you own off the battlefield', () => {
    const f = parseCard(card('Example Bloom', 'Enchantment', 'As this enchantment enters, choose a creature type.\nCreatures you control are the chosen type in addition to their other types. The same is true for creature spells you control and creature cards you own that aren\'t on the battlefield.'), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(true);
    expect(f.gate.every((g) => g.ok)).toBe(true);
  });
  it('an identity that grants an ability but sets no name keeps its own wording (no "named")', () => {
    const f = aura('Enchanted creature loses all abilities and is a Citizen with base power and toughness 1/1 and "{T}: Add {C}".');
    expect(json(f.abilities)).not.toContain('"named"');
  });
});
