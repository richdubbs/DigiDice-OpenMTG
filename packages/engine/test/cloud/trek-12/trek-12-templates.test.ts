/**
 * Lane trek, round trek-12 (Star Trek: an ability a card in exile has): the template data of parser/templates/zz-cloud/trek-12.json ("create a copy of ~") and what
 * finishes the card around it:
 *  - the short name "Q" of a legendary creature whose name is that creature type (CR 201.5c; parser/front/selfref.ts#shortNames);
 *  - "That nonland card gains ..." after "exile cards from the top of your library until you exile a nonland card" (CR 608.2c; parser/holes/object.ts, the binding's
 *    name in render/steps-cards.ts#exileUntil);
 *  - "~ is exiled" as an activation restriction (CR 113.6, 602.5b; parser/holes/cond.ts, render/cond.ts) that puts the ability in exile
 *    (parser/lower/activation.ts#activationZone, lower/quoted.ts for a quoted ability);
 *  - "you may cast the copy" (r4-copy's rider) after the copy of the card itself, read only in an ability that functions in exile (model/lint-nodes.ts, case 'cast');
 *  - the render gate's "create a copy of ~" (render/steps-zones.ts#cast, family create-a-copy-of-self).
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are
 * synthetic wordings (design 6.10). The behavior is in trek-12-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { lexiconIndex } from '../../../src/parser/front/lexicon-index';
import { shortNames } from '../../../src/parser/front/selfref';
import type { FaceContext } from '../../../src/parser/front/types';
import { activationZone } from '../../../src/parser/lower/activation';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/trek-12.json';
import review from '../../m5/golden/cards/trek-12-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 1;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** An ability of a creature card. */
const parse = (text: string, type = 'Creature — Ooze') => parseCard(card('Example Ooze', type, text, { power: '0', toughness: '0' }), OPTS).faces[0]!;
/** A legendary creature whose name before the comma is its creature type, as the card of this round is. */
const parseNamed = (name: string, type: string, text: string) => parseCard(card(name, type, text, { power: '1', toughness: '1' }), OPTS).faces[0]!;
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);

describe('trek-12 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/trek-12.json, in path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/trek-12.json');
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.trek12.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.trek12\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 DEVIATION (named in the round record, accepted by the owner on 2026-10-24 for single-printing Star Trek wordings): the wording is printed on one card, so the template is stable on one hand-verified golden card plus these tests', () => {
    expect(MECH.filter((x) => x.status === 'stable').map((t) => t.id).sort()).toEqual(['eff.trek12.copy.self.create']);
    expect(evidence('eff.trek12.copy.self.create')).toEqual(['Q, Stacking the Deck']);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'same']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('trek-12 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parse(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parse(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(f.templatesUsed.includes('rid.r4copy.mayCastCopy'), e.text).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parse(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
  it('the two examples are the copy of the card itself cast from exile: `cast` with `copyIn`, `what` self, in an activated ability that functions in exile alone', () => {
    for (const e of MECH[0]!.examples) {
      const a = parse(e.text).abilities[0]!;
      expect(a, e.text).toMatchObject({ kind: 'activated', zone: ['exile'], effect: { steps: [{ op: 'cast', what: { ref: 'self' }, who: { ref: 'you' }, copyIn: 'exile', optional: true }] } });
      expect(JSON.stringify(a), e.text).toContain('"cond":"matches","object":{"ref":"self"},"filter":{"zone":"exile"}');
    }
  });
  it('the counter-examples that stay automated differ in JSON, the others are manual: no restriction (the ability would function on the battlefield), no cast, or a token copy', () => {
    const [noRestriction, noCast, token] = MECH[0]!.counterExamples.map((c) => parse(c));
    expect(fullyAutomated(noRestriction!)).toBe(false);
    expect(fullyAutomated(noCast!)).toBe(false);
    // a token that is a copy of the card is another instruction (eff.copy.token), never this one
    expect(token!.templatesUsed).not.toContain('eff.trek12.copy.self.create');
  });
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} this turn.`];
  const swaps: [RegExp, string][] = [
    [/Create a copy of ~/, 'Create two copies of ~'], [/Create a copy of ~/, 'Create a copy of target creature'], [/You may cast the copy/, 'You cast the copy'],
    [/You may cast the copy/, 'You may cast it'], [/only if ~ is exiled/, 'only if ~ is tapped'], [/only if ~ is exiled/, 'only if ~ is in your hand'],
    [/Activate only if/, 'Activate only if you control a creature and only if'], [/Exile (a|two) card/, 'Sacrifice a creature, exile a card'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('trek-12 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/this turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parse(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parse(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('trek-12 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          // (a word of the cost that is not understood is a manual cost part, which the controller confirms: the card is partial, as `automated` alone does not see)
          const f = parse(mutated);
          expect(fullyAutomated(f) && !JSON.stringify(f.abilities).includes('"kind":"manual"'), mutated).toBe(false);
        });
      }
    });
  }
});

describe('trek-12 guard G2 on the whole card: a nonsense word in any place of the card\'s own text never leaves it full', () => {
  const Q_TEXT = 'When Q enters, shuffle your library, then exile cards from the top of your library until you exile a nonland card. That nonland card gains "Exile a card from your hand: Create a copy of this card. You may cast the copy. Activate only during your turn and only if this card is exiled."';
  const level = (text: string): { level: string; manualPart: boolean } => {
    const def = compileCard({ name: 'Q, Stacking the Deck', layout: 'normal', mana_cost: '{2}{R}{R}', type_line: 'Legendary Creature — Q', oracle_text: text, colors: ['R'], power: '5', toughness: '4' } as OracleCard);
    return { level: def.automation.level, manualPart: JSON.stringify(def.faces).includes('"kind":"manual"') || JSON.stringify(def.faces).includes('"op":"manual"') };
  };
  it('the card as printed is full, with no manual part', () => {
    expect(level(Q_TEXT)).toEqual({ level: 'full', manualPart: false });
  });
  it('replacing any one word by an invented word: never full', () => {
    const words = Q_TEXT.split(' ');
    words.forEach((w, i) => {
      const lead = w.match(/^["\n]+/)?.[0] ?? '';
      const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
      const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
      const r = level(mutated);
      expect(r.level === 'full' && !r.manualPart, mutated).toBe(false);
    });
  });
  it('leaving out the restriction, the cast, or the "only if this card is exiled" half is never full either (a missing sentence is not the card)', () => {
    for (const text of [
      Q_TEXT.replace(' Activate only during your turn and only if this card is exiled.', ''),
      Q_TEXT.replace(' You may cast the copy.', ''),
      Q_TEXT.replace(' and only if this card is exiled', ''),
      Q_TEXT.replace('Activate only during your turn and only if this card is exiled.', 'Activate only during your turn.'),
    ]) {
      const r = level(text);
      expect(r.level === 'full' && !r.manualPart, text).toBe(false);
    }
  });
});

describe('CR 201.5c: the short name "Q" (parser/front/selfref.ts#shortNames)', () => {
  const ix = lexiconIndex();
  const ctx = (name: string, type: string): FaceContext => {
    const [left, right] = type.split(' — ');
    const words = left!.split(' ');
    return {
      name, otherNames: [], isToken: false,
      supertypes: words.filter((w) => w === 'Legendary').map((w) => w.toLowerCase()),
      types: words.filter((w) => w !== 'Legendary').map((w) => w.toLowerCase()),
      subtypes: (right ?? '').split(' ').filter(Boolean).map((w) => w.toLowerCase()),
    } as unknown as FaceContext;
  };
  it('a legendary card whose name before the comma is one letter that is its own creature type is known by it', () => {
    expect(shortNames(ctx('Q, Stacking the Deck', 'Legendary Creature — Q'), ix)).toEqual(['Q']);
    expect(shortNames(ctx('Z, Test of Names', 'Legendary Creature — Z'), ix)).toEqual(['Z']);
  });
  it('not on a card that is not legendary, and not a short name that is not the card\'s own creature type (X, Me, Ao, MJ, Uh keep their words)', () => {
    expect(shortNames(ctx('Q, Stacking the Deck', 'Creature — Q'), ix)).toEqual([]);
    expect(shortNames(ctx('X, Mystery Racer', 'Legendary Creature — Human Spy'), ix)).toEqual([]);
    expect(shortNames(ctx('Me, the Immortal', 'Legendary Creature — Human Rogue'), ix)).toEqual([]);
    expect(shortNames(ctx('Ao, the Dawn Sky', 'Legendary Creature — Dragon Spirit'), ix)).toEqual([]);
    expect(shortNames(ctx('MJ, Rising Star', 'Legendary Creature — Human Performer'), ix)).toEqual([]);
    expect(shortNames(ctx('Uh, Squen & Cragg Made a Card', 'Enchantment'), ix)).toEqual([]);
  });
  it('"When Q enters" is the card itself; a type position of the word stays a type', () => {
    const f = parseNamed('Q, Stacking the Deck', 'Legendary Creature — Q', 'When Q enters, you gain 2 life.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(f.abilities[0]).toMatchObject({ kind: 'triggered', trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }] } });
  });
});

describe('CR 608.2c, 400.7: "That nonland card gains ..." names the card an exile until stopped at (parser/holes/object.ts)', () => {
  const until = 'When ~ enters, exile cards from the top of your library until you exile a nonland card.';
  it('"that nonland card" is the card the exile stopped at, said again with its description: automated and rendered back by the gate', () => {
    const f = parse(`${until} That nonland card gains flying.`);
    expect(fullyAutomated(f), JSON.stringify([f.diagnostics, f.gate])).toBe(true);
    expect(JSON.stringify(f.abilities[0])).toContain('"affects":{"ref":"bound","name":"them"}');
  });
  it('the description must be the one the exile used: a creature card exiled, then "that nonland card", is not understood (the renderer names it only as it was described)', () => {
    const f = parse('When ~ enters, exile cards from the top of your library until you exile a creature card. That nonland card gains flying.');
    expect(fullyAutomated(f)).toBe(false);
  });
  it('and "that card" and "the exiled nonland card" still read as they did (std-eoe, std-exile-play-1-1)', () => {
    expect(fullyAutomated(parse(`${until} That card gains flying.`))).toBe(true);
    expect(fullyAutomated(parse(`${until} You may cast the exiled nonland card this turn.`))).toBe(true);
  });
});

describe('CR 113.6, 602.5b, 400.7: "~ is exiled" is an activation restriction that puts the ability in exile', () => {
  const text = 'Exile a card from your hand: Draw a card. Activate only during your turn and only if ~ is exiled.';
  it('"Activate only during your turn and only if ~ is exiled": both conditions must hold, the ability functions in exile (the zone the engine offers it from), full', () => {
    const f = parse(text);
    expect(fullyAutomated(f), JSON.stringify([f.diagnostics, f.gate])).toBe(true);
    expect(f.abilities[0]).toMatchObject({
      kind: 'activated', zone: ['exile'],
      onlyIf: { cond: 'all', of: [{ cond: 'turnOf', whose: 'you' }, { cond: 'matches', object: { ref: 'self' }, filter: { zone: 'exile' } }] },
    });
  });
  it('the restriction alone is enough, in either order of the two, and the words are said back (render gate)', () => {
    expect(parse('Exile a card from your hand: Draw a card. Activate only if ~ is exiled.').abilities[0]).toMatchObject({ zone: ['exile'], onlyIf: { cond: 'matches', filter: { zone: 'exile' } } });
    expect(fullyAutomated(parse('Exile a card from your hand: Draw a card. Activate only if ~ is exiled and only during your turn.'))).toBe(true);
  });
  it('a quoted ability granted with it functions in exile too (lower/quoted.ts), and a granted one whose cost or effect needs ~ elsewhere is not understood', () => {
    const ok = parse('When ~ enters, exile cards from the top of your library until you exile a nonland card. That nonland card gains "Exile a card from your hand: Draw a card. Activate only if this card is exiled."');
    expect(fullyAutomated(ok), JSON.stringify(ok.diagnostics)).toBe(true);
    expect(JSON.stringify(ok.abilities[0])).toContain('"zone":["exile"]');
    const bad = parse('When ~ enters, exile cards from the top of your library until you exile a nonland card. That nonland card gains "{T}, Exile a card from your hand: Draw a card. Activate only if this card is exiled."');
    expect(fullyAutomated(bad)).toBe(false);
  });
  it('activationZone (parser/lower/activation.ts): the restriction states exile when the cost and the effect state none; a cost or an effect that names another zone is a clash (manual)', () => {
    const onlyExiled = { cond: 'matches' as const, object: { ref: 'self' as const }, filter: { zone: 'exile' as const } };
    expect(activationZone({}, 'draw a card.', onlyExiled)).toEqual({ zone: ['exile'] });
    expect(activationZone({}, 'draw a card.', { cond: 'all', of: [{ cond: 'turnOf', whose: 'you' }, onlyExiled] })).toEqual({ zone: ['exile'] });
    expect(activationZone({ tap: true }, 'draw a card.', onlyExiled)).toMatchObject({ manual: expect.stringMatching(/restriction needs ~ in exile/) });
    expect(activationZone({}, 'return ~ from your graveyard to your hand.', onlyExiled)).toMatchObject({ manual: expect.any(String) });
    // not a restriction that reads ~ in exile: another condition, an "or", a "not": no zone, as before
    expect(activationZone({}, 'draw a card.', { cond: 'turnOf', whose: 'you' })).toEqual({});
    expect(activationZone({}, 'draw a card.', { cond: 'any', of: [onlyExiled, { cond: 'turnOf', whose: 'you' }] })).toEqual({});
    // unchanged: a cost or an effect that names ~ in exile alone is a zone the engine offers no activation from
    expect(activationZone({}, 'return ~ from exile to your hand.')).toMatchObject({ manual: expect.stringMatching(/only in the exile/) });
  });
});

describe('CR 707.12, 113.6: the copy of the card itself is read only where ~ is a card in exile', () => {
  it('"Create a copy of ~. You may cast the copy." in an ability that does not function in exile is not understood: a permanent or a spell is no card to copy', () => {
    for (const text of [
      'When ~ enters, create a copy of ~. You may cast the copy.',
      '{1}: Create a copy of ~. You may cast the copy.',
      'Exile a card from your hand: Create a copy of ~. You may cast the copy.',
    ]) expect(fullyAutomated(parse(text)), text).toBe(false);
  });
  it('the copy of a card an effect exiled and the copy of a spell are what they were (r4-copy): "Copy it. You may cast the copy." and "Copy target instant spell." keep their readings', () => {
    const f = parse('{2}: Exile target instant card from your graveyard. Copy it. You may cast the copy.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities[0])).toContain('"copyIn":"exile"');
    expect(fullyAutomated(parse('{2}: Copy target instant spell.'), )).toBe(true);
  });
  it('model/lint-nodes.ts: a `cast` with `copyIn` of ~ outside an activated ability that functions in exile alone is a lint error; a spell copy of ~ is one only in a spell\'s own ability or the cast trigger of the spell itself', async () => {
    const { validateAbility } = await import('../../../src/model/validate');
    const errors = (def: unknown): string[] => validateAbility(def as never).filter((i) => i.severity === 'error').map((i) => i.message);
    const activated = (zone: string[] | undefined, step: Record<string, unknown>) => ({ kind: 'activated', text: 'x', cost: {}, effect: { targets: [], steps: [step] }, ...(zone ? { zone } : {}) });
    const triggered = (on: unknown[], step: Record<string, unknown>) => ({ kind: 'triggered', text: 'x', trigger: { on }, effect: { targets: [], steps: [step] } });
    const spell = (step: Record<string, unknown>) => ({ kind: 'spell', text: 'x', effect: { targets: [], steps: [step] } });
    const cast = { op: 'cast', who: { ref: 'you' }, what: { ref: 'self' }, copyIn: 'exile', optional: true };
    const copy = { op: 'copy', what: { ref: 'self' }, result: 'spell', who: { ref: 'you' } };
    const castSelf = { ev: 'cast', player: 'you', spell: { self: true } };
    const enters = { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' };
    expect(errors(activated(['exile'], cast))).toEqual([]);
    expect(errors(activated(undefined, cast)).join('|')).toMatch(/functions only in exile/);
    expect(errors(activated(['graveyard'], cast)).join('|')).toMatch(/functions only in exile/);
    expect(errors(triggered([enters], cast)).join('|')).toMatch(/functions only in exile/);
    // a spell copy of ~: only where ~ is a spell on the stack
    expect(errors(spell(copy))).toEqual([]);
    expect(errors(triggered([castSelf], copy))).toEqual([]);
    expect(errors(activated(['exile'], copy)).join('|')).toMatch(/copy of a spell on the stack/);
    expect(errors(activated(undefined, copy)).join('|')).toMatch(/copy of a spell on the stack/);
    expect(errors(triggered([enters], copy)).join('|')).toMatch(/copy of a spell on the stack/);
    expect(errors(triggered([castSelf, enters], copy)).join('|')).toMatch(/copy of a spell on the stack/);
  });
});

describe('trek-12 renderer (render/steps-zones.ts#cast): "create a copy of ~" and "copy ~", the same copy', () => {
  it('both wordings of the copy of the card itself pass the gate', () => {
    for (const first of ['Create a copy of ~.', 'Copy ~.']) {
      const f = parse(`Exile a card from your hand: ${first} You may cast the copy. Activate only if ~ is exiled.`);
      expect(fullyAutomated(f), `${first}: ${JSON.stringify([f.diagnostics, f.gate])}`).toBe(true);
    }
  });
});

describe('trek-12 engine capabilities: nothing new is registered, the card needs what exists', () => {
  it('`op:cast.copy`, `op:exileUntil` and `announce.matches.self` are engine capabilities', () => {
    for (const c of ['op:cast.copy', 'op:exileUntil', 'feature:announce.matches.self', 'feature:activate.onlyIf', 'op:effect', 'op:shuffle']) expect(ENGINE_CAPABILITIES.has(c), c).toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('trek-12 design 6.10 (local index): synthetic examples', () => {
  it('no trek-12 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
