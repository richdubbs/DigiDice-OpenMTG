/**
 * WP6: the Earley chart parser (design 6.3). Rules cited: CR 118.12a ("unless pays"), 603.2 (triggers), 608.2c (instructions in order), 614.15 (self-replacement),
 * 115.1 (targets). Guards: G1 (whole units), G2 (closed vocabulary), G5 (ambiguity is failure).
 */
import { describe, expect, it } from 'vitest';
import type { ChartInput, ChartResult } from '../../../src/parser/chart';
import { chartInputFrom, compileTemplates, instantiate, parsePattern, parseUnit, validateTemplates } from '../../../src/parser/chart';
import type { Template, TemplateKind } from '../../../src/parser/types';
import { findMarkers } from '../../../src/parser/holes';
import { ENV, toks } from './env';

let seq = 0;
function tpl(kind: TemplateKind, pattern: string, build: unknown, extra: Partial<Template> = {}): Template {
  return { id: extra.id ?? `t${++seq}`, kind, cr: ['CR 608.2c'], pattern, build, examples: [{ text: 'x' }], counterExamples: ['a', 'b'], status: 'stable', since: 1, ...extra };
}
const run = (goal: ChartInput['goal'], text: string, templates: Template[], extra: Partial<ChartInput> = {}): ChartResult => parseUnit({ tokens: toks(text), templates, env: ENV, goal, ...extra });
const ok = (r: ChartResult): Extract<ChartResult, { status: 'ok' }> => { if (r.status !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r).slice(0, 600)}`); return r; };
const value = (goal: ChartInput['goal'], text: string, templates: Template[]): unknown => ok(run(goal, text, templates)).derivation.value;

/** The twelve seed templates of design 6.3, abridged, plus the imperative forms the spells below need. */
const SEED: Template[] = [
  tpl('effect', '{src:Obj} deal[s] {n:Qty} damage to {to:Recipient}', { op: 'damage', source: '$src', to: '$to', amount: '$n' }, { id: 'eff.damage' }),
  tpl('effect', 'destroy {o:Objs}', { op: 'destroy', what: '$o' }, { id: 'eff.destroy' }),
  tpl('effect', '{p:Player} draw[s] {n:Qty} card[s]', { op: 'draw', who: '$p', count: '$n' }, { id: 'eff.draw' }),
  tpl('effect', 'draw {n:Qty} card[s]', { op: 'draw', who: { ref: 'you' }, count: '$n' }, { id: 'eff.draw.you' }),
  tpl('effect', 'create {n:Qty} {t:TokenDesc}', { op: 'createToken', who: { ref: 'you' }, token: '$t', count: '$n' }, { id: 'eff.token' }),
  tpl('effect', '{o:Obj} get[s] {pt:PT} {d:Dur}', { op: 'effect', duration: '$d', effects: [{ s: 'continuous', affects: '$o', mods: [{ layer: '7c', power: '$pt.p', toughness: '$pt.t' }] }] }, { id: 'eff.pump' }),
  tpl('effect', 'counter {o:Obj}', { op: 'counter', what: '$o' }, { id: 'eff.counter' }),
  tpl('effect', '{e:Effects} unless {p:Player} pay[s] {c:Cost}', { op: 'pay', who: '$p', cost: '$c', else: '$e' }, { id: 'wrap.payelse', consumes: ['unless'] }),
  tpl('rider', '( they | it ) can\'t be regenerated', { $patchPrevious: { regeneration: 'cant' } }, { id: 'rid.noregen', consumes: ["can't"] }),
  tpl('trigger', '(when|whenever) {e:Event} ,', { on: '$e' }, { id: 'trg.any' }),
  tpl('static', '{f:Filter} you control get[s] {pt:PT}', { s: 'continuous', affects: { ref: 'each', filter: { '$when': 'f', then: '$f' } }, mods: [{ layer: '7c', power: '$pt.p', toughness: '$pt.t' }] }, { id: 'sta.anthem' }),
  tpl('cost', 'sacrifice {o:Filter}', { kind: 'sacrifice', filter: '$o', count: 1 }, { id: 'cost.sac' }),
];

describe('WP6 pattern language (design 6.3)', () => {
  it('compiles words, holes, optional groups, alternatives, agreement suffixes, punctuation and the object', () => {
    const c = compileTemplates([tpl('effect', '^ [you may] ( tap | untap ) ~ , then draw[s] {n:Qty} card[es] :', { x: '$n' }, { id: 'p1' })]);
    expect(c.errors).toEqual([]);
    // 2 (optional) x 2 (alternatives) productions plus the 8 of the Effects nonterminal
    expect(c.prods.filter((p) => p.tpl?.id === 'p1')).toHaveLength(4);
  });
  it('reports malformed templates (unknown hole type, unbalanced groups, a build that names a missing hole) without throwing', () => {
    const bad = [
      tpl('effect', 'destroy {o:Nope}', {}, { id: 'bad1' }), tpl('effect', 'destroy (a | b', {}, { id: 'bad2' }), tpl('effect', 'destroy {o:Objs}', { x: '$zzz' }, { id: 'bad3' }),
      tpl('effect', 'destroy {o:Objs} {o:Objs}', {}, { id: 'bad4' }), tpl('effect', 'destroy {o:Objs}', { $oops: 1 }, { id: 'bad5' }), tpl('effect', '', {}, { id: 'bad6' }),
    ];
    const errors = compileTemplates(bad).errors;
    expect(errors.map((e) => e.id).sort()).toEqual(['bad1', 'bad2', 'bad3', 'bad4', 'bad5', 'bad6']);
    // parsing with them is just a failure, never an exception
    expect(run('effect', 'destroy target creature', bad).status).toBe('fail');
  });
  it('parsePattern reads [s] and [es] as optional endings', () => {
    expect(parsePattern('enter[s] catch[es]')).toEqual([{ t: 'lit', alts: ['enter', 'enters'] }, { t: 'lit', alts: ['catch', 'catches'] }]);
  });
  it('validateTemplates also checks rule citations, examples and counter examples', () => {
    const t = { ...tpl('effect', 'destroy {o:Objs}', {}, { id: 'v1' }), cr: [], counterExamples: [] };
    expect(validateTemplates([t]).map((e) => e.message).join('|')).toMatch(/cite at least one rule/);
    expect(validateTemplates([tpl('effect', 'destroy {o:Objs}', {}, { id: 'dup' }), tpl('effect', 'destroy {o:Objs}', {}, { id: 'dup' })]).some((e) => /duplicate/.test(e.message))).toBe(true);
  });
});

describe('WP6 build language: $hole, $hole.path, $when, $patchPrevious', () => {
  const caps = { a: 3, b: { c: { d: 'deep' } }, z: undefined };
  it('substitutes whole strings only and drops members whose hole is missing', () => {
    expect(instantiate({ x: '$a', y: '$b.c.d', lit: 'plain', w: '$nope', arr: ['$a', '$nope'] }, caps)).toEqual({ x: 3, y: 'deep', lit: 'plain', arr: [3] });
  });
  it('$when chooses by presence of an optional hole', () => {
    expect(instantiate({ $when: 'a', then: { has: true }, else: { has: false } }, caps)).toEqual({ has: true });
    expect(instantiate({ $when: 'nope', then: { has: true }, else: { has: false } }, caps)).toEqual({ has: false });
    expect(instantiate({ k: { $when: 'nope', then: 1 } }, caps)).toEqual({});
  });
  it('$patchPrevious stays a marker for the riders pass (design 6.5 pass 4)', () => {
    expect(instantiate({ $patchPrevious: { regeneration: 'cant', n: '$a' } }, caps)).toEqual({ $patchPrevious: { regeneration: 'cant', n: 3 } });
  });
  it('optional groups: the optional hole is absent from the captures when the group is skipped', () => {
    const t = [tpl('effect', 'draw {n:Qty} card[s] [{d:Dur}]', { op: 'draw', count: '$n', until: '$d' }, { id: 'opt' })];
    expect(value('effect', 'draw two cards', t)).toEqual([{ op: 'draw', count: 2 }]);
    expect(value('effect', 'draw two cards until end of turn', t)).toEqual([{ op: 'draw', count: 2, until: { d: 'endOfTurn' } }]);
  });
});

describe('WP6 whole units (G1) and the end-to-end shape of real spells (design 13.1)', () => {
  it('Lightning Bolt: damage to any target', () => {
    const v = value('effect', '~ deals 3 damage to any target', SEED) as { op: string; source: unknown; amount: number; to: unknown }[];
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ op: 'damage', source: { ref: 'self' }, amount: 3 });
    expect(findMarkers(v).map((m) => m.kind)).toEqual(['target']);
    expect(findMarkers(v).map((m) => (m.value as { kind: string }).kind)).toEqual(['anyTarget']);
  });
  it('Doom Blade: destroy target nonblack creature', () => {
    const v = value('effect', 'Destroy target nonblack creature.', SEED) as { what: { $target: { filter: unknown } } }[];
    expect(v[0]!.what.$target.filter).toEqual({ types: ['Creature'], notColors: ['B'] });
  });
  it('Giant Growth: target creature gets +3/+3 until end of turn', () => {
    const v = value('effect', 'Target creature gets +3/+3 until end of turn', SEED) as { op: string; duration: unknown; effects: { mods: unknown[] }[] }[];
    expect(v[0]!.op).toBe('effect');
    expect(v[0]!.duration).toEqual({ d: 'endOfTurn' });
    expect(v[0]!.effects[0]!.mods).toEqual([{ layer: '7c', power: 3, toughness: 3 }]);
  });
  it('Mana Leak: "X unless its controller pays {3}" nests the effect inside the pay step (CR 118.12a)', () => {
    const v = value('effect', "Counter target spell unless its controller pays {3}", SEED) as { op: string; who: { ref: string }; else: { op: string }[]; cost: unknown }[];
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ op: 'pay', who: { ref: 'controllerOf' }, cost: { mana: [{ kind: 'generic', amount: 3 }] } });
    expect(v[0]!.else[0]!.op).toBe('counter');
  });
  it('Raise the Alarm: create two tokens', () => {
    const v = value('effect', 'Create two 1/1 white Soldier creature tokens', SEED) as { op: string; count: number; token: { subtypes: string[] } }[];
    expect(v[0]).toMatchObject({ op: 'createToken', count: 2, token: { subtypes: ['Soldier'] } });
  });
  it('a trigger clause through the Event hole; the comma belongs to the template and the effect is parsed separately', () => {
    const r = ok(run('trigger', 'Whenever a creature you control dies,', SEED));
    expect(r.derivation.value).toEqual({ on: [{ ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you' }, from: 'battlefield', to: 'graveyard' }] });
  });
  it('a static ability: an anthem', () => {
    expect(ok(run('static', 'Elves you control get +1/+1', SEED)).derivation.value).toMatchObject({ s: 'continuous', affects: { ref: 'each', filter: { subtypes: ['Elf'] } } });
  });
  it('a cost template', () => {
    expect(ok(run('cost', 'sacrifice a creature', SEED)).derivation.value).toEqual({ kind: 'sacrifice', filter: { types: ['Creature'] }, count: 1 });
  });
  it('G1: "Destroy target creature unless it is blue." never parses as "Destroy target creature."', () => {
    const r = run('effect', 'Destroy target creature unless it is blue', SEED);
    expect(r.status).toBe('fail');
    if (r.status === 'fail') {
      // the parser got past "unless" (the wrapper template wants a player next) and stopped at "it", which is no player
      expect(r.furthest).toMatchObject({ index: 4, token: 'it' });
      expect(r.furthest.expected).toContain('<Player>');
    }
  });
  it('G1: the whole unit must be consumed: trailing words, a missing object and an extra clause all fail', () => {
    for (const bad of ['destroy target creature now', 'destroy', 'destroy target creature draw a card', 'target creature']) expect(run('effect', bad, SEED).status, bad).toBe('fail');
  });
  it('a final period is the sentence mark, not content', () => {
    expect(run('effect', 'destroy target creature.', SEED).status).toBe('ok');
    expect(run('effect', 'destroy target creature.', SEED, { stripFinalPeriod: false }).status).toBe('fail');
  });
});

describe('WP6 Effects: sequences joined by comma, "and", "then" and the sentence mark (CR 608.2c)', () => {
  it.each([
    ['destroy target creature, then draw a card', 2],
    ['destroy target creature and draw a card', 2],
    ['destroy target creature. draw a card', 2],
    ['destroy target creature, draw a card, then draw two cards', 3],
    ['destroy target creature then draw a card', 2],
  ])('"%s" is %i steps in order', (text, n) => {
    const v = value('effect', text, SEED) as { op: string }[];
    expect(v).toHaveLength(n);
    expect(v[0]!.op).toBe('destroy');
    expect(v[1]!.op).toBe('draw');
  });
  it('the scope of a wrapper over a sequence is ambiguous English ("A and B unless C"): two different JSONs, so the unit is manual (G5)', () => {
    const r = run('effect', 'destroy target creature and draw a card unless target opponent pays {2}', SEED);
    expect(r.status).toBe('ambiguous');
    if (r.status === 'ambiguous') {
      const shapes = r.alternatives.map((d) => (d.value as { op: string }[]).map((s) => s.op).join('+')).sort();
      expect(shapes).toEqual(['destroy+pay', 'pay']);
    }
    // one clause: no ambiguity
    expect((value('effect', 'draw a card unless target opponent pays {2}', SEED) as { op: string }[])[0]!.op).toBe('pay');
  });
  it('the same text twice gives the same JSON (determinism)', () => {
    const a = JSON.stringify(value('effect', 'destroy target creature, then draw a card', SEED));
    const b = JSON.stringify(value('effect', 'destroy target creature, then draw a card', SEED));
    expect(a).toBe(b);
  });
  it('rider templates are their own goal; the patch marker survives', () => {
    expect(value('rider', "They can't be regenerated", SEED)).toEqual({ $patchPrevious: { regeneration: 'cant' } });
    expect(value('rider', "It can't be regenerated", SEED)).toEqual({ $patchPrevious: { regeneration: 'cant' } });
  });
});

describe('WP6 ambiguity is failure (G5), identical JSON is harmless, priority ranks', () => {
  const A = (id: string, build: unknown, extra: Partial<Template> = {}): Template => tpl('effect', 'destroy {a:Obj} and {b:Obj}', build, { id, ...extra });
  const base = tpl('effect', 'destroy {o:Objs}', { op: 'destroy', what: '$o' }, { id: 'base' });
  const text = 'destroy target creature and target artifact';

  it('two templates with the same JSON for the same text: one result, the duplicate counted as harmless', () => {
    const same = A('same', { op: 'destroy', what: { ref: 'union', of: ['$a', '$b'] } });
    const r = ok(run('effect', text, [base, same]));
    expect(r.harmless).toBe(1);
    expect((r.derivation.value as { op: string }[])[0]!.op).toBe('destroy');
  });
  it('different JSON at equal priority: ambiguous, with both alternatives listed', () => {
    const other = A('other', { op: 'destroy', what: { ref: 'union', of: ['$b', '$a'] } });
    const r = run('effect', text, [base, other]);
    expect(r.status).toBe('ambiguous');
    if (r.status === 'ambiguous') expect(r.alternatives.map((d) => d.templatesUsed).sort()).toEqual([['base'], ['other']]);
  });
  it('a higher priority wins, and the loser is reported as outranked (the CI check looks for equal-priority conflicts)', () => {
    const other = A('other', { op: 'destroy', what: { ref: 'union', of: ['$b', '$a'] } }, { priority: 5 });
    const r = ok(run('effect', text, [base, other]));
    expect(r.derivation.templatesUsed).toEqual(['other']);
    expect(r.outranked.map((d) => d.templatesUsed)).toEqual([['base']]);
  });
  it('fewer unspecific holes win: a card name (weak) loses to a closed-vocabulary reading', () => {
    // "named" is only a literal word of the first template; the second reads "named Foo" as a name hole
    const t1 = tpl('effect', 'destroy target creature named {n:Name}', { op: 'destroy', name: '$n' }, { id: 'weak' });
    const t2 = tpl('effect', 'destroy target creature named Foo', { op: 'destroy', exact: true }, { id: 'exact' });
    const r = ok(run('effect', 'destroy target creature named Foo', [t1, t2]));
    expect(r.derivation.templatesUsed).toEqual(['exact']);
  });
  it('an ambiguity inside a hole (two readings with different JSON) makes the unit ambiguous', () => {
    // "up to two target creatures" read once; a hole that returns two JSONs for the same tokens is made with a custom template pair
    const t1 = tpl('effect', 'tap {o:Objs}', { op: 'tap', what: '$o' }, { id: 'tap1' });
    const t2 = tpl('effect', 'tap {o:Obj}', { op: 'untap', what: '$o' }, { id: 'tap2' });
    expect(run('effect', 'tap target creature', [t1, t2]).status).toBe('ambiguous');
  });
});

describe('WP6 design examples of ambiguity (6.3 rule 3) and G2 at unit level', () => {
  it('"target artifact or creature you control" has one reading: the post-modifier distributes, so there is nothing to disambiguate', () => {
    const r = ok(run('effect', 'destroy target artifact or creature you control', SEED));
    expect(r.harmless).toBe(0);
    expect(r.outranked).toEqual([]);
    const what = (r.derivation.value as { what: { $target: { filter: unknown } } }[])[0]!.what.$target.filter;
    expect(what).toEqual({ types: ['Artifact', 'Creature'], controller: 'you' });
  });
  it('G2 on whole units: replacing any word of a valid unit by a nonsense word, or inserting one, never leaves an ok parse', () => {
    const units: [ChartInput['goal'], string][] = [
      ['effects', '~ deals 3 damage to any target'], ['effects', 'Destroy target nonblack creature'], ['effects', 'Target creature gets +3/+3 until end of turn'],
      ['effects', 'Counter target spell unless its controller pays {3}'], ['effects', 'Create two 1/1 white Soldier creature tokens'], ['effects', 'destroy target creature, then draw a card'],
      ['trigger', 'Whenever a creature you control dies,'], ['static', 'Elves you control get +1/+1'], ['cost', 'sacrifice a creature'],
    ];
    let checked = 0;
    for (const [goal, text] of units) {
      const base = toks(text);
      expect(run(goal, text, SEED).status, text).toBe('ok');
      for (let i = 0; i < base.length; i++) {
        if (base[i]!.kind !== 'WORD') continue;
        const replaced = base.map((t, k) => (k === i ? { ...t, text: 'zzzblorp', norm: 'zzzblorp' } : t));
        expect(parseUnit({ tokens: replaced, templates: SEED, env: ENV, goal }).status, `${text} [${i}]`).not.toBe('ok');
        const inserted = [...base.slice(0, i), { ...base[i]!, kind: 'WORD' as const, text: 'zzzblorp', norm: 'zzzblorp' }, ...base.slice(i)];
        expect(parseUnit({ tokens: inserted, templates: SEED, env: ENV, goal }).status, `${text} +[${i}]`).not.toBe('ok');
        checked += 2;
      }
    }
    expect(checked).toBeGreaterThan(90);
  });
});

describe('WP6 capabilities, experimental templates, diagnostics, budget', () => {
  it('a template whose needs are missing is skipped; if only it can parse the unit the answer is needs-engine with the missing capabilities', () => {
    const t = tpl('effect', 'destroy {o:Objs}', { op: 'destroy', what: '$o' }, { id: 'needy', needs: ['op:destroy'] });
    const have = new Set<string>(['op:draw']);
    const r = run('effect', 'destroy target creature', [t], { capabilities: have });
    expect(r.status).toBe('needs-engine');
    if (r.status === 'needs-engine') { expect(r.missing).toEqual(['op:destroy']); expect(r.templateIds).toEqual(['needy']); }
    expect(run('effect', 'destroy target creature', [t], { capabilities: new Set(['op:destroy']) }).status).toBe('ok');
    expect(run('effect', 'destroy target creature', [t]).status).toBe('ok');
  });
  it('experimental templates are reported (they cap the card at partial)', () => {
    const t = tpl('effect', 'destroy {o:Objs}', { op: 'destroy', what: '$o' }, { id: 'exp', status: 'experimental' });
    expect(ok(run('effect', 'destroy target creature', [t])).derivation.experimental).toEqual(['exp']);
  });
  it('the derivation tree says which template and which holes covered which tokens (guard G3 and the lowering passes read it)', () => {
    const r = ok(run('effect', 'destroy target creature, then draw a card', SEED));
    const tree = r.derivation.tree;
    expect(tree.start).toBe(0);
    expect(tree.end).toBe(8);
    const flat: string[] = [];
    const walk = (u: typeof tree): void => { if (u.template) flat.push(`${u.template.id}:${u.start}-${u.end}:${u.holes.map((h) => `${h.name}=${h.type}@${h.start}-${h.end}`).join(',')}`); u.children.forEach(walk); };
    walk(tree);
    expect(flat).toEqual(['eff.destroy:0-3:o=Objs@1-3', 'eff.draw.you:5-8:n=Qty@6-7']);
  });
  it('furthest and expected tell the repair prompt where it stopped and what would have been accepted', () => {
    const r = run('effect', 'destroy target', SEED);
    expect(r.status).toBe('fail');
    if (r.status === 'fail') { expect(r.furthest.index).toBeGreaterThanOrEqual(1); expect(r.furthest.expected.some((e) => e.startsWith('<'))).toBe(true); }
    const r2 = run('effect', 'zzzblorp target creature', SEED);
    if (r2.status !== 'fail') throw new Error('fail expected');
    expect(r2.furthest).toMatchObject({ index: 0, token: 'zzzblorp' });
    expect(r2.furthest.expected).toContain('destroy');
  });
  it('G2: unknown words are listed, known words in the wrong place are not', () => {
    const r = run('effect', 'destroy target creature zzzblorp', SEED);
    if (r.status !== 'fail') throw new Error('fail expected');
    expect(r.unknownWords).toEqual([{ index: 3, token: 'zzzblorp' }]);
    const r2 = run('effect', 'destroy draw target creature', SEED);
    if (r2.status !== 'fail') throw new Error('fail expected');
    expect(r2.unknownWords).toEqual([]);
  });
  it('the node budget makes a unit manual instead of running away (design 6.3 rule 4)', () => {
    const r = run('effect', 'destroy target creature, then draw a card, then draw two cards', SEED, { budget: 20 });
    expect(r.status).toBe('budget');
    expect(run('effect', 'destroy target creature', SEED, { budget: 100000 }).status).toBe('ok');
  });
  it('an empty unit and a unit of only a period fail cleanly', () => {
    expect(run('effect', '', SEED).status).toBe('fail');
    expect(run('effect', '.', SEED).status).toBe('fail');
  });
  it('quoted abilities are single tokens: a template may not look inside them', () => {
    const t = tpl('effect', 'destroy {o:Objs}', {}, { id: 'q' });
    expect(run('effect', 'destroy "target creature"', [t]).status).toBe('fail');
  });
});

describe('WP6 scale and the bridge to ParseOptions', () => {
  it('600 templates cost little: templates are indexed by their first symbol, so only the ones that can start are tried (design 6.3)', () => {
    const word = (i: number): string => `frob${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + (Math.floor(i / 26) % 26))}`;
    const many: Template[] = [...SEED];
    for (let i = 0; i < 600; i++) many.push(tpl('effect', `${word(i)} {o:Objs}`, { op: 'frob', n: i, what: '$o' }, { id: `gen${i}` }));
    const t0 = Date.now();
    const r = run('effect', 'destroy target creature, then draw a card, then destroy all creatures', many);
    expect(r.status).toBe('ok');
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(ok(run('effect', `${word(417)} target creature`, many)).derivation.templatesUsed).toEqual(['gen417']);
    // the items counted against the budget stay near the size of the input, not of the template set
    expect(run('effect', 'destroy target creature, then draw a card, then destroy all creatures', many, { budget: 400 }).status).toBe('ok');
  });
  it('chartInputFrom carries ParseOptions over (templates, lexicon, keywords, card names, capabilities, budget)', () => {
    const input = chartInputFrom({ templates: SEED, lexicon: ENV.lexicon, capabilities: new Set(), keywords: ENV.keywords, cardNames: new Set(['Real Card']), budget: 777 }, toks('destroy target creature'), 'effects');
    expect(input.budget).toBe(777);
    expect(input.env.cardNames?.has('Real Card')).toBe(true);
    expect(parseUnit(input).status).toBe('ok');
  });
});
