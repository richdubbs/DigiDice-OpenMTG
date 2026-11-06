/**
 * edh-players-5 (Commander lane edh-players): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names
 * and wordings, design 6.10). Each test is named after the rule it checks, with its negative case. The cites were checked against the Comprehensive Rules text of 2026-09-25
 * (media.wizards.com, fetched in the cloud session) and the Scryfall rulings of the cards.
 *
 *   CR 602.2, 605.1a, 603.2    "Whenever an opponent activates an ability of a creature or land that isn't a mana ability"; "... of an artifact, creature, or land on the battlefield, if it isn't a mana ability"
 *   CR 121.1, 119.3, 107.1a    "draws cards equal to half the number of cards in their library and loses half their life. Round up each time."
 *   CR 119.3, 701.21a, 106.1   "Any number of target players each lose 2 life and sacrifice a creature of their choice. You add {B}{B} and draw a card."
 *   CR 611.2c, 613.4c, 107.3c  "~ and Drakes you control each get +X/+X until end of turn, where X is the number of cards in your hand"
 *   CR 702.11b-c, 119.8, 104.3 "Players gain hexproof until end of turn" (each player against their own opponents), "players can't lose life ... can't lose the game or win the game"
 *   CR 119.1, 121.1            "you gain life and draw cards equal to its power"
 *   CR 603.7c, 510.2, 120.1    "Choose target creature you control. Whenever that creature deals combat damage to a player or planeswalker this turn, draw that many cards."
 *   CR 107.3a, 613.4c          "Each creature gets twice -X/-X until end of turn."
 *   CR 118.12, 119.4           "return it to your hand unless target opponent pays 3 life"
 *   CR 701.13a, 608.2c         "If you have at least 15 life more than your starting life total, exile ~ and each artifact and creature your opponents control"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, battlefieldNames, find, legal, life, pass, passBoth, pool, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as unknown as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

interface Script { targets?: TargetChoice[][]; numbers?: number[]; yes?: boolean | boolean[] }
/** Answer the decisions that come up (targets, numbers, costs paid automatically) until a player has priority or a combat declaration is due. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { targets: script.targets ?? [], numbers: script.numbers ?? [], yes: Array.isArray(script.yes) ? script.yes : undefined }; // the queues are shared by every call that gets the same script
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: q.numbers.shift() ?? p.max });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes !== undefined ? (q.yes.shift() ?? false) : (script.yes as boolean | undefined) ?? false });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else break;
  }
  return s;
}
const resolveAll = (s0: GameState, script?: Script): GameState => {
  let s = drive(s0, script);
  for (let i = 0; i < 16 && s.zones.stack.length > 0 && s.pending?.kind === 'priority'; i++) s = drive(passBoth(s), script);
  return s;
};
const own = (script: Script = {}): Script => ({ ...script, targets: [...(script.targets ?? [])], numbers: [...(script.numbers ?? [])], ...(Array.isArray(script.yes) ? { yes: [...script.yes] } : {}) });
const cast = (s: GameState, name: string, script?: Script, player: 'p1' | 'p2' = 'p1'): GameState => { const sc = own(script); return resolveAll(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), sc), sc); };
const activate = (s: GameState, source: ObjectId, script?: Script, ability = 'p:0:0', player: 'p1' | 'p2' = 'p1'): GameState => { const sc = own(script); return resolveAll(drive(act(s, { type: 'activate', player, source, ability }), sc), sc); };
/** Give p2 priority in the first main phase of turn 1 (p1 passes). */
const toP2 = (s: GameState): GameState => (s.pending?.player === 'p1' ? pass(s) : s);
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const plr = (id: 'p1' | 'p2'): TargetChoice => ({ kind: 'player', id });
const mana = (s: GameState, player: 'p1' | 'p2', ...types: string[]): void => { s.players.find((x) => x.id === player)!.manaPool.push(...types.map((type) => ({ type }) as never)); };
const pt = (s: GameState, id: ObjectId): [number, number] => { const c = getChars(s, id); return [Number(c.power), Number(c.toughness)]; };
const handSize = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;
const libSize = (s: GameState, p: 'p1' | 'p2'): number => s.zones.library[p]!.length;
const setLife = (s: GameState, p: 'p1' | 'p2', n: number): void => { s.players.find((x) => x.id === p)!.life = n; };

describe('CR 602.2, 605.1a, 603.2: "Whenever an opponent activates an ability of a creature or land that isn\'t a mana ability, you may draw a card."', () => {
  const HOUND = card('Test Rune Hound', 'Creature — Hound', "Whenever an opponent activates an ability of a creature or land that isn't a mana ability, you may draw a card.", ['2', '2']);
  const PINGER = card('Test Pinger', 'Creature — Wizard', '{0}: You gain 1 life.', ['1', '1']);
  const CUP = card('Test Sip Cup', 'Artifact', '{0}: You gain 1 life.');
  const defs = [HOUND, PINGER, CUP];
  it('is automated', () => expect(full(HOUND)).toBe(true));
  it("an opponent's non-mana ability of a creature: the controller of the trigger may draw", () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Rune Hound'] }, p2: { battlefield: ['Test Pinger'] } });
    s = toP2(s);
    s = activate(s, find(s, 'Test Pinger', 'battlefield', 'p2'), { yes: true }, 'p:0:0', 'p2');
    expect(handSize(s, 'p1')).toBe(1);
  });
  it('declined, nothing is drawn ("may")', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Rune Hound'] }, p2: { battlefield: ['Test Pinger'] } });
    s = toP2(s);
    s = activate(s, find(s, 'Test Pinger', 'battlefield', 'p2'), { yes: false }, 'p:0:0', 'p2');
    expect(handSize(s, 'p1')).toBe(0);
  });
  it('an opponent\'s mana ability of a land, an opponent\'s ability of an artifact and your own ability do not trigger it', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Rune Hound', 'Test Pinger'] }, p2: { battlefield: ['Plains', 'Test Sip Cup'] } });
    s = activate(s, find(s, 'Test Pinger', 'battlefield', 'p1'), { yes: true }, 'p:0:0', 'p1'); // your own ability
    expect(handSize(s, 'p1')).toBe(0);
    s = toP2(s);
    s = activate(s, find(s, 'Plains', 'battlefield', 'p2'), { yes: true }, 'r:basic:W', 'p2'); // a mana ability
    s = activate(s, find(s, 'Test Sip Cup', 'battlefield', 'p2'), { yes: true }, 'p:0:0', 'p2'); // an artifact's ability
    expect(handSize(s, 'p1')).toBe(0);
  });
});

describe('CR 109.2, 602.2 (rulings of Runic Armasaur and Harsh Mentor, 2017-04-18 and 2018-07-13): an ability of a CARD in a hand or a graveyard is not an ability of a creature', () => {
  const HOUND = card('Test Rune Hound', 'Creature \u2014 Hound', "Whenever an opponent activates an ability of a creature or land that isn't a mana ability, you may draw a card.", ['2', '2']);
  const IMP = card('Test Sting Imp', 'Creature \u2014 Imp', "Whenever an opponent activates an ability of an artifact, creature, or land on the battlefield, if it isn't a mana ability, this creature deals 2 damage to that player.", ['1', '1']);
  const CYCLER = card('Test Cycler', 'Creature \u2014 Bird', 'Cycling {0}', ['1', '1']);
  const GRAVE = card('Test Grave Bird', 'Creature \u2014 Bird', '{0}: You gain 1 life.', ['1', '1']);
  const defs = [HOUND, IMP, CYCLER, GRAVE];
  it('cycling a creature card from the hand triggers neither', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Rune Hound', 'Test Sting Imp'] }, p2: { hand: ['Test Cycler'] } });
    s = toP2(s);
    const cycle = legal(s, 'p2', 'activate').find((a) => a.label.includes('Test Cycler'))!;
    s = resolveAll(drive(act(s, cycle.action), { yes: true }), { yes: true });
    expect(handSize(s, 'p1')).toBe(0);
    expect(life(s, 'p2')).toBe(20);
  });
  it('"an ability of a permanent" (the description with no type) is no ability of a card in a hand either: it makes a Zombie for an ability of a permanent only, once each turn', () => {
    const MENTOR = card('Test Wizened Sage', 'Creature \u2014 Human', "Whenever an opponent activates an ability of a permanent that isn't a mana ability, you create a 1/1 white Zombie creature token. This ability triggers only once each turn.", ['1', '1']);
    const CUP = card('Test Sip Cup', 'Artifact', '{0}: You gain 1 life.');
    const make = (): GameState => scenario([], { defs: [...defs, MENTOR, CUP], p1: { battlefield: ['Test Wizened Sage'] }, p2: { hand: ['Test Cycler'], battlefield: ['Test Sip Cup'] } });
    const zombies = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1').length;
    let s = toP2(make());
    const cycle = legal(s, 'p2', 'activate').find((a) => a.label.includes('Test Cycler'))!;
    s = resolveAll(drive(act(s, cycle.action)));
    expect(zombies(s)).toBe(0);
    s = activate(toP2(s), find(s, 'Test Sip Cup', 'battlefield', 'p2'), undefined, 'p:0:0', 'p2');
    expect(zombies(s)).toBe(1);
    s = activate(toP2(s), find(s, 'Test Sip Cup', 'battlefield', 'p2'), undefined, 'p:0:0', 'p2');
    expect(zombies(s)).toBe(1); // once each turn
  });
  it('control: the same card on the battlefield with an ability triggers both', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Rune Hound', 'Test Sting Imp'] }, p2: { battlefield: ['Test Grave Bird'] } });
    s = toP2(s);
    s = activate(s, find(s, 'Test Grave Bird', 'battlefield', 'p2'), { yes: true }, 'p:0:0', 'p2');
    expect(handSize(s, 'p1')).toBe(1);
    expect(life(s, 'p2')).toBe(19); // 20 - 2 + 1
  });
});

describe('CR 602.2, 605.1a, 603.4: "Whenever an opponent activates an ability of an artifact, creature, or land on the battlefield, if it isn\'t a mana ability, this creature deals 2 damage to that player."', () => {
  const IMP = card('Test Sting Imp', 'Creature — Imp', "Whenever an opponent activates an ability of an artifact, creature, or land on the battlefield, if it isn't a mana ability, this creature deals 2 damage to that player.", ['1', '1']);
  const CUP = card('Test Sip Cup', 'Artifact', '{0}: You gain 1 life.');
  const defs = [IMP, CUP];
  it('is automated', () => expect(full(IMP)).toBe(true));
  it('the player who activated it, and only that player, is dealt 2 damage', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Sting Imp'] }, p2: { battlefield: ['Test Sip Cup'] } });
    s = toP2(s);
    s = activate(s, find(s, 'Test Sip Cup', 'battlefield', 'p2'), undefined, 'p:0:0', 'p2');
    expect(life(s, 'p2')).toBe(19); // 20 - 2 (the Imp) + 1 (the cup's own gain)
    expect(life(s, 'p1')).toBe(20);
  });
  it('a mana ability and your own ability deal no damage', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Sting Imp', 'Test Sip Cup'] }, p2: { battlefield: ['Plains'] } });
    s = activate(s, find(s, 'Test Sip Cup', 'battlefield', 'p1'), undefined, 'p:0:0', 'p1');
    expect(life(s, 'p1')).toBe(21);
    s = toP2(s);
    s = activate(s, find(s, 'Plains', 'battlefield', 'p2'), undefined, 'r:basic:W', 'p2');
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 121.1, 119.3, 107.1a: "Target opponent draws cards equal to half the number of cards in their library and loses half their life. Round up each time."', () => {
  const ABYSS = card('Test Deep Gaze', 'Sorcery', 'Target opponent draws cards equal to half the number of cards in their library and loses half their life. Round up each time.');
  const run = (libraryLeft: number, lifeNow: number): GameState => {
    const s0 = scenario([], { defs: [ABYSS], p1: { hand: ['Test Deep Gaze'] } });
    s0.zones.library.p2!.splice(0, libraryLeft === 0 ? 99 : s0.zones.library.p2!.length - libraryLeft);
    setLife(s0, 'p2', lifeNow);
    return cast(s0, 'Test Deep Gaze', { targets: [[plr('p2')]] });
  };
  it('is automated', () => expect(full(ABYSS)).toBe(true));
  it('an odd library and an odd life total are halved and rounded UP (7 cards: draws 4; 11 life: loses 6), by the target only', () => {
    const s = run(7, 11);
    expect(handSize(s, 'p2')).toBe(4);
    expect(libSize(s, 'p2')).toBe(3);
    expect(life(s, 'p2')).toBe(5);
    expect(life(s, 'p1')).toBe(20);
    expect(handSize(s, 'p1')).toBe(0);
  });
  it('an even library and life total are halved exactly (20 cards: draws 10; 20 life: loses 10)', () => {
    const s = run(20, 20);
    expect(handSize(s, 'p2')).toBe(10);
    expect(life(s, 'p2')).toBe(10);
  });
  it('the draw is counted before the cards are drawn: a library of 1 draws 1 (half rounded up), and 1 life loses 1', () => {
    const s = run(1, 1);
    expect(handSize(s, 'p2')).toBe(1);
    expect(life(s, 'p2')).toBe(0);
  });
});

describe('CR 119.3, 701.21a, 106.1: "{T}, Sacrifice two other creatures: Any number of target players each lose 2 life and sacrifice a creature of their choice. You add {B}{B} and draw a card."', () => {
  const PRIEST = card('Test Pyre Priest', 'Creature — Cleric', '{T}, Sacrifice two other creatures: Any number of target players each lose 2 life and sacrifice a creature of their choice. You add {B}{B} and draw a card.', ['2', '2']);
  const FODDER = card('Test Fodder', 'Creature — Rat', '', ['1', '1']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [PRIEST, FODDER, BEAR];
  const setup = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Pyre Priest', 'Test Fodder', 'Test Fodder'] }, p2: { battlefield: ['Test Plain Bear'] } });
  it('is automated', () => expect(full(PRIEST)).toBe(true));
  it('the targeted player loses 2 life and sacrifices their creature; you pay with two other creatures, add {B}{B} and draw a card', () => {
    let s = setup();
    s = activate(s, find(s, 'Test Pyre Priest', 'battlefield', 'p1'), { targets: [[plr('p2')]] });
    expect(life(s, 'p2')).toBe(18);
    expect(battlefieldNames(s, 'p2')).toEqual([]);
    expect(battlefieldNames(s, 'p1')).toEqual(['Test Pyre Priest']);
    expect(pool(s, 'p1')).toBe('BB');
    expect(handSize(s, 'p1')).toBe(1);
  });
  it('with no player targeted ("any number") you still add {B}{B} and draw; nobody loses life or a creature', () => {
    let s = setup();
    s = activate(s, find(s, 'Test Pyre Priest', 'battlefield', 'p1'), { targets: [[]] });
    expect(life(s, 'p2')).toBe(20);
    expect(battlefieldNames(s, 'p2')).toEqual(['Test Plain Bear']);
    expect(pool(s, 'p1')).toBe('BB');
    expect(handSize(s, 'p1')).toBe(1);
  });
  it('a target with no creature still loses 2 life (ruling 2019-01-25)', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Pyre Priest', 'Test Fodder', 'Test Fodder'] } });
    s = activate(s, find(s, 'Test Pyre Priest', 'battlefield', 'p1'), { targets: [[plr('p2')]] });
    expect(life(s, 'p2')).toBe(18);
  });
  it('you may target yourself: you lose 2 life and sacrifice a creature of your choice too', () => {
    let s = setup();
    s = activate(s, find(s, 'Test Pyre Priest', 'battlefield', 'p1'), { targets: [[plr('p1')]] });
    expect(life(s, 'p1')).toBe(18);
    expect(battlefieldNames(s, 'p1')).toEqual([]);
  });
});

describe('CR 611.2c, 613.4c, 107.3c: "Whenever you draw your fifth card each turn, ~ and Drakes you control each get +X/+X until end of turn, where X is the number of cards in your hand."', () => {
  const SKY = card('Test Sky Sage', 'Creature — Human Wizard', 'Whenever you draw your fifth card each turn, ~ and Drakes you control each get +X/+X until end of turn, where X is the number of cards in your hand.', ['3', '3']);
  const DRAKE = card('Test Little Drake', 'Creature — Drake', '', ['2', '2']);
  const OGRE = card('Test Cave Ogre', 'Creature — Ogre', '', ['4', '4']);
  const GUSH = card('Test Gush', 'Sorcery', 'Draw five cards.');
  const GUST = card('Test Small Gust', 'Sorcery', 'Draw four cards.');
  const defs = [SKY, DRAKE, OGRE, GUSH, GUST];
  it('is automated', () => expect(full(SKY)).toBe(true));
  it('the fifth card drawn this turn pumps Alandra-like and each Drake you control by the hand size as it resolves (5); another creature and an opponent\'s Drake are unchanged', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Sky Sage', 'Test Little Drake', 'Test Cave Ogre'], hand: ['Test Gush'] }, p2: { battlefield: ['Test Little Drake'] } });
    s = cast(s, 'Test Gush');
    expect(pt(s, find(s, 'Test Sky Sage', 'battlefield', 'p1'))).toEqual([8, 8]);
    expect(pt(s, find(s, 'Test Little Drake', 'battlefield', 'p1'))).toEqual([7, 7]);
    expect(pt(s, find(s, 'Test Cave Ogre', 'battlefield', 'p1'))).toEqual([4, 4]);
    expect(pt(s, find(s, 'Test Little Drake', 'battlefield', 'p2'))).toEqual([2, 2]);
  });
  it('X is locked in as the ability resolves (ruling 2022-12-02): casting another card afterwards does not change the bonus', () => {
    const ZAP = card('Test Zap', 'Instant', 'You gain 1 life.');
    let s = scenario([], { defs: [...defs, ZAP], p1: { battlefield: ['Test Sky Sage'], hand: ['Test Gush', 'Test Zap'] } });
    s = cast(s, 'Test Gush');
    expect(pt(s, find(s, 'Test Sky Sage', 'battlefield', 'p1'))).toEqual([9, 9]); // 6 cards in hand: Test Zap and the five drawn
    s = cast(s, 'Test Zap');
    expect(handSize(s, 'p1')).toBe(5);
    expect(pt(s, find(s, 'Test Sky Sage', 'battlefield', 'p1'))).toEqual([9, 9]);
  });
  it('four cards are not the fifth: nothing happens', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Sky Sage', 'Test Little Drake'], hand: ['Test Small Gust'] } });
    s = cast(s, 'Test Small Gust');
    expect(pt(s, find(s, 'Test Sky Sage', 'battlefield', 'p1'))).toEqual([3, 3]);
    expect(pt(s, find(s, 'Test Little Drake', 'battlefield', 'p1'))).toEqual([2, 2]);
  });
  it('the pump ends with the turn', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Sky Sage'], hand: ['Test Gush'] } });
    s = cast(s, 'Test Gush');
    s = advanceTo(s, 2, 'main1');
    expect(pt(s, find(s, 'Test Sky Sage', 'battlefield', 'p1'))).toEqual([3, 3]);
  });
});

describe('CR 702.11b-c, 119.8, 104.3: "Players gain hexproof until end of turn. Players can\'t lose life this turn and players can\'t lose the game or win the game this turn."', () => {
  const LIVES = card('Test Everyone Lives', 'Instant', "All creatures gain hexproof and indestructible until end of turn. Players gain hexproof until end of turn. Players can't lose life this turn and players can't lose the game or win the game this turn.");
  const SPARK = card('Test Spark', 'Instant', 'Test Spark deals 2 damage to target player.');
  const BOON = card('Test Boon', 'Instant', 'Target player gains 1 life.');
  const BLAST = card('Test Blast', 'Instant', 'Test Blast deals 3 damage to each opponent.');
  const defs = [LIVES, SPARK, BOON, BLAST];
  /** Does the game let `player` cast the spell at `target`? (true when the target was accepted and the spell resolved) */
  function castAt(s: GameState, player: 'p1' | 'p2', name: string, target: 'p1' | 'p2'): boolean {
    try {
      let t = act(s, { type: 'cast', player, card: find(s, name, 'hand', player) });
      t = answer(t, { kind: 'chooseTargets', targets: [plr(target)] });
      return t.pending?.kind !== 'chooseTargets';
    } catch {
      return false;
    }
  }
  const lives = (): GameState => cast(scenario([], { defs, p1: { hand: ['Test Everyone Lives', 'Test Spark', 'Test Boon'] }, p2: { hand: ['Test Spark', 'Test Boon', 'Test Blast'] } }), 'Test Everyone Lives');
  it('is automated', () => expect(full(LIVES)).toBe(true));
  it('each player is untargetable by the spells of their own opponent: an opponent can\'t target you, and you can\'t target them', () => {
    const s = toP2(lives());
    expect(castAt(s, 'p2', 'Test Spark', 'p1')).toBe(false);
    expect(castAt(s, 'p2', 'Test Boon', 'p1')).toBe(false);
    const s1 = lives();
    expect(castAt(s1, 'p1', 'Test Spark', 'p2')).toBe(false);
  });
  it('a player can target themselves (hexproof is against opponents)', () => {
    const s = lives();
    expect(castAt(s, 'p1', 'Test Boon', 'p1')).toBe(true);
    expect(castAt(toP2(s), 'p2', 'Test Boon', 'p2')).toBe(true);
  });
  it('without the spell the same targets are legal (the restriction is the spell\'s)', () => {
    const s = scenario([], { defs, p1: { hand: ['Test Spark'] }, p2: { hand: ['Test Spark'] } });
    expect(castAt(s, 'p1', 'Test Spark', 'p2')).toBe(true);
  });
  it('players can\'t lose life: damage that does not target (each opponent) changes no life total', () => {
    let s = toP2(lives());
    s = cast(s, 'Test Blast', undefined, 'p2');
    expect(life(s, 'p1')).toBe(20);
  });
  it('players can\'t lose the game: a player at 0 life or less stays in the game this turn', () => {
    const s0 = lives();
    setLife(s0, 'p1', 0);
    const s = pass(s0);
    expect(s.result ?? null).toBeNull();
  });
  it('controls: without the spell the same damage is lost and a player at 0 life loses', () => {
    let s = scenario([], { defs, p2: { hand: ['Test Blast'] } });
    s = cast(toP2(s), 'Test Blast', undefined, 'p2');
    expect(life(s, 'p1')).toBe(17);
    const s0 = scenario([], { defs });
    setLife(s0, 'p1', 0);
    expect(pass(s0).result).toMatchObject({ winner: 'p2' });
  });
  it('it ends with the turn: on the next turn an opponent can target you again', () => {
    let s = lives();
    s = advanceTo(s, 2, 'main1');
    expect(castAt(s, 'p2', 'Test Spark', 'p1')).toBe(true);
  });
});

describe('CR 119.1, 121.1: "When this creature dies, you gain life and draw cards equal to its power."', () => {
  const HYDRA = card('Test Bloodwell Hydra', 'Creature — Hydra', 'When this creature dies, you gain life and draw cards equal to its power.', ['4', '4']);
  const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.');
  const defs = [HYDRA, DOOM];
  it('is automated', () => expect(full(HYDRA)).toBe(true));
  it('on death you gain life and draw cards equal to its power as it last existed (a +2/+0 pump counts: 6)', () => {
    const PUMP = card('Test Surge', 'Instant', 'Target creature gets +2/+0 until end of turn.');
    let s = scenario([], { defs: [...defs, PUMP], p1: { battlefield: ['Test Bloodwell Hydra'], hand: ['Test Doom', 'Test Surge'] } });
    const hydra = find(s, 'Test Bloodwell Hydra', 'battlefield', 'p1');
    s = cast(s, 'Test Surge', { targets: [[obj(hydra)]] });
    s = cast(s, 'Test Doom', { targets: [[obj(hydra)]] });
    expect(life(s, 'p1')).toBe(26);
    expect(handSize(s, 'p1')).toBe(6);
  });
  it('an opponent\'s creature dying, or a creature that is not it, gives nothing', () => {
    let s = scenario([], { defs: [...defs, card('Test Bear', 'Creature — Bear', '', ['2', '2'])], p1: { battlefield: ['Test Bloodwell Hydra', 'Test Bear'], hand: ['Test Doom'] } });
    s = cast(s, 'Test Doom', { targets: [[obj(find(s, 'Test Bear', 'battlefield', 'p1'))]] });
    expect(life(s, 'p1')).toBe(20);
    expect(handSize(s, 'p1')).toBe(0);
  });
});

describe('CR 107.3a, 613.4c: "Each creature gets twice -X/-X until end of turn. Each player gets X rad counters."', () => {
  const FALLOUT = card('Test Fallout', 'Sorcery', 'Each creature gets twice -X/-X until end of turn. Each player gets X rad counters.', undefined, '{X}{B}');
  const BIG = card('Test Big Bear', 'Creature — Bear', '', ['5', '5']);
  const SMALL = card('Test Small Bear', 'Creature — Bear', '', ['3', '3']);
  const defs = [FALLOUT, BIG, SMALL];
  it('is automated', () => expect(full(FALLOUT)).toBe(true));
  it('with X = 2 every creature, yours and theirs, gets -4/-4: the 5/5 survives as a 1/1, the 3/3 dies', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Big Bear'], hand: ['Test Fallout'] }, p2: { battlefield: ['Test Small Bear'] } });
    mana(s, 'p1', 'B', 'B', 'B');
    const big = find(s, 'Test Big Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Fallout', { numbers: [2] });
    expect(pt(s, big)).toEqual([1, 1]);
    expect(battlefieldNames(s, 'p2')).toEqual([]);
    expect(s.players.find((p) => p.id === 'p1')!.counters?.['rad'] ?? 0).toBe(2);
  });
  it('with X = 0 nothing changes', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Big Bear'], hand: ['Test Fallout'] }, p2: { battlefield: ['Test Small Bear'] } });
    mana(s, 'p1', 'B');
    s = cast(s, 'Test Fallout', { numbers: [0] });
    expect(pt(s, find(s, 'Test Big Bear', 'battlefield', 'p1'))).toEqual([5, 5]);
    expect(battlefieldNames(s, 'p2')).toEqual(['Test Small Bear']);
  });
});

describe('CR 118.12, 119.4: "Whenever another creature you own dies, return it to your hand unless target opponent pays 3 life."', () => {
  const ATH = card('Test Gate Keeper', 'Creature — Spirit', 'Whenever another creature you own dies, return it to your hand unless target opponent pays 3 life.', ['2', '2']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.');
  const defs = [ATH, BEAR, DOOM];
  const kill = (s: GameState, name: string, owner: 'p1' | 'p2', script: Script): GameState => cast(s, 'Test Doom', { ...script, targets: [[obj(find(s, name, 'battlefield', owner))], [plr('p2')]] });
  const setup = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Gate Keeper', 'Test Plain Bear'], hand: ['Test Doom'] }, p2: { battlefield: ['Test Plain Bear'] } });
  it('is automated', () => expect(full(ATH)).toBe(true));
  it('when the opponent pays 3 life the creature stays in the graveyard', () => {
    let s = kill(setup(), 'Test Plain Bear', 'p1', { yes: true });
    expect(life(s, 'p2')).toBe(17);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toContain('Test Plain Bear');
    expect(handSize(s, 'p1')).toBe(0);
  });
  it('when the opponent does not pay, it returns to your hand', () => {
    const s = kill(setup(), 'Test Plain Bear', 'p1', { yes: false });
    expect(life(s, 'p2')).toBe(20);
    expect(s.zones.hand.p1!.map((id) => s.objects[id]!.defId)).toContain('Test Plain Bear');
  });
  it('an opponent who can\'t pay 3 life (2 life left) can\'t pay it (CR 119.4): the creature returns to your hand', () => {
    const s0 = setup();
    setLife(s0, 'p2', 2);
    const s = kill(s0, 'Test Plain Bear', 'p1', { yes: true });
    expect(life(s, 'p2')).toBe(2);
    expect(s.zones.hand.p1!.map((id) => s.objects[id]!.defId)).toContain('Test Plain Bear');
  });
  it('a creature an opponent owns, or the keeper itself, does not trigger it', () => {
    let s = kill(setup(), 'Test Plain Bear', 'p2', { yes: false });
    expect(handSize(s, 'p1')).toBe(0);
    expect(handSize(s, 'p2')).toBe(0);
  });
});

describe('CR 701.13a, 608.2c, 119.1: "If you have at least 15 life more than your starting life total, exile ~ and each artifact and creature your opponents control."', () => {
  const WALKER = compileCard({ name: 'Test Pride Walker', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Test', oracle_text: '0: If you have at least 15 life more than your starting life total, exile ~ and each artifact and creature your opponents control.', colors: [], keywords: [], loyalty: '5' } as unknown as OracleCard);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const CUP = card('Test Sip Cup', 'Artifact', '');
  const RING = card('Test Odd Ring', 'Enchantment', '');
  const defs = [WALKER, BEAR, CUP, RING];
  const setup = (lifeNow: number): GameState => {
    const s = scenario([], { defs, p1: { battlefield: [{ name: 'Test Pride Walker', counters: { loyalty: 5 } }, 'Test Plain Bear', 'Test Sip Cup'] }, p2: { battlefield: ['Test Plain Bear', 'Test Sip Cup', 'Test Odd Ring', 'Plains'] } });
    setLife(s, 'p1', lifeNow);
    return s;
  };
  it('is automated', () => expect(full(WALKER)).toBe(true));
  it('at 35 life (20 + 15) the walker and each artifact and creature your opponents control are exiled; your own, their enchantment and their land stay', () => {
    const s = activate(setup(35), find(setup(35), 'Test Pride Walker', 'battlefield', 'p1'));
    expect(battlefieldNames(s, 'p2').sort()).toEqual(['Plains', 'Test Odd Ring']);
    expect(battlefieldNames(s, 'p1').sort()).toEqual(['Test Plain Bear', 'Test Sip Cup']);
    expect(s.zones.exile.length).toBe(3); // the walker, their creature and their artifact
  });
  it('at 34 life nothing is exiled and the walker stays', () => {
    const s0 = setup(34);
    const s = activate(s0, find(s0, 'Test Pride Walker', 'battlefield', 'p1'));
    expect(battlefieldNames(s, 'p2').sort()).toEqual(['Plains', 'Test Odd Ring', 'Test Plain Bear', 'Test Sip Cup']);
    expect(battlefieldNames(s, 'p1')).toContain('Test Pride Walker');
  });
});

describe('CR 603.7c, 510.2, 120.1: "Choose target creature you control. Whenever that creature deals combat damage to a player or planeswalker this turn, draw that many cards."', () => {
  const INSIGHT = card('Test Hunt Sight', 'Instant', 'Choose target creature you control. Whenever that creature deals combat damage to a player or planeswalker this turn, draw that many cards.');
  const WOLF = card('Test Wolf', 'Creature \u2014 Wolf', '', ['3', '3']);
  const CAT = card('Test Cat', 'Creature \u2014 Cat', '', ['2', '2']);
  const WALL = card('Test Wall', 'Creature \u2014 Wall', '', ['0', '5']);
  const WALKER = compileCard({ name: 'Test Foe Walker', layout: 'normal', mana_cost: '{0}', type_line: 'Planeswalker \u2014 Test', oracle_text: '', colors: [], keywords: [], loyalty: '6' } as unknown as OracleCard);
  const defs = [INSIGHT, WOLF, CAT, WALL, WALKER];
  /** Attack with the given creatures at the given defenders (the first combat of turn 1), let combat damage happen, and resolve what triggers. */
  function attack(s0: GameState, attacks: { who: ObjectId; defender: string }[], blocks: { blocker: ObjectId; attacker: ObjectId }[] = []): GameState {
    let s = s0;
    for (let guard = 0; guard < 200 && s.turn.number === 1; guard++) {
      const d = s.pending;
      if (d?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: attacks.map((a) => ({ attacker: a.who, defender: a.defender })) } as never);
      else if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks } as never);
      else if (d?.kind === 'priority') {
        if (s.zones.stack.length > 0) s = resolveAll(s, { yes: true });
        else if (s.turn.step === 'main2') break;
        else s = pass(s);
      } else if (d) s = drive(s, { yes: true });
      else break;
    }
    return s;
  }
  const setup = (extra: Partial<{ p2: string[] }> = {}): { s: GameState; wolf: ObjectId; cat: ObjectId } => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Wolf', 'Test Cat'], hand: ['Test Hunt Sight'] }, p2: { battlefield: extra.p2 ?? [] } });
    const wolf = find(s, 'Test Wolf', 'battlefield', 'p1');
    const cat = find(s, 'Test Cat', 'battlefield', 'p1');
    s = cast(s, 'Test Hunt Sight', { targets: [[obj(wolf)]] });
    return { s, wolf, cat };
  };
  it('is automated', () => expect(full(INSIGHT)).toBe(true));
  it('the chosen creature deals 3 combat damage to a player: you draw 3 cards', () => {
    const { s: s0, wolf } = setup();
    const s = attack(s0, [{ who: wolf, defender: 'p2' }]);
    expect(life(s, 'p2')).toBe(17);
    expect(handSize(s, 'p1')).toBe(3);
  });
  it('it works for a planeswalker too: the damage dealt to it is the number of cards (3)', () => {
    const { s: s0, wolf } = setup({ p2: [{ name: 'Test Foe Walker', counters: { loyalty: 6 } } as never] });
    const walker = find(s0, 'Test Foe Walker', 'battlefield', 'p2');
    const s = attack(s0, [{ who: wolf, defender: walker }]);
    expect(handSize(s, 'p1')).toBe(3);
  });
  it('another creature\'s combat damage, and damage the chosen creature deals to a creature, draw nothing', () => {
    const { s: s0, wolf, cat } = setup({ p2: ['Test Wall'] });
    const wall = find(s0, 'Test Wall', 'battlefield', 'p2');
    const s = attack(s0, [{ who: wolf, defender: 'p2' }, { who: cat, defender: 'p2' }], [{ blocker: wall, attacker: wolf }]);
    expect(life(s, 'p2')).toBe(18); // the cat was not blocked
    expect(handSize(s, 'p1')).toBe(0);
  });
  it('it lasts this turn only: the next turn the creature\'s damage draws nothing', () => {
    const { s: s0 } = setup();
    let s = advanceTo(s0, 3, 'main1'); // p1's next turn
    const wolf = find(s, 'Test Wolf', 'battlefield', 'p1');
    const before = handSize(s, 'p1');
    for (let guard = 0; guard < 200 && s.turn.number === 3; guard++) {
      const d = s.pending;
      if (d?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: wolf, defender: 'p2' }] } as never);
      else if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] } as never);
      else if (d?.kind === 'priority') { if (s.turn.step === 'main2') break; s = s.zones.stack.length > 0 ? resolveAll(s) : pass(s); }
      else if (d) s = drive(s);
      else break;
    }
    expect(life(s, 'p2')).toBeLessThan(20);
    expect(handSize(s, 'p1')).toBe(before);
  });
});

describe('CR 118.12, 119.4 (template eff.edhp5.payelse.life, read by other cards too): "<effect> unless <player> pays N life"', () => {
  const TYRANT = card('Test Tyrant Gaze', 'Sorcery', 'Target player discards their hand unless they pay 7 life.');
  const THRALL = card('Test Thrall Prince', 'Creature — Vampire', 'Whenever a permanent an opponent controls is put into a graveyard, put that card onto the battlefield under your control unless that opponent pays 3 life.', ['1', '1']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.');
  const defs = [TYRANT, THRALL, BEAR, DOOM];
  it('the player who pays keeps the cards in hand and loses 7 life; one who does not pay discards the hand', () => {
    const run = (yes: boolean): GameState => cast(scenario([], { defs, p1: { hand: ['Test Tyrant Gaze'] }, p2: { hand: ['Plains', 'Plains', 'Plains'] } }), 'Test Tyrant Gaze', { targets: [[plr('p2')]], yes });
    const paid = run(true);
    expect(life(paid, 'p2')).toBe(13);
    expect(handSize(paid, 'p2')).toBe(3);
    const refused = run(false);
    expect(life(refused, 'p2')).toBe(20);
    expect(handSize(refused, 'p2')).toBe(0);
  });
  it('"that opponent" is the player who controlled the permanent: not paying gives it to you, paying leaves it in the graveyard', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Thrall Prince'], hand: ['Test Doom'] }, p2: { battlefield: ['Test Plain Bear'] } });
    const bear = find(s, 'Test Plain Bear', 'battlefield', 'p2');
    const taken = cast(s, 'Test Doom', { targets: [[obj(bear)]], yes: false });
    expect(battlefieldNames(taken, 'p1')).toContain('Test Plain Bear');
    expect(life(taken, 'p2')).toBe(20);
    const paid = cast(s, 'Test Doom', { targets: [[obj(bear)]], yes: true });
    expect(battlefieldNames(paid, 'p1')).not.toContain('Test Plain Bear');
    expect(life(paid, 'p2')).toBe(17);
  });
});
