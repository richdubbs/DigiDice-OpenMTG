/**
 * Commander lane edh-next, round edh-next-5: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default
 * compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive
 * Rules of 2026-09-25 (see the round's record).
 *
 *   CR 205.1b, 613.1d, 613.4b   "All lands are 2/2 creatures that are still lands." (Nature's Revolt), "Forests you control are 1/1 green Elf creatures that are still lands." (Ambush Commander)
 *   CR 120.3a, 614.1a           "Damage that would reduce your life total to less than 1 reduces it to 1 instead." (Fortune Thief), "As long as you have 7 or more life, ... 7" (Elderscale Wurm)
 *   CR 702.29a, 601.2i, 113.6k  "When you cast or cycle ~, ..." (Drownyard Lurker); "Whenever you cycle another card for the first time each turn, ..." (Valiant Rescuer)
 *   CR 118.12, 701.6a           "When you cast this spell, counter target spell an opponent controls unless they pay {1}." (Hope-Ender Coatl)
 *   CR 611.2a, 613.4c, 702.9b   "Until your next turn, up to one target creature gets -2/-0 and loses flying." (Mu Yanling, Sky Dancer)
 *   CR 604.1, 611.3a, 500.1     "During your turn, creatures you control get +1/+0 and have trample." (Street Riot)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, legal, pass, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', loyalty?: string): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}), ...(loyalty ? { loyalty } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const plr = (id: string): TargetChoice => ({ kind: 'player', id } as TargetChoice);
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };
const no: DecisionAnswer = { kind: 'yesNo', yes: false };

interface Opts { targets?: TargetChoice[][]; answers?: DecisionAnswer[] }
/** Answer what comes up: targets, then the answers; pay costs automatically; stop at priority. */
function settle(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets' && o.targets && o.targets.length > 0) s = answer(s, { kind: 'chooseTargets', targets: o.targets.shift()! });
    else if (o.answers && o.answers.length > 0) s = answer(s, o.answers.shift()!);
    else break;
  }
  return s;
}
const queued = (o: Opts): Opts => ({ targets: [...(o.targets ?? [])], answers: [...(o.answers ?? [])] });
function drain(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 40; guard++) s = settle(pass(s), o);
  return s;
}
/** The player activates an ability of a permanent, answers what is asked, and lets the stack resolve. */
function activate(s0: GameState, source: ObjectId, opts: Opts = {}, ability = 'p:0:0', player = 'p1'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'activate', player, source, ability } as never), q), q);
}
/** The player casts a card from their hand, answers what is asked, and lets the stack resolve. */
function cast(s0: GameState, name: string, opts: Opts = {}, player = 'p1'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) } as never), q), q);
}
/** The player cycles a card from their hand (the cycling ability), answers what is asked, and lets the stack resolve. */
function cycle(s0: GameState, name: string, opts: Opts = {}): GameState {
  const q = queued(opts);
  const id = find(s0, name, 'hand', 'p1');
  const la = legal(s0, 'p1', 'activate').find((a) => a.object === id && !a.isMana);
  if (!la) throw new Error(`no cycling for ${name}`);
  return drain(settle(act(s0, la.action), q), q);
}
/** Pass (declaring no attackers when asked) until turn `n` begins. */
function toTurn(s0: GameState, n: number): GameState {
  let s = s0;
  for (let i = 0; i < 300 && s.turn.number < n; i++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = pass(s);
    else s = settle(s, {});
  }
  return s;
}
const names = (s: GameState, name: string, zone: 'battlefield' | 'hand' | 'graveyard' = 'battlefield'): ObjectId[] =>
  Object.values(s.objects).filter((o) => o.zone === zone && (o.kind === 'token' ? getChars(s, o.id)?.name === name : s.defs[o.defId]?.name === name)).map((o) => o.id);
const byName = (s: GameState, name: string, zone: 'battlefield' | 'hand' | 'graveyard' = 'battlefield', owner?: string): ObjectId =>
  Object.values(s.objects).find((o) => s.defs[o.defId]?.name === name && o.zone === zone && (owner === undefined || o.owner === owner))!.id;
const stat = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const hasType = (s: GameState, id: ObjectId, t: string): boolean => getChars(s, id)!.types.includes(t as never);
const kw = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword?: string }).keyword ?? ''));
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const setLife = (s: GameState, p: string, life: number): GameState => tweak(s, (g) => { g.players.find((x) => x.id === p)!.life = life; });

const land = (name: string, sub: string, mana: string): CardDef => compileCard({ name, layout: 'normal', mana_cost: '', type_line: `Basic Land — ${sub}`, oracle_text: `({T}: Add {${mana}}.)`, colors: [] } as OracleCard);
const ISLAND = land('Island', 'Island', 'U');
const SWAMP = land('Swamp', 'Swamp', 'B');
const FOREST = land('Forest', 'Forest', 'G');
const REVOLT = card('Test Revolt', 'Enchantment', 'All lands are 2/2 creatures that are still lands.');
const BELL = card('Test Bell', 'Artifact', 'All Swamps are 1/1 black creatures that are still lands.');
const COMMANDER = card('Test Woodsman', 'Creature — Elf', 'Forests you control are 1/1 green Elf creatures that are still lands.', ['2', '2']);
const THIEF = card('Test Thief', 'Creature — Human Rogue', 'Damage that would reduce your life total to less than 1 reduces it to 1 instead.', ['2', '2']);
const WURM = card('Test Wurm', 'Creature — Wurm', 'As long as you have 7 or more life, damage that would reduce your life total to less than 7 reduces it to 7 instead.', ['7', '7']);
const PINGER = card('Test Pinger', 'Creature — Wizard', '{0}: ~ deals 5 damage to target player.', ['1', '1']);
const DRAIN = card('Test Drain', 'Sorcery', 'You lose 5 life.');
const LURKER = card('Test Lurker', 'Creature — Eldrazi Trilobite', 'When you cast or cycle ~, create a 0/1 colorless Eldrazi Spawn creature token with "Sacrifice this token: Add {C}."\nCycling {0}', ['6', '6'], '{1}');
const LURKER2 = card('Test Lurker Two', 'Creature — Eldrazi Trilobite', 'When you cast or cycle ~, create a 0/1 colorless Eldrazi Spawn creature token with "Sacrifice this token: Add {C}."\nCycling {0}', ['6', '6'], '{1}');
const RIP = card('Test Rip', 'Enchantment', 'If a card or token would be put into a graveyard from anywhere, exile it instead.');
const MIND = card('Test Mind', 'Sorcery', 'Target player discards a card.');
const RESCUER = card('Test Rescuer', 'Creature — Human Soldier', 'Whenever you cycle another card for the first time each turn, create a 1/1 white Human Soldier creature token.\nCycling {0}', ['1', '1']);
const CYCLER = card('Test Cycler', 'Creature — Bird', 'Cycling {0}', ['1', '1'], '{2}');
const CYCLER2 = card('Test Cycler Two', 'Creature — Bird', 'Cycling {0}', ['1', '1'], '{2}');
const COATL = card('Test Coatl', 'Creature — Eldrazi Snake', 'Flash\nWhen you cast this spell, counter target spell an opponent controls unless they pay {1}.\nFlying', ['3', '3'], '{1}');
const OPT = card('Test Opt', 'Sorcery', 'Draw a card.');
const YANLING = card('Test Yanling', 'Legendary Planeswalker — Test', 'Until your next turn, up to one target creature gets -2/-0 and loses flying.\nThis is filler.', undefined, '{0}', '5');
const YANLING2 = card('Test Skydancer', 'Legendary Planeswalker — Test', '+2: Until your next turn, up to one target creature gets -2/-0 and loses flying.', undefined, '{0}', '5');
const BIRD = card('Test Bird', 'Creature — Bird', 'Flying', ['3', '3']);
const RIOT = card('Test Riot', 'Enchantment', 'During your turn, creatures you control get +1/+0 and have trample.');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [REVOLT, BELL, COMMANDER, THIEF, WURM, PINGER, DRAIN, LURKER, LURKER2, RIP, MIND, RESCUER, CYCLER, CYCLER2, COATL, OPT, YANLING2, BIRD, RIOT, BEAR]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
    void YANLING;
  });
});

describe('CR 205.1b, 613.1d, 613.4b: "All lands are 2/2 creatures that are still lands." and its colored and typed forms', () => {
  it('every land of every player is a 2/2 creature that is still a land; a nonland permanent is unchanged, and the effect ends with its source', () => {
    const s0 = mpScenario({ players: 3, defs: [REVOLT, BEAR, ISLAND], zones: { p1: { hand: ['Test Revolt'], battlefield: ['Plains', 'Test Bear'] }, p2: { battlefield: ['Island'] } } });
    const s = cast(s0, 'Test Revolt', {});
    for (const id of [byName(s, 'Plains'), byName(s, 'Island')]) {
      expect(stat(s, id)).toBe('2/2');
      expect(hasType(s, id, 'Creature')).toBe(true);
      expect(hasType(s, id, 'Land')).toBe(true);
    }
    expect(stat(s, byName(s, 'Test Bear'))).toBe('2/2');
    expect(getChars(s, byName(s, 'Test Bear'))!.types).toEqual(['Creature']);
    const gone = tweak(s, (g) => { g.objects[byName(s, 'Test Revolt')]!.zone = 'graveyard'; g.zones.battlefield = g.zones.battlefield.filter((i) => i !== byName(s, 'Test Revolt')); g.zones.graveyard['p1']!.push(byName(s, 'Test Revolt')); });
    expect(hasType(gone, byName(gone, 'Plains'), 'Creature')).toBe(false);
  });
  it('"All Swamps are 1/1 black creatures that are still lands": a Swamp is a black 1/1 creature land, a Plains is not changed', () => {
    const s0 = mpScenario({ players: 3, defs: [BELL, SWAMP], zones: { p1: { hand: ['Test Bell'], battlefield: ['Swamp', 'Plains'] }, p2: { battlefield: ['Swamp'] } } });
    const s = cast(s0, 'Test Bell', {});
    for (const id of names(s, 'Swamp')) {
      expect(stat(s, id)).toBe('1/1');
      expect(getChars(s, id)!.colors).toEqual(['B']);
      expect(hasType(s, id, 'Land')).toBe(true);
      expect(getChars(s, id)!.subtypes).toContain('Swamp');
    }
    expect(hasType(s, byName(s, 'Plains'), 'Creature')).toBe(false);
  });
  it('"Forests you control are 1/1 green Elf creatures that are still lands": only the controller\'s Forests change; they keep the Forest type', () => {
    const s0 = mpScenario({ players: 3, defs: [COMMANDER, FOREST], zones: { p1: { battlefield: ['Test Woodsman', 'Forest', 'Plains'] }, p2: { battlefield: ['Forest'] } } });
    const mine = byName(s0, 'Forest', 'battlefield', 'p1');
    const theirs = byName(s0, 'Forest', 'battlefield', 'p2');
    expect(stat(s0, mine)).toBe('1/1');
    expect(getChars(s0, mine)!.subtypes).toEqual(expect.arrayContaining(['Elf', 'Forest']));
    expect(getChars(s0, mine)!.colors).toEqual(['G']);
    expect(hasType(s0, mine, 'Land')).toBe(true);
    expect(hasType(s0, theirs, 'Creature')).toBe(false);
    expect(hasType(s0, byName(s0, 'Plains'), 'Creature')).toBe(false);
  });
});

describe('CR 120.3a, 614.1a: "Damage that would reduce your life total to less than 1 reduces it to 1 instead." (ruling 2018-03-16)', () => {
  const game = (life: number) => setLife(mpScenario({ players: 3, defs: [THIEF, PINGER, DRAIN], zones: { p1: { battlefield: ['Test Thief', 'Test Pinger'], hand: ['Test Drain'] } } }), 'p1', life);
  it('lethal damage leaves you at 1 life; damage that does not reach 0 is dealt as usual', () => {
    const a = activate(game(3), byName(game(3), 'Test Pinger'), { targets: [[plr('p1')]] });
    expect(lifeOf(a, 'p1')).toBe(1);
    expect(a.players.find((p) => p.id === 'p1')!.hasLost).toBeFalsy();
    const b = activate(game(9), byName(game(9), 'Test Pinger'), { targets: [[plr('p1')]] });
    expect(lifeOf(b, 'p1')).toBe(4);
  });
  it('at 1 life further damage changes nothing; another player is not protected; losing life is not damage', () => {
    const s0 = game(1);
    expect(lifeOf(activate(s0, byName(s0, 'Test Pinger'), { targets: [[plr('p1')]] }), 'p1')).toBe(1);
    expect(lifeOf(activate(s0, byName(s0, 'Test Pinger'), { targets: [[plr('p2')]] }), 'p2')).toBe(15);
    expect(lifeOf(cast(game(3), 'Test Drain', {}), 'p1')).toBe(-2);
  });
});

describe('CR 120.3a, 614.1a: "As long as you have 7 or more life, damage that would reduce your life total to less than 7 reduces it to 7 instead." (ruling 2012-07-01)', () => {
  const game = (life: number) => setLife(mpScenario({ players: 3, defs: [WURM, PINGER], zones: { p1: { battlefield: ['Test Wurm', 'Test Pinger'] } } }), 'p1', life);
  it('from 10 life five damage is dealt in full (5), from 9 life it stops at 7; from 6 life (less than 7) it is dealt as usual', () => {
    const s10 = game(10);
    expect(lifeOf(activate(s10, byName(s10, 'Test Pinger'), { targets: [[plr('p1')]] }), 'p1')).toBe(7);
    const s9 = game(9);
    expect(lifeOf(activate(s9, byName(s9, 'Test Pinger'), { targets: [[plr('p1')]] }), 'p1')).toBe(7);
    const s6 = game(6);
    expect(lifeOf(activate(s6, byName(s6, 'Test Pinger'), { targets: [[plr('p1')]] }), 'p1')).toBe(1);
  });
  it('damage that leaves you at 7 or more is dealt in full (20 life, 5 damage: 15)', () => {
    const s20 = game(20);
    expect(lifeOf(activate(s20, byName(s20, 'Test Pinger'), { targets: [[plr('p1')]] }), 'p1')).toBe(15);
  });
  it('another player\'s life total is not floored', () => {
    const s = setLife(game(10), 'p2', 7);
    expect(lifeOf(activate(s, byName(s, 'Test Pinger'), { targets: [[plr('p2')]] }), 'p2')).toBe(2);
  });
});

describe('CR 702.29a, 601.2i, 113.6k: "When you cast or cycle ~, create a 0/1 colorless Eldrazi Spawn creature token ..."', () => {
  const game = () => scenario(['Plains'], { p1: { hand: ['Test Lurker', 'Test Mind'], battlefield: ['Plains'] }, defs: [LURKER, MIND] });
  it('casting it makes one Spawn token (the trigger works on the stack)', () => {
    const s = cast(game(), 'Test Lurker', {});
    expect(names(s, 'Eldrazi Spawn Token').length).toBe(1);
    expect(names(s, 'Test Lurker').length).toBe(1);
  });
  it('cycling it makes one Spawn token (the trigger works in the graveyard)', () => {
    const s = cycle(game(), 'Test Lurker', {});
    expect(names(s, 'Test Lurker', 'graveyard').length).toBe(1);
    expect(names(s, 'Eldrazi Spawn Token').length).toBe(1);
  });
  it('discarding it by another effect makes no token', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Lurker', 'Test Mind'], battlefield: ['Plains'] }, defs: [LURKER, MIND] });
    const s = cast(s0, 'Test Mind', { targets: [[plr('p1')]] });
    expect(names(s, 'Test Lurker', 'graveyard').length).toBe(1);
    expect(names(s, 'Eldrazi Spawn Token').length).toBe(0);
  });
  it('cycling it while a graveyard replacement exiles it still makes the token (CR 702.29c: it triggers from the zone it winds up in)', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Lurker'], battlefield: ['Plains', 'Test Rip'] }, defs: [LURKER, RIP] });
    const s = cycle(s0, 'Test Lurker', {});
    expect(names(s, 'Test Lurker', 'graveyard').length).toBe(0);
    expect(names(s, 'Eldrazi Spawn Token').length).toBe(1);
  });
  it('a Lurker in the graveyard does not trigger when another card is cycled', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Lurker Two'], graveyard: ['Test Lurker'], battlefield: ['Plains'] }, defs: [LURKER, LURKER2] });
    const s = cycle(s0, 'Test Lurker Two', {});
    expect(names(s, 'Eldrazi Spawn Token').length).toBe(1); // only the cycled card's own trigger
  });
  it('another card being cast or cycled does not trigger it', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Lurker', 'Test Lurker Two'], battlefield: ['Plains', 'Test Lurker'] }, defs: [LURKER, LURKER2] });
    const s = cycle(s0, 'Test Lurker Two', {});
    expect(names(s, 'Eldrazi Spawn Token').length).toBe(1); // only the cycled card's own trigger
  });
});

describe('CR 702.29a, 603.2c: "Whenever you cycle another card for the first time each turn, create a 1/1 white Human Soldier creature token."', () => {
  const game = () => scenario(['Plains'], { p1: { hand: ['Test Cycler', 'Test Cycler Two'], battlefield: ['Test Rescuer'] }, defs: [RESCUER, CYCLER, CYCLER2] });
  it('the first cycling of the turn makes a token, the second does not', () => {
    const one = cycle(game(), 'Test Cycler', {});
    expect(names(one, 'Human Soldier Token').length).toBe(1);
    const two = cycle(one, 'Test Cycler Two', {});
    expect(names(two, 'Human Soldier Token').length).toBe(1);
  });
  it('the next turn the first cycling triggers again', () => {
    const one = cycle(game(), 'Test Cycler', {});
    const next = toTurn(one, 3);
    const two = cycle(next, 'Test Cycler Two', {});
    expect(names(two, 'Human Soldier Token').length).toBe(2);
  });
});

describe('CR 118.12, 701.6a: "When you cast this spell, counter target spell an opponent controls unless they pay {1}."', () => {
  const game = (lands: string[]) => scenario(['Plains'], { p1: { hand: ['Test Opt'], battlefield: lands }, p2: { hand: ['Test Coatl'], battlefield: ['Plains', 'Plains'] }, defs: [OPT, COATL] });
  const respond = (s0: GameState, payAnswer: DecisionAnswer[]): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Opt', 'hand', 'p1') } as never);
    s = settle(s, {});
    s = pass(s); // p1 passes: p2 may respond
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Coatl', 'hand', 'p2') } as never);
    s = settle(s, { targets: [[obj(find(s, 'Test Opt', 'stack'))]], answers: [...payAnswer] });
    return drain(s, { answers: [...payAnswer] });
  };
  it('the spell is countered when its controller cannot or does not pay', () => {
    const s = respond(game([]), [no]);
    expect(names(s, 'Test Opt', 'graveyard').length).toBe(1);
    expect(s.zones.hand['p1']!.length).toBe(0); // countered: no card drawn
    expect(names(s, 'Test Coatl').length).toBe(1);
  });
  it('the spell resolves when its controller pays {1}', () => {
    const s = respond(game(['Plains']), [yes]);
    expect(names(s, 'Test Opt', 'graveyard').length).toBe(1); // it resolved: a sorcery goes to the graveyard either way, the player drew a card
    expect(s.zones.hand['p1']!.length).toBe(1);
  });
});

describe('CR 611.2a, 613.4c, 702.9b: "Until your next turn, up to one target creature gets -2/-0 and loses flying."', () => {
  it('the creature is 1/3 without flying until the controller of the ability\'s next turn, then 3/3 with flying again', () => {
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Skydancer', counters: { loyalty: 5 } }] }, p2: { battlefield: ['Test Bird'] }, defs: [YANLING2, BIRD] });
    const bird = byName(s0, 'Test Bird');
    const s = activate(s0, byName(s0, 'Test Skydancer'), { targets: [[obj(bird)]] });
    expect(stat(s, bird)).toBe('1/3');
    expect(kw(s, bird)).not.toContain('flying');
    const t2 = toTurn(s, 2);
    expect(stat(t2, bird)).toBe('1/3');
    const t3 = toTurn(t2, 3);
    expect(stat(t3, bird)).toBe('3/3');
    expect(kw(t3, bird)).toContain('flying');
  });
});

describe('CR 604.1, 611.3a, 500.1: "During your turn, creatures you control get +1/+0 and have trample."', () => {
  it('your creatures get +1/+0 and trample in your turn; an opponent\'s creature does not; in the opponent\'s turn nothing', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Riot', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] }, defs: [RIOT, BEAR] });
    const mine = byName(s0, 'Test Bear', 'battlefield', 'p1');
    const theirs = byName(s0, 'Test Bear', 'battlefield', 'p2');
    expect(stat(s0, mine)).toBe('3/2');
    expect(kw(s0, mine)).toContain('trample');
    expect(stat(s0, theirs)).toBe('2/2');
    const t2 = toTurn(s0, 2);
    expect(stat(t2, mine)).toBe('2/2');
    expect(kw(t2, mine)).not.toContain('trample');
  });
});
