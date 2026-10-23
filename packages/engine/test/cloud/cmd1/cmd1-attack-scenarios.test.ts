/**
 * Commander batch, slice cmd1: the Backgrounds' granted attack triggers "Whenever this creature attacks a player, if no opponent has more life than that player, ..."
 * (CR 603.4 intervening "if", 119.1 life totals, 506.2 the defending player) and the other shapes of zz-cloud/cmd1.json that play in combat, in two-player Commander
 * games (CR 903.2) and a three-player Free-for-All game (CR 806), with synthetic cards compiled by the default compiler (invented names, design 6.10).
 *
 *   CR 603.4, 119.1      the condition is checked as the ability triggers: with an opponent at more life than the attacked player, it does not trigger
 *   CR 508.4, 608.2f     "for each opponent, create a 1/1 ... token that's tapped and attacking that opponent"
 *   CR 701.15a           "Goad that creature." after "~ deals 1 damage to target creature."
 *   CR 701.16a           "investigate once for each nontoken attacking creature"
 */
import { describe, expect, it } from 'vitest';
import { applyAction, type CardDef, type GameState, type ObjectId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answerUntilPriority, card, commanderOnBattlefield, commanderScenario, find, legend, pass } from '../../m11/rules/helpers';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';
import { legal } from '../../m3/scenario';
import { mpScenario, passUntil as mpPassUntil, resolveStack } from '../../m12/rules/helpers';

const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const tokens = (s: GameState, p: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p);

/** Answer what is asked (payment automatic; yes to "may"; the first legal target or object) until priority. */
function drive(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 40 && s.pending && s.pending.kind !== 'priority'; i++) {
    const d = s.pending;
    if (d.kind === 'payCost') s = answerUntilPriority(s, []);
    else if (d.kind === 'yesNo') s = answerUntilPriority(s, [{ kind: 'yesNo', yes: true }]);
    else if (d.kind === 'chooseTargets') s = answerUntilPriority(s, [{ kind: 'chooseTargets', targets: d.objects.length > 0 ? [{ kind: 'object', id: d.objects[0]! }] : [{ kind: 'player', id: d.players[d.players.length - 1]! }] }]);
    else if (d.kind === 'chooseObjects') s = answerUntilPriority(s, [{ kind: 'chooseObjects', ids: d.options.slice(0, Math.max(d.min, 1)) }]);
    else if (d.kind === 'chooseOption') s = answerUntilPriority(s, [{ kind: 'chooseOption', ids: d.options.slice(0, Math.max(d.min, 1)).map((o) => o.id) }]);
    else if (d.kind === 'order') s = answerUntilPriority(s, [{ kind: 'order', ids: d.items.map((x) => x.id) }]);
    else throw new Error(`unexpected decision ${d.kind}`);
  }
  return s;
}
const resolveAll = (s0: GameState): GameState => {
  let s = drive(s0);
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)));
  return s;
};

const CHOOSER = legend('Test Bold Chooser', '{0}', ['3', '3'], ['W'], 'Choose a Background (You can have a Background as a second commander.)');
const BOB = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);
const lead = 'Commander creatures you own have "Whenever this creature attacks a player, if no opponent has more life than that player, ';
const SAILOR = card('Test Tidewalker Upbringing', '{0}', 'Legendary Enchantment — Background', `${lead}this creature can't be blocked this turn."`);
const ARTISAN = card('Test Coin Upbringing', '{0}', 'Legendary Enchantment — Background', `${lead}you create two Treasure tokens."`);
const AGENT = card('Test Knife Upbringing', '{0}', 'Legendary Enchantment — Background', `${lead}put a +1/+1 counter on this creature. It gains deathtouch and indestructible until end of turn."`);
const OUTLANDER = card('Test Trail Upbringing', '{0}', 'Legendary Enchantment — Background', `${lead}another target creature you control gets +X/+X until end of turn, where X is this creature's power."`);
const VETERAN = card('Test Drill Upbringing', '{0}', 'Legendary Enchantment — Background', `${lead}for each opponent, create a 1/1 white Soldier creature token that's tapped and attacking that opponent."`);

/** A two-player Commander game with the chooser (a commander, on the battlefield and able to attack) and the Background on the battlefield; then attack Bob. */
function attackWith(bg: CardDef, extra: { cards?: string[]; defs?: CardDef[]; battlefield?: (string | { name: string })[]; p2?: string[] } = {}): GameState {
  let s = commanderScenario({ p1Commanders: [CHOOSER, bg], p2Commanders: [BOB], cards: extra.cards, defs: extra.defs, p1: { battlefield: ['Test Bold Chooser', bg.name, ...(extra.battlefield ?? [])] }, p2: { battlefield: extra.p2 ?? [] } });
  s = commanderOnBattlefield(commanderOnBattlefield(s, 'Test Bold Chooser'), bg.name);
  s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Bold Chooser', 'battlefield'), 'p2']]);
  return resolveAll(s);
}

describe('CR 603.4, 119.1: "Whenever this creature attacks a player, if no opponent has more life than that player, ..." granted by a Background', () => {
  it.each([SAILOR, ARTISAN, AGENT, OUTLANDER, VETERAN].map((d) => [d.name, d] as const))('%s is understood (the intervening "if" is the granted trigger\'s)', (_n, d) => {
    expect(noManual(d)).toBe(true);
    expect(JSON.stringify(d.faces[0]!.abilities[0])).toContain('"interveningIf":{"cond":"compare","left":{"q":"countPlayers","of":{"ref":"each","who":"opponent"},"lifeVs":{"op":">","than":{"ref":"event","role":"defender"}}},"op":"==","right":0}');
  });
  it('CR 119.1: in a two-player game the attacked opponent is the only opponent, so the condition holds: two Treasure tokens', () => {
    const s = attackWith(ARTISAN);
    expect(tokens(s, 'p1').filter((id) => getChars(s, id)!.subtypes.includes('Treasure'))).toHaveLength(2);
  });
  it('CR 509.1b: "this creature can\'t be blocked this turn": Bob\'s creature cannot block it', () => {
    let s = attackWith(SAILOR, { cards: ['Grizzly Bears'], p2: ['Grizzly Bears'] });
    const cmd = find(s, 'Test Bold Chooser', 'battlefield');
    const life0 = s.players.find((p) => p.id === 'p2')!.life;
    // with no creature able to block it, the declaration may be skipped altogether (CR 509.1a); if it is asked, the block is refused
    for (let i = 0; i < 40 && s.turn.step !== 'main2'; i++) {
      if (s.pending?.kind === 'declareBlockers') {
        const r = applyAction(s, { type: 'answer', player: 'p2', decisionId: s.pending.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: find(s, 'Grizzly Bears', 'battlefield'), attacker: cmd }] } });
        expect(r.error).toBeDefined();
        s = answerUntilPriority(s, [{ kind: 'declareBlockers', blocks: [] }]);
      } else s = pass(s);
    }
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(life0 - 3);
  });
  it('CR 122.1, 613.1f: a +1/+1 counter, then deathtouch and indestructible until end of turn', () => {
    const s = attackWith(AGENT);
    const cmd = find(s, 'Test Bold Chooser', 'battlefield');
    expect(pt(s, cmd)).toBe('4/4');
    const kws = getChars(s, cmd)!.keywords.map((k) => k.keyword);
    expect(kws).toContain('deathtouch');
    expect(kws).toContain('indestructible');
  });
  it('CR 608.2h: another target creature you control gets +X/+X where X is the commander\'s power', () => {
    const s = attackWith(OUTLANDER, { cards: ['Grizzly Bears'], battlefield: ['Grizzly Bears'] });
    expect(pt(s, find(s, 'Grizzly Bears', 'battlefield'))).toBe('5/5');
  });
  it('CR 508.4, 608.2f: one Soldier token for each opponent, tapped and attacking that opponent', () => {
    const s = attackWith(VETERAN);
    const soldiers = tokens(s, 'p1');
    expect(soldiers).toHaveLength(1);
    expect(s.objects[soldiers[0]!]!.tapped).toBe(true);
    expect(s.combat?.attackers.find((a) => a.id === soldiers[0])?.defender).toBe('p2');
  });
});

describe('CR 506.2, 508.4: tokens "tapped and attacking target player" attack only an opponent (wave-4 review)', () => {
  const HERALD = legend('Test Banner Herald', '{0}', ['2', '2'], ['W'], "Whenever Test Banner Herald attacks, create a 1/1 white Soldier creature token that's tapped and attacking target player.", 'Legendary Creature — Human');
  const run = (target: string): { s: GameState; soldier: ObjectId } => {
    let s = commanderScenario({ p1Commanders: [HERALD], p2Commanders: [BOB], p1: { battlefield: ['Test Banner Herald'] } });
    s = commanderOnBattlefield(s, 'Test Banner Herald');
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Banner Herald', 'battlefield'), 'p2']]);
    if (s.pending?.kind === 'chooseTargets') s = answerUntilPriority(s, [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: target }] }]);
    s = resolveAll(s);
    return { s, soldier: tokens(s, 'p1')[0]! };
  };
  it('is understood', () => expect(noManual(HERALD)).toBe(true));
  it('CR 508.4: aimed at the opponent, the token attacks that opponent', () => {
    const { s, soldier } = run('p2');
    expect(s.combat?.attackers.find((a) => a.id === soldier)?.defender).toBe('p2');
  });
  it('CR 506.2: aimed at its own controller, the token enters tapped and is not attacking', () => {
    const { s, soldier } = run('p1');
    expect(soldier).toBeDefined();
    expect(s.objects[soldier]!.tapped).toBe(true);
    expect(s.combat?.attackers.some((a) => a.id === soldier)).toBe(false);
  });
});

describe('CR 603.4, 119.1, 806: the condition in a three-player game', () => {
  const RAIDER = card('Test Life Watcher', '{0}', 'Creature — Human Warrior', 'Whenever this creature attacks a player, if no opponent has more life than that player, draw a card.', ['2', '2']);
  const setup = (lives: Record<string, number>): GameState => mpScenario({
    players: 3, defs: [RAIDER], zones: { p1: { battlefield: ['Test Life Watcher'] } },
    setup: (s) => { for (const p of s.players) if (lives[p.id] !== undefined) p.life = lives[p.id]!; },
  });
  const attack = (s0: GameState, defender: string): GameState => {
    let s = mpPassUntil(s0, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    s = answerUntilPriority(s, [{ kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Life Watcher', 'battlefield'), defender }] }]);
    return resolveStack(s);
  };
  it('CR 603.4: attacking the player with the most life triggers it (a card is drawn)', () => {
    const s0 = setup({ p2: 30, p3: 20 });
    const h = s0.zones.hand['p1']!.length;
    expect(attack(s0, 'p2').zones.hand['p1']!.length).toBe(h + 1);
  });
  it('CR 603.4: attacking a player while another opponent has more life does not trigger it', () => {
    const s0 = setup({ p2: 30, p3: 20 });
    const h = s0.zones.hand['p1']!.length;
    expect(attack(s0, 'p3').zones.hand['p1']!.length).toBe(h);
  });
  it('CR 119.1: a tie for the most life is enough', () => {
    const s0 = setup({ p2: 25, p3: 25 });
    const h = s0.zones.hand['p1']!.length;
    expect(attack(s0, 'p3').zones.hand['p1']!.length).toBe(h + 1);
  });
});

describe('CR 701.15a: "~ deals 1 damage to target creature. Goad that creature." ("that creature" is the target, never ~, CR 201.5)', () => {
  const GOADER = legend('Test Goading Alchemist', '{0}', ['1', '3'], ['R'], '{T}, Sacrifice an artifact: Test Goading Alchemist deals 1 damage to target creature. Goad that creature.', 'Legendary Creature — Human');
  it('is understood and goads the damaged creature', () => {
    expect(noManual(GOADER)).toBe(true);
    let s = commanderScenario({ p1Commanders: [GOADER], p2Commanders: [BOB], cards: ['Ornithopter', 'Grizzly Bears'], p1: { battlefield: ['Test Goading Alchemist', 'Ornithopter'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const a = legal(s, 'p1', 'activate').find((x) => x.object === find(s, 'Test Goading Alchemist', 'battlefield'))!;
    s = act(s, a.action);
    s = answerUntilPriority(s, [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: bears }] }]);
    s = drive(s);
    s = resolveAll(s);
    expect(s.objects[bears]!.damage).toBe(1);
    expect(JSON.stringify(s.objects[bears])).toContain('goad');
  });
});

describe('CR 701.16a: "investigate once for each nontoken attacking creature"', () => {
  const SCOUT = legend('Test Clue Scout', '{0}', ['2', '2'], ['W'], 'Whenever Test Clue Scout attacks, investigate once for each nontoken attacking creature.', 'Legendary Creature — Human');
  it('two nontoken attackers: two Clues', () => {
    let s = commanderScenario({ p1Commanders: [SCOUT], p2Commanders: [BOB], cards: ['Grizzly Bears'], p1: { battlefield: ['Test Clue Scout', 'Grizzly Bears'] } });
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Clue Scout', 'battlefield'), 'p2'], [find(s, 'Grizzly Bears', 'battlefield'), 'p2']]);
    s = resolveAll(s);
    expect(tokens(s, 'p1').filter((id) => getChars(s, id)!.subtypes.includes('Clue'))).toHaveLength(2);
  });
});

describe('CR 105.3, 205.1b, 613.4b: "Until end of turn, target token you control becomes a green Bear creature with base power and toughness 4/4 in addition to its other colors and types."', () => {
  const DRUID = legend('Test Bear Druid', '{0}', ['2', '2'], ['G'], '{1}: Until end of turn, target token you control becomes a green Bear creature with base power and toughness 4/4 in addition to its other colors and types.', 'Legendary Creature — Elf Druid');
  it('CR 105.3, 205.1b: a Treasure token becomes a 4/4 green Bear artifact creature and stays a Treasure', () => {
    expect(noManual(DRUID)).toBe(true);
    let s = attackWith(ARTISAN, { defs: [DRUID], battlefield: ['Test Bear Druid', { name: 'Forest' }] });
    const treasure = tokens(s, 'p1').find((id) => getChars(s, id)!.subtypes.includes('Treasure'))!;
    const a = legal(s, 'p1', 'activate').find((x) => x.object === find(s, 'Test Bear Druid', 'battlefield'))!;
    s = act(s, a.action);
    s = answerUntilPriority(s, [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: treasure }] }]);
    s = resolveAll(s);
    const c = getChars(s, treasure)!;
    expect(`${c.power}/${c.toughness}`).toBe('4/4');
    expect(c.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(c.subtypes).toEqual(expect.arrayContaining(['Treasure', 'Bear']));
    expect(c.colors).toEqual(['G']);
  });
});

describe('CR 118.12, 701.21a, 508.4: "you may sacrifice another creature or an artifact. If you do, create a ... token ... that\'s tapped and attacking."', () => {
  const ZEALOT = legend('Test Bone Zealot', '{0}', ['2', '2'], ['R'], "Whenever you attack, you may sacrifice another creature or an artifact. If you do, create a 4/1 black Skeleton creature token with menace that's tapped and attacking.", 'Legendary Creature — Goblin Shaman');
  it('an artifact is sacrificed and the Skeleton token enters attacking', () => {
    expect(noManual(ZEALOT)).toBe(true);
    let s = commanderScenario({ p1Commanders: [ZEALOT], p2Commanders: [BOB], cards: ['Ornithopter'], p1: { battlefield: ['Test Bone Zealot', 'Ornithopter'] } });
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Bone Zealot', 'battlefield'), 'p2']]);
    s = resolveAll(s);
    expect(s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Ornithopter')).toHaveLength(0);
    const skel = tokens(s, 'p1');
    expect(skel).toHaveLength(1);
    expect(pt(s, skel[0]!)).toBe('4/1');
    expect(s.combat?.attackers.some((a) => a.id === skel[0])).toBe(true);
  });
});
