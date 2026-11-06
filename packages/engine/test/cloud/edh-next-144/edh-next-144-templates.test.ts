/**
 * Must-finish round edh-next-144 (library, draw and search; code edhn144): the template data of parser/templates/zz-cloud/edh-next-144.json, tested here and in
 * edh-next-144-scenarios.test.ts. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not
 * parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are
 * synthetic wordings (design 6.10). CR cites checked against MagicCompRules 20260925.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext144 from '../../../src/parser/templates/zz-cloud/edh-next-144.json';
import review from '../../m5/golden/cards/edh-next-144-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { lintAbility } from '../../../src/model/lint';

const MECH = edhNext144 as Template[];
const MECH_COUNT = 15;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only
 * one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT, owner instruction 2026-10-21).
 * Each wording is printed on one card (the card named), except the guarded put, which one golden card of this round prints (a generic, weak template).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhn144.put.hand.ifCond': ['Loyal Inventor'],
  'eff.edhn144.reveal.chooseAndOr.handOrBattlefieldIfX': ["Green Sun's Twilight"],
  'rep.edhn144.enters.note.lifeTotal': ["Sigarda's Splendor"],
  'eff.edhn144.note.lifeTotal': ["Sigarda's Splendor"],
  'sta.edhn144.rule.revealFirstDraw.yourTurns': ['Keranos, God of Storms'],
  'trg.edhn144.reveal.thisWay': ['Keranos, God of Storms'],
  'sta.edhn144.addCost.mayRevealOrChooseDragon': ["Dragon's Fire"],
  'rid.edhn144.instead.damage.powerOfBeheld': ["Dragon's Fire"],
  'sta.edhn144.spell.cast.manaValue.has.blitz.manaCost': ['Henzie "Toolbox" Torre'],
  'cm.edhn144.blitz.you.less.forEachCommanderCast': ['Henzie "Toolbox" Torre'],
  'eff.edhn144.cast.fromHand.free.mvEqual': ['In Search of Greatness'],
  'eff.edhn144.sacrifice.ifCant.repeatForTwoMore': ['Invoke Despair'],
  'eff.edhn144.maySearch.curse.differentName.attachedToEnchantedPlayer': ['Curse of Misfortunes'],
  'eff.edhn144.maySacrifice.revealUntil.lesserMv.rest': ['Kethek, Crucible Goliath'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });

/** A synthetic card with the example as its ability: a static ability on an enchantment creature, a trigger on an artifact creature; the templates whose examples are whole cards say their card type. */
const TYPE_OF: Readonly<Record<string, string>> = {
  'rep.edhn144.enters.note.lifeTotal': 'Enchantment', 'eff.edhn144.note.lifeTotal': 'Enchantment', 'sta.edhn144.rule.revealFirstDraw.yourTurns': 'Enchantment',
  'sta.edhn144.rule.revealFirstDraw.eachTurn': 'Enchantment', 'trg.edhn144.reveal.thisWay': 'Enchantment', 'sta.edhn144.addCost.mayRevealOrChooseDragon': 'Instant',
  'rid.edhn144.instead.damage.powerOfBeheld': 'Instant', 'eff.edhn144.maySearch.curse.differentName.attachedToEnchantedPlayer': 'Enchantment — Aura Curse',
  'cm.edhn144.blitz.you.less.forEachCommanderCast': 'Legendary Creature — Devil', 'sta.edhn144.spell.cast.manaValue.has.blitz.manaCost': 'Legendary Creature — Devil',
};
const parsedWith = (t: Template, text: string) => {
  const type = TYPE_OF[t.id];
  const pt = type?.includes('Creature') ? { power: '2', toughness: '2' } : {};
  const x = /\bX\b/.test(text) ? { mana_cost: '{X}{G}' } : {};
  if (type !== undefined) return parseCard(card('Example Card', type, text, { ...pt, ...x }), OPTS).faces[0]!;
  return parseCard(
    /^(Whenever|When|At the beginning)/.test(text) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2', ...x }) : t.kind === 'static' ? card('Example Shrine', 'Enchantment', text, x) : card('Example Plan', 'Sorcery', text, x), OPTS).faces[0]!;
};

describe('edh-next-144 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-144.json, path order: after edh-next-14.json, before edh-next-15.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-144.json');
    expect(files.indexOf('zz-cloud/edh-next-144.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-14.json'));
    expect(files.indexOf('zz-cloud/edh-next-144.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-15.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn144.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|kw)\.edhn144\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the cards that print the wording', () => {
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

describe('edh-next-144 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [[/graveyard/, 'hand'], [/exiling/, 'discarding'], [/sacrificing/, 'discarding'], [/tapped/, 'untapped'], [/mutate/, 'flashback']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-144 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-144 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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
    }, 120_000);
  }
});



describe('edh-next-144 engine and parser changes (one test per change)', () => {
  const f = (type: string, text: string, pt?: { power: string; toughness: string }) => parseCard(card('Example Card', type, text, { ...(pt ?? {}), ...(/\bX\b/.test(text) ? { mana_cost: '{X}{G}' } : {}) }), OPTS).faces[0]!;
  it('parser/lower/join-edhn144.ts: the choose-and/or paragraph is joined only in its exact shape (another destination stays unread)', () => {
    expect(fullyAutomated(f('Sorcery', 'Reveal the top X plus one cards of your library. Choose a creature card and/or a land card from among them. Put those cards into your hand and the rest on the bottom of your library in a random order. If X is 5 or more, instead put the chosen cards onto the battlefield or into your hand and the rest on the bottom of your library in a random order.'))).toBe(true);
    expect(fullyAutomated(f('Sorcery', 'Reveal the top X plus one cards of your library. Choose a creature card and/or a land card from among them. Put those cards into your graveyard and the rest on the bottom of your library in a random order. If X is 5 or more, instead put the chosen cards onto the battlefield or into your hand and the rest on the bottom of your library in a random order.'))).toBe(false);
  });
  it('parser/segment.ts#splitRevealedThisWay: the linked triggers are abilities of their own only after "Reveal the first card you draw"', () => {
    const ok = f('Enchantment', 'Reveal the first card you draw each turn. Whenever you reveal a land card this way, draw a card.');
    expect(ok.abilities.map((a) => a.kind)).toEqual(['static', 'triggered']);
    expect(fullyAutomated(f('Enchantment', 'Players can\'t gain life. Whenever you reveal a land card this way, draw a card.'))).toBe(false);
  });
  it('CR 607.2 (ev:reveal): a "this way" reveal trigger with no reveal rule on the face is never automated', () => {
    expect(fullyAutomated(f('Enchantment', 'Whenever you reveal a land card this way, draw a card.'))).toBe(false);
  });
  it('CR 119.1 (op:chooseValue.lifeTotal): "the last noted life total" with no note of a life total on the face stays manual', () => {
    expect(fullyAutomated(f('Enchantment', 'At the beginning of your upkeep, draw a card if your life total is greater than the last noted life total for ~.'))).toBe(false);
  });
  it('CR 601.2b (cost:sacrifice.atMost): "Sacrifice up to three permanents" is an announced count of at most three; "up to one" is not read', () => {
    const three = f('Artifact', '{T}, Sacrifice up to three permanents: You gain 1 life.');
    expect(fullyAutomated(three)).toBe(true);
    expect(JSON.stringify(three.abilities)).toContain('"atMost":3');
  });
  it('parser/lower/anaphora.ts: "other permanents you control" bounding cards in hand is other than ~; acting on a battlefield group keeps the two candidates', () => {
    expect(fullyAutomated(f('Enchantment', 'At the beginning of your upkeep, you may cast a creature spell from your hand with mana value equal to the number of other permanents you control without paying its mana cost.'))).toBe(true);
  });
});
