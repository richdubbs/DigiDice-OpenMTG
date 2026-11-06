/**
 * Commander EDHREC ranks 23,001-23,500, round edh-c-110 (fourth pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's
 * default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 205.1b, 613.4b, 611.2a    "When ~ enters, put three +1/+1 counters on up to one target noncreature artifact. That artifact becomes a 0/0 Homunculus artifact creature with flying." (types kept)
 *   CR 508.1h, 509.1d, 122.1     "~ can't attack or block unless you pay {1} for each +1/+1 counter on it."
 *   CR 109.4, 608.2d, 702.16a    "Target creature gains protection from the color of its controller's choice until end of turn." (the controller of the target chooses)
 *   CR 400.3, 608.2c             "Whenever ~ attacks alone, return ~ to ~'s owner's hand. If you do, each opponent loses 2 life and you gain 2 life."
 *   CR 702.3b, 609.4             "It can attack this turn as though it didn't have defender."
 *   CR 701.24a                   "Target player shuffles their library."
 *   CR 702.193a, 106.6           "{T}: Add {R}{R}. Spend this mana only to activate power-up abilities."
 *   CR 302.6, 602.5b, 400.7      "Activate only if you've controlled ~ continuously since the beginning of your most recent turn."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { hasKeyword } from '../../../src/rules/characteristics';
import { attackTaxes, blockTaxes } from '../../../src/statics/combat-tax';
import { act, advanceTo, answer, find, findAll, legal, pass, put, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers, tweak } from '../../m4/helpers';
import { activate, target } from '../../m5/cr-examples/helpers';
import { drive, resolveStack } from '../../m12/rules/helpers';
import { card, cast, full, resolveAll } from '../cmd3/helpers';

const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const onBf = (s: GameState, name: string, p?: string): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name && (p === undefined || s.objects[id]!.controller === p));

describe('CR 205.1b, 613.4b, 611.2a: "That artifact becomes a 0/0 Homunculus artifact creature with flying." (for good; the artifact keeps its types and artifact subtypes)', () => {
  const SERVANT = card('Test Servant', 'Creature — Bird', 'When this creature enters, put three +1/+1 counters on up to one target noncreature artifact. That artifact becomes a 0/0 Homunculus artifact creature with flying.', ['1', '1']);
  const TRINKET = card('Test Trinket', 'Artifact', '');
  const BLADE = card('Test Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+0.\nEquip {2}');
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', ['2', '2']);
  const run = (name: string): { s: GameState; id: ObjectId } => {
    const s0 = scenario([], { defs: [SERVANT, TRINKET, BLADE, GOLEM], p1: { hand: ['Test Servant'], battlefield: ['Test Trinket', 'Test Blade', 'Test Golem'] } });
    const id = find(s0, name, 'battlefield', 'p1');
    const picks = { targets: [{ kind: 'object' as const, id }] };
    return { s: resolveAll(cast(s0, 'Test Servant', picks), picks), id };
  };
  it('is full', () => expect(full(SERVANT)).toBe(true));
  it('a noncreature artifact gets three +1/+1 counters and is a 3/3 Homunculus artifact creature with flying', () => {
    const { s, id } = run('Test Trinket');
    const c = getChars(s, id)!;
    expect(c.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(c.subtypes).toContain('Homunculus');
    expect(pt(s, id)).toBe('3/3');
    expect(hasKeyword(getChars(s, id)!, 'flying')).toBe(true);
  });
  it('it stays a creature after the turn ends (no duration, CR 611.2a)', () => {
    const { s: s0, id } = run('Test Trinket');
    let s = s0;
    for (let i = 0; i < 40 && s.turn.number === s0.turn.number; i++) s = s.pending?.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : pass(s);
    expect(s.turn.number).toBeGreaterThan(s0.turn.number);
    expect(getChars(s, id)!.types).toContain('Creature');
    expect(pt(s, id)).toBe('3/3');
  });
  it('an Equipment keeps its Equipment subtype and its abilities (CR 205.1b: artifact types kept, only creature types replaced)', () => {
    const { s, id } = run('Test Blade');
    const c = getChars(s, id)!;
    expect(c.subtypes).toEqual(expect.arrayContaining(['Equipment', 'Homunculus']));
    expect(c.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
  });
  it('negative: an artifact creature is not a legal target (noncreature only), and no other artifact is changed', () => {
    const s0 = scenario([], { defs: [SERVANT, TRINKET, BLADE, GOLEM], p1: { hand: ['Test Servant'], battlefield: ['Test Trinket', 'Test Golem'] } });
    const golem = find(s0, 'Test Golem', 'battlefield', 'p1');
    const trinket = find(s0, 'Test Trinket', 'battlefield', 'p1');
    let s = cast(s0, 'Test Servant');
    for (let i = 0; i < 6 && s.pending?.kind !== 'chooseTargets'; i++) s = pass(s);
    expect(s.pending?.kind).toBe('chooseTargets');
    const options = JSON.stringify(s.pending);
    expect(options).toContain(trinket);
    expect(options).not.toContain(golem);
  });
});

describe('CR 508.1h, 509.1d, 122.1: "~ can\'t attack or block unless you pay {1} for each +1/+1 counter on it." (the tax of ~ itself, counted as the attack or block is declared)', () => {
  const PROTO = card('Test Prototype', 'Artifact Creature — Myr', 'At the beginning of your upkeep, put a +1/+1 counter on this creature.\nThis creature can\'t attack or block unless you pay {1} for each +1/+1 counter on it.', ['1', '1']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const board = (counters: number): { s: GameState; proto: ObjectId; bear: ObjectId } => {
    const s0 = scenario([], { defs: [PROTO, BEAR], p1: { battlefield: [{ name: 'Test Prototype', counters: { '+1/+1': counters } } as never, 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    return { s: s0, proto: find(s0, 'Test Prototype', 'battlefield', 'p1'), bear: find(s0, 'Test Bear', 'battlefield', 'p1') };
  };
  it('is full', () => expect(full(PROTO)).toBe(true));
  it('with three +1/+1 counters attacking costs {3} and blocking costs {3}', () => {
    const { s, proto } = board(3);
    expect(attackTaxes(s, [{ attacker: proto, defender: 'p2' }]).map((x) => x.cost)).toEqual([{ mana: [{ kind: 'generic', amount: 3 }] }]);
    expect(blockTaxes(s, [{ blocker: proto, attacker: proto }]).map((x) => x.cost)).toEqual([{ mana: [{ kind: 'generic', amount: 3 }] }]);
  });
  it('with no counters both cost nothing', () => {
    const { s, proto } = board(0);
    expect(attackTaxes(s, [{ attacker: proto, defender: 'p2' }]).map((x) => x.cost)).toEqual([{ mana: [{ kind: 'generic', amount: 0 }] }]);
  });
  it('negative: another creature (yours or an opponent\'s) attacks and blocks free', () => {
    const { s, bear } = board(3);
    expect(attackTaxes(s, [{ attacker: bear, defender: 'p2' }])).toEqual([]);
    const other = find(s, 'Test Bear', 'battlefield', 'p2');
    expect(blockTaxes(s, [{ blocker: other, attacker: bear }])).toEqual([]);
  });
});

describe('CR 302.6, 602.5b, 400.7: "Activate only if you\'ve controlled ~ continuously since the beginning of your most recent turn." (an artifact that entered this turn or after your last turn began cannot be activated yet)', () => {
  const LAUNCHER = card('Test Launcher', 'Artifact', '{0}: This artifact deals 1 damage to any target. Activate only if you\'ve controlled this artifact continuously since the beginning of your most recent turn.');
  const can = (s: GameState, player = 'p1'): boolean => legal(s, player, 'activate').some((a) => JSON.stringify(a).includes('Test Launcher') || a.kind === 'activate');
  const abilityCount = (s: GameState, player = 'p1'): number => legal(s, player, 'activate').length;
  it('is full', () => expect(full(LAUNCHER)).toBe(true));
  it('on your turn: an artifact you have controlled since an earlier turn can be activated; one that came under your control this turn cannot', () => {
    const old = scenario([], { defs: [LAUNCHER], p1: { battlefield: [{ name: 'Test Launcher', since: 0 }] } });
    expect(abilityCount(old)).toBe(1);
    const fresh = scenario([], { defs: [LAUNCHER], p1: { battlefield: [{ name: 'Test Launcher', since: old.turn.number }] } });
    expect(abilityCount(fresh)).toBe(0);
    expect(can(fresh)).toBe(false);
  });
  it('on an opponent\'s turn: it counts from the beginning of YOUR most recent turn (it entered on your turn: not yet; it entered before: yes)', () => {
    const mk = (since: number): GameState => {
      const s0 = scenario([], { defs: [LAUNCHER], p1: { battlefield: [{ name: 'Test Launcher', since }] } });
      return pass(advanceTo(s0, s0.turn.number + 1, 'main1')); // the opponent passes priority, so you have it on their turn
    };
    const base = scenario([], { defs: [LAUNCHER] });
    const s = mk(0);
    expect(s.turn.activePlayer).toBe('p2');
    expect(s.pending?.player).toBe('p1');
    expect(abilityCount(s)).toBe(1);
    const entered = mk(base.turn.number);
    expect(entered.turn.activePlayer).toBe('p2');
    expect(abilityCount(entered)).toBe(0);
  });
  it('a skipped upkeep changes nothing: "your most recent turn" is the turn you began last, not your last upkeep (the list of upkeeps is empty here)', () => {
    const s0 = scenario([], { defs: [LAUNCHER], p1: { battlefield: [{ name: 'Test Launcher', since: 0 }] } });
    const mk = (since: number): GameState => {
      const base = scenario([], { defs: [LAUNCHER], p1: { battlefield: [{ name: 'Test Launcher', since }] } });
      return tweak(pass(advanceTo(base, base.turn.number + 1, 'main1')), (t) => { t.players.find((p) => p.id === 'p1')!.upkeepTurns = []; });
    };
    expect(s0.turn.number).toBe(1);
    expect(abilityCount(mk(0))).toBe(1);
    expect(abilityCount(mk(1))).toBe(0);
  });
  it('negative: an opponent\'s artifact is never activated by you, and a copy of the card controlled by the opponent is theirs to activate only after their turn began', () => {
    const s = scenario([], { defs: [LAUNCHER], p2: { battlefield: [{ name: 'Test Launcher', since: 0 }] } });
    expect(abilityCount(s, 'p1')).toBe(0);
  });
});

describe('CR 109.4, 608.2d, 702.16a: "Target creature gains protection from the color of its controller\'s choice until end of turn." (the controller of the target chooses, not the player who activated)', () => {
  const MONGER = card('Test Monger', 'Artifact', '{0}: Target creature gains protection from the color of its controller\'s choice until end of turn. Any player may activate this ability.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const toChoice = (s0: GameState): GameState => {
    let s = s0;
    for (let i = 0; i < 8 && s.pending?.kind !== 'chooseColor'; i++) s = pass(s);
    return s;
  };
  it('is full', () => expect(full(MONGER)).toBe(true));
  it('p1 activates it on p2\'s creature: the color is chosen by p2, and only that color is protected from (red: a red source cannot damage it)', () => {
    const s0 = scenario([], { defs: [MONGER, BEAR], p1: { battlefield: ['Test Monger'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    let s = toChoice(activate(s0, find(s0, 'Test Monger', 'battlefield'), [target(bear)]));
    expect(s.pending?.kind).toBe('chooseColor');
    expect(s.pending?.player).toBe('p2');
    s = resolveAll(answer(s, { kind: 'chooseColor', color: 'R' }));
    const keywords = JSON.stringify(getChars(s, bear)!.keywords);
    expect(keywords).toContain('color:R');
    expect(keywords).not.toContain('color:G');
  });
  it('negative: a creature that was not targeted gains nothing, and p1 (the activator) is never asked for the color', () => {
    const s0 = scenario([], { defs: [MONGER, BEAR], p1: { battlefield: ['Test Monger', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    const mine = find(s0, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s0, 'Test Bear', 'battlefield', 'p2');
    let s = toChoice(activate(s0, find(s0, 'Test Monger', 'battlefield'), [target(theirs)]));
    expect(s.pending?.player).not.toBe('p1');
    s = resolveAll(answer(s, { kind: 'chooseColor', color: 'U' }));
    expect(JSON.stringify(getChars(s, theirs)!.keywords)).toContain('color:U');
    expect(JSON.stringify(getChars(s, mine)!.keywords)).not.toContain('protection');
  });
});

describe('CR 400.3, 608.2c, 506.5: "Whenever ~ attacks alone, return ~ to ~\'s owner\'s hand. If you do, each opponent loses 2 life and you gain 2 life."', () => {
  const HERO = card('Test Coward', 'Legendary Creature — Human', 'Whenever ~ attacks alone, return ~ to ~\'s owner\'s hand. If you do, each opponent loses 2 life and you gain 2 life.', ['2', '2']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const attack = (ids: ObjectId[], s0: GameState): GameState => {
    let s = toDeclareAttackers(s0);
    s = declareAttackers(s, ids.map((id) => [id] as [ObjectId]));
    return resolveAll(s);
  };
  it('is full', () => expect(full(HERO)).toBe(true));
  it('attacking alone: it returns to its owner\'s hand, each opponent loses 2 life and you gain 2', () => {
    const s0 = scenario([], { defs: [HERO, BEAR], p1: { battlefield: ['Test Coward', 'Test Bear'] } });
    const s = attack([find(s0, 'Test Coward', 'battlefield', 'p1')], s0);
    expect(onBf(s, 'Test Coward')).toEqual([]);
    expect(s.zones.hand.p1!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Coward')).toBe(true);
    expect(life(s, 'p2')).toBe(18);
    expect(life(s, 'p1')).toBe(22);
  });
  it('negative: attacking with another creature too does not trigger it (no bounce, no life change)', () => {
    const s0 = scenario([], { defs: [HERO, BEAR], p1: { battlefield: ['Test Coward', 'Test Bear'] } });
    const s = attack([find(s0, 'Test Coward', 'battlefield', 'p1'), find(s0, 'Test Bear', 'battlefield', 'p1')], s0);
    expect(onBf(s, 'Test Coward', 'p1')).toHaveLength(1);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 702.3b, 609.4, 611.2a: "~ gets +2/+0 and gains trample until end of turn. It can attack this turn as though it didn\'t have defender."', () => {
  const KEEP = card('Test Keep', 'Artifact Creature — Wall', 'Defender\n{0}: ~ gets +2/+0 and gains trample until end of turn. It can attack this turn as though it didn\'t have defender.', ['0', '6']);
  it('is full', () => expect(full(KEEP)).toBe(true));
  it('it cannot attack until the ability resolves; then it is a 2/6 trampler that can attack this turn, and no other creature gained anything', () => {
    const s0 = scenario([], { defs: [KEEP], p1: { battlefield: ['Test Keep'] } });
    const keep = find(s0, 'Test Keep', 'battlefield', 'p1');
    expect(() => toDeclareAttackers(s0)).toThrow(/declare attackers/); // a defender has nothing to declare: the decision never comes
    let s = activate(s0, keep);
    s = resolveStack(s);
    expect(pt(s, keep)).toBe('2/6');
    expect(hasKeyword(getChars(s, keep)!, 'trample')).toBe(true);
    const at = toDeclareAttackers(s);
    expect(JSON.stringify(at.pending)).toContain(keep);
  });
});

describe('CR 701.24a, 701.21a: "{0}, Sacrifice this creature: Target player shuffles their library."', () => {
  const FORAGER = card('Test Forager', 'Creature — Goblin', '{0}, Sacrifice this creature: Target player shuffles their library.', ['1', '1']);
  it('is full', () => expect(full(FORAGER)).toBe(true));
  it('sacrificing it shuffles the target player\'s library (the order changes for a long library) and not the other player\'s', () => {
    const lib = Array.from({ length: 12 }, () => 'Plains');
    const s0 = scenario(lib, { defs: [FORAGER], p1: { battlefield: ['Test Forager'] } });
    const order = (s: GameState, p: string): string => (s.zones.library[p] ?? []).join(',');
    const p1Before = order(s0, 'p1');
    const p2Before = order(s0, 'p2');
    let s = activate(s0, find(s0, 'Test Forager', 'battlefield'), [target('p2')]);
    s = resolveStack(s);
    expect(onBf(s, 'Test Forager')).toEqual([]);
    expect(order(s, 'p1')).toBe(p1Before);
    expect(order(s, 'p2')).not.toBe(p2Before);
    expect((s.zones.library.p2 ?? []).length).toBe(p2Before.split(',').length);
  });
});

describe('CR 702.193a, 106.6, 605.1a: "{T}: Add {R}{R}. Spend this mana only to activate power-up abilities."', () => {
  const TECH = card('Test Technician', 'Creature — Human', '{T}: Add {R}.\n{T}: Add {R}{R}. Spend this mana only to activate power-up abilities.', ['1', '1']);
  const BRUTE = card('Test Brute', 'Creature — Giant', 'Power-up — {1}{R}: Put a +1/+1 counter on this creature.', ['2', '2']);
  const PING = card('Test Ping', 'Artifact', '{1}{R}: You gain 1 life.');
  const board = (): GameState => scenario([], { defs: [TECH, BRUTE, PING], p1: { battlefield: ['Test Technician', 'Test Brute', 'Test Ping'] } });
  const ability = (s: GameState, name: string): number => legal(s, 'p1', 'activate').filter((a) => JSON.stringify(a).includes(find(s, name, 'battlefield', 'p1'))).length;
  it('is full', () => expect(full(TECH)).toBe(true));
  it('the restricted {R}{R} pays a power-up ability (a counter lands on the creature) and the plain {1}{R} ability is not offered for that mana', () => {
    const s0 = board();
    const tech = find(s0, 'Test Technician', 'battlefield', 'p1');
    const brute = find(s0, 'Test Brute', 'battlefield', 'p1');
    expect(ability(s0, 'Test Brute')).toBe(0);
    const s1 = drive(act(s0, { type: 'activate', player: 'p1', source: tech, ability: 'p:0:1' }));
    expect(ability(s1, 'Test Brute')).toBe(1); // {R}{R} covers {1}{R}
    expect(ability(s1, 'Test Ping')).toBe(0); // but not an ability that is not a power-up ability
    const s2 = resolveStack(activate(s1, brute));
    expect(s2.objects[brute]!.counters['+1/+1']).toBe(1);
  });
  it('negative: the unrestricted {R} from the same creature pays the plain ability only together with other mana, the restricted mana never does', () => {
    const s0 = board();
    const tech = find(s0, 'Test Technician', 'battlefield', 'p1');
    const s1 = drive(act(s0, { type: 'activate', player: 'p1', source: tech, ability: 'p:0:0' }));
    expect(ability(s1, 'Test Ping')).toBe(0); // one {R} is not {1}{R}
  });
});
