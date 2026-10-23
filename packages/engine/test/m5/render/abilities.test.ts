/**
 * WP2: static effects (design 2.3 `StaticEffect`, 9) and the ability kinds (design 2.3 `AbilityDef`), each as the Oracle wording it must print. The gate
 * must accept the wording, so every case is also a statement about what the equivalence table lets through.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, ObjectFilter, StaticEffect, TargetSpec } from '../../../src/types/ability';
import { renderAbility, renderGate } from '../../../src/index';
import { renderStaticEffect } from '../../../src/render/static';

const ctx = { selfNames: ['Test Card'], selfTypes: ['Creature'] };
const you = { ref: 'you' } as const;
const mana = (n: number) => [{ kind: 'generic' as const, amount: n }];
const creature = (id: string, filter: ObjectFilter = { types: ['Creature'] }): TargetSpec => ({ id, kind: 'object', min: 1, max: 1, text: '', filter });
const t = (id: string) => ({ ref: 'target', id }) as const;
const statics = (effects: StaticEffect[], extra: Partial<Extract<AbilityDef, { kind: 'static' }>> = {}): AbilityDef => ({ kind: 'static', text: '', effects, ...extra });
const yourCreatures: ObjectFilter = { types: ['Creature'], controller: 'you' };

type Case = [string, AbilityDef, string];

const abilityCases: Case[] = [
  // --- activated
  ['activated with a sorcery restriction', { kind: 'activated', text: '', cost: { mana: mana(2) }, sorcerySpeed: true, effect: { targets: [], steps: [{ op: 'draw', who: you, count: 1 }] } }, '{2}: Draw a card. Activate only as a sorcery.'],
  ['activated once each turn', { kind: 'activated', text: '', cost: { tap: true }, limit: { per: 'turn', max: 1 }, effect: { targets: [], steps: [{ op: 'draw', who: you, count: 1 }] } }, '{T}: Draw a card. Activate only once each turn.'],
  ['activated only if', { kind: 'activated', text: '', cost: { tap: true }, onlyIf: { cond: 'turnOf', whose: 'you' }, effect: { targets: [], steps: [{ op: 'draw', who: you, count: 1 }] } }, "{T}: Draw a card. Activate only if it's your turn."],
  ['activated with two restrictions', { kind: 'activated', text: '', cost: { tap: true }, sorcerySpeed: true, limit: { per: 'turn', max: 1 }, effect: { targets: [], steps: [{ op: 'draw', who: you, count: 1 }] } }, '{T}: Draw a card. Activate only as a sorcery and only once each turn.'],
  ['activated with a sacrifice cost', { kind: 'activated', text: '', cost: { mana: mana(1), other: [{ kind: 'sacrifice', filter: {}, count: 1, self: true }] }, effect: { targets: [], steps: [{ op: 'gainLife', who: you, amount: 3 }] } }, '{1}, Sacrifice ~: Gain 3 life.'.replace('~', 'Test Card')],
  // --- triggered
  ['triggered with an intervening if', { kind: 'triggered', text: '', trigger: { on: [{ ev: 'step', step: 'upkeep', whose: 'you' }] }, interveningIf: { cond: 'exists', of: { ref: 'each', filter: yourCreatures } }, effect: { targets: [], steps: [{ op: 'draw', who: you, count: 1 }] } },
    'At the beginning of your upkeep, if you control a creature, draw a card.'],
  ['triggered on several events', { kind: 'triggered', text: '', trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, { ev: 'attacks', attacker: { self: true } }] }, effect: { targets: [], steps: [{ op: 'draw', who: you, count: 1 }] } },
    'Whenever Test Card enters or attacks, draw a card.'],
  ['triggered batch', { kind: 'triggered', text: '', trigger: { on: [{ ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you' }, from: 'battlefield', to: 'graveyard' }], batch: true }, effect: { targets: [], steps: [{ op: 'draw', who: you, count: 1 }] } },
    'Whenever one or more creatures you control die, draw a card.'],
  ['triggered once each turn', { kind: 'triggered', text: '', trigger: { on: [{ ev: 'cast', player: 'you' }] }, limit: { per: 'turn', max: 1 }, effect: { targets: [], steps: [{ op: 'draw', who: you, count: 1 }] } },
    'Whenever you cast a spell, draw a card. Do this only once each turn.'],
  ['triggered with the event as it', { kind: 'triggered', text: '', trigger: { on: [{ ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'graveyard' }] }, effect: { targets: [], steps: [{ op: 'move', what: { ref: 'event', role: 'subject' }, to: { zone: 'exile' } }] } },
    'Whenever a creature dies, exile it.'],
  // --- chapters, classes, levels
  ['chapter', { kind: 'chapter', text: '', chapters: [1, 2], effect: { targets: [], steps: [{ op: 'draw', who: you, count: 1 }] } }, 'I, II -- Draw a card.'],
  ['chapter III', { kind: 'chapter', text: '', chapters: [3], effect: { targets: [], steps: [{ op: 'gainLife', who: you, amount: 2 }] } }, 'III -- Gain 2 life.'],
  ['class level', { kind: 'classLevel', text: '', level: 2, cost: { mana: mana(2) }, abilities: [statics([{ s: 'continuous', affects: { ref: 'each', filter: yourCreatures }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }])] },
    '{2}: Level 2. Creatures you control get +1/+1.'],
  ['level bracket', { kind: 'levelBracket', text: '', min: 2, max: 6, power: '3', toughness: '3', abilities: [{ kind: 'keyword', text: '', keyword: 'flying' }] }, 'Level 2-6 3/3 Flying'],
  // --- keywords and manual
  ['keyword line', { kind: 'keyword', text: '', keyword: 'kicker', cost: { mana: mana(2) } }, 'Kicker {2}'],
  ['manual text', { kind: 'manual', text: 'Do whatever it says.', reason: 'test', shape: 'unknown' }, 'Do whatever it says.'],
  // --- modal
  ['modal choose one', { kind: 'spell', text: '', effect: { targets: [], modes: { min: 1, max: 1, options: [
    { text: '', program: { targets: [], steps: [{ op: 'draw', who: you, count: 1 }] } },
    { text: '', program: { targets: [], steps: [{ op: 'gainLife', who: you, amount: 3 }] } },
  ] }, steps: [] } }, 'Choose one -- • Draw a card. • Gain 3 life.'],
  ['modal choose one or both', { kind: 'spell', text: '', effect: { targets: [], modes: { min: 1, max: 2, options: [
    { text: '', program: { targets: [], steps: [{ op: 'draw', who: you, count: 1 }] } },
    { text: '', program: { targets: [], steps: [{ op: 'gainLife', who: you, amount: 3 }] } },
  ] }, steps: [] } }, 'Choose one or both -- • Draw a card. • Gain 3 life.'],
  ['modal choose up to two', { kind: 'spell', text: '', effect: { targets: [], modes: { min: 0, max: 2, options: [
    { text: '', program: { targets: [], steps: [{ op: 'draw', who: you, count: 1 }] } },
    { text: '', program: { targets: [], steps: [{ op: 'gainLife', who: you, amount: 3 }] } },
    { text: '', program: { targets: [], steps: [{ op: 'mill', who: you, count: 3 }] } },
  ] }, steps: [] } }, 'Choose up to two -- • Draw a card. • Gain 3 life. • Mill three cards.'],
  ['modal in a trigger', { kind: 'triggered', text: '', trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }] }, effect: { targets: [], modes: { min: 1, max: 1, options: [
    { text: '', program: { targets: [{ id: 'a', kind: 'object', min: 1, max: 1, text: '', filter: { types: ['Creature'] } }], steps: [{ op: 'destroy', what: t('a') }] } },
    { text: '', program: { targets: [], steps: [{ op: 'draw', who: you, count: 2 }] } },
  ] }, steps: [] } }, 'When Test Card enters, choose one -- • Destroy target creature. • Draw two cards.'],
];

const staticCases: Case[] = [
  // --- continuous
  ['anthem for a subtype', statics([{ s: 'continuous', affects: { ref: 'each', filter: { subtypes: ['Elf'], controller: 'you' } }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }]), 'Elves you control get +1/+1.'],
  ['other creatures', statics([{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you', other: true } }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }]), 'Other creatures you control get +1/+1.'],
  ['grants flying', statics([{ s: 'continuous', affects: { ref: 'each', filter: yourCreatures }, mods: [{ layer: 6, add: [{ kind: 'keyword', text: '', keyword: 'flying' }] }] }]), 'Creatures you control have flying.'],
  ['gets and has', statics([{ s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: '7c', power: 1, toughness: 1 }, { layer: 6, add: [{ kind: 'keyword', text: '', keyword: 'flying' }, { kind: 'keyword', text: '', keyword: 'vigilance' }] }] }]), 'Enchanted creature gets +1/+1 and has flying and vigilance.'],
  ['loses a keyword', statics([{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'opponent' } }, mods: [{ layer: 6, remove: ['flying'] }] }]), 'Creatures your opponents control lose flying.'],
  ['dynamic bonus', statics([{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } }, toughness: 0 }] }]), '~ gets +X/+0, where X is the number of creatures you control.'.replace('~', 'Test Card')],
  ['characteristic-defining', statics([{ s: 'continuous', affects: { ref: 'self' }, cda: true, mods: [{ layer: '7a', power: { q: 'count', of: { ref: 'each', filter: yourCreatures } }, toughness: { q: 'count', of: { ref: 'each', filter: yourCreatures } } }] }]), "Test Card's power and toughness are each equal to the number of creatures you control."],
  ['colors', statics([{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'] } }, mods: [{ layer: 5, colors: { set: ['B'] } }] }]), 'All creatures are black.'],
  ['lands become', statics([{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Land'], notSupertypes: ['Basic'] } }, mods: [{ layer: 4, subtypes: { set: ['Mountain'] } }] }]), 'All nonbasic lands are Mountains.'],
  ['conditional anthem', statics([{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: 2, toughness: 2 }] }], { condition: { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Island'], controller: 'you' } } } }), 'As long as you control an Island, Test Card gets +2/+2.'],
  // --- cost modification
  ['spells cost less', statics([{ s: 'costMod', applies: { spells: { zone: 'stack', types: ['Creature'] }, caster: 'you' }, change: { kind: 'reduce', generic: 1 } }]), 'Creature spells you cast cost {1} less to cast.'],
  ['opponents spells cost more', statics([{ s: 'costMod', applies: { spells: { zone: 'stack' }, caster: 'opponent' }, change: { kind: 'increase', generic: 1 } }]), 'Spells your opponents cast cost {1} more to cast.'],
  ['self cost per count', statics([{ s: 'costMod', applies: { self: true, caster: 'you' }, change: { kind: 'reduce', generic: { q: 'count', of: { ref: 'each', filter: { types: ['Artifact'], controller: 'you' } } } } }]), 'Test Card costs {1} less to cast for each artifact you control.'],
  ['abilities cost more', statics([{ s: 'costMod', applies: { abilities: { kind: 'activated', source: { types: ['Creature'] } }, caster: 'any' }, change: { kind: 'increase', generic: 1 } }]), 'Activated abilities of creatures cost {1} more to activate.'],
  // --- restrictions
  ['cant attack', statics([{ s: 'restrict', subject: { ref: 'attachedTo' }, mode: 'cant', action: 'attack' }]), "Enchanted creature can't attack."],
  ['cant block', statics([{ s: 'restrict', subject: { ref: 'each', filter: { types: ['Creature'], controller: 'opponent' } }, mode: 'cant', action: 'block' }]), "Creatures your opponents control can't block."],
  ['must attack', statics([{ s: 'restrict', subject: { ref: 'self' }, mode: 'mustIfAble', action: 'attack' }]), 'Test Card attacks each combat if able.'],
  ['cant be blocked by', statics([{ s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'beBlockedBy', other: { types: ['Creature'], power: { op: '<=', value: 2 } } }]), "Test Card can't be blocked by creatures with power 2 or less."],
  ['players cant gain life', statics([{ s: 'restrict', subject: { ref: 'each', who: 'player' }, mode: 'cant', action: 'gainLife' }]), "Each player can't gain life."],
  ['cant cast', statics([{ s: 'restrict', subject: { ref: 'each', who: 'opponent' }, mode: 'cant', action: 'cast', max: 1 }]), "Each opponent can't cast more than one spell each turn."],
  ['doesnt untap', statics([{ s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'untapDuringUntapStep' }]), "Test Card doesn't untap during your untap step."],
  // --- replacement
  ['enters tapped', statics([{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', tapped: true } }]), 'Test Card enters tapped.'],
  ['enters with counters', statics([{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', counters: [{ kind: '+1/+1', count: 2 }] } }]), 'Test Card enters with two +1/+1 counters on it.'],
  ['exile instead', statics([{ s: 'replace', replaces: { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'opponent' }, from: 'battlefield', to: 'graveyard' }, body: { b: 'modify', destination: { zone: 'exile' } } }]), 'If a creature an opponent controls would die, exile it instead.'],
  ['twice the damage', statics([{ s: 'replace', replaces: { ev: 'damage', source: { types: ['Creature'], controller: 'you' } }, body: { b: 'modify', amount: { mul: 2 } } }]), 'If a creature you control would deal damage, it deals twice that much damage instead.'],
  ['skip your draw step', statics([{ s: 'replace', replaces: { ev: 'step', step: 'draw', whose: 'you' }, body: { b: 'skip' } }]), 'Skip your draw step.'],
  // --- permissions and rule modifications
  ['flash for spells', statics([{ s: 'permit', who: you, action: 'haveFlash', of: { types: ['Creature'] } }]), 'You may cast creature spells as though they had flash.'],
  ['extra land', statics([{ s: 'permit', who: you, action: 'playLand', count: 1 }]), 'You may play an additional land on each of your turns.'],
  ['play lands from the graveyard', statics([{ s: 'permit', who: you, action: 'play', of: { types: ['Land'] }, from: 'graveyard' }]), 'You may play lands from your graveyard.'],
  ['no maximum hand size', statics([{ s: 'rule', rule: 'maxHandSize', player: you, value: 'none' }]), 'You have no maximum hand size.'],
  ['maximum hand size', statics([{ s: 'rule', rule: 'maxHandSize', player: you, value: 3 }]), 'Your maximum hand size is 3.'],
  ['two extra land plays', statics([{ s: 'rule', rule: 'landPlays', player: you, value: 2 }]), 'You may play two additional lands on each of your turns.'],
  // --- trigger modifier, costs, pregame
  ['additional cost', statics([{ s: 'additionalCost', cost: { other: [{ kind: 'sacrifice', filter: { types: ['Creature'] }, count: 1 }] } }], { zone: ['stack'] }), 'As an additional cost to cast Test Card, sacrifice a creature.'],
  ['optional additional cost', statics([{ s: 'additionalCost', cost: { other: [{ kind: 'discard', count: 1 }] }, optional: true }], { zone: ['stack'] }), 'As an additional cost to cast Test Card, you may discard a card.'],
  ['alternative cost', statics([{ s: 'alternativeCost', name: 'free', cost: { other: [{ kind: 'payLife', amount: 4 }] } }], { zone: ['stack'] }), "You may pay 4 life rather than pay Test Card's mana cost."],
  ['begin on the battlefield', statics([{ s: 'pregame', action: 'beginOnBattlefield', optional: true }], { zone: ['hand'] }), 'If Test Card is in your opening hand, you may begin the game with it on the battlefield.'],
];

describe('CR 602.1, 603.1, 604.1, 700.2, 714.2, 716.1: ability kinds print their Oracle wording and the gate accepts it', () => {
  it.each(abilityCases)('%s', (_name, def, expected) => {
    expect(renderAbility(def, ctx).join(' ')).toBe(expected);
    const r = renderGate(def, [expected], ctx);
    expect(r.ok, `${r.rendered}\n${r.expected}`).toBe(true);
  });
});

describe('CR 604.1, 611.2, 613.1, 614.1, 615.1, 601.2f: static effects print their Oracle wording and the gate accepts it', () => {
  it.each(staticCases)('%s', (name, def, expected) => {
    // FAST3 T12: "other creatures" (other than the source) is a creature's wording; on an Aura it means other than the enchanted creature, a different
    // filter (render/mods.ts#hostOther refuses it there), so that case is printed for a creature
    const types = name === 'other creatures' ? ['Creature'] : ['Aura', 'Enchantment'];
    expect(renderAbility(def, { ...ctx, selfTypes: types }).join(' ')).toBe(expected);
    const r = renderGate(def, [expected], { ...ctx, selfTypes: types });
    expect(r.ok, `${r.rendered}\n${r.expected}`).toBe(true);
    if (name === 'other creatures') expect(renderGate(def, [expected], { ...ctx, selfTypes: ['Aura', 'Enchantment'] }).ok).toBe(false);
  });

  it('renderStaticEffect prints a single effect without the period', () => {
    const e: StaticEffect = { s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'block' };
    expect(renderStaticEffect(e, ctx)).toBe("Test Card can't block");
  });
});

describe('CR 613.1a, 613.1b, 613.1c (layers 1a, 1b and 3, executed in milestone 6) already have their words', () => {
  const c = (id: string): TargetSpec => creature(id);
  it('a copy effect with an exception (layer 1a)', () => {
    const def: AbilityDef = { kind: 'spell', text: '', effect: { targets: [c('a')], steps: [{ op: 'effect', effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '1a', copyOf: t('a'), except: [{ layer: 4, types: { add: ['Artifact'] } }] }] }], duration: { d: 'permanent' } }] } };
    const text = renderAbility(def, ctx).join(' ');
    expect(text).toBe('Test Card becomes a copy of target creature, except it is an artifact in addition to its other types.');
  });
  it('face down (layer 1b) and text change (layer 3)', () => {
    const down: AbilityDef = { kind: 'spell', text: '', effect: { targets: [c('a')], steps: [{ op: 'effect', effects: [{ s: 'continuous', affects: t('a'), mods: [{ layer: '1b', faceDown: true }] }], duration: { d: 'endOfTurn' } }] } };
    expect(renderAbility(down, ctx).join(' ')).toBe('Target creature becomes face down until end of turn.');
    const words: AbilityDef = { kind: 'spell', text: '', effect: { targets: [c('a')], steps: [{ op: 'effect', effects: [{ s: 'continuous', affects: t('a'), mods: [{ layer: 3, changeWord: { from: 'red', to: 'blue', kind: 'color' } }] }], duration: { d: 'permanent' } }] } };
    expect(renderAbility(words, ctx).join(' ')).toBe('Target creature has its text changed so that each instance of the color word red is replaced by blue.');
  });
  it('switching power and toughness is an instruction', () => {
    const def: AbilityDef = { kind: 'spell', text: '', effect: { targets: [c('a')], steps: [{ op: 'effect', effects: [{ s: 'continuous', affects: t('a'), mods: [{ layer: '7d', switchPT: true }] }], duration: { d: 'endOfTurn' } }] } };
    expect(renderAbility(def, ctx).join(' ')).toBe("Switch target creature's power and toughness until end of turn.");
  });
});

describe('creature spells with targets keep the CR 608.2b ids across modes', () => {
  it('two modes with their own targets print each target once', () => {
    const def: AbilityDef = { kind: 'spell', text: '', effect: { targets: [], modes: { min: 2, max: 2, options: [
      { text: '', program: { targets: [creature('a')], steps: [{ op: 'tap', what: t('a') }] } },
      { text: '', program: { targets: [creature('b')], steps: [{ op: 'untap', what: t('b') }] } },
    ] }, steps: [] } };
    expect(renderAbility(def, ctx).join(' ')).toBe('Choose two -- • Tap target creature. • Untap target creature.');
  });
});
