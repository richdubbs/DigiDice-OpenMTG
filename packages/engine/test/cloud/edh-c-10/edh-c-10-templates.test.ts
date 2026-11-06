/**
 * Commander lane edh-c, round edh-c-10: the template data of parser/templates/zz-cloud/edh-c-10.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-c-10-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. CR cites checked against the Comprehensive Rules of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC10 from '../../../src/parser/templates/zz-cloud/edh-c-10.json';
import review from '../../m5/golden/cards/edh-c-10-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC10 as Template[];
const MECH_COUNT = 9;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full
  'eff.edhv10.search.playerLibrary.exile': ['Extract'],
  'eff.edhv10.counter.andGoadIt': ['Bhaal, Lord of Murder'],
  'eff.edhv10.self.dealsDamage.andGains': ['Ellie, Vengeful Hunter'],
  'eff.edhv10.destroy.allOther.shareColorWithIt': ['Spreading Plague'],
  'sta.edhv10.attached.hasKeyword.toughnessDamage': ['Solid Footing'],
  'eff.edhv10.put.upToN.fromGraveyards': ['Liliana, the Necromancer'],
  'eff.edhv10.returnToOwnersHand.each.powerVsHand': ['Noetic Scales'],
  'sta.edhv10.asLongAs.preventAllDamageToYou': ['Spirit of Resistance'],
  'eff.edhv10.controllerSacrificesIt.thenTokensEqualPower': ['Mercy Killing'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || text.startsWith('~') ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-c-10 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-10.json, path order: edh-c- sorts before edh-cast) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-10.json');
    expect(files.indexOf('zz-cloud/edh-c-10.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhv10.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid)\.edhv10\./);
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

describe('edh-c-10 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bElemental\b/, 'Elementals'], [/\bhaste\b/, 'x'], [/\bdouble\b/, 'triple'], [/\bloses\b/, 'gains'], [/\bcounters\b/, 'x'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-c-10 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-10 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // edh-next-87: a counter's kind is any word (CR 122.1); "it" is the target of its sentence now, so "a blorfty counter" parses (as edh-next-76 did for edh-c-14)
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

describe.skipIf(index === null)('edh-c-10 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-10 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-c-10 renderer and lowering changes (one test each)', () => {
  const creature = (text: string, type = 'Creature — Wizard') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const spell = (text: string, type = 'Instant') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  it('render/fold-edhv10.ts (CR 120.3, 611.2a): "~ deals N damage to X and gains K until end of turn" says the subject once; a grant with no duration stays manual', () => {
    expect(fullyAutomated(creature('{0}: ~ deals 2 damage to target player and gains lifelink until end of turn.'))).toBe(true);
    expect(fullyAutomated(creature('{0}: ~ deals 2 damage to target player and gains lifelink.'))).toBe(false);
  });
  it('render/cond.ts and parser/holes/cond.ts (CR 402.1; The Biblioplex): "exactly zero or seven cards in hand" is a hand size of 0 or 7; "exactly zero or" with no second number stays manual', () => {
    const text = (w: string): string => JSON.stringify(creature(`{T}: Add {C}. Activate only if you have ${w} cards in hand.`, 'Land').abilities.map((x) => (x as { onlyIf?: unknown }).onlyIf));
    expect(fullyAutomated(creature('{T}: Add {C}. Activate only if you have exactly zero or seven cards in hand.', 'Land'))).toBe(true);
    expect(text('exactly zero or seven')).toContain('"cond":"any"');
    expect(text('exactly zero or more')).not.toContain('"cond":"any"');
    expect(text('zero or seven')).not.toContain('"cond":"any"');
  });
  it('render/cond.ts (CR 105.1; Spirit of Resistance): "you control a permanent of each color" is five colors among your permanents; "of each type" stays manual', () => {
    expect(fullyAutomated(creature('As long as you control a permanent of each color, prevent all damage that would be dealt to you.', 'Enchantment'))).toBe(true);
    expect(fullyAutomated(creature('As long as you control a permanent of each type, prevent all damage that would be dealt to you.', 'Enchantment'))).toBe(false);
  });
  it('render/abil.ts (CR 510.1a, 613.11): a condition on the always-on toughness damage of the enchanted creature says "it"; a group still says "each"', () => {
    expect(fullyAutomated(creature('Enchant creature\nAs long as enchanted creature has flying, it assigns combat damage equal to its toughness rather than its power.', 'Enchantment — Aura'))).toBe(true);
    expect(fullyAutomated(creature('Enchant creature\nAs long as enchanted creature has flying, each creature assigns combat damage equal to its toughness rather than its power.', 'Enchantment — Aura'))).toBe(false);
  });
  it('templates (G5): a template of this round that overlaps a generic one wins by priority; the sentence the generic reading cannot take stays with the generic one', () => {
    expect(fullyAutomated(creature('{T}: Put a +1/+1 counter on target creature and goad it.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever another creature you control dies, put a +1/+1 counter on target creature and tap it.'))).toBe(true); // edh-next-87 (CR 608.2c, 115.1): "it" in the sentence that names the target is the target, beside the creature that died (anaphora.ts), so this reads now
    expect(fullyAutomated(spell('Destroy target creature. It can\'t be regenerated.'))).toBe(true);
  });
});
