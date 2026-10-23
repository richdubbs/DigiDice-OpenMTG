/**
 * WP4, rules/filter.ts: `matchesFilter` evaluates every field of `ObjectFilter` (design 3.3), one test per field, through the characteristics function.
 * A filter that cannot be evaluated never matches, and a `not` never turns that into "true".
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, ObjectFilter } from '../../../src/index';
import { filterCtxOf } from '../../../src/effects/refs';
import { filterForms } from '../../../src/model/forms';
import { findObjects, matchesFilter, SUPPORTED_FILTER_FIELDS, type FilterContext, NO_ENV } from '../../../src/rules/filter';
import { synth, activated, keyword } from '../helpers';
import { ctxOn, find, putOnStack, scenario } from './helpers';

const CARDS = ['Grizzly Bears', 'Serra Angel', 'Llanowar Elves', 'Elvish Visionary', 'Hill Giant', 'Plains', 'Island', 'Bonesplitter', 'Delver of Secrets // Insectile Aberration', 'Kitchen Finks', 'Wastes', 'Ornithopter'];

const triggerCreature: CardDef = synth({
  name: 'Test Trigger Guy', cost: '{1}{W}', type: 'Creature — Human Cleric', pt: ['1', '1'],
  abilities: [
    { kind: 'triggered', text: 'When this enters, x.', trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }] }, effect: { targets: [], steps: [] } },
    { kind: 'static', text: 'Static.', effects: [] },
    activated('{T}: x.', { tap: true }),
    keyword('flying'),
  ],
});
const legend: CardDef = synth({ name: 'Test Legend', cost: '{2}{U}{R}', type: 'Legendary Creature — Human Wizard', pt: ['3', '2'], abilities: [] });
const changeling: CardDef = synth({ name: 'Test Shifter', cost: '{1}{G}', type: 'Creature — Shapeshifter', pt: ['1', '1'], abilities: [keyword('changeling')] });
const drake: CardDef = synth({ name: 'Test Drake', cost: '{2}{U}', type: 'Creature — Drake', pt: ['2', '2'], abilities: [keyword('flying'), keyword('reach')] });

function board() {
  const s = scenario(CARDS, {
    p1: { battlefield: ['Grizzly Bears', 'Serra Angel', 'Llanowar Elves', 'Plains', 'Bonesplitter', 'Test Trigger Guy', 'Test Legend', 'Test Shifter', 'Test Drake', 'Kitchen Finks', 'Ornithopter', { name: 'Delver of Secrets // Insectile Aberration' }], hand: ['Elvish Visionary', 'Island'], graveyard: ['Hill Giant'] },
    p2: { battlefield: ['Hill Giant', 'Island', 'Wastes'] },
    defs: [triggerCreature, legend, changeling, drake],
  });
  const id = (name: string, zone: 'battlefield' | 'hand' | 'graveyard' = 'battlefield', owner = 'p1') => find(s, name, zone, owner);
  const obj = (name: string, zone: 'battlefield' | 'hand' | 'graveyard' = 'battlefield', owner = 'p1') => s.objects[id(name, zone, owner)]!;
  return { s, id, obj };
}

const ctx: FilterContext = { you: 'p1', env: NO_ENV };
const m = (b: ReturnType<typeof board>, name: string, f: ObjectFilter, c: FilterContext = ctx, zone: 'battlefield' | 'hand' | 'graveyard' = 'battlefield', owner = 'p1'): boolean =>
  matchesFilter(b.s, b.obj(name, zone, owner), f, c);

describe('ObjectFilter: zone, controller, owner (CR 109.4, 110.2, 108.3)', () => {
  const b = board();
  it('zone: a name, a list of names, "any"; absent means no constraint here (searches default to the battlefield, design 3.2)', () => {
    expect(m(b, 'Grizzly Bears', { zone: 'battlefield' })).toBe(true);
    expect(m(b, 'Grizzly Bears', { zone: 'graveyard' })).toBe(false);
    expect(m(b, 'Grizzly Bears', { zone: ['hand', 'battlefield'] })).toBe(true);
    expect(m(b, 'Grizzly Bears', { zone: 'any' })).toBe(true);
    expect(m(b, 'Elvish Visionary', {}, ctx, 'hand')).toBe(true);
    expect(findObjects(b.s, { types: ['Creature'] }, ctx).every((o) => o.zone === 'battlefield')).toBe(true);
    expect(findObjects(b.s, { zone: 'hand', types: ['Creature'] }, ctx).map((o) => o.defId)).toEqual(['Elvish Visionary']);
  });

  it('controller: you, opponent, any (CR 109.5)', () => {
    expect(m(b, 'Grizzly Bears', { controller: 'you' })).toBe(true);
    expect(m(b, 'Grizzly Bears', { controller: 'opponent' })).toBe(false);
    expect(m(b, 'Hill Giant', { controller: 'opponent' }, ctx, 'battlefield', 'p2')).toBe(true);
    expect(m(b, 'Hill Giant', { controller: 'you' }, ctx, 'battlefield', 'p2')).toBe(false);
    expect(m(b, 'Hill Giant', { controller: 'any' }, ctx, 'battlefield', 'p2')).toBe(true);
    expect(m(b, 'Hill Giant', { controller: 'you' }, { you: 'p2', env: NO_ENV }, 'battlefield', 'p2')).toBe(true); // relative to the controller of the ability
  });

  it('owner: you, opponent (a stolen creature is owned by someone else, CR 108.3)', () => {
    const t = board();
    t.obj('Grizzly Bears').controller = 'p2';
    expect(m(t, 'Grizzly Bears', { controller: 'opponent' })).toBe(true);
    expect(m(t, 'Grizzly Bears', { owner: 'you' })).toBe(true);
    expect(m(t, 'Grizzly Bears', { owner: 'opponent' })).toBe(false);
  });

  it('controller / owner as a reference (filter:controller.ref, filter:owner.ref): resolved through the filter environment', () => {
    const t = board();
    t.obj('Grizzly Bears').controller = 'p2';
    const withEnv: FilterContext = { you: 'p1', env: { ...NO_ENV, refs: (ref) => (ref.ref === 'anOpponent' ? { objects: [], players: ['p2'] } : undefined) } };
    expect(m(t, 'Grizzly Bears', { controller: { ref: 'anOpponent' } }, withEnv)).toBe(true);
    expect(m(t, 'Grizzly Bears', { owner: { ref: 'anOpponent' } }, withEnv)).toBe(false);
    expect(m(t, 'Grizzly Bears', { controller: { ref: 'anOpponent' } })).toBe(false); // no environment: cannot be resolved, so no match
    expect(m(t, 'Grizzly Bears', { not: { controller: { ref: 'anOpponent' } } })).toBe(false); // ... and a not never makes that true
    expect(m(t, 'Grizzly Bears', { controller: { ref: 'you' } }, { you: 'p2', env: NO_ENV })).toBe(true); // `you` and `active` need no environment
  });
});

describe('ObjectFilter: types, subtypes, supertypes (CR 205)', () => {
  const b = board();
  it('types: any of; allTypes: all of; notTypes: none of', () => {
    expect(m(b, 'Ornithopter', { types: ['Land', 'Artifact'] })).toBe(true);
    expect(m(b, 'Ornithopter', { allTypes: ['Artifact', 'Creature'] })).toBe(true);
    expect(m(b, 'Bonesplitter', { allTypes: ['Artifact', 'Creature'] })).toBe(false);
    expect(m(b, 'Ornithopter', { notTypes: ['Land', 'Enchantment'] })).toBe(true);
    expect(m(b, 'Ornithopter', { notTypes: ['Artifact'] })).toBe(false);
  });
  it('subtypes: any of; notSubtypes: none of', () => {
    expect(m(b, 'Llanowar Elves', { subtypes: ['Druid', 'Goblin'] })).toBe(true);
    expect(m(b, 'Llanowar Elves', { subtypes: ['Goblin'] })).toBe(false);
    expect(m(b, 'Llanowar Elves', { notSubtypes: ['Goblin'] })).toBe(true);
    expect(m(b, 'Llanowar Elves', { notSubtypes: ['Elf'] })).toBe(false);
  });
  it('supertypes: any of; notSupertypes: none of', () => {
    expect(m(b, 'Test Legend', { supertypes: ['Legendary'] })).toBe(true);
    expect(m(b, 'Grizzly Bears', { supertypes: ['Legendary'] })).toBe(false);
    expect(m(b, 'Plains', { supertypes: ['Basic'] })).toBe(true);
    expect(m(b, 'Plains', { notSupertypes: ['Basic'] })).toBe(false);
    expect(m(b, 'Test Legend', { notSupertypes: ['Snow'] })).toBe(true);
  });
});

describe('ObjectFilter: colors (CR 105, 202.2)', () => {
  const b = board();
  it('colors: any of; notColors: none of', () => {
    expect(m(b, 'Kitchen Finks', { colors: ['G'] })).toBe(true);
    expect(m(b, 'Kitchen Finks', { colors: ['R', 'W'] })).toBe(true);
    expect(m(b, 'Kitchen Finks', { colors: ['R'] })).toBe(false);
    expect(m(b, 'Kitchen Finks', { notColors: ['R'] })).toBe(true);
    expect(m(b, 'Kitchen Finks', { notColors: ['R', 'G'] })).toBe(false);
  });
  it('colorless, multicolored, monocolored (and their negations)', () => {
    expect(m(b, 'Ornithopter', { colorless: true })).toBe(true);
    expect(m(b, 'Ornithopter', { colorless: false })).toBe(false);
    expect(m(b, 'Grizzly Bears', { colorless: true })).toBe(false);
    expect(m(b, 'Kitchen Finks', { multicolored: true })).toBe(true);
    expect(m(b, 'Kitchen Finks', { monocolored: true })).toBe(false);
    expect(m(b, 'Grizzly Bears', { multicolored: true })).toBe(false);
    expect(m(b, 'Grizzly Bears', { monocolored: true })).toBe(true);
    expect(m(b, 'Grizzly Bears', { multicolored: false })).toBe(true);
    expect(m(b, 'Ornithopter', { monocolored: true })).toBe(false);
  });
});

describe('ObjectFilter: name, mana value, power, toughness (CR 201, 202.3, 208)', () => {
  const b = board();
  it('name / notName', () => {
    expect(m(b, 'Grizzly Bears', { name: 'Grizzly Bears' })).toBe(true);
    expect(m(b, 'Grizzly Bears', { name: 'Hill Giant' })).toBe(false);
    expect(m(b, 'Grizzly Bears', { notName: 'Hill Giant' })).toBe(true);
    expect(m(b, 'Grizzly Bears', { notName: 'Grizzly Bears' })).toBe(false);
  });
  it('manaValue, power, toughness compare with all six operators; no power fails to determine (false)', () => {
    expect(m(b, 'Serra Angel', { manaValue: { op: '==', value: 5 } })).toBe(true);
    expect(m(b, 'Serra Angel', { manaValue: { op: '<', value: 5 } })).toBe(false);
    expect(m(b, 'Serra Angel', { power: { op: '>=', value: 4 } })).toBe(true);
    expect(m(b, 'Serra Angel', { power: { op: '>', value: 4 } })).toBe(false);
    expect(m(b, 'Serra Angel', { toughness: { op: '<=', value: 4 } })).toBe(true);
    expect(m(b, 'Serra Angel', { toughness: { op: '!=', value: 4 } })).toBe(false);
    expect(m(b, 'Plains', { power: { op: '>=', value: 0 } })).toBe(false); // a land has no power
    expect(m(b, 'Plains', { power: { op: '<', value: 99 } })).toBe(false);
    expect(m(b, 'Wastes', { manaValue: { op: '==', value: 0 } }, ctx, 'battlefield', 'p2')).toBe(true);
  });
  it('a comparison against a quantity (filter:cmp.quantity) needs the filter environment and uses its answer; "fails to determine" is false', () => {
    const withEnv: FilterContext = { you: 'p1', env: { ...NO_ENV, qty: (q) => (typeof q === 'object' && q.q === 'X' ? 4 : undefined) } };
    expect(m(b, 'Serra Angel', { power: { op: '<=', value: { q: 'X' } } }, withEnv)).toBe(true);
    expect(m(b, 'Serra Angel', { power: { op: '<', value: { q: 'X' } } }, withEnv)).toBe(false);
    expect(m(b, 'Serra Angel', { power: { op: '<=', value: { q: 'speed' } } }, withEnv)).toBe(false); // the quantity fails to determine
    expect(m(b, 'Serra Angel', { power: { op: '<=', value: { q: 'X' } } })).toBe(false); // no environment
    expect(m(b, 'Serra Angel', { not: { power: { op: '<=', value: { q: 'X' } } } })).toBe(false);
  });
  it('the mana value of a spell on the stack includes the announced X (CR 202.3e)', () => {
    const s = scenario(['Fireball']);
    const id = putOnStack(s, { name: 'Fireball', x: 3 });
    expect(matchesFilter(s, s.objects[id]!, { manaValue: { op: '==', value: 4 } }, ctx)).toBe(true); // {X}{R} with X = 3
    s.objects[id]!.stack!.x = 0;
    expect(matchesFilter(s, s.objects[id]!, { manaValue: { op: '==', value: 1 } }, ctx)).toBe(true);
  });
});

describe('ObjectFilter: abilities (CR 702, 113.3)', () => {
  const b = board();
  it('keyword: a name, or a list (any of); notKeyword likewise', () => {
    expect(m(b, 'Serra Angel', { keyword: 'flying' })).toBe(true);
    expect(m(b, 'Serra Angel', { keyword: 'reach' })).toBe(false);
    expect(m(b, 'Test Drake', { keyword: ['reach', 'trample'] })).toBe(true);
    expect(m(b, 'Test Drake', { keyword: ['trample', 'menace'] })).toBe(false);
    expect(m(b, 'Grizzly Bears', { notKeyword: ['flying', 'reach'] })).toBe(true);
    expect(m(b, 'Test Drake', { notKeyword: ['flying', 'trample'] })).toBe(false);
    expect(m(b, 'Test Drake', { notKeyword: 'trample' })).toBe(true);
  });
  it('hasAbility: activated, mana (a mana ability is an activated ability, CR 605.1a), triggered, static', () => {
    expect(m(b, 'Llanowar Elves', { hasAbility: 'mana' })).toBe(true);
    expect(m(b, 'Llanowar Elves', { hasAbility: 'activated' })).toBe(true);
    expect(m(b, 'Llanowar Elves', { hasAbility: 'triggered' })).toBe(false);
    expect(m(b, 'Test Trigger Guy', { hasAbility: 'triggered' })).toBe(true);
    expect(m(b, 'Test Trigger Guy', { hasAbility: 'static' })).toBe(true);
    expect(m(b, 'Test Trigger Guy', { hasAbility: 'activated' })).toBe(true);
    expect(m(b, 'Test Trigger Guy', { hasAbility: 'mana' })).toBe(false);
    expect(m(b, 'Grizzly Bears', { hasAbility: 'activated' })).toBe(false);
  });
});

describe('ObjectFilter: status (CR 110.5, 111.1, 708, 712)', () => {
  it('tapped', () => {
    const b = board();
    b.obj('Grizzly Bears').tapped = true;
    expect(m(b, 'Grizzly Bears', { tapped: true })).toBe(true);
    expect(m(b, 'Grizzly Bears', { tapped: false })).toBe(false);
    expect(m(b, 'Serra Angel', { tapped: false })).toBe(true);
  });
  it('token and isCard: tokens are not cards (CR 111.1); absent matches both', () => {
    const b = board();
    b.obj('Grizzly Bears').kind = 'token';
    expect(m(b, 'Grizzly Bears', { token: true })).toBe(true);
    expect(m(b, 'Grizzly Bears', { isCard: true })).toBe(false);
    expect(m(b, 'Grizzly Bears', { isCard: false })).toBe(true);
    expect(m(b, 'Serra Angel', { token: true })).toBe(false);
    expect(m(b, 'Serra Angel', { token: false, isCard: true })).toBe(true);
    expect(m(b, 'Grizzly Bears', { types: ['Creature'] })).toBe(true);
  });
  it('faceDown', () => {
    const b = board();
    b.obj('Grizzly Bears').faceDown = true;
    expect(m(b, 'Grizzly Bears', { faceDown: true })).toBe(true);
    expect(m(b, 'Serra Angel', { faceDown: true })).toBe(false);
    expect(m(b, 'Serra Angel', { faceDown: false })).toBe(true);
  });
  it('transformed: a double-faced permanent on the battlefield with its back face up (CR 701.27g); not the front face', () => {
    const b = board();
    const delver = 'Delver of Secrets // Insectile Aberration';
    expect(m(b, delver, { transformed: false })).toBe(true);
    expect(m(b, delver, { transformed: true })).toBe(false);
    b.obj(delver).face = 1;
    expect(m(b, delver, { transformed: true })).toBe(true);
    expect(m(b, delver, { transformed: false })).toBe(false);
    expect(m(b, 'Grizzly Bears', { transformed: true })).toBe(false);
  });
  it('transformed (W3b audit, CR 701.27g, 712.1): a modal double-faced card is a double-faced card too; a melded permanent never is transformed', () => {
    const b = board();
    const delver = b.obj('Delver of Secrets // Insectile Aberration');
    delver.face = 1;
    const def = b.s.defs[delver.defId]!;
    b.s.defs = { ...b.s.defs, [delver.defId]: { ...def, layout: 'modal_dfc' } };
    expect(m(b, 'Delver of Secrets // Insectile Aberration', { transformed: true })).toBe(true); // a modal card played as its back face
    b.s.defs = { ...b.s.defs, [delver.defId]: { ...def, layout: 'double_faced_token' } };
    expect(m(b, 'Delver of Secrets // Insectile Aberration', { transformed: true })).toBe(true);
    b.s.defs = { ...b.s.defs, [delver.defId]: { ...def, layout: 'meld' } };
    expect(m(b, 'Delver of Secrets // Insectile Aberration', { transformed: true })).toBe(false); // CR 701.27g: melded permanents are excluded
  });
  it('isCopy: a copy of a spell (CR 707.10)', () => {
    const s = scenario(['Lightning Bolt', 'Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const bolt = putOnStack(s, { name: 'Lightning Bolt' });
    const copy = putOnStack(s, { name: 'Lightning Bolt' });
    s.objects[copy]!.kind = 'spellCopy';
    expect(matchesFilter(s, s.objects[copy]!, { isCopy: true }, ctx)).toBe(true);
    expect(matchesFilter(s, s.objects[bolt]!, { isCopy: true }, ctx)).toBe(false);
    expect(matchesFilter(s, s.objects[bolt]!, { isCopy: false }, ctx)).toBe(true);
    expect(matchesFilter(s, s.objects[copy]!, { isCard: true }, ctx)).toBe(false); // a copy of a spell is not a card
  });
});

describe('ObjectFilter: combat (CR 506-509)', () => {
  function inCombat() {
    const b = board();
    const bears = b.id('Grizzly Bears');
    const angel = b.id('Serra Angel');
    const giant = b.id('Hill Giant', 'battlefield', 'p2');
    b.s.combat = {
      number: 1,
      attacked: true, damageSteps: 0, extraDamageStep: false, firstStrikers: [],
      attackers: [
        { id: bears, defender: 'p2', defendingPlayer: 'p2', blockedBy: [giant], blocked: true },
        { id: angel, defender: 'p2', defendingPlayer: 'p2', blockedBy: [], blocked: false },
      ],
      blockers: [{ id: giant, blocking: [bears], defendingPlayer: 'p2' }],
    };
    return b;
  }
  it('attacking (a boolean) and blocking', () => {
    const b = inCombat();
    expect(m(b, 'Grizzly Bears', { attacking: true })).toBe(true);
    expect(m(b, 'Llanowar Elves', { attacking: true })).toBe(false);
    expect(m(b, 'Llanowar Elves', { attacking: false })).toBe(true);
    expect(m(b, 'Hill Giant', { blocking: true }, ctx, 'battlefield', 'p2')).toBe(true);
    expect(m(b, 'Grizzly Bears', { blocking: true })).toBe(false);
  });
  it('attacking { defender } (filter:attacking.defender): the player being attacked (CR 508.5)', () => {
    const b = inCombat();
    expect(m(b, 'Grizzly Bears', { attacking: { defender: 'opponent' } })).toBe(true);
    expect(m(b, 'Grizzly Bears', { attacking: { defender: 'you' } })).toBe(false);
    expect(m(b, 'Grizzly Bears', { attacking: { defender: 'you' } }, { you: 'p2', env: NO_ENV })).toBe(true);
    expect(m(b, 'Llanowar Elves', { attacking: { defender: 'any' } })).toBe(false); // not attacking at all
    const env: FilterContext = { you: 'p1', env: { ...NO_ENV, refs: (r) => (r.ref === 'anOpponent' ? { objects: [], players: ['p2'] } : undefined) } };
    expect(m(b, 'Grizzly Bears', { attacking: { defender: { ref: 'anOpponent' } } }, env)).toBe(true);
  });
  it('blocked: an attacker that was blocked stays blocked (CR 509.1h)', () => {
    const b = inCombat();
    expect(m(b, 'Grizzly Bears', { blocked: true })).toBe(true);
    expect(m(b, 'Serra Angel', { blocked: true })).toBe(false);
    expect(m(b, 'Serra Angel', { blocked: false })).toBe(true);
  });
});

describe('ObjectFilter: the source (self, other, is, attached, attachedToSource, counters)', () => {
  it('self and other relate the object to the source of the ability', () => {
    const b = board();
    const c: FilterContext = { you: 'p1', sourceId: b.id('Grizzly Bears'), env: NO_ENV };
    expect(m(b, 'Grizzly Bears', { self: true }, c)).toBe(true);
    expect(m(b, 'Serra Angel', { self: true }, c)).toBe(false);
    expect(m(b, 'Serra Angel', { self: false }, c)).toBe(true);
    expect(m(b, 'Grizzly Bears', { other: true }, c)).toBe(false);
    expect(m(b, 'Serra Angel', { other: true }, c)).toBe(true);
  });

  it('is: one of these specific objects, found through the environment (a fixed set, ObjRef "fixed")', () => {
    const b = board();
    const bears = b.id('Grizzly Bears');
    const env = (zone: 'battlefield' | 'graveyard'): FilterContext => ({ you: 'p1', env: { ...NO_ENV, refs: () => ({ objects: [{ id: bears, zone }], players: [] }) } });
    expect(m(b, 'Grizzly Bears', { is: { ref: 'bound', name: 'x' } }, env('battlefield'))).toBe(true);
    expect(m(b, 'Serra Angel', { is: { ref: 'bound', name: 'x' } }, env('battlefield'))).toBe(false);
    expect(m(b, 'Grizzly Bears', { is: { ref: 'bound', name: 'x' } }, env('graveyard'))).toBe(false); // the handle expects another zone: a different object (CR 400.7)
    expect(m(b, 'Grizzly Bears', { is: { ref: 'self' } }, { you: 'p1', sourceId: bears, env: NO_ENV })).toBe(true); // `self` needs no environment
  });

  it('attached: attached to something, or something is attached to it (CR 301.5, 303.4)', () => {
    const b = board();
    b.obj('Bonesplitter').attachedTo = b.id('Grizzly Bears');
    expect(m(b, 'Bonesplitter', { attached: true })).toBe(true);
    expect(m(b, 'Grizzly Bears', { attached: true })).toBe(true);
    expect(m(b, 'Serra Angel', { attached: true })).toBe(false);
    expect(m(b, 'Serra Angel', { attached: false })).toBe(true);
    expect(m(b, 'Grizzly Bears', { attached: false })).toBe(false);
  });

  it('attachedToSource: the object the source is attached to ("equipped creature", Sword of Fire and Ice)', () => {
    const b = board();
    b.obj('Bonesplitter').attachedTo = b.id('Grizzly Bears');
    const c: FilterContext = { you: 'p1', sourceId: b.id('Bonesplitter'), env: NO_ENV };
    expect(m(b, 'Grizzly Bears', { attachedToSource: true }, c)).toBe(true);
    expect(m(b, 'Serra Angel', { attachedToSource: true }, c)).toBe(false);
    expect(m(b, 'Serra Angel', { attachedToSource: false }, c)).toBe(true);
    expect(m(b, 'Grizzly Bears', { attachedToSource: true })).toBe(false); // no source
  });

  it('counters: at least one counter of the kind, or a comparison', () => {
    const b = board();
    b.obj('Grizzly Bears').counters = { '+1/+1': 2, charge: 1 };
    expect(m(b, 'Grizzly Bears', { counters: { kind: '+1/+1' } })).toBe(true);
    expect(m(b, 'Grizzly Bears', { counters: { kind: 'loyalty' } })).toBe(false);
    expect(m(b, 'Grizzly Bears', { counters: { kind: '+1/+1', cmp: { op: '>=', value: 2 } } })).toBe(true);
    expect(m(b, 'Grizzly Bears', { counters: { kind: '+1/+1', cmp: { op: '>', value: 2 } } })).toBe(false);
    expect(m(b, 'Serra Angel', { counters: { kind: 'charge', cmp: { op: '==', value: 0 } } })).toBe(true); // no counter is zero counters
    expect(m(b, 'Grizzly Bears', { counters: { kind: 'toString' } })).toBe(false); // counter names are data, not inherited members
  });
});

describe('ObjectFilter: sharesWith and chosen (CR 205.3m, 702.73a, 607)', () => {
  const b = board();
  const refTo = (...ids: string[]): FilterContext => ({ you: 'p1', env: { ...NO_ENV, refs: () => ({ objects: ids.map((id) => ({ id, zone: 'battlefield' as const })), players: [] }) } });
  const share = (name: string, with_: string, quality: 'creatureType' | 'color' | 'cardType' | 'name' | 'landType', owner = 'p1') =>
    m(b, name, { sharesWith: { with: { ref: 'bound', name: 'x' }, quality } }, refTo(b.id(with_, 'battlefield', owner)), 'battlefield', owner);

  it('creatureType: Elf and Druid share with Llanowar Elves; a Human does not; a land type is not a creature type', () => {
    expect(share('Test Shifter', 'Llanowar Elves', 'creatureType')).toBe(true); // changeling: every creature type (CR 702.73a)
    expect(share('Llanowar Elves', 'Test Shifter', 'creatureType')).toBe(true);
    expect(share('Test Legend', 'Test Trigger Guy', 'creatureType')).toBe(true); // both Human
    expect(share('Grizzly Bears', 'Llanowar Elves', 'creatureType')).toBe(false);
    expect(share('Plains', 'Llanowar Elves', 'creatureType')).toBe(false);
    expect(share('Ornithopter', 'Test Shifter', 'creatureType')).toBe(true); // Ornithopter is a Thopter (a creature type), the changeling shares it
    expect(share('Bonesplitter', 'Test Shifter', 'creatureType')).toBe(false); // Equipment is an artifact type, not a creature type
  });
  it('color, cardType, name, landType', () => {
    expect(share('Grizzly Bears', 'Llanowar Elves', 'color')).toBe(true);
    expect(share('Serra Angel', 'Llanowar Elves', 'color')).toBe(false);
    expect(share('Ornithopter', 'Bonesplitter', 'color')).toBe(false); // colorless shares no color
    expect(share('Ornithopter', 'Bonesplitter', 'cardType')).toBe(true); // Artifact
    expect(share('Grizzly Bears', 'Plains', 'cardType')).toBe(false);
    expect(share('Grizzly Bears', 'Grizzly Bears', 'name')).toBe(true);
    expect(share('Grizzly Bears', 'Serra Angel', 'name')).toBe(false);
    expect(m(b, 'Island', { sharesWith: { with: { ref: 'bound', name: 'x' }, quality: 'landType' } }, refTo(b.id('Island', 'battlefield', 'p2')), 'battlefield', 'p2')).toBe(true);
    expect(share('Plains', 'Plains', 'landType')).toBe(true);
    expect(m(b, 'Island', { sharesWith: { with: { ref: 'bound', name: 'x' }, quality: 'landType' } }, refTo(b.id('Plains')), 'battlefield', 'p2')).toBe(false);
  });
  it('an object that left is read from last known information; nothing to share with (or no environment) means no match', () => {
    const t = board();
    const giant = t.id('Hill Giant', 'battlefield', 'p2');
    const elf = t.id('Llanowar Elves');
    const shifter = t.id('Test Shifter');
    const gone = { ...t.s.objects[elf]! };
    t.s.lki[elf] = { object: gone, chars: null, leftZone: 'battlefield' };
    delete t.s.objects[elf];
    const env: FilterContext = { you: 'p1', env: { ...NO_ENV, refs: () => ({ objects: [{ id: elf, zone: 'battlefield' }], players: [] }) } };
    expect(matchesFilter(t.s, t.s.objects[shifter]!, { sharesWith: { with: { ref: 'bound', name: 'x' }, quality: 'color' } }, env)).toBe(true); // green: from last known information
    expect(matchesFilter(t.s, t.s.objects[giant]!, { sharesWith: { with: { ref: 'bound', name: 'x' }, quality: 'color' } }, { you: 'p1', env: { ...NO_ENV, refs: () => ({ objects: [], players: [] }) } })).toBe(false);
    expect(matchesFilter(t.s, t.s.objects[giant]!, { sharesWith: { with: { ref: 'bound', name: 'x' }, quality: 'color' } }, ctx)).toBe(false);
  });

  it('chosen: the quality a linked ability of the SOURCE chose (CR 607.2d); an undefined choice matches nothing (CR 607.5a)', () => {
    const t = board();
    const src = t.s.objects[t.id('Bonesplitter')]!;
    const c: FilterContext = { you: 'p1', sourceId: src.id, env: NO_ENV };
    const f = (quality: 'color' | 'creatureType' | 'cardType' | 'landType' | 'cardName'): ObjectFilter => ({ chosen: { link: 'q', quality } });
    expect(m(t, 'Llanowar Elves', f('creatureType'), c)).toBe(false); // nothing chosen yet
    src.links = { q: { values: ['Elf'] } };
    expect(m(t, 'Llanowar Elves', f('creatureType'), c)).toBe(true);
    expect(m(t, 'Grizzly Bears', f('creatureType'), c)).toBe(false);
    expect(m(t, 'Test Shifter', f('creatureType'), c)).toBe(true); // changeling
    src.links = { q: { values: ['green'] } };
    expect(m(t, 'Grizzly Bears', f('color'), c)).toBe(true);
    expect(m(t, 'Serra Angel', f('color'), c)).toBe(false);
    src.links = { q: { values: ['G'] } };
    expect(m(t, 'Grizzly Bears', f('color'), c)).toBe(true);
    src.links = { q: { values: ['Artifact'] } };
    expect(m(t, 'Ornithopter', f('cardType'), c)).toBe(true);
    expect(m(t, 'Grizzly Bears', f('cardType'), c)).toBe(false);
    src.links = { q: { values: ['Plains'] } };
    expect(m(t, 'Plains', f('landType'), c)).toBe(true);
    expect(m(t, 'Plains', f('cardName'), c)).toBe(true);
    expect(m(t, 'Grizzly Bears', f('cardName'), c)).toBe(false);
    expect(m(t, 'Plains', { chosen: { link: 'other', quality: 'cardName' } }, c)).toBe(false); // another link: not this one's choice
    expect(m(t, 'Plains', f('cardName'), { you: 'p1', env: NO_ENV })).toBe(false); // no source
  });
});

describe('ObjectFilter: stack objects (stackKind, targets, castFrom; CR 115.9b, 113.3)', () => {
  function stack() {
    const s = scenario(['Lightning Bolt', 'Grizzly Bears', 'Llanowar Elves'], { p1: { battlefield: ['Grizzly Bears', 'Llanowar Elves'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const bolt = putOnStack(s, { name: 'Lightning Bolt', targets: [[{ kind: 'object', id: bears }]], castFrom: 'hand' });
    const copy = putOnStack(s, { name: 'Lightning Bolt', targets: [[{ kind: 'player', id: 'p2' }]] });
    s.objects[copy]!.kind = 'spellCopy';
    const act = putOnStack(s, { name: 'Llanowar Elves', kind: 'activated', targets: [] });
    const trig = putOnStack(s, { name: 'Grizzly Bears', kind: 'triggered', targets: [[{ kind: 'object', id: bears }]] });
    return { s, bears, bolt, copy, act, trig };
  }
  it('stackKind: spell, activatedAbility, triggeredAbility, ability, copy; only objects on the stack', () => {
    const { s, bears, bolt, copy, act, trig } = stack();
    const k = (id: string, stackKind: NonNullable<ObjectFilter['stackKind']>) => matchesFilter(s, s.objects[id]!, { stackKind }, ctx);
    expect([k(bolt, 'spell'), k(copy, 'spell'), k(act, 'spell'), k(trig, 'spell')]).toEqual([true, true, false, false]);
    expect([k(bolt, 'ability'), k(act, 'ability'), k(trig, 'ability')]).toEqual([false, true, true]);
    expect([k(act, 'activatedAbility'), k(trig, 'activatedAbility'), k(act, 'triggeredAbility'), k(trig, 'triggeredAbility')]).toEqual([true, false, false, true]);
    expect([k(bolt, 'copy'), k(copy, 'copy')]).toEqual([false, true]);
    expect(k(bears, 'spell')).toBe(false);
  });
  it('an ability on the stack has no characteristics of its own (CR 113.7a): it is not a creature even if its source is', () => {
    const { s, act, trig } = stack();
    expect(matchesFilter(s, s.objects[act]!, { types: ['Creature'] }, ctx)).toBe(false);
    expect(matchesFilter(s, s.objects[trig]!, { colors: ['G'] }, ctx)).toBe(false);
    expect(matchesFilter(s, s.objects[trig]!, { colorless: true }, ctx)).toBe(true);
  });
  it('targets: a spell or ability that has the referenced object (or player) as a target (CR 115.9b)', () => {
    const { s, bears, bolt, copy, trig, act } = stack();
    const elves = find(s, 'Llanowar Elves', 'battlefield');
    const at = (_id: string, o: string, p: string[] = []): FilterContext => ({ you: 'p1', env: { ...NO_ENV, refs: () => ({ objects: [{ id: o, zone: 'battlefield' }], players: p }) } });
    expect(matchesFilter(s, s.objects[bolt]!, { targets: { ref: 'bound', name: 'x' } }, at(bolt, bears))).toBe(true);
    expect(matchesFilter(s, s.objects[bolt]!, { targets: { ref: 'bound', name: 'x' } }, at(bolt, elves))).toBe(false);
    expect(matchesFilter(s, s.objects[trig]!, { targets: { ref: 'bound', name: 'x' } }, at(trig, bears))).toBe(true);
    expect(matchesFilter(s, s.objects[copy]!, { targets: { ref: 'bound', name: 'x' } }, at(copy, elves, ['p2']))).toBe(true); // a player target
    expect(matchesFilter(s, s.objects[act]!, { targets: { ref: 'bound', name: 'x' } }, at(act, bears))).toBe(false); // no targets
    expect(matchesFilter(s, s.objects[bears]!, { targets: { ref: 'bound', name: 'x' } }, at(bears, bears))).toBe(false); // not on the stack
    expect(matchesFilter(s, s.objects[bolt]!, { targets: { ref: 'self' } }, { you: 'p1', sourceId: bears, env: NO_ENV })).toBe(true); // "spell that targets ~"
  });
  it('castFrom: the zone a spell was cast from, or a permanent was cast from', () => {
    const { s, bolt, copy, bears } = stack();
    expect(matchesFilter(s, s.objects[bolt]!, { castFrom: 'hand' }, ctx)).toBe(true);
    expect(matchesFilter(s, s.objects[bolt]!, { castFrom: 'graveyard' }, ctx)).toBe(false);
    expect(matchesFilter(s, s.objects[copy]!, { castFrom: 'hand' }, ctx)).toBe(false);
    s.objects[bears]!.cast = { costsPaid: {}, from: 'exile', turn: 1 };
    expect(matchesFilter(s, s.objects[bears]!, { castFrom: 'exile' }, ctx)).toBe(true);
  });
});

describe('ObjectFilter: anyOf and not (boolean structure)', () => {
  const b = board();
  it('anyOf: at least one alternative holds, ANDed with the other fields; an empty anyOf matches nothing', () => {
    expect(m(b, 'Serra Angel', { anyOf: [{ colors: ['R'] }, { keyword: 'flying' }] })).toBe(true);
    expect(m(b, 'Serra Angel', { anyOf: [{ colors: ['R'] }, { keyword: 'reach' }] })).toBe(false);
    expect(m(b, 'Serra Angel', { types: ['Creature'], anyOf: [{ colors: ['W'] }, { colors: ['U'] }] })).toBe(true);
    expect(m(b, 'Serra Angel', { types: ['Land'], anyOf: [{ colors: ['W'] }] })).toBe(false);
    expect(m(b, 'Serra Angel', { anyOf: [] })).toBe(false);
  });
  it('not: the inner filter must not hold ("creature you don\'t control" differs from "an opponent controls")', () => {
    expect(m(b, 'Serra Angel', { not: { colors: ['W'] } })).toBe(false);
    expect(m(b, 'Serra Angel', { not: { colors: ['B'] } })).toBe(true);
    expect(m(b, 'Serra Angel', { types: ['Creature'], not: { controller: 'you' } })).toBe(false);
    expect(m(b, 'Hill Giant', { types: ['Creature'], not: { controller: 'you' } }, ctx, 'battlefield', 'p2')).toBe(true);
  });
});

describe('a field this build does not know never matches', () => {
  const b = board();
  it('an unknown field, alone or inside anyOf / not, is "cannot evaluate": false, never "approximately right" (design D2)', () => {
    const odd = { madeUpField: true } as unknown as ObjectFilter;
    expect(m(b, 'Grizzly Bears', odd)).toBe(false);
    expect(m(b, 'Grizzly Bears', { anyOf: [odd, { types: ['Creature'] }] })).toBe(false);
    expect(m(b, 'Grizzly Bears', { not: odd })).toBe(false);
    expect(m(b, 'Grizzly Bears', { madeUpField: undefined } as unknown as ObjectFilter)).toBe(true); // an absent value is no constraint
  });
  it('findObjects returns the matches in zone order and ignores a filter it cannot evaluate', () => {
    expect(findObjects(b.s, { types: ['Creature'], controller: 'you', colors: ['G'] }, ctx).map((o) => o.defId)).toEqual(['Grizzly Bears', 'Llanowar Elves', 'Test Shifter', 'Kitchen Finks']);
    expect(findObjects(b.s, { madeUpField: true } as unknown as ObjectFilter, ctx)).toEqual([]);
  });
});

describe('the capability names of the filter (design 5.2)', () => {
  it('every field of ObjectFilter and every value form is evaluated and advertised: the history ones since WP8 writes the history, those that need a context since WP30 passes one at every call site (test/m5/eval/wp30-filter-env.test.ts)', () => {
    const everywhere = ['anyOf', 'not', 'zone', 'controller', 'owner', 'types', 'allTypes', 'notTypes', 'subtypes', 'notSubtypes', 'supertypes', 'notSupertypes', 'colors', 'notColors', 'colorless',
      'multicolored', 'monocolored', 'name', 'notName', 'manaValue', 'power', 'toughness', 'keyword', 'notKeyword', 'hasAbility', 'tapped', 'token', 'isCard', 'faceDown', 'transformed', 'isCopy',
      'attacking', 'blocking', 'blocked', 'self', 'other', 'attached', 'attachedToSource', 'counters', 'chosen', 'stackKind', 'castFrom', 'keyword.list', 'notKeyword.list'];
    const needContext = ['is', 'sharesWith', 'targets', 'controller.ref', 'owner.ref', 'attacking.defender', 'cmp.quantity'];
    const history = ['enteredThisTurn', 'dealtDamageThisTurn', 'attackedThisTurn', 'blockedThisTurn'];
    for (const field of [...everywhere, ...history]) expect(SUPPORTED_FILTER_FIELDS.has(field), field).toBe(true);
    for (const field of needContext) expect(SUPPORTED_FILTER_FIELDS.has(field), field).toBe(true); // WP30
    for (const form of filterForms({ controller: { ref: 'you' }, owner: { ref: 'you' }, keyword: ['a'], notKeyword: ['b'], attacking: { defender: 'you' }, power: { op: '<', value: { q: 'X' } } })) {
      expect(everywhere.includes(form.slice('filter:'.length)) || needContext.includes(form.slice('filter:'.length)), form).toBe(true); // every form the model has a name for is known here
    }
  });
});

describe('the filter context of a resolution (filterCtxOf)', () => {
  it('"you" is the controller of the resolving object and "this" its source', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const cx = ctxOn(s, find(s, 'Grizzly Bears', 'battlefield'));
    expect(filterCtxOf(cx)).toMatchObject({ you: 'p1', sourceId: find(s, 'Grizzly Bears', 'battlefield') });
    const t = board();
    expect(findObjects(t.s, { types: ['Creature'], controller: 'opponent', other: true }, filterCtxOf(ctxOn(t.s, t.id('Grizzly Bears')))).map((o) => o.defId)).toEqual(['Hill Giant']);
  });
});
