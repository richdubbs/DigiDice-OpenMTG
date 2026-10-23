/**
 * FAST4 T34: the shapes of parser/templates/zz-fast4/t34.json (and the hole grammar and renderer readings the package added) played through the engine with
 * synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 118.12a, 118.3   "~ deals 2 damage to target player unless they sacrifice a creature of their choice"; "loses N life unless they discard a card";
 *                       "... unless they sacrifice a nonland permanent of their choice or discard a card": the player chooses; a cost they can't pay is not paid
 *   CR 118.12a, 608.2d  "~ deals 3 damage to target creature unless that creature's controller has ~ deal 5 damage to them"
 *   CR 107.3            "target player gains twice X life"; CR 122.1 "you gain 3 life and get {E}{E}{E}"
 *   CR 601.2i, 608.2h   "deals damage to that player equal to the number of noncreature spells they've cast this turn"
 *   CR 119.3, 120.3a    "each opponent loses life equal to the life they lost this turn" (each player's own loss, damage included, gains not subtracted)
 *   CR 601.2h, 707.10   "where X is the number of colors of mana spent to cast ~" (converge)
 *   CR 115.3, 601.2c    "~ deals 4 damage to any target and 3 damage to each of up to two other targets"; "any target that isn't a Dragon"
 *   CR 601.2d           "divided as you choose among one, two, or three target attacking or blocking creatures"
 *   CR 608.2h, 506.4    "if it was tapped", "if it wasn't attacking", "if it was a permanent card", "if it's a land card" (last known information)
 *   CR 701.24a, 121.1   "each player shuffles the cards from their hand into their library, then draws that many cards"
 *   CR 401.4, 608.2c    "put any number of cards from your hand on the bottom of your library, then draw that many cards plus one"
 *   CR 121.2            "each opponent draws a card, then you draw a card for each opponent who drew a card this way"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, battlefieldNames, find, legal, life, pass, scenario, zoneNames } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers, toStep, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (experimental templates cap the card at partial, never an ability). */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });

/** Answer the decisions that come up: target groups from `targets` (one list per group, in order), then `answers`; pay costs automatically; stop at priority. */
function settle(s0: GameState, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const groups = [...targets];
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
const resolve = (s: GameState, answers: DecisionAnswer[] = []): GameState => settle(pass(pass(s)), [], answers);
const castWith = (s0: GameState, name: string, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = []): GameState =>
  settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), targets, answers);
function activate(s: GameState, name: string, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = []): GameState {
  const id = find(s, name, 'battlefield', 'p1');
  const la = legal(s, 'p1', 'activate').find((a) => a.object === id && !a.isMana);
  if (!la) throw new Error(`no activated ability of ${name}`);
  return settle(act(s, la.action), targets, answers);
}
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };
const no: DecisionAnswer = { kind: 'yesNo', yes: false };
const tokens = (s: GameState, p: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p).length;
const energy = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.counters?.['energy'] ?? 0;

const ELF = card('Test Elf', 'Creature — Elf', '', ['2', '2'], '{1}');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '5'], '{3}');
const ROCK = card('Test Rock', 'Artifact', '');
const GLOW = card('Test Glow', 'Instant', 'You gain 1 life.');

describe('CR 118.12a, 118.3: "unless they sacrifice / discard" (the player chooses; a cost they cannot pay is not paid)', () => {
  const SAC = card('Test Toll Idol', 'Artifact', '{0}: Test Toll Idol deals 2 damage to target player unless they sacrifice a creature of their choice.');
  const DISCARD = card('Test Quandary Idol', 'Artifact', '{0}: Target opponent loses 3 life unless they discard a card.');
  const EITHER = card('Test Threat Idol', 'Artifact', '{0}: Target opponent loses 3 life unless they sacrifice a nonland permanent of their choice or discard a card.');
  it('are automated', () => {
    for (const d of [SAC, DISCARD, EITHER]) expect(automated(d), d.name).toBe(true);
  });
  it('the player who would be dealt the damage sacrifices a creature instead, or declines and is dealt it', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Toll Idol'] }, p2: { battlefield: ['Test Elf'] }, defs: [SAC, ELF] });
    const paid = resolve(activate(s0, 'Test Toll Idol', [[player('p2')]]), [yes]);
    expect(battlefieldNames(paid, 'p2')).not.toContain('Test Elf');
    expect(life(paid, 'p2')).toBe(20);
    const declined = resolve(activate(s0, 'Test Toll Idol', [[player('p2')]]), [no]);
    expect(battlefieldNames(declined, 'p2')).toContain('Test Elf');
    expect(life(declined, 'p2')).toBe(18);
  });
  it('a player with no creature cannot pay (CR 118.3): the damage is dealt with no question', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Toll Idol'] }, defs: [SAC] });
    const s = resolve(activate(s0, 'Test Toll Idol', [[player('p2')]]));
    expect(s.pending?.kind).toBe('priority');
    expect(life(s, 'p2')).toBe(18);
  });
  it('"loses 3 life unless they discard a card": an empty hand loses the life; a card in hand may be discarded instead', () => {
    const empty = scenario([], { p1: { battlefield: ['Test Quandary Idol'] }, defs: [DISCARD] });
    expect(life(resolve(activate(empty, 'Test Quandary Idol', [[player('p2')]])), 'p2')).toBe(17);
    const one = scenario([], { p1: { battlefield: ['Test Quandary Idol'] }, p2: { hand: ['Test Rock'] }, defs: [DISCARD, ROCK] });
    const s = resolve(activate(one, 'Test Quandary Idol', [[player('p2')]]), [yes]);
    expect(life(s, 'p2')).toBe(20);
    expect(zoneNames(s, 'graveyard', 'p2')).toContain('Test Rock');
  });
  it('"... unless they sacrifice a nonland permanent of their choice or discard a card": either payment prevents the loss, neither loses it', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Threat Idol'] }, p2: { hand: ['Test Rock'], battlefield: ['Test Elf'] }, defs: [EITHER, ROCK, ELF] });
    const discarded = resolve(activate(s0, 'Test Threat Idol', [[player('p2')]]), [no, yes]);
    expect(life(discarded, 'p2')).toBe(20);
    expect(battlefieldNames(discarded, 'p2')).toContain('Test Elf');
    expect(zoneNames(discarded, 'graveyard', 'p2')).toContain('Test Rock');
    const sacrificed = resolve(activate(s0, 'Test Threat Idol', [[player('p2')]]), [yes]);
    expect(life(sacrificed, 'p2')).toBe(20);
    expect(battlefieldNames(sacrificed, 'p2')).not.toContain('Test Elf');
    const neither = resolve(activate(s0, 'Test Threat Idol', [[player('p2')]]), [no, no]);
    expect(life(neither, 'p2')).toBe(17);
  });
});

describe('CR 118.12a, 608.2d: "~ deals 3 damage to target creature unless that creature\'s controller has ~ deal 5 damage to them"', () => {
  const SALVO = card('Test Salvo', 'Instant', "Test Salvo deals 3 damage to target creature unless that creature's controller has Test Salvo deal 5 damage to them.");
  it('is automated; the controller of the creature chooses which damage is dealt', () => {
    expect(automated(SALVO)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Salvo'] }, p2: { battlefield: ['Test Ogre'] }, defs: [SALVO, OGRE] });
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p2');
    const cast = castWith(s0, 'Test Salvo', [[obj(ogre)]]);
    const taken = pass(pass(cast));
    expect(taken.pending?.kind).toBe('yesNo');
    expect(taken.pending?.player).toBe('p2');
    const toPlayer = settle(taken, [], [yes]);
    expect(life(toPlayer, 'p2')).toBe(15);
    expect(toPlayer.objects[ogre]!.damage).toBe(0);
    const toCreature = settle(taken, [], [no]);
    expect(life(toCreature, 'p2')).toBe(20);
    expect(toCreature.objects[ogre]!.damage).toBe(3);
  });
});

describe('CR 107.3, 122.1: "target player gains twice X life"; "you gain 3 life and get {E}{E}{E}"', () => {
  const FONT = card('Test Font', 'Artifact', '{X}: Target player gains twice X life.');
  const KNOT = card('Test Knot', 'Artifact', '{0}: You gain 3 life and get {E}{E}{E}.');
  it('X = 3 gains 6; the energy is three counters on you', () => {
    expect(automated(FONT)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Font', 'Plains', 'Plains', 'Plains'] }, defs: [FONT] });
    const s = resolve(activate(s0, 'Test Font', [[player('p1')]], [{ kind: 'chooseNumber', n: 3 }]));
    expect(life(s, 'p1')).toBe(26);
    expect(automated(KNOT)).toBe(true);
    const k = resolve(activate(scenario([], { p1: { battlefield: ['Test Knot'] }, defs: [KNOT] }), 'Test Knot'));
    expect(life(k, 'p1')).toBe(23);
    expect(energy(k, 'p1')).toBe(3);
  });
});

describe('CR 601.2i: "deals damage to that player equal to the number of noncreature spells they\'ve cast this turn"', () => {
  const LIZARD = card('Test Lizard', 'Creature — Lizard', "Whenever a player casts a noncreature spell, Test Lizard deals damage to that player equal to the number of noncreature spells they've cast this turn.", ['2', '2']);
  it('the first spell costs 1 life, the second 2 (the spell that triggered counts; another player\'s spells do not)', () => {
    expect(automated(LIZARD)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Glow', 'Test Glow'] }, p2: { battlefield: ['Test Lizard'] }, defs: [LIZARD, GLOW] });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Glow', 'hand', 'p1') }));
    s = resolve(s); // the trigger: 1 damage
    expect(life(s, 'p1')).toBe(19);
    s = resolve(s); // the first Glow: +1
    expect(life(s, 'p1')).toBe(20);
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Glow', 'hand', 'p1') }));
    s = resolve(s);
    expect(life(s, 'p1')).toBe(18);
  });
});

describe('CR 119.3, 120.3a: "each opponent loses life equal to the life they lost this turn"', () => {
  const MIRROR = card('Test Mirror', 'Artifact', '{0}: Each opponent loses life equal to the life they lost this turn.');
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to any target.');
  const DRAIN = card('Test Drain', 'Instant', 'Target player loses 2 life.');
  it('damage and life loss both count; life gained is not subtracted; your own loss is not counted', () => {
    expect(automated(MIRROR)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Mirror'], hand: ['Test Bolt', 'Test Drain', 'Test Drain'] }, p2: { hand: ['Test Glow'] }, defs: [MIRROR, BOLT, DRAIN, GLOW] });
    let s = resolve(castWith(s0, 'Test Bolt', [[player('p2')]]));
    s = resolve(castWith(s, 'Test Drain', [[player('p2')]]));
    s = resolve(castWith(s, 'Test Drain', [[player('p1')]]));
    s = tweak(s, (t) => { const p = t.players.find((x) => x.id === 'p2')!; p.life += 4; p.turnStats.lifeGained += 4; });
    expect(life(s, 'p2')).toBe(19);
    s = resolve(activate(s, 'Test Mirror'));
    expect(life(s, 'p2')).toBe(14); // lost 5 this turn (3 damage, 2 life), so loses 5 more
    expect(life(s, 'p1')).toBe(18);
  });
});

describe('CR 601.2h, 707.10: converge, "where X is the number of colors of mana spent to cast ~"', () => {
  const TRUTHS = card('Test Truths', 'Sorcery', 'You draw X cards and lose X life, where X is the number of colors of mana spent to cast Test Truths.', undefined, '{W}{U}{B}');
  const OMENS = card('Test Omens', 'Sorcery', 'Target player discards X cards, where X is the number of colors of mana spent to cast Test Omens.', undefined, '{2}{B}');
  it('three colors spent: draw 3, lose 3', () => {
    expect(automated(TRUTHS)).toBe(true);
    const s0 = scenario(['Island', 'Swamp'], { p1: { hand: ['Test Truths'], battlefield: ['Plains', 'Island', 'Swamp'] }, defs: [TRUTHS] });
    const before = s0.zones.hand['p1']!.length;
    const s = resolve(castWith(s0, 'Test Truths'));
    expect(life(s, 'p1')).toBe(17);
    expect(s.zones.hand['p1']!.length).toBe(before - 1 + 3);
  });
  it('one color spent (the rest colorless) discards one card', () => {
    expect(automated(OMENS)).toBe(true);
    const s0 = scenario(['Swamp', 'Wastes'], { p1: { hand: ['Test Omens'], battlefield: ['Swamp', 'Wastes', 'Wastes'] }, p2: { hand: ['Test Rock', 'Test Rock', 'Test Rock'] }, defs: [OMENS, ROCK] });
    let s = resolve(castWith(s0, 'Test Omens', [[player('p2')]]));
    expect(s.pending?.kind).toBe('chooseObjects');
    if (s.pending?.kind === 'chooseObjects') expect(s.pending.min).toBe(1);
    s = settle(answer(s, { kind: 'chooseObjects', ids: [s0.zones.hand['p2']![0]!] }));
    expect(s.zones.graveyard['p2']!.length + s.zones.hand['p2']!.length).toBe(3);
    expect(s.zones.hand['p2']!.length).toBe(2);
  });
});

describe('CR 115.3, 601.2c: "~ deals 4 damage to any target and 3 damage to each of up to two other targets"', () => {
  const DRAKE = card('Test Drake', 'Artifact', '{0}: Test Drake deals 4 damage to any target and 3 damage to each of up to two other targets.');
  it('the first target is dealt 4, each other target 3', () => {
    expect(automated(DRAKE)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Drake'] }, p2: { battlefield: ['Test Ogre', 'Test Elf'] }, defs: [DRAKE, OGRE, ELF] });
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p2');
    const elf = find(s0, 'Test Elf', 'battlefield', 'p2');
    const s = resolve(activate(s0, 'Test Drake', [[player('p2')], [obj(ogre), obj(elf)]]));
    expect(life(s, 'p2')).toBe(16);
    expect(s.objects[ogre]!.damage).toBe(3);
    expect(battlefieldNames(s, 'p2')).not.toContain('Test Elf');
  });
});

describe('CR 115.4: "it deals that much damage to any target that isn\'t a Dragon"', () => {
  const WYRM = card('Test Wyrm', 'Creature — Dragon', "Whenever a Dragon you control is dealt damage, it deals that much damage to any target that isn't a Dragon.", ['4', '6']);
  const OTHER = card('Test Hatchling', 'Creature — Dragon', '', ['1', '1']);
  const SPARK = card('Test Spark', 'Instant', 'Test Spark deals 2 damage to any target.');
  it('is automated; a Dragon is no legal target, a player and another creature are', () => {
    expect(automated(WYRM)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Spark'] }, p2: { battlefield: ['Test Wyrm', 'Test Hatchling', 'Test Elf'] }, defs: [WYRM, OTHER, SPARK, ELF] });
    const wyrm = find(s0, 'Test Wyrm', 'battlefield', 'p2');
    const s = pass(pass(castWith(s0, 'Test Spark', [[obj(wyrm)]])));
    const t = s.pending?.kind === 'priority' ? pass(s) : s;
    const p = t.pending;
    expect(p?.kind).toBe('chooseTargets');
    if (p?.kind !== 'chooseTargets') return;
    const ids = p.objects ?? [];
    expect(ids).toContain(find(s0, 'Test Elf', 'battlefield', 'p2'));
    expect(ids).not.toContain(wyrm);
    expect(ids).not.toContain(find(s0, 'Test Hatchling', 'battlefield', 'p2'));
    expect(p.players).toContain('p1');
  });
});

describe('CR 601.2d: "divided as you choose among one, two, or three target attacking or blocking creatures"', () => {
  const DISMISS = card('Test Dismissal', 'Instant', 'Test Dismissal deals 3 damage divided as you choose among one, two, or three target attacking or blocking creatures.');
  it('is automated as one target spec of one to three attacking or blocking creatures with the damage divided', () => {
    expect(automated(DISMISS)).toBe(true);
    const spell = DISMISS.faces[0]!.abilities[0] as unknown as { effect: { targets: { min: number; max: number; divide?: unknown; filter?: unknown }[] } };
    expect(spell.effect.targets).toHaveLength(1);
    expect(spell.effect.targets[0]).toMatchObject({ id: 't0', kind: 'object', min: 1, max: 3, filter: { anyOf: [{ attacking: true }, { blocking: true }], types: ['Creature'] }, divide: { what: 'damage', total: 3 } });
  });
});

describe('CR 608.2h, 506.4: conditions on what the previous instruction acted on, read as it last existed', () => {
  const BLUNDER = card('Test Blunder', 'Instant', 'Return target creature to its owner\'s hand. If it was tapped, create a Treasure token.');
  const END = card('Test End', 'Instant', "Destroy target creature. If it wasn't attacking, its controller draws a card.");
  const SASH = card('Test Sash', 'Artifact', '{0}: Exile target card from a graveyard. If it was a permanent card, put a +1/+1 counter on target creature.');
  it('"if it was tapped": a tapped creature returned to hand still counts as tapped', () => {
    expect(automated(BLUNDER)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Blunder', 'Test Blunder'] }, p2: { battlefield: [{ name: 'Test Elf', tapped: true }, 'Test Ogre'] }, defs: [BLUNDER, ELF, OGRE] });
    const tapped = resolve(castWith(s0, 'Test Blunder', [[obj(find(s0, 'Test Elf', 'battlefield', 'p2'))]]));
    expect(tokens(tapped, 'p1')).toBe(1);
    const untapped = resolve(castWith(s0, 'Test Blunder', [[obj(find(s0, 'Test Ogre', 'battlefield', 'p2'))]]));
    expect(tokens(untapped, 'p1')).toBe(0);
  });
  it('"if it wasn\'t attacking": a creature destroyed while attacking was attacking (its last known information keeps that); one not in combat was not', () => {
    expect(automated(END)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Elf', since: -1 }] }, p2: { hand: ['Test End', 'Test End'], battlefield: ['Test Ogre'] }, defs: [END, ELF, OGRE] });
    const elf = find(s0, 'Test Elf', 'battlefield', 'p1');
    let s = declareAttackers(toDeclareAttackers(s0), [[elf, 'p2']]);
    s = toStep(s, 'declareAttackers');
    while (s.pending?.kind === 'priority' && s.pending.player !== 'p2') s = pass(s);
    const hand1 = s.zones.hand['p1']!.length;
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test End', 'hand', 'p2') }), [[obj(elf)]]);
    s = resolve(s);
    expect(battlefieldNames(s, 'p1')).not.toContain('Test Elf');
    expect(s.zones.hand['p1']!.length).toBe(hand1); // it was attacking: no card
    // not in combat: its controller draws
    const t0 = scenario([], { p1: { hand: ['Test End'] }, p2: { battlefield: ['Test Ogre'] }, defs: [END, OGRE] });
    const hand2 = t0.zones.hand['p2']!.length;
    const t = resolve(castWith(t0, 'Test End', [[obj(find(t0, 'Test Ogre', 'battlefield', 'p2'))]]));
    expect(t.zones.hand['p2']!.length).toBe(hand2 + 1);
  });
  it('"draw a card if it was attacking" in a dies trigger reads the creature as it last existed on the battlefield, combat included (CR 603.10a, 506.4)', () => {
    const MOURN = card('Test Mourner', 'Enchantment', 'Whenever another creature you control dies, draw a card if it was attacking.');
    expect(automated(MOURN)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Mourner', { name: 'Test Elf', since: -1 }] }, p2: { hand: ['Test End'], battlefield: ['Test Ogre'] }, defs: [MOURN, END, ELF, OGRE] });
    const elf = find(s0, 'Test Elf', 'battlefield', 'p1');
    let s = declareAttackers(toDeclareAttackers(s0), [[elf, 'p2']]);
    s = toStep(s, 'declareAttackers');
    while (s.pending?.kind === 'priority' && s.pending.player !== 'p2') s = pass(s);
    const hand = s.zones.hand['p1']!.length;
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test End', 'hand', 'p2') }), [[obj(elf)]]);
    s = resolve(s); // Test End: the Elf dies while attacking (its controller draws nothing: it was attacking)
    s = resolve(s); // the Mourner's trigger
    expect(s.zones.hand['p1']!.length).toBe(hand + 1);
  });
  it('"if it was a permanent card": an exiled artifact card counts, an instant card does not', () => {
    expect(automated(SASH)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Sash', 'Test Elf'], graveyard: ['Test Rock', 'Test Glow'] }, defs: [SASH, ROCK, GLOW, ELF] });
    const elf = find(s0, 'Test Elf', 'battlefield', 'p1');
    const rock = resolve(activate(s0, 'Test Sash', [[obj(find(s0, 'Test Rock', 'graveyard', 'p1'))], [obj(elf)]]));
    expect(rock.objects[elf]!.counters['+1/+1']).toBe(1);
    const glow = resolve(activate(s0, 'Test Sash', [[obj(find(s0, 'Test Glow', 'graveyard', 'p1'))], [obj(elf)]]));
    expect(glow.objects[elf]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});

describe('CR 701.24a, 121.1: "each player shuffles the cards from their hand into their library, then draws that many cards"', () => {
  const WINDS = card('Test Winds', 'Sorcery', 'Each player shuffles the cards from their hand into their library, then draws that many cards.');
  it('each player ends with as many cards in hand as they had', () => {
    expect(automated(WINDS)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Winds', 'Test Rock', 'Test Rock'] }, p2: { hand: ['Test Rock', 'Test Rock', 'Test Rock', 'Test Rock'] }, defs: [WINDS, ROCK] });
    const s = resolve(castWith(s0, 'Test Winds'));
    expect(s.zones.hand['p1']!.length).toBe(2);
    expect(s.zones.hand['p2']!.length).toBe(4);
    expect(s.zones.library['p1']!.length).toBe(20); // the two cards went in and two came out
  });
});

describe('CR 401.4, 608.2c: "put any number of cards from your hand on the bottom of your library, then draw that many cards plus one"', () => {
  const AWAKEN = card('Test Awakening', 'Instant', 'Put any number of cards from your hand on the bottom of your library, then draw that many cards plus one.');
  it('two cards on the bottom: three drawn', () => {
    expect(automated(AWAKEN)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Awakening', 'Test Rock', 'Test Rock'] }, defs: [AWAKEN, ROCK] });
    const rocks = s0.zones.hand['p1']!.filter((id) => s0.objects[id]!.defId === 'Test Rock');
    let s = pass(pass(castWith(s0, 'Test Awakening')));
    expect(s.pending?.kind).toBe('chooseObjects');
    s = answer(s, { kind: 'chooseObjects', ids: rocks });
    if (s.pending?.kind === 'order') s = answer(s, { kind: 'order', ids: s.pending.items.map((x) => x.id) });
    s = settle(s);
    expect(s.zones.hand['p1']!.length).toBe(3);
    expect(zoneNames(s, 'hand', 'p1')).not.toContain('Test Rock');
    expect(zoneNames(s, 'library', 'p1').slice(-2)).toEqual(['Test Rock', 'Test Rock']);
  });
});

describe('CR 121.2: "each opponent draws a card, then you draw a card for each opponent who drew a card this way"', () => {
  const DEAL = card('Test Deal', 'Sorcery', 'Each opponent draws a card, then you draw a card for each opponent who drew a card this way.');
  it('the opponent draws one, you draw one', () => {
    expect(automated(DEAL)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Deal'] }, defs: [DEAL] });
    const s = resolve(castWith(s0, 'Test Deal'));
    expect(s.zones.hand['p1']!.length).toBe(1);
    expect(s.zones.hand['p2']!.length).toBe(1);
  });
  it('an opponent who cannot draw (an empty library) gives you nothing', () => {
    const s0 = tweak(scenario([], { p1: { hand: ['Test Deal'] }, defs: [DEAL] }), (t) => { for (const id of t.zones.library['p2']!) delete t.objects[id]; t.zones.library['p2'] = []; });
    const s = resolve(castWith(s0, 'Test Deal'));
    expect(s.zones.hand['p1']!.length).toBe(0);
  });
});
