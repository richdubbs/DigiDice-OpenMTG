/**
 * Cloud batch 2, slice std-tmt (the Standard backlog of the Teenage Mutant Ninja Turtles set, tuning half): the template data of
 * parser/templates/zz-cloud/std-tmt.json and the parser, lowering and renderer support they needed. Guard G9 (design 6.8): every example lowers with its template,
 * is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a
 * nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in std-tmt-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdTmt from '../../../src/parser/templates/zz-cloud/std-tmt.json';
import review from '../../m5/golden/cards/cloud-std-tmt-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const TMT = stdTmt as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered, activated or static ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Turtle Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const face = (type: string, text: string) => parseCard(card('Example Brute', type, text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
const spellFace = (text: string) => parseCard(card('Example Volley', 'Sorcery', text), OPTS).faces[0]!;

describe('std-tmt template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-tmt.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-tmt.json');
    expect(files.indexOf('zz-cloud/std-tmt.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-tmt.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdtmt.* or rid.stdtmt.*', () => {
    expect(TMT.length).toBe(7);
    for (const t of TMT) {
      expect(t.id, t.id).toMatch(/^(eff|rid)\.stdtmt\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: at least one hand-verified golden card that uses it', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of TMT.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of TMT) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'tapped', 'attacking']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-tmt guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of TMT) {
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

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\bfor each\b/, 'for any'], [/\btapped\b/, 'untapped'], [/\buntil end of turn\b/, 'until your next turn'], [/\bthis turn\b/, 'this game'], [/\bthat much\b/, 'twice that much'],
    [/\bwhenever you\b/, 'whenever an opponent'], [/\bYou\b/, 'Target opponent'], [/\ball\b/, 'each'], [/\bbottom\b/, 'top'], [/\bthat player\b/, 'you'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-tmt guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of TMT) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
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

describe('std-tmt guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of TMT) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^"?\{/.test(w) || w.includes('\n')) return;
          const end = w.match(/[.,:"]+$/)?.[0] ?? '';
          const start = w.startsWith('"') ? '"' : '';
          const mutated = [...words.slice(0, i), `${start}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-tmt parser, lowering and renderer support', () => {
  const abilityJson = (f: ReturnType<typeof face>): string => JSON.stringify(f.abilities);
  it('CR 120.3, 201.5: a plural name deals combat damage ("Whenever ~ deal combat damage to a player"), the same trigger as "deals"', () => {
    const plural = face('Legendary Creature — Turtle', 'Whenever ~ deal combat damage to a player, draw a card.');
    const single = face('Legendary Creature — Turtle', 'Whenever ~ deals combat damage to a player, draw a card.');
    expect(fullyAutomated(plural)).toBe(true);
    expect(jsonKey(plural.abilities)).toBe(jsonKey(single.abilities));
  });
  it('CR 506.2, 508.1b, 603.2c: "Whenever one or more of your opponents are attacked" is the batched trigger of attackers attacking an opponent, one for the declaration', () => {
    const f = face('Enchantment', 'Whenever one or more of your opponents are attacked, draw a card.');
    expect(fullyAutomated(f)).toBe(true);
    expect(abilityJson(f)).toContain('"trigger":{"on":[{"ev":"attacks","attacker":{"types":["Creature"]},"defender":"opponent"}],"batch":true,"wholeBatch":true}');
    // Standard merge wave 3 (CR 603.2c): not the trigger of "one or more creatures attack an opponent", which is one for each opponent attacked (std-tla)
    expect(jsonKey(f.abilities)).not.toBe(jsonKey(face('Enchantment', 'Whenever one or more creatures attack an opponent, draw a card.').abilities));
    expect(fullyAutomated(face('Enchantment', 'Whenever one or more of your opponents are attacked by a Ninja, draw a card.'))).toBe(false);
  });
  it('CR 111.1, 205.2a: "another creature or token" is a creature, or a token of any type (a bare "token" shares no head noun)', () => {
    const f = face('Artifact Creature — Food Cat', '{2}, Sacrifice another creature or token: Draw a card.');
    expect(fullyAutomated(f)).toBe(true);
    expect(abilityJson(f)).toContain('"filter":{"anyOf":[{"types":["Creature"]},{"token":true}],"other":true}');
    // a token of a type keeps the shared head noun: "creature or Treasure token" is a creature token or a Treasure token (unchanged)
    expect(abilityJson(face('Creature — Cat', '{2}, Sacrifice another artifact or creature token: Draw a card.'))).not.toContain('{"token":true}]');
  });
  it('CR 115.1, 601.2c: "two target creatures controlled by different players" is one target spec with `differentControllers`; a single target never has it', () => {
    const f = spellFace('Exchange control of two target creatures controlled by different players.');
    expect(fullyAutomated(f)).toBe(true);
    expect(abilityJson(f)).toContain('"differentControllers":true');
    expect(fullyAutomated(spellFace('Exile target creature controlled by different players.'))).toBe(false);
    expect(fullyAutomated(spellFace('Exchange control of two target creatures you control controlled by different players.'))).toBe(false);
  });
  it('CR 611.2c, 608.2c: after "Gain control of all <group> until end of turn", "them" / "they" name the objects the effect locked (`as`), not the description again', () => {
    const f = spellFace('Gain control of all creatures your opponents control until end of turn. Untap them. They gain haste until end of turn.');
    expect(fullyAutomated(f)).toBe(true);
    const steps = (f.abilities[0] as unknown as { effect: { steps: Record<string, unknown>[] } }).effect.steps;
    expect(typeof steps[0]!['as']).toBe('string');
    expect(steps[1]).toMatchObject({ op: 'untap', what: { ref: 'bound', name: steps[0]!['as'] } });
    // a pump of a group keeps its description reading (FAST5 T76): no name on the step
    const pump = spellFace('Creatures you control get +1/+1 until end of turn. Untap them.');
    expect(fullyAutomated(pump)).toBe(true);
    expect(JSON.stringify(pump.abilities)).not.toContain('"as":');
  });
  it('CR 406.1, 400.7: after a move of several targets into exile, "them" is what the move exiled', () => {
    const f = face('Creature — Turtle', "When ~ enters, exile up to one target artifact you control and up to one target creature you control. Return them to the battlefield under their owners' control.");
    expect(fullyAutomated(f)).toBe(true);
    const steps = (f.abilities[0] as unknown as { effect: { steps: Record<string, unknown>[] } }).effect.steps;
    expect(steps[0]).toMatchObject({ op: 'move', what: { ref: 'union' }, to: { zone: 'exile' } });
    expect(steps[1]).toMatchObject({ op: 'move', what: { ref: 'bound', name: steps[0]!['as'] }, to: { zone: 'battlefield', controller: 'owner' } });
  });
  it('CR 607.2a, 608.2d: "Return a creature card exiled with ~ ... Return each other card exiled with ~ ...": the second sentence reads the choice of the first, and alone it is never automated', () => {
    const both = face('Land', "{1}, {T}: Exile target creature you own.\n{2}, {T}, Sacrifice ~: Return a creature card exiled with ~ to the battlefield under your control. Return each other card exiled with ~ to its owner's hand.");
    expect(fullyAutomated(both)).toBe(true);
    expect(JSON.stringify(both.abilities[1])).toContain('"not":{"is":{"ref":"bound","name":"returned"}}');
    expect(JSON.stringify(both.abilities[0])).toContain('"link":"exiled"');
    const alone = face('Land', "{1}, {T}: Exile target creature you own.\n{2}, {T}, Sacrifice ~: Return each other card exiled with ~ to its owner's hand.");
    expect(fullyAutomated(alone)).toBe(false);
  });
  it('CR 205.2a: "the number of card types among spells you\'ve cast this turn" counts the history (`happenedDistinct`); a count by colors has no reading', () => {
    const f = face('Creature — Human', "At the beginning of your end step, draw a card for each card type among spells you've cast this turn.");
    expect(fullyAutomated(f)).toBe(true);
    expect(abilityJson(f)).toContain('"q":"happenedDistinct"');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-tmt design 6.10 (local index): synthetic examples', () => {
  it('no std-tmt line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Vehicle)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = TMT.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
