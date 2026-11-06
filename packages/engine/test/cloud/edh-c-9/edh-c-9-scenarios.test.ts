/**
 * Commander EDHREC ranks 17,501-18,125, round edh-c-9 (second pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's
 * default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 120.3, 608.2c, 105.2     "~ deals 1 damage to target creature or planeswalker. It deals 5 damage instead if that target is white and/or blue." (a white-blue target takes 5, once)
 *   CR 509.1c, 604.1, 611.3a    "As long as enchanted creature is green, it gets +1/+1 and all creatures able to block it do so."
 *   CR 731.1, 608.2c            "Target creature you control gets +2/+0 until end of turn if it's night. Then it deals damage equal to its power to target creature you don't control."
 *   CR 603.4, 603.10a           "At the beginning of your end step, if a permanent you controlled left the battlefield this turn, each opponent loses 3 life."
 *   CR 608.2h, 122.1, 611.2a    "Put X +1/+1 counters on target creature, where X is your life total. That creature gains trample until end of turn."
 *   CR 509.1b, 611.2a           "Up to two target creatures each get +1/+0 until end of turn and can't be blocked this turn."
 *   CR 401.7, 400.3             "{2}{W}: Put ~ from your graveyard into your library second from the top."
 *   CR 613.4b, 611.2c           "Until end of turn, each creature you control has base power and toughness 10/10 and gains trample."
 *   CR 401.4, 608.2c            "Draw a card. Then if you don't control a legendary creature, put a card from your hand on the bottom of your library."
 *   CR 700.5                    "Create a 0/1 white Goat creature token for each white mana symbol in the mana costs of permanents you control."
 *   CR 611.3a, 601.2f, 702.6a   "During your turn, creatures you control have first strike and equip abilities you activate cost {1} less to activate."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, getChars, type GameState, type ObjectId } from '../../../src/index';
import { hasKeyword } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, legal, life, pass, put, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers, passUntil, tweak } from '../../m4/helpers';
import { compileCard, type CardDef, type OracleCard } from '../../../src/index';
import { card, cast, full, pt, resolveAll, settle, tokens } from '../cmd3/helpers';

/** A synthetic card with colors (the cmd3 helper's cards are colorless whatever their mana cost). */
const colored = (name: string, type: string, text: string, ptv: [string, string], cost: string, colors: string[]): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, power: ptv[0], toughness: ptv[1] } as OracleCard);
/** Cast, answering each target decision in turn (one list per target). */
const castAt = (s0: GameState, name: string, lists: { kind: 'object' | 'player'; id: string }[][]): GameState => {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  for (const l of lists) s = answer(s, { kind: 'chooseTargets', targets: l as never });
  return resolveAll(s);
};
/** Pass to the end step of the turn (no attacks) and let what triggered there resolve. */
const toEnd = (s0: GameState): GameState => {
  let s = s0;
  for (let i = 0; i < 80 && !(s.turn.step === 'end' && s.pending?.kind === 'priority'); i++) s = s.pending?.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : pass(s);
  return resolveAll(s);
};
const dmg = (s: GameState, id: ObjectId): number => s.objects[id]!.damage;
const onBf = (s: GameState, defId: string, p?: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && (p === undefined || s.objects[id]!.controller === p));
const reply = (s: GameState, a: Parameters<typeof answer>[1]) => ({ type: 'answer' as const, player: s.pending!.player, decisionId: s.pending!.id, answer: a });

describe('CR 120.3, 608.2c, 105.2: "~ deals 1 damage to target creature or planeswalker. It deals 5 damage instead if that target is white and/or blue."', () => {
  const BARRAGE = card('Test Needle Volley', 'Sorcery', 'This spell can\'t be countered.\nTest Needle Volley deals 1 damage to target creature or planeswalker. It deals 5 damage instead if that target is white and/or blue.', undefined, '{0}');
  const WHITE = colored('Test Pale Giant', 'Creature — Giant', '', ['9', '9'], '{W}', ['W']);
  const BLUE = colored('Test Tide Giant', 'Creature — Giant', '', ['9', '9'], '{U}', ['U']);
  const BOTH = colored('Test Frost Giant', 'Creature — Giant', '', ['9', '9'], '{W}{U}', ['W', 'U']);
  const RED = colored('Test Ember Giant', 'Creature — Giant', '', ['9', '9'], '{R}', ['R']);
  const NONE = card('Test Stone Giant', 'Artifact Creature — Giant', '', ['9', '9'], '{4}');
  const shoot = (target: string): { s: GameState; id: ObjectId } => {
    const s0 = scenario([], { defs: [BARRAGE, WHITE, BLUE, BOTH, RED, NONE], p1: { hand: ['Test Needle Volley'] }, p2: { battlefield: [target] } });
    const id = find(s0, target, 'battlefield', 'p2');
    return { s: resolveAll(cast(s0, 'Test Needle Volley', { targets: [{ kind: 'object', id }] })), id };
  };
  it('is full', () => expect(full(BARRAGE)).toBe(true));
  it('a white creature takes 5, a blue creature takes 5', () => {
    expect(dmg(shoot('Test Pale Giant').s, shoot('Test Pale Giant').id)).toBe(5);
    const b = shoot('Test Tide Giant');
    expect(dmg(b.s, b.id)).toBe(5);
  });
  it('a white-blue creature takes 5 once (not 6: the 5 is instead of the 1)', () => {
    const b = shoot('Test Frost Giant');
    expect(dmg(b.s, b.id)).toBe(5);
  });
  it('negative: a red creature and a colorless creature take 1', () => {
    const r = shoot('Test Ember Giant');
    expect(dmg(r.s, r.id)).toBe(1);
    const n = shoot('Test Stone Giant');
    expect(dmg(n.s, n.id)).toBe(1);
  });
});

describe('CR 509.1c, 604.1, 611.3a: "As long as enchanted creature is green, it gets +1/+1 and all creatures able to block it do so."', () => {
  const GIFT = card('Test Wild Mantle', 'Enchantment — Aura', 'Enchant creature\nAs long as enchanted creature is black, it gets +1/+1 and has deathtouch.\nAs long as enchanted creature is green, it gets +1/+1 and all creatures able to block it do so.');
  const GREEN = colored('Test Grove Bear', 'Creature — Bear', '', ['2', '2'], '{G}', ['G']);
  const BLACK = colored('Test Murk Bear', 'Creature — Bear', '', ['2', '2'], '{B}', ['B']);
  const RED = colored('Test Cinder Bear', 'Creature — Bear', '', ['2', '2'], '{R}', ['R']);
  const BOTH = colored('Test Bog Bear', 'Creature — Bear', '', ['2', '2'], '{B}{G}', ['B', 'G']);
  const OGRE = card('Test Wall Ogre', 'Creature — Ogre', '', ['2', '2']);
  const enchanted = (name: string): { s: GameState; id: ObjectId } => {
    const s0 = scenario([], { defs: [GIFT, GREEN, BLACK, RED, BOTH, OGRE], p1: { battlefield: [name] }, p2: { battlefield: ['Test Wall Ogre', 'Test Wall Ogre'] } });
    const id = find(s0, name, 'battlefield', 'p1');
    const s = tweak(s0, (t) => { t.objects[put(t, 'p1', 'battlefield', 'Test Wild Mantle')]!.attachedTo = id; });
    return { s, id };
  };
  const toBlocks = (s0: GameState, id: ObjectId): GameState => passUntil(declareAttackers(toDeclareAttackers(s0), [[id]]), (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage' || x.turn.step === 'endCombat', 'blockers or damage');
  it('is full', () => expect(full(GIFT)).toBe(true));
  it('on a green creature: +1/+1 and every creature able to block it must (no blockers declared is refused, both ogres blocking is accepted)', () => {
    const { s: s0, id } = enchanted('Test Grove Bear');
    expect(pt(s0, id)).toBe('3/3');
    const s = toBlocks(s0, id);
    expect(s.pending?.kind).toBe('declareBlockers');
    expect(applyAction(s, reply(s, { kind: 'declareBlockers', blocks: [] })).error).toBeDefined();
    const [a, b] = onBf(s, 'Test Wall Ogre', 'p2');
    expect(applyAction(s, reply(s, { kind: 'declareBlockers', blocks: [a!, b!].map((blocker) => ({ blocker, attacker: id })) })).error).toBeUndefined();
  });
  it('a black-green creature gets both bonuses (+1/+1 twice, deathtouch) (ruling 2008-08-01)', () => {
    const { s, id } = enchanted('Test Bog Bear');
    expect(pt(s, id)).toBe('4/4');
    expect(hasKeyword(getChars(s, id)!, 'deathtouch')).toBe(true);
  });
  it('negative: a black creature gets +1/+1 and deathtouch but no one must block it; a red one gets nothing', () => {
    const { s: s0, id } = enchanted('Test Murk Bear');
    expect(pt(s0, id)).toBe('3/3');
    const s = toBlocks(s0, id);
    expect(s.pending?.kind).toBe('declareBlockers');
    expect(applyAction(s, reply(s, { kind: 'declareBlockers', blocks: [] })).error).toBeUndefined();
    const red = enchanted('Test Cinder Bear');
    expect(pt(red.s, red.id)).toBe('2/2');
  });
});

describe('CR 731.1, 608.2c: "Target creature you control gets +2/+0 until end of turn if it\'s night. Then it deals damage equal to its power to target creature you don\'t control."', () => {
  const STRIKE = card('Test Moon Strike', 'Instant', 'Target creature you control gets +2/+0 until end of turn if it\'s night. Then it deals damage equal to its power to target creature you don\'t control.');
  const WOLF = card('Test Howler', 'Creature — Wolf', '', ['2', '2']);
  const OGRE = card('Test Wall Ogre', 'Creature — Ogre', '', ['4', '4']);
  const strike = (time: 'day' | 'night' | undefined): { s: GameState; ogre: ObjectId; wolf: ObjectId } => {
    const s0 = tweak(scenario([], { defs: [STRIKE, WOLF, OGRE], p1: { hand: ['Test Moon Strike'], battlefield: ['Test Howler'] }, p2: { battlefield: ['Test Wall Ogre'] } }), (t) => { t.designations.dayNight = time; });
    const wolf = find(s0, 'Test Howler', 'battlefield', 'p1');
    const ogre = find(s0, 'Test Wall Ogre', 'battlefield', 'p2');
    return { s: castAt(s0, 'Test Moon Strike', [[{ kind: 'object', id: wolf }], [{ kind: 'object', id: ogre }]]), ogre, wolf };
  };
  it('is full', () => expect(full(STRIKE)).toBe(true));
  it('at night the creature is 4/2 and deals 4 damage (the pump comes first): the 4/4 dies', () => {
    const { s, ogre, wolf } = strike('night');
    expect(pt(s, wolf)).toBe('4/2');
    expect(s.zones.battlefield.includes(ogre)).toBe(false);
  });
  it('negative: by day (ruling 2021-11-19) the creature stays 2/2 and still deals its 2 damage: the 4/4 survives with 2 damage', () => {
    const { s, ogre, wolf } = strike('day');
    expect(pt(s, wolf)).toBe('2/2');
    expect(dmg(s, ogre)).toBe(2);
  });
  it('negative: before day or night has begun (neither designation) it is not night either', () => {
    const { s, wolf } = strike(undefined);
    expect(pt(s, wolf)).toBe('2/2');
  });
});

describe('CR 603.4, 603.10a: "At the beginning of your end step, if a permanent you controlled left the battlefield this turn, each opponent loses 3 life."', () => {
  const BIRD = card('Test Spore Bird', 'Creature — Bird', 'At the beginning of your end step, if a permanent you controlled left the battlefield this turn, each opponent loses 3 life.', ['3', '3']);
  const PAWN = card('Test Pawn', 'Creature — Human', '', ['1', '1']);
  const RITE = card('Test Cull', 'Sorcery', 'Target player sacrifices a creature.');
  const SWEEP = card('Test Land Cull', 'Sorcery', 'Destroy target land.');
  const play = (setup: (s: GameState) => GameState): GameState => {
    const s0 = scenario([], { defs: [BIRD, PAWN, RITE, SWEEP], p1: { hand: ['Test Cull', 'Test Land Cull'], battlefield: ['Test Spore Bird', 'Test Pawn'] }, p2: { battlefield: ['Test Pawn', 'Plains'] } });
    return toEnd(setup(s0));
  };
  it('is full', () => expect(full(BIRD)).toBe(true));
  it('a creature of yours sacrificed this turn: each opponent loses 3 life at your end step', () => {
    const s = play((s0) => resolveAll(cast(s0, 'Test Cull', { targets: [{ kind: 'player', id: 'p1' }] }), { objects: [find(s0, 'Test Pawn', 'battlefield', 'p1')] }));
    expect(life(s, 'p2')).toBe(17);
    expect(life(s, 'p1')).toBe(20);
  });
  it('negative: nothing left the battlefield: no loss', () => {
    expect(life(play((s0) => s0), 'p2')).toBe(20);
  });
  it('negative: only an opponent\'s permanent left the battlefield: no loss', () => {
    const s = play((s0) => resolveAll(cast(s0, 'Test Land Cull', { targets: [{ kind: 'object', id: find(s0, 'Plains', 'battlefield', 'p2') }] })));
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 608.2h, 122.1, 611.2a: "Put X +1/+1 counters on target creature, where X is your life total. That creature gains trample until end of turn."', () => {
  const FLOOD = card('Test Tidal Boon', 'Sorcery', 'Put X +1/+1 counters on target creature, where X is your life total. That creature gains trample until end of turn.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const run = (mine: number, theirs: number): { s: GameState; id: ObjectId } => {
    const s0 = tweak(scenario([], { defs: [FLOOD, BEAR], p1: { hand: ['Test Tidal Boon'], battlefield: ['Test Bear'] } }), (t) => { t.players[0]!.life = mine; t.players[1]!.life = theirs; });
    const id = find(s0, 'Test Bear', 'battlefield', 'p1');
    return { s: resolveAll(cast(s0, 'Test Tidal Boon', { targets: [{ kind: 'object', id }] })), id };
  };
  it('is full', () => expect(full(FLOOD)).toBe(true));
  it('as many counters as your life total (13) and trample', () => {
    const { s, id } = run(13, 40);
    expect(s.objects[id]!.counters['+1/+1']).toBe(13);
    expect(pt(s, id)).toBe('15/15');
    expect(hasKeyword(getChars(s, id)!, 'trample')).toBe(true);
  });
  it('negative: an opponent\'s life total is not counted', () => {
    const { s, id } = run(5, 40);
    expect(s.objects[id]!.counters['+1/+1']).toBe(5);
  });
});

describe('CR 509.1b, 611.2a: "Up to two target creatures each get +1/+0 until end of turn and can\'t be blocked this turn."', () => {
  const INGRESS = card('Test Slip Past', 'Instant', 'Up to two target creatures each get +1/+0 until end of turn and can\'t be blocked this turn.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const OGRE = card('Test Wall Ogre', 'Creature — Ogre', '', ['2', '2']);
  const board = (picks: number): { s: GameState; ids: ObjectId[] } => {
    const s0 = scenario([], { defs: [INGRESS, BEAR, OGRE], p1: { hand: ['Test Slip Past'], battlefield: ['Test Bear', 'Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Wall Ogre'] } });
    const ids = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Test Bear');
    return { s: resolveAll(cast(s0, 'Test Slip Past', { targets: ids.slice(0, picks).map((id) => ({ kind: 'object' as const, id })) })), ids };
  };
  it('is full', () => expect(full(INGRESS)).toBe(true));
  it('both targets are 3/2 and cannot be blocked; the third creature is neither', () => {
    const { s: s0, ids } = board(2);
    expect(ids.map((id) => pt(s0, id))).toEqual(['3/2', '3/2', '2/2']);
    const s = passUntil(declareAttackers(toDeclareAttackers(s0), ids.map((id) => [id] as [ObjectId])), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    const ogre = onBf(s, 'Test Wall Ogre')[0]!;
    expect(applyAction(s, reply(s, { kind: 'declareBlockers', blocks: [{ blocker: ogre, attacker: ids[0]! }] })).error).toBeDefined();
    expect(applyAction(s, reply(s, { kind: 'declareBlockers', blocks: [{ blocker: ogre, attacker: ids[1]! }] })).error).toBeDefined();
    expect(applyAction(s, reply(s, { kind: 'declareBlockers', blocks: [{ blocker: ogre, attacker: ids[2]! }] })).error).toBeUndefined();
  });
  it('"up to": one target, or none, is fine', () => {
    expect(board(1).ids.map((id) => pt(board(1).s, id))).toEqual(['3/2', '2/2', '2/2']);
    expect(board(0).ids.map((id) => pt(board(0).s, id))).toEqual(['2/2', '2/2', '2/2']);
  });
});

describe('CR 401.7, 400.3: "{2}{W}: Put ~ from your graveyard into your library second from the top."', () => {
  const SWARM = card('Test Murk Swarm', 'Creature — Bird Horror', '{2}{W}: Put Test Murk Swarm from your graveyard into your library second from the top.', ['2', '2']);
  const RELIC = card('Test Relic', 'Artifact', '');
  const VAULT = card('Test Vault', 'Artifact', '');
  const board = (zone: 'graveyard' | 'battlefield' | 'hand', lands = 3): GameState =>
    scenario([], { defs: [SWARM, RELIC, VAULT], p1: { [zone]: ['Test Murk Swarm'], battlefield: [...(zone === 'battlefield' ? ['Test Murk Swarm'] : []), ...(Array(lands).fill('Plains') as string[])], library: ['Test Relic', 'Test Vault', 'Test Relic'] } });
  const activations = (s: GameState, zone: 'graveyard' | 'battlefield' | 'hand') => legal(s, 'p1', 'activate').filter((a) => (a as { object?: ObjectId }).object === find(s, 'Test Murk Swarm', zone, 'p1') && !(a as { isMana?: boolean }).isMana);
  it('is full', () => expect(full(SWARM)).toBe(true));
  it('from the graveyard it goes under the top card of the library (second from the top)', () => {
    const s0 = board('graveyard');
    const a = activations(s0, 'graveyard')[0] as unknown as { action: Parameters<typeof act>[1] };
    const s = resolveAll(settle(act(s0, a.action)));
    expect(s.zones.library['p1']!.map((id) => s.objects[id]!.defId).slice(0, 4)).toEqual(['Test Relic', 'Test Murk Swarm', 'Test Vault', 'Test Relic']);
    expect(s.zones.graveyard['p1']!.length).toBe(0);
  });
  it('negative: it can only be activated from the graveyard (not on the battlefield or in the hand), and not with two lands', () => {
    expect(activations(board('battlefield'), 'battlefield').length).toBe(0);
    expect(activations(board('hand'), 'hand').length).toBe(0);
    expect(activations(board('graveyard', 2), 'graveyard').length).toBe(0);
  });
});

describe('CR 613.4b, 611.2c: "Until end of turn, each creature you control has base power and toughness 10/10 and gains trample."', () => {
  const ROAR = card('Test Great Roar', 'Sorcery', 'Until end of turn, each creature you control has base power and toughness 10/10 and gains trample.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const MOUSE = card('Test Mouse', 'Creature — Mouse', '', ['1', '1']);
  const run = (): GameState => {
    const s0 = scenario([], { defs: [ROAR, BEAR, MOUSE], p1: { hand: ['Test Great Roar'], battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 1 } }, 'Test Mouse'] }, p2: { battlefield: ['Test Bear'] } });
    return resolveAll(cast(s0, 'Test Great Roar'));
  };
  it('is full', () => expect(full(ROAR)).toBe(true));
  it('your creatures are 10/10 with trample (a +1/+1 counter still adds, ruling 2019-10-04); an opponent\'s creature is untouched', () => {
    const s = run();
    const mine = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1');
    expect(mine.map((id) => pt(s, id)).sort()).toEqual(['10/10', '11/11']);
    for (const id of mine) expect(hasKeyword(getChars(s, id)!, 'trample')).toBe(true);
    const theirs = onBf(s, 'Test Bear', 'p2')[0]!;
    expect(pt(s, theirs)).toBe('2/2');
    expect(hasKeyword(getChars(s, theirs)!, 'trample')).toBe(false);
  });
  it('negative: a creature that enters later this turn is not affected (the set is fixed as it resolves, CR 611.2c)', () => {
    const s0 = run();
    const s = tweak(s0, (t) => { put(t, 'p1', 'battlefield', 'Test Mouse'); });
    const late = onBf(s, 'Test Mouse', 'p1');
    expect(late.map((id) => pt(s, id)).sort()).toEqual(['1/1', '10/10']);
  });
});

describe('CR 401.4, 608.2c: "Draw a card. Then if you don\'t control a legendary creature, put a card from your hand on the bottom of your library."', () => {
  const RIDER = card('Test Gate Rider', 'Creature — Human Soldier', 'When Test Gate Rider enters, draw a card. Then if you don\'t control a legendary creature, put a card from your hand on the bottom of your library.', ['2', '2']);
  const KING = card('Test Old King', 'Legendary Creature — Human Noble', '', ['2', '2']);
  const RELIC = card('Test Relic', 'Artifact', '');
  const VAULT = card('Test Vault', 'Artifact', '');
  const GEM = card('Test Gem', 'Artifact', '');
  const enter = (legend: boolean): GameState => {
    const s0 = scenario([], { defs: [RIDER, KING, RELIC, VAULT, GEM], p1: { hand: ['Test Gate Rider', 'Test Gem'], battlefield: legend ? ['Test Old King'] : [], library: ['Test Relic', 'Test Vault'] } });
    return resolveAll(cast(s0, 'Test Gate Rider'), { objects: [find(s0, 'Test Gem', 'hand', 'p1')] });
  };
  const names = (s: GameState, z: 'hand' | 'library') => s.zones[z]['p1']!.map((id) => s.objects[id]!.defId);
  it('is full', () => expect(full(RIDER)).toBe(true));
  it('with no legendary creature: draws the Relic, then the chosen Gem goes to the bottom of the library', () => {
    const s = enter(false);
    expect(names(s, 'hand')).toEqual(['Test Relic']);
    expect(names(s, 'library')[0]).toBe('Test Vault');
    expect(names(s, 'library').at(-1)).toBe('Test Gem');
  });
  it('negative: with a legendary creature it only draws', () => {
    const s = enter(true);
    expect(names(s, 'hand').sort()).toEqual(['Test Gem', 'Test Relic']);
    expect(names(s, 'library')[0]).toBe('Test Vault');
    expect(names(s, 'library')).not.toContain('Test Gem');
  });
});

describe('CR 700.5: "Create a 0/1 white Goat creature token for each white mana symbol in the mana costs of permanents you control."', () => {
  const HERD = card('Test Goat Herder', 'Creature — Kithkin Wizard', 'Chroma — When Test Goat Herder enters, create a 0/1 white Goat creature token for each white mana symbol in the mana costs of permanents you control.', ['2', '2'], '{3}{W}');
  const KNIGHT = card('Test Pale Knight', 'Creature — Knight', '', ['2', '2'], '{1}{W}{W}');
  const MAGE = card('Test Tide Mage', 'Creature — Wizard', '', ['1', '1'], '{U}');
  const TWIN = card('Test Twin Fey', 'Creature — Faerie', '', ['1', '1'], '{W/U}{W/U}');
  const THEIRS = card('Test Rival Knight', 'Creature — Knight', '', ['2', '2'], '{W}{W}{W}');
  const enter = (mine: string[], theirs: string[] = []): GameState =>
    resolveAll(cast(scenario([], { defs: [HERD, KNIGHT, MAGE, TWIN, THEIRS], p1: { hand: ['Test Goat Herder'], battlefield: [...mine, 'Plains', 'Plains', 'Plains', 'Plains'] }, p2: { battlefield: theirs } }), 'Test Goat Herder'));
  it('is full', () => expect(full(HERD)).toBe(true));
  it('counts its own symbol too: alone it makes 1 Goat (ruling 2008-08-01)', () => {
    expect(tokens(enter([])).length).toBe(1);
  });
  it('counts every white symbol of your permanents, hybrid symbols included, not blue symbols: 1 + 2 + 0 + 2 = 5', () => {
    expect(tokens(enter(['Test Pale Knight', 'Test Tide Mage', 'Test Twin Fey'])).length).toBe(5);
  });
  it('negative: an opponent\'s permanents are not counted', () => {
    expect(tokens(enter([], ['Test Rival Knight'])).length).toBe(1);
  });
});

describe('CR 611.3a, 601.2f, 702.6a: "During your turn, creatures you control have first strike and equip abilities you activate cost {1} less to activate."', () => {
  const STORM = card('Test Storm Walker', 'Legendary Creature — Test', 'During your turn, creatures you control have first strike and equip abilities you activate cost {1} less to activate.', ['1', '1']);
  const BLADE = card('Test Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+0.\nEquip {3}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const base = (walker: boolean, lands: number): GameState =>
    scenario([], { defs: [STORM, BLADE, BEAR], p1: { battlefield: [...(walker ? ['Test Storm Walker'] : []), 'Test Blade', 'Test Bear', ...(Array(lands).fill('Plains') as string[])] } });
  /** Is the equip ability offered (payable) with the lands the player has? */
  const equipError = (s: GameState): boolean => legal(s, 'p1', 'activate').some((a) => (a as { object?: ObjectId }).object === find(s, 'Test Blade', 'battlefield', 'p1') && !(a as { isMana?: boolean }).isMana);
  it('is full', () => expect(full(STORM)).toBe(true));
  it('on your turn: creatures have first strike and equip {3} costs {2}: payable with two lands', () => {
    const s = base(true, 2);
    expect(hasKeyword(getChars(s, find(s, 'Test Bear', 'battlefield', 'p1'))!, 'first strike')).toBe(true);
    expect(equipError(s)).toBe(true);
  });
  it('negative: without the planeswalker equip {3} is not payable with two lands and nothing has first strike', () => {
    const s = base(false, 2);
    expect(hasKeyword(getChars(s, find(s, 'Test Bear', 'battlefield', 'p1'))!, 'first strike')).toBe(false);
    expect(equipError(s)).toBe(false);
  });
  it('negative: on an opponent\'s turn the creatures have no first strike', () => {
    const s = advanceTo(base(true, 3), 2, 'upkeep');
    expect(s.turn.activePlayer).toBe('p2');
    expect(hasKeyword(getChars(s, find(s, 'Test Bear', 'battlefield', 'p1'))!, 'first strike')).toBe(false);
  });
});
