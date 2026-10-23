/**
 * std-rw7 (card wave 2, slice s7): the template data of parser/templates/zz-cloud/std-rw7.json ("you may cast a <spell> from your hand without paying its mana
 * cost", "you may cast a <spell> from your graveyard" during a resolution; "If an instant or sorcery spell cast this way would be put into your graveyard, exile it
 * instead.") and the renderer and engine changes of the round: the fold render/fold.ts#castFromOwnZone, the sentence render/steps-zones.ts#graveyardInsteadText and
 * the cast step's `graveyardInstead.types` (types/ability.ts, effects/handlers/tokens-cast.ts). Guard G9 (design 6.8): every example lowers with its template, is
 * automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a
 * nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in std-rw7-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRw7 from '../../../src/parser/templates/zz-cloud/std-rw7.json';
import review from '../../m5/golden/cards/cloud-std-rw7-review.json';
import { renderGate } from '../../../src/index';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdRw7 as Template[];
const MECH_COUNT = 3;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered or activated ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('std-rw7 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rw7.json, after zz-cloud/std-rp.json, before zz-cloud/std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rw7.json');
    expect(files.indexOf('zz-cloud/std-rw7.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rp.json'));
    expect(files.indexOf('zz-cloud/std-rw7.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff|rid.stdrw7.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|rid)\.stdrw7\./);
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
    const uses = (id: string) => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);
    for (const t of MECH.filter((x) => x.status === 'stable')) expect(uses(t.id).length, t.id).toBeGreaterThanOrEqual(1);
    // the free cast from your hand meets design 6.9 itself (three independently verified golden cards, tuning half); the other two are narrow wordings
    // (one or two cards in the whole index) made stable on their golden cards plus these tests and the played scenarios: a 6.9 deviation, named in the record
    expect(uses('eff.stdrw7.cast.fromHand.free')).toEqual(["Sram's Expertise", "Yahenni's Expertise", "Rishkar's Expertise"]);
    expect(uses('eff.stdrw7.cast.fromGraveyard')).toEqual(['Bilbo, Thief in the Night']);
    expect(uses('rid.stdrw7.cast.typed.exileInstead')).toEqual(['Bilbo, Thief in the Night', 'Scholar of the Lost Trove']);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'without']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
      if (t.pattern.includes('this way')) expect(t.consumes ?? [], t.id).toContain('this way');
    }
  });
  it('design 6.3: the general reading ranks below a fixed wording of the same sentence (priority -1): FAST5 T63 keeps "a noncreature spell from your hand"', () => {
    for (const t of MECH.filter((x) => x.kind === 'effect')) expect(t.priority, t.id).toBe(-1);
    const f = parseCard(card('Example Volley', 'Sorcery', 'Draw a card. You may cast a noncreature spell from your hand without paying its mana cost.'), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(true);
    expect(f.templatesUsed.some((id) => id.startsWith('eff.stdrw7.')), f.templatesUsed.join(', ')).toBe(false);
  });
});

describe('std-rw7 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const out = [`${body} unless it is blue.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\bfrom your hand\b/, 'from your library'], [/\bfrom your graveyard\b/, "from an opponent's graveyard"], [/\byou may cast an? /, 'you may cast two '],
    [/\bwithout paying its mana cost\b/, 'by paying {2} more'], [/\binto your graveyard\b/, 'into your hand'], [/\bexile it instead\b/, 'shuffle it into your library instead'],
    [/\binstant or sorcery spell cast this way\b/, 'instant or sorcery spell'], [/\bmana value 2 or less\b/, 'mana value 2 or greater'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rw7 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
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

describe('std-rw7 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('std-rw7 design 6.10 (local index): synthetic examples', () => {
  it('no std-rw7 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const synthetic = [...MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples]), ...RENDER_SENTENCES];
    const verbatim = synthetic.filter((x) => x.split('\n').some((l) => lines.has(l.trim())));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

// ---- renderer and engine changes ----------------------------------------------------------------------------------------------------------------------

const RCTX = { selfNames: ['Test Card'], selfTypes: ['Creature'] };
const RENDER_SENTENCES = [
  'Whenever ~ attacks, you may cast an artifact or instant spell from your graveyard. If that spell would be put into your graveyard, exile it instead.',
  'When ~ enters, you may cast target instant or sorcery card from your graveyard. If an instant or sorcery spell cast this way would be put into your graveyard, exile it instead.',
];
const choose = (zone: 'hand' | 'graveyard', kind: Record<string, unknown>) => ({
  op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { anyOf: [kind], notTypes: ['Land'], zone, owner: 'you', isCard: true } }, min: 0, max: 1, as: 'cast',
});
const def = (steps: unknown[]) => ({ kind: 'spell', effect: { targets: [], steps } }) as never;
const castIt = (extra: Record<string, unknown> = {}) => ({ op: 'cast', who: { ref: 'you' }, what: { ref: 'bound', name: 'cast' }, ...extra });

describe('std-rw7 renderer (CR 608.2g, 118.9; render/fold.ts#castFromOwnZone): one optional choice in a zone of yours, then the cast of that card', () => {
  const ctx = { selfNames: ['Test Card'], selfTypes: ['Sorcery'] };
  it('from your hand, free: "you may cast a spell with mana value 3 or less from your hand without paying its mana cost"; the zone and the cost are said as they are', () => {
    const d = def([choose('hand', { manaValue: { op: '<=', value: 3 } }), castIt({ free: true })]);
    expect(renderGate(d, ['You may cast a spell with mana value 3 or less from your hand without paying its mana cost.'], ctx).ok).toBe(true);
    expect(renderGate(d, ['You may cast a spell with mana value 3 or less from your graveyard without paying its mana cost.'], ctx).ok).toBe(false);
    expect(renderGate(d, ['You may cast a spell with mana value 3 or less from your hand.'], ctx).ok).toBe(false);
  });
  it('from your graveyard, paid: "you may cast an instant or sorcery spell from your graveyard"; free from a graveyard and paid from a hand are not folded (not this round\'s wordings)', () => {
    expect(renderGate(def([choose('graveyard', { types: ['Instant', 'Sorcery'] }), castIt()]), ['You may cast an instant or sorcery spell from your graveyard.'], ctx).ok).toBe(true);
    expect(renderGate(def([choose('graveyard', { types: ['Instant'] }), castIt({ free: true })]), ['You may cast an instant spell from your graveyard without paying its mana cost.'], ctx).ok).toBe(false);
    expect(renderGate(def([choose('hand', { types: ['Instant'] }), castIt()]), ['You may cast an instant spell from your hand.'], ctx).ok).toBe(false);
  });
  it('a choice by another player, of two cards, or a cast with an alternative cost is not this fold', () => {
    const other = { ...choose('graveyard', { types: ['Instant'] }), who: { ref: 'opponent' } };
    expect(renderGate(def([other, castIt()]), ['You may cast an instant spell from your graveyard.'], ctx).ok).toBe(false);
    expect(renderGate(def([{ ...choose('graveyard', { types: ['Instant'] }), max: 2 }, castIt()]), ['You may cast an instant spell from your graveyard.'], ctx).ok).toBe(false);
  });
});

describe('std-rw7 renderer (CR 614.1a, 205.2a; render/steps-zones.ts#graveyardInsteadText): the sentence of `graveyardInstead` with card types', () => {
  it('"If an instant or sorcery spell cast this way would be put into your graveyard, exile it instead." after the fold; the untyped form stays "that spell"', () => {
    const typed = def([choose('graveyard', { types: ['Artifact', 'Instant', 'Sorcery'] }), castIt({ graveyardInstead: { to: { zone: 'exile' }, yours: true, types: ['Instant', 'Sorcery'] } })]);
    const text = 'You may cast an artifact, instant, or sorcery spell from your graveyard. If an instant or sorcery spell cast this way would be put into your graveyard, exile it instead.';
    expect(renderGate(typed, [text], RCTX).ok).toBe(true);
    expect(renderGate(typed, ['You may cast an artifact, instant, or sorcery spell from your graveyard. If that spell would be put into your graveyard, exile it instead.'], RCTX).ok).toBe(false);
    const untyped = def([choose('graveyard', { types: ['Artifact', 'Instant'] }), castIt({ graveyardInstead: { to: { zone: 'exile' }, yours: true } })]);
    expect(renderGate(untyped, ['You may cast an artifact or instant spell from your graveyard. If that spell would be put into your graveyard, exile it instead.'], RCTX).ok).toBe(true);
  });
  it('a single card type or a graveyard that is not yours is not rendered (no wording read for it)', () => {
    const one = def([choose('graveyard', { types: ['Instant'] }), castIt({ graveyardInstead: { to: { zone: 'exile' }, yours: true, types: ['Instant'] } })]);
    expect(renderGate(one, ['You may cast an instant spell from your graveyard. If an instant spell cast this way would be put into your graveyard, exile it instead.'], RCTX).ok).toBe(false);
    const anyGy = def([choose('graveyard', { types: ['Instant'] }), castIt({ graveyardInstead: { to: { zone: 'exile' }, types: ['Instant', 'Sorcery'] } })]);
    expect(renderGate(anyGy, ['You may cast an instant spell from your graveyard. If an instant or sorcery spell cast this way would be put into a graveyard, exile it instead.'], RCTX).ok).toBe(false);
  });
  it('the target-card cast of eff.cost.cast.target.free takes the same sentence (Scholar of the Lost Trove\'s shape, a synthetic wording)', () => {
    const f = parseCard(card('Example Brute', 'Creature — Elf Warrior', RENDER_SENTENCES[1]!, { power: '3', toughness: '3' }), OPTS).faces[0]!;
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"graveyardInstead":{"to":{"zone":"exile"},"yours":true,"types":["Instant","Sorcery"]}');
  });
  it('the existing untyped rider (rid.r4repl.cast.yourGraveyard.exileInstead) still reads after the new fold', () => {
    const f = parseCard(card('Example Brute', 'Creature — Elf Warrior', RENDER_SENTENCES[0]!, { power: '3', toughness: '3' }), OPTS).faces[0]!;
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(f.templatesUsed).toContain('rid.r4repl.cast.yourGraveyard.exileInstead');
  });
});
