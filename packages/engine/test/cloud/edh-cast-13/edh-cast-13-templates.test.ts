/**
 * Commander lane edh-cast, round edh-cast-13: the template data of parser/templates/zz-cloud/edh-cast-13.json ("If you cast a creature spell this way, it gains haste until end of
 * turn" on a top-of-library cast permission, Thundermane Dragon; "If X is 5 or more, this spell can't be countered and the damage can't be prevented", Banefire) and the parser, renderer
 * and engine changes of the round (one test each at the end). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every
 * counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card
 * (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-cast-13-scenarios.test.ts. CR cites from memory
 * unless named in the record (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhCast13 from '../../../src/parser/templates/zz-cloud/edh-cast-13.json';
import review from '../../m5/golden/cards/edh-cast-13-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhCast13 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only one
 * or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (decided by the owner's standing rule 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'eff.edhc13.cost.spells.opp.more.yourTurn': ['Paladin Class'],
  'eff.edhc13.lead.player.cantCast.filter': ['Hope of Ghirapur'],
  'sta.edhc13.copy.spell.extra': ['Twinning Staff'],
  'eff.edhc13.lead.pumpForEach.target.grant': ['Paladin Class'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (a sorcery); the others are abilities of a creature (static, triggered). */
const SPELL = new Set<string>(['eff.edhc13.lead.player.cantCast.filter', 'eff.edhc13.lead.pumpForEach.target.grant']);
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id)
    ? parseCard(card('Example Plan', 'Sorcery', text), OPTS)
    : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-cast-13 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-cast-13.json, path order: after edh-cast-12, before edh-cast-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-cast-13.json');
    expect(files.indexOf('zz-cloud/edh-cast-13.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-cast-12.json'));
    expect(files.indexOf('zz-cloud/edh-cast-13.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are eff.edhc13.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|rst|trg)\.edhc13\./);
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

describe('edh-cast-13 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bor more\b/, 'or less'], [/\bhaste\b/, 'flying'], [/\btop\b/, 'bottom'], [/\bonce\b/i, 'twice'], [/\bcast\b/, 'exile'], [/\bwithout paying its mana cost\b/, 'by paying its mana cost'], [/\bor less\b/, 'or more'], [/\bplay\b/, 'cast'], [/\battacked\b/, 'blocked'], [/\bspell\b/, 'ability'], [/\blife\b/, 'cards'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-cast-13 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-cast-13 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (words.includes('--') && i < words.indexOf('--')) return; // the ability word before the dash has no rules meaning (CR 207.2c)
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

describe.skipIf(index === null)('edh-cast-13 design 6.10 (local index): synthetic examples', () => {
  it('no edh-cast-13 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-cast-13 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Artifact', name = 'Example Relic') => parseCard(card(name, type, text), OPTS).faces[0]!;
  it('parser/lower/targets.ts (CR 109.2, 115.3, 608.2c; Paladin Class): "each other attacking creature" after a target of the same description is the group without the target; a source that could be in the group (a creature) leaves it manual', () => {
    const text = 'Whenever you attack, until end of turn, target attacking creature gets +1/+1 for each other attacking creature and gains double strike.';
    const f = face(text, 'Enchantment');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"not":{"is":{"ref":"target","id":"t0"}}');
    expect(JSON.stringify(f.abilities)).not.toContain('"other":true');
    // a creature could be one of the other attacking creatures: "other" is then other than the target or other than this object (never a guess)
    expect(fullyAutomated(face(text, 'Creature — Soldier'))).toBe(false);
    // "it" or another object that is not a target keeps the old refusal of "each other" (the template reads a target phrase only)
    expect(fullyAutomated(face('Whenever you attack, until end of turn, it gets +1/+1 for each other attacking creature and gains double strike.', 'Enchantment'))).toBe(false);
    // a different group than the target's own description is not read
    expect(fullyAutomated(face(text.replace('for each other attacking creature', 'for each other creature you control'), 'Enchantment'))).toBe(false);
    // without "other" the group includes the target and is the plain count
    expect(JSON.stringify(face(text.replace('each other attacking', 'each attacking'), 'Enchantment').abilities)).not.toContain('"not"');
  });
  it('parser/holes/player.ts, rules/targets.ts, effects/ctx.ts (CR 115.1, 510.2; Hope of Ghirapur): "target player who was dealt combat damage by ~ this turn" is a player target limited by the damage history; only that wording, one target, no other player word', () => {
    const base = 'Sacrifice ~: Until your next turn, target player who was dealt combat damage by ~ this turn can\'t cast noncreature spells.';
    const f = face(base, 'Artifact Creature — Thopter');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"dealtCombatDamageBySource":true');
    expect(fullyAutomated(face(base.replace('combat damage', 'damage'), 'Artifact Creature — Thopter'))).toBe(false);
    expect(fullyAutomated(face(base.replace('target player', 'target opponent'), 'Artifact Creature — Thopter'))).toBe(false);
    expect(fullyAutomated(face(base.replace('by ~', 'by a creature'), 'Artifact Creature — Thopter'))).toBe(false);
    expect(fullyAutomated(face(base.replace('this turn can', 'this turn or last turn can'), 'Artifact Creature — Thopter'))).toBe(false);
    expect(ENGINE_CAPABILITIES.has('feature:target.player.dealtCombatDamageBySource')).toBe(true);
  });
  it('statics/hooks.ts#extraSpellCopies, effects/handlers/tokens-copy.ts (CR 707.10, 614.1a; Twinning Staff): the rule effect is registered; both sentences are needed and a different multiplier is not read', () => {
    const text = 'If you would copy a spell one or more times, instead copy it that many times plus an additional time. You may choose new targets for the additional copy.';
    expect(fullyAutomated(face(text))).toBe(true);
    expect(ENGINE_CAPABILITIES.has('rulemod:extraSpellCopy')).toBe(true);
    expect(fullyAutomated(face(text.replace('an additional time', 'two additional times')))).toBe(false);
    expect(fullyAutomated(face(text.replace('a spell', 'an ability')))).toBe(false);
    expect(fullyAutomated(face(text.replace('If you would', 'If an opponent would')))).toBe(false);
    expect(fullyAutomated(face(text.split('. ')[0] + '.'))).toBe(false);
  });
  it('render/abil.ts (CR 601.2f, 500.1; family cost-spells-during-your-turn): "Spells your opponents cast during your turn cost {1} more" and "During your turn, spells your opponents cast cost {1} more" are one condition; "you cast" is not read with it', () => {
    const a = face('Spells your opponents cast during your turn cost {1} more to cast.', 'Enchantment');
    expect(fullyAutomated(a)).toBe(true);
    expect(fullyAutomated(face('Spells you cast during your turn cost {1} more to cast.', 'Enchantment'))).toBe(false);
    expect(fullyAutomated(face('Spells your opponents cast during their turns cost {1} more to cast.', 'Enchantment'))).toBe(false);
    expect(JSON.stringify(a.abilities)).toContain('"cond":"turnOf","whose":"you"');
  });
});
