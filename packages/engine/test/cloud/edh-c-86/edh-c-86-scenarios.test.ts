/**
 * Commander lane edh-c, round edh-c-86 (EDHREC ranks 16,001-16,500, later pass): the round's readings played through the engine with synthetic cards (invented names,
 * design 6.10), compiled by the game's default compiler, in 4-player games. Each group has its negative cases. CR cites are checked against the Comprehensive Rules
 * text of 2026-09-25 (media.wizards.com).
 *
 *   CR 205.1a, 205.3m, 613.1d   "Choose a creature type other than Wall. Each creature becomes that type until end of turn."
 *   CR 614.1c, 608.2c           "Return target creature card from your graveyard to the battlefield. If a Hero enters this way, it enters with two additional +1/+1 counters on it."
 *   CR 601.2h, 115.1, 608.2c    "Put a +1/+1 counter on target creature you control, then it fights target creature you don't control. If at least three green mana was spent
 *                               to cast this spell, the creature you control gains indestructible until end of turn."
 *   CR 603.4, 118.9, 110.2      "If an opponent had two or more creatures enter the battlefield under their control this turn, you may pay {U} rather than pay this spell's mana cost."
 *   CR 208.1, 611.2c            "gain control of up to one target creature with lesser power for as long as you control this creature"
 *   CR 205.3m, 110.4            "When this creature dies, exile it, then return up to two target Bird and/or Cleric permanent cards from your graveyard to the battlefield."
 *   CR 111.1, 201.5a, 701.21a   a created token with the quoted ability "At the beginning of your upkeep, sacrifice another creature. If you can't, this token deals 6 damage to you."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, find, mpScenario, pass } from '../../m12/rules/helpers';
import { legal } from '../../m3/scenario';
import { attackWith, card, full, pt, settle as settleBase } from '../cmd3/helpers';
import { answer } from '../../m3/scenario';

interface Picks { targets?: ReturnType<typeof target>[]; name?: string }
/** The shared settle, but one target per target spec in the order given (a spell with two targets asks for them one at a time) and a chosen name. */
function settle(s0: GameState, p: Picks = {}): GameState {
  let s = s0;
  const queue = [...(p.targets ?? [])];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    const d = s.pending as { kind: string };
    if (d.kind === 'chooseName') s = answer(s, { kind: 'chooseName', name: p.name ?? 'Goblin' } as never);
    else if (d.kind === 'chooseTargets') {
      const max = (d as { max?: number }).max ?? 1;
      s = answer(s, { kind: 'chooseTargets', targets: queue.splice(0, max) } as never);
    } else s = settleBase(s, {});
  }
  return s;
}
function resolveAll(s0: GameState, p: Picks = {}): GameState {
  let s = settle(s0, p);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) s = settle(pass(s), p);
  return s;
}

const onBf = (s: GameState, p: string, defId: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && s.objects[id]!.controller === p);
const castAs = (s: GameState, name: string, player: string, picks: Parameters<typeof settle>[1] = {}): GameState => settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) } as never), picks);
const toPriority = (s0: GameState, who: string): GameState => { let s = s0; for (let i = 0; i < 8 && s.pending?.player !== who; i++) s = pass(s); return s; };
const target = (id: string, kind: 'object' | 'player' = 'object') => ({ kind, id } as never);
const colored = (name: string, type: string, text: string, color: 'G' | 'U', pt?: [string, string], cost = '{0}'): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [color], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
const castable = (s: GameState, name: string, player = 'p1'): boolean => legal(s, player, 'cast').some((a) => s.defs[s.objects[a.object!]!.defId]!.name === name);
const subtypesOf = (s: GameState, id: ObjectId): string[] => [...(getChars(s, id)!.subtypes ?? [])].sort();

describe('CR 205.1a, 205.3m, 613.1d: "Choose a creature type other than Wall. Each creature becomes that type until end of turn."', () => {
  const STD = card('Test Typecast', 'Instant', 'Choose a creature type other than Wall. Each creature becomes that type until end of turn.');
  const ELF = card('Test Quiet Elf', 'Creature — Elf Druid', '', ['1', '1']);
  const OGRE = card('Test Quiet Ogre', 'Creature — Ogre', '', ['3', '3']);
  const start = (): GameState => mpScenario({ defs: [STD, ELF, OGRE], zones: { p1: { battlefield: ['Test Quiet Elf'], hand: ['Test Typecast'] }, p2: { battlefield: ['Test Quiet Ogre'] } } });
  it('is automated', () => expect(full(STD)).toBe(true));
  it('every creature, whoever controls it, is the chosen type only (its old creature types are gone) until end of turn, then the types return', () => {
    const s0 = start();
    const elf = onBf(s0, 'p1', 'Test Quiet Elf')[0]!;
    const ogre = onBf(s0, 'p2', 'Test Quiet Ogre')[0]!;
    const s1 = resolveAll(castAs(s0, 'Test Typecast', 'p1'), { name: 'Goblin' });
    expect(subtypesOf(s1, elf)).toEqual(['Goblin']);
    expect(subtypesOf(s1, ogre)).toEqual(['Goblin']);
    expect(pt(s1, ogre)).toBe('3/3');
  });
  it('the chosen type is not Wall (negative: the option is not offered)', () => {
    let s = castAs(start(), 'Test Typecast', 'p1');
    for (let i = 0; i < 6 && s.pending?.kind === 'priority'; i++) s = pass(s);
    const opts = (s.pending as { options?: string[] } | null)?.options ?? [];
    expect(opts.length).toBeGreaterThan(10);
    expect(opts).not.toContain('Wall');
    expect(opts).toContain('Goblin');
  });
});

describe('CR 614.1c, 608.2c: "If a Hero enters this way, it enters with two additional +1/+1 counters on it."', () => {
  const RET = card('Test Heroic Call', 'Instant', 'Return target creature card from your graveyard to the battlefield. If a Hero enters this way, it enters with two additional +1/+1 counters on it.');
  const HERO = card('Test Fallen Hero', 'Creature — Human Hero', '', ['2', '2']);
  const COWARD = card('Test Fallen Coward', 'Creature — Human Rogue', '', ['2', '2']);
  const start = (): GameState => mpScenario({ defs: [RET, HERO, COWARD], zones: { p1: { hand: ['Test Heroic Call'], graveyard: ['Test Fallen Hero', 'Test Fallen Coward'] } } });
  it('is automated', () => expect(full(RET)).toBe(true));
  it('a Hero returns with two +1/+1 counters; a creature that is not a Hero returns with none (negative)', () => {
    const s0 = start();
    const hero = find(s0, 'Test Fallen Hero', 'graveyard', 'p1');
    const s1 = resolveAll(castAs(s0, 'Test Heroic Call', 'p1', { targets: [target(hero)] }), { targets: [target(hero)] });
    const back = onBf(s1, 'p1', 'Test Fallen Hero')[0]!;
    expect(s1.objects[back]!.counters['+1/+1']).toBe(2);
    expect(pt(s1, back)).toBe('4/4');
    const coward = find(s0, 'Test Fallen Coward', 'graveyard', 'p1');
    const s2 = resolveAll(castAs(s0, 'Test Heroic Call', 'p1', { targets: [target(coward)] }), { targets: [target(coward)] });
    const back2 = onBf(s2, 'p1', 'Test Fallen Coward')[0]!;
    expect(s2.objects[back2]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(pt(s2, back2)).toBe('2/2');
  });
});

describe('CR 601.2h, 115.1, 608.2c: Adamant on a counter-and-fight spell, "the creature you control gains indestructible"', () => {
  const MUSCLE = colored('Test Flex', 'Sorcery', "Put a +1/+1 counter on target creature you control, then it fights target creature you don't control.\nIf at least three green mana was spent to cast this spell, the creature you control gains indestructible until end of turn.", 'G', undefined, '{G}{G}{G}');
  const MINE = card('Test Brawler', 'Creature — Ape', '', ['2', '2']);
  const THEIRS = card('Test Rival', 'Creature — Ape', '', ['3', '3']);
  const start = (lands: string[]): GameState => mpScenario({ cards: ['Forest', 'Mountain'], defs: [MUSCLE, MINE, THEIRS], zones: { p1: { battlefield: [...lands, 'Test Brawler'], hand: ['Test Flex'] }, p2: { battlefield: ['Test Rival'] } } });
  it('is automated', () => expect(full(MUSCLE)).toBe(true));
  it('three green mana: the counter goes on my creature, it fights, and it gains indestructible (it survives the 3 damage after the counter makes it 3/3? no: 3 damage kills a 3/3 unless indestructible)', () => {
    const s0 = start(['Forest', 'Forest', 'Forest']);
    const mine = onBf(s0, 'p1', 'Test Brawler')[0]!;
    const theirs = onBf(s0, 'p2', 'Test Rival')[0]!;
    const s1 = resolveAll(castAs(s0, 'Test Flex', 'p1', { targets: [target(mine), target(theirs)] }), { targets: [target(mine), target(theirs)] });
    expect(s1.objects[mine]?.zone).toBe('battlefield');
    expect(s1.objects[mine]!.counters['+1/+1']).toBe(1);
    expect(s1.objects[theirs]?.zone === 'battlefield').toBe(false);
  });
  it('only two green mana were spent: the counter and the fight happen, no indestructible (negative)', () => {
    const SOFT = colored('Test Soft Flex', 'Sorcery', "Put a +1/+1 counter on target creature you control, then it fights target creature you don't control.\nIf at least three green mana was spent to cast this spell, the creature you control gains indestructible until end of turn.", 'G', undefined, '{1}{G}{G}');
    const s0 = mpScenario({ cards: ['Forest', 'Mountain'], defs: [SOFT, MINE, THEIRS], zones: { p1: { battlefield: ['Forest', 'Forest', 'Mountain', 'Test Brawler'], hand: ['Test Soft Flex'] }, p2: { battlefield: ['Test Rival'] } } });
    const mine = onBf(s0, 'p1', 'Test Brawler')[0]!;
    const theirs = onBf(s0, 'p2', 'Test Rival')[0]!;
    const s1 = resolveAll(castAs(s0, 'Test Soft Flex', 'p1', { targets: [target(mine), target(theirs)] }), { targets: [target(mine), target(theirs)] });
    expect(s1.zones.graveyard['p1']!.some((id) => s1.objects[id]!.defId === 'Test Brawler')).toBe(true); // 3 damage kills the 3/3 it became: nothing made it indestructible
  });
  it('the indestructible goes to MY creature, never to the one I do not control (negative)', () => {
    const s0 = start(['Forest', 'Forest', 'Forest']);
    const mine = onBf(s0, 'p1', 'Test Brawler')[0]!;
    const theirs = onBf(s0, 'p2', 'Test Rival')[0]!;
    const s1 = resolveAll(castAs(s0, 'Test Flex', 'p1', { targets: [target(mine), target(theirs)] }), { targets: [target(mine), target(theirs)] });
    expect(getChars(s1, mine)!.keywords.some((k) => k.keyword === 'indestructible')).toBe(true);
  });
});

describe('CR 603.4, 110.2, 118.9: "If an opponent had two or more creatures enter the battlefield under their control this turn, you may pay {U} rather than pay this spell\'s mana cost."', () => {
  const TRAP = colored('Test Springtrap', 'Instant', "If an opponent had two or more creatures enter the battlefield under their control this turn, you may pay {U} rather than pay this spell's mana cost.\nReturn two target creatures to their owners' hands.", 'U', undefined, '{3}{U}{U}');
  const BEAR = compileCard({ name: 'Test Flash Bear', layout: 'normal', mana_cost: '{0}', type_line: 'Creature — Bear', oracle_text: 'Flash', colors: [], power: '2', toughness: '2' } as OracleCard);
  const defs = [TRAP, BEAR];
  const start = (bearsFor: Record<string, number>): GameState => {
    let s = mpScenario({
      cards: ['Island'], defs,
      zones: { p1: { battlefield: ['Island'], hand: ['Test Springtrap'] }, p2: { hand: Array(bearsFor['p2'] ?? 0).fill('Test Flash Bear') }, p3: { hand: Array(bearsFor['p3'] ?? 0).fill('Test Flash Bear') } },
    });
    for (const p of ['p2', 'p3']) for (let i = 0; i < (bearsFor[p] ?? 0); i++) { s = toPriority(s, p); s = resolveAll(castAs(s, 'Test Flash Bear', p)); }
    return s;
  };
  it('is automated', () => expect(full(TRAP)).toBe(true));
  it('one opponent with two creatures entering this turn: the spell can be cast for {U} alone', () => expect(castable(toPriority(start({ p2: 2 }), 'p1'), 'Test Springtrap')).toBe(true));
  it('two different opponents with one creature each are NOT one opponent with two (negative: the counts are not added up)', () => expect(castable(toPriority(start({ p2: 1, p3: 1 }), 'p1'), 'Test Springtrap')).toBe(false));
  it('one creature entering under an opponent\'s control is not enough (negative)', () => expect(castable(toPriority(start({ p2: 1 }), 'p1'), 'Test Springtrap')).toBe(false));
  it('a creature reanimated from ANOTHER player\'s graveyard counts for the player it entered under, not its owner (review finding)', () => {
    const RAISE = compileCard({ name: 'Test Raise', layout: 'normal', mana_cost: '{0}', type_line: 'Instant', oracle_text: 'Return target creature card from a graveyard to the battlefield under your control.', colors: [] } as OracleCard);
    const mk = (): GameState => {
      let s = mpScenario({ cards: ['Island'], defs: [...defs, RAISE], zones: { p1: { battlefield: ['Island'], hand: ['Test Springtrap'] }, p2: { hand: ['Test Flash Bear', 'Test Raise'] }, p3: { graveyard: ['Test Flash Bear'] } } });
      s = toPriority(s, 'p2'); s = resolveAll(castAs(s, 'Test Flash Bear', 'p2'));
      const dead = find(s, 'Test Flash Bear', 'graveyard', 'p3');
      s = toPriority(s, 'p2'); s = resolveAll(castAs(s, 'Test Raise', 'p2', { targets: [target(dead)] }), { targets: [target(dead)] });
      return toPriority(s, 'p1');
    };
    expect(castable(mk(), 'Test Springtrap')).toBe(true);
  });
  it('no creature entered: with one Island it cannot be cast (negative)', () => expect(castable(start({}), 'Test Springtrap')).toBe(false));
});

describe('CR 208.1, 611.2c: "gain control of up to one target creature with lesser power for as long as you control this creature. Then the Ring tempts you."', () => {
  const RANGER = card('Test Border Ranger', 'Creature — Human Ranger', 'When this creature enters, gain control of up to one target creature with lesser power for as long as you control this creature. Then the Ring tempts you.', ['3', '3']);
  const SMALL = card('Test Small Mark', 'Creature — Ape', '', ['2', '2']);
  const EQUAL = card('Test Equal Mark', 'Creature — Ape', '', ['3', '3']);
  const start = (): GameState => mpScenario({ defs: [RANGER, SMALL, EQUAL], zones: { p1: { hand: ['Test Border Ranger'] }, p2: { battlefield: ['Test Small Mark', 'Test Equal Mark'] } } });
  it('is automated', () => expect(full(RANGER)).toBe(true));
  it('takes the creature with lesser power', () => {
    const s0 = start();
    const small = onBf(s0, 'p2', 'Test Small Mark')[0]!;
    const s1 = resolveAll(castAs(s0, 'Test Border Ranger', 'p1'), { targets: [target(small)] });
    expect(s1.objects[small]!.controller).toBe('p1');
  });
  it('a creature with equal power is not a legal target (negative)', () => {
    const s0 = start();
    const equal = onBf(s0, 'p2', 'Test Equal Mark')[0]!;
    expect(() => resolveAll(castAs(s0, 'Test Border Ranger', 'p1'), { targets: [target(equal)] })).toThrow(/not a legal target/);
  });
});

describe('CR 205.3m, 110.4: "return up to two target Bird and/or Cleric permanent cards from your graveyard to the battlefield"', () => {
  const GATE = card('Test Gatewing', 'Creature — Bird Cleric', 'When this creature dies, exile it, then return up to two target Bird and/or Cleric permanent cards from your graveyard to the battlefield.', ['2', '2']);
  const BIRD = card('Test Lost Bird', 'Creature — Bird', '', ['1', '1']);
  const CLERIC = card('Test Lost Cleric', 'Creature — Human Cleric', '', ['1', '1']);
  const OGRE = card('Test Lost Ogre', 'Creature — Ogre', '', ['1', '1']);
  const KILL = card('Test Smite', 'Instant', 'Destroy target creature.');
  const start = (): GameState => mpScenario({ defs: [GATE, BIRD, CLERIC, OGRE, KILL], zones: { p1: { battlefield: ['Test Gatewing'], hand: ['Test Smite'], graveyard: ['Test Lost Bird', 'Test Lost Cleric', 'Test Lost Ogre'] } } });
  it('is automated', () => expect(full(GATE)).toBe(true));
  it('the Bird and the Cleric return, the Gatewing itself is exiled', () => {
    const s0 = start();
    const gate = onBf(s0, 'p1', 'Test Gatewing')[0]!;
    const bird = find(s0, 'Test Lost Bird', 'graveyard', 'p1');
    const cleric = find(s0, 'Test Lost Cleric', 'graveyard', 'p1');
    const s1 = resolveAll(castAs(s0, 'Test Smite', 'p1', { targets: [target(gate)] }), { targets: [target(bird), target(cleric)] });
    expect(onBf(s1, 'p1', 'Test Lost Bird').length).toBe(1);
    expect(onBf(s1, 'p1', 'Test Lost Cleric').length).toBe(1);
    expect(s1.zones.exile.some((id) => s1.objects[id]!.defId === 'Test Gatewing')).toBe(true);
    expect(s1.zones.graveyard['p1']!.some((id) => s1.objects[id]!.defId === 'Test Gatewing')).toBe(false);
  });
  it('an Ogre card is not a legal target (negative)', () => {
    const s0 = start();
    const gate = onBf(s0, 'p1', 'Test Gatewing')[0]!;
    const ogre = find(s0, 'Test Lost Ogre', 'graveyard', 'p1');
    expect(() => resolveAll(castAs(s0, 'Test Smite', 'p1', { targets: [target(gate)] }), { targets: [target(ogre)] })).toThrow(/not a legal target/);
  });
});

describe('CR 111.1, 201.5a, 701.21a: a token with the quoted ability "At the beginning of your upkeep, sacrifice another creature. If you can\'t, this token deals 6 damage to you."', () => {
  const MAKE = card('Test Summoning', 'Sorcery', 'Create a 6/6 black Demon creature token with flying, trample, and "At the beginning of your upkeep, sacrifice another creature. If you can\'t, this token deals 6 damage to you."');
  const DEMON_FOOD = card('Test Offering', 'Creature — Goblin', '', ['1', '1']);
  it('is automated, and the token carries a triggered ability that sacrifices another creature (other than itself)', () => {
    expect(full(MAKE)).toBe(true);
    const text = JSON.stringify(MAKE.faces);
    expect(text).toContain('"other":true');
    expect(text).toContain('"amount":6');
  });
  it('the sorcery makes one 6/6 flying trample Demon for its controller', () => {
    const s0 = mpScenario({ defs: [MAKE, DEMON_FOOD], zones: { p1: { hand: ['Test Summoning'] } } });
    const s1 = resolveAll(castAs(s0, 'Test Summoning', 'p1'));
    const toks = s1.zones.battlefield.filter((id) => s1.objects[id]!.kind === 'token' && s1.objects[id]!.controller === 'p1');
    expect(toks.length).toBe(1);
    expect(pt(s1, toks[0]!)).toBe('6/6');
  });
});

describe('CR 208.1, 508.1: "Whenever ~ attacks, you may put a creature card with lesser power from your hand onto the battlefield tapped and attacking." (lesser than the attacker itself)', () => {
  const RAIDER = card('Test Cavalry Chief', 'Creature — Horse', 'Whenever this creature attacks, you may put a creature card with lesser power from your hand onto the battlefield tapped and attacking.', ['3', '3']);
  const SMALL = card('Test Little Rider', 'Creature — Human', '', ['2', '2']);
  const BIG = card('Test Big Rider', 'Creature — Human', '', ['3', '3']);
  const start = (): GameState => mpScenario({ defs: [RAIDER, SMALL, BIG], zones: { p1: { battlefield: ['Test Cavalry Chief'], hand: ['Test Little Rider', 'Test Big Rider'] } } });
  it('is automated', () => expect(full(RAIDER)).toBe(true));
  it('only the card with lesser power than the attacker can be put in; it enters tapped and attacking', () => {
    const s0 = start();
    const chief = onBf(s0, 'p1', 'Test Cavalry Chief')[0]!;
    const small = find(s0, 'Test Little Rider', 'hand', 'p1');
    const big = find(s0, 'Test Big Rider', 'hand', 'p1');
    let s = attackWith(s0, [chief]);
    const d = s.pending as { options?: string[] } | null;
    if (d?.options) { expect(d.options).toContain(small); expect(d.options).not.toContain(big); }
    s = settle(s, {});
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = settleBase(pass(s), { objects: [small] });
    expect(onBf(s, 'p1', 'Test Big Rider').length).toBe(0);
    const rider = onBf(s, 'p1', 'Test Little Rider')[0];
    expect(rider, JSON.stringify({ stack: s.zones.stack.length, pending: s.pending?.kind, bf: s.zones.battlefield.map((id) => s.objects[id]!.defId) })).toBeDefined();
    expect(s.objects[rider!]!.tapped).toBe(true);
  });
});
