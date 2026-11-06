/**
 * Must-finish round edh-next-128 (dice, coins and random, EDHREC 5,001-10,000): the template data of parser/templates/zz-cloud/edh-next-128.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-next-128-scenarios.test.ts.
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
import edhNext128 from '../../../src/parser/templates/zz-cloud/edh-next-128.json';
import review from '../../m5/golden/cards/edh-next-128-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext128 as Template[];
const MECH_COUNT = 14;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the card of the EDHREC top 10,000 that prints the wording and is full (held-out, opened by the owner: commander request 2026-10-27, more cards 2026-10-30)
  'eff.edhn128.damage.playerOrPlaneswalker': ['Curse of the Pierced Heart'],
  'eff.edhn128.damage.equal.playerOrPlaneswalker': ['Vial Smasher the Fierce'],
  'rep.edhn128.enters.rollDice.countersEqualTotal': ['Neverwinter Hydra'],
  'eff.edhn128.choose.counterKindAtRandom.notOnSelf': ['Crystalline Giant'],
  'eff.edhn128.put.counterOfThatKind': ['Crystalline Giant'],
  'eff.edhn128.permit.free.fromHand.thisTurn': ["Yusri, Fortune's Flame"],
  'eff.edhn128.ifWonNFlipsThisWay': ["Yusri, Fortune's Flame"],
  'eff.edhn128.forEachResultOf': ['Celebr-8000'],
  'eff.edhn128.indicatedAbility': ['Celebr-8000'],
  'eff.edhn128.ifRolledDoubles.alsoGains': ['Celebr-8000'],
  'eff.edhn128.forEach.putNCounters': ['Attempted Murder'],
  'eff.edhn128.youAndPlayerFlip.tailsDamage.untilBothHeads': ['Mana Clash'],
  'eff.edhn128.chooseNumber.flipUntilLoseCapped.drawIfAllWon': ["Squee's Revenge"],
  'eff.edhn128.eachNonland.randomPlayer.gainsControl.untap': ['Scrambleverse'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  /^[+\u2212-]\d+:/.test(text) || /loyalty counter/.test(text) ? card('Example Sage', 'Legendary Planeswalker — Example', text, { loyalty: '4' }) :
  /enchanted (creature|land|artifact|permanent|enchantment)/.test(text) ? card(
    'Example Boon', 'Enchantment — Aura', text) :
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-128 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-128.json, path order: after edh-next-126, before edh-next-13) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-128.json');
    expect(files.indexOf('zz-cloud/edh-next-128.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-126.json'));
    expect(files.indexOf('zz-cloud/edh-next-128.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-13.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn128.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|dl)\.edhn128\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
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

describe('edh-next-128 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bplaneswalker\b/, 'creature'], [/\bthat player controls\b/, 'you control'], [/\bthey control\b/, 'you control'], [/\bthat player or\b/, 'each opponent or'], [/\btotal\b/, 'highest'], [/\bd6\b/, 'd20'], [/^As\b/, 'When'], [/\bdoesn't have\b/, 'has'], [/\bat random\b/, 'of your choice'], [/\ba counter of that kind\b/, 'two counters of that kind'], [/\bwon\b/, 'lost'], [/\bfrom your hand\b/, 'from your graveyard'], [/\bflips this way\b/, 'flips this turn'], [/\bdoubles\b/, 'triples'], [/\bindicated\b/, 'chosen'], [/\bresult of 1\b/, 'result of 1 or 2'], [/\bcomes up tails\b/, 'comes up heads'], [/\bcome up heads\b/, 'come up tails'], [/\b1 damage\b/, '2 damage'], [/\buntil you lose\b/, 'until you win'], [/\bwin all the flips\b/, 'win a flip'], [/\bnonland permanent\b/, 'creature'], [/\buntap those\b/, 'tap those'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-128 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-128 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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
    }, 120_000); // like the other rounds' G2 guards: one parse per word of each example
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-next-128 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-128 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-next-128 parser, renderer and engine changes (one test each)', () => {
  const creature = (text: string) => parseCard(card('Example Beast', 'Creature — Goblin', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('render/steps-life.ts#recipientText + effects/handlers/lifedamage.ts (CR 608.2d, 120.3): `orPlaneswalker` only after one player that is not a target', () => {
    expect(fullyAutomated(creature('Whenever you cast your first spell each turn, choose an opponent at random. Example Beast deals 1 damage to that player or a planeswalker they control.'))).toBe(true);
    expect(JSON.stringify(creature('Whenever Example Beast attacks, Example Beast deals 1 damage to target player or a planeswalker that player controls.').abilities)).not.toContain('orPlaneswalker');
    expect(JSON.stringify(creature('Whenever Example Beast attacks, Example Beast deals 1 damage to each opponent or a planeswalker they control.').abilities)).not.toContain('orPlaneswalker');
  });
  it('parser/lower/coin-flip.ts (CR 705.2, 608.2c): after a flip of several coins, "For each flip you win / lose, X" happens once per flip won / lost (after all the flips); one coin keeps the old reading', () => {
    const several = JSON.stringify(creature('Whenever Example Beast attacks, flip three coins. For each flip you lose, you lose 1 life.').abilities);
    expect(several).toContain('"lost":true');
    expect(several).toContain('"called":true');
    const one = JSON.stringify(creature('When Example Beast enters, flip a coin for each opponent you have. For each flip you win, draw a card.').abilities);
    expect(one).toContain('"onWin"');
    expect(one).not.toContain('"op":"repeat"');
    expect(fullyAutomated(creature('Whenever Example Beast attacks, flip three coins. If you won three flips this way, draw a card.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever Example Beast attacks, flip three coins. If you won two flips this way, draw a card.')), 'N below the most coins: exactly or at least is not stated').toBe(false);
    expect(fullyAutomated(creature('Whenever Example Beast attacks, flip a coin. If you won two flips this way, draw a card.'))).toBe(false);
  });
  it('review fixes: "for each result of N" and "if you rolled doubles" only after a roll (doubles: of two dice); the counters "for each" only of even results', () => {
    expect(fullyAutomated(creature('Whenever Example Beast attacks, draw a card. For each result of 1, draw a card.'))).toBe(false);
    expect(fullyAutomated(creature('Whenever Example Beast attacks, roll a six-sided die. If you rolled doubles, it also gains double strike until end of turn.'))).toBe(false);
    expect(fullyAutomated(creature('Whenever Example Beast attacks, roll two six-sided dice. If you rolled doubles, it also gains double strike until end of turn.'))).toBe(true);
    expect(creature('Whenever Example Beast attacks, target creature gets +1/+1 until end of turn. For each creature its controller controls, put two -1/-1 counters on that creature.').templatesUsed, 'an older reading (edh-c-98) may take it; never this round\'s').not.toContain('eff.edhn128.forEach.putNCounters');
  });
});
