/**
 * Commander lane edh-c, round edh-c-59 (EDHREC ranks 20,001-20,500, second pass): the round's readings played through the engine with synthetic cards (invented names, design
 * 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites
 * checked against the Comprehensive Rules of 2026-09-25 (see the round's record).
 *
 *   CR 601.2f, 702.33d          "The first kicked spell you cast each turn costs {1} less to cast." (Vine Gecko)
 *   CR 601.2f, 121.2            "This ability costs {4}{B} less to activate if you've drawn three or more cards this turn." (Kami of Jealous Thirst)
 *   CR 702.6a, 601.2f           "~'s equip ability costs {2} less to activate if it targets a colorless creature." (Ghostfire Blade)
 *   CR 601.2f, 205.3m           "~ costs {2} less to cast if you control at least two creatures that share a creature type." (Synchronized Eviction)
 *   CR 702.16a, 105.1           "Each creature has protection from each of its colors." (Earnest Fellowship)
 *   CR 603.1, 506.1             "When ~ dies during combat, create four 1/1 Dogs." (Mongrel Pack)
 *   CR 603.4, 701.21a           "At the beginning of your upkeep, sacrifice a creature if you don't control an Ogre." (Painwracker Oni)
 *   CR 115.7b, 603.2            "Whenever an opponent casts a spell, if it has a single target, change the target to enchanted creature if able." (Captured by the Consulate)
 *   CR 402.1                    "~'s power and toughness are each equal to the number of cards in the hand of the opponent with the most cards in hand." (Adamaro)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, legal, pass, scenario } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';
import { logHas } from '../../m4/helpers';
import { card, cast, full, pt, resolveAll, settle } from '../cmd3/helpers';

const LANDS = ['Forest', 'Swamp', 'Island', 'Mountain', 'Plains'];
const obj = (id: ObjectId) => ({ kind: 'object' as const, id });
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const tappedCount = (s: GameState, player = 'p1'): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === player && s.defs[s.objects[id]!.defId]!.name === 'Forest' && s.objects[id]!.tapped).length;
/** Cast `name` from p1's hand answering yes to every kicker question when `kick`, then pay automatically. */
function castKicked(s0: GameState, name: string, kick: boolean): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') } as never);
  for (let k = 0; k < 12 && s.pending && s.pending.kind !== 'priority'; k++) {
    const d = s.pending as unknown as { kind: string; options?: { id: string }[] };
    if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: kick });
    else if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: kick ? [d.options![0]!.id] : [] });
    else s = settle(s);
  }
  return s;
}

const GECKO = card('Test Gecko', 'Creature — Lizard', 'The first kicked spell you cast each turn costs {1} less to cast.', ['1', '1']);
const KSPELL = card('Test Kick Spell', 'Sorcery', 'Kicker {G}\nYou gain 1 life.', undefined, '{1}{G}');
const KSPELL2 = card('Test Kick Spell Two', 'Sorcery', 'Kicker {G}\nYou gain 2 life.', undefined, '{1}{G}');
const KAMI = card('Test Kami', 'Creature — Spirit', 'Deathtouch\n{4}{B}: Each opponent loses 2 life and you gain 2 life. This ability costs {4}{B} less to activate if you\'ve drawn three or more cards this turn.', ['1', '1']);
const BLADE = card('Test Blade', 'Artifact — Equipment', 'Equipped creature gets +2/+2.\nEquip {3}\nThis Equipment\'s equip ability costs {2} less to activate if it targets a colorless creature.');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', ['2', '2']);
const EVICT = card('Test Eviction', 'Sorcery', 'This spell costs {2} less to cast if you control at least two creatures that share a creature type.\nPut target nonland permanent into its owner\'s library second from the top.', undefined, '{2}{U}');
const ELF1 = card('Test Elf One', 'Creature — Elf Druid', '', ['1', '1']);
const ELF2 = card('Test Elf Two', 'Creature — Elf Warrior', '', ['1', '1']);
const FISH = card('Test Fish', 'Creature — Fish', '', ['1', '1']);
const CHANGE = card('Test Changeling', 'Creature — Shapeshifter', 'Changeling', ['1', '1']);
const FELLOW = card('Test Fellowship', 'Enchantment', 'Each creature has protection from each of its colors.');
/** A card with colors (the shared helper makes colorless ones). */
const colored = (name: string, type: string, text: string, colors: string[], cost: string, pt?: [string, string]) =>
  compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
const RED = colored('Test Red Bear', 'Creature — Bear', '', ['R'], '{R}', ['2', '2']);
const REDBOLT = colored('Test Red Bolt', 'Instant', 'Test Red Bolt deals 2 damage to target creature.', ['R'], '{R}');
const PACK = card('Test Pack', 'Creature — Wolf', 'When this creature dies during combat, create four 1/1 green Dog creature tokens.', ['1', '1']);
const BIGGUY = card('Test Big Guy', 'Creature — Ogre', '', ['3', '3']);
const ONI = card('Test Oni', 'Creature — Ogre', 'At the beginning of your upkeep, sacrifice a creature if you don\'t control an Ogre.', ['2', '2']);
const NOGRE = card('Test Not Ogre Oni', 'Creature — Demon', 'At the beginning of your upkeep, sacrifice a creature if you don\'t control an Ogre.', ['2', '2']);
const CONSULATE = card('Test Consulate', 'Enchantment — Aura', 'Enchant creature you don\'t control\nEnchanted creature can\'t attack.\nWhenever an opponent casts a spell, if it has a single target, change the target to enchanted creature if able.');
const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to target creature.', undefined, '{0}');
const ADAMARO = card('Test Adamaro', 'Legendary Creature — Spirit', 'Test Adamaro\'s power and toughness are each equal to the number of cards in the hand of the opponent with the most cards in hand.');
const FILLER = card('Test Filler', 'Sorcery', 'You gain 1 life.', undefined, '{G}');
const DEFS = [GECKO, KSPELL, KSPELL2, KAMI, BLADE, BEAR, GOLEM, EVICT, ELF1, ELF2, FISH, CHANGE, FELLOW, RED, REDBOLT, PACK, BIGGUY, ONI, NOGRE, CONSULATE, ZAP, ADAMARO, FILLER];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 601.2f, 702.33d: "The first kicked spell you cast each turn costs {1} less to cast." (Vine Gecko)', () => {
  it('a kicked spell costs {1} less: {1}{G} plus kicker {G} is paid with two Forests', () => {
    const s0 = scenario(LANDS, { defs: DEFS, p1: { hand: ['Test Kick Spell'], battlefield: ['Test Gecko', 'Forest', 'Forest'] } });
    const s = resolveAll(castKicked(s0, 'Test Kick Spell', true));
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1') + 1);
    expect(logHas(s, /casts Test Kick Spell.* kicked/)).toBe(true);
    expect(tappedCount(s)).toBe(2);
  });
  it('negative: without the Gecko the kicked spell needs three mana and is not castable with two', () => {
    const s0 = scenario(LANDS, { defs: DEFS, p1: { hand: ['Test Kick Spell'], battlefield: ['Forest', 'Forest'] } });
    const s = resolveAll(castKicked(s0, 'Test Kick Spell', true));
    expect(logHas(s, /casts Test Kick Spell.* kicked/)).toBe(false);
  });
  it('negative: the second kicked spell of the turn gets no cut, and an unkicked spell gets none', () => {
    let s = scenario(LANDS, { defs: DEFS, p1: { hand: ['Test Kick Spell', 'Test Kick Spell Two'], battlefield: ['Test Gecko', 'Forest', 'Forest', 'Forest', 'Forest'] } });
    s = resolveAll(castKicked(s, 'Test Kick Spell', true));
    expect(tappedCount(s)).toBe(2);
    const s2 = resolveAll(castKicked(s, 'Test Kick Spell Two', true));
    expect(logHas(s2, /casts Test Kick Spell Two.* kicked/)).toBe(false); // {1}{G}{G} (3 mana) is wanted with two Forests untapped: the cut is not given again
    const u = scenario(LANDS, { defs: DEFS, p1: { hand: ['Test Kick Spell'], battlefield: ['Test Gecko', 'Forest', 'Forest'] } });
    const s3 = resolveAll(castKicked(u, 'Test Kick Spell', false));
    expect(tappedCount(s3)).toBe(2); // the unkicked spell costs {1}{G}: no cut
    expect(lifeOf(s3, 'p1')).toBe(lifeOf(u, 'p1') + 1);
  });
});

describe('CR 601.2f, 602.2b, 121.2: "This ability costs {4}{B} less to activate if you\'ve drawn three or more cards this turn." (Kami of Jealous Thirst)', () => {
  const DRAW3 = card('Test Draw Three', 'Sorcery', 'Draw three cards.');
  const DRAW2 = card('Test Draw Two', 'Sorcery', 'Draw two cards.');
  const drain = (s: GameState) => legal(s, 'p1', 'activate').find((a) => a.label.toLowerCase().includes('lose'));
  const board = (spell: string): GameState => scenario(LANDS, { defs: [...DEFS, DRAW3, DRAW2], p1: { hand: [spell], battlefield: ['Test Kami'] } });
  it('after three cards are drawn the ability costs nothing: it is offered with no land and drains', () => {
    const s0 = board('Test Draw Three');
    expect(drain(s0)).toBeUndefined();
    const s1 = resolveAll(cast(s0, 'Test Draw Three'));
    const d = drain(s1);
    expect(d).toBeDefined();
    const s2 = resolveAll(settle(act(s1, d!.action)));
    expect(lifeOf(s2, 'p2')).toBe(lifeOf(s1, 'p2') - 2);
    expect(lifeOf(s2, 'p1')).toBe(lifeOf(s1, 'p1') + 2);
  });
  it('negative: two cards drawn is not enough, and at the start of the turn it costs {4}{B}', () => {
    const s1 = resolveAll(cast(board('Test Draw Two'), 'Test Draw Two'));
    expect(drain(s1)).toBeUndefined();
  });
});

describe('CR 702.6a, 601.2f, 602.2b: "~\'s equip ability costs {2} less to activate if it targets a colorless creature." (Ghostfire Blade)', () => {
  const equip = (s: GameState) => legal(s, 'p1', 'activate').find((a) => a.label.toLowerCase().includes('equip'));
  it('with one land the equip ability ({3}, reduced to {1}) is offered when a colorless creature can be equipped', () => {
    const s = scenario(LANDS, { defs: DEFS, p1: { battlefield: ['Test Blade', 'Test Golem', 'Forest'] } });
    expect(equip(s)).toBeDefined();
    const eq = equip(s)!;
    const t = resolveAll(settle(act(s, eq.action), { targets: [obj(find(s, 'Test Golem', 'battlefield', 'p1'))] }), { targets: [obj(find(s, 'Test Golem', 'battlefield', 'p1'))] });
    expect(t.objects[find(t, 'Test Blade', 'battlefield', 'p1')]!.attachedTo).toBe(find(t, 'Test Golem', 'battlefield', 'p1'));
  });
  /** Activate equip on `name` and report whether the Blade ended up attached to it (payment is automatic; an unpayable activation leaves it unattached). */
  const equipped = (s: GameState, name: string): boolean => {
    const creature = find(s, name, 'battlefield', 'p1');
    try {
      const t = resolveAll(settle(act(s, equip(s)!.action), { targets: [obj(creature)] }), { targets: [obj(creature)] });
      return t.objects[find(t, 'Test Blade', 'battlefield', 'p1')]!.attachedTo === creature;
    } catch {
      return false;
    }
  };
  it('negative: a red creature still costs {3}: one land does not pay, three lands do', () => {
    const one = scenario(LANDS, { defs: DEFS, p1: { battlefield: ['Test Blade', 'Test Red Bear', 'Forest'] } });
    expect(equipped(one, 'Test Red Bear')).toBe(false);
    const three = scenario(LANDS, { defs: DEFS, p1: { battlefield: ['Test Blade', 'Test Red Bear', 'Forest', 'Forest', 'Forest'] } });
    expect(equipped(three, 'Test Red Bear')).toBe(true);
    const golem = scenario(LANDS, { defs: DEFS, p1: { battlefield: ['Test Blade', 'Test Golem', 'Forest'] } });
    expect(equipped(golem, 'Test Golem')).toBe(true);
  });
});

describe('CR 601.2f, 205.3m, 702.73a: "~ costs {2} less to cast if you control at least two creatures that share a creature type." (Synchronized Eviction)', () => {
  const castable = (s: GameState): boolean => legal(s, 'p1', 'cast').some((a) => a.object === find(s, 'Test Eviction', 'hand', 'p1'));
  it('two Elves: the {2}{U} spell is castable with one Island', () => {
    expect(castable(scenario(LANDS, { defs: DEFS, p1: { hand: ['Test Eviction'], battlefield: ['Test Elf One', 'Test Elf Two', 'Island'] } }))).toBe(true);
  });
  it('a Changeling shares a type with any creature (CR 702.73a)', () => {
    expect(castable(scenario(LANDS, { defs: DEFS, p1: { hand: ['Test Eviction'], battlefield: ['Test Changeling', 'Test Fish', 'Island'] } }))).toBe(true);
  });
  it('negative: an Elf and a Fish share nothing, one Elf alone shares nothing, and the opponent\'s creatures do not count', () => {
    expect(castable(scenario(LANDS, { defs: DEFS, p1: { hand: ['Test Eviction'], battlefield: ['Test Elf One', 'Test Fish', 'Island'] } }))).toBe(false);
    expect(castable(scenario(LANDS, { defs: DEFS, p1: { hand: ['Test Eviction'], battlefield: ['Test Elf One', 'Island'] } }))).toBe(false);
    expect(castable(scenario(LANDS, { defs: DEFS, p1: { hand: ['Test Eviction'], battlefield: ['Test Elf One', 'Island'] }, p2: { battlefield: ['Test Elf Two'] } }))).toBe(false);
    expect(castable(scenario(LANDS, { defs: DEFS, p1: { hand: ['Test Eviction'], battlefield: ['Test Fish', 'Island', 'Island', 'Island'] } }))).toBe(true); // full price with three Islands
  });
});

describe('CR 702.16a, 105.1, 613.1f: "Each creature has protection from each of its colors." (Earnest Fellowship)', () => {
  const protections = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.filter((k) => k.keyword === 'protection').map((k) => String(k.quality)).sort();
  it('a red creature has protection from red; a colorless creature has none; it ends when the enchantment leaves', () => {
    const s = scenario(LANDS, { defs: DEFS, p1: { battlefield: ['Test Fellowship', 'Test Red Bear', 'Test Golem'] } });
    expect(protections(s, find(s, 'Test Red Bear', 'battlefield', 'p1'))).toEqual(['color:R']);
    expect(protections(s, find(s, 'Test Golem', 'battlefield', 'p1'))).toEqual([]);
    const gone = scenario(LANDS, { defs: DEFS, p1: { battlefield: ['Test Red Bear'] } });
    expect(protections(gone, find(gone, 'Test Red Bear', 'battlefield', 'p1'))).toEqual([]);
  });
  it('a red spell can\'t target the red creature but can target the colorless one', () => {
    const s = scenario(LANDS, { defs: DEFS, p1: { hand: ['Test Red Bolt'], battlefield: ['Test Fellowship', 'Test Red Bear', 'Test Golem', 'Mountain'] } });
    expect(() => cast(s, 'Test Red Bolt', { targets: [obj(find(s, 'Test Red Bear', 'battlefield', 'p1'))] })).toThrow();
    const t = resolveAll(cast(s, 'Test Red Bolt', { targets: [obj(find(s, 'Test Golem', 'battlefield', 'p1'))] }));
    expect(findAll(t, 'Test Golem', 'battlefield', 'p1')).toEqual([]); // the 2/2 died to the 2 damage
  });
  it('a multicolored creature has protection from each of its colors', () => {
    const GOLD = colored('Test Gold Knight', 'Creature — Knight', '', ['R', 'G'], '{R}{G}', ['2', '2']);
    const s = scenario(LANDS, { defs: [...DEFS, GOLD], p1: { battlefield: ['Test Fellowship', 'Test Gold Knight'] } });
    expect(protections(s, find(s, 'Test Gold Knight', 'battlefield', 'p1'))).toEqual(['color:G', 'color:R']);
  });
});

describe('CR 603.1, 506.1, 700.4: "When ~ dies during combat, create four 1/1 green Dog creature tokens." (Mongrel Pack)', () => {
  const dogs = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1').length;
  it('it blocks and dies in combat damage: four Dogs', () => {
    let s = scenario(LANDS, { defs: DEFS, p1: { battlefield: ['Test Pack'] }, p2: { battlefield: ['Test Big Guy'] } });
    s = advanceTo(s, 2, 'declareAttackers');
    s = toDeclareAttackers(s);
    s = declareAttackers(s, [[find(s, 'Test Big Guy', 'battlefield', 'p2'), 'p1']]);
    s = toDeclareBlockers(s);
    s = declareBlockers(s, [[find(s, 'Test Pack', 'battlefield', 'p1'), find(s, 'Test Big Guy', 'battlefield', 'p2')]]);
    s = passUntil(s, (x) => x.zones.battlefield.every((id) => x.objects[id]!.defId !== 'Test Pack') || x.turn.step === 'main2', 'the Pack to die');
    s = resolveAll(s);
    expect(findAll(s, 'Test Pack', 'battlefield', 'p1')).toEqual([]);
    expect(dogs(s)).toBe(4);
  });
  it('negative: it dies in the main phase (damage from a spell): no Dogs', () => {
    const s0 = scenario(LANDS, { defs: DEFS, p1: { hand: ['Test Zap'], battlefield: ['Test Pack'] } });
    const s = resolveAll(cast(s0, 'Test Zap', { targets: [obj(find(s0, 'Test Pack', 'battlefield', 'p1'))] }));
    expect(findAll(s, 'Test Pack', 'battlefield', 'p1')).toEqual([]);
    expect(dogs(s)).toBe(0);
  });
});

describe('CR 603.4, 701.21a: "At the beginning of your upkeep, sacrifice a creature if you don\'t control an Ogre." (Painwracker Oni)', () => {
  const creatures = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && getChars(s, id)!.types.includes('Creature')).length;
  const toUpkeep = (s: GameState): GameState => settle(advanceTo(s, 3, 'upkeep'));
  it('with no Ogre, its controller sacrifices a creature at the upkeep', () => {
    const s0 = scenario(LANDS, { defs: DEFS, p1: { battlefield: ['Test Not Ogre Oni', 'Test Bear'] } });
    const s = resolveAll(toUpkeep(s0));
    expect(creatures(s)).toBe(1);
  });
  it('negative: with an Ogre (here a second creature that is an Ogre) nothing is sacrificed', () => {
    const s0 = scenario(LANDS, { defs: DEFS, p1: { battlefield: ['Test Not Ogre Oni', 'Test Big Guy'] } });
    const s = resolveAll(toUpkeep(s0));
    expect(creatures(s)).toBe(2);
    const own = resolveAll(toUpkeep(scenario(LANDS, { defs: DEFS, p1: { battlefield: ['Test Oni'] } })));
    expect(creatures(own)).toBe(1); // an Ogre itself
  });
});

describe('CR 115.7b, 603.2, 601.2c: "Whenever an opponent casts a spell, if it has a single target, change the target to enchanted creature if able." (Captured by the Consulate)', () => {
  const PING = card('Test Ping', 'Instant', 'Test Ping deals 1 damage to target player.');
  /** p1 enchants p2's Bear with the Aura; then it is p2's turn and p2 is the opponent who casts. */
  const board = (): GameState => {
    let s = scenario(LANDS, { defs: [...DEFS, PING], p1: { hand: ['Test Consulate'], battlefield: ['Test Big Guy'] }, p2: { hand: ['Test Zap', 'Test Ping'], battlefield: ['Test Bear'] } });
    s = resolveAll(cast(s, 'Test Consulate', { targets: [obj(find(s, 'Test Bear', 'battlefield', 'p2'))] }));
    return advanceTo(s, 2, 'main1');
  };
  it('a spell with one target is redirected to the enchanted creature', () => {
    const s0 = board();
    const s = resolveAll(cast(s0, 'Test Zap', { targets: [obj(find(s0, 'Test Big Guy', 'battlefield', 'p1'))] }, 'p2'));
    expect(s.objects[find(s, 'Test Bear', 'battlefield', 'p2')]!.damage).toBe(1);
    expect(s.objects[find(s, 'Test Big Guy', 'battlefield', 'p1')]!.damage).toBe(0);
  });
  it('negative: a spell that can\'t target the enchanted creature keeps its target (if able)', () => {
    const s0 = board();
    const s = resolveAll(cast(s0, 'Test Ping', { targets: [{ kind: 'player', id: 'p1' }] }, 'p2'));
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1') - 1);
    expect(s.objects[find(s, 'Test Bear', 'battlefield', 'p2')]!.damage).toBe(0);
  });
  it('negative: a spell its controller casts is not redirected (only opponents of the Aura\'s controller)', () => {
    const s0 = scenario(LANDS, { defs: [...DEFS, PING], p1: { hand: ['Test Consulate', 'Test Zap'], battlefield: ['Test Big Guy'] }, p2: { battlefield: ['Test Bear'] } });
    const s1 = resolveAll(cast(s0, 'Test Consulate', { targets: [obj(find(s0, 'Test Bear', 'battlefield', 'p2'))] }));
    const s = resolveAll(cast(s1, 'Test Zap', { targets: [obj(find(s1, 'Test Big Guy', 'battlefield', 'p1'))] }));
    expect(s.objects[find(s, 'Test Big Guy', 'battlefield', 'p1')]!.damage).toBe(1);
    expect(s.objects[find(s, 'Test Bear', 'battlefield', 'p2')]!.damage).toBe(0);
  });
});

describe('CR 402.1: "~\'s power and toughness are each equal to the number of cards in the hand of the opponent with the most cards in hand." (Adamaro)', () => {
  it('the largest hand among the opponents, not the sum and not your own', () => {
    const f = (n: number): string[] => Array(n).fill('Test Filler');
    const s = mpScenario({ players: 3, defs: DEFS, zones: { p1: { hand: f(7), battlefield: ['Test Adamaro'] }, p2: { hand: f(2) }, p3: { hand: f(4) } } });
    expect(s.players.length).toBe(3);
    expect(pt(s, find(s, 'Test Adamaro', 'battlefield', 'p1'))).toBe('4/4');
  });
  it('negative: it follows a change of the biggest hand', () => {
    const s = scenario(LANDS, { defs: DEFS, p1: { battlefield: ['Test Adamaro'] }, p2: { hand: ['Test Filler', 'Test Filler', 'Test Filler'] } });
    expect(pt(s, find(s, 'Test Adamaro', 'battlefield', 'p1'))).toBe('3/3');
    const t = scenario(LANDS, { defs: DEFS, p1: { battlefield: ['Test Adamaro', 'Test Bear'] }, p2: { hand: ['Test Filler'] } });
    expect(pt(t, find(t, 'Test Adamaro', 'battlefield', 'p1'))).toBe('1/1');
  });
});
