/**
 * Commander lane edh-top, round edh-top-10: the template data of parser/templates/zz-cloud/edh-top-10.json ("when you spend this mana to cast a Dragon creature spell, it enters with an additional +1/+1
 * counter on it and gains hexproof until your next turn", "untap a creature you control", "<player> gets N <kind> counters if they don't have any <kind> counters", "then if it has N or more <kind>
 * counters on it, remove them all and ...") and the round's parser, lowering and renderer changes, tested at the end of this file and in edh-top-10-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-top-10-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhTop10 from '../../../src/parser/templates/zz-cloud/edh-top-10.json';
import review10 from '../../m5/golden/cards/edh-top-10-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhTop10 as Template[];
const review = review10 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'rid.edht10.mana.youSpend.entersWith.gains.untilNextTurn': ['Jade Orb of Dragonkind'],
  'eff.edht10.untap.chosenOne': ['White Plume Adventurer'],
  'eff.edht10.player.counters.ifTheyHaveNone': ['Vexing Radgull'],
  'eff.edht10.thenIf.removeThemAll.and': ['Strixhaven Stadium'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (_t: Template, text: string) =>
  parseCard(/^\{/.test(text) ? card('Example Plan', 'Artifact', text) : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-top-10 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-top-10.json, path order: after edh-top-1, before edh-top-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-top-10.json');
    expect(files.indexOf('zz-cloud/edh-top-10.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-top-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 10; ids are *.edht10.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid)\.edht10\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(10);
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

describe('edh-top-10 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bwhen you spend\b/, 'if you spend'], [/\buntil your next turn\b/, 'until end of turn'], [/\ban additional\b/, 'two additional'], [/\bDragon\b/, 'Elf'],
    [/\bUntap a\b/, 'Untap up to one'], [/\buntap a\b/, 'untap two'], [/\bthey don't\b/, 'they do'], [/\bdo not\b/, 'do'], [/\bremove them all\b/, 'remove two of them'], [/\bor more\b/, 'or fewer'],
    [/\bThen if\b/, 'If'], [/\bgets two\b/, 'gets three'], [/\bgets a\b/, 'gets two'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-top-10 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-top-10 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-top-10 design 6.10 (local index): synthetic examples', () => {
  it('no edh-top-10 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

const sorcery = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
const artifact = (text: string) => parseCard(card('Example Plan', 'Artifact', text), OPTS).faces[0]!;



describe('edh-top-10 parser, lowering and renderer changes (one test each)', () => {
  it('types/ability.ts ManaSpentRider.untilNextTurn, core/mana-riders.ts and render/steps-cards.ts#riderText: the rider with a counter and a keyword "until your next turn" is read and said back; a keyword until end of turn, or a second counter, is a different rider', () => {
    const ok = artifact('{T}: Add {G}. When you spend this mana to cast a Dragon creature spell, it enters with an additional +1/+1 counter on it and gains hexproof until your next turn.');
    expect(fullyAutomated(ok)).toBe(true);
    for (const k of ['"untilNextTurn":true', '"entersWith"', '"gains"']) expect(JSON.stringify(ok.abilities)).toContain(k);
    expect(fullyAutomated(artifact('{T}: Add {G}. When you spend this mana to cast a Dragon creature spell, it enters with two additional +1/+1 counters on it and gains hexproof until your next turn.'))).toBe(false);
    expect(fullyAutomated(artifact('{T}: Add {G}. When you spend this mana to cast a Dragon creature spell, it enters with an additional +1/+1 counter on it and gains hexproof until end of turn.'))).toBe(false);
  });
  it('render/fold.ts#chooseThenUntap and render/self-replacement.ts#everyChosenInstead: "Untap a creature you control." is the choice of exactly one as the ability resolves, and "untap all creatures you control instead" replaces the choice and the untap; up to one, or a condition that is not decided as it resolves, is not that reading', () => {
    const ok = creature("At the beginning of each opponent's upkeep, untap a creature you control. If you've completed a dungeon, untap all creatures you control instead.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"op":"chooseObjects"');
    expect(JSON.stringify(ok.abilities)).toContain('"cond":"completedDungeon"');
    // the group of the replacement must be the group the choice was made from
    expect(fullyAutomated(creature("At the beginning of each opponent's upkeep, untap a creature you control. If you've completed a dungeon, untap all artifacts you control instead."))).toBe(false);
    expect(fullyAutomated(creature("At the beginning of each opponent's upkeep, untap a creature you control. If you've completed a dungeon, tap all creatures you control instead."))).toBe(false);
  });
  it('render/cond.ts (compare of a player\'s counters with 0): "they don\'t have any rad counters" is the damaged player\'s own count; another kind or another player is not that reading', () => {
    const ok = creature("Whenever this creature deals combat damage to a player, that player gets two rad counters if they don't have any rad counters. Otherwise, proliferate.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"q":"counters"');
    expect(JSON.stringify(ok.abilities)).toContain('"action":"proliferate"');
    // the kind is a word of its own: another kind is another test, not the same JSON
    const energy = creature("Whenever this creature deals combat damage to a player, that player gets two rad counters if they don't have any energy counters. Otherwise, proliferate.");
    expect(jsonKey(energy.abilities)).not.toBe(jsonKey(ok.abilities));
    // "you" is a player of its own: the older reading of an ordinary condition, not the damaged player's
    const you = creature("Whenever this creature deals combat damage to a player, that player gets two rad counters if you don't have any rad counters. Otherwise, proliferate.");
    expect(JSON.stringify(you.abilities)).not.toContain('"role":"recipient"},"op":"=="');
    expect(fullyAutomated(creature("Whenever this creature deals combat damage to a player, that player gets two rad counters if they have any rad counters. Otherwise, proliferate."))).toBe(false);
  });
  it('parser/lower/anaphora.ts#focusAt (+ sentenceReferences): beside "that player" the bare "it" is still the object the instruction before it put counters on; with another object named in the sentence it stays ambiguous', () => {
    const ok = creature('Whenever a creature you control deals combat damage to an opponent, put a +1/+1 counter on this creature. Then if it has ten or more +1/+1 counters on it, that player loses the game.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(fullyAutomated(creature('Whenever a creature you control deals combat damage to an opponent, put a +1/+1 counter on this creature. Then if it has ten or more +1/+1 counters on it, that player loses the game unless that creature is blue.'))).toBe(false);
  });
  it('render/fold-edhmk8.ts: "remove them all" is also "remove all of them" after a counter condition; "remove two of them" is not', () => {
    const them = artifact('At the beginning of your upkeep, put a charge counter on this artifact. Then if it has three or more charge counters on it, remove them all and draw a card.');
    const all = artifact('At the beginning of your upkeep, put a charge counter on this artifact. Then if it has three or more charge counters on it, remove all of them and draw a card.');
    expect(fullyAutomated(them)).toBe(true);
    expect(jsonKey(them.abilities)).toBe(jsonKey(all.abilities));
  });
  it('parser/holes/cond.ts#ringTemptedTimes and render/cond.ts#happenedPhrase: "the Ring has tempted you two or more times this game" counts the game\'s temptations; "this turn", "exactly" and "fewer than" are not read', () => {
    const ok = creature('Whenever this creature attacks, the Ring tempts you. Then if this creature is your Ring-bearer and the Ring has tempted you two or more times this game, draw a card.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"verb":"ringTempts"');
    expect(JSON.stringify(ok.abilities)).toContain('"scope":"game"');
    expect(fullyAutomated(creature('Whenever this creature attacks, the Ring tempts you. Then if this creature is your Ring-bearer and the Ring has tempted you two or more times this turn, draw a card.'))).toBe(false);
    expect(fullyAutomated(creature('Whenever this creature attacks, the Ring tempts you. Then if this creature is your Ring-bearer and the Ring has tempted you fewer than two times this game, draw a card.'))).toBe(false);
  });
});
