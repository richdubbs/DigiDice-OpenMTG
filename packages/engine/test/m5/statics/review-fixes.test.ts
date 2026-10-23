/**
 * The review of WP9: one group of tests per finding, each named after the rule it pins. Written BEFORE the fixes (they failed on the reviewed commit).
 *
 *   CR 613.7a  an ability granted in layer 6 whose own effect is in layer 6 (Rune of Flight on Colossus Hammer); the relative order of the effects of an
 *              object's own and granted abilities survives a new timestamp
 *   CR 613.7n  a static ability's effect before a resolved effect on equal timestamps; ties among resolved effects follow creation order
 *   CR 613.8a  a layer 2 effect that reads "you" depends on the effect that changes who "you" is
 *   CR 613.8b  only the effects IN a dependency loop go in timestamp order; an effect that depends on the loop waits for it
 *   CR 611.2b  "for as long as you control X" is judged with the controller after layer 2
 *   CR 122.1a  a +X/+Y counter works on a creature card in any zone
 *   CR 208.5   a creature that lost its characteristic-defining ability has power/toughness 0
 *   CR 602.2   a granted activated ability resolves from the stack
 *   CR 613.1b  layer 2 reaches the rules code (tracked: the consumers of the stored controller are integration work)
 */
import { describe, expect, it } from 'vitest';
import { getChars, hasKeyword, legalActions, type AbilityDef, type GameState, type ObjectId } from '../../../src/index';
import { SUPPORTED_FILTER_FIELDS } from '../../../src/rules/filter';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { controllerOf } from '../../../src/rules/characteristics';
import { computeAll, LAYER_STATS } from '../../../src/statics/layers';
import { STATIC_CONDITION_KINDS, STATIC_FILTER_FIELDS, STATIC_OBJREF_KINDS, STATIC_QUANTITY_KINDS, STATIC_STATUS_FIELDS } from '../../../src/statics/match';
import { abilityDefOnStack } from '../../../src/rules/abilities';
import { act, activated, pass, scenario } from '../helpers';
import { artifact, board, continuous, creature, each, enchantment, find, fixedOn, land, nth, SELF, staticOf, tweak, withEffect } from './fixtures';

const FLYING: AbilityDef = { kind: 'keyword', text: 'Flying', keyword: 'flying' };
const pt = (s: GameState, id: ObjectId): string => `${getChars(s, id).power}/${getChars(s, id).toughness}`;
const setTs = (s: GameState, id: ObjectId, ts: number): GameState => tweak(s, (t) => { t.objects[id]!.timestamp = ts; });
const attach = (s: GameState, what: ObjectId, to: ObjectId): GameState => tweak(s, (t) => { t.objects[what]!.attachedTo = to; });

describe('CR 613.7a: an ability granted in layer 6 produces its layer 6 effect too (Rune of Flight on Colossus Hammer)', () => {
  const HAMMER = artifact('Test Hammer', '{3}', [staticOf('Equipped creature gets +10/+10 and loses flying.', [continuous({ ref: 'attachedTo' }, [{ layer: 6, remove: ['flying'] }, { layer: '7c', power: 10, toughness: 10 }])])], 'Artifact — Equipment');
  const GRANTED = staticOf('Equipped creature has flying.', [continuous({ ref: 'attachedTo' }, [{ layer: 6, add: [FLYING] }])]);
  const RUNE = enchantment('Test Rune', '{U}', [staticOf('Enchanted Equipment has "Equipped creature has flying."', [continuous({ ref: 'attachedTo' }, [{ layer: 6, add: [GRANTED] }])])], 'Enchantment — Aura');
  const FLYER = creature('Test Flyer', '2', '2', [FLYING]);

  function rig(runeTs: number): { s: GameState; bear: ObjectId } {
    let s = board([HAMMER, RUNE, FLYER], ['Test Flyer', 'Test Hammer', 'Test Rune']);
    const [bear, hammer, rune] = [nth(s, 'Test Flyer'), nth(s, 'Test Hammer'), nth(s, 'Test Rune')];
    s = setTs(setTs(setTs(s, bear, 5), hammer, 10), rune, runeTs);
    return { s: attach(attach(s, hammer, bear), rune, hammer), bear };
  }

  it('the granted ability shares Rune of Flight\'s later timestamp, so it applies after "loses flying": the creature has flying (and the +10/+10 still applies)', () => {
    const { s, bear } = rig(20);
    expect(hasKeyword(getChars(s, bear), 'flying')).toBe(true);
    expect(pt(s, bear)).toBe('12/12');
  });

  it('a layer 6 grant of "creatures you control have flying" gives the OTHER creatures flying', () => {
    const lordAbility = staticOf('Creatures you control have flying.', [continuous(each({ types: ['Creature'], controller: 'you' }), [{ layer: 6, add: [FLYING] }])]);
    let s = board([creature('Test Bear', '2', '2')], ['Test Bear', 'Test Bear']);
    const [a, b] = [nth(s, 'Test Bear', 0), nth(s, 'Test Bear', 1)];
    s = withEffect(s, continuous(fixedOn(s, a), [{ layer: 6, add: [lordAbility] }]));
    expect(hasKeyword(getChars(s, a), 'flying')).toBe(true);
    expect(hasKeyword(getChars(s, b), 'flying')).toBe(true);
  });

  it('the chain: creatures you control have "creatures you control have flying"', () => {
    const inner = staticOf('Creatures you control have flying.', [continuous(each({ types: ['Creature'], controller: 'you' }), [{ layer: 6, add: [FLYING] }])]);
    const outer = staticOf('Creatures you control have "Creatures you control have flying."', [continuous(each({ types: ['Creature'], controller: 'you' }), [{ layer: 6, add: [inner] }])]);
    const s = board([creature('Test Chain Lord', '2', '2', [outer]), creature('Test Bear', '2', '2')], ['Test Chain Lord', 'Test Bear']);
    expect(hasKeyword(getChars(s, nth(s, 'Test Bear')), 'flying')).toBe(true);
    expect(hasKeyword(getChars(s, nth(s, 'Test Chain Lord')), 'flying')).toBe(true);
  });
});

describe('CR 613.7a: a new timestamp keeps the relative order of an object\'s own and granted effects', () => {
  const BANNER = artifact('Test Banner', '{2}', [staticOf('Equipped creature has base power and toughness 5/5.', [continuous({ ref: 'attachedTo' }, [{ layer: '7b', power: 5, toughness: 5 }])])], 'Artifact — Equipment');
  const SLEEVE = enchantment('Test Sleeve', '{U}', [staticOf('Enchanted Equipment has "Equipped creature has base power and toughness 1/1."', [continuous({ ref: 'attachedTo' }, [{ layer: 6, add: [staticOf('Equipped creature has base power and toughness 1/1.', [continuous({ ref: 'attachedTo' }, [{ layer: '7b', power: 1, toughness: 1 }])])] }])])], 'Enchantment — Aura');

  it('the granted 1/1 beats the Banner\'s own 5/5 (it is later), and still does after the Banner is re-attached and gets a newer timestamp than the Aura (613.7e)', () => {
    let s = board([BANNER, SLEEVE, creature('Test Bear', '2', '2')], ['Test Bear', 'Test Banner', 'Test Sleeve']);
    const [bear, banner, sleeve] = [nth(s, 'Test Bear'), nth(s, 'Test Banner'), nth(s, 'Test Sleeve')];
    s = attach(attach(setTs(setTs(setTs(s, bear, 5), banner, 10), sleeve, 20), banner, bear), sleeve, banner);
    expect(pt(s, bear)).toBe('1/1');
    s = setTs(s, banner, 30);
    expect(pt(s, bear)).toBe('1/1');
  });
});

describe('CR 613.7n and 613.7: ties between equal timestamps', () => {
  it('613.7n: the effect of an object\'s own static ability gets the earlier relative timestamp, a resolved effect with the same timestamp applies after it', () => {
    const setter = creature('Test Setter', '9', '9', [staticOf('Other creatures have base power and toughness 4/4.', [continuous(each({ types: ['Creature'], other: true }), [{ layer: '7b', power: 4, toughness: 4 }])])]);
    let s = board([setter, creature('Test Bear', '2', '2')], ['Test Setter', 'Test Bear']);
    const [setterId, bear] = [nth(s, 'Test Setter'), nth(s, 'Test Bear')];
    s = withEffect(s, continuous(fixedOn(s, bear), [{ layer: '7b', power: 1, toughness: 1 }]));
    s = tweak(s, (t) => { t.continuousEffects[0]!.timestamp = t.objects[setterId]!.timestamp; });
    expect(pt(s, bear)).toBe('1/1');
  });

  it('two resolved effects with the same timestamp follow creation order by the NUMBER in the id (e9 before e10)', () => {
    let s = board([creature('Test Bear', '2', '2')], ['Test Bear']);
    const id = nth(s, 'Test Bear');
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: '7b', power: 5, toughness: 5 }]));
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: '7b', power: 7, toughness: 7 }]));
    s = tweak(s, (t) => { t.continuousEffects[0]!.id = 'e9'; t.continuousEffects[1]!.id = 'e10'; for (const e of t.continuousEffects) e.timestamp = 100; });
    expect(pt(s, id)).toBe('7/7');
  });
});

describe('CR 613.8a: layer 2 reads "you" (the controller of the effect\'s source)', () => {
  const STEAL = enchantment('Test Steal', '{3}{U}{U}', [staticOf('You control enchanted creature.', [continuous({ ref: 'attachedTo' }, [{ layer: 2, controller: { ref: 'you' } }])])], 'Enchantment — Aura');

  it.each([['the Aura is older than the effect that steals it', 1], ['the Aura is newer', 1000]])('%s: stealing the Aura first means the Aura\'s effect gives the creature to its NEW controller', (_n, auraTs) => {
    let s = board([creature('Test Bear', '2', '2'), STEAL], ['Test Steal'], ['Test Bear']);
    const [bear, aura] = [nth(s, 'Test Bear'), nth(s, 'Test Steal')];
    s = setTs(attach(s, aura, bear), aura, auraTs);
    expect(getChars(s, bear).controller).toBe('p1'); // the Aura\'s controller steals it
    s = withEffect(s, continuous(fixedOn(s, aura), [{ layer: 2, controller: { ref: 'fixed', players: ['p2'] } }]), { controller: 'p2' });
    expect(getChars(s, aura).controller).toBe('p2');
    expect(getChars(s, bear).controller).toBe('p2');
  });
});

describe('CR 613.8b: only the effects in a loop go in timestamp order; an effect that depends on the loop waits for it', () => {
  it('D (oldest) depends on the loop A <-> B: the order is A, B, D', () => {
    const D = enchantment('Test Bulwark', '{1}', [staticOf('Creatures with power 3 or more get +0/+5.', [continuous(each({ types: ['Creature'], power: { op: '>=', value: 3 } }), [{ layer: '7c', power: 0, toughness: 5 }])])]);
    const A = enchantment('Test Rise', '{1}', [staticOf('Creatures with power 2 or less get +1/+0.', [continuous(each({ types: ['Creature'], power: { op: '<=', value: 2 } }), [{ layer: '7c', power: 1, toughness: 0 }])])]);
    const B = enchantment('Test Fall', '{1}', [staticOf('Creatures with power 3 or more get -1/+0.', [continuous(each({ types: ['Creature'], power: { op: '>=', value: 3 } }), [{ layer: '7c', power: -1, toughness: 0 }])])]);
    const s = board([D, A, B, creature('Test Two', '2', '2'), creature('Test Three', '3', '3')], ['Test Bulwark', 'Test Rise', 'Test Fall', 'Test Two', 'Test Three']);
    expect([pt(s, nth(s, 'Test Two')), pt(s, nth(s, 'Test Three'))]).toEqual(['2/2', '2/3']);
  });
});

describe('CR 611.2b, 613.1b: "for as long as you control X" is judged with the controller after layer 2', () => {
  it('Aladdin-like: when a newer effect takes the source away, the effect that depended on controlling it ends and the target goes back', () => {
    const aladdin = creature('Test Aladdin', '1', '1');
    let s = board([aladdin, creature('Test Bear', '2', '2')], ['Test Aladdin'], ['Test Bear']);
    const [source, bear] = [nth(s, 'Test Aladdin'), nth(s, 'Test Bear')];
    s = withEffect(s, continuous(fixedOn(s, bear), [{ layer: 2, controller: { ref: 'fixed', players: ['p1'] } }]), { source, controller: 'p1', duration: { d: 'whileSource', as: 'controlled' } });
    expect(getChars(s, bear).controller).toBe('p1');
    s = withEffect(s, continuous(fixedOn(s, source), [{ layer: 2, controller: { ref: 'fixed', players: ['p2'] } }]), { controller: 'p2' });
    expect(getChars(s, source).controller).toBe('p2');
    expect(getChars(s, bear).controller).toBe('p2'); // p1 no longer controls Aladdin: the effect ended
  });
});

describe('CR 122.1a: a +X/+Y counter works on a creature card in any zone', () => {
  it('a creature card in the graveyard with a +1/+1 counter has the bonus; a -1/-1 counter subtracts', () => {
    const s = board([creature('Test Bear', '2', '2')], ['Test Bear']);
    const id = nth(s, 'Test Bear');
    const gy = tweak(s, (t) => {
      const o = t.objects[id]!;
      o.zone = 'graveyard'; o.counters = { '+1/+1': 1 };
      t.zones.battlefield = t.zones.battlefield.filter((x) => x !== id);
      t.zones.graveyard['p1']!.push(id);
    });
    expect(pt(gy, id)).toBe('3/3');
    const minus = tweak(gy, (t) => { t.objects[id]!.counters = { '-1/-1': 1 }; });
    expect(pt(minus, id)).toBe('1/1');
  });
});

describe('CR 208.5, 208.2a: a "*" creature that lost its characteristic-defining ability has power and toughness 0', () => {
  const count = { q: 'count', of: each({ types: ['Land'], controller: 'you' }) } as const;
  const STAR = creature('Test Star', '*', '*', [staticOf('Test Star\'s power and toughness are each equal to the number of lands you control.', [continuous(SELF, [{ layer: '7a', power: count, toughness: count }], true)])]);

  it('with the ability it is the number of lands; after "loses all abilities" it is 0/0', () => {
    let s = board([STAR], ['Test Star', 'Plains', 'Plains']);
    const id = nth(s, 'Test Star');
    expect(pt(s, id)).toBe('2/2');
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: 6, removeAll: true }]));
    expect(pt(s, id)).toBe('0/0');
  });

  it('a +1/+1 counter on the creature that lost its definition makes it 1/1 (layer 7c comes after the 0 of 7a)', () => {
    let s = board([STAR], ['Test Star', 'Plains']);
    const id = nth(s, 'Test Star');
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: 6, removeAll: true }]));
    s = tweak(s, (t) => { t.objects[id]!.counters = { '+1/+1': 1 }; });
    expect(pt(s, id)).toBe('1/1');
  });

  it('a "*" that never had a definition the engine understands stays "*" (an unreadable line may be the definition: the card is manual, never silently 0/0)', () => {
    const s = scenario([], { p1: { hand: ['Test Odd Star'] }, defs: [creature('Test Odd Star', '*', '*')] });
    expect(pt(s, find(s, 'Test Odd Star', 'hand'))).toBe('*/*');
  });
});

describe('CR 602.2, 608: a granted activated ability that uses the stack can be activated and resolves', () => {
  it('activating it puts an ability on the stack; both players passing resolves it without an engine error, and the definition is found again', () => {
    let s = board([creature('Test Bear', '2', '2')], ['Test Bear']);
    const id = nth(s, 'Test Bear');
    const noop = activated('Do nothing.', {}) as AbilityDef;
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: 6, add: [noop] }]));
    const key = `g:${s.continuousEffects[0]!.id}:0`;
    s = act(s, { type: 'activate', player: 'p1', source: id, ability: key });
    const onStack = s.objects[s.zones.stack[0]!]!;
    expect(abilityDefOnStack(s, onStack)).toMatchObject({ kind: 'activated', text: 'Do nothing.' });
    s = pass(pass(s));
    expect(s.zones.stack).toEqual([]);
  });

  it('the definition is still found after the source lost the granting effect (the ability on the stack exists independently of its source, CR 113.7a)', () => {
    let s = board([creature('Test Bear', '2', '2')], ['Test Bear']);
    const id = nth(s, 'Test Bear');
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: 6, add: [activated('Do nothing.', {}) as AbilityDef] }]));
    const key = `g:${s.continuousEffects[0]!.id}:0`;
    s = act(s, { type: 'activate', player: 'p1', source: id, ability: key });
    s = tweak(s, (t) => { t.continuousEffects = []; });
    expect(abilityDefOnStack(s, s.objects[s.zones.stack[0]!]!)).toMatchObject({ kind: 'activated', text: 'Do nothing.' });
    s = pass(pass(s));
    expect(s.zones.stack).toEqual([]);
  });
});

describe('CR 613.1b: layer 2 and the rules code', () => {
  const manaBear = creature('Test Mana Bear', '1', '1', [activated('{T}: Add {G}.', { tap: true }) as AbilityDef]);
  const stolen = (): { s: GameState; id: ObjectId } => {
    let s = board([manaBear], [], ['Test Mana Bear']);
    const id = nth(s, 'Test Mana Bear');
    s = tweak(s, (t) => { t.objects[id]!.controlledSinceTurn = 0; });
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: 2, controller: { ref: 'fixed', players: ['p1'] } }]));
    return { s, id };
  };

  it('controllerOf(s, o) answers with the layered controller (the helper the consumers of the stored controller switch to)', () => {
    const { s, id } = stolen();
    expect(controllerOf(s, id)).toBe('p1');
    expect(controllerOf(s, s.objects[id]!)).toBe('p1');
    expect(s.objects[id]!.controller).toBe('p2');
    const plain = board([manaBear], [], ['Test Mana Bear']);
    expect(controllerOf(plain, nth(plain, 'Test Mana Bear'))).toBe('p2');
  });

  // TRACKED GAP (integration, not WP9): the milestone 3/4 rules code still reads the stored `GameObject.controller` (actions/activate.ts, core/legal.ts,
  // rules/combat-rules.ts, rules/mana.ts, rules/sources.ts, rules/timing.ts, core/sba-objects.ts, rules/filter.ts, keywords/hooks/index.ts). `it.fails` turns RED
  // when the consumers are switched to `controllerOf`: then change it to a plain `it`.
  it.fails('a stolen mana creature can be activated by its new controller and not by the old one (consumers of the stored controller not yet switched)', () => {
    const { s, id } = stolen();
    const can = (p: string): boolean => legalActions(s, p).some((a) => a.action.type === 'activate' && a.action.source === id);
    expect(can('p1')).toBe(true);
    expect(can('p2')).toBe(false);
  });
});

describe('design 5.2: the static side of the capability tables', () => {
  it('every filter field, quantity, condition and reference kind the layer system evaluates has an `s...` capability; the ones it does not evaluate have none', () => {
    for (const f of STATIC_FILTER_FIELDS) expect(ENGINE_CAPABILITIES.has(`sfilter:${f}`)).toBe(true);
    for (const f of STATIC_QUANTITY_KINDS) expect(ENGINE_CAPABILITIES.has(`sq:${f}`)).toBe(true);
    for (const f of STATIC_CONDITION_KINDS) expect(ENGINE_CAPABILITIES.has(`scond:${f}`)).toBe(true);
    for (const f of STATIC_OBJREF_KINDS) expect(ENGINE_CAPABILITIES.has(`sref:${f}`)).toBe(true);
    for (const f of ['enteredThisTurn', 'dealtDamageThisTurn', 'blockedThisTurn', 'targets']) expect(ENGINE_CAPABILITIES.has(`sfilter:${f}`), f).toBe(false);
    expect(ENGINE_CAPABILITIES.has('sfilter:attackedThisTurn')).toBe(true); // FAST5X E28: read from the turn's history (CR 508.1, 611.3a)
    expect(ENGINE_CAPABILITIES.has('sfilter:castFrom')).toBe(true); // std-rf: "spells you cast from your hand" (statics/match.ts)
    expect(ENGINE_CAPABILITIES.has('sfilter:stackKind')).toBe(true); // FAST4 T24: "spells you cast" (statics/match.ts#stackKindOk)
    for (const f of ['var', 'eventAmount']) expect(ENGINE_CAPABILITIES.has(`sq:${f}`), f).toBe(false);
    expect(ENGINE_CAPABILITIES.has('sq:happenedCount')).toBe(true); // CLOUD std-ecl: a count of the game's history (statics/match.ts#evalQuantity, CR 611.3a)
  });

  // The general tables (WP4) may know more than the layer system. A field it does not evaluate is NOT a static capability (the `sfilter:` capability above is missing,
  // so `degrade` keeps it out of a static ability); this pin lists the known difference so that a new one is a decision, not an accident.
  it('the filter fields the general table supports beyond the layer system are only the known ones (history, stack and cast fields, spell copies, keyword lists)', () => {
    const known = ['enteredThisTurn', 'dealtDamageThisTurn', 'dealtDamageBySourceThisTurn' /* FAST3 T14 */, 'controllerDealtCombatDamageBySourceThisTurn' /* FAST5 T66 */, 'blockingObject' /* FAST3 T18 */, 'blockedThisTurn', 'stackKind', 'targets', 'abilitySource' /* FAST5 T45 */, 'targetsOnly' /* FAST5 T45 */, 'targetCount' /* FAST5 T45 */, 'adventure' /* FAST5 T49: a card's definition, CR 715.1 */, 'manaCostHasX' /* FAST5X E23, CR 107.3: a spell's mana cost, read by mana spending restrictions */, 'isCopy', 'keyword.list', 'notKeyword.list', // the last three are WP4's, added after WP9 was written
      'warped', // std-costs-2 (CR 702.185a): a card in exile, read by costs and targets, never by a static ability's continuous effect
      'controller.ref', 'owner.ref', 'attacking.defender', 'cmp.quantity', 'attacking.orPlaneswalker' /* std-combat-1 */, // advertised by WP30 (a FilterEnv at every call site); inside a static ability they need sfilter:, which the layers do not claim
      'dealtDamageAsSourceThisTurn' /* CLOUD std-mkm: a history field (rules/history.ts), "a creature that dealt damage this turn", CR 120.1 */,
      'putThereThisTurn' /* r3-choose: a history field (rules/history.ts), "a card in your graveyard that was put there from anywhere this turn", CR 400.7 */,
      'toughnessGreaterThanPower' /* Standard round 4, r4-trig: the object's own two values (CR 208.1); a static ability does not read it (statics/match.ts), so it stays manual there */,
      'totalPowerToughness' /* std-rx10: the sum of the object's own power and toughness (CR 208.1); a static ability does not read it (statics/match.ts), so it stays manual there */,
      'crewedBySourceThisTurn', 'enteredFrom' /* Standard round 5, r5-trig: history fields (rules/history.ts), CR 702.122c, 603.6a */, 'castWithMana' /* r5-trig: the cast record (CR 601.2h) */, 'manaSymbols' /* r5-trig: the mana cost (CR 107.4); no static ability reads it */,
      'putThereFrom' /* r5-fxz: with putThereThisTurn, "... from the battlefield this turn", CR 400.7 */, 'lockedDoor' /* r5-fxz: a Room with a locked door, CR 709.5c */,
      'doubleFaced' /* std-rx31: a card's layout, "a double-faced card", CR 712.1; a static ability does not read it (statics/match.ts), so it stays manual there */,
      'powerGreaterThanBase' /* std-rx11: power against base power after layer 7b (CR 208.1, 613.4); a static ability does not read it (statics/match.ts), so it stays manual there */,
      'targetedBy' /* std-rx28: the objects a spell or ability targets (CR 115.9b), read in an effect's group; a static ability does not read it (statics/match.ts), so it stays manual there */,
      'prepareSpell' /* std-copy-2: "a prepared spell", a spell cast from a prepared card (CR 722.3c-d), read by a cast trigger's filter; a static ability does not read it, so it stays manual there */,
      'emblem' /* std-typechange-2: an emblem (CR 114.1), read in a triggerMod's abilitiesOf (triggers/collect.ts); a static ability does not read it (statics/match.ts), so it stays manual there */];
    // M6-0: the status fields (solved, prepared, prototyped, flipped) are advertised by their owners (rules/registries.ts#FILTER_PARTS) and read in the layers as
    // STATIC_STATUS_FIELDS (sfilter:, advertised the same way; M6-4: flipped)
    expect([...SUPPORTED_FILTER_FIELDS].filter((f) => !STATIC_FILTER_FIELDS.has(f) && !STATIC_STATUS_FIELDS.has(f) && !known.includes(f))).toEqual([]);
  });
});

describe('design 9.3: the dependency loop does not trial-apply effects that cannot change an ability\'s existence', () => {
  it('eight lords that only ADD abilities and +1/+1 over 40 creatures need no trial application at all', () => {
    const lord = (n: number) => creature(`Test Lord ${n}`, '2', '2', [staticOf('Other creatures you control have flying and get +1/+1.', [continuous(each({ types: ['Creature'], controller: 'you', other: true }), [{ layer: 6, add: [FLYING] }, { layer: '7c', power: 1, toughness: 1 }])])]);
    const lords = Array.from({ length: 8 }, (_, i) => lord(i));
    const bear = creature('Test Bear', '1', '1');
    const s = board([...lords, bear], [...lords.map((l) => l.name), ...Array(40).fill('Test Bear')]);
    LAYER_STATS.trials = 0;
    const all = computeAll(s);
    expect(LAYER_STATS.trials).toBe(0);
    const b = nth(s, 'Test Bear');
    expect(all.get(b)!.power).toBe('9'); // 1 + 8 lords
    expect(hasKeyword(all.get(b)!, 'flying')).toBe(true);
  });

  it('8 lords over 80 creatures compute in a few milliseconds (the reviewed commit needed about 17 ms; the bound leaves room for a slow machine)', () => {
    const lord = (n: number) => creature(`Test Lord ${n}`, '2', '2', [staticOf('Other creatures you control have flying and get +1/+1.', [continuous(each({ types: ['Creature'], controller: 'you', other: true }), [{ layer: 6, add: [FLYING] }, { layer: '7c', power: 1, toughness: 1 }])])]);
    const lords = Array.from({ length: 8 }, (_, i) => lord(i));
    const s = board([...lords, creature('Test Bear', '1', '1')], [...lords.map((l) => l.name), ...Array(80).fill('Test Bear')]);
    computeAll(s); // warm up
    let best = Infinity;
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now();
      computeAll(s);
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThan(10);
  });

  it('an effect that DENIES abilities is still tried against the effects that depend on its existence (Blood Moon is not skipped)', () => {
    const URB = land('Test Urborg', [staticOf('Each land is a Swamp.', [continuous(each({ types: ['Land'] }), [{ layer: 4, subtypes: { add: ['Swamp'] } }])])], 'Legendary Land');
    const s = board([URB, enchantment('Test Blood Moon', '{2}{R}', [staticOf('Nonbasic lands are Mountains.', [continuous(each({ types: ['Land'], notSupertypes: ['Basic'] }), [{ layer: 4, subtypes: { set: ['Mountain'] } }])])])], ['Test Urborg', 'Test Blood Moon', 'Plains']);
    LAYER_STATS.trials = 0;
    computeAll(s);
    expect(LAYER_STATS.trials).toBeGreaterThan(0);
  });
});
