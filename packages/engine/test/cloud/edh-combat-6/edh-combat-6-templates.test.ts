/**
 * Commander lane edh-combat, round edh-combat-6: the template data of parser/templates/zz-cloud/edh-combat-6.json ("<player> draws a card if <condition>", "Each opponent can't block with
 * more than one creature this combat", "~ can attack players who attacked you during their last turn as though it didn't have defender", "Whenever <creature> deals combat damage to a
 * player this combat, ...") and the round's reader, renderer and engine changes ("another player attacks with N or more creatures", "none of those creatures attacked you", "that opponent"
 * for the controller of the creatures that dealt combat damage to you, "one or more players being attacked are poisoned", "fight" as an event, the per-player block limit).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to
 * different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic
 * wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-combat-6-scenarios.test.ts. CR cites checked against the
 * Comprehensive Rules of 2026-09-25 (rules/cr/ is not in the cloud checkout; the text was fetched from media.wizards.com).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhCb6 from '../../../src/parser/templates/zz-cloud/edh-combat-6.json';
import review6 from '../../m5/golden/cards/edh-combat-6-review.json';
import reviewR5 from '../../m5/golden/cards/cloud-r5-static-review.json'; // Mirri's entry is in the file of the template's own round (the promotion of sta.r5static.aslong.limit.attackYou)
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhCb6 as Template[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'eff.edhcb6.draw.player.ifCond': ['Firemane Commando'],
  'eff.edhcb6.eachOpponent.cantBlockMoreThan': ['Mirri, Weatherlight Duelist'],
  'sta.edhcb6.attack.noDefender.attackedYouLastTurn': ['Weathered Sentinels'],
  'eff.edhcb6.whenever.thatCreature.combatDamage.thisCombat': ['Stensian Sanguinist // Exsanguinate'],
  'sta.edhcb6.attack.onlyAlone': ['Master of Cruelties'],
  'eff.edhcb6.obj.assignsNoCombatDamage': ['Master of Cruelties'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (a sorcery); the others are abilities of a creature. */
const SPELL = new Set<string>(['eff.edhcb6.whenever.thatCreature.combatDamage.thisCombat']);
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Sorcery', text, { mana_cost: '{X}{W}' }), OPTS) : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-combat-6 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-combat-6.json, path order: after edh-combat-5, before edh-mana-keywords-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-combat-6.json');
    expect(files.indexOf('zz-cloud/edh-combat-6.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-combat-5.json'));
    expect(files.indexOf('zz-cloud/edh-combat-6.json')).toBeLessThan(files.indexOf('zz-cloud/edh-mana-keywords-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are sta./eff./rid.edhcb6.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|rid|dl)\.edhcb6\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = [...(review6 as { card: string; verified: string; expect?: string }[]), ...(reviewR5 as { card: string; verified: string; expect?: string }[]).filter((g) => g.card === 'Mirri, Weatherlight Duelist')];
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

describe('edh-combat-6 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-combat-6 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-combat-6 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-combat-6 design 6.10 (local index): synthetic examples', () => {
  it('no edh-combat-6 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-combat-6 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Creature — Advisor', name = 'Example Relic') => parseCard(card(name, type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : {}), OPTS).faces[0]!;
  it('parser/holes/event.ts + render/evt.ts (CR 508.1a, 603.2c): "whenever another player attacks with N or more creatures" is the declaration of an opponent with at least N attackers; "a player" and a different count are other readings', () => {
    const a = face('Whenever another player attacks with two or more creatures, you gain 2 life.');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"controller":"opponent"');
    expect(jsonKey(a.abilities)).toBe(jsonKey(face('Whenever an opponent attacks with two or more creatures, you gain 2 life.').abilities));
    for (const other of ['Whenever a player attacks with two or more creatures, you gain 2 life.', 'Whenever another player attacks with three or more creatures, you gain 2 life.', 'Whenever another player attacks with two or more Goblins, you gain 2 life.']) {
      const f = face(other);
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(a.abilities), other).toBe(false);
    }
  });
  it('parser/holes/cond.ts + render/cond.ts (CR 508.1b, 506.3, 608.2): "none of those creatures attacked you" is no attack on you (the player) in this combat; "attacked a planeswalker you control" or another wording is another thing', () => {
    const a = face('Whenever an opponent attacks with three or more creatures, they draw a card if none of those creatures attacked you.');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"cond":"not","of":{"cond":"happened","event":{"ev":"attacks","attacker":{"types":["Creature"]},"defender":"you"},"scope":"combat"}');
    for (const other of ['Whenever an opponent attacks with three or more creatures, they draw a card if none of those creatures attacked a planeswalker.', 'Whenever an opponent attacks with three or more creatures, they draw a card if none of those creatures attacked.', 'Whenever an opponent attacks with three or more creatures, they draw a card if one of those creatures attacked you.']) {
      const f = face(other);
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(a.abilities), other).toBe(false);
    }
  });
  it('parser/lower/scope.ts + render/refs.ts (CR 109.4, 506.4, 510.2): "that opponent" after creatures an opponent controls dealt combat damage to you is their controller; to another player, or by your own creatures, it names nobody', () => {
    const a = face('Whenever one or more creatures an opponent controls deal combat damage to you, that opponent gets a poison counter.', 'Enchantment');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"on":{"ref":"controllerOf","object":{"ref":"event","role":"source"}}');
    for (const other of ['Whenever one or more creatures an opponent controls deal combat damage to an opponent, that opponent gets a poison counter.', 'Whenever one or more creatures you control deal combat damage to you, that opponent gets a poison counter.', 'Whenever one or more creatures an opponent controls deal damage to you, that opponent gets a poison counter.']) {
      const f = face(other, 'Enchantment');
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(a.abilities), other).toBe(false);
    }
    // "to you, that player ..." used to read the damaged player (you) as "that player": it is the opponent now
    expect(fullyAutomated(face('Whenever one or more creatures an opponent controls deal combat damage to you, that player loses 1 life.', 'Enchantment'))).toBe(true);
  });
  it('types/ability.ts + effects/refs.ts + parser/holes/cond.ts + render/cond.ts (CR 506.2, 506.3, 122.1f): "one or more players being attacked are poisoned" counts the players a creature in combat attacks (not an attacked planeswalker\'s controller); the ref is advertised', () => {
    const a = face('Whenever a player attacks, if one or more players being attacked are poisoned, the attacking player draws a card.', 'Enchantment');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"of":{"ref":"attacked"}');
    expect(ENGINE_CAPABILITIES.has('ref:attacked')).toBe(true);
    for (const other of ['Whenever a player attacks, if one or more players being attacked are poisoned, you draw a card.', 'Whenever a player attacks, if two or more players being attacked are poisoned, the attacking player draws a card.', 'Whenever a player attacks, if one or more players being attacked are monarch, the attacking player draws a card.']) {
      const f = face(other, 'Enchantment');
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(a.abilities), other).toBe(false);
    }
  });
  it('types/ability.ts + statics/hooks.ts + core/combat.ts + render/steps-lasting.ts + model/cap-walk.ts (CR 509.1b): the per-player block limit is advertised in its one form; a static, a ban or a limit on another action is not understood', () => {
    expect(ENGINE_CAPABILITIES.has('feature:restrict.perPlayer.block')).toBe(true);
    const a = face("Whenever ~ attacks, each opponent can't block with more than one creature this combat.");
    expect(fullyAutomated(a)).toBe(true);
    for (const other of ["Whenever ~ attacks, each opponent can't block with more than one creature this turn and can't attack.", "Whenever ~ attacks, each opponent can't block with more than one creature of each color this combat.", "Whenever ~ attacks, you can't block with more than one creature this combat."]) {
      const f = face(other);
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(a.abilities), other).toBe(false);
    }
  });
  it('types/ability.ts + statics/hooks.ts + render/stat.ts (CR 609.4, 508.1b, 500.1): "attack players who attacked you during their last turn as though it didn\'t have defender" is the permission for the creature itself, advertised in its one form', () => {
    expect(ENGINE_CAPABILITIES.has('feature:permit.attackAsThoughNoDefender.attackedYouLastTurn')).toBe(true);
    const a = face("Defender\n~ can attack players who attacked you during their last turn as though it didn't have defender.");
    expect(fullyAutomated(a)).toBe(true);
    expect(jsonKey(a.abilities)).toBe(jsonKey(face("Defender\n~ can attack opponents who attacked you during their last turn as though it didn't have defender.").abilities));
    for (const other of ["Defender\nCreatures you control can attack players who attacked you during their last turn as though they didn't have defender.", "Defender\n~ can attack players who attacked you this turn as though it didn't have defender."]) {
      const f = face(other);
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(a.abilities), other).toBe(false);
    }
  });
  it('triggers/forms.ts + effects/handlers/lifedamage.ts + parser/holes/event.ts + render/evt.ts (CR 701.14a, 603.2c): "fight" is an event of each creature that fought, with "become blocked" in one batch; a "fights" of one creature is the singular', () => {
    expect(ENGINE_CAPABILITIES.has('feature:ev.action.fight')).toBe(true);
    const a = face('Whenever one or more creatures you control fight or become blocked, you gain 2 life.');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"verb":"fight"');
    const one = face('Whenever a creature you control fights, you gain 2 life.');
    expect(fullyAutomated(one)).toBe(true);
    for (const other of ['Whenever one or more creatures you control fight or deal combat damage, you gain 2 life.', 'Whenever one or more creatures you control fought, you gain 2 life.']) {
      const f = face(other);
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(a.abilities), other).toBe(false);
    }
  });
  it('render/steps-lasting.ts (CR 603.7b, 511.3): a delayed trigger that lasts until end of combat is said "this combat"; the other durations of a delayed trigger are still refused', () => {
    const a = face('Target creature gets +2/+0 until end of turn. Whenever it deals combat damage to a player this combat, you gain 2 life.', 'Sorcery');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"d":"endOfCombat"');
    expect(fullyAutomated(face('Target creature gets +2/+0 until end of turn. Whenever it deals combat damage to a player this game, you gain 2 life.', 'Sorcery'))).toBe(false);
  });
  it('statics/hooks.ts + core/combat.ts + render/stat.ts + model/cap-walk.ts (CR 506.5, 508.1c): "~ can only attack alone" is the restriction on a whole declaration, advertised in its one form; "block", "can\'t" and an attached creature are other things', () => {
    expect(ENGINE_CAPABILITIES.has('feature:restrict.onlyAlone.attack')).toBe(true);
    const a = face('~ can only attack alone.');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"onlyAlone":true');
    for (const other of ['~ can only block alone.', "~ can't attack alone.", 'Enchanted creature can only attack alone.']) {
      const f = face(other);
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(a.abilities), other).toBe(false);
    }
  });
  it('core/combat-damage.ts + statics/hooks.ts + render/stat.ts (CR 510.1): "assigns no combat damage" is a rule modification of the creature, not prevention; advertised as a rule', () => {
    expect(ENGINE_CAPABILITIES.has('rulemod:assignsNoCombatDamage')).toBe(true);
    const a = face('Whenever ~ attacks, it assigns no combat damage this combat.');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"rule":"assignsNoCombatDamage"');
    for (const other of ['Whenever ~ attacks, prevent all combat damage that would be dealt by it this combat.', 'Whenever ~ attacks, it deals no combat damage this combat.']) {
      const f = face(other);
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(a.abilities), other).toBe(false);
    }
  });
  it('parser/holes/event.ts + triggers/normalize.ts + model/lint-roles.ts + render/evt.ts (CR 509.1h, 508.5): "~ attacks a player and isn\'t blocked" names the player attacked as "that player"; of a planeswalker, of other creatures, or with "you" it is another thing', () => {
    const a = face("Whenever ~ attacks a player and isn't blocked, that player loses 2 life.");
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"ref":"event","role":"defender"');
    for (const other of ["Whenever ~ attacks a planeswalker and isn't blocked, that player loses 2 life.", "Whenever a creature you control attacks a player and isn't blocked, that player loses 2 life.", "Whenever ~ attacks you and isn't blocked, that player loses 2 life."]) {
      const f = face(other);
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(a.abilities), other).toBe(false);
    }
  });
});
