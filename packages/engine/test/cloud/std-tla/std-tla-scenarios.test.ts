/**
 * Cloud batch 2, slice std-tla (the Standard backlog of Avatar: The Last Airbender, tuning half): the templates of parser/templates/zz-cloud/std-tla.json and the
 * hole, lowering and renderer support they needed, played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 611.2c, 613.4c            "Untap one or two target creatures. They each get +2/+2 until end of turn."
 *   CR 205.1b, 305.6, 611.2c     "Lands you control gain all basic land types until end of turn."
 *   CR 601.3b, 702.8a, 611.3a    "If there are two or more instant cards in your graveyard, you may cast this spell as though it had flash."
 *   CR 603.4, 400.7, 610.3       "At the beginning of your end step, if ~ has two or more quest counters on it, exile up to one target creature you control, then return it ..."
 *   CR 702.34a, 611.3a, 500.1    "During your turn, each instant card in your graveyard has flashback. The flashback cost is equal to that card's mana cost." / "... flashback {1}."
 *   CR 613.1f, 202.3, 701.8a     "Each creature with mana value 2 or less loses all abilities until end of turn. Destroy those creatures."
 *   CR 701.17a, 608.2c, 608.2d   "Mill a card. You may put a land card milled this way into your hand. You gain 2 life if a Lesson card is milled this way."
 *   CR 201.5, 508.1              "Whenever <a plural name> attack, put a +1/+1 counter on each tapped creature you control."
 *   CR 508.1b, 603.2c            "Whenever you attack a player with one or more creatures with power 4 or greater, you gain 1 life." (once for each player attacked)
 *   CR 608.2n, 406.3             "Draw a card. Exile ~." (the shared shape "exile ~." of the backlog: a spell that exiles itself as it resolves)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, life, pass, scenario, zoneNames } from '../../m3/scenario';
import { lifeOf, mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const full = (d: CardDef): boolean => d.automation.level === 'full' && noManual(d);
const ptOf = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const hand = (s: GameState, p: PlayerId = 'p1'): string[] => zoneNames(s, 'hand', p);
const graveyard = (s: GameState, p: PlayerId = 'p1'): string[] => zoneNames(s, 'graveyard', p);
const exile = (s: GameState): string[] => s.zones.exile.map((id) => s.objects[id]!.defId);

/** How many of the offered objects a choice takes: the fewest allowed, or as many as allowed. */
type Pick = 'min' | 'max';
/** Answer the decisions that come up until priority (payments automatic; the targets `targets` in order; object choices by `picks` in order, else the fewest allowed). */
function drive(s0: GameState, targets: ObjectId[][] = [], picks: Pick[] = []): GameState {
  let s = s0;
  const q = [...targets];
  const p = [...picks];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const d = s.pending;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (q.shift() ?? []).map((id) => ({ kind: 'object' as const, id })) });
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, (p.shift() ?? 'min') === 'max' ? d.max : d.min) });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((x) => x.id) }); // CR 603.3b: triggers put on the stack in the order offered
    else throw new Error(`unexpected decision ${d.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, targets: ObjectId[][] = [], picks: Pick[] = []): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), targets, picks);
  return s;
}
const cast = (s: GameState, name: string, targets: ObjectId[][] = []): GameState => drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets);
const castAndResolve = (s: GameState, name: string, targets: ObjectId[][] = []): GameState => resolveAll(cast(s, name, targets), targets);
const castable = (s: GameState, name: string): boolean => legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.label.includes(name));
const flashbackLabels = (s: GameState): string[] => legalActions(s, 'p1').filter((a) => a.kind === 'cast' && /flashback/.test(a.label)).map((a) => a.label).sort();

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const GAIN = card('Test Gain', 'Instant', 'You gain 1 life.');

describe('CR 611.2c, 613.4c: "Untap one or two target creatures. They each get +2/+2 until end of turn."', () => {
  const FOOTWORK = card('Test Footwork', 'Instant', 'Untap one or two target creatures. They each get +2/+2 until end of turn.');
  it('is automated', () => expect(full(FOOTWORK)).toBe(true));
  it('both targets untap and get +2/+2 until end of turn; a creature that was not chosen does not', () => {
    const s0 = scenario([], { defs: [FOOTWORK, BEAR], p1: { hand: ['Test Footwork'], battlefield: [{ name: 'Test Bear', tapped: true }, { name: 'Test Bear', tapped: true }, { name: 'Test Bear', tapped: true }] } });
    const [a, b, c] = findAll(s0, 'Test Bear', 'battlefield');
    const s = castAndResolve(s0, 'Test Footwork', [[a!, b!]]);
    expect([s.objects[a!]!.tapped, s.objects[b!]!.tapped, s.objects[c!]!.tapped]).toEqual([false, false, true]);
    expect([ptOf(s, a!), ptOf(s, b!), ptOf(s, c!)]).toEqual(['4/4', '4/4', '2/2']);
    const later = advanceTo(s, s.turn.number + 1, 'upkeep');
    expect(ptOf(later, a!)).toBe('2/2');
  });
});

describe('CR 205.1b, 305.6, 611.2c: "Lands you control gain all basic land types until end of turn."', () => {
  const BENDING = card('Test Bending', 'Instant', 'Lands you control gain all basic land types until end of turn.\nDraw a card.');
  const WASTE = card('Test Waste', 'Land', '');
  const basics = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
  it('is automated', () => expect(full(BENDING)).toBe(true));
  it('a land you control has the five basic land types and their mana abilities until end of turn and keeps its own; an opponent\'s land and a land played later do not', () => {
    const s0 = scenario([], { defs: [BENDING, WASTE], p1: { hand: ['Test Bending', 'Test Waste'], battlefield: ['Test Waste'] }, p2: { battlefield: ['Test Waste'] } });
    const mine = find(s0, 'Test Waste', 'battlefield', 'p1');
    const theirs = find(s0, 'Test Waste', 'battlefield', 'p2');
    let s = castAndResolve(s0, 'Test Bending');
    const c = getChars(s, mine)!;
    expect(c.types).toEqual(['Land']);
    expect(c.subtypes).toEqual(expect.arrayContaining(basics));
    expect(c.abilities.filter((a) => a.def.kind === 'activated' && a.def.isMana === true).length).toBe(5); // CR 305.6
    expect(getChars(s, theirs)!.subtypes).toEqual([]);
    // CR 611.2c: the effect of the resolved spell changes only the lands that were there as it resolved
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Waste', 'hand', 'p1') });
    const played = findAll(s, 'Test Waste', 'battlefield', 'p1').find((id) => id !== mine)!;
    expect(getChars(s, played)!.subtypes).toEqual([]);
    const later = advanceTo(s, s.turn.number + 1, 'upkeep');
    expect(getChars(later, mine)!.subtypes).toEqual([]);
  });
});

describe('CR 601.3b, 702.8a, 611.3a: "If there are two or more instant cards in your graveyard, you may cast this spell as though it had flash."', () => {
  const SERPENT = card('Test Serpent', 'Creature — Serpent', 'If there are two or more instant cards in your graveyard, you may cast this spell as though it had flash.', { pt: ['3', '3'], cost: '{1}' });
  it('is automated', () => expect(full(SERPENT)).toBe(true));
  it('with two instant cards in your graveyard it can be cast while a spell is on the stack (as though it had flash)', () => {
    const s0 = scenario([], { defs: [SERPENT, GAIN], p1: { hand: ['Test Serpent', 'Test Gain'], graveyard: ['Test Gain', 'Test Gain'], battlefield: ['Plains', 'Plains'] } });
    const s1 = cast(s0, 'Test Gain');
    expect(s1.zones.stack).toHaveLength(1);
    expect(castable(s1, 'Test Serpent')).toBe(true);
    const s2 = cast(s1, 'Test Serpent');
    expect(s2.zones.stack).toHaveLength(2);
    const s = resolveAll(s2);
    expect(findAll(s, 'Test Serpent', 'battlefield', 'p1')).toHaveLength(1);
  });
  it('with only one instant card there it cannot (CR 307.1: a creature spell has sorcery timing)', () => {
    const s0 = scenario([], { defs: [SERPENT, GAIN], p1: { hand: ['Test Serpent', 'Test Gain'], graveyard: ['Test Gain'], battlefield: ['Plains', 'Plains'] } });
    const s1 = cast(s0, 'Test Gain');
    expect(castable(s1, 'Test Serpent')).toBe(false);
    expect(castable(s0, 'Test Serpent')).toBe(true); // normal timing still works
  });
});

describe('CR 603.4, 400.7, 110.2: "At the beginning of your end step, if this enchantment has two or more quest counters on it, exile up to one target creature you control, then return it to the battlefield under its owner\'s control."', () => {
  const ASCENT = card('Test Ascent', 'Enchantment', 'At the beginning of your end step, if this enchantment has two or more quest counters on it, exile up to one target creature you control, then return it to the battlefield under its owner\'s control.');
  it('is automated', () => expect(full(ASCENT)).toBe(true));
  it('with two quest counters the target is exiled and returns as a new object without its counters', () => {
    const s0 = scenario([], { defs: [ASCENT, BEAR], p1: { battlefield: [{ name: 'Test Ascent', counters: { quest: 2 } }, { name: 'Test Bear', counters: { '+1/+1': 1 } }] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    expect(ptOf(s0, bear)).toBe('3/3');
    let s = advanceTo(s0, 1, 'end');
    s = resolveAll(drive(s, [[bear]]), [[bear]]);
    const back = findAll(s, 'Test Bear', 'battlefield', 'p1');
    expect(back).toHaveLength(1);
    expect(back[0]).not.toBe(bear); // CR 400.7
    expect(ptOf(s, back[0]!)).toBe('2/2');
  });
  it('with one quest counter it does not trigger (the intervening "if")', () => {
    const s0 = scenario([], { defs: [ASCENT, BEAR], p1: { battlefield: [{ name: 'Test Ascent', counters: { quest: 1 } }, { name: 'Test Bear', counters: { '+1/+1': 1 } }] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = advanceTo(s0, 1, 'end');
    expect(s.zones.stack).toHaveLength(0);
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1')).toEqual([bear]);
  });
});

describe('CR 702.34a, 118.9, 611.3a, 500.1: "During your turn, each instant card in your graveyard has flashback. The flashback cost is equal to that card\'s mana cost." / "During your turn, each sorcery card in your graveyard has flashback {1}."', () => {
  const LOTUS = card('Test Lotus', 'Legendary Creature — Human Noble', 'During your turn, each instant card in your graveyard has flashback. The flashback cost is equal to that card\'s mana cost.\nDuring your turn, each sorcery card in your graveyard has flashback {1}.', { pt: ['3', '3'] });
  const PRICEY = card('Test Pricey', 'Instant', 'You gain 3 life.', { cost: '{2}' });
  const DEAR = card('Test Dear', 'Sorcery', 'You gain 2 life.', { cost: '{5}' });
  it('is automated', () => expect(full(LOTUS)).toBe(true));
  it('during your turn: the instant for its mana cost, the sorcery for {1}; each is exiled after it resolves', () => {
    const s0 = scenario([], { defs: [LOTUS, PRICEY, DEAR], p1: { battlefield: ['Test Lotus', 'Plains', 'Plains', 'Plains'], graveyard: ['Test Pricey', 'Test Dear'] } });
    expect(flashbackLabels(s0)).toEqual(['Cast Test Dear with flashback', 'Cast Test Pricey with flashback']);
    let s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Dear', 'graveyard', 'p1'), method: 'flashback' })));
    expect(life(s, 'p1')).toBe(22);
    expect(exile(s)).toContain('Test Dear'); // CR 702.34a
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Pricey', 'graveyard', 'p1'), method: 'flashback' })));
    expect(life(s, 'p1')).toBe(25);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped)).toHaveLength(3); // {1} + {2}
  });
  it('with too little mana for the instant\'s own cost it is not offered; the {1} one is', () => {
    const s0 = scenario([], { defs: [LOTUS, PRICEY, DEAR], p1: { battlefield: ['Test Lotus', 'Plains'], graveyard: ['Test Pricey', 'Test Dear'] } });
    expect(flashbackLabels(s0)).toEqual(['Cast Test Dear with flashback']);
  });
  it('during an opponent\'s turn the cards have no flashback (CR 611.3a: the condition is checked continuously)', () => {
    const s0 = scenario([], { defs: [LOTUS, PRICEY, DEAR], p1: { battlefield: ['Test Lotus', 'Plains', 'Plains', 'Plains'], graveyard: ['Test Pricey', 'Test Dear'] } });
    let s = advanceTo(s0, 2, 'upkeep');
    for (let i = 0; i < 10 && s.pending?.player !== 'p1'; i++) s = pass(s);
    expect(s.turn.activePlayer).toBe('p2');
    expect(flashbackLabels(s)).toEqual([]);
  });
});

describe('CR 613.1f, 202.3, 701.8a: "Each creature with mana value 2 or less loses all abilities until end of turn. Destroy those creatures."', () => {
  const ECLIPSE = card('Test Eclipse', 'Sorcery', 'Each creature with mana value 2 or less loses all abilities until end of turn. Destroy those creatures.');
  const WALL = card('Test Wall', 'Creature — Wall', 'Indestructible', { pt: ['0', '4'], cost: '{2}' });
  const GIANT = card('Test Giant', 'Creature — Giant', '', { pt: ['5', '5'], cost: '{4}' });
  const MOURNER = card('Test Mourner', 'Creature — Spirit', 'When this creature dies, you gain 5 life.', { pt: ['1', '1'], cost: '{1}' });
  it('is automated', () => expect(full(ECLIPSE)).toBe(true));
  it('an indestructible creature of mana value 2 loses indestructible and is destroyed; a creature of mana value 4 is untouched; a dies trigger it lost does not trigger', () => {
    const s0 = scenario([], { defs: [ECLIPSE, WALL, GIANT, MOURNER], p1: { hand: ['Test Eclipse'], battlefield: ['Test Mourner'] }, p2: { battlefield: ['Test Wall', 'Test Giant'] } });
    const s = castAndResolve(s0, 'Test Eclipse');
    expect(findAll(s, 'Test Wall', 'battlefield')).toHaveLength(0);
    expect(graveyard(s, 'p2')).toContain('Test Wall');
    expect(findAll(s, 'Test Giant', 'battlefield')).toHaveLength(1);
    expect(findAll(s, 'Test Mourner', 'battlefield')).toHaveLength(0);
    expect(life(s, 'p1')).toBe(20); // CR 603.10a: the creature had no abilities as it died
  });
});

describe('CR 701.17a, 608.2c, 608.2d: "Mill a card. You may put a land card milled this way into your hand. You gain 2 life if a Lesson card is milled this way."', () => {
  const DUMMY = card('Test Dummy', 'Artifact Creature — Scarecrow', 'Defender\n{T}: Mill a card. You may put a land card milled this way into your hand. You gain 2 life if a Lesson card is milled this way.', { pt: ['0', '3'] });
  const LESSON = card('Test Lesson', 'Instant — Lesson', 'You gain 1 life.');
  const DIG = card('Test Dig', 'Sorcery', 'Mill two cards. If a land card was milled this way, draw a card.');
  const activate = (s0: GameState, picks: Pick[] = []): GameState => {
    const a = legalActions(s0, 'p1').find((x) => x.kind === 'activate' && x.object === find(s0, 'Test Dummy', 'battlefield', 'p1'))!;
    return resolveAll(drive(act(s0, a.action), [], picks), [], picks);
  };
  it('are automated', () => {
    expect(full(DUMMY)).toBe(true);
    expect(full(DIG)).toBe(true);
  });
  it('a milled land card may be put into your hand; no life is gained', () => {
    const s0 = scenario(['Forest'], { defs: [DUMMY, LESSON], p1: { battlefield: [{ name: 'Test Dummy', since: -1 }], library: ['Forest'] } });
    const s = activate(s0, ['max']); // the one milled Forest is the one option (a new object in the graveyard, CR 400.7)
    expect(hand(s)).toContain('Forest');
    expect(life(s, 'p1')).toBe(20);
  });
  it('a milled Lesson card: 2 life, and the Lesson card stays in the graveyard (it is no land card)', () => {
    const s0 = scenario([], { defs: [DUMMY, LESSON], p1: { battlefield: [{ name: 'Test Dummy', since: -1 }], library: ['Test Lesson'] } });
    const s = activate(s0);
    expect(life(s, 'p1')).toBe(22);
    expect(graveyard(s)).toContain('Test Lesson');
    expect(hand(s)).not.toContain('Test Lesson');
  });
  it('"If a land card was milled this way": a draw only when one of the milled cards is a land card', () => {
    const withLand = castAndResolve(scenario(['Forest'], { defs: [DIG], p1: { hand: ['Test Dig'], library: ['Forest', 'Plains'] } }), 'Test Dig');
    expect(hand(withLand)).toHaveLength(1);
    const LESSON2 = card('Test Lesson', 'Instant — Lesson', 'You gain 1 life.');
    const without = castAndResolve(scenario([], { defs: [DIG, LESSON2], p1: { hand: ['Test Dig'], library: ['Test Lesson', 'Test Lesson'] } }), 'Test Dig');
    expect(hand(without)).toHaveLength(0);
  });
});

describe('CR 201.5, 508.1: "Whenever Kip and Kel attack, put a +1/+1 counter on each tapped creature you control." (a plural name, a plural verb)', () => {
  const TWINS = card('Kip and Kel', 'Legendary Creature — Human', 'Whenever Kip and Kel attack, put a +1/+1 counter on each tapped creature you control.', { pt: ['2', '2'] });
  it('is automated', () => expect(full(TWINS)).toBe(true));
  it('when it attacks, each tapped creature you control (the attackers) gets a counter; an untapped one does not', () => {
    const s0 = scenario([], { defs: [TWINS, BEAR], p1: { battlefield: [{ name: 'Kip and Kel', since: -1 }, { name: 'Test Bear', since: -1 }, { name: 'Test Bear', since: -1 }] } });
    const twins = find(s0, 'Kip and Kel', 'battlefield', 'p1');
    const [b1, b2] = findAll(s0, 'Test Bear', 'battlefield', 'p1');
    let s = s0;
    for (let i = 0; i < 60 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: twins, defender: 'p2' }, { attacker: b1!, defender: 'p2' }] });
    s = resolveAll(drive(s));
    expect(ptOf(s, twins)).toBe('3/3');
    expect(ptOf(s, b1!)).toBe('3/3');
    expect(ptOf(s, b2!)).toBe('2/2');
  });
});

describe('CR 508.1b, 603.2c: "Whenever you attack a player with one or more creatures with power 4 or greater, you gain 1 life." (once for each player attacked)', () => {
  const TOIL = card('Test Toil', 'Enchantment', 'Whenever you attack a player with one or more creatures with power 4 or greater, you gain 1 life.');
  const OX = card('Test Ox', 'Creature — Ox', '', { pt: ['4', '4'] });
  const WALKER = compileCard({ name: 'Test Walker', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Test', oracle_text: '', colors: [], keywords: [], loyalty: '3' } as OracleCard);
  const toAttackers = (s0: GameState): GameState => {
    let s = s0;
    for (let i = 0; i < 60 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    return s;
  };
  const attackWith = (s0: GameState, attacks: { attacker: ObjectId; defender: string }[]): GameState => resolveAll(drive(answer(toAttackers(s0), { kind: 'declareAttackers', attacks })));
  const two = (): GameState => scenario([], {
    defs: [TOIL, OX, BEAR, WALKER],
    p1: { battlefield: ['Test Toil', { name: 'Test Ox', since: -1 }, { name: 'Test Bear', since: -1 }] },
    p2: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 3 } }] },
  });
  it('is automated', () => expect(full(TOIL)).toBe(true));
  it('a 4/4 and a 2/2 attacking a player: one trigger for the declaration', () => {
    const s0 = two();
    const s = attackWith(s0, [{ attacker: find(s0, 'Test Ox', 'battlefield', 'p1'), defender: 'p2' }, { attacker: find(s0, 'Test Bear', 'battlefield', 'p1'), defender: 'p2' }]);
    expect(life(s, 'p1')).toBe(21);
  });
  it('the 2/2 alone: no trigger (no attacker with power 4 or greater)', () => {
    const s0 = two();
    expect(life(attackWith(s0, [{ attacker: find(s0, 'Test Bear', 'battlefield', 'p1'), defender: 'p2' }]), 'p1')).toBe(20);
  });
  it('the 4/4 attacking a planeswalker: no trigger (CR 508.1b: attacking a planeswalker is not attacking a player)', () => {
    const s0 = two();
    const s = attackWith(s0, [{ attacker: find(s0, 'Test Ox', 'battlefield', 'p1'), defender: find(s0, 'Test Walker', 'battlefield', 'p2') }]);
    expect(life(s, 'p1')).toBe(20);
  });
  it('in a game of three, a 4/4 at each opponent is two triggers (one for each player attacked, CR 603.3b orders them); both at one opponent is one', () => {
    const game = (): GameState => mpScenario({ players: 3, defs: [TOIL, OX], zones: { p1: { battlefield: ['Test Toil', { name: 'Test Ox', since: -1 }, { name: 'Test Ox', since: -1 }] } } });
    const s0 = game();
    const [o1, o2] = findAll(s0, 'Test Ox', 'battlefield', 'p1');
    expect(lifeOf(attackWith(s0, [{ attacker: o1!, defender: 'p2' }, { attacker: o2!, defender: 'p3' }]), 'p1')).toBe(22);
    const s1 = game();
    const [q1, q2] = findAll(s1, 'Test Ox', 'battlefield', 'p1');
    expect(lifeOf(attackWith(s1, [{ attacker: q1!, defender: 'p2' }, { attacker: q2!, defender: 'p2' }]), 'p1')).toBe(21);
  });
  it('the same for "Whenever one or more Elves you control attack a player" (a batch subject with a player): one trigger for each player attacked', () => {
    const KIN = card('Test Kin', 'Enchantment', 'Whenever one or more Elves you control attack a player, you gain 1 life.');
    const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
    expect(full(KIN)).toBe(true);
    const game = (): GameState => mpScenario({ players: 3, defs: [KIN, ELF], zones: { p1: { battlefield: ['Test Kin', { name: 'Test Elf', since: -1 }, { name: 'Test Elf', since: -1 }] } } });
    const s0 = game();
    const [e1, e2] = findAll(s0, 'Test Elf', 'battlefield', 'p1');
    expect(lifeOf(attackWith(s0, [{ attacker: e1!, defender: 'p2' }, { attacker: e2!, defender: 'p3' }]), 'p1')).toBe(22);
    const s1 = game();
    const [f1, f2] = findAll(s1, 'Test Elf', 'battlefield', 'p1');
    expect(lifeOf(attackWith(s1, [{ attacker: f1!, defender: 'p3' }, { attacker: f2!, defender: 'p3' }]), 'p1')).toBe(21);
  });
});

describe('CR 608.2n, 406.3: "Draw a card. Exile Test Lesson Plan." (the shared shape "exile ~.": the spell exiles itself as it resolves)', () => {
  const PLAN = card('Test Lesson Plan', 'Sorcery — Lesson', 'Draw a card. Exile Test Lesson Plan.');
  it('is automated', () => expect(full(PLAN)).toBe(true));
  it('after it resolves the card is in exile, not in its owner\'s graveyard, and the card was drawn', () => {
    const s = castAndResolve(scenario([], { defs: [PLAN], p1: { hand: ['Test Lesson Plan'] } }), 'Test Lesson Plan');
    expect(exile(s)).toContain('Test Lesson Plan');
    expect(graveyard(s)).not.toContain('Test Lesson Plan');
    expect(hand(s)).toHaveLength(1);
  });
});
