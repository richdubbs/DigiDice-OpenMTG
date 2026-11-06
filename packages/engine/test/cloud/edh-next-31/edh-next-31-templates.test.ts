/**
 * Commander EDHREC ranks 6,251-7,500, round edh-next-31: the template data of parser/templates/zz-cloud/edh-next-31.json. Guard G9 (design 6.8): every example lowers with its template,
 * is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word
 * of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10). The behavior is in edh-next-31-scenarios.test.ts. CR cites are from the Comprehensive
 * Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext31 from '../../../src/parser/templates/zz-cloud/edh-next-31.json';
import reviewNext31 from '../../m5/golden/cards/edh-next-31-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext31 as Template[];
/** The round's golden entries. */
const review = reviewNext31 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 5;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'rst.edhn31.cantWinGame.oppsCantLose': ['Abyssal Persecutor'],
  'rst.edhn31.self.cantAttack.duringExtraTurns': ['Medomai the Ageless'],
  'eff.edhn31.gainlife.foreach.imp': ['Skyfisher Spider'],
  'eff.edhn31.player.incubates': ['Excise the Imperfect'],
  'rep.edhn31.enter.additionalCounter.forEachDiedUnderYourControl': ['Gorma, the Gullet'],
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

describe('edh-next-31 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-31.json, path order: after edh-next-3, before edh-next-4) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-31.json');
    expect(files.indexOf('zz-cloud/edh-next-31.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-4.json'));
    expect(files.indexOf('zz-cloud/edh-next-3.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-31.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn31.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|rst|trg|rid|cm)\.edhn31\./);
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

describe('edh-next-31 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-next-31 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-31 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-next-31 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-31 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // design 6.10 deviation (recorded): the two templates whose whole wording is one printed line (Abyssal Persecutor's, and the mirror of Platinum Angel's it must not take) cannot have an
    // invented example; the line is the card's own text. Every other line of an example is synthetic.
    const FIXED = new Set(["You can't win the game and your opponents can't lose the game.", "You can't lose the game and your opponents can't win the game."]);
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !FIXED.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Drake', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
const enchant = (text: string) => parseCard(card('Example Plan', 'Enchantment', text), OPTS).faces[0]!;
const sorcery = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
const instant = (text: string) => parseCard(card('Example Plan', 'Instant', text), OPTS).faces[0]!;

describe('edh-next-31 parser, engine and renderer changes (one test each)', () => {
  it('parser/holes/edhn31.ts (CR 105.1, 105.2; Breathe Your Last): "for each of its colors" counts the colors of the one object "its" names; a plural or other possessive is not this reading', () => {
    const ok = instant('Destroy target creature. You gain 1 life for each of its colors.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"q":"distinct","what":"colors","among":{"ref":"target","id":"t0"}');
    for (const bad of ['Destroy target creature. You gain 1 life for each of their colors.', 'You gain 1 life for each of its colors.']) expect(fullyAutomated(instant(bad)), bad).toBe(false);
  });
  it('types/ability.ts turnOf.extra, statics/match.ts, triggers/cond.ts, effects/eval.ts, actions/announce-cond.ts and render/cond.ts, render/stat.ts (CR 500.7; Medomai the Ageless): "can\'t attack during extra turns" is the restriction while the turn is an extra turn', () => {
    const ok = creature('Example Plan can\'t attack during extra turns.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"when":{"cond":"turnOf","whose":"any","extra":true}');
    for (const bad of ['Example Plan can\'t block during extra turns.', 'Example Plan can\'t attack during your turn.', 'Example Plan can\'t attack during an extra turn.']) expect(fullyAutomated(creature(bad)), bad).toBe(false);
  });
  it('lower/ability.ts#exertWhenYouDo (CR 701.43a, 603.12; Glorybringer): the plain "it" of "When you do, it deals ..." is the creature exerted; a second candidate keeps the sentence manual', () => {
    const ok = creature('You may exert this creature as it attacks. When you do, it deals 4 damage to target non-Dragon creature an opponent controls.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"source":{"ref":"self"}');
    for (const bad of ['You may exert this creature as it attacks. When you do, it deals 4 damage to target creature and it gets +1/+1 until end of turn.', 'When this creature attacks, it deals 4 damage to target creature an opponent controls and then it gets +1/+1 until end of turn.']) {
      expect(fullyAutomated(creature(bad)) && JSON.stringify(creature(bad).abilities).includes('"source":{"ref":"self"}') && !JSON.stringify(creature(bad).abilities).includes('manual'), bad).toBe(false);
    }
  });
  it('lower/anaphora.ts#happenedOtherIsTarget, parser/holes/cond.ts and render/cond.ts (CR 700.4, 109.2; Chain Assassination): "another creature died this turn" in a spell with one object target is other than that target; a spell with two targets or a permanent ability keeps its reading', () => {
    const ok = instant('Destroy target creature. If another creature died this turn, draw a card.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"not":{"is":{"ref":"target","id":"t0"}}');
    expect(fullyAutomated(instant('Destroy target creature and target artifact. If another creature died this turn, draw a card.')), 'two targets: which one is "another" than').toBe(false);
    expect(fullyAutomated(creature('At the beginning of your end step, if another creature died this turn, draw a card.')), 'a permanent: other than the source').toBe(true);
    expect(JSON.stringify(creature('At the beginning of your end step, if another creature died this turn, draw a card.').abilities)).toContain('"other":true');
  });
  it('lower/anaphora.ts#anaphoricOther (CR 109.2, 608.2c; Tori D\'Avenant, Aragorn and Arwen): a later "other" after an earlier sentence that names only "other" groups is other than ~; an earlier target keeps the refusal', () => {
    expect(fullyAutomated(creature('Whenever this creature attacks, all other attacking creatures you control get +1/+1 until end of turn. Other red attacking creatures you control gain trample until end of turn.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever this creature enters, put a +1/+1 counter on each other creature you control. You gain 1 life for each other creature you control.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever this creature attacks, destroy target creature. Other creatures you control get +1/+1 until end of turn.')), 'an earlier target is a second candidate').toBe(false);
    // combined copy: edh-d-98 (Fall of the First Civilization) reads "all other" after a choice as other than the chosen objects (CR 109.2, 608.2c), never other than ~
    expect(fullyAutomated(creature('Whenever this creature attacks, each player chooses three nonland permanents they control. Destroy all other nonland permanents.')), 'other than the chosen').toBe(true);
    expect(JSON.stringify(creature('Whenever this creature attacks, each player chooses three nonland permanents they control. Destroy all other nonland permanents.').abilities)).toContain('"not":{"is":{"ref":"bound","name":"chosen"}}');
  });
  it('render/np.ts (CR 205.2a, 506.4; family attacking-color-order): "other red attacking creatures" and "other attacking red creatures" are one filter', () => {
    const a = creature('Whenever this creature attacks, other red attacking creatures you control gain trample until end of turn.');
    const b = creature('Whenever this creature attacks, other attacking red creatures you control gain trample until end of turn.');
    expect(fullyAutomated(a)).toBe(true);
    expect(fullyAutomated(b)).toBe(true);
    expect(jsonKey(a.abilities)).toBe(jsonKey(b.abilities));
  });
  it('model/focus.ts#damagedGroup, lower/mentions.ts and render/steps.ts (CR 608.2c, 120.3; Thundermaw Hellkite): "those creatures" after damage to a described group is that group again; a power test or a target is not', () => {
    const ok = creature('When this creature enters, it deals 1 damage to each creature with flying your opponents control. Tap those creatures.');
    expect(fullyAutomated(ok)).toBe(true);
    const steps = (ok.abilities[ok.abilities.length - 1] as unknown as { effect: { steps: { op: string; to?: unknown; what?: unknown }[] } }).effect.steps;
    expect(steps.map((x) => x.op)).toEqual(['damage', 'tap']);
    expect(steps[1]!.what, 'the same group again').toEqual(steps[0]!.to);
    expect(fullyAutomated(creature('When this creature enters, it deals 1 damage to each creature with power 2 or less. Tap those creatures.')), 'a power can change by the damage').toBe(false);
    expect(fullyAutomated(creature('When this creature enters, it deals 1 damage to target creature. Tap those creatures.'))).toBe(false);
  });
  it('lower/moved-self.ts, render/steps-zones.ts (CR 400.7e, 404.1; Skyfisher Spider): after the source died, "exile ~ from your graveyard" moves the dead card (the event\'s subject); an Aura\'s host dying is not this reading', () => {
    const ok = creature('When this creature dies, you may gain 1 life for each creature card in your graveyard. If you do, exile this card from your graveyard.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"is":{"ref":"event","role":"subject"}');
    expect(JSON.stringify(ok.abilities)).toContain('"zone":"graveyard"');
    expect(fullyAutomated(creature('When this creature dies, you may gain 1 life for each creature card in your graveyard. If you do, exile this card from their graveyard.'))).toBe(false);
  });
  it('render/cond.ts#zoneHistoryPhrase (CR 700.4, 603.4): "one or more creatures died this turn" is the count one or more', () => {
    expect(fullyAutomated(creature('At the beginning of your end step, if one or more creatures died this turn, you gain 2 life.'))).toBe(true);
    expect(fullyAutomated(creature('At the beginning of your end step, if two or more creatures died this turn, you gain 2 life.'))).toBe(true);
  });
  it('template parse (CR 701.53a, 109.5; Excise the Imperfect): "Its controller incubates X, where X is its mana value" is the controller of the exiled permanent', () => {
    const ok = instant('Exile target nonland permanent. Its controller incubates X, where X is its mana value.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"action":"incubate","who":{"ref":"controllerOf","object":{"ref":"target","id":"t0"}}');
    expect(fullyAutomated(instant('Exile target nonland permanent. Its controller incubates.'))).toBe(false);
  });
  it('template parse (CR 614.1c, 700.4; Gorma, the Gullet): the count is the creatures that died under your control this turn, read when the creature enters; "died this turn" for any controller is another reading', () => {
    const ok = creature('Nontoken creatures you control enter with an additional +1/+1 counter on them for each creature that died under your control this turn.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"q":"happenedCount"');
    expect(fullyAutomated(creature('Nontoken creatures you control enter with an additional +1/+1 counter on them for each creature that died this turn.'))).toBe(false);
  });
});
