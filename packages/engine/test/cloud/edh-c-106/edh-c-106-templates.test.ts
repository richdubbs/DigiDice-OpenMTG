/**
 * Commander EDHREC ranks 25,001-25,500, round edh-c-106 (third pass): the template data of parser/templates/zz-cloud/edh-c-106.json. Guard G9 (design 6.8): every example lowers with its template,
 * is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word
 * of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10). The behavior is in edh-c-106-scenarios.test.ts. CR cites are from the Comprehensive
 * Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC106 from '../../../src/parser/templates/zz-cloud/edh-c-106.json';
import review106 from '../../m5/golden/cards/edh-c-106-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC106 as Template[];
/** The round's golden entries. */
const review = review106 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 5;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'rep.edhv106.enters.counter.forEachOtherSpell': ['Storm Entity'],
  'sta.edhv106.self.blockAsThough.reach': ['Dragon Hunter'],
  'eff.edhv106.unlessPay.prefix': ['Demonic Hordes'],
  'eff.edhv106.loseLife.unlessThatPlayerSacrificeOrDiscard': ['Forbidden Ritual'],
  'eff.edhv106.sacrifice.ofOpponentsChoice': ['Demonic Hordes'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static line on an Aura, an Equipment or a creature, a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(
    t.kind === 'static' ? card('Example Plan', 'World Enchantment', text)
    : /^\{/.test(text) ? card('Example Plan', 'Artifact', text)
    : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : card('Example Plan', 'Sorcery', text),
    OPTS,
  ).faces[0]!;

describe('edh-c-106 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-106.json, path order: after edh-c-10, before edh-c-11) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-106.json');
    expect(files.indexOf('zz-cloud/edh-c-106.json')).toBeLessThan(files.indexOf('zz-cloud/edh-c-11.json'));
    expect(files.indexOf('zz-cloud/edh-c-10.json')).toBeLessThan(files.indexOf('zz-cloud/edh-c-106.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhv106.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhv106\./);
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

describe('edh-c-106 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-c-106 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-106 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^[+-]?\d+\/[+-]?\d+$/.test(w) || w === 'charge') return; // the counter kind is a hole that takes any name (CounterKind), as in the older "enters with a counter" templates
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

describe.skipIf(index === null)('edh-c-106 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-106 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Drake', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
const aura = (text: string) => parseCard(card('Example Plan', 'Enchantment — Aura', `Enchant creature\n${text}`), OPTS).faces[0]!;
const sorcery = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-c-106 parser, engine and renderer changes (one test each)', () => {
  it('parser/holes/object.ts, lower/scope.ts, lower/anaphora.ts and render/refs.ts (CR 608.2c, 120.3, 509.1; Venomous Fangs, Venom): "the other creature" is the other party of a damage or block trigger; with no such event, or a self trigger, it is not read', () => {
    const fangs = aura('Whenever enchanted creature deals damage to a creature, destroy the other creature.');
    expect(fullyAutomated(fangs)).toBe(true);
    expect(JSON.stringify(fangs.abilities)).toContain('"what":{"ref":"event","role":"object"}');
    expect(fullyAutomated(aura('Whenever enchanted creature blocks or becomes blocked by a non-Wall creature, destroy the other creature at end of combat.'))).toBe(true);
    for (const bad of ['Whenever enchanted creature attacks, destroy the other creature.', 'Whenever enchanted creature deals damage to a player, destroy the other creature.', 'Whenever enchanted creature dies, destroy the other creature.']) {
      expect(fullyAutomated(aura(bad)), bad).toBe(false);
    }
    expect(fullyAutomated(creature('Whenever this creature deals damage to a creature, destroy the other creature.')), 'a creature that is the object itself keeps the older reading').toBe(true);
  });
  it('statics/hooks.ts and render/stat.ts (CR 609.4, 702.17b, 702.9b; Dragon Hunter): the blocker filter `of` narrows who may block; another keyword, "can\'t block" and a group subject are not this reading', () => {
    const ok = creature('This creature can block Dragons as though it had reach.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"of":{"self":true}');
    for (const bad of ['This creature can block Dragons as though it had shadow.', 'Creatures you control can block Dragons as though they had reach.', 'This creature can block Dragons as though it had flying.']) {
      expect(fullyAutomated(creature(bad)), bad).toBe(false);
    }
  });
  it('render/steps-flow.ts (CR 118.12a, 603.1; Demonic Hordes): "unless you pay {mana}, <instructions>" is the payment first; a non-mana cost, "if you pay" and a counter are not this wording', () => {
    expect(fullyAutomated(creature('At the beginning of your upkeep, unless you pay {B}{B}{B}, tap this creature and sacrifice a land.'))).toBe(true);
    expect(fullyAutomated(creature('At the beginning of your upkeep, unless you pay {B}{B}{B}, sacrifice this creature.'))).toBe(true);
    expect(fullyAutomated(creature('At the beginning of your upkeep, unless you pay 3 life, sacrifice this creature.'))).toBe(false);
    expect(fullyAutomated(creature('At the beginning of your upkeep, if you pay {B}{B}{B}, sacrifice this creature.'))).toBe(false);
  });
  it('effects/handlers/zones-remove.ts and render/steps-zones.ts (CR 701.21a, 608.2d; Demonic Hordes): `chooser` makes an opponent choose the permanent you sacrifice; "of their choice" for you and other choosers are other readings', () => {
    const ok = creature('At the beginning of your upkeep, sacrifice a land of an opponent\'s choice.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"chooser":{"ref":"anOpponent"}');
    expect(fullyAutomated(creature('At the beginning of your upkeep, sacrifice a land of your opponent\'s choice.'))).toBe(false);
  });
  it('lower/mentions.ts and render/steps-cards.ts (CR 701.9b, 608.2c; Kindle the Carnage): "that card" is the one card you discarded at random; a discard of several cards or by another player is not "that card"', () => {
    const ok = sorcery("Discard a card at random. If you do, this spell deals damage equal to that card's mana value to each creature.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"mode":"random"');
    expect(fullyAutomated(sorcery("Discard two cards at random. If you do, this spell deals damage equal to that card's mana value to each creature."))).toBe(false);
    expect(fullyAutomated(sorcery("Target opponent discards a card at random. If they do, this spell deals damage equal to that card's mana value to each creature."))).toBe(false);
  });
  it('lower/ability.ts and render/steps-flow.ts (CR 118.12a, 608.2c; Forbidden Ritual): "target opponent ... unless that player sacrifices a permanent of their choice or discards a card"; "each opponent" keeps the older template (one reading)', () => {
    expect(fullyAutomated(sorcery('Target opponent loses 2 life unless that player sacrifices a permanent of their choice or discards a card.'))).toBe(true);
    expect(fullyAutomated(sorcery('Each opponent loses 2 life unless that player sacrifices a permanent of their choice or discards a card.'))).toBe(true);
    expect(fullyAutomated(sorcery('Target opponent loses 2 life unless that player sacrifices a permanent of their choice and discards a card.'))).toBe(false);
  });
});
