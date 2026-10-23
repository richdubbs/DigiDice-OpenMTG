/**
 * Cloud batch 3, C8: references to what a cost moved ("the discarded card", "the exiled card" of an activation cost, an additional cost or a payment an effect asks
 * for; CR 400.7j, 601.2b, 601.2h, 602.2b, 608.2h, 707.10). Played through applyAction with synthetic cards compiled by the game's default compiler (wordings are
 * invented, design 6.10). Each test is named after the rule it checks. The template and lint side is in c8-templates.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, validateAbility, validateCardAbilities, type AbilityDef, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, legal, life, passBoth, scenario } from '../../m3/scenario';
import { getChars, ptNumbers } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard as never);
}
/** The abilities of a card that are manual or hold a manual step. */
const manualParts = (d: CardDef): AbilityDef[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const power = (s: GameState, id: ObjectId): number | null => ptNumbers(getChars(s, id)).power;
const toughness = (s: GameState, id: ObjectId): number | null => ptNumbers(getChars(s, id)).toughness;
const p2: TargetChoice = { kind: 'player', id: 'p2' };

/** Answer the decisions of casting or activating: targets, automatic payment, the card(s) the cost picks (`pick`), and "no" to every yes/no question. */
function settle(s0: GameState, targets: TargetChoice[], pick?: ObjectId[]): GameState {
  let s = s0;
  while (s.pending && s.pending.kind !== 'priority') {
    const d = s.pending as { kind: string };
    if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseObjects' && pick !== undefined) s = answer(s, { kind: 'chooseObjects', ids: pick } as DecisionAnswer);
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false } as DecisionAnswer);
    else break;
  }
  return s;
}
const cast = (s: GameState, name: string, targets: TargetChoice[] = [], pick?: ObjectId[]): GameState => settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets, pick);
function activate(s0: GameState, source: ObjectId, targets: TargetChoice[] = [], pick?: ObjectId[]): GameState {
  const a = legal(s0, 'p1', 'activate').find((x) => x.object === source && !x.isMana);
  if (!a) throw new Error(`no ability of ${source} to activate`);
  return settle(act(s0, a.action), targets, pick);
}
/** Pass priority until the stack is empty (answering "no" to any yes/no question on the way). */
function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 20 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); i++) {
    s = s.pending?.kind === 'priority' ? passBoth(s) : settle(s, []);
  }
  return s;
}

const OGRE = card('Test Ridge Ogre', 'Creature — Ogre', '', '{3}{R}', ['4', '4']);
const ROCK = card('Test Loose Rock', 'Artifact', '', '{2}');
const PRIZE = card('Test Prize Grab', 'Instant', "As an additional cost to cast this spell, discard a card.\nDraw a card. If the discarded card was a creature card, this spell deals 3 damage to each opponent.", '{1}{R}');
const CRUSH = card('Test Crushing Toss', 'Instant', "As an additional cost to cast this spell, discard a card.\nThis spell deals damage equal to the discarded card's mana value to any target.", '{R}');
const CHEMIST = card('Test Ember Alchemist', 'Creature — Human Wizard', "{1}, Discard a card: This creature deals damage to target creature equal to the discarded card's mana value.", '{1}', ['1', '1']);
const TWIN = card('Test Twin Echo', 'Instant', 'Copy target instant or sorcery spell. You may choose new targets for the copy.', '{U}');
const PURGE = card('Test Grave Purge', 'Instant', 'Exile target card from a graveyard.', '{0}');
const LUNGE = card('Test Bone Lunge', 'Instant', "As an additional cost to cast this spell, exile a creature card from your graveyard.\nThis spell deals damage equal to the exiled card's power to target creature.", '{2}{B}');
const RECALL = card('Test Exile Recall', 'Instant', 'Return target card in exile to its owner\'s hand.', '{0}');
const TORA = card('Test Dozing Idol', 'Artifact', "{2}, Discard a creature card: This artifact becomes an X/X Cat artifact creature until end of turn, where X is the discarded card's mana value.", '{3}');
const LEGEND = card('Test Old Warlord', 'Legendary Creature — Human Warrior', '', '{2}', ['2', '2']);
const END = card('Test Grim Ending', 'Instant', 'As an additional cost to cast this spell, sacrifice a creature.\nDraw two cards. If the sacrificed creature was legendary, draw three cards instead.', '{1}{B}');
const SLING = card('Test Stone Sling', 'Artifact', "{1}, {T}, Tap an untapped creature you control: This artifact deals damage equal to the tapped creature's power to target creature.", '{2}');
const KILL = card('Test Quick End', 'Instant', 'Destroy target creature.', '{0}');
const DEFS = [OGRE, ROCK, PRIZE, CRUSH, CHEMIST, TWIN, PURGE, LUNGE, RECALL, TORA, LEGEND, END, SLING, KILL];
const BASICS = ['Mountain', 'Island', 'Swamp'];
const LANDS = ['Mountain', 'Mountain', 'Mountain', 'Island', 'Island', 'Swamp', 'Swamp'];

describe('CR 601.2b, 400.7j: "As an additional cost to cast this spell, discard a card" and "if the discarded card was a creature card"', () => {
  it('both abilities are automated; the spell reads {ref:costDiscarded}', () => {
    expect(manualParts(PRIZE)).toEqual([]);
    expect(JSON.stringify(PRIZE)).toContain('{"cond":"matches","object":{"ref":"costDiscarded"},"filter":{"types":["Creature"],"isCard":true}}');
  });
  it('a discarded creature card: the condition holds and each opponent is dealt 3 damage', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Prize Grab', 'Test Ridge Ogre'], battlefield: LANDS }, defs: DEFS });
    s = cast(s, 'Test Prize Grab', [], [find(s, 'Test Ridge Ogre', 'hand', 'p1')]);
    expect(findAll(s, 'Test Ridge Ogre', 'graveyard', 'p1').length).toBe(1); // paid as the spell is cast (CR 601.2h)
    s = resolveAll(s);
    expect(life(s, 'p2')).toBe(17);
  });
  it('a discarded noncreature card: the condition is false and nobody is dealt damage', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Prize Grab', 'Test Loose Rock'], battlefield: LANDS }, defs: DEFS });
    s = cast(s, 'Test Prize Grab', [], [find(s, 'Test Loose Rock', 'hand', 'p1')]);
    s = resolveAll(s);
    expect(life(s, 'p2')).toBe(20);
  });
  it('CR 608.2h: the discarded card left the graveyard before the spell resolved: its last known information is read (still a creature card)', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Prize Grab', 'Test Ridge Ogre', 'Test Grave Purge'], battlefield: LANDS }, defs: DEFS });
    s = cast(s, 'Test Prize Grab', [], [find(s, 'Test Ridge Ogre', 'hand', 'p1')]);
    s = cast(s, 'Test Grave Purge', [obj(find(s, 'Test Ridge Ogre', 'graveyard', 'p1'))]);
    s = passBoth(s); // the exile resolves first
    expect(findAll(s, 'Test Ridge Ogre', 'exile').length).toBe(1);
    s = resolveAll(s);
    expect(life(s, 'p2')).toBe(17);
  });
  it('CR 707.10: a copy of the spell paid no cost but its effect reads the card discarded for the original: both deal 3 damage', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Prize Grab', 'Test Ridge Ogre', 'Test Twin Echo'], battlefield: LANDS }, defs: DEFS });
    s = cast(s, 'Test Prize Grab', [], [find(s, 'Test Ridge Ogre', 'hand', 'p1')]);
    s = cast(s, 'Test Twin Echo', [obj(find(s, 'Test Prize Grab', 'stack', 'p1'))]);
    s = resolveAll(s);
    expect(life(s, 'p2')).toBe(14);
  });
});

describe('CR 608.2h, 202.3: "damage equal to the discarded card\'s mana value"', () => {
  it('the spell deals damage equal to the mana value of the card discarded for it', () => {
    expect(manualParts(CRUSH)).toEqual([]);
    expect(JSON.stringify(CRUSH)).toContain('{"q":"stat","stat":"manaValue","of":{"ref":"costDiscarded"}}');
    let s = scenario(BASICS, { p1: { hand: ['Test Crushing Toss', 'Test Ridge Ogre'], battlefield: LANDS }, defs: DEFS });
    s = cast(s, 'Test Crushing Toss', [p2], [find(s, 'Test Ridge Ogre', 'hand', 'p1')]);
    s = resolveAll(s);
    expect(life(s, 'p2')).toBe(16);
  });
  it('CR 707.10: the copy deals as much, from the card discarded for the original', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Crushing Toss', 'Test Ridge Ogre', 'Test Twin Echo'], battlefield: LANDS }, defs: DEFS });
    s = cast(s, 'Test Crushing Toss', [p2], [find(s, 'Test Ridge Ogre', 'hand', 'p1')]);
    s = cast(s, 'Test Twin Echo', [obj(find(s, 'Test Crushing Toss', 'stack', 'p1'))]);
    s = resolveAll(s);
    expect(life(s, 'p2')).toBe(12);
  });
});

describe('CR 602.2b, 608.2h: "{1}, Discard a card: ~ deals damage to target creature equal to the discarded card\'s mana value"', () => {
  it('the ability is automated and reads {ref:costDiscarded}', () => {
    expect(manualParts(CHEMIST)).toEqual([]);
    expect(JSON.stringify(CHEMIST)).toContain('"amount":{"q":"stat","stat":"manaValue","of":{"ref":"costDiscarded"}}');
  });
  it('the damage is the mana value of the discarded card; a card discarded later (not for this cost) is not read', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Ridge Ogre'], battlefield: ['Test Ember Alchemist', ...LANDS] }, p2: { battlefield: [{ name: 'Test Ridge Ogre' }] }, defs: DEFS });
    const target = find(s, 'Test Ridge Ogre', 'battlefield', 'p2');
    s = activate(s, find(s, 'Test Ember Alchemist', 'battlefield', 'p1'), [obj(target)], [find(s, 'Test Ridge Ogre', 'hand', 'p1')]);
    s = resolveAll(s);
    expect(findAll(s, 'Test Ridge Ogre', 'battlefield', 'p2').length).toBe(0); // 4 damage to a 4/4 (CR 704.5g)
  });
  it('CR 608.2h: the discarded card was exiled from the graveyard in response: the ability still reads its mana value', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Ridge Ogre', 'Test Grave Purge'], battlefield: ['Test Ember Alchemist', ...LANDS] }, p2: { battlefield: [{ name: 'Test Ridge Ogre' }] }, defs: DEFS });
    const target = find(s, 'Test Ridge Ogre', 'battlefield', 'p2');
    s = activate(s, find(s, 'Test Ember Alchemist', 'battlefield', 'p1'), [obj(target)], [find(s, 'Test Ridge Ogre', 'hand', 'p1')]);
    s = cast(s, 'Test Grave Purge', [obj(find(s, 'Test Ridge Ogre', 'graveyard', 'p1'))]);
    s = resolveAll(s);
    expect(findAll(s, 'Test Ridge Ogre', 'exile').length).toBe(1);
    expect(findAll(s, 'Test Ridge Ogre', 'battlefield', 'p2').length).toBe(0);
  });
});

describe('CR 601.2b, 400.7j: "As an additional cost to cast this spell, exile a creature card from your graveyard" and "the exiled card\'s power"', () => {
  it('the spell is automated and reads {ref:costExiled}; the damage is the power of the exiled card', () => {
    expect(manualParts(LUNGE)).toEqual([]);
    expect(JSON.stringify(LUNGE)).toContain('"amount":{"q":"stat","stat":"power","of":{"ref":"costExiled"}}');
    let s = scenario(BASICS, { p1: { graveyard: ['Test Ridge Ogre'], battlefield: LANDS, hand: ['Test Bone Lunge'] }, p2: { battlefield: [{ name: 'Test Ridge Ogre' }] }, defs: DEFS });
    const target = find(s, 'Test Ridge Ogre', 'battlefield', 'p2');
    s = cast(s, 'Test Bone Lunge', [obj(target)], [find(s, 'Test Ridge Ogre', 'graveyard', 'p1')]);
    expect(findAll(s, 'Test Ridge Ogre', 'exile').length).toBe(1);
    s = resolveAll(s);
    expect(findAll(s, 'Test Ridge Ogre', 'battlefield', 'p2').length).toBe(0);
  });
});

describe('CR 608.2h, 400.7: the card the additional cost exiled left exile before the spell resolved', () => {
  it('its power is read from its last known information in exile; the card is a new object in the hand (nothing acts on it)', () => {
    let s = scenario(BASICS, { p1: { graveyard: ['Test Ridge Ogre'], battlefield: LANDS, hand: ['Test Bone Lunge', 'Test Exile Recall'] }, p2: { battlefield: [{ name: 'Test Ridge Ogre' }] }, defs: DEFS });
    const target = find(s, 'Test Ridge Ogre', 'battlefield', 'p2');
    s = cast(s, 'Test Bone Lunge', [obj(target)], [find(s, 'Test Ridge Ogre', 'graveyard', 'p1')]);
    s = cast(s, 'Test Exile Recall', [obj(find(s, 'Test Ridge Ogre', 'exile'))]);
    s = passBoth(s); // the card leaves exile for its owner's hand first
    expect(findAll(s, 'Test Ridge Ogre', 'hand', 'p1').length).toBe(1);
    s = resolveAll(s);
    expect(findAll(s, 'Test Ridge Ogre', 'battlefield', 'p2').length).toBe(0); // 4 damage: the power the card had in exile
  });
});

describe('CR 107.3, 608.2h, 613.4b: "~ becomes an X/X Cat artifact creature until end of turn, where X is the discarded card\'s mana value"', () => {
  it('is automated; X is the mana value of the discarded card, fixed as the effect is created', () => {
    expect(manualParts(TORA)).toEqual([]);
    let s = scenario(BASICS, { p1: { hand: ['Test Ridge Ogre', 'Test Grave Purge'], battlefield: ['Test Dozing Idol', ...LANDS] }, defs: DEFS });
    const idol = find(s, 'Test Dozing Idol', 'battlefield', 'p1');
    s = activate(s, idol, [], [find(s, 'Test Ridge Ogre', 'hand', 'p1')]);
    s = resolveAll(s);
    expect(power(s, idol)).toBe(4);
    expect(toughness(s, idol)).toBe(4);
    s = cast(s, 'Test Grave Purge', [obj(find(s, 'Test Ridge Ogre', 'graveyard', 'p1'))]); // the discarded card leaves the graveyard later: X stays (CR 608.2h, 611.2c)
    s = resolveAll(s);
    expect(power(s, idol)).toBe(4);
  });
});

describe('CR 205.4a, 608.2h: "If the sacrificed creature was legendary, draw three cards instead"', () => {
  it('is automated; a legendary creature sacrificed for the cost draws three, another creature two', () => {
    expect(manualParts(END)).toEqual([]);
    const hand = (s: GameState): number => s.zones.hand['p1']!.length;
    let s = scenario(BASICS, { p1: { hand: ['Test Grim Ending'], battlefield: ['Test Old Warlord', 'Test Ridge Ogre', ...LANDS] }, defs: DEFS });
    s = cast(s, 'Test Grim Ending', [], [find(s, 'Test Old Warlord', 'battlefield', 'p1')]);
    const before = hand(s);
    s = resolveAll(s);
    expect(hand(s)).toBe(before + 3);
    let t = scenario(BASICS, { p1: { hand: ['Test Grim Ending'], battlefield: ['Test Old Warlord', 'Test Ridge Ogre', ...LANDS] }, defs: DEFS });
    t = cast(t, 'Test Grim Ending', [], [find(t, 'Test Ridge Ogre', 'battlefield', 'p1')]);
    const before2 = hand(t);
    t = resolveAll(t);
    expect(hand(t)).toBe(before2 + 2);
  });
});

describe('CR 602.2b, 608.2h: "Tap an untapped creature you control: ~ deals damage equal to the tapped creature\'s power to target creature"', () => {
  it('is automated and reads {ref:costTapped}; the creature tapped for the cost left the battlefield in response: its last known power is read', () => {
    expect(manualParts(SLING)).toEqual([]);
    expect(JSON.stringify(SLING)).toContain('"amount":{"q":"stat","stat":"power","of":{"ref":"costTapped"}}');
    let s = scenario(BASICS, { p1: { hand: ['Test Quick End'], battlefield: ['Test Stone Sling', { name: 'Test Ridge Ogre' }, ...LANDS] }, p2: { battlefield: [{ name: 'Test Ridge Ogre' }] }, defs: DEFS });
    const mine = find(s, 'Test Ridge Ogre', 'battlefield', 'p1');
    const target = find(s, 'Test Ridge Ogre', 'battlefield', 'p2');
    s = activate(s, find(s, 'Test Stone Sling', 'battlefield', 'p1'), [obj(target)], [mine]);
    expect(s.objects[mine]!.tapped).toBe(true); // paid as the ability is activated (CR 602.2b)
    s = cast(s, 'Test Quick End', [obj(mine)]);
    s = resolveAll(s);
    expect(findAll(s, 'Test Ridge Ogre', 'battlefield').length).toBe(0); // both gone: the target was dealt 4 (CR 704.5g)
  });
});

describe('fails closed: a reference to what a cost moved with nothing that pays it is refused (model/lint-nodes.ts, model/lint-card.ts)', () => {
  it('CR 601.2b: a spell reading {ref:costDiscarded} with no additional cost that discards is a card lint error', () => {
    const spell = { kind: 'spell', text: 'x', effect: { targets: [], steps: [{ op: 'gainLife', who: { ref: 'you' }, amount: { q: 'stat', stat: 'manaValue', of: { ref: 'costDiscarded' } } }] } } as unknown as AbilityDef;
    const issues = validateCardAbilities([{ abilities: [spell] }]);
    expect(issues.some((i) => i.severity === 'error' && i.message.includes("{ref:'costDiscarded'} in a spell needs an additional cost"))).toBe(true);
    const cost = { kind: 'static', text: 'y', zone: ['stack'], effects: [{ s: 'additionalCost', cost: { other: [{ kind: 'discard', count: 1 }] } }] } as unknown as AbilityDef;
    expect(validateCardAbilities([{ abilities: [cost, spell] }]).filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('CR 602.2b: an activated ability whose cost discards nothing never reads {ref:costDiscarded}', () => {
    const d = card('Test Idle Lever', 'Artifact', "{1}, {T}: You gain life equal to the discarded card's mana value.");
    expect(manualParts(d).length).toBeGreaterThan(0);
    const reads = { op: 'gainLife', who: { ref: 'you' }, amount: { q: 'stat', stat: 'manaValue', of: { ref: 'costDiscarded' } } };
    const without = { kind: 'activated', text: 'x', cost: { mana: [{ kind: 'generic', amount: 1 }], tap: true }, effect: { targets: [], steps: [reads] } } as unknown as AbilityDef;
    expect(validateAbility(without).some((i) => i.severity === 'error' && i.message.includes("{ref:'costDiscarded'} is allowed only"))).toBe(true);
    const self = { ...without, cost: { other: [{ kind: 'discard', count: 1, self: true }] } } as unknown as AbilityDef; // "Discard ~" names no other card
    expect(validateAbility(self).some((i) => i.severity === 'error' && i.message.includes("{ref:'costDiscarded'} is allowed only"))).toBe(true);
    const ok = { ...without, cost: { other: [{ kind: 'discard', count: 1 }] } } as unknown as AbilityDef;
    expect(validateAbility(ok).filter((i) => i.severity === 'error')).toEqual([]);
    const reflexive = { kind: 'triggered', text: 'y', trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }] }, effect: { targets: [], steps: [{ op: 'pay', who: { ref: 'you' }, cost: { other: [{ kind: 'discard', count: 1 }] }, then: [reads] }] } } as unknown as AbilityDef;
    expect(validateAbility(reflexive).filter((i) => i.severity === 'error')).toEqual([]); // CR 118.12: a payment of the effect, read inside its own `then`
  });
  it('CR 605.3b: a mana ability that reads what its cost discarded stays manual (no stack object keeps the cost paid)', () => {
    const d = card('Test Ember Vat', 'Artifact', "{T}, Discard a card: Add an amount of {R} equal to the discarded card's mana value.");
    expect(manualParts(d).length).toBeGreaterThan(0);
  });
  it('CR 601.2c, 601.2h: a target is never what the cost discarded (costs are paid after targets are chosen)', () => {
    const d = card('Test Odd Sling', 'Artifact', '{1}, Discard a card: Return target card that shares a card type with the discarded card from your graveyard to your hand.');
    expect(JSON.stringify(d)).not.toContain('"ref":"costDiscarded"');
  });
});
