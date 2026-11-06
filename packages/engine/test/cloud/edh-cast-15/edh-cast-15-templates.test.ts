/**
 * Commander lane edh-cast, round edh-cast-15: the template data of parser/templates/zz-cloud/edh-cast-15.json (copies of spells and abilities, ripple, the owner's choice of top or
 * bottom, "another target player", "or activate an ability" on spent mana, the optional sacrifice that copies the spell) and the parser, renderer and engine changes of the round (one test
 * each at the end). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to
 * different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10),
 * checked against the local index when it is present. The behavior is in edh-cast-15-scenarios.test.ts. CR cites: see the record (checked against the 2026-09-25 text where it says so).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhCast15 from '../../../src/parser/templates/zz-cloud/edh-cast-15.json';
import review from '../../m5/golden/cards/edh-cast-15-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhCast15 as Template[];
const MECH_COUNT = 13;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only one
 * or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (decided by the owner's standing rule 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'rid.edhc15.mana.whenSpent.castOrActivate.copy': ['Sunken Palace'],
  'eff.edhc15.copy.all.spells.thenOtherAbilities': ['Ulalek, Fused Atrocity'],
  'eff.edhc15.eachOpponentMay.copy.newTargets': ['Tempt with Mayhem'],
  'eff.edhc15.copy.oncePlus.eachOpponentWhoCopied': ['Tempt with Mayhem'],
  'rid.edhc15.copies.youControl.newTargets': ['Tempt with Mayhem'],
  'cm.edhc15.additional.sacrificeOneOrMore.copyForEach': ['Plumb the Forbidden'],
  'sta.edhc15.spells.cast.ripple': ['Thrumming Stone'],
  'eff.edhc15.choose.anotherTargetPlayer.thanCaster': ['The Lord of Pain'],
  'cm.edhc15.self.less.ifTargetsSpellThatTargets': ['Not of This World'],
  'eff.edhc15.owner.putsIt.topOrBottom': ['Subtlety'],
  'eff.edhc15.cast.upTo.instantSorcery.totalMV.graveyardOrHand.free': ['Invoke Calamity'],
  'rid.edhc15.cast.those.exileInstead': ['Invoke Calamity'],
  'eff.edhc15.cantBeCounteredOrTargeted.byBlueOrBlackSpells.thisTurn': ["Autumn's Veil"],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** The kind of card whose text an example is: abilities of a permanent, or the text of a spell. */
const KIND: Readonly<Record<string, { type: string; pt?: boolean }>> = {
  'rid.edhc15.mana.whenSpent.castOrActivate.copy': { type: 'Land' },
  'eff.edhc15.copy.all.spells.thenOtherAbilities': { type: 'Artifact Creature — Golem', pt: true },
  'eff.edhc15.eachOpponentMay.copy.newTargets': { type: 'Instant' },
  'eff.edhc15.copy.oncePlus.eachOpponentWhoCopied': { type: 'Instant' },
  'rid.edhc15.copies.youControl.newTargets': { type: 'Instant' },
  'cm.edhc15.additional.sacrificeOneOrMore.copyForEach': { type: 'Instant' },
  'sta.edhc15.spells.cast.ripple': { type: 'Artifact' },
  'eff.edhc15.choose.anotherTargetPlayer.thanCaster': { type: 'Artifact Creature — Golem', pt: true },
  'cm.edhc15.self.less.ifTargetsSpellThatTargets': { type: 'Kindred Instant — Eldrazi' },
  'eff.edhc15.owner.putsIt.topOrBottom': { type: 'Artifact Creature — Golem', pt: true },
  'eff.edhc15.cast.upTo.instantSorcery.totalMV.graveyardOrHand.free': { type: 'Instant' },
  'rid.edhc15.cast.those.exileInstead': { type: 'Instant' },
  'eff.edhc15.cantBeCounteredOrTargeted.byBlueOrBlackSpells.thisTurn': { type: 'Instant' },
};
const parsedWith = (t: Template, text: string) => {
  const k = KIND[t.id]!;
  return parseCard(card('Example Relic', k.type, text, k.pt ? { power: '2', toughness: '2' } : {}), OPTS).faces[0]!;
};

describe('edh-cast-15 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-cast-15.json, path order: after edh-cast-13, before edh-cast-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-cast-15.json');
    expect(files.indexOf('zz-cloud/edh-cast-15.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-cast-13.json'));
    expect(files.indexOf('zz-cloud/edh-cast-15.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhc15.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|rst|trg)\.edhc15\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
      expect(KIND[t.id], t.id).toBeDefined();
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
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'when']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-cast-15 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bor more\b/, 'or less'], [/\bor less\b/, 'or more'], [/\bonce\b/i, 'twice'], [/\bcast\b/, 'exile'], [/\bspell\b/, 'ability'], [/\bcopy\b/, 'exile'], [/\bblue\b/, 'red'], [/\bprevious\b/, 'next'],
    [/\btop\b/, 'bottom'], [/\bgraveyard\b/, 'library'], [/\bhand\b/, 'library'], [/\bsacrifice\b/, 'exile'], [/\bcreatures\b/, 'artifacts'], [/\bopponent\b/, 'player'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-cast-15 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-cast-15 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (words.includes('--') && i < words.indexOf('--')) return; // the ability word before the dash has no rules meaning (CR 207.2c)
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any word (CR 122.1)
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

describe.skipIf(index === null)('edh-cast-15 design 6.10 (local index): synthetic examples', () => {
  it('no edh-cast-15 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-cast-15 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Artifact', name = 'Example Relic') => parseCard(card(name, type, text), OPTS).faces[0]!;
  const SPENT = '{T}: Add {R}. When you spend this mana to cast a spell or activate an ability, copy that spell or ability.';
  it('types/ability.ts ManaSpentTrigger.orAbilities, actions/activate.ts, actions/cast.ts#manaSpentTriggers, render/steps-cards.ts (CR 106.6, 603.2, 602.2; Sunken Palace): mana spent to activate an ability also triggers; the feature is registered', () => {
    expect(fullyAutomated(face(SPENT, 'Land'))).toBe(true);
    expect(JSON.stringify(face(SPENT, 'Land').abilities)).toContain('"orAbilities":true');
    expect(ENGINE_CAPABILITIES.has('feature:mana.whenSpent.abilities')).toBe(true);
    // "or activate an ability" with anything but any spell, or a copy of something else, is not read
    expect(fullyAutomated(face(SPENT.replace('a spell or activate', 'a red spell or activate'), 'Land'))).toBe(false);
    expect(fullyAutomated(face(SPENT.replace('copy that spell or ability', 'draw a card'), 'Land'))).toBe(false);
    // the copy's new targets are a sentence of their own (rid.copy.newTargets reaches into the mana's triggered ability, parser/lower/riders.ts#innerStep)
    expect(fullyAutomated(face(`${SPENT} You may choose new targets for the copy.`, 'Land'))).toBe(true);
  });
  it('parser/lower/ability.ts#manaShape (CR 605.1a): "You may choose new targets for the copy." after the mana\'s own trigger does not make the ability one that targets', () => {
    const f = face(`${SPENT} You may choose new targets for the copy.`, 'Land');
    expect(JSON.stringify(f.abilities)).not.toContain('"op":"manual"');
    expect(f.abilities.some((a) => a.kind === 'activated' && (a as { isMana?: boolean }).isMana === true)).toBe(true);
  });
  it('parser/lower/riders.ts "@withPrevious", rid.t45.copy.newTargets.plural "@oneOf" (CR 707.10c; Ulalek): "the copies" of two copy instructions in a row speak of both; the old shape (a count) is unchanged', () => {
    const two = 'Whenever you cast a spell, copy all spells you control, then copy all other activated and triggered abilities you control. You may choose new targets for the copies.';
    const f = parseCard(card('Example Wisp', 'Creature — Spirit', two, { power: '1', toughness: '1' }), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities).match(/"newTargets":"may"/g)?.length).toBe(2);
    const old = parseCard(card('Example Wisp', 'Sorcery', 'When you next cast a creature spell this turn, copy that spell twice. You may choose new targets for the copies.', {}), OPTS).faces[0]!;
    expect(fullyAutomated(old)).toBe(true);
    expect(ENGINE_CAPABILITIES.has('op:copy.exceptThis')).toBe(true);
  });
  it('rid.r4copy.mayCastCopy.free "@into" (CR 707.12, 603.7; Surge to Victory): the rider reaches the copy inside a delayed trigger; a copy of a card that is not exiled still stays manual', () => {
    const rite = 'Exile target instant card from your graveyard. Whenever a creature you control deals combat damage to a player this turn, copy the exiled card. You may cast the copy without paying its mana cost.';
    expect(fullyAutomated(face(rite, 'Sorcery'))).toBe(true);
    expect(JSON.stringify(face(rite, 'Sorcery').abilities)).toContain('"copyIn":"exile"');
    expect(fullyAutomated(face(rite.replace('Exile target instant card from your graveyard.', 'Draw a card.'), 'Sorcery'))).toBe(false);
  });
  it('parser/lower/anaphora.ts#itThenThatCard, movedCardFocus (CR 608.2c, 400.7; Rundvelt Hordemaster): "it" and "that card" after "exile the top card" are the exiled card, also beside a trigger about another creature; two different things stay refused', () => {
    const t = 'Whenever ~ or another Goblin you control dies, exile the top card of your library. If it\'s a Goblin creature card, you may cast that card until the end of your next turn.';
    expect(fullyAutomated(face(t, 'Creature — Goblin'))).toBe(true);
    expect(fullyAutomated(face(t.replace('If it\'s a Goblin creature card, you may cast that card', 'If that creature is a Goblin, you may cast that card'), 'Creature — Goblin'))).toBe(false);
    expect(fullyAutomated(face(t.replace('cast that card', 'cast it, and then cast that card'), 'Creature — Goblin'))).toBe(false);
  });
  it('parser/holes/object.ts#stackItemLists, render/refs.ts#stackItemsOf (CR 115.1; Subtlety): "target creature spell or planeswalker spell" is one stack-object target of two spell descriptions; a count of "up to one" is said; "up to two" is not read', () => {
    expect(fullyAutomated(face('Counter target creature spell or planeswalker spell.', 'Instant'))).toBe(true);
    expect(fullyAutomated(face('Counter target creature spell, planeswalker spell, or artifact spell.', 'Instant'))).toBe(true);
    expect(fullyAutomated(face('Counter up to two target creature spells or planeswalker spells.', 'Instant'))).toBe(false);
  });
  it('rules/targets.ts, effects/ctx.ts (CR 115.1, 608.2b; The Lord of Pain): the player target "other than" a reference is registered and read at the announcement and again at the resolution', () => {
    expect(ENGINE_CAPABILITIES.has('feature:target.player.otherThan')).toBe(true);
    const t = 'Whenever a player casts their first spell each turn, choose another target player. ~ deals damage equal to that spell\'s mana value to the chosen player.';
    expect(fullyAutomated(face(t, 'Artifact Creature — Golem'))).toBe(true);
    expect(fullyAutomated(face(t.replace('another target player', 'another target opponent'), 'Artifact Creature — Golem'))).toBe(false);
  });
  it('statics/costmods.ts#filteredTargetCount, statics/rule-match.ts, model/cap-walk.ts (CR 115.9b, 601.2c; Not of This World): the counted spell or ability is judged by what it targets; the feature is registered', () => {
    expect(ENGINE_CAPABILITIES.has('feature:spellTargetCount.filter.targets')).toBe(true);
    const t = 'Counter target spell or ability that targets a permanent you control.\n~ costs {7} less to cast if it targets a spell or ability that targets a creature you control with power 7 or greater.';
    expect(fullyAutomated(face(t, 'Kindred Instant — Eldrazi'))).toBe(true);
  });
  it('types/ability.ts AdditionalCostDef.copyForEach, actions/cast.ts#copyForEachTriggers (CR 603.12, 707.10; Plumb the Forbidden): the optional sacrifice that copies the spell once for each creature; the feature is registered', () => {
    expect(ENGINE_CAPABILITIES.has('feature:additionalCost.copyForEach')).toBe(true);
    const t = 'As an additional cost to cast this spell, you may sacrifice one or more creatures. When you do, copy this spell for each creature sacrificed this way.\nYou gain 2 life.';
    expect(fullyAutomated(face(t, 'Instant'))).toBe(true);
    expect(fullyAutomated(face(t.replace('copy this spell', 'copy this spell twice'), 'Instant'))).toBe(false);
  });
  it('keywords/data/ripple.json (CR 702.60a): ripple is implemented; the grant to spells you cast is a template', () => {
    expect(fullyAutomated(face('Spells you cast have ripple 4.', 'Artifact'))).toBe(true);
    expect(fullyAutomated(face('Spells you cast have ripple 4, 5.', 'Artifact'))).toBe(false);
  });
});
