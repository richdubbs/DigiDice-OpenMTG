/**
 * Must-finish round edh-next-146 (group "other", EDHREC ranks 5,001-10,000, code edhn146): the round's readings and engine pieces played through the engine with synthetic cards
 * (invented names, design 6.10), compiled by the game's default compiler. Each test is named after the rule it checks, with its negative case. CR cites checked against the
 * Comprehensive Rules of 2026-09-25 (MagicCompRules 20260925.txt).
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { act, answer, card, drive, find, full, legal, passBoth, resolveAll, scenario } from '../r4-cost/support';
import { pass, reject } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';
import { declareAttackers, passUntil, toDeclareAttackers, tweak } from '../../m4/helpers';
import { concede, mpScenario } from '../../m12/rules/helpers';

const setCounters = (s: GameState, p: string, kind: string, n: number): GameState => tweak(s, (t) => { t.players.find((x) => x.id === p)!.counters[kind] = n; });

// ---- Minthara, Merciless Soul: "~ has ward {X}, where X is the number of experience counters you have." --------------------------------------------------------------
describe('CR 702.21a-b, 107.3: "~ has ward {X}, where X is the number of experience counters you have." (X worked out as the ward trigger resolves)', () => {
  const ELF = card('Test Cruel Elf', 'Legendary Creature — Elf Cleric', 'Test Cruel Elf has ward {X}, where X is the number of experience counters you have.', '{0}', ['2', '2']);
  const ZAP = card('Test Small Zap', 'Instant', 'Test Small Zap deals 1 damage to target creature.');
  const defs = [ELF, ZAP];
  const board = (lands: number, xp: number): GameState => setCounters(scenario(['Mountain'], { defs, p1: { hand: ['Test Small Zap'], battlefield: Array.from({ length: lands }, () => 'Mountain') }, p2: { battlefield: ['Test Cruel Elf'] } }), 'p2', 'experience', xp);
  const zap = (s0: GameState, yes = true): GameState => {
    const elf = find(s0, 'Test Cruel Elf', 'battlefield', 'p2');
    const s1 = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Small Zap', 'hand', 'p1') }), { targets: [[{ kind: 'object', id: elf }]] });
    return resolveAll(s1, { yes: [yes] });
  };
  const damage = (s: GameState): number => s.objects[find(s, 'Test Cruel Elf', 'battlefield', 'p2')]!.damage ?? 0;
  it('is full', () => expect(full(ELF)).toBe(true));
  it('X = 2 experience counters: the opponent who pays {2} keeps the spell', () => expect(damage(zap(board(2, 2)))).toBe(1));
  it('negative: X = 2 and only one land: the spell is countered', () => expect(damage(zap(board(1, 2)))).toBe(0));
  it('negative: declining to pay counters the spell', () => expect(damage(zap(board(2, 2), false))).toBe(0));
  it('X = 0 (no experience counters): the payment of nothing keeps the spell', () => expect(damage(zap(board(0, 0)))).toBe(1));
  it('CR 702.21b: the counters gained after ward triggers count (X is not locked in as it triggers)', () => {
    let s = board(2, 1);
    const elf = find(s, 'Test Cruel Elf', 'battlefield', 'p2');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Small Zap', 'hand', 'p1') }), { targets: [[{ kind: 'object', id: elf }]] });
    // the ward trigger is put on the stack the next time a player would receive priority (CR 117.5)
    for (let i = 0; i < 4 && s.zones.stack.length < 2; i++) s = drive(passBoth(s));
    expect(s.zones.stack.length).toBe(2);
    s = setCounters(s, 'p2', 'experience', 3);
    s = resolveAll(s, { yes: [true] });
    expect(damage(s)).toBe(0); // {3} with two lands: countered
  });
});

// ---- Ramses, Assassin Lord: "Whenever a player loses the game, if they were attacked this turn by an Assassin you controlled, you win the game." ---------------------------------
describe('CR 104.3a, 508.1, 603.4, 603.10a: "Whenever a player loses the game, if they were attacked this turn by an Assassin you controlled, you win the game." (four players)', () => {
  const LORD = card('Test Shadow Master', 'Legendary Creature — Human Assassin', 'Whenever a player loses the game, if they were attacked this turn by an Assassin you controlled, you win the game.', '{0}', ['2', '2']);
  const BLADE = card('Test Knife Runner', 'Creature — Human Assassin', 'Menace', '{0}', ['1', '1']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', 'Vigilance', '{0}', ['2', '2']);
  const defs = [LORD, BLADE, BEAR];
  const board = (p2: string[] = []): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Shadow Master', 'Test Knife Runner', 'Test Plain Bear'] }, p2: { battlefield: p2 } } });
  const id = (s: GameState, n: string, p = 'p1'): ObjectId => find(s, n, 'battlefield', p);
  /** p1 attacks with these creatures, the combat ends without blocks, then `loser` concedes in p1's second main phase; the stack resolves. */
  const play = (attacks: [string, string][], loser: string): GameState => {
    let s = board();
    s = declareAttackers(toDeclareAttackers(s), attacks.map(([n, d]) => [id(s, n), d]));
    s = passUntil(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority' && x.zones.stack.length === 0, 'the second main phase', 200);
    s = concede(s, loser).state;
    return resolveAll(s);
  };
  it('is full', () => expect(full(LORD)).toBe(true));
  it('an Assassin you controlled attacked the player who loses: you win the game', () => {
    const s = play([['Test Knife Runner', 'p2']], 'p2');
    expect(s.result?.winner).toBe('p1');
  });
  it('the source itself (an Assassin) attacked that player: you win', () => expect(play([['Test Shadow Master', 'p3']], 'p3').result?.winner).toBe('p1'));
  it('negative: only a creature that is not an Assassin attacked that player: the game goes on', () => {
    const s = play([['Test Plain Bear', 'p2']], 'p2');
    expect(s.result).toBeNull();
  });
  it('negative: the Assassin attacked another player than the one who loses: the game goes on', () => {
    const s = play([['Test Knife Runner', 'p3']], 'p2');
    expect(s.result).toBeNull();
  });
  it('negative: nobody attacked this turn: the game goes on', () => {
    const s = resolveAll(concede(board(), 'p2').state);
    expect(s.result).toBeNull();
  });
  it('negative (review; ruling: an attacking creature that became an Assassin after attackers were declared does not count): the Bear attacked, then became an Assassin', () => {
    let s = board();
    s = declareAttackers(toDeclareAttackers(s), [[id(s, 'Test Plain Bear'), 'p2']]);
    s = passUntil(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority' && x.zones.stack.length === 0, 'the second main phase', 200);
    const bear = id(s, 'Test Plain Bear');
    s = tweak(s, (t) => { t.objects[bear]!.defId = 'Test Knife Runner' as never; }); // its characteristics now make it an Assassin (still attacking)
    expect(getChars(s, bear).subtypes).toContain('Assassin');
    expect(resolveAll(concede(s, 'p2').state).result).toBeNull();
  });
});

// ---- Psychic Paper: "As this Equipment becomes attached to a creature, choose a creature card name and a creature type." + the last chosen name and creature type ----------
describe('CR 701.3a, 607.2d, 612.8, 613.1d, 613.7e: "As ~ becomes attached to a creature, choose a creature card name and a creature type." and "its name and creature type are the last chosen name and creature type"', () => {
  const PAPER = card('Test Forged Papers', 'Artifact — Equipment', 'As this Equipment becomes attached to a creature, choose a creature card name and a creature type.\nEquipped creature has ward {1}, it can\'t be blocked, and its name and creature type are the last chosen name and creature type.\nEquip {0}');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', 'Vigilance', '{0}', ['2', '2']);
  const ELF = card('Test Oak Elf', 'Creature — Elf Druid', 'Reach', '{0}', ['1', '1']);
  const GIANT = card('Test Mighty Giant', 'Creature — Giant', 'Trample', '{5}', ['5', '5']);
  const ZAP = card('Test Small Zap', 'Instant', 'Test Small Zap deals 1 damage to target creature.');
  const defs = [PAPER, BEAR, ELF, GIANT, ZAP];
  const board = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Forged Papers', 'Test Plain Bear', 'Test Oak Elf'], hand: ['Test Mighty Giant'] }, p2: { hand: ['Test Small Zap'] } });
  const equip = (s0: GameState, target: string): GameState => {
    const paper = find(s0, 'Test Forged Papers', 'battlefield', 'p1');
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === paper)!;
    let s = drive(act(s0, a.action), { targets: [[{ kind: 'object', id: find(s0, target, 'battlefield', 'p1') }]] });
    for (let i = 0; i < 6 && s.zones.stack.length > 0 && s.pending?.kind === 'priority'; i++) s = passBoth(s);
    return s;
  };
  const named = (s: GameState, n: string): GameState => { expect(s.pending).toMatchObject({ kind: 'chooseName' }); return answer(s, { kind: 'chooseName', name: n }); };
  it('is full', () => expect(full(PAPER)).toBe(true));
  it('the choices are made as it becomes attached (no stack): the name, then the creature type; the creature has them, ward {1} and can\'t be blocked', () => {
    let s = equip(board(), 'Test Plain Bear');
    expect(s.pending).toMatchObject({ kind: 'chooseName', what: 'cardName', cardKind: 'creature' });
    s = named(s, 'Test Mighty Giant');
    expect(s.pending).toMatchObject({ kind: 'chooseName', what: 'creatureType' });
    s = named(s, 'Wizard');
    const bear = find(s, 'Test Plain Bear', 'battlefield', 'p1');
    const c = getChars(s, bear)!;
    expect(c.names).toEqual(['Test Mighty Giant']);
    expect(c.subtypes).toEqual(['Wizard']);
    expect(c.keywords.some((k) => (k as { keyword?: string }).keyword === 'ward')).toBe(true);
    expect(s.objects[find(s, 'Test Forged Papers', 'battlefield', 'p1')]!.attachedTo).toBe(bear);
  });
  it('negative (CR 201.3): a name that is not a creature card\'s is refused; a creature type must be one (ruling 2023-10-13)', () => {
    const s = equip(board(), 'Test Plain Bear');
    expect(reject(s, { type: 'answer', player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'chooseName', name: 'Test Small Zap' } }).message).toMatch(/creature card/);
    const t = named(s, 'Test Mighty Giant');
    expect(() => named(t, 'Artifact')).toThrow();
  });
  it('re-equipped to another creature: new choices; the first creature has its own name and types again; the last chosen ones apply', () => {
    let s = named(named(equip(board(), 'Test Plain Bear'), 'Test Mighty Giant'), 'Wizard');
    s = named(named(equip(s, 'Test Oak Elf'), 'Test Plain Bear'), 'Goblin');
    const bear = find(s, 'Test Plain Bear', 'battlefield', 'p1');
    const elfId = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Oak Elf')!;
    expect(getChars(s, bear)!.names).toEqual(['Test Plain Bear']);
    expect(getChars(s, bear)!.subtypes).toEqual(['Bear']);
    expect(getChars(s, bear)!.keywords.some((k) => (k as { keyword?: string }).keyword === 'ward')).toBe(false);
    expect(getChars(s, elfId)!.names).toEqual(['Test Plain Bear']);
    expect(getChars(s, elfId)!.subtypes).toEqual(['Goblin']);
  });
});

// ---- Hellish Rebuke: "Until end of turn, permanents your opponents control gain "When this permanent deals damage to the player who cast ~, sacrifice this permanent. You lose 2 life."" ----
describe('CR 601.2a, 611.2c, 613.1f, 603.2: a granted trigger on damage to "the player who cast" the spell (fixed as the effect is created), its sacrifice and life loss', () => {
  const REBUKE = card('Test Burning Reproach', 'Instant', 'Until end of turn, permanents your opponents control gain "When this permanent deals damage to the player who cast Test Burning Reproach, sacrifice this permanent. You lose 2 life."');
  const TOTEM = card('Test Spark Totem', 'Artifact', '{0}: Test Spark Totem deals 1 damage to any target.');
  const defs = [REBUKE, TOTEM];
  const totemOf = (s: GameState, p: string): ObjectId => find(s, 'Test Spark Totem', 'battlefield', p);
  /** p2 activates its totem at the player `at`, and everything resolves. */
  const zapBy = (s0: GameState, p: string, at: string): GameState => {
    const a = legal(s0, p, 'activate').find((x) => x.object === totemOf(s0, p))!;
    return resolveAll(drive(act(s0, a.action), { targets: [[{ kind: 'player', id: at }]] }));
  };
  const rebuked = (s0: GameState): GameState => pass(resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Burning Reproach', 'hand', 'p1') }))));
  it('is full', () => expect(full(REBUKE)).toBe(true));
  it('an opponent\'s permanent deals damage to the caster: it is sacrificed and its controller loses 2 life', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Burning Reproach'] }, p2: { battlefield: ['Test Spark Totem'] } });
    const s1 = rebuked(s0);
    expect(s1.pending?.player).toBe('p2');
    const s2 = zapBy(s1, 'p2', 'p1');
    expect(s2.zones.battlefield.some((id) => s2.objects[id]!.defId === 'Test Spark Totem')).toBe(false);
    expect(s2.players.find((x) => x.id === 'p2')!.life).toBe(18);
    expect(s2.players.find((x) => x.id === 'p1')!.life).toBe(19);
  });
  it('negative: without the spell nothing happens', () => {
    const s0 = scenario([], { defs, p1: { hand: [] }, p2: { battlefield: ['Test Spark Totem'] } });
    const s2 = zapBy(pass(s0), 'p2', 'p1');
    expect(s2.zones.battlefield.some((id) => s2.objects[id]!.defId === 'Test Spark Totem')).toBe(true);
    expect(s2.players.find((x) => x.id === 'p2')!.life).toBe(20);
  });
  it('negative (four players): damage to another player than the caster does not trigger it', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Burning Reproach'] }, p2: { battlefield: ['Test Spark Totem'] } } });
    const s1 = rebuked(s0);
    expect(s1.pending?.player).toBe('p2');
    const s2 = zapBy(s1, 'p2', 'p3');
    expect(s2.zones.battlefield.some((id) => s2.objects[id]!.defId === 'Test Spark Totem')).toBe(true);
    expect(s2.players.find((x) => x.id === 'p2')!.life).toBe(20);
  });
  it('negative: a permanent of the caster\'s own does not gain it (only the opponents\' permanents)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Burning Reproach'], battlefield: ['Test Spark Totem'] } });
    let s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Burning Reproach', 'hand', 'p1') })));
    s = zapBy(s, 'p1', 'p1');
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Spark Totem')).toBe(true);
    expect(s.players.find((x) => x.id === 'p1')!.life).toBe(19);
  });
  it('negative (CR 707.10, ruling 2021-07-23): a copy that was not cast grants an ability that does nothing: only the cast spell\'s ability triggers (2 life, not 4)', () => {
    const ECHO = card('Test Twin Echo', 'Instant', 'Copy target instant spell you control.');
    const s0 = scenario([], { defs: [...defs, ECHO], p1: { hand: ['Test Burning Reproach', 'Test Twin Echo'] }, p2: { battlefield: ['Test Spark Totem'] } });
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Burning Reproach', 'hand', 'p1') }));
    const spell = s.zones.stack[s.zones.stack.length - 1]!;
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Twin Echo', 'hand', 'p1') }), { targets: [[{ kind: 'object', id: spell }]] });
    s = pass(resolveAll(s));
    s = zapBy(s, 'p2', 'p1');
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Spark Totem')).toBe(false);
    expect(s.players.find((x) => x.id === 'p2')!.life).toBe(18);
  });
  it('two of them this turn: each granted ability triggers on its own (ruling 2021-07-23): 4 life lost', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Burning Reproach', 'Test Burning Reproach'] }, p2: { battlefield: ['Test Spark Totem'] } });
    let s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Burning Reproach', 'hand', 'p1') })));
    s = rebuked(s);
    s = zapBy(s, 'p2', 'p1');
    expect(s.players.find((x) => x.id === 'p2')!.life).toBe(16);
  });
});

// ---- Plague Reaver ---------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.21a: "At the beginning of your end step, sacrifice each other creature you control."', () => {
  const REAVER = card('Test Blight Hulk', 'Creature — Beast', 'At the beginning of your end step, sacrifice each other creature you control.', '{0}', ['6', '5']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', 'Vigilance', '{0}', ['2', '2']);
  const STONE = card('Test Grey Stone', 'Artifact', '{T}: You gain 1 life.');
  it('is full', () => expect(full(REAVER)).toBe(true));
  it('your other creatures are sacrificed at your end step; the source itself, your noncreature permanents and an opponent\'s creatures stay', () => {
    let s = scenario([], { defs: [REAVER, BEAR, STONE], p1: { battlefield: ['Test Blight Hulk', 'Test Plain Bear', 'Test Grey Stone'] }, p2: { battlefield: ['Test Plain Bear'] } });
    for (let i = 0; i < 200 && !(s.turn.step === 'end' && s.zones.stack.length === 0 && s.pending?.kind === 'priority' && s.log.some((l) => /resolves/.test(l.text))); i++) {
      s = s.pending?.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : pass(s);
    }
    const mine = (n: string, p: string) => s.zones.battlefield.some((id) => s.objects[id]!.defId === n && s.objects[id]!.controller === p);
    expect(mine('Test Blight Hulk', 'p1')).toBe(true);
    expect(mine('Test Plain Bear', 'p1')).toBe(false);
    expect(mine('Test Grey Stone', 'p1')).toBe(true);
    expect(mine('Test Plain Bear', 'p2')).toBe(true);
  });
});

describe('CR 603.7a, 603.7c, 110.2, 400.7j, 800.4a: "Discard two cards, Sacrifice ~: Choose target opponent. Return ~ to the battlefield under that player\'s control at the beginning of their next upkeep." (four players)', () => {
  const REAVER = card('Test Blight Hulk', 'Creature — Beast', 'Discard two cards, Sacrifice this creature: Choose target opponent. Return this creature to the battlefield under that player\'s control at the beginning of their next upkeep.', '{0}', ['6', '5']);
  const defs = [REAVER];
  const activate = (target: string): GameState => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Blight Hulk'], hand: ['Plains', 'Plains'] } } });
    const hulk = find(s0, 'Test Blight Hulk', 'battlefield', 'p1');
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === hulk)!;
    return resolveAll(drive(act(s0, a.action), { targets: [[{ kind: 'player', id: target }]] }));
  };
  const where = (s: GameState): { zone: string; controller?: string } => {
    const bf = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Blight Hulk');
    if (bf !== undefined) return { zone: 'battlefield', controller: s.objects[bf]!.controller };
    return { zone: s.zones.graveyard['p1']!.some((id) => s.objects[id]!.defId === 'Test Blight Hulk') ? 'graveyard' : 'elsewhere' };
  };
  const toUpkeepOf = (s: GameState, p: string): GameState => passUntil(s, (x) => x.turn.activePlayer === p && x.turn.step === 'upkeep' && x.zones.stack.length === 0 && x.pending?.kind === 'priority', `the upkeep of ${p}`, 400);
  it('is full', () => expect(full(REAVER)).toBe(true));
  it('the costs: two cards discarded and the creature sacrificed (it is in the graveyard)', () => {
    const s = activate('p3');
    expect(s.zones.graveyard['p1']!.filter((id) => s.objects[id]!.defId === 'Plains').length).toBe(2);
    expect(where(s).zone).toBe('graveyard');
  });
  it('it stays in the graveyard through the upkeep of another opponent, then returns under the chosen opponent\'s control at that player\'s upkeep', () => {
    let s = activate('p3');
    s = toUpkeepOf(s, 'p2');
    expect(where(s).zone).toBe('graveyard');
    s = passUntil(s, (x) => x.turn.activePlayer === 'p3' && x.turn.step === 'draw', 'the draw step of p3', 400);
    expect(where(s)).toEqual({ zone: 'battlefield', controller: 'p3' });
  });
  it('negative (CR 603.7c): a card that left the graveyard before is not returned', () => {
    let s = activate('p2');
    s = tweak(s, (t) => {
      const id = t.zones.graveyard['p1']!.find((x) => t.objects[x]!.defId === 'Test Blight Hulk')!;
      t.zones.graveyard['p1'] = t.zones.graveyard['p1']!.filter((x) => x !== id);
      t.zones.exile.push(id);
      t.objects[id]!.zone = 'exile';
    });
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'draw', 'the draw step of p2', 400);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Blight Hulk')).toBe(false);
  });
  it('negative (ruling 2020-11-10): the chosen opponent left the game before their upkeep: it stays in the graveyard', () => {
    let s = activate('p3');
    s = concede(s, 'p3').state;
    s = passUntil(s, (x) => x.turn.activePlayer === 'p4' && x.turn.step === 'draw', 'the draw step of p4', 400);
    expect(where(s).zone).toBe('graveyard');
  });
});

// ---- Corrupted Shapeshifter: "As this creature enters, it becomes your choice of a 3/3 creature with flying, a 2/5 creature with vigilance, or a 0/12 creature with defender." ---
describe('CR 614.1c, 614.12a, 613.2a, 707.2: "As ~ enters, it becomes your choice of ..." (a copiable effect, layer 1a; rulings 2024-06-07)', () => {
  const SHIFTER = card('Test Void Mimic', 'Creature — Eldrazi Shapeshifter', 'As this creature enters, it becomes your choice of a 3/3 creature with flying, a 2/5 creature with vigilance, or a 0/12 creature with defender.', '{0}', ['0', '0']);
  const HUMBLE = card('Test Grey Field', 'Enchantment', 'All creatures lose all abilities and have base power and toughness 1/1.');
  const MIME = card('Test Mirror Mime', 'Creature — Shapeshifter', 'You may have this creature enter as a copy of any creature on the battlefield.', '{0}', ['0', '0']);
  const defs = [SHIFTER, HUMBLE, MIME];
  const enter = (s0: GameState, option: string): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Void Mimic', 'hand', 'p1') });
    s = drive(s);
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) {
      s = passBoth(s);
      if (s.pending?.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [option] });
    }
    return s;
  };
  const mimic = (s: GameState): ObjectId => find(s, 'Test Void Mimic', 'battlefield', 'p1');
  const kw = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (k as { keyword: string }).keyword);
  it('is full', () => expect(full(SHIFTER)).toBe(true));
  it('each option: its base power and toughness and its keyword, from the moment it enters', () => {
    for (const [opt, p, t, k] of [['0', '3', '3', 'flying'], ['1', '2', '5', 'vigilance'], ['2', '0', '12', 'defender']] as const) {
      const s = enter(scenario([], { defs, p1: { hand: ['Test Void Mimic'] } }), opt);
      const c = getChars(s, mimic(s))!;
      expect([c.power, c.toughness], opt).toEqual([p, t]);
      expect(kw(s, mimic(s)), opt).toEqual([k]);
      expect(c.subtypes).toEqual(['Eldrazi', 'Shapeshifter']);
    }
  });
  it('the choice is offered as it enters (the three options); off the battlefield it is a 0/0 without them', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Void Mimic'] } });
    const id = find(s0, 'Test Void Mimic', 'hand', 'p1');
    expect([getChars(s0, id)!.power, getChars(s0, id)!.toughness]).toEqual(['0', '0']);
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: id }));
    for (let i = 0; i < 4 && s.pending?.kind !== 'chooseOption'; i++) s = passBoth(s);
    expect(s.pending).toMatchObject({ kind: 'chooseOption' });
    expect((s.pending as { options: unknown[] }).options.length).toBe(3);
  });
  it('CR 613.2a: the values are copiable, so a later layer still applies on top: "lose all abilities and have base power and toughness 1/1" makes it a 1/1 without flying', () => {
    const s = enter(scenario([], { defs, p1: { hand: ['Test Void Mimic'], battlefield: ['Test Grey Field'] } }), '0');
    const c = getChars(s, mimic(s))!;
    expect([c.power, c.toughness]).toEqual(['1', '1']);
    expect(kw(s, mimic(s))).toEqual([]);
  });
  it('ruling 2024-06-07: a permanent that enters as a copy of it copies the values its replacement chose', () => {
    let s = enter(scenario([], { defs, p1: { hand: ['Test Void Mimic', 'Test Mirror Mime'] } }), '1');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mirror Mime', 'hand', 'p1') }));
    for (let i = 0; i < 8 && s.zones.stack.length > 0; i++) {
      s = passBoth(s);
      for (let j = 0; j < 6 && s.pending !== null && s.pending.kind !== 'priority'; j++) {
        const d = s.pending;
        if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
        else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [mimic(s)] });
        else if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: ['1'] });
        else break;
      }
    }
    const copies = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Mirror Mime');
    expect(copies.length).toBe(1);
    const c = getChars(s, copies[0]!)!;
    expect([c.power, c.toughness]).toEqual(['2', '5']);
    expect(kw(s, copies[0]!)).toContain('vigilance');
  });
});

// ---- Arena: "{3}, {T}: Tap target creature you control and target creature of an opponent's choice they control. Those creatures fight each other." ---------------------------
describe('CR 601.7, 601.7a, 701.26a, 701.14a: "target creature of an opponent\'s choice they control" (the opponent chooses among their creatures), tapped and then fighting (rulings 2004-10-04, 2006-09-25)', () => {
  const PIT = card('Test Duel Pit', 'Land', '{3}, {T}: Tap target creature you control and target creature of an opponent\'s choice they control. Those creatures fight each other.');
  const OGRE = card('Test Big Ogre', 'Creature — Ogre', 'Trample', '{0}', ['4', '4']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', 'Vigilance', '{0}', ['2', '2']);
  const ELF = card('Test Oak Elf', 'Creature — Elf', 'Reach', '{0}', ['1', '1']);
  const defs = [PIT, OGRE, BEAR, ELF];
  const pitOf = (s: GameState): ObjectId => find(s, 'Test Duel Pit', 'battlefield', 'p1');
  const start = (s0: GameState): GameState => {
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === pitOf(s0) && x.isMana !== true)!;
    return act(s0, a.action);
  };
  const pick = (s: GameState, player: string, id: ObjectId): GameState => {
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', player });
    return answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id }] });
  };
  const board = (): GameState => scenario(['Swamp'], { defs, p1: { battlefield: ['Test Duel Pit', 'Swamp', 'Swamp', 'Swamp', 'Test Big Ogre'] }, p2: { battlefield: ['Test Plain Bear', 'Test Oak Elf'] } });
  it('is full', () => expect(full(PIT)).toBe(true));
  it('you choose your creature; the opponent chooses one of their own creatures (only theirs are offered); both are tapped, then they fight', () => {
    let s = start(board());
    s = pick(s, 'p1', find(s, 'Test Big Ogre', 'battlefield', 'p1'));
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', player: 'p2' });
    const offered = (s.pending as { objects: ObjectId[] }).objects;
    expect(offered.every((id) => s.objects[id]!.controller === 'p2')).toBe(true);
    expect(offered.length).toBe(2);
    s = pick(s, 'p2', find(s, 'Test Oak Elf', 'battlefield', 'p2'));
    s = resolveAll(drive(s));
    const ogre = find(s, 'Test Big Ogre', 'battlefield', 'p1');
    expect(s.objects[ogre]!.tapped).toBe(true);
    expect(s.objects[ogre]!.damage).toBe(1);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Oak Elf')).toBe(false); // 4 damage to the 1/1
    expect(s.objects[find(s, 'Test Plain Bear', 'battlefield', 'p2')]!.tapped).toBe(false);
  });
  it('negative (CR 601.7a): an opponent with no creature can\'t make the choice: with no opponent who can, the ability can\'t be activated', () => {
    const s0 = scenario(['Swamp'], { defs, p1: { battlefield: ['Test Duel Pit', 'Swamp', 'Swamp', 'Swamp', 'Test Big Ogre'] } });
    expect(legal(s0, 'p1', 'activate').some((x) => x.object === pitOf(s0) && x.isMana !== true)).toBe(false);
  });
  it('four players (ruling 2004-10-04): you decide which opponent chooses, only among those who control a creature', () => {
    let s = mpScenario({ defs: [...defs], zones: { p1: { battlefield: ['Test Duel Pit', 'Plains', 'Plains', 'Plains', 'Test Big Ogre'] }, p3: { battlefield: ['Test Plain Bear'] }, p4: { battlefield: ['Test Oak Elf'] } } });
    s = start(s);
    s = pick(s, 'p1', find(s, 'Test Big Ogre', 'battlefield', 'p1'));
    expect(s.pending).toMatchObject({ kind: 'chooseOption', player: 'p1' });
    expect((s.pending as { options: { id: string }[] }).options.map((o) => o.id).sort()).toEqual(['p3', 'p4']);
    s = answer(s, { kind: 'chooseOption', ids: ['p4'] });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', player: 'p4' });
    expect((s.pending as { objects: ObjectId[] }).objects).toEqual([find(s, 'Test Oak Elf', 'battlefield', 'p4')]);
  });
  it('ruling 2006-09-25: one target gone before it resolves: the other is tapped, no damage is dealt', () => {
    let s = start(board());
    s = pick(s, 'p1', find(s, 'Test Big Ogre', 'battlefield', 'p1'));
    s = pick(s, 'p2', find(s, 'Test Plain Bear', 'battlefield', 'p2'));
    s = drive(s);
    s = tweak(s, (t) => {
      const id = t.zones.battlefield.find((x) => t.objects[x]!.defId === 'Test Plain Bear')!;
      t.zones.battlefield = t.zones.battlefield.filter((x) => x !== id);
      t.zones.exile.push(id);
      t.objects[id]!.zone = 'exile';
    });
    s = resolveAll(s);
    const ogre = find(s, 'Test Big Ogre', 'battlefield', 'p1');
    expect(s.objects[ogre]!.tapped).toBe(true);
    expect(s.objects[ogre]!.damage ?? 0).toBe(0);
  });
  it('ruling 2006-09-25 (review): the chosen opponent\'s creature changes to another opponent\'s control before it resolves: an illegal target, no fight; the control-stays negative fights', () => {
    const run = (steal: boolean): { ogre: number; bear: boolean } => {
      let s = mpScenario({ defs: [...defs], zones: { p1: { battlefield: ['Test Duel Pit', 'Plains', 'Plains', 'Plains', 'Test Big Ogre'] }, p3: { battlefield: ['Test Plain Bear'] }, p4: { battlefield: ['Test Oak Elf'] } } });
      s = start(s);
      s = pick(s, 'p1', find(s, 'Test Big Ogre', 'battlefield', 'p1'));
      s = answer(s, { kind: 'chooseOption', ids: ['p3'] });
      const bear = find(s, 'Test Plain Bear', 'battlefield', 'p3');
      s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] });
      s = drive(s);
      if (steal) s = tweak(s, (t) => { t.objects[bear]!.controller = 'p4'; });
      s = resolveAll(s);
      return { ogre: s.objects[find(s, 'Test Big Ogre', 'battlefield', 'p1')]!.damage ?? 0, bear: s.zones.battlefield.includes(bear) };
    };
    expect(run(true)).toEqual({ ogre: 0, bear: true });
    expect(run(false)).toEqual({ ogre: 2, bear: false });
  });
});

// ---- Urborg: "{T}: Target creature loses first strike or swampwalk until end of turn." -------------------------------------------------------------------------------------
describe('CR 608.2d, 613.1f, 702.7a, 702.14c: "Target creature loses first strike or swampwalk until end of turn." (the choice as it resolves; rulings 2009-10-01, 2004-10-04)', () => {
  const TOWER = card('Test Bog Tower', 'Legendary Land', '{T}: Add {B}.\n{T}: Target creature loses first strike or swampwalk until end of turn.');
  const KNIGHT = card('Test Bog Knight', 'Creature — Knight', 'First strike, swampwalk, forestwalk', '{0}', ['2', '2']);
  const DUAL = card('Test Twin Blade', 'Creature — Soldier', 'Double strike', '{0}', ['2', '2']);
  const defs = [TOWER, KNIGHT, DUAL];
  const use = (target: string, option: string): GameState => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Bog Tower'] }, p2: { battlefield: ['Test Bog Knight', 'Test Twin Blade'] } });
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === find(s0, 'Test Bog Tower', 'battlefield', 'p1') && x.isMana !== true)!;
    let s = drive(act(s0, a.action), { targets: [[{ kind: 'object', id: find(s0, target, 'battlefield', 'p2') }]] });
    for (let i = 0; i < 4 && s.zones.stack.length > 0; i++) {
      s = passBoth(s);
      if (s.pending?.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [option] });
    }
    return s;
  };
  const kws = (s: GameState, n: string): string[] => getChars(s, find(s, n, 'battlefield', 'p2'))!.keywords.map((k) => { const x = k as { keyword: string; quality?: string }; return x.quality ? `${x.keyword}:${x.quality}` : x.keyword; });
  const optionOf = (word: string): string => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Bog Tower'] }, p2: { battlefield: ['Test Bog Knight'] } });
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === find(s0, 'Test Bog Tower', 'battlefield', 'p1') && x.isMana !== true)!;
    let s = drive(act(s0, a.action), { targets: [[{ kind: 'object', id: find(s0, 'Test Bog Knight', 'battlefield', 'p2') }]] });
    for (let i = 0; i < 4 && s.pending?.kind !== 'chooseOption'; i++) s = passBoth(s);
    return (s.pending as { options: { id: string; label: string }[] }).options.find((o) => o.label.includes(word))!.id;
  };
  it('is full', () => expect(full(TOWER)).toBe(true));
  it('choosing swampwalk: it loses swampwalk only (first strike and forestwalk stay)', () => {
    const k = kws(use('Test Bog Knight', optionOf('swampwalk')), 'Test Bog Knight');
    expect(k).toContain('first strike');
    expect(k).toContain('landwalk:forest');
    expect(k).not.toContain('landwalk:swamp');
  });
  it('choosing first strike: a creature with both loses just first strike', () => {
    const k = kws(use('Test Bog Knight', optionOf('first strike')), 'Test Bog Knight');
    expect(k).not.toContain('first strike');
    expect(k).toContain('landwalk:swamp');
  });
  it('negative (ruling 2009-10-01): double strike is not first strike: a creature with double strike keeps it', () => {
    const k = kws(use('Test Twin Blade', optionOf('first strike')), 'Test Twin Blade');
    expect(k).toContain('double strike');
  });
});

// ---- Dauntless Bodyguard: "As this creature enters, choose another creature you control." + "Sacrifice this creature: The chosen creature gains indestructible until end of turn." -
describe('CR 614.12a, 607.2d, 400.7, 702.12b: an object chosen as ~ enters and "the chosen creature" of its sacrifice ability (rulings 2018-04-27)', () => {
  const GUARD = card('Test Loyal Shield', 'Creature — Human Knight', 'As this creature enters, choose another creature you control.\nSacrifice this creature: The chosen creature gains indestructible until end of turn.', '{0}', ['2', '1']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', 'Vigilance', '{0}', ['2', '2']);
  const ELF = card('Test Oak Elf', 'Creature — Elf', 'Reach', '{0}', ['1', '1']);
  const BOUNCE = card('Test Quick Recall', 'Instant', 'Return target creature to its owner\'s hand.');
  const defs = [GUARD, BEAR, ELF, BOUNCE];
  const enterChoosing = (s0: GameState, chosen: string | null): GameState => {
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Loyal Shield', 'hand', 'p1') }));
    for (let i = 0; i < 4 && s.zones.stack.length > 0; i++) {
      s = passBoth(s);
      if (s.pending?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [find(s, chosen!, 'battlefield', 'p1')] });
    }
    return s;
  };
  const sacrifice = (s0: GameState): GameState => {
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === find(s0, 'Test Loyal Shield', 'battlefield', 'p1'))!;
    return resolveAll(drive(act(s0, a.action)));
  };
  const indestructible = (s: GameState, n: string): boolean => getChars(s, find(s, n, 'battlefield', 'p1'))!.keywords.some((k) => (k as { keyword: string }).keyword === 'indestructible');
  it('is full', () => expect(full(GUARD)).toBe(true));
  it('the creature chosen as it enters gains indestructible when it is sacrificed (the choice is read after the sacrifice); the other creature does not', () => {
    let s = enterChoosing(scenario([], { defs, p1: { hand: ['Test Loyal Shield'], battlefield: ['Test Plain Bear', 'Test Oak Elf'] } }), 'Test Oak Elf');
    s = sacrifice(s);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Loyal Shield')).toBe(false);
    expect(indestructible(s, 'Test Oak Elf')).toBe(true);
    expect(indestructible(s, 'Test Plain Bear')).toBe(false);
  });
  it('negative: only another creature you control is offered (not an opponent\'s, not itself)', () => {
    let s = drive(act(scenario([], { defs, p1: { hand: ['Test Loyal Shield'], battlefield: ['Test Plain Bear'] }, p2: { battlefield: ['Test Oak Elf'] } }), { type: 'cast', player: 'p1', card: find(scenario([], { defs, p1: { hand: ['Test Loyal Shield'], battlefield: ['Test Plain Bear'] }, p2: { battlefield: ['Test Oak Elf'] } }), 'Test Loyal Shield', 'hand', 'p1') }));
    for (let i = 0; i < 4 && s.pending?.kind !== 'chooseObjects' && s.zones.stack.length > 0; i++) s = passBoth(s);
    expect(s.pending).toMatchObject({ kind: 'chooseObjects' });
    expect((s.pending as { options: ObjectId[] }).options).toEqual([find(s, 'Test Plain Bear', 'battlefield', 'p1')]);
  });
  it('ruling 2018-04-27: the chosen creature left the battlefield (it is a new object): no creature gains indestructible, none is chosen again', () => {
    let s = enterChoosing(scenario([], { defs, p1: { hand: ['Test Loyal Shield', 'Test Quick Recall'], battlefield: ['Test Plain Bear', 'Test Oak Elf'] } }), 'Test Oak Elf');
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Quick Recall', 'hand', 'p1') }), { targets: [[{ kind: 'object', id: find(s, 'Test Oak Elf', 'battlefield', 'p1') }]] }));
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Oak Elf', 'hand', 'p1') }));
    s = resolveAll(s);
    s = sacrifice(s);
    expect(indestructible(s, 'Test Oak Elf')).toBe(false);
    expect(indestructible(s, 'Test Plain Bear')).toBe(false);
  });
  it('negative: with no other creature it enters with nothing chosen and the ability gives nothing', () => {
    let s = enterChoosing(scenario([], { defs, p1: { hand: ['Test Loyal Shield'] } }), null);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Loyal Shield')).toBe(true);
    s = sacrifice(s);
    expect(s.zones.battlefield.length).toBe(0);
  });
});

describe('CR 400.7e, 603.7c: a delayed return of "~" by a trigger on ~ dying finds the card it became in the graveyard', () => {
  const PHOENIX = card('Test Ember Bird', 'Creature — Bird', 'When this creature dies, choose target opponent. Return this creature to the battlefield under that player\'s control at the beginning of their next upkeep.', '{0}', ['1', '1']);
  const ZAP = card('Test Small Zap', 'Instant', 'Test Small Zap deals 1 damage to target creature.');
  it('it dies, then returns under the chosen opponent\'s control at that player\'s upkeep', () => {
    let s = scenario([], { defs: [PHOENIX, ZAP], p1: { battlefield: ['Test Ember Bird'], hand: ['Test Small Zap'] } });
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Small Zap', 'hand', 'p1') }), { targets: [[{ kind: 'object', id: find(s, 'Test Ember Bird', 'battlefield', 'p1') }], [{ kind: 'player', id: 'p2' }]] }), { targets: [[{ kind: 'player', id: 'p2' }]] });
    expect(s.zones.graveyard['p1']!.some((id) => s.objects[id]!.defId === 'Test Ember Bird')).toBe(true);
    for (let i = 0; i < 200 && !(s.turn.activePlayer === 'p2' && s.turn.step === 'draw'); i++) s = s.pending?.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : pass(s);
    const back = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Ember Bird');
    expect(back).toBeDefined();
    expect(s.objects[back!]!.controller).toBe('p2');
  });
});

describe('CR 614.12a, 607.2d, 603.10a: the object chosen as ~ enters read by a static ability and by its leaves-the-battlefield trigger', () => {
  const LORD = card('Test Pit Tyrant', 'Creature — Demon', 'As this creature enters, choose another creature you control.\nThe chosen creature gets +3/+3 and has flying.\nWhen this creature leaves the battlefield, sacrifice the chosen creature.', '{0}', ['4', '4']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', 'Vigilance', '{0}', ['2', '2']);
  const ELF = card('Test Oak Elf', 'Creature — Elf', 'Reach', '{0}', ['1', '1']);
  const BOUNCE = card('Test Quick Recall', 'Instant', 'Return target creature to its owner\'s hand.');
  const defs = [LORD, BEAR, ELF, BOUNCE];
  const enter = (): GameState => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Pit Tyrant', 'Test Quick Recall'], battlefield: ['Test Plain Bear', 'Test Oak Elf'] } });
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Pit Tyrant', 'hand', 'p1') }));
    for (let i = 0; i < 4 && s.zones.stack.length > 0; i++) {
      s = passBoth(s);
      if (s.pending?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Plain Bear', 'battlefield', 'p1')] });
    }
    return s;
  };
  it('is full', () => expect(full(LORD)).toBe(true));
  it('the chosen creature gets +3/+3 and flying; the other does not', () => {
    const s = enter();
    const bear = getChars(s, find(s, 'Test Plain Bear', 'battlefield', 'p1'))!;
    expect([bear.power, bear.toughness]).toEqual(['5', '5']);
    expect(getChars(s, find(s, 'Test Oak Elf', 'battlefield', 'p1'))!.power).toBe('1');
  });
  it('when it leaves the battlefield, the chosen creature is sacrificed (the choice read after it left); the other stays', () => {
    let s = enter();
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Quick Recall', 'hand', 'p1') }), { targets: [[{ kind: 'object', id: find(s, 'Test Pit Tyrant', 'battlefield', 'p1') }]] }));
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Plain Bear')).toBe(false);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Oak Elf')).toBe(true);
  });
});
