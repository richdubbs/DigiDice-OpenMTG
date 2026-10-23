/**
 * FAST2 T9: the continuous-effect shapes of parser/templates/zz-fast2/t9.json (and the renderer readings that unlock lords and graveyard-counting
 * characteristic-defining abilities) played through the engine with synthetic cards compiled by the game's default compiler (wordings are invented, design
 * 6.10). The templates are experimental, so most cards are `partial` (design 6.9): their automated steps run, which is what these tests check.
 *
 *   CR 205.1b, 613.1d-f, 613.4b  "becomes a 2/2 white and blue Bird artifact creature with flying until end of turn"; "becomes an artifact creature"
 *                                keeps its other types and subtypes; "becomes a 4/2 Knight creature" (no duration) lasts (CR 611.2a)
 *   CR 509.1b, 609.4, 702.3b     "gets +1/+0 until end of turn and can't be blocked this turn"; "can attack this turn as though it didn't have defender";
 *                                "target creature can't block ~ this turn"
 *   CR 608.2h, 611.2c            "for each other attacking Goblin" and "where X is its power" are counted once, as the ability resolves
 *   CR 107.3, 608.2h             "-X/-X ..., where X is the number of cards in your hand"
 *   CR 115.1                     "Up to two target creatures each get +2/+2"; "One or more target creatures become red"
 *   CR 608.2d                    "you may have target creature get -1/-1 until end of turn"
 *   CR 613.1f                    "loses defender until end of turn"
 *   CR 702.16a, 611.2c           "gains protection from the color of your choice" is fixed as it begins; "your choice of reach, trample, or haste"
 *   CR 604.3, 613.4a             "power and toughness are each equal to the number of creature cards in all graveyards"
 *   CR 607.2d, 613.4c            "Creatures you control of the chosen type get +1/+1"; "Other Zombie creatures get +1/+1" (every player's, CR 109.2)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { ruleDenial } from '../../../src/statics/hooks';
import { act, advanceTo, answer, find, legal, pass, put, reject, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers, passUntil } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const manualSteps = (d: CardDef): boolean => JSON.stringify(d.faces).includes('"op":"manual"') || d.faces.some((f) => f.abilities.some((a) => a.kind === 'manual'));

/** Answer the decisions that come up with `answers` (in order), pay costs automatically, choose `targets` when asked; stop at priority. */
function settle(s0: GameState, targets: TargetChoice[] = [], answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}

/** Activate the (one non-mana) activated ability of p1's permanent `name`; the ability is on the stack. */
function activate(s: GameState, name: string, targets: TargetChoice[] = []): GameState {
  const id = find(s, name, 'battlefield', 'p1');
  const la = legal(s, 'p1', 'activate').find((a) => a.object === id && !a.isMana);
  if (!la) throw new Error(`no activated ability of ${name}`);
  return settle(act(s, la.action), targets);
}

/** Both players pass so the top of the stack resolves; decisions while it resolves get `answers`. */
function resolve(s: GameState, answers: DecisionAnswer[] = []): GameState {
  return settle(pass(pass(s)), [], answers);
}

const nextTurn = (s: GameState): GameState => advanceTo(s, s.turn.number + 1, 'upkeep');
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

const BEARS = card('Test Bears', 'Creature — Bear', '', ['2', '2']);

describe('CR 205.1b, 613.1d-f, 613.4b: "becomes a [P/T] [colors] [subtype] artifact creature [with ...] until end of turn"', () => {
  const KEYRUNE = card('Test Keyrune', 'Artifact', '{0}: Test Keyrune becomes a 2/2 white and blue Bird artifact creature with flying until end of turn.');
  const IDOL = card('Test Idol', 'Artifact', '{0}: Test Idol becomes a 4/4 Spirit artifact creature until end of turn.');
  const WAGON = card('Test Wagon', 'Artifact — Vehicle', '{0}: Test Wagon becomes an artifact creature until end of turn.', ['3', '3']);

  it('the abilities are automated (no manual step)', () => {
    for (const d of [KEYRUNE, IDOL, WAGON]) expect(manualSteps(d), d.name).toBe(false);
  });

  it('CR 205.1b, 613.1d-f: the artifact is a 2/2 white and blue Bird artifact creature with flying until end of turn, then an artifact again', () => {
    let s = scenario([], { p1: { battlefield: ['Test Keyrune'] }, defs: [KEYRUNE] });
    const id = find(s, 'Test Keyrune', 'battlefield');
    expect(getChars(s, id)!.types).toEqual(['Artifact']);
    s = resolve(activate(s, 'Test Keyrune'));
    const c = getChars(s, id)!;
    expect([...c.types].sort()).toEqual(['Artifact', 'Creature']);
    expect(c.subtypes).toEqual(['Bird']);
    expect([...c.colors].sort()).toEqual(['U', 'W']);
    expect(hasKeyword(c, 'flying')).toBe(true);
    expect(pt(s, id)).toBe('2/2');
    s = nextTurn(s);
    expect(getChars(s, id)!.types).toEqual(['Artifact']);
    expect(hasKeyword(getChars(s, id)!, 'flying')).toBe(false);
  });

  it('CR 205.1b, 613.4b: "a 4/4 Spirit artifact creature" sets the creature type and the base P/T', () => {
    let s = scenario([], { p1: { battlefield: ['Test Idol'] }, defs: [IDOL] });
    const id = find(s, 'Test Idol', 'battlefield');
    s = resolve(activate(s, 'Test Idol'));
    expect([...getChars(s, id)!.types].sort()).toEqual(['Artifact', 'Creature']);
    expect(getChars(s, id)!.subtypes).toEqual(['Spirit']);
    expect(pt(s, id)).toBe('4/4');
  });

  it('CR 205.1b, 301.7b: "becomes an artifact creature" keeps the Vehicle subtype and the printed P/T', () => {
    let s = scenario([], { p1: { battlefield: ['Test Wagon'] }, defs: [WAGON] });
    const id = find(s, 'Test Wagon', 'battlefield');
    s = resolve(activate(s, 'Test Wagon'));
    const c = getChars(s, id)!;
    expect([...c.types].sort()).toEqual(['Artifact', 'Creature']);
    expect(c.subtypes).toEqual(['Vehicle']);
    expect(pt(s, id)).toBe('3/3');
  });
});

describe('CR 205.1b, 611.2a: "becomes a 4/2 Knight creature" with no duration lasts', () => {
  const STATUE = card('Test Dormant Statue', 'Enchantment', '{0}: Test Dormant Statue becomes a 4/2 Knight creature with vigilance.');
  it('CR 205.1b: it is a creature (no longer an enchantment) with vigilance, also after the turn ends', () => {
    expect(manualSteps(STATUE)).toBe(false);
    let s = scenario([], { p1: { battlefield: ['Test Dormant Statue'] }, defs: [STATUE] });
    const id = find(s, 'Test Dormant Statue', 'battlefield');
    s = nextTurn(resolve(activate(s, 'Test Dormant Statue')));
    const c = getChars(s, id)!;
    expect(c.types).toEqual(['Creature']);
    expect(c.subtypes).toEqual(['Knight']);
    expect(hasKeyword(c, 'vigilance')).toBe(true);
    expect(pt(s, id)).toBe('4/2');
  });
});

describe('CR 509.1b, 609.4, 702.3b: evasion, the defender waiver and a block ban for one turn', () => {
  const SNEAK = card('Test Sneak', 'Creature — Rogue', "{0}: Test Sneak gets +1/+0 until end of turn and can't be blocked this turn.", ['1', '1']);
  const WALL = card('Test Charging Wall', 'Creature — Wall', "Defender\n{0}: Test Charging Wall gets +2/-1 until end of turn and can attack this turn as though it didn't have defender.", ['0', '4']);
  const BULLY = card('Test Bully', 'Creature — Ogre', "{0}: Target creature can't block Test Bully this turn.", ['3', '3']);

  it('CR 509.1b: +1/+0 and "can\'t be blocked" until the turn ends', () => {
    expect(manualSteps(SNEAK)).toBe(false);
    let s = scenario([], { p1: { battlefield: ['Test Sneak'] }, defs: [SNEAK] });
    const id = find(s, 'Test Sneak', 'battlefield');
    expect(ruleDenial(s, { action: 'beBlocked', subject: id })).toBeNull();
    s = resolve(activate(s, 'Test Sneak'));
    expect(pt(s, id)).toBe('2/1');
    expect(ruleDenial(s, { action: 'beBlocked', subject: id })).not.toBeNull();
    s = nextTurn(s);
    expect(pt(s, id)).toBe('1/1');
    expect(ruleDenial(s, { action: 'beBlocked', subject: id })).toBeNull();
  });

  it('CR 609.4, 702.3b: the wall with defender can attack after the ability resolves, and gets +2/-1', () => {
    expect(manualSteps(WALL)).toBe(false);
    const s0 = scenario([], { p1: { battlefield: ['Test Charging Wall', 'Test Bears'] }, defs: [WALL, BEARS] });
    const id = find(s0, 'Test Charging Wall', 'battlefield');
    const before = toDeclareAttackers(s0);
    expect(reject(before, { type: 'answer', player: 'p1', decisionId: before.pending!.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: id, defender: 'p2' }] } }).rules).toContain('CR 702.3b');
    let s = resolve(activate(s0, 'Test Charging Wall'));
    expect(pt(s, id)).toBe('2/3');
    s = declareAttackers(toDeclareAttackers(s), [[id]]);
    expect(s.combat?.attackers.map((a) => a.id)).toContain(id);
  });

  it('CR 509.1b: the targeted creature can\'t block the source this turn; it can block another attacker', () => {
    expect(manualSteps(BULLY)).toBe(false);
    let s = scenario([], { p1: { battlefield: ['Test Bully', 'Test Bears'] }, p2: { battlefield: ['Test Bears'] }, defs: [BULLY, BEARS] });
    const bully = find(s, 'Test Bully', 'battlefield', 'p1');
    const mine = find(s, 'Test Bears', 'battlefield', 'p1');
    const theirs = find(s, 'Test Bears', 'battlefield', 'p2');
    s = resolve(activate(s, 'Test Bully', [obj(theirs)]));
    expect(ruleDenial(s, { action: 'block', subject: theirs, other: bully })).not.toBeNull();
    expect(ruleDenial(s, { action: 'block', subject: theirs, other: mine })).toBeNull();
    s = nextTurn(s);
    expect(ruleDenial(s, { action: 'block', subject: theirs, other: bully })).toBeNull();
  });
});

describe('CR 608.2h, 611.2c: amounts counted once, as the ability resolves', () => {
  const CHIEF = card('Test Goblin Chief', 'Creature — Goblin', 'Whenever Test Goblin Chief attacks, it gets +2/+0 until end of turn for each other attacking Goblin.', ['1', '1']);
  const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', ['1', '1']);
  const SPIRIT = card('Test Doubling Spirit', 'Creature — Spirit', '{0}: Test Doubling Spirit gets +X/+X until end of turn, where X is its power.', ['3', '3']);

  it('CR 608.2h: two other attacking Goblins give +4/+0 (the Chief itself is not counted, CR 109.2)', () => {
    expect(manualSteps(CHIEF)).toBe(false);
    const s0 = scenario([], { p1: { battlefield: ['Test Goblin Chief', 'Test Goblin', 'Test Goblin', 'Test Bears'] }, defs: [CHIEF, GOBLIN, BEARS] });
    const chief = find(s0, 'Test Goblin Chief', 'battlefield');
    const goblins = s0.zones.battlefield.filter((x) => s0.defs[s0.objects[x]!.defId]!.name === 'Test Goblin');
    const bears = find(s0, 'Test Bears', 'battlefield');
    let s = declareAttackers(toDeclareAttackers(s0), [[chief], [goblins[0]!], [goblins[1]!], [bears]]);
    s = passUntil(s, (x) => x.zones.stack.length === 0 && x.turn.step !== 'declareAttackers', 'the trigger resolved', 10);
    expect(pt(s, chief)).toBe('5/1');
  });

  it('CR 608.2h: X is its power as the ability resolves (3, then 6)', () => {
    expect(manualSteps(SPIRIT)).toBe(false);
    let s = scenario([], { p1: { battlefield: ['Test Doubling Spirit'] }, defs: [SPIRIT] });
    const id = find(s, 'Test Doubling Spirit', 'battlefield');
    s = resolve(activate(s, 'Test Doubling Spirit'));
    expect(pt(s, id)).toBe('6/6');
    s = resolve(activate(s, 'Test Doubling Spirit'));
    expect(pt(s, id)).toBe('12/12');
  });
});

describe('CR 107.3, 115.1, 608.2d, 613.1e-f: one-shot P/T, ability and color changes', () => {
  const DREAD = card('Test Dread', 'Instant', 'Target creature gets -X/-X until end of turn, where X is the number of cards in your hand.');
  const RALLY = card('Test Twin Rally', 'Instant', 'Up to two target creatures each get +2/+2 until end of turn.');
  const HEX = card('Test Hex Witch', 'Creature — Human Warlock', '{0}: You may have target creature get -1/-1 until end of turn.', ['1', '1']);
  const ROUSE = card('Test Rousing Wall', 'Creature — Wall', 'Defender\n{0}: Test Rousing Wall loses defender until end of turn.', ['2', '4']);
  const PAINT = card('Test Paint', 'Instant', 'One or more target creatures become red until end of turn.');

  const castWith = (s0: GameState, name: string, targets: TargetChoice[]): GameState => settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), targets);

  it('CR 107.3, 608.2h: -X/-X with X the cards in your hand as it resolves (two cards left in hand)', () => {
    expect(manualSteps(DREAD)).toBe(false);
    const s0 = scenario([], { p1: { hand: ['Test Dread', 'Test Bears', 'Test Bears'] }, p2: { battlefield: ['Test Bears'] }, defs: [DREAD, BEARS] });
    const target = find(s0, 'Test Bears', 'battlefield', 'p2');
    const s = resolve(castWith(s0, 'Test Dread', [obj(target)]));
    expect(find(s, 'Test Bears', 'graveyard', 'p2')).toBeTruthy(); // 2/2 -2/-2 dies (CR 704.5f)
  });

  it('CR 115.1: up to two target creatures each get +2/+2', () => {
    expect(manualSteps(RALLY)).toBe(false);
    const s0 = scenario([], { p1: { hand: ['Test Twin Rally'], battlefield: ['Test Bears', 'Test Bears'] }, defs: [RALLY, BEARS] });
    const ids = s0.zones.battlefield.slice();
    const s = resolve(castWith(s0, 'Test Twin Rally', ids.map(obj)));
    for (const id of ids) expect(pt(s, id)).toBe('4/4');
  });

  it('CR 608.2d: "you may have target creature get -1/-1": yes applies it, no does nothing', () => {
    expect(manualSteps(HEX)).toBe(false);
    const s0 = scenario([], { p1: { battlefield: ['Test Hex Witch'] }, p2: { battlefield: ['Test Bears'] }, defs: [HEX, BEARS] });
    const target = find(s0, 'Test Bears', 'battlefield', 'p2');
    const yes = resolve(activate(s0, 'Test Hex Witch', [obj(target)]), [{ kind: 'yesNo', yes: true }]);
    expect(pt(yes, target)).toBe('1/1');
    const no = resolve(activate(s0, 'Test Hex Witch', [obj(target)]), [{ kind: 'yesNo', yes: false }]);
    expect(pt(no, target)).toBe('2/2');
  });

  it('CR 613.1f: "loses defender until end of turn"', () => {
    expect(manualSteps(ROUSE)).toBe(false);
    let s = scenario([], { p1: { battlefield: ['Test Rousing Wall'] }, defs: [ROUSE] });
    const id = find(s, 'Test Rousing Wall', 'battlefield');
    expect(hasKeyword(getChars(s, id)!, 'defender')).toBe(true);
    s = resolve(activate(s, 'Test Rousing Wall'));
    expect(hasKeyword(getChars(s, id)!, 'defender')).toBe(false);
    s = nextTurn(s);
    expect(hasKeyword(getChars(s, id)!, 'defender')).toBe(true);
  });

  it('CR 613.1e: one or more target creatures become red', () => {
    expect(manualSteps(PAINT)).toBe(false);
    const s0 = scenario([], { p1: { hand: ['Test Paint'], battlefield: ['Test Bears'] }, p2: { battlefield: ['Test Bears'] }, defs: [PAINT, BEARS] });
    const ids = s0.zones.battlefield.slice();
    const s = resolve(castWith(s0, 'Test Paint', ids.map(obj)));
    for (const id of ids) expect(getChars(s, id)!.colors).toEqual(['R']);
  });
});

describe('CR 702.16a, 608.2d, 611.2c: a choice as the ability resolves', () => {
  const KNIGHT = card('Test Prism Knight', 'Creature — Human Knight', '{0}: Test Prism Knight gains protection from the color of your choice until end of turn.', ['2', '2']);
  const BEAST = card('Test Shifting Beast', 'Creature — Dinosaur', '{0}: Test Shifting Beast gains your choice of reach, trample, or haste until end of turn.', ['4', '4']);
  const protections = (s: GameState, id: ObjectId): string[] =>
    getChars(s, id)!.abilities.flatMap((a) => (a.def.kind === 'keyword' && a.def.keyword === 'protection' ? [String(a.def.quality)] : [])).sort();

  it('CR 702.16a, 611.2c: protection from the chosen color, fixed as it begins (a second activation adds another)', () => {
    expect(manualSteps(KNIGHT)).toBe(false);
    let s = scenario([], { p1: { battlefield: ['Test Prism Knight'] }, defs: [KNIGHT] });
    const id = find(s, 'Test Prism Knight', 'battlefield');
    s = resolve(activate(s, 'Test Prism Knight'), [{ kind: 'chooseColor', color: 'R' }]);
    expect(protections(s, id)).toEqual(['color:R']);
    s = resolve(activate(s, 'Test Prism Knight'), [{ kind: 'chooseColor', color: 'G' }]);
    expect(protections(s, id)).toEqual(['color:G', 'color:R']);
    s = nextTurn(s);
    expect(protections(s, id)).toEqual([]);
  });

  it('CR 608.2d: the chosen keyword only', () => {
    expect(manualSteps(BEAST)).toBe(false);
    let s = scenario([], { p1: { battlefield: ['Test Shifting Beast'] }, defs: [BEAST] });
    const id = find(s, 'Test Shifting Beast', 'battlefield');
    s = resolve(activate(s, 'Test Shifting Beast'));
    expect(s.pending).toMatchObject({ kind: 'chooseOption' });
    const pick = (s.pending as { options: { id: string; label: string }[] }).options.find((o) => o.label === 'trample')!;
    s = settle(answer(s, { kind: 'chooseOption', ids: [pick.id] }));
    const c = getChars(s, id)!;
    expect([hasKeyword(c, 'reach'), hasKeyword(c, 'trample'), hasKeyword(c, 'haste')]).toEqual([false, true, false]);
  });
});

describe('CR 604.3, 607.2d, 613.4a, 613.4c, 109.2: characteristic-defining abilities and lords', () => {
  const GRAVE = card('Test Grave Eater', 'Creature — Lhurgoyf', "Test Grave Eater's power and toughness are each equal to the number of creature cards in all graveyards.", ['*', '*']);
  const BANNER = card('Test Kin Banner', 'Artifact', 'As Test Kin Banner enters, choose a creature type.\nCreatures you control of the chosen type get +1/+1.', undefined, '{0}');
  const LORD = card('Test Ghoul Lord', 'Creature — Zombie', 'Other Zombie creatures get +1/+1.', ['2', '2']);
  const ZOMBIE = card('Test Zombie', 'Creature — Zombie', '', ['2', '2']);
  const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', ['1', '1']);

  it('CR 604.3, 613.4a: creature cards in every graveyard count, other cards do not', () => {
    expect(GRAVE.automation.level).toBe('full');
    let s = scenario([], { p1: { battlefield: ['Test Grave Eater'], graveyard: ['Test Bears', 'Test Bears'] }, p2: { graveyard: ['Test Bears', 'Test Kin Banner'] }, defs: [GRAVE, BEARS, BANNER] });
    expect(pt(s, find(s, 'Test Grave Eater', 'battlefield'))).toBe('3/3');
    put(s, 'p2', 'graveyard', 'Test Bears');
    s = { ...s };
    expect(pt(s, find(s, 'Test Grave Eater', 'battlefield'))).toBe('4/4');
  });

  it('CR 607.2d, 613.4c: the chosen type, your creatures only', () => {
    expect(manualSteps(BANNER)).toBe(false);
    const s0 = scenario([], { p1: { hand: ['Test Kin Banner'], battlefield: ['Test Goblin', 'Test Bears'] }, p2: { battlefield: ['Test Goblin'] }, defs: [BANNER, GOBLIN, BEARS] });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Kin Banner', 'hand', 'p1') }));
    s = resolve(s, [{ kind: 'chooseName', name: 'Goblin' }]);
    expect(pt(s, find(s, 'Test Goblin', 'battlefield', 'p1'))).toBe('2/2');
    expect(pt(s, find(s, 'Test Bears', 'battlefield', 'p1'))).toBe('2/2');
    expect(pt(s, find(s, 'Test Goblin', 'battlefield', 'p2'))).toBe('1/1');
  });

  it('CR 109.2, 613.4c: other Zombies of every player get +1/+1, the lord itself does not', () => {
    expect(LORD.automation.level).toBe('full');
    const s = scenario([], { p1: { battlefield: ['Test Ghoul Lord', 'Test Zombie'] }, p2: { battlefield: ['Test Zombie', 'Test Goblin'] }, defs: [LORD, ZOMBIE, GOBLIN] });
    expect(pt(s, find(s, 'Test Ghoul Lord', 'battlefield'))).toBe('2/2');
    expect(pt(s, find(s, 'Test Zombie', 'battlefield', 'p1'))).toBe('3/3');
    expect(pt(s, find(s, 'Test Zombie', 'battlefield', 'p2'))).toBe('3/3');
    expect(pt(s, find(s, 'Test Goblin', 'battlefield', 'p2'))).toBe('1/1');
  });
});
