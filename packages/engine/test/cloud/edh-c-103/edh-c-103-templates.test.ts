/**
 * Commander EDHREC ranks 21,501-22,000, round edh-c-103 (third pass): the template data of parser/templates/zz-cloud/edh-c-103.json ("counter ... unless its controller pays {B} or {3}", "exile all creatures
 * and graveyards") and the round's parser, engine and renderer changes, tested at the end of this file and in edh-c-103-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-c-103-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), fetched in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC103 from '../../../src/parser/templates/zz-cloud/edh-c-103.json';
import review103 from '../../m5/golden/cards/edh-c-103-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC103 as Template[];
/** The round's golden entries. */
const review = review103 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 2;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhv103.payelse.mana.orMana': ['Thrull Wizard'],
  'eff.edhv103.exile.allAndGraveyards': ['Ultimate Nullification'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static line on an Aura, an Equipment or a creature, a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(
    /^\{/.test(text) ? card('Example Plan', 'Artifact', text)
    : /^(When|At the|Whenever)/.test(text) && /enchanted creature/.test(text) ? card('Example Plan', 'Enchantment — Aura', `Enchant creature\n${text}`)
    : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : t.id.startsWith('sta.') && /enchanted creature/.test(text) ? card('Example Plan', 'Enchantment — Aura', `Enchant creature\n${text}`)
    : t.id.startsWith('sta.') ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : card('Example Plan', 'Sorcery', text),
    OPTS,
  ).faces[0]!;

describe('edh-c-103 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-103.json, path order: before edh-cast-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-103.json');
    expect(files.indexOf('zz-cloud/edh-c-103.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhv103.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhv103\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
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

describe('edh-c-103 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/half/, 'a third of'], [/rounded up/, 'rounded down'], [/round up/, 'round down'], [/your/, 'their'], [/first/, 'second'], [/an opponent/, 'you'], [/less/, 'more'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-c-103 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-103 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-103 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-103 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Drake', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
const enchantment = (text: string) => parseCard(card('Example Plan', 'Enchantment', text), OPTS).faces[0]!;
const aura = (text: string) => parseCard(card('Example Plan', 'Enchantment — Aura', `Enchant nonland permanent\n${text}`), OPTS).faces[0]!;

describe('edh-c-103 parser, engine and renderer changes (one test each)', () => {
  it('parser/holes/object.ts and render/refs.ts (CR 601.2c, 603.3d): "target <description> that player controls of their choice" is a target chosen by that player; in a step trigger the player is the active player; any other player, another trigger or a description of more than one target stays manual', () => {
    const ok = enchantment("At the beginning of each player's upkeep, destroy target nonartifact creature that player controls of their choice.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"chooser":{"ref":"active"}');
    expect(fullyAutomated(enchantment("At the beginning of each player's upkeep, destroy target creature that player controls of your choice."))).toBe(false);
    expect(fullyAutomated(enchantment("At the beginning of each player's upkeep, destroy up to two target creatures that player controls of their choice."))).toBe(false);
    const other = enchantment('Whenever a player casts a spell, destroy target creature that player controls of their choice.');
    expect(JSON.stringify(other.abilities)).not.toContain('"chooser":{"ref":"active"}'); // the caster is not the active player: never read as the active player
  });
  it('parser/holes/cond.ts and render/p2iv2.ts (CR 303.4, 603.4): "if it\'s enchanted" after an attack trigger is an Aura attached to the attacker; "is not enchanted" and an unrelated adjective are other readings', () => {
    const ok = creature("Whenever this creature attacks, if it's enchanted, exile target permanent.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"filter":{"enchanted":true}');
    expect(fullyAutomated(creature("Whenever this creature attacks, if it's tapped, exile target permanent."))).toBe(true); // an older reading, unchanged
    expect(JSON.stringify(creature("Whenever this creature attacks, if it's tapped, exile target permanent.").abilities)).not.toContain('"enchanted":true');
    expect(fullyAutomated(creature("Whenever this creature attacks, if it's enchanted by two Auras, exile target permanent."))).toBe(false);
  });
  it('parser/holes/qty.ts and parser/lower/quantities.ts (CR 701.20a, 608.2c): "the number of cards revealed this way" counts every card a reveal-until revealed; with no reveal before it, or a plain reveal step of a hand, it is not this reading', () => {
    const text = 'Reveal cards from the top of your library until you reveal an artifact card. Put that card onto the battlefield and the rest on the bottom of your library in a random order.';
    const ok = parseCard(card('Example Plan', 'Sorcery', `${text} Example Plan deals damage to you equal to the number of cards revealed this way.`), OPTS).faces[0]!;
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"q":"resultCount"');
    expect(fullyAutomated(sorcery('Example Plan deals damage to you equal to the number of cards revealed this way.'))).toBe(false);
  });
  it('parser/holes/cond.ts and render/cond.ts (CR 608.2c): "If you return a nonland card to your hand this way" reads the move right before it; a land, a different zone or no move before it is not this reading', () => {
    const base = 'Return target card from your graveyard to your hand.';
    const ok = sorcery(`${base} If you return a nonland card to your hand this way, you gain 2 life.`);
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"notTypes":["Land"]');
    expect(fullyAutomated(sorcery(`${base} If you return a nonland card to the battlefield this way, you gain 2 life.`))).toBe(false);
    expect(fullyAutomated(sorcery('If you return a nonland card to your hand this way, you gain 2 life.'))).toBe(false);
  });
  it('parser/holes/cond.ts and render/steps-zones.ts (CR 701.21a, 608.2c): "If the player can\'t, sacrifice ~" after that player\'s sacrifice is "if they did not"; after an instruction that is not a sacrifice it stays manual', () => {
    const ok = creature("At the beginning of each player's upkeep, that player sacrifices a creature of their choice. If the player can't, sacrifice this creature.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"cond":"did"');
    expect(fullyAutomated(creature("At the beginning of each player's upkeep, that player gains 2 life. If the player can't, sacrifice this creature."))).toBe(false);
  });
  it('model/lint-nodes.ts (CR 107.3a, 602.2b): an {X} paid on resolution is announced by an activated ability whose cost counts X cards; with no X in its cost the payment still stays manual', () => {
    const ok = creature('{2}, Reveal X blue cards from your hand, Sacrifice this creature: Counter target spell unless its controller pays {X}.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(fullyAutomated(creature('{2}, Sacrifice this creature: Counter target spell unless its controller pays {X}.'))).toBe(false);
  });
  it('parser/lower/activation.ts, actions/activate.ts and render/abil.ts (CR 602.2): "Only your opponents may activate this ability" (alone or with "and only as a sorcery") is read; another restriction after it stays manual', () => {
    const ok = aura('{3}: Destroy this Aura. Only your opponents may activate this ability and only as a sorcery.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"opponentsOnly":true');
    expect(fullyAutomated(aura('{3}: Destroy this Aura. Only your opponents may activate this ability.'))).toBe(true);
    expect(fullyAutomated(aura('{3}: Destroy this Aura. Only your opponents may activate this ability and only during your turn.'))).toBe(false);
    expect(fullyAutomated(aura('{3}: Destroy this Aura. Only your opponents may activate this ability and only once each turn.'))).toBe(false);
  });
  it('render/steps-flow.ts and render/steps-zones.ts: "pays {B} or {3}" is one choice between two payments; "exile all creatures and graveyards" is one group; a payment of a cost that is not mana, or a group of another zone, stays manual', () => {
    expect(fullyAutomated(sorcery('Counter target spell unless its controller pays {B} or {3}.'))).toBe(true);
    expect(fullyAutomated(sorcery('Counter target spell unless its controller pays {B} or discards a card.'))).toBe(false);
    expect(fullyAutomated(sorcery('Exile all creatures and graveyards.'))).toBe(true);
    expect(fullyAutomated(sorcery('Exile all creatures and libraries.'))).toBe(false);
  });
});
