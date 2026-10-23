/**
 * std-control-1 (lane std-control): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (wordings
 * invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud
 * checkout).
 *
 *   CR 702.179, 608.2c     "If that opponent's speed is greater than each other player's speed, reduce that opponent's speed by 1. This effect can't reduce their
 *                          speed below 1.": only a speed greater than every other player's goes down, never below 1; a tie changes nothing; "that opponent" is the
 *                          controller of the returned creature as it last existed (an opponent's stolen creature of yours: the opponent)
 *   CR 500.7, 611.2a       "Take an extra turn after this one. During that turn, power-up abilities can't be activated.": the rest of this turn they can; in the
 *                          extra turn none can, other activated abilities can; after it, the ban is over
 *   CR 610.3, 601.2        "Target land gains "..." until this card is cast from exile.": the land keeps the ability while the card stays exiled and loses it once
 *                          the card is cast from exile
 *   CR 105.1, 608.2c       "for each color, put a +1/+1 counter on a Dragon you control of that color. If you put +1/+1 counters on five Dragons this way, you win
 *                          the game.": five Dragons of five colors win; a multicolored Dragon may take the counter of each of its colors, and then fewer than five
 *                          Dragons got counters: no win
 *   CR 607.2d, 400.7       "choose a creature an opponent controls ... When the chosen creature leaves the battlefield, transform ~.": the chosen creature leaving
 *                          transforms it, another creature leaving does not; "creatures other than ~ and the chosen creature get -2/-2"
 *   CR 712.20, 607.2d      "As this creature transforms into ~, choose an opponent. When the chosen player loses the game, you win the game.": in a game of three,
 *                          the chosen opponent losing wins the game for you; the other opponent losing does not
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, scenario } from '../../m3/scenario';
import { card, counters, full, pt, resolveAll, settle } from '../cmd3/helpers';
import { concede, mpScenario, resolveStack } from '../../m12/rules/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const speedOf = (s: GameState, p: string): number | undefined => s.designations.speed?.[p];
const withSpeed = (s0: GameState, speeds: Record<string, number>): GameState => {
  const s = structuredClone(s0);
  s.designations.speed = { ...speeds };
  return s;
};

/** A transforming double-faced card (CR 712.2) compiled by the game's default compiler. */
function dfc(name: string, front: { name: string; type: string; text: string; pt?: [string, string] }, back: { name: string; type: string; text: string; pt?: [string, string] }): CardDef {
  const face = (f: typeof front) => ({ name: f.name, mana_cost: f === front ? '{0}' : '', type_line: f.type, oracle_text: f.text, colors: [], ...(f.pt ? { power: f.pt[0], toughness: f.pt[1] } : {}) });
  return compileCard({ name, layout: 'transform', type_line: `${front.type} // ${back.type}`, card_faces: [face(front), face(back)], colors: [] } as unknown as OracleCard);
}

// ---- speed --------------------------------------------------------------------------------------------------------------------------------------------------

const HARRIER = card('Test Harrier', 'Creature — Turtle',
  "When this creature enters, return target creature an opponent controls to its owner's hand. If that opponent's speed is greater than each other player's speed, reduce that opponent's speed by 1. This effect can't reduce their speed below 1.", ['2', '2']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const SPEED_DEFS: CardDef[] = [HARRIER, BEAR];

function bounce(speeds: Record<string, number>, mine = false): GameState {
  let s = scenario([], { p1: { hand: ['Test Harrier'], ...(mine ? { battlefield: ['Test Bear'] } : {}) }, p2: { battlefield: mine ? [] : ['Test Bear'] }, defs: SPEED_DEFS });
  if (mine) {
    // CR 108.4: a creature Alice owns that Bob controls (a control-changing effect long ago): "an opponent controls" it, its owner's hand is Alice's
    s = structuredClone(s);
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s.objects[bear]!.controller = 'p2';
  }
  s = withSpeed(s, speeds);
  const bear = s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear')!;
  s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Harrier', 'hand', 'p1') }));
  return resolveAll(s, { targets: [obj(bear)] });
}

describe('the synthetic cards are automated', () => {
  it('every synthetic card with rules text plays fully', () => {
    for (const d of [HARRIER, KANG, BOOSTER, DOOM, SPIRITS, ZENOS]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 702.179, 608.2c: "reduce that opponent\'s speed by 1. This effect can\'t reduce their speed below 1."', () => {
  it('the opponent\'s speed 3 is greater than every other player\'s (Alice 1): it becomes 2; the creature is returned to its owner\'s hand', () => {
    const s = bounce({ p1: 1, p2: 3 });
    expect(speedOf(s, 'p2')).toBe(2);
    expect(speedOf(s, 'p1')).toBe(1);
    expect(s.zones.hand.p2!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear')).toBe(true);
  });
  it('a tie is not greater than each other player\'s speed: nothing changes', () => {
    const s = bounce({ p1: 2, p2: 2 });
    expect(speedOf(s, 'p2')).toBe(2);
  });
  it('the floor: speed 1 against no speed (0, CR 702.179f) stays 1', () => {
    const s = bounce({ p2: 1 });
    expect(speedOf(s, 'p2')).toBe(1);
    expect(speedOf(s, 'p1')).toBeUndefined();
  });
  it('"that opponent" is the controller of the creature as it last existed: Bob controlled Alice\'s creature, so Bob\'s speed goes down (it returns to Alice\'s hand)', () => {
    const s = bounce({ p1: 1, p2: 4 }, true);
    expect(speedOf(s, 'p2')).toBe(3);
    expect(speedOf(s, 'p1')).toBe(1);
    expect(s.zones.hand.p1!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear')).toBe(true);
  });
});

// ---- "during that turn" -------------------------------------------------------------------------------------------------------------------------------------

const KANG = card('Test Chronarch', 'Creature — Human Villain', 'Power-up — {1}: Draw a card. Take an extra turn after this one. During that turn, power-up abilities can\'t be activated.', ['2', '2'], '{3}');
const BOOSTER = card('Test Booster', 'Creature — Robot', 'Power-up — {1}: Put a +1/+1 counter on this creature.\n{1}: This creature gets +1/+0 until end of turn.', ['1', '1'], '{2}');
const TIME_DEFS: CardDef[] = [KANG, BOOSTER];
const PLAINS = ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'];

const abilityOf = (s: GameState, source: ObjectId, i: number): string => `p:0:${i}`;
const canActivate = (s: GameState, source: ObjectId, i: number): boolean => {
  try {
    act(s, { type: 'activate', player: 'p1', source, ability: abilityOf(s, source, i) });
    return true;
  } catch {
    return false;
  }
};
const activate = (s: GameState, source: ObjectId, i: number): GameState => resolveAll(settle(act(s, { type: 'activate', player: 'p1', source, ability: abilityOf(s, source, i) })));
/** On to the first main phase of the next turn: priority passed, no attackers or blockers declared, the cleanup discard answered. */
const nextMain = (s0: GameState): GameState => {
  const turn = s0.turn.number;
  let s = s0;
  for (let i = 0; i < 300; i++) {
    if (s.turn.number > turn && s.turn.step === 'main1' && s.pending?.kind === 'priority' && s.zones.stack.length === 0) return s;
    const d = s.pending!;
    if (d.kind === 'priority') s = act(s, { type: 'pass', player: d.player });
    else if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else s = settle(s);
  }
  throw new Error('never reached the next main phase');
};

describe('CR 500.7, 611.2a: "Take an extra turn after this one. During that turn, power-up abilities can\'t be activated."', () => {
  const board = (): GameState => scenario([], { p1: { battlefield: ['Test Chronarch', 'Test Booster', ...PLAINS] }, defs: TIME_DEFS });
  it('the rest of this turn power-up abilities can still be activated; in the extra turn none can, another activated ability can', () => {
    let s = board();
    const kang = find(s, 'Test Chronarch', 'battlefield', 'p1');
    const booster = find(s, 'Test Booster', 'battlefield', 'p1');
    s = activate(s, kang, 0);
    expect(canActivate(s, booster, 0)).toBe(true); // this turn: the effect is dormant
    s = nextMain(s);
    expect(s.turn.activePlayer).toBe('p1'); // the extra turn (CR 500.7)
    expect(canActivate(s, booster, 0)).toBe(false);
    expect(canActivate(s, booster, 1)).toBe(true);
  });
  it('after the extra turn the ban is over (Bob\'s turn, then Alice\'s next one)', () => {
    let s = board();
    const kang = find(s, 'Test Chronarch', 'battlefield', 'p1');
    const booster = find(s, 'Test Booster', 'battlefield', 'p1');
    s = activate(s, kang, 0);
    s = nextMain(nextMain(nextMain(s)));
    expect(s.turn.activePlayer).toBe('p1');
    expect(s.continuousEffects.some((e) => e.duration.d === 'duringNextTurn')).toBe(false);
    expect(canActivate(s, booster, 0)).toBe(true);
  });
});

// ---- "until this card is cast from exile" ------------------------------------------------------------------------------------------------------------------

const DOOM = card('Test Doom', 'Creature — Eldrazi', '{1}, Exile this card from your hand: Target land gains "{T}: Add {C}{C}{C}" until this card is cast from exile. You may cast this card for as long as it remains exiled.', ['5', '5'], '{3}');

describe('CR 610.3, 400.7: "Target land gains "{T}: Add {C}{C}{C}" until this card is cast from exile."', () => {
  const abilitiesOf = (s: GameState, id: ObjectId): number => s.continuousEffects.filter((e) => JSON.stringify(e).includes(id)).length;
  it('the land has the ability while the card is exiled, and loses it as the card is cast from exile', () => {
    let s = scenario([], { p1: { hand: ['Test Doom'], battlefield: PLAINS }, defs: [DOOM] });
    const land = find(s, 'Plains', 'battlefield', 'p1');
    const doom = find(s, 'Test Doom', 'hand', 'p1');
    s = resolveAll(settle(act(s, { type: 'activate', player: 'p1', source: doom, ability: 'p:0:0' }), { targets: [obj(land)] }));
    expect(s.zones.exile.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Doom')).toBe(true);
    expect(abilitiesOf(s, land)).toBe(1);
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Doom', 'exile') }));
    s = resolveAll(s);
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Doom')).toBe(true);
    expect(abilitiesOf(s, land)).toBe(0);
  });
});

// ---- "for each color" ---------------------------------------------------------------------------------------------------------------------------------------

const SPIRITS = card('Test Spirit Call', 'Enchantment', 'At the beginning of your end step, for each color, put a +1/+1 counter on a Dragon you control of that color. If you put +1/+1 counters on five Dragons this way, you win the game.');
const dragon = (name: string, colors: string[]): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: 'Creature — Dragon', oracle_text: '', colors, power: '2', toughness: '2' } as unknown as OracleCard);
const WHITE = dragon('Test White Dragon', ['W']);
const BLUE = dragon('Test Blue Dragon', ['U']);
const BLACK = dragon('Test Black Dragon', ['B']);
const RED = dragon('Test Red Dragon', ['R']);
const GREEN = dragon('Test Green Dragon', ['G']);
const GOLD = dragon('Test Gold Dragon', ['W', 'U']);
const COLOR_DEFS: CardDef[] = [SPIRITS, WHITE, BLUE, BLACK, RED, GREEN, GOLD];
/** On to the end step trigger of this turn (priority passed, no attackers declared). */
const toEndStep = (s0: GameState): GameState => {
  let s = s0;
  for (let i = 0; i < 100; i++) {
    if (s.zones.stack.length > 0 || s.result !== null) return s;
    const d = s.pending!;
    if (d.kind === 'priority') s = act(s, { type: 'pass', player: d.player });
    else if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else s = settle(s);
  }
  throw new Error('never reached the end step trigger');
};

describe('CR 105.1, 608.2c, 104.2b: "for each color, put a +1/+1 counter on a Dragon you control of that color. If you put +1/+1 counters on five Dragons this way ..."', () => {
  it('five Dragons, one of each color: each gets a counter and you win the game', () => {
    let s = scenario([], { p1: { battlefield: ['Test Spirit Call', 'Test White Dragon', 'Test Blue Dragon', 'Test Black Dragon', 'Test Red Dragon', 'Test Green Dragon'] }, defs: COLOR_DEFS });
    s = resolveAll(toEndStep(s));
    expect(s.result).not.toBeNull();
    expect(JSON.stringify(s.result)).toContain('p1');
  });
  it('a white-and-blue Dragon takes the counters of both its colors when it is the only one of them: four Dragons got counters, no win', () => {
    let s = scenario([], { p1: { battlefield: ['Test Spirit Call', 'Test Gold Dragon', 'Test Black Dragon', 'Test Red Dragon', 'Test Green Dragon'] }, defs: COLOR_DEFS });
    const gold = find(s, 'Test Gold Dragon', 'battlefield', 'p1');
    s = resolveAll(toEndStep(s));
    expect(s.result).toBeNull();
    expect(counters(s, gold, '+1/+1')).toBe(2);
    expect(counters(s, find(s, 'Test Black Dragon', 'battlefield', 'p1'), '+1/+1')).toBe(1);
  });
  it('a color with no Dragon of it gets no counter (no green Dragon): no win', () => {
    let s = scenario([], { p1: { battlefield: ['Test Spirit Call', 'Test White Dragon', 'Test Blue Dragon', 'Test Black Dragon', 'Test Red Dragon'] }, defs: COLOR_DEFS });
    s = resolveAll(toEndStep(s));
    expect(s.result).toBeNull();
    expect(counters(s, find(s, 'Test Red Dragon', 'battlefield', 'p1'), '+1/+1')).toBe(1);
  });
});

// ---- chosen creature, chosen player -------------------------------------------------------------------------------------------------------------------------

const ZENOS = dfc('Test Rival // Test Ascended Rival',
  { name: 'Test Rival', type: 'Legendary Creature — Human Warrior', text: 'When this creature enters, choose a creature an opponent controls. Until end of turn, creatures other than this creature and the chosen creature get -1/-1.\nWhen the chosen creature leaves the battlefield, transform this creature.', pt: ['3', '3'] },
  { name: 'Test Ascended Rival', type: 'Legendary Creature — Dragon', text: 'Flying\nAs this creature transforms into Test Ascended Rival, choose an opponent.\nWhen the chosen player loses the game, you win the game.', pt: ['5', '5'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);
const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
const RIVAL_DEFS: CardDef[] = [ZENOS, OGRE, BEAR, SMITE];
const isBack = (s: GameState, id: ObjectId): boolean => s.objects[id]?.face === 1; // CR 712.8: a transformed permanent has its back face up

describe('CR 607.2d, 400.7: "choose a creature an opponent controls ... When the chosen creature leaves the battlefield, transform ~."', () => {
  const enter = (): { s: GameState; ogre: ObjectId; bear: ObjectId } => {
    let s = scenario([], { p1: { hand: ['Test Rival // Test Ascended Rival', 'Test Smite'] }, p2: { battlefield: ['Test Ogre', 'Test Bear'] }, defs: RIVAL_DEFS });
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rival // Test Ascended Rival', 'hand', 'p1') }));
    s = resolveAll(s, { objects: [ogre] });
    return { s, ogre, bear };
  };
  it('the creatures other than ~ and the chosen creature get -1/-1 until end of turn; the chosen one does not', () => {
    const { s, ogre, bear } = enter();
    expect(pt(s, ogre)).toBe('3/3');
    expect(pt(s, bear)).toBe('1/1');
    expect(pt(s, find(s, 'Test Rival // Test Ascended Rival', 'battlefield', 'p1'))).toBe('3/3');
  });
  it('the chosen creature leaving the battlefield transforms ~; another creature leaving does not', () => {
    const { s: s0, ogre, bear } = enter();
    const rival = find(s0, 'Test Rival // Test Ascended Rival', 'battlefield', 'p1');
    let s = resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Smite', 'hand', 'p1') }), { targets: [obj(bear)] }));
    expect(isBack(s, rival)).toBe(false);
    s = structuredClone(s);
    s.zones.hand.p1!.push(...[]);
    const smite2 = s.zones.graveyard.p1!.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Smite')!;
    s.zones.graveyard.p1 = s.zones.graveyard.p1!.filter((id) => id !== smite2);
    s.zones.hand.p1!.push(smite2);
    s.objects[smite2]!.zone = 'hand';
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: smite2 }), { targets: [obj(ogre)] }));
    expect(isBack(s, rival)).toBe(true);
  });
});

describe('CR 712.20, 607.2d, 800.4a: "As this creature transforms into ~, choose an opponent. When the chosen player loses the game, you win the game."', () => {
  const transformed = (chosen: string): GameState => {
    let s = mpScenario({ defs: RIVAL_DEFS, cards: [], zones: { p1: { battlefield: ['Test Rival // Test Ascended Rival'] }, p3: { battlefield: ['Test Ogre'] } } });
    const rival = find(s, 'Test Rival // Test Ascended Rival', 'battlefield', 'p1');
    // the chosen creature (Carol's Ogre) is remembered by the Rival, as its trigger would have chosen it (CR 607.2d)
    s = structuredClone(s);
    s.objects[rival]!.links = { ...(s.objects[rival]!.links ?? {}), chosen: { objects: [{ id: find(s, 'Test Ogre', 'battlefield', 'p3'), zone: 'battlefield' }] } } as never;
    s = resolveStack(concede(s, 'p3').state, [{ kind: 'chooseOption', ids: [chosen] }]);
    return s;
  };
  it('Carol\'s creature leaves with her: the Rival transforms and Alice chooses Bob; Bob losing wins the game for Alice', () => {
    let s = transformed('p2');
    expect(s.result).toBeNull();
    s = resolveStack(concede(s, 'p2').state);
    expect(JSON.stringify(s.result)).toContain('p1');
  });
  it('the opponent not chosen losing does not: Alice chose Dan, Bob concedes, the game goes on', () => {
    let s = transformed('p4');
    s = resolveStack(concede(s, 'p2').state);
    expect(s.result).toBeNull();
  });
});

