/**
 * WP6 review fixes: one test group per finding of the independent review. Each group was written to fail before the fix.
 * Rules cited: CR 608.2c (effects in order), 603.2 (triggers), 500 / 505.1 (steps and the main phases), 400.3 (cards go to their owner's graveyard),
 * 601.2 / 305.1 (casting from a zone), 508.1 (attackers and the player or planeswalker attacked), 205.3 (plural subtype names), 109.4 (controller),
 * 111.10 (predefined tokens), 115.1 (targets), 107.1a (quantities), 702.16 (protection from a quality).
 */
import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChartInput, ChartResult } from '../../../src/parser/chart';
import { compileTemplates, parseUnit, validateTemplates } from '../../../src/parser/chart';
import type { Template, TemplateKind } from '../../../src/parser/types';
import { adaptTokens, isGrammarWord, makeHoleCtx, runHole } from '../../../src/parser/holes';
import type { RawTok } from '../../../src/parser/holes';
import { anyPhraseAt, P } from '../../../src/parser/holes/core';
import { ENV, KEYWORDS, LEXICON, full, one, rejects, target, toks } from './env';

let seq = 0;
function tpl(kind: TemplateKind, pattern: string, build: unknown, extra: Partial<Template> = {}): Template {
  return { id: extra.id ?? `rf${++seq}`, kind, cr: ['CR 608.2c'], pattern, build, examples: [{ text: 'x' }], counterExamples: ['a', 'b'], status: 'stable', since: 1, ...extra };
}
const run = (goal: ChartInput['goal'], text: string, templates: Template[], extra: Partial<ChartInput> = {}): ChartResult => parseUnit({ tokens: toks(text), templates, env: ENV, goal, ...extra });
const ok = (r: ChartResult): Extract<ChartResult, { status: 'ok' }> => { if (r.status !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r).slice(0, 600)}`); return r; };

const creature = { types: ['Creature'] };
const HERE = fileURLToPath(new URL('.', import.meta.url));
/** The tokenizer of WP5, once it is merged (a stub without `tokenize` until then). */
const realTokenize = await import('../../../src/parser/tokenize').then((m) => (m as unknown as Record<string, unknown>)['tokenize']).catch(() => undefined);

// ---------------------------------------------------------------------------
// chart.ts
// ---------------------------------------------------------------------------

describe('review: unit-production cycles over Effects are template errors (CR 608.2c, design 6.3 rule 4)', () => {
  const draw = tpl('effect', 'draw {n:Qty} card[s]', { op: 'draw', who: { ref: 'you' }, count: '$n' }, { id: 'cy.draw' });
  it.each([
    '[you may] {e:Effects}',
    '{e:Effects}',
    '[if {c:Cond} ,] {e:Effects}',
    '^ {e:Effects}',
  ])('"%s" is reported in templateErrors, skipped, and the other templates still parse in few items', (pattern) => {
    const bad = tpl('effect', pattern, { op: 'wrap', do: '$e' }, { id: 'cy.bad' });
    const errors = validateTemplates([draw, bad]).filter((e) => e.id === 'cy.bad');
    expect(errors.map((e) => e.message).join('|')).toMatch(/unit|cycle/i);
    const r = ok(run('effect', 'draw a card', [draw, bad], { budget: 2000 }));
    expect(r.derivation.value).toEqual([{ op: 'draw', who: { ref: 'you' }, count: 1 }]);
    expect(r.items).toBeLessThan(500);
  });
  it('a wrapper that has a literal word in front is no cycle', () => {
    const may = tpl('effect', 'you may {e:Effects}', { op: 'may', who: { ref: 'you' }, do: '$e' }, { id: 'cy.may' });
    expect(compileTemplates([draw, may]).errors).toEqual([]);
    expect(ok(run('effect', 'you may draw a card', [draw, may])).derivation.value).toEqual([{ op: 'may', who: { ref: 'you' }, do: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] }]);
  });
});

describe('review: priority is not added up over the templates of a derivation (design 6.3 rule 3, G5)', () => {
  const base = (comboPrio: number | undefined, destroyPrio = 1): Template[] => [
    tpl('effect', 'destroy {o:Objs}', { op: 'destroy', what: '$o' }, { id: 'eff.d', priority: destroyPrio }),
    tpl('effect', 'draw a card', { op: 'draw', who: { ref: 'you' }, count: 1 }, { id: 'eff.dr', priority: 1 }),
    tpl('effect', 'destroy {o:Objs} and draw a card', { op: 'combo', what: '$o' }, { id: 'eff.combo', ...(comboPrio !== undefined ? { priority: comboPrio } : {}), }),
  ];
  const text = 'destroy target creature and draw a card';
  it('equal priority with a different number of templates is an equal-priority conflict, not a win for the split', () => {
    const r = run('effect', text, base(1));
    expect(r.status).toBe('ambiguous');
  });
  it('a higher priority on the combined template wins, a higher one on a part of the split wins too', () => {
    const r = ok(run('effect', text, base(3)));
    expect(r.derivation.templatesUsed).toEqual(['eff.combo']);
    const r2 = ok(run('effect', text, base(3, 5)));
    expect(r2.derivation.templatesUsed).toEqual(['eff.d', 'eff.dr']);
  });
});

describe('review: the result does not depend on template ids (design 6.3)', () => {
  const mk = (low: string, high: string): Template[] => [
    tpl('effect', 'frob', { x: 1 }, { id: low, priority: 0 }),
    tpl('effect', 'frob', { x: 1 }, { id: high, priority: 5 }),
    tpl('effect', 'frob', { x: 2 }, { id: 'rival', priority: 3 }),
  ];
  it('harmless duplicates are represented by their best (weak, then priority), whatever their ids', () => {
    expect(ok(run('effect', 'frob', mk('a1', 'a2'))).derivation.value).toEqual([{ x: 1 }]);
    expect(ok(run('effect', 'frob', mk('a2', 'a1'))).derivation.value).toEqual([{ x: 1 }]);
    expect(ok(run('effect', 'frob', mk('a2', 'a1'))).harmless).toBe(1);
  });
});

describe('review: a winner that needs a missing capability makes the unit needs-engine (guard G8)', () => {
  const hi = tpl('effect', 'destroy {o:Objs}', { op: 'destroy', what: '$o', regeneration: 'cant' }, { id: 'hi', priority: 5, needs: ['op:destroyNoRegen'] });
  const lo = tpl('effect', 'destroy {o:Objs}', { op: 'destroy', what: '$o' }, { id: 'lo', priority: 0 });
  it('with the capability the better template wins', () => {
    const r = ok(run('effect', 'destroy target creature', [hi, lo], { capabilities: new Set(['op:destroyNoRegen']) }));
    expect(r.derivation.templatesUsed).toEqual(['hi']);
  });
  it('without it the unit is needs-engine, not the approximate reading of the lower template', () => {
    const r = run('effect', 'destroy target creature', [hi, lo], { capabilities: new Set() });
    expect(r.status).toBe('needs-engine');
    if (r.status === 'needs-engine') { expect(r.missing).toEqual(['op:destroyNoRegen']); expect(r.templateIds).toEqual(['hi']); }
  });
  it('a skipped template that would lose anyway does not change the result', () => {
    const weak = tpl('effect', 'destroy {o:Objs}', { op: 'destroy', what: '$o', regeneration: 'cant' }, { id: 'weak', priority: -1, needs: ['op:destroyNoRegen'] });
    const r = ok(run('effect', 'destroy target creature', [weak, lo], { capabilities: new Set() }));
    expect(r.derivation.templatesUsed).toEqual(['lo']);
  });
});

describe('review: the grammar-word set is fixed at load time (guard G2, determinism)', () => {
  it('the diagnostics do not depend on which holes ran before', async () => {
    vi.resetModules();
    const holes = await import('../../../src/parser/holes');
    const chart = await import('../../../src/parser/chart');
    expect(holes.isGrammarWord('alone')).toBe(true);
    expect(holes.isGrammarWord('monstrous')).toBe(true);
    const t = [tpl('effect', 'destroy {o:Objs}', { op: 'destroy', what: '$o' }, { id: 'det.d' }), tpl('trigger', 'whenever {e:Event} ,', { on: '$e' }, { id: 'det.t' })];
    const unit = (): ChartResult => chart.parseUnit({ tokens: holes.lex('destroy target creature alone monstrous'), templates: t, env: ENV, goal: 'effect' });
    const before = unit();
    chart.parseUnit({ tokens: holes.lex('whenever ~ attacks alone ,'), templates: t, env: ENV, goal: 'trigger' });
    const after = unit();
    expect(before.status).toBe('fail');
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    if (before.status === 'fail') expect(before.unknownWords).toEqual([]);
  });
  it('every literal phrase of the hole grammars is a known word, and the generated list is current', () => {
    const dir = join(HERE, '../../../src/parser/holes');
    const words = new Set<string>();
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts') || f === 'grammar-words.ts') continue;
      const src = readFileSync(join(dir, f), 'utf8');
      for (const m of src.matchAll(/\bP\(\s*(['"])((?:\\.|(?!\1).)*)\1\s*\)/g)) for (const w of m[2]!.toLowerCase().split(/\s+/)) if (w !== '') words.add(w);
    }
    for (const w of words) expect(isGrammarWord(w), `grammar word "${w}"`).toBe(true);
    const file = join(dir, 'grammar-words.ts');
    const sorted = [...words].sort();
    if (process.env['OPENMTG_UPDATE_GRAMMAR_WORDS'] === '1') {
      const q = (w: string): string => (w.includes("'") ? JSON.stringify(w) : `'${w}'`);
      const lines: string[] = [];
      let line = '  ';
      for (const w of sorted) {
        const piece = `${q(w)}, `;
        if ((line + piece).length > 150) { lines.push(line.trimEnd()); line = '  '; }
        line += piece;
      }
      lines.push(line.trimEnd());
      const head = readFileSync(file, 'utf8').split('export const GRAMMAR_WORD_LIST')[0]!;
      writeFileSync(file, `${head}export const GRAMMAR_WORD_LIST: readonly string[] = [\n${lines.join('\n')}\n];\n`);
    }
    const body = readFileSync(file, 'utf8').split('export const GRAMMAR_WORD_LIST')[1]!;
    const listed = [...body.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]!);
    expect(listed, 'grammar-words.ts is stale: run the tests with OPENMTG_UPDATE_GRAMMAR_WORDS=1').toEqual(sorted);
  });
  it('P does not register anything after the set is fixed', () => {
    P('zzzunseenword');
    expect(isGrammarWord('zzzunseenword')).toBe(false);
  });
});

describe('review: built values are immutable and share nothing (the lowering passes are pure)', () => {
  it('the same hole used twice in a build gives two separate frozen objects', () => {
    const t = [tpl('effect', 'destroy {o:Objs}', { op: 'destroy', what: '$o', again: '$o' }, { id: 'fz' })];
    const v = ok(run('effect', 'destroy target creature', t)).derivation.value as { what: Record<string, unknown>; again: Record<string, unknown> }[];
    expect(v[0]!.what).toEqual(v[0]!.again);
    expect(v[0]!.what).not.toBe(v[0]!.again);
    expect(Object.isFrozen(v[0])).toBe(true);
    expect(Object.isFrozen(v[0]!.what)).toBe(true);
    expect(() => { v[0]!.what['x'] = 1; }).toThrow();
  });
});

describe('review: the compiled grammar follows the template array and results report the items used', () => {
  it('a template pushed onto an array that was already used is seen', () => {
    const arr: Template[] = [tpl('effect', 'destroy {o:Objs}', { op: 'destroy', what: '$o' }, { id: 'c.d' })];
    expect(run('effect', 'exile target creature', arr).status).toBe('fail');
    arr.push(tpl('effect', 'exile {o:Objs}', { op: 'exile', what: '$o' }, { id: 'c.e' }));
    expect(run('effect', 'exile target creature', arr).status).toBe('ok');
  });
  it('every status reports `items`, and `budget` reports what was used (more than the limit), not the limit', () => {
    const t = [tpl('effect', 'destroy {o:Objs}', { op: 'destroy', what: '$o' }, { id: 'i.d' })];
    const good = ok(run('effect', 'destroy target creature', t));
    expect(good.items).toBeGreaterThan(0);
    const bad = run('effect', 'destroy target flurb', t);
    expect(bad.status).toBe('fail');
    expect((bad as { items: number }).items).toBeGreaterThan(0);
    const b = run('effect', 'destroy target creature, then destroy target creature, then destroy target creature', t, { budget: 5 });
    expect(b.status).toBe('budget');
    if (b.status === 'budget') expect(b.items).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------
// event.ts
// ---------------------------------------------------------------------------

describe('review: step events keep the player (CR 500, 603.2)', () => {
  const step = (whose: unknown, s: string): unknown => [{ ev: 'step', step: s, ...(whose !== undefined ? { whose } : {}) }];
  it.each([
    ["the beginning of that player's upkeep", one('Player', 'that player'), 'upkeep'],
    ["the beginning of its controller's upkeep", one('Player', 'its controller'), 'upkeep'],
    ["the beginning of the chosen player's upkeep", one('Player', 'the chosen player'), 'upkeep'],
    ["the beginning of target player's upkeep", one('Player', 'target player'), 'upkeep'],
    ["the beginning of defending player's upkeep", one('Player', 'defending player'), 'upkeep'],
    ["the beginning of each other player's draw step", { ref: 'each', who: 'otherPlayer' }, 'draw'],
  ])('"%s"', (text, whose, stepName) => {
    expect(one('Event', text)).toEqual(step(whose, stepName));
  });
  it('a possessor that is not understood gives no parse, never a pattern for every upkeep', () => {
    for (const a of full('Event', "the beginning of enchanted creature's controller's upkeep")) expect(JSON.stringify(a.value)).toContain('whose');
  });
  it('the forms with a plain word keep it: your, each opponent, an opponent, and each player means any', () => {
    expect(one('Event', 'the beginning of your upkeep')).toEqual(step('you', 'upkeep'));
    expect(one('Event', "the beginning of each opponent's upkeep")).toEqual(step('opponent', 'upkeep'));
    expect(one('Event', "the beginning of an opponent's upkeep")).toEqual(step('opponent', 'upkeep'));
    expect(one('Event', "the beginning of each player's upkeep")).toEqual(step(undefined, 'upkeep'));
  });
  it('no two different possessors share a pattern (synonyms excepted)', () => {
    const texts = ['each upkeep', "each player's upkeep", "the chosen player's upkeep", "that player's upkeep", "target player's upkeep", "each other player's upkeep", 'your upkeep', "each opponent's upkeep", "defending player's upkeep"];
    const byJson = new Map<string, string[]>();
    for (const t of texts) {
      const k = JSON.stringify(one('Event', `the beginning of ${t}`));
      byJson.set(k, [...(byJson.get(k) ?? []), t]);
    }
    const shared = [...byJson.values()].filter((g) => g.length > 1);
    expect(shared).toEqual([['each upkeep', "each player's upkeep"]]);
  });
});

describe('review: "main phase" without first or second means both main phases (CR 505.1)', () => {
  it('is two patterns, precombat and postcombat', () => {
    expect(one('Event', 'the beginning of your main phase')).toEqual([{ ev: 'step', step: 'main1', whose: 'you' }, { ev: 'step', step: 'main2', whose: 'you' }]);
    expect(one('Event', 'the beginning of each main phase')).toEqual([{ ev: 'step', step: 'main1' }, { ev: 'step', step: 'main2' }]);
    expect(one('Event', 'the beginning of your first main phase')).toEqual([{ ev: 'step', step: 'main1', whose: 'you' }]);
    // FAST5X E17 (CR 505.1b): the second main phase is the main phase numbered 2 in its turn, not every postcombat main phase (CR 505.1a)
    expect(one('Event', 'the beginning of your second main phase')).toEqual([{ ev: 'step', step: 'main2', whose: 'you', nth: 2 }]);
  });
});

describe('review: "put into your graveyard" is limited to cards you own (CR 400.3)', () => {
  it.each([
    ['a creature is put into your graveyard from the battlefield', { ...creature, owner: 'you' }, 'battlefield'],
    ['a creature is put into a graveyard from the battlefield', creature, 'battlefield'],
    ['a creature is put into an opponent\'s graveyard from the battlefield', { ...creature, owner: 'opponent' }, 'battlefield'],
    ['~ is put into your graveyard from the battlefield', { self: true, owner: 'you' }, 'battlefield'],
    ['a nontoken creature is put into your graveyard from the battlefield', { ...creature, token: false, owner: 'you' }, 'battlefield'],
    ['a land card is put into your graveyard from anywhere', { types: ['Land'], isCard: true, owner: 'you' }, undefined],
  ])('"%s"', (text, subject, from) => {
    expect(one('Event', text)).toEqual([{ ev: 'zoneChange', subject, ...(from ? { from } : {}), to: 'graveyard' }]);
  });
  it('"your graveyard", "a graveyard" and "dies" are three different patterns', () => {
    const a = JSON.stringify(one('Event', 'a creature is put into your graveyard from the battlefield'));
    const b = JSON.stringify(one('Event', 'a creature is put into a graveyard from the battlefield'));
    const c = JSON.stringify(one('Event', 'a creature dies'));
    expect(new Set([a, b, c]).size).toBe(2); // b and c are the same meaning (CR 700.4), a is narrower
    expect(a).not.toBe(b);
  });
});

describe('review: "cast ... from <zone>" has exactly one reading (CR 601.2, 305.1)', () => {
  it.each([
    ['you cast a spell from exile', [{ ev: 'cast', player: 'you', from: 'exile' }]],
    ['you cast a spell from your hand', [{ ev: 'cast', player: 'you', from: 'hand' }]],
    // std-rp (CR 400.3, 601.2a): "from your graveyard" of your own cast is a spell you own (a graveyard is its owner's)
    ['you cast a creature spell from your graveyard', [{ ev: 'cast', player: 'you', spell: { ...creature, owner: 'you' }, from: 'graveyard' }]],
    ['an opponent casts a spell from their hand', [{ ev: 'cast', player: 'opponent', from: 'hand' }]],
    ['a player casts a spell from a graveyard', [{ ev: 'cast', player: 'any', from: 'graveyard' }]],
    ['you cast a spell', [{ ev: 'cast', player: 'you' }]],
  ])('"%s"', (text, expected) => {
    expect(full('Event', text).map((a) => a.value)).toEqual([expected]);
  });
  it('a zone owner the pattern cannot say is not dropped: another player\'s zone is no parse', () => {
    expect(rejects('Event', 'an opponent casts a spell from your graveyard')).toBe(true);
    expect(rejects('Event', "you cast a spell from an opponent's graveyard")).toBe(true);
  });
});

describe('review: attack events (CR 508.1) and longest phrase first', () => {
  it('anyPhraseAt takes the longest phrase that matches', () => {
    const ctx = makeHoleCtx(toks('a card each turn'), ENV);
    expect(anyPhraseAt(ctx, 0, [P('a card'), P('a card each turn')])).toBe(4);
    expect(anyPhraseAt(ctx, 0, [P('a card each turn'), P('a card')])).toBe(4);
  });
  it.each([
    ['a creature attacks you', 'you'],
    ['a creature attacks a player', 'any'],
    ['a creature attacks an opponent', 'opponent'],
    ['a creature attacks a planeswalker', 'planeswalker'],
    ['a creature attacks a battle', 'battle'],
  ])('"%s"', (text, defender) => {
    expect(one('Event', text)).toEqual([{ ev: 'attacks', attacker: creature, defender }]);
  });
  // M12-3: the model says it now (`orPlaneswalker`, CR 506.3, 508.1b); it is never narrowed to "you"
  it('"you or a planeswalker you control" is `defender: you` with `orPlaneswalker`, never narrowed to "you"', () => {
    expect(one('Event', 'a creature attacks you or a planeswalker you control')).toEqual([{ ev: 'attacks', attacker: creature, defender: 'you', orPlaneswalker: true }]);
  });
});

// ---------------------------------------------------------------------------
// target.ts, vocab.ts, filter.ts, core.ts, zone.ts, qty.ts, cost.ts, token.ts
// ---------------------------------------------------------------------------

describe('review: "each of ..." before "target" (analysis 8.2 rows 9, 14, 16, 18, 19, 22, 23; CR 601.2c)', () => {
  const t = (text: string, min: unknown, max: unknown, extra: Record<string, unknown> = {}): unknown => target({ kind: 'object', filter: creature, min, max, text, ...extra });
  it.each([
    ['each of up to two target creatures', 0, 2, {}],
    ['each of up to X target creatures', 0, { q: 'X' }, {}],
    ['each of up to two other target creatures', 0, 2, { another: true }],
    ['each of any number of target creatures', 0, 'any', {}],
    ['each of up to three target creatures', 0, 3, {}],
    ['each of two target creatures', 2, 2, {}],
    ['each of up to one target creature', 0, 1, {}],
  ] as [string, unknown, unknown, Record<string, unknown>][])('"%s"', (phrase, min, max, extra) => {
    const alts = full('Objs', phrase);
    expect(alts).toHaveLength(1);
    expect(alts[0]!.value).toEqual(t(phrase, min, max, extra));
    expect(alts[0]!.flags).toContain('each-of');
  });
  it('players too, and a bare "each of target creature" is nonsense', () => {
    expect(full('Player', 'each of up to two target players')[0]!.flags).toContain('each-of');
    expect(rejects('Objs', 'each of target creature')).toBe(true);
    expect(rejects('Objs', 'each of two target creature')).toBe(true);
  });
});

describe('review: subtypes whose plural is the singular (Eldrazi, Merfolk, Plains; CR 205.3)', () => {
  it.each([
    ['two target Eldrazi', target({ kind: 'object', filter: { subtypes: ['Eldrazi'] }, min: 2, max: 2, text: 'two target Eldrazi' })],
    ['up to two target Merfolk', target({ kind: 'object', filter: { subtypes: ['Merfolk'] }, min: 0, max: 2, text: 'up to two target Merfolk' })],
    ['target Eldrazi', target({ kind: 'object', filter: { subtypes: ['Eldrazi'] }, min: 1, max: 1, text: 'target Eldrazi' })],
    ['all Eldrazi', { ref: 'each', filter: { subtypes: ['Eldrazi'] } }],
    ['all Plains', { ref: 'each', filter: { subtypes: ['Plains'] } }],
    ['Eldrazi you control', { ref: 'each', filter: { subtypes: ['Eldrazi'], controller: 'you' } }],
    ['each Merfolk you control', { ref: 'each', filter: { subtypes: ['Merfolk'], controller: 'you' } }],
  ])('Objs "%s"', (text, expected) => {
    expect(one('Objs', text)).toEqual(expected);
  });
  it('protection from such a type', () => {
    expect(one('Keyword', 'protection from Merfolk')).toMatchObject({ keyword: 'protection', quality: 'subtype:merfolk' });
  });
});

describe('review: a list of types with an Oxford "and"', () => {
  it('Filter and Objs accept ", and"', () => {
    expect(one('Filter', 'artifact, creature, and enchantment')).toEqual({ types: ['Artifact', 'Creature', 'Enchantment'] });
    expect(one('Filter', 'artifact, creature, or enchantment')).toEqual({ types: ['Artifact', 'Creature', 'Enchantment'] });
    expect(one('Filter', 'artifact, creature and enchantment')).toEqual({ types: ['Artifact', 'Creature', 'Enchantment'] });
    expect(one('Objs', 'all artifacts, creatures, and enchantments')).toEqual({ ref: 'each', filter: { types: ['Artifact', 'Creature', 'Enchantment'] } });
    expect(one('Objs', 'each artifact, creature, and enchantment')).toEqual({ ref: 'each', filter: { types: ['Artifact', 'Creature', 'Enchantment'] } });
  });
});

describe('review: "your opponents control" is the plain word "opponent" (CR 109.4; model 3.3)', () => {
  it.each([
    ['creature your opponents control', { ...creature, controller: 'opponent' }],
    ['creature each opponent controls', { ...creature, controller: 'opponent' }],
    ['creature an opponent controls', { ...creature, controller: 'opponent' }],
    ['creature each player controls', { ...creature, controller: 'any' }],
    ["creature your opponents don't control", { ...creature, not: { controller: 'opponent' } }],
    ['creature your opponents own', { ...creature, owner: 'opponent' }],
  ])('Filter "%s"', (text, expected) => {
    expect(one('Filter', text)).toEqual(expected);
  });
  it('zones: "your opponents\' graveyards" is owner "opponent"', () => {
    expect(one('Zone', "your opponents' graveyards")).toEqual({ zone: 'graveyard', owner: 'opponent' });
  });
  it('a player the model has no plain word for stays a reference', () => {
    expect(one('Filter', 'creature each other player controls')).toEqual({ ...creature, controller: { ref: 'each', who: 'otherPlayer' } });
  });
});

describe('review: Lib is also a library reference (candidate grammar: "search {lib:Lib}", "of {lib:Lib}")', () => {
  it('"your library", "target player\'s library", "its owner\'s library" have no position', () => {
    expect(one('Lib', 'your library')).toEqual({ zone: 'library', owner: { ref: 'you' } });
    expect(one('Lib', "target player's library")).toMatchObject({ zone: 'library', owner: { ref: 'target' } });
    expect(one('Lib', "its owner's library")).toMatchObject({ zone: 'library', owner: { ref: 'ownerOf' } });
  });
  it('the destination forms keep their position', () => {
    expect(one('Lib', 'on top of your library')).toEqual({ zone: 'library', owner: { ref: 'you' }, position: 'top' });
    expect(one('Lib', "on the bottom of its owner's library")).toMatchObject({ zone: 'library', position: 'bottom' });
  });
});

describe('review: predefined tokens come from the lexicon (CR 111.10)', () => {
  const lexWith = (names: string[]): typeof ENV => ({ ...ENV, lexicon: { ...LEXICON, predefinedTokens: names.map((name) => ({ name, rule: '111.10' })) }, keywords: KEYWORDS });
  it('a token the lexicon does not list is no parse; one it lists is', () => {
    expect(rejects('TokenDesc', 'Walker token')).toBe(true);
    expect(one('TokenDesc', 'Walker token', lexWith(['Walker']))).toEqual({ predefined: 'Walker' });
    expect(one('TokenDesc', 'Lander tokens', lexWith(['Lander']))).toEqual({ predefined: 'Lander' });
  });
  it('"Role" alone is not a token name; "Monster Role" is, when the lexicon has it', () => {
    expect(rejects('TokenDesc', 'Role token', lexWith(['Monster Role']))).toBe(true);
    expect(one('TokenDesc', 'Monster Role token', lexWith(['Monster Role']))).toEqual({ predefined: 'Monster Role' });
  });
  it('the CR sets that cannot change stay built in: types, supertypes and colors', () => {
    expect(one('Filter', 'legendary white creature')).toEqual({ ...creature, supertypes: ['Legendary'], colors: ['W'] });
  });
});

describe('review: quantities the evaluator cannot compute are no parse (model 4 "Quantities")', () => {
  it.each([
    "each opponent's life total",
  ])('Qty "%s"', (text) => {
    expect(rejects('Qty', text)).toBe(true);
  });
  // FAST5X E15 (MX18): the model has the maximum / minimum of a set now (`agg`), so these parse (CR 208.1)
  it('the greatest / highest value among a set is the stat quantity with agg max', () => {
    expect(one('Qty', 'the greatest power among creatures you control')).toEqual({ q: 'stat', stat: 'power', of: { ref: 'each', filter: { ...creature, controller: 'you' } }, agg: 'max' });
    expect(one('Qty', 'the highest toughness among creatures you control')).toEqual({ q: 'stat', stat: 'toughness', of: { ref: 'each', filter: { ...creature, controller: 'you' } }, agg: 'max' });
  });
  it('the sum and one player\'s life total still parse', () => {
    expect(one('Qty', 'the total power of creatures you control')).toEqual({ q: 'stat', stat: 'power', of: { ref: 'each', filter: { ...creature, controller: 'you' } }, sum: true });
    expect(one('Qty', 'your life total')).toEqual({ q: 'life', of: { ref: 'you' } });
    expect(full('Qty', "target player's life total")).toHaveLength(1);
  });
  it('cards in your opponents\' hands is a count of the matching cards, not a hand size of "each opponent"', () => {
    expect(one('Qty', "the number of cards in your opponents' hands")).toEqual({ q: 'count', of: { ref: 'each', filter: { isCard: true, zone: 'hand', owner: 'opponent' } } });
  });
});

describe('review: costs keep the owner of the zone they exile from (CR 118, 400.3)', () => {
  it('"from a graveyard" cannot be said by the cost part, "from your graveyard" can', () => {
    expect(rejects('Cost', 'exile a creature card from a graveyard')).toBe(true);
    expect(one('Cost', 'exile a creature card from your graveyard')).toEqual({ other: [{ kind: 'exileFrom', zone: 'graveyard', count: 1, filter: creature }] });
  });
});

// ---------------------------------------------------------------------------
// tok.ts: tokens of the real tokenizer (WP5) through adaptTokens
// ---------------------------------------------------------------------------

describe('review: adaptTokens bridges the tokenizer of WP5 (non-prefix, signed pairs, loyalty numbers)', () => {
  const W = (text: string, range: [number, number], extra: Record<string, unknown> = {}): RawTok => ({ kind: 'WORD', text, norm: text.toLowerCase(), range, ...extra } as RawTok);
  const parse = (type: Parameters<typeof runHole>[0], raw: RawTok[]): unknown[] => {
    const t = adaptTokens(raw);
    return runHole(type, t, 0, ENV).filter((a) => a.end === t.length).map((a) => a.value);
  };
  it('"nonland" arrives as non + land (both split) and is one word again', () => {
    const raw = [W('target', [0, 6]), W('non', [7, 10], { split: true }), W('land', [10, 14], { split: true }), W('permanent', [15, 24])];
    expect(parse('Objs', raw)).toEqual([target({ kind: 'object', filter: { notTypes: ['Land'] }, min: 1, max: 1, text: 'target nonland permanent' })]);
  });
  it('"non-Human" arrives as non- + Human', () => {
    const raw = [W('target', [0, 6]), W('non-', [7, 11], { split: true, norm: 'non' }), W('Human', [11, 16], { split: true, cap: true }), W('creature', [17, 25])];
    expect(parse('Objs', raw)).toEqual([target({ kind: 'object', filter: { ...creature, notSubtypes: ['Human'] }, min: 1, max: 1, text: 'target non-Human creature' })]);
  });
  it('+2/+2 arrives as MOD and is a power/toughness modification; 1/1 stays a PT', () => {
    expect(parse('PT', [{ kind: 'MOD', text: '+2/+2', norm: '+2/+2', range: [0, 5] } as RawTok])).toEqual([{ p: 2, t: 2 }]);
    expect(parse('PT', [{ kind: 'MOD', text: '-1/-1', norm: '-1/-1', range: [0, 5] } as RawTok])).toEqual([{ p: -1, t: -1 }]);
  });
  it('a +1/+1 counter phrase works with the MOD token', () => {
    const raw = [W('creature', [0, 8]), W('with', [9, 13]), W('a', [14, 15]), { kind: 'MOD', text: '+1/+1', norm: '+1/+1', range: [16, 21] } as RawTok, W('counter', [22, 29]), W('on', [30, 32]), W('it', [33, 35])];
    expect(parse('Filter', raw)).toEqual([{ ...creature, counters: { kind: '+1/+1' } }]);
  });
  it('a loyalty cost "+1" arrives as PUNCT + NUM with touching ranges and becomes one MOD token', () => {
    const raw: RawTok[] = [{ kind: 'PUNCT', text: '+', norm: '+', range: [0, 1] } as RawTok, { kind: 'NUM', text: '1', norm: '1', range: [1, 2] } as RawTok];
    const t = adaptTokens(raw);
    expect(t.map((x) => [x.kind, x.norm])).toEqual([['MOD', '+1']]);
    expect(parse('Cost', raw)).toEqual([{ loyalty: 1 }]);
    // not touching: two tokens, as written
    const apart = adaptTokens([{ kind: 'PUNCT', text: '+', norm: '+', range: [0, 1] } as RawTok, { kind: 'NUM', text: '1', norm: '1', range: [3, 4] } as RawTok]);
    expect(apart.map((x) => x.kind)).toEqual(['PUNCT', 'NUM']);
  });
  it('a lone "non" that is not split off a word stays a word', () => {
    const t = adaptTokens([W('non', [0, 3]), W('land', [4, 8])]);
    expect(t.map((x) => x.norm)).toEqual(['non', 'land']);
  });
  it.skipIf(typeof realTokenize !== 'function')('integration with the real tokenizer (runs once WP5 is merged)', () => {
    const tokenize = realTokenize as (text: string) => RawTok[];
    for (const [type, text] of [['Objs', 'target nonland permanent'], ['Objs', 'target non-Human creature'], ['Objs', 'target nonblack creature'], ['PT', '+2/+2'], ['Filter', 'creature with a +1/+1 counter on it']] as const) {
      const t = adaptTokens(tokenize(text));
      expect(runHole(type, t, 0, ENV).some((a) => a.end === t.length), `${type} "${text}"`).toBe(true);
    }
  });
});

describe('review: no debugging scripts in the test folder', () => {
  it('has only tests and shared helpers', () => {
    const files = readdirSync(HERE);
    expect(files.filter((f) => f.includes('scratch') || f.endsWith('.run.ts'))).toEqual([]);
    expect(existsSync(join(HERE, 'scratch.run.ts'))).toBe(false);
  });
});
