/**
 * Standard round D (std-rD, slot D of five parallel rounds): the template data of parser/templates/zz-cloud/std-rD.json (a choice among listed card types,
 * "players can't cast spells of the chosen type", "exile that card from your graveyard") and the hole, face-choice, renderer and reference support they needed.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2).
 * Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-rD-scenarios.test.ts. CR cites
 * from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRD from '../../../src/parser/templates/zz-cloud/std-rD.json';
import review from '../../m5/golden/cards/cloud-std-rD-review.json';
import { renderAbility, renderGate } from '../../../src/index';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdRD as Template[];
const MECH_COUNT = 4;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered or static ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('std-rD template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rD.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rD.json');
    expect(files.indexOf('zz-cloud/std-rD.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-rD.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdrd.*, rep.stdrd.* or sta.stdrd.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|rep|sta)\.stdrd\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence, hand-verified golden cards of the tuning half that use it (the review file pins each card as full)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
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

/** std-rx21: experimental templates whose examples a stable later template now reads to the same JSON (the stable derivation is kept). */
const SAME_JSON_VIA: Readonly<Record<string, string>> = { 'sta.stdrd.players.cantCast.chosen': 'sta.stdrx21.player.cantCast.filter' };

describe('std-rD guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        // std-rx21 (changed on purpose): the stable generic "<player> can't cast <spells>" reads "spells of the chosen type" to the same JSON, and the parser
        // keeps the stable derivation when an experimental one gives the same result (design 6.9, G10)
        const via = SAME_JSON_VIA[t.id];
        expect(f.templatesUsed.includes(t.id) || (via !== undefined && f.templatesUsed.includes(via)), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
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
    [/\buntil end of turn\b/, 'until your next turn'], [/\bor more\b/, 'or fewer'], [/\beach\b/, 'all'], [/\bget\b/, 'gain'], [/\bgain\b/, 'lose'], [/\bhas\b/, 'loses'],
    [/\bDuring your turn\b/, 'During your end step'], [/\bflash\b/, 'haste'], [/\bits owner's control\b/, 'your control'], [/\binto your hand\b/, 'onto the battlefield'],
    [/\bmilled this way\b/, 'discarded this way'], [/\bloses all abilities\b/, 'loses flying'], [/\bmana cost\b/, 'power'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rD guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
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

describe('std-rD guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        const labelEnd = words.indexOf('--'); // a flavor word before "--" has no rules meaning (CR 207.2d): any words may stand there
        words.forEach((w, i) => {
          if (i <= labelEnd) return;
          if (w === '~' || w === '~,' || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // the word in front of "counter(s)" is an open class by design (6.11, the CounterKind hole), as wp22-mutation.test.ts
          const end = w.match(/[.,]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-rD design 6.10 (local index): synthetic examples', () => {
  it('no std-rD line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

// ---- the TypeChoices hole, the face choice and the renderer --------------------------------------------------------------------------------------------------

const spell = (text: string) => parseCard(card('Example Volley', 'Sorcery', text), OPTS).faces[0]!;
const creature = (text: string) => parseCard(card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
const optionsOf = (f: ReturnType<typeof spell>): unknown => JSON.parse(JSON.stringify(f.abilities)).flatMap((a: { effect?: { steps?: { options?: unknown }[] } }) => (a.effect?.steps ?? []).map((s) => s.options)).find((o: unknown) => o !== undefined);

describe('std-rD hole TypeChoices (CR 205.2a): a list of two or more singular card type words, as Oracle lists them', () => {
  it.each([
    ['Choose artifact or enchantment. Destroy all permanents of the chosen type.', ['Artifact', 'Enchantment']],
    ['Choose artifact, creature, or land. Destroy all permanents of the chosen type.', ['Artifact', 'Creature', 'Land']],
    ['Choose battle, enchantment, instant, or planeswalker. Destroy all permanents of the chosen type.', ['Battle', 'Enchantment', 'Instant', 'Planeswalker']],
  ])('%s', (text, want) => {
    const f = spell(text);
    expect(f.templatesUsed).toContain('eff.stdrd.choose.cardTypeList');
    expect(optionsOf(f)).toEqual(want);
  });
  it.each([
    'Choose land or nonland. Destroy all permanents of the chosen type.', // "nonland" is not a card type
    'Choose artifact or artifact. Destroy all permanents of the chosen type.', // a type twice is not a list
    'Choose artifact, creature or land. Destroy all permanents of the chosen type.', // three or more take ", or" (Oracle\'s list form)
    'Choose artifact, or creature. Destroy all permanents of the chosen type.', // two take a bare "or"
    'Choose artifacts or enchantments. Destroy all permanents of the chosen type.', // plural words are not the choice\'s values
    'Choose Elf or Goblin. Destroy all permanents of the chosen type.', // creature types are another choice (r4-cost)
  ])('refused: %s', (text) => {
    expect(spell(text).templatesUsed).not.toContain('eff.stdrd.choose.cardTypeList');
  });
});

describe('std-rD face choice (CR 607.2d, 614.12a): "As ~ enters, choose <type list>" gives "the chosen type" of the other abilities its card type', () => {
  it('the chosen type of a cost reduction reads the enters choice of the list form', () => {
    const f = creature('As ~ enters, choose artifact or creature.\nSpells you cast of the chosen type cost {1} less to cast.');
    expect(automated(f.abilities), JSON.stringify(f.diagnostics)).toBe(true);
    expect(f.templatesUsed).toContain('rep.stdrd.enters.choose.cardTypeList');
  });
  it('without an enters choice the chosen type has no antecedent and stays manual', () => {
    expect(automated(creature("Players can't cast spells of the chosen type.").abilities)).toBe(false);
  });
});

const RCTX = { selfNames: ['Test Card'], selfTypes: ['Sorcery'] };
const chooseThenDestroy = (options?: string[]) => ({
  kind: 'spell', effect: { targets: [], steps: [
    { op: 'chooseValue', who: { ref: 'you' }, what: 'cardType', ...(options ? { options } : {}), as: 'chosenCardType', link: 'chosenCardType' },
    { op: 'destroy', what: { ref: 'each', filter: { chosen: { link: 'chosenCardType', quality: 'cardType' } } } },
  ] },
}) as never;

describe('std-rD renderer (CR 608.2d, 205.2a): a card type choice among listed types prints the list', () => {
  it('two types: "choose artifact or enchantment"; the gate refuses another list and "a card type"', () => {
    const def = chooseThenDestroy(['Artifact', 'Enchantment']);
    expect(renderAbility(def, RCTX).join(' ')).toBe('Choose artifact or enchantment. Destroy all permanents of the chosen type.');
    expect(renderGate(def, ['Choose artifact or creature. Destroy all permanents of the chosen type.'], RCTX).ok).toBe(false);
    expect(renderGate(def, ['Choose a card type. Destroy all permanents of the chosen type.'], RCTX).ok).toBe(false);
  });
  it('three types: with commas and ", or"', () => {
    expect(renderAbility(chooseThenDestroy(['Artifact', 'Creature', 'Land']), RCTX).join(' ')).toBe('Choose artifact, creature, or land. Destroy all permanents of the chosen type.');
  });
  it('no list: "choose a card type", as before', () => {
    expect(renderAbility(chooseThenDestroy(), RCTX).join(' ')).toBe('Choose a card type. Destroy all permanents of the chosen type.');
  });
});

const discardTrigger = (what: unknown, batch = false) => ({
  kind: 'triggered', trigger: { on: [{ ev: 'action', verb: 'discard', actor: 'you' }], ...(batch ? { batch: true } : {}) },
  effect: { targets: [], steps: [{ op: 'move', what, to: { zone: 'exile' } }] },
}) as never;
const inYourGraveyard = (is: unknown) => ({ ref: 'each', filter: { is, zone: 'graveyard', owner: 'you' } });

describe('std-rD renderer (CR 701.9a, 608.2c, 400.7): the card of a discard is "that card"; "exile that card from your graveyard"', () => {
  it('the discarded card is "that card" (and "it")', () => {
    const def = discardTrigger({ ref: 'event', role: 'subject' });
    expect(renderGate(def, ['Whenever you discard a card, exile that card.'], RCTX).ok).toBe(true);
    expect(renderGate(def, ['Whenever you discard a card, exile it.'], RCTX).ok).toBe(true);
    expect(renderGate(def, ['Whenever you discard a card, exile that creature.'], RCTX).ok).toBe(false);
  });
  it('the event\'s card, only while in your graveyard, is "that card from your graveyard"', () => {
    const def = discardTrigger(inYourGraveyard({ ref: 'event', role: 'subject' }));
    expect(renderGate(def, ['Whenever you discard a card, exile that card from your graveyard.'], RCTX).ok).toBe(true);
    expect(renderGate(def, ['Whenever you discard a card, exile that card.'], RCTX).ok).toBe(false);
    expect(renderGate(def, ["Whenever you discard a card, exile that card from its owner's graveyard."], RCTX).ok).toBe(false);
  });
  it('a player of the event is not a card in a graveyard: no renderer', () => {
    expect(renderGate(discardTrigger(inYourGraveyard({ ref: 'event', role: 'player' })), ['Whenever you discard a card, exile that player from your graveyard.'], RCTX).ok).toBe(false);
  });
});
