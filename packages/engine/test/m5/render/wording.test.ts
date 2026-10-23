/**
 * WP2 review fixes: the false rejects that cost automation (WP25 measures them, design 6.12). Each case is a common Oracle idiom that the JSON means exactly
 * and the renderer did not write: thresholds ("you have 40 or more life", CR 119), Oxford commas, "Activate only during your turn" (CR 602.5d), a dash
 * cost that ends with a period (CR 702.21 ward), "Gain control of ...", "for each" tokens, "Scry X, where X is ...".
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, Condition, EffectStep, ObjectFilter, ObjRef, Quantity, StaticEffect } from '../../../src/types/ability';
import { accepts, mana, objTarget, rejects, spell, statics, t, you } from './build';

const creature = { selfNames: ['Test Card'], selfTypes: ['Creature'] };
const grow: StaticEffect = { s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: 2, toughness: 2 }] };
const whenever = (condition: Condition): AbilityDef => ({ kind: 'static', text: '', effects: [grow], condition });
const myCreatures: ObjRef = { ref: 'each', filter: { types: ['Creature'], controller: 'you' } };

describe('CR 119, 700.5 and 404: thresholds are written the way Oracle writes them', () => {
  it('life: "you have 40 or more life"', () => {
    const c: Condition = { cond: 'compare', left: { q: 'life', of: you }, op: '>=', right: 40 };
    accepts(whenever(c), 'As long as you have 40 or more life, Test Card gets +2/+2.', creature);
    accepts(whenever(c), "As long as your life total is 40 or greater, Test Card gets +2/+2.", creature);
  });
  it('life: "you have 5 or less life"', () => {
    accepts(whenever({ cond: 'compare', left: { q: 'life', of: you }, op: '<=', right: 5 }), 'As long as you have 5 or less life, Test Card gets +2/+2.', creature);
  });
  it('a graveyard size: "seven or more cards are in your graveyard"', () => {
    const c: Condition = { cond: 'compare', left: { q: 'zoneSize', zone: 'graveyard', of: you }, op: '>=', right: 7 };
    accepts(whenever(c), 'As long as seven or more cards are in your graveyard, Test Card gets +2/+2.', creature);
  });
  it('a count of permanents: "you control three or more creatures"', () => {
    const c: Condition = { cond: 'compare', left: { q: 'count', of: myCreatures }, op: '>=', right: 3 };
    accepts(whenever(c), 'As long as you control three or more creatures, Test Card gets +2/+2.', creature);
  });
  it('card types among cards: "there are four or more card types among cards in your graveyard"', () => {
    const among = { ref: 'each', filter: { zone: 'graveyard', owner: 'you' } } as const;
    const c: Condition = { cond: 'compare', left: { q: 'distinct', what: 'cardTypes', among }, op: '>=', right: 4 };
    accepts(whenever(c), 'As long as there are four or more card types among cards in your graveyard, Test Card gets +2/+2.', creature);
  });
  it('life against an opponent: "you have more life than an opponent"', () => {
    const c: Condition = { cond: 'compare', left: { q: 'life', of: you }, op: '>', right: { q: 'life', of: { ref: 'anOpponent' } } };
    accepts(whenever(c), 'As long as you have more life than an opponent, Test Card gets +2/+2.', creature);
  });
});

describe('Oxford commas in lists of types and conditions', () => {
  const destroy = (what: unknown, specs: ReturnType<typeof objTarget>[] = []): AbilityDef => spell([{ op: 'destroy', what } as EffectStep], specs);
  it('three types of a target', () => {
    const filter: ObjectFilter = { types: ['Artifact', 'Creature', 'Enchantment'] };
    accepts(destroy(t('c'), [objTarget('c', filter)]), 'Destroy target artifact, creature, or enchantment.');
  });
  it('three types of a set', () => {
    const all = { ref: 'each', filter: { types: ['Artifact', 'Creature', 'Enchantment'] } };
    accepts(destroy(all), 'Destroy all artifacts, creatures, and enchantments.');
    accepts(destroy(all), 'Destroy all artifacts, creatures, or enchantments.');
  });
  it('two types need no comma', () => accepts(destroy(t('c'), [objTarget('c', { types: ['Artifact', 'Creature'] })]), 'Destroy target artifact or creature.'));
  it('three conditions of an "or"', () => {
    const has = (sub: string): Condition => ({ cond: 'exists', of: { ref: 'each', filter: { subtypes: [sub], controller: 'you' } } });
    accepts(whenever({ cond: 'any', of: [has('Forest'), has('Island'), has('Swamp')] }), 'As long as you control a Forest, you control an Island, or you control a Swamp, Test Card gets +2/+2.', creature);
  });
});

describe('CR 602.5d: activation restrictions about turns', () => {
  const ability = (onlyIf: Condition): AbilityDef => ({ kind: 'activated', text: '', cost: { tap: true }, onlyIf, effect: { targets: [], steps: [{ op: 'draw', who: you, count: 1 }] } });
  it('"Activate only during your turn."', () => {
    accepts(ability({ cond: 'turnOf', whose: 'you' }), '{T}: Draw a card. Activate only during your turn.');
    accepts(ability({ cond: 'turnOf', whose: 'you' }), "{T}: Draw a card. Activate only if it's your turn.");
  });
  it('"Activate only during your upkeep."', () => {
    accepts(ability({ cond: 'turnOf', whose: 'you', step: 'upkeep' }), '{T}: Draw a card. Activate only during your upkeep.');
  });
});

describe('CR 702.21 and 702.62: keyword lines with dash costs', () => {
  const kw = (extra: Record<string, unknown>): AbilityDef => ({ kind: 'keyword', text: '', ...extra }) as AbilityDef;
  it('ward with a cost that is not mana ends with a period', () => {
    accepts(kw({ keyword: 'ward', cost: { other: [{ kind: 'payLife', amount: 3 }] } }), 'Ward—Pay 3 life.');
  });
  it('ward with a mana cost has none', () => accepts(kw({ keyword: 'ward', cost: { mana: mana(2) } }), 'Ward {2}'));
  it('an amount and a cost are joined by a dash', () => {
    accepts(kw({ keyword: 'suspend', amount: 3, cost: { mana: [{ kind: 'colored', color: 'R' }] } }), 'Suspend 3—{R}');
  });
});

describe('CR 701.12 and 108.4: effects that Oracle starts with the verb', () => {
  const control = (): AbilityDef => spell([{ op: 'effect', effects: [{ s: 'continuous', affects: t('c'), mods: [{ layer: 2, controller: you }] }], duration: { d: 'endOfTurn' } } as EffectStep], [objTarget('c')]);
  it('"Gain control of target creature until end of turn."', () => {
    accepts(control(), 'Gain control of target creature until end of turn.');
    accepts(control(), 'You gain control of target creature until end of turn.');
  });
});

describe('CR 111 and 701.22: a computed count of tokens, scry and surveil', () => {
  const soldier = { power: 1, toughness: 1, colors: ['W'], types: ['Creature'], subtypes: ['Soldier'] } as const;
  const counted: Quantity = { q: 'count', of: myCreatures };
  const tokens = (count: Quantity): AbilityDef => spell([{ op: 'createToken', who: you, token: soldier, count } as unknown as EffectStep]);
  it('"for each"', () => accepts(tokens(counted), 'Create a 1/1 white Soldier creature token for each creature you control.'));
  it('"X tokens, where X is"', () => accepts(tokens(counted), 'Create X 1/1 white Soldier creature tokens, where X is the number of creatures you control.'));
  it('"a number of tokens equal to"', () => accepts(tokens(counted), 'Create a number of 1/1 white Soldier creature tokens equal to the number of creatures you control.'));
  it('scry and surveil with a computed number', () => {
    accepts(spell([{ op: 'scry', who: you, count: counted } as EffectStep]), 'Scry X, where X is the number of creatures you control.');
    accepts(spell([{ op: 'surveil', who: you, count: counted } as EffectStep]), 'Surveil X, where X is the number of creatures you control.');
  });
  it('mill with a computed number', () => {
    accepts(spell([{ op: 'mill', who: you, count: counted } as EffectStep]), 'Mill X cards, where X is the number of creatures you control.');
  });
});

describe('CR 601.2f: a cast with a cost change in mana', () => {
  it('"It costs {1}{G} less to cast this way."', () => {
    const def = spell([{ op: 'cast', who: you, what: t('c'), costChange: { kind: 'reduce', mana: [{ kind: 'generic', amount: 1 }, { kind: 'colored', color: 'G' }] } } as EffectStep], [objTarget('c', { zone: 'graveyard' })]);
    accepts(def, 'Cast target card from a graveyard. It costs {1}{G} less to cast this way.');
  });
});

describe('CR 508.1d, 726.2 and design 6.8: only the wordings that Oracle has', () => {
  it('"can\'t attack unless" and "can attack only if" are one restriction; "can\'t attack only if" is nobody\'s wording', () => {
    const def = statics([{ s: 'restrict', subject: { ref: 'self' }, mode: 'onlyIf', action: 'attack', when: { cond: 'turnOf', whose: 'you' } }]);
    accepts(def, "Test Card can't attack unless it's your turn.", creature);
    accepts(def, "Test Card can attack only if it's your turn.", creature);
    rejects(def, "Test Card can't attack only if it's your turn.", creature);
  });
  it('"it becomes day" is not "it becomes day next turn"', () => {
    const def = spell([{ op: 'designate', who: you, what: 'day' } as EffectStep]);
    accepts(def, 'It becomes day.');
    rejects(def, 'It becomes day next turn.');
  });
});

describe('design 6.8 (grouping): a bracket-free sentence with two readings is refused, not printed as one of them', () => {
  const has = (sub: string): Condition => ({ cond: 'exists', of: { ref: 'each', filter: { subtypes: [sub], controller: 'you' } } });
  it('an "or" holding an "and" and an "and" holding an "or" are refused', () => {
    rejects(whenever({ cond: 'any', of: [{ cond: 'all', of: [has('Forest'), has('Island')] }, has('Swamp')] }), 'As long as you control a Forest and you control an Island or you control a Swamp, Test Card gets +2/+2.', creature);
    rejects(whenever({ cond: 'all', of: [{ cond: 'any', of: [has('Forest'), has('Island')] }, has('Swamp')] }), 'As long as you control a Forest or you control an Island and you control a Swamp, Test Card gets +2/+2.', creature);
  });
  it('twice (X + 1) and twice X, plus 1 do not print the same', () => {
    const x: Quantity = { q: 'count', of: myCreatures };
    const sum: Quantity = { q: 'math', op: '*', args: [2, { q: 'math', op: '+', args: [x, 1] }] };
    const prod: Quantity = { q: 'math', op: '+', args: [{ q: 'math', op: '*', args: [2, x] }, 1] };
    const draw = (n: Quantity): AbilityDef => spell([{ op: 'draw', who: you, count: n } as EffectStep]);
    rejects(draw(sum), 'Draw cards equal to twice the number of creatures you control plus 1.');
    accepts(draw(prod), 'Draw cards equal to twice the number of creatures you control plus 1.');
  });
});

describe('CR 702.1: a line of several keywords has a gate entry point of its own', () => {
  const flying: AbilityDef = { kind: 'keyword', text: '', keyword: 'flying' };
  const first: AbilityDef = { kind: 'keyword', text: '', keyword: 'first strike' };
  const ward: AbilityDef = { kind: 'keyword', text: '', keyword: 'ward', cost: { mana: mana(2) } };
  const gate = async (defs: AbilityDef[], line: string): Promise<boolean> => {
    const { renderGateKeywordLine } = await import('../../../src/render/gate');
    return renderGateKeywordLine(defs as never, [line], creature).ok;
  };
  it('"Flying, first strike" (keywords in order, separated by commas)', async () => {
    expect(await gate([flying, first], 'Flying, first strike')).toBe(true);
    expect(await gate([flying, first, ward], 'Flying, first strike, ward {2}')).toBe(true);
  });
  it('rejects a keyword that is missing, extra or swapped', async () => {
    expect(await gate([flying, first], 'Flying')).toBe(false);
    expect(await gate([flying], 'Flying, first strike')).toBe(false);
    expect(await gate([first, flying], 'Flying, first strike')).toBe(false);
  });
  it('never throws on junk', async () => {
    expect(await gate([{ kind: 'spell' } as never], 'Flying')).toBe(false);
    expect(await gate([] as never, 'Flying')).toBe(false);
  });
});
