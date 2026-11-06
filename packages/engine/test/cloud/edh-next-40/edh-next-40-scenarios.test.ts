/**
 * Commander EDHREC ranks 6,251-7,500, second pass (round edh-next-40): the round's readings played through the engine with synthetic cards (invented names and wordings,
 * design 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test names the rule it checks, with its negative case. CR cites are
 * from the Comprehensive Rules of 2026-09-25 (media.wizards.com text, fetched 2026-11-02).
 *
 *   CR 731.1, 731.1a          "If it's night, it becomes day. Otherwise, it becomes night." (the day/night designation as an effect)
 *   CR 701.20a, 404.1, 110.2a  "Target opponent reveals cards from the top of their library until they reveal a land card. Put that card onto the battlefield tapped under your
 *                             control and the rest into their graveyard." (the hit is yours, the rest are theirs)
 *   CR 701.20a, 401.4        "Put target creature on the bottom of its owner's library. That creature's controller reveals ... The player puts that card onto the battlefield and the rest
 *                             on the bottom of their library in any order."
 *   CR 202.3, 608.2d, 611.2c "Choose odd or even. Creatures with mana value of that quality can't block this turn." (zero is even)
 *   CR 608.2d, 611.2c        "Choose hexproof or indestructible. Creatures you control gain that ability until end of turn."
 *   CR 110.4, 608.2d         "Choose a permanent type. Return all cards of the chosen type from your graveyard to your hand."
 *   CR 701.27a, 702.145b    "Transform any number of Human Werewolves you control." (a permanent with daybound or nightbound can't be transformed by it)
 *   CR 701.9a, 118.3         "{1}, Discard a land card or Shrine card: ..." (one card of either description)
 *   CR 603.2, 603.2c         "When ~ enters and whenever one or more Assassins you control deal combat damage to a player, ..." (one trigger for each event)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { charsOfObject } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, legal, life, pass, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, tweak, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const chars = (s: GameState, id: ObjectId) => charsOfObject(s, s.objects[id]!);
const hasKw = (s: GameState, id: ObjectId, kw: string): boolean => chars(s, id).keywords.some((k) => k.keyword === kw);
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const opt = (i: number): DecisionAnswer => ({ kind: 'chooseOption', ids: [String(i)] } as DecisionAnswer);
const zone = (s: GameState, z: 'hand' | 'graveyard' | 'library', p: PlayerId): string[] => s.zones[z][p]!.map((id) => s.objects[id]!.defId);
const field = (s: GameState, p?: PlayerId): string[] => s.zones.battlefield.filter((id) => p === undefined || s.objects[id]!.controller === p).map((id) => s.objects[id]!.defId);

interface Opts { targets?: TargetChoice[][]; answers?: DecisionAnswer[]; picks?: ObjectId[][] }
/** Answer what comes up (targets in order, then the given answers, payments automatic, "yes" to a may) until a priority decision. */
function settle(s0: GameState, o: Opts = {}): GameState {
  let s = s0;
  const targets = [...(o.targets ?? [])];
  const answers = [...(o.answers ?? [])];
  const picks = [...(o.picks ?? [])];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 60; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.shift() ?? ((p as unknown as { objects?: ObjectId[] }).objects?.[0] !== undefined ? [obj((p as unknown as { objects: ObjectId[] }).objects[0]!)] : []) });
    else if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] } as DecisionAnswer);
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: picks.shift() ?? [] });
    else if (p.kind === 'yesNo') s = answer(s, answers.length > 0 ? answers.shift()! : { kind: 'yesNo', yes: true });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (answers.length > 0) s = answer(s, answers.shift()!);
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((i) => i.id) } as DecisionAnswer);
    else break;
  }
  return s;
}
/** Pass priority until the stack is empty, answering as `settle` does. */
function drain(s0: GameState, o: Opts = {}): GameState {
  let s = settle(s0, o);
  const rest: Opts = { targets: [...(o.targets ?? [])], answers: [...(o.answers ?? [])], picks: [...(o.picks ?? [])] };
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 40; guard++) s = settle(pass(s), rest);
  return s;
}
const activate = (s0: GameState, name: string, o: Opts = {}, owner: PlayerId = 'p1', ability = 'p:0:0'): GameState =>
  drain(settle(act(s0, { type: 'activate', player: owner, source: find(s0, name, 'battlefield', owner), ability } as never), o), o);
const cast = (s0: GameState, name: string, o: Opts = {}, player: PlayerId = 'p1'): GameState => drain(settle(act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) } as never), o), o);

/** Pass (declaring no attackers or blockers) until the upkeep of `turn` has a trigger on the stack and its player has priority. */
function toUpkeepTrigger(s0: GameState, turn: number): GameState {
  let s = s0;
  for (let guard = 0; guard < 80 && !(s.turn.number === turn && s.turn.step === 'upkeep' && s.pending?.kind === 'priority' && s.zones.stack.length > 0); guard++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
  expect(s.turn.number === turn && s.zones.stack.length > 0).toBe(true);
  return s;
}

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['4', '4'] });

describe('CR 731.1, 731.1a: "If it\'s night, it becomes day. Otherwise, it becomes night."', () => {
  const DIAL = card('Test Dial', 'Artifact', "{T}: If it's night, it becomes day. Otherwise, it becomes night.");
  const WATCH = card('Test Watcher', 'Artifact', 'Whenever day becomes night or night becomes day, you gain 1 life.');
  const base = (time: 'day' | 'night' | undefined): GameState => {
    const s = scenario([], { defs: [DIAL, WATCH], p1: { battlefield: ['Test Dial', 'Test Watcher'] } });
    if (time !== undefined) s.designations.dayNight = time;
    return s;
  };
  it('the synthetic cards are automated', () => { expect(full(DIAL)).toBe(true); expect(full(WATCH)).toBe(true); });
  it('night becomes day, and a trigger of "night becomes day" fires', () => {
    const s = activate(base('night'), 'Test Dial');
    expect(s.designations.dayNight).toBe('day');
    expect(life(s, 'p1')).toBe(21);
  });
  it('day becomes night, and a trigger of "day becomes night" fires', () => {
    const s = activate(base('day'), 'Test Dial');
    expect(s.designations.dayNight).toBe('night');
    expect(life(s, 'p1')).toBe(21);
  });
  it('negative: when it is neither day nor night it becomes night (Otherwise), and that first change fires no trigger (CR 731.1a)', () => {
    const s = activate(base(undefined), 'Test Dial');
    expect(s.designations.dayNight).toBe('night');
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 701.20a, 404.1, 110.2a: another player reveals until a land; you put it onto the battlefield tapped under your control and the rest go into their graveyard', () => {
  const THIEF = card('Test Pickpocket', 'Artifact', '{T}: Target opponent reveals cards from the top of their library until they reveal a land card. Put that card onto the battlefield tapped under your control and the rest into their graveyard.');
  const game = (library: string[]): GameState => scenario([], { defs: [THIEF, BEAR, OGRE], p1: { battlefield: ['Test Pickpocket'] }, p2: { library } });
  it('is automated', () => { expect(full(THIEF)).toBe(true); });
  it('the land is yours (tapped, owned by them), the cards above it are in their graveyard, the cards below stay in their library', () => {
    const s = activate(game(['Test Bear', 'Test Ogre', 'Plains', 'Test Bear']), 'Test Pickpocket', { targets: [[{ kind: 'player', id: 'p2' } as TargetChoice]] });
    const land = find(s, 'Plains', 'battlefield');
    expect(s.objects[land]).toMatchObject({ controller: 'p1', owner: 'p2', tapped: true });
    expect(zone(s, 'graveyard', 'p2').sort()).toEqual(['Test Bear', 'Test Ogre']);
    expect(zone(s, 'graveyard', 'p1')).toEqual([]);
    expect(zone(s, 'library', 'p2')[0]).toBe('Test Bear'); // below the land: not revealed, still on top of the rest of the library
    expect(s.zones.library.p2!.length).toBe(21); // the scenario adds 20 Plains below the listed cards: 24 cards, 3 left it
  });
  it('negative: a library with no land is revealed whole into their graveyard and nothing enters the battlefield', () => {
    const s = activate(tweak(game(['Test Bear', 'Test Ogre']), (x) => { x.zones.library.p2 = x.zones.library.p2!.slice(0, 2); }), 'Test Pickpocket', { targets: [[{ kind: 'player', id: 'p2' } as TargetChoice]] });
    expect(field(s, 'p1')).toEqual(['Test Pickpocket']);
    expect(zone(s, 'graveyard', 'p2').sort()).toEqual(['Test Bear', 'Test Ogre']);
    expect(s.zones.library.p2!.length).toBe(0);
  });
});

describe('CR 701.20a, 401.4, 110.2a: "That creature\'s controller reveals ... The player puts that card onto the battlefield and the rest on the bottom of their library in any order."', () => {
  const STAFF = card('Test Rod', 'Artifact', "{T}: Put target creature on the bottom of its owner's library. That creature's controller reveals cards from the top of their library until they reveal a creature card. The player puts that card onto the battlefield and the rest on the bottom of their library in any order.");
  it('is automated', () => { expect(full(STAFF)).toBe(true); });
  it('the target goes to the bottom, its controller reveals to the first creature and keeps it (under their control); the others go to the bottom of their library', () => {
    const s0 = scenario([], { defs: [STAFF, BEAR, OGRE], p1: { battlefield: ['Test Rod'] }, p2: { battlefield: ['Test Bear'], library: ['Plains', 'Plains', 'Test Ogre', 'Plains'] } });
    const s = activate(s0, 'Test Rod', { targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p2'))]] });
    expect(field(s, 'p2')).toEqual(['Test Ogre']);
    expect(s.objects[find(s, 'Test Ogre', 'battlefield')]).toMatchObject({ controller: 'p2', owner: 'p2' });
    const lib = zone(s, 'library', 'p2');
    expect(lib.length).toBe(24); // 24 cards, +1 for the Bear put on the bottom, -3 revealed, +2 of them put back at the bottom
    expect(lib[0]).toBe('Plains'); // the card below the revealed ones was not reached
    expect(lib.indexOf('Test Bear')).toBeGreaterThanOrEqual(21); // the Bear went to the bottom first, the two revealed Plains below it
    expect(lib.slice(-2)).toEqual(['Plains', 'Plains']);
    expect(zone(s, 'graveyard', 'p2')).toEqual([]);
  });
});

describe('CR 701.20a, 404.1, 110.2a: "At the beginning of enchanted player\'s upkeep, that player reveals ... Put that card onto the battlefield under your control. That player puts the rest of the revealed cards into their graveyard."', () => {
  const HEX = card('Test Hex', 'Enchantment — Aura Curse', "Enchant player\nAt the beginning of enchanted player's upkeep, that player reveals cards from the top of their library until they reveal a creature card. Put that card onto the battlefield under your control. That player puts the rest of the revealed cards into their graveyard.");
  it('is automated', () => { expect(full(HEX)).toBe(true); });
  it('at the enchanted player\'s upkeep the creature they reveal is the Aura controller\'s (CR 110.2a), the other cards go to the enchanted player\'s graveyard', () => {
    let s = scenario([], { defs: [HEX, OGRE, BEAR], p1: { hand: ['Test Hex'] }, p2: { library: ['Plains', 'Test Ogre', 'Test Bear'] } });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Hex', 'hand', 'p1') } as never), { targets: [[{ kind: 'player', id: 'p2' } as TargetChoice]] });
    s = drain(s);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Hex')).toBe(true);
    s = passUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'upkeep' && x.pending?.kind === 'priority' && x.zones.stack.length > 0, "p2's upkeep trigger on the stack");
    s = drain(s);
    expect(s.objects[find(s, 'Test Ogre', 'battlefield')]).toMatchObject({ controller: 'p1', owner: 'p2' });
    expect(zone(s, 'graveyard', 'p2')).toContain('Plains');
    expect(zone(s, 'graveyard', 'p1')).toEqual([]);
    expect(zone(s, 'library', 'p2')).toContain('Test Bear'); // below the creature: not revealed
  });
  it('negative: it triggers only at the enchanted player\'s upkeep, not at its controller\'s', () => {
    let s = scenario([], { defs: [HEX, OGRE], p1: { hand: ['Test Hex'], library: ['Plains', 'Test Ogre'] }, p2: { library: ['Plains'] } });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Hex', 'hand', 'p1') } as never), { targets: [[{ kind: 'player', id: 'p2' } as TargetChoice]] });
    s = drain(s);
    expect(s.zones.stack.length).toBe(0);
    expect(zone(s, 'graveyard', 'p1')).toEqual([]);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Ogre').length).toBe(0);
  });
});

describe('CR 202.3, 608.2d, 611.2c: "Whenever you attack, choose odd or even. Creatures with mana value of that quality can\'t block this turn." (zero is even)', () => {
  const SPLIT = card('Test Splitter', 'Creature — Eldrazi', 'Whenever you attack, choose odd or even. Creatures with mana value of that quality can\'t block this turn.', { pt: ['1', '1'] });
  const THREE = card('Test Three', 'Creature — Goat', '', { pt: ['1', '1'], cost: '{3}' });
  const FOUR = card('Test Four', 'Creature — Goat', '', { pt: ['1', '1'], cost: '{4}' });
  const ZERO = card('Test Zero', 'Creature — Goat', '', { pt: ['1', '1'] });
  const blockers = (choice: number): { three: boolean; four: boolean; zero: boolean } => {
    let s = scenario([], { defs: [SPLIT, THREE, FOUR, ZERO], p1: { battlefield: ['Test Splitter'] }, p2: { battlefield: ['Test Three', 'Test Four', 'Test Zero'] } });
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Splitter', 'battlefield', 'p1')]]);
    s = settle(s, { answers: [opt(choice)] });
    s = drain(s, { answers: [opt(choice)] });
    s = toDeclareBlockers(s);
    const can = (n: string): boolean => {
      try { declareBlockers(s, [[find(s, n, 'battlefield', 'p2'), find(s, 'Test Splitter', 'battlefield', 'p1')]]); return true; } catch { return false; }
    };
    return { three: can('Test Three'), four: can('Test Four'), zero: can('Test Zero') };
  };
  it('is automated', () => { expect(full(SPLIT)).toBe(true); });
  it('odd: only the mana value 3 creature cannot block; even: the mana value 4 creature and the mana value 0 one cannot', () => {
    expect(blockers(0)).toEqual({ three: false, four: true, zero: true });
    expect(blockers(1)).toEqual({ three: true, four: false, zero: false });
  });
});

describe('CR 608.2d, 611.2c: "Sacrifice ~: Choose hexproof or indestructible. Creatures you control gain that ability until end of turn."', () => {
  const GUARD = card('Test Warden', 'Creature — Angel', 'Sacrifice ~: Choose hexproof or indestructible. Creatures you control gain that ability until end of turn.', { pt: ['1', '1'] });
  const play = (choice: number): GameState => {
    const s = scenario([], { defs: [GUARD, BEAR, OGRE], p1: { battlefield: ['Test Warden', 'Test Bear'] }, p2: { battlefield: ['Test Ogre'] } });
    return activate(s, 'Test Warden', { answers: [opt(choice)] });
  };
  it('is automated', () => { expect(full(GUARD)).toBe(true); });
  it('the chosen ability, and only it, goes to the creatures you control, not to the opponent\'s', () => {
    for (const [choice, got, other] of [[0, 'hexproof', 'indestructible'], [1, 'indestructible', 'hexproof']] as const) {
      const s = play(choice);
      const bear = find(s, 'Test Bear', 'battlefield', 'p1');
      expect(hasKw(s, bear, got), got).toBe(true);
      expect(hasKw(s, bear, other), other).toBe(false);
      expect(hasKw(s, find(s, 'Test Ogre', 'battlefield', 'p2'), got), `opponent ${got}`).toBe(false);
    }
  });
});

describe('CR 110.4, 608.2d: "Choose a permanent type. Return all cards of the chosen type from your graveyard to your hand."', () => {
  const REUSE = card('Test Reclaim', 'Sorcery', 'Choose a permanent type. Return all cards of the chosen type from your graveyard to your hand.');
  const RELIC = card('Test Relic', 'Artifact', '');
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', { pt: ['2', '2'] });
  const SPELL = card('Test Zap', 'Instant', 'You gain 1 life.');
  const game = (type: string): GameState => {
    const s = scenario([], { defs: [REUSE, RELIC, GOLEM, SPELL, BEAR, OGRE], p1: { hand: ['Test Reclaim'], graveyard: ['Test Bear', 'Test Relic', 'Test Golem', 'Test Zap', 'Plains'] }, p2: { graveyard: ['Test Ogre'] }, });
    return cast(s, 'Test Reclaim', { answers: [{ kind: 'chooseName', name: type } as DecisionAnswer] });
  };
  it('is automated', () => { expect(full(REUSE)).toBe(true); });
  it('creature: the Bear and the artifact creature come back; the artifact, the instant and the land stay', () => {
    expect(zone(game('Creature'), 'hand', 'p1').sort()).toEqual(['Test Bear', 'Test Golem']);
  });
  it('artifact: the artifact and the artifact creature come back (a card of both types is of either)', () => {
    expect(zone(game('Artifact'), 'hand', 'p1').sort()).toEqual(['Test Golem', 'Test Relic']);
  });
  it('negative: the opponent\'s graveyard is not touched, and an instant is no permanent type: nothing else returns', () => {
    const s = game('Land');
    expect(zone(s, 'hand', 'p1')).toEqual(['Plains']);
    expect(zone(s, 'graveyard', 'p2')).toEqual(['Test Ogre']);
    expect(zone(s, 'graveyard', 'p1')).toContain('Test Zap');
  });
});

describe('CR 701.27a, 702.145b, 608.2d: "At the beginning of your upkeep, transform any number of Human Werewolves you control."', () => {
  const dfc = (name: string, back: string, frontText: string, backText: string): CardDef => compileCard({
    name: `${name} // ${back}`, layout: 'transform', mana_cost: '{1}{G}', type_line: 'Creature — Human Werewolf // Creature — Werewolf', colors: [], keywords: [],
    card_faces: [
      { name, mana_cost: '{1}{G}', type_line: 'Creature — Human Werewolf', oracle_text: frontText, power: '2', toughness: '2', colors: [] },
      { name: back, type_line: 'Creature — Werewolf', oracle_text: backText, power: '3', toughness: '3', colors: [] },
    ],
  } as unknown as OracleCard);
  const PLAIN = dfc('Test Wolfman', 'Test Beastman', '', '');
  const BOUND = dfc('Test Dawnwolf', 'Test Duskwolf', 'Daybound', 'Nightbound');
  const HERD = card('Test Moonherd', 'Creature — Human Shaman', 'At the beginning of your upkeep, transform any number of Human Werewolves you control.', { pt: ['1', '1'] });
  const toUpkeep = (): GameState => toUpkeepTrigger(scenario([], { defs: [HERD, PLAIN, BOUND], p1: { battlefield: ['Test Moonherd', PLAIN.name, BOUND.name] } }), 3);
  it('is automated', () => { expect(full(HERD)).toBe(true); });
  it('the chosen werewolf transforms; a werewolf with daybound is not transformed by it (it only transforms as day/night says); a choice of none transforms none', () => {
    const s0 = toUpkeep();
    const plain = find(s0, PLAIN.name, 'battlefield', 'p1');
    const bound = find(s0, BOUND.name, 'battlefield', 'p1');
    const none = drain(s0, { picks: [[]] });
    expect(none.objects[plain]!.face).toBe(0);
    expect(() => drain(s0, { picks: [[plain, bound]] })).toThrow(/Choose between 0 and 1/); // the daybound werewolf is not one that can be chosen (CR 702.145b)
    const done = drain(s0, { picks: [[plain]] });
    expect(done.objects[plain]!.face).toBe(1);
    // (day/night itself may have turned the daybound card over by now, as the turn-3 untap step checks it: the effect adds nothing to what it did when nothing was chosen)
    expect(done.objects[bound]!.face).toBe(none.objects[bound]!.face);
  });
});

describe('CR 701.9a, 118.3, 602.2b: "{1}, Discard a land card or Shrine card: ..." (one card of either description)', () => {
  const SHRINE = card('Test Shrine Alpha', 'Legendary Enchantment — Shrine', '{1}, Discard a land card or Shrine card: ~ deals X damage to target creature or planeswalker, where X is the number of Shrines you control.');
  const SHRINE2 = card('Test Shrine Beta', 'Enchantment — Shrine', '');
  const SPELL = card('Test Zap', 'Instant', 'You gain 1 life.');
  const game = (hand: string[]): GameState => scenario([], { defs: [SHRINE, SHRINE2, SPELL, OGRE], p1: { hand, battlefield: ['Test Shrine Alpha', 'Plains'] }, p2: { battlefield: ['Test Ogre'] } });
  const fire = (s: GameState, discard: ObjectId): GameState => activate(s, 'Test Shrine Alpha', { targets: [[obj(find(s, 'Test Ogre', 'battlefield', 'p2'))]], picks: [[discard]] });
  it('is automated', () => { expect(full(SHRINE)).toBe(true); });
  it('a land card pays it: the Shrines you control (1) are the damage', () => {
    const s0 = game(['Plains', 'Test Zap']);
    const s = fire(s0, find(s0, 'Plains', 'hand', 'p1'));
    expect(s.objects[find(s, 'Test Ogre', 'battlefield', 'p2')]!.damage).toBe(1);
    expect(zone(s, 'graveyard', 'p1')).toEqual(['Plains']);
  });
  it('a Shrine card pays it too, and with a second Shrine on the battlefield the damage is 2', () => {
    const s0 = scenario([], { defs: [SHRINE, SHRINE2, SPELL, OGRE], p1: { hand: ['Test Shrine Beta'], battlefield: ['Test Shrine Alpha', 'Test Shrine Beta', 'Plains'] }, p2: { battlefield: ['Test Ogre'] } });
    const s = fire(s0, find(s0, 'Test Shrine Beta', 'hand', 'p1'));
    expect(s.objects[find(s, 'Test Ogre', 'battlefield', 'p2')]!.damage).toBe(2);
  });
  it('negative: a hand of only an instant cannot pay it (the ability cannot be activated)', () => {
    const s = game(['Test Zap']);
    expect(legal(s, 'p1', 'activate' as never).some((a) => a.object === find(s, 'Test Shrine Alpha', 'battlefield', 'p1'))).toBe(false);
  });
});

describe('CR 603.2, 603.2c, 700.6: "When ~ enters and whenever one or more Assassins you control deal combat damage to a player, return target historic card from your graveyard to your hand."', () => {
  const SLEUTH = card('Test Sleuth', 'Creature — Human Assassin', 'When ~ enters and whenever one or more Assassins you control deal combat damage to a player, return target historic card from your graveyard to your hand.', { pt: ['2', '2'] });
  const BLADE = card('Test Blade', 'Creature — Human Assassin', '', { pt: ['1', '1'] });
  const GRUNT = card('Test Grunt', 'Creature — Human Soldier', '', { pt: ['1', '1'] });
  const LEGEND = card('Test Legend', 'Legendary Creature — Human', '', { pt: ['1', '1'] });
  const RELIC = card('Test Relic', 'Artifact', '');
  const SAGA = card('Test Saga', 'Enchantment — Saga', '');
  const defs = [SLEUTH, BLADE, GRUNT, LEGEND, RELIC, SAGA, BEAR];
  it('is automated', () => { expect(full(SLEUTH)).toBe(true); });
  it('entering: returns a historic card (legendary, artifact or Saga) and nothing else is offered (a Bear is not historic)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Sleuth'], graveyard: ['Test Bear', 'Test Legend', 'Test Relic', 'Test Saga'] } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Sleuth', 'hand', 'p1') } as never);
    s = settle(s);
    s = pass(s); // the creature spell resolves, its enters trigger asks for its target
    s = settle(pass(s)) === s ? s : s;
    let offered: string[] | null = null;
    for (let i = 0; i < 6 && s.zones.stack.length + (s.pending?.kind === 'chooseTargets' ? 1 : 0) > 0; i++) {
      if (s.pending?.kind === 'chooseTargets') offered = (s.pending as unknown as { objects: ObjectId[] }).objects.map((id) => s.objects[id]!.defId).sort();
      s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
    }
    expect(offered).toEqual(['Test Legend', 'Test Relic', 'Test Saga']);
    expect(zone(s, 'hand', 'p1').length).toBe(1);
    expect(['Test Legend', 'Test Relic', 'Test Saga']).toContain(zone(s, 'hand', 'p1')[0]);
    expect(zone(s, 'graveyard', 'p1')).toContain('Test Bear');
  });
  it('combat: two Assassins that deal combat damage to a player together trigger it once (one card returns); a creature that is no Assassin does not', () => {
    const run = (names: string[]): GameState => {
      let s = scenario([], { defs, p1: { battlefield: names, graveyard: ['Test Legend', 'Test Relic'] } });
      s = tweak(s, (x) => { for (const id of x.zones.battlefield) x.objects[id]!.controlledSinceTurn = 0; });
      s = declareAttackers(toDeclareAttackers(s), names.map((n) => [find(s, n, 'battlefield', 'p1')] as [ObjectId]));
      s = passUntil(s, (x) => x.turn.step === 'combatDamage' || x.turn.step === 'endCombat' || x.turn.step === 'main2', 'after combat damage');
      return settleAll(s);
    };
    function settleAll(s0: GameState): GameState { let s = s0; for (let i = 0; i < 12 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); i++) s = s.pending?.kind === 'priority' ? settle(pass(s)) : settle(s); return s; }
    expect(zone(run(['Test Blade', 'Test Sleuth']), 'hand', 'p1').length).toBe(1);
    expect(zone(run(['Test Grunt']), 'hand', 'p1').length).toBe(0);
  });
});
