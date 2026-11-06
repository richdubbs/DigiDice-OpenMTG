/**
 * Round edh-next-139 (must-finish round, group tokens): the behaviour it added, played through the engine with synthetic cards (invented names, the printed wordings of the
 * real cards), compiled by the game's default compiler, in four-player games.
 *
 *   CR 205.1b, 301.5, 613.1d, 613.1f, 702.6a,  Gemcutter Buccaneer: "Whenever this creature or another Pirate you control enters, create a tapped Treasure token. Treasures you control
 *   702.6c, 701.21a                            are Equipment in addition to their other types and have "Equipped creature gets +2/+0," equip Pirate {1}, and equip {3}."
 *   CR 111.4, 201.5a, 113.7a, 702.6a,          Toggo, Goblin Weaponsmith: "Landfall -- Whenever a land you control enters, create a colorless Equipment artifact token named Rock with
 *   701.21a, 118.3                            "Equipped creature has '{1}, {T}, Sacrifice Rock: This creature deals 2 damage to any target'" and equip {1}." (ruling 2020-11-10: the
 *                                             equipped creature is the source of the ability and of the damage)
 *   CR 101.4, 119.4, 118.3, 608.2c, 608.2d,    Plague of Vermin: "Starting with you, each player may pay any amount of life. Repeat this process until no one pays life. Each player creates a
 *   111.1                                     1/1 black Rat creature token for each 1 life they paid this way." (rulings 2008-05-01: the process ends only when all players in sequence
 *                                             pay nothing; a player who declined may pay on a later pass; at most their life total; each payment is a separate life loss; all the
 *                                             tokens are made after the process)
 *   CR 105.2, 105.2c, 608.2h, 603.2,          Jenson Carthalion, Druid Exile: "Whenever you cast a multicolored spell, scry 1. If that spell was all colors, create a 4/4 white Angel creature
 *   111.1                                     token with flying and vigilance." (the spell as it last existed when it has left the stack: CR 608.2h)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, legalActions, type GameState, type OracleCard } from '../../../src/index';
import { act, find, mpScenario } from '../../m12/rules/helpers';
import { card, full } from '../cmd3/helpers';
import { activate, bfOf, powerOf, run, texts, tokensOf } from './helpers';

const GEM = card('Gemcrafter Corsair', 'Creature — Orc Pirate Artificer', 'Whenever this creature or another Pirate you control enters, create a tapped Treasure token.\nTreasures you control are Equipment in addition to their other types and have "Equipped creature gets +2/+0," equip Pirate {1}, and equip {3}.', ['2', '2']);
const PIRATE = card('Deckhand Testo', 'Creature — Human Pirate', '', ['1', '1']);
const BEAR = card('Plain Bear', 'Creature — Bear', '', ['2', '2']);
const TREASURE_MAKER = card('Coin Spiller', 'Sorcery', 'Create a Treasure token.');

describe('CR 205.1b, 613.1d, 613.1f, 702.6a, 702.6c: Gemcutter Buccaneer ("Treasures you control are Equipment ... and have ... equip Pirate {1}, and equip {3}")', () => {
  it('compiles full', () => expect(full(GEM)).toBe(true));
  const start = (): GameState => mpScenario({ defs: [GEM, PIRATE, BEAR, TREASURE_MAKER], zones: { p1: { hand: ['Gemcrafter Corsair', 'Deckhand Testo', 'Coin Spiller'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plain Bear'] }, p2: { hand: ['Coin Spiller'] } } });

  it('the enter trigger makes a tapped Treasure that is an Equipment with the two equip abilities and its mana ability', () => {
    let s = run(act(start(), { type: 'cast', player: 'p1', card: find(start(), 'Gemcrafter Corsair', 'hand', 'p1') }));
    const [t] = tokensOf(s, 'p1', 'Treasure');
    expect(t).toBeDefined();
    expect(s.objects[t!]!.tapped).toBe(true);
    expect(getChars(s, t!)!.subtypes).toEqual(expect.arrayContaining(['Treasure', 'Equipment']));
    expect(getChars(s, t!)!.types).toEqual(['Artifact']);
    const ts = texts(s, t!).map((x) => x.toLowerCase());
    expect(ts.some((x) => x.startsWith('equip pirate {1}'))).toBe(true);
    expect(ts.some((x) => x === 'equip {3}')).toBe(true);
    // another Pirate entering triggers it too; a non-Pirate does not
    s = run(act(s, { type: 'cast', player: 'p1', card: find(s, 'Deckhand Testo', 'hand', 'p1') }));
    expect(tokensOf(s, 'p1', 'Treasure')).toHaveLength(2);
  });

  it('equip Pirate {1} attaches only to a Pirate you control; the equipped creature gets +2/+0; sacrificing the Treasure for mana unattaches it', () => {
    let s = run(act(start(), { type: 'cast', player: 'p1', card: find(start(), 'Gemcrafter Corsair', 'hand', 'p1') }));
    s = run(act(s, { type: 'cast', player: 'p1', card: find(s, 'Deckhand Testo', 'hand', 'p1') }));
    const pirate = bfOf(s, PIRATE.id, 'p1')[0]!;
    const bear = bfOf(s, BEAR.id, 'p1')[0]!;
    const [t1] = tokensOf(s, 'p1', 'Treasure');
    // the Pirate-only equip offers no non-Pirate target
    const s1 = activate(s, t1!, /^equip pirate/i);
    expect(s1.pending?.kind).toBe('chooseTargets');
    const options = (s1.pending as unknown as { objects: string[] }).objects;
    expect(options).toContain(pirate);
    expect(options).not.toContain(bear);
    s = run(s1, { targets: [pirate] });
    expect(s.objects[t1!]!.attachedTo).toBe(pirate);
    expect(powerOf(s, pirate)).toBe(3);
    // equip {3} may move it to any creature you control
    s = run(activate(s, t1!, /^equip \{3\}$/i), { targets: [bear] });
    expect(s.objects[t1!]!.attachedTo).toBe(bear);
    expect(powerOf(s, bear)).toBe(4);
    expect(powerOf(s, pirate)).toBe(1);
    // CR 701.21a, 400.7: sacrificed for its mana, it leaves and the creature loses the bonus (it entered tapped: untapped here as by an untap step)
    s = structuredClone(s);
    s.objects[t1!]!.tapped = false;
    s = run(activate(s, t1!, /^\{T\}, Sacrifice/i));
    expect(s.zones.battlefield).not.toContain(t1);
    expect(powerOf(s, bear)).toBe(2);
  });

  it('an opponent\'s Treasure is no Equipment (only Treasures you control)', () => {
    const s = run(act(start(), { type: 'cast', player: 'p1', card: find(start(), 'Gemcrafter Corsair', 'hand', 'p1') }));
    // the Treasure under another player's control (CR 108.4): the static ability no longer reaches it
    const t = tokensOf(s, 'p1', 'Treasure')[0]!;
    const s2 = structuredClone(s);
    s2.objects[t]!.controller = 'p2';
    expect(getChars(s2, t)!.subtypes).not.toContain('Equipment');
    expect(texts(s2, t).some((x) => /equip/i.test(x))).toBe(false);
  });
});

const TOGGO = card('Gobbo Smithwright', 'Legendary Creature — Goblin Artificer', 'Landfall — Whenever a land you control enters, create a colorless Equipment artifact token named Rock with "Equipped creature has \'{1}, {T}, Sacrifice Rock: This creature deals 2 damage to any target\'" and equip {1}.\nPartner', ['2', '2']);
const RED_BEAR = { ...card('Red Testbear', 'Creature — Bear', '', ['2', '2']), colors: ['R'] };

describe('CR 111.4, 201.5a, 113.7a, 702.6a: Toggo, Goblin Weaponsmith (the Rock token: "Equipped creature has \'{1}, {T}, Sacrifice Rock: This creature deals 2 damage to any target\'")', () => {
  it('compiles full', () => expect(full(TOGGO)).toBe(true));
  const start = (): GameState => mpScenario({ defs: [TOGGO, BEAR], zones: { p1: { hand: ['Plains', 'Plains'], battlefield: ['Plains', 'Plains', 'Plains', 'Gobbo Smithwright', 'Plain Bear'] } } });
  const landfall = (s: GameState): GameState => run(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Plains', 'hand', 'p1') }));

  it('a land entering makes a colorless Equipment artifact token named Rock with equip {1}; the equipped creature gets the ability, sacrifices THAT Rock and deals the damage itself', () => {
    let s = landfall(start());
    const rocks = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(rocks).toHaveLength(1);
    const rock = rocks[0]!;
    const c = getChars(s, rock)!;
    expect(c.name).toBe('Rock');
    expect(c.types).toEqual(['Artifact']);
    expect(c.subtypes).toEqual(['Equipment']);
    expect(c.colors ?? []).toEqual([]);
    const bear = bfOf(s, BEAR.id, 'p1')[0]!;
    // not attached: the bear has no such ability
    expect(texts(s, bear)).toHaveLength(0);
    s = run(activate(s, rock, /^equip \{1\}$/i), { targets: [bear] });
    expect(s.objects[rock]!.attachedTo).toBe(bear);
    expect(texts(s, bear).some((t) => /sacrifice rock/i.test(t))).toBe(true);
    // the bear has been under p1's control since the turn began (put there before the game moved on), so it may use {T}
    const life = s.players.find((p) => p.id === 'p2')!.life;
    s = run(activate(s, bear, /sacrifice rock/i), { targets: ['p2'] });
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(life - 2);
    expect(s.objects[bear]!.tapped).toBe(true);
    // CR 113.7a (ruling 2020-11-10): the equipped creature is the source of the damage
    expect(s.log.some((l) => /Plain Bear deals 2 damage/i.test(l.text))).toBe(true);
    expect(s.zones.battlefield).not.toContain(rock);
  });

  it('with two Rocks on two creatures, each creature sacrifices the Rock that grants its ability (the grantor), not the other one', () => {
    let s = landfall(start());
    s = structuredClone(s);
    s.players.find((p) => p.id === 'p1')!.landsPlayedThisTurn = 0; // a second land this turn (as with an extra land drop)
    s = landfall(s);
    const rocks = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(rocks).toHaveLength(2);
    const bear = bfOf(s, BEAR.id, 'p1')[0]!;
    const toggo = bfOf(s, TOGGO.id, 'p1')[0]!;
    s = run(activate(s, rocks[0]!, /^equip \{1\}$/i), { targets: [bear] });
    s = run(activate(s, rocks[1]!, /^equip \{1\}$/i), { targets: [toggo] });
    expect(s.objects[rocks[0]!]!.attachedTo).toBe(bear);
    expect(s.objects[rocks[1]!]!.attachedTo).toBe(toggo);
    s = structuredClone(s);
    for (const id of s.zones.battlefield) if (s.objects[id]!.defId === 'Plains') s.objects[id]!.tapped = false;
    s = run(activate(s, bear, /sacrifice rock/i), { targets: ['p3'] });
    expect(s.zones.battlefield).not.toContain(rocks[0]);
    expect(s.zones.battlefield).toContain(rocks[1]);
    expect(s.objects[bear]!.tapped).toBe(true);
    expect(s.objects[toggo]!.tapped).toBe(false);
  });
});

const PLAGUE = card('Vermin Tide', 'Sorcery', 'Starting with you, each player may pay any amount of life. Repeat this process until no one pays life. Each player creates a 1/1 black Rat creature token for each 1 life they paid this way.');

describe('CR 101.4, 119.4, 608.2c-d: Plague of Vermin (each player in turn pays any amount of life, repeated until no one pays; tokens for each life each paid)', () => {
  it('compiles full', () => expect(full(PLAGUE)).toBe(true));
  const start = (): GameState => mpScenario({ defs: [PLAGUE], life: 10, zones: { p1: { hand: ['Vermin Tide'] } } });
  const cast = (script: (who: string, pass: number, max: number) => number, asked: string[] = []): GameState => {
    const passes: Record<string, number> = {};
    const s0 = start();
    return run(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Vermin Tide', 'hand', 'p1') }), {
      asked,
      number: (_min, max, _prompt, who) => { passes[who] = (passes[who] ?? 0) + 1; return script(who, passes[who]!, max); },
    });
  };
  const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
  const rats = (s: GameState, p: string): number => tokensOf(s, p, 'Rat').length;

  it('the players are asked in turn order starting with you; each gets a Rat for each 1 life THEY paid over every pass; the process stops after a pass where no one paid', () => {
    const order: string[] = [];
    const s = cast((who, pass) => {
      order.push(`${who}#${pass}`);
      if (who === 'p1') return pass === 1 ? 2 : pass === 2 ? 1 : 0;
      if (who === 'p2') return pass === 1 ? 0 : pass === 2 ? 3 : 0; // declined first, paid on a later pass (ruling)
      if (who === 'p3') return pass === 1 ? 1 : 0;
      return 0;
    });
    expect(order).toEqual(['p1#1', 'p2#1', 'p3#1', 'p4#1', 'p1#2', 'p2#2', 'p3#2', 'p4#2', 'p1#3', 'p2#3', 'p3#3', 'p4#3']);
    expect([life(s, 'p1'), life(s, 'p2'), life(s, 'p3'), life(s, 'p4')]).toEqual([7, 7, 9, 10]);
    expect([rats(s, 'p1'), rats(s, 'p2'), rats(s, 'p3'), rats(s, 'p4')]).toEqual([3, 3, 1, 0]);
    const r = tokensOf(s, 'p1', 'Rat')[0]!;
    expect(getChars(s, r)!.colors).toEqual(['B']);
    expect([getChars(s, r)!.power, getChars(s, r)!.toughness].map(Number)).toEqual([1, 1]);
  });

  it('no one pays on the first pass: the process ends at once and nobody gets a token', () => {
    const order: string[] = [];
    const s = cast((who, pass) => { order.push(`${who}#${pass}`); return 0; });
    expect(order).toEqual(['p1#1', 'p2#1', 'p3#1', 'p4#1']);
    expect([0, 1, 2, 3].map((k) => rats(s, `p${k + 1}`))).toEqual([0, 0, 0, 0]);
  });

  it('a player may pay at most their life total (ruling 2008-05-01): the most offered shrinks as they pay', () => {
    const maxes: number[] = [];
    const s = cast((who, pass, max) => { if (who === 'p2') { maxes.push(max); return pass === 1 ? 6 : pass === 2 ? max - 1 : 0; } return 0; });
    expect(maxes.slice(0, 2)).toEqual([10, 4]);
    expect(life(s, 'p2')).toBe(1);
    expect(rats(s, 'p2')).toBe(9);
  });
});

const JENSON = card('Druid Exile Testo', 'Legendary Creature — Human Druid', 'Whenever you cast a multicolored spell, scry 1. If that spell was all colors, create a 4/4 white Angel creature token with flying and vigilance.\n{5}, {T}: Add {W}{U}{B}{R}{G}.', ['4', '4']);
/** A sorcery of these colors (its color indicator, CR 204: castable for {0} here, the colors are what the trigger reads). */
const colored = (name: string, colors: string[]) => compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: 'Sorcery', oracle_text: 'Draw a card.', colors } as OracleCard);
const FIVE = colored('Rainbow Testspell', ['W', 'U', 'B', 'R', 'G']);
const TWO = colored('Twotone Testspell', ['U', 'R']);
const FOUR = colored('Fourtone Testspell', ['W', 'U', 'B', 'R']);

describe('CR 105.2, 105.2c, 608.2h: Jenson Carthalion, Druid Exile ("If that spell was all colors, create a 4/4 white Angel ...")', () => {
  it('compiles full', () => expect(full(JENSON)).toBe(true));
  const play = (spell: string): GameState => {
    const s0 = mpScenario({ defs: [JENSON, FIVE, TWO, FOUR], zones: { p1: { hand: [spell], battlefield: ['Druid Exile Testo'] } } });
    return run(act(s0, { type: 'cast', player: 'p1', card: find(s0, spell, 'hand', 'p1') }), { objects: () => [] });
  };
  const angels = (s: GameState): string[] => tokensOf(s, 'p1', 'Angel');
  it('a five-color spell: scry 1 and a 4/4 white Angel with flying and vigilance', () => {
    const s = play('Rainbow Testspell');
    expect(s.log.some((l) => /scr(y|ies)/i.test(l.text))).toBe(true);
    const [a] = angels(s);
    expect(a).toBeDefined();
    const c = getChars(s, a!)!;
    expect([Number(c.power), Number(c.toughness)]).toEqual([4, 4]);
    expect(c.colors).toEqual(['W']);
    expect(c.keywords.map((k) => (typeof k === 'string' ? k : k.keyword))).toEqual(expect.arrayContaining(['flying', 'vigilance']));
  });
  it('a two-color or four-color spell: the scry only, no Angel', () => {
    const two = play('Twotone Testspell');
    expect(two.log.some((l) => /scr(y|ies)/i.test(l.text))).toBe(true); // the trigger did resolve
    expect(angels(two)).toHaveLength(0);
    expect(angels(play('Fourtone Testspell'))).toHaveLength(0);
  });
});

const DECREE = card('Edict of Testing', 'Sorcery', 'Create X 4/4 white Angel creature tokens with flying.\nCycling {2}{W}\nWhen you cycle this card, you may pay {X}. If you do, create X 1/1 white Soldier creature tokens.', undefined, '{X}{X}{W}');

describe('CR 702.29c, 107.3, 118.12: Decree of Justice ("When you cycle this card, you may pay {X}. If you do, create X 1/1 white Soldier creature tokens.")', () => {
  it('compiles full', () => expect(full(DECREE)).toBe(true));
  const start = (): GameState => mpScenario({ defs: [DECREE], zones: { p1: { hand: ['Edict of Testing'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'] } } });
  const cycle = (sc: Parameters<typeof run>[1]): GameState => {
    const s0 = start();
    return run(activate(s0, find(s0, 'Edict of Testing', 'hand', 'p1'), /^cycling/i), sc);
  };
  // the hand after cycling: the cycled card discarded, one card drawn (the hand also holds the card drawn in the turn's draw step)
  const handSize = (s: GameState): number => s.zones.hand['p1']!.length - start().zones.hand['p1']!.length + 1;
  it('cycled: the trigger asks to pay {X}; paying X = 3 makes three 1/1 white Soldiers; the cycling still draws a card, after the trigger', () => {
    const s = cycle({ yes: () => true, number: (_min, max) => Math.min(3, max) });
    const soldiers = tokensOf(s, 'p1', 'Soldier');
    expect(soldiers).toHaveLength(3);
    const c = getChars(s, soldiers[0]!)!;
    expect([Number(c.power), Number(c.toughness)]).toEqual([1, 1]);
    expect(c.colors).toEqual(['W']);
    expect(tokensOf(s, 'p1', 'Angel')).toHaveLength(0);
    // 3 Plains paid the cycling, 3 more the X
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.tapped)).toHaveLength(6);
    expect(handSize(s)).toBe(1);
    const drawAt = s.log.map((l, i) => (/draws? (a|1) card/i.test(l.text) ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    const tokensAt = s.log.findIndex((l) => /Soldier/i.test(l.text));
    expect(tokensAt).toBeGreaterThanOrEqual(0);
    expect(drawAt).toBeGreaterThan(tokensAt);
  });
  it('declined: no Soldier, the card is still drawn', () => {
    const s = cycle({ yes: () => false });
    expect(tokensOf(s, 'p1', 'Soldier')).toHaveLength(0);
    expect(handSize(s)).toBe(1);
  });
  it('cast instead (X = 1, {X}{X}{W} = three mana): one 4/4 flying Angel, no Soldier (the cycle trigger does not trigger on a cast)', () => {
    const s0 = start();
    const s = run(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Edict of Testing', 'hand', 'p1') }), { number: () => 1 });
    expect(tokensOf(s, 'p1', 'Angel')).toHaveLength(1);
    expect(tokensOf(s, 'p1', 'Soldier')).toHaveLength(0);
  });
});

const HUNT = card('Wild Hunt Testmaster', 'Creature — Human Shaman', 'At the beginning of your upkeep, create a 2/2 green Wolf creature token.\n{T}: Tap all untapped Wolf creatures you control. Each Wolf tapped this way deals damage equal to its power to target creature. That creature deals damage equal to its power divided as its controller chooses among any number of those Wolves.', ['2', '2']);
const WOLF = card('Test Wolf', 'Creature — Wolf', '', ['2', '2']);
const OGRE = card('Big Testogre', 'Creature — Ogre', '', ['3', '5']);

describe('CR 701.26a, 608.2c-d, 120.2b: Master of the Wild Hunt (Wolves tapped this way deal damage to the target; it divides its damage among them, chosen by its controller)', () => {
  it('compiles full', () => expect(full(HUNT)).toBe(true));
  const start = (): GameState => mpScenario({ defs: [HUNT, WOLF, OGRE], zones: { p1: { battlefield: ['Wild Hunt Testmaster', 'Test Wolf', 'Test Wolf', { name: 'Test Wolf', tapped: true }] }, p2: { battlefield: ['Big Testogre'] } } });
  it('only the untapped Wolves are tapped and deal damage; the target\'s controller divides its 3 damage among those Wolves only', () => {
    const s0 = start();
    const master = bfOf(s0, HUNT.id, 'p1')[0]!;
    const ogre = bfOf(s0, OGRE.id, 'p2')[0]!;
    const wolves = bfOf(s0, WOLF.id, 'p1');
    const [w1, w2, w3] = wolves as [string, string, string];
    let offered: string[] = [];
    let divider = '';
    const s = run(activate(s0, master, /^\{T\}: Tap all/i), { targets: [ogre], assign: (ids, amount, who) => { offered = ids; divider = who; return ids.map((id) => (id === w1 ? 2 : id === w2 ? amount - 2 : 0)); } });
    expect(divider).toBe('p2');
    expect([...offered].sort()).toEqual([w1, w2].sort());
    expect(s.objects[ogre]?.damage ?? 0).toBe(4); // 2 + 2 from the two Wolves tapped this way (the third was tapped already)
    expect(s.zones.battlefield).not.toContain(w1); // 2 damage: dies
    expect(s.objects[w2]!.damage).toBe(1);
    expect(s.objects[w3]!.damage).toBe(0);
  });
  it('the target is gone before it resolves: nothing happens (ruling), the Wolves stay untapped', () => {
    const s0 = start();
    const master = bfOf(s0, HUNT.id, 'p1')[0]!;
    const ogre = bfOf(s0, OGRE.id, 'p2')[0]!;
    let s = run(activate(s0, master, /^\{T\}: Tap all/i), { targets: [ogre], noPass: true });
    s = structuredClone(s);
    // the Ogre leaves the battlefield in response (as if bounced): moved to its owner's hand
    s.zones.battlefield = s.zones.battlefield.filter((id) => id !== ogre);
    s.zones.hand['p2']!.push(ogre);
    s.objects[ogre]!.zone = 'hand';
    s = run(s);
    const wolves = bfOf(s, WOLF.id, 'p1');
    expect(wolves.filter((id) => s.objects[id]!.tapped)).toHaveLength(1);
  });
});

const PALADIN = card('Oathless Testknight', 'Creature — Human Knight', 'Menace\n{1}{B}, {T}, Pay 1 life: Create a Treasure token.\n{2}{B}: Target creature gets +2/+0 until end of turn. If mana from a Treasure was spent to activate this ability, that creature also gains deathtouch until end of turn.', ['1', '4']);

describe('CR 602.2b, 106.3: Forsworn Paladin ("If mana from a Treasure was spent to activate this ability, that creature also gains deathtouch")', () => {
  it('compiles full', () => expect(full(PALADIN)).toBe(true));
  const start = (): GameState => mpScenario({ cards: ['Swamp'], defs: [PALADIN, BEAR], zones: { p1: { battlefield: ['Oathless Testknight', 'Plain Bear', 'Swamp', 'Swamp', 'Swamp', 'Swamp', 'Swamp'] } } });
  const kw = (s: GameState, id: string): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword: string }).keyword));
  it('with mana from a Treasure: +2/+0 and deathtouch until end of turn', () => {
    let s = start();
    const knight = bfOf(s, PALADIN.id, 'p1')[0]!;
    const bear = bfOf(s, BEAR.id, 'p1')[0]!;
    s = run(activate(s, knight, /Create a Treasure/i));
    const [t] = tokensOf(s, 'p1', 'Treasure');
    s = run(activate(s, t!, /^\{T\}, Sacrifice/i), { color: 'B' });
    expect(s.players.find((p) => p.id === 'p1')!.manaPool.length).toBeGreaterThan(0);
    s = run(activate(s, knight, /^\{2\}\{B\}: Target creature/i), { targets: [bear] });
    expect(powerOf(s, bear)).toBe(4);
    expect(kw(s, bear)).toContain('deathtouch');
  });
  it('without mana from a Treasure: only +2/+0', () => {
    let s = start();
    const knight = bfOf(s, PALADIN.id, 'p1')[0]!;
    const bear = bfOf(s, BEAR.id, 'p1')[0]!;
    s = run(activate(s, knight, /^\{2\}\{B\}: Target creature/i), { targets: [bear] });
    expect(powerOf(s, bear)).toBe(4);
    expect(kw(s, bear)).not.toContain('deathtouch');
  });
});

const DOOM = card('Doom Testfluence', 'Sorcery', 'Choose X. You may choose the same mode more than once.\n• Each player sacrifices a nonartifact creature of their choice.\n• Create a 3/3 black Dalek artifact creature token with menace.\n• Each opponent discards a card.', undefined, '{X}{B}{B}');
const BOT = card('Testbot', 'Artifact Creature — Construct', '', ['1', '1']);

describe('CR 601.2b, 601.4, 700.2d: Doomsday Confluence ("Choose X. You may choose the same mode more than once.")', () => {
  it('compiles full', () => expect(full(DOOM)).toBe(true));
  const start = (swamps = 5): GameState => mpScenario({ cards: ['Swamp'], defs: [DOOM, BEAR, BOT], zones: {
    p1: { hand: ['Doom Testfluence'], battlefield: Array(swamps).fill('Swamp') },
    p2: { battlefield: ['Plain Bear', 'Testbot'], hand: ['Plains'] }, p3: { battlefield: ['Plain Bear'] }, p4: { battlefield: ['Testbot'] },
  } });
  it('three modes (sacrifice once, Dalek twice): X is 3, so {3}{B}{B} is paid; the modes happen in the order written', () => {
    const s0 = start();
    let maxOffered = -1;
    const s = run(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Doom Testfluence', 'hand', 'p1') }), {
      pick: (_o, _prompt, _who, _min, max) => { maxOffered = max; return ['0', '1', '1']; },
    });
    expect(maxOffered).toBe(3); // five Swamps: X can be at most 3
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Swamp' && s.objects[id]!.tapped)).toHaveLength(5);
    const daleks = tokensOf(s, 'p1', 'Dalek');
    expect(daleks).toHaveLength(2);
    const c = getChars(s, daleks[0]!)!;
    expect(c.types).toEqual(['Artifact', 'Creature']);
    expect(c.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword: string }).keyword))).toContain('menace');
    // the sacrifice came first (the Daleks, made after it, are still there); each player sacrificed a NONARTIFACT creature
    expect(bfOf(s, BEAR.id)).toHaveLength(0);
    expect(bfOf(s, BOT.id)).toHaveLength(2);
    // the discard mode was not chosen
    expect(s.zones.hand['p2']!.length).toBe(s0.zones.hand['p2']!.length);
  });
  it('X = 1 (one mode, each opponent discards): one mana for X', () => {
    const s0 = start();
    const s = run(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Doom Testfluence', 'hand', 'p1') }), { pick: () => ['2'], objects: (o, _p, _s, _w, _max, min) => o.slice(0, Math.max(1, min)) });
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Swamp' && s.objects[id]!.tapped)).toHaveLength(3);
    expect(s.zones.hand['p2']!.length).toBe(s0.zones.hand['p2']!.length - 1);
    expect(tokensOf(s, 'p1', 'Dalek')).toHaveLength(0);
  });
  it('review fix (CR 107.3b): cast without paying its mana cost, X is 0: it can be cast, with no mode, and does nothing', () => {
    const OMNI = card('Free Testmind', 'Enchantment', 'You may cast spells from your hand without paying their mana costs.');
    const s0 = mpScenario({ defs: [DOOM, OMNI, BEAR], zones: { p1: { hand: ['Doom Testfluence'], battlefield: ['Free Testmind'] }, p2: { battlefield: ['Plain Bear'] } } });
    const casts = legalActions(s0, 'p1').map((a) => a.action).filter((a) => a.type === 'cast' && (a as { card: string }).card === find(s0, 'Doom Testfluence', 'hand', 'p1'));
    const free = casts.find((a) => (a as { method?: string }).method !== undefined);
    expect(free).toBeDefined(); // offered with the granted free cost
    let maxOffered = -1;
    const s = run(act(s0, free! as never), { pick: (_o, _p, _w, _min, max) => { maxOffered = max; return []; } });
    expect(maxOffered === -1 || maxOffered === 0).toBe(true);
    expect(bfOf(s, BEAR.id, 'p2')).toHaveLength(1);
    expect(tokensOf(s, 'p1', 'Dalek')).toHaveLength(0);
  });
  it('more modes than X can be paid for are refused', () => {
    const s0 = start(3);
    expect(() => run(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Doom Testfluence', 'hand', 'p1') }), { pick: () => ['1', '1'] })).toThrow();
  });
});

const HAVEN = compileCard({ name: 'Testgul Lab // Testgul Mystery', layout: 'transform', type_line: 'Legendary Land // Legendary Land', colors: [], card_faces: [
  { name: 'Testgul Lab', type_line: 'Legendary Land', mana_cost: '', oracle_text: '{T}: Add {C}.\n{4}, {T}: Investigate.\nAt the beginning of your end step, if you sacrificed three or more Clues this turn, transform Testgul Lab.' },
  { name: 'Testgul Mystery', type_line: 'Legendary Land', mana_cost: '', oracle_text: 'When this land transforms into Testgul Mystery, return target creature card from your graveyard to the battlefield.\nWhen the creature put onto the battlefield with Testgul Mystery leaves the battlefield, transform Testgul Mystery.\n{T}, Pay 1 life: Add {B}.' },
] } as unknown as OracleCard);
const CLUES = card('Triple Testclue', 'Sorcery', 'Investigate three times.');
const KILL = card('Test Murder', 'Instant', 'Destroy target creature.');

describe('CR 607.2c, 603.10a: Havengul Mystery ("When the creature put onto the battlefield with Havengul Mystery leaves the battlefield, transform Havengul Mystery.")', () => {
  it('compiles full', () => { expect(full(HAVEN)).toBe(true); expect(full(CLUES)).toBe(true); });
  it('three Clues sacrificed: the end step transforms it; the creature card returns; when THAT creature leaves, it transforms back (another creature leaving does not)', () => {
    let s = mpScenario({ defs: [HAVEN, CLUES, KILL, BEAR, WOLF], zones: { p1: { hand: ['Triple Testclue', 'Test Murder', 'Test Murder'], graveyard: ['Plain Bear'], battlefield: ['Testgul Lab // Testgul Mystery', 'Test Wolf', ...Array(10).fill('Plains')] } } });
    const lab = bfOf(s, HAVEN.id, 'p1')[0]!;
    s = run(act(s, { type: 'cast', player: 'p1', card: find(s, 'Triple Testclue', 'hand', 'p1') }));
    const clues = tokensOf(s, 'p1', 'Clue');
    expect(clues).toHaveLength(3);
    for (const c of clues) s = run(activate(s, c, /sacrifice/i));
    expect(s.objects[lab]!.face).toBe(0);
    s = run(s, { until: (x) => x.turn.step === 'end' && x.zones.stack.length === 0 && x.objects[lab]!.face === 1 && bfOf(x, BEAR.id, 'p1').length === 1 });
    expect(s.objects[lab]!.face).toBe(1);
    const bear = bfOf(s, BEAR.id, 'p1')[0]!;
    expect(bear).toBeDefined();
    // another creature dying: nothing (it was not put onto the battlefield with the land)
    const wolf = bfOf(s, WOLF.id, 'p1')[0]!;
    s = run(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Murder', 'hand', 'p1') }), { targets: [wolf] });
    expect(s.objects[lab]!.face).toBe(1);
    // the returned creature leaving: the land transforms back
    s = run(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Murder', 'hand', 'p1') }), { targets: [bear] });
    expect(s.zones.battlefield).not.toContain(bear);
    expect(s.objects[lab]!.face).toBe(0);
  });
});

const RING = card('Testing Ring', 'Artifact', "Whenever a creature you control enters, it fights up to one target creature you don't control with the same mana value.\n{T}: Create a Treasure token. Activate only if you control a creature that fought this turn.", undefined, '{0}');
const TWO_DROP = card('Two Testboxer', 'Creature — Human', '', ['3', '3'], '{2}');
const SMALL_TWO = card('Small Testboxer', 'Creature — Human', '', ['1', '1'], '{2}');
const OPP_TWO = card('Opp Twodrop', 'Creature — Ogre', '', ['2', '2'], '{1}{R}');
const OPP_THREE = card('Opp Threedrop', 'Creature — Ogre', '', ['1', '1'], '{2}{R}');
const OPP_BIG_TWO = card('Opp Bigtwo', 'Creature — Ogre', '', ['5', '5'], '{1}{G}');

describe('CR 701.14a, 202.3, 602.5b: Boxing Ring (fights a creature with the same mana value; "Activate only if you control a creature that fought this turn")', () => {
  it('compiles full', () => expect(full(RING)).toBe(true));
  const start = (mine: string, theirs: string[]): GameState => mpScenario({ defs: [RING, TWO_DROP, SMALL_TWO, OPP_TWO, OPP_THREE, OPP_BIG_TWO], zones: { p1: { hand: [mine], battlefield: ['Testing Ring', 'Plains', 'Plains'] }, p2: { battlefield: theirs } } });
  const treasureOk = (s: GameState): boolean => { try { run(activate(s, bfOf(s, RING.id, 'p1')[0]!, /Create a Treasure/i)); return true; } catch { return false; } };
  it('a creature you control enters: it fights the target with the same mana value; then the Treasure ability can be activated (not before)', () => {
    const s0 = start('Two Testboxer', ['Opp Twodrop', 'Opp Threedrop']);
    expect(treasureOk(s0)).toBe(false); // nothing fought yet
    const two = bfOf(s0, OPP_TWO.id, 'p2')[0]!;
    const s = run(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Two Testboxer', 'hand', 'p1') }), { targets: [two] });
    expect(s.zones.battlefield).not.toContain(two); // 3 damage to the 2/2: dies
    const boxer = bfOf(s, TWO_DROP.id, 'p1')[0]!;
    expect(s.objects[boxer]!.damage).toBe(2);
    expect(treasureOk(s)).toBe(true);
  });
  it('the target options hold only creatures you don\'t control with the same mana value', () => {
    const s0 = start('Two Testboxer', ['Opp Twodrop', 'Opp Threedrop']);
    const two = bfOf(s0, OPP_TWO.id, 'p2')[0]!;
    const three = bfOf(s0, OPP_THREE.id, 'p2')[0]!;
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Two Testboxer', 'hand', 'p1') });
    for (let i = 0; i < 40 && s.pending?.kind !== 'chooseTargets'; i++) s = s.pending?.kind === 'priority' ? act(s, { type: 'pass', player: s.pending.player }) : run(s, { noPass: true });
    expect(s.pending?.kind).toBe('chooseTargets');
    const options = (s.pending as unknown as { objects: string[] }).objects;
    expect(options).toContain(two);
    expect(options).not.toContain(three);
    expect(options).not.toContain(bfOf(s, TWO_DROP.id, 'p1')[0]);
  });
  it('the only creature that fought died in the fight: the Treasure ability can\'t be activated (ruling)', () => {
    const s0 = start('Small Testboxer', ['Opp Bigtwo']);
    const big = bfOf(s0, OPP_BIG_TWO.id, 'p2')[0]!;
    const s = run(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Small Testboxer', 'hand', 'p1') }), { targets: [big] });
    expect(bfOf(s, SMALL_TWO.id, 'p1')).toHaveLength(0);
    expect(treasureOk(s)).toBe(false);
  });
});
