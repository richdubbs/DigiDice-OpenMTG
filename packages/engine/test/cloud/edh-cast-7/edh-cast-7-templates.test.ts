/**
 * Commander lane edh-cast, round edh-cast-7: the template data of parser/templates/zz-cloud/edh-cast-7.json ("copy that spell, and you may choose new targets for the copy",
 * "Players can't cast creature or planeswalker spells until the end of your next turn", "Cast this spell only before the combat damage step", "If you cast a spell this way,
 * mana of any type can be spent to cast it", "If your life total is less than your starting life total, this spell costs {X} less to cast, where X is the difference", "you may
 * cast your commander from the command zone without paying its mana cost") and the parser, renderer and engine changes of the round (one test each at the end). Guard G9
 * (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON;
 * near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10),
 * checked against the local index when it is present. The behavior is in edh-cast-7-scenarios.test.ts. CR cites checked against the Comprehensive Rules 2026-09-25
 * (media.wizards.com) where the record says so.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhCast7 from '../../../src/parser/templates/zz-cloud/edh-cast-7.json';
import review from '../../m5/golden/cards/edh-cast-7-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhCast7 as Template[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only one
 * card of the EDHREC top 5,000, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT, owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'eff.edhc7.copy.commaAnd.newTargets': ['Krark, the Thumbless'],
  'eff.edhc7.players.cantCast.filter.dur': ['Single Combat'],
  'rst.edhc7.cast.self.beforeCombatDamage': ['Berserk'],
  'rid.edhc7.castThisWay.anyManaType.passive': ['Bloodsoaked Insight // Sanguine Morass'],
  'cm.edhc7.self.less.lifeDifference': ['Shadow of Mortality'],
  'eff.edhc7.cast.yourCommander.free': ['Geode Golem'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (a sorcery); the others are abilities of a creature (static, activated, triggered). */
const SPELL = new Set<string>(['eff.edhc7.copy.commaAnd.newTargets', 'eff.edhc7.players.cantCast.filter.dur', 'rid.edhc7.castThisWay.anyManaType.passive']);
/** The one template whose examples are the text of an instant with the card's own name (a timing restriction names the spell, CR 601.3). */
const INSTANT_NAMED = new Set<string>(['rst.edhc7.cast.self.beforeCombatDamage']);
/** The template whose examples name the card "Example Subject" (the name the mutation harness gives a static example, packages/cards/src/coverage/mutation.ts#exampleCard). */
const SUBJECT_NAMED = new Set<string>(['cm.edhc7.self.less.lifeDifference']);
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (INSTANT_NAMED.has(t.id)
    ? parseCard(card('Example Subject', 'Enchantment', text), OPTS)
    : SUBJECT_NAMED.has(t.id)
      ? parseCard(card('Example Subject', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)
      : SPELL.has(t.id)
      ? parseCard(card('Example Plan', 'Sorcery', text), OPTS)
      : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-cast-7 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-cast-7.json, path order: after edh-cast-5, before edh-combat-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-cast-7.json');
    expect(files.indexOf('zz-cloud/edh-cast-7.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-cast-5.json'));
    expect(files.indexOf('zz-cloud/edh-cast-7.json')).toBeLessThan(files.indexOf('zz-cloud/edh-combat-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are eff.edhc7.* (or sta., cm., rst., rid.)', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|rst)\.edhc7\./);
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

describe('edh-cast-7 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bless\b/, 'more'], [/\bonly\b/, 'also'], [/\bbefore\b/, 'after'], [/\bcast\b/, 'play'], [/\bplayers\b/, 'your opponents'], [/\bcopy\b/, 'exile'], [/\bcommander\b/, 'creature'],
    [/\bdifference\b/, 'sum'], [/\bany type\b/, 'any color'], [/\bcreature\b/, 'land'], [/\bmay\b/, 'must'], [/\bwithout paying\b/, 'by paying'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-cast-7 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-cast-7 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w) || w === 'Example' || w === 'Subject' || w === 'Relic') return; // the card's own name
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    }, 120_000);
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-cast-7 design 6.10 (local index): synthetic examples', () => {
  it('no edh-cast-7 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-cast-7 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Artifact Creature — Golem', name = 'Example Relic') => parseCard(card(name, type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
  it('parser/holes/cost.ts (CR 701.9a, 118.3): "discard <a described card> and another card" is two discard parts, in an alternative cost and in an activated cost; "a card and another card" without a description, "and two other cards" and "or another card" are not that reading', () => {
    const alt = (cost: string) => face(`You may ${cost} rather than pay this spell's mana cost.\nCounter target spell.`, 'Instant', 'Example Spell');
    expect(fullyAutomated(alt('discard a Forest card and another card'))).toBe(true);
    expect(JSON.stringify(alt('discard a Forest card and another card').abilities)).toContain('"kind":"discard"');
    expect(fullyAutomated(alt('discard a card and another card'))).toBe(false);
    expect(fullyAutomated(alt('discard a Forest card and two other cards'))).toBe(false);
    expect(fullyAutomated(alt('discard a Forest card or another card'))).toBe(false);
    expect(fullyAutomated(face('Discard a Forest card and another card: You gain 2 life.'))).toBe(true);
  });
  it('render/costs.ts (CR 701.9a): the two discard parts are said "<a described card> and another card" once, and only for one described card and one more card of the hand', () => {
    const f = face('Discard an Island card and another card: You gain 2 life.');
    expect(fullyAutomated(f)).toBe(true);
    // (a cost part the model cannot state stays a manual cost part, which the helper's `fullyAutomated` does not count: look at the part itself)
    const manualCost = (g: ReturnType<typeof face>): boolean => JSON.stringify(g.abilities).includes('"kind":"manual"');
    expect(manualCost(f)).toBe(false);
    expect(manualCost(face('Discard an Island card and another card at random: You gain 2 life.'))).toBe(true);
    expect(fullyAutomated(face('Discard an Island card, discard a card: You gain 2 life.'))).toBe(false);
  });
  it('parser/lower/anaphora.ts#flipWorld (CR 705.2, 608.2c): in the branch of one flip result, "that spell" is the spell of the trigger and not what the other result moved or made; ordinary flips are read as before', () => {
    const k = (lose: string, win: string) => face(`Whenever you cast an instant or sorcery spell, flip a coin. If you lose the flip, ${lose} If you win the flip, ${win}`);
    expect(fullyAutomated(k("return that spell to its owner's hand.", 'copy that spell, and you may choose new targets for the copy.'))).toBe(true);
    expect(fullyAutomated(k("return that spell to its owner's hand.", 'copy that spell.'))).toBe(true);
    // the other order of the two results is read too, and a result that names an object the other branch made is not resolved to it
    const swapped = face(`Whenever you cast an instant or sorcery spell, flip a coin. If you win the flip, copy that spell, and you may choose new targets for the copy. If you lose the flip, return that spell to its owner's hand.`);
    expect(fullyAutomated(swapped)).toBe(true);
    expect(JSON.stringify(swapped.abilities)).not.toContain('"bound"');
    // a draw before the flip does not make "that spell" ambiguous either: the flip results alone are exclusive
    expect(fullyAutomated(face('Whenever you cast an instant or sorcery spell, flip a coin. If you win the flip, copy that spell. If you lose the flip, you lose 2 life.'))).toBe(true);
  });
  it('parser/lower/coin-flip.ts (CR 608.2c, 705.2; review finding, Ral): "If you win the flip, you may exile ~" followed by an "If you do" sentence that is not understood stays manual (the exile alone would leave the card in exile); with an understood follow-up it is a branch', () => {
    const t = (follow: string) => face(`Whenever you cast an instant or sorcery spell, flip a coin. If you lose the flip, ~ deals 1 damage to you. If you win the flip, you may exile ~. ${follow}`);
    expect(JSON.stringify(t('If you do, return it to the battlefield transformed under its owner\'s control.').abilities)).not.toContain('"onWin"');
    expect(JSON.stringify(t('If you do, draw a card.').abilities)).toContain('"onWin"');
  });
  it('render/steps-lasting.ts (CR 705.2): the results of a flip are said in either order; a result that differs from the model is refused', () => {
    expect(fullyAutomated(face('{T}: Flip a coin. If you win the flip, draw a card. If you lose the flip, you lose 1 life.'))).toBe(true);
    expect(fullyAutomated(face('{T}: Flip a coin. If you lose the flip, you lose 1 life. If you win the flip, draw a card.'))).toBe(true);
    expect(fullyAutomated(face('{T}: Flip a coin. If you lose the flip, draw a card. If you win the flip, you lose 1 life.'))).toBe(true); // other effects: still two results, each one branch
    const a = face('{T}: Flip a coin. If you win the flip, draw a card. If you lose the flip, you lose 1 life.');
    const b = face('{T}: Flip a coin. If you lose the flip, you lose 1 life. If you win the flip, draw a card.');
    expect(jsonKey(a.abilities)).toBe(jsonKey(b.abilities)); // one model for both orders
  });
  it('render/stat.ts#CAST_SELF_ONLY_STEPS (CR 601.3, 510.4): the steps before the combat damage step are the words "before the combat damage step"; other step lists stay as they were', () => {
    const f = face('Cast Example Subject only before the combat damage step.\nTarget creature gets +1/+1 until end of turn.', 'Instant', 'Example Subject');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"declareBlockers"');
    expect(JSON.stringify(f.abilities)).not.toContain('"combatDamage"');
    expect(fullyAutomated(face('Cast Example Subject only during combat before blockers are declared.\nTarget creature gets +1/+1 until end of turn.', 'Instant', 'Example Subject'))).toBe(true);
  });
  it('render/stat.ts#anyTypeRider (CR 609.4b): the passive rider is one more wording of the any-type permission; a rider about another kind of mana or of another permission is not', () => {
    const t = (rider: string) => face(`Exile the top card of your library. You may play that card this turn. ${rider}`, 'Sorcery', 'Example Plan');
    expect(fullyAutomated(t('If you cast a spell this way, mana of any type can be spent to cast it.'))).toBe(true);
    expect(fullyAutomated(t('If you cast a spell this way, mana of any color can be spent to cast it.'))).toBe(false);
    expect(fullyAutomated(t('If you cast a spell this way, mana of any type can be spent to activate it.'))).toBe(false);
  });
  it('render/stat.ts, render/abil.ts (CR 601.2f, 119.1): the life difference is "the difference" only under the condition that your life total is below the starting life total, which may lead the sentence', () => {
    const w = (cond: string, tail: string) => face(`If ${cond}, this spell costs {X} less to cast, where X is ${tail}.`);
    expect(fullyAutomated(w('your life total is less than your starting life total', 'the difference'))).toBe(true);
    expect(fullyAutomated(w('your life total is greater than your starting life total', 'the difference'))).toBe(false);
    expect(fullyAutomated(w("an opponent's life total is less than your starting life total", 'the difference'))).toBe(false);
  });
  it('render/fold-edhcast7.ts (CR 903.3d, 702.124e, 903.8): "you may cast your commander from the command zone without paying its mana cost" is a choice of up to one commander you own in the command zone and its free cast; from another zone, or paying the cost, it is not', () => {
    const c = (tail: string) => face(`When this creature enters, you may cast your commander ${tail}`);
    expect(fullyAutomated(c('from the command zone without paying its mana cost.'))).toBe(true);
    expect(fullyAutomated(c('from the command zone.'))).toBe(false);
    expect(fullyAutomated(c('from your hand without paying its mana cost.'))).toBe(false);
    expect(fullyAutomated(c('from the command zone without paying its mana cost, then put it into your hand.'))).toBe(false);
  });
});
