/**
 * Commander lane edh-next, round edh-next-42 (EDHREC ranks 15,001-16,250, second pass): the round's readings played through the engine with synthetic cards (invented
 * names), compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites
 * from memory of the Comprehensive Rules of 2026-09-25 (cloud session without rules/cr: listed as unverified in the round's record).
 *
 *   CR 615.1, 615.5, 121.1          "If a source would deal damage to ~, prevent that damage. The source's controller draws cards equal to the damage prevented this way." (Swans of Bryn Argoll)
 *   CR 106.4, 608.2h                "Destroy target artifact if its mana value is equal to the amount of unspent mana you have." (Glissa Sunseeker)
 *   CR 506.2, 506.3                 "If you do, draw a card for each player being attacked." (Amber Gristle O'Maul)
 *   CR 700.5, 601.2c                "up to X target creatures each gain intimidate and haste until end of turn, where X is your devotion to black." (Mogis's Marauder)
 *   CR 201.2, 610.3, 109.2          "Exile target nonland permanent an opponent controls and all other nonland permanents that player controls with the same name as that permanent until ~ leaves the battlefield." (Deputy of Detention)
 */
import { describe, expect, it } from 'vitest';
import { getChars, legalActions, type CardDef, type GameState, type ObjectId, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, pass } from '../../m3/scenario';
import { declareAttackers, tweak, toDeclareAttackers } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';
import { card, counters, full, pt, resolveAll, settle } from '../cmd3/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const plr = (id: string): TargetChoice => ({ kind: 'player', id } as TargetChoice);
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const handSize = (s: GameState, p: string): number => s.zones.hand[p]!.length;
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const onField = (s: GameState, name: string, p?: string): ObjectId[] => s.zones.battlefield.filter((id) => nameOf(s, id) === name && (p === undefined || s.objects[id]!.controller === p));
const inExile = (s: GameState, name: string): ObjectId[] => Object.values(s.objects).filter((o) => o.zone === 'exile' && nameOf(s, o.id) === name).map((o) => o.id);
const cast = (s: GameState, name: string, targets: TargetChoice[] = [], objects: ObjectId[] | undefined = undefined, player = 'p1'): GameState =>
  resolveAll(settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), { targets, ...(objects ? { objects } : {}) }), { targets, ...(objects ? { objects } : {}) });
function activate(s: GameState, source: ObjectId, targets: TargetChoice[] = [], n = 0): GameState {
  const a = legalActions(s, s.objects[source]!.controller).filter((x) => x.kind === 'activate' && x.object === source && x.isMana !== true)[n];
  if (!a) throw new Error(`no ability ${n} of ${source}`);
  return resolveAll(settle(act(s, a.action), { targets }), { targets });
}
const tapForMana = (s: GameState, source: ObjectId): GameState => {
  const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.isMana === true && x.object === source);
  if (!a) throw new Error(`no mana ability of ${source}`);
  return act(s, a.action);
};


const PINGER = card('Test Pinger', 'Creature — Goblin', '{0}: This creature deals 4 damage to target player.', [ '2', '2' ]);
const OTHER = card('Test Other Pinger', 'Creature — Goblin', '{0}: This creature deals 3 damage to target player.', [ '2', '2' ]);
const SWANS = card('Test Swans', 'Creature — Bird', 'Flying\nIf a source would deal damage to this creature, prevent that damage. The source\'s controller draws cards equal to the damage prevented this way.', ['2', '2']);
const BOLT = card('Test Bolt', 'Instant', '~ deals 3 damage to any target.');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['3', '3']);
const POKER = card('Test Poker', 'Creature — Goblin', '{0}: This creature deals 2 damage to target creature.', ['1', '1']);
const GLISSA = card('Test Seeker', 'Creature — Elf', 'First strike\n{T}: Destroy target artifact if its mana value is equal to the amount of unspent mana you have.', ['2', '2']);
const ROCK1 = card('Test Rock One', 'Artifact', '', undefined, '{1}');
const ROCK2 = card('Test Rock Two', 'Artifact', '', undefined, '{2}');
const AMBER = card('Test Amber', 'Creature — Goblin', 'Haste\nWhenever ~ attacks, you may discard your hand. If you do, draw a card for each player being attacked.', ['2', '2']);

const DEPUTY = card('Test Deputy', 'Creature — Human Cleric', 'When this creature enters, exile target nonland permanent an opponent controls and all other nonland permanents that player controls with the same name as that permanent until this creature leaves the battlefield.', ['2', '2']);
const KILLER = card('Test Zapper', 'Instant', '~ deals 5 damage to target creature.');
const MARAUDER = card('Test Marauder', 'Creature — Zombie', 'When this creature enters, up to X target creatures each gain haste until end of turn, where X is your devotion to black.', ['2', '2'], '{2}{B}');
const DARK = card('Test Dark Idol', 'Artifact', '', undefined, '{B}{B}');
const WOLF = card('Test Wolf', 'Creature — Wolf', '', ['2', '2']);
const OWL = card('Test Owl', 'Creature — Bird', '', ['1', '1']);

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [PINGER, OTHER, SWANS, BOLT, BEAR, POKER, GLISSA, ROCK1, ROCK2, AMBER, DEPUTY, KILLER, WOLF, OWL, MARAUDER, DARK] as CardDef[]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 615.1, 615.5, 121.1: "If a source would deal damage to ~, prevent that damage. The source\'s controller draws cards equal to the damage prevented this way." (Swans of Bryn Argoll)', () => {
  const game = () => mpScenario({ players: 3, defs: [SWANS, BOLT, BEAR, POKER], zones: { p1: { hand: ['Test Bolt'], battlefield: ['Test Bear', 'Test Poker'] }, p2: { battlefield: ['Test Swans', 'Test Bear'] } } });
  it('the damage of a spell is prevented (the creature is not damaged) and the spell\'s controller draws that many cards', () => {
    const s0 = game();
    const swans = find(s0, 'Test Swans', 'battlefield', 'p2');
    const s = cast(s0, 'Test Bolt', [obj(swans)]);
    expect(s.objects[swans]!.damage).toBe(0);
    expect(s.zones.battlefield).toContain(swans);
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') - 1 + 3); // Bolt left the hand, three cards drawn
  });
  it('the damage of a permanent is prevented and that permanent\'s controller draws (not the Swans\' controller)', () => {
    const s0 = game();
    const swans = find(s0, 'Test Swans', 'battlefield', 'p2');
    const s = activate(s0, find(s0, 'Test Poker', 'battlefield', 'p1'), [obj(swans)]);
    expect(s.objects[swans]!.damage).toBe(0);
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') + 2);
    expect(handSize(s, 'p2')).toBe(handSize(s0, 'p2'));
  });
  it('negative: damage to another creature is dealt as usual and nobody draws', () => {
    const s0 = game();
    const bear = findAll(s0, 'Test Bear', 'battlefield', 'p2')[0]!;
    const s = cast(s0, 'Test Bolt', [obj(bear)]);
    expect(s.zones.battlefield).not.toContain(bear); // 3 damage destroys the 3/3
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') - 1);
  });
});

describe('CR 106.4, 608.2h: "Destroy target artifact if its mana value is equal to the amount of unspent mana you have." (Glissa Sunseeker)', () => {
  const game = () => mpScenario({ players: 3, defs: [GLISSA, ROCK1, ROCK2], zones: { p1: { battlefield: ['Test Seeker', 'Plains', 'Test Rock One', 'Test Rock Two'] } } });
  it('with one unspent mana it destroys a mana value 1 artifact', () => {
    let s = game();
    s = tapForMana(s, find(s, 'Plains', 'battlefield', 'p1'));
    expect(s.players[0]!.manaPool.length).toBe(1);
    s = activate(s, find(s, 'Test Seeker', 'battlefield', 'p1'), [obj(find(s, 'Test Rock One', 'battlefield', 'p1'))]);
    expect(onField(s, 'Test Rock One')).toEqual([]);
    expect(onField(s, 'Test Rock Two').length).toBe(1);
  });
  it('negative: a mana value 2 artifact is not destroyed by one unspent mana, nor any artifact when none is unspent', () => {
    let s = game();
    s = tapForMana(s, find(s, 'Plains', 'battlefield', 'p1'));
    s = activate(s, find(s, 'Test Seeker', 'battlefield', 'p1'), [obj(find(s, 'Test Rock Two', 'battlefield', 'p1'))]);
    expect(onField(s, 'Test Rock Two').length).toBe(1);
    const t = activate(game(), find(game(), 'Test Seeker', 'battlefield', 'p1'), [obj(find(game(), 'Test Rock One', 'battlefield', 'p1'))]);
    expect(onField(t, 'Test Rock One').length).toBe(1); // mana value 1, no unspent mana
  });
});

describe('CR 506.2, 506.3: "Whenever ~ attacks, you may discard your hand. If you do, draw a card for each player being attacked." (Amber Gristle O\'Maul)', () => {
  const game = () => mpScenario({ players: 4, defs: [AMBER, BEAR, WOLF], zones: { p1: { hand: ['Test Bear', 'Test Wolf'], battlefield: ['Test Amber', 'Test Wolf', 'Test Bear'] } } });
  const attack = (s0: GameState, yes: boolean, defenders: [ObjectId, string][]): GameState => {
    let s = declareAttackers(toDeclareAttackers(s0), defenders.map(([id, d]) => [id, d] as [ObjectId, string]));
    for (let g = 0; g < 30 && !(s.pending?.kind === 'priority' && s.zones.stack.length === 0 && s.turn.step !== 'declareAttackers'); g++) {
      if (s.pending?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
      else if (s.pending?.kind === 'priority') s = pass(s);
      else s = settle(s);
      if (s.turn.step === 'declareBlockers' || s.turn.step === 'combatDamage') break;
    }
    return s;
  };
  it('attacking two different players, discarding the two-card hand draws two cards', () => {
    const s0 = game();
    const amber = find(s0, 'Test Amber', 'battlefield', 'p1');
    const wolf = find(s0, 'Test Wolf', 'battlefield', 'p1');
    const s = attack(s0, true, [[amber, 'p2'], [wolf, 'p3']]);
    expect(handSize(s, 'p1')).toBe(2); // discarded the whole hand (three cards), drew two (players being attacked: Bob and Carol)
  });
  it('attacking one player draws one card; not discarding draws nothing and keeps the hand', () => {
    const s0 = game();
    const amber = find(s0, 'Test Amber', 'battlefield', 'p1');
    const one = attack(s0, true, [[amber, 'p2']]);
    expect(handSize(one, 'p1')).toBe(1);
    const none = attack(s0, false, [[amber, 'p2']]);
    expect(handSize(none, 'p1')).toBe(handSize(s0, 'p1')); // no discard, no draw
  });
});

describe('CR 201.2, 610.3, 109.2: "Exile target nonland permanent an opponent controls and all other nonland permanents that player controls with the same name as that permanent until ~ leaves the battlefield." (Deputy of Detention)', () => {
  const game = () => mpScenario({ players: 3, defs: [DEPUTY, KILLER, WOLF, OWL], zones: { p1: { hand: ['Test Deputy', 'Test Zapper'] }, p2: { battlefield: ['Test Wolf', 'Test Wolf', 'Test Owl', 'Plains'] }, p3: { battlefield: ['Test Wolf'] } } });
  /** Cast the Deputy, let it resolve and aim its enters trigger at `target`. */
  const deputize = (s0: GameState, target: ObjectId): GameState => {
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Deputy', 'hand', 'p1') }));
    for (let g = 0; g < 10 && s.pending?.kind !== 'chooseTargets'; g++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
    s = answer(s, { kind: 'chooseTargets', targets: [obj(target)] });
    return resolveAll(s);
  };
  it('exiles the target and the other permanents of that name that player controls (not another player\'s), and returns them all when the Deputy leaves', () => {
    const s0 = game();
    let s = deputize(s0, findAll(s0, 'Test Wolf', 'battlefield', 'p2')[0]!);
    expect(onField(s, 'Test Wolf', 'p2')).toEqual([]);
    expect(onField(s, 'Test Wolf', 'p3').length).toBe(1); // another player's Wolf stays
    expect(onField(s, 'Test Owl', 'p2').length).toBe(1);
    expect(inExile(s, 'Test Wolf').length).toBe(2);
    s = cast(s, 'Test Zapper', [obj(find(s, 'Test Deputy', 'battlefield', 'p1'))]); // the Deputy dies: both Wolves return
    expect(onField(s, 'Test Deputy')).toEqual([]);
    expect(onField(s, 'Test Wolf', 'p2').length).toBe(2);
    expect(inExile(s, 'Test Wolf')).toEqual([]);
  });
  it('negative: the Owl (another name) and the land stay, and a lone permanent is exiled alone', () => {
    const s0 = game();
    const s = deputize(s0, find(s0, 'Test Owl', 'battlefield', 'p2'));
    expect(inExile(s, 'Test Owl').length).toBe(1);
    expect(onField(s, 'Test Wolf', 'p2').length).toBe(2);
    expect(onField(s, 'Plains', 'p2').length).toBe(1);
  });
});

describe('CR 700.5, 601.2c: "When this creature enters, up to X target creatures each gain haste until end of turn, where X is your devotion to black." (Mogis\'s Marauder)', () => {
  const game = () => mpScenario({ players: 3, cards: ['Swamp'], defs: [MARAUDER, DARK, WOLF], zones: { p1: { hand: ['Test Marauder'], battlefield: ['Swamp', 'Swamp', 'Swamp', 'Test Dark Idol', 'Test Wolf', 'Test Wolf', 'Test Wolf', 'Test Wolf'] } } });
  const enter = (s0: GameState, targets: ObjectId[]): GameState => {
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Marauder', 'hand', 'p1') }));
    for (let g = 0; g < 10 && s.pending?.kind !== 'chooseTargets'; g++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
    s = answer(s, { kind: 'chooseTargets', targets: targets.map(obj) });
    return resolveAll(s);
  };
  const hasty = (s: GameState, id: ObjectId): boolean => getChars(s, id)!.keywords.some((k) => (typeof k === 'string' ? k : (k as { keyword?: string }).keyword) === 'haste');
  it('your devotion to black (the Marauder\'s {B} and the idol\'s {B}{B}, once it is on the battlefield: 3) is how many creatures may be targeted; three Wolves gain haste, the fourth does not', () => {
    const s0 = game();
    const wolves = findAll(s0, 'Test Wolf', 'battlefield', 'p1');
    const s = enter(s0, wolves.slice(0, 3));
    expect(wolves.slice(0, 3).every((w) => hasty(s, w))).toBe(true);
    expect(hasty(s, wolves[3]!)).toBe(false);
  });
  it('negative: a fourth target is refused (three symbols of black among your permanents), and an opponent\'s black permanent adds nothing', () => {
    const s0 = game();
    const wolves = findAll(s0, 'Test Wolf', 'battlefield', 'p1');
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Marauder', 'hand', 'p1') }));
    for (let g = 0; g < 10 && s.pending?.kind !== 'chooseTargets'; g++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
    expect(() => answer(s, { kind: 'chooseTargets', targets: wolves.map(obj) })).toThrow();
    const other = mpScenario({ players: 3, cards: ['Swamp'], defs: [MARAUDER, DARK, WOLF], zones: { p1: { hand: ['Test Marauder'], battlefield: ['Swamp', 'Swamp', 'Swamp', 'Test Wolf', 'Test Wolf'] }, p2: { battlefield: ['Test Dark Idol'] } } });
    const w2 = findAll(other, 'Test Wolf', 'battlefield', 'p1');
    let t = settle(act(other, { type: 'cast', player: 'p1', card: find(other, 'Test Marauder', 'hand', 'p1') }));
    for (let g = 0; g < 10 && t.pending?.kind !== 'chooseTargets'; g++) t = t.pending?.kind === 'priority' ? pass(t) : settle(t);
    expect(() => answer(t, { kind: 'chooseTargets', targets: w2.map(obj) })).toThrow(); // devotion 1: two targets are too many
  });
});
