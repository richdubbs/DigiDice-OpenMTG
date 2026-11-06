/**
 * Commander band 5,001-10,000, group counters part 3, round edh-d-94 (code edhd94): the template data of parser/templates/zz-cloud/edh-d-94.json (see the file) and the round's parser,
 * lowering, engine and renderer changes, tested at the end of this file and in edh-d-94-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10),
 * checked against the local index when it is present. CR cites checked against the Comprehensive Rules of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import { compileCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhD94 from '../../../src/parser/templates/zz-cloud/edh-d-94.json';
import review from '../../m5/golden/cards/edh-d-94-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD94 as Template[];
const MECH_COUNT = 8;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one
 * card, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (owner's standing rule 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhd94.exileAllCreatures.eachPlayerToken.countersTotalPowerTheyControlled': ['Oversimplify'],
  'eff.edhd94.tapAll.mayPayAnyEnergy.chooseUpToTappedThisWay.stunEach': ['Suppression Ray // Orderly Plaza'],
  'rep.edhd94.dies.exile.whenYouDo.mayPay': ['Valentin, Dean of the Vein // Lisette, Dean of the Root'],
  'eff.edhd94.revealUntil.putHandRestBottom.whenRevealedThisWay.countersMv': ["Yuna's Whistle"],
  'eff.edhd94.token.thenEntersWithCountersNumberOfOther': ['Printlifter Ooze'],
  'rep.edhd94.enters.choose.planeswalkerType': ['Deification'],
  'sta.edhd94.asLongAs.damageLeavesOneLoyalty': ['Deification'],
  'eff.edhd94.chooseCounterKindOnYours.putOnEachOther': ['Contractual Safeguard'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a trigger on an artifact creature, "this artifact" / "this Vehicle" / "this planeswalker" on such a permanent, a static ability on an enchantment, else a sorcery. */
const parsedWith = (t: Template, text: string) => parseCard(
  /^(Whenever|When|At the beginning)/.test(text) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' })
    : /this artifact/.test(text) ? card('Example Relic', 'Artifact', text)
      : /this Vehicle/.test(text) ? card('Example Cart', 'Artifact — Vehicle', text, { power: '3', toughness: '3' })
        : /this planeswalker/.test(text) ? card('Example Sage', 'Legendary Planeswalker — Example', text, { loyalty: '3' })
      : t.kind === 'static' ? card('Example Shrine', 'Enchantment', text) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-d-94 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-94.json, path order: after edh-d-9.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-94.json');
    expect(files.indexOf('zz-cloud/edh-d-94.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-9.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status; ids are *.edhd94.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|kw)\.edhd94\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the card that prints the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`) || g.verified.includes(`${t.id})`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) for (const n of NARROW[t.id]!) expect(cards, t.id).toContain(n);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'additional', 'except', "can't", 'would', 'next', 'then', 'during']) {
        if (words.includes(w)) expect((t.consumes ?? []).join(' ').split(' '), `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-d-94 guard G9 (design 6.8): examples and counter-examples', () => {
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
    }, 120_000);
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [[/creatures/, 'artifacts'], [/exile/i, 'Destroy'], [/stun/, 'shield'], [/hand/, 'graveyard'], [/other/, 'each'], [/planeswalker type/, 'creature type']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-d-94 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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
    }, 120_000);
  }
});

describe('edh-d-94 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // a counter kind is any word (CR 122.1b)
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    }, 120_000); // like the other rounds' G2 guards: one parse per word of each example
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-d-94 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-94 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

/** The parser, lowering and renderer changes of the round: each wording in a synthetic card, with the near misses that must stay out. */
const asCard = (text: string, type = 'Artifact Creature — Construct') => card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : {});
/** The card's own automation level (a manual cost part, which `fullyAutomated` does not see, caps it at partial). */
const isFull = (text: string, type?: string): boolean => compileCard(asCard(text, type)).automation.level === 'full' && fullyAutomated(parseCard(asCard(text, type), OPTS).faces[0]!);

describe('edh-d-94: readings of the cost, anaphora, lowering and render changes (each with its near misses)', () => {
  it('CR 118.3, 607.2a (parser/holes/cost.ts): "Put a <card> exiled with ~ into its owner\'s graveyard" is a cost of a card of the linked exile set; other zones, owners and destinations are not', () => {
    const exiler = 'Whenever a creature an opponent controls dies, exile it.\n';
    expect(isFull(`${exiler}{1}, Put a creature card exiled with ~ into its owner's graveyard: You gain 2 life.`)).toBe(true);
    expect(isFull(`${exiler}Put a card exiled with ~ into its owner's graveyard: Draw a card.`)).toBe(true);
    expect(isFull(`${exiler}{1}, Put a creature card exiled with ~ into your graveyard: You gain 2 life.`)).toBe(false);
    expect(isFull(`${exiler}{1}, Put a creature card exiled with ~ into its owner's hand: You gain 2 life.`)).toBe(false);
    expect(isFull(`${exiler}{1}, Put two creature cards exiled with ~ into their owners' graveyards: You gain 2 life.`)).toBe(false);
    expect(isFull("{1}, Put a creature card exiled with ~ into its owner's graveyard: You gain 2 life.")).toBe(false); // no linked exiling instruction (CR 607.2a)
  });
  it('CR 400.7j (lower/anaphora.ts, lower/mentions.ts, render/refs.ts): the card a cost exiled gets counters and gains an ability, and is "it" afterwards; other actions on it stay manual', () => {
    expect(isFull("{3}, Exile a card from your hand: Put two time counters on the exiled card. If it doesn't have suspend, it gains suspend.")).toBe(true);
    expect(isFull('{1}, Exile a creature card from your graveyard: Put a +1/+1 counter on the exiled card.')).toBe(true);
    expect(isFull('{1}, Exile a creature card from your graveyard: Return the exiled card to its owner\'s hand.')).toBe(false); // a move of it: still manual (CR 400.7)
    expect(isFull("{2}, Sacrifice a creature: Put two time counters on the sacrificed creature. If it doesn't have suspend, it gains suspend.")).toBe(false); // a sacrificed object is gone
  });
  it('CR 701.26a (effects/handlers/zones-status.ts): op:tap.changedOnly is a capability of this build', () => {
    expect(ENGINE_CAPABILITIES.has('op:tap.changedOnly')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('rulemod:damageLeavesOneLoyalty')).toBe(true);
  });
  it('CR 205.3j, 607.2d (parser/parse.ts, lower/links.ts): "of the chosen type" reads a planeswalker type choice of the face; without the choice it stays manual', () => {
    expect(isFull('As ~ enters, choose a planeswalker type.\nPlaneswalkers you control of the chosen type have shroud.', 'Enchantment')).toBe(true);
    expect(isFull('Planeswalkers you control of the chosen type have shroud.', 'Enchantment')).toBe(false);
  });
});
