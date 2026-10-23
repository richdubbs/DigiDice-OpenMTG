/**
 * FAST4 T26: the shapes of parser/templates/zz-fast4/t26.json and the engine additions they needed, played through the engine with synthetic cards compiled by
 * the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 121.2, 701.9b, 608.2c   "draw two cards, then discard one of them": the choice is among the cards just drawn, never a card already in hand
 *   CR 701.9a-b, 608.2c        "discard any number of cards, then draw that many cards plus one"; "discard your hand, then draw cards equal to the number
 *                              of cards discarded this way"
 *   CR 508.1, 603.2c           "whenever one or more Dinosaurs you control attack, create that many Treasure tokens": the number of those attackers
 *   CR 119.3, 107.3, 608.2h    "each opponent loses X life and you gain X life, where X is the number of Vampires you control"
 *   CR 608.2h, 202.3           "Destroy target creature. If its mana value was 2 or less, create a Food token" (last known information)
 *   CR 119.3, 608.2c           "draw a card if you've gained 3 or more life this turn" (checked as the ability resolves); "each opponent mills X cards, where
 *                              X is the amount of life you gained this turn"
 *   CR 701.9a, 119.3, 406.1    "each opponent discards a card, loses 2 life, and exiles the top three cards of their library"
 *   CR 111.1, 110.5b           "create a number of tapped Treasure tokens equal to its power" (dies trigger: last known power)
 *   CR 611.2c                  "each other attacking creature gets +1/+0 until end of turn"
 *   CR 201.2                   "draw X cards, where X is the number of differently named lands you control"
 *   CR 111.4                   "create X 2/2 colorless Wizard Soldier creature tokens named Cadet, where X is the amount of life you gained this turn"
 *   CR 608.2c                  "create a 2/2 green Wolf creature token if you control a creature with power 4 or greater"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, battlefieldNames, find, findAll, legal, life, pass, scenario, zoneNames } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';
import { tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated and the card full (the T26 templates are stable). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const power = (s: GameState, id: ObjectId): number => Number(getChars(s, id)!.power);

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
const resolve = (s: GameState, answers: DecisionAnswer[] = []): GameState => settle(pass(pass(s)), [], answers);
const castWith = (s0: GameState, name: string, targets: TargetChoice[] = []): GameState => settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), targets);
function activate(s: GameState, name: string, targets: TargetChoice[] = []): GameState {
  const id = find(s, name, 'battlefield', 'p1');
  const la = legal(s, 'p1', 'activate').find((a) => a.object === id && !a.isMana);
  if (!la) throw new Error(`no activated ability of ${name}`);
  return settle(act(s, la.action), targets);
}
const gained = (s: GameState, n: number): GameState => tweak(s, (t) => { t.players.find((p) => p.id === 'p1')!.turnStats.lifeGained = n; });

const ELF = card('Test Elf', 'Creature — Elf', '', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '1']);
const ROCK = card('Test Rock', 'Artifact', '');

describe('CR 121.2, 701.9b, 608.2c: "{0}: Draw two cards, then discard one of them"', () => {
  const SAGE = card('Test Tome Sage', 'Creature — Human Wizard', '{0}: Draw two cards, then discard one of them.', ['1', '1']);
  it('is automated, and the discard is chosen among the two cards just drawn only', () => {
    expect(full(SAGE)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Ogre'], battlefield: ['Test Tome Sage'], library: ['Test Elf', 'Test Rock', 'Test Elf'] }, defs: [SAGE, ELF, OGRE, ROCK] });
    const ogre = find(s0, 'Test Ogre', 'hand', 'p1');
    const s = pass(pass(activate(s0, 'Test Tome Sage')));
    const p = s.pending!;
    expect(p.kind).toBe('chooseObjects');
    if (p.kind !== 'chooseObjects') return;
    expect(p.min).toBe(1);
    expect(p.options).toHaveLength(2);
    expect(p.options).not.toContain(ogre); // CR 608.2c: "them" is the drawn cards
    const rock = p.options.find((id) => s.objects[id]!.defId === 'Test Rock')!;
    const done = settle(answer(s, { kind: 'chooseObjects', ids: [rock] }));
    expect(zoneNames(done, 'graveyard', 'p1')).toEqual(['Test Rock']);
    expect([...zoneNames(done, 'hand', 'p1')].sort()).toEqual(['Test Elf', 'Test Ogre']);
  });
});

describe('CR 701.9a-b, 608.2c: "discard any number of cards, then draw that many cards plus one"; "discard your hand, then draw cards equal to the number of cards discarded this way"', () => {
  const COLOSSUS = card('Test Blood Colossus', 'Sorcery', 'Discard any number of cards, then draw that many cards plus one.');
  const KNOW = card('Test Borrowed Lore', 'Sorcery', 'Discard your hand, then draw cards equal to the number of cards discarded this way.');
  it('the player chooses any number of cards in hand (none allowed), discards them, and draws one more than that', () => {
    expect(full(COLOSSUS)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Blood Colossus', 'Test Elf', 'Test Ogre', 'Test Rock'], library: ['Test Elf', 'Test Elf', 'Test Elf', 'Test Elf', 'Test Elf'] }, defs: [COLOSSUS, ELF, OGRE, ROCK] });
    const s = pass(pass(castWith(s0, 'Test Blood Colossus')));
    const p = s.pending!;
    expect(p.kind).toBe('chooseObjects');
    if (p.kind !== 'chooseObjects') return;
    expect(p.min).toBe(0);
    expect(p.options).toHaveLength(3);
    const two = p.options.filter((id) => s.objects[id]!.defId !== 'Test Rock');
    const done = settle(answer(s, { kind: 'chooseObjects', ids: two }));
    expect([...zoneNames(done, 'graveyard', 'p1')].sort()).toEqual(['Test Blood Colossus', 'Test Elf', 'Test Ogre']);
    expect(zoneNames(done, 'hand', 'p1').filter((n) => n === 'Test Elf')).toHaveLength(3); // 2 + 1
    expect(zoneNames(done, 'hand', 'p1')).toContain('Test Rock');
    // none discarded: one card drawn
    const none = settle(answer(s, { kind: 'chooseObjects', ids: [] }));
    expect(zoneNames(none, 'hand', 'p1')).toHaveLength(4);
  });
  it('"discard your hand, then draw cards equal to the number of cards discarded this way" draws as many as were discarded', () => {
    expect(full(KNOW)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Borrowed Lore', 'Test Ogre', 'Test Ogre', 'Test Rock'], library: ['Test Elf', 'Test Elf', 'Test Elf', 'Test Elf'] }, defs: [KNOW, ELF, OGRE, ROCK] });
    const s = resolve(castWith(s0, 'Test Borrowed Lore'));
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Elf', 'Test Elf', 'Test Elf']);
    expect(zoneNames(s, 'graveyard', 'p1')).toHaveLength(4);
  });
});

describe('CR 508.1, 603.2c: "Whenever one or more Dinosaurs you control attack, create that many Treasure tokens"', () => {
  const VERSE = card('Test Dino Verse', 'Enchantment', 'Whenever one or more Dinosaurs you control attack, create that many Treasure tokens.');
  const DINO = card('Test Dino', 'Creature — Dinosaur', '', ['3', '3']);
  const treasures = (s: GameState): number => battlefieldNames(s, 'p1').filter((n) => n !== 'Test Dino' && n !== 'Test Elf' && n !== 'Test Dino Verse').length;
  it('is automated: one trigger for the batch, and as many Treasures as Dinosaurs attacked (the Elf does not count)', () => {
    expect(full(VERSE)).toBe(true);
    expect(JSON.stringify(VERSE.faces)).toContain('"count":{"q":"eventAmount"}');
    let s = scenario([], { p1: { battlefield: ['Test Dino Verse', 'Test Dino', 'Test Dino', 'Test Elf'] }, defs: [VERSE, DINO, ELF] });
    const [a, b] = findAll(s, 'Test Dino', 'battlefield', 'p1') as [ObjectId, ObjectId];
    const elf = find(s, 'Test Elf', 'battlefield', 'p1');
    s = declareAttackers(toDeclareAttackers(s), [[a], [b], [elf]]);
    s = passUntil(s, (x) => treasures(x) > 0, 'the trigger to resolve', 20);
    expect(treasures(s)).toBe(2);
  });
  it('one Dinosaur attacking alone is one Treasure (the batch of one has the amount 1)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Dino Verse', 'Test Dino'] }, defs: [VERSE, DINO] });
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Dino', 'battlefield', 'p1')]]);
    s = passUntil(s, (x) => treasures(x) > 0, 'the trigger to resolve', 20);
    expect(treasures(s)).toBe(1);
  });
  it('"whenever ~ attacks, create that many Treasure tokens" has no number to read: it stays manual', () => {
    const ONE = card('Test Lone Dino', 'Creature — Dinosaur', 'Whenever Test Lone Dino attacks, create that many Treasure tokens.', ['3', '3']);
    expect(JSON.stringify(ONE.faces)).toContain('"op":"manual"');
  });
});

describe('CR 119.3, 107.3, 608.2h: "each opponent loses X life and you gain X life, where X is ..."', () => {
  const TEMPLE = card('Test Bat Temple', 'Enchantment', '{0}: Each opponent loses X life and you gain X life, where X is the number of Bats you control.');
  const BAT = card('Test Bat', 'Creature — Bat', '', ['1', '1']);
  it('is automated, and X is the number of Bats you control as it resolves', () => {
    expect(full(TEMPLE)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Bat Temple', 'Test Bat', 'Test Bat', 'Test Bat'] }, p2: { battlefield: ['Test Bat'] }, defs: [TEMPLE, BAT] });
    const s = resolve(activate(s0, 'Test Bat Temple'));
    expect(life(s, 'p2')).toBe(17);
    expect(life(s, 'p1')).toBe(23);
  });
});

describe('CR 608.2h, 202.3: "Destroy target creature. If its mana value was 2 or less, create a Food token"', () => {
  const TREATS = card('Test Tainted Snack', 'Instant', 'Destroy target creature. If its mana value was 2 or less, create a Food token.');
  const CHEAP = card('Test Cheap Elf', 'Creature — Elf', '', ['1', '1'], '{1}{G}');
  const DEAR = card('Test Dear Ogre', 'Creature — Ogre', '', ['5', '5'], '{4}{R}');
  const foods = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.defId.startsWith('token:Food')).length;
  it('is automated; the mana value is the destroyed creature\'s (last known information): 2 makes a Food, 5 does not', () => {
    expect(full(TREATS)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Tainted Snack', 'Test Tainted Snack'] }, p2: { battlefield: ['Test Cheap Elf', 'Test Dear Ogre'] }, defs: [TREATS, CHEAP, DEAR] });
    const cheap = find(s, 'Test Cheap Elf', 'battlefield', 'p2');
    const dear = find(s, 'Test Dear Ogre', 'battlefield', 'p2');
    s = resolve(castWith(s, 'Test Tainted Snack', [obj(cheap)]));
    expect(zoneNames(s, 'graveyard', 'p2')).toContain('Test Cheap Elf');
    expect(foods(s)).toBe(1);
    s = resolve(castWith(s, 'Test Tainted Snack', [obj(dear)]));
    expect(zoneNames(s, 'graveyard', 'p2')).toContain('Test Dear Ogre');
    expect(foods(s)).toBe(1);
  });
});

describe('CR 119.3, 608.2c: life gained this turn', () => {
  const HALO = card('Test Halo Lamp', 'Artifact', "{0}: Draw a card if you've gained 3 or more life this turn.");
  const HOPE = card('Test Hope Mill', 'Artifact', '{0}: Each opponent mills X cards, where X is the amount of life you gained this turn.');
  const CADET = card('Test Cadet Call', 'Sorcery', 'Create X 2/2 colorless Wizard Soldier creature tokens named Cadet, where X is the amount of life you gained this turn.');
  it('"draw a card if you\'ve gained 3 or more life this turn" is checked as the ability resolves', () => {
    expect(full(HALO)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Halo Lamp'], library: ['Test Elf', 'Test Elf'] }, defs: [HALO, ELF] });
    expect(zoneNames(resolve(activate(gained(s0, 2), 'Test Halo Lamp')), 'hand', 'p1')).toEqual([]);
    expect(zoneNames(resolve(activate(gained(s0, 3), 'Test Halo Lamp')), 'hand', 'p1')).toEqual(['Test Elf']);
  });
  it('"each opponent mills X cards, where X is the amount of life you gained this turn"', () => {
    expect(full(HOPE)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Hope Mill'] }, p2: { library: ['Test Elf', 'Test Elf', 'Test Elf', 'Test Elf'] }, defs: [HOPE, ELF] });
    const s = resolve(activate(gained(s0, 3), 'Test Hope Mill'));
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Elf', 'Test Elf', 'Test Elf']);
    expect(zoneNames(s, 'library', 'p2')).toHaveLength(zoneNames(s0, 'library', 'p2').length - 3);
  });
  it('CR 111.4: "create X ... tokens named Cadet": X tokens, each a 2/2 colorless Wizard Soldier named Cadet', () => {
    expect(full(CADET)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Cadet Call'] }, defs: [CADET] });
    const s = resolve(castWith(gained(s0, 2), 'Test Cadet Call'));
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1');
    expect(tokens).toHaveLength(2);
    for (const id of tokens) {
      const c = getChars(s, id)!;
      expect(c.names).toEqual(['Cadet']);
      expect([c.power, c.toughness, c.colors.length]).toEqual(['2', '2', 0]);
      expect([...c.subtypes].sort()).toEqual(['Soldier', 'Wizard']);
    }
  });
});

describe('CR 701.9a, 119.3, 406.1: "each opponent discards a card, loses 2 life, and exiles the top three cards of their library"', () => {
  const MAL = card('Test Mal Fiend', 'Artifact', '{0}: Each opponent discards a card, loses 2 life, and exiles the top three cards of their library.');
  it('is automated, and the opponent does all three, the exiled cards coming from their own library', () => {
    expect(full(MAL)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Mal Fiend'], library: ['Test Rock', 'Test Rock', 'Test Rock'] }, p2: { hand: ['Test Ogre'], library: ['Test Elf', 'Test Elf', 'Test Elf', 'Test Elf'] }, defs: [MAL, ELF, OGRE, ROCK] });
    const s = resolve(activate(s0, 'Test Mal Fiend'));
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Ogre']);
    expect(life(s, 'p2')).toBe(18);
    expect(zoneNames(s, 'library', 'p2')).toHaveLength(zoneNames(s0, 'library', 'p2').length - 3);
    expect(s.zones.exile.map((id) => [s.objects[id]!.owner, s.objects[id]!.defId])).toEqual([['p2', 'Test Elf'], ['p2', 'Test Elf'], ['p2', 'Test Elf']]);
    expect(zoneNames(s, 'library', 'p1')).toEqual(zoneNames(s0, 'library', 'p1'));
  });
});

describe('CR 111.1, 110.5b, 608.2h: "When ~ dies, create a number of tapped Treasure tokens equal to its power"', () => {
  const HYDRA = card('Test Gold Hydra', 'Creature — Hydra', 'When Test Gold Hydra dies, create a number of tapped Treasure tokens equal to its power.', ['3', '3']);
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
  it('is automated: as many tapped Treasures as its last known power', () => {
    expect(full(HYDRA)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Kill'], battlefield: [{ name: 'Test Gold Hydra', counters: { '+1/+1': 2 } }] }, defs: [HYDRA, KILL] });
    s = resolve(castWith(s, 'Test Kill', [obj(find(s, 'Test Gold Hydra', 'battlefield', 'p1'))]));
    s = resolve(s);
    const treasures = s.zones.battlefield.filter((id) => s.objects[id]!.defId !== 'Test Gold Hydra');
    expect(treasures).toHaveLength(5);
    expect(treasures.every((id) => s.objects[id]!.tapped)).toBe(true);
  });
});

describe('CR 611.2c: "Whenever ~ attacks, each other attacking creature gets +1/+0 until end of turn"', () => {
  const BAT = card('Test Belfry Bat', 'Creature — Bat', 'Flying\nWhenever Test Belfry Bat attacks, each other attacking creature gets +1/+0 until end of turn.', ['1', '1']);
  it('the other attackers get +1/+0, the source and a creature that did not attack do not', () => {
    expect(full(BAT)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Belfry Bat', 'Test Elf', 'Test Elf', 'Test Ogre'] }, defs: [BAT, ELF, OGRE] });
    const bat = find(s, 'Test Belfry Bat', 'battlefield', 'p1');
    const [a, b] = findAll(s, 'Test Elf', 'battlefield', 'p1') as [ObjectId, ObjectId];
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
    s = declareAttackers(toDeclareAttackers(s), [[bat], [a], [b]]);
    s = passUntil(s, (x) => power(x, a) === 3, 'the trigger to resolve', 20);
    expect([power(s, bat), power(s, a), power(s, b), power(s, ogre)]).toEqual([1, 3, 3, 3]);
  });
});

describe('CR 201.2: "Draw X cards, where X is the number of differently named lands you control"', () => {
  const SCROLL = card('Test Fate Scroll', 'Artifact', '{0}: Draw X cards, where X is the number of differently named lands you control.');
  const FOREST = card('Test Forest', 'Land — Forest', '');
  const ISLAND = card('Test Island', 'Land — Island', '');
  it('two lands of one name and one of another are two names', () => {
    expect(full(SCROLL)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Fate Scroll', 'Test Forest', 'Test Forest', 'Test Island'], library: ['Test Elf', 'Test Elf', 'Test Elf'] }, p2: { battlefield: ['Test Island'] }, defs: [SCROLL, FOREST, ISLAND, ELF] });
    const s = resolve(activate(s0, 'Test Fate Scroll'));
    expect(zoneNames(s, 'hand', 'p1')).toHaveLength(2);
  });
});

describe('CR 608.2c: "Create a 2/2 green Wolf creature token if you control a creature with power 4 or greater"', () => {
  const SCAV = card('Test Wolf Call', 'Artifact', '{0}: Create a 2/2 green Wolf creature token if you control a creature with power 4 or greater.');
  const BIG = card('Test Big Ogre', 'Creature — Ogre', '', ['4', '4']);
  it('creates the token only when the condition holds as it resolves', () => {
    expect(full(SCAV)).toBe(true);
    const small = resolve(activate(scenario([], { p1: { battlefield: ['Test Wolf Call', 'Test Ogre'] }, defs: [SCAV, OGRE] }), 'Test Wolf Call'));
    expect(small.zones.battlefield).toHaveLength(2);
    const big = resolve(activate(scenario([], { p1: { battlefield: ['Test Wolf Call', 'Test Big Ogre'] }, defs: [SCAV, BIG] }), 'Test Wolf Call'));
    expect(big.zones.battlefield).toHaveLength(3);
  });
});

describe('CR 107.3, 608.2h: "Create a 0/0 green and blue Fractal creature token and put X +1/+1 counters on it, where X is the number of cards you\'ve drawn this turn"', () => {
  const FRACTAL = card('Test Fractal Burst', 'Sorcery', "Create a 0/0 green and blue Fractal creature token and put X +1/+1 counters on it, where X is the number of cards you've drawn this turn.");
  it('is automated (renderer reading of the where-X counters), and the token gets one counter per card drawn this turn', () => {
    expect(full(FRACTAL)).toBe(true);
    const s0 = tweak(scenario([], { p1: { hand: ['Test Fractal Burst'] }, defs: [FRACTAL] }), (t) => { t.players.find((p) => p.id === 'p1')!.turnStats.cardsDrawn = 3; });
    const s = resolve(castWith(s0, 'Test Fractal Burst'));
    const token = s.zones.battlefield.find((id) => s.objects[id]!.controller === 'p1')!;
    expect(s.objects[token]!.counters['+1/+1']).toBe(3);
    expect(power(s, token)).toBe(3);
  });
});
