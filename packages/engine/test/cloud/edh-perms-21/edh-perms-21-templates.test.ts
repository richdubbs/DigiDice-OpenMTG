/**
 * Commander lane edh-perms, round edh-perms-21: the template data of parser/templates/zz-cloud/edh-perms-21.json (a protection that keeps its own Aura, a copy
 * token with no comma before "except", "exile all other tokens created with ~", an entering permanent that becomes a creature, "only X can be enchanted this way",
 * a token copy of one chosen permanent) and the round's parser, lowering and renderer changes, tested at the end of this
 * file and in edh-perms-21-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. CR cites checked against the Comprehensive Rules of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { instantiate, validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhPm21 from '../../../src/parser/templates/zz-cloud/edh-perms-21.json';
import review from '../../m5/golden/cards/edh-perms-21-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhPm21 as Template[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards of the EDHREC top 5,000 (or elsewhere only on cards out of reach), with their template tests (G9, G2) and played scenarios. Listed in
 * the round's record for the owner (DECIDED BY DEFAULT, owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhpm21.copyToken.except.noComma': ['Faerie Artisans'],
  'eff.edhpm21.exile.otherTokensCreatedWithSelf': ['Faerie Artisans'],
  'sta.edhpm21.enters.becomes.creature': ['Displaced Dinosaurs'],
  'rid.edhpm21.onlyFilter.canBeEnchantedThisWay': ['Retether'],
  'eff.edhpm21.copyToken.ofOneYouControl': ['Calix, Guided by Fate', 'Summon: Good King Mog XII'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind (an Aura for "Enchant ...", a trigger or "{cost}:" is a permanent's, an effect on its own a spell's). */
function exampleCard(text: string): OracleCard {
  if (/^Enchanted /.test(text)) return card('Example Charm', 'Enchantment — Aura', `Enchant creature\n${text}`);
  if (/^As (a|an) /.test(text)) return card('Example Brute', 'Creature — Elf Warrior', text, { power: '2', toughness: '2' });
  if (/^(when|whenever|at) /i.test(text)) return card('Example Engine', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' });
  if (/^\{[^}]*\}[^:]*:/.test(text)) return card('Example Relic', 'Artifact', text);
  return card('Example Volley', 'Sorcery', text);
}
const parsedWith = (_t: Template, text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

describe('edh-perms-21 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-perms-21.json, path order: after edh-perms-2, before edh-perms-3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-perms-21.json');
    expect(files.indexOf('zz-cloud/edh-perms-21.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-perms-2.json'));
    expect(files.indexOf('zz-cloud/edh-perms-21.json')).toBeLessThan(files.indexOf('zz-cloud/edh-perms-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids end with the round code edhpm21', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid)\.edhpm21\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
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

describe('edh-perms-21 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/protection from/, 'hexproof from'], [/doesn't remove/, 'removes'], [/in addition to its other types/, 'instead of its other types'], [/can be enchanted this way/, 'can be attached this way'],
    [/other tokens/, 'tokens'], [/a copy of/, 'two copies of'], [/you control/, 'an opponent controls'], [/or more/, 'or fewer'], [/remove those counters/, 'remove a counter'], [/ transform it/, ' sacrifice it'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-perms-21 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-perms-21 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter kind is any word (Oracle invents them)
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

describe.skipIf(index === null)('edh-perms-21 design 6.10 (local index): synthetic examples', () => {
  it('no edh-perms-21 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-perms-21 parser, lowering and renderer changes (one test each)', () => {
  const aura = (text: string) => parseCard(card('Example Charm', 'Enchantment — Aura', `Enchant creature\n${text}`), OPTS).faces[0]!;
  const spell = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  const permanent = (text: string, type = 'Enchantment') => parseCard(card('Example Relic', type, text), OPTS).faces[0]!;
  it('parser/chart.ts $mergeEach (CR 702.16c): the members of the object are added to each object of the list; a missing list, a non-object member or a non-object is no value', () => {
    expect(instantiate({ $mergeEach: ['$a', { k: 1 }] }, { a: [{ x: 1 }, { x: 2, k: 0 }] })).toEqual([{ x: 1, k: 1 }, { x: 2, k: 1 }]);
    expect(instantiate({ $mergeEach: ['$a', { k: 1 }] }, {})).toBeUndefined();
    expect(instantiate({ $mergeEach: ['$a', { k: 1 }] }, { a: [1] })).toBeUndefined();
    expect(instantiate({ $mergeEach: ['$a', '$b'] }, { a: [{ x: 1 }], b: [1] })).toBeUndefined();
  });
  it('rules/protection.ts + render/mods.ts (CR 702.16c, 704.5m): the exception is a protection granted by a static ability, said with "this effect doesn\'t remove ~"; another keyword has no such wording', () => {
    expect(fullyAutomated(aura("Enchanted creature has protection from red. This effect doesn't remove this Aura."))).toBe(true);
    expect(JSON.stringify(aura("Enchanted creature has protection from red. This effect doesn't remove this Aura.").abilities)).toContain('"exceptAttached":{"ref":"grantor"}');
    expect(fullyAutomated(aura("Enchanted creature has flying. This effect doesn't remove this Aura."))).toBe(false);
    expect(fullyAutomated(aura("Enchanted creature has protection from red until end of turn. This effect doesn't remove this Aura."))).toBe(false);
    expect(fullyAutomated(aura('Enchanted creature has protection from red.'))).toBe(true); // the older reading is unchanged
    expect(JSON.stringify(aura('Enchanted creature has protection from red.').abilities)).not.toContain('exceptAttached');
  });
  it('effects/handlers/zones-move.ts + render/steps-zones.ts (CR 303.4f, 303.4g): the restriction of what the returned Auras enchant is a sentence after the move; on a move that is not onto the battlefield, or after another instruction, it is not read', () => {
    expect(fullyAutomated(spell('Put each Aura card from your hand onto the battlefield. Only lands can be enchanted this way.'))).toBe(true);
    expect(fullyAutomated(spell('Put each Aura card from your hand into your graveyard. Only lands can be enchanted this way.'))).toBe(false);
    expect(fullyAutomated(spell('Draw a card. Only lands can be enchanted this way.'))).toBe(false);
  });
  it('effects/bodies/m5.ts + effects/perform-events.ts (CR 614.1c, 205.1b, 613.4b): the entering permanent becomes a creature of a size and a type in addition to its other types, for another permanent only', () => {
    expect(fullyAutomated(permanent('As an artifact you control enters, it becomes a 5/5 Golem creature in addition to its other types.', 'Creature — Elf'))).toBe(true);
    expect(fullyAutomated(permanent('As an artifact you control enters, it becomes a 5/5 Golem creature.', 'Creature — Elf'))).toBe(false);
    expect(fullyAutomated(permanent('As an artifact you control enters, it becomes a 5/5 Golem creature in addition to its other types until end of turn.', 'Creature — Elf'))).toBe(false);
  });
  it('effects/handlers/tokens-copy.ts + effects/refs.ts + render/refs.ts (Faerie Artisans ruling 2016-11-08): "all other tokens created with ~" needs the copy that made them in the same ability; alone it is not read', () => {
    const ok = permanent("Whenever a creature an opponent controls enters, create a token that's a copy of that creature except it's an artifact in addition to its other types. Then exile all other tokens created with this creature.", 'Creature — Faerie');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"link":"created"');
    expect(fullyAutomated(permanent('Whenever you cast a spell, exile all other tokens created with this creature.', 'Creature — Faerie'))).toBe(false);
    expect(fullyAutomated(permanent("Whenever a creature an opponent controls enters, create a token that's a copy of that creature except it's an artifact in addition to its other types. Then exile all tokens created with this creature.", 'Creature — Faerie'))).toBe(false);
  });
  it('triggers/normalize.ts + parser/lower/scope.ts (event role spellTarget; CR 115.9c, 608.2h): "that artifact or creature" of a cast trigger is the one object the spell targets; "that spell" stays the spell', () => {
    const ok = permanent("Whenever you cast a spell that targets only a single artifact or creature you control, create a token that's a copy of that artifact or creature, except it's not legendary.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"role":"spellTarget"');
    expect(fullyAutomated(permanent('Whenever you cast an instant or sorcery spell that targets only a single creature you control, copy that spell.'))).toBe(true);
    expect(fullyAutomated(permanent("Whenever you cast a spell that targets only a single artifact or creature you control, create a token that's a copy of that land, except it's not legendary."))).toBe(false);
  });
  it('render/fold.ts#chooseOneCopyToken (CR 707.2, 111.2, 608.2d): a token copy of one chosen permanent of a description, no target; a target stays another template', () => {
    expect(fullyAutomated(permanent("At the beginning of your upkeep, create a token that's a copy of a Goblin you control."))).toBe(true);
    expect(JSON.stringify(permanent("At the beginning of your upkeep, create a token that's a copy of a Goblin you control.").abilities)).toContain('"op":"chooseObjects"');
    expect(fullyAutomated(permanent("At the beginning of your upkeep, create two tokens that are copies of a Goblin you control."))).toBe(false); // (the plural wording has no choice template)
  });
});
