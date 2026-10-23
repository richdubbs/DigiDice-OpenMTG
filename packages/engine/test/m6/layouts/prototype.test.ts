/**
 * M6-6 (m6 design 3.7 "Prototype", 5 "M6-6"): prototype cards (CR 718, 702.160). The alternative characteristics of the inset frame (cards/faces.ts), the cast
 * option `prototype` (actions/cast-opt/prototype.ts), the base part (rules/base-parts/prototype.ts) and the move part that keeps the status
 * (core/move-parts/prototype.ts). Fixture card: Phyrexian Fleshgorger ({7}, 7/5; Prototype {1}{B}{B} -- 3/3).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, legalActions, type GameState, type OracleCard } from '../../../src/index';
import { matchesFilter } from '../../../src/rules/filter';
import { act, find, scenario } from '../../m3/scenario';
import { cast, drive, resolveTop, target } from '../../m5/cr-examples/helpers';

const swamps = (n: number): string[] => Array<string>(n).fill('Swamp');
const view = (s: GameState, id: string) => {
  const c = getChars(s, id);
  return { cost: c.manaCost?.map((m) => (m.kind === 'generic' ? String(m.amount) : m.kind === 'colored' ? m.color : m.kind)).join('') ?? null, mv: c.manaValue, colors: [...c.colors], pt: [c.power, c.toughness], kw: c.keywords.map((k) => k.keyword) };
};
const castLabels = (s: GameState): string[] => legalActions(s, 'p1').filter((a) => a.kind === 'cast').map((a) => a.label);

describe('CR 718.2, 702.160: the prototype characteristics of the card', () => {
  it('cards/faces.ts reads the inset frame: mana cost {1}{B}{B}, 3/3', () => {
    const s = scenario(['Phyrexian Fleshgorger']);
    expect(s.defs['Phyrexian Fleshgorger']!.faces[0]!.prototype).toEqual({ manaCost: [{ kind: 'generic', amount: 1 }, { kind: 'colored', color: 'B' }, { kind: 'colored', color: 'B' }], power: '3', toughness: '3' });
  });
});

describe('CR 718.3a-b: a prototyped spell and the permanent it becomes have only the prototype\'s mana cost, power and toughness, and its colors', () => {
  it('with three Swamps only the prototyped cast is offered (judged on the prototype\'s mana cost, CR 718.3a)', () => {
    const s = scenario(['Phyrexian Fleshgorger', 'Swamp'], { p1: { hand: ['Phyrexian Fleshgorger'], battlefield: swamps(3) } });
    expect(castLabels(s)).toEqual(['Cast Phyrexian Fleshgorger (prototype)']);
  });

  it('cast prototyped: a black 3/3 spell with mana value 3; it resolves into a prototyped black 3/3 with the card\'s other characteristics (CR 718.5)', () => {
    let s = scenario(['Phyrexian Fleshgorger', 'Swamp'], { p1: { hand: ['Phyrexian Fleshgorger'], battlefield: swamps(7) } });
    expect(castLabels(s)).toEqual(['Cast Phyrexian Fleshgorger', 'Cast Phyrexian Fleshgorger (prototype)']);
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Phyrexian Fleshgorger', 'hand'), method: 'prototype' }));
    expect(s.zones.battlefield.filter((x) => s.objects[x]!.tapped)).toHaveLength(3); // {1}{B}{B}
    const spell = s.zones.stack[0]!;
    expect(s.objects[spell]!.prototyped).toBe(true);
    expect(view(s, spell)).toMatchObject({ cost: '1BB', mv: 3, colors: ['B'], pt: ['3', '3'] });
    s = resolveTop(s);
    const id = find(s, 'Phyrexian Fleshgorger', 'battlefield');
    expect(s.objects[id]!.prototyped).toBe(true);
    expect(view(s, id)).toMatchObject({ cost: '1BB', mv: 3, colors: ['B'], pt: ['3', '3'] });
    expect(view(s, id).kw).toEqual(expect.arrayContaining(['menace', 'lifelink']));
    expect(matchesFilter(s, s.objects[id]!, { prototyped: true }, { you: 'p1' } as never)).toBe(true);
  });

  it('cast normally: a colorless 7/5 with mana value 7, not prototyped (CR 718.4)', () => {
    let s = scenario(['Phyrexian Fleshgorger', 'Swamp'], { p1: { hand: ['Phyrexian Fleshgorger'], battlefield: swamps(7) } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Phyrexian Fleshgorger', 'hand') }));
    s = resolveTop(s);
    const id = find(s, 'Phyrexian Fleshgorger', 'battlefield');
    expect(s.objects[id]!.prototyped).toBeUndefined();
    expect(view(s, id)).toMatchObject({ cost: '7', mv: 7, colors: [], pt: ['7', '5'] });
  });
});

describe('CR 718.3c, 718.3b: a copy of a prototyped spell is also prototyped, and so is the token it becomes (CR 707.10f)', () => {
  it('a synthetic "Copy target creature spell you control." copies a prototyped Fleshgorger: a black 3/3 with mana value 3 on the stack and on the battlefield', () => {
    const copier = compileCard({ name: 'Test Mirror Spell', layout: 'normal', type_line: 'Instant', mana_cost: '{B}', oracle_text: 'Copy target creature spell you control.', colors: [] } as OracleCard);
    expect(copier.automation.level).toBe('full');
    let s = scenario(['Phyrexian Fleshgorger', 'Swamp'], { p1: { hand: ['Phyrexian Fleshgorger', 'Test Mirror Spell'], battlefield: swamps(4) }, defs: [copier] });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Phyrexian Fleshgorger', 'hand'), method: 'prototype' }));
    const spell = s.zones.stack[0]!;
    s = cast(s, 'Test Mirror Spell', [target(spell)]);
    s = resolveTop(s); // the copy spell resolves: a copy of the prototyped Fleshgorger is put onto the stack (CR 707.10)
    const copy = s.zones.stack[s.zones.stack.length - 1]!;
    expect(s.objects[copy]!.kind).toBe('spellCopy');
    expect(s.objects[copy]!.prototyped).toBe(true); // CR 718.3c
    expect(view(s, copy)).toMatchObject({ cost: '1BB', mv: 3, colors: ['B'], pt: ['3', '3'] });
    s = resolveTop(s); // CR 707.10f, 718.3b: the copy becomes a token, the permanent a prototyped spell becomes
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.defId === 'Phyrexian Fleshgorger')!;
    expect(token).toBeDefined();
    expect(s.objects[token]!.prototyped).toBe(true);
    expect(view(s, token)).toMatchObject({ cost: '1BB', mv: 3, colors: ['B'], pt: ['3', '3'] });
  });
});

describe('CR 718.3d (wave 3 merge): a copy of a prototyped permanent has the prototype characteristics', () => {
  it('a synthetic "Create a token that\'s a copy of target creature." copies a prototyped Fleshgorger: a black 3/3 with mana value 3 (not the 7/5); a normal one gives a 7/5', () => {
    const copier = compileCard({ name: 'Test Mirror Token', layout: 'normal', type_line: 'Instant', mana_cost: '{B}', oracle_text: "Create a token that's a copy of target creature.", colors: [] } as OracleCard);
    expect(copier.automation.level).toBe('full');
    for (const method of ['prototype', undefined] as const) {
      let s = scenario(['Phyrexian Fleshgorger', 'Swamp'], { p1: { hand: ['Phyrexian Fleshgorger', 'Test Mirror Token'], battlefield: swamps(8) }, defs: [copier] });
      s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Phyrexian Fleshgorger', 'hand'), ...(method ? { method } : {}) }));
      s = resolveTop(s);
      const original = find(s, 'Phyrexian Fleshgorger', 'battlefield');
      s = cast(s, 'Test Mirror Token', [target(original)]);
      s = resolveTop(s);
      const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
      expect(token, String(method)).toBeDefined();
      if (method === 'prototype') expect(view(s, token)).toMatchObject({ cost: '1BB', mv: 3, colors: ['B'], pt: ['3', '3'] });
      else expect(view(s, token)).toMatchObject({ cost: '7', mv: 7, colors: [], pt: ['7', '5'] });
      expect(view(s, token).kw).toEqual(expect.arrayContaining(['menace', 'lifelink'])); // CR 718.5: the card's other characteristics
      expect(s.log.some((l) => /by hand|not automated/i.test(typeof l === 'string' ? l : JSON.stringify(l))), String(method)).toBe(false);
    }
  });
});

describe('CR 718.4: in every zone other than the stack and the battlefield a prototype card has only its normal characteristics', () => {
  it('a prototyped Fleshgorger that dies is a 7/5 colorless card with mana value 7 in the graveyard', () => {
    let s = scenario(['Phyrexian Fleshgorger', 'Swamp', 'Murder'], { p1: { hand: ['Phyrexian Fleshgorger', 'Murder'], battlefield: swamps(6) } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Phyrexian Fleshgorger', 'hand'), method: 'prototype' }));
    s = resolveTop(s);
    const id = find(s, 'Phyrexian Fleshgorger', 'battlefield');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Murder', 'hand') }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id }] }]);
    s = resolveTop(s);
    const dead = find(s, 'Phyrexian Fleshgorger', 'graveyard');
    expect(s.objects[dead]!.prototyped).toBeUndefined();
    expect(view(s, dead)).toMatchObject({ cost: '7', mv: 7, colors: [], pt: ['7', '5'] });
  });
});
