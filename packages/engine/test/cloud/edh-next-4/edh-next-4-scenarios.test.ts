/**
 * Commander lane edh-next, round edh-next-4: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default
 * compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive
 * Rules of 2026-09-25 (see the round's record).
 *
 *   CR 205.1b, 611.2a, 611.2c, 613.1d   "All lands become 2/2 creatures until end of turn. They're still lands." (Natural Affinity); "Until end of turn, lands you control become
 *                                       2/2 creatures that are still lands." (Rude Awakening); "Until end of turn, ~ becomes a 2/3 Construct artifact creature. It's still a land." (Frostwalk Bastion)
 *   CR 205.1a, 613.4b, 613.1f           "Target creature becomes a Frog with base power and toughness 3/3 until end of turn." (Omnibian); "... and flying" (Eccentric Apprentice)
 *   CR 613.4d, 611.2a                   "Switch the power and toughness of each of up to two target creatures until end of turn." (Invert // Invent, Inversion Behemoth)
 *   CR 615.1a, 510.1, 120.2             "Prevent all combat damage that other creatures would deal this turn." (Haze Frog); "... that would be dealt by creatures other than target creature this turn." (Terrifying Presence)
 *   CR 121.1, 119.3, 701.17a, 122.1f    "Target player mills two cards, draws two cards, and loses 2 life." (Atrocious Experiment); "You draw two cards, lose 2 life, then mill two cards." (Funeral Rites);
 *                                       "... draws three cards, loses 3 life, and gets three poison counters." (Caress of Phyrexia); "loses X life and mills X cards, where X is ..." (Lich Lord of Unx)
 *   CR 702.95b, 613.1f, 613.4c          "As long as ~ is paired with another creature, both creatures have double strike." (Silverblade Paladin); "... each of those creatures gets +2/+2." (Druid's Familiar)
 *   CR 121.1, 614.17                    "Players can't draw cards." (Maralen of the Mornsong)
 */
import { describe, expect, it } from 'vitest';
import { getChars, type CardDef, type GameState, type ObjectId, type TargetChoice } from '../../../src/index';
import { act, answer, find, life, put, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';
import { card, full, pt, resolveAll, settle } from '../cmd3/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const plr = (id: string): TargetChoice => ({ kind: 'player', id } as TargetChoice);
const hasType = (s: GameState, id: ObjectId, t: string): boolean => getChars(s, id)!.types.includes(t as never);
const kw = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword?: string }).keyword ?? ''));
const dmg = (s: GameState, id: ObjectId): number => s.objects[id]!.damage ?? 0;
const handSize = (s: GameState, p: string): number => s.zones.hand[p]!.length;
const yardSize = (s: GameState, p: string): number => s.zones.graveyard[p]!.length;
const poison = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.poison;

const AFFINITY = card('Test Affinity', 'Sorcery', "All lands become 2/2 creatures until end of turn. They're still lands.");
const AWAKE = card('Test Awake', 'Sorcery', 'Until end of turn, lands you control become 2/2 creatures that are still lands.');
const BASTION = card('Test Bastion', 'Land', "{0}: Until end of turn, ~ becomes a 2/3 Construct artifact creature. It's still a land.");
const FROG = card('Test Frogger', 'Artifact', '{0}: Target creature becomes a Frog with base power and toughness 3/3 until end of turn.');
const BIRD = card('Test Birder', 'Artifact', '{0}: Up to one target creature becomes a Bird with base power and toughness 1/1 and flying until end of turn.');
const INVERT = card('Test Inverter', 'Artifact', '{0}: Switch the power and toughness of each of up to two target creatures until end of turn.');
const PUMP = card('Test Pump', 'Instant', 'Target creature gets +1/+1 until end of turn.');
const HAZE = card('Test Haze', 'Creature — Frog', '{0}: Prevent all combat damage that other creatures would deal this turn.', ['1', '1']);
const PRESENCE = card('Test Presence', 'Instant', 'Prevent all combat damage that would be dealt by creatures other than target creature this turn.');
const EXPERIMENT = card('Test Experiment', 'Sorcery', 'Target player mills two cards, draws two cards, and loses 2 life.');
const RITES = card('Test Rites', 'Sorcery', 'You draw two cards, lose 2 life, then mill two cards.');
const CARESS = card('Test Caress', 'Sorcery', 'Target player draws three cards, loses 3 life, and gets three poison counters.');
const LORD = card('Test Lord', 'Sorcery', 'Target player loses X life and mills X cards, where X is the number of Zombies you control.');
const PALADIN = card('Test Paladin', 'Creature — Human Knight', 'Soulbond (You may pair this creature with another unpaired creature when either enters. They remain paired for as long as you control both of them.)\nAs long as this creature is paired with another creature, both creatures have double strike.', ['2', '2']);
const FAMILIAR = card('Test Familiar', 'Creature — Wolf', 'Soulbond (You may pair this creature with another unpaired creature when either enters. They remain paired for as long as you control both of them.)\nAs long as this creature is paired with another creature, each of those creatures gets +2/+2.', ['1', '1']);
const MARALEN = card('Test Maralen', 'Creature — Elf Wizard', "Players can't draw cards.", ['2', '3']);
const DRAWER = card('Test Drawer', 'Sorcery', 'Draw two cards.');
const BEAR = card('Test Bear', 'Creature — Bear Warrior', 'Flying', ['2', '2']);
const BIG = card('Test Big', 'Creature — Giant', '', ['4', '4']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);
const ZOMBIE = card('Test Zombie', 'Creature — Zombie', '', ['1', '1']);
const FISSURE = card('Test Fissure', 'Instant', 'Prevent all combat damage that would be dealt this turn by creatures target opponent controls.');
const JOLT = card('Test Jolt', 'Instant', "All lands target player controls become 3/3 creatures until end of turn. They're still lands.");
const WALL = card('Test Wall', 'Creature — Wall', '', ['2', '5']);
const DEFS: CardDef[] = [FISSURE, JOLT, AFFINITY, AWAKE, BASTION, FROG, BIRD, INVERT, PUMP, HAZE, PRESENCE, EXPERIMENT, RITES, CARESS, LORD, PALADIN, FAMILIAR, MARALEN, DRAWER, BEAR, BIG, OGRE, ZOMBIE, WALL];

/** p1 casts a card from the hand, answers targets/costs, and lets the stack resolve. */
function cast(s0: GameState, name: string, targets: TargetChoice[] = []): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  for (let g = 0; s.pending && s.pending.kind !== 'priority' && g < 20; g++) {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return resolveAll(s);
}
/** p1 activates the first ability of a permanent. */
function activate(s0: GameState, source: ObjectId, targets: TargetChoice[] = []): GameState {
  let s = act(s0, { type: 'activate', player: 'p1', source, ability: 'p:0:0' });
  for (let g = 0; s.pending && s.pending.kind !== 'priority' && g < 20; g++) {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return resolveAll(s);
}
const lands = (s: GameState, owner: string): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Plains' && s.objects[id]!.controller === owner);
/** Pass until it is turn `n`, declaring nothing. */
function toTurn(s0: GameState, n: number): GameState {
  let s = s0;
  for (let i = 0; i < 300 && s.turn.number < n; i++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player } as never);
    else s = settle(s);
  }
  return s;
}

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 205.1b, 611.2c, 613.1d: "All lands become 2/2 creatures until end of turn. They\'re still lands."', () => {
  const game = (): GameState => scenario([], { p1: { hand: ['Test Affinity'], battlefield: ['Plains', 'Plains'] }, p2: { battlefield: ['Plains'] }, defs: DEFS });
  it('every land of every player is a 2/2 creature that is still a land; a land that enters later is not (the set is fixed as the spell resolves)', () => {
    const s = cast(game(), 'Test Affinity');
    for (const id of [...lands(s, 'p1'), ...lands(s, 'p2')]) { expect(pt(s, id)).toBe('2/2'); expect(hasType(s, id, 'Creature')).toBe(true); expect(hasType(s, id, 'Land')).toBe(true); }
  });
  it('a land that enters after the spell resolved is not a creature (CR 611.2c)', () => {
    const s = cast(game(), 'Test Affinity');
    const later = tweak(s, (g) => { put(g, 'p2', 'battlefield', 'Plains'); });
    const fresh = lands(later, 'p2').find((id) => !lands(s, 'p2').includes(id))!;
    expect(hasType(later, fresh, 'Creature')).toBe(false);
  });
  it('the effect ends at the end of the turn', () => {
    const s0 = cast(game(), 'Test Affinity');
    const id = lands(s0, 'p1')[0]!;
    const s = toTurn(s0, 2);
    expect(s.turn.number).toBe(2);
    expect(hasType(s, id, 'Creature')).toBe(false);
    expect(hasType(s, id, 'Land')).toBe(true);
  });
});

describe('CR 205.1b, 611.2c: "Until end of turn, lands you control become 2/2 creatures that are still lands."', () => {
  it('your lands are 2/2 creatures and still lands; an opponent\'s land is unchanged', () => {
    const s = cast(scenario([], { p1: { hand: ['Test Awake'], battlefield: ['Plains', 'Plains'] }, p2: { battlefield: ['Plains'] }, defs: DEFS }), 'Test Awake');
    for (const id of lands(s, 'p1')) { expect(pt(s, id)).toBe('2/2'); expect(hasType(s, id, 'Creature')).toBe(true); expect(hasType(s, id, 'Land')).toBe(true); }
    expect(hasType(s, lands(s, 'p2')[0]!, 'Creature')).toBe(false);
  });
});

describe('CR 205.1b, 613.1d: "Until end of turn, ~ becomes a 2/3 Construct artifact creature. It\'s still a land."', () => {
  it('the land is a 2/3 Construct artifact creature that is still a land; it is a plain land again next turn', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bastion'] }, defs: DEFS });
    const id = find(s0, 'Test Bastion', 'battlefield');
    const s = activate(s0, id);
    expect(pt(s, id)).toBe('2/3');
    for (const t of ['Land', 'Artifact', 'Creature']) expect(hasType(s, id, t), t).toBe(true);
    expect(getChars(s, id)!.subtypes).toContain('Construct');
    const later = toTurn(s, 2);
    expect(hasType(later, id, 'Creature')).toBe(false);
    expect(hasType(later, id, 'Land')).toBe(true);
  });
});

describe('CR 205.1a, 613.4b: "Target creature becomes a Frog with base power and toughness 3/3 until end of turn."', () => {
  const game = (): GameState => scenario([], { p1: { hand: ['Test Pump'], battlefield: ['Test Frogger', 'Test Bear', 'Test Big'] }, defs: DEFS });
  it('it loses its other creature types, keeps its abilities, and has base 3/3 (counters and other effects still apply)', () => {
    const s0 = game();
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s = activate(s0, find(s0, 'Test Frogger', 'battlefield'), [obj(bear)]);
    expect(pt(s, bear)).toBe('3/3');
    expect(getChars(s, bear)!.subtypes).toEqual(['Frog']);
    expect(hasType(s, bear, 'Creature')).toBe(true);
    expect(kw(s, bear)).toContain('flying');
    const pumped = cast(s, 'Test Pump', [obj(bear)]);
    expect(pt(pumped, bear)).toBe('4/4');
  });
  it('a creature that was not chosen is unchanged, and the effect ends at the end of the turn', () => {
    const s0 = game();
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s = activate(s0, find(s0, 'Test Frogger', 'battlefield'), [obj(bear)]);
    expect(pt(s, find(s, 'Test Big', 'battlefield'))).toBe('4/4');
    const later = toTurn(s, 2);
    expect(pt(later, bear)).toBe('2/2');
    expect(getChars(later, bear)!.subtypes).toContain('Bear');
  });
});

describe('CR 205.1a, 613.1f, 613.4b: "Up to one target creature becomes a Bird with base power and toughness 1/1 and flying until end of turn."', () => {
  it('the chosen creature is a 1/1 Bird with flying; with no target nothing changes', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Birder', 'Test Big'] }, defs: DEFS });
    const big = find(s0, 'Test Big', 'battlefield');
    const s = activate(s0, find(s0, 'Test Birder', 'battlefield'), [obj(big)]);
    expect(pt(s, big)).toBe('1/1');
    expect(getChars(s, big)!.subtypes).toEqual(['Bird']);
    expect(kw(s, big)).toContain('flying');
    const none = activate(s0, find(s0, 'Test Birder', 'battlefield'), []);
    expect(pt(none, big)).toBe('4/4');
    expect(kw(none, big)).not.toContain('flying');
  });
});

describe('CR 613.4d, 611.2a: "Switch the power and toughness of each of up to two target creatures until end of turn."', () => {
  const game = (): GameState => scenario([], { p1: { hand: ['Test Pump'], battlefield: ['Test Inverter', 'Test Wall', 'Test Big', 'Test Bear'] }, defs: DEFS });
  it('the two chosen creatures have their power and toughness switched; the third is unchanged', () => {
    const s0 = game();
    const wall = find(s0, 'Test Wall', 'battlefield');
    const big = find(s0, 'Test Big', 'battlefield');
    const s = activate(s0, find(s0, 'Test Inverter', 'battlefield'), [obj(wall), obj(big)]);
    expect(pt(s, wall)).toBe('5/2');
    expect(pt(s, big)).toBe('4/4');
    expect(pt(s, find(s, 'Test Bear', 'battlefield'))).toBe('2/2');
  });
  it('the switch comes after +1/+1 effects (layer 7d after 7c): a pumped 2/5 is 6/3, not 5/2 plus one', () => {
    const s0 = game();
    const wall = find(s0, 'Test Wall', 'battlefield');
    const pumped = cast(s0, 'Test Pump', [obj(wall)]);
    const s = activate(pumped, find(pumped, 'Test Inverter', 'battlefield'), [obj(wall)]);
    expect(pt(s, wall)).toBe('6/3');
  });
  it('one target is enough ("up to two"), and the effect ends at the end of the turn', () => {
    const s0 = game();
    const wall = find(s0, 'Test Wall', 'battlefield');
    const s = activate(s0, find(s0, 'Test Inverter', 'battlefield'), [obj(wall)]);
    expect(pt(s, wall)).toBe('5/2');
    expect(pt(toTurn(s, 2), wall)).toBe('2/5');
  });
});

describe('CR 615.1a, 510.1: "Prevent all combat damage that other creatures would deal this turn."', () => {
  const board = (): GameState => scenario([], { p1: { battlefield: ['Test Haze', 'Test Bear', 'Test Big'] }, p2: { battlefield: ['Test Ogre'] }, defs: DEFS });
  it('the damage of the other creatures, theirs and its controller\'s, is prevented; the creature itself still deals its combat damage', () => {
    let s = board();
    const haze = find(s, 'Test Haze', 'battlefield');
    const bear = find(s, 'Test Bear', 'battlefield');
    const big = find(s, 'Test Big', 'battlefield');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = activate(s, haze);
    s = declareAttackers(toDeclareAttackers(s), [[haze], [bear], [big]]);
    s = declareBlockers(toDeclareBlockers(s), [[ogre, big]]);
    s = passUntil(s, (x) => x.turn.step === 'endCombat', 'end of combat', 12);
    expect(life(s, 'p2')).toBe(19); // only the 1/1 Haze itself dealt damage; the Bear's 2 was prevented
    expect(dmg(s, big)).toBe(0);
    expect(dmg(s, ogre)).toBe(0);
  });
  it('without the effect the same combat deals damage', () => {
    let s = board();
    const bear = find(s, 'Test Bear', 'battlefield');
    const big = find(s, 'Test Big', 'battlefield');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = declareAttackers(toDeclareAttackers(s), [[bear], [big]]);
    s = declareBlockers(toDeclareBlockers(s), [[ogre, big]]);
    s = passUntil(s, (x) => x.turn.step === 'endCombat', 'end of combat', 12);
    expect(life(s, 'p2')).toBe(18);
    expect(dmg(s, big)).toBe(3);
  });
});

describe('CR 615.1, 510.2: "When this creature enters, prevent all combat damage that other creatures would deal this turn." (as printed)', () => {
  it('the combat damage of a creature already there and of one that enters after the ability resolved is prevented (the prevention is judged as each damage event happens)', () => {
    const FROGLET = card('Test Froglet', 'Creature — Frog', 'When this creature enters, prevent all combat damage that other creatures would deal this turn.', ['1', '1']);
    expect(full(FROGLET)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Froglet'], battlefield: ['Test Bear'] }, defs: [...DEFS, FROGLET] });
    const s1 = cast(s0, 'Test Froglet');
    const s2 = tweak(s1, (g) => { put(g, 'p1', 'battlefield', 'Test Big'); });
    const bear = find(s2, 'Test Bear', 'battlefield');
    const big = find(s2, 'Test Big', 'battlefield');
    let s = declareAttackers(toDeclareAttackers(s2), [[bear], [big]]);
    s = passUntil(s, (x) => x.turn.step === 'endCombat', 'end of combat', 12);
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 615.1a, 510.1, 608.2b: "Prevent all combat damage that would be dealt by creatures other than target creature this turn."', () => {
  it('the target creature still deals combat damage; every other creature\'s combat damage is prevented', () => {
    let s = scenario([], { p1: { hand: ['Test Presence'], battlefield: ['Test Zombie', 'Test Big'] }, p2: { battlefield: ['Test Ogre'] }, defs: DEFS });
    const zombie = find(s, 'Test Zombie', 'battlefield');
    const big = find(s, 'Test Big', 'battlefield');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = cast(s, 'Test Presence', [obj(zombie)]);
    s = declareAttackers(toDeclareAttackers(s), [[zombie], [big]]);
    s = declareBlockers(toDeclareBlockers(s), [[ogre, zombie]]);
    s = passUntil(s, (x) => x.turn.step === 'endCombat', 'end of combat', 12);
    expect(dmg(s, ogre)).toBe(1); // the target dealt its damage
    expect(dmg(s, zombie)).toBe(0); // the blocking Ogre is "another creature": its damage was prevented
    expect(life(s, 'p2')).toBe(20); // the unblocked Big's damage was prevented
  });
});

describe('CR 701.17a, 121.1, 119.3: "Target player mills two cards, draws two cards, and loses 2 life."', () => {
  const lib = ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'];
  it('the player mills first, then draws, then loses life; the cards drawn are not the milled ones', () => {
    const s0 = scenario([], { p1: { hand: ['Test Experiment'] }, p2: { library: lib }, defs: DEFS });
    const s = cast(s0, 'Test Experiment', [plr('p2')]);
    expect(yardSize(s, 'p2')).toBe(2);
    expect(handSize(s, 'p2')).toBe(2);
    expect(life(s, 'p2')).toBe(18);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 121.1, 119.3, 701.17a: "You draw two cards, lose 2 life, then mill two cards."', () => {
  it('you draw two, lose 2 and mill the next two of the library', () => {
    const s0 = scenario([], { p1: { hand: ['Test Rites'], library: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'] }, defs: DEFS });
    const s = cast(s0, 'Test Rites');
    expect(handSize(s, 'p1')).toBe(2);
    expect(yardSize(s, 'p1')).toBe(3); // the spell itself and the two milled cards
    expect(life(s, 'p1')).toBe(18);
  });
});

describe('CR 121.1, 119.3, 122.1f: "Target player draws three cards, loses 3 life, and gets three poison counters."', () => {
  it('the target draws, loses life and gets poison counters; the caster is untouched', () => {
    const s0 = scenario([], { p1: { hand: ['Test Caress'] }, p2: { library: ['Plains', 'Plains', 'Plains', 'Plains'] }, defs: DEFS });
    const s = cast(s0, 'Test Caress', [plr('p2')]);
    expect(handSize(s, 'p2')).toBe(3);
    expect(life(s, 'p2')).toBe(17);
    expect(poison(s, 'p2')).toBe(3);
    expect(poison(s, 'p1')).toBe(0);
  });
});

describe('CR 107.3, 608.2h, 119.3, 701.17a: "Target player loses X life and mills X cards, where X is the number of Zombies you control."', () => {
  it('X is the number of Zombies you control as it resolves', () => {
    const s0 = scenario([], { p1: { hand: ['Test Lord'], battlefield: ['Test Zombie', 'Test Zombie', 'Test Bear'] }, p2: { library: ['Plains', 'Plains', 'Plains', 'Plains'] }, defs: DEFS });
    const s = cast(s0, 'Test Lord', [plr('p2')]);
    expect(life(s, 'p2')).toBe(18);
    expect(yardSize(s, 'p2')).toBe(2);
  });
  it('with no Zombie X is 0: no life lost, nothing milled', () => {
    const s0 = scenario([], { p1: { hand: ['Test Lord'], battlefield: ['Test Bear'] }, p2: { library: ['Plains', 'Plains'] }, defs: DEFS });
    const s = cast(s0, 'Test Lord', [plr('p2')]);
    expect(life(s, 'p2')).toBe(20);
    expect(yardSize(s, 'p2')).toBe(0);
  });
});

describe('CR 702.95b, 613.1f, 613.4c: soulbond statics "both creatures have double strike" / "each of those creatures gets +2/+2"', () => {
  /** Test setup: two creatures of p1 already paired (as the pair op leaves them, CR 702.95b). */
  const pairUp = (s: GameState, a: string, b: string): GameState => {
    const t = structuredClone(s);
    const x = t.objects[find(t, a, 'battlefield', 'p1')]!;
    const y = t.objects[find(t, b, 'battlefield', 'p1')]!;
    x.pairedWith = y.id; y.pairedWith = x.id; x.pairedBy = y.pairedBy = 'p1';
    return t;
  };
  it('paired: both creatures have double strike; unpaired: neither does', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Paladin', 'Test Bear', 'Test Big'] }, defs: DEFS });
    const s = pairUp(s0, 'Test Paladin', 'Test Bear');
    expect(kw(s, find(s, 'Test Paladin', 'battlefield'))).toContain('double strike');
    expect(kw(s, find(s, 'Test Bear', 'battlefield'))).toContain('double strike');
    expect(kw(s, find(s, 'Test Big', 'battlefield'))).not.toContain('double strike');
    expect(kw(s0, find(s0, 'Test Paladin', 'battlefield'))).not.toContain('double strike');
  });
  it('paired: each of the two gets +2/+2; a third creature and an unpaired source do not', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Familiar', 'Test Bear', 'Test Big'] }, defs: DEFS });
    const s = pairUp(s0, 'Test Familiar', 'Test Bear');
    expect(pt(s, find(s, 'Test Familiar', 'battlefield'))).toBe('3/3');
    expect(pt(s, find(s, 'Test Bear', 'battlefield'))).toBe('4/4');
    expect(pt(s, find(s, 'Test Big', 'battlefield'))).toBe('4/4');
    expect(pt(s0, find(s0, 'Test Familiar', 'battlefield'))).toBe('1/1');
    const un = structuredClone(s);
    for (const o of Object.values(un.objects)) { delete o.pairedWith; delete o.pairedBy; }
    expect(pt(un, find(un, 'Test Bear', 'battlefield'))).toBe('2/2'); // unpaired: the bonus is gone at once
  });
});

describe('CR 121.1, 614.17: "Players can\'t draw cards."', () => {
  it('while the creature is on the battlefield nobody draws; without it a draw happens', () => {
    const lib = ['Plains', 'Plains', 'Plains'];
    const blocked = scenario([], { p1: { hand: ['Test Drawer'], battlefield: ['Test Maralen'], library: lib }, defs: DEFS });
    const s = cast(blocked, 'Test Drawer');
    expect(handSize(s, 'p1')).toBe(0);
    const free = scenario([], { p1: { hand: ['Test Drawer'], library: lib }, defs: DEFS });
    expect(handSize(cast(free, 'Test Drawer'), 'p1')).toBe(2);
  });
  it('the draw step draws nothing and an empty library does not lose the game (the rulings)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Maralen'] }, defs: DEFS });
    const s = toTurn(s0, 2);
    expect(s.turn.number).toBe(2);
    expect(s.players.find((x) => x.id === 'p2')!.lostReason).toBeUndefined();
  });
});

describe('CR 615.1a, 510.2, 608.2b: "Prevent all combat damage that would be dealt this turn by creatures target opponent controls." (the rendering of a target player named once)', () => {
  it('the combat damage of the creatures that opponent controls is prevented; your own creature still deals its damage', () => {
    let s = scenario([], { p1: { hand: ['Test Fissure'], battlefield: ['Test Big', 'Test Zombie'] }, p2: { battlefield: ['Test Ogre'] }, defs: DEFS });
    const big = find(s, 'Test Big', 'battlefield');
    const zombie = find(s, 'Test Zombie', 'battlefield');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = cast(s, 'Test Fissure', [plr('p2')]);
    s = declareAttackers(toDeclareAttackers(s), [[big], [zombie]]);
    s = declareBlockers(toDeclareBlockers(s), [[ogre, big]]);
    s = passUntil(s, (x) => x.turn.step === 'endCombat', 'end of combat', 12);
    expect(dmg(s, big)).toBe(0); // the blocking Ogre's damage was prevented
    expect(s.zones.graveyard['p2']!.length).toBe(1); // the Big's 4 damage killed the Ogre
    expect(life(s, 'p2')).toBe(19); // the unblocked Zombie dealt its damage
  });
});

describe('CR 205.1b, 611.2c, 613.4b: "All lands target player controls become 3/3 creatures until end of turn. They\'re still lands."', () => {
  it('only the lands the target player controls are 3/3 creatures that are still lands; the caster\'s lands are not', () => {
    const s0 = scenario([], { p1: { hand: ['Test Jolt'], battlefield: ['Plains'] }, p2: { battlefield: ['Plains', 'Plains'] }, defs: DEFS });
    const s = cast(s0, 'Test Jolt', [plr('p2')]);
    for (const id of lands(s, 'p2')) { expect(pt(s, id)).toBe('3/3'); expect(hasType(s, id, 'Land')).toBe(true); expect(hasType(s, id, 'Creature')).toBe(true); }
    expect(hasType(s, lands(s, 'p1')[0]!, 'Creature')).toBe(false);
  });
});
