/**
 * trek-18 (lane trek, Star Trek cards): the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default
 * compiler. Nothing is mocked. CR cites checked against the Comprehensive Rules of 2026-09-25, except Star Trek's own words (station, which has CR 702.184).
 *
 *   CR 601.3, 400.7, 614.1c, 122.1h   "Once during each of your turns, you may cast an artifact creature spell from your graveyard. If you cast a spell this way,
 *                                    that artifact creature enters with a finality counter on it": one spell each of your turns per source, only that type, the
 *                                    counter; never on an opponent's turn
 *   CR 601.3, 401.5                  "Once during each of your turns, you may cast an artifact spell from the top of your library": one a turn, only on yours, only
 *                                    that type, only the top card
 *   CR 702.11c, 115.1                "You gain hexproof until end of turn": opponents can't target you, you can; the turn ends it
 *   CR 500.7                         "if you control a Whale and haven't begun an extra turn this game, take an extra turn": once; not without the Whale
 *   CR 702.122a, 702.184a, 701.11    "stations Spacecraft and crews Vehicles as though its power were tripled": only that creature, only crew and station
 *   CR 724.2                         "end the combat phase": the stack is exiled, combat is over, no end of combat step, the next phase is main 2; outside combat nothing
 *   CR 508.7                         "reselect which player or permanent that creature is attacking": the creature stays in combat, is not declared again
 */
import { describe, expect, it } from 'vitest';
import { applyAction, getChars, legalActions, type GameState, type ObjectId, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, pass, scenario } from '../../m5/helpers';
import { drive, resolveAll, resolveTop } from '../../m5/cr-examples/helpers';
import { synthetic } from '../../m6/costs/support';

const PT = { power: '2', toughness: '2' };
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const onField = (s: GameState, name: string): ObjectId | undefined => s.zones.battlefield.find((id) => nameOf(s, id) === name);
const plains = (n: number): string[] => Array(n).fill('Plains') as string[];
const casts = (s: GameState, zone: 'graveyard' | 'library', player: PlayerId = 'p1'): string[] =>
  legalActions(s, player).filter((a) => a.kind === 'cast' && s.objects[a.object!]?.zone === zone).map((a) => a.label).sort();

const ENGINEER = synthetic('Test Salvage Engineer', 'Creature — Human', '{2}', 'Once during each of your turns, you may cast an artifact creature spell from your graveyard. If you cast a spell this way, that artifact creature enters with a shield counter on it.', PT);
const DRONE = synthetic('Test Scrap Drone', 'Artifact Creature — Construct', '{1}', '', PT);
const BEAR = synthetic('Test Plain Bear', 'Creature — Bear', '{1}', '', PT);
const GADGET = synthetic('Test Spare Gadget', 'Artifact', '{1}', '');
const PIONEER = synthetic('Test Orbit Pioneer', 'Creature — Human', '{2}', 'You may look at the top card of your library any time.\nOnce during each of your turns, you may cast an artifact spell from the top of your library.', PT);
const DEFS = [ENGINEER, DRONE, BEAR, GADGET, PIONEER];

const board = (p1: { battlefield?: string[]; hand?: string[]; graveyard?: string[]; library?: string[] }, p2: { battlefield?: string[]; graveyard?: string[] } = {}): GameState =>
  scenario(['Grizzly Bears', 'Plains'], { p1, p2, defs: DEFS });
const castFrom = (s: GameState, name: string, zone: 'graveyard' | 'library'): GameState =>
  drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, zone, 'p1') }));

describe('CR 601.3, 400.7, 614.1c: "Once during each of your turns, you may cast an artifact creature spell from your graveyard. If you cast a spell this way, ... enters with a counter"', () => {
  it('the cards are full', () => {
    expect(ENGINEER.automation.level).toBe('full');
    expect(PIONEER.automation.level).toBe('full');
  });
  it('an artifact creature card is cast from the graveyard and enters with the counter; a plain creature card and an artifact that is no creature are not offered', () => {
    let s = board({ battlefield: ['Test Salvage Engineer', ...plains(3)], graveyard: ['Test Scrap Drone', 'Test Plain Bear', 'Test Spare Gadget'] });
    expect(casts(s, 'graveyard')).toEqual(['Cast Test Scrap Drone']);
    s = resolveTop(castFrom(s, 'Test Scrap Drone', 'graveyard'));
    const drone = onField(s, 'Test Scrap Drone')!;
    expect(s.objects[drone]!.counters['shield']).toBe(1);
  });
  it('once each turn: a second artifact creature card is not offered until the next turn of yours; never on an opponent\'s turn', () => {
    let s = board({ battlefield: ['Test Salvage Engineer', ...plains(4)], graveyard: ['Test Scrap Drone', 'Test Scrap Drone'] });
    s = resolveTop(castFrom(s, 'Test Scrap Drone', 'graveyard'));
    expect(casts(s, 'graveyard')).toEqual([]);
    expect(applyAction(s, { type: 'cast', player: 'p1', card: find(s, 'Test Scrap Drone', 'graveyard', 'p1') }).error?.rules).toContain('CR 601.3');
    s = advanceTo(s, 2, 'main1');
    expect(s.turn.activePlayer).toBe('p2');
    s = act(s, { type: 'pass', player: 'p2' });
    expect(casts(s, 'graveyard')).toEqual([]);
    s = advanceTo(s, 3, 'main1');
    expect(casts(s, 'graveyard')).toEqual(['Cast Test Scrap Drone']);
  });
  it('without the source nothing is offered; a card in the opponent\'s graveyard is not covered', () => {
    const s = board({ battlefield: plains(3), graveyard: ['Test Scrap Drone'] }, { graveyard: ['Test Scrap Drone'] });
    expect(casts(s, 'graveyard')).toEqual([]);
    const t = board({ battlefield: ['Test Salvage Engineer', ...plains(3)] }, { graveyard: ['Test Scrap Drone'] });
    expect(casts(t, 'graveyard')).toEqual([]);
  });
});

describe('CR 601.3, 401.5: "Once during each of your turns, you may cast an artifact spell from the top of your library"', () => {
  it('the artifact on top is offered and cast; then no second spell from the top this turn; a nonartifact on top is not offered', () => {
    let s = board({ battlefield: ['Test Orbit Pioneer', ...plains(4)], library: ['Test Spare Gadget', 'Test Spare Gadget', 'Test Plain Bear'] });
    expect(casts(s, 'library')).toEqual(['Cast Test Spare Gadget from library']);
    s = resolveTop(castFrom(s, 'Test Spare Gadget', 'library'));
    expect(onField(s, 'Test Spare Gadget')).toBeDefined();
    expect(casts(s, 'library')).toEqual([]); // the next artifact is on top now, but the turn's one is used
  });
  it('a nonartifact card on top is not offered; never on an opponent\'s turn', () => {
    const s = board({ battlefield: ['Test Orbit Pioneer', ...plains(4)], library: ['Test Plain Bear', 'Test Spare Gadget'] });
    expect(casts(s, 'library')).toEqual([]);
    let t = board({ battlefield: ['Test Orbit Pioneer', ...plains(4)], library: ['Test Spare Gadget'] });
    t = advanceTo(t, 2, 'main1');
    t = act(t, { type: 'pass', player: 'p2' });
    expect(casts(t, 'library')).toEqual([]);
  });
});

// ---- player hexproof ---------------------------------------------------------------------------------------------------------------------------------
const CHARM = synthetic('Test Rally Charm', 'Instant', '{0}', "As an additional cost to cast this spell, sacrifice a creature.\nCreatures you control gain hexproof and indestructible until end of turn. You gain hexproof until end of turn. Prevent all damage that would be dealt to you this turn. Exile Test Rally Charm.");
const SPARK = synthetic('Test Spark', 'Instant', '{0}', 'Test Spark deals 2 damage to target player.');
const BOON = synthetic('Test Boon', 'Instant', '{0}', 'Target player gains 1 life.');
const HEX_DEFS = [CHARM, SPARK, BOON];
const full = (d: { automation: { level: string }; faces: unknown }): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"kind":"manual"') && !JSON.stringify(d.faces).includes('"op":"manual"');
const plr = (id: PlayerId): TargetChoice => ({ kind: 'player', id });
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
/** Does the game let `player` cast the spell at `target`? */
function castAt(s: GameState, player: PlayerId, name: string, target: PlayerId): boolean {
  try {
    const t = answer(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), { kind: 'chooseTargets', targets: [plr(target)] });
    return t.pending?.kind !== 'chooseTargets';
  } catch {
    return false;
  }
}

describe('CR 702.11c, 115.1, 611.2a: "You gain hexproof until end of turn." (with a sacrifice cost, damage prevention and the spell exiling itself)', () => {
  const rally = (): GameState => {
    let s = scenario([], { defs: [...DEFS, ...HEX_DEFS], p1: { hand: ['Test Rally Charm', 'Test Spark', 'Test Boon'], battlefield: ['Test Plain Bear'] }, p2: { hand: ['Test Spark', 'Test Boon'] } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rally Charm', 'hand', 'p1') }));
    return resolveAll(s);
  };
  it('is full', () => expect(full(CHARM)).toBe(true));
  it('the cost sacrifices a creature; the spell exiles itself when it resolves (not the graveyard)', () => {
    const s = rally();
    expect(onField(s, 'Test Plain Bear')).toBeUndefined();
    expect(s.zones.exile.map((id) => nameOf(s, id))).toContain('Test Rally Charm');
    expect(s.zones.graveyard['p1']!.map((id) => nameOf(s, id))).not.toContain('Test Rally Charm');
  });
  it('an opponent can\'t target you; you can target yourself and an opponent', () => {
    const s = rally();
    const p2 = s.pending?.player === 'p1' ? pass(s) : s;
    expect(castAt(p2, 'p2', 'Test Spark', 'p1')).toBe(false);
    expect(castAt(p2, 'p2', 'Test Boon', 'p1')).toBe(false);
    expect(castAt(p2, 'p2', 'Test Boon', 'p2')).toBe(true);
    expect(castAt(s, 'p1', 'Test Boon', 'p1')).toBe(true);
    expect(castAt(s, 'p1', 'Test Spark', 'p2')).toBe(true);
  });
  it('without the spell the same target is legal (the restriction is the spell\'s)', () => {
    let s = scenario([], { defs: HEX_DEFS, p2: { hand: ['Test Spark'] } });
    s = s.pending?.player === 'p1' ? pass(s) : s;
    expect(castAt(s, 'p2', 'Test Spark', 'p1')).toBe(true);
  });
  it('the restriction ends with the turn: on the opponent\'s turn they can target you again', () => {
    let s = rally();
    s = advanceTo(s, 2, 'main1');
    s = s.pending?.player === 'p2' ? s : pass(s);
    expect(s.turn.activePlayer).toBe('p2');
    expect(castAt(s, 'p2', 'Test Spark', 'p1')).toBe(true);
  });
  it('damage to you is prevented this turn', () => {
    const BLAST = synthetic('Test Blast', 'Instant', '{0}', 'Test Blast deals 3 damage to each opponent.');
    let s = scenario([], { defs: [...DEFS, ...HEX_DEFS, BLAST], p1: { hand: ['Test Rally Charm'], battlefield: ['Test Plain Bear'] }, p2: { hand: ['Test Blast'] } });
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rally Charm', 'hand', 'p1') })));
    s = s.pending?.player === 'p1' ? pass(s) : s;
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Blast', 'hand', 'p2') })));
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

// ---- the extra turn once ------------------------------------------------------------------------------------------------------------------------------
const TIDE = synthetic('Test Tide Caller', 'Creature — Human', '{1}', "{0}: Draw a card. If you control a Whale and haven't begun an extra turn this game, take an extra turn after this one.", PT);
const WHALE = synthetic('Test Blue Whale', 'Creature — Whale', '{1}', '', PT);
const TIDE_DEFS = [TIDE, WHALE];
describe('CR 500.7: "If you control a Whale and haven\'t begun an extra turn this game, take an extra turn after this one."', () => {
  const run1 = (s: GameState): GameState => {
    const id = find(s, 'Test Tide Caller', 'battlefield', 'p1');
    const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && !a.isMana && a.object === id)!;
    return resolveAll(drive(act(s, la.action)));
  };
  const game = (bf: string[]): GameState => scenario(['Plains'], { defs: [...DEFS, ...TIDE_DEFS], p1: { battlefield: bf, library: ['Plains', 'Plains', 'Plains', 'Plains'] } });
  it('is full', () => expect(full(TIDE)).toBe(true));
  it('with a Whale and no extra turn begun yet: an extra turn is taken; without a Whale none', () => {
    expect(run1(game(['Test Tide Caller', 'Test Blue Whale'])).turn.extraTurns).toEqual(['p1']);
    expect(run1(game(['Test Tide Caller'])).turn.extraTurns).toEqual([]);
  });
  it('after an extra turn began (the count is the player\'s, extra turns only), none is taken again; a normal turn does not count', () => {
    const s0 = game(['Test Tide Caller', 'Test Blue Whale']);
    expect(s0.players.find((p) => p.id === 'p1')!.extraTurnsBegun ?? 0).toBe(0);
    let s = run1(s0);
    s = advanceTo(s, 2, 'main1'); // the extra turn of p1 (turn 2), not p2's
    expect(s.turn.activePlayer).toBe('p1');
    expect(s.turn.extra).toBe(true);
    expect(s.players.find((p) => p.id === 'p1')!.extraTurnsBegun).toBe(1);
    expect(s.players.find((p) => p.id === 'p2')!.extraTurnsBegun ?? 0).toBe(0);
    s = run1(s);
    expect(s.turn.extraTurns).toEqual([]);
  });
  it('a player who only had normal turns has begun no extra turn (turns begun does not count)', () => {
    let s = advanceTo(game(['Test Tide Caller', 'Test Blue Whale']), 3, 'main1');
    expect(s.players.find((p) => p.id === 'p1')!.turnsBegun).toBe(2);
    s = run1(s);
    expect(s.turn.extraTurns).toEqual(['p1']);
  });
});

// ---- crew and station, tripled ------------------------------------------------------------------------------------------------------------------------
const HELMSMAN = synthetic('Test Helm Officer', 'Legendary Creature — Human Pilot', '{1}', "Test Helm Officer stations Spacecraft and crews Vehicles as though his power were tripled.", { power: '1', toughness: '1' });
const MOUSE = synthetic('Test Mouse', 'Creature — Mouse', '{1}', '', { power: '1', toughness: '1' });
const CART = synthetic('Test Cart', 'Artifact — Vehicle', '{1}', 'Crew 3', { power: '4', toughness: '4' });
const HULL = synthetic('Test Drift Hull', 'Artifact — Spacecraft', '{1}', 'Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery.)');
const JAGUAR = synthetic('Test Jaguar', 'Creature — Cat Mount', '{1}', 'Saddle 3', PT);
const HELM_DEFS = [HELMSMAN, MOUSE, CART, HULL, JAGUAR];
describe('CR 702.122a, 702.184a, 701.11: "~ stations Spacecraft and crews Vehicles as though ~\'s power were tripled."', () => {
  const g = (bf: string[]): GameState => scenario([], { defs: [...DEFS, ...HELM_DEFS], p1: { battlefield: bf } });
  /** Activate the first non-mana ability of `id`, tapping `pick` for its cost, and resolve it. */
  function use(s0: GameState, id: ObjectId, pick: ObjectId): GameState {
    const la = legalActions(s0, 'p1').find((a) => a.kind === 'activate' && !a.isMana && a.object === id);
    expect(la, 'offered').toBeDefined();
    let s = act(s0, la!.action);
    for (let i = 0; i < 8 && s.pending && s.pending.kind !== 'priority'; i++) {
      if (s.pending.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [pick] });
      else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else break;
    }
    return resolveAll(s);
  }
  const offered = (s: GameState, id: ObjectId): boolean => legalActions(s, 'p1').some((a) => a.kind === 'activate' && !a.isMana && a.object === id);
  it('is full', () => expect(full(HELMSMAN)).toBe(true));
  it('a 1/1 crews a Crew 3 Vehicle alone; a plain 1/1 does not', () => {
    const s0 = g(['Test Helm Officer', 'Test Cart']);
    const cart = onField(s0, 'Test Cart')!;
    const s = use(s0, cart, onField(s0, 'Test Helm Officer')!);
    expect(getChars(s, cart)!.types).toContain('Creature');
    const plain = g(['Test Mouse', 'Test Cart']);
    expect(offered(plain, onField(plain, 'Test Cart')!)).toBe(false);
  });
  it('stations for three times its power: a 1/1 puts 3 charge counters on a Spacecraft; a plain 1/1 puts 1', () => {
    const s0 = g(['Test Helm Officer', 'Test Drift Hull']);
    const hull = onField(s0, 'Test Drift Hull')!;
    expect(use(s0, hull, onField(s0, 'Test Helm Officer')!).objects[hull]!.counters['charge']).toBe(3);
    const p0 = g(['Test Mouse', 'Test Drift Hull']);
    expect(use(p0, onField(p0, 'Test Drift Hull')!, onField(p0, 'Test Mouse')!).objects[onField(p0, 'Test Drift Hull')!]!.counters['charge']).toBe(1);
  });
  it('only the creature with the ability: another creature stations for its own power, and the Helm Officer does not saddle at three times (saddle is not crew)', () => {
    const s0 = g(['Test Helm Officer', 'Test Mouse', 'Test Drift Hull', 'Test Jaguar']);
    const hull = onField(s0, 'Test Drift Hull')!;
    expect(use(s0, hull, onField(s0, 'Test Mouse')!).objects[hull]!.counters['charge']).toBe(1);
    const j = g(['Test Helm Officer', 'Test Jaguar']);
    expect(offered(j, onField(j, 'Test Jaguar')!)).toBe(false); // Saddle 3 needs power 3: the 1/1 counts 1
  });
});

// ---- ending the combat phase --------------------------------------------------------------------------------------------------------------------------
const ORDER = synthetic('Test Peace Order', 'Instant', '{0}', "Untap all creatures you control. If it's a combat phase, you may end the combat phase.");
const BRUISER = synthetic('Test Bruiser', 'Creature — Ogre', '{1}', '', { power: '3', toughness: '3' });
const WAVE = synthetic('Test Second Wave', 'Sorcery', '{0}', 'After this main phase, there is an additional combat phase followed by an additional main phase.');
const PEACE = synthetic('Test Peace Treaty', 'Instant', '{0}', 'Cast this spell only during combat.\nYour opponents can\'t cast spells this turn.\nEnd the combat phase.');
const BOLT = synthetic('Test Quick Bolt', 'Instant', '{0}', 'Test Quick Bolt deals 3 damage to any target.');
const END_DEFS = [ORDER, BRUISER, WAVE, PEACE, BOLT];
const attackWith = (ids: ObjectId[], defender: string = 'p2') => ({ kind: 'declareAttackers' as const, attacks: ids.map((attacker) => ({ attacker, defender })) });
/** Pass priority (no blocks) until `done`. */
function run(s0: GameState, done: (s: GameState) => boolean, what: string): GameState {
  let s = s0;
  for (let i = 0; i < 200; i++) {
    if (done(s)) return s;
    if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
    else throw new Error(`waiting for ${what}, a ${s.pending?.kind} decision is pending`);
  }
  throw new Error(`never reached ${what}`);
}
describe('CR 724.2: "end the combat phase" (Test Peace Order: "Untap all creatures you control. If it\'s a combat phase, you may end the combat phase.")', () => {
  const attacking = (): { s: GameState; bruiser: ObjectId } => {
    let s = scenario([], { defs: [...DEFS, ...END_DEFS], p1: { battlefield: ['Test Bruiser'], hand: ['Test Peace Order'] } });
    const bruiser = onField(s, 'Test Bruiser')!;
    s = run(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    s = answer(s, attackWith([bruiser]));
    s = run(s, (x) => x.turn.step === 'declareBlockers' && x.pending?.kind === 'priority', 'the declare blockers step');
    return { s, bruiser };
  };
  const order = (s: GameState, yes: boolean): GameState => {
    let t = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Peace Order', 'hand', 'p1') }));
    t = pass(t);
    t = pass(t);
    if (t.pending?.kind === 'yesNo') t = answer(t, { kind: 'yesNo', yes });
    return t;
  };
  it('is full', () => expect(full(ORDER)).toBe(true));
  it('ending it in the declare blockers step: no combat damage, the attacker is out of combat, the next phase is the second main phase, the spell is exiled', () => {
    const { s: s0, bruiser } = attacking();
    expect(s0.objects[bruiser]!.tapped).toBe(true);
    const s = order(s0, true);
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(s.combat).toBeNull();
    expect(s.turn.step).toBe('main2');
    expect(s.turn.number).toBe(1);
    expect(s.pending?.kind).toBe('priority');
    expect(s.zones.exile.map((id) => nameOf(s, id))).toContain('Test Peace Order'); // CR 724.2b: exiled, not put into the graveyard
    expect(s.zones.graveyard['p1']!.map((id) => nameOf(s, id))).not.toContain('Test Peace Order');
    expect(s.objects[bruiser]!.tapped).toBe(false); // its first sentence still untapped it
  });
  it('declining: combat goes on, the attacker deals its damage', () => {
    const { s: s0 } = attacking();
    const s = run(order(s0, false), (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'the second main phase');
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(s.zones.graveyard['p1']!.map((id) => nameOf(s, id))).toContain('Test Peace Order');
  });
  it('outside a combat phase nothing is ended: it is not even asked, and the spell goes to the graveyard (CR 724.2g)', () => {
    let s = scenario([], { defs: [...DEFS, ...END_DEFS], p1: { battlefield: ['Test Bruiser'], hand: ['Test Peace Order'] } });
    s = order(s, true);
    expect(s.pending?.kind).toBe('priority');
    expect(s.turn.step).toBe('main1');
    expect(s.zones.graveyard['p1']!.map((id) => nameOf(s, id))).toContain('Test Peace Order');
  });
  it('ending an added combat phase (CR 500.8): the turn goes on with the regular combat phase, which still happens', () => {
    let s = scenario([], { defs: [...DEFS, ...END_DEFS], p1: { battlefield: ['Test Bruiser'], hand: ['Test Second Wave', 'Test Peace Order'] } });
    const bruiser = onField(s, 'Test Bruiser')!;
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Second Wave', 'hand', 'p1') })));
    s = run(s, (x) => x.pending?.kind === 'declareAttackers', 'the added combat');
    s = drive(answer(s, attackWith([bruiser])));
    s = run(s, (x) => x.turn.step === 'declareBlockers' && x.pending?.kind === 'priority', 'the declare blockers step of the added combat');
    s = order(s, true);
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(s.turn.step).toBe('main2'); // CR 500.8: the added main phase that follows the added combat phase (a main phase after combat; the regular combat comes after it)
    expect(s.turn.mains).toBe(2);
    expect(s.pending?.kind).toBe('priority');
    s = run(s, (x) => x.pending?.kind === 'declareAttackers', 'the regular combat');
    expect(s.turn.number).toBe(1);
    expect(s.pending?.kind).toBe('declareAttackers'); // the regular combat phase is still to come
  });
  it('a spell that ends the combat phase and does something else first (cast only during combat; opponents can\'t cast spells this turn): both happen, the spell is exiled, outside combat it can\'t be cast', () => {
    let s = scenario([], { defs: [...DEFS, ...END_DEFS], p1: { battlefield: ['Test Bruiser'], hand: ['Test Peace Treaty'] }, p2: { hand: ['Test Quick Bolt'] } });
    expect(applyAction(s, { type: 'cast', player: 'p1', card: find(s, 'Test Peace Treaty', 'hand', 'p1') }).error).toBeDefined(); // main phase: not during combat
    const bruiser = onField(s, 'Test Bruiser')!;
    s = run(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    s = drive(answer(s, attackWith([bruiser])));
    s = run(s, (x) => x.turn.step === 'declareBlockers' && x.pending?.kind === 'priority', 'the declare blockers step');
    s = pass(pass(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Peace Treaty', 'hand', 'p1') }))));
    expect(s.turn.step).toBe('main2');
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(s.zones.exile.map((id) => nameOf(s, id))).toContain('Test Peace Treaty');
    expect(legalActions(s, 'p2').some((a) => a.kind === 'cast')).toBe(false); // "your opponents can't cast spells this turn" outlives the ended phase
  });
  it('the turn goes on normally afterwards: the second main phase passes to the end step and the next turn', () => {
    const { s: s0 } = attacking();
    const s = run(order(s0, true), (x) => x.turn.number === 2, 'turn 2');
    expect(s.turn.activePlayer).toBe('p2');
  });
});

// ---- reselecting what a creature attacks ----------------------------------------------------------------------------------------------------------------
const WATCH = synthetic('Test Watch Officer', 'Legendary Creature — Vulcan Officer', '{0}', "Flash\nWhen ~ enters during the declare attackers step, choose up to two target attacking creatures. For each of them, you may reselect which player or permanent that creature is attacking.", PT);
const LEADER = synthetic('Test Raid Leader', 'Creature — Warrior', '{1}', 'Whenever ~ attacks, you gain 1 life.', { power: '3', toughness: '3' });
const SAGE = synthetic('Test Wall Sage', 'Legendary Planeswalker — Sage', '{2}', '+1: You gain 1 life.', { loyalty: '4' });
const RESELECT_DEFS = [WATCH, LEADER, SAGE];
describe('CR 508.7: "When ~ enters during the declare attackers step, choose up to two target attacking creatures. For each of them, you may reselect which player or permanent that creature is attacking."', () => {
  const setup = (): { s: GameState; leader: ObjectId; sage: ObjectId } => {
    let s = scenario([], { defs: [...DEFS, ...RESELECT_DEFS], p1: { battlefield: ['Test Raid Leader'], hand: ['Test Watch Officer'] }, p2: { battlefield: [{ name: 'Test Wall Sage', counters: { loyalty: 4 } }] } });
    const leader = onField(s, 'Test Raid Leader')!;
    const sage = onField(s, 'Test Wall Sage')!;
    s = run(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    s = drive(answer(s, attackWith([leader])));
    s = pass(pass(s)); // its attack trigger resolves
    return { s, leader, sage };
  };
  const flashIn = (s0: GameState, leader: ObjectId, pick: string | null): GameState => {
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Watch Officer', 'hand', 'p1') }));
    s = pass(pass(s)); // the creature spell resolves, its enters trigger asks for targets
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: leader }] });
    s = pass(pass(s)); // the trigger resolves
    if (s.pending?.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: pick === null ? [] : [pick] });
    return s;
  };
  const defenderOf = (s: GameState, id: ObjectId): string | null | undefined => s.combat?.attackers.find((a) => a.id === id)?.defender;
  it('is full', () => expect(full(WATCH)).toBe(true));
  it('the attacker is attacking the planeswalker instead of the player; it stays in combat and does not attack again (no second attack trigger)', () => {
    const { s: s0, leader, sage } = setup();
    expect(defenderOf(s0, leader)).toBe('p2');
    expect(lifeOf(s0, 'p1')).toBe(21); // its attack trigger
    const s = flashIn(s0, leader, sage);
    expect(s.turn.step).toBe('declareAttackers');
    expect(defenderOf(s, leader)).toBe(sage);
    expect(s.combat!.attackers.find((a) => a.id === leader)!.defendingPlayer).toBe('p2');
    expect(lifeOf(s, 'p1')).toBe(21);
    const t = run(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'the second main phase');
    expect(lifeOf(t, 'p2')).toBe(20); // the damage went to the planeswalker
    expect(t.objects[sage]!.counters['loyalty']).toBe(1);
  });
  it('"you may": keeping what it attacks is allowed', () => {
    const { s: s0, leader } = setup();
    const s = flashIn(s0, leader, null);
    expect(defenderOf(s, leader)).toBe('p2');
    expect(run(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'main 2').players.find((p) => p.id === 'p2')!.life).toBe(17);
  });
  it('during the main phase the trigger does not happen (the card must enter during the declare attackers step)', () => {
    let s = scenario([], { defs: [...DEFS, ...RESELECT_DEFS], p1: { battlefield: ['Test Raid Leader'], hand: ['Test Watch Officer'] }, p2: { battlefield: [{ name: 'Test Wall Sage', counters: { loyalty: 4 } }] } });
    s = pass(pass(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Watch Officer', 'hand', 'p1') }))));
    expect(s.zones.stack).toHaveLength(0);
    expect(s.pending?.kind).toBe('priority');
  });
});

// ---- the token that is tapped and attacking, exiled at end of combat --------------------------------------------------------------------------------------
const BARGE = synthetic('Test Star Barge', 'Artifact — Spacecraft', '{3}', 'Station\n1+ | Flying\nWhenever ~ attacks, create a tapped and attacking 4/3 colorless Illusion artifact creature token with flying. Exile that token at end of combat.', { power: '4', toughness: '4' });
describe('CR 508.4, 603.7: "create a tapped and attacking 4/3 ... token with flying. Exile that token at end of combat."', () => {
  it('is full', () => expect(full(BARGE)).toBe(true));
  it('the token enters tapped and attacking, deals its damage, and is exiled at end of combat (not before)', () => {
    let s = scenario([], { defs: [...DEFS, BARGE], p1: { battlefield: [{ name: 'Test Star Barge', counters: { charge: 3 } }] } });
    const barge = onField(s, 'Test Star Barge')!;
    s = run(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    s = drive(answer(s, attackWith([barge])));
    s = pass(pass(s)); // the attack trigger resolves
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(token).toBeDefined();
    expect(s.objects[token]!.tapped).toBe(true);
    expect(s.combat!.attackers.map((a) => a.id)).toContain(token);
    const t = run(s, (x) => x.turn.step === 'endCombat' && x.pending?.kind === 'priority', 'end of combat');
    expect(lifeOf(t, 'p2')).toBe(12); // 4 from the Spacecraft and 4 from the token
    expect(t.objects[token]?.zone === 'battlefield').toBe(true);
    const u = run(t, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'main 2');
    expect(u.zones.battlefield).not.toContain(token);
  });
});
