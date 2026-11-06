/**
 * Commander lane edh-perms, round edh-perms-13: the template data of parser/templates/zz-cloud/edh-perms-13.json ("When you cast this spell and whenever ~ attacks") and the
 * round's hole, lowering and renderer changes ("each player who controls an F", "each player other than its controller", "if you're not the monarch", "you may have it become a
 * copy of another target F", the copy a sentence before), tested at the end of this file and in edh-perms-13-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-perms-13-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhPm13 from '../../../src/parser/templates/zz-cloud/edh-perms-13.json';
import review from '../../m5/golden/cards/edh-perms-13-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhPm13 as Template[];
const MECH_COUNT = 2;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full
  'trg.edhpm13.castSelfAndWhenever': ['Cityscape Leveler'],
  'eff.edhpm13.copy.token.andTappedAttacking': ['Flamerush Rider'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic creature card with the example as its ability (a cast trigger of the spell itself functions on the stack: the card is an artifact creature). */
const parsedWith = (_t: Template, text: string) => parseCard(card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;

describe('edh-perms-13 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-perms-13.json, path order: after edh-perms-11, before edh-perms-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-perms-13.json');
    expect(files.indexOf('zz-cloud/edh-perms-13.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-perms-11.json'));
    expect(files.indexOf('zz-cloud/edh-perms-13.json')).toBeLessThan(files.indexOf('zz-cloud/edh-perms-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are trg.edhpm13.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg)\.edhpm13\./);
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

describe('edh-perms-13 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bwhenever ~ attacks\b/, 'whenever ~ blocks'], [/\bwhen you cast\b/, 'when an opponent casts'], [/\bwhen you cast\b/, 'whenever you cast'], [/\byou gain 2 life\b/, 'you gain 3 life'],
    [/\btarget creature\b/, 'target artifact'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-perms-13 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-perms-13 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-perms-13 design 6.10 (local index): synthetic examples', () => {
  it('no edh-perms-13 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-perms-13 parser, lowering and renderer changes (one test each)', () => {
  const spell = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  const creature = (text: string, type = 'Creature — Dinosaur') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/holes/player.ts + types PlayerRef controlsAny + effects/refs.ts + render/refs.ts (CR 109.4, 101.4): "each player who controls an F" reads with a singular description; plural, "the most", an owner or a zone are not read as it', () => {
    const ok = spell('Each player who controls an artifact or enchantment gains 3 life.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"ref":"controlsAny"');
    expect(fullyAutomated(spell('Each player who controls artifacts gains 3 life.'))).toBe(false);
    expect(fullyAutomated(spell('Each player who controls an artifact you own gains 3 life.'))).toBe(false);
    expect(fullyAutomated(spell('Each player who controls an artifact card in a graveyard gains 3 life.'))).toBe(false);
    expect(JSON.stringify(spell('Each player who controls the most artifacts gains 3 life.').abilities)).toContain('"ref":"controlsMost"');
  });
  it('parser/holes/player.ts + render/refs.ts (CR 608.2c, 101.4): "each player other than its controller" reads after a target; with no object to name ("each player other than it") or a group it is not read', () => {
    const ok = spell('Exile target nonland permanent. Each player other than its controller creates a token that\'s a copy of it.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"ref":"otherOf"');
    expect(fullyAutomated(spell('Each player other than its controller gains 2 life.'))).toBe(false);
    expect(fullyAutomated(spell('Exile target nonland permanent. Each player other than each opponent gains 2 life.'))).toBe(false);
  });
  it('parser/lower/anaphora.ts (CR 608.2c; review finding): a later "they/their" after "each player other than F" or "each player who controls an F" is ambiguous, so the sentence stays manual', () => {
    expect(fullyAutomated(spell('Each player other than target player loses life equal to the number of cards in their hand.'))).toBe(false);
    expect(fullyAutomated(spell('Each player other than target player discards a card.'))).toBe(false); // a named player is not read as the excluded one
    expect(fullyAutomated(spell('Exile target creature. Each player other than its controller discards a card. Then they draw a card.'))).toBe(false);
    expect(fullyAutomated(spell('Each player who controls an artifact discards a card. Then they draw a card.'))).toBe(false);
  });
  it('parser/holes/cond.ts + render/cond.ts (CR 725.1): "if you\'re not the monarch" is the negated designation; "an opponent isn\'t the monarch" and "you aren\'t the monarch" are not read', () => {
    const ok = creature('At the beginning of your upkeep, if you\'re not the monarch, draw a card.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"cond":"not"');
    expect(fullyAutomated(creature('At the beginning of your upkeep, if an opponent isn\'t the monarch, draw a card.'))).toBe(false);
    expect(fullyAutomated(creature("At the beginning of your upkeep, if you aren't the monarch, draw a card."))).toBe(false);
  });
  it('parser/lower/anaphora.ts (CR 707.2): in "you may have it become a copy of another target F", "it" is the object that becomes the copy (the attacker), never the target it copies', () => {
    const ok = creature('Whenever this creature attacks, you may have it become a copy of another target Dinosaur you control, except it has this ability.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"affects":{"ref":"event","role":"attacker"}');
  });
  it('parser/lower/anaphora.ts (CR 707.2): "a copy of it" in the sentence after a token copy of the same target is the target, not the token the other branch made', () => {
    const ok = parseCard(card('Example Court', 'Enchantment', 'At the beginning of your upkeep, choose up to one other target enchantment or artifact. If you\'re the monarch, you may create a token that\'s a copy of it. If you\'re not the monarch, you may have this enchantment become a copy of it, except it has this ability.'), OPTS).faces[0]!;
    expect(fullyAutomated(ok)).toBe(true);
  });
  it('parser/lower/trigger-zone.ts + ability.ts + cast-self.ts (CR 113.6k, 601.2i): the cast trigger of the spell itself with its own attack functions on the stack and the battlefield; with a blocks trigger, an intervening "if" or an effect that names the spell it stays manual', () => {
    const ok = creature('When you cast this spell and whenever this creature attacks, you gain 2 life.', 'Artifact Creature — Construct');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"zone":["stack","battlefield"]');
    const no = (t: string) => fullyAutomated(creature(t, 'Artifact Creature — Construct'));
    expect(no('When you cast this spell and whenever this creature blocks, you gain 2 life.')).toBe(false);
    expect(no('When you cast this spell and whenever this creature attacks while saddled, you gain 2 life.')).toBe(true); // the attack event keeps its own condition
    expect(no('When you cast this spell and whenever this creature attacks, if you control a creature, you gain 2 life.')).toBe(false);
    expect(no('When you cast this spell and whenever this creature attacks, return this creature to its owner\'s hand.')).toBe(false);
    expect(no('Whenever an opponent casts a spell and whenever this creature attacks, you gain 2 life.')).toBe(true);
  });
});
