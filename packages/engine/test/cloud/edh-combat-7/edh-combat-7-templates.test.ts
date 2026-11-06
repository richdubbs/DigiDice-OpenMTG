/**
 * Commander lane edh-combat, round edh-combat-7: the template data of parser/templates/zz-cloud/edh-combat-7.json ("you may reselect which player or permanent <object> is attacking",
 * "put <object> onto the battlefield attacking", "artifact offering", "you choose which creatures block this combat and how those creatures block", "cast ~ only during the declare
 * blockers step on an opponent's turn", "remove <objects> from combat and untap them. After this phase, there is an additional combat phase. ...") and the round's reader, renderer and engine
 * changes (the step event "each of enchanted player's postcombat main phases", the exile-zone trigger "if ~ is exiled", "creatures attacking your opponents", the attacks event's "at least N
 * other creatures", offering as a sacrifice cost that reduces the total by the permanent's mana cost, control of the block declaration).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to
 * different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic
 * wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-combat-7-scenarios.test.ts. CR cites checked against the
 * Comprehensive Rules of 2026-09-25 (rules/cr/ is not in the cloud checkout; the text was fetched from media.wizards.com).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhCb7 from '../../../src/parser/templates/zz-cloud/edh-combat-7.json';
import review7 from '../../m5/golden/cards/edh-combat-7-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhCb7 as Template[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'eff.edhcb7.reselect.target': ['Misleading Signpost'],
  'eff.edhcb7.put.bf.attacking': ['Senu, Keen-Eyed Protector'],
  'kw.edhcb7.artifactOffering': ['Blast-Furnace Hellkite'],
  'eff.edhcb7.youChooseBlocks': ['Odric, Master Tactician'],
  'rst.edhcb7.cast.self.declareBlockersOpponentsTurn': ["Illusionist's Gambit"],
  'eff.edhcb7.removeAttackersExtraCombat': ["Illusionist's Gambit"],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (an instant or sorcery); the others are abilities of a creature. */
const SPELL = new Set<string>(['eff.edhcb7.put.bf.attacking', 'rst.edhcb7.cast.self.declareBlockersOpponentsTurn', 'eff.edhcb7.removeAttackersExtraCombat']);
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Subject', 'Instant', text), OPTS) : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2', mana_cost: '{4}{R}{R}' }), OPTS)).faces[0]!;

describe('edh-combat-7 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-combat-7.json, path order: after edh-combat-6, before edh-mana-keywords-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-combat-7.json');
    expect(files.indexOf('zz-cloud/edh-combat-7.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-combat-6.json'));
    expect(files.indexOf('zz-cloud/edh-combat-7.json')).toBeLessThan(files.indexOf('zz-cloud/edh-mana-keywords-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are sta./eff./rid.edhcb7.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|rid|dl|kw|rst)\.edhcb7\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = review7 as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) for (const n of NARROW[t.id]!) expect(cards, t.id).toContain(n);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'also']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-combat-7 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bgets\b/, 'loses'], [/\btapped and attacking\b/, 'tapped and blocking'], [/\bend of combat\b/, 'end of turn'], [/\bthat's attacking\b/, "that's blocking"],
    [/\bhas\b/, 'loses'], [/\bYou control\b/, 'An opponent controls'], [/\byou control\b/, 'an opponent controls'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-combat-7 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-combat-7 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-combat-7 design 6.10 (local index): synthetic examples', () => {
  it('no edh-combat-7 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-combat-7 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Creature — Advisor', name = 'Example Relic') => parseCard(card(name, type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : {}), OPTS).faces[0]!;
  it('parser/holes/event.ts + render/evt.ts (CR 505.1a, 603.2, 303.4): "each of enchanted player\'s postcombat main phases" is every postcombat main phase of the Aura\'s player; "each of your", another player and another step are other things', () => {
    const a = face("Enchant player\nAt the beginning of each of enchanted player's postcombat main phases, you gain 1 life.", 'Enchantment — Aura');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"whose":{"ref":"enchantedPlayer"}');
    expect(jsonKey(a.abilities)).toBe(jsonKey(face("Enchant player\nAt the beginning of enchanted player's postcombat main phase, you gain 1 life.", 'Enchantment — Aura').abilities));
    for (const other of ["Enchant player\nAt the beginning of each of enchanted player's precombat main phases, you gain 1 life.", "Enchant player\nAt the beginning of each of target player's postcombat main phases, you gain 1 life.", "Enchant player\nAt the beginning of each of enchanted player's main phases, you gain 1 life."]) {
      const f = face(other, 'Enchantment — Aura');
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(a.abilities), other).toBe(false);
    }
  });
  it('parser/lower/trigger-zone.ts + parser/lower/ability.ts (CR 113.6m, 603.4): a trigger with the intervening "if ~ is exiled" functions in exile and its bare "it" is that card; "if ~ is in exile" reads the same zone; no other off-battlefield wording is automated by it', () => {
    const a = face("When a legendary creature you control attacks and isn't blocked, if ~ is exiled, put it onto the battlefield attacking.");
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"zone":["exile"]');
    expect(JSON.stringify(a.abilities)).toContain('"what":{"ref":"self"}');
    expect(JSON.stringify(a.abilities)).toContain('"attacking":true');
    for (const other of ["When a legendary creature you control attacks and isn't blocked, if ~ is exiled, return it to your hand.", "When a legendary creature you control attacks and isn't blocked, put it onto the battlefield attacking."]) {
      const f = face(other);
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(a.abilities), other).toBe(false);
    }
  });
  it('parser/holes/filter.ts + render/np.ts (CR 508.1b, 102.3): "creatures attacking your opponents" is attacking a player who is an opponent (never a planeswalker); "attacking you" and "attacking a player" are other readings', () => {
    const a = face('Creatures attacking your opponents have trample.', 'Enchantment');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"attacking":{"defender":"opponent"}');
    expect(jsonKey(a.abilities)).toBe(jsonKey(face('Creatures that are attacking one of your opponents have trample.', 'Enchantment').abilities));
    for (const other of ['Creatures attacking you have trample.', 'Creatures attacking a player have trample.', 'Creatures attacking your opponent have trample.']) {
      const f = face(other, 'Enchantment');
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(a.abilities), other).toBe(false);
    }
  });
  it('parser/holes/event.ts + render/evt.ts (CR 508.1, 603.2c): "~ and at least three other creatures attack" is the source as one of four or more attackers declared together (the battalion shape); "at least two" is the battalion template\'s, the same JSON with three', () => {
    const a = face('Whenever ~ and at least three other creatures attack, you gain 1 life.');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"count":{"op":">=","value":4}');
    const two = face('Whenever ~ and at least two other creatures attack, you gain 1 life.');
    expect(fullyAutomated(two)).toBe(true);
    expect(JSON.stringify(two.abilities)).toContain('"count":{"op":">=","value":3}');
    for (const other of ['Whenever ~ and at least three other creatures block, you gain 1 life.', 'Whenever ~ and at least three creatures attack, you gain 1 life.', 'Whenever ~ and three other creatures attack, you gain 1 life.']) {
      const f = face(other);
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(a.abilities), other).toBe(false);
    }
  });
  it('effects/handlers/edh-combat-7.ts + core/combat.ts + core/player-control.ts (CR 509.1, 723.1): control of the block declaration is advertised as the op controlBlocks, in its one form (you)', () => {
    expect(ENGINE_CAPABILITIES.has('op:controlBlocks')).toBe(true);
    const a = face('Whenever ~ attacks, you choose which creatures block this combat and how those creatures block.');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"op":"controlBlocks","who":{"ref":"you"}');
  });
  it('rules/payment-options.ts + actions/cast.ts + keywords/data/offering.json + render/kw.ts (CR 702.48a-c): offering is a cast option with a sacrifice cost like emerge; only the artifact quality and the Patrons\' creature types are read (edh-c-92)', () => {
    const a = face('Artifact offering\nFlying', 'Creature — Dragon', 'Example Drake');
    expect(JSON.stringify(a.abilities)).toContain('"keyword":"offering"');
    for (const other of ['Elf offering\nFlying', 'Artifact offering {1}\nFlying', 'Offering\nFlying']) {
      const f = face(other, 'Creature — Dragon', 'Example Drake');
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(a.abilities), other).toBe(false);
    }
  });
  it('effects/handlers/zones-status.ts (CR 608.2c): removeFromCombat names the creatures it removed (`as`) for the sentences after it, and the fold prints the four sentences of the Gambit only in that exact shape', () => {
    const real = parseCard(card('Example Subject', 'Instant', 'Remove all attacking creatures from combat and untap them. After this phase, there is an additional combat phase. Each of those creatures attacks that combat if able. They can\'t attack you or planeswalkers you control that combat.'), OPTS).faces[0]!;
    expect(fullyAutomated(real)).toBe(true);
    expect(JSON.stringify(real.abilities)).toContain('"as":"those"');
    expect(JSON.stringify(real.abilities)).toContain('"phase":"added"');
  });
});
