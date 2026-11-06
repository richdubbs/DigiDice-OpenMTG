/**
 * Commander effort, coordinator B, round edh-b-2 (EDHREC ranks 7,251 to 8,000): the round's readings played through the engine with synthetic cards (invented names),
 * compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case.
 *
 *   CR 614.10, 502.1          "Players skip their untap steps." (Stasis)
 *   CR 122.6, 614.17          "Creatures your opponents control can't have +1/+1 counters put on them." (Blightbeetle), "-1/-1" (Darksteel Angel)
 *   CR 613.4c, 107.3          "Equipped creature gets +X/+1, where X is the number of artifacts you control." (Cranial Ram)
 *   CR 702                    "Each creature you control with flying, deathtouch, and/or lifelink gets +1/+0 until end of turn." (Henrika Domnathi)
 *   CR 205.2a, 205.3m         "Each creature you control that's an artifact or Human gains indestructible until end of turn." (Paladin Danse, Steel Maverick)
 *   CR 609.4, 702.3b, 611.3a  "As long as C, it has trample and can attack as though it didn't have defender." (Colossus of Akros)
 *   CR 205.4a, 613.1d, 111.1  "~ isn't legendary if it's a token." (Aeve, Progenitor Ooze)
 *   CR 615.1a, 611.2a, 120.2  "Until your next turn, prevent all damage that would be dealt to and dealt by target permanent an opponent controls." (Kiora, the Crashing Wave)
 *   CR 208.1, 608.2h          "... if you control the creature with the greatest toughness or tied for the greatest toughness." (Abzan Beastmaster)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, pass, put } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', loyalty?: string): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}), ...(loyalty ? { loyalty } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const plr = (id: string): TargetChoice => ({ kind: 'player', id } as TargetChoice);
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };

interface Opts { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[]; options?: string[] }
/** Answer what comes up: targets, object choices, option labels, then the answers; pay costs automatically; stop at priority. */
function settle(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets' && o.targets && o.targets.length > 0) s = answer(s, { kind: 'chooseTargets', targets: o.targets.shift()! });
    else if (p.kind === 'chooseObjects' && o.picks && o.picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: o.picks.shift()! });
    else if (p.kind === 'chooseOption' && o.options && o.options.length > 0) {
      const label = o.options.shift()!;
      const opt = p.options.find((x) => x.label === label);
      if (!opt) throw new Error(`no option ${label} among ${p.options.map((x) => x.label).join(', ')}`);
      s = answer(s, { kind: 'chooseOption', ids: [opt.id] });
    } else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [p.options[0]!.id] });
    else if (o.answers && o.answers.length > 0) s = answer(s, o.answers.shift()!);
    else break;
  }
  return s;
}
const queued = (o: Opts): Opts => ({ ...o, targets: [...(o.targets ?? [])], picks: [...(o.picks ?? [])], answers: [...(o.answers ?? [])], options: [...(o.options ?? [])] });
function drain(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 40; guard++) s = settle(pass(s), o);
  return s;
}
/** p1 activates an ability of a permanent, answers what is asked, and lets the stack resolve. */
function activate(s0: GameState, source: ObjectId, opts: Opts = {}, ability = 'p:0:0'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'activate', player: 'p1', source, ability } as never), q), q);
}
/** p1 casts a card from their hand, answers what is asked, and lets the stack resolve. */
function cast(s0: GameState, name: string, opts: Opts = {}): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') } as never), q), q);
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
/** Pass (declaring nothing when asked) until the first main phase of turn `n`. */
function toMain(s0: GameState, n: number): GameState {
  let s = s0;
  for (let i = 0; i < 400 && !(s.turn.number === n && s.turn.step === 'main1' && s.pending?.kind === 'priority'); i++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player } as never);
    else s = settle(s, {});
  }
  return s;
}
const byName = (s: GameState, name: string, zone: 'battlefield' | 'hand' | 'graveyard' | 'library' = 'battlefield', owner?: string): ObjectId =>
  Object.values(s.objects).find((o) => s.defs[o.defId]?.name === name && o.zone === zone && (owner === undefined || o.owner === owner))!.id;
const stat = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const hasType = (s: GameState, id: ObjectId, t: string): boolean => getChars(s, id)!.types.includes(t as never);
const kw = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword?: string }).keyword ?? ''));
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;


const FREEZE = card('Test Freeze', 'Enchantment', 'Players skip their untap steps.');
const BEETLE = card('Test Beetle', 'Creature — Insect', "Creatures your opponents control can't have +1/+1 counters put on them.", ['2', '2']);
const ANGEL = card('Test Angel', 'Artifact Creature — Angel', "Creatures you control can't have -1/-1 counters put on them.", ['2', '2']);
const GROW = card('Test Grow', 'Instant', 'Put a +1/+1 counter on target creature.');
const SHRINK = card('Test Shrink', 'Instant', 'Put a -1/-1 counter on target creature.');
const RAM = card('Test Ram', 'Artifact — Equipment', 'Equipped creature gets +X/+1, where X is the number of artifacts you control.\nEquip {0}');
const RALLY = card('Test Rally', 'Instant', 'Each creature you control with flying, deathtouch, and/or lifelink gets +1/+0 until end of turn.');
const FLYER = card('Test Flyer', 'Creature — Bird', 'Flying', ['1', '1']);
const DEATHER = card('Test Deather', 'Creature — Snake', 'Deathtouch', ['1', '1']);
const LINKER = card('Test Linker', 'Creature — Cleric', 'Lifelink', ['1', '1']);
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', ['1', '1']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const WARD = card('Test Ward', 'Instant', "Each creature you control that's an artifact or Human gains indestructible until end of turn.");
const ROBOT = card('Test Robot', 'Artifact Creature — Robot', '', ['1', '1']);
const HUMAN = card('Test Human', 'Creature — Human', '', ['1', '1']);
const GIANT = card('Test Giant', 'Creature — Giant', "Defender\nAs long as ~ is monstrous, it has trample and can attack as though it didn't have defender.", ['3', '3']);
const OOZE = card('Test Ooze', 'Legendary Creature — Ooze', "~ isn't legendary if it's a token.", ['2', '2']);
const COPY = card('Test Copy', 'Instant', "Create a token that's a copy of target creature you control.");
const SHIELD = card('Test Shield', 'Instant', 'Until your next turn, prevent all damage that would be dealt to and dealt by target permanent an opponent controls.');
const PING = card('Test Ping', 'Creature — Wizard', '{0}: ~ deals 1 damage to target creature.', ['1', '1']);
const BEAST = card('Test Beast', 'Creature — Dog', 'At the beginning of your upkeep, draw a card if you control the creature with the greatest toughness or tied for the greatest toughness.', ['1', '3']);
const BIG = card('Test Big', 'Creature — Giant', '', ['1', '5']);

const ALL = [FREEZE, BEETLE, ANGEL, GROW, SHRINK, RAM, RALLY, FLYER, DEATHER, LINKER, GOBLIN, WARD, ROBOT, HUMAN, BEAR, GIANT, OOZE, COPY, SHIELD, PING, BEAST, BIG];
describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of ALL) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

const handOf = (s: GameState, p: string): number => s.zones.hand[p]!.length;
const tappedOf = (s: GameState, id: ObjectId): boolean => s.objects[id]!.tapped;
const countersOf = (s: GameState, id: ObjectId): Record<string, number> => ({ ...s.objects[id]!.counters });

describe('CR 614.10, 502.1: "Players skip their untap steps." (every player, every turn)', () => {
  const game = (withFreeze: boolean) => mpScenario({ players: 3, defs: [FREEZE, GOBLIN],
    zones: { p1: { battlefield: [...(withFreeze ? ['Test Freeze'] : []), { name: 'Test Goblin', tapped: true }] }, p2: { battlefield: [{ name: 'Test Goblin', tapped: true }] } } });
  it('with it, a tapped permanent of the active player and of the next player stays tapped through their untap steps', () => {
    const s = toMain(game(true), 4);
    const mine = byName(s, 'Test Goblin', 'battlefield', 'p1');
    const theirs = byName(s, 'Test Goblin', 'battlefield', 'p2');
    expect(s.turn.number).toBe(4);
    expect(tappedOf(s, mine)).toBe(true);
    expect(tappedOf(s, theirs)).toBe(true);
  });
  it('without it (negative case) both untap in their untap steps', () => {
    const s = toMain(game(false), 4);
    expect(tappedOf(s, byName(s, 'Test Goblin', 'battlefield', 'p1'))).toBe(false);
    expect(tappedOf(s, byName(s, 'Test Goblin', 'battlefield', 'p2'))).toBe(false);
  });
});

describe('CR 502.1, 614.10: no untap step means no phasing (Stasis ruling 2004-10-04)', () => {
  const game = (withFreeze: boolean) => {
    const s = mpScenario({ players: 3, defs: [FREEZE, GOBLIN], zones: { p1: { battlefield: [...(withFreeze ? ['Test Freeze'] : []), 'Test Goblin'] } } });
    return tweak(s, (t) => { t.objects[byName(s, 'Test Goblin')]!.phasedOut = true; });
  };
  it('a permanent that is phased out stays phased out through the untap step it would phase in during; without Stasis it phases in', () => {
    const a = toMain(game(true), 4);
    expect(a.objects[byName(a, 'Test Goblin')]!.phasedOut).toBe(true);
    const b = toMain(game(false), 4);
    expect(b.objects[byName(b, 'Test Goblin')]!.phasedOut).toBe(false);
  });
});

describe('CR 122.6, 614.17: a ban on counters of one kind', () => {
  const game = () => mpScenario({ players: 3, defs: [BEETLE, ANGEL, GROW, SHRINK, BEAR],
    zones: { p1: { hand: ['Test Grow', 'Test Shrink'], battlefield: ['Test Beetle', 'Test Bear'] }, p2: { battlefield: [{ name: 'Test Bear' }] } } });
  it('"+1/+1 counters can\'t be put on creatures your opponents control": the opponent\'s creature gets none, mine does, and a -1/-1 counter still goes on theirs', () => {
    const s0 = game();
    const mine = byName(s0, 'Test Bear', 'battlefield', 'p1');
    const theirs = byName(s0, 'Test Bear', 'battlefield', 'p2');
    let s = cast(s0, 'Test Grow', { targets: [[obj(theirs)]] });
    expect(countersOf(s, theirs)).toEqual({});
    s = cast(s, 'Test Shrink', { targets: [[obj(theirs)]] });
    expect(countersOf(s, theirs)).toEqual({ '-1/-1': 1 });
    const s2 = cast(game(), 'Test Grow', { targets: [[obj(mine)]] });
    expect(countersOf(s2, mine)).toEqual({ '+1/+1': 1 });
  });
  it('"-1/-1 counters can\'t be put on creatures you control": mine get no -1/-1 counter but a +1/+1 counter; an opponent\'s creature gets either', () => {
    const mk = () => mpScenario({ players: 3, defs: [ANGEL, GROW, SHRINK, BEAR],
      zones: { p1: { hand: ['Test Grow', 'Test Shrink'], battlefield: ['Test Angel', 'Test Bear'] }, p2: { battlefield: [{ name: 'Test Bear' }] } } });
    const s0 = mk();
    const mine = byName(s0, 'Test Bear', 'battlefield', 'p1');
    const theirs = byName(s0, 'Test Bear', 'battlefield', 'p2');
    const s1 = cast(s0, 'Test Shrink', { targets: [[obj(mine)]] });
    expect(countersOf(s1, mine)).toEqual({});
    const s2 = cast(mk(), 'Test Grow', { targets: [[obj(mine)]] });
    expect(countersOf(s2, mine)).toEqual({ '+1/+1': 1 });
    const s3 = cast(mk(), 'Test Shrink', { targets: [[obj(theirs)]] });
    expect(countersOf(s3, theirs)).toEqual({ '-1/-1': 1 });
  });
});

describe('CR 122.6, 614.12: a ban on +1/+1 counters also stops a creature entering with them (Blightbeetle ruling 2019-07-12)', () => {
  const CUB = card('Test Cub', 'Creature — Bear', '~ enters with a +1/+1 counter on it.', ['1', '1']);
  const FENCE = card('Test Fence', 'Enchantment', "Creatures you control can't have +1/+1 counters put on them.");
  const CURSED = card('Test Cursed Cub', 'Creature — Bear', '~ enters with a -1/-1 counter on it.', ['2', '2']);
  it('a creature of mine that enters with a +1/+1 counter gets none while the ban stands, and does without it; a -1/-1 counter is still put on it', () => {
    for (const d of [CUB, FENCE, CURSED]) expect(full(d), d.name).toBe(true);
    const mk = (fence: boolean) => mpScenario({ players: 3, defs: [CUB, FENCE, CURSED], zones: { p1: { hand: ['Test Cub', 'Test Cursed Cub'], battlefield: fence ? ['Test Fence'] : [] } } });
    const withFence = cast(mk(true), 'Test Cub');
    expect(countersOf(withFence, byName(withFence, 'Test Cub'))).toEqual({});
    const without = cast(mk(false), 'Test Cub');
    expect(countersOf(without, byName(without, 'Test Cub'))).toEqual({ '+1/+1': 1 });
    const cursed = cast(mk(true), 'Test Cursed Cub');
    expect(countersOf(cursed, byName(cursed, 'Test Cursed Cub'))).toEqual({ '-1/-1': 1 });
  });
});

describe('CR 613.4c, 107.3: "Equipped creature gets +X/+1, where X is the number of artifacts you control."', () => {
  it('the equipped creature gets +X/+1 with X the artifacts its controller controls; an unequipped creature is unchanged', () => {
    const s0 = mpScenario({ players: 3, defs: [RAM, GOBLIN, ROBOT], zones: { p1: { battlefield: ['Test Ram', 'Test Goblin', 'Test Robot'] } } });
    const goblin = byName(s0, 'Test Goblin');
    const robot = byName(s0, 'Test Robot');
    expect(stat(s0, goblin)).toBe('1/1');
    const s = tweak(s0, (t) => { t.objects[byName(s0, 'Test Ram')]!.attachedTo = goblin; });
    expect(stat(s, goblin)).toBe('3/2'); // the Ram and the Robot are artifacts: +2/+1
    expect(stat(s, robot)).toBe('1/1');
  });
});

describe('Each creature you control with flying, deathtouch, and/or lifelink gets +1/+0 until end of turn (any one of them is enough)', () => {
  it('a flier, a deathtoucher and a lifelinker get +1/+0; a vanilla creature and an opponent\'s flier do not', () => {
    const s0 = mpScenario({ players: 3, defs: [RALLY, FLYER, DEATHER, LINKER, GOBLIN], zones: { p1: { hand: ['Test Rally'], battlefield: ['Test Flyer', 'Test Deather', 'Test Linker', 'Test Goblin'] }, p2: { battlefield: ['Test Flyer'] } } });
    const s = cast(s0, 'Test Rally');
    expect(stat(s, byName(s, 'Test Flyer', 'battlefield', 'p1'))).toBe('2/1');
    expect(stat(s, byName(s, 'Test Deather'))).toBe('2/1');
    expect(stat(s, byName(s, 'Test Linker'))).toBe('2/1');
    expect(stat(s, byName(s, 'Test Goblin'))).toBe('1/1');
    expect(stat(s, byName(s, 'Test Flyer', 'battlefield', 'p2'))).toBe('1/1');
  });
  it('the set is fixed when the effect resolves (CR 611.2c): a flier that arrives later this turn gets nothing', () => {
    const s0 = mpScenario({ players: 3, defs: [RALLY, FLYER], zones: { p1: { hand: ['Test Rally'], battlefield: ['Test Flyer'] } } });
    let s = cast(s0, 'Test Rally');
    s = tweak(s, (t) => { put(t, 'p1', 'battlefield', 'Test Flyer'); });
    const fliers = Object.values(s.objects).filter((o) => o.zone === 'battlefield' && s.defs[o.defId]?.name === 'Test Flyer').map((o) => stat(s, o.id)).sort();
    expect(fliers).toEqual(['1/1', '2/1']);
  });
});

describe('CR 205.2a, 205.3m: "Each creature you control that\'s an artifact or Human gains indestructible until end of turn."', () => {
  it('an artifact creature and a Human creature of mine gain it; another creature of mine and an opponent\'s Human do not', () => {
    const s0 = mpScenario({ players: 3, defs: [WARD, ROBOT, HUMAN, GOBLIN], zones: { p1: { hand: ['Test Ward'], battlefield: ['Test Robot', 'Test Human', 'Test Goblin'] }, p2: { battlefield: ['Test Human'] } } });
    const s = cast(s0, 'Test Ward');
    expect(kw(s, byName(s, 'Test Robot'))).toContain('indestructible');
    expect(kw(s, byName(s, 'Test Human', 'battlefield', 'p1'))).toContain('indestructible');
    expect(kw(s, byName(s, 'Test Goblin'))).not.toContain('indestructible');
    expect(kw(s, byName(s, 'Test Human', 'battlefield', 'p2'))).not.toContain('indestructible');
  });
  it('the set is fixed when the effect resolves (CR 611.2c; Paladin Danse ruling 2024-03-08): a Human that arrives later this turn does not gain it', () => {
    const s0 = mpScenario({ players: 3, defs: [WARD, HUMAN], zones: { p1: { hand: ['Test Ward'], battlefield: ['Test Human'] } } });
    let s = cast(s0, 'Test Ward');
    s = tweak(s, (t) => { put(t, 'p1', 'battlefield', 'Test Human'); });
    const humans = Object.values(s.objects).filter((o) => o.zone === 'battlefield' && s.defs[o.defId]?.name === 'Test Human').map((o) => o.id);
    expect(humans.length).toBe(2);
    expect(humans.filter((id) => kw(s, id).includes('indestructible')).length).toBe(1);
  });
});

describe('CR 609.4, 702.3b, 611.3a: "As long as C, it has trample and can attack as though it didn\'t have defender."', () => {
  const game = (monstrous: boolean) => {
    const s = mpScenario({ players: 3, defs: [GIANT], zones: { p1: { battlefield: ['Test Giant'] } } });
    return monstrous ? tweak(s, (t) => { t.objects[byName(s, 'Test Giant')]!.monstrous = true; }) : s;
  };
  const attack = (s0: GameState): GameState => {
    let s = s0;
    while (s.pending?.kind === 'priority' && s.turn.step !== 'declareAttackers') s = pass(s);
    return s;
  };
  it('monstrous (CR 701.37b): it has trample and the Giant may be declared as an attacker', () => {
    const s0 = game(true);
    const giant = byName(s0, 'Test Giant');
    expect(kw(s0, giant)).toEqual(expect.arrayContaining(['defender', 'trample']));
    const s = attack(s0);
    expect(s.pending?.kind).toBe('declareAttackers');
    const r = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: giant, defender: 'p2' }] } as never);
    expect(r.turn.step === 'declareAttackers' || r.turn.step === 'declareBlockers' || r.turn.step === 'combatDamage' || r.turn.step === 'endCombat').toBe(true);
  });
  it('not monstrous (negative case): it has no trample and a defender can\'t be declared', () => {
    const s0 = game(false);
    const giant = byName(s0, 'Test Giant');
    expect(kw(s0, giant)).not.toContain('trample');
    const s = attack(s0);
    if (s.pending?.kind === 'declareAttackers') {
      expect(() => answer(s, { kind: 'declareAttackers', attacks: [{ attacker: giant, defender: 'p2' }] } as never)).toThrow();
    }
  });
});

describe('CR 205.4a, 613.1d, 111.1: "~ isn\'t legendary if it\'s a token."', () => {
  it('the card is legendary; a token copy of it is not', () => {
    const s0 = mpScenario({ players: 3, defs: [OOZE, COPY], zones: { p1: { hand: ['Test Copy'], battlefield: ['Test Ooze'] } } });
    const card0 = byName(s0, 'Test Ooze');
    expect(getChars(s0, card0)!.supertypes).toContain('Legendary');
    const s = cast(s0, 'Test Copy', { targets: [[obj(card0)]] });
    const oozes = Object.values(s.objects).filter((o) => o.zone === 'battlefield' && s.defs[o.defId]?.name === 'Test Ooze');
    expect(oozes.length).toBe(2);
    const token = oozes.find((o) => o.kind === 'token')!;
    expect(getChars(s, token.id)!.supertypes).not.toContain('Legendary');
    expect(getChars(s, card0)!.supertypes).toContain('Legendary');
  });
});

describe('CR 615.1a, 611.2a, 120.2: "Until your next turn, prevent all damage that would be dealt to and dealt by target permanent an opponent controls."', () => {
  const game = () => mpScenario({ players: 3, defs: [SHIELD, PING, GOBLIN, BIG], zones: { p1: { hand: ['Test Shield'], battlefield: ['Test Ping', 'Test Big'] }, p2: { battlefield: [{ name: 'Test Ping' }, { name: 'Test Goblin' }] } } });
  it('damage to the target and by the target is prevented; damage to and by other permanents is not', () => {
    const s0 = game();
    const theirPing = byName(s0, 'Test Ping', 'battlefield', 'p2');
    const myPing = byName(s0, 'Test Ping', 'battlefield', 'p1');
    const theirGoblin = byName(s0, 'Test Goblin');
    let s = cast(s0, 'Test Shield', { targets: [[obj(theirPing)]] });
    s = activate(s, myPing, { targets: [[obj(theirPing)]] }, 'p:0:0'); // damage TO the target
    expect(s.zones.battlefield.includes(theirPing)).toBe(true);
    expect(s.objects[theirPing]!.damage).toBe(0);
    s = activate(s, myPing, { targets: [[obj(theirGoblin)]] }, 'p:0:0'); // another permanent takes damage
    expect(s.zones.battlefield.includes(theirGoblin)).toBe(false); // 1 damage kills the 1/1
  });
  it('damage dealt BY the target is prevented, also in the opponent\'s own turn (turn 2); it ends when the controller\'s next turn begins (turn 4)', () => {
    const s0 = game();
    const theirPing = byName(s0, 'Test Ping', 'battlefield', 'p2');
    const myBig = byName(s0, 'Test Big');
    let s = cast(s0, 'Test Shield', { targets: [[obj(theirPing)]] });
    s = toMain(s, 2);
    s = act(s, { type: 'activate', player: 'p2', source: theirPing, ability: 'p:0:0' } as never);
    s = drain(settle(s, { targets: [[obj(myBig)]] }), {});
    expect(s.objects[myBig]!.damage).toBe(0);
    s = toMain(s, 4);
    s = activate(s, byName(s, 'Test Ping', 'battlefield', 'p1'), { targets: [[obj(theirPing)]] }, 'p:0:0');
    expect(s.zones.battlefield.includes(theirPing)).toBe(false); // no longer prevented: the 1/1 dies
  });
});

describe('CR 208.1, 608.2h: "draw a card if you control the creature with the greatest toughness or tied for the greatest toughness"', () => {
  const run = (mine: string[], opposing: string[]) => {
    const s0 = mpScenario({ players: 3, defs: [BEAST, BIG, GOBLIN], zones: { p1: { battlefield: mine }, p2: { battlefield: opposing } } });
    const before = handOf(s0, 'p1');
    return handOf(toMain(s0, 4), 'p1') - before;
  };
  it('alone with the greatest toughness it draws at the upkeep; with a creature of greater toughness in play it does not; tied for the greatest it does', () => {
    const draw = run(['Test Goblin'], []); // no Beast: only the draw step
    const alone = run(['Test Beast'], []);
    const outclassed = run(['Test Beast'], ['Test Big']);
    const tied = run(['Test Beast'], ['Test Beast']);
    expect(alone - draw).toBe(1);
    expect(outclassed - draw).toBe(0);
    expect(tied - draw).toBe(1);
  });
});

describe('CR 601.2f, 115.9b: "Spells that target ~ cost {2} less to cast." (the plural "that target"; Spellwild Ouphe was made full by the same renderer fix)', () => {
  const OUPHE = card('Test Ouphe', 'Creature — Ouphe', 'Spells that target ~ cost {2} less to cast.', ['1', '1']);
  const ZAP = card('Test Zap', 'Instant', '~ deals 1 damage to target creature.', undefined, '{2}');
  it('a spell that targets it costs {2} less (castable with no mana at all); a spell that targets another creature still costs {2}', () => {
    for (const d of [OUPHE, ZAP]) expect(full(d), d.name).toBe(true);
    const mk = () => mpScenario({ players: 3, defs: [OUPHE, ZAP, BEAR], zones: { p1: { hand: ['Test Zap'], battlefield: ['Test Ouphe', 'Test Bear'] } } });
    const s0 = mk();
    const s = cast(s0, 'Test Zap', { targets: [[obj(byName(s0, 'Test Ouphe'))]] });
    expect(byName(s, 'Test Zap', 'graveyard', 'p1')).toBeDefined(); // it was cast and resolved with no mana paid
    const s1 = mk();
    expect(() => cast(s1, 'Test Zap', { targets: [[obj(byName(s1, 'Test Bear'))]] })).toThrow();
  });
});

describe('CR 122.6, 614.17b: a cost that puts counters on a creature (Blightbeetle ruling 2019-07-12) is refused for the banned kind only', () => {
  const RITE = card('Test Rite', 'Instant', 'As an additional cost to cast this spell, put a -1/-1 counter on a creature you control.\nDraw two cards.');
  const BOOST = card('Test Boost', 'Instant', 'As an additional cost to cast this spell, put a +1/+1 counter on a creature you control.\nDraw two cards.');
  const mk = (ban: string[]) => mpScenario({ players: 3, defs: [RITE, BOOST, BEETLE, BEAR], zones: { p1: { hand: ['Test Rite', 'Test Boost'], battlefield: ['Test Bear'] }, p2: { battlefield: ban } } });
  it('under an opponent\'s Blightbeetle the +1/+1 cost can\'t be paid but the -1/-1 cost can', () => {
    for (const d of [RITE, BOOST]) expect(full(d), d.name).toBe(true);
    expect(() => cast(mk(['Test Beetle']), 'Test Boost')).toThrow();
    expect(handOf(cast(mk(['Test Beetle']), 'Test Rite'), 'p1')).toBe(handOf(cast(mk([]), 'Test Rite'), 'p1'));
    expect(handOf(cast(mk([]), 'Test Boost'), 'p1')).toBe(handOf(cast(mk([]), 'Test Rite'), 'p1')); // negative case: no ban, the +1/+1 cost is paid
  });
});
