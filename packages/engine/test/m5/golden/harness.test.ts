/**
 * The golden harness checks itself (design 15.2 WP25: "the harness tests itself on the fixture set"): it finds a wrong golden JSON, accepts a manual
 * ability as pending, enforces the `expect: "full"` ratchet, ignores display text and bookkeeping, and reads golden files with no Oracle text. It also
 * compares the automated nodes of partial abilities, runs the card-wide lint (linked abilities, CR 607.1), masks manual nodes where the canonical form
 * has them, and renames every binding-name reference together. Synthetic cards use invented names and wordings (design 6.10).
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_TEMPLATES } from '../../../src/parser/parse';
import type { OracleCard } from '../../../src/types/card';
import { getCard } from '../../fixtures';
import { MASK, agreesOutsideMasks, behavior, checkGolden, goldenOptions, goldenTemplates, loadGolden, cardLintErrors, maskedBehavior, partialAgreesWith, understood, type GoldenEntry } from './harness';

const murder = (): GoldenEntry => loadGolden().find((e) => e.card === 'Murder' && e.source === 'wp25-seed.json')!;

describe('golden harness', () => {
  it('reads every merged template file (the bootstrap set at least)', () => {
    const ids = new Set(goldenTemplates().map((t) => t.id));
    for (const t of BOOTSTRAP_TEMPLATES) expect(ids.has(t.id)).toBe(true);
  });
  it('CR 701.8a: a golden JSON that disagrees with a fully understood ability is a mismatch (here: the wrong card type)', () => {
    const e = structuredClone(murder());
    ((e.faces[0]!.abilities[0] as { effect: { targets: { filter: { types: string[] } }[] } }).effect.targets[0]!.filter.types) = ['Artifact'];
    const r = checkGolden(e, getCard('Murder'), goldenOptions());
    expect(r.matched).toBe(0);
    expect(r.mismatches).toHaveLength(1);
    expect(r.ratchet).toMatch(/expected every ability fully understood/);
  });
  it('an ability the parser leaves manual is pending, not a failure (without the template it is manual)', () => {
    const opts = goldenOptions(BOOTSTRAP_TEMPLATES.filter((t) => t.id !== 'eff.destroy'));
    const r = checkGolden({ ...murder(), expect: undefined }, getCard('Murder'), opts);
    expect(r).toMatchObject({ matched: 0, pending: 1, mismatches: [] });
    expect(checkGolden(murder(), getCard('Murder'), opts).ratchet).toBeDefined();
  });
  it('compares behavior only: display text, labels, provenance and source lines do not matter', () => {
    const a = { kind: 'keyword', keyword: 'flying', text: 'Flying', src: [0], prov: { by: 'keyword', id: 'flying' } };
    expect(behavior(a)).toBe(behavior({ kind: 'keyword', keyword: 'flying' }));
    expect(behavior(a)).not.toBe(behavior({ kind: 'keyword', keyword: 'reach' }));
    expect(understood({ kind: 'manual', text: 'x', reason: 'y', shape: 'static' } as never)).toBe(false);
  });
  it('applies the representation equivalences of the hole grammars (CR 115.1: no restriction either way) and compares binding names up to renaming', () => {
    const spec = (extra: object) => ({ kind: 'spell', effect: { targets: [{ id: 't0', kind: 'player', min: 1, max: 1, ...extra }], steps: [{ op: 'draw', who: { ref: 'target', id: 't0' }, count: 1 }] } });
    expect(behavior(spec({ players: { who: 'any' } }))).toBe(behavior(spec({})));
    expect(behavior(spec({ players: { who: 'opponent' } }))).not.toBe(behavior(spec({})));
    const named = (n: string) => ({ kind: 'spell', effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 1, as: n }, { op: 'discard', who: { ref: 'you' }, what: { ref: 'bound', name: n } }] } });
    expect(behavior(named('drawn'))).toBe(behavior(named('x')));
  });
  it('a face count that differs makes every understood ability a mismatch', () => {
    const e = { ...murder(), faces: [...murder().faces, { abilities: [] }] };
    expect(checkGolden(e, getCard('Murder'), goldenOptions()).mismatches).toHaveLength(1);
  });
  it('golden files are arrays of entries keyed by Oracle name; the seed file carries no Oracle text (design 6.10)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wp25-golden-'));
    writeFileSync(join(dir, 'x.json'), JSON.stringify([{ card: 'Shock', faces: [{ abilities: [] }] }]));
    expect(loadGolden(dir).filter((e) => e.source === 'x.json').map((e) => e.card)).toEqual(['Shock']);
    writeFileSync(join(dir, 'y.json'), '{"card":"Shock"}');
    expect(() => loadGolden(dir)).toThrow(/array of entries/);
    const seed = JSON.stringify(loadGolden().filter((e) => e.source === 'wp25-seed.json'));
    expect(seed).not.toMatch(/"text"/);
    expect(seed).not.toContain('damage to any target');
  });
});

/** A synthetic one-face card (invented name; design 6.10). */
const synthetic = (name: string, typeLine: string, text: string): OracleCard =>
  ({ name, layout: 'normal', type_line: typeLine, oracle_text: text, mana_cost: '{1}', colors: [], keywords: [], oracle_id: `synthetic-${name}` }) as unknown as OracleCard;

const spellEntry = (name: string, steps: unknown[], extra: Partial<GoldenEntry> = {}): GoldenEntry => ({ card: name, source: 'test', faces: [{ abilities: [{ kind: 'spell', effect: { targets: [], steps } }] }], ...extra });

describe('golden harness: partial abilities are compared on their automated nodes (never silently wrong)', () => {
  // "Draw two cards. You gain 3 life." with the bootstrap templates: a partial spell [draw 2, manual] (the bootstrap set has no life template)
  const card = synthetic('Quiet Bargain', 'Sorcery', 'Draw two cards. You gain 3 life.');
  const opts = goldenOptions(BOOTSTRAP_TEMPLATES);
  const gain = { op: 'gainLife', who: { ref: 'you' }, amount: 3 };
  it('CR 121.1: a golden entry that draws THREE cards disagrees with the automated draw of two: a mismatch, not pending', () => {
    const r = checkGolden(spellEntry('Quiet Bargain', [{ op: 'draw', who: { ref: 'you' }, count: 3 }, gain]), card, opts);
    expect(r.mismatches).toHaveLength(1);
    expect(r.mismatches[0]!.reason).toMatch(/automated nodes of this partial ability/);
    expect(r.matched).toBe(0);
  });
  it('CR 121.1: the right golden JSON agrees with the automated draw; the ability stays pending (it is not fully understood)', () => {
    const right = spellEntry('Quiet Bargain', [{ op: 'draw', who: { ref: 'you' }, count: 2 }, gain]);
    expect(checkGolden(right, card, opts)).toMatchObject({ matched: 0, partialAgree: 1, pending: 1, mismatches: [] });
    expect(checkGolden({ ...right, expect: 'full' }, card, opts).ratchet).toBeDefined();
  });
  it('CR 608.2c: a mask stands for one or more steps, never for an automated step that is missing or different', () => {
    const m = [{ op: 'draw' }, MASK];
    expect(agreesOutsideMasks(m, [{ op: 'draw' }, { op: 'a' }, { op: 'b' }])).toBe(true);
    expect(agreesOutsideMasks(m, [{ op: 'draw' }])).toBe(false);
    expect(agreesOutsideMasks(m, [{ op: 'discard' }, { op: 'a' }])).toBe(false);
  });
});

describe('golden harness: masks are placed on the canonical form (canonicalize sorts the operands of all/any)', () => {
  const ability = (types: string[]) => ({
    kind: 'spell',
    effect: { targets: [], steps: [{ op: 'if', cond: { cond: 'all', of: [{ cond: 'exists', filter: { types, controller: 'you' } }, { cond: 'ask', text: 'if the moon is full' }] }, then: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] }] },
  });
  it('CR 608.2c: the ask operand of an `all` condition is masked and the automated operand compared, whatever order the parser built them in', () => {
    const masked = JSON.stringify(maskedBehavior(ability(['Creature'])));
    expect(masked).toContain(MASK);
    expect(masked).toContain('"Creature"');
    expect(masked).not.toContain('"ask"');
    expect(partialAgreesWith(maskedBehavior(ability(['Creature'])), ability(['Creature']))).toBe(true);
    expect(partialAgreesWith(maskedBehavior(ability(['Creature'])), ability(['Artifact']))).toBe(false);
    // the golden JSON with the condition understood: the operands are a set (canonicalize sorts them), so the mask may stand for either position
    const filled = { ...ability(['Creature']), effect: { targets: [], steps: [{ op: 'if', cond: { cond: 'all', of: [{ cond: 'exists', filter: { types: ['Creature'], controller: 'you' } }, { cond: 'exists', filter: { types: ['Land'], controller: 'you' } }] }, then: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] }] } };
    expect(partialAgreesWith(maskedBehavior(ability(['Creature'])), filled)).toBe(true);
  });
});

describe('golden harness: binding names are renamed together wherever they are read (CR 608.2c)', () => {
  const program = (first: string, second: string, did: string) => ({
    kind: 'spell',
    effect: { targets: [], steps: [
      { op: 'discard', who: { ref: 'you' }, count: 1, as: first },
      { op: 'draw', who: { ref: 'you' }, count: 1, as: second },
      { op: 'gainLife', who: { ref: 'you' }, amount: 2, guard: { cond: 'did', step: did } },
    ] },
  });
  it('CR 608.2c: an "if you do" that reads the draw is not the program whose "if you do" reads the discard', () => {
    expect(behavior(program('a', 'b', 'b'))).not.toBe(behavior(program('b', 'a', 'b')));
  });
  it('CR 608.2c, 608.2h: the same program under other names is equal (as, did.step, resultCount.step, let/var, delay.capture)', () => {
    expect(behavior(program('a', 'b', 'b'))).toBe(behavior(program('x', 'y', 'y')));
    const more = (n: string, v: string, captured: string = n) => ({ kind: 'spell', effect: { targets: [], steps: [
      { op: 'discard', who: { ref: 'you' }, count: 1, as: n },
      { op: 'let', name: v, value: { q: 'resultCount', step: n } },
      { op: 'draw', who: { ref: 'you' }, count: { q: 'var', name: v } },
      { op: 'delay', when: { at: 'step', step: 'end', next: true }, capture: [captured], do: [{ op: 'sacrifice', what: { ref: 'bound', name: n } }] },
    ] } });
    expect(behavior(more('d', 'x'))).toBe(behavior(more('e', 'y')));
    expect(behavior(more('d', 'x'))).not.toBe(behavior(more('d', 'x', 'other')));
  });
});

describe('golden harness: the card-wide lint (linked abilities, CR 607.1, 607.2a)', () => {
  // the shape the review found with the WP19-WP23 templates: the enters ability exiles without `link`, the leaves ability returns "the exiled card"
  const etb = (link?: string) => ({
    kind: 'triggered', trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }] },
    effect: { targets: [{ id: 't0', kind: 'object', min: 1, max: 1, filter: { types: ['Creature'], other: true } }], steps: [{ op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'exile' }, ...(link ? { link } : {}) }] },
  });
  const ltb = { kind: 'triggered', trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, from: 'battlefield' }] }, effect: { targets: [], steps: [{ op: 'move', what: { ref: 'linked', link: 'exiled' }, to: { zone: 'battlefield', controller: 'owner' } }] } };
  it('CR 607.2a: an exile without `link` and a return of "the exiled card" is a lint error (the card would never come back); with the link it is clean', () => {
    expect(cardLintErrors([{ abilities: [etb(), ltb] as never }]).join('\n')).toMatch(/unlinked: link "exiled" is read here but no ability of this card produces it \(CR 607\.1\)/);
    expect(cardLintErrors([{ abilities: [etb('exiled'), ltb] as never }])).toEqual([]);
  });
  it('checkGolden reports the lint of the parsed faces (none for a card without links)', () => {
    expect(checkGolden(murder(), getCard('Murder'), goldenOptions()).cardLint).toEqual([]);
  });
});

describe('golden harness: the reviewed equivalences (EQUIVALENCES)', () => {
  it('CR 111.4: a token named after its subtypes is the token without a name; any other name is not', () => {
    const token = (extra: object) => ({ kind: 'spell', effect: { targets: [], steps: [{ op: 'createToken', who: { ref: 'you' }, count: 1, token: { types: ['Creature'], subtypes: ['Soldier'], power: 1, toughness: 1, ...extra } }] } });
    expect(behavior(token({ name: 'Soldier' }))).toBe(behavior(token({})));
    expect(behavior(token({ name: 'Soldier Token' }))).toBe(behavior(token({})));
    expect(behavior(token({ name: 'Bramble' }))).not.toBe(behavior(token({})));
  });
  it('CR 301.5c: "equipped creature" with or without types [Creature]; another type is not the same', () => {
    const trig = (source: object) => ({ kind: 'triggered', trigger: { on: [{ ev: 'damage', source, combat: true }] }, effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] } });
    expect(behavior(trig({ attachedToSource: true, types: ['Creature'] }))).toBe(behavior(trig({ attachedToSource: true })));
    expect(behavior(trig({ attachedToSource: true, types: ['Artifact'] }))).not.toBe(behavior(trig({ attachedToSource: true })));
  });
  it('CR 608.2c: a step followed by a manual step may lack the `else` branch the golden step has; a field it has must still be equal', () => {
    const pay = (amount: number) => ({ op: 'pay', who: { ref: 'event', role: 'player' }, cost: { mana: [{ kind: 'generic', amount }] } });
    const parsed = maskedBehavior({ kind: 'spell', effect: { targets: [], steps: [pay(2), { op: 'manual', text: 'x', reason: 'y' }] } });
    const golden = (amount: number) => ({ kind: 'spell', effect: { targets: [], steps: [{ ...pay(amount), else: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] }] } });
    expect(partialAgreesWith(parsed, golden(2))).toBe(true);
    expect(partialAgreesWith(parsed, golden(3))).toBe(false);
  });
  it('CR 608.2c, 701.20e: a step may lack the golden `as` when no automated node reads a name (the reader is masked); not when one does, nor for another step', () => {
    const look = (count: number, as?: string) => ({ op: 'look', who: { ref: 'you' }, at: { ref: 'topCards', player: { ref: 'target', id: 't0' }, count }, ...(as ? { as } : {}) });
    const targets = [{ id: 't0', kind: 'player', min: 1, max: 1 }];
    const manual = { op: 'manual', text: 'x', reason: 'y' };
    const bottom = { op: 'may', who: { ref: 'you' }, do: [{ op: 'move', what: { ref: 'bound', name: 'top' }, to: { zone: 'library', owner: { ref: 'target', id: 't0' }, position: 'bottom' } }] };
    const golden = { kind: 'spell', effect: { targets, steps: [look(1, 'top'), bottom] } };
    expect(partialAgreesWith(maskedBehavior({ kind: 'spell', effect: { targets, steps: [look(1), manual] } }), golden)).toBe(true);
    expect(partialAgreesWith(maskedBehavior({ kind: 'spell', effect: { targets, steps: [look(2), manual] } }), golden)).toBe(false);
    // an automated reader of a name: the names must line up as before (here the parsed move reads a name its look does not bind)
    const reads = { op: 'move', what: { ref: 'bound', name: 'top' }, to: { zone: 'graveyard' } };
    expect(partialAgreesWith(maskedBehavior({ kind: 'spell', effect: { targets, steps: [look(1), reads, manual] } }), { kind: 'spell', effect: { targets, steps: [look(1, 'top'), reads, bottom] } })).toBe(false);
    expect(partialAgreesWith(maskedBehavior({ kind: 'spell', effect: { targets, steps: [look(1, 'top'), reads, manual] } }), { kind: 'spell', effect: { targets, steps: [look(1, 'top'), reads, bottom] } })).toBe(true);
  });
  it('CR 602.2: an activated ability whose every step is manual agrees with a golden manual ability of the same cost, not of another cost', () => {
    const masked = maskedBehavior({ kind: 'activated', cost: { tap: true, mana: [{ kind: 'generic', amount: 1 }] }, effect: { targets: [], steps: [{ op: 'manual', text: 'x', reason: 'y' }] } });
    const golden = (amount: number, shape = 'activated') => ({ kind: 'manual', shape, reason: 'r', cost: { tap: true, mana: [{ kind: 'generic', amount }] } });
    expect(partialAgreesWith(masked, golden(1))).toBe(true);
    expect(partialAgreesWith(masked, golden(2))).toBe(false);
    expect(partialAgreesWith(masked, golden(1, 'triggered'))).toBe(false);
    const automated = maskedBehavior({ kind: 'activated', cost: { tap: true }, effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 1 }, { op: 'manual', text: 'x', reason: 'y' }] } });
    expect(partialAgreesWith(automated, { kind: 'manual', shape: 'activated', reason: 'r', cost: { tap: true } })).toBe(false);
  });
});
