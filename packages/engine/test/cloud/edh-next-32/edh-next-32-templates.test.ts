/**
 * Commander lane edh-next, round edh-next-32 (EDHREC ranks 7,501 to 8,750): the template data of parser/templates/zz-cloud/edh-next-32.json ("All creatures have <abilities> and attack each combat if able",
 * "If <a damage event>, prevent that damage", "you may pay one or more {E}", "It enters with N additional counters on it if it's a creature", "Put one of them into your hand and the rest on top of your library in any order")
 * and the round's parser, renderer and engine changes. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON;
 * near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present.
 * The behavior is in edh-next-32-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), fetched and grepped in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhN32 from '../../../src/parser/templates/zz-cloud/edh-next-32.json';
import reviewN32 from '../../m5/golden/cards/edh-next-32-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhN32 as Template[];
/** The round's golden entries. */
const review = reviewN32 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 5;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'sta.edhn32.all.grant.mustAttack': ['Avatar of Slaughter'],
  'rep.edhn32.damage.prevent.all': ['Rem Karolus, Stalwart Slayer'],
  'eff.edhn32.mayPay.oneOrMoreEnergy': ['Rampaging Aetherhood', 'Localized Destruction', 'Territorial Aetherkite', 'Pia Nalaar, Chief Mechanic'],
  'rid.edhn32.entersWith.itsACreature': ['What Must Be Done'],
  'eff.edhn32.dig.putHand.rest.topAny': ['Diabolic Vision'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or replacement on a creature, a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  /^(sta|rep)\./.test(t.id) ? parseCard(card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!
  : parseCard(/^\{/.test(text) ? card('Example Plan', 'Artifact', text) : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-32 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-32.json, path order: after edh-next-3, before edh-next-4) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-32.json');
    expect(files.indexOf('zz-cloud/edh-next-32.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-3.json'));
    expect(files.indexOf('zz-cloud/edh-next-32.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-4.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn32.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhn32\./);
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

describe('edh-next-32 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-next-32 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-32 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-next-32 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-32 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
const dfc = (text: string) => parseCard({ name: 'Example Front // Example Back', layout: 'transform', mana_cost: '{1}', type_line: 'Creature — Angel // Creature — Angel', oracle_text: '', colors: [], card_faces: [
  { name: 'Example Front', mana_cost: '{1}', type_line: 'Creature — Angel', oracle_text: 'Flying', power: '4', toughness: '4', colors: [] },
  { name: 'Example Back', mana_cost: '', type_line: 'Creature — Angel', oracle_text: text, power: '6', toughness: '5', colors: [] },
] } as unknown as OracleCard, OPTS).faces[1]!;

describe('edh-next-32 parser, renderer and engine changes (one test each)', () => {
  it('parser/lower/scope.ts (CR 701.27e, 712.18, 109.2): "it" in a trigger of the object\'s own transformation is the object; a trigger of another object\'s event keeps its pronoun manual', () => {
    expect(fullyAutomated(dfc('When this creature transforms into Example Back, it deals 3 damage to each other creature and each opponent.'))).toBe(true);
    expect(JSON.stringify(dfc('When this creature transforms into Example Back, it deals 3 damage to each other creature and each opponent.').abilities)).toContain('"source":{"ref":"self"}');
    expect(fullyAutomated(creature('Whenever another creature you control dies, it deals 3 damage to each other creature and each opponent.'))).toBe(false);
  });
  it('parser/holes/p2rd2.ts (DamageWould recipient "you or another permanent you control", CR 120.3, 109.2): reads with "prevent that damage"; "or a permanent you control" and "or another permanent an opponent controls" do not', () => {
    const ok = creature('If a spell would deal damage to you or another permanent you control, prevent that damage.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"other":true');
    for (const bad of ['If a spell would deal damage to you or another permanent an opponent controls, prevent that damage.', 'If a spell would deal damage to you or another permanent you control, you may prevent that damage.', 'If a spell would deal damage to another permanent you control, prevent that damage.']) expect(fullyAutomated(creature(bad)), bad).toBe(false);
  });
  it('parser/holes/filter.ts, rules/filter.ts, statics/match.ts, render/np.ts (ObjectFilter.powerEqualsToughness, CR 208.1): "with power equal to its toughness" reads and says itself back; "greater than" and a missing "its" do not', () => {
    const ok = creature('Whenever a creature you control with power equal to its toughness enters, draw a card.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"powerEqualsToughness":true');
    for (const bad of ['Whenever a creature you control with power greater than its toughness enters, draw a card.', 'Whenever a creature you control with power equal to toughness enters, draw a card.', 'Whenever a creature you control with power equal to its power enters, draw a card.']) expect(fullyAutomated(creature(bad)), bad).toBe(false);
  });
  it('parser/holes/filter.ts, rules/filter.ts, render/np.ts (ObjectFilter.nameInGraveyard, CR 201.2, 404.1): "with the same name as a card in their graveyard" reads for a cast event; "your graveyard" keeps its older reading and "their hand" does not read', () => {
    const ok = creature('Whenever an opponent casts a creature spell with the same name as a card in their graveyard, that player loses 10 life.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"nameInGraveyard":{"of":"controller"}');
    expect(JSON.stringify(creature('Whenever an opponent casts a creature spell with the same name as a card in your graveyard, that player loses 10 life.').abilities)).not.toContain('nameInGraveyard');
    expect(fullyAutomated(creature('Whenever an opponent casts a creature spell with the same name as a card in their hand, that player loses 10 life.'))).toBe(false);
  });
  it('parser/lower/quantities.ts, effects/handlers/pay.ts, render/steps-flow.ts, render/steps-life.ts (CR 107.14, 118.12): "that many" after a payment of one or more {E} is the payment, not the energy gained before it', () => {
    const ok = creature('At the beginning of your upkeep, you get an amount of {E} equal to this creature\'s power. Then you may pay one or more {E}. If you do, put that many +1/+1 counters on this creature.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"anyAmount":true');
    expect(JSON.stringify(ok.abilities)).toContain('"q":"resultCount"');
    // the payment of life keeps working beside it, and "that many" with no payment before it stays ambiguous (two earlier amounts)
    expect(fullyAutomated(creature('At the beginning of your upkeep, you get {E}{E}. Then you get {E}. Put that many +1/+1 counters on this creature.'))).toBe(false);
  });
  it('parser/holes/qty.ts, render/qty.ts (CR 107.14, 608.2c): "the amount of {E} paid this way" is the count of the payment of one or more {E}; a payment of life has no such amount', () => {
    const ok = sorcery('You get {E}, then you may pay one or more {E}. If you do, each creature you control with power equal to the amount of {E} paid this way gains indestructible until end of turn.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(fullyAutomated(sorcery('You may pay any amount of life. If you do, each creature you control with power equal to the amount of {E} paid this way gains indestructible until end of turn.'))).toBe(false);
  });
  it('render/edhpm10.ts (CR 614.1c, 608.2c): a creature that enters this way enters with the counters, said three ways; "an artifact" and "if it enters as a creature" with two counters do not read', () => {
    const base = 'Return target permanent card from your graveyard to the battlefield.';
    for (const t of ['If a creature enters this way, it enters with two additional +1/+1 counters on it.', "It enters with two additional +1/+1 counters on it if it's a creature."]) expect(fullyAutomated(sorcery(`${base} ${t}`)), t).toBe(true);
    expect(fullyAutomated(sorcery(`${base} If it enters as a creature, it enters with an additional +1/+1 counter on it.`))).toBe(true);
    for (const bad of ["It enters with two additional +1/+1 counters on it if it's an artifact.", 'If it enters as a creature, it enters with two additional +1/+1 counters on it.']) expect(fullyAutomated(sorcery(`${base} ${bad}`)), bad).toBe(false);
  });
  it('parser/holes/filter.ts, render/np.ts (CR 208.1, 109.1): "power less than ~\'s" and "equal or lesser power" read as comparisons with the object\'s own power; "greater" and "toughness" do not', () => {
    const ok = creature('When this creature enters, return target creature card with power less than ~\'s from your graveyard to the battlefield.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"op":"<"');
    const eq = creature('When this creature dies, return another target creature card with equal or lesser power from your graveyard to the battlefield.');
    expect(fullyAutomated(eq)).toBe(true);
    expect(JSON.stringify(eq.abilities)).toContain('"op":"<="');
    // review: in a trigger of ANOTHER object's event "equal or lesser power" compares with that object, so it stays manual
    expect(fullyAutomated(creature("Whenever a creature you control attacks, target creature defending player controls with equal or lesser power can't block this turn."))).toBe(false);
    for (const bad of ['When this creature enters, return target creature card with power greater than ~\'s from your graveyard to the battlefield.', 'When this creature dies, return another target creature card with equal or greater power from your graveyard to the battlefield.', 'When this creature enters, return target creature card with toughness less than ~\'s from your graveyard to the battlefield.']) expect(fullyAutomated(creature(bad)), bad).toBe(false);
  });
  it('parser/templates edh-next-32 (CR 701.20e, 401.4): "the rest on top of your library in any order" reads after "put one of them into your hand"; "on the bottom" keeps its older reading with another JSON', () => {
    const top = sorcery('Look at the top five cards of your library. Put one of them into your hand and the rest on top of your library in any order.');
    const bottom = sorcery('Look at the top five cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.');
    expect(fullyAutomated(top)).toBe(true);
    expect(jsonKey(top.abilities)).not.toBe(jsonKey(bottom.abilities));
    expect(JSON.stringify(top.abilities)).not.toContain('"position":"bottom"');
  });
  it('the enchantment helper: "All creatures have ..." without "attack each combat if able" keeps its older reading', () => {
    expect(JSON.stringify(enchantment('All creatures have double strike.').abilities)).not.toContain('mustIfAble');
    expect(JSON.stringify(enchantment('All creatures have double strike and attack each combat if able.').abilities)).toContain('mustIfAble');
  });
});
