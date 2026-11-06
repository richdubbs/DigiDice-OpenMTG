/**
 * edh-players-23 (Commander lane edh-players): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. CR cites were checked against the Comprehensive Rules text of
 * 2026-09-25 (media.wizards.com).
 *
 *   CR 605.1a, 605.3b, 119.3         "{T}: Add one mana of any color. Each player loses 1 life.": a mana ability that does more than add mana
 *   CR 119.1, 603.4, 603.8           "At the beginning of your upkeep, if each player has 10 or less life, ...": an intervening "if" over every player
 *   CR 701.21a, 608.2d, 120.3, 109.4 "Choose up to one target nonland permanent. Its controller may sacrifice it. If they don't, ~ deals 4 damage to that player."
 *   CR 120.3, 118.12, 609.7          "Whenever a source an opponent controls deals damage to you or a creature you control, that source's controller loses 3 life unless they pay {2}."
 *   CR 701.53a, 111.10i, 701.27a     "Incubate 1 three times, then transform all Incubator tokens you control."
 *   CR 701.21a, 603.12, 608.2c       "You may sacrifice one or more Treasures. When you do, up to that many target creatures gain double strike until end of turn."
 *   CR 305.2, 614.1c, 611.2a, 107.3  "Sacrifice X lands. For each land sacrificed this way, draw a card. You may play X additional lands this turn. Lands you control enter tapped this turn."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, lifeOf, mpScenario, pass, passUntil } from '../../m12/rules/helpers';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';

const card = (name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef =>
  compileCard({ name, layout: 'normal', type_line: type, mana_cost: cost, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as unknown as OracleCard);

const FRAGMENT = card('Test Murk Stone', 'Artifact', '{T}: Add one mana of any color. Each player loses 1 life.');
const PAIN = card('Test Pain Stone', 'Artifact', '{T}: Add {B}{B}. You lose 2 life.');
const WATCHER = card('Test Pale Watcher', 'Creature — Wizard', 'At the beginning of your upkeep, if each player has 10 or less life, draw a card.', ['1', '1']);
const STAR = card('Test Star Runner', 'Creature — Human Athlete', "Whenever ~ attacks, choose up to one target nonland permanent. Its controller may sacrifice it. If they don't, ~ deals 4 damage to that player.", ['2', '2']);
const PRAETOR = card('Test Cold Praetor', 'Legendary Creature — Phyrexian Praetor', "Whenever a source an opponent controls deals damage to you or a creature you control, that source's controller loses 3 life unless they pay {2}.", ['4', '7']);
const ZAP = card('Test Zap', 'Instant', '~ deals 1 damage to any target.');
const ETCHINGS = card('Test Etchings', 'Enchantment — Saga', 'I — Incubate 1 three times, then transform all Incubator tokens you control.\nII — You gain 1 life.');
const BOSS = card('Test Raider Boss', 'Creature — Human Pirate', 'Whenever you attack, you may sacrifice one or more Treasures. When you do, up to that many target creatures gain double strike until end of turn.', ['2', '2']);
const GOLD = card('Test Gold', 'Artifact — Treasure', '{T}, Sacrifice this artifact: Add one mana of any color.');
const OVERTURN = card('Test Overturn', 'Sorcery', 'Sacrifice X lands. For each land sacrificed this way, draw a card. You may play X additional lands this turn. Lands you control enter tapped this turn.', undefined, '{X}');
const TRINKET = card('Test Trinket', 'Artifact', '');
const MARSH = card('Test Marsh', 'Land', '');
const CUB = card('Test Cub', 'Creature — Bear', '', ['1', '1']);
const DEFS = [FRAGMENT, PAIN, WATCHER, STAR, PRAETOR, ZAP, ETCHINGS, BOSS, GOLD, OVERTURN, TRINKET, MARSH, CUB];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(d.automation.level, `${d.name}: ${JSON.stringify(d.automation)}`).toBe('full');
  });
});

const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const onBattlefield = (s: GameState, name: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => nameOf(s, id) === name && (p === undefined || s.objects[id]!.controller === p));
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const pool = (s: GameState, p: PlayerId): string => s.players.find((x) => x.id === p)!.manaPool.map((u) => u.type).sort().join('');

interface Script {
  /** The targets chosen for each `chooseTargets`, in order (object ids; a string is a player). */
  targets?: (ObjectId | PlayerId)[][];
  /** The answers to each yes/no question, in order (default: no). */
  yes?: boolean[];
  /** The ids chosen for each `chooseObjects`, as a function of the question (default: the first `min`). */
  pick?: (s: GameState, p: { player: PlayerId; options: ObjectId[]; min?: number; max?: number }) => ObjectId[];
  /** The numbers chosen for each `chooseNumber`, in order. */
  numbers?: number[];
}
/** Answer decisions and pass priority until nothing is on the stack and the game waits for priority again. */
function run(s0: GameState, script: Script = {}, seen: string[] = []): GameState {
  let s = s0;
  const targets = [...(script.targets ?? [])];
  const yes = [...(script.yes ?? [])];
  const numbers = [...(script.numbers ?? [])];
  for (let i = 0; i < 300; i++) {
    const p = s.pending;
    if (!p) break;
    seen.push(p.kind);
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (targets.shift() ?? []).map((id) => (s.players.some((x) => x.id === id) ? { kind: 'player' as const, id: id as PlayerId } : { kind: 'object' as const, id })) as never });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: yes.shift() ?? false });
    else if (p.kind === 'chooseObjects') {
      const q = p as unknown as { player: PlayerId; options: ObjectId[]; min?: number; max?: number };
      s = answer(s, { kind: 'chooseObjects', ids: script.pick ? script.pick(s, q) : q.options.slice(0, q.min ?? 1) });
    } else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: numbers.shift() ?? 0 });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else if (p.kind === 'priority' && s.zones.stack.length > 0) s = pass(s);
    else break;
  }
  return s;
}
function attack(s0: GameState, attacks: { attacker: ObjectId; defender: PlayerId }[], script: Script = {}, seen: string[] = []): GameState {
  let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === x.turn.activePlayer, 'the attack');
  s = answer(s, { kind: 'declareAttackers', attacks });
  return run(s, script, seen);
}
function tapMana(s0: GameState, name: string, p: PlayerId = 'p1'): GameState {
  const source = find(s0, name, 'battlefield', p);
  const a = legalActions(s0, p).find((l) => l.kind === 'activate' && l.isMana === true && l.object === source);
  if (!a) throw new Error(`no mana ability of ${name}`);
  let s = act(s0, a.action);
  for (let guard = 0; guard < 5 && s.pending && s.pending.kind === 'chooseColor'; guard++) s = answer(s, { kind: 'chooseColor', color: 'G' });
  return s;
}

// ---- Cryptolith Fragment: a mana ability that makes every player lose life; "if each player has 10 or less life" -----------------------------------------------------------------

describe('CR 605.1a, 605.3b, 119.3: "{T}: Add one mana of any color. Each player loses 1 life."', () => {
  const setup = (): GameState => mpScenario({ defs: DEFS, zones: { p1: { battlefield: ['Test Murk Stone', 'Test Pain Stone'] } } });
  it('the mana is added at once, without the stack, and every player loses 1 life (you too)', () => {
    const s = tapMana(setup(), 'Test Murk Stone');
    expect(pool(s, 'p1')).toBe('G');
    expect(s.zones.stack.length).toBe(0);
    expect([1, 2, 3, 4].map((n) => lifeOf(s, `p${n}` as PlayerId))).toEqual([19, 19, 19, 19]);
  });
  it('the tapped stone does not do it twice', () => {
    const s = tapMana(setup(), 'Test Murk Stone');
    expect(legalActions(s, 'p1').some((l) => l.kind === 'activate' && l.isMana === true && l.object === find(s, 'Test Murk Stone', 'battlefield', 'p1'))).toBe(false);
  });
  it('"You lose 2 life" costs only you', () => {
    const s = tapMana(setup(), 'Test Pain Stone');
    expect(pool(s, 'p1')).toBe('BB');
    expect([1, 2, 3, 4].map((n) => lifeOf(s, `p${n}` as PlayerId))).toEqual([18, 20, 20, 20]);
  });
});

describe('CR 119.1, 603.4: "At the beginning of your upkeep, if each player has 10 or less life, draw a card."', () => {
  const toUpkeep = (life: Partial<Record<PlayerId, number>>): { s0: GameState; s: GameState } => {
    const s0 = mpScenario({ defs: DEFS, life: 10, zones: { p1: { battlefield: ['Test Pale Watcher'] } }, setup: (g) => { for (const [p, n] of Object.entries(life)) g.players.find((x) => x.id === p)!.life = n!; } });
    const s = passUntil(s0, (x) => x.turn.number === 5 && x.turn.step === 'upkeep' && x.zones.stack.length > 0, 'the next upkeep trigger');
    return { s0, s };
  };
  it('every player at 10 or less: the trigger is on the stack and draws', () => {
    const { s } = toUpkeep({});
    const h = hand(s, 'p1');
    expect(hand(run(s), 'p1')).toBe(h + 1);
  });
  it('one player at 11: the intervening "if" is false, the ability never triggers', () => {
    const s0 = mpScenario({ defs: DEFS, life: 10, zones: { p1: { battlefield: ['Test Pale Watcher'] } }, setup: (g) => { g.players.find((x) => x.id === 'p3')!.life = 11; } });
    const s = passUntil(s0, (x) => x.turn.number === 5 && x.turn.step === 'draw', 'the next draw step');
    expect(s.zones.stack.length).toBe(0);
  });
});

// ---- Star Athlete: the controller of a chosen permanent may sacrifice it, else takes the damage ---------------------------------------------------------------------------------

describe('CR 701.21a, 608.2d, 120.3: "Choose up to one target nonland permanent. Its controller may sacrifice it. If they don\'t, ~ deals 4 damage to that player."', () => {
  const setup = (): GameState => mpScenario({
    defs: DEFS,
    zones: { p1: { battlefield: ['Test Star Runner'] }, p3: { battlefield: ['Test Trinket', 'Test Marsh', 'Test Cub'] } },
  });
  const go = (script: Script, seen: string[] = []): { s: GameState; s0: GameState } => {
    const s0 = setup();
    return { s0, s: attack(s0, [{ attacker: onBattlefield(s0, 'Test Star Runner')[0]!, defender: 'p2' }], script, seen) };
  };
  it('the controller declines: they, not the defending player, take 4 damage and keep the permanent', () => {
    const s0 = setup();
    const { s } = go({ targets: [[onBattlefield(s0, 'Test Trinket')[0]!]], yes: [false] });
    expect(lifeOf(s, 'p3')).toBe(16);
    expect(onBattlefield(s, 'Test Trinket', 'p3').length).toBe(1);
    expect(lifeOf(s, 'p4')).toBe(20);
    expect(lifeOf(s, 'p2')).toBeGreaterThanOrEqual(18); // the defending player takes at most the attacker's own combat damage, never the trigger's 4
  });
  it('the controller sacrifices it: the permanent is gone and nobody takes the trigger\'s damage', () => {
    const s0 = setup();
    const { s } = go({ targets: [[onBattlefield(s0, 'Test Trinket')[0]!]], yes: [true] });
    expect(onBattlefield(s, 'Test Trinket').length).toBe(0);
    expect(lifeOf(s, 'p3')).toBe(20);
  });
  it('a creature of the controller works the same way, and the damage is dealt by the creature source to that controller only', () => {
    const s0 = setup();
    const { s } = go({ targets: [[onBattlefield(s0, 'Test Cub')[0]!]], yes: [false] });
    expect(lifeOf(s, 'p3')).toBe(16);
    expect(onBattlefield(s, 'Test Cub', 'p3').length).toBe(1);
  });
  it('no target chosen ("up to one"): nothing is sacrificed and nobody is asked or damaged', () => {
    const seen: string[] = [];
    const { s } = go({ targets: [[]], yes: [true] }, seen);
    expect(lifeOf(s, 'p3')).toBe(20);
    expect(onBattlefield(s, 'Test Trinket').length).toBe(1);
    expect(seen).not.toContain('yesNo');
  });
  it('a land is not a legal target (nonland permanent)', () => {
    const s0 = setup();
    const seen: string[] = [];
    const s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers', 'the attack');
    const t = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: onBattlefield(s0, 'Test Star Runner')[0]!, defender: 'p2' as PlayerId }] });
    const pending = (t.pending?.kind === 'chooseTargets' ? t : run(t, {}, seen)).pending as unknown as { kind: string; specs?: { options?: { id: string }[] }[] } | undefined;
    const options = JSON.stringify(pending ?? {});
    expect(options).not.toContain(onBattlefield(s0, 'Test Marsh')[0]!);
  });
});

// ---- Elesh Norn: damage by an opponent's source to you or a creature of yours; its controller loses life unless they pay -------------------------------------------------------------

describe('CR 120.3, 118.12, 603.2: "Whenever a source an opponent controls deals damage to you or a creature you control, that source\'s controller loses 3 life unless they pay {2}."', () => {
  const setup = (): GameState => mpScenario({
    defs: DEFS,
    options: { startingPlayer: 'p2' },
    zones: { p1: { battlefield: ['Test Cold Praetor', 'Test Cub'] }, p2: { hand: ['Test Zap'], battlefield: ['Plains', 'Plains'] }, p3: { hand: ['Test Zap'] } },
  });
  const zap = (s0: GameState, who: PlayerId, target: PlayerId | ObjectId, script: Script): GameState => {
    const c = act(s0, { type: 'cast', player: who, card: find(s0, 'Test Zap', 'hand', who) });
    return run(c, { ...script, targets: [[target], ...(script.targets ?? [])] });
  };
  it('damage to you: the controller of the spell loses 3 life when they do not pay', () => {
    const s0 = setup();
    const s = zap(s0, 'p2', 'p1', { yes: [false] });
    expect(lifeOf(s, 'p1')).toBe(19);
    expect(lifeOf(s, 'p2')).toBe(17);
  });
  it('damage to a creature you control: the same, and paying {2} avoids the loss', () => {
    const s0 = setup();
    const cub = onBattlefield(s0, 'Test Cub', 'p1')[0]!;
    const noPay = zap(s0, 'p2', cub, { yes: [false] });
    expect(lifeOf(noPay, 'p2')).toBe(17);
    const paid = zap(s0, 'p2', cub, { yes: [true] });
    expect(lifeOf(paid, 'p2')).toBe(20);
    expect(s0.zones.battlefield.filter((id) => nameOf(s0, id) === 'Plains' && s0.objects[id]!.tapped).length).toBe(0);
    expect(paid.zones.battlefield.filter((id) => nameOf(paid, id) === 'Plains' && paid.objects[id]!.tapped).length).toBe(2);
  });
  it('negative: damage to a creature an opponent controls, or by a source you control, never triggers it', () => {
    const s0 = setup();
    const own = zap(s0, 'p2', 'p3', { yes: [false] });
    expect(lifeOf(own, 'p2')).toBe(20); // p2 hurt p3: the Praetor's controller (p1) was not dealt damage
    const s1 = mpScenario({ defs: DEFS, zones: { p1: { hand: ['Test Zap'], battlefield: ['Test Cold Praetor'] } } });
    const mine = zap(s1, 'p1', 'p1', { yes: [false] });
    expect(lifeOf(mine, 'p1')).toBe(19); // only the damage itself: a source you control does not trigger it
  });
});

// ---- The Argent Etchings: Incubate N times, then transform all Incubator tokens -----------------------------------------------------------------------------------------------------

describe('CR 701.53a, 111.10i, 701.27a: "Incubate 1 three times, then transform all Incubator tokens you control."', () => {
  it('three Incubator tokens are made, each with a +1/+1 counter, and all of them transform', () => {
    const s0 = mpScenario({ defs: DEFS, zones: { p1: { hand: ['Test Etchings'] } } });
    const s = run(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Etchings', 'hand', 'p1') }));
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens.length).toBe(3);
    for (const id of tokens) {
      expect(s.objects[id]!.counters['+1/+1']).toBe(1);
      expect(s.objects[id]!.face, 'the Phyrexian side').toBe(1);
      expect(getChars(s, id)!.types).toContain('Creature');
    }
  });
});

// ---- Swashbuckler Extraordinaire: sacrifice one or more Treasures, up to that many targets -----------------------------------------------------------------------------------------

describe('CR 701.21a, 603.12, 608.2c: "you may sacrifice one or more Treasures. When you do, up to that many target creatures gain double strike until end of turn."', () => {
  const setup = (): GameState => mpScenario({
    defs: DEFS,
    zones: { p1: { battlefield: ['Test Raider Boss', 'Test Cub', 'Test Cub', 'Test Gold', 'Test Gold', 'Test Gold'] } },
  });
  const swing = (s0: GameState, script: Script): GameState => attack(s0, [{ attacker: onBattlefield(s0, 'Test Cub')[0]!, defender: 'p2' }], script);
  const double = (s: GameState, id: ObjectId): boolean => hasKeyword(getChars(s, id)!, 'double strike');
  it('two Treasures sacrificed: up to two creatures (the Boss and a Cub) gain double strike', () => {
    const s0 = setup();
    const boss = onBattlefield(s0, 'Test Raider Boss')[0]!;
    const [cub1, cub2] = onBattlefield(s0, 'Test Cub') as [ObjectId, ObjectId];
    const s = swing(s0, {
      yes: [true],
      pick: (g, q) => q.options.filter((id) => nameOf(g, id) === 'Test Gold').slice(0, 2),
      targets: [[boss, cub1]],
    });
    expect(onBattlefield(s, 'Test Gold').length).toBe(1);
    expect(double(s, boss)).toBe(true);
    expect(double(s, cub1)).toBe(true);
    expect(double(s, cub2)).toBe(false);
  });
  it('negative: you decline, nothing is sacrificed and no creature gains it', () => {
    const s0 = setup();
    const s = swing(s0, { yes: [false] });
    expect(onBattlefield(s, 'Test Gold').length).toBe(3);
    for (const id of onBattlefield(s, 'Test Cub')) expect(double(s, id)).toBe(false);
  });
  it('negative: one Treasure sacrificed allows only one target', () => {
    const s0 = setup();
    const [cub1, cub2] = onBattlefield(s0, 'Test Cub') as [ObjectId, ObjectId];
    const s = swing(s0, { yes: [true], pick: (g, q) => q.options.filter((id) => nameOf(g, id) === 'Test Gold').slice(0, 1), targets: [[cub1]] });
    expect(onBattlefield(s, 'Test Gold').length).toBe(2);
    expect(double(s, cub1)).toBe(true);
    expect(double(s, cub2)).toBe(false);
    expect(() => swing(setup(), { yes: [true], pick: (g, q) => q.options.filter((id) => nameOf(g, id) === 'Test Gold').slice(0, 1), targets: [[cub1, cub2]] })).toThrow(/between 0 and 1/); // a second target is refused
  });
});

// ---- Nahiri's Lithoforming: sacrifice X lands, draw for each, play X additional lands, lands enter tapped this turn ---------------------------------------------------------------------

describe('CR 305.2, 614.1c, 611.2a: "Sacrifice X lands. For each land sacrificed this way, draw a card. You may play X additional lands this turn. Lands you control enter tapped this turn."', () => {
  const setup = (): GameState => mpScenario({
    defs: DEFS,
    zones: { p1: { hand: ['Test Overturn', 'Test Marsh', 'Test Marsh', 'Test Marsh'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains'] } },
  });
  const play = (s0: GameState): GameState => {
    const c = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Overturn', 'hand', 'p1') });
    return run(c, { numbers: [2], pick: (g, q) => q.options.slice(0, 2) });
  };
  it('X = 2: two lands are sacrificed, two cards are drawn, and the lands played afterwards (one normal play, two extra) enter tapped', () => {
    const s0 = setup();
    const h = hand(s0, 'p1');
    let s = play(s0);
    expect(onBattlefield(s, 'Plains', 'p1').length).toBe(2); // four lands, two sacrificed (the other two paid X)
    expect(hand(s, 'p1')).toBe(h - 1 + 2); // the spell left the hand, two cards were drawn
    const marsh = (): ObjectId => s.zones.hand['p1']!.find((id) => nameOf(s, id) === 'Test Marsh')!;
    for (let i = 0; i < 3; i++) {
      s = act(s, { type: 'playLand', player: 'p1', card: marsh() });
    }
    const marshes = onBattlefield(s, 'Test Marsh', 'p1');
    expect(marshes.length).toBe(3);
    for (const id of marshes) expect(s.objects[id]!.tapped).toBe(true);
  });
  it('negative: the lands of other players are not affected, and the effect ends with the turn', () => {
    const s0 = mpScenario({
      defs: DEFS,
      zones: { p1: { hand: ['Test Overturn', 'Test Marsh'], battlefield: ['Plains', 'Plains', 'Plains'] }, p2: { hand: ['Test Marsh'] } },
    });
    const c = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Overturn', 'hand', 'p1') });
    const s = run(c, { numbers: [1], pick: (g, q) => q.options.slice(0, 1) });
    const next = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.zones.stack.length === 0, "the next player's main phase");
    const after = act(next, { type: 'playLand', player: 'p2', card: next.zones.hand['p2']!.find((id) => nameOf(next, id) === 'Test Marsh')! });
    expect(onBattlefield(after, 'Test Marsh', 'p2').every((id) => !after.objects[id]!.tapped)).toBe(true);
  });
});
