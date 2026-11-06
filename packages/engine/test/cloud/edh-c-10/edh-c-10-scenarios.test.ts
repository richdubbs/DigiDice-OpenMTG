/**
 * Commander lane edh-c, round edh-c-10: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 * Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 701.23a, 406.3            "Search target player's library for a card and exile it. Then that player shuffles."
 *   CR 701.15a, 122.1            "put a +1/+1 counter on target creature and goad it" (a dies trigger)
 *   CR 120.3, 611.2a, 613.1f     "~ deals 2 damage to target player and gains indestructible until end of turn"
 *   CR 701.8a, 701.19c, 105.1    "destroy all other creatures that share a color with it. They can't be regenerated."
 *   CR 510.1a, 613.11            "As long as enchanted creature has vigilance, it assigns combat damage equal to its toughness rather than its power."
 *   CR 602.5b, 402.1             "Activate only if you have exactly zero or seven cards in hand."
 *   CR 404.1, 110.2a             "Put up to two creature cards from graveyards onto the battlefield under your control."
 *   CR 108.3, 608.2h             "return to its owner's hand each creature that player controls with power greater than the number of cards in their hand"
 *   CR 105.1, 615.1              "As long as you control a permanent of each color, prevent all damage that would be dealt to you."
 *   CR 701.21a, 111.2, 608.2h    "Target creature's controller sacrifices it, then creates X tokens, where X is that creature's power."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, legal, pass, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', loyalty?: string, colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}), ...(loyalty ? { loyalty } : {}) } as OracleCard);
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
/** Pass (declaring no attackers when asked) until turn `n` begins. */
function toTurn(s0: GameState, n: number): GameState {
  let s = s0;
  for (let i = 0; i < 400 && !(s.turn.number >= n && s.turn.step === 'main1'); i++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = pass(s);
    else s = settle(s, {});
  }
  return s;
}
const names = (s: GameState, name: string, zone: 'battlefield' | 'hand' | 'graveyard' | 'library' = 'battlefield'): ObjectId[] =>
  Object.values(s.objects).filter((o) => o.zone === zone && (o.kind === 'token' ? getChars(s, o.id)?.name === name : s.defs[o.defId]?.name === name)).map((o) => o.id);
const byName = (s: GameState, name: string, zone: 'battlefield' | 'hand' | 'graveyard' | 'library' = 'battlefield', owner?: string): ObjectId =>
  Object.values(s.objects).find((o) => s.defs[o.defId]?.name === name && o.zone === zone && (owner === undefined || o.owner === owner))!.id;
const stat = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const hasType = (s: GameState, id: ObjectId, t: string): boolean => getChars(s, id)!.types.includes(t as never);
const kw = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword?: string }).keyword ?? ''));
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const setLife = (s: GameState, p: string, life: number): GameState => tweak(s, (g) => { g.players.find((x) => x.id === p)!.life = life; });

import { assignsCombatDamageAsToughness } from '../../../src/statics/hooks';

const BEAR_C = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const EXTRACT = card('Test Extract', 'Sorcery', "Search target player's library for a card and exile it. Then that player shuffles.");
const BHAAL = card('Test Murderer', 'Legendary Creature — God', 'Whenever another nontoken creature you control dies, put a +1/+1 counter on target creature and goad it.', ['4', '4']);
const SLAYER = card('Test Slayer', 'Instant', 'Destroy target creature.');
const ELLIE = card('Test Hunter', 'Legendary Creature — Human Survivor', '{0}, Sacrifice another creature: ~ deals 2 damage to target player and gains indestructible until end of turn.', ['3', '3']);
const PLAGUE = card('Test Plague', 'Enchantment', "Whenever a creature enters, destroy all other creatures that share a color with it. They can't be regenerated.");
const GREEN_A = card('Test Green A', 'Creature — Elf', '', ['2', '2'], '{0}', undefined, ['G']);
const GREEN_B = card('Test Green B', 'Creature — Elf', '', ['2', '2'], '{0}', undefined, ['G']);
const GREEN_NEW = card('Test Green New', 'Creature — Elf', '', ['2', '2'], '{0}', undefined, ['G']);
const RED_A = card('Test Red A', 'Creature — Goblin', '', ['2', '2'], '{0}', undefined, ['R']);
const GOLD_A = card('Test Gold A', 'Creature — Elf Goblin', '', ['2', '2'], '{0}', undefined, ['R', 'G']);
const COLORLESS_NEW = card('Test Colorless New', 'Artifact Creature — Golem', '', ['2', '2']);
const REGEN = card('Test Regen', 'Creature — Elf', '{0}: Regenerate ~.', ['2', '2'], '{0}', undefined, ['G']);
const FOOTING = card('Test Footing', 'Enchantment — Aura', 'Enchant creature\nAs long as enchanted creature has vigilance, it assigns combat damage equal to its toughness rather than its power.');
const TALL = card('Test Tall', 'Creature — Wall', '', ['1', '4']);
const TALL_VIG = card('Test Tall Vigilance', 'Creature — Wall', 'Vigilance', ['1', '4']);
const BIBLIO = card('Test Library', 'Land', '{2}, {T}: Draw a card. Activate only if you have exactly zero or seven cards in hand.');
const NECRO = card('Test Necro', 'Sorcery', 'Put up to two creature cards from graveyards onto the battlefield under your control.');
const SCALES = card('Test Scales', 'Artifact', "At the beginning of each player's upkeep, return to its owner's hand each creature that player controls with power greater than the number of cards in their hand.");
const BIG = card('Test Big', 'Creature — Ogre', '', ['3', '3']);
const TWO = card('Test Two', 'Creature — Ogre', '', ['2', '2']);
const SMALL = card('Test Small', 'Creature — Ogre', '', ['1', '1']);
const RESIST = card('Test Resist', 'Enchantment', 'As long as you control a permanent of each color, prevent all damage that would be dealt to you.');
const PERM_W = card('Test White', 'Enchantment', '', undefined, '{0}', undefined, ['W']);
const PERM_U = card('Test Blue', 'Enchantment', '', undefined, '{0}', undefined, ['U']);
const PERM_B = card('Test Black', 'Enchantment', '', undefined, '{0}', undefined, ['B']);
const PERM_R = card('Test Redd', 'Enchantment', '', undefined, '{0}', undefined, ['R']);
const PERM_G = card('Test Greenn', 'Enchantment', '', undefined, '{0}', undefined, ['G']);
const PERM_RG = card('Test Gold', 'Enchantment', '', undefined, '{0}', undefined, ['R', 'G']);
const PINGER = card('Test Pinger', 'Creature — Wizard', '{0}: ~ deals 3 damage to target player.', ['1', '1']);
const MERCY = card('Test Mercy', 'Instant', "Target creature's controller sacrifices it, then creates X 1/1 green and white Elf Warrior creature tokens, where X is that creature's power.");

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [EXTRACT, BHAAL, SLAYER, ELLIE, PLAGUE, FOOTING, BIBLIO, NECRO, SCALES, RESIST, PINGER, MERCY]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 701.23a, 406.3: "Search target player\'s library for a card and exile it. Then that player shuffles."', () => {
  const game = () => mpScenario({ players: 3, defs: [EXTRACT, BEAR_C], zones: { p1: { hand: ['Test Extract'] }, p2: { library: ['Test Bear'] } } });
  it('you search the target player\'s library, the chosen card is exiled (face up) from it and that library is one card smaller', () => {
    const s0 = game();
    const bear = byName(s0, 'Test Bear', 'library', 'p2');
    const s = cast(s0, 'Test Extract', { targets: [[plr('p2')]], answers: [{ kind: 'chooseObjects', ids: [bear] }] });
    expect(names(s, 'Test Bear', 'library').length).toBe(0);
    const exiled = Object.values(s.objects).filter((o) => o.zone === 'exile' && s.defs[o.defId]?.name === 'Test Bear');
    expect(exiled.length).toBe(1);
    expect(exiled[0]!.owner).toBe('p2');
    expect(s.zones.library['p2']!.length).toBe(s0.zones.library['p2']!.length - 1);
  });
  it('only the target\'s library is searched: another player\'s library keeps its size, and a card cannot be skipped (a search for "a card" finds one)', () => {
    const s0 = game();
    const bear = byName(s0, 'Test Bear', 'library', 'p2');
    const s = cast(s0, 'Test Extract', { targets: [[plr('p2')]], answers: [{ kind: 'chooseObjects', ids: [bear] }] });
    expect(s.zones.library['p1']!.length).toBe(s0.zones.library['p1']!.length);
    expect(s.zones.library['p3']!.length).toBe(s0.zones.library['p3']!.length);
    expect(() => cast(game(), 'Test Extract', { targets: [[plr('p2')]], answers: [{ kind: 'chooseObjects', ids: [] }] })).toThrow(/Choose exactly 1/);
  });
});

describe('CR 701.15a, 122.1: "Whenever another nontoken creature you control dies, put a +1/+1 counter on target creature and goad it."', () => {
  const game = () => mpScenario({ players: 3, defs: [BHAAL, SLAYER, BEAR_C, BIG], zones: { p1: { battlefield: ['Test Murderer', 'Test Bear'], hand: ['Test Slayer'] }, p2: { battlefield: ['Test Big'] } } });
  it('the dying creature\'s trigger gives one target creature a +1/+1 counter and goads it', () => {
    const s0 = game();
    const s = cast(s0, 'Test Slayer', { targets: [[obj(byName(s0, 'Test Bear'))], [obj(byName(s0, 'Test Big'))]] });
    const big = byName(s, 'Test Big');
    expect(s.objects[big]!.counters?.['+1/+1']).toBe(1);
    expect(s.objects[big]!.goaded?.map((g) => g.by)).toEqual(['p1']);
    expect(stat(s, big)).toBe('4/4');
  });
  it('Murderer itself dying, or a creature of another player dying, does not trigger it', () => {
    const s0 = game();
    const s = cast(s0, 'Test Slayer', { targets: [[obj(byName(s0, 'Test Big'))]] });
    expect(s.zones.stack.length).toBe(0);
    expect(s.objects[byName(s, 'Test Murderer')]!.counters?.['+1/+1']).toBeUndefined();
    const t = cast(s0, 'Test Slayer', { targets: [[obj(byName(s0, 'Test Murderer'))]] });
    expect(t.zones.stack.length).toBe(0);
    expect(names(t, 'Test Murderer').length).toBe(0);
    expect(t.objects[byName(t, 'Test Bear')]!.counters?.['+1/+1']).toBeUndefined();
  });
});

describe('CR 120.3, 611.2a, 613.1f: "~ deals 2 damage to target player and gains indestructible until end of turn."', () => {
  it('the target player loses 2 life and the source (not the sacrificed creature) is indestructible until end of turn, then not', () => {
    const s0 = mpScenario({ players: 3, defs: [ELLIE, BEAR_C], zones: { p1: { battlefield: ['Test Hunter', 'Test Bear'] } } });
    const s = activate(s0, byName(s0, 'Test Hunter'), { targets: [[plr('p2')]], answers: [{ kind: 'chooseObjects', ids: [byName(s0, 'Test Bear')] }] });
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(kw(s, byName(s, 'Test Hunter'))).toContain('indestructible');
    expect(names(s, 'Test Bear').length).toBe(0);
    expect(names(s, 'Test Bear', 'graveyard').length).toBe(1);
    const later = toTurn(s, 2);
    expect(kw(later, byName(later, 'Test Hunter'))).not.toContain('indestructible');
  });
  it('another player is not damaged', () => {
    const s0 = mpScenario({ players: 3, defs: [ELLIE, BEAR_C], zones: { p1: { battlefield: ['Test Hunter', 'Test Bear'] } } });
    const s = activate(s0, byName(s0, 'Test Hunter'), { targets: [[plr('p2')]], answers: [{ kind: 'chooseObjects', ids: [byName(s0, 'Test Bear')] }] });
    expect(lifeOf(s, 'p3')).toBe(lifeOf(s0, 'p3'));
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1'));
  });
});

describe('CR 701.8a, 701.19c, 105.1: "Whenever a creature enters, destroy all other creatures that share a color with it. They can\'t be regenerated."', () => {
  const game = (extra: string[] = []) => mpScenario({ players: 3, defs: [PLAGUE, GREEN_A, GREEN_B, GREEN_NEW, RED_A, GOLD_A, COLORLESS_NEW, REGEN], zones: { p1: { battlefield: ['Test Plague', 'Test Green A', 'Test Red A', ...extra], hand: ['Test Green New', 'Test Colorless New'] }, p2: { battlefield: ['Test Green B'] } } });
  it('a green creature entering destroys the other green creatures of every player, not the red one and not itself', () => {
    const s = cast(game(), 'Test Green New', {});
    expect(names(s, 'Test Green A').length).toBe(0);
    expect(names(s, 'Test Green B').length).toBe(0);
    expect(names(s, 'Test Red A').length).toBe(1);
    expect(names(s, 'Test Green New').length).toBe(1);
  });
  it('a multicolored creature shares a color with each of its colors: the red and the green creature both die, the entering colorless creature destroys nothing', () => {
    const s0 = mpScenario({ players: 3, defs: [PLAGUE, GREEN_A, RED_A, GOLD_A, COLORLESS_NEW], zones: { p1: { battlefield: ['Test Plague', 'Test Green A', 'Test Red A'], hand: ['Test Gold A', 'Test Colorless New'] } } });
    const s = cast(s0, 'Test Gold A', {});
    expect(names(s, 'Test Green A').length + names(s, 'Test Red A').length).toBe(0);
    expect(names(s, 'Test Gold A').length).toBe(1);
    const t0 = mpScenario({ players: 3, defs: [PLAGUE, GREEN_A, COLORLESS_NEW], zones: { p1: { battlefield: ['Test Plague', 'Test Green A'], hand: ['Test Colorless New'] } } });
    const t = cast(t0, 'Test Colorless New', {});
    expect(names(t, 'Test Green A').length).toBe(1);
  });
  it('regeneration does not save a destroyed creature ("They can\'t be regenerated")', () => {
    const s0 = mpScenario({ players: 3, defs: [PLAGUE, REGEN, GREEN_NEW], zones: { p1: { battlefield: ['Test Plague', 'Test Regen'], hand: ['Test Green New'] } } });
    const shielded = activate(s0, byName(s0, 'Test Regen'), {});
    const s = cast(shielded, 'Test Green New', {});
    expect(names(s, 'Test Regen').length).toBe(0);
  });
});

describe('CR 510.1a, 613.11: "As long as enchanted creature has vigilance, it assigns combat damage equal to its toughness rather than its power."', () => {
  const game = (target: string) => mpScenario({ players: 3, defs: [FOOTING, TALL, TALL_VIG], zones: { p1: { battlefield: [target], hand: ['Test Footing'] } } });
  it('with vigilance the creature assigns damage as its toughness (4), its power stays 1; without vigilance it does not', () => {
    const s0 = game('Test Tall Vigilance');
    const s = cast(s0, 'Test Footing', { targets: [[obj(byName(s0, 'Test Tall Vigilance'))]] });
    const id = byName(s, 'Test Tall Vigilance');
    expect(assignsCombatDamageAsToughness(s, id, getChars(s, id)!)).toBe(true);
    expect(stat(s, id)).toBe('1/4');
    const t0 = game('Test Tall');
    const t = cast(t0, 'Test Footing', { targets: [[obj(byName(t0, 'Test Tall'))]] });
    const tid = byName(t, 'Test Tall');
    expect(assignsCombatDamageAsToughness(t, tid, getChars(t, tid)!)).toBe(false);
  });
  it('another creature of the same player does not assign as its toughness', () => {
    const s0 = mpScenario({ players: 3, defs: [FOOTING, TALL, TALL_VIG], zones: { p1: { battlefield: ['Test Tall Vigilance', 'Test Tall'], hand: ['Test Footing'] } } });
    const s = cast(s0, 'Test Footing', { targets: [[obj(byName(s0, 'Test Tall Vigilance'))]] });
    expect(assignsCombatDamageAsToughness(s, byName(s, 'Test Tall'), getChars(s, byName(s, 'Test Tall'))!)).toBe(false);
  });
});

describe('CR 602.5b, 402.1: "Activate only if you have exactly zero or seven cards in hand."', () => {
  const canActivate = (hand: number): boolean => {
    const s0 = mpScenario({ players: 3, defs: [BIBLIO], zones: { p1: { battlefield: ['Test Library', 'Plains', 'Plains'], hand: Array.from({ length: 9 }, () => 'Plains') } } });
    const s = tweak(s0, (g) => { const ids = g.zones.hand['p1']!; while (ids.length > hand) delete g.objects[ids.pop()!]; });
    expect(s.zones.hand['p1']!.length).toBe(hand);
    return legal(s, 'p1', 'activate').some((a) => a.object === byName(s, 'Test Library') && !a.isMana);
  };
  it('zero cards and seven cards allow it; one, six and eight do not', () => {
    expect(canActivate(0)).toBe(true);
    expect(canActivate(7)).toBe(true);
    for (const n of [1, 6, 8]) expect(canActivate(n), `${n} cards`).toBe(false);
  });
});

describe('CR 404.1, 110.2a: "Put up to two creature cards from graveyards onto the battlefield under your control."', () => {
  const game = () => mpScenario({ players: 3, defs: [NECRO, BIG, SMALL, BEAR_C], zones: { p1: { hand: ['Test Necro'], graveyard: ['Test Big'] }, p2: { graveyard: ['Test Small', 'Test Bear'] } } });
  it('you choose up to two creature cards from any graveyards and they enter under your control', () => {
    const s0 = game();
    const ids = [byName(s0, 'Test Big', 'graveyard'), byName(s0, 'Test Small', 'graveyard')];
    const s = cast(s0, 'Test Necro', { answers: [{ kind: 'chooseObjects', ids }] });
    expect(names(s, 'Test Big').length + names(s, 'Test Small').length).toBe(2);
    for (const id of [...names(s, 'Test Big'), ...names(s, 'Test Small')]) expect(s.objects[id]!.controller).toBe('p1');
    expect(s.objects[names(s, 'Test Small')[0]!]!.owner).toBe('p2');
    expect(names(s, 'Test Bear', 'graveyard').length).toBe(1);
  });
  it('up to: choosing one card, or none, is allowed', () => {
    const s0 = game();
    const one = byName(s0, 'Test Small', 'graveyard');
    const s = cast(s0, 'Test Necro', { answers: [{ kind: 'chooseObjects', ids: [one] }] });
    expect(names(s, 'Test Small').length).toBe(1);
    expect(names(s, 'Test Big').length).toBe(0);
    const none = cast(game(), 'Test Necro', { answers: [{ kind: 'chooseObjects', ids: [] }] });
    expect(names(none, 'Test Small').length + names(none, 'Test Big').length).toBe(0);
  });
});

describe('CR 108.3, 608.2h: "return to its owner\'s hand each creature that player controls with power greater than the number of cards in their hand"', () => {
  it('on a player\'s upkeep, only their creatures with power greater than their hand size return to their owners; the others and other players\' creatures stay', () => {
    const s0 = mpScenario({ players: 3, defs: [SCALES, BIG, SMALL], zones: { p1: { battlefield: ['Test Scales', 'Test Big'] }, p2: { battlefield: ['Test Big', 'Test Small'], hand: ['Plains', 'Plains'] }, p3: { battlefield: ['Test Big'] } } });
    const s = toTurn(s0, 2);
    expect(s.turn.number).toBe(2);
    expect(names(s, 'Test Big').length).toBe(2);
    expect(names(s, 'Test Small').length).toBe(1);
  });
  it('the number of cards in hand is counted on resolution: a 3/3 with two cards in hand returns, a creature with power equal to the hand size stays', () => {
    const s0 = mpScenario({ players: 3, defs: [SCALES, BIG], zones: { p1: { battlefield: ['Test Scales'] }, p2: { battlefield: ['Test Big'], hand: ['Plains', 'Plains'] } } });
    const s = toTurn(s0, 2);
    expect(names(s, 'Test Big').length).toBe(0);
    const t0 = mpScenario({ players: 3, defs: [SCALES, TWO], zones: { p1: { battlefield: ['Test Scales'] }, p2: { battlefield: ['Test Two'], hand: ['Plains', 'Plains'] } } });
    const t = toTurn(t0, 2);
    expect(names(t, 'Test Two').length).toBe(1);
  });
});

describe('CR 105.1, 615.1: "As long as you control a permanent of each color, prevent all damage that would be dealt to you."', () => {
  const game = (perms: string[]) => mpScenario({ players: 3, defs: [RESIST, PERM_W, PERM_U, PERM_B, PERM_R, PERM_G, PERM_RG, PINGER], zones: { p1: { battlefield: ['Test Resist', 'Test Pinger', ...perms] } } });
  it('with all five colors among your permanents (a two-colored permanent counts for both) damage to you is prevented', () => {
    const s0 = game(['Test White', 'Test Blue', 'Test Black', 'Test Gold']);
    const s = activate(s0, byName(s0, 'Test Pinger'), { targets: [[plr('p1')]] });
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('with only four colors the damage is dealt', () => {
    const s0 = game(['Test White', 'Test Blue', 'Test Black', 'Test Redd']);
    const s = activate(s0, byName(s0, 'Test Pinger'), { targets: [[plr('p1')]] });
    expect(lifeOf(s, 'p1')).toBe(17);
  });
});

describe('CR 701.21a, 111.2, 608.2h: "Target creature\'s controller sacrifices it, then creates X 1/1 ... tokens, where X is that creature\'s power."', () => {
  it('an opponent\'s 3/3 is sacrificed and its controller gets three 1/1 Elf Warrior tokens; the spell\'s caster gets none', () => {
    const s0 = mpScenario({ players: 3, defs: [MERCY, BIG], zones: { p1: { hand: ['Test Mercy'] }, p2: { battlefield: ['Test Big'] } } });
    const s = cast(s0, 'Test Mercy', { targets: [[obj(byName(s0, 'Test Big'))]] });
    expect(names(s, 'Test Big').length).toBe(0);
    const tokens = names(s, 'Elf Warrior Token');
    expect(tokens.length).toBe(3);
    for (const id of tokens) { expect(s.objects[id]!.controller).toBe('p2'); expect(stat(s, id)).toBe('1/1'); expect(getChars(s, id)!.colors.slice().sort()).toEqual(['G', 'W']); }
  });
  it('your own creature: you get the tokens', () => {
    const s0 = mpScenario({ players: 3, defs: [MERCY, BIG], zones: { p1: { hand: ['Test Mercy'], battlefield: ['Test Big'] } } });
    const s = cast(s0, 'Test Mercy', { targets: [[obj(byName(s0, 'Test Big'))]] });
    const tokens = names(s, 'Elf Warrior Token');
    expect(tokens.length).toBe(3);
    for (const id of tokens) expect(s.objects[id]!.controller).toBe('p1');
  });
});
