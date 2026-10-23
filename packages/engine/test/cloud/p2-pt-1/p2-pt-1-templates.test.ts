/**
 * p2-pt-1 (Phase 2 lane p2-pt: power/toughness statics and pumps): the template data of parser/templates/zz-cloud/p2-pt-1.json ("Until end of turn, double
 * <obj>'s power and it gains <abilities>", "<obj> gets <pt> and has <abilities> <duration>", "<obj> deals damage equal to <qty> to each other creature and
 * <players>", "each <filter> gets <pt> for each other creature on the battlefield that shares at least one creature type with it", "exchange <player>'s life
 * total with <obj>'s toughness"), and the round's renderer changes (the power alone doubled beside a grant, one computed damage amount for a further recipient,
 * "other ... that shares at least one creature type with it" of the object modified).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in p2-pt-1-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2pt1 from '../../../src/parser/templates/zz-cloud/p2-pt-1.json';
import ownReview from '../../m5/golden/cards/p2-pt-1-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = p2pt1 as Template[];
const MECH_COUNT = 6;
const review = ownReview as { card: string; verified: string; expect?: string }[];
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only (tuning half), with their template tests (G9, G2) and played scenarios. Listed in the round's record (DECIDED BY DEFAULT, owner
 * instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, string>> = {
  'eff.p2pt1.dur.double.power.gains': 'Legion Leadership // Legion Stronghold',
  'eff.p2pt1.damage.equal.eachOtherCreature.andPlayers': "Chandra's Ignition",
  'sta.p2pt1.pump.foreach.otherSharingCreatureType': 'Coat of Arms',
  'eff.p2pt1.exchange.yourLife.toughness': 'Tree of Redemption',
  'eff.p2pt1.exchange.playerLife.toughness': 'Tree of Perdition',
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a creature's activated or triggered ability, an artifact's static, an instant's effect. */
const parsedWith = (t: Template, text: string) => {
  if (/^(\{|When )/.test(text)) return parseCard(card('Example Courier', 'Creature — Human', text, { power: '2', toughness: '3' }), OPTS).faces[0]!;
  if (t.kind === 'static') return parseCard(card('Example Banner', 'Artifact', text), OPTS).faces[0]!;
  return parseCard(card('Example Rage', 'Instant', text), OPTS).faces[0]!;
};

describe('p2-pt-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it("is loaded by the default compiler (zz-cloud/p2-pt-1.json, after zz-cloud/look3.json, before zz-cloud/r3-*) and its ids are unique in the whole set", () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-pt-1.json');
    expect(files.indexOf('zz-cloud/p2-pt-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/look3.json'));
    expect(files.indexOf('zz-cloud/p2-pt-1.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are (eff|sta).p2pt1.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.p2pt1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = review.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) expect(cards, t.id).toContain(NARROW[t.id]);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'double']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('p2-pt-1 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\bpower\b/, 'toughness'], [/\btoughness\b/, 'power'], [/\bremains tapped\b/, 'remains untapped'], [/\bgains\b/, 'loses'], [/\bhas\b/, 'loses'],
    [/\beach opponent\b/, 'each player'], [/\beach player\b/, 'each opponent'], [/\beach other creature\b/, 'each creature'], [/\bcreature type\b/, 'color'],
    [/\blife total\b/, 'hand'], [/\byour life total\b/, "target player's life total"], [/\bdouble\b/, 'triple'], [/\bother\b/, 'nonland'],
    [/\bat least one\b/, 'exactly one'], [/\+1\/\+1/, '+1/+0'], [/\+3\/\+0/, '+3/+3'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-pt-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
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

describe('p2-pt-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
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

describe.skipIf(index === null)('p2-pt-1 design 6.10 (local index): synthetic examples', () => {
  it('no p2-pt-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('p2-pt-1 renderer (CR 701.10c, 613.4c): the power alone doubled beside a grant', () => {
  it('"Until end of turn, double target creature\'s power and it gains first strike" renders (said with the duration in front or at the end)', () => {
    const f = parseCard(card('Example Rage', 'Instant', "Double target creature's power and it gains first strike until end of turn."), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(false); // the duration at the end is not a template wording: the renderer's second reading alone parses nothing
    const g = parseCard(card('Example Rage', 'Instant', "Until end of turn, double target creature's power and it gains first strike."), OPTS).faces[0]!;
    expect(fullyAutomated(g)).toBe(true);
    expect(json(g.abilities)).toContain('"toughness":0');
  });
});

describe('p2-pt-1 renderer (CR 120.2b, 608.2h): one computed damage amount for a further recipient', () => {
  it('"... deals damage equal to its power to each other creature and each opponent" is one amount for both', () => {
    const f = parseCard(card('Example Rage', 'Sorcery', 'Target creature you control deals damage equal to its power to each other creature and each opponent.'), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f.abilities)).toContain('"also":[{"to":{"ref":"each","who":"opponent"},"amount":{"q":"stat","stat":"power","of":{"ref":"target","id":"t0"}}}]');
  });
  it('a computed amount for a different further amount still has no renderer (fails closed)', () => {
    const f = parseCard(card('Example Rage', 'Sorcery', 'Target creature you control deals damage equal to its power to each other creature and damage equal to its toughness to each opponent.'), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(false);
  });
});

describe('p2-pt-1 renderer (CR 205.3m, 613.4c): "for each other creature on the battlefield that shares at least one creature type with it"', () => {
  it('the count compares each other creature with the object modified (`subject`), not with ~', () => {
    const f = parseCard(card('Example Banner', 'Artifact', 'Each creature you control gets +1/+1 for each other creature on the battlefield that shares at least one creature type with it.'), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f.abilities)).toContain('"sharesWith":{"with":{"ref":"subject"},"quality":"creatureType","other":true}');
  });
  it('"that shares a color with it" stays manual (only the creature type reading is written)', () => {
    const f = parseCard(card('Example Banner', 'Artifact', 'Each creature gets +1/+1 for each other creature on the battlefield that shares at least one color with it.'), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(false);
  });
});
