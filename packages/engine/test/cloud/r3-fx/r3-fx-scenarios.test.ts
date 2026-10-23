/**
 * Standard round 3, slice r3-fx: the shapes of this slice played through applyAction with synthetic cards compiled by the game's default compiler (invented
 * wordings, design 6.10). Nothing is mocked. The promotions (design 6.9, 10.4) rest on these plays and on the hand-verified golden cards of
 * test/m5/golden/cards/cloud-r3-fx-review.json.
 *
 *   CR 614.1e, 708.11, 702.168a  "As this creature is turned face up, put N +1/+1 counters on it" (static.m6.turnedFaceUp.counters): turning it face up, not
 *                                entering face down (CR 708.3)
 *   CR 110.2, 122.6, 614.1c      "put target creature card ... onto the battlefield under your control with a finality counter on it" (eff.e13.put.bf.counter)
 *   CR 603.7, 603.7a, 513.1      "At the beginning of your next end step, exile that creature." (dl.yourNextEnd.lead)
 *   CR 701.47a, 608.2h, 603.10a  "When this creature dies, amass Goblins X, where X is this creature's power." (eff.e16.amass.goblins.whereX): its power as it
 *                                last existed on the battlefield, counters included
 *   CR 701.24a, 401.1            "shuffle your graveyard into your library" (eff.t6.shuffle.graveyardInto.you)
 *   CR 111.1, 122.1, 608.2h      "{T}, Sacrifice this artifact: Create a ... token for each counter on this artifact." (eff.t67.token.forEach.counterOnSelf): the
 *                                counters it had as it was sacrificed (last known information)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, pass, put, reject, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';
import { tweak } from '../../m5/helpers';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual node): what a promotion makes full. */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };

function settle(s0: GameState, opts: { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[] } = {}): GameState {
  let s = s0;
  const groups = opts.targets ?? [];
  const picks = opts.picks ?? [];
  const queue = opts.answers ?? [];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else if (s.pending.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (s.pending.kind === 'chooseObjects' && picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: picks.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
type Opts = Parameters<typeof settle>[1];
/** Pass priority until the stack is empty, answering what comes up. */
function drain(s0: GameState, opts: Opts = {}): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 12; guard++) s = settle(pass(pass(s)), opts);
  return s;
}
function cast(s0: GameState, name: string, opts: Opts = {}): GameState {
  const q = { targets: [...(opts.targets ?? [])], picks: [...(opts.picks ?? [])], answers: [...(opts.answers ?? [])] };
  return drain(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), { targets: q.targets }), q);
}
function activate(s0: GameState, source: ObjectId, opts: Opts = {}, ability = 'p:0:0'): GameState {
  const q = { targets: [...(opts.targets ?? [])], picks: [...(opts.picks ?? [])], answers: [...(opts.answers ?? [])] };
  return drain(settle(act(s0, { type: 'activate', player: 'p1', source, ability }), { targets: q.targets }), q);
}
/** Pass priority (declaring no attackers and no blockers) until `done`. */
function passTo(s0: GameState, done: (s: GameState) => boolean, opts: Opts = {}, max = 300): GameState {
  let s = s0;
  for (let guard = 0; guard < max && !done(s); guard++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = pass(s);
    else s = settle(s, opts);
  }
  if (!done(s)) throw new Error(`never reached (turn ${s.turn.number} ${s.turn.step}, pending ${s.pending?.kind})`);
  return s;
}
const onBattlefield = (s: GameState, defId: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId);
const tokensNamed = (s: GameState, sub: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && (getChars(s, id).subtypes ?? []).includes(sub));

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}{G}');
const LAND = card('Test Land', 'Land', '');

describe('CR 614.1e, 708.11: "As this creature is turned face up, put three +1/+1 counters on it." (static.m6.turnedFaceUp.counters)', () => {
  const SMUGGLER = card('Test Smuggler', 'Creature — Octopus', 'Disguise {2}{U}\nAs this creature is turned face up, put three +1/+1 counters on it.', ['2', '1'], '{2}{U}');
  it('is automated; a face-down creature gets no counters, turning it face up for its disguise cost puts three on it', () => {
    expect(automated(SMUGGLER)).toBe(true);
    let s = scenario(['Island'], { p1: { battlefield: ['Island', 'Island', 'Island'] }, defs: [SMUGGLER] });
    let id = '';
    s = tweak(s, (x) => { id = put(x, 'p1', 'battlefield', 'Test Smuggler'); Object.assign(x.objects[id]!, { faceDown: true, faceDownInfo: { by: 'disguise', profile: 'ward2' } }); });
    expect(s.objects[id]!.counters['+1/+1'] ?? 0).toBe(0);
    s = settle(act(s, { type: 'special', player: 'p1', kind: 'turnFaceUp', object: id, via: 'disguise' }));
    expect(s.objects[id]!.faceDown).toBe(false);
    expect(s.objects[id]!.counters['+1/+1']).toBe(3);
    expect(getChars(s, id)).toMatchObject({ power: '5', toughness: '4' });
  });
});

describe('CR 110.2, 122.6, 603.7a: "put target creature card ... onto the battlefield under your control with a finality counter on it ... At the beginning of your next end step, exile that creature."', () => {
  const HULK = card('Test Hulk', 'Artifact Creature — Construct', 'When this creature enters, put target creature card with mana value 3 or less from a graveyard onto the battlefield under your control with a finality counter on it. That creature gains haste. At the beginning of your next end step, exile that creature.', ['4', '4']);
  it('is automated; the card enters under your control with one finality counter and haste, and is exiled at the beginning of your next end step', () => {
    expect(automated(HULK)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Hulk'] }, p2: { graveyard: ['Test Bear'] }, defs: [HULK, BEAR] });
    const bear = find(s, 'Test Bear', 'graveyard', 'p2');
    s = cast(s, 'Test Hulk', { targets: [[obj(bear)]] });
    const [b] = onBattlefield(s, 'Test Bear');
    expect(b).toBeDefined();
    expect(s.objects[b!]).toMatchObject({ owner: 'p2', controller: 'p1' });
    expect(s.objects[b!]!.counters.finality).toBe(1);
    expect(getChars(s, b!).abilities.map((a) => (a.def as { keyword?: string }).keyword)).toContain('haste');
    s = passTo(s, (x) => x.turn.number === 1 && x.turn.step === 'end' && x.zones.stack.length > 0);
    s = drain(s);
    expect(onBattlefield(s, 'Test Bear')).toHaveLength(0);
    expect(findAll(s, 'Test Bear', 'exile', 'p2')).toHaveLength(1);
  });
  it('with the finality counter, the creature dying before that end step is exiled instead (CR 122.1h)', () => {
    const SWAT = card('Test Swat', 'Instant', 'Destroy target creature.');
    let s = scenario([], { p1: { hand: ['Test Hulk', 'Test Swat'] }, p2: { graveyard: ['Test Bear'] }, defs: [HULK, BEAR, SWAT] });
    s = cast(s, 'Test Hulk', { targets: [[obj(find(s, 'Test Bear', 'graveyard', 'p2'))]] });
    const [b] = onBattlefield(s, 'Test Bear');
    s = cast(s, 'Test Swat', { targets: [[obj(b!)]] });
    expect(findAll(s, 'Test Bear', 'graveyard', 'p2')).toHaveLength(0);
    expect(findAll(s, 'Test Bear', 'exile', 'p2')).toHaveLength(1);
  });
  it('cast during an opponent\'s turn, "your next end step" is your own end step, not the opponent\'s (CR 603.7a, 513.1)', () => {
    const FLASH_HULK = card('Test Flash Hulk', 'Artifact Creature — Construct', 'Flash\nWhen this creature enters, put target creature card with mana value 3 or less from a graveyard onto the battlefield under your control with a finality counter on it. That creature gains haste. At the beginning of your next end step, exile that creature.', ['4', '4']);
    let s = scenario([], { p1: { hand: ['Test Flash Hulk'] }, p2: { graveyard: ['Test Bear'] }, defs: [FLASH_HULK, BEAR] });
    s = passTo(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.player === 'p2');
    s = pass(s);
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    const bear = find(s, 'Test Bear', 'graveyard', 'p2');
    s = drain(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Flash Hulk', 'hand', 'p1') })), { targets: [[obj(bear)]] });
    s = settle(s, { targets: [[obj(bear)]] });
    s = drain(s);
    expect(onBattlefield(s, 'Test Bear')).toHaveLength(1);
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'main1');
    expect(onBattlefield(s, 'Test Bear')).toHaveLength(1); // the opponent's end step of turn 2 did not exile it
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'end' && x.zones.stack.length > 0);
    s = drain(s);
    expect(onBattlefield(s, 'Test Bear')).toHaveLength(0);
  });
});

describe('CR 724.1, 603.7a: "End the turn. At the beginning of your next end step, you lose the game." (dl.yourNextEnd.lead after endTurn)', () => {
  const FINALE = card('Test Finale', 'Instant', 'End the turn.\nAt the beginning of your next end step, you lose the game.');
  it('is automated; the turn ends (the spell itself is exiled, CR 724.1b), nobody loses at the opponent\'s end step, and its caster loses at their own next end step', () => {
    expect(automated(FINALE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Finale'] }, defs: [FINALE] });
    s = cast(s, 'Test Finale');
    expect(findAll(s, 'Test Finale', 'exile', 'p1')).toHaveLength(1);
    s = passTo(s, (x) => x.turn.number === 2 && x.turn.step === 'main1');
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'main1');
    expect(s.players.map((p) => p.hasLost)).toEqual([false, false]);
    s = passTo(s, (x) => Boolean(x.result) || (x.turn.number === 3 && x.turn.step === 'end' && x.zones.stack.length > 0));
    s = drain(s);
    expect(s.players.find((p) => p.id === 'p1')!.hasLost).toBe(true);
    expect(s.players.find((p) => p.id === 'p2')!.hasLost).toBe(false);
  });
});

describe('CR 603.7, 603.7c, 608.2h: "At the beginning of the next end step, ..." (dl.nextEnd.lead)', () => {
  const THEFT = card('Test Theft', 'Instant', 'Untap target creature you don\'t control and gain control of it. It gains haste until end of turn. At the beginning of the next end step, sacrifice it. If you do, you gain life equal to its toughness.');
  const SNEAK = card('Test Sneak', 'Instant', 'You may put a nongreen creature card from your hand onto the battlefield. At the beginning of the next end step, return that creature to your hand.');
  const BLINK = card('Test Blink', 'Instant', 'Exile target creature. At the beginning of the next end step, return that card to the battlefield under its owner\'s control with a +1/+1 counter on it.');
  const RAISE = card('Test Raise', 'Artifact', '{T}, Sacrifice this artifact: Return target creature card from your graveyard to the battlefield. That creature gains haste. At the beginning of the next end step, sacrifice it.');
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '4'], '{2}{R}', ['R']);
  it('the stolen creature is sacrificed at the end step and its toughness (as it last existed, CR 608.2h) is gained', () => {
    let s = scenario([], { p1: { hand: ['Test Theft'] }, p2: { battlefield: [{ name: 'Test Ogre', tapped: true }] }, defs: [THEFT, OGRE] });
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = cast(s, 'Test Theft', { targets: [[obj(ogre)]] });
    expect(s.objects[ogre]).toMatchObject({ controller: 'p1', tapped: false });
    s = passTo(s, (x) => x.turn.number === 1 && x.turn.step === 'end' && x.zones.stack.length > 0);
    s = drain(s);
    expect(findAll(s, 'Test Ogre', 'graveyard', 'p2')).toHaveLength(1);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(24);
  });
  it('the creature put onto the battlefield from the hand returns to its owner\'s hand at the next end step', () => {
    let s = scenario([], { p1: { hand: ['Test Sneak', 'Test Ogre'] }, defs: [SNEAK, OGRE] });
    s = cast(s, 'Test Sneak', { picks: [[find(s, 'Test Ogre', 'hand', 'p1')]], answers: [yes] });
    expect(onBattlefield(s, 'Test Ogre')).toHaveLength(1);
    s = passTo(s, (x) => x.turn.number === 1 && x.turn.step === 'end' && x.zones.stack.length > 0);
    s = drain(s);
    expect(onBattlefield(s, 'Test Ogre')).toHaveLength(0);
    expect(findAll(s, 'Test Ogre', 'hand', 'p1')).toHaveLength(1);
  });
  it('the exiled card returns under its owner\'s control with a +1/+1 counter at the next end step', () => {
    let s = scenario([], { p1: { hand: ['Test Blink'] }, p2: { battlefield: ['Test Ogre'] }, defs: [BLINK, OGRE] });
    s = cast(s, 'Test Blink', { targets: [[obj(find(s, 'Test Ogre', 'battlefield', 'p2'))]] });
    expect(findAll(s, 'Test Ogre', 'exile', 'p2')).toHaveLength(1);
    s = passTo(s, (x) => x.turn.number === 1 && x.turn.step === 'end' && x.zones.stack.length > 0);
    s = drain(s);
    const [o] = onBattlefield(s, 'Test Ogre');
    expect(s.objects[o!]).toMatchObject({ controller: 'p2' });
    expect(s.objects[o!]!.counters['+1/+1']).toBe(1);
  });
  it('the returned creature is sacrificed at the next end step; a creature that left and came back in between is a new object and stays (CR 400.7)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Raise'], graveyard: ['Test Ogre'] }, defs: [RAISE, OGRE] });
    s = activate(s, find(s, 'Test Raise', 'battlefield', 'p1'), { targets: [[obj(find(s, 'Test Ogre', 'graveyard', 'p1'))]] });
    expect(onBattlefield(s, 'Test Ogre')).toHaveLength(1);
    s = passTo(s, (x) => x.turn.number === 1 && x.turn.step === 'end' && x.zones.stack.length > 0);
    s = drain(s);
    expect(onBattlefield(s, 'Test Ogre')).toHaveLength(0);
    expect(findAll(s, 'Test Ogre', 'graveyard', 'p1')).toHaveLength(1);
  });
});

describe('CR 701.47a, 608.2h: "When this creature dies, amass Goblins X, where X is this creature\'s power." (eff.e16.amass.goblins.whereX)', () => {
  const WOLF = card('Test Wolf', 'Creature — Wolf', 'When this creature dies, amass Goblins X, where X is this creature\'s power.', ['3', '2']);
  const SWAT = card('Test Swat', 'Instant', 'Destroy target creature.');
  it('is automated; X is the power the creature had on the battlefield, its +1/+1 counters included (last known information)', () => {
    expect(automated(WOLF)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Swat'], battlefield: [{ name: 'Test Wolf', counters: { '+1/+1': 2 } }] }, defs: [WOLF, SWAT] });
    s = cast(s, 'Test Swat', { targets: [[obj(find(s, 'Test Wolf', 'battlefield', 'p1'))]] });
    const [army] = tokensNamed(s, 'Army');
    expect(army).toBeDefined();
    expect(getChars(s, army!).subtypes).toEqual(expect.arrayContaining(['Goblin', 'Army']));
    expect(s.objects[army!]!.counters['+1/+1']).toBe(5);
  });
});

describe('CR 701.24a, 401.1: "shuffle your graveyard into your library" (eff.t6.shuffle.graveyardInto.you)', () => {
  const RENEWAL = card('Test Renewal', 'Sorcery', 'Draw a card, then shuffle your graveyard into your library.');
  it('is automated; every card of your graveyard goes into your library, the library is shuffled; the opponent\'s graveyard is untouched', () => {
    expect(automated(RENEWAL)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Renewal'], graveyard: ['Test Bear', 'Test Land'] }, p2: { graveyard: ['Test Bear'] }, defs: [RENEWAL, BEAR, LAND] });
    const before = s.zones.library.p1!.length;
    s = cast(s, 'Test Renewal');
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Test Renewal']);
    expect(s.zones.library.p1!.length).toBe(before - 1 + 2);
    expect(s.zones.library.p1!.filter((id) => ['Test Bear', 'Test Land'].includes(s.objects[id]!.defId))).toHaveLength(2);
    expect(s.zones.graveyard.p2!).toHaveLength(1);
  });
});

describe('CR 111.1, 608.2h: "{T}, Sacrifice this artifact: Create a 1/1 green Insect creature token for each counter on this artifact." (eff.t67.token.forEach.counterOnSelf)', () => {
  const HIVE = card('Test Hive', 'Artifact', '{T}, Sacrifice this artifact: Create a 1/1 green Insect creature token for each counter on this artifact.');
  it('is automated; the counters it had as it was sacrificed count, of every kind (last known information)', () => {
    expect(automated(HIVE)).toBe(true);
    let s = scenario([], { p1: { battlefield: [{ name: 'Test Hive', counters: { nest: 2, charge: 1 } }] }, defs: [HIVE] });
    s = activate(s, find(s, 'Test Hive', 'battlefield', 'p1'));
    expect(findAll(s, 'Test Hive', 'graveyard', 'p1')).toHaveLength(1);
    expect(tokensNamed(s, 'Insect')).toHaveLength(3);
  });
  it('with no counters, no token', () => {
    let s = scenario([], { p1: { battlefield: ['Test Hive'] }, defs: [HIVE] });
    s = activate(s, find(s, 'Test Hive', 'battlefield', 'p1'));
    expect(tokensNamed(s, 'Insect')).toHaveLength(0);
  });
});

/** A transforming double-faced card compiled by the default compiler from invented text on each face. */
function transformCard(front: { name: string; type: string; text: string; pt: [string, string] }, back: { name: string; type: string; text: string; pt: [string, string] }): CardDef {
  const face = (f: typeof front, cost: string) => ({ name: f.name, type_line: f.type, mana_cost: cost, oracle_text: f.text, colors: [], power: f.pt[0], toughness: f.pt[1] });
  return compileCard({ name: `${front.name} // ${back.name}`, layout: 'transform', type_line: `${front.type} // ${back.type}`, mana_cost: '{1}{R}', colors: [], card_faces: [face(front, '{1}{R}'), face(back, '')] } as unknown as OracleCard);
}

describe('CR 608.2c, 608.2d, 400.7, 712.14a: "you may exile it, then return it to the battlefield transformed under its owner\'s control" (one "may" for both instructions)', () => {
  const BLADE = transformCard(
    { name: 'Test Bladeguard', type: 'Creature — Human Soldier', text: 'Whenever this creature deals combat damage to a player, you may exile it, then return it to the battlefield transformed under its owner\'s control.', pt: ['2', '2'] },
    { name: 'Test Bladelord', type: 'Creature — Human Soldier', text: '', pt: ['4', '4'] },
  );
  const attack = (answers: DecisionAnswer[]): GameState => {
    let s = scenario([], { p1: { battlefield: ['Test Bladeguard // Test Bladelord'] }, defs: [BLADE] });
    const id = find(s, 'Test Bladeguard // Test Bladelord', 'battlefield', 'p1');
    s = declareAttackers(toDeclareAttackers(s), [[id]]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.zones.stack.length > 0, 'blockers or the trigger', 20);
    if (s.pending?.kind === 'declareBlockers') s = declareBlockers(s, []);
    s = passUntil(s, (x) => x.zones.stack.length > 0, 'the combat damage trigger', 20);
    return drain(s, { answers });
  };
  it('is automated; the exile names the exiled card, and the return returns that card (not the creature that left)', () => {
    const steps = JSON.stringify(BLADE.faces[0]!.abilities);
    expect(automated(BLADE)).toBe(true);
    expect(steps).toMatch(/"op":"may"/);
    expect(steps).toMatch(/"as":"[a-z0-9]+"/);
  });
  it('accepted: the card is exiled and returns transformed, a new object under its owner\'s control', () => {
    const s = attack([yes]);
    const [back] = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Bladeguard // Test Bladelord');
    expect(back).toBeDefined();
    expect(s.objects[back!]!.face).toBe(1);
    expect(getChars(s, back!)).toMatchObject({ name: 'Test Bladelord', power: '4', toughness: '4' });
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(18);
  });
  it('declined: nothing is exiled and nothing returns (the "may" covers the return too)', () => {
    const s = attack([{ kind: 'yesNo', yes: false }]);
    const [front] = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Bladeguard // Test Bladelord');
    expect(s.objects[front!]!.face).toBe(0);
    expect(s.zones.exile).toHaveLength(0);
  });
});

describe('CR 608.2c, 205.1b, 603.7a: "Return all Mount and Vehicle cards from your graveyard to the battlefield. Sacrifice them at the beginning of the next end step." (a moved group named "them")', () => {
  const RALLY = card('Test Rally', 'Sorcery', 'Return all Mount and Vehicle cards from your graveyard to the battlefield. Sacrifice them at the beginning of the next end step.\nVehicles you control become artifact creatures until end of turn. Creatures you control gain haste until end of turn.');
  const STEED = card('Test Steed', 'Creature — Horse Mount', '', ['3', '3']);
  const WAGON = card('Test Wagon', 'Artifact — Vehicle', 'Crew 2', ['4', '4']);
  it('is automated; the Mount and the Vehicle return (not the Bear), the Vehicle is an artifact creature with haste this turn, and both are sacrificed at the next end step', () => {
    expect(automated(RALLY)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Rally'], graveyard: ['Test Steed', 'Test Wagon', 'Test Bear'] }, defs: [RALLY, STEED, WAGON, BEAR] });
    s = cast(s, 'Test Rally');
    const [w] = onBattlefield(s, 'Test Wagon');
    expect(onBattlefield(s, 'Test Steed')).toHaveLength(1);
    expect(onBattlefield(s, 'Test Bear')).toHaveLength(0);
    expect(getChars(s, w!).types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(getChars(s, w!).subtypes).toContain('Vehicle');
    expect(getChars(s, w!).abilities.map((a) => (a.def as { keyword?: string }).keyword)).toContain('haste');
    s = passTo(s, (x) => x.turn.number === 1 && x.turn.step === 'end' && x.zones.stack.length > 0);
    s = drain(s);
    expect(onBattlefield(s, 'Test Steed')).toHaveLength(0);
    expect(onBattlefield(s, 'Test Wagon')).toHaveLength(0);
    expect(findAll(s, 'Test Wagon', 'graveyard', 'p1')).toHaveLength(1);
  });
});

describe('CR 406.1, 608.2d: "If you don\'t control a Goblin, exile a card from your hand." (eff.r3fx.exile.fromHand.you)', () => {
  const PURGE = card('Test Purge', 'Sorcery', 'Draw a card. If you don\'t control a Goblin, exile a card from your hand.');
  const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', ['1', '1']);
  it('is automated; with no Goblin you choose a card in your hand and exile it; with one, nothing is exiled', () => {
    expect(automated(PURGE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Purge', 'Test Bear', 'Test Land'] }, defs: [PURGE, BEAR, LAND] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Purge', 'hand', 'p1') });
    s = settle(s);
    s = settle(pass(pass(s)));
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1' });
    s = drain(settle(s, { picks: [[find(s, 'Test Land', 'hand', 'p1')]] }));
    expect(findAll(s, 'Test Land', 'exile', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Bear', 'hand', 'p1')).toHaveLength(1);
    let t = scenario([], { p1: { hand: ['Test Purge', 'Test Bear'], battlefield: ['Test Goblin'] }, defs: [PURGE, BEAR, GOBLIN] });
    t = cast(t, 'Test Purge');
    expect(t.zones.exile).toHaveLength(0);
    expect(findAll(t, 'Test Bear', 'hand', 'p1')).toHaveLength(1);
  });
});

describe('CR 400.7, 712.14a, 201.5: "Exile ~, then return ~ to the battlefield transformed under ~\'s owner\'s control." (eff.r3fx.exile.self.returnTransformed.selfOwner)', () => {
  const POET = transformCard(
    { name: 'Test Poet', type: 'Legendary Creature — Human Bard', text: '{2}: Exile Test Poet, then return Test Poet to the battlefield transformed under Test Poet\'s owner\'s control. Activate only as a sorcery.', pt: ['2', '3'] },
    { name: 'Test Laureate', type: 'Legendary Creature — Human Bard', text: '', pt: ['5', '5'] },
  );
  it('is automated; the card is exiled and the card in exile returns transformed (a new object), not left in exile', () => {
    expect(automated(POET)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Poet // Test Laureate', 'Plains', 'Plains'] }, defs: [POET] });
    s = activate(s, find(s, 'Test Poet // Test Laureate', 'battlefield', 'p1'));
    expect(s.zones.exile).toHaveLength(0);
    const [back] = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Poet // Test Laureate');
    expect(s.objects[back!]!.face).toBe(1);
    expect(getChars(s, back!)).toMatchObject({ name: 'Test Laureate', power: '5', toughness: '5' });
  });
});

describe('CR 120.1, 608.2h: "If that creature wasn\'t dealt damage this turn, its controller draws two cards." (holes/cond.ts, r3-fx)', () => {
  const FAITH = card('Test Faithful', 'Creature — Human Wizard', 'When this creature enters, destroy up to one other target creature. If that creature wasn\'t dealt damage this turn, its controller draws two cards.', ['3', '2']);
  const PING = card('Test Ping', 'Instant', 'Test Ping deals 1 damage to target creature.');
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '4']);
  it('is automated; an undamaged creature is destroyed and its controller (the opponent) draws two', () => {
    expect(automated(FAITH)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Faithful'] }, p2: { battlefield: ['Test Ogre'] }, defs: [FAITH, OGRE] });
    const hand2 = s.zones.hand.p2!.length;
    s = cast(s, 'Test Faithful', { targets: [[obj(find(s, 'Test Ogre', 'battlefield', 'p2'))]] });
    expect(findAll(s, 'Test Ogre', 'graveyard', 'p2')).toHaveLength(1);
    expect(s.zones.hand.p2!.length).toBe(hand2 + 2);
  });
  it('a creature dealt damage this turn (as it last existed) is destroyed and nobody draws', () => {
    let s = scenario([], { p1: { hand: ['Test Ping', 'Test Faithful'] }, p2: { battlefield: ['Test Ogre'] }, defs: [FAITH, OGRE, PING] });
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = cast(s, 'Test Ping', { targets: [[obj(ogre)]] });
    const hand2 = s.zones.hand.p2!.length;
    s = cast(s, 'Test Faithful', { targets: [[obj(ogre)]] });
    expect(findAll(s, 'Test Ogre', 'graveyard', 'p2')).toHaveLength(1);
    expect(s.zones.hand.p2!.length).toBe(hand2);
  });
});

describe('CR 509.1b, 604.1, 611.3a: "This creature can\'t be blocked if an artifact entered the battlefield under your control this turn." (sta.r3fx.self.unblockable.if)', () => {
  const DROID = card('Test Droid', 'Artifact Creature — Robot', 'This creature can\'t be blocked if an artifact entered the battlefield under your control this turn.', ['2', '1']);
  const GEAR = card('Test Gear', 'Artifact', '');
  const attack = (artifactFirst: boolean): { s: GameState; droid: ObjectId; bear: ObjectId } => {
    let s = scenario([], { p1: { hand: ['Test Gear'], battlefield: ['Test Droid'] }, p2: { battlefield: ['Test Bear'] }, defs: [DROID, GEAR, BEAR] });
    if (artifactFirst) s = cast(s, 'Test Gear');
    const droid = find(s, 'Test Droid', 'battlefield', 'p1');
    s = declareAttackers(toDeclareAttackers(s), [[droid]]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'endCombat', 'blockers or the end of combat', 30);
    return { s, droid, bear: find(s, 'Test Bear', 'battlefield', 'p2') };
  };
  it('is automated; after an artifact entered under your control this turn the creature can\'t be blocked (no block is offered, and it deals its damage)', () => {
    expect(automated(DROID)).toBe(true);
    const { s, droid, bear } = attack(true);
    if (s.pending?.kind === 'declareBlockers') reject(s, { type: 'answer', player: 'p2', decisionId: s.pending.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: bear, attacker: droid }] } });
    const t = s.pending?.kind === 'declareBlockers' ? declareBlockers(s, []) : s;
    const end = passUntil(t, (x) => x.turn.step === 'endCombat', 'the end of combat', 30);
    expect(end.players.find((p) => p.id === 'p2')!.life).toBe(18);
  });
  it('without one it can be blocked', () => {
    const { s, droid, bear } = attack(false);
    expect(s.pending?.kind).toBe('declareBlockers');
    const t = declareBlockers(s, [[bear, droid]]);
    expect(t.pending?.kind).not.toBe('declareBlockers');
  });
});

describe('CR 509.1b, 611.3a: "This creature can\'t be blocked if you\'ve cast two or more creature spells this turn." (sta.r3fx.self.unblockable.if; a count of cast events with a filter)', () => {
  const ROGUE = card('Test Rogue', 'Creature — Rogue', 'This creature can\'t be blocked if you\'ve cast two or more creature spells this turn.', ['2', '1']);
  const PUP = card('Test Pup', 'Creature — Dog', '', ['1', '1']);
  const ROCK = card('Test Rock', 'Artifact', '');
  const attack = (hand: string[]): GameState => {
    let s = scenario([], { p1: { hand, battlefield: ['Test Rogue'] }, p2: { battlefield: ['Test Bear'] }, defs: [ROGUE, PUP, ROCK, BEAR] });
    for (const n of hand) s = cast(s, n);
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Rogue', 'battlefield', 'p1')]]);
    return passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'endCombat', 'blockers or the end of combat', 30);
  };
  it('is automated; after two creature spells this turn no block is offered', () => {
    expect(automated(ROGUE)).toBe(true);
    expect(attack(['Test Pup', 'Test Pup']).pending?.kind).not.toBe('declareBlockers');
  });
  it('one creature spell and an artifact spell are not two creature spells: it can be blocked', () => {
    expect(attack(['Test Pup', 'Test Rock']).pending?.kind).toBe('declareBlockers');
  });
});

describe('CR 111.1, 608.2c: "Create a Clue token and a 1/1 green Squirrel creature token." (eff.r3fx.token.two.kinds, render/fold-r3fx.ts)', () => {
  const STASH = card('Test Stash', 'Sorcery', 'Create a Clue token and a 1/1 green Squirrel creature token.');
  it('is automated; you create one token of each kind', () => {
    expect(automated(STASH)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Stash'] }, defs: [STASH] });
    s = cast(s, 'Test Stash');
    expect(tokensNamed(s, 'Squirrel')).toHaveLength(1);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && (getChars(s, id).subtypes ?? []).includes('Clue'))).toHaveLength(1);
  });
});

describe('CR 701.21a, 111.1, 608.2c: "you may sacrifice an artifact, enchantment, or token. If you don\'t, tap this creature." (holes/filter.ts list closed by "token")', () => {
  const BRUTE = card('Test Brute', 'Creature — Horror', 'At the beginning of your upkeep, you may sacrifice an artifact, enchantment, or token. If you don\'t, tap this creature.', ['5', '5']);
  const STASH = card('Test Stash', 'Sorcery', 'Create a Clue token and a 1/1 green Squirrel creature token.');
  const toUpkeep = (s0: GameState): GameState => passTo(s0, (x) => x.turn.number === 3 && x.turn.step === 'upkeep' && (x.zones.stack.length > 0 || x.pending?.kind !== 'priority'));
  it('is automated; a token creature may be sacrificed (not a nontoken creature), and then the creature stays untapped', () => {
    expect(automated(BRUTE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Stash'], battlefield: ['Test Brute', 'Test Bear'] }, defs: [BRUTE, STASH, BEAR] });
    s = cast(s, 'Test Stash');
    s = toUpkeep(s);
    s = settle(s, { answers: [yes] });
    s = drain(s, { answers: [yes] });
    if (s.pending?.kind === 'chooseObjects') {
      const opts = (s.pending as unknown as { options: ObjectId[] }).options;
      expect(opts.some((id) => s.objects[id]!.defId === 'Test Bear')).toBe(false);
      s = drain(settle(s, { picks: [[opts.find((id) => (getChars(s, id).subtypes ?? []).includes('Squirrel'))!]] }));
    }
    expect(tokensNamed(s, 'Squirrel')).toHaveLength(0);
    expect(s.objects[find(s, 'Test Brute', 'battlefield', 'p1')]!.tapped).toBe(false);
  });
  it('with nothing it may sacrifice (only a nontoken creature), the creature is tapped', () => {
    let s = scenario([], { p1: { battlefield: ['Test Brute', 'Test Bear'] }, defs: [BRUTE, BEAR] });
    s = toUpkeep(s);
    s = drain(settle(s, { answers: [yes] }), { answers: [yes] });
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1')).toHaveLength(1);
    expect(s.objects[find(s, 'Test Brute', 'battlefield', 'p1')]!.tapped).toBe(true);
  });
});

describe('CR 508.1, 509.1, 118.12, 201.5: "Whenever Test Twins attack or block, sacrifice a permanent unless you discard a card." (render/evt.ts, family plural-name-events)', () => {
  const TWINS = card('Test Twins', 'Legendary Creature — Boar Rhino', 'Whenever Test Twins attack or block, sacrifice a permanent unless you discard a card.', ['7', '5']);
  const GEAR = card('Test Gear', 'Artifact', '');
  const attack = (hand: string[]): { s: GameState; twins: ObjectId } => {
    let s = scenario([], { p1: { hand, battlefield: ['Test Twins', 'Test Gear'] }, defs: [TWINS, GEAR, BEAR] });
    const twins = find(s, 'Test Twins', 'battlefield', 'p1');
    s = declareAttackers(toDeclareAttackers(s), [[twins]]);
    return { s, twins };
  };
  it('is automated; one trigger on attacking: with a card in hand, you discard it and keep your permanents', () => {
    expect(automated(TWINS)).toBe(true);
    let { s } = attack(['Test Bear']);
    s = drain(settle(s, { answers: [yes] }), { answers: [yes] });
    if (s.pending?.kind === 'chooseObjects') s = drain(settle(s, { picks: [[find(s, 'Test Bear', 'hand', 'p1')]] }));
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Gear', 'battlefield', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Twins', 'battlefield', 'p1')).toHaveLength(1);
  });
  it('with no card to discard, you sacrifice a permanent of your choice', () => {
    let { s } = attack([]);
    s = drain(settle(s));
    expect(s.pending?.kind).toBe('chooseObjects');
    s = drain(settle(s, { picks: [[find(s, 'Test Gear', 'battlefield', 'p1')]] }));
    expect(findAll(s, 'Test Gear', 'graveyard', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Twins', 'battlefield', 'p1')).toHaveLength(1);
  });
});

// Standard merge wave 4 (line fx): the review item of r3-fx, Ifrit, Warden of Inferno's chapters II-III ("If Ifrit has three or more lore counters on it,
// exile it, then return it to the battlefield"): inside an "if" branch too, an instruction that moved an object binds what it moved (lower/mentions.ts#movedInside),
// so the return returns the exiled card. Before, the return named the object that had left the battlefield and did nothing (CR 400.7): a deliberate G10 change,
// docs/coverage/wave4-fx-g10.txt.
describe('CR 400.7, 608.2c: "If ~ has a +1/+1 counter on it, exile it, then return it to the battlefield." (an "if" branch binds what it moved)', () => {
  const BLINKER = card('Test Blinker', 'Creature — Phoenix', '{1}: If this creature has a +1/+1 counter on it, exile it, then return it to the battlefield.', ['2', '2']);
  it('is automated; the exile names the exiled card and the return returns that card', () => {
    expect(automated(BLINKER)).toBe(true);
    const steps = JSON.stringify(BLINKER.faces[0]!.abilities);
    expect(steps).toMatch(/"op":"if"/);
    expect(steps).toMatch(/"what":\{"ref":"bound","name":"[a-zA-Z0-9]+"\},"to":\{"zone":"battlefield"/);
  });
  it('with a counter: the creature is exiled and comes back as a new object without the counter (CR 400.7, 122.2)', () => {
    let id = '' as ObjectId;
    let s = scenario([], { p1: { battlefield: ['Plains'] }, defs: [BLINKER] });
    s = tweak(s, (x) => { id = put(x, 'p1', 'battlefield', 'Test Blinker'); x.objects[id]!.counters['+1/+1'] = 1; });
    s = activate(s, id);
    expect(s.zones.exile).toHaveLength(0);
    const back = onBattlefield(s, 'Test Blinker');
    expect(back).toHaveLength(1);
    expect(back[0]).not.toBe(id);
    expect(s.objects[back[0]!]!.counters['+1/+1'] ?? 0).toBe(0);
  });
  it('without a counter: nothing is exiled', () => {
    let id = '' as ObjectId;
    let s = scenario([], { p1: { battlefield: ['Plains'] }, defs: [BLINKER] });
    s = tweak(s, (x) => { id = put(x, 'p1', 'battlefield', 'Test Blinker'); });
    s = activate(s, id);
    expect(onBattlefield(s, 'Test Blinker')).toEqual([id]);
  });
});
