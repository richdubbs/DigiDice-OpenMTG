/**
 * Commander coordinator D, round edh-d-35 (lane dig, second pass): the template data of parser/templates/zz-cloud/edh-d-35.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-d-35-scenarios.test.ts.
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
import edhD35 from '../../../src/parser/templates/zz-cloud/edh-d-35.json';
import review from '../../m5/golden/cards/edh-d-35-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD35 as Template[];
const MECH_COUNT = 9;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27, more cards 2026-10-30)
  'eff.edhd35.revealUntil.countQty': ['Mass Polymorph'],
  'eff.edhd35.revealUntil.numberEqual': ['Empty the Laboratory'],
  'eff.edhd35.put.objs.bf.restBottomRandom': ['Empty the Laboratory'],
  'eff.edhd35.putAll.revealed.bf.thenShuffleRest': ['Mass Polymorph'],
  'eff.edhd35.forEachOf.controllerRevealsUntil.putsBf.shufflesRest': ['Divergent Transformations'],
  'eff.edhd35.forEach.controllerRevealsUntil.putsBf.restBottomRandom': ['Chaos Mutation'],
  'eff.edhd35.dig.putAnyNumber.hand.restGraveyard': ['Blex, Vexing Pest // Search for Blex'],
  'eff.edhd35.loselife.3.foreach': ['Blex, Vexing Pest // Search for Blex'],
  'eff.edhd35.tap.anyNumber': ['Plargg, Dean of Chaos // Augusta, Dean of Order'],
}
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-d-35 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-35.json, path order: after edh-d-11.json, before edh-mana-keywords-1.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-35.json');
    expect(files.indexOf('zz-cloud/edh-d-35.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-11.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 35; ids are *.edhd35.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rst|ch|rid|cm)\.edhd35\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(35);
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

describe('edh-d-35 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [[/\btwo\b/, 'three'], [/\bhaste\b/, 'flying'], [/\bWalls\b/, 'Wall'], [/\bone\b/, 'two']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-d-35 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-35 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-d-35 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-35 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-d-35 renderer, lowering and engine changes (one test each)', () => {
  const spell = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  const X_SPELL = (text: string) => parseCard(card('Example Plan', 'Sorcery', text, { mana_cost: '{X}' }), OPTS).faces[0]!;
  it('render/steps-cards.ts#computedUntilCount (CR 107.3, 608.2h): the count of a reveal until is "that many ..." (an earlier instruction of the sentence made it), "a number of ... equal to ..." or "X ..., where X is ..."; a count nothing made is not "that many"', () => {
    const that = (cards: string) => spell(`Exile all creatures you control, then reveal cards from the top of your library until you reveal ${cards} creature cards. Put those cards onto the battlefield and the rest on the bottom of your library in a random order.`);
    expect(fullyAutomated(that('that many'))).toBe(true);
    expect(fullyAutomated(that('that much'))).toBe(false);
    expect(fullyAutomated(spell('Reveal cards from the top of your library until you reveal that many creature cards. Put those cards onto the battlefield and the rest on the bottom of your library in a random order.'))).toBe(false);
    expect(fullyAutomated(X_SPELL('Sacrifice X Zombies, then reveal cards from the top of your library until you reveal a number of Zombie creature cards equal to the number of Zombies sacrificed this way. Put those cards onto the battlefield and the rest on the bottom of your library in a random order.'))).toBe(true);
    expect(fullyAutomated(X_SPELL('Sacrifice X Zombies, then reveal cards from the top of your library until you reveal a number of Zombie creature cards equal to the number of Zombies sacrificed this way. Put those cards onto the battlefield and the rest on the bottom of your library in any order.'))).toBe(false);
  });
  it('render/np.ts (CR 608.2c): "creature cards revealed this way" names the cards a counted reveal until stopped at (the one description the parser folded to a single filter), and only that description', () => {
    const rest = (cards: string) => spell(`Exile all creatures you control, then reveal cards from the top of your library until you reveal that many creature cards. Put all ${cards} revealed this way onto the battlefield, then shuffle the rest of the revealed cards into your library.`);
    expect(fullyAutomated(rest('creature cards'))).toBe(true);
    expect(fullyAutomated(rest('artifact cards'))).toBe(false);
    expect(fullyAutomated(rest('land cards'))).toBe(false);
  });
  it('render/fold-edhd35.ts#iterationControllerRevealsAndPuts (CR 608.2c, 608.2f, 701.20a): the controller of the permanent the loop is on reveals, puts the card and shuffles (or bottoms in a random order) the rest; "their library" is the one revealed from, the shuffle is theirs', () => {
    const of = (tail: string) => spell(`Exile two target creatures. For each of those creatures, its controller reveals cards from the top of their library until they reveal a creature card, puts that card onto the battlefield, then ${tail}`);
    const exiledThisWay = (tail: string) => spell(`Exile any number of target creatures controlled by different players. For each creature exiled this way, its controller reveals cards from the top of their library until they reveal a creature card, puts that card onto the battlefield, then ${tail}`);
    expect(fullyAutomated(of('shuffles the rest into their library.'))).toBe(true);
    expect(fullyAutomated(exiledThisWay('puts the rest on the bottom of their library in a random order.'))).toBe(true);
    expect(fullyAutomated(exiledThisWay('puts the rest on the bottom of their library in any order.'))).toBe(false);
    expect(fullyAutomated(of('puts the rest into their graveyard.'))).toBe(false);
    expect(fullyAutomated(of('shuffles the rest into your library.'))).toBe(false);
  });
  it('parser/lower/mentions.ts#revealedNotCastOf (CR 701.20a, 601.2a): "all revealed cards not cast this way" names every card of your reveal until still in the library; another player\'s reveal, a counted reveal and a reveal without a cast do not give it', () => {
    const dig = (who: string, rest: string) => spell(`${who} until ${who === 'Reveal cards from the top of your library' ? 'you' : 'they'} reveal a nonland card. You may cast that card without paying its mana cost. Put ${rest} on the bottom of your library in a random order.`);
    expect(fullyAutomated(dig('Reveal cards from the top of your library', 'all revealed cards not cast this way'))).toBe(true);
    expect(fullyAutomated(dig('Reveal cards from the top of your library', 'all revealed cards'))).toBe(false);
    expect(fullyAutomated(spell('Reveal cards from the top of your library until you reveal two nonland cards. You may cast one of them without paying its mana cost. Put all revealed cards not cast this way on the bottom of your library in a random order.'))).toBe(false);
  });
  it('parser/holes/moved-words.ts and render/moved.ts (CR 608.2c, 400.3): "for each card you put into your hand this way" counts the cards of the one earlier move to your hand; a move to another zone or another player\'s hand is not it', () => {
    const dig = (zone: string, tail: string) => spell(`Look at the top five cards of your library. You may put any number of them ${zone} and the rest into your graveyard. You lose 3 life for each card ${tail} this way.`);
    expect(fullyAutomated(dig('into your hand', 'you put into your hand'))).toBe(true);
    expect(fullyAutomated(dig('into your hand', 'put into your hand'))).toBe(true);
    expect(fullyAutomated(dig('into your hand', 'put onto the battlefield'))).toBe(false);
    expect(fullyAutomated(dig('into your hand', 'you put into their hand'))).toBe(false);
  });
});
