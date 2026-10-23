/**
 * Standard round E (std-re): the template data of parser/templates/zz-cloud/std-re.json (a search for three cards of three descriptions; "you scry N", "you
 * surveil N") and the parser and renderer changes of the round: the "that's a <kind> or a <kind>" reading of parser/holes/filter.ts#thatsKinds and its
 * renderer (render/np.ts#thatAreForm), subtypes joined by "or" before one card type (parser/holes/filter.ts#shape), the Lorwyn tribe choice as "the chosen
 * type" (parser/parse.ts#ENTERS_CHOICE) and "draw X cards, where X is the number of cards discarded this way" with X said again (render/steps-cards.ts,
 * render/steps-util.ts#markX). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every
 * counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never
 * leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * std-re-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRe from '../../../src/parser/templates/zz-cloud/std-re.json';
import review from '../../m5/golden/cards/cloud-std-re-review.json';
import { renderGate } from '../../../src/index';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = (stdRe as Template[]).filter((t) => t.id !== 'eff.stdre.cast.fromLinkedExile.owned'); // that one: std-re-exile-templates.test.ts
const MECH_COUNT = 2;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered or static ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('std-re template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-re.json, after zz-cloud/std-r9.json, before zz-cloud/std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-re.json');
    expect(files.indexOf('zz-cloud/std-re.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-r9.json'));
    expect(files.indexOf('zz-cloud/std-re.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdre.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.stdre\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence, hand-verified golden cards that use it (the review file pins each card as full)', () => {
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

describe('std-re guard G9 (design 6.8): examples and counter-examples', () => {
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

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\bscry\b/, 'surveil'], [/\bsurveil\b/, 'scry'], [/\byou scry\b/, 'each opponent scries'], [/\byour library\b/, 'your graveyard'],
    [/\ba red card\b/, 'two red cards'], [/, and a green card\b/, ', or a green card'], [/\bonto the battlefield\b/, 'into your hand'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-re guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('std-re guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~,' || /^\{/.test(w)) return;
          const end = w.match(/[.,]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-re design 6.10 (local index): synthetic examples', () => {
  it('no std-re line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const synthetic = [...MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples]), ...PARSER_SENTENCES];
    const verbatim = synthetic.filter((x) => x.split('\n').some((l) => lines.has(l.trim())));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

// ---- parser and renderer changes ------------------------------------------------------------------------------------------------------------------------

const RCTX = { selfNames: ['Test Card'], selfTypes: ['Creature'] };
const creatureCard = (text: string): OracleCard => card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
const parsed = (text: string) => parseCard(creatureCard(text), OPTS).faces[0]!;
const full = (text: string): boolean => fullyAutomated(parsed(text));

const THATS_WOLF = "Whenever this creature attacks, put a +1/+1 counter on each creature you control that's a Bear or a Wolf.";
const THATS_TOKEN = "Whenever this creature attacks, put a +1/+1 counter on each other creature you control that's a token or a Squirrel.";
const THATS_ONE_ARTICLE = "Each other creature you control that's a Goblin or Kobold gets +1/+1.";
const SUBTYPES_TYPE = 'When this creature enters, return target Bear or Wolf creature card from your graveyard to your hand.';
const PARSER_SENTENCES = [THATS_WOLF, THATS_TOKEN, THATS_ONE_ARTICLE, SUBTYPES_TYPE, "As this enchantment enters, choose Elemental, Elf, Faerie, Giant, Goblin, Kithkin, Merfolk, or Treefolk.", "When this creature enters, you may discard your hand. Draw X cards, where X is the number of cards discarded this way. This creature deals X damage to each opponent."];

/** The `each` filter of the first counter or continuous step of the face. */
function eachFilter(text: string): unknown {
  const s = JSON.stringify(parsed(text).abilities);
  const m = /"ref":"each","filter":(\{.*?\})\}/.exec(s);
  return m ? JSON.parse(m[1]!) : null;
}

describe('std-re parser (CR 205.3m, 111.1): "that\'s a <kind> or a <kind>" after a creature description is one object of any of the kinds', () => {
  it('"each creature you control that\'s a Bear or a Wolf": a creature you control with either subtype', () => {
    expect(full(THATS_WOLF)).toBe(true);
    expect(eachFilter(THATS_WOLF)).toMatchObject({ types: ['Creature'], controller: 'you', anyOf: [{ subtypes: ['Bear'] }, { subtypes: ['Wolf'] }] });
  });
  it('"each other creature you control that\'s a token or a Squirrel": a token, or a Squirrel (CR 111.1)', () => {
    expect(full(THATS_TOKEN)).toBe(true);
    expect(eachFilter(THATS_TOKEN)).toMatchObject({ other: true, anyOf: [{ token: true }, { subtypes: ['Squirrel'] }] });
  });
  it('one article for the list ("that\'s a Goblin or Kobold") reads the same', () => {
    expect(full(THATS_ONE_ARTICLE)).toBe(true);
  });
  it('a lone kind, "and", a card type or a word that is not a subtype is not read here', () => {
    expect(full("Whenever this creature attacks, put a +1/+1 counter on each creature you control that's a Bear and a Wolf.")).toBe(false);
    expect(full("Whenever this creature attacks, put a +1/+1 counter on each creature you control that's a Bear or a blorfty.")).toBe(false);
    expect(full("Whenever this creature attacks, put a +1/+1 counter on each creature you control that's a Bear or Wolves.")).toBe(false);
  });
});

describe('std-re parser (CR 205.3m, 205.2a): subtypes joined by "or" before one card type share it', () => {
  it('"target Bear or Wolf creature card": a creature card with either subtype (`subtypes` is "any of")', () => {
    const f = parsed(SUBTYPES_TYPE);
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"subtypes":["Bear","Wolf"]');
    expect(JSON.stringify(f.abilities)).toContain('"types":["Creature"]');
  });
  it('a repeated subtype is not read', () => {
    expect(full('When this creature enters, return target Bear or Bear creature card from your graveyard to your hand.')).toBe(false);
  });
});

describe('std-re renderer (CR 205.3m): the "that\'s" list after a determiner', () => {
  const def = (filter: Record<string, unknown>) => ({ kind: 'spell', effect: { targets: [], steps: [{ op: 'putCounters', on: { ref: 'each', filter }, kind: '+1/+1', count: 1 }] } }) as never;
  const wolves = { types: ['Creature'], controller: 'you', anyOf: [{ subtypes: ['Bear'] }, { subtypes: ['Wolf'] }] };
  it('both wordings of the same set are accepted, a different set is not', () => {
    expect(renderGate(def(wolves), ["Put a +1/+1 counter on each creature you control that's a Bear or a Wolf."], RCTX).ok).toBe(true);
    expect(renderGate(def(wolves), ['Put a +1/+1 counter on each Bear or Wolf creature you control.'], RCTX).ok).toBe(true);
    expect(renderGate(def(wolves), ["Put a +1/+1 counter on each creature you control that's a Bear or an Elf."], RCTX).ok).toBe(false);
    expect(renderGate(def(wolves), ["Put a +1/+1 counter on each creature you control that's a Bear."], RCTX).ok).toBe(false);
  });
  it('a token is said only after "that\'s" ("a token or a Squirrel"), never as a subtype', () => {
    const tok = { types: ['Creature'], controller: 'you', other: true, anyOf: [{ token: true }, { subtypes: ['Squirrel'] }] };
    expect(renderGate(def(tok), ["Put a +1/+1 counter on each other creature you control that's a token or a Squirrel."], RCTX).ok).toBe(true);
    expect(renderGate(def(tok), ["Put a +1/+1 counter on each other creature you control that's a Squirrel or a token."], RCTX).ok).toBe(false);
  });
});

describe('std-re renderer (CR 701.23a): a search for three descriptions is a list', () => {
  it('"for a red card, a white card, and a green card"; "and" between the first two is not Oracle\'s', () => {
    const def = { kind: 'spell', effect: { targets: [], steps: [
      { op: 'search', who: { ref: 'you' }, zone: 'library', filter: { colors: ['R'] }, max: 1, and: [{ colors: ['W'] }, { colors: ['G'] }], as: 'search' },
      { op: 'move', what: { ref: 'bound', name: 'search' }, to: { zone: 'graveyard' } },
      { op: 'shuffle', who: { ref: 'you' } },
    ] } } as never;
    const ctx = { selfNames: ['Test Card'], selfTypes: ['Sorcery'] };
    expect(renderGate(def, ['Search your library for a red card, a white card, and a green card. Put those cards into your graveyard, then shuffle.'], ctx).ok).toBe(true);
    expect(renderGate(def, ['Search your library for a red card and a white card and a green card. Put those cards into your graveyard, then shuffle.'], ctx).ok).toBe(false);
  });
});

const LORWYN = 'As this enchantment enters, choose Elemental, Elf, Faerie, Giant, Goblin, Kithkin, Merfolk, or Treefolk.\nWhenever a creature you control of the chosen type dies, draw a card.';
const BALIN_LIKE = 'When this creature enters, you may discard your hand. Draw X cards, where X is the number of cards discarded this way. This creature deals X damage to each opponent.';

describe('std-re parser (CR 205.3m, 607.2d): the Lorwyn tribe choice is a creature-type choice that "the chosen type" of the face reads', () => {
  const artifact = (text: string) => parseCard(card('Example Banner', 'Enchantment', text), OPTS).faces[0]!;
  it('the eight-type list links "the chosen type" of the other ability', () => {
    const f = artifact(LORWYN);
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"chosen":{"link":"type","quality":"creatureType"}');
  });
  it('another list of creature types is not this choice (it stays manual)', () => {
    expect(fullyAutomated(artifact('As this enchantment enters, choose Elf, Faerie, Giant, Goblin, or Treefolk.\nWhenever a creature you control of the chosen type dies, draw a card.'))).toBe(false);
  });
});

describe('std-re renderer (CR 107.3, 608.2c, 608.2h): "draw X cards, where X is the number of cards discarded this way", and X said again', () => {
  it('the count of what the discard moved draws that many and deals that much damage; the gate accepts the Oracle wording', () => {
    const f = parsed(BALIN_LIKE);
    expect(fullyAutomated(f)).toBe(true);
    const s = JSON.stringify(f.abilities);
    expect(s.match(/"q":"resultCount","step":"discard"/g)?.length).toBe(2);
  });
  it('a later "X" with no earlier "where X is" is not read as that count', () => {
    expect(full('When this creature enters, you may discard your hand. Draw two cards. This creature deals X damage to each opponent.')).toBe(false);
  });
});
