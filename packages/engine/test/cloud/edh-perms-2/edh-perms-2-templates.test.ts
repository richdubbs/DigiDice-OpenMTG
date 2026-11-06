/**
 * Commander lane edh-perms, round edh-perms-2: the template data of parser/templates/zz-cloud/edh-perms-2.json ("You, <group>, and <group> have hexproof" (Shalai);
 * "<player> may draw N cards if <condition>" (Selvala)). The hole, lowering and renderer changes (protection from each color outside your commander's color identity;
 * "its power is greater than each other creature's power"; "create twice X ... tokens"; the static "it" of "for each Aura and Equipment attached to it"; the relative
 * clause "that's attached to a creature") are tested at the end of this file and in edh-perms-2-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-perms-2-scenarios.test.ts. CR cites checked
 * against the Comprehensive Rules of 2026-09-25 (media.wizards.com).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhPm2 from '../../../src/parser/templates/zz-cloud/edh-perms-2.json';
import review from '../../m5/golden/cards/edh-perms-2-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhPm2 as Template[];
const MECH_COUNT = 2;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'sta.edhpm2.youAndTwoGroups.hexproof': ['Shalai, Voice of Plenty'],
  'eff.edhpm2.player.mayDraw.if': ['Selvala, Heart of the Wilds'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (an instant); the others are abilities of a creature (static, activated, triggered; "~ gains" needs a creature). */
const SPELL = new Set<string>();
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Instant', text), OPTS) : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-perms-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-perms-2.json, path order: after edh-mana-keywords-1, before look3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-perms-2.json');
    expect(files.indexOf('zz-cloud/edh-perms-2.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-perms-1.json'));
    expect(files.indexOf('zz-cloud/edh-perms-2.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are rep.edhpm2.* (or eff., sta.)', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.edhpm2\./);
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

describe('edh-perms-2 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bremoved this way\b/, 'put this way'], [/\bfor each\b/, 'for every two'], [/\ban additional\b/, 'two additional'], [/\bany number of\b/, 'all'],
    [/\bany type\b/, 'any color'], [/\bany color\b/, 'any type'], [/\bcould produce\b/, 'produced'], [/\bland produced\b/, 'creature produced'],
    [/\byou control\b/, 'an opponent controls'], [/\ban opponent controls\b/, 'you control'], [/\bone mana\b/, 'two mana'], [/\bplus that many\b/, 'plus twice that many'], [/\bthat many\b/, 'twice that many'], [/\bone or more\b/, 'two or more'], [/\bnumber of\b/, 'number of twice'], [/\bequal to\b/, 'equal to twice'], [/\bcan't be blocked\b/, 'can be blocked'], [/\bin addition to\b/, 'instead of'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-perms-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-perms-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-perms-2 design 6.10 (local index): synthetic examples', () => {
  it('no edh-perms-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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




describe('edh-perms-2 parser, lowering and renderer changes (one test each)', () => {
  const face = (text: string, type = 'Artifact — Equipment', extra: Partial<OracleCard> = {}) => parseCard(card('Example Relic', type, text, extra), OPTS).faces[0]!;
  it('parser/holes/misc.ts#qualityAt (CR 702.16a, 903.4): "protection from each color that\'s not in your commander\'s color identity" is the quality identity:outside, granted by a layer-6 effect only', () => {
    const f = face("Equipped creature gets +3/+3 and has protection from each color that's not in your commander's color identity.");
    expect(fullyAutomated(f)).toBe(true);
    expect(jsonKey(f.abilities)).toContain('"quality":"identity:outside"');
    // not the colors IN the identity, not another player's commander
    expect(fullyAutomated(face("Equipped creature gets +3/+3 and has protection from each color that's in your commander's color identity."))).toBe(false);
    expect(fullyAutomated(face("Equipped creature gets +3/+3 and has protection from each color that's not in an opponent's commander's color identity."))).toBe(false);
    // the keyword line "Protection from each color that's not in ..." printed on the object is a form nothing registers (feature:quality.identity.printed): not automated;
    // the same words in a static ability that grants it ("~ has", "other creatures you control have") are granted by a layer-6 effect, which works out the identity
    const printed = face("Protection from each color that's not in your commander's color identity", 'Creature — Angel', { power: '2', toughness: '2' });
    expect(JSON.stringify(printed.abilities)).toContain('"quality":"identity:outside"'); // read, but the game's compiler withholds the card: the capability is not registered
    const level = compileCard(card('Example Angel', 'Creature — Angel', "Protection from each color that's not in your commander's color identity", { power: '2', toughness: '2' })).automation;
    expect(level.level).not.toBe('full');
    expect(JSON.stringify(level)).toContain('feature:quality.identity.printed');
    expect(fullyAutomated(face("Other creatures you control have protection from each color that's not in your commander's color identity.", 'Creature — Angel', { power: '2', toughness: '2' }))).toBe(true);
  });
  it('parser/holes/cond.ts#statGreaterThanEachOther (CR 208.1, 608.2c): "its power (toughness) is greater than each other creature\'s power (toughness)"; the statistic must be the same on both sides, mana value is not read', () => {
    const base = (c: string) => face(`Whenever another creature enters, its controller may draw a card if ${c}.`, 'Creature — Elf', { power: '2', toughness: '2' });
    expect(fullyAutomated(base("its power is greater than each other creature's power"))).toBe(true);
    expect(fullyAutomated(base("its toughness is greater than each other creature's toughness"))).toBe(true);
    expect(fullyAutomated(base("its power is greater than each other creature's toughness"))).toBe(false);
    expect(fullyAutomated(base("its mana value is greater than each other creature's mana value"))).toBe(false);
    expect(fullyAutomated(base("its power is greater than each creature's power"))).toBe(false); // "each creature" includes itself: never true
    const j = JSON.stringify(base("its power is greater than each other creature's power").abilities);
    expect(j).toContain('"agg":"max"'); // the greatest power of the OTHER creatures
    expect(jsonKey(base("its power is greater than each other creature's power").abilities)).toContain('"not":{"is":{"ref":"event","role":"subject"}}'); // other than the one that entered
  });
  it('render/steps-zones.ts (CR 111.2, 107.3): "create twice X ... tokens"; twice a fixed number or "three times X" is not this wording', () => {
    const f = face('Create twice X 1/1 black and green Pest creature tokens with "When this token dies, you gain 1 life."', 'Sorcery', { mana_cost: '{X}{G}' });
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"op":"*"');
    expect(fullyAutomated(face('Create three times X 1/1 black Pest creature tokens.', 'Sorcery', { mana_cost: '{X}{G}' }))).toBe(false);
  });
  it('parser/lower/static-anaphora.ts (CR 301.5, 303.4): the "it" of "for each Aura and Equipment attached to it" in an Aura or Equipment\'s own static ability is the object it is attached to; a group of other kinds is not', () => {
    const f = face('Equipped creature gets +1/+1 for each Aura and Equipment attached to it and has ward {2}.');
    expect(fullyAutomated(f)).toBe(true);
    expect(jsonKey(f.abilities)).toContain('"attachedToObject":{"ref":"attachedTo"}');
    expect(fullyAutomated(face('Equipped creature gets +1/+1 for each Aura and creature attached to it and has ward {2}.'))).toBe(false);
    expect(fullyAutomated(face('Equipped creature gets +1/+1 for each Aura and Equipment attached to it and has ward {2}. Draw a card for each Aura attached to it.'))).toBe(false);
  });
  it('parser/holes/filter.ts + render/np.ts (CR 303.4): "each Aura you control that\'s attached to a creature" is an Aura you control attached to any creature; "that\'s not attached" is not read', () => {
    const f = face("Enchanted creature gets +1/+1 for each Aura you control that's attached to a creature.", 'Enchantment — Aura');
    expect(fullyAutomated(f)).toBe(true);
    expect(jsonKey(f.abilities)).toContain('"attachedToObject":{"filter":{"types":["Creature"]},"ref":"each"}');
    expect(fullyAutomated(face("Enchanted creature gets +1/+1 for each Aura you control that's not attached to a creature.", 'Enchantment — Aura'))).toBe(false);
  });
});
